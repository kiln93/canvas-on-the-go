import { useState } from "react";

const STEPS = [
  {
    title: "Welcome to Canvas on the go",
    body: "Sketch screens with your Pencil, confirm what they are, and get live, clickable React screens built from shadcn.",
  },
  {
    title: "Start a surface",
    body: "Pick the frame tool and drag a rough rectangle. It snaps to iPhone, iPad or desktop. The pen tool turns on right after, so you can sketch inside.",
  },
  {
    title: "Sketch, then tap ✓",
    body: "Draw boxes, lines and handwriting. An X in a box is an image, wavy lines are text, a circle is an avatar. Tap “Done sketching” and suggestions appear in the note beside the frame.",
  },
  {
    title: "Confirm and generate",
    body: "Accept, edit or dismiss each suggestion, or write or say your own. Then tap Generate. The sketch stays until you approve the result.",
  },
  {
    title: "Mark it up",
    body: "Draw over a generated screen to change it. Arrows move things, crossing out removes them, handwriting says what to do. Tap “Apply markups”.",
  },
  {
    title: "Dive into a surface",
    body: "Double-tap a surface, or tap “Open surface”, to see all its variations: empty, loading, error and anything you describe. Overview takes you back.",
  },
  {
    title: "Gestures",
    body: "Pencil draws. One finger pans, two fingers pinch to zoom. Two-finger tap undoes, three-finger tap redoes. On a keyboard: V, P, E, F switch tools.",
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
