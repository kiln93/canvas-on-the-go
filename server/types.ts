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
