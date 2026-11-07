import {
  EVENT_POOL_ERROR__EVENT_NOT_ENDED,
  EVENT_POOL_ERROR__EVENT_NOT_OPEN,
  EVENT_POOL_ERROR__INVALID_SPONSORSHIP_STATUS,
  EVENT_POOL_ERROR__NOT_GATE_AUTHORITY,
  EVENT_POOL_ERROR__SPONSORSHIP_BUDGET_EXCEEDED,
} from "../../generated/event_pool";
import { parseTransactionError } from "../errors";
import { programErrorCode } from "./send";

/** Friendly copy for sponsorship transaction failures; falls back to the generic parser. */
export function sponsorshipErrorMessage(err: unknown): string {
  switch (programErrorCode(err)) {
    case EVENT_POOL_ERROR__SPONSORSHIP_BUDGET_EXCEEDED:
      return "This sponsorship is bigger than the host budget still available (the host share of the pool minus what is already approved). Reject it, or approve it after more tickets are sold.";
    case EVENT_POOL_ERROR__INVALID_SPONSORSHIP_STATUS:
      return "This sponsorship changed state in the meantime. Refresh and check its status.";
    case EVENT_POOL_ERROR__EVENT_NOT_OPEN:
      return "The event is no longer open, so this can not be done any more.";
    case EVENT_POOL_ERROR__EVENT_NOT_ENDED:
      return "The event has not ended yet. This works after the host ends the event.";
    case EVENT_POOL_ERROR__NOT_GATE_AUTHORITY:
      return "The gate key is not authorized for this event. Authorize it on the scanner page.";
    default:
      return parseTransactionError(err);
  }
}
