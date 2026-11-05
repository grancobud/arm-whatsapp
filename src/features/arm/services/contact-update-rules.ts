// Reglas de update_contact. Módulo puro: se prueba sin base ni red.

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type ContactField = "name" | "email";

/** Por qué no se puede guardar ese valor, o null si está bien. */
export function invalidContactValue(field: ContactField, value: string, quote: string): string | null {
  const clean = value.trim();
  if (field === "email" && !EMAIL.test(clean)) return "Ese correo no parece válido.";
  if (field === "name" && (clean.length < 2 || clean.length > 80 || /\d{3}|[@/\\<>]/.test(clean))) {
    return "Ese nombre no parece válido.";
  }
  // El valor tiene que estar en las palabras del cliente: el modelo no lo puede inventar.
  if (!normalize(quote).includes(normalize(clean))) {
    return "El valor tiene que aparecer en lo que escribió el cliente.";
  }
  return null;
}

export type ContactUpdateDecision = "apply" | "same" | "propose";

/** Un campo vacío se completa solo; pisar un valor distinto lo decide una persona. */
export function decideContactUpdate(current: string | null | undefined, next: string): ContactUpdateDecision {
  const actual = (current ?? "").trim();
  if (!actual) return "apply";
  return normalize(actual) === normalize(next) ? "same" : "propose";
}

/** Solo se deshace si nadie volvió a cambiar el campo después. */
export function canRevertChange(current: string | null | undefined, changedTo: string): boolean {
  return normalize(current ?? "") === normalize(changedTo);
}
