import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPrivacyNotice,
  hasSpecialCategoryData,
  privacyPageUrl,
  readRetentionMonths,
} from "../../src/features/privacy/privacy-rules.ts";
import {
  eraseContact,
  eraseExpiredContacts,
  removeStorageFolder,
} from "../../src/features/privacy/services/contact-erasure.ts";

interface FakeOptions {
  files?: Record<string, { name: string; id: string | null }[]>;
  conversations?: { id: string }[];
  listError?: string;
  removeError?: string;
  expired?: { workspace_id: string; contact_id: string }[];
}

function fakeDb(options: FakeOptions = {}) {
  const calls: string[] = [];
  const files = { ...options.files };
  const db = {
    storage: {
      from: () => ({
        list: async (prefix: string) => {
          if (options.listError) return { data: null, error: { message: options.listError } };
          calls.push(`list:${prefix}`);
          return { data: files[prefix] ?? [], error: null };
        },
        remove: async (paths: string[]) => {
          if (options.removeError) return { error: { message: options.removeError } };
          calls.push(`remove:${paths.join(",")}`);
          for (const path of paths) {
            const prefix = path.slice(0, path.lastIndexOf("/"));
            const name = path.slice(path.lastIndexOf("/") + 1);
            files[prefix] = (files[prefix] ?? []).filter((f) => f.name !== name);
          }
          return { error: null };
        },
      }),
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        insert: async (row: { type: string; payload: { count: number } }) => {
          calls.push(`insert:${table}:${row.type}:${row.payload.count}`);
          return { error: null };
        },
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: options.conversations ?? [], error: null }),
      };
      return query;
    },
    rpc: async (name: string, args: { p_contact_id?: string }) => {
      calls.push(`rpc:${name}:${args.p_contact_id ?? ""}`);
      if (name === "expired_contacts") return { data: options.expired ?? [], error: null };
      return { data: true, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

test("el aviso dice que responde una IA, que se guardan datos y cómo decidir", () => {
  const texto = buildPrivacyNotice("Barbería El Faro", "https://ejemplo.com/privacidad");
  for (const parte of ["Barbería El Faro", "inteligencia artificial", "una persona", "borrar", "BAJA", "https://ejemplo.com/privacidad"]) {
    assert.ok(texto.includes(parte), parte);
  }
});

test("la dirección de privacidad no queda con barras de más ni vacía", () => {
  assert.equal(privacyPageUrl("https://mi.app/"), "https://mi.app/privacidad");
  assert.equal(privacyPageUrl(undefined), "https://arm-whatsapp.vercel.app/privacidad");
});

test("el plazo de conservación es 12 meses salvo un valor permitido", () => {
  assert.equal(readRetentionMonths(null), 12);
  assert.equal(readRetentionMonths({ retention_months: 24 }), 24);
  assert.equal(readRetentionMonths({ retention_months: 0 }), 0);
  assert.equal(readRetentionMonths({ retention_months: 7 }), 12);
  assert.equal(readRetentionMonths({ retention_months: "24" }), 12);
});

test("detecta datos sensibles con o sin tildes, y deja pasar los comunes", () => {
  assert.equal(hasSpecialCategoryData("Tiene DIABETES tipo 2"), true);
  assert.equal(hasSpecialCategoryData("Está embarazada de 3 meses"), true);
  assert.equal(hasSpecialCategoryData("Su religión no le permite"), true);
  assert.equal(hasSpecialCategoryData("Quiere un corte para su casamiento del viernes"), false);
  assert.equal(hasSpecialCategoryData("Busca una barba prolija"), false);
});

test("borrar una carpeta recorre subcarpetas y repite hasta vaciar", async () => {
  const { db, calls } = fakeDb({
    files: {
      w1: [{ name: "c1", id: null }],
      "w1/c1": [{ name: "a.jpg", id: "1" }, { name: "b.ogg", id: "2" }],
    },
  });
  await removeStorageFolder(db, "w1");
  assert.ok(calls.includes("remove:w1/c1/a.jpg,w1/c1/b.ogg"));
});

test("si no se pueden borrar los archivos, el contacto no se borra", async () => {
  const { db, calls } = fakeDb({
    conversations: [{ id: "c1" }],
    files: { "w1/c1": [{ name: "a.jpg", id: "1" }] },
    removeError: "falló",
  });
  await assert.rejects(eraseContact(db, "w1", "k1"), /archivos/);
  assert.ok(!calls.some((c) => c.startsWith("rpc:erase_contact")));
});

test("borra los archivos antes que la base", async () => {
  const { db, calls } = fakeDb({
    conversations: [{ id: "c1" }],
    files: { "w1/c1": [{ name: "a.jpg", id: "1" }] },
  });
  assert.equal(await eraseContact(db, "w1", "k1"), true);
  const archivos = calls.indexOf("remove:w1/c1/a.jpg");
  const base = calls.indexOf("rpc:erase_contact:k1");
  assert.ok(archivos >= 0 && base > archivos);
});

test("el borrado por antigüedad sigue si uno falla y registra solo el total", async () => {
  const { db, calls } = fakeDb({
    expired: [
      { workspace_id: "w1", contact_id: "k1" },
      { workspace_id: "w1", contact_id: "k2" },
    ],
  });
  assert.equal(await eraseExpiredContacts(db, 50), 2);
  assert.ok(calls.includes("insert:events:retention_erased:2"));
  assert.ok(!calls.some((c) => c.includes("insert") && c.includes("k1")));
});
