import Anthropic from "@anthropic-ai/sdk";
import { lintScreen } from "./lint.js";
import { BRIEF_SYSTEM, GENERATE_SYSTEM, REVIEW_SYSTEM, SKILLS_CONTEXT, SUGGEST_SYSTEM, VARIATIONS_SYSTEM } from "./prompts.js";
import { SKILLS } from "./skills.js";
import type {
  ApiError,
  GenerateRequest,
  GenerateResponse,
  ImportRequest,
  ImportResponse,
  SuggestRequest,
  SuggestResponse,
  ReviewRequest,
  ReviewResponse,
  Usage,
  VariationsRequest,
  VariationsResponse,
} from "./types.js";

// List prices, USD per million tokens, for the in-app cost meter. Cache writes (5-minute) cost 1.25x input;
// cache reads are much cheaper, and every call re-reads the ~21k-token skills block.
const PRICES = {
  "claude-opus-5-5": { in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.1 },
} as const;
type ModelId = keyof typeof PRICES;
const pick = (m: string | undefined, fallback: ModelId): ModelId => (m && m in PRICES ? (m as ModelId) : fallback);
// A new screen is designed from scratch by FIRST_BUILD_MODEL at high effort: that's where taste matters
// most. Rebuilds, markups and variations edit an existing screen, so BUILD_MODEL does them at medium effort,
// and it also runs the review when the checks find problems. Both can be overridden with env vars.
// Suggestions, variation plans and briefs use the helper model.
const FIRST_BUILD_MODEL = pick(process.env.FIRST_BUILD_MODEL, "claude-opus-5-5");
const BUILD_MODEL = pick(process.env.BUILD_MODEL, "claude-sonnet-5-5");
const HELPER_MODEL: ModelId = "claude-sonnet-5-5";
const FIRST_BUILD_EFFORT = "high" as const;
const BUILD_EFFORT = "medium" as const;
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
  const written = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const input = u.input_tokens + written + read;
  const p = PRICES[pick(msg.model, BUILD_MODEL)];
  const cost = (u.input_tokens * p.in + written * p.cacheWrite + read * p.cacheRead + u.output_tokens * p.out) / 1_000_000;
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

// plan comes first so the model decides the archetype, navigation and signature before writing code.
/** After the code, Claude reports note by note what it changed, so a skipped note never looks built. */
const notesDoneSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["note", "done", "change"],
    properties: { note: { type: "integer" }, done: { type: "boolean" }, change: { type: "string" } },
  },
};

const generateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["plan", "title", "summary", "code", "notes_done"],
  properties: {
    plan: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    code: { type: "string" },
    notes_done: notesDoneSchema,
  },
};

/** When a built screen changes, Claude sends only the changed lines: far fewer output tokens than a rewrite. */
const editsSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["find", "replace"],
    properties: { find: { type: "string" }, replace: { type: "string" } },
  },
};
const editSchema = {
  type: "object",
  additionalProperties: false,
  required: ["plan", "title", "summary", "edits", "notes_done"],
  properties: {
    plan: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    edits: editsSchema,
    notes_done: notesDoneSchema,
  },
};
const EDIT_RULES = [
  "Return the change as edits to the current code, not a rewrite.",
  "Each edit's find is an exact snippet of the current code (a few whole lines, unique in the file) and replace is its new text.",
  "Keep edits as small as the change allows. Only when most of the screen must change, return one edit with an empty find and the whole new code as replace.",
].join(" ");

/** Applies find/replace edits in order. Returns null when an edit doesn't match exactly once. */
export function applyEdits(code: string, edits: { find: string; replace: string }[]): string | null {
  let out = code;
  for (const e of edits) {
    if (!e.find) {
      out = e.replace;
      continue;
    }
    const at = out.indexOf(e.find);
    if (at < 0 || out.indexOf(e.find, at + 1) >= 0) return null;
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  }
  return out;
}

function image(data: string, media_type: "image/png" | "image/jpeg" = "image/png"): Anthropic.Beta.BetaImageBlockParam {
  return { type: "image", source: { type: "base64", media_type, data } };
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
    model: HELPER_MODEL,
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

export type Progress = { phase: "thinking" | "writing" | "reviewing" | "fixing"; chars: number };

// The design skills go first and are cached, so building and reviewing share them and later calls
// pay a tenth of the price for those ~21k tokens.
const skillsBlock: Anthropic.Beta.BetaTextBlockParam = {
  type: "text",
  text: SKILLS_CONTEXT(SKILLS),
  cache_control: { type: "ephemeral" },
};
const withSkills = (prompt: string): Anthropic.Beta.BetaTextBlockParam[] => [skillsBlock, { type: "text", text: prompt }];

export async function generate(req: GenerateRequest, onProgress?: (p: Progress) => void): Promise<GenerateResponse> {
  if (req.previousCode) {
    const edited = await generateOnce(req, true, onProgress);
    if (edited) return edited;
    // The edits didn't line up with the code: fall back to writing the screen out in full.
  }
  return (await generateOnce({ ...req }, false, onProgress))!;
}

async function generateOnce(
  req: GenerateRequest,
  asEdits: boolean,
  onProgress?: (p: Progress) => void,
): Promise<GenerateResponse | null> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.styleRef) {
    content.push({ type: "text", text: "Style reference (match its look, not its content):" });
    content.push(image(req.styleRef, "image/jpeg"));
  }
  if (req.image) content.push(image(req.image));
  content.push({
    type: "text",
    text: [
      `Project brief: ${req.brief || "(none)"}`,
      `Surface: ${req.surfaceName || "untitled"}`,
      `Frame: ${req.device}, ${req.width}x${req.height}px`,
      `Design system: ${req.designSystem}`,
      req.notes.length
        ? `Confirmed notes. Each one is a change the designer is asking for now${
            req.previousCode ? "; previousCode does not have it yet" : ""
          }:\n${req.notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
        : "No notes.",
      req.instruction ? `Instruction: ${req.instruction}` : "",
      req.previousCode ? `previousCode:\n${req.previousCode}` : "",
      asEdits ? EDIT_RULES : "",
      req.image
        ? req.previousCode
          ? "The image shows markups drawn over the current screen."
          : "The image is the sketch."
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const fresh = !req.previousCode;
  // Streaming keeps long generations under HTTP timeouts.
  const stream = client().beta.messages.stream({
    model: fresh ? FIRST_BUILD_MODEL : BUILD_MODEL,
    max_tokens: fresh ? 32000 : 20000,
    system: withSkills(GENERATE_SYSTEM),
    output_config: { effort: fresh ? FIRST_BUILD_EFFORT : BUILD_EFFORT, format: { type: "json_schema", schema: asEdits ? editSchema : generateSchema } },
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
  type Done = { note: number; done: boolean; change: string }[];
  // Note numbers are 1-based in the prompt; the app matches them back to its notes by position.
  const notesDone = (d: Done | undefined) =>
    (d ?? []).filter((x) => x.note >= 1 && x.note <= req.notes.length).map((x) => ({ ...x, note: x.note - 1 }));
  if (asEdits) {
    const out = jsonText(msg) as { title: string; summary: string; edits: { find: string; replace: string }[]; notes_done: Done };
    const code = applyEdits(req.previousCode ?? "", out.edits);
    if (code == null) return null;
    return { title: out.title, summary: out.summary, code, notesDone: notesDone(out.notes_done), usage: usageOf(msg) };
  }
  const out = jsonText(msg) as { title: string; summary: string; code: string; notes_done: Done };
  return { title: out.title, summary: out.summary, code: out.code, notesDone: notesDone(out.notes_done), usage: usageOf(msg) };
}

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings", "keep", "edits"],
  properties: {
    verdict: { type: "string", enum: ["ship", "fix"] },
    findings: { type: "array", items: { type: "string" } },
    keep: { type: "string" },
    edits: editsSchema,
  },
};

/** A second, fresh look at a generated screen against the design skills; returns fixed code when needed. */
export async function review(req: ReviewRequest, onProgress?: (p: Progress) => void): Promise<ReviewResponse> {
  if (!req.code) throw new HttpError(400, { error: "Nothing to review.", code: "bad_request" });
  const lint = lintScreen(req.code, req.device);
  // Only pay for a review when the checks find something to fix.
  if (!lint.length) {
    return { verdict: "ship", findings: [], keep: "", code: "", usage: { input_tokens: 0, output_tokens: 0, cost: 0 } };
  }
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) content.push(image(req.image));
  content.push({
    type: "text",
    text: [
      `Project brief: ${req.brief || "(none)"}`,
      `Surface: ${req.surfaceName || "untitled"}`,
      `Frame: ${req.device}, ${req.width}x${req.height}px`,
      req.notes.length ? `Designer's notes:\n${req.notes.map((n) => `- ${n}`).join("\n")}` : "No notes.",
      req.instruction ? `Instruction the screen was built for: ${req.instruction}` : "",
      req.image ? "The image is the designer's sketch (or markups) the screen was built from." : "",
      lint.length ? `Linter findings:\n${lint.map((l) => `- ${l}`).join("\n")}` : "Linter findings: none.",
      `Screen code:\n${req.code}`,
      `If you fix anything: ${EDIT_RULES}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const stream = client().beta.messages.stream({
    model: BUILD_MODEL,
    max_tokens: 20000,
    system: withSkills(REVIEW_SYSTEM),
    output_config: { effort: "low", format: { type: "json_schema", schema: reviewSchema } },
    messages: [{ role: "user", content }],
    ...FALLBACK,
  });
  let chars = 0;
  stream.on("text", (delta) => {
    chars += delta.length;
    onProgress?.({ phase: "fixing", chars });
  });
  onProgress?.({ phase: "reviewing", chars: 0 });
  const msg = await stream.finalMessage();
  const out = jsonText(msg) as Omit<ReviewResponse, "usage" | "code"> & { edits: { find: string; replace: string }[] };
  const code = out.verdict === "fix" && out.edits.length ? applyEdits(req.code, out.edits) : null;
  const fixed = !!code?.trim();
  return {
    verdict: fixed ? "fix" : "ship",
    findings: out.findings.slice(0, 8),
    keep: out.keep,
    code: fixed ? code! : "",
    usage: usageOf(msg),
  };
}

const variationsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["variations"],
  properties: {
    variations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "instruction"],
        properties: { name: { type: "string" }, instruction: { type: "string" } },
      },
    },
  },
};

/** Plans which states and scenarios of a screen are worth designing. */
export async function planVariations(req: VariationsRequest): Promise<VariationsResponse> {
  if (!req.code) throw new HttpError(400, { error: "Generate the screen first.", code: "bad_request" });
  const msg = await client().beta.messages.create({
    model: HELPER_MODEL,
    max_tokens: 3000,
    system: VARIATIONS_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: variationsSchema } },
    messages: [
      {
        role: "user",
        content: [
          `Project brief: ${req.brief || "(none)"}`,
          `Screen: ${req.surfaceName} on ${req.device}`,
          req.existing.length ? `Already exists: ${req.existing.join(", ")}` : "",
          `Screen code:\n${req.code}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    ...FALLBACK,
  });
  const out = jsonText(msg) as Omit<VariationsResponse, "usage">;
  return { variations: out.variations.slice(0, 6), usage: usageOf(msg) };
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
    model: HELPER_MODEL,
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
