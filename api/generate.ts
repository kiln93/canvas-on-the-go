import { generate, streamingEndpoint } from "../server/claude.js";
export const POST = streamingEndpoint(generate);
