import { useSyncExternalStore } from "react";
import type { Suggestion, Usage } from "../server/types";

export type Point = [number, number, number]; // x, y, pressure (frame-local px)
export type Stroke = { id: string; points: Point[]; kind: "sketch" | "markup" };

export type DeviceId = "iphone" | "ipad" | "desktop";
export const DEVICES: Record<DeviceId, { label: string; w: number; h: number }> = {
  iphone: { label: "iPhone", w: 393, h: 852 },
  ipad: { label: "iPad", w: 834, h: 1194 },
  desktop: { label: "Desktop", w: 1440, h: 900 },
};

export type NoteItem = Suggestion & { status: "pending" | "accepted" | "dismissed"; mine?: boolean };

export type Version = { code: string; summary: string; at: number };

export type Frame = {
  id: string;
  surfaceId: string; // id of the surface's primary frame (itself, for a primary frame)
  primary: boolean;
  name: string;
  device: DeviceId;
  x: number;
  y: number;
  w: number;
  h: number;
  strokes: Stroke[];
  notes: NoteItem[];
  code?: string;
  summary?: string;
  versions: Version[];
  approved: boolean;
  showSketch: boolean;
  busy?: "suggesting" | "generating";
  error?: string;
};

export type Project = {
  brief: string;
  frames: Frame[];
  spend: { month: string; cost: number };
  cap: number;
};

type State = {
  project: Project;
  surfaceId: string | null; // null = overview canvas
  selectedId: string | null;
  tutorialDone: boolean;
};

const KEY = "cotg.v1";
const month = () => new Date().toISOString().slice(0, 7);

function load(): State {
  const empty: State = {
    project: { brief: "", frames: [], spend: { month: month(), cost: 0 }, cap: 50 },
    surfaceId: null,
    selectedId: null,
    tutorialDone: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const saved = JSON.parse(raw) as State;
    // Busy flags and errors never survive a reload: an old error would hide that a fix worked.
    saved.project.frames.forEach((f) => {
      f.busy = undefined;
      f.error = undefined;
    });
    if (saved.project.spend.month !== month()) saved.project.spend = { month: month(), cost: 0 };
    return { ...empty, ...saved, selectedId: null };
  } catch {
    return empty;
  }
}

let state: State = load();
const listeners = new Set<() => void>();
const undoStack: Frame[][] = [];
const redoStack: Frame[][] = [];

let saveTimer: number | undefined;
function emit() {
  listeners.forEach((l) => l());
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked: keep working in memory */
    }
  }, 300);
}

export function getState() {
  return state;
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

function setFrames(frames: Frame[], undoable: boolean) {
  if (undoable) {
    undoStack.push(state.project.frames);
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  state = { ...state, project: { ...state.project, frames } };
  emit();
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(state.project.frames);
  setFrames(prev, false);
}

export function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(state.project.frames);
  setFrames(next, false);
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function setBrief(brief: string) {
  state = { ...state, project: { ...state.project, brief } };
  emit();
}

export function addFrame(f: Omit<Frame, "id" | "surfaceId" | "primary" | "strokes" | "notes" | "versions" | "approved" | "showSketch"> & { surfaceId?: string }) {
  const id = uid();
  const frame: Frame = {
    strokes: [],
    notes: [],
    versions: [],
    approved: false,
    showSketch: true,
    ...f,
    id,
    surfaceId: f.surfaceId ?? id,
    primary: !f.surfaceId,
  };
  setFrames([...state.project.frames, frame], true);
  return frame;
}

export function updateFrame(id: string, patch: Partial<Frame> | ((f: Frame) => Partial<Frame>), undoable = false) {
  setFrames(
    state.project.frames.map((f) => (f.id === id ? { ...f, ...(typeof patch === "function" ? patch(f) : patch) } : f)),
    undoable,
  );
}

export function deleteFrame(id: string) {
  const f = state.project.frames.find((x) => x.id === id);
  if (!f) return;
  // Deleting a surface's primary frame deletes the whole surface.
  setFrames(
    state.project.frames.filter((x) => (f.primary ? x.surfaceId !== f.surfaceId : x.id !== id)),
    true,
  );
  if (state.selectedId === id) set({ selectedId: null });
}

export function addSpend(u: Usage) {
  const spend = state.project.spend.month === month() ? state.project.spend : { month: month(), cost: 0 };
  state = { ...state, project: { ...state.project, spend: { month: spend.month, cost: spend.cost + u.cost } } };
  emit();
}

export function framesOn(frames: Frame[], surfaceId: string | null) {
  return frames.filter((f) => (surfaceId ? f.surfaceId === surfaceId : f.primary));
}
