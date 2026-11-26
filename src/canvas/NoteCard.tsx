import { useRef, useState, type CSSProperties } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { runGenerate, runSuggest } from "../api";
import { uid, updateFrame, type Frame, type NoteItem } from "../store";

export function NoteCard({ frame: f, style }: { frame: Frame; style: CSSProperties }) {
  const visible = f.notes.filter((n) => n.status !== "dismissed");
  const pending = visible.filter((n) => n.status === "pending").length;
  const accepted = visible.filter((n) => n.status === "accepted").length;
  const setNote = (id: string, patch: Partial<NoteItem>) =>
    updateFrame(f.id, (cur) => ({ notes: cur.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  // Callout numbers on the sketch count only notes that have a region.
  let callout = 0;

  return (
    <div data-ui className="note-card" style={style}>
      <div className="note-head">
        <span>Notes</span>
        {pending > 0 && (
          <button
            className="link"
            onClick={() =>
              updateFrame(f.id, (cur) => ({
                notes: cur.notes.map((n) => (n.status === "pending" ? { ...n, status: "accepted" } : n)),
              }))
            }
          >
            Accept all
          </button>
        )}
      </div>
      {visible.length === 0 && (
        <p className="muted small note-empty">
          {f.busy ? (
            <>
              <ThinkingOrb state="searching" size={20} theme="light" color="#016a71" />
              Reading your sketch…
            </>
          ) : (
            "Tap “Done sketching” and I'll suggest what each part is. You can also write or say notes below."
          )}
        </p>
      )}
      <ol className="notes">
        {visible.map((n) => {
          const num = !f.code && n.region ? ++callout : null;
          return (
            <li key={n.id} className={`note ${n.status}`}>
              <span className="num">{num ?? "•"}</span>
              <NoteText text={n.text} onChange={(text) => setNote(n.id, { text, status: "accepted" })} />
              {n.status === "pending" ? (
                <span className="note-btns">
                  <button aria-label="Accept" className="icon-btn ok" onClick={() => setNote(n.id, { status: "accepted" })}>
                    ✓
                  </button>
                  <button aria-label="Dismiss" className="icon-btn" onClick={() => setNote(n.id, { status: "dismissed" })}>
                    ✕
                  </button>
                </span>
              ) : (
                <span className="note-btns">
                  <button aria-label="Remove" className="icon-btn" onClick={() => setNote(n.id, { status: "dismissed" })}>
                    ✕
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <AddNote
        onAdd={(text) =>
          updateFrame(f.id, (cur) => ({
            notes: [...cur.notes, { id: uid(), kind: "component", text, status: "accepted", mine: true, region: null }],
          }))
        }
      />
      <div className="note-foot">
        {f.code ? (
          <>
            <button className="btn" disabled={!!f.busy} onClick={() => runSuggest(f.id)}>
              Review markups
            </button>
            <button className="btn ink" disabled={!!f.busy} onClick={() => runGenerate(f.id)}>
              Rebuild
            </button>
          </>
        ) : (
          <button className="btn ink wide" disabled={!!f.busy || (accepted === 0 && !f.strokes.length)} onClick={() => runGenerate(f.id)}>
            Generate screen{accepted ? ` from ${accepted} note${accepted > 1 ? "s" : ""}` : ""}
          </button>
        )}
      </div>
    </div>
  );
}

function NoteText({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  if (!editing)
    return (
      <span className="note-text" onClick={() => (setValue(text), setEditing(true))}>
        {text}
      </span>
    );
  return (
    <textarea
      className="note-edit"
      autoFocus
      value={value}
      rows={2}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (value.trim() && value !== text) onChange(value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}

// Safari and Chrome ship speech recognition under a prefix; it's optional.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

// iPadOS Safari's recognizer is unreliable in continuous mode: it often stops at once or never
// returns results. One utterance per tap works; each tap appends to what's already typed.
const IS_APPLE_TOUCH = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const STANDALONE = window.matchMedia?.("(display-mode: standalone)").matches;

function micError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return STANDALONE
        ? "Dictation doesn't work when the app is opened from the Home Screen. Open it in Safari, or use the mic key on the keyboard."
        : "The mic is blocked. Allow microphone access for this site in Safari and turn on Dictation (Settings › General › Keyboard), or use the keyboard's mic key.";
    case "no-speech":
      return "I didn't hear anything. Tap the mic and speak again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Dictation needs an internet connection.";
    case "aborted":
      return "";
    default:
      return `Dictation stopped (${code}). You can use the mic key on the keyboard instead.`;
  }
}
const SpeechRecognitionCtor: (new () => Recognition) | undefined =
  (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
    .SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

function AddNote({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);

  const toggleMic = () => {
    if (!SpeechRecognitionCtor) return;
    if (listening) return rec.current?.stop();
    setError("");
    const r = new SpeechRecognitionCtor();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = !IS_APPLE_TOUCH;
    const before = text.trim() ? text.trim() + " " : "";
    let heard = false;
    r.onresult = (e) => {
      heard = true;
      const said = Array.from(e.results)
        .map((res) => res[0].transcript)
        .join("");
      setText(before + said.trim());
    };
    r.onerror = (e) => setError(micError(e.error));
    r.onend = () => {
      setListening(false);
      if (!heard) setError((cur) => cur || micError("no-speech"));
    };
    rec.current = r;
    try {
      r.start(); // must run inside the tap, or Safari refuses
      setListening(true);
    } catch (e) {
      setError(micError((e as Error).name === "NotAllowedError" ? "not-allowed" : "other"));
    }
  };

  return (
    <>
      <form
        className="add-note"
        onSubmit={(e) => {
          e.preventDefault();
          rec.current?.stop();
          if (text.trim()) onAdd(text.trim());
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={listening ? "Listening…" : "Write or say a note…"}
          enterKeyHint="done"
        />
        {SpeechRecognitionCtor && (
          <button
            type="button"
            className={`icon-btn mic ${listening ? "on" : ""}`}
            onClick={toggleMic}
            aria-label={listening ? "Stop dictation" : "Dictate a note"}
          >
            {listening ? "■" : <MicIcon />}
          </button>
        )}
      </form>
      {error && <p className="mic-error">{error}</p>}
    </>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </svg>
  );
}
