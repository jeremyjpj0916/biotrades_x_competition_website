import { describe, expect, it } from "vitest";
import {
  computeReturn,
  competitionRanks,
  earnedTrophies,
  valuePosition,
  type Action,
  type StoredBar,
} from "../src/lib/scoring";
const dates = ["2027-01-04", "2027-01-05", "2027-01-06"];
const initial: StoredBar = { security_id: "a", session_date: dates[0], open: "10", close: "11" };
function bar(security_id: string, session_date: string, close: string, open = close): StoredBar {
  return { security_id, session_date, close, open };
}
function series(...prices: StoredBar[]) {
  return new Map([initial, ...prices].map((p) => [`${p.security_id}/${p.session_date}`, p]));
}
function action(overrides: Partial<Action>): Action {
  return {
    kind: "split",
    effective_date: dates[1],
    security_id: "a",
    ratio: null,
    cash: null,
    successor_id: null,
    sequence: 0,
    ...overrides,
  };
}
const score = (prices: Map<string, StoredBar>, actions: Action[] = []) =>
  valuePosition("a", dates[0], dates[2], dates, prices, actions);
describe("competition scoring", () => {
  it("measures the opening day from its opening print and keeps unrounded gains", () => {
    expect(computeReturn("1.50", "5.75").startsWith("283.333333")).toBe(true);
    expect(valuePosition("a", dates[0], dates[0], dates, series(), []).pct).toBe("10");
    expect(computeReturn("8", "2")).toBe("-75");
  });
  it("adjusts split and reverse split shares", () => {
    expect(
      score(series(bar("a", dates[1], "5.5"), bar("a", dates[2], "6")), [action({ ratio: "2" })]),
    ).toMatchObject({ value: "12", pct: "20" });
    expect(
      score(series(bar("a", dates[1], "22"), bar("a", dates[2], "24")), [action({ ratio: ".5" })]),
    ).toMatchObject({ value: "12", pct: "20" });
  });
  it("carries cash acquisitions and computes mixed and stock successors", () => {
    expect(score(series(), [action({ kind: "cash", cash: "15" })])).toMatchObject({
      status: "acquired",
      pct: "50",
      close: null,
    });
    const prices = series(bar("b", dates[1], "12"), bar("b", dates[2], "20"));
    expect(
      score(prices, [action({ kind: "mixed", cash: "3", successor_id: "b", ratio: ".5" })]),
    ).toMatchObject({ value: "13", pct: "30", status: "acquired" });
    expect(score(prices, [action({ kind: "stock", successor_id: "b", ratio: "1" })]).value).toBe("20");
  });
  it("retains verified halted prices and distinguishes delisting or cancellation", () => {
    expect(score(series(), [action({ kind: "halt" })])).toMatchObject({ pct: "10", status: "halted" });
    expect(score(series(), [action({ kind: "delist" })])).toMatchObject({
      pct: null,
      status: "delisting under review",
    });
    expect(score(series(), [action({ kind: "cancel" })])).toMatchObject({ pct: "-100", status: "bankrupt" });
    expect(
      score(series(), [action({ kind: "halt" }), action({ kind: "resume", effective_date: dates[2] })]).pct,
    ).toBeNull();
  });
  it("never treats missing prices as zero, or ranks equal securities differently", () => {
    expect(score(series()).pct).toBeNull();
    const a = score(series(bar("a", dates[2], "10.0001")));
    const b = score(series(bar("a", dates[2], "10.00009")));
    const ranks = competitionRanks(
      new Map([
        ["a", a],
        ["b", b],
      ]),
      [
        { id: "one", security_id: "a" },
        { id: "two", security_id: "a" },
        { id: "three", security_id: "b" },
      ],
    );
    expect([...ranks.values()]).toEqual([1, 1, 3]);
    expect(earnedTrophies(1, 2)).toEqual(["champion", "elite"]);
    expect(earnedTrophies(51, 501)).toEqual(["elite"]);
    expect(earnedTrophies(52, 501)).toEqual([]);
  });
});
