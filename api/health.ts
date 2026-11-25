// Lets the app tell you up front whether the server has an API key, without calling Claude.
export async function POST(): Promise<Response> {
  return new Response(JSON.stringify({ hasKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
