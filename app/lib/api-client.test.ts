import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import {
  ApiError,
  apiFetch,
  clearSession,
  getSession,
  getToken,
  jwtExpiry,
  setSession,
  signInWithWallet,
} from "./api-client";
import { fromBase58 } from "./qr/base58";

function jwt(exp: number): string {
  const enc = (o: object) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${enc({ alg: "HS256" })}.${enc({ exp })}.sig`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;

beforeEach(() => {
  vi.stubGlobal("window", undefined);
  clearSession();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jwtExpiry", () => {
  it("reads exp and tolerates junk", () => {
    expect(jwtExpiry(jwt(123))).toBe(123);
    expect(jwtExpiry("abc")).toBeNull();
    expect(jwtExpiry("a.b.c")).toBeNull();
  });
});

describe("session store", () => {
  it("works without sessionStorage", () => {
    setSession({ wallet: "W", token: jwt(future()) });
    expect(getToken("W")).toBeTruthy();
    expect(getToken("other")).toBeNull();
    clearSession();
    expect(getSession()).toBeNull();
  });

  it("drops expired tokens", () => {
    setSession({ wallet: "W", token: jwt(Math.floor(Date.now() / 1000) - 5) });
    expect(getToken()).toBeNull();
  });

  it("does not throw when sessionStorage throws", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() =>
      setSession({ wallet: "W", token: jwt(future()) })
    ).not.toThrow();
    expect(getToken("W")).toBeTruthy();
  });
});

describe("apiFetch", () => {
  it("adds the bearer token and JSON content type", async () => {
    const token = jwt(future());
    setSession({ wallet: "W", token });
    const spy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await apiFetch("/api/events", { method: "POST", body: "{}" });
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("sends no auth header when signed out and clears on 401", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await apiFetch("/api/events");
    expect(
      new Headers((spy.mock.calls[0][1] as RequestInit).headers).has(
        "Authorization"
      )
    ).toBe(false);

    setSession({ wallet: "W", token: jwt(future()) });
    spy.mockResolvedValue(new Response("{}", { status: 401 }));
    await apiFetch("/api/events/x/details");
    expect(getSession()).toBeNull();
  });
});

describe("signInWithWallet", () => {
  it("signs the nonce message verbatim and stores the token", async () => {
    const kp = nacl.sign.keyPair();
    const message = "Sign in to SOLSocial: abc123";
    const token = jwt(future());
    const calls: { path: string; body: Record<string, string> }[] = [];
    const fetchImpl = vi.fn(async (path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ path, body });
      if (path === "/api/auth/nonce") {
        return Response.json({ nonce: "abc123", message });
      }
      return Response.json({ token });
    }) as unknown as typeof fetch;

    const result = await signInWithWallet(
      "W",
      async (m) => nacl.sign.detached(m, kp.secretKey),
      fetchImpl
    );

    expect(result).toBe(token);
    expect(calls.map((c) => c.path)).toEqual([
      "/api/auth/nonce",
      "/api/auth/verify",
    ]);
    expect(calls[0].body).toEqual({ wallet: "W" });
    const sig = fromBase58(calls[1].body.signature);
    expect(
      nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        sig,
        kp.publicKey
      )
    ).toBe(true);
    expect(getToken("W")).toBe(token);
  });

  it("surfaces API errors", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "nope" }, { status: 429 })
    ) as unknown as typeof fetch;
    await expect(
      signInWithWallet("W", async () => new Uint8Array(64), fetchImpl)
    ).rejects.toMatchObject({ status: 429, message: "nope" });
    await expect(
      signInWithWallet("W", async () => new Uint8Array(64), fetchImpl)
    ).rejects.toBeInstanceOf(ApiError);
    expect(getSession()).toBeNull();
  });
});
