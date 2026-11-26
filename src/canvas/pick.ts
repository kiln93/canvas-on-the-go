// Asks a live frame's iframe what component sits at a point (see PICKER in runtime/frameHtml.ts).

export type Hit = { x: number; y: number; w: number; h: number; label: string };

const frames = new Map<string, HTMLIFrameElement>();
export const registerFrame = (id: string, el: HTMLIFrameElement | null) => (el ? frames.set(id, el) : frames.delete(id));

let seq = 0;
export function pickInFrame(frameId: string, x: number, y: number): Promise<Hit | null> {
  const win = frames.get(frameId)?.contentWindow;
  if (!win) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => {
    const done = (hit: Hit | null) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(hit);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source === win && e.data?.type === "picked" && e.data.id === id) done(e.data.hit ?? null);
    };
    const timer = setTimeout(() => done(null), 600);
    window.addEventListener("message", onMessage);
    win.postMessage({ type: "pick", id, x, y }, "*");
  });
}
