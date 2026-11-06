import type { Address } from "@solana/kit";
import { findEventPda, findVaultPda } from "../../generated/event_pool";

export async function deriveEventAddress(
  host: Address,
  eventId: bigint
): Promise<Address> {
  const [pda] = await findEventPda({ host, eventId });
  return pda;
}

export async function deriveVaultAddress(event: Address): Promise<Address> {
  const [pda] = await findVaultPda({ event });
  return pda;
}
