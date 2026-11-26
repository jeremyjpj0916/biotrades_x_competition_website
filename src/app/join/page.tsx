import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AuthForm } from "@/components/account-forms";
import { PageHeading, Phase, SeasonTimeline } from "@/components/ui";
import { listSeasons, selectHomeSeason, selectEntrySeason } from "@/lib/calendar";
import { providers, turnstile } from "@/lib/config";
import { session } from "@/lib/session";
import type { SearchParams } from "@/components/competition-pages";

export const metadata = { title: "Join competition", robots: { index: false } };
export default async function Join({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (await session()) redirect("/account");
  const seasons = await listSeasons();
  const season = selectEntrySeason(seasons, selectHomeSeason(seasons));
  const search = await searchParams;
  return (
    <div className="page">
      <PageHeading
        tag={season ? `${season.year} competition` : "Annual competition"}
        title="Join BioTrades X"
        description="Create a free player account and enter one eligible biotech stock when registration opens."
      />
      <div className="account-grid">
        <AuthForm
          initial={search.mode === "sign-in" ? "sign-in" : "sign-up"}
          providers={providers}
          siteKey={turnstile.siteKey}
          nonce={(await headers()).get("x-nonce") ?? undefined}
          oauthError={search.oauth === "error"}
        />
        {season && (
          <div className="form-stack">
            <div className="notice">
              <Phase phase={season.phase} />{" "}
              <Link className="text-link" href={`/competitions/${season.year}/rules`}>
                Read the season rules
              </Link>
            </div>
            <SeasonTimeline season={season} />
          </div>
        )}
      </div>
    </div>
  );
}
