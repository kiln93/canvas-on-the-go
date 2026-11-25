import type {
  ApiError,
  GenerateRequest,
  GenerateResponse,
  ImportRequest,
  ImportResponse,
  SuggestRequest,
  SuggestResponse,
} from "../server/types";
import { rasterize } from "./canvas/ink";
import { addSpend, DEVICES, getState, updateFrame, type Frame } from "./store";

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
    const out = await post<GenerateResponse>("/api/generate", req);
    addSpend(out.usage);
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
    updateFrame(id, { busy: undefined, error: (e as Error).message });
  }
}

/** Condenses a PRD (a shared Google Doc link or pasted text) into a project brief. */
export async function importPrd(req: ImportRequest): Promise<ImportResponse> {
  const out = await post<ImportResponse>("/api/import", req);
  addSpend(out.usage);
  return out;
}
