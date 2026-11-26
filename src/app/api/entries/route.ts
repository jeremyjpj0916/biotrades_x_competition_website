import { z } from "zod";
import { one, transaction } from "@/lib/db";
import { apiError, bodyJson, HttpError, privateJson, rateLimit, sameOrigin } from "@/lib/http";
import { type Profile, session } from "@/lib/session";

const yearSchema = z.number().int().min(1900).max(9999);
const input = z.object({ year: yearSchema, securityId: z.uuid().nullable() });

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const current = await session(request.headers);
    if (!current?.user.emailVerified) throw new HttpError(401, "Sign in with a verified email to enter.");
    const accountId = current.user.id;
    const { year, securityId } = input.parse(await bodyJson(request));
    await rateLimit(`entry:${accountId}`, 15, 60);
    const result = await transaction(async (db) => {
      const profile = await one<Profile>(
        "SELECT * FROM profiles WHERE auth_user_id=$1 FOR SHARE",
        [accountId],
        db,
      );
      if (!profile || profile.suspended || profile.removed)
        throw new HttpError(403, "An active player profile is required to enter.");
      const season = await one<{ open: boolean }>(
        "SELECT registration_at<=clock_timestamp() AND locks_at>clock_timestamp() AS open FROM seasons WHERE year=$1 FOR SHARE",
        [year],
        db,
      );
      if (!season?.open) throw new HttpError(409, "Registration is closed for this season.");
      if (securityId === null) {
        await db.query("DELETE FROM entries WHERE season_year=$1 AND profile_id=$2", [year, profile.id]);
        return null;
      }
      const entry = await one<{ symbol: string }>(
        `INSERT INTO entries(season_year,profile_id,security_id,pick_symbol,company)
        SELECT $1,$2,id,symbol,name FROM securities WHERE id=$3
        ON CONFLICT(season_year,profile_id) DO UPDATE SET security_id=excluded.security_id,
          pick_symbol=excluded.pick_symbol,company=excluded.company,updated_at=clock_timestamp()
        RETURNING pick_symbol AS symbol`,
        [year, profile.id, securityId],
        db,
      );
      if (!entry) throw new HttpError(400, "This security was not found.");
      return entry;
    });
    return privateJson({ entry: result });
  } catch (error) {
    return apiError(error);
  }
}
