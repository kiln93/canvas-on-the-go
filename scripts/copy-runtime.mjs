// Copies the libraries that generated frames run on into public/runtime, so frames load them
// from our own server (no third-party CDN, and they keep working offline once cached).
import { copyFileSync, mkdirSync } from "node:fs";

const files = {
  "react.js": "node_modules/react/umd/react.production.min.js",
  "react-dom.js": "node_modules/react-dom/umd/react-dom.production.min.js",
  "babel.js": "node_modules/@babel/standalone/babel.min.js",
  "tailwind.js": "node_modules/@tailwindcss/browser/dist/index.global.js",
};
mkdirSync("public/runtime", { recursive: true });
for (const [to, from] of Object.entries(files)) copyFileSync(from, `public/runtime/${to}`);
console.log("Copied frame runtime to public/runtime");
