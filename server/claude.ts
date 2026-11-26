import Anthropic from "@anthropic-ai/sdk";
import { BRIEF_SYSTEM, GENERATE_SYSTEM, SUGGEST_SYSTEM } from "./prompts.js";
import type {
  ApiError,
  GenerateRequest,
  GenerateResponse,
  ImportRequest,
  ImportResponse,
  SuggestRequest,
  SuggestResponse,
  Usage,
} from "./types.js";

const MODEL = "claude-opus-5-5";
// Claude Opus 5.5 list prices, USD per million tokens. Used for the in-app cost meter.
const PRICE_IN = 4;
const PRICE_OUT = 20;
// Server-side fallback: if a request is declined by a safety classifier, the API retries it on
// a fallback model chosen by refusal category, inside the same call.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export class HttpError extends Error {
  constructor(public status: number, public body: ApiError) {
    super(body.error);
  }
}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(501, {
      error: "No Anthropic API key is set on the server. Add ANTHROPIC_API_KEY and restart.",
      code: "no_key",
    });
  }
  return new Anthropic();
}

function usageOf(msg: Anthropic.Beta.BetaMessage): Usage {
  const u = msg.usage;
  const input =
    u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const cost = (input * PRICE_IN + u.output_tokens * PRICE_OUT) / 1_000_000;
  return { input_tokens: input, output_tokens: u.output_tokens, cost };
}

function jsonText(msg: Anthropic.Beta.BetaMessage): unknown {
  if (msg.stop_reason === "refusal") {
    throw new HttpError(422, { error: "The model declined this request.", code: "refusal" });
  }
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, { error: "The model returned something unreadable. Try again.", code: "upstream" });
  }
}

const suggestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "suggestions"],
  properties: {
    title: { type: "string" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text", "region"],
        properties: {
          kind: { type: "string", enum: ["component", "layout", "question", "copy"] },
          text: { type: "string" },
          region: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["x", "y", "w", "h"],
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  w: { type: "number" },
                  h: { type: "number" },
                },
              },
            ],
          },
        },
      },
    },
  },
};

const generateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "code"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    code: { type: "string" },
  },
};

function image(data: string): Anthropic.Beta.BetaImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/png", data } };
}

export async function suggest(req: SuggestRequest): Promise<SuggestResponse> {
  if (!req.image) throw new HttpError(400, { error: "Missing sketch image.", code: "bad_request" });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    image(req.image),
    {
      type: "text",
      text: [
        `Project brief: ${req.brief || "(none yet)"}`,
        `Surface: ${req.surfaceName || "untitled"} on ${req.device}`,
        `Stage: ${req.stage}`,
        req.code ? `Current screen code:\n${req.code}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  const msg = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SUGGEST_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: suggestSchema } },
    messages: [{ role: "user", content }],
    ...FALLBACK,
  });
  const out = jsonText(msg) as Omit<SuggestResponse, "usage">;
  return {
    title: out.title,
    suggestions: out.suggestions.map((s, i) => ({ ...s, id: `s${Date.now().toString(36)}${i}` })),
    usage: usageOf(msg),
  };
}

export type Progress = { phase: "thinking" | "writing"; chars: number };

export async function generate(req: GenerateRequest, onProgress?: (p: Progress) => void): Promise<GenerateResponse> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) content.push(image(req.image));
  content.push({
    type: "text",
    text: [
      `Project brief: ${req.brief || "(none)"}`,
      `Surface: ${req.surfaceName || "untitled"}`,
      `Frame: ${req.device}, ${req.width}x${req.height}px`,
      `Design system: ${req.designSystem}`,
      req.notes.length ? `Confirmed notes:\n${req.notes.map((n) => `- ${n}`).join("\n")}` : "No notes.",
      req.instruction ? `Instruction: ${req.instruction}` : "",
      req.previousCode ? `previousCode:\n${req.previousCode}` : "",
      req.image
        ? req.previousCode
          ? "The image shows markups drawn over the current screen."
          : "The image is the sketch."
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  // Streaming keeps long generations under HTTP timeouts.
  const stream = client().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: GENERATE_SYSTEM,
    output_config: { effort: "high", format: { type: "json_schema", schema: generateSchema } },
    messages: [{ role: "user", content }],
    ...FALLBACK,
  });
  // Report how much of the answer has been written, so the app can show real progress.
  let chars = 0;
  stream.on("text", (delta) => {
    chars += delta.length;
    onProgress?.({ phase: "writing", chars });
  });
  onProgress?.({ phase: "thinking", chars: 0 });
  const msg = await stream.finalMessage();
  const out = jsonText(msg) as Omit<GenerateResponse, "usage">;
  return { ...out, usage: usageOf(msg) };
}

const briefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "brief"],
  properties: { title: { type: "string" }, brief: { type: "string" } },
};

const MAX_DOC_CHARS = 200_000;

/** Reads a Google Doc that is shared "Anyone with the link" as plain text. */
async function fetchGoogleDoc(url: string): Promise<string> {
  const id = url.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{20,})/)?.[1];
  if (!id) {
    throw new HttpError(400, { error: "That doesn't look like a Google Docs link.", code: "bad_request" });
  }
  const notShared =
    "I couldn't open that doc. In Google Docs, tap Share, set General access to “Anyone with the link” (Viewer), then try again. Or paste the text instead.";
  let res: Response;
  try {
    res = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, { redirect: "follow" });
  } catch {
    throw new HttpError(502, { error: "Couldn't reach Google Docs. Try again in a moment.", code: "upstream" });
  }
  // A private doc redirects to a sign-in page, which comes back as HTML.
  if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new HttpError(403, { error: notShared, code: "bad_request" });
  }
  return (await res.text()).replace(/^\uFEFF/, "");
}

export async function importBrief(req: ImportRequest): Promise<ImportResponse> {
  let text = req.kind === "gdoc" ? await fetchGoogleDoc(req.url) : req.text;
  text = (text ?? "").trim();
  if (text.length < 40) {
    throw new HttpError(400, { error: "That document is empty or too short to use.", code: "bad_request" });
  }
  if (text.length > MAX_DOC_CHARS) text = text.slice(0, MAX_DOC_CHARS);
  const msg = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: BRIEF_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: briefSchema } },
    messages: [{ role: "user", content: `<document>\n${text}\n</document>` }],
    ...FALLBACK,
  });
  const out = jsonText(msg) as Omit<ImportResponse, "usage">;
  return { ...out, usage: usageOf(msg) };
}

function errorBody(err: unknown): { status: number; body: ApiError } {
  if (err instanceof HttpError) return { status: err.status, body: err.body };
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, body: { error: "The Anthropic API key was rejected.", code: "no_key" } };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, body: { error: "Rate limited by Anthropic. Wait a moment and try again.", code: "upstream" } };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 502, body: { error: `Anthropic API error ${err.status}: ${err.message}`, code: "upstream" } };
  }
  console.error(err);
  return { status: 500, body: { error: "Something went wrong on the server.", code: "upstream" } };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Wraps a handler as a web-standard POST endpoint (used by Vercel and the dev server). */
export function endpoint<I, O>(fn: (input: I) => Promise<O>) {
  return async (request: Request): Promise<Response> => {
    try {
      const input = (await request.json()) as I;
      return json(200, await fn(input));
    } catch (err) {
      const { status, body } = errorBody(err);
      return json(status, body);
    }
  };
}

/**
 * Like endpoint(), but streams newline-delimited JSON: progress lines while the model writes, then
 * one {"type":"done","result":…} or {"type":"error",…} line. A missing key still fails up front
 * with a normal status code.
 */
export function streamingEndpoint<I, O>(fn: (input: I, onProgress: (p: Progress) => void) => Promise<O>) {
  return async (request: Request): Promise<Response> => {
    let input: I;
    try {
      input = (await request.json()) as I;
      client(); // fail fast with a proper status when there's no key
    } catch (err) {
      const { status, body } = errorBody(err);
      return json(status, body);
    }
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (line: unknown) => controller.enqueue(enc.encode(JSON.stringify(line) + "\n"));
        let last = 0;
        try {
          const result = await fn(input, (p) => {
            const now = Date.now();
            if (p.phase === "writing" && now - last < 250) return; // a few updates a second is plenty
            last = now;
            send({ type: "progress", ...p });
          });
          send({ type: "done", result });
        } catch (err) {
          send({ type: "error", ...errorBody(err).body });
        }
        controller.close();
      },
    });
    return new Response(body, {
      headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  };
}
