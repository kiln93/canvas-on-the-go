import { review, streamingEndpoint } from "../server/claude.js";
export const POST = streamingEndpoint(review);
