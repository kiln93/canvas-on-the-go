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
  instruction?: string; // e.g. "empty state" for a variation
  designSystem: "shadcn";
};

export type GenerateResponse = { title: string; code: string; summary: string; usage: Usage };

export type Usage = { input_tokens: number; output_tokens: number; cost: number };

export type ApiError = { error: string; code?: "no_key" | "refusal" | "bad_request" | "upstream" };

export type ImportRequest =
  | { kind: "gdoc"; url: string }
  | { kind: "text"; text: string; name?: string };

export type ImportResponse = { title: string; brief: string; usage: Usage };

// /api/generate streams one JSON object per line.
export type GenerateStreamLine =
  | { type: "progress"; phase: "thinking" | "writing"; chars: number }
  | { type: "done"; result: GenerateResponse }
  | ({ type: "error" } & ApiError);

export type VariationsRequest = { brief: string; surfaceName: string; device: string; code: string; existing: string[] };
export type VariationsResponse = { variations: { name: string; instruction: string }[]; usage: Usage };
