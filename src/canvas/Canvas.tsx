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

export type Tool = "select" | "pen" | "eraser" | "frame";
type Camera = { x: number; y: number; z: number };

const cameras = new Map<string, Camera>(); // remembered per canvas (overview or a surface)

type Gesture =
  | { type: "draw"; frameId: string; points: Point[]; kind: Stroke["kind"] }
  | { type: "erase"; touched: boolean }
  | { type: "frame"; x0: number; y0: number; x1: number; y1: number }
  | { type: "move"; frameId: string; dx: number; dy: number; moved: boolean }
  | { type: "pan"; sx: number; sy: number; cam: Camera }
  | { type: "pinch"; d0: number; mid0: { x: number; y: number }; cam: Camera }
  | null;

export function Canvas(props: {
  tool: Tool;
  device: DeviceId;
  onPlay: (id: string) => void;
}) {
  const { tool, device } = props;
  const surfaceId = useStore((s) => s.surfaceId);
  const allFrames = useStore((s) => s.project.frames);
  const frames = useMemo(() => framesOn(allFrames, surfaceId), [allFrames, surfaceId]);
  const selectedId = useStore((s) => s.selectedId);
  const key = surfaceId ?? "overview";
  const rootRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera>(() => cameras.get(key) ?? { x: 80, y: 80, z: 0.6 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const gesture = useRef<Gesture>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const touchTap = useRef<{ t: number; max: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; id: string | null }>({ t: 0, id: null });
  const [live, setLive] = useState<Gesture>(null);

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
    // Palm rejection: while the Pencil is drawing, ignore touches.
    const busyPen = gesture.current && ["draw", "erase", "frame", "move"].includes(gesture.current.type);
    if (e.pointerType === "touch" && busyPen) return;
    rootRef.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const isTouch = e.pointerType === "touch";
    const isPan = isTouch || e.button === 1 || (e.pointerType === "mouse" && e.button === 0 && spaceDown.current);

    if (isPan) {
      const touches = [...pointers.current.values()].filter((p) => p.type === "touch");
      if (isTouch) {
        if (touches.length === 1) touchTap.current = { t: Date.now(), max: 1, moved: false };
        else if (touchTap.current) touchTap.current.max = Math.max(touchTap.current.max, touches.length);
      }
      if (touches.length >= 2) {
        const [a, b] = touches;
        gesture.current = {
          type: "pinch",
          d0: Math.hypot(a.x - b.x, a.y - b.y),
          mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          cam: camRef.current,
        };
      } else gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, cam: camRef.current };
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e.clientX, e.clientY);
    const hit = frameAt(w.x, w.y);

    if (tool === "pen") {
      if (!hit) return;
      const kind = hit.code ? "markup" : "sketch";
      gesture.current = { type: "draw", frameId: hit.id, kind, points: [[w.x - hit.x, w.y - hit.y, e.pressure]] };
      set({ selectedId: hit.id });
    } else if (tool === "eraser") {
      gesture.current = { type: "erase", touched: false };
      eraseAt(w.x, w.y);
    } else if (tool === "frame") {
      gesture.current = { type: "frame", x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    } else {
      if (!hit) {
        set({ selectedId: null });
        gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, cam: camRef.current };
        return;
      }
      const now = Date.now();
      if (lastTap.current.id === hit.id && now - lastTap.current.t < 350 && hit.primary && !surfaceId) {
        set({ surfaceId: hit.surfaceId, selectedId: hit.id });
        gesture.current = null;
        return;
      }
      lastTap.current = { t: now, id: hit.id };
      set({ selectedId: hit.id });
      gesture.current = { type: "move", frameId: hit.id, dx: w.x - hit.x, dy: w.y - hit.y, moved: false };
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
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 6 && touchTap.current) touchTap.current.moved = true;
      setCam({ ...g.cam, x: g.cam.x + e.clientX - g.sx, y: g.cam.y + e.clientY - g.sy });
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (g.type === "draw") {
      const f = frames.find((x) => x.id === g.frameId)!;
      const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events) {
        const cw = toWorld(ev.clientX, ev.clientY);
        g.points.push([cw.x - f.x, cw.y - f.y, ev.pressure]);
      }
      setLive({ ...g });
    } else if (g.type === "erase") eraseAt(w.x, w.y);
    else if (g.type === "frame") {
      g.x1 = w.x;
      g.y1 = w.y;
      setLive({ ...g });
    } else if (g.type === "move") {
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
    const g = gesture.current;
    const remainingTouches = [...pointers.current.values()].filter((t) => t.type === "touch").length;

    // Two-finger tap undoes, three-finger tap redoes (when nothing moved).
    if (e.pointerType === "touch" && remainingTouches === 0 && touchTap.current) {
      const t = touchTap.current;
      touchTap.current = null;
      if (!t.moved && Date.now() - t.t < 350) {
        if (t.max === 2) undo();
        else if (t.max === 3) redo();
        else if (t.max === 1 && g?.type === "pan") {
          const w = toWorld(e.clientX, e.clientY);
          const hit = frameAt(w.x, w.y);
          set({ selectedId: hit?.id ?? null });
        }
      }
    }
    if (g?.type === "pinch" && remainingTouches === 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { type: "pan", sx: p.x, sy: p.y, cam: camRef.current };
      return;
    }
    if (pointers.current.size > 0 && (g?.type === "pan" || g?.type === "pinch")) return;

    if (g?.type === "draw" && g.points.length > 1) {
      const stroke: Stroke = { id: uid(), points: g.points, kind: g.kind };
      updateFrame(g.frameId, (f) => ({ strokes: [...f.strokes, stroke] }), true);
    } else if (g?.type === "frame") {
      createFrame(g);
    }
    gesture.current = null;
    setLive(null);
  }

  function createFrame(g: Extract<Gesture, { type: "frame" }>) {
    const w = Math.abs(g.x1 - g.x0);
    const h = Math.abs(g.y1 - g.y0);
    // Snap the rough rectangle to the closest device by shape; a tap uses the chosen device.
    let d: DeviceId = device;
    if (w > 40 && h > 40) {
      const ratio = h / w;
      d = (Object.keys(DEVICES) as DeviceId[]).reduce((best, k) =>
        Math.abs(Math.log(DEVICES[k].h / DEVICES[k].w / ratio)) <
        Math.abs(Math.log(DEVICES[best].h / DEVICES[best].w / ratio))
          ? k
          : best,
      );
    }
    const spec = DEVICES[d];
    const f = addFrame({
      name: "",
      device: d,
      x: Math.min(g.x0, g.x1),
      y: Math.min(g.y0, g.y1),
      w: spec.w,
      h: spec.h,
      surfaceId: surfaceId ?? undefined,
    });
    set({ selectedId: f.id });
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

  const spaceDown = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) spaceDown.current = true;
      if ((e.key === "Backspace" || e.key === "Delete") && !isTyping(e)) {
        const id = getState().selectedId;
        if (id) deleteFrame(id);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && (spaceDown.current = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
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
          />
        ))}
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
        {live?.type === "frame" && (
          <div
            className="frame-ghost"
            style={{
              left: Math.min(live.x0, live.x1),
              top: Math.min(live.y0, live.y1),
              width: Math.abs(live.x1 - live.x0),
              height: Math.abs(live.y1 - live.y0),
            }}
          />
        )}
      </div>
      {frames.length === 0 && (
        <div className="empty-hint">
          {surfaceId
            ? "Draw a frame here to sketch a variation of this surface."
            : "Pick the frame tool and drag a rectangle to start a surface. Tap to drop the selected device."}
        </div>
      )}
    </div>
  );
}

const clampZ = (z: number) => Math.min(3, Math.max(0.08, z));
const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
};
