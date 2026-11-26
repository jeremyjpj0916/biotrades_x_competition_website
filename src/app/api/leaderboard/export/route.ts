import { getSeason } from "@/lib/calendar";
import { availableDates, getBoard, revealed, yearValue } from "@/lib/public-data";
import { apiError, HttpError } from "@/lib/http";

function csvCell(value: unknown) {
  const raw = value == null ? "" : String(value);
  const cell =
    typeof value === "string" && /^[\s]*[=+\-@]/.test(raw) && !/^-\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  return `"${cell.replaceAll('"', '""')}"`;
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const season = await getSeason(yearValue(params.get("year") ?? undefined));
    if (!season) throw new HttpError(404, "Season not found.");
    if (!revealed(season)) throw new HttpError(404, "This season has no public results yet.");
    const date = params.get("date") ?? undefined;
    if (date && !(await availableDates(season)).includes(date))
      throw new HttpError(404, "Standings date not found.");
    const official = season.data_mode === "official";
    const rows = [
      [
        "Rank",
        "Participant",
        "Ticker",
        "Company",
        ...(official ? ["Opening price", "Lately verified price", "Equivalent value"] : []),
        "Return (%)",
        "Daily change (%)",
        "Rank movement",
        "Status",
      ],
    ];
    const data = await getBoard(season, { date, search: params.get("q")?.slice(0, 60), limit: 20000 });
    for (const row of data.rows)
      rows.push([
        row.rank?.toString() ?? "",
        row.removed || row.suspended ? "Anonymous" : row.username,
        row.symbol,
        row.company,
        ...(official ? [row.startPrice ?? "", row.close ?? "", row.value ?? ""] : []),
        row.returnPct ?? "",
        row.dailyPct ?? "",
        row.rankChange?.toString() ?? "",
        row.status,
      ]);
    return new Response(rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="biotrades-${season.year}${date ? `-${date}` : ""}.csv"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
