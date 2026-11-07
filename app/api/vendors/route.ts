import { requireAuth } from "../../lib/server/auth";
import { errorResponse, readJson } from "../../lib/server/errors";
import { upsertVendorProfile } from "../../lib/server/vendors";

export const dynamic = "force-dynamic";

/** POST { name, logoUrl?, description? } (JWT vendor) -> VendorView; needs an on-chain VendorProfile */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    const body = await readJson(request);
    return Response.json(await upsertVendorProfile(auth, body));
  } catch (err) {
    return errorResponse(err);
  }
}
