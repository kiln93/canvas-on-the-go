/**
 * iPhone and iPad only open the keyboard when a text box is focused during a tap.
 * A note box that opens after a press-and-hold (or after a moment's work) misses that tap,
 * so on the lift we focus a hidden box to bring the keyboard up, and the note box takes
 * the focus from it once it appears. The keyboard stays up across that hand-off.
 */
let proxy: HTMLInputElement | null = null;

export function primeKeyboard() {
  if (!proxy) {
    proxy = document.createElement("input");
    proxy.setAttribute("aria-hidden", "true");
    proxy.tabIndex = -1;
    // On screen (so Safari doesn't scroll to it), but invisible; 16px so Safari doesn't zoom.
    Object.assign(proxy.style, {
      position: "fixed", top: "0", left: "0", width: "1px", height: "1px",
      opacity: "0", fontSize: "16px", border: "0", padding: "0", pointerEvents: "none",
    });
    document.body.appendChild(proxy);
  }
  proxy.focus({ preventScroll: true });
  // If no note box takes over, let the keyboard go.
  setTimeout(() => document.activeElement === proxy && proxy?.blur(), 2000);
}

/**
 * With an Apple Pencil, tapping a text box starts Scribble (handwriting) instead of the keyboard.
 * Notes are typed or dictated here, so a Pencil tap on a note box opens the keyboard.
 */
export function keyboardOnPencilTap(el: HTMLElement) {
  let pen = false;
  const isPen = (e: TouchEvent) =>
    Array.from(e.changedTouches).some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
  const start = (e: TouchEvent) => {
    pen = isPen(e);
    if (pen) e.preventDefault();
  };
  const end = (e: TouchEvent) => {
    if (!pen) return;
    pen = false;
    e.preventDefault();
    el.focus();
  };
  el.addEventListener("touchstart", start, { passive: false });
  el.addEventListener("touchend", end, { passive: false });
  return () => {
    el.removeEventListener("touchstart", start);
    el.removeEventListener("touchend", end);
  };
}
