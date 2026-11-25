# Canvas on the go

A lightweight design canvas for iPad (and any browser). Sketch a screen with Apple Pencil, confirm what each part is, and get a live, clickable React + Tailwind screen built from shadcn/ui. Inspired by paper.design: frames are real code, not pictures of code.

## How it works

1. **Project brief.** Describe what you're building once. Every AI call uses it as context.
2. **Overview canvas.** Each frame you draw here is a *surface*. Drag a rough rectangle with the frame tool and it snaps to iPhone, iPad or desktop.
3. **Sketch, then tap ✓ Done sketching.** Claude reads the sketch and fills the note card beside the frame with suggestions ("Is this a header?"), numbered to match callouts on the sketch.
4. **Confirm.** Accept, edit or dismiss each one, or write or dictate your own notes.
5. **Generate.** The frame becomes a live React screen. The sketch stays as a faint layer until you tap **Approve**.
6. **Mark it up.** Draw over a live screen (strokes turn red), then **Apply markups** to rebuild it. **Undo version** steps back.
7. **Open surface.** Double-tap a surface, or tap **Open surface**, to see all its variations. **+ Variation** makes empty, loading, error, dark or any scenario you describe.
8. **▶ Play** opens the screen full size so you can click through it.

### Gestures

| Input | Action |
| --- | --- |
| Pencil | Uses the current tool (select, pen, eraser, frame) |
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
| `src/canvas/NoteCard.tsx` | The note card tethered to each frame, with dictation |
| `src/runtime/frameHtml.ts` | The document a generated screen runs in, with the shadcn-style kit |
| `src/store.ts` | Project state, undo and redo, saved to the browser |
| `server/claude.ts`, `server/prompts.ts` | The two Claude calls: read a sketch, build a screen |
| `api/*.ts` | Vercel functions. `npm run dev` serves the same handlers |

## Costs

Both calls use Claude Opus 5.5 ($4 per million input tokens, $20 per million output). The meter in the top bar estimates this month's spend from real token counts and stops new AI calls at your cap ($50 by default, editable).

## Not in this slice yet

Prototype links between frames, motion and interaction editing, Figma import and export, MCP assets (Nano Banana, Higgsfield, Blender), sync across devices, and share links. Projects are saved in the browser for now.
