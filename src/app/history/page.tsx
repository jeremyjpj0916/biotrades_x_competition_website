import Link from "next/link";
import { Archive, ArrowRight } from "lucide-react";
import { listSeasons } from "@/lib/calendar";
import { getRecentChampions } from "@/lib/public-data";
import { dateLabel } from "@/lib/format";
import { Empty, PageHeading, Phase } from "@/components/ui";

export const metadata = { title: "Competition history" };
export default async function History() {
  const [seasons, champions] = await Promise.all([listSeasons(), getRecentChampions()]);
  const completed = seasons.filter(({ final_revision }) => final_revision);
  return (
    <div className="page">
      <PageHeading
        tag="Annual seasons"
        title="Competition history"
        description="Final standings, winners, and season-specific rules, preserved year after year."
      />
      {completed.length ? (
        <div className="cards-grid">
          {completed.map((season) => (
            <Link key={season.year} className="panel card-link" href={`/competitions/${season.year}`}>
              <div className="section-heading">
                <h2>{season.year}</h2>
                <Phase phase={season.phase} />
              </div>
              <p>
                {champions
                  .filter(({ year }) => year === season.year)
                  .map(({ username }) => username)
                  .join(", ") || "Final results"}
              </p>
              <p className="muted">
                Finalized {dateLabel(season.finalized_at)} · Revision {season.final_revision}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            icon={Archive}
            title="The archive opens after the first season"
            text="Completed competitions, their final leaderboards, and annual trophy winners will appear here."
          />
        </div>
      )}
      {seasons.some(({ final_revision }) => !final_revision) && (
        <section className="panel page-panel">
          <h2>Current and upcoming seasons</h2>
          <div className="trophy-list">
            {seasons
              .filter(({ final_revision }) => !final_revision)
              .map((season) => (
                <Link key={season.year} className="button" href={`/competitions/${season.year}`}>
                  {season.year}
                  <Phase phase={season.phase} />
                  <ArrowRight size={14} />
                </Link>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
