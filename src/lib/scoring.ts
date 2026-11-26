import Decimal from "decimal.js";

export const D = Decimal.clone({ precision: 72 });
export type Action = {
  security_id: string;
  effective_date: string;
  sequence: number;
  kind:
    | "split"
    | "cash"
    | "stock"
    | "mixed"
    | "halt"
    | "resume"
    | "cancel"
    | "delist"
    | "distribution"
    | "spin_off"
    | "review";
  ratio: string | null;
  cash: string | null;
  successor_id: string | null;
};
export type StoredBar = { security_id: string; session_date: string; open: string; close: string };
export type Valuation = {
  start: string | null;
  close: string | null;
  value: string | null;
  pct: string | null;
  previousPct: string | null;
  status: string;
};

export function computeReturn(start: string, value: string) {
  return new D(value).minus(start).div(start).times(100).toFixed();
}

export function valuePosition(
  id: string,
  first: string,
  last: string,
  dates: string[],
  bars: Map<string, StoredBar>,
  actions: Action[],
): Valuation {
  const opening = bars.get(`${id}/${first}`)?.open ?? null;
  const missing = (status: string): Valuation => ({
    start: opening,
    close: null,
    value: null,
    pct: null,
    previousPct: null,
    status,
  });
  if (!opening) return missing("opening price pending");
  const positions = new Map([[id, new D(1)]]);
  const halted = new Set<string>();
  const lastClose = new Map<string, string>();
  let cash = new D(0);
  let status = "active";
  let previous: string | null = null;
  let current: string | null = null;
  let visibleClose: string | null = null;

  const relevantDates = dates.filter((date) => date >= first && date <= last);
  let actionIndex = 0;
  for (const date of relevantDates) {
    previous = current;
    while (actionIndex < actions.length && actions[actionIndex].effective_date <= date) {
      const action = actions[actionIndex++];
      const shares = positions.get(action.security_id);
      if (!shares || (action.effective_date <= first && action.kind === "split")) continue;
      const ratio = action.ratio == null ? null : new D(action.ratio);
      const proceeds = action.cash == null ? null : new D(action.cash);
      if (action.kind === "review") return missing("action under review");
      if (action.kind === "halt") halted.add(action.security_id);
      if (action.kind === "resume") halted.delete(action.security_id);
      if (action.kind === "split" && ratio) positions.set(action.security_id, shares.times(ratio));
      if (["cash", "mixed", "distribution"].includes(action.kind) && proceeds)
        cash = cash.plus(shares.times(proceeds));
      if (["stock", "mixed", "spin_off", "delist"].includes(action.kind) && action.successor_id && ratio) {
        const successor = positions.get(action.successor_id) ?? new D(0);
        positions.set(action.successor_id, successor.plus(shares.times(ratio)));
      }
      if (["cash", "stock", "mixed", "cancel", "delist"].includes(action.kind)) {
        if (action.kind === "delist" && !action.successor_id && proceeds == null)
          return missing("delisting under review");
        if (action.kind === "delist" && proceeds) cash = cash.plus(shares.times(proceeds));
        positions.delete(action.security_id);
        halted.delete(action.security_id);
        status = action.kind === "cancel" ? "bankrupt" : action.kind === "delist" ? "delisted" : "acquired";
      }
    }
    let value = cash;
    let complete = true;
    for (const [security, shares] of positions) {
      const actual = bars.get(`${security}/${date}`)?.close;
      if (actual) lastClose.set(security, actual);
      const close = actual ?? (halted.has(security) ? lastClose.get(security) : null);
      if (close == null) {
        complete = false;
        break;
      }
      value = value.plus(shares.times(close));
    }
    current = complete ? value.toFixed() : null;
    if (date === last)
      visibleClose = positions.size === 1 ? (lastClose.get([...positions.keys()][0]) ?? null) : null;
  }
  if (current == null) return missing("closing price pending");
  return {
    start: opening,
    value: current,
    close: visibleClose,
    pct: computeReturn(opening, current),
    previousPct: previous == null || new D(previous).isZero() ? null : computeReturn(previous, current),
    status: halted.size ? "halted" : status,
  };
}

export function competitionRanks(
  values: Map<string, Valuation>,
  entrySecurity: { id: string; security_id: string }[],
) {
  const ranked = entrySecurity
    .filter((entry) => values.get(entry.security_id)?.pct != null)
    .sort((a, b) => new D(values.get(b.security_id)!.pct!).comparedTo(values.get(a.security_id)!.pct!));
  let rank = 0;
  let prior: string | undefined;
  const result = new Map<string, number>();
  for (const [index, entry] of ranked.entries()) {
    const value = values.get(entry.security_id)!.pct!;
    if (prior === undefined || !new D(prior).eq(value)) rank = index + 1;
    result.set(entry.id, rank);
    prior = value;
  }
  return result;
}
export function earnedTrophies(rank: number, ranked: number) {
  const medals = ["champion", "silver", "bronze"];
  const result = rank > 0 && rank <= 3 ? [medals[rank - 1]] : [];
  if (rank > 0 && rank <= Math.max(1, Math.ceil(ranked * 0.1))) result.push("elite");
  return result;
}
