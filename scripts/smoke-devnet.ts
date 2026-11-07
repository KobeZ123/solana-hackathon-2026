/**
 * Live devnet smoke check. Run: npx tsx scripts/smoke-devnet.ts
 *
 * 1. Fetches the program account over RPC and confirms it is executable (required).
 * 2. If SMOKE_FULL=1 (or the script can airdrop), creates a test event with a throwaway host
 *    and joins it with a throwaway member (both funded by devnet airdrop). Skipped otherwise.
 * Env: SOLANA_RPC_URL (default devnet), NEXT_PUBLIC_PROGRAM_ID, SMOKE_FULL=0 to skip step 2.
 * Prints PASS/FAIL; exit code 1 on FAIL. Devnet only.
 */
import {
  address,
  airdropFactory,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  EVENT_POOL_PROGRAM_ADDRESS,
  findEventPda,
  findTicketPda,
  findVaultPda,
  getCreateEventInstruction,
  getJoinEventInstruction,
} from "../app/generated/event_pool";

const HTTP = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
if (/mainnet/i.test(HTTP)) {
  console.error("FAIL: refusing to run against mainnet");
  process.exit(1);
}
const WS = HTTP.replace(/^http/, "ws");
const PROGRAM = process.env.NEXT_PUBLIC_PROGRAM_ID
  ? address(process.env.NEXT_PUBLIC_PROGRAM_ID)
  : EVENT_POOL_PROGRAM_ADDRESS;

const rpc = createSolanaRpc(HTTP);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions,
});
const airdrop = airdropFactory({ rpc, rpcSubscriptions });

async function send(payer: TransactionSigner, ixs: Instruction[]) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(ixs, m)
    )
  );
  await sendAndConfirm(tx as never, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}

async function main() {
  console.log(`rpc: ${HTTP}\nprogram: ${PROGRAM}`);
  const { value: acct } = await rpc
    .getAccountInfo(PROGRAM, { encoding: "base64" })
    .send();
  if (!acct) throw new Error("program account not found on this cluster");
  if (!acct.executable) throw new Error("program account is not executable");
  console.log("ok: program account exists and is executable");

  if (process.env.SMOKE_FULL === "0") {
    console.log("skipping create/join (SMOKE_FULL=0)");
    return;
  }
  const host = await generateKeyPairSigner();
  const member = await generateKeyPairSigner();
  try {
    await airdrop({
      recipientAddress: host.address,
      lamports: lamports(500_000_000n),
      commitment: "confirmed",
    });
    await airdrop({
      recipientAddress: member.address,
      lamports: lamports(500_000_000n),
      commitment: "confirmed",
    });
  } catch (e) {
    console.log(
      `skipping create/join: airdrop unavailable (${(e as Error).message.slice(0, 80)})`
    );
    return;
  }
  const eventId = BigInt(Date.now());
  const [event] = await findEventPda(
    { host: host.address, eventId },
    { programAddress: PROGRAM }
  );
  const [vault] = await findVaultPda({ event }, { programAddress: PROGRAM });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const sig1 = await send(host, [
    getCreateEventInstruction(
      {
        host,
        event,
        vault,
        eventId,
        entryFee: 1_000_000n,
        capacity: 5,
        startTs: now + 3600n,
        endTs: now + 7200n,
        payoutBps: 0,
        metadataHash: new Uint8Array(32),
      },
      { programAddress: PROGRAM }
    ),
  ]);
  console.log(`ok: create_event ${sig1}`);
  const [ticket] = await findTicketPda(
    { event, member: member.address },
    { programAddress: PROGRAM }
  );
  const ticketKey = (await generateKeyPairSigner()).address;
  const sig2 = await send(member, [
    getJoinEventInstruction(
      { member, event, vault, ticket, ticketKey },
      { programAddress: PROGRAM }
    ),
  ]);
  console.log(`ok: join_event ${sig2}`);
}

main().then(
  () => console.log("PASS"),
  (e) => {
    console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
);
