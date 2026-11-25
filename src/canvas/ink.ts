import { getStroke } from "perfect-freehand";
import type { Frame, Point, Stroke } from "../store";

// The USB-C Apple Pencil reports no pressure, so pressure is simulated from speed unless real
// pressure (anything other than the 0.5 browsers report as a default) comes through.
export function strokeOutline(points: Point[], kind: Stroke["kind"]) {
  const real = points.some((p) => p[2] !== 0.5 && p[2] > 0);
  return getStroke(points, {
    size: kind === "markup" ? 5 : 3.5,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !real,
    last: true,
  });
}

export function outlineToPath(outline: number[][]) {
  if (!outline.length) return "";
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
      return acc;
    },
    ["M", ...outline[0].map((n) => n.toFixed(1)), "Q"],
  );
  return d.join(" ") + " Z";
}

export const strokePath = (s: Stroke) => outlineToPath(strokeOutline(s.points, s.kind));

/** Renders a frame's strokes of one kind to a PNG (base64, no prefix) for the AI to read. */
export function rasterize(frame: Frame, kind: Stroke["kind"], maxSide = 1024): string | undefined {
  const strokes = frame.strokes.filter((s) => s.kind === kind);
  if (!strokes.length) return undefined;
  const scale = Math.min(1, maxSide / Math.max(frame.w, frame.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(frame.w * scale);
  canvas.height = Math.round(frame.h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#d1d1cd";
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  ctx.scale(scale, scale);
  ctx.fillStyle = kind === "markup" ? "#c0262d" : "#27251e";
  for (const s of strokes) ctx.fill(new Path2D(strokePath(s)));
  return canvas.toDataURL("image/png").split(",")[1];
}
