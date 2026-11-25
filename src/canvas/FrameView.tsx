import { memo, useMemo, useState } from "react";
import { runGenerate, runSuggest } from "../api";
import { frameHtml } from "../runtime/frameHtml";
import { addFrame, deleteFrame, DEVICES, getState, set, updateFrame, type Frame } from "../store";
import { strokePath } from "./ink";
import { NoteCard } from "./NoteCard";

export const FrameView = memo(function FrameView(props: {
  frame: Frame;
  selected: boolean;
  inSurface: boolean;
  zoom: number;
  onPlay: () => void;
}) {
  const { frame: f, selected, inSurface } = props;
  const html = useMemo(() => (f.code ? frameHtml(f.code) : ""), [f.code]);
  const sketch = f.strokes.filter((s) => s.kind === "sketch");
  const markups = f.strokes.filter((s) => s.kind === "markup");
  const hasNotes = f.notes.some((n) => n.status !== "dismissed");
  const [variationOpen, setVariationOpen] = useState(false);
  const ui = 1 / Math.max(props.zoom, 0.35); // keep controls readable when zoomed out

  return (
    <>
      <div className={`frame ${selected ? "selected" : ""}`} style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
        <div className="frame-label" style={{ transform: `scale(${ui})` }}>
          <span>{f.name || (f.primary ? "Untitled surface" : "Variation")}</span>
          <span className="muted">{DEVICES[f.device].label}</span>
          {f.code && !f.approved && <span className="pill">Review</span>}
        </div>
        {f.code && <iframe title={f.name || "frame"} srcDoc={html} sandbox="allow-scripts" className="frame-live" />}
        {(!f.code || f.showSketch) && sketch.length > 0 && (
          <svg className={`ink-layer ${f.code ? "ghost" : ""}`} width={f.w} height={f.h}>
            {sketch.map((s) => (
              <path key={s.id} d={strokePath(s)} />
            ))}
          </svg>
        )}
        {markups.length > 0 && (
          <svg className="ink-layer markup" width={f.w} height={f.h}>
            {markups.map((s) => (
              <path key={s.id} d={strokePath(s)} />
            ))}
          </svg>
        )}
        {!f.code &&
          f.notes
            .filter((n) => n.status !== "dismissed" && n.region)
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
        {f.busy && (
          <div className="frame-busy">
            <span className="spinner" />
            {f.busy === "suggesting" ? "Reading your sketch…" : "Building the screen…"}
          </div>
        )}
      </div>

      <div
        data-ui
        className="frame-actions"
        style={{ left: f.x, top: f.y + f.h + 12 * ui, transform: `scale(${ui})` }}
      >
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
        {f.summary && f.code && !f.error && <div className="frame-summary">{f.summary}</div>}
      </div>

      {(hasNotes || (!f.code && sketch.length > 0)) && (
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
