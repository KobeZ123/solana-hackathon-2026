import { issueNonce } from "../../../lib/server/auth";
import {
  errorResponse,
  readJson,
  requireString,
} from "../../../lib/server/errors";

export const dynamic = "force-dynamic";

/** POST { wallet } -> { nonce, message } */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const wallet = requireString(body, "wallet", { max: 64 });
    return Response.json(await issueNonce(wallet));
  } catch (err) {
    return errorResponse(err);
  }
}
