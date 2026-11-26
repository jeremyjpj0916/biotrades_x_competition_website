import Link from "next/link";
import { ArrowRight, BarChart3, CalendarDays, type LucideIcon } from "lucide-react";
import { dateLabel, money, percent, returnClass } from "@/lib/format";
import type { Season } from "@/lib/calendar";
import type { Standing } from "@/lib/public-data";

export function PageHeading({
  tag,
  title,
  description,
}: {
  tag?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="page-heading">
      {tag && <p className="eyebrow">{tag}</p>}
      <h1>{title}</h1>
      {description && <p className="muted">{description}</p>}
    </div>
  );
}
export function Empty({
  title,
  text,
  icon: Icon = BarChart3,
  href,
  action,
}: {
  title: string;
  text: string;
  icon?: LucideIcon;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={22} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {href && (
        <Link className="text-link" href={href}>
          {action}
          <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}
export function Phase({ phase }: { phase: Season["phase"] }) {
  return (
    <span className={`phase phase-${phase.toLowerCase().replaceAll(" ", "-")}`}>
      <span />
      {phase}
    </span>
  );
}
export function Value({
  children,
  label,
  subtitle,
  icon: Icon,
}: {
  children: React.ReactNode;
  label: string;
  subtitle?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="metric panel">
      <div className="metric-label">
        {Icon && (
          <span className="metric-icon">
            <Icon size={17} />
          </span>
        )}
        {label}
      </div>
      <strong className="metric-number">{children}</strong>
      {subtitle && <span className="muted metric-caption">{subtitle}</span>}
    </div>
  );
}
export function Avatar({
  username,
  avatar,
  large,
}: {
  username: string;
  avatar?: string | null;
  large?: boolean;
}) {
  return (
    <span aria-hidden="true" className={`avatar ${large ? "avatar-large" : ""}`}>
      {avatar && /^https:\/\//.test(avatar) ? (
        <img src={avatar} alt="" referrerPolicy="no-referrer" />
      ) : (
        username.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function SeasonTabs({ year, active }: { year: number; active: string }) {
  return (
    <nav className="tabs" aria-label="Season pages">
      {["Overview", "Leaderboard", "Analytics", "Stocks", "Rules"].map((tab) => (
        <Link
          key={tab}
          className={tab === active ? "selected" : ""}
          aria-current={tab === active ? "page" : undefined}
          href={`/competitions/${year}${tab === "Overview" ? "" : `/${tab.toLowerCase()}`}`}
        >
          {tab}
        </Link>
      ))}
    </nav>
  );
}
export function SeasonTimeline({ season }: { season: Season }) {
  const steps = [
    [
      "Registration opens",
      dateLabel(season.registration_at),
      "Pick your eligible biotech stock.",
      ["Upcoming"],
    ],
    [
      "Picks lock",
      dateLabel(season.locks_at) +
        " · " +
        new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "numeric",
          timeZone: "America/New_York",
        }).format(season.locks_at) +
        " ET",
      "Picks go public at market open.",
      ["Registration open", "Picks locked"],
    ],
    [
      "Season ends",
      dateLabel(season.ends_at),
      "Final close sets the official standings.",
      ["Active", "Finalizing"],
    ],
  ] as const;
  return (
    <section className="panel timeline">
      <div className="section-title">
        <span className="section-icon">
          <CalendarDays size={18} />
        </span>
        <h2>Season timeline</h2>
      </div>
      <ol>
        {steps.map(([title, date, text, states]) => (
          <li key={title} className={states.some((state) => state === season.phase) ? "next-step" : ""}>
            <span className="timeline-dot" />
            <div>
              <h3>{title}</h3>
              <time>{date}</time>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
export function StandingsTable({
  rows,
  season,
  preview = false,
  viewer,
}: {
  rows: Standing[];
  season: Season;
  preview?: boolean;
  viewer?: string;
}) {
  const official = season.data_mode === "official";
  return (
    <div className="table-scroll">
      <table className="standings-table">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Participant</th>
            <th scope="col">Pick</th>
            {official && (
              <>
                <th scope="col">Start price</th>
                <th scope="col">{season.final_revision ? "Final value" : "Last close"}</th>
              </>
            )}
            <th scope="col">YTD return</th>
            {!preview && (
              <>
                <th scope="col">Daily</th>
                <th scope="col">Rank change</th>
                <th scope="col">Status</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entryId} className={row.profileId === viewer ? "your-entry" : undefined}>
              <td>
                <span className={`rank rank-${row.rank ?? "pending"}`}>
                  {row.rank ? `#${row.rank}` : "—"}
                </span>
              </td>
              <td>
                <span className="row-user">
                  <Avatar
                    username={row.removed || row.suspended ? "Anonymous" : row.username}
                    avatar={row.avatar}
                  />
                  {row.removed || row.suspended ? (
                    "Anonymous"
                  ) : (
                    <Link href={`/users/${row.username}`}>{row.username}</Link>
                  )}
                  {row.profileId === viewer && <small className="muted">You</small>}
                </span>
              </td>
              <td>
                <Link className="ticker" href={`/competitions/${season.year}/stocks/${row.securityId}`}>
                  {row.symbol}
                </Link>
                <span className="table-company">{row.company}</span>
              </td>
              {official && (
                <>
                  <td>{money(row.startPrice)}</td>
                  <td>{money(season.final_revision ? row.value : row.close)}</td>
                </>
              )}
              <td className={`numeric ${returnClass(row.returnPct)}`}>{percent(row.returnPct)}</td>
              {!preview && (
                <>
                  <td className={`numeric ${returnClass(row.dailyPct)}`}>{percent(row.dailyPct)}</td>
                  <td className={returnClass(row.rankChange)}>
                    {row.rankChange == null
                      ? "—"
                      : row.rankChange > 0
                        ? `↑ ${row.rankChange}`
                        : row.rankChange < 0
                          ? `↓ ${Math.abs(row.rankChange)}`
                          : "0"}
                  </td>
                  <td className="capitalized">{row.status}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
