// How long a piece of contact memory stays usable. Pure, so the agent's prompt,
// the relationship score and the CRM panel share one rule and it can be tested
// without a database. An expired claim is not deleted: the team still sees it,
// and erasing data for privacy is a separate path.

import type { ClaimKind, ClaimRow } from "../types";

const DAY = 86_400_000;
const PROMPT_CLAIMS_LIMIT = 20;

/** A hunch isn't confirmed by anything the customer said, so it goes first. */
export const HUNCH_TTL_DAYS = 30;

/** null = doesn't expire (e.g. the name of a customer's child). */
export const CLAIM_TTL_DAYS: Record<ClaimKind, number | null> = {
  risk: 90,
  need: 180,
  goal: 180,
  objection: 180,
  commitment: 365,
  fact: null,
};

type ExpiryFields = Pick<ClaimRow, "kind" | "created_at" | "source_message_id"> & {
  author?: ClaimRow["author"];
};

export function isClaimExpired(claim: ExpiryFields, now: number): boolean {
  const isHunch = !claim.source_message_id && claim.author !== "human";
  const days = isHunch ? HUNCH_TTL_DAYS : CLAIM_TTL_DAYS[claim.kind];
  if (days === null) return false;
  // An unreadable date never hides data: NaN compares false.
  return now - new Date(claim.created_at).getTime() >= days * DAY;
}

export function unexpiredClaims<T extends ExpiryFields>(claims: T[], now: number): T[] {
  return claims.filter((c) => !isClaimExpired(c, now));
}

/** Expired claims are dropped before the cut, so they don't take up room. */
export function claimsForPrompt<T extends ExpiryFields>(
  claims: T[],
  now: number,
  limit = PROMPT_CLAIMS_LIMIT,
): T[] {
  return unexpiredClaims(claims, now).slice(0, limit);
}
