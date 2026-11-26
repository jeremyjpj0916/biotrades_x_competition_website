import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";
import { getSeason } from "@/lib/calendar";
import { yearValue } from "@/lib/public-data";
import {
  Analytics,
  CompetitionOverview,
  Leaderboard,
  StockDetails,
  Stocks,
  type SearchParams,
} from "@/components/competition-pages";
import { Rules } from "@/components/rules";

type Route = { params: Promise<{ year: string; section?: string[] }>; searchParams: Promise<SearchParams> };
export async function generateMetadata({ params }: Route): Promise<Metadata> {
  const { year, section = [] } = await params;
  const name = section[0] ?? "competition";
  return {
    title: `${year} ${name[0].toUpperCase() + name.slice(1)}`,
    robots: yearValue(year) ? undefined : { index: false },
  };
}
export default async function Competition({ params, searchParams }: Route) {
  const { year, section = [] } = await params;
  const season = await getSeason(yearValue(year));
  if (!season || section.length > 2) notFound();
  const [screen, id] = section;
  if (id && (screen !== "stocks" || !z.uuid().safeParse(id).success)) notFound();
  const details = id ? await StockDetails({ season, security: id }) : null;
  if (id && !details) notFound();
  let content = details;
  if (!id) {
    switch (screen) {
      case undefined:
        content = <CompetitionOverview season={season} />;
        break;
      case "leaderboard":
        content = <Leaderboard season={season} search={await searchParams} />;
        break;
      case "analytics":
        content = <Analytics season={season} />;
        break;
      case "stocks":
        content = <Stocks season={season} />;
        break;
      case "rules":
        content = <Rules season={season} />;
        break;
      default:
        notFound();
    }
  }
  return <div className="page">{content}</div>;
}
