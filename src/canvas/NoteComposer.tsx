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
export function NoteComposer({ frame: f, target, scale, onClose }: { frame: Frame; target: NoteTarget; scale: number; onClose: () => void }) {
  const { box } = target;
  const style: CSSProperties = {
    left: f.x + box.x,
    top: f.y + box.y + box.h + 8,
    transform: `scale(${scale})`,
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
      <div className="note-target" style={{ left: f.x + box.x, top: f.y + box.y, width: box.w, height: box.h }} />
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
