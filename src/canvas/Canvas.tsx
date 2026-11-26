import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addFrame,
  deleteFrame,
  DEVICES,
  framesOn,
  getState,
  redo,
  set,
  uid,
  undo,
  updateFrame,
  useStore,
  type DeviceId,
  type Frame,
  type Point,
  type Stroke,
} from "../store";
import { FrameView } from "./FrameView";
import { strokePath } from "./ink";
import { NoteCard } from "./NoteCard";
import { useCloseOnOutsideTap } from "../useCloseOnOutsideTap";
import { NoteComposer, NoteTargetBox, type NoteTarget } from "./NoteComposer";
import { primeKeyboard } from "./keyboard";
import { pickInFrame } from "./pick";
import { buildInputs, COST_ESTIMATE, dollars, runGenerate, runSuggest } from "../api";

/** Drawing tools, used only in the drawing view. The canvas itself only moves and opens screens. */
export type Tool = "pen" | "eraser";
type Camera = { x: number; y: number; z: number };

const cameras = new Map<string, Camera>(); // remembered per canvas (overview or a surface)
const HOLD_MS = 500; // press and hold the pen this long, without moving, to leave a note
const MOVE_HOLD_MS = 450; // on the canvas, hold a frame this long to pick it up and move it
const TAP_SLOP = 8; // screen px a tap may wander and still count as a tap

type Gesture =
  | { type: "draw"; frameId: string; points: Point[]; kind: Stroke["kind"]; sx: number; sy: number; t0: number }
  | { type: "erase"; touched: boolean }
  | { type: "move"; frameId: string; dx: number; dy: number; moved: boolean }
  | { type: "pan"; sx: number; sy: number; cam: Camera }
  | { type: "pinch"; d0: number; mid0: { x: number; y: number }; cam: Camera }
  | null;

export function Canvas(props: { tool: Tool; onPlay: (id: string) => void }) {
  const { tool } = props;
  const surfaceId = useStore((s) => s.surfaceId);
  const allFrames = useStore((s) => s.project.frames);
  const focusId = useStore((s) => s.focusId);
  // In the focused drawing view only that frame is on the canvas.
  const frames = useMemo(
    () => (focusId ? allFrames.filter((f) => f.id === focusId) : framesOn(allFrames, surfaceId)),
    [allFrames, surfaceId, focusId],
  );
  const selectedId = useStore((s) => s.selectedId);
  const key = surfaceId ?? "overview";
  const rootRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera>(() => cameras.get(key) ?? { x: 80, y: 80, z: 0.6 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const gesture = useRef<Gesture>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const touchTap = useRef<{ t: number; max: number; moved: boolean } | null>(null);
  // A press on the canvas (not the drawing view): a tap selects, a drag pans, a hold on a frame picks it up.
  const press = useRef<{ t: number; x: number; y: number; moved: boolean; hitId: string | null } | null>(null);
  // In the drawing view, a tap (finger or Pencil) on the screen picks the part under it and opens a note there.
  const focusTap = useRef<{ t: number; x: number; y: number; wx: number; wy: number; hitId: string | null } | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastTap = useRef<{ t: number; id: string | null }>({ t: 0, id: null });
  const [live, setLive] = useState<Gesture>(null);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [pressAt, setPressAt] = useState<{ x: number; y: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  // Until a Pencil shows up, a single finger uses the tool (phones); after that fingers only pan and zoom.
  const penSeen = useRef(false);
  const holdOpened = useRef(false); // a press-and-hold just opened a note box; the lift brings up the keyboard
  const beforeFocus = useRef<Camera | null>(null);
  const flight = useRef<gsap.core.Tween>();

  /** Glides the camera to a new position. */
  const flyTo = (to: Camera) => {
    flight.current?.kill();
    const from = { ...camRef.current };
    flight.current = gsap.to(from, { ...to, duration: 0.6, ease: "power3.inOut", onUpdate: () => setCam({ ...from }) });
  };
  /** Camera that makes a frame fill the screen in the focused view. */
  const fitFocus = (f: Frame): Camera | null => {
    const el = rootRef.current;
    if (!el) return null;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const safe = safeInsets();
    const wide = W >= WIDE;
    const top = FOCUS_BAR_H + safe.top + 16; // the drawing view's top bar
    // The tools float at the bottom, or on wide screens sit in a rail on the left edge.
    const bottom = (wide ? 16 : 76 + 16) + safe.bottom;
    const left = wide ? TOOL_RAIL_W : 0;
    // On wide screens the notes panel is docked on the right, so the frame centers in what's left.
    const right = getState().notesOpen && wide ? NOTES_W : 0;
    const availW = W - left - right - 32;
    const availH = H - top - bottom;
    // As big as the width allows, like a sheet of paper, but never so tall that most of it is off screen:
    // a phone on a landscape iPad shows most of its height; scroll with two fingers for the rest.
    const z = clampZ(Math.min(3, availW / f.w, (1.6 * availH) / f.h));
    const fits = f.h * z <= availH;
    return { z, x: left + (W - left - right - f.w * z) / 2 - f.x * z, y: (fits ? top + (availH - f.h * z) / 2 : top) - f.y * z };
  };

  /** Opens the focused drawing view on a frame. */
  const enterFocus = (f: Frame) => {
    const to = fitFocus(f);
    if (!to) return;
    if (!getState().focusId) beforeFocus.current = { ...camRef.current };
    setNoteTarget(null);
    set({ focusId: f.id, selectedId: f.id });
    flyTo(to);
  };
  // Opening or closing the docked notes panel on a wide screen re-centers the frame beside it.
  const notesOpen = useStore((s) => s.notesOpen);
  useEffect(() => {
    const f = getState().project.frames.find((x) => x.id === getState().focusId);
    const to = f && rootRef.current && rootRef.current.clientWidth >= WIDE && fitFocus(f);
    if (to) flyTo(to);
  }, [notesOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back on the canvas, the frame stays in view with its buttons clear of the toolbar, no closer than before.
  const exitFocus = () => {
    const f = getState().project.frames.find((x) => x.id === getState().focusId);
    const el = rootRef.current;
    set({ focusId: null, notesOpen: false });
    setNoteTarget(null);
    const prev = beforeFocus.current;
    beforeFocus.current = null;
    if (!f || !el) return prev && flyTo(prev);
    const W = el.clientWidth;
    const H = el.clientHeight;
    const top = 52 + safeInsets().top + 24;
    const bottom = W < 500 ? 260 : 180; // the frame's buttons (they wrap on a phone) plus the toolbar
    const z = clampZ(Math.min(prev?.z ?? 1, (H - top - bottom) / f.h, (W - 32) / f.w));
    flyTo({ z, x: (W - f.w * z) / 2 - f.x * z, y: top + (H - top - bottom - f.h * z) / 2 - f.y * z });
  };
  // Leave the focused view if its frame is deleted (or undone away); refit when the screen turns.
  useEffect(() => {
    if (focusId && !allFrames.some((f) => f.id === focusId)) exitFocus();
  }, [focusId, allFrames]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const refit = () => {
      const f = getState().project.frames.find((x) => x.id === getState().focusId);
      const to = f && fitFocus(f);
      if (to) flyTo(to);
    };
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Zoom out to show every frame on this canvas (after variations are added).
  useEffect(() => {
    const fit = () => {
      const el = rootRef.current;
      const fs = framesOn(getState().project.frames, getState().surfaceId); // fresh: frames were just added
      if (!el || !fs.length) return;
      const x0 = Math.min(...fs.map((f) => f.x));
      const y0 = Math.min(...fs.map((f) => f.y));
      const x1 = Math.max(...fs.map((f) => f.x + f.w));
      const y1 = Math.max(...fs.map((f) => f.y + f.h));
      const W = el.clientWidth;
      const H = el.clientHeight;
      const z = clampZ(Math.min(1, (W - 96) / (x1 - x0), (H - 76 - 140) / (y1 - y0)));
      flyTo({ z, x: (W - (x1 - x0) * z) / 2 - x0 * z, y: 76 + 24 - y0 * z });
    };
    // "Draw" on a frame: zoom in so it fills the screen.
    const focus = (e: Event) => {
      const f = getState().project.frames.find((x) => x.id === (e as CustomEvent<string>).detail);
      if (f) enterFocus(f);
    };
    // "New screen": a frame for the chosen device beside the others, opened straight in the drawing view.
    const newScreen = (e: Event) => {
      const device = (e as CustomEvent<DeviceId>).detail;
      const spec = DEVICES[device];
      const sid = getState().surfaceId;
      const fs = framesOn(getState().project.frames, sid);
      const x = fs.length ? Math.max(...fs.map((f) => f.x + f.w)) + 400 : 0;
      const y = fs.length ? Math.min(...fs.map((f) => f.y)) : 0;
      const f = addFrame({ name: "", device, x, y, w: spec.w, h: spec.h, surfaceId: sid ?? undefined });
      enterFocus(f);
    };
    window.addEventListener("cotg:fit-all", fit);
    window.addEventListener("cotg:focus", focus);
    window.addEventListener("cotg:new-screen", newScreen);
    return () => {
      window.removeEventListener("cotg:fit-all", fit);
      window.removeEventListener("cotg:focus", focus);
      window.removeEventListener("cotg:new-screen", newScreen);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelHold = () => {
    clearTimeout(holdTimer.current);
    setPressAt(null);
  };

  /** Opens a note at a point in a frame: on a live screen, on the component there; on a sketch, on the strokes there. */
  async function startNote(f: Frame, lx: number, ly: number) {
    let target: NoteTarget = { frameId: f.id, box: { x: lx - 70, y: ly - 45, w: 140, h: 90 } };
    if (f.code) {
      const hit = await pickInFrame(f.id, lx, ly);
      if (hit && hit.w > 0) target = { frameId: f.id, box: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, label: hit.label };
    } else {
      const near = f.strokes.filter((s) => s.kind === "sketch" && s.points.some(([x, y]) => Math.hypot(x - lx, y - ly) < 40));
      if (near.length) {
        const xs = near.flatMap((s) => s.points.map((p) => p[0]));
        const ys = near.flatMap((s) => s.points.map((p) => p[1]));
        const x0 = Math.min(...xs) - 8;
        const y0 = Math.min(...ys) - 8;
        target = { frameId: f.id, box: { x: x0, y: y0, w: Math.max(...xs) + 8 - x0, h: Math.max(...ys) + 8 - y0 } };
      }
    }
    set({ selectedId: f.id });
    setNoteTarget(target);
  }

  // Switch camera when moving between the overview and a surface.
  useEffect(() => {
    const saved = cameras.get(key);
    if (saved) return setCam(saved);
    const primary = surfaceId ? getState().project.frames.find((f) => f.id === surfaceId) : undefined;
    const el = rootRef.current;
    if (primary && el) {
      const z = Math.min(1, (el.clientHeight - 200) / primary.h);
      setCam({ x: 120 - primary.x * z, y: 100 - primary.y * z, z });
    } else setCam({ x: 80, y: 80, z: 0.6 });
  }, [key, surfaceId]);
  useEffect(() => void cameras.set(key, cam), [key, cam]);

  const toWorld = (cx: number, cy: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    const c = camRef.current;
    return { x: (cx - r.left - c.x) / c.z, y: (cy - r.top - c.y) / c.z };
  };
  const frameAt = (wx: number, wy: number): Frame | undefined =>
    [...frames].reverse().find((f) => wx >= f.x && wx <= f.x + f.w && wy >= f.y && wy <= f.y + f.h);

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("[data-ui]")) return;
    // A tap on the canvas closes the keyboard; and stopping the tap's mouse events keeps a note box
    // that opens under the finger (press and hold) from losing its focus when the finger lifts.
    e.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    if (active?.matches("input, textarea")) active.blur();
    if (e.pointerType === "pen") penSeen.current = true;
    const isTouch = e.pointerType === "touch";
    // Palm rejection: while the Pencil is drawing, ignore touches.
    const busyPen = gesture.current && ["draw", "erase", "move"].includes(gesture.current.type);
    if (isTouch && busyPen && penSeen.current) return;
    // A second finger turns a one-finger stroke or move into a pinch.
    if (isTouch && busyPen) {
      cancelHold();
      gesture.current = null;
      setLive(null);
    }
    rootRef.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const touches = [...pointers.current.values()].filter((p) => p.type === "touch");
    if (isTouch) {
      if (touches.length === 1) touchTap.current = { t: Date.now(), max: 1, moved: false };
      else if (touchTap.current) touchTap.current.max = Math.max(touchTap.current.max, touches.length);
    }
    if (touches.length >= 2) {
      clearTimeout(moveTimer.current);
      press.current = null;
      focusTap.current = null;
      const [a, b] = touches;
      gesture.current = {
        type: "pinch",
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        cam: camRef.current,
      };
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) {
      gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, cam: camRef.current };
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const hit = frameAt(w.x, w.y);

    // The canvas never draws: any finger, Pencil or mouse pans it, a tap selects, a hold on a frame moves it.
    if (!focusId) {
      gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, cam: camRef.current };
      press.current = { t: Date.now(), x: e.clientX, y: e.clientY, moved: false, hitId: hit?.id ?? null };
      clearTimeout(moveTimer.current);
      if (hit) {
        moveTimer.current = setTimeout(() => {
          if (!press.current || press.current.moved || gesture.current?.type !== "pan") return;
          press.current = null;
          set({ selectedId: hit.id });
          gesture.current = { type: "move", frameId: hit.id, dx: w.x - hit.x, dy: w.y - hit.y, moved: false };
          setLive(gesture.current);
        }, MOVE_HOLD_MS);
      }
      return;
    }

    // The drawing view: the Pencil (and a mouse) always draws. Fingers draw too until a Pencil has been
    // used; after that a finger scrolls, so a resting palm never leaves marks.
    focusTap.current = pointers.current.size === 1 ? { t: Date.now(), x: e.clientX, y: e.clientY, wx: w.x, wy: w.y, hitId: hit?.id ?? null } : null;
    if (isTouch && penSeen.current) {
      gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, cam: camRef.current };
      return;
    }
    const owner = frames[0];
    if (!owner) return;
    if (tool === "pen") {
      setNoteTarget(null);
      const kind = owner.code ? "markup" : "sketch";
      gesture.current = {
        type: "draw",
        frameId: owner.id,
        kind,
        points: [[w.x - owner.x, w.y - owner.y, e.pressure]],
        sx: e.clientX,
        sy: e.clientY,
        t0: Date.now(),
      };
      // Press and hold on the screen to leave a note there instead of drawing.
      if (hit) {
        clearTimeout(holdTimer.current);
        setPressAt({ x: w.x, y: w.y });
        holdTimer.current = setTimeout(() => {
          const g = gesture.current;
          if (g?.type !== "draw" || g.frameId !== hit.id) return;
          gesture.current = null;
          setLive(null);
          setPressAt(null);
          holdOpened.current = true;
          startNote(hit, w.x - hit.x, w.y - hit.y);
        }, HOLD_MS);
      }
    } else {
      gesture.current = { type: "erase", touched: false };
      eraseAt(w.x, w.y);
    }
    setLive(gesture.current);
  }

  function eraseAt(wx: number, wy: number) {
    const g = gesture.current;
    if (g?.type !== "erase") return;
    const hit = frameAt(wx, wy);
    if (!hit) return;
    const lx = wx - hit.x;
    const ly = wy - hit.y;
    const r = 12 / camRef.current.z;
    const keep = hit.strokes.filter((s) => !s.points.some(([x, y]) => Math.hypot(x - lx, y - ly) < r));
    if (keep.length !== hit.strokes.length) {
      updateFrame(hit.id, { strokes: keep }, !g.touched);
      g.touched = true;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const g = gesture.current;
    if (!g) return;

    if (g.type === "pinch") {
      const touches = [...pointers.current.values()].filter((t) => t.type === "touch");
      if (touches.length < 2) return;
      const [a, b] = touches;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (Math.abs(d - g.d0) > 8 || Math.hypot(mid.x - g.mid0.x, mid.y - g.mid0.y) > 8) {
        if (touchTap.current) touchTap.current.moved = true;
      }
      const r = rootRef.current!.getBoundingClientRect();
      const z = clampZ(g.cam.z * (d / g.d0));
      const wx = (g.mid0.x - r.left - g.cam.x) / g.cam.z;
      const wy = (g.mid0.y - r.top - g.cam.y) / g.cam.z;
      setCam({ z, x: mid.x - r.left - wx * z, y: mid.y - r.top - wy * z });
      return;
    }
    if (g.type === "pan") {
      const far = Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > TAP_SLOP;
      if (far && touchTap.current) touchTap.current.moved = true;
      if (far && press.current) {
        press.current.moved = true;
        clearTimeout(moveTimer.current);
      }
      setCam({ ...g.cam, x: g.cam.x + e.clientX - g.sx, y: g.cam.y + e.clientY - g.sy });
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (g.type === "draw") {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) cancelHold();
      const f = frames.find((x) => x.id === g.frameId) ?? { x: 0, y: 0 };
      const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events) {
        const cw = toWorld(ev.clientX, ev.clientY);
        g.points.push([cw.x - f.x, cw.y - f.y, ev.pressure]);
      }
      setLive({ ...g });
    } else if (g.type === "erase") eraseAt(w.x, w.y);
    else if (g.type === "move") {
      const f = frames.find((x) => x.id === g.frameId);
      if (!f) return;
      const nx = w.x - g.dx;
      const ny = w.y - g.dy;
      if (!g.moved && Math.hypot(nx - f.x, ny - f.y) < 3) return;
      updateFrame(g.frameId, { x: nx, y: ny }, !g.moved);
      g.moved = true;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return; // an ignored touch (palm) or a UI tap
    pointers.current.delete(e.pointerId);
    if (holdOpened.current) {
      holdOpened.current = false;
      // The lift is a tap, so the keyboard may open now: focus the note box, or hold the keyboard for it.
      const box = document.querySelector<HTMLInputElement>(".note-composer input");
      if (box) box.focus();
      else primeKeyboard();
    }
    const g = gesture.current;
    const remainingTouches = [...pointers.current.values()].filter((t) => t.type === "touch").length;

    // Drawing view: a tap on the screen (not a stroke, not a pinch) opens a note on the part tapped.
    const ft = focusTap.current;
    focusTap.current = null;
    if (
      focusId &&
      ft?.hitId &&
      pointers.current.size === 0 &&
      Date.now() - ft.t < 400 &&
      Math.hypot(e.clientX - ft.x, e.clientY - ft.y) < TAP_SLOP &&
      (!g || g.type === "pan" || (g.type === "draw" && g.points.length < 6))
    ) {
      const hit = frames.find((f) => f.id === ft.hitId);
      cancelHold();
      gesture.current = null;
      setLive(null);
      touchTap.current = null;
      if (hit) {
        startNote(hit, ft.wx - hit.x, ft.wy - hit.y).then(() => {
          const box = document.querySelector<HTMLInputElement>(".note-composer input");
          if (box) box.focus();
        });
      }
      return;
    }

    // Two-finger tap undoes, three-finger tap redoes (when nothing moved).
    if (e.pointerType === "touch" && remainingTouches === 0 && touchTap.current) {
      const t = touchTap.current;
      touchTap.current = null;
      if (!t.moved && Date.now() - t.t < 350) {
        if (t.max === 2) undo();
        else if (t.max === 3) redo();
      }
    }
    // A tap on the canvas selects a frame (or clears the selection); a double tap opens a surface.
    clearTimeout(moveTimer.current);
    const pr = press.current;
    press.current = null;
    if (pr && !pr.moved && pointers.current.size === 0 && Date.now() - pr.t < MOVE_HOLD_MS) {
      const now = Date.now();
      const hit = pr.hitId ? frames.find((f) => f.id === pr.hitId) : undefined;
      if (hit && lastTap.current.id === hit.id && now - lastTap.current.t < 350 && hit.primary && !surfaceId) {
        set({ surfaceId: hit.surfaceId, selectedId: hit.id });
      } else set({ selectedId: hit?.id ?? null });
      lastTap.current = { t: now, id: hit?.id ?? null };
    }
    if (g?.type === "pinch" && remainingTouches === 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { type: "pan", sx: p.x, sy: p.y, cam: camRef.current };
      return;
    }
    if (pointers.current.size > 0 && (g?.type === "pan" || g?.type === "pinch")) return;

    cancelHold();
    if (g?.type === "draw" && g.points.length > 1) {
      const stroke: Stroke = { id: uid(), points: g.points, kind: g.kind };
      updateFrame(g.frameId, (f) => ({ strokes: [...f.strokes, stroke] }), true);
    }
    gesture.current = null;
    setLive(null);
  }

  // Mouse and trackpad: scroll pans, pinch or ctrl+scroll zooms.
  function onWheel(e: React.WheelEvent) {
    if ((e.target as HTMLElement).closest("[data-ui]")) return;
    const c = camRef.current;
    if (e.ctrlKey || e.metaKey) {
      const r = rootRef.current!.getBoundingClientRect();
      const z = clampZ(c.z * Math.exp(-e.deltaY * 0.01));
      const wx = (e.clientX - r.left - c.x) / c.z;
      const wy = (e.clientY - r.top - c.y) / c.z;
      setCam({ z, x: e.clientX - r.left - wx * z, y: e.clientY - r.top - wy * z });
    } else setCam({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY });
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && getState().focusId && !isTyping(e)) exitFocus();
      if ((e.key === "Backspace" || e.key === "Delete") && !isTyping(e)) {
        const id = getState().selectedId;
        if (id) deleteFrame(id);
      }
    };
    window.addEventListener("keydown", down);
    return () => {
      window.removeEventListener("keydown", down);
    };
  }, []);

  // Safari fires gesture events for trackpad/touch pinch; stop it zooming the page.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    return () => document.removeEventListener("gesturestart", stop);
  }, []);

  const liveFrame = live?.type === "draw" ? frames.find((f) => f.id === live.frameId) : undefined;

  return (
    <div
      ref={rootRef}
      className={`canvas tool-${tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ backgroundPosition: `${cam.x}px ${cam.y}px`, backgroundSize: `${24 * cam.z}px ${24 * cam.z}px` }}
    >
      <div className="world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
        {frames.map((f) => (
          <FrameView
            key={f.id}
            frame={f}
            selected={f.id === selectedId}
            inSurface={!!surfaceId}
            zoom={cam.z}
            onPlay={() => props.onPlay(f.id)}
            focused={f.id === focusId}
          />
        ))}
        {pressAt && <div className="press-ring" style={{ left: pressAt.x, top: pressAt.y }} />}
        {noteTarget &&
          (() => {
            const f = frames.find((x) => x.id === noteTarget.frameId);
            return f ? <NoteTargetBox frame={f} target={noteTarget} /> : null;
          })()}
        {liveFrame && live?.type === "draw" && (
          <svg
            className="live-ink"
            style={{ left: liveFrame.x, top: liveFrame.y, width: liveFrame.w, height: liveFrame.h }}
          >
            <path
              d={strokePath({ id: "live", points: live.points, kind: live.kind })}
              fill={live.kind === "markup" ? "var(--markup)" : "var(--ink)"}
            />
          </svg>
        )}
      </div>
      {noteTarget &&
        rootRef.current &&
        (() => {
          const f = frames.find((x) => x.id === noteTarget.frameId);
          return f ? (
            <NoteComposer
              frame={f}
              target={noteTarget}
              cam={cam}
              viewport={{ w: rootRef.current.clientWidth, h: rootRef.current.clientHeight }}
              onClose={() => setNoteTarget(null)}
            />
          ) : null;
        })()}
      {focusId && frames[0] && <FocusBar frame={frames[0]} onDone={exitFocus} onPlay={() => props.onPlay(frames[0].id)} />}
      {frames.length === 0 && (
        <div className="empty-hint">
          {surfaceId
            ? "Tap New screen to sketch another state of this surface."
            : "Tap New screen, pick a device, and start drawing."}
        </div>
      )}
    </div>
  );
}

const clampZ = (z: number) => Math.min(3, Math.max(0.08, z));
// The drawing view's chrome, matched in styles.css (.focus-bar, .focus-notes).
const FOCUS_BAR_H = 56;
const NOTES_W = 360;
const TOOL_RAIL_W = 76;
const WIDE = 900;
/** The notch and home-indicator insets, in CSS px (CSS env() values aren't readable from script). */
function safeInsets() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return out;
}
const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
};

/** The bar above a frame in the focused drawing view: back to the canvas, the notes, and the next step. */
function FocusBar({ frame: f, onDone, onPlay }: { frame: Frame; onDone: () => void; onPlay: () => void }) {
  const sketched = f.strokes.some((s) => s.kind === "sketch");
  const marked = f.strokes.some((s) => s.kind === "markup");
  const live = f.notes.filter((n) => n.status === "pending" || n.status === "accepted");
  const accepted = live.filter((n) => n.status === "accepted").length;
  const notesOpen = useStore((s) => s.notesOpen);
  const setNotesOpen = (open: boolean) => set({ notesOpen: open });
  // Open the notes when suggestions arrive, or when a build leaves a note undone.
  const suggesting = f.busy === "suggesting";
  const skipped = f.notes.some((n) => n.status === "accepted" && n.skipped);
  useEffect(() => {
    if (suggesting || skipped) setNotesOpen(true);
  }, [suggesting, skipped]);
  return (
    <>
      <header className="focus-bar" data-ui>
        <button className="btn ghost focus-done" onClick={onDone}>
          ‹ Done
        </button>
        <ScreenMenu frame={f} onPlay={onPlay} onDeleted={onDone} />
        <button className={`btn ${notesOpen ? "on" : ""}`} aria-expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
          Notes{live.length ? ` · ${live.length}` : ""}
        </button>
        {!f.code && sketched && (
          <button className="btn focus-suggest" disabled={!!f.busy} onClick={() => runSuggest(f.id)}>
            Suggest
          </button>
        )}
        {buildInputs(f).any && (
          <button className="btn ink" disabled={!!f.busy} onClick={() => runGenerate(f.id)}>
            {f.code ? "Rebuild" : "Generate"}
            <span className="focus-cost"> · {dollars(f.code ? COST_ESTIMATE.variation : COST_ESTIMATE.screen)}</span>
            <span className="focus-cost-short"> · {dollars(f.code ? COST_ESTIMATE.variation : COST_ESTIMATE.screen).replace("about ", "~")}</span>
          </button>
        )}
      </header>
      {notesOpen && (
        <div className="focus-notes" data-ui>
          <div className="focus-notes-bar">
            <span>Notes</span>
            <button className="btn ghost focus-notes-close" onClick={() => setNotesOpen(false)}>
              Done
            </button>
          </div>
          <NoteCard frame={f} style={{}} />
        </div>
      )}
    </>
  );
}

/** The screen's name in the drawing view's bar; tap it for the screen's actions (play, rename, undo a version). */
function ScreenMenu({ frame: f, onPlay, onDeleted }: { frame: Frame; onPlay: () => void; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(f.name);
  const ref = useCloseOnOutsideTap(open, () => (setOpen(false), setRenaming(false)));
  const close = () => (setOpen(false), setRenaming(false));
  const title = f.name || (f.primary ? "Untitled screen" : "Variation");
  return (
    <div className="focus-title menu-wrap" ref={ref}>
      <button className="focus-title-btn" onClick={() => (setName(f.name), setOpen((o) => !o))} aria-expanded={open} aria-haspopup="menu">
        <span className="focus-title-name">{title}</span>
        <span className="muted"> · {DEVICES[f.device].label}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span className="focus-title-more" aria-label="Screen actions">•••</span>
      </button>
      {open && (
        <div className="menu screen-menu" role="menu">
          {renaming ? (
            <form
              className="screen-rename"
              onSubmit={(e) => {
                e.preventDefault();
                updateFrame(f.id, { name: name.trim() }, true);
                close();
              }}
            >
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Screen name" placeholder="Screen name" />
              <button className="btn ink">Save</button>
            </form>
          ) : (
            <>
              {!f.code && f.strokes.some((s) => s.kind === "sketch") && (
                <button role="menuitem" disabled={!!f.busy} onClick={() => (close(), runSuggest(f.id))}>
                  Suggest notes from the sketch
                </button>
              )}
              {f.code && (
                <button role="menuitem" onClick={() => (close(), onPlay())}>
                  ▶ Play
                </button>
              )}
              <button role="menuitem" onClick={() => (primeKeyboard(), setRenaming(true))}>
                Rename
              </button>
              {f.code && !f.approved && (
                <button
                  role="menuitem"
                  onClick={() => (close(), updateFrame(f.id, (cur) => ({ approved: true, strokes: cur.strokes.filter((s) => s.kind !== "sketch") }), true))}
                >
                  Approve this version
                </button>
              )}
              {f.versions.length > 1 && (
                <button
                  role="menuitem"
                  disabled={!!f.busy}
                  onClick={() => {
                    close();
                    updateFrame(
                      f.id,
                      (cur) => {
                        const versions = cur.versions.slice(0, -1);
                        const prev = versions[versions.length - 1];
                        return { versions, code: prev.code, summary: prev.summary };
                      },
                      true,
                    );
                  }}
                >
                  Undo version
                </button>
              )}
              <button role="menuitem" className="danger" onClick={() => (close(), onDeleted(), deleteFrame(f.id))}>
                Delete screen
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
