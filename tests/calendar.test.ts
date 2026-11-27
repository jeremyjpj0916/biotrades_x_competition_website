import { describe, expect, it } from "vitest";
import {
  fallbackSeason,
  parseNyseCalendar,
  publishedCalendar,
  selectEntrySeason,
  selectHomeSeason,
  selectRulesSeason,
  type Season,
} from "../src/lib/calendar";
describe("exchange calendar and annual selection", () => {
  it("uses the actual first session, holiday and shortened November close", () => {
    const dates = publishedCalendar(2027);
    expect(dates[0]).toEqual({ date: "2027-01-04", open: "09:30", close: "16:00" });
    expect(dates.find(({ date }) => date === "2027-11-26")?.close).toBe("13:00");
    expect(dates.some(({ date }) => date === "2027-06-18")).toBe(false);
    expect(fallbackSeason(2027)?.locks_at.toISOString()).toBe("2027-01-04T14:30:00.000Z");
  });
  it("uses an updated exchange schedule without a hardcoded new year", () => {
    const holidays = [
      "Friday, January 1",
      "Monday, January 18",
      "Monday, February 15",
      "Friday, March 26",
      "Monday, May 31",
      "Friday, June 18",
      "Monday, July 5",
      "Monday, September 6",
      "Thursday, November 25",
      "Friday, December 24",
    ];
    const html = `<table><tr><th>Holiday</th><th>2038</th></tr>${holidays.map((day) => `<tr><th>Holiday</th><td>${day}</td></tr>`).join("")}</table>
      <p>Each market will close early at 1:00 p.m. on Friday, November 26, 2038.</p>`;
    const parsed = parseNyseCalendar(html, 2038);
    expect(parsed.length).toBeGreaterThan(240);
    expect(parsed.find(({ date }) => date === "2038-11-26")?.close).toBe("13:00");
    expect(parsed.some(({ date }) => date === "2038-01-01")).toBe(false);
    expect(parseNyseCalendar(html, 2039)).toEqual([]);
  });
  it("keeps this year's board and next year's registration independent in December", () => {
    const current = { ...fallbackSeason(2027)!, phase: "Active" } as Season;
    const next = { ...fallbackSeason(2028)!, phase: "Registration open" } as Season;
    expect(selectHomeSeason([next, current], 2027)?.year).toBe(2027);
    expect(selectEntrySeason([next, current], current)?.year).toBe(2028);
    expect(selectHomeSeason([next, current], 2028)?.year).toBe(2028);
    expect(selectRulesSeason([next, current], 2027)?.year).toBe(2028);
    expect(selectRulesSeason([{ ...next, phase: "Upcoming" }, current], 2027)?.year).toBe(2027);
  });
});
