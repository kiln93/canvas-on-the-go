import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { keyboardOnPencilTap, primeKeyboard } from "./keyboard";
import { ThinkingOrb } from "thinking-orbs";
import { buildInputs, COST_ESTIMATE, dollars, NOTHING_TO_BUILD, runGenerate, runSuggest, surfaceJob } from "../api";
import { NOTE_TAGS, uid, updateFrame, useStore, type Frame, type NoteItem, type NoteTag } from "../store";
import { shrinkImage } from "../images";
import { MAX_REFS, openMobbin, suggestRefs } from "./MobbinPicker";

export function NoteCard({ frame: f, style }: { frame: Frame; style: CSSProperties }) {
  const visible = f.notes.filter((n) => n.status === "pending" || n.status === "accepted");
  const history = f.notes.filter((n) => n.status === "applied").sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0));
  const [historyOpen, setHistoryOpen] = useState(false);
  const pending = visible.filter((n) => n.status === "pending").length;
  const accepted = visible.filter((n) => n.status === "accepted").length;
  const setNote = (id: string, patch: Partial<NoteItem>) =>
    updateFrame(f.id, (cur) => ({ notes: cur.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  // Callout numbers on the sketch count only notes that have a region.
  let callout = 0;

  const inputs = buildInputs(f);
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
      <JobField frame={f} />
      {f.assumed && visible.some((n) => n.status === "pending") && (
        <p className="muted small note-assumed">
          <span>Assumed:</span> {f.assumed}
        </p>
      )}
      {visible.length === 0 && (
        <p className="muted small note-empty">
          {f.busy === "suggesting" ? (
            <>
              <ThinkingOrb state="searching" size={20} theme="light" color="#016a71" />
              Reading your sketch…
            </>
          ) : f.code ? (
            "Tap any part of the screen to leave a note on it, or write one below."
          ) : (
            "Tap “Done sketching” and I'll suggest what each part is. You can also press and hold the pen on any part, or write or say a note below."
          )}
        </p>
      )}
      <ol className="notes">
        {visible.map((n) => {
          const num = n.region ? ++callout : null;
          return (
            <li key={n.id} className={`note ${n.status}`}>
              <span className="num">{num ?? "•"}</span>
              {(n.tag || n.kind === "copy") && (
                <span className={`tag tag-${n.tag ?? "copy"}`}>{NOTE_TAGS.find((t) => t.id === (n.tag ?? "copy"))?.label}</span>
              )}
              <span className="note-body">
                <NoteText text={n.text} onChange={(text) => setNote(n.id, { text, status: "accepted", skipped: undefined })} />
                {n.status === "pending" && !!n.options?.length && (
                  <span className="note-options" role="group" aria-label="Answers">
                    {n.options.map((o) => (
                      <button
                        key={o}
                        className="chip"
                        onClick={() => setNote(n.id, { text: `${n.text.replace(/\s+$/, "")} ${o}.`.replace(/\.\.$/, "."), status: "accepted", options: undefined })}
                      >
                        {o}
                      </button>
                    ))}
                  </span>
                )}
                {n.skipped && <span className="note-skipped">Not built yet: {n.skipped}</span>}
              </span>
              {n.status === "pending" ? (
                <span className="note-btns">
                  {/* A question with answers is accepted by tapping an answer. */}
                  {!n.options?.length && (
                    <button aria-label="Accept" className="icon-btn ok" onClick={() => setNote(n.id, { status: "accepted" })}>
                      ✓
                    </button>
                  )}
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
        onAdd={(text, tag) =>
          updateFrame(f.id, (cur) => ({
            notes: [...cur.notes, { id: uid(), kind: "component", text, tag, status: "accepted", mine: true, region: null }],
          }))
        }
      />
      <References frame={f} />
      {history.length > 0 && (
        <div className="note-history">
          <button className="history-toggle" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}>
            <span className={`chev ${historyOpen ? "open" : ""}`}>›</span>
            History · {history.length} note{history.length > 1 ? "s" : ""} built in
          </button>
          {historyOpen && (
            <ul className="history-list">
              {history.map((n) => (
                <li key={n.id}>
                  <span className="note-body">
                    <span className="note-text">{n.text}</span>
                    {n.change && <span className="note-change">{n.change}</span>}
                  </span>
                  <button
                    className="link"
                    title="Use this note again in the next build"
                    onClick={() => setNote(n.id, { status: "accepted", appliedAt: undefined })}
                  >
                    Reuse
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="note-foot">
        {f.code ? (
          <>
            {!inputs.any && !f.busy && <p className="muted small note-foot-hint">{NOTHING_TO_BUILD}</p>}
            {inputs.markups && (
              <button className="btn" disabled={!!f.busy} onClick={() => runSuggest(f.id)}>
                Review markups
              </button>
            )}
            <button className="btn ink" disabled={!!f.busy || !inputs.any} onClick={() => runGenerate(f.id)}>
              {inputs.refs && !inputs.notes && !inputs.markups ? "Rebuild with references" : "Rebuild"} · {dollars(COST_ESTIMATE.variation)}
            </button>
          </>
        ) : (
          <button className="btn ink wide" disabled={!!f.busy || (accepted === 0 && !f.strokes.length)} onClick={() => runGenerate(f.id)}>
            Generate screen{accepted ? ` from ${accepted} note${accepted > 1 ? "s" : ""}` : ""} · {dollars(f.code ? COST_ESTIMATE.variation : COST_ESTIMATE.screen)}
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
      <span className="note-text" onClick={() => (primeKeyboard(), setValue(text), setEditing(true))}>
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

export function AddNote({
  onAdd,
  autoFocus,
  placeholder = "Write or say a note…",
}: {
  onAdd: (text: string, tag: NoteTag) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [tag, setTag] = useState<NoteTag>("ui");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => (input.current ? keyboardOnPencilTap(input.current) : undefined), []);

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
      <div className="tag-picker" role="radiogroup" aria-label="What is this note about?">
        {NOTE_TAGS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={tag === t.id}
            className={`tag tag-${t.id} ${tag === t.id ? "on" : ""}`}
            onClick={() => setTag(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        className="add-note"
        onSubmit={(e) => {
          e.preventDefault();
          rec.current?.stop();
          if (text.trim()) onAdd(text.trim(), tag);
          setText("");
        }}
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={listening ? "Listening…" : placeholder}
          autoFocus={autoFocus}
          enterKeyHint="send"
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
        <button type="submit" className="icon-btn send" disabled={!text.trim()} aria-label="Add note">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
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

/** Screenshots, photos or sketches the designer wants this screen to draw on, each with what to take from it. */
function References({ frame: f }: { frame: Frame }) {
  const refs = f.refs ?? [];
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  // A screen with no references gets the top Mobbin results for it, once, when it's opened to draw;
  // the designer edits from there. (Not on the canvas, which would search for every screen at once.)
  const focused = useStore((s) => s.focusId === f.id);
  useEffect(() => {
    if (!focused || f.refsSuggested || refs.length) return;
    let live = true;
    setSuggesting(true);
    suggestRefs(f.id).then((msg) => {
      if (!live) return;
      setSuggesting(false);
      setError(msg);
    });
    return () => {
      live = false;
    };
  }, [f.id, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (files: FileList | null) => {
    setError("");
    const picked = [...(files ?? [])].slice(0, MAX_REFS - refs.length);
    try {
      const data = await Promise.all(picked.map((file) => shrinkImage(file)));
      updateFrame(f.id, (cur) => ({
        refs: [...(cur.refs ?? []), ...data.map((d) => ({ id: uid(), data: d, note: "" }))].slice(0, MAX_REFS),
      }));
    } catch {
      setError("That file couldn't be read as an image.");
    }
  };
  const setRef = (id: string, note: string) =>
    updateFrame(f.id, (cur) => ({ refs: (cur.refs ?? []).map((r) => (r.id === id ? { ...r, note } : r)) }));
  const remove = (id: string) => updateFrame(f.id, (cur) => ({ refs: (cur.refs ?? []).filter((r) => r.id !== id) }));
  return (
    <div className="refs">
      <div className="refs-head">
        <span>References</span>
        <span className="muted small">{refs.length ? `${refs.length} of ${MAX_REFS} · sent with every build` : "Optional"}</span>
      </div>
      {refs.some((r) => r.suggested) && (
        <p className="muted small refs-hint">Suggested from Mobbin for this screen. Remove any you don't want, or tap Find on Mobbin to swap them.</p>
      )}
      {suggesting && (
        <p className="muted small mobbin-status">
          <ThinkingOrb state="searching" size={20} theme="light" color="#016a71" /> Finding references on Mobbin…
        </p>
      )}
      {refs.map((r) => (
        <div key={r.id} className={`ref-row ${r.suggested ? "suggested" : ""}`}>
          <button className="ref-thumb" onClick={() => setViewing(r.id)} aria-label={`View ${r.title ?? "reference"}`}>
            <img src={r.data ? `data:image/jpeg;base64,${r.data}` : r.url} alt="" referrerPolicy="no-referrer" />
          </button>
          <input
            value={r.note}
            onChange={(e) => setRef(r.id, e.target.value)}
            placeholder={r.suggested && r.title ? `Suggested: ${r.title}` : "What to take from it, e.g. this card layout"}
            aria-label="What to take from this reference"
          />
          <button className="icon-btn" aria-label="Remove reference" onClick={() => remove(r.id)}>
            ✕
          </button>
        </div>
      ))}
      <div className="ref-adds">
        {refs.length < MAX_REFS ? (
          <label className="ref-add">
            + Screenshot or photo
            <input type="file" accept="image/*" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
          </label>
        ) : (
          <span className="ref-add ref-full">Full · remove one to add a photo</span>
        )}
        <button className="ref-add" onClick={() => openMobbin(f.id)}>
          {refs.length ? "Change on Mobbin" : "Find on Mobbin"}
        </button>
      </div>
      {viewing && <RefViewer frame={f} id={viewing} onClose={() => setViewing(null)} onRemove={(id) => (remove(id), setViewing(null))} />}
      {error && <p className="small note-skipped">{error}</p>}
    </div>
  );
}

/** A reference shown large, with what to take from it and where it came from. */
function RefViewer({ frame: f, id, onClose, onRemove }: { frame: Frame; id: string; onClose: () => void; onRemove: (id: string) => void }) {
  const r = f.refs?.find((x) => x.id === id);
  if (!r) return null;
  return createPortal(
    <div className="modal-scrim" data-ui onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ref-viewer" role="dialog" aria-label="Reference">
        <div className="mobbin-head">
          <h2>{r.title ?? "Reference"}</h2>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <img src={r.data ? `data:image/jpeg;base64,${r.data}` : r.url} alt={r.title ?? "Reference"} referrerPolicy="no-referrer" />
        {r.note && <p className="small">Take from it: {r.note}</p>}
        <div className="modal-actions">
          <button className="btn ghost danger" onClick={() => onRemove(r.id)}>
            Remove
          </button>
          {r.link && (
            <a className="btn" href={r.link} target="_blank" rel="noreferrer">
              Open on Mobbin
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The screen's one-line job. Claude proposes it on "Done sketching"; the designer's words always win. */
function JobField({ frame: f }: { frame: Frame }) {
  const job = surfaceJob(f);
  const [text, setText] = useState(job);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setText(job), [job]);
  useEffect(() => (input.current ? keyboardOnPencilTap(input.current) : undefined), []);
  const save = () => {
    const t = text.trim();
    if (t !== job) updateFrame(f.surfaceId, { job: t || undefined });
  };
  return (
    <label className="job-field">
      <span>Job</span>
      <input
        ref={input}
        value={text}
        placeholder="What is this screen for?"
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
      />
    </label>
  );
}
