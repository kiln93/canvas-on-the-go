import { useEffect, useMemo, useState } from "react";
import { importPrd } from "./api";
import { Canvas, type Tool } from "./canvas/Canvas";
import { frameHtml } from "./runtime/frameHtml";
import { DEVICES, getState, redo, set, setBrief, undo, useStore, type DeviceId } from "./store";
import { Tutorial } from "./Tutorial";

export function App() {
  const [tool, setTool] = useState<Tool>("frame");
  const [device, setDevice] = useState<DeviceId>("iphone");
  const [playing, setPlaying] = useState<string | null>(null);
  const tutorialDone = useStore((s) => s.tutorialDone);
  const brief = useStore((s) => s.project.brief);
  const [editingBrief, setEditingBrief] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      const map: Record<string, Tool> = { v: "select", p: "pen", e: "eraser", f: "frame" };
      if (map[e.key]) setTool(map[e.key]);
      if (e.key === "Escape") set({ selectedId: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // After a frame is created, switch to the pen so you can sketch straight away.
  const frameCount = useStore((s) => s.project.frames.length);
  const [lastCount, setLastCount] = useState(frameCount);
  useEffect(() => {
    if (frameCount > lastCount && tool === "frame") setTool("pen");
    setLastCount(frameCount);
  }, [frameCount]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <TopBar onEditBrief={() => setEditingBrief(true)} />
      <KeyBanner />
      <Canvas tool={tool} device={device} onPlay={setPlaying} />
      <Toolbar tool={tool} setTool={setTool} device={device} setDevice={setDevice} />
      {playing && <Preview id={playing} onClose={() => setPlaying(null)} />}
      {!tutorialDone && <Tutorial onDone={() => set({ tutorialDone: true })} />}
      {tutorialDone && (!brief || editingBrief) && (
        <BriefDialog
          initial={brief}
          onSave={(b) => {
            setBrief(b);
            setEditingBrief(false);
          }}
          onCancel={brief ? () => setEditingBrief(false) : undefined}
        />
      )}
    </div>
  );
}

// Asks the server once whether it has an API key, so a missing key shows up front instead of on every frame.
function KeyBanner() {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    fetch("/api/health", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hasKey?: boolean } | null) => setMissing(d?.hasKey === false))
      .catch(() => {});
  }, []);
  if (!missing) return null;
  return (
    <div className="key-banner" data-ui>
      The server has no Anthropic API key. In Vercel, open this project's Settings, then Environment Variables, and add{" "}
      <code>ANTHROPIC_API_KEY</code> with Production ticked. Then redeploy the Production deployment.
    </div>
  );
}

function TopBar({ onEditBrief }: { onEditBrief: () => void }) {
  const surfaceId = useStore((s) => s.surfaceId);
  const surface = useStore((s) => s.project.frames.find((f) => f.id === s.surfaceId));
  const count = useStore((s) => s.project.frames.filter((f) => f.surfaceId === s.surfaceId).length);
  const brief = useStore((s) => s.project.brief);
  const [menu, setMenu] = useState(false);
  return (
    <header className="topbar" data-ui>
      <nav className="crumbs">
        <button className={`crumb ${!surfaceId ? "active" : ""}`} onClick={() => set({ surfaceId: null })}>
          Overview
        </button>
        {surfaceId && (
          <>
            <span className="sep">/</span>
            <span className="crumb active">{surface?.name || "Untitled surface"}</span>
            <span className="muted small">
              {count} frame{count === 1 ? "" : "s"}
            </span>
          </>
        )}
      </nav>
      <button className="brief" onClick={onEditBrief} title="Edit project brief">
        {brief ? brief.slice(0, 80) + (brief.length > 80 ? "…" : "") : "Add a project brief"}
      </button>
      <div className="top-right">
        <CostMeter />
        <div className="menu-wrap">
          <button className="btn ghost" onClick={() => setMenu((m) => !m)} aria-label="Menu">
            •••
          </button>
          {menu && (
            <div className="menu" onClick={() => setMenu(false)}>
              <button onClick={() => set({ tutorialDone: false })}>Show the tutorial</button>
              <button onClick={onEditBrief}>Edit project brief</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function CostMeter() {
  const spend = useStore((s) => s.project.spend);
  const cap = useStore((s) => s.project.cap);
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, (spend.cost / cap) * 100);
  return (
    <div className="meter-wrap">
      <button className="meter" onClick={() => setOpen((o) => !o)} title="AI spending this month">
        <span className="meter-bar">
          <span style={{ width: `${pct}%` }} className={pct >= 100 ? "over" : ""} />
        </span>
        ${spend.cost.toFixed(2)} / ${cap}
      </button>
      {open && (
        <div className="menu meter-pop">
          <p className="small">
            AI spend this month, estimated from tokens at Claude Opus 5.5 prices ($4 in, $20 out per million).
          </p>
          <label className="small">
            Monthly cap ($)
            <input
              type="number"
              min={1}
              value={cap}
              onChange={(e) => set({ project: { ...getState().project, cap: Math.max(1, Number(e.target.value) || 1) } })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: "select", label: "Select and move", key: "V", icon: "M5 3l14 8-6 2-2 6z" },
  { id: "pen", label: "Pencil", key: "P", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" },
  { id: "eraser", label: "Eraser", key: "E", icon: "M20 20H8l-5-5 10-10 7 7-8 8M14 6l6 6" },
  { id: "frame", label: "Frame", key: "F", icon: "M6 2v20M18 2v20M2 6h20M2 18h20" },
];

function Toolbar(props: {
  tool: Tool;
  setTool: (t: Tool) => void;
  device: DeviceId;
  setDevice: (d: DeviceId) => void;
}) {
  return (
    <div className="toolbar" data-ui>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool ${props.tool === t.id ? "active" : ""}`}
          onClick={() => props.setTool(t.id)}
          aria-label={`${t.label} (${t.key})`}
          title={`${t.label} (${t.key})`}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d={t.icon} />
          </svg>
        </button>
      ))}
      {props.tool === "frame" && (
        <div className="devices">
          {(Object.keys(DEVICES) as DeviceId[]).map((d) => (
            <button key={d} className={`chip ${props.device === d ? "active" : ""}`} onClick={() => props.setDevice(d)}>
              {DEVICES[d].label}
            </button>
          ))}
        </div>
      )}
      <span className="divider" />
      <button className="tool" onClick={undo} aria-label="Undo" title="Undo (two-finger tap)">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />
        </svg>
      </button>
      <button className="tool" onClick={redo} aria-label="Redo" title="Redo (three-finger tap)">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />
        </svg>
      </button>
    </div>
  );
}

function Preview({ id, onClose }: { id: string; onClose: () => void }) {
  const frame = useStore((s) => s.project.frames.find((f) => f.id === id));
  const html = useMemo(() => (frame?.code ? frameHtml(frame.code) : ""), [frame?.code]);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const r = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);
  if (!frame) return null;
  const scale = Math.min(1, (size.w - 48) / frame.w, (size.h - 120) / frame.h);
  return (
    <div className="preview" data-ui>
      <div className="preview-bar">
        <span>{frame.name || "Preview"}</span>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="preview-stage" style={{ width: frame.w * scale, height: frame.h * scale }}>
        <iframe
          title="Preview"
          srcDoc={html}
          sandbox="allow-scripts"
          style={{ width: frame.w, height: frame.h, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}

const GDOC = /docs\.google\.com\/document\//;

function BriefDialog(props: { initial: string; onSave: (b: string) => void; onCancel?: () => void }) {
  const [text, setText] = useState(props.initial);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<{ busy?: boolean; msg?: string; error?: boolean }>({});

  const runImport = async (req: Parameters<typeof importPrd>[0], label: string) => {
    setStatus({ busy: true, msg: `Reading ${label}…` });
    try {
      const out = await importPrd(req);
      setText(out.brief);
      setSource("");
      setStatus({ msg: `Brief written from “${out.title}”. Edit it if anything's off.` });
    } catch (e) {
      setStatus({ msg: (e as Error).message, error: true });
    }
  };

  const importSource = () => {
    const v = source.trim();
    if (!v) return;
    if (GDOC.test(v)) runImport({ kind: "gdoc", url: v }, "the Google Doc");
    else runImport({ kind: "text", text: v }, "the PRD");
  };

  const importFile = async (file: File) => {
    if (file.size > 2_000_000) return setStatus({ msg: "That file is over 2 MB. Paste the text instead.", error: true });
    runImport({ kind: "text", text: await file.text(), name: file.name }, file.name);
  };

  return (
    <div className="modal-scrim" data-ui>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) props.onSave(text.trim());
        }}
      >
        <h2>What are you building?</h2>
        <p className="muted">
          A sentence or two is enough, or import a PRD and I'll write the brief from it. Every suggestion and screen uses
          this as context.
        </p>
        <div className="import-row">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Google Docs link, or paste PRD text"
            aria-label="Google Docs link or PRD text"
            disabled={status.busy}
          />
          <button type="button" className="btn" onClick={importSource} disabled={status.busy || !source.trim()}>
            Import
          </button>
          <label className={`btn ghost file-btn ${status.busy ? "disabled" : ""}`}>
            File
            <input
              type="file"
              accept=".md,.markdown,.txt,text/plain,text/markdown"
              disabled={status.busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) importFile(f);
              }}
            />
          </label>
        </div>
        {status.msg && (
          <p className={`small import-status ${status.error ? "error" : ""}`}>
            {status.busy && <span className="spinner" />} {status.msg}
          </p>
        )}
        <textarea
          autoFocus
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Example: A habit tracker for runners, mobile first, with streaks and a weekly summary."
          aria-label="Project brief"
        />
        <div className="modal-actions">
          {props.onCancel && (
            <button type="button" className="btn ghost" onClick={props.onCancel}>
              Cancel
            </button>
          )}
          <button className="btn ink" disabled={!text.trim() || status.busy}>
            {props.initial ? "Save brief" : "Start designing"}
          </button>
        </div>
      </form>
    </div>
  );
}
