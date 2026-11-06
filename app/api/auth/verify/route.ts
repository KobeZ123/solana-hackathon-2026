import { verifySignIn } from "../../../lib/server/auth";
import {
  errorResponse,
  readJson,
  requireString,
} from "../../../lib/server/errors";

export const dynamic = "force-dynamic";

/** POST { wallet, signature (base58 ed25519 over the nonce message) } -> { token } */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const wallet = requireString(body, "wallet", { max: 64 });
    const signature = requireString(body, "signature", { max: 200 });
    return Response.json({ token: await verifySignIn(wallet, signature) });
  } catch (err) {
    return errorResponse(err);
  }
}
