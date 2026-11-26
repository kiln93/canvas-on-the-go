// Mobbin on the device: the sign-in tokens live only in this browser (never in the project or the repo),
// and the server just relays each call to Mobbin. See server/mobbin.ts.
import type { MobbinAuth, MobbinScreen, MobbinTokens } from "../server/mobbin";

const KEY = "cotg.mobbin";
const PENDING = "cotg.mobbin.pending";

type Saved = { auth: MobbinAuth; tokens: MobbinTokens };

const read = <T,>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "null") as T | null;
  } catch {
    return null;
  }
};
const redirectUri = () => `${location.origin}/`;

async function call<T>(body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/mobbin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("You're offline. Try again when you're connected.");
  }
  const data = (await res.json().catch(() => ({ error: `Server error ${res.status}` }))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Error ${res.status}`), { status: res.status });
  return data;
}

export const mobbinConnected = () => !!read<Saved>(KEY)?.tokens?.accessToken;
export const disconnectMobbin = () => localStorage.removeItem(KEY);

/** Sends the browser to Mobbin's sign-in; it comes back to this app with a code. */
export async function connectMobbin(frameId: string) {
  const out = await call<{ authUrl: string; verifier: string; state: string } & MobbinAuth>({
    action: "begin",
    redirectUri: redirectUri(),
  });
  localStorage.setItem(PENDING, JSON.stringify({ ...out, frameId }));
  location.href = out.authUrl;
}

/**
 * Run once at startup: finishes a Mobbin sign-in if the page was opened by Mobbin's redirect.
 * Returns the frame to reopen (with the picker), or an error to show.
 */
export async function finishMobbinSignIn(): Promise<{ frameId?: string; error?: string } | null> {
  const q = new URLSearchParams(location.search);
  const pending = read<{ verifier: string; state: string; frameId: string } & MobbinAuth>(PENDING);
  if (!pending || !(q.has("code") || q.has("error")) || q.get("state") !== pending.state) return null;
  history.replaceState(null, "", "/");
  localStorage.removeItem(PENDING);
  if (q.has("error")) return { frameId: pending.frameId, error: q.get("error_description") ?? "Mobbin sign-in was cancelled." };
  try {
    const tokens = await call<MobbinTokens>({
      action: "token",
      code: q.get("code"),
      verifier: pending.verifier,
      redirectUri: redirectUri(),
      clientId: pending.clientId,
      tokenEndpoint: pending.tokenEndpoint,
      resource: pending.resource,
    });
    const auth: MobbinAuth = { clientId: pending.clientId, tokenEndpoint: pending.tokenEndpoint, resource: pending.resource };
    localStorage.setItem(KEY, JSON.stringify({ auth, tokens }));
    return { frameId: pending.frameId };
  } catch (e) {
    return { frameId: pending.frameId, error: (e as Error).message };
  }
}

async function refresh(saved: Saved): Promise<Saved | null> {
  if (!saved.tokens.refreshToken) return null;
  try {
    const tokens = await call<MobbinTokens>({ action: "refresh", refreshToken: saved.tokens.refreshToken, ...saved.auth });
    const next = { auth: saved.auth, tokens };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

/** Searches Mobbin's screens or flows. Refreshes the sign-in once if it has expired. */
export async function searchMobbin(query: string, kind: "screens" | "flows") {
  let saved = read<Saved>(KEY);
  if (!saved) throw new Error("Connect Mobbin first.");
  if (saved.tokens.expiresAt && saved.tokens.expiresAt < Date.now() + 30_000) saved = (await refresh(saved)) ?? saved;
  const go = (s: Saved) => call<{ screens: MobbinScreen[]; said?: string }>({ action: "search", accessToken: s.tokens.accessToken, query, kind });
  try {
    return await go(saved);
  } catch (e) {
    if ((e as { status?: number }).status !== 401) throw e;
    const again = await refresh(saved);
    if (!again) {
      disconnectMobbin();
      throw new Error("Your Mobbin sign-in has expired. Connect again.");
    }
    return go(again);
  }
}
