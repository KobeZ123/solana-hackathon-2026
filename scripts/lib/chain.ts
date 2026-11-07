/**
 * Chain helpers for the localnet e2e scripts: RPC, funded keypairs, transaction
 * building/sending with @solana/kit, and balance reads. No websockets: sending
 * polls signature statuses so only the HTTP RPC port is needed.
 */
import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";

export const RPC_PORT = process.env.E2E_RPC_PORT ?? "8899";
export const RPC_URL =
  process.env.E2E_RPC_URL ?? `http://127.0.0.1:${RPC_PORT}`;

/** Lamports charged per signature on localnet (default fee schedule). */
export const SIGNATURE_FEE = 5000n;

export const rpc = createSolanaRpc(RPC_URL);

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function getBalance(address: Address): Promise<bigint> {
  const { value } = await rpc
    .getBalance(address, { commitment: "confirmed" })
    .send();
  return BigInt(value);
}

/** Rent-exempt minimum for an account with `dataLen` bytes of data. */
export async function rentMinimum(dataLen = 0n): Promise<bigint> {
  return BigInt(await rpc.getMinimumBalanceForRentExemption(dataLen).send());
}

const json = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

async function waitForSignature(
  signature: Signature,
  timeoutMs = 30_000,
  resend?: () => Promise<unknown>
) {
  const deadline = Date.now() + timeoutMs;
  let lastSend = Date.now();
  while (Date.now() < deadline) {
    // Early in a fresh validator's life the first send can be dropped; resend.
    if (resend && Date.now() - lastSend > 2000) {
      lastSend = Date.now();
      await resend().catch(() => undefined);
    }
    const { value } = await rpc
      .getSignatureStatuses([signature], { searchTransactionHistory: true })
      .send();
    const status = value[0];
    if (status) {
      if (status.err) {
        throw new Error(`transaction failed: ${json(status.err)}`);
      }
      if (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      ) {
        return;
      }
    }
    await sleep(200);
  }
  const st = await rpc.getSignatureStatuses([signature]).send();
  throw new Error(
    `timed out confirming ${signature} status=${json(st.value)} slot=${await rpc.getSlot().send()}`
  );
}

/**
 * Build, sign (signers attached to the instruction accounts plus the fee
 * payer) and send one transaction. Throws if preflight or execution fails; the
 * message includes the program log lines that carry the error.
 */
export async function send(
  feePayer: KeyPairSigner,
  instructions: Instruction[]
): Promise<Signature> {
  const { value: blockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m)
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);
  const submit = (skipPreflight: boolean) =>
    rpc
      .sendTransaction(wire, {
        encoding: "base64",
        preflightCommitment: "confirmed",
        skipPreflight,
      })
      .send();
  try {
    await submit(false);
  } catch (e) {
    const cause = (e as { cause?: { data?: { logs?: string[] } } }).cause;
    const logs = cause?.data?.logs
      ?.filter((l) => /error|failed/i.test(l))
      .join(" | ");
    throw new Error(
      `send failed: ${(e as Error).message}${logs ? ` [${logs}]` : ""}`
    );
  }
  await waitForSignature(signature, 30_000, () => submit(true));
  return signature;
}

export async function airdrop(address: Address, amount: bigint) {
  const sig = await rpc
    .requestAirdrop(address, lamports(amount), { commitment: "confirmed" })
    .send();
  await waitForSignature(sig);
}

/** Fresh keypair funded from the local faucet. */
export async function fundedSigner(sol = 5n): Promise<KeyPairSigner> {
  const signer = await generateKeyPairSigner();
  await airdrop(signer.address, sol * 1_000_000_000n);
  return signer;
}

/** Validator clock (unix seconds) from the latest block time. */
export async function chainNow(): Promise<number> {
  const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
  return Number(await rpc.getBlockTime(slot).send());
}

/**
 * A freshly started validator can drop or stall the first transactions while
 * it warms up. Wait for a few slots and a usable block time before starting.
 */
export async function warmUp(minSlot = 20n) {
  while ((await rpc.getSlot({ commitment: "confirmed" }).send()) < minSlot) {
    await sleep(300);
  }
  await chainNow();
}

/** Sleep until the validator clock is strictly past `ts`. */
export async function waitUntilChainPast(ts: number) {
  while ((await chainNow()) <= ts) await sleep(500);
}
