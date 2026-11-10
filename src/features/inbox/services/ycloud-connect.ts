// Alta con una sola clave: con la API key de YCloud la app encuentra el número
// y crea el webhook sola, así el cliente no copia claves de firma ni direcciones.

/** Un rechazo de YCloud. Solo guarda el código: la respuesta cruda no viaja con el error. */
export class YCloudConnectError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "YCloudConnectError";
    this.status = status;
  }
}

const YCLOUD_BASE_URL = "https://api.ycloud.com/v2";

/** Los dos avisos que la app necesita: mensajes que entran y estados de los que salen. */
export const APP_WEBHOOK_EVENTS = ["whatsapp.inbound_message.received", "whatsapp.message.updated"];

export interface YCloudNumber {
  phoneNumber: string;
  verifiedName: string | null;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  status?: string;
}

/** Pure: la dirección a la que YCloud le avisa a este negocio. */
export function ycloudWebhookUrl(appUrl: string, workspaceId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/webhooks/ycloud?wsid=${workspaceId}`;
}

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Pure: qué número se conecta. Con uno solo no hay nada que elegir; con varios
 * hace falta que la persona diga cuál.
 */
export function pickNumber(
  numbers: YCloudNumber[],
  wanted?: string | null,
): { phone: string } | { choose: YCloudNumber[] } | { error: string } {
  if (numbers.length === 0) {
    return { error: "Esa cuenta de YCloud todavía no tiene ningún número de WhatsApp conectado." };
  }
  const target = wanted ? digits(wanted) : "";
  if (target) {
    const match = numbers.find((n) => digits(n.phoneNumber) === target);
    return match ? { phone: match.phoneNumber } : { error: "Ese número no está en la cuenta de YCloud." };
  }
  return numbers.length === 1 ? { phone: numbers[0].phoneNumber } : { choose: numbers };
}

/** Pure: el webhook de este negocio, si YCloud ya lo tiene. */
export function ownWebhook(endpoints: WebhookEndpoint[], url: string): WebhookEndpoint | null {
  return endpoints.find((e) => e.url === url) ?? null;
}

async function yc(apiKey: string, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${YCLOUD_BASE_URL}${path}`, {
    method,
    headers: { "X-API-Key": apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new YCloudConnectError(res.status, `YCloud ${method} ${path} → ${res.status}`);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return (json ?? {}) as Record<string, unknown>;
}

const itemsOf = (data: Record<string, unknown>) =>
  (Array.isArray(data.items) ? data.items : []) as Record<string, unknown>[];

export async function listNumbers(apiKey: string): Promise<YCloudNumber[]> {
  const data = await yc(apiKey, "GET", "/whatsapp/phoneNumbers?limit=100");
  return itemsOf(data)
    .filter((p) => typeof p.phoneNumber === "string")
    .map((p) => ({
      phoneNumber: p.phoneNumber as string,
      verifiedName: typeof p.verifiedName === "string" ? p.verifiedName : null,
    }));
}

/**
 * Deja el webhook de este negocio creado y activo, y devuelve su clave de firma.
 * Si ya existía, le pide a YCloud una clave nueva: la anterior no se puede leer.
 */
export async function ensureWebhook(apiKey: string, url: string): Promise<string> {
  const existing = ownWebhook(
    itemsOf(await yc(apiKey, "GET", "/webhookEndpoints?limit=100")) as unknown as WebhookEndpoint[],
    url,
  );
  let secret: unknown;
  if (existing) {
    secret = (await yc(apiKey, "POST", `/webhookEndpoints/${existing.id}/rotateSecret`)).secret;
    if (existing.status !== "active") {
      await yc(apiKey, "PATCH", `/webhookEndpoints/${existing.id}`, { status: "active" });
    }
  } else {
    secret = (
      await yc(apiKey, "POST", "/webhookEndpoints", {
        url,
        enabledEvents: APP_WEBHOOK_EVENTS,
        description: "ARM WhatsApp",
      })
    ).secret;
  }
  if (typeof secret !== "string" || !secret) {
    throw new YCloudConnectError(502, "YCloud no devolvió la clave de firma del webhook");
  }
  return secret;
}

/** Pure: el mensaje para la persona cuando YCloud rechaza algo. */
export function connectErrorMessage(err: unknown): string {
  if (err instanceof YCloudConnectError) {
    if (err.status === 401 || err.status === 403) return "YCloud no aceptó esa clave. Revisá que esté bien copiada.";
    if (err.status === 502) return err.message;
    return `YCloud respondió con un error (${err.status}). Probá de nuevo en un rato.`;
  }
  return "No se pudo llegar a YCloud. Probá de nuevo en un rato.";
}
