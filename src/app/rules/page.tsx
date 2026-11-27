import type { Metadata } from "next";
import { Rules } from "@/components/rules";
import { listSeasons, selectRulesSeason } from "@/lib/calendar";
export const metadata: Metadata = { title: "Rules" };
export default async function RulesPage() {
  return (
    <div className="page">
      <Rules season={selectRulesSeason(await listSeasons())} />
    </div>
  );
}
