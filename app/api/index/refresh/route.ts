import { refreshAttendance } from "../../../lib/server/attendance";
import { errorResponse } from "../../../lib/server/errors";
import { requireCronSecret } from "../../../lib/server/network";

export const dynamic = "force-dynamic";

/** POST with `Authorization: Bearer $CRON_SECRET` -> { indexed }. Not throttled. */
export async function POST(request: Request) {
  try {
    requireCronSecret(request);
    return Response.json(await refreshAttendance());
  } catch (err) {
    return errorResponse(err);
  }
}

/** Vercel Cron issues GET (with `Authorization: Bearer $CRON_SECRET`); same behaviour as POST. */
export async function GET(request: Request) {
  return POST(request);
}
