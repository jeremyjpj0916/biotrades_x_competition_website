import { apiError, HttpError, privateJson, rateLimit } from "@/lib/http";
import { getPickerPrices, searchSecurities } from "@/lib/securities";
import { session } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const current = await session(request.headers);
    if (!current?.user.emailVerified) throw new HttpError(401, "Sign in with a verified email to search.");
    await rateLimit(`securities:${current.user.id}`, 45, 60);
    const value = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (!value || value.length > 60) return privateJson({ securities: [] });
    const securities = await searchSecurities(value);
    const prices = await getPickerPrices(securities.map(({ id }) => id));
    const priceById = new Map(prices.map(({ id, price }) => [id, price]));
    return privateJson({
      securities: securities.map((stock) => ({ ...stock, price: priceById.get(stock.id) ?? null })),
    });
  } catch (error) {
    return apiError(error);
  }
}
