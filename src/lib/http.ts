import { z } from "zod";
import { appUrl } from "./config";
import { one } from "./db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function apiError(error: unknown) {
  if (error instanceof HttpError) return privateJson({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return privateJson({ error: error.issues[0]?.message || "Invalid request" }, 400);
  if (error instanceof SyntaxError) return privateJson({ error: "Invalid JSON request" }, 400);
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return privateJson({ error: "That value is already in use." }, 409);
  if (code === "BT001") return privateJson({ error: "Registration is closed for this season." }, 409);
  if (code === "BT002") return privateJson({ error: "This security is no longer eligible." }, 400);
  console.error("Request failed", code ?? (error instanceof Error ? error.name : "Unknown"));
  return privateJson({ error: "This request could not be completed. Try again shortly." }, 500);
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(appUrl).origin)
    throw new HttpError(403, "Request origin is invalid.");
}
export async function bodyJson(request: Request) {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let size = 0;
  if (!reader) throw new HttpError(400, "Request body required.");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 12_000) {
        await reader.cancel();
        throw new HttpError(413, "Request is too large.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(chunks.join("") + decoder.decode()) as unknown;
}
export async function rateLimit(bucket: string, max: number, seconds: number) {
  const hit = await one<{ count: number }>(
    `INSERT INTO request_limits VALUES ($1,1,now()+$2*interval '1 second')
    ON CONFLICT(bucket) DO UPDATE SET
      count=CASE WHEN request_limits.expires_at <= now() THEN 1 ELSE request_limits.count+1 END,
      expires_at=CASE WHEN request_limits.expires_at <= now() THEN excluded.expires_at ELSE request_limits.expires_at END
    RETURNING count`,
    [bucket, seconds],
  );
  if (hit.count > max) throw new HttpError(429, "Too many requests. Try again shortly.");
}
