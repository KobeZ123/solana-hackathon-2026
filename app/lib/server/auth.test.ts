import { describe, expect, it } from "vitest";
import { buildSignInMessage } from "../auth-message";
import {
  NONCE_TTL_MS,
  TOKEN_TTL_SECS,
  issueNonce,
  optionalAuth,
  requireAuth,
  signToken,
  verifySignIn,
} from "./auth";
import { ApiError } from "./errors";
import { makeWallet, tempFileStore } from "./testing";

const secret = "test-secret";
const req = (token?: string) =>
  new Request("http://x/api", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

async function setup(now = 1_000_000) {
  const clock = { t: now };
  const deps = { store: tempFileStore(), now: () => clock.t, secret };
  return { clock, deps, wallet: await makeWallet() };
}

describe("sign-in message", () => {
  it("has the documented exact format", () => {
    expect(buildSignInMessage("abc")).toBe("Sign in to Event Pool: abc");
  });
});

describe("nonce + verify", () => {
  it("accepts a valid signature and returns a working token", async () => {
    const { deps, wallet } = await setup();
    const { nonce, message } = await issueNonce(wallet.address, deps);
    expect(message).toBe(buildSignInMessage(nonce));
    const token = await verifySignIn(
      wallet.address,
      await wallet.sign(message),
      deps
    );
    expect((await requireAuth(req(token), deps)).wallet).toBe(wallet.address);
  });

  it("nonce is single use", async () => {
    const { deps, wallet } = await setup();
    const { message } = await issueNonce(wallet.address, deps);
    const sig = await wallet.sign(message);
    await verifySignIn(wallet.address, sig, deps);
    await expect(verifySignIn(wallet.address, sig, deps)).rejects.toMatchObject(
      { status: 401 }
    );
  });

  it("nonce expires after the TTL", async () => {
    const { deps, wallet, clock } = await setup();
    const { message } = await issueNonce(wallet.address, deps);
    clock.t += NONCE_TTL_MS + 1;
    await expect(
      verifySignIn(wallet.address, await wallet.sign(message), deps)
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a signature from a different key, and burns the nonce", async () => {
    const { deps, wallet } = await setup();
    const other = await makeWallet();
    const { message } = await issueNonce(wallet.address, deps);
    await expect(
      verifySignIn(wallet.address, await other.sign(message), deps)
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      verifySignIn(wallet.address, await wallet.sign(message), deps)
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a signature over a different message and garbage input", async () => {
    const { deps, wallet } = await setup();
    await issueNonce(wallet.address, deps);
    await expect(
      verifySignIn(wallet.address, await wallet.sign("something else"), deps)
    ).rejects.toBeInstanceOf(ApiError);
    await issueNonce(wallet.address, deps);
    await expect(
      verifySignIn(wallet.address, "not-base58-!!", deps)
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects invalid wallet addresses", async () => {
    const { deps } = await setup();
    await expect(issueNonce("nope", deps)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("tokens", () => {
  it("expire after 12 hours", async () => {
    const { deps, wallet, clock } = await setup();
    const token = await signToken(wallet.address, deps);
    clock.t += (TOKEN_TTL_SECS - 5) * 1000;
    await expect(requireAuth(req(token), deps)).resolves.toBeTruthy();
    clock.t += 10 * 1000;
    await expect(requireAuth(req(token), deps)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects missing, malformed and wrongly-signed tokens", async () => {
    const { deps, wallet } = await setup();
    await expect(requireAuth(req(), deps)).rejects.toMatchObject({
      status: 401,
    });
    await expect(requireAuth(req("junk"), deps)).rejects.toMatchObject({
      status: 401,
    });
    const forged = await signToken(wallet.address, {
      ...deps,
      secret: "other",
    });
    await expect(requireAuth(req(forged), deps)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("optionalAuth returns null instead of throwing", async () => {
    const { deps, wallet } = await setup();
    expect(await optionalAuth(req(), deps)).toBeNull();
    expect(await optionalAuth(req("junk"), deps)).toBeNull();
    const token = await signToken(wallet.address, deps);
    expect((await optionalAuth(req(token), deps))?.wallet).toBe(wallet.address);
  });
});
