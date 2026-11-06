import { optionalAuth, requireAuth } from "../../lib/server/auth";
import { errorResponse, readJson } from "../../lib/server/errors";
import { createEvent, listEvents } from "../../lib/server/events";

export const dynamic = "force-dynamic";

/** POST { eventPda, title, summary, coverUrl?, details, visibility? } (JWT, host) -> 201 EventSummary */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    const body = await readJson(request);
    return Response.json(await createEvent(auth, body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET (optional JWT) -> { events: EventSummary[] } */
export async function GET(request: Request) {
  try {
    const viewer = await optionalAuth(request);
    return Response.json({ events: await listEvents(viewer) });
  } catch (err) {
    return errorResponse(err);
  }
}
