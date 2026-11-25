import Anthropic from "@anthropic-ai/sdk";
import { GENERATE_SYSTEM, SUGGEST_SYSTEM } from "./prompts.js";
import type {
  ApiError,
  GenerateRequest,
  GenerateResponse,
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

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
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
  const msg = await stream.finalMessage();
  const out = jsonText(msg) as Omit<GenerateResponse, "usage">;
  return { ...out, usage: usageOf(msg) };
}

/** Wraps a handler as a web-standard POST endpoint (used by Vercel and the dev server). */
export function endpoint<I, O>(fn: (input: I) => Promise<O>) {
  return async (request: Request): Promise<Response> => {
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    try {
      const input = (await request.json()) as I;
      return json(200, await fn(input));
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, err.body);
      if (err instanceof Anthropic.AuthenticationError) {
        return json(401, { error: "The Anthropic API key was rejected.", code: "no_key" });
      }
      if (err instanceof Anthropic.RateLimitError) {
        return json(429, { error: "Rate limited by Anthropic. Wait a moment and try again.", code: "upstream" });
      }
      if (err instanceof Anthropic.APIError) {
        return json(502, { error: `Anthropic API error ${err.status}: ${err.message}`, code: "upstream" });
      }
      console.error(err);
      return json(500, { error: "Something went wrong on the server.", code: "upstream" });
    }
  };
}
