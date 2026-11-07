import { errorResponse } from "../../../lib/server/errors";
import { getVendorView } from "../../../lib/server/vendors";

export const dynamic = "force-dynamic";

/** GET -> VendorView (public profile + on-chain vendorKey); 404 when unknown */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet } = await params;
    return Response.json(await getVendorView(wallet));
  } catch (err) {
    return errorResponse(err);
  }
}
