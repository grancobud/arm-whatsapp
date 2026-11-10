import { timingSafeEqual } from "node:crypto";

/**
 * Sin secreto configurado no entra nadie: comparar contra `Bearer ${undefined}` dejaba
 * pasar el encabezado literal "Bearer undefined".
 */
export function isCronAuthorized(header: string | null, secret = process.env.CRON_SECRET): boolean {
  const expected = secret?.trim();
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
