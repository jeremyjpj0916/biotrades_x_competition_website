import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Trophy } from "lucide-react";
import { Avatar, Empty, PageHeading, Value } from "@/components/ui";
import { TrophyLink } from "@/components/competition-pages";
import { SeriesChart } from "@/components/charts";
import { getProfile, getProfileYears, getTrophies } from "@/lib/public-data";
import { dateLabel, money, percent, returnClass } from "@/lib/format";
export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return {
    title: `@${username}`,
    description: `Competition results and trophies for ${username} on BioTrades X.`,
  };
}
export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const profile = await getProfile((await params).username);
  if (!profile) notFound();
  const [seasons, trophies] = await Promise.all([getProfileYears(profile.id), getTrophies(profile.id)]);
  const complete = seasons.filter(
    ({ season, standing }) => season.final_revision && standing?.returnPct != null,
  );
  const returns = complete.map(({ standing }) => Number(standing.returnPct)).sort((a, b) => a - b);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null;
  const median = returns.length
    ? (returns[Math.floor((returns.length - 1) / 2)] + returns[Math.floor(returns.length / 2)]) / 2
    : null;
  const finishes = complete
    .map(({ standing }) => standing.rank)
    .filter((rank): rank is number => rank !== null);
  const won = trophies.filter(({ kind }) => kind === "champion").length;
  const elite = trophies.filter(({ kind }) => kind === "elite").length;
  const profitable = returns.filter((value) => value > 0).length;
  const series = complete
    .slice()
    .reverse()
    .map(({ season, standing }) => ({
      date: String(season.year),
      pct: standing.returnPct,
      rank: String(standing.rank),
    }));
  const current = seasons.find(({ season }) => !season.final_revision);
  const showPrices = seasons.some(({ season, standing }) => standing && season.data_mode === "official");
  const headings = [
    "Year",
    "Pick",
    ...(showPrices ? ["Opening price", "Final value"] : []),
    "Return",
    "Rank",
    "Participants",
  ];
  return (
    <div className="page">
      <div className="profile-hero">
        <Avatar username={profile.username} avatar={profile.avatar} large />
        <PageHeading
          tag={`@${profile.username}`}
          title={profile.display_name ?? profile.username}
          description={profile.bio ?? undefined}
        />
      </div>
      <div className="inline-list muted">
        <CalendarDays size={15} /> Joined {dateLabel(profile.joined_at)}
        {profile.x_handle && (
          <a href={`https://x.com/${profile.x_handle}`} className="text-link">
            @{profile.x_handle} on X
          </a>
        )}
        {profile.discord_handle && <span>Discord · {profile.discord_handle}</span>}
      </div>
      {current?.standing && (
        <section className="panel page-panel">
          <h2>Current competition</h2>
          <p>
            <Link
              className="ticker"
              href={`/competitions/${current.season.year}/stocks/${current.standing.securityId}`}
            >
              {current.standing.symbol}
            </Link>{" "}
            · {current.season.year} · Rank {current.standing.rank ?? "pending"} ·{" "}
            {percent(current.standing.returnPct)}
          </p>
        </section>
      )}
      <div className="metrics-grid chart-group">
        <Value label="Average annual return" subtitle={`Median ${percent(median)}`}>
          {percent(mean)}
        </Value>
        <Value label="Best finish" subtitle={`Best return ${percent(returns.at(-1) ?? null)}`}>
          {finishes.length ? `#${Math.min(...finishes)}` : "—"}
        </Value>
        <Value label="Top 10% finishes" subtitle={`${won} championships`}>
          {elite}
        </Value>
        <Value label="Profitable seasons" subtitle={`${seasons.length} public seasons entered`}>
          {returns.length
            ? `${profitable} / ${returns.length} · ${Math.round((100 * profitable) / returns.length)}%`
            : "—"}
        </Value>
      </div>
      <section className="panel page-panel">
        <div className="section-title">
          <Trophy size={21} />
          <h2>Trophy cabinet</h2>
        </div>
        {trophies.length ? (
          <div className="trophy-list">
            {trophies.map((item) => (
              <TrophyLink key={`${item.year}/${item.kind}`} {...item} />
            ))}
          </div>
        ) : (
          <p className="muted">Trophies appear after final results are published.</p>
        )}
      </section>
      <section className="panel page-panel">
        <h2>Competition results</h2>
        {seasons.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {headings.map((name) => (
                    <th key={name}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seasons.map(
                  ({ season, standing, participants }) =>
                    standing && (
                      <tr key={season.year}>
                        <td>
                          <Link className="text-link" href={`/competitions/${season.year}`}>
                            {season.year}
                          </Link>
                          {!season.final_revision && " · ongoing"}
                        </td>
                        <td>
                          <Link
                            className="ticker"
                            href={`/competitions/${season.year}/stocks/${standing.securityId}`}
                          >
                            {standing.symbol}
                          </Link>
                        </td>
                        {showPrices && (
                          <>
                            <td>{season.data_mode === "official" ? money(standing.startPrice) : "—"}</td>
                            <td>
                              {season.data_mode === "official" && season.final_revision
                                ? money(standing.value)
                                : "—"}
                            </td>
                          </>
                        )}
                        <td className={returnClass(standing.returnPct)}>{percent(standing.returnPct)}</td>
                        <td>{standing.rank ?? "—"}</td>
                        <td>{participants}</td>
                      </tr>
                    ),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No public competition results"
            text="Revealed entries and completed seasons will appear here."
          />
        )}
      </section>
      {series.length > 0 && (
        <div className="dashboard-grid">
          <section className="panel page-panel">
            <h2>Annual returns</h2>
            <SeriesChart points={series} series={[["pct", "Return"]]} title="Historical annual returns" />
          </section>
          <section className="panel page-panel">
            <h2>Annual ranks</h2>
            <SeriesChart
              points={series}
              series={[["rank", "Rank"]]}
              title="Historical annual rank"
              valueLabel={(n) => `#${n}`}
            />
          </section>
        </div>
      )}
    </div>
  );
}
