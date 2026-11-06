import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
} from "@solana/kit";
import {
  getEventPoolErrorMessage,
  EVENT_POOL_ERROR__INVALID_TIME_RANGE,
  EVENT_POOL_ERROR__MATH_OVERFLOW,
  type EventPoolError,
} from "../generated/event_pool";

// Program error codes are contiguous, first and last variant bound the range.
// Stretch-A errors appended later extend the range: update the upper bound then.
function isEventPoolErrorCode(code: number): code is EventPoolError {
  return (
    code >= EVENT_POOL_ERROR__INVALID_TIME_RANGE &&
    code <= EVENT_POOL_ERROR__MATH_OVERFLOW
  );
}

export function parseTransactionError(err: unknown): string {
  // Wallet rejection (comes from wallet-standard, not a SolanaError)
  if (err instanceof Error && err.message.includes("User rejected")) {
    return "Transaction was rejected by the wallet.";
  }

  // Anchor custom program errors — use the Codama-generated error messages
  if (
    isSolanaError(err, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
    typeof err.context?.code === "number"
  ) {
    const code = err.context.code;
    if (isEventPoolErrorCode(code)) {
      return getEventPoolErrorMessage(code);
    }
  }

  // For all other errors, kit's SolanaError already has readable messages.
  // Walk the cause chain to find the deepest message.
  const message = getDeepestMessage(err);
  return message.length > 200 ? `${message.slice(0, 200)}...` : message;
}

function getDeepestMessage(err: unknown): string {
  let deepest = err instanceof Error ? err.message : String(err);
  let current: unknown = err;

  while (current instanceof Error && current.cause) {
    current = current.cause;
    if (current instanceof Error) {
      deepest = current.message;
    }
  }

  return deepest;
}
