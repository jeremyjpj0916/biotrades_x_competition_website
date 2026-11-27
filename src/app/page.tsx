import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  ChartNoAxesCombined,
  Crosshair,
  FlaskConical,
  LockKeyhole,
  Trophy,
  UsersRound,
} from "lucide-react";
import { Countdown } from "@/components/countdown";
import { MarketRefresh } from "@/components/market-refresh";
import { Empty, PageHeading, Phase, SeasonTimeline, StandingsTable, Value } from "@/components/ui";
import { fallbackSeason, listSeasons, selectHomeSeason, selectEntrySeason } from "@/lib/calendar";
import { firstYear } from "@/lib/config";
import { dateLabel, percent, returnClass } from "@/lib/format";
import { getBoard, getOverview, getRecentChampions, marketPublication, revealed } from "@/lib/public-data";

export default async function Home() {
  const seasons = await listSeasons().catch(() => []);
  const season = selectHomeSeason(seasons) ?? fallbackSeason();
  if (!season)
    return (
      <PageHeading title="BioTrades X" description="The next competition calendar is being confirmed." />
    );
  const entrySeason = selectEntrySeason(seasons, season) ?? season;
  const [summary, board, champions] = seasons.length
    ? await Promise.all([getOverview(season), getBoard(season, { limit: 5 }), getRecentChampions()])
    : [null, null, []];
  const registrationMessage =
    entrySeason.phase === "Registration open" ? "Picks lock in" : "Registration opens in";
  const countdownDate =
    entrySeason.phase === "Registration open" ? entrySeason.locks_at : entrySeason.registration_at;
  const links = [
    {
      title: "Make your pick",
      text: "Choose one eligible biotech or pharma stock before the first opening bell.",
      icon: Crosshair,
    },
    {
      title: "Track your rank",
      text: "Follow the leaderboard as verified market returns come in during the season.",
      icon: ChartNoAxesCombined,
    },
    {
      title: "Earn a trophy",
      text: "Finish on the podium or in the top 10% to earn a trophy on your public profile.",
      icon: Trophy,
    },
  ];
  return (
    <div className="home">
      {seasons.length > 0 && revealed(season) && season.phase !== "Completed" && (
        <MarketRefresh year={season.year} publication={marketPublication(season)} />
      )}
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-art" />
        <div className="hero-inner">
          <div className="hero-label">
            <span />
            <span>{season.year} BIOTECH STOCK COMPETITION</span>
          </div>
          <h1 id="home-title">
            One pick.
            <br />
            <em>One trading year.</em>
          </h1>
          <p>
            Choose a biotech stock. Follow it from the first opening bell to the final close and see where
            your pick ranks.
          </p>
          <div className="hero-actions">
            <Link href="/join" className="button primary">
              {["Upcoming", "Registration open"].includes(entrySeason.phase)
                ? `Join the ${entrySeason.year} competition`
                : "Create a player account"}{" "}
              <ArrowUpRight size={18} />
            </Link>
            <Link href="/rules" className="button hero-secondary">
              Read the rules <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div className="hero-footer">
          <span>
            <span className="hero-dot" /> {season.phase}
          </span>
          {["Upcoming", "Registration open"].includes(entrySeason.phase) && (
            <Countdown
              deadline={countdownDate.toISOString()}
              label={
                entrySeason.year === season.year
                  ? registrationMessage
                  : `${entrySeason.year} · ${registrationMessage}`
              }
            />
          )}
        </div>
      </section>

      <section className="season-overview" aria-labelledby="overview-title">
        <div className="section-heading">
          <div>
            <h2 id="overview-title">{season.year} season overview</h2>
            <p className="muted">
              {season.published_date
                ? `Standings through ${dateLabel(season.published_date)}`
                : season.year === firstYear
                  ? "The inaugural BioTrades X competition."
                  : "BioTrades X annual competition."}
            </p>
          </div>
          <Phase phase={season.phase} />
        </div>
        <div className="metrics-grid">
          <Value
            icon={UsersRound}
            label="Participants"
            subtitle={season.phase === "Upcoming" ? "Registration has yet to open" : "Entered this season"}
          >
            {summary?.participants ?? 0}
          </Value>
          <Value
            icon={FlaskConical}
            label="Unique picks"
            subtitle={
              summary?.unique == null ? "Revealed at the opening bell" : "Distinct securities selected"
            }
          >
            {summary?.unique ?? "—"}
          </Value>
          <Value icon={ChartNoAxesCombined} label="Average return" subtitle="Participant-weighted">
            <span className={returnClass(summary?.mean ?? null)}>{percent(summary?.mean ?? null)}</span>
          </Value>
          <Value
            icon={Trophy}
            label="Top-performing pick"
            subtitle={summary?.best?.symbol ?? "Awaits the first standings"}
          >
            <span className={returnClass(summary?.best?.returnPct ?? null)}>
              {percent(summary?.best?.returnPct ?? null)}
            </span>
          </Value>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel leaderboard-preview">
          <div className="panel-heading">
            <div className="section-title">
              <span className="section-icon">
                <BarChart3 size={19} />
              </span>
              <h2>Leaderboard</h2>
            </div>
            <Link className="text-link" href={`/competitions/${season.year}/leaderboard`}>
              Full leaderboard <ArrowRight size={15} />
            </Link>
          </div>
          {board?.rows.length ? (
            <StandingsTable rows={board.rows} season={season} preview />
          ) : (
            <>
              <div className="fake-table-head" aria-hidden="true">
                <span>Rank</span>
                <span>Participant</span>
                <span>Pick</span>
                <span>YTD return</span>
              </div>
              <Empty
                title={
                  ["Upcoming", "Registration open"].includes(season.phase)
                    ? "Picks are still private"
                    : "Standings are pending"
                }
                text={
                  ["Upcoming", "Registration open"].includes(season.phase)
                    ? `The leaderboard opens when picks lock on ${dateLabel(season.locks_at)}.`
                    : "Standings appear when market data becomes available."
                }
                icon={LockKeyhole}
              />
            </>
          )}
        </section>
        <SeasonTimeline season={season} />
      </div>

      {champions.length > 0 && (
        <section className="panel page-panel">
          <div className="section-heading">
            <h2>Recent champions</h2>
            <Link className="text-link" href="/hall-of-fame">
              Hall of Fame <ArrowRight size={15} />
            </Link>
          </div>
          <div className="inline-list">
            {champions.map((row) => (
              <Link
                className="tag"
                key={`${row.year}/${row.username}`}
                href={`/competitions/${row.year}/leaderboard`}
              >
                <Trophy size={15} /> {row.year} · {row.username}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="how">
        <div className="section-heading">
          <div>
            <h2>How the competition works</h2>
            <p className="muted">One entry per participant each season.</p>
          </div>
        </div>
        <div className="how-grid">
          {links.map(({ title, text, icon: Icon }) => (
            <article className="panel how-card" key={title}>
              <span className="section-icon">
                <Icon size={21} />
              </span>
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="data-note">
        <Calendar size={16} />
        <span>All dates follow the U.S. equity market calendar in Eastern Time.</span>
      </div>
    </div>
  );
}
