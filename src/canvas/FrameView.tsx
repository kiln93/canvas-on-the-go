import { memo, useEffect, useMemo, useRef, useState } from "react";
import { runGenerate, runSuggest, runVariations, setProgress, useProgress } from "../api";
import { frameHtml } from "../runtime/frameHtml";
import { addFrame, deleteFrame, DEVICES, getState, set, updateFrame, type Frame } from "../store";
import { strokePath } from "./ink";
import { FrameBeam, FrameMosaic, FrameStatus, RevealWave } from "./FrameLoader";
import { NoteCard } from "./NoteCard";
import { registerFrame } from "./pick";

export const FrameView = memo(function FrameView(props: {
  frame: Frame;
  selected: boolean;
  inSurface: boolean;
  zoom: number;
  onPlay: () => void;
  /** Open in the focused drawing view: the canvas's focus bar replaces the buttons under the frame. */
  focused?: boolean;
}) {
  const { frame: f, selected, inSurface } = props;
  const html = useMemo(() => (f.code ? frameHtml(f.code) : ""), [f.code]);
  const sketch = f.strokes.filter((s) => s.kind === "sketch");
  const markups = f.strokes.filter((s) => s.kind === "markup");
  const hasNotes = f.notes.some((n) => n.status !== "dismissed");
  const [variationOpen, setVariationOpen] = useState(false);
  const ui = 1 / Math.max(props.zoom, 0.35); // keep controls readable when zoomed out
  const progress = useProgress(f.id);

  // A live screen takes a moment to boot in its iframe; it says when it has drawn (or failed).
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!html) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "frame-ready" || e.data?.type === "frame-error") setReady(true);
    };
    window.addEventListener("message", onMessage);
    const fallback = setTimeout(() => setReady(true), 20000); // never hide a screen behind a loader for good
    return () => (window.removeEventListener("message", onMessage), clearTimeout(fallback));
  }, [html]);

  // A screen that just finished generating gets the reveal wave once it has drawn.
  const revealing = progress?.phase === "rendering" && ready;
  const loadingScreen = !!f.code && !ready && !f.busy;
  const statusPhase = f.busy
    ? (progress?.phase ?? (f.busy === "suggesting" ? "reading" : f.busy === "planning" ? "planning" : "thinking"))
    : loadingScreen || (progress?.phase === "rendering" && !ready)
      ? progress?.phase === "rendering"
        ? "rendering"
        : "loading"
      : null;
  const sketchLayer = (ghost: boolean) =>
    sketch.length > 0 && (
      <svg className={`ink-layer ${ghost ? "ghost" : ""}`} width={f.w} height={f.h}>
        {sketch.map((s) => (
          <path key={s.id} d={strokePath(s)} />
        ))}
      </svg>
    );

  return (
    <>
      <div className={`frame ${selected ? "selected" : ""}`} style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
        {!props.focused && (
          <div className="frame-label" style={{ transform: `scale(${ui})` }}>
            <span>{f.name || (f.primary ? "Untitled surface" : "Variation")}</span>
            <span className="muted">{DEVICES[f.device].label}</span>
            {f.code && !f.approved && <span className="pill">Review</span>}
          </div>
        )}
        {f.code && (
          <iframe
            ref={(el) => {
              iframeRef.current = el;
              registerFrame(f.id, el);
            }}
            title={f.name || "frame"}
            srcDoc={html}
            sandbox="allow-scripts"
            className="frame-live"
            style={{ opacity: ready && progress?.phase !== "rendering" ? 1 : revealing ? 1 : 0 }}
          />
        )}
        {(!f.code || f.showSketch) && !revealing && sketchLayer(!!f.code && ready)}
        {markups.length > 0 && (
          <svg className="ink-layer markup" width={f.w} height={f.h}>
            {markups.map((s) => (
              <path key={s.id} d={strokePath(s)} />
            ))}
          </svg>
        )}
        {!f.busy &&
          f.notes
            .filter((n) => (n.status === "pending" || n.status === "accepted") && n.region)
            .map((n, i) => (
              <div
                key={n.id}
                className={`callout ${n.status}`}
                style={{
                  left: n.region!.x * f.w,
                  top: n.region!.y * f.h,
                  width: n.region!.w * f.w,
                  height: n.region!.h * f.h,
                }}
              >
                <b>{i + 1}</b>
              </div>
            ))}
        {f.busy === "generating" && (progress?.phase === "writing" || progress?.phase === "fixing") && (
          <FrameMosaic w={f.w} h={f.h} />
        )}
        {revealing && (
          <RevealWave onDone={() => setProgress(f.id, undefined)}>
            <div className="frame-wave-view">{sketchLayer(false)}</div>
          </RevealWave>
        )}
        {statusPhase && (
          <div className={`frame-busy ${f.busy === "suggesting" || f.busy === "planning" ? "light" : ""}`}>
            <FrameStatus phase={statusPhase} progress={progress} scale={Math.min(ui, 2.5)} />
          </div>
        )}
      </div>
      {f.busy && <FrameBeam frame={f} />}

      {!props.focused && (
      <div
        data-ui
        className="frame-actions"
        // Wrap within the frame's width, so zoomed-out buttons never run under the next frame's.
        style={{ left: f.x, top: f.y + f.h + 12 * ui, transform: `scale(${ui})`, maxWidth: Math.max(160, f.w / ui) }}
      >
        <button
          className="btn"
          onClick={() => window.dispatchEvent(new CustomEvent("cotg:focus", { detail: f.id }))}
          title="Zoom in and pick up the pen"
        >
          ✎ {f.code ? "Mark up" : "Draw"}
        </button>
        {!f.code && (
          <button className="btn ink" disabled={!!f.busy || !sketch.length} onClick={() => runSuggest(f.id)} title="Done sketching">
            ✓ Done sketching
          </button>
        )}
        {f.code && !f.approved && (
          <button
            className="btn ink"
            onClick={() =>
              updateFrame(f.id, (cur) => ({ approved: true, strokes: cur.strokes.filter((s) => s.kind !== "sketch") }), true)
            }
          >
            Approve
          </button>
        )}
        {f.code && markups.length > 0 && (
          <button className="btn ink" disabled={!!f.busy} onClick={() => runGenerate(f.id)}>
            Apply markups
          </button>
        )}
        {f.code && (
          <button className="btn" onClick={props.onPlay}>
            ▶ Play
          </button>
        )}
        {f.code && !f.approved && sketch.length > 0 && (
          <button className="btn ghost" onClick={() => updateFrame(f.id, { showSketch: !f.showSketch })}>
            {f.showSketch ? "Hide sketch" : "Show sketch"}
          </button>
        )}
        {f.primary && !inSurface && (
          <button className="btn" onClick={() => set({ surfaceId: f.surfaceId, selectedId: f.id })}>
            Open surface →
          </button>
        )}
        {inSurface && f.code && (
          <button className="btn" onClick={() => setVariationOpen((v) => !v)}>
            + Variation
          </button>
        )}
        {inSurface && f.primary && f.code && (
          <button className="btn ghost" disabled={!!f.busy} onClick={() => runVariations(f.id)} title="Ask for more states and edge cases">
            Suggest more states
          </button>
        )}
        {f.versions.length > 1 && (
          <button
            className="btn ghost"
            title="Go back to the previous version"
            onClick={() =>
              updateFrame(
                f.id,
                (cur) => {
                  const versions = cur.versions.slice(0, -1);
                  const prev = versions[versions.length - 1];
                  return { versions, code: prev.code, summary: prev.summary };
                },
                true,
              )
            }
          >
            Undo version
          </button>
        )}
        <button className="btn ghost danger" onClick={() => deleteFrame(f.id)} title={f.primary ? "Delete surface" : "Delete frame"}>
          Delete
        </button>
        {variationOpen && <VariationInput frame={f} onDone={() => setVariationOpen(false)} />}
        {f.error && (
          <div className="frame-error" role="alert">
            {f.error}
            <button className="link" onClick={() => updateFrame(f.id, { error: undefined })}>
              Dismiss
            </button>
          </div>
        )}
        {f.summary && f.code && !f.error && (
          <div className="frame-summary">
            {f.summary}
            {f.review && (
              <details className="review">
                <summary>
                  {f.review.verdict === "fix"
                    ? `Reviewed: fixed ${f.review.findings.length} thing${f.review.findings.length === 1 ? "" : "s"}`
                    : f.review.verdict === "ship"
                      ? "Reviewed: nothing to fix"
                      : "Review didn't finish; this is the first build"}
                </summary>
                {f.review.findings.length > 0 && (
                  <ul>
                    {f.review.findings.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                )}
              </details>
            )}
          </div>
        )}
      </div>
      )}
      {props.focused && f.error && (
        <div data-ui className="frame-actions" style={{ left: f.x, top: f.y + f.h + 12 * ui, transform: `scale(${ui})` }}>
          <div className="frame-error" role="alert">
            {f.error}
            <button className="link" onClick={() => updateFrame(f.id, { error: undefined })}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* In the focused view the notes live in a panel beside the drawing instead. */}
      {!props.focused && (hasNotes || (!f.code && sketch.length > 0)) && (
        <>
          <svg className="tether" style={{ left: f.x + f.w, top: f.y + 40, width: 32, height: 2 }}>
            <line x1="0" y1="1" x2="32" y2="1" />
          </svg>
          <NoteCard frame={f} style={{ left: f.x + f.w + 32, top: f.y, transform: `scale(${Math.min(ui, 2)})` }} />
        </>
      )}
    </>
  );
});

const VARIATION_IDEAS = ["Empty state", "Loading", "Error", "Dark mode", "Success"];

function VariationInput({ frame, onDone }: { frame: Frame; onDone: () => void }) {
  const [text, setText] = useState("");
  const make = (instruction: string) => {
    if (!instruction.trim()) return;
    const siblings = getState().project.frames.filter((x) => x.surfaceId === frame.surfaceId);
    const right = Math.max(...siblings.map((x) => x.x + x.w));
    const v = addFrame({
      name: instruction.trim(),
      device: frame.device,
      x: right + 720, // leave room for the note card beside the previous frame
      y: frame.y,
      w: frame.w,
      h: frame.h,
      surfaceId: frame.surfaceId,
    });
    set({ selectedId: v.id });
    runGenerate(v.id, `Make the "${instruction.trim()}" variation of this screen.`, frame.code);
    onDone();
  };
  return (
    <div className="variation">
      <div className="chips">
        {VARIATION_IDEAS.map((i) => (
          <button key={i} className="chip" onClick={() => make(i)}>
            {i}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          make(text);
        }}
      >
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Or describe a scenario…" />
      </form>
    </div>
  );
}
