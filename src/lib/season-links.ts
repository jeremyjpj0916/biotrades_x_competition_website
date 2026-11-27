import { redirect } from "next/navigation";
import { seasonFrom, stringValue, type Standing } from "./public-data";
import type { SearchParams } from "@/components/competition-pages";

export async function seasonRedirect(segment: string, input: SearchParams) {
  const season = await seasonFrom(stringValue(input.year));
  if (!season) return;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (key !== "year" && typeof value === "string" && value) params.set(key, value);
  redirect(`/competitions/${season.year}/${segment}${params.size ? `?${params}` : ""}`);
}
