import { randomBytes } from "node:crypto";
import { getAddressEncoder, getBase58Encoder, isAddress } from "@solana/kit";
import { jwtVerify, SignJWT } from "jose";
import { buildSignInMessage } from "../auth-message";
import { ApiError } from "./errors";
import { getStore, type Store } from "./store";

export const NONCE_TTL_MS = 5 * 60 * 1000;
export const TOKEN_TTL_SECS = 12 * 60 * 60;

const DEV_SECRET = "dev-only-insecure-jwt-secret";
let warned = false;

function jwtKey(secret = process.env.JWT_SECRET): Uint8Array {
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set in production");
    }
    if (!warned) {
      warned = true;
      console.warn("[auth] JWT_SECRET not set; using an insecure dev secret");
    }
    secret = DEV_SECRET;
  }
  return new TextEncoder().encode(secret);
}

export interface AuthDeps {
  store?: Store;
  now?: () => number; // unix ms
  secret?: string;
}

/** Create and store a fresh nonce for `wallet`; returns the message the wallet must sign. */
export async function issueNonce(
  wallet: string,
  deps: AuthDeps = {}
): Promise<{ nonce: string; message: string }> {
  if (!isAddress(wallet)) throw new ApiError(400, "Invalid wallet address");
  const now = (deps.now ?? Date.now)();
  const nonce = randomBytes(16).toString("hex");
  await (deps.store ?? getStore()).putNonce({
    wallet,
    nonce,
    expiresAt: now + NONCE_TTL_MS,
  });
  return { nonce, message: buildSignInMessage(nonce) };
}

/** Verify an ed25519 signature (raw 64 bytes, base58) by `wallet` over `message` bytes. */
export async function verifyWalletSignature(
  wallet: string,
  message: string,
  signatureBase58: string
): Promise<boolean> {
  try {
    const sig = new Uint8Array(getBase58Encoder().encode(signatureBase58));
    if (sig.length !== 64) return false;
    const pub = new Uint8Array(getAddressEncoder().encode(wallet as never));
    const key = await crypto.subtle.importKey("raw", pub, "Ed25519", false, [
      "verify",
    ]);
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      sig,
      new TextEncoder().encode(message)
    );
  } catch {
    return false;
  }
}

/**
 * Consume the wallet's nonce (single use, 5 min TTL), verify the signature over
 * `buildSignInMessage(nonce)`, and return a 12 h HS256 JWT (`sub` = wallet).
 */
export async function verifySignIn(
  wallet: string,
  signature: string,
  deps: AuthDeps = {}
): Promise<string> {
  if (!isAddress(wallet)) throw new ApiError(400, "Invalid wallet address");
  const now = (deps.now ?? Date.now)();
  const rec = await (deps.store ?? getStore()).consumeNonce(wallet, now);
  if (!rec) throw new ApiError(401, "Nonce missing, expired, or already used");
  const ok = await verifyWalletSignature(
    wallet,
    buildSignInMessage(rec.nonce),
    signature
  );
  if (!ok) throw new ApiError(401, "Invalid signature");
  return signToken(wallet, deps);
}

export async function signToken(
  wallet: string,
  deps: AuthDeps = {}
): Promise<string> {
  const iat = Math.floor((deps.now ?? Date.now)() / 1000);
  return new SignJWT({ wallet })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(wallet)
    .setIssuedAt(iat)
    .setExpirationTime(iat + TOKEN_TTL_SECS)
    .sign(jwtKey(deps.secret));
}

export interface AuthContext {
  wallet: string;
}

async function verifyToken(
  token: string,
  deps: AuthDeps
): Promise<AuthContext | null> {
  try {
    const { payload } = await jwtVerify(token, jwtKey(deps.secret), {
      algorithms: ["HS256"],
      currentDate: new Date((deps.now ?? Date.now)()),
    });
    return typeof payload.sub === "string" ? { wallet: payload.sub } : null;
  } catch {
    return null;
  }
}

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization");
  const m = h && /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

/** Require a valid bearer JWT or throw ApiError(401). */
export async function requireAuth(
  request: Request,
  deps: AuthDeps = {}
): Promise<AuthContext> {
  const token = bearer(request);
  if (!token) throw new ApiError(401, "Missing bearer token");
  const ctx = await verifyToken(token, deps);
  if (!ctx) throw new ApiError(401, "Invalid or expired token");
  return ctx;
}

/** Returns the caller when a valid token is present, null when absent or invalid. */
export async function optionalAuth(
  request: Request,
  deps: AuthDeps = {}
): Promise<AuthContext | null> {
  const token = bearer(request);
  return token ? verifyToken(token, deps) : null;
}
