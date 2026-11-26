// Mobbin, through its MCP server: sign in with the designer's own Mobbin account (OAuth with PKCE),
// then search real app screens to use as references. Tokens live only on the designer's device; this
// server just relays. Mobbin's terms ask that its screens aren't cached or re-hosted, so the app keeps
// only links and the build fetches each image when it runs.

const MCP_URL = "https://api.mobbin.com/mcp";
const MOBBIN_HOST = /(^|\.)mobbin\.com$/;
const PROTOCOL = "2025-06-18";

export type MobbinAuth = { clientId: string; tokenEndpoint: string; resource: string };
export type MobbinTokens = { accessToken: string; refreshToken?: string; expiresAt?: number };
export type MobbinScreen = { image: string; title: string; link?: string };

export type MobbinRequest =
  | { action: "begin"; redirectUri: string }
  | ({ action: "token"; code: string; verifier: string; redirectUri: string } & MobbinAuth)
  | ({ action: "refresh"; refreshToken: string } & MobbinAuth)
  | { action: "search"; accessToken: string; query: string; kind?: MobbinKind; platform?: "ios" | "web" };

export class MobbinError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const PRM_URLS = ["https://api.mobbin.com/.well-known/oauth-protected-resource/mcp", "https://api.mobbin.com/.well-known/oauth-protected-resource"];

/**
 * Hosts Mobbin itself names as its sign-in servers (its protected-resource document on api.mobbin.com).
 * Mobbin signs people in through a separate auth host (Supabase), so that host is trusted only because Mobbin lists it.
 */
let authHosts: Set<string> | null = null;
async function trustedAuthHosts(prm?: Record<string, unknown> | null) {
  if (!prm && authHosts) return authHosts;
  for (const u of PRM_URLS) if (prm || (prm = await getJson(u))) break;
  const hosts = ((prm?.authorization_servers as string[] | undefined) ?? []).flatMap((a) => {
    try {
      const h = new URL(a);
      return h.protocol === "https:" ? [h.hostname] : [];
    } catch {
      return [];
    }
  });
  authHosts = new Set(hosts);
  return authHosts;
}

/** Only Mobbin's own hosts, or the sign-in hosts Mobbin names, may be called with a user's codes or tokens. */
async function mobbinUrl(u: string) {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    throw new MobbinError(400, "Mobbin gave an address that couldn't be read.");
  }
  if (url.protocol === "https:" && (MOBBIN_HOST.test(url.hostname) || (await trustedAuthHosts()).has(url.hostname))) return url.toString();
  throw new MobbinError(400, `Mobbin's sign-in pointed to ${url.hostname}, which Mobbin doesn't list as its sign-in server.`);
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Finds Mobbin's sign-in endpoints the way MCP clients do (RFC 9728, then RFC 8414 / OpenID discovery). */
async function discover() {
  let hinted: string | undefined;
  try {
    const r = await fetch(MCP_URL, { method: "POST", headers: rpcHeaders(), body: JSON.stringify(initialize(1)) });
    hinted = /resource_metadata="([^"]+)"/.exec(r.headers.get("www-authenticate") ?? "")?.[1];
  } catch {
    // fall through to the well-known locations
  }
  let prm: Record<string, unknown> | null = null;
  // The hint comes from Mobbin's own server, but only follow it to a Mobbin address.
  const hint = hinted && /^https:\/\/([a-z0-9-]+\.)*mobbin\.com\//i.test(hinted) ? hinted : undefined;
  for (const u of [hint, ...PRM_URLS]) {
    if (u && (prm = await getJson(u))) break;
  }
  await trustedAuthHosts(prm);
  const issuer = String((prm?.authorization_servers as string[] | undefined)?.[0] ?? "https://api.mobbin.com");
  const iu = new URL(issuer);
  const path = iu.pathname === "/" ? "" : iu.pathname.replace(/\/$/, "");
  let as: Record<string, unknown> | null = null;
  for (const u of [
    `${iu.origin}/.well-known/oauth-authorization-server${path}`,
    `${iu.origin}/.well-known/openid-configuration${path}`,
    `${iu.origin}${path}/.well-known/openid-configuration`,
  ]) {
    if ((as = await getJson(u))) break;
  }
  if (!as?.authorization_endpoint || !as?.token_endpoint) throw new MobbinError(502, "Couldn't find Mobbin's sign-in page. Try again later.");
  return { resource: String(prm?.resource ?? MCP_URL), as, scopesNeeded: prm?.scopes_supported as string[] | undefined };
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64url");

/** Step 1: register this app with Mobbin and build the sign-in link (with PKCE). */
async function begin(redirectUri: string) {
  const { resource, as, scopesNeeded } = await discover();
  let clientId = "";
  if (as.registration_endpoint) {
    const r = await fetch(await mobbinUrl(String(as.registration_endpoint)), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: "Canvas on the go",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    const reg = (await r.json().catch(() => ({}))) as { client_id?: string; error_description?: string };
    if (!r.ok || !reg.client_id) throw new MobbinError(502, `Mobbin didn't accept this app: ${reg.error_description ?? r.status}`);
    clientId = reg.client_id;
  } else {
    throw new MobbinError(502, "Mobbin doesn't allow new apps to register for sign-in.");
  }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const auth = new URL(await mobbinUrl(String(as.authorization_endpoint)));
  // Ask for what Mobbin's MCP server says it needs (as MCP clients do), not everything the sign-in server offers.
  const scopes = scopesNeeded ?? [];
  auth.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource,
    ...(scopes.length ? { scope: scopes.join(" ") } : {}),
  }).toString();
  return { authUrl: auth.toString(), verifier, state, clientId, tokenEndpoint: String(as.token_endpoint), resource };
}

async function tokenCall(tokenEndpoint: string, params: Record<string, string>): Promise<MobbinTokens> {
  const r = await fetch(await mobbinUrl(tokenEndpoint), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const t = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!r.ok || !t.access_token) throw new MobbinError(401, `Mobbin sign-in failed: ${t.error_description ?? t.error ?? r.status}`);
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? params.refresh_token,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
  };
}

// --- MCP over streamable HTTP ---
const rpcHeaders = (token?: string, session?: string) => ({
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": PROTOCOL,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  ...(session ? { "mcp-session-id": session } : {}),
});
const initialize = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "canvas-on-the-go", version: "1.0.0" } },
});

/** Reads a JSON-RPC reply that may come back as plain JSON or as a server-sent event stream. */
async function rpcReply(r: Response, id: number): Promise<Record<string, unknown>> {
  if (r.status === 401) throw new MobbinError(401, "Your Mobbin sign-in has expired. Connect again.");
  if (r.status === 429) throw new MobbinError(429, "Mobbin is rate limiting searches. Wait a minute and try again.");
  if (!r.ok) throw new MobbinError(502, `Mobbin answered ${r.status}.`);
  const text = await r.text();
  const msgs = (r.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => {
          try {
            return JSON.parse(l.slice(5));
          } catch {
            return null;
          }
        })
    : [JSON.parse(text || "null")];
  const msg = msgs.flat().find((m) => m && m.id === id);
  if (!msg) throw new MobbinError(502, "Mobbin sent an answer I couldn't read.");
  if (msg.error) throw new MobbinError(502, `Mobbin: ${msg.error.message ?? "error"}`);
  return msg.result as Record<string, unknown>;
}

async function mcp(token: string) {
  let session: string | undefined;
  let id = 0;
  const call = async (method: string, params: unknown) => {
    const n = ++id;
    const r = await fetch(MCP_URL, {
      method: "POST",
      headers: rpcHeaders(token, session),
      body: JSON.stringify(method === "initialize" ? initialize(n) : { jsonrpc: "2.0", id: n, method, params }),
    });
    session = r.headers.get("mcp-session-id") ?? session;
    return rpcReply(r, n);
  };
  await call("initialize", null);
  await fetch(MCP_URL, {
    method: "POST",
    headers: rpcHeaders(token, session),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => undefined);
  return call;
}

const IMAGE_URL = /^https:\/\/[^\s"')]+?(\.(png|jpe?g|webp|avif)(\?[^\s"')]*)?|[?&](w|width|format|fm)=[^\s"')]*)$/i;

/** Pulls screens (image URL, a title, the Mobbin link) out of whatever shape the tool answered in. */
function screensFrom(result: Record<string, unknown>): MobbinScreen[] {
  const out: MobbinScreen[] = [];
  const seen = new Set<string>();
  const push = (image: string, title: string, link?: string) => {
    if (!image || seen.has(image) || out.length >= 24) return;
    seen.add(image);
    out.push({ image, title: title.trim().slice(0, 80) || "Mobbin screen", link });
  };
  const walk = (v: unknown, ctx: string) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, ctx));
    const o = v as Record<string, unknown>;
    const strings = Object.entries(o).filter(([, x]) => typeof x === "string") as [string, string][];
    const img = strings.find(([k, x]) => /image|screenshot|thumbnail|preview|src/i.test(k) && /^https:\/\//.test(x))?.[1];
    if (img) {
      const name = strings.find(([k]) => /^(app_?name|appName|app|name|title)$/i.test(k))?.[1] ?? ctx;
      const extra = strings.find(([k]) => /^(screen_?name|pattern|element|label|flow_?name)$/i.test(k))?.[1];
      const link = strings.find(([k, x]) => /url|link|href|permalink/i.test(k) && /mobbin\.com/.test(x) && x !== img)?.[1];
      push(img, extra ? `${name} · ${extra}` : name, link);
    }
    const app = strings.find(([k]) => /^(app_?name|appName)$/i.test(k))?.[1];
    for (const [, x] of Object.entries(o)) if (x && typeof x === "object") walk(x, app ?? ctx);
  };
  walk(result.structuredContent, "");
  for (const c of (result.content as { type: string; text?: string; data?: string; mimeType?: string }[] | undefined) ?? []) {
    if (c.type === "image" && c.data) push(`data:${c.mimeType ?? "image/png"};base64,${c.data}`, "Mobbin screen");
    if (c.type !== "text" || !c.text) continue;
    try {
      walk(JSON.parse(c.text), "");
    } catch {
      for (const m of c.text.matchAll(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g)) push(m[2], m[1]);
      for (const m of c.text.matchAll(/https:\/\/[^\s"')\]]+/g)) if (IMAGE_URL.test(m[0])) push(m[0], "");
    }
  }
  return out;
}

/** screens and flows are app UI; sections are parts of websites (heroes, pricing, footers) from Mobbin Sites. */
export type MobbinKind = "screens" | "flows" | "sections";

async function search(token: string, query: string, kind: MobbinKind = "screens", platform: "ios" | "web" = "ios") {
  const call = await mcp(token);
  const tools = ((await call("tools/list", {})).tools as { name: string; inputSchema?: { properties?: Record<string, unknown> } }[]) ?? [];
  const tool = tools.find((t) => t.name === `search_${kind}`) ?? tools.find((t) => /search/.test(t.name));
  if (!tool) throw new MobbinError(502, "Mobbin's search isn't available on this account.");
  const props = Object.keys(tool.inputSchema?.properties ?? {});
  const qKey = props.find((p) => /^(query|q|search|text|prompt)$/i.test(p)) ?? "query";
  const args: Record<string, unknown> = { [qKey]: query };
  if (props.includes("platform")) args.platform = kind === "sections" ? "web" : platform;
  const result = await call("tools/call", { name: tool.name, arguments: args });
  const screens = screensFrom(result);
  // When nothing parsed, send back a little of what Mobbin said, so the problem can be seen and fixed.
  const said = screens.length
    ? undefined
    : JSON.stringify(result).slice(0, 1500);
  return { screens, said };
}

export async function mobbin(req: MobbinRequest) {
  switch (req.action) {
    case "begin":
      return begin(req.redirectUri);
    case "token":
      return tokenCall(req.tokenEndpoint, {
        grant_type: "authorization_code",
        code: req.code,
        code_verifier: req.verifier,
        redirect_uri: req.redirectUri,
        client_id: req.clientId,
        resource: req.resource,
      });
    case "refresh":
      return tokenCall(req.tokenEndpoint, {
        grant_type: "refresh_token",
        refresh_token: req.refreshToken,
        client_id: req.clientId,
        resource: req.resource,
      });
    case "search":
      if (!req.query?.trim()) throw new MobbinError(400, "Type what you're looking for.");
      return search(
        req.accessToken,
        req.query.trim().slice(0, 200),
        (["screens", "flows", "sections"] as const).find((k) => k === req.kind),
        req.platform === "web" ? "web" : "ios",
      );
    default:
      throw new MobbinError(400, "Unknown Mobbin action.");
  }
}

type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** Which image format the bytes are, whatever the server's content-type says. */
function sniff(b: Uint8Array): ImageType | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

// Claude takes images up to 5 MB once base64-encoded.
const MAX_IMAGE_BYTES = 3_700_000;

/**
 * Fetches a reference image at build time (never stored), as base64 for Claude.
 * When it can't, says why in plain words, so the designer learns the build went without it.
 */
export async function fetchImage(url: string): Promise<{ data: string; type: ImageType } | { error: string }> {
  try {
    if (url.startsWith("data:")) {
      const m = /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(url);
      return m ? { data: m[3], type: m[1] as ImageType } : { error: "it isn't a PNG, JPEG, WebP or GIF" };
    }
    if (!url.startsWith("https://")) return { error: "its address isn't secure (https)" };
    // Ask for formats Claude reads, so an image CDN doesn't answer with AVIF.
    const r = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: "image/webp,image/png,image/jpeg;q=0.9,image/*;q=0.5" },
    });
    if (!r.ok) return { error: `the image server answered ${r.status}` };
    const buf = new Uint8Array(await r.arrayBuffer());
    const type = sniff(buf);
    if (!type) return { error: `it came back as ${(r.headers.get("content-type") ?? "an unknown type").split(";")[0]}, which Claude can't read` };
    if (buf.byteLength > MAX_IMAGE_BYTES) return { error: `it's too large (${(buf.byteLength / 1e6).toFixed(1)} MB)` };
    return { data: Buffer.from(buf).toString("base64"), type };
  } catch (e) {
    return { error: (e as Error).name === "TimeoutError" ? "it took too long to load" : "it couldn't be downloaded" };
  }
}
