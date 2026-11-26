// Copies the libraries that generated frames run on into public/runtime, so frames load them
// from our own server (no third-party CDN, and they keep working offline once cached).
import { copyFileSync, mkdirSync } from "node:fs";

const files = {
  "react.js": "node_modules/react/umd/react.production.min.js",
  "react-dom.js": "node_modules/react-dom/umd/react-dom.production.min.js",
  "babel.js": "node_modules/@babel/standalone/babel.min.js",
  // Every Lucide icon (window.lucide.icons), so Icon can draw any of ~2,400 by name.
  "lucide.js": "node_modules/lucide/dist/umd/lucide.min.js",
  "tailwind.js": "node_modules/@tailwindcss/browser/dist/index.global.js",
  // Motion for generated screens: GSAP (window.gsap and plugins), Motion for React (window.Motion),
  // and Three.js as an ES module (loaded only by screens that use THREE).
  "gsap.js": "node_modules/gsap/dist/gsap.min.js",
  "gsap-flip.js": "node_modules/gsap/dist/Flip.min.js",
  "gsap-draggable.js": "node_modules/gsap/dist/Draggable.min.js",
  "gsap-scrolltrigger.js": "node_modules/gsap/dist/ScrollTrigger.min.js",
  "gsap-customease.js": "node_modules/gsap/dist/CustomEase.min.js",
  "motion.js": "node_modules/framer-motion/dist/framer-motion.js",
  "three.module.js": "node_modules/three/build/three.module.js",
  "three.core.js": "node_modules/three/build/three.core.js",
};
mkdirSync("public/runtime", { recursive: true });
for (const [to, from] of Object.entries(files)) copyFileSync(from, `public/runtime/${to}`);
console.log("Copied frame runtime to public/runtime");
