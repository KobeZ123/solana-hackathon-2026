import { requireAuth } from "../../../lib/server/auth";
import { errorResponse } from "../../../lib/server/errors";
import { getNetwork } from "../../../lib/server/network";

export const dynamic = "force-dynamic";

/** GET (JWT) -> NetworkSummary: peers (strong/weak, shared events), totals, unlockable. */
export async function GET(request: Request) {
  try {
    const viewer = await requireAuth(request);
    return Response.json(await getNetwork(viewer));
  } catch (err) {
    return errorResponse(err);
  }
}
