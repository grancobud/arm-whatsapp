// WhatsApp's rules for sending campaigns. Pure module so it can be unit-tested.
//
// Meta: a new business portfolio can reach 250 people a day outside the customer
// service window, a template that isn't APPROVED can't be sent, and people need
// clear instructions to opt out.

export const DEFAULT_DAILY_LIMIT = 250;
const STOP_AFTER_FAILURES = 10;
const STOP_FAILURE_RATE = 0.5;

/** The daily limit: Meta raises it per account, so it can be overridden. */
export function dailyLimit(value: string | undefined = process.env.CAMPAIGN_DAILY_LIMIT): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

/** How many more can go out now, given how many went out in the last 24 h. */
export function dailyRoom(sentLast24h: number, limit: number = dailyLimit()): number {
  return Math.max(0, limit - sentLast24h);
}

/** Does the template tell people how to stop getting these messages? */
export function hasOptOutInstruction(templateText: string): boolean {
  return /\b(baja|stop)\b|dejar de recibir|no recibir m[aá]s/i.test(templateText);
}

/** Text to add to a marketing template that doesn't say how to opt out. */
export const OPT_OUT_LINE = "Si no querés recibir más mensajes, respondé BAJA.";

/** Many failures in a row hurt the number's quality: better to stop and look. */
export function shouldStopCampaign(sent: number, failed: number): boolean {
  return failed >= STOP_AFTER_FAILURES && failed / (sent + failed) >= STOP_FAILURE_RATE;
}

/** Meta's code on a failed message, wherever the provider puts it. */
export function messageErrorCode(message: {
  errorCode?: unknown;
  whatsappApiError?: { code?: unknown } | null;
  errors?: { code?: unknown }[] | null;
}): string | null {
  const code = message.whatsappApiError?.code ?? message.errors?.[0]?.code ?? message.errorCode;
  return code === undefined || code === null || code === "" ? null : String(code);
}

/** 131050: the person pressed "stop promotions" for this business in WhatsApp. */
export function isMarketingOptOutError(code: string | null): boolean {
  return code === "131050";
}
