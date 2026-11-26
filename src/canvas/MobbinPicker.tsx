import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ThinkingOrb } from "thinking-orbs";
import { connectMobbin, disconnectMobbin, mobbinConnected, searchMobbin } from "../mobbin";
import type { Frame } from "../store";
import { getState, set, uid, updateFrame, useStore } from "../store";
import type { MobbinScreen } from "../../server/mobbin";

export const MAX_REFS = 4;

/** Search Mobbin's real app screens and pick some as this screen's references (kept as links only). */
export function MobbinPicker() {
  const frameId = useStore((s) => s.mobbinFor);
  const notice = useStore((s) => s.mobbinNotice);
  const f = useStore((s) => s.project.frames.find((x) => x.id === s.mobbinFor));
  const [connected, setConnected] = useState(mobbinConnected());
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"screens" | "flows">("screens");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<MobbinScreen[] | null>(null);
  const [said, setSaid] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  // Start from the screen's own name, so a search is one tap away.
  useEffect(() => {
    if (!f) return;
    setConnected(mobbinConnected());
    setQuery(f.name && !/^untitled/i.test(f.name) ? f.name : "");
    setResults(null);
    setPicked([]);
    setError(notice ?? "");
  }, [frameId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return null;
  // Suggested references make way for ones the designer picks.
  const room = MAX_REFS - (f.refs ?? []).filter((r) => !r.suggested).length;
  const close = () => set({ mobbinFor: null, mobbinNotice: undefined });

  const run = async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError("");
    setSaid("");
    try {
      const out = await searchMobbin(query.trim(), kind);
      setResults(out.screens);
      setSaid(out.said ?? "");
      setPicked([]);
    } catch (e) {
      setError((e as Error).message);
      setConnected(mobbinConnected());
    } finally {
      setBusy(false);
    }
  };
  const toggle = (img: string) =>
    setPicked((p) => (p.includes(img) ? p.filter((x) => x !== img) : p.length < room ? [...p, img] : p));
  const add = () => {
    const chosen = (results ?? []).filter((r) => picked.includes(r.image));
    updateFrame(f.id, (cur) => ({
      refs: [
        ...(cur.refs ?? []).filter((r) => !r.suggested),
        ...chosen.map((r) => ({ id: uid(), url: r.image, link: r.link, title: r.title, note: "" })),
        ...(cur.refs ?? []).filter((r) => r.suggested && !chosen.some((c) => c.image === r.url)),
      ].slice(0, MAX_REFS),
    }));
    close();
  };

  return createPortal(
    <div className="modal-scrim" data-ui onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal mobbin-sheet" role="dialog" aria-label="Find on Mobbin">
        <div className="mobbin-top">
          <div className="mobbin-head">
            <h2>Find on Mobbin</h2>
            <button className="btn ghost" onClick={close}>
              Close
            </button>
          </div>
          {connected && (
            <>
              <form
                className="mobbin-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  run();
                }}
              >
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. wallet offline banner"
                  aria-label="Search Mobbin"
                  enterKeyHint="search"
                />
                <button className="btn ink" disabled={busy || !query.trim()}>
                  Search
                </button>
              </form>
              <div className="chips">
                {(["screens", "flows"] as const).map((k) => (
                  <button key={k} className={`chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
                    {k === "screens" ? "Screens" : "Flows"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {!connected ? (
          <>
            <p className="muted">
              Search real app screens and flows on Mobbin and add the ones you like as references for this screen. You'll sign in
              with your Mobbin account once; the sign-in stays on this device.
            </p>
            {error && <p className="small note-skipped">{error}</p>}
            <button
              className="btn ink"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await connectMobbin(f.id);
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              {busy ? "Opening Mobbin…" : "Connect Mobbin"}
            </button>
          </>
        ) : (
          <>
            {busy && (
              <p className="muted small mobbin-status">
                <ThinkingOrb state="searching" size={20} theme="light" color="#016a71" /> Searching Mobbin…
              </p>
            )}
            {error && <p className="small note-skipped">{error}</p>}
            {results && !busy && results.length === 0 && (
              <p className="muted small">
                No screens came back for that search.
                {said && <span className="mobbin-said"> Mobbin said: {said}</span>}
              </p>
            )}
            {results && results.length > 0 && (
              <div className="mobbin-grid">
                {results.map((r) => (
                  <button
                    key={r.image}
                    className={`mobbin-shot ${picked.includes(r.image) ? "on" : ""}`}
                    onClick={() => toggle(r.image)}
                    aria-pressed={picked.includes(r.image)}
                  >
                    <img src={r.image} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />
                    <span>{r.title}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="modal-actions mobbin-actions">
              <button
                className="btn ghost"
                onClick={() => {
                  disconnectMobbin();
                  setConnected(false);
                  setResults(null);
                }}
              >
                Disconnect
              </button>
              <button className="btn ink" disabled={!picked.length} onClick={add}>
                {room <= 0 ? "References are full" : `Add ${picked.length || ""} to references`.replace("  ", " ")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Opens the picker for a frame. */
export const openMobbin = (frameId: string) => set({ mobbinFor: frameId, mobbinNotice: undefined });

const SUGGEST = 3;

/** What to search Mobbin for: the screen's name plus the start of the project brief. */
export function suggestQuery(f: Frame, brief: string) {
  const name = f.name && !/^untitled/i.test(f.name) ? f.name.trim() : "";
  const about = brief.trim().split(/\s+/).slice(0, 8).join(" ");
  const seen = new Set<string>();
  const words = `${name} ${about}`.split(/\s+/).filter((w) => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));
  return words.join(" ").slice(0, 80);
}

/**
 * Fills an empty References list with the top Mobbin results for this screen, once per screen.
 * Free (no AI call). Returns an error message to show, or "" when nothing went wrong.
 */
export async function suggestRefs(frameId: string): Promise<string> {
  const { project } = getState();
  const f = project.frames.find((x) => x.id === frameId);
  if (!f || f.refsSuggested || f.refs?.length || !mobbinConnected()) return "";
  const query = suggestQuery(f, project.brief);
  if (!query) return "";
  updateFrame(frameId, () => ({ refsSuggested: true }));
  try {
    const { screens } = await searchMobbin(query, "screens");
    const top = screens.slice(0, SUGGEST);
    updateFrame(frameId, (cur) => ({
      refs: [
        ...(cur.refs ?? []),
        ...top.map((r) => ({ id: uid(), url: r.image, link: r.link, title: r.title, note: "", suggested: true })),
      ].slice(0, MAX_REFS),
    }));
    return top.length ? "" : "Mobbin found nothing for this screen yet. Name the screen, then tap Find on Mobbin.";
  } catch (e) {
    updateFrame(frameId, () => ({ refsSuggested: false }));
    return `Couldn't suggest references: ${(e as Error).message}`;
  }
}
