import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// iOS Safari scrolls the whole page to keep a focused text box above the keyboard, and often leaves it
// scrolled after the keyboard closes, hiding the top bar under the address bar. Put it back, and tell the
// CSS how tall the keyboard is (--kb) so sheets can sit above it.
const typing = () => !!document.activeElement?.matches("input, textarea");
const vv = window.visualViewport;
const syncKeyboard = () => {
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty("--kb", `${Math.round(kb)}px`);
  if (!typing() && (window.scrollY || vv?.offsetTop)) window.scrollTo(0, 0);
};
vv?.addEventListener("resize", syncKeyboard);
vv?.addEventListener("scroll", syncKeyboard);
document.addEventListener("focusout", () => setTimeout(syncKeyboard, 60));
window.addEventListener("scroll", () => !typing() && window.scrollY && window.scrollTo(0, 0));

createRoot(document.getElementById("root")!).render(<App />);
