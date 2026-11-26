import { useState } from "react";

const STEPS = [
  {
    title: "Welcome to Canvas on the go",
    body: "Sketch screens with your Pencil, confirm what they are, and get live, clickable React screens built from shadcn.",
  },
  {
    title: "Start a screen",
    body: "Tap New screen and pick iPhone, iPad or desktop. It opens as a full-screen sheet, ready to draw on.",
  },
  {
    title: "Sketch, then Suggest",
    body: "Draw boxes, lines and handwriting. An X in a box is an image, wavy lines are text, a circle is an avatar. Press and hold on any part to leave a note there. Tap Suggest and Claude labels what you drew.",
  },
  {
    title: "Confirm and generate",
    body: "Open Notes to accept, edit or dismiss each suggestion, or write or say your own. Then tap Generate. Done takes you back to the canvas.",
  },
  {
    title: "Mark it up",
    body: "Tap Mark up on a built screen and draw over it. Arrows move things, crossing out removes them, handwriting says what to do. Then tap Rebuild.",
  },
  {
    title: "Dive into a surface",
    body: "Tap Open surface to see its variations. Suggest variations lists states worth designing, with the cost, and builds only the ones you pick.",
  },
  {
    title: "Gestures",
    body: "On the canvas nothing draws: drag to move around, pinch to zoom, tap a screen to select it, hold one to move it. In a screen, the Pencil draws and two fingers scroll. Two-finger tap undoes.",
  },
];

export function Tutorial({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <div className="modal-scrim" data-ui>
      <div className="modal tutorial" role="dialog" aria-label="Tutorial">
        <div className="dots">
          {STEPS.map((_, n) => (
            <span key={n} className={n === i ? "on" : ""} />
          ))}
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onDone}>
            Skip
          </button>
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn ink" onClick={() => (last ? onDone() : setI(i + 1))}>
            {last ? "Start" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
