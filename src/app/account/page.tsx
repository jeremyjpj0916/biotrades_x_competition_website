import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountActions, PickForm, ProfileForm } from "@/components/account-forms";
import { Countdown } from "@/components/countdown";
import { Empty, PageHeading, Phase } from "@/components/ui";
import { listSeasons } from "@/lib/calendar";
import { providers, turnstile } from "@/lib/config";
import { query } from "@/lib/db";
import { dateLabel } from "@/lib/format";
import { isAdmin, profileFor, session } from "@/lib/session";

export const metadata = { title: "My account", robots: { index: false } };
export default async function Account() {
  const current = await session();
  if (!current) redirect("/join?mode=sign-in");
  const [profile, seasons] = await Promise.all([profileFor(current.user.id), listSeasons()]);
  const next = seasons.filter(({ phase }) => phase === "Upcoming").at(-1);
  const entries = profile
    ? await query<{
        year: number;
        symbol: string;
        company: string;
        disqualified_reason: string | null;
        review: string | null;
      }>(
        `SELECT
    e.season_year AS year,e.pick_symbol AS symbol,e.company,e.disqualified_reason,r.message AS review
    FROM entries e LEFT JOIN security_reviews r ON r.year=e.season_year AND r.security_id=e.security_id
      AND r.category='eligibility' AND r.resolved_at IS NULL
    WHERE e.profile_id=$1 ORDER BY e.season_year DESC`,
        [profile.id],
      )
    : [];
  return (
    <div className="page">
      <PageHeading
        tag="Participant account"
        title="My profile"
        description="Manage your competition entries and the details other participants can see."
      />
      <div className="toolbar">
        <div className="toolbar-left">
          {profile && !profile.suspended && (
            <Link className="button" href={`/users/${profile.username}`}>
              View public profile
            </Link>
          )}
          {isAdmin(current.user) && (
            <Link className="button" href="/admin">
              Admin dashboard
            </Link>
          )}
        </div>
      </div>
      <div className="account-grid">
        <div className="form-stack">
          {!current.user.emailVerified && (
            <div className="notice">Verify your email to edit a profile and submit a pick.</div>
          )}
          {profile?.suspended && (
            <div role="alert" className="notice">
              This player profile is suspended.
            </div>
          )}
          {current.user.emailVerified && !profile?.suspended && (
            <ProfileForm
              profile={profile}
              defaultName={current.user.name}
              defaultAvatar={current.user.image ?? ""}
            />
          )}
          <AccountActions
            providers={providers}
            email={current.user.email}
            siteKey={turnstile.siteKey}
            nonce={(await headers()).get("x-nonce") ?? undefined}
            canVerify={!current.user.emailVerified}
          />
        </div>
        <div className="form-stack">
          {profile &&
            !profile.suspended &&
            current.user.emailVerified &&
            seasons
              .filter(({ phase }) => phase === "Registration open")
              .map((season) => (
                <PickForm
                  key={season.year}
                  year={season.year}
                  entry={entries.find(({ year }) => year === season.year) ?? null}
                  official={season.data_mode === "official"}
                />
              ))}
          {next && (
            <section className="panel form-panel form-stack">
              <Phase phase={next.phase} />
              <h2>{next.year} registration</h2>
              <p className="muted">Opens {dateLabel(next.registration_at, "long")} at midnight Eastern.</p>
              <Countdown deadline={next.registration_at.toISOString()} label="Registration opens in" />
            </section>
          )}
          <section className="panel form-panel form-stack">
            <h2>Your competition entries</h2>
            {entries.length ? (
              entries.map((entry) => (
                <div key={entry.year} className="notice">
                  <strong>
                    {entry.year} · {entry.symbol}
                  </strong>{" "}
                  · {entry.company}
                  {(entry.review || entry.disqualified_reason) && (
                    <p className="alert">{entry.disqualified_reason ?? entry.review}</p>
                  )}
                </div>
              ))
            ) : (
              <Empty title="No entries yet" text="Once you save a pick, it will appear here." />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
