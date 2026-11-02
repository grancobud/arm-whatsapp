import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createClient as svcClient } from "@supabase/supabase-js";
import { getOpenRouterApiKey } from "./openrouter";

// ──────────────────────────────────────────────────────────────────────────────
// Media understanding — turns inbound voice notes and images into text via a
// cheap multimodal model (OpenRouter → Gemini Flash) so the agent can "read"
// them. The result is stored in messages.meta (transcript / description) and
// the buffer consolidation injects it as text — the agent keeps its own model.
// ──────────────────────────────────────────────────────────────────────────────

const BUCKET = "whatsapp-media";

/** Multimodal model used only for media→text. Overridable via env. */
const UNDERSTANDING_MODEL =
  process.env.MEDIA_UNDERSTANDING_MODEL ?? "google/gemini-2.5-flash";

function svc() {
  return svcClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function downloadBytes(storagePath: string): Promise<Uint8Array | null> {
  const { data, error } = await svc()
    .storage.from(BUCKET)
    .download(storagePath);
  if (error || !data) {
    console.error(
      "[media-understanding] storage download failed:",
      error?.message ?? "no data",
    );
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

function openrouter(apiKey: string) {
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    headers: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "ARM WhatsApp",
    },
  });
}

/**
 * Transcribes a WhatsApp voice note. Returns the verbatim text, or null on any
 * failure (caller degrades gracefully — the agent still sees "[nota de voz]").
 */
export async function transcribeAudio(opts: {
  storagePath: string;
  mimeType?: string;
  workspaceId: string;
}): Promise<string | null> {
  const bytes = await downloadBytes(opts.storagePath);
  if (!bytes) return null;

  const apiKey = await getOpenRouterApiKey(opts.workspaceId);
  if (!apiKey) return null;

  // Call OpenRouter directly with the OpenAI-style `input_audio` content part.
  // The AI SDK's `type:"file"` audio part is NOT serialized to `input_audio`,
  // so the model never received the audio and returned empty → the agent saw
  // "[nota de voz no transcrita]". WhatsApp voice notes are ogg/opus.
  const mime = opts.mimeType || "audio/ogg";
  const format =
    mime.includes("mp3") || mime.includes("mpeg")
      ? "mp3"
      : mime.includes("wav")
        ? "wav"
        : mime.includes("m4a") || mime.includes("mp4")
          ? "m4a"
          : "ogg";
  const b64 = Buffer.from(bytes).toString("base64");

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "ARM WhatsApp",
      },
      body: JSON.stringify({
        model: UNDERSTANDING_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe esta nota de voz de WhatsApp palabra por palabra, en su idioma original. Devuelve SOLO la transcripción, sin comentarios ni comillas.",
              },
              { type: "input_audio", input_audio: { data: b64, format } },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      console.error(
        "[media-understanding] transcribeAudio HTTP",
        res.status,
        (await res.text()).slice(0, 200),
      );
      return null;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch (err) {
    console.error(
      "[media-understanding] transcribeAudio error:",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}

/**
 * Describes an inbound image so the agent understands what the client sent
 * (documents, screenshots, photos of teeth, etc.). Returns null on failure.
 */
export async function describeImage(opts: {
  storagePath: string;
  mimeType?: string;
  caption?: string;
  workspaceId: string;
}): Promise<string | null> {
  const bytes = await downloadBytes(opts.storagePath);
  if (!bytes) return null;

  const apiKey = await getOpenRouterApiKey(opts.workspaceId);
  if (!apiKey) return null;

  try {
    const { text } = await generateText({
      model: openrouter(apiKey).chat(UNDERSTANDING_MODEL),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Un cliente envió esta imagen por WhatsApp${
                opts.caption ? ` con el texto: "${opts.caption}"` : ""
              }. Describe de forma concisa y útil qué muestra (objetos, personas, texto o documentos visibles, lo relevante para atención al cliente). Máximo 2–3 frases, en español.`,
            },
            { type: "image", image: bytes, mediaType: opts.mimeType },
          ],
        },
      ],
      maxOutputTokens: 512,
    });
    return text.trim() || null;
  } catch (err) {
    console.error(
      "[media-understanding] describeImage error:",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}
