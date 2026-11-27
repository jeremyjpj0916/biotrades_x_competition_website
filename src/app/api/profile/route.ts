import { z } from "zod";
import { one } from "@/lib/db";
import { apiError, bodyJson, HttpError, privateJson, rateLimit, sameOrigin } from "@/lib/http";
import { profileFor, session } from "@/lib/session";

const input = z.object({
  username: z
    .string()
    .trim()
    .regex(/^(?!deleted_)[a-z0-9_]{3,24}$/i, "Use 3–24 letters, numbers or underscores."),
  displayName: z.string().trim().max(60),
  bio: z.string().trim().max(300),
  avatar: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(512)]),
  x: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{0,15}$/),
  discord: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.]{0,32}$/),
});
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const current = await session(request.headers);
    if (!current?.user.emailVerified) throw new HttpError(401, "Verify your email before saving a profile.");
    await rateLimit(`profile:${current.user.id}`, 10, 60);
    const data = input.parse(await bodyJson(request));
    if ((await profileFor(current.user.id))?.suspended)
      throw new HttpError(403, "This account is suspended.");
    const result = await one<{ username: string }>(
      `INSERT INTO profiles(auth_user_id,username,display_name,bio,avatar,x_handle,discord_handle)
      VALUES($1,$2,nullif($3,''),nullif($4,''),nullif($5,''),nullif($6,''),nullif($7,''))
      ON CONFLICT(auth_user_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,
      bio=excluded.bio,avatar=excluded.avatar,x_handle=excluded.x_handle,discord_handle=excluded.discord_handle
      WHERE NOT profiles.suspended RETURNING username`,
      [
        current.user.id,
        data.username,
        data.displayName,
        data.bio,
        data.avatar || current.user.image || "",
        data.x,
        data.discord,
      ],
    );
    if (!result) throw new HttpError(403, "This account is suspended.");
    return privateJson(result);
  } catch (error) {
    return apiError(error);
  }
}
