import { optionalAuth } from "../../../lib/server/auth";
import { errorResponse } from "../../../lib/server/errors";
import { getEventSummary } from "../../../lib/server/events";

export const dynamic = "force-dynamic";

/** GET (optional JWT) -> EventSummary; 404 if unknown */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ pda: string }> }
) {
  try {
    const { pda } = await params;
    const viewer = await optionalAuth(request);
    return Response.json(await getEventSummary(pda, viewer));
  } catch (err) {
    return errorResponse(err);
  }
}
