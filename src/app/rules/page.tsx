import type { Metadata } from "next";
import { Rules } from "@/components/rules";
import { listSeasons, selectHomeSeason } from "@/lib/calendar";
export const metadata: Metadata = { title: "Rules" };
export default async function RulesPage() {
  return (
    <div className="page">
      <Rules season={selectHomeSeason(await listSeasons())} />
    </div>
  );
}
