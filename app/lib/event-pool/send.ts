import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import {
  getClusterUrl,
  getClusterWsConfig,
  type ClusterMoniker,
} from "../solana-client";

/**
 * Build a sender whose fee payer and signer is `payer` (used for the gate key:
 * no wallet popup). Returns the signature string.
 */
export function createPayerSender(
  cluster: ClusterMoniker,
  payer: TransactionSigner
) {
  const client = createClient({
    url: getClusterUrl(cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(cluster),
    payer,
  });
  return async (instructions: readonly Instruction[]): Promise<string> => {
    const result = await client.sendTransaction([...instructions]);
    return result.context.signature;
  };
}

/**
 * Custom program error code carried by a send failure (searches the cause
 * chain, since preflight failures wrap the instruction error), or null.
 */
export function programErrorCode(err: unknown): number | null {
  let current: unknown = err;
  for (let i = 0; i < 8 && current; i++) {
    if (
      isSolanaError(current, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
      typeof current.context?.code === "number"
    ) {
      return current.context.code;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}
