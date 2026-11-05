// Lo que se puede escribir en un log. Un error del AI SDK trae el pedido entero en
// requestBodyValues: imprimirlo completo vuelca el prompt y los mensajes del cliente
// en los logs del proveedor. Comprobado el 05/11 con APICallError.
// Módulo puro: se prueba sin base ni red.

const MAX_CHARS = 300;

export function safeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, MAX_CHARS);
  if (err && typeof err === "object") {
    const { message, code } = err as { message?: unknown; code?: unknown };
    if (typeof message === "string") return `${code ?? "error"}: ${message}`.slice(0, MAX_CHARS);
    return "error sin mensaje";
  }
  return String(err).slice(0, MAX_CHARS);
}
