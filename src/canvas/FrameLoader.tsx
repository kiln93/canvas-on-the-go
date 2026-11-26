import { BorderBeam } from "border-beam";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import type { FrameProgress } from "../api";
import type { Frame } from "../store";

// The WebGL effects are big (img-fx brings three.js), so they load only when a frame first needs them.
const ImageGeneration = lazy(() => import("img-fx").then((m) => ({ default: m.ImageGeneration })));
const DistortionWave = lazy(() => import("distortion-waves").then((m) => ({ default: m.DistortionWave })));

const ACCENT = "#016a71";

type Phase = FrameProgress["phase"] | "loading";

const ORB: Record<Phase, OrbState> = {
  reading: "searching",
  planning: "connecting",
  thinking: "working",
  writing: "composing",
  reviewing: "solving",
  fixing: "weaving",
  rendering: "shaping",
  loading: "shaping",
};

const LABEL: Record<Phase, string> = {
  reading: "Reading your sketch",
  planning: "Planning the variations",
  thinking: "Planning the layout",
  writing: "Writing the screen",
  reviewing: "Reviewing against the design skills",
  fixing: "Fixing what the review found",
  rendering: "Drawing the screen",
  loading: "Loading the screen",
};

function useElapsed(since?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return "";
  const s = Math.max(0, Math.round((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The status card in the middle of a busy or loading frame: orb, what's happening, and how far along. */
export function FrameStatus({ phase, progress, scale }: { phase: Phase; progress?: FrameProgress; scale: number }) {
  const elapsed = useElapsed(progress?.startedAt);
  const pct = progress?.fraction != null ? Math.round(progress.fraction * 100) : null;
  return (
    <div className="frame-status" style={{ transform: `scale(${scale})` }} role="status" aria-live="polite">
      <ThinkingOrb state={ORB[phase]} size={32} theme="light" color={ACCENT} />
      <div className="frame-status-text">
        <span>
          {LABEL[phase]}
          {pct != null && pct < 100 && phase !== "rendering" ? ` · ${pct}%` : "…"}
        </span>
        {elapsed && <span className="muted small">{elapsed}</span>}
        {pct != null && phase !== "rendering" && (
          <span className="frame-status-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
    </div>
  );
}

/** A beam of light running around the frame's edge while Claude works on it. */
export function FrameBeam({ frame: f }: { frame: Frame }) {
  return (
    <BorderBeam
      className="frame-beam"
      style={{ position: "absolute", left: f.x, top: f.y, pointerEvents: "none" }}
      size="md"
      theme="light"
      borderRadius={4}
      duration={2.4}
    >
      <div style={{ width: f.w, height: f.h, borderRadius: 4 }} />
    </BorderBeam>
  );
}

/** A churning pixel mosaic that fills the frame while the screen is being written. */
// The shader runs at a third of the frame's size and is scaled up: it's a pixel mosaic, so it looks
// the same, and phones draw a ninth of the pixels.
const MOSAIC_SCALE = 3;
export function FrameMosaic({ w, h }: { w: number; h: number }) {
  return (
    <Suspense fallback={null}>
      <div className="frame-mosaic" style={{ width: w / MOSAIC_SCALE, height: h / MOSAIC_SCALE, transform: `scale(${MOSAIC_SCALE})` }}>
        <ImageGeneration preset="sweep-gradient" theme="light" strength={0.6} cardBg="#ffffff">
          <div style={{ width: w / MOSAIC_SCALE, height: h / MOSAIC_SCALE }} />
        </ImageGeneration>
      </div>
    </Suspense>
  );
}

/**
 * When a new screen is ready, a wave washes the sketch away and leaves the live screen behind.
 * The wave can't picture the iframe itself, so the view it leaves behind is see-through.
 */
export function RevealWave({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    // Give the wave a moment to take its picture before it runs.
    const t = setTimeout(() => setRevealed(true), 60);
    const safety = setTimeout(onDone, 4000); // never leave the overlay stuck
    return () => (clearTimeout(t), clearTimeout(safety));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Suspense fallback={null}>
      <DistortionWave
        className="frame-wave"
        revealed={revealed}
        revealedContent={<div style={{ width: "100%", height: "100%" }} />}
        type="vertical"
        palette="colorful"
        onFinish={onDone}
      >
        {children}
      </DistortionWave>
    </Suspense>
  );
}
