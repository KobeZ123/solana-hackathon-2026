import {
  AccountRole,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;

/** System Program `Transfer` instruction (no system-program client is installed). */
export function getTransferSolInstruction(args: {
  source: TransactionSigner;
  destination: Address;
  amount: bigint;
}): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, args.amount, true);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      {
        address: args.source.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: args.source,
      },
      { address: args.destination, role: AccountRole.WRITABLE },
    ],
    data,
  } as Instruction;
}
