/**
 * url-scraper.ts — fetches a public web page and extracts readable text for the
 * Knowledge Base. Dependency-free (runs on Vercel's serverless runtime).
 *
 * Not a full readability engine: strips scripts/styles/tags and decodes common
 * entities. Good enough for most marketing/info pages; can be upgraded later.
 */

import { fetchPublicUrl } from "@/features/tools/services/ssrf-guard";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT_LENGTH = 200_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

/** Converts an HTML document to plain readable text. */
export function htmlToText(html: string): string {
  let text = html;

  // Drop non-content regions entirely.
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Prefer the <body> when present.
  const bodyMatch = text.match(/<body[\s\S]*?>([\s\S]*?)<\/body>/i);
  if (bodyMatch) text = bodyMatch[1];

  // Block-level closings → line breaks so the text stays readable.
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|section|article|h[1-6]|li|tr|ul|ol)>/gi, "\n");

  // Strip the remaining tags, decode entities, collapse whitespace.
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  text = text
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.slice(0, MAX_TEXT_LENGTH);
}

/**
 * Downloads `rawUrl` and returns its readable text. Throws a user-friendly
 * Error on invalid/blocked URLs, non-HTML responses, or fetch failures.
 */
export async function fetchUrlText(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("URL inválida");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http(s)");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetchPublicUrl(
      url.toString(),
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AgenteWA-KB/1.0)",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
      },
      { allowHttp: true },
    );
    if (!res.ok) {
      throw new Error(`La página respondió ${res.status}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/xhtml")
    ) {
      throw new Error("La URL no devolvió una página de texto/HTML");
    }
    html = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("La página tardó demasiado en responder");
    }
    throw err instanceof Error ? err : new Error("No se pudo descargar la URL");
  } finally {
    clearTimeout(timeout);
  }

  const text = htmlToText(html);
  if (text.length < 20) {
    throw new Error("No se pudo extraer contenido legible de la URL");
  }
  return text;
}
