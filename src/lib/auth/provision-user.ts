// Agency-managed user provisioning — NO email / NO SMTP required.
//
// Instead of inviteUserByEmail (which sends a magic-link email and needs SMTP +
// Site URL configured), the agency creates the account with a known password and
// shares the credentials with the client, who logs in directly. This is the
// distribution model for the one-click/giveaway install: zero email setup.

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Strong, URL-safe password (~22 chars). Avoids ambiguous email-delivery issues. */
export function generatePassword(): string {
  return randomBytes(16).toString("base64url");
}

const USERS_PER_PAGE = 200;
const MAX_USER_PAGES = 50;

/** Pure: el correo de una cuenta se compara sin mayúsculas ni espacios. */
export const sameEmail = (a: string | null | undefined, b: string) =>
  (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/** Recorre todas las páginas: sin esto solo se miraban las primeras 50 cuentas. */
async function findUserIdByEmail(service: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) return null;
    const found = data.users.find((u) => sameEmail(u.email, email));
    if (found) return found.id;
    if (data.users.length < USERS_PER_PAGE) return null;
  }
  return null;
}

export interface ProvisionResult {
  userId: string;
  /** Password to share with the user — only set when a NEW account was created. */
  password: string | null;
  /** false when the email already existed (we don't reset an existing password). */
  created: boolean;
}

/**
 * Creates a confirmed Supabase auth user with a known password (no email sent),
 * or resolves the existing user by email. Ensures a `users` profile row exists.
 *
 * @param service  A service-role Supabase client (admin API access).
 * @param email    The user's email (also their login).
 * @param opts.password  Optional explicit password; a strong one is generated if omitted.
 */
export async function provisionWorkspaceUser(
  service: SupabaseClient,
  email: string,
  opts?: { password?: string; fullName?: string },
): Promise<ProvisionResult> {
  const password = opts?.password?.trim() || generatePassword();

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // mark confirmed → no verification email
  });

  let userId = data?.user?.id ?? null;
  let created = Boolean(userId);

  if (!userId) {
    // Most likely the email is already registered — resolve the existing user.
    userId = await findUserIdByEmail(service, email);
    created = false;
    if (!userId) {
      throw new Error(error?.message ?? "No se pudo crear el usuario");
    }
  }

  // Ensure the public.users profile row exists (the auth trigger may lag).
  await service.from("users").upsert(
    {
      id: userId,
      email,
      full_name: opts?.fullName ?? email.split("@")[0],
      is_active: true,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  return { userId, password: created ? password : null, created };
}
