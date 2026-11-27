import { getSeason } from "@/lib/calendar";
import { apiError, HttpError } from "@/lib/http";
import { marketPublication, yearValue } from "@/lib/public-data";

export async function GET(request: Request) {
  try {
    const year = yearValue(new URL(request.url).searchParams.get("year") ?? undefined);
    const season = year ? await getSeason(year) : undefined;
    if (!season) throw new HttpError(404, "Season not found.");
    return Response.json(
      { publication: marketPublication(season) },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=15" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
