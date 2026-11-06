/** An error that maps to an HTTP response. Route handlers turn it into `{ error }` JSON. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error("Unhandled API error", err);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

/** Parse a JSON object body or throw 400. */
export async function readJson(
  request: Request
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function requireString(
  body: Record<string, unknown>,
  key: string,
  { max = 10_000 }: { max?: number } = {}
): string {
  const v = body[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ApiError(400, `Field "${key}" must be a non-empty string`);
  }
  if (v.length > max) throw new ApiError(400, `Field "${key}" is too long`);
  return v;
}
