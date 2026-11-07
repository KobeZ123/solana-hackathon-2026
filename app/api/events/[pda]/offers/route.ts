import { requireAuth } from "../../../../lib/server/auth";
import { errorResponse, readJson } from "../../../../lib/server/errors";
import { listOffers, putOffer } from "../../../../lib/server/vendors";

export const dynamic = "force-dynamic";

/** POST { text } (JWT vendor) -> 201 OfferView; text must hash to the on-chain offer_hash */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ pda: string }> }
) {
  try {
    const auth = await requireAuth(request);
    const { pda } = await params;
    const body = await readJson(request);
    return Response.json(await putOffer(pda, auth, body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET (JWT host or the offer's vendor) -> { offers: OfferView[] } */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ pda: string }> }
) {
  try {
    const auth = await requireAuth(request);
    const { pda } = await params;
    return Response.json({ offers: await listOffers(pda, auth) });
  } catch (err) {
    return errorResponse(err);
  }
}
