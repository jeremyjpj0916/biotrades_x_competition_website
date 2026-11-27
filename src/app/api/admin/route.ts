import { runAdmin } from "@/lib/admin";
import { apiError, bodyJson, HttpError, privateJson, rateLimit, sameOrigin } from "@/lib/http";
import { isAdmin, session } from "@/lib/session";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const current = await session(request.headers);
    if (!current || !isAdmin(current.user)) throw new HttpError(403, "Administrator permission required.");
    await rateLimit(`admin:${current.user.id}`, 25, 60);
    return privateJson({ message: await runAdmin(current.user.id, await bodyJson(request)) });
  } catch (error) {
    return apiError(error);
  }
}
