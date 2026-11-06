import { toBase58 } from "./qr/base58";

/**
 * Browser API client for `/api/*` with sign-in-with-wallet auth.
 *
 * The JWT is kept in memory and mirrored to sessionStorage (every storage
 * access is wrapped in try/catch; the client works without it).
 */

const SESSION_KEY = "event-pool:auth";

export type AuthSession = { wallet: string; token: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Listener = () => void;

let session: AuthSession | null = null;
let hydrated = false;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function readStorage(): AuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as AuthSession).wallet === "string" &&
      typeof (parsed as AuthSession).token === "string"
    ) {
      return parsed as AuthSession;
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return null;
}

function writeStorage(value: AuthSession | null) {
  try {
    if (value) {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } else {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** Read the `exp` claim (unix seconds) of a JWT without verifying it. */
export function jwtExpiry(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

function isExpired(token: string, now = Date.now() / 1000): boolean {
  const exp = jwtExpiry(token);
  return exp !== null && exp - 30 <= now;
}

/** Current session, hydrating from sessionStorage on first use. Expired tokens are dropped. */
export function getSession(): AuthSession | null {
  if (!hydrated && typeof window !== "undefined") {
    hydrated = true;
    session = readStorage();
  }
  if (session && isExpired(session.token)) {
    // No emit: this runs inside useSyncExternalStore snapshots.
    session = null;
    writeStorage(null);
    return null;
  }
  return session;
}

export function setSession(next: AuthSession) {
  hydrated = true;
  session = next;
  writeStorage(next);
  emit();
}

export function clearSession() {
  hydrated = true;
  const had = session !== null;
  session = null;
  writeStorage(null);
  if (had) emit();
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Token for `wallet` if signed in as that wallet, else null. */
export function getToken(wallet?: string): string | null {
  const s = getSession();
  if (!s) return null;
  if (wallet !== undefined && s.wallet !== wallet) return null;
  return s.token;
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    const m = body.error ?? body.message;
    if (typeof m === "string") message = m;
  } catch {
    /* non-JSON body */
  }
  return new ApiError(res.status, message);
}

/**
 * `fetch` wrapper for API routes: adds `Authorization: Bearer <token>` when
 * signed in and clears the session on 401. Returns the raw Response.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && token) clearSession();
  return res;
}

/** `apiFetch` + JSON parse; throws `ApiError` on non-2xx. */
export async function apiJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

/**
 * Sign-in-with-wallet:
 * `POST /api/auth/nonce {wallet}` -> `{nonce, message}`; the wallet signs the
 * returned `message` verbatim; `POST /api/auth/verify {wallet, signature}`
 * (base58 signature) -> `{token}`. Stores and returns the token.
 */
export async function signInWithWallet(
  wallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const post = async (path: string, body: unknown) => {
    const res = await fetchImpl(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await errorFrom(res);
    return (await res.json()) as Record<string, unknown>;
  };

  const { message } = await post("/api/auth/nonce", { wallet });
  if (typeof message !== "string") {
    throw new ApiError(500, "Auth nonce response missing message");
  }
  const signature = await signMessage(new TextEncoder().encode(message));
  const { token } = await post("/api/auth/verify", {
    wallet,
    signature: toBase58(signature),
  });
  if (typeof token !== "string") {
    throw new ApiError(500, "Auth verify response missing token");
  }
  setSession({ wallet, token });
  return token;
}
