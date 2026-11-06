import { requireAuth } from "../../../../lib/server/auth";
import { errorResponse } from "../../../../lib/server/errors";
import { getEventDetails } from "../../../../lib/server/events";

export const dynamic = "force-dynamic";

/** GET (JWT) -> { eventPda, title, summary, coverUrl, details }; 401 / 403 / 404 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ pda: string }> }
) {
  try {
    const auth = await requireAuth(request);
    const { pda } = await params;
    return Response.json(await getEventDetails(pda, auth));
  } catch (err) {
    return errorResponse(err);
  }
}
