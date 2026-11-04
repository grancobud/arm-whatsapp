// Marketing consent. opt_in = "may receive messages" (BAJA turns it off);
// marketing_opt_in = "accepted promotions", which only a person records, with
// where it came from. Meta asks for explicit permission per message category.
//
// Pure module so it can be unit-tested on its own.

export const NO_MARKETING_CONSENT =
  "Este contacto no aceptó recibir promociones. Cargá su consentimiento en Ver contacto.";

/** A contact can get marketing only with both permissions. */
export function canReceiveMarketing(contact: {
  opt_in?: boolean | null;
  marketing_opt_in?: boolean | null;
}): boolean {
  return contact.opt_in === true && contact.marketing_opt_in === true;
}

/** Template categories come in either case depending on the source. */
export function isMarketingTemplate(category: string | null | undefined): boolean {
  return (category ?? "").toLowerCase() === "marketing";
}

export interface MarketingConsentInput {
  opt_in?: boolean;
  marketing_opt_in?: boolean;
  marketing_opt_in_source?: string;
}

/**
 * What to write for a change of consent made by a person, or the reason it's
 * not valid. Without a source there's no proof of the permission.
 */
export function marketingConsentUpdate(
  input: MarketingConsentInput,
  now: Date = new Date(),
): { error: string } | { update: Record<string, unknown> } {
  if (input.marketing_opt_in === undefined) return { update: {} };
  if (!input.marketing_opt_in) {
    return { update: { marketing_opt_in: false, marketing_opt_in_at: null } };
  }
  if (input.opt_in === false) {
    return { error: "Un contacto dado de baja no puede aceptar promociones." };
  }
  const source = input.marketing_opt_in_source?.trim();
  if (!source) {
    return { error: "Contá cómo aceptó recibir promociones (por ejemplo, formulario web o en el local)." };
  }
  return {
    update: {
      marketing_opt_in: true,
      marketing_opt_in_at: now.toISOString(),
      marketing_opt_in_source: source,
    },
  };
}
