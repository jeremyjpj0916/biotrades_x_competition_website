import { PageHeading, SeasonTabs } from "@/components/ui";
import { MarketMethod } from "@/components/competition-pages";
import type { Season } from "@/lib/calendar";
import { ruleSections, rulesVersion, freeScoringRule } from "@/lib/rules";
import { one } from "@/lib/db";

export async function Rules({ season }: { season?: Season }) {
  const archived =
    season &&
    (await one<{ sections: [string, string][] }>("SELECT sections FROM rulesets WHERE version=$1", [
      season.rules_version,
    ]));
  return (
    <>
      <PageHeading
        tag={season ? `${season.year} season · Rules v${season.rules_version}` : `Rules v${rulesVersion}`}
        title="Competition rules"
        description="Eligibility, deadlines, scoring, and how annual trophies are awarded."
      />
      {season && <SeasonTabs year={season.year} active="Rules" />}
      <div className="details-list">
        {(archived?.sections ?? ruleSections).map(([title, text]) => (
          <article className="panel" key={title}>
            <h2>{title}</h2>
            <p>{season?.data_mode === "free" && title === "How we score" ? freeScoringRule : text}</p>
          </article>
        ))}
      </div>
      {season && <MarketMethod season={season} />}
    </>
  );
}
