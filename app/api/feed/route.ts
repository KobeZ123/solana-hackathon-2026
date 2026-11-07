import { optionalAuth } from "../../lib/server/auth";
import { errorResponse } from "../../lib/server/errors";
import { listEvents } from "../../lib/server/events";

export const dynamic = "force-dynamic";

/**
 * GET (optional JWT) -> { events: (EventSummary & { via })[] }. Public events plus
 * `network` events whose host is within 1 hop of the viewer; `?strong=1` keeps only
 * strong-tie network events. Anonymous callers get public events.
 */
export async function GET(request: Request) {
  try {
    const viewer = await optionalAuth(request);
    const strong = new URL(request.url).searchParams.get("strong") === "1";
    return Response.json({ events: await listEvents(viewer, {}, { strong }) });
  } catch (err) {
    return errorResponse(err);
  }
}
