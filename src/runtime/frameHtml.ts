// Builds the HTML document that runs a generated screen live inside an iframe.
// React, Babel and Tailwind load from /runtime on our own server (see scripts/copy-runtime.mjs); the shadcn-style kit is defined inline,
// matching the component list the model is told about in server/prompts.ts.

const KIT = String.raw`
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const cn = (...c) => c.filter(Boolean).join(" ");

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  user: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 1.2 14H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 1.2V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  "chevron-left": "m15 18-6-6 6-6",
  "chevron-right": "m9 18 6-6-6-6",
  "chevron-down": "m6 9 6 6 6-6",
  x: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  heart: "M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z",
  star: "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  menu: "M4 6h16M4 12h16M4 18h16",
  more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-5-5L5 21",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "map-pin": "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6",
  lock: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  filter: "M22 3H2l8 9.5V19l4 2v-8.5z",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  bookmark: "m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
  play: "m6 3 14 9-14 9z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  cart: "M8 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM2 2h3l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6",
  "arrow-right": "M5 12h14M12 5l7 7-7 7",
  "arrow-left": "M19 12H5M12 19l-7-7 7-7",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  message: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  wallet: "M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4z",
  chart: "M3 3v18h18M7 16V9M12 16V5M17 16v-4",
};
function Icon({ name, className }) {
  const d = ICONS[name] || ICONS.more;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("h-5 w-5 shrink-0", className)} aria-hidden="true"><path d={d} /></svg>;
}

const btnVariants = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  link: "text-primary underline-offset-4 hover:underline",
};
const btnSizes = { sm: "h-8 px-3 text-sm", default: "h-10 px-4", lg: "h-12 px-6 text-base", icon: "h-10 w-10" };
function Button({ variant = "default", size = "default", className, ...p }) {
  return <button className={cn("inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50", btnVariants[variant], btnSizes[size], className)} {...p} />;
}
const Card = ({ className, ...p }) => <div className={cn("rounded-lg border border-border bg-card text-card-foreground shadow-sm", className)} {...p} />;
const CardHeader = ({ className, ...p }) => <div className={cn("flex flex-col gap-1.5 p-4", className)} {...p} />;
const CardTitle = ({ className, ...p }) => <h3 className={cn("font-semibold leading-none tracking-tight", className)} {...p} />;
const CardDescription = ({ className, ...p }) => <p className={cn("text-sm text-muted-foreground", className)} {...p} />;
const CardContent = ({ className, ...p }) => <div className={cn("p-4 pt-0", className)} {...p} />;
const CardFooter = ({ className, ...p }) => <div className={cn("flex items-center p-4 pt-0", className)} {...p} />;
const Input = ({ className, ...p }) => <input className={cn("flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring", className)} {...p} />;
const Textarea = ({ className, ...p }) => <textarea className={cn("flex min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring", className)} {...p} />;
const Label = ({ className, ...p }) => <label className={cn("text-sm font-medium leading-none", className)} {...p} />;
const badgeVariants = { default: "bg-primary text-primary-foreground", secondary: "bg-secondary text-secondary-foreground", outline: "border border-border", destructive: "bg-destructive text-white" };
const Badge = ({ variant = "default", className, ...p }) => <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", badgeVariants[variant], className)} {...p} />;
function Switch({ checked, defaultChecked, onCheckedChange, className }) {
  const [inner, setInner] = useState(!!defaultChecked);
  const on = checked ?? inner;
  return <button role="switch" aria-checked={on} onClick={() => { setInner(!on); onCheckedChange && onCheckedChange(!on); }} className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", on ? "bg-primary" : "bg-muted", className)}><span className={cn("inline-block h-5 w-5 rounded-full bg-background shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} /></button>;
}
function Checkbox({ checked, defaultChecked, onCheckedChange, className }) {
  const [inner, setInner] = useState(!!defaultChecked);
  const on = checked ?? inner;
  return <button role="checkbox" aria-checked={on} onClick={() => { setInner(!on); onCheckedChange && onCheckedChange(!on); }} className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-primary transition-colors", on && "bg-primary text-primary-foreground", className)}>{on && <Icon name="check" className="h-3.5 w-3.5" />}</button>;
}
const TabsCtx = React.createContext(null);
function Tabs({ value, defaultValue, onValueChange, className, children }) {
  const [inner, setInner] = useState(defaultValue);
  const v = value ?? inner;
  return <TabsCtx.Provider value={{ v, set: (n) => { setInner(n); onValueChange && onValueChange(n); } }}><div className={className}>{children}</div></TabsCtx.Provider>;
}
const TabsList = ({ className, ...p }) => <div className={cn("inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground", className)} {...p} />;
function TabsTrigger({ value, className, children }) {
  const t = React.useContext(TabsCtx);
  const on = t && t.v === value;
  return <button onClick={() => t && t.set(value)} className={cn("inline-flex flex-1 items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium transition-all", on && "bg-background text-foreground shadow-sm", className)}>{children}</button>;
}
function TabsContent({ value, className, children }) {
  const t = React.useContext(TabsCtx);
  return t && t.v === value ? <div className={className}>{children}</div> : null;
}
function Avatar({ src, fallback, className }) {
  const [err, setErr] = useState(false);
  return <span className={cn("relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium", className)}>{src && !err ? <img src={src} onError={() => setErr(true)} className="h-full w-full object-cover" /> : fallback}</span>;
}
const Separator = ({ className }) => <div className={cn("h-px w-full bg-border", className)} />;
const Progress = ({ value = 0, className }) => <div className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}><div className="h-full bg-primary transition-all duration-500" style={{ width: value + "%" }} /></div>;
const Skeleton = ({ className }) => <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
function Sheet({ open, onOpenChange, side = "bottom", className, children }) {
  return <div className={cn("absolute inset-0 z-50", open ? "" : "pointer-events-none")}>
    <div onClick={() => onOpenChange && onOpenChange(false)} className={cn("absolute inset-0 bg-black/40 transition-opacity duration-300", open ? "opacity-100" : "opacity-0")} />
    <div className={cn("absolute bg-background shadow-xl transition-transform duration-300 ease-out", side === "bottom" ? "inset-x-0 bottom-0 rounded-t-2xl p-4" : "inset-y-0 right-0 w-4/5 p-4", open ? "translate-x-0 translate-y-0" : side === "bottom" ? "translate-y-full" : "translate-x-full", className)}>{children}</div>
  </div>;
}
function Dialog({ open, onOpenChange, title, className, children }) {
  return <div className={cn("absolute inset-0 z-50 flex items-center justify-center p-6", open ? "" : "pointer-events-none")}>
    <div onClick={() => onOpenChange && onOpenChange(false)} className={cn("absolute inset-0 bg-black/40 transition-opacity duration-200", open ? "opacity-100" : "opacity-0")} />
    <div className={cn("relative w-full max-w-sm rounded-lg bg-background p-5 shadow-xl transition-all duration-200", open ? "scale-100 opacity-100" : "scale-95 opacity-0", className)}>{title && <h2 className="mb-2 text-lg font-semibold">{title}</h2>}{children}</div>
  </div>;
}
`;

const THEME = `
@custom-variant dark (&:where(.dark, .dark *));
@theme {
  --color-background: #ffffff; --color-foreground: #0a0a0a;
  --color-card: #ffffff; --color-card-foreground: #0a0a0a;
  --color-primary: #171717; --color-primary-foreground: #fafafa;
  --color-secondary: #f5f5f5; --color-secondary-foreground: #171717;
  --color-muted: #f5f5f5; --color-muted-foreground: #737373;
  --color-accent: #f5f5f5; --color-accent-foreground: #171717;
  --color-destructive: #e7000b; --color-border: #e5e5e5; --color-ring: #a1a1a1;
  --radius-lg: 0.625rem; --radius-md: 0.5rem; --radius-sm: 0.375rem;
}
.dark {
  --color-background: #0a0a0a; --color-foreground: #fafafa;
  --color-card: #171717; --color-card-foreground: #fafafa;
  --color-primary: #e5e5e5; --color-primary-foreground: #171717;
  --color-secondary: #262626; --color-secondary-foreground: #fafafa;
  --color-muted: #262626; --color-muted-foreground: #a1a1a1;
  --color-accent: #262626; --color-accent-foreground: #fafafa;
  --color-border: #ffffff1a; --color-ring: #737373;
}
`;

export function frameHtml(code: string, opts: { dark?: boolean } = {}): string {
  // srcdoc frames have no base URL of their own, so point at this app's origin explicitly.
  const rt = `${location.origin}/runtime`;
  // Escape "</script" so generated code can't close the script tag early.
  const safe = (s: string) => s.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html class="${opts.dark ? "dark" : ""}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="${rt}/tailwind.js"></script>
<style type="text/tailwindcss">${THEME}</style>
<style>html,body,#root{height:100%;margin:0}body{font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}#err{font:12px ui-monospace,monospace;color:#b42318;padding:12px;white-space:pre-wrap}</style>
<script src="${rt}/react.js"></script>
<script src="${rt}/react-dom.js"></script>
<script src="${rt}/babel.js"></script>
</head><body><div id="root"></div>
<script>
function showError(e){document.getElementById("root").innerHTML='<div id="err"></div>';document.getElementById("err").textContent="This frame hit an error:\\n"+(e&&e.message||e);parent.postMessage({type:"frame-error",message:String(e&&e.message||e)},"*");}
window.addEventListener("error",function(ev){showError(ev.error||ev.message)});
try{
  var src=${JSON.stringify(safe(KIT))}+"\\n"+${JSON.stringify(safe(code))}+"\\nReactDOM.createRoot(document.getElementById('root')).render(<App/>);";
  var out=Babel.transform(src,{presets:["react"]}).code;
  new Function(out)();
  parent.postMessage({type:"frame-ready"},"*");
}catch(e){showError(e)}
</script></body></html>`;
}
