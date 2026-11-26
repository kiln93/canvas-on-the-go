import type {
  ApiError,
  GenerateRequest,
  GenerateResponse,
  ReviewRequest,
  ReviewResponse,
  StreamLine,
  ImportRequest,
  ImportResponse,
  SuggestRequest,
  SuggestResponse,
  VariationsRequest,
  VariationsResponse,
} from "../server/types";
import { rasterize } from "./canvas/ink";
import { useSyncExternalStore } from "react";
import { addFrame, addSpend, DEVICES, getState, NOTE_TAGS, updateFrame, type Frame, type NoteItem } from "./store";

// Live progress for frames that are busy. Kept out of the saved project: it's only true right now.
export type FrameProgress = {
  phase: "reading" | "planning" | "thinking" | "writing" | "reviewing" | "fixing" | "rendering";
  startedAt: number;
  /** 0..1 when there is a real measure of how far along it is. */
  fraction?: number;
};
let progress: Record<string, FrameProgress | undefined> = {};
const listeners = new Set<() => void>();
export function setProgress(id: string, p: FrameProgress | undefined) {
  progress = { ...progress, [id]: p };
  listeners.forEach((l) => l());
}
export function useProgress(id: string) {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => progress[id],
  );
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("You're offline. Your drawing is saved; try again when you're connected.");
  }
  const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
  if (!res.ok) throw new Error((data as ApiError).error);
  return data as T;
}

function frame(id: string) {
  return getState().project.frames.find((f) => f.id === id);
}

function surfaceName(f: Frame) {
  const primary = frame(f.surfaceId);
  return primary?.name || f.name || "Untitled surface";
}

/** A screen's job lives on its surface's primary frame, so its variations share it. */
export function surfaceJob(f: Frame) {
  return (frame(f.surfaceId)?.job ?? f.job ?? "").trim();
}

/** The project's other screens, by name, so a screen is built as part of an app rather than alone. */
function otherScreens(f: Frame) {
  return getState()
    .project.frames.filter((x) => x.primary && x.surfaceId !== f.surfaceId && x.name && !/^untitled/i.test(x.name))
    .map((x) => x.name.trim())
    .slice(0, 20);
}

function overCap() {
  const { spend, cap } = getState().project;
  return spend.cost >= cap;
}

const CAP_MSG = "You've reached this month's AI spending cap. Raise it from the meter at the top right.";

/** One note as Claude reads it: its tag, its text, and where on the frame it points. */
function noteLine(n: NoteItem) {
  const tag = NOTE_TAGS.find((t) => t.id === n.tag)?.label;
  const where = n.region
    ? ` (at ${Math.round(n.region.x * 100)}%,${Math.round(n.region.y * 100)}% of the frame, ${Math.round(n.region.w * 100)}%×${Math.round(n.region.h * 100)}%)`
    : "";
  return `${tag ? `[${tag}] ` : ""}${n.text}${where}`;
}

/** Reads the sketch (or markups) and fills the frame's note with suggestions. */
export async function runSuggest(id: string) {
  const f = frame(id);
  if (!f || f.busy) return;
  if (overCap()) return updateFrame(id, { error: CAP_MSG });
  const stage = f.code ? "generated" : "sketch";
  const image = rasterize(f, stage === "generated" ? "markup" : "sketch");
  if (!image) return updateFrame(id, { error: "Draw something in the frame first." });
  updateFrame(id, { busy: "suggesting", error: undefined });
  setProgress(id, { phase: "reading", startedAt: Date.now() });
  try {
    const req: SuggestRequest = {
      brief: getState().project.brief,
      surfaceName: surfaceName(f),
      device: DEVICES[f.device].label,
      image,
      stage,
      code: f.code,
      // The designer's own notes, and suggestions they already confirmed, so Claude reads the sketch through them.
      notes: f.notes.filter((n) => n.status === "accepted" || (n.mine && n.status === "pending")).map(noteLine),
      job: surfaceJob(f) || undefined,
      otherScreens: otherScreens(f),
    };
    const out = await post<SuggestResponse>("/api/suggest", req);
    addSpend(out.usage);
    // The proposed job goes on the surface only while the designer hasn't written one.
    if (out.job && !surfaceJob(f)) updateFrame(f.surfaceId, { job: out.job });
    updateFrame(id, (cur) => ({
      busy: undefined,
      assumed: out.assumed || undefined,
      name: cur.name || out.title,
      // Keep what the designer wrote; replace only the AI's unanswered guesses.
      notes: [
        ...cur.notes.filter((n) => n.mine || n.status !== "pending"),
        ...out.suggestions.map((s) => ({ ...s, status: "pending" as const })),
      ],
    }));
  } catch (e) {
    updateFrame(id, { busy: undefined, error: (e as Error).message });
  }
  setProgress(id, undefined);
}

/** Reads a newline-delimited JSON stream (/api/generate, /api/review), reporting progress as it goes. */
async function postStream<T>(path: string, body: unknown, onLine: (l: StreamLine<T>) => void): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("You're offline. Your drawing is saved; try again when you're connected.");
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    throw new Error((data as ApiError).error);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as StreamLine<T>;
      if (msg.type === "done") return msg.result;
      if (msg.type === "error") throw new Error(msg.error);
      onLine(msg);
    }
    if (done) break;
  }
  throw new Error("The connection dropped before the screen was finished. Try again.");
}

// Roughly how long a finished answer is, so writing progress can be shown as a fraction.
// The answer is JSON-escaped code plus a title and summary.
function expectedChars(f: Frame, previousCode?: string) {
  if (previousCode) return previousCode.length * 1.15 + 600;
  return f.device === "desktop" ? 16000 : f.device === "ipad" ? 13000 : 10000;
}

/** A fingerprint of a frame's references and captions. */
export const refsKey = (f: Frame) => (f.refs ?? []).map((r) => `${r.url ?? r.data?.slice(0, 32)}|${r.note.trim()}`).join("\n");

/** What a build would take in right now, so buttons only offer a build that can run. */
/** "Why" and "Not this" notes are standing rules: sent with every build, never used up or a reason to rebuild on their own. */
export const standing = (n: NoteItem) => n.tag === "why" || n.tag === "not";

export function buildInputs(f: Frame) {
  const notes = f.notes.filter((n) => n.status === "accepted" && !standing(n)).length;
  const markups = f.strokes.some((s) => s.kind === "markup");
  const sketch = !f.code && f.strokes.some((s) => s.kind === "sketch");
  const refs = !!f.refs?.length && refsKey(f) !== (f.refsBuilt ?? "");
  return { notes, markups, sketch, refs, any: notes > 0 || markups || sketch || refs };
}
export const NOTHING_TO_BUILD = "Add a note, mark up the screen, or change a reference, then rebuild.";

/** Builds (or rebuilds) the live screen from the sketch, notes and any markups. */
export async function runGenerate(id: string, instruction?: string, baseCode?: string) {
  const f = frame(id);
  if (!f || f.busy) return;
  if (overCap()) return updateFrame(id, { error: CAP_MSG });
  const previousCode = baseCode ?? f.code;
  const image = rasterize(f, previousCode && f.code ? "markup" : "sketch");
  const sent = f.notes.filter((n) => n.status === "accepted");
  const notes = sent.map(noteLine);
  // New or changed references are reason enough to rebuild.
  const refsChanged = buildInputs(f).refs;
  const changes = sent.filter((n) => !standing(n)).length;
  if (!image && !changes && !instruction && refsChanged && f.code)
    instruction = "Rework this screen to take from the attached references what each one is marked for. Keep the screen's purpose and content.";
  if (!image && !changes && !instruction && !(refsChanged && !f.code)) {
    return updateFrame(id, { error: f.code ? NOTHING_TO_BUILD : "Draw in the frame or add a note first." });
  }
  const builtRefs = refsKey(f);
  updateFrame(id, { busy: "generating", error: undefined });
  const startedAt = Date.now();
  setProgress(id, { phase: "thinking", startedAt });
  const expected = expectedChars(f, previousCode);
  try {
    const req: GenerateRequest = {
      brief: getState().project.brief,
      surfaceName: surfaceName(f),
      device: DEVICES[f.device].label,
      width: f.w,
      height: f.h,
      image,
      notes,
      previousCode,
      instruction,
      styleRef: getState().project.styleRef,
      refs: f.refs?.map((r) => ({ data: r.data, url: r.url, note: r.note })),
      designSystem: "shadcn",
      job: surfaceJob(f) || undefined,
      assumed: !f.code ? f.assumed : undefined,
      otherScreens: otherScreens(f),
    };
    // Building fills the first 60% of the bar; the review and its fixes the rest.
    const built = await postStream<GenerateResponse>("/api/generate", req, (l) => {
      if (l.type !== "progress") return;
      setProgress(id, {
        phase: l.phase,
        startedAt,
        fraction: l.phase === "writing" ? 0.6 * Math.min(1, l.chars / expected) : undefined,
      });
    });
    addSpend(built.usage);
    let out = { ...built, review: undefined as Frame["review"] };

    // A fresh look against the design skills, fixing what fails. If it can't finish, keep the build.
    setProgress(id, { phase: "reviewing", startedAt, fraction: 0.62 });
    try {
      const reviewReq: ReviewRequest = {
        brief: req.brief,
        surfaceName: req.surfaceName,
        device: req.device,
        width: req.width,
        height: req.height,
        image: req.image,
        notes: req.notes,
        instruction: req.instruction,
        code: built.code,
        job: req.job,
        otherScreens: req.otherScreens,
      };
      const rev = await postStream<ReviewResponse>("/api/review", reviewReq, (l) => {
        if (l.type !== "progress") return;
        setProgress(id, {
          phase: l.phase === "fixing" && l.chars > 400 ? "fixing" : "reviewing",
          startedAt,
          fraction: 0.62 + 0.36 * Math.min(1, l.chars / (built.code.length * 1.1 + 800)),
        });
      });
      addSpend(rev.usage);
      out = {
        ...out,
        code: rev.verdict === "fix" ? rev.code : built.code,
        review: { verdict: rev.verdict, findings: rev.findings, at: Date.now() },
      };
    } catch (e) {
      out = { ...out, review: { verdict: "skipped", findings: [(e as Error).message], at: Date.now() } };
    }

    // The frame shows "rendering" until its iframe reports it has drawn the screen.
    setProgress(id, { phase: "rendering", startedAt, fraction: 1 });
    updateFrame(
      id,
      (cur) => ({
        busy: undefined,
        code: out.code,
        summary: out.summary,
        alsoChanged: built.alsoChanged,
        review: out.review,
        name: cur.name || out.title,
        approved: false,
        showSketch: false, // the sketch did its job; "Show sketch" brings it back
        // Notes Claude reports as built move to History with what changed; the others stay open, with why.
        notes: cur.notes.map((n) => {
          const i = sent.findIndex((s) => s.id === n.id);
          if (i < 0 || n.status !== "accepted" || standing(n)) return n;
          const r = built.notesDone?.find((d) => d.note === i);
          // An answer without a report (an older server) counts every note as built, as before.
          if (!built.notesDone?.length || r?.done)
            return { ...n, status: "applied" as const, appliedAt: Date.now(), change: r?.change, skipped: undefined };
          return { ...n, skipped: r?.change || "Claude didn't get to this one. Rebuild to try again." };
        }),
        // Markups have been applied, so clear them; the sketch stays until you approve.
        strokes: cur.code ? cur.strokes.filter((s) => s.kind !== "markup") : cur.strokes,
        versions: [...cur.versions, { code: out.code, summary: out.summary, at: Date.now() }],
        refsBuilt: builtRefs,
      }),
      true,
    );
  } catch (e) {
    setProgress(id, undefined);
    updateFrame(id, { busy: undefined, error: (e as Error).message });
  }
}

/** Condenses a PRD (a shared Google Doc link or pasted text) into a project brief. */
export async function importPrd(req: ImportRequest): Promise<ImportResponse> {
  const out = await post<ImportResponse>("/api/import", req);
  addSpend(out.usage);
  return out;
}

/** About what a build costs: a new screen (Opus, high effort), and a variation or rebuild (Sonnet edits). */
export const COST_ESTIMATE = { screen: 0.35, variation: 0.05 };
export const dollars = (n: number) => (n < 0.1 ? `about ${Math.max(1, Math.round(n * 100))}¢` : `about $${n.toFixed(2)}`);

/**
 * Asks Claude which states of a surface's screen are worth designing (empty, error, a product-specific
 * edge case…). Nothing is built yet: the plan waits on the frame for the designer to pick from.
 */
export async function planVariations(surfaceId: string) {
  const primary = frame(surfaceId);
  if (!primary?.code || primary.busy) return;
  if (overCap()) return updateFrame(surfaceId, { error: CAP_MSG });
  const siblings = getState().project.frames.filter((x) => x.surfaceId === surfaceId && x.id !== surfaceId);
  updateFrame(surfaceId, { busy: "planning", error: undefined, variationsPlanned: true });
  setProgress(surfaceId, { phase: "planning", startedAt: Date.now() });
  try {
    const req: VariationsRequest = {
      brief: getState().project.brief,
      surfaceName: surfaceName(primary),
      device: DEVICES[primary.device].label,
      code: primary.code,
      existing: siblings.map((x) => x.name).filter(Boolean),
      job: surfaceJob(primary) || undefined,
    };
    const plan = await post<VariationsResponse>("/api/variations", req);
    addSpend(plan.usage);
    updateFrame(surfaceId, { busy: undefined, variationPlan: plan.variations });
  } catch (e) {
    updateFrame(surfaceId, { busy: undefined, error: (e as Error).message });
  } finally {
    setProgress(surfaceId, undefined);
  }
}

/** Builds the variations the designer picked, beside the original, two at a time. */
export async function buildVariations(surfaceId: string, picked: { name: string; instruction: string }[]) {
  const primary = frame(surfaceId);
  updateFrame(surfaceId, { variationPlan: undefined });
  if (!primary?.code || !picked.length) return;
  // Lay them out in rows of three to the right of the original, leaving room for note cards.
  const all = getState().project.frames.filter((x) => x.surfaceId === surfaceId);
  const startX = Math.max(...all.map((x) => x.x + x.w)) + 720;
  const stepX = primary.w + 720;
  const stepY = primary.h + 200;
  const made = picked.map((v, i) =>
    addFrame({
      name: v.name,
      device: primary.device,
      x: startX + (i % 3) * stepX,
      y: primary.y + Math.floor(i / 3) * stepY,
      w: primary.w,
      h: primary.h,
      surfaceId,
    }),
  );
  window.dispatchEvent(new Event("cotg:fit-all")); // zoom out so every variation is in view
  const queue = made.map(
    (f, i) => () => runGenerate(f.id, `Make the "${picked[i].name}" variation of this screen: ${picked[i].instruction}`, primary.code),
  );
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await job();
  };
  await Promise.all([worker(), worker()]);
}
