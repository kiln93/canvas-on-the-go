# Canvas on the go

A lightweight design canvas for iPad (and any browser). Sketch a screen with Apple Pencil, confirm what each part is, and get a live, clickable React + Tailwind screen built from shadcn/ui. Inspired by paper.design: frames are real code, not pictures of code.

## How it works

1. **Project brief.** Describe what you're building once. Every AI call uses it as context.
2. **New screen, then draw.** Tap **+ New screen** and pick iPhone, iPad or desktop. The screen opens as a full-width drawing sheet. The Pencil draws (fingers too, until a Pencil is used); two fingers scroll. **✎ Draw** on any frame opens it again. The canvas itself never draws: drag to move around, pinch to zoom, tap a screen to select it, hold one to move it.
3. **Sketch, then tap ✓ Done sketching.** Claude reads the sketch and fills the note card beside the frame with suggestions ("Is this a header?"), numbered to match callouts on the sketch.
4. **Leave notes where they belong.** Press and hold the pen on any part of a sketch or a live screen to leave a note on just that part (on a live screen it picks the exact component). Tag each note **UI**, **Interaction**, **Motion**, **Copy** or **Data**, and type or dictate it. Accept, edit or dismiss Claude's suggestions too.
5. **Generate.** The frame becomes a live React screen built on iOS patterns (large titles, tab bars, grouped lists, sheets) with realistic content. The sketch hides; **Show sketch** brings it back. Notes that went into the build move to **History**, where **Reuse** puts one back.
6. **Mark it up.** Draw over a live screen (strokes turn red), or press and hold to note a component, then **Rebuild**. **Undo version** steps back.
7. **Open surface.** **Suggest variations** asks Claude which states are worth designing (empty, offline, a product-specific edge case…) and shows them with their cost; only the ones you tick are built. **+ Variation** makes one you describe.
8. **▶ Play** opens the screen full size so you can click through it.

Every build is checked by `server/lint.ts`. When the checks find a problem, a fresh Claude reviews the screen against the design skills in `server/skills` (Anthropic's frontend-design, plus guides from impeccable, hallmark and open-design) and fixes it. **Reviewed: fixed N things** under the screen lists what changed.

While Claude works, the frame shows what it's doing and how far along it is, with an orb, a beam around the frame, a pixel mosaic while the screen is written, and a wave that reveals the finished screen.

Generated screens can use Motion for React, GSAP (with Flip, Draggable, ScrollTrigger, CustomEase) and Three.js. They load only in screens that use them.

### Gestures

| Input | Action |
| --- | --- |
| Pencil | Uses the current tool (select, pen, eraser, frame) |
| Pencil, press and hold on a frame | Leave a note on that part |
| One finger | Pan |
| Two-finger pinch | Zoom |
| Two-finger tap | Undo |
| Three-finger tap | Redo |
| Keyboard | V select, P pen, E eraser, F frame, ⌘Z undo, ⇧⌘Z redo, Delete removes the selected frame |

Touches are ignored while the Pencil is drawing, for palm rejection.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then put your Anthropic API key in it
npm run dev                  # http://localhost:5173, and on your network for the iPad
```

## Deploy (Vercel)

1. Import this repo at vercel.com/new. The defaults work (Vite, `npm run build`, output `dist`).
2. Add the environment variable `ANTHROPIC_API_KEY`.
3. Deploy, then open the URL in Safari on the iPad and use Share → Add to Home Screen.

The key stays on the server (`api/*.ts`). The browser never sees it.

## Layout

| Path | What it is |
| --- | --- |
| `src/canvas/Canvas.tsx` | Infinite canvas: Pencil and touch input, pan and zoom, frames |
| `src/canvas/FrameView.tsx` | One frame: ink, callouts, the live screen, actions |
| `src/canvas/NoteCard.tsx` | The note card tethered to each frame: tags, dictation, history |
| `src/canvas/NoteComposer.tsx`, `src/canvas/pick.ts` | Press-and-hold notes, and asking a live screen which component was pressed |
| `src/canvas/FrameLoader.tsx` | Progress while Claude works: orb, beam, mosaic, reveal wave |
| `src/runtime/frameHtml.ts` | The document a generated screen runs in: the shadcn-style kit plus iOS parts (Screen, NavBar, TabBar, ListGroup…) |
| `src/store.ts` | Project state, undo and redo, saved to the browser |
| `server/claude.ts`, `server/prompts.ts` | The Claude calls: read a sketch, build a screen (streamed with progress), plan variations, import a PRD |
| `server/skills/`, `server/skills.ts` | Design skill files given to Claude (sources and licenses in `server/skills/NOTICE.md`), bundled by `scripts/build-skills.mjs` |
| `server/lint.ts` | Mechanical checks passed to the reviewer |
| `api/*.ts` | Vercel functions. `npm run dev` serves the same handlers |

## Costs

A new screen is designed by Claude Opus 5.5 at high effort ($4 per million input tokens, $20 per million output), about 35¢. Variations, markups and rebuilds are edits by Claude Sonnet 5.5 at medium effort that send only the changed lines (find/replace edits), about 5¢. Reviews (the automatic check when lint finds problems, and "Review markups") run on Opus 5.5. `FIRST_BUILD_MODEL`, `BUILD_MODEL` and `REVIEW_MODEL` env vars override the models. Screens can use any Lucide icon, real photos by keyword (`Photo`), and the project's optional style reference image. Each screen's notes also take up to four references: your own screenshots, or screens found on Mobbin ("Find on Mobbin" signs in with your own Mobbin account; the sign-in stays in your browser, and the app keeps only links to the screens, fetching the images when it builds). Nothing paid runs without a tap, and buttons show the estimate. The meter in the top bar estimates this month's spend from real token counts (cache reads and writes at their own prices) and stops new AI calls at your cap ($50 by default, editable).

## Not in this slice yet

Prototype links between frames, a motion editor, Figma import and export, MCP assets (Nano Banana, Higgsfield, Blender), sync across devices, and share links. Projects are saved in the browser for now.
