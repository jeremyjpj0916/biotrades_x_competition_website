import { seasonRedirect } from "@/lib/season-links";
import { PageHeading } from "@/components/ui";
import type { SearchParams } from "@/components/competition-pages";
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await seasonRedirect("analytics", await searchParams);
  return (
    <div className="page">
      <PageHeading
        title="Competition season unavailable"
        description="Check the season year or return to the overview."
      />
    </div>
  );
}
