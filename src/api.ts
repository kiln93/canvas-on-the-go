import type {
  ApiError,
  GenerateRequest,
  GenerateResponse,
  GenerateStreamLine,
  ImportRequest,
  ImportResponse,
  SuggestRequest,
  SuggestResponse,
} from "../server/types";
import { rasterize } from "./canvas/ink";
import { useSyncExternalStore } from "react";
import { addSpend, DEVICES, getState, updateFrame, type Frame } from "./store";

// Live progress for frames that are busy. Kept out of the saved project: it's only true right now.
export type FrameProgress = {
  phase: "reading" | "thinking" | "writing" | "rendering";
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

function overCap() {
  const { spend, cap } = getState().project;
  return spend.cost >= cap;
}

const CAP_MSG = "You've reached this month's AI spending cap. Raise it from the meter at the top right.";

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
    };
    const out = await post<SuggestResponse>("/api/suggest", req);
    addSpend(out.usage);
    updateFrame(id, (cur) => ({
      busy: undefined,
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

/** Reads a newline-delimited JSON stream from /api/generate, reporting progress as it goes. */
async function postStream(body: GenerateRequest, onLine: (l: GenerateStreamLine) => void): Promise<GenerateResponse> {
  let res: Response;
  try {
    res = await fetch("/api/generate", {
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
      const msg = JSON.parse(line) as GenerateStreamLine;
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

/** Builds (or rebuilds) the live screen from the sketch, notes and any markups. */
export async function runGenerate(id: string, instruction?: string, baseCode?: string) {
  const f = frame(id);
  if (!f || f.busy) return;
  if (overCap()) return updateFrame(id, { error: CAP_MSG });
  const previousCode = baseCode ?? f.code;
  const image = rasterize(f, previousCode && f.code ? "markup" : "sketch");
  const notes = f.notes.filter((n) => n.status === "accepted").map((n) => n.text);
  if (!image && !notes.length && !instruction) {
    return updateFrame(id, { error: "Draw in the frame or add a note first." });
  }
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
      designSystem: "shadcn",
    };
    const out = await postStream(req, (l) => {
      if (l.type !== "progress") return;
      setProgress(id, {
        phase: l.phase,
        startedAt,
        fraction: l.phase === "writing" ? Math.min(0.95, l.chars / expected) : undefined,
      });
    });
    addSpend(out.usage);
    // The frame shows "rendering" until its iframe reports it has drawn the screen.
    setProgress(id, { phase: "rendering", startedAt, fraction: 1 });
    updateFrame(
      id,
      (cur) => ({
        busy: undefined,
        code: out.code,
        summary: out.summary,
        name: cur.name || out.title,
        approved: false,
        showSketch: true,
        // Markups have been applied, so clear them; the sketch stays until you approve.
        strokes: cur.code ? cur.strokes.filter((s) => s.kind !== "markup") : cur.strokes,
        versions: [...cur.versions, { code: out.code, summary: out.summary, at: Date.now() }],
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
