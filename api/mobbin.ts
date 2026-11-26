import { mobbin, MobbinError, type MobbinRequest } from "../server/mobbin.js";

// Mobbin sign-in and screen search (see server/mobbin.ts). Tokens come from and go back to the device.
export async function POST(request: Request): Promise<Response> {
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  try {
    return reply(200, await mobbin((await request.json()) as MobbinRequest));
  } catch (err) {
    if (err instanceof MobbinError) return reply(err.status, { error: err.message });
    console.error(err);
    return reply(502, { error: "Couldn't reach Mobbin. Try again in a moment." });
  }
}
