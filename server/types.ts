// Shapes shared by the browser app and the API.

export type Region = { x: number; y: number; w: number; h: number }; // 0..1, relative to the frame

export type Suggestion = {
  id: string;
  kind: "component" | "layout" | "question" | "copy";
  text: string;
  region?: Region | null;
};

export type SuggestRequest = {
  brief: string;
  surfaceName: string;
  device: string;
  image: string; // base64 PNG, no data: prefix
  stage: "sketch" | "generated";
  code?: string;
};

export type SuggestResponse = { title: string; suggestions: Suggestion[]; usage: Usage };

export type GenerateRequest = {
  brief: string;
  surfaceName: string;
  device: string;
  width: number;
  height: number;
  image?: string; // the sketch, or markups drawn over the live frame
  notes: string[]; // the confirmed note lines
  previousCode?: string; // present when iterating or making a variation
  styleRef?: string; // the project's style reference image (base64 JPEG), if the designer set one
  // Reference images attached to this screen, with what to take from each: uploaded (data) or a Mobbin link (url).
  refs?: { data?: string; url?: string; note: string }[];
  instruction?: string; // e.g. "empty state" for a variation
  designSystem: "shadcn";
};

export type GenerateResponse = {
  title: string;
  code: string;
  summary: string;
  /** One entry per note (0-based, in the order sent): whether it was built, and what changed on screen. */
  notesDone?: { note: number; done: boolean; change: string }[];
  usage: Usage;
};

export type Usage = { input_tokens: number; output_tokens: number; cost: number };

export type ApiError = { error: string; code?: "no_key" | "refusal" | "bad_request" | "upstream" };

export type ImportRequest =
  | { kind: "gdoc"; url: string }
  | { kind: "text"; text: string; name?: string };

export type ImportResponse = { title: string; brief: string; usage: Usage };

// /api/generate and /api/review stream one JSON object per line.
export type StreamLine<T> =
  | { type: "progress"; phase: "thinking" | "writing" | "reviewing" | "fixing"; chars: number }
  | { type: "done"; result: T }
  | ({ type: "error" } & ApiError);
export type GenerateStreamLine = StreamLine<GenerateResponse>;

export type ReviewRequest = Omit<GenerateRequest, "previousCode" | "designSystem"> & { code: string };
export type ReviewResponse = {
  verdict: "ship" | "fix";
  findings: string[];
  keep: string;
  code: string; // the corrected screen, or "" when shipping as is
  usage: Usage;
};

export type VariationsRequest = { brief: string; surfaceName: string; device: string; code: string; existing: string[] };
export type VariationsResponse = { variations: { name: string; instruction: string }[]; usage: Usage };
