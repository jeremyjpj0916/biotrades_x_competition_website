import { apiError, HttpError, privateJson, rateLimit } from "@/lib/http";
import { searchSecurities } from "@/lib/securities";
import { session } from "@/lib/session";
import { one } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const current = await session(request.headers);
    if (!current?.user.emailVerified) throw new HttpError(401, "Sign in with a verified email to search.");
    await rateLimit(`securities:${current.user.id}`, 45, 60);
    const value = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (!value || value.length > 60) return privateJson({ securities: [] });
    const securities = await searchSecurities(value);
    const allowPrices = await one<{
      approved: boolean;
    }>(`SELECT EXISTS(SELECT 1 FROM seasons WHERE data_mode='official'
      AND registration_at<=now() AND locks_at>now()) AS approved`);
    const prices =
      allowPrices.approved && securities.length
        ? await (
            await import("@/lib/db")
          ).query<{ id: string; price: string }>(
            `SELECT DISTINCT ON (security_id) security_id AS id, close AS price FROM daily_prices
          WHERE security_id=ANY($1::uuid[]) AND source NOT LIKE 'Market History%' ORDER BY security_id,session_date DESC`,
            [securities.map(({ id }) => id)],
          )
        : [];
    const priceById = new Map(prices.map(({ id, price }) => [id, price]));
    return privateJson({
      securities: securities.map((stock) => ({ ...stock, price: priceById.get(stock.id) ?? null })),
    });
  } catch (error) {
    return apiError(error);
  }
}
