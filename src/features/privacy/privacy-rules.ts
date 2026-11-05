// Reglas de datos personales. Módulo puro: se prueba sin base ni red.

export const RETENTION_OPTIONS = [6, 12, 24, 0] as const;
export const DEFAULT_RETENTION_MONTHS = 12;

/** Meses de conservación del cliente; 0 significa que no se borra por antigüedad. */
export function readRetentionMonths(settings: unknown): number {
  const value = (settings as { retention_months?: unknown } | null)?.retention_months;
  return RETENTION_OPTIONS.includes(value as (typeof RETENTION_OPTIONS)[number])
    ? (value as number)
    : DEFAULT_RETENTION_MONTHS;
}

const FALLBACK_APP_URL = "https://arm-whatsapp.vercel.app";

export function privacyPageUrl(appUrl: string | undefined): string {
  return `${(appUrl?.trim() || FALLBACK_APP_URL).replace(/\/+$/, "")}/privacidad`;
}

/** Lo primero que recibe quien escribe: quién contesta, qué se hace con sus datos y cómo decidir. */
export function buildPrivacyNotice(businessName: string, url: string): string {
  return (
    `Hola. En ${businessName} te responde un asistente automático con inteligencia artificial, ` +
    `y podés pedir hablar con una persona. Guardamos esta conversación para atenderte. ` +
    `Podés pedirnos ver, corregir o borrar tus datos, o escribir BAJA para no recibir más mensajes. ` +
    `Más información: ${url}`
  );
}

const sinTildes = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const SPECIAL_CATEGORY =
  /\b(diabetes|diabetic[oa]|vih|hiv|cancer|embarazad[oa]|depresion|bipolar|epilepsia|antidepresivos?|quimioterapia|discapacidad|discapacitad[oa]|silla de ruedas|ciego|ciega|sordo|sorda|autismo|autista|religion|musulman[ae]?|islam|islamic[oa]|catolic[oa]|judi[oa]|evangelic[oa]|testigo de jehova|budista|mormon[ae]?|ate[oa]|(soy|es) cristian[oa]|orientacion sexual|gay|lesbiana|bisexual|homosexual|heterosexual|hetero|(soy|es|una|un) trans|mujer trans|hombre trans|transexual|afiliad[oa] al partido|peronista|kirchnerista|macrista|libertari[oa]|voto (a|al|por)|vota (a|al|por))\b/;

/** Datos sensibles de la Ley 25.326 (salud, religión, política, vida sexual) que no van a la memoria. */
export function hasSpecialCategoryData(text: string): boolean {
  return SPECIAL_CATEGORY.test(sinTildes(text));
}
