import type { MetadataRoute } from "next";
import { listSeasons } from "@/lib/calendar";
import { appUrl } from "@/lib/config";
import { query } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [seasons, profiles, picks] = await Promise.all([
    listSeasons(),
    query<{ username: string }>(
      "SELECT username FROM profiles WHERE NOT suspended AND NOT removed ORDER BY username LIMIT 20000",
    ),
    query<{ year: number; id: string }>(`SELECT DISTINCT e.season_year AS year,e.security_id AS id
      FROM entries e JOIN seasons s ON s.year=e.season_year AND s.locks_at<=now() LIMIT 10000`),
  ]);
  return [
    ...["", "rules", "hall-of-fame", "history"].map((p) => ({ url: `${appUrl}/${p}` })),
    ...seasons.flatMap(({ year }) =>
      ["", "/leaderboard", "/analytics", "/stocks", "/rules"].map((p) => ({
        url: `${appUrl}/competitions/${year}${p}`,
      })),
    ),
    ...profiles.map(({ username }) => ({ url: `${appUrl}/users/${encodeURIComponent(username)}` })),
    ...picks.map(({ year, id }) => ({ url: `${appUrl}/competitions/${year}/stocks/${id}` })),
  ];
}
