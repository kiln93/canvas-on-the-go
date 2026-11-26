import type { CSSProperties } from "react";
import { uid, updateFrame, type Frame, type NoteTag } from "../store";
import { AddNote } from "./NoteCard";

export type NoteTarget = {
  frameId: string;
  /** Frame pixels. */
  box: { x: number; y: number; w: number; h: number };
  /** What was pressed, e.g. Button “Log habit”, when the frame could tell. */
  label?: string;
};

/** The small note box that opens where the pen was held down. */
/** The highlight on the part being noted. It lives in the zoomed canvas, so it stays on that part. */
export function NoteTargetBox({ frame: f, target }: { frame: Frame; target: NoteTarget }) {
  const { box } = target;
  return <div className="note-target" style={{ left: f.x + box.x, top: f.y + box.y, width: box.w, height: box.h }} />;
}

/**
 * The note box that opens where the pen was held down. It sits on the screen, not in the zoomed
 * canvas, so it is always full size and fully on screen, with its close button in reach.
 */
export function NoteComposer({
  frame: f,
  target,
  cam,
  viewport,
  onClose,
}: {
  frame: Frame;
  target: NoteTarget;
  cam: { x: number; y: number; z: number };
  viewport: { w: number; h: number };
  onClose: () => void;
}) {
  const { box } = target;
  const W = Math.min(340, viewport.w - 24);
  const H = 170; // about the box's height, to keep it clear of the toolbar
  const top0 = 120; // under the top bar and the focus bar
  const bottom0 = viewport.h - 100 - H; // above the toolbar
  const sx = cam.x + (f.x + box.x) * cam.z;
  const below = cam.y + (f.y + box.y + box.h) * cam.z + 8;
  const above = cam.y + (f.y + box.y) * cam.z - 8 - H;
  const top = below <= bottom0 ? Math.max(top0, below) : Math.max(top0, Math.min(bottom0, above));
  const style: CSSProperties = {
    left: Math.max(12, Math.min(viewport.w - W - 12, sx)),
    top,
    width: W,
  };
  const save = (text: string, tag: NoteTag) => {
    const region = { x: box.x / f.w, y: box.y / f.h, w: box.w / f.w, h: box.h / f.h };
    updateFrame(
      f.id,
      (cur) => ({
        notes: [
          ...cur.notes,
          {
            id: uid(),
            kind: "component" as const,
            text: target.label ? `${target.label}: ${text}` : text,
            tag,
            status: "accepted" as const,
            mine: true,
            region,
          },
        ],
      }),
      true,
    );
    onClose();
  };
  return (
    <>
      <div data-ui className="note-composer" style={style}>
        <div className="note-composer-head">
          <span>{target.label ?? "Note on this area"}</span>
          <button className="icon-btn" aria-label="Cancel" onClick={onClose}>
            ✕
          </button>
        </div>
        <AddNote onAdd={save} autoFocus placeholder="What should change here?" />
      </div>
    </>
  );
}
