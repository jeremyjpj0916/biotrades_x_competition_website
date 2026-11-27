export const integer = (value: number | string) => Number(value).toLocaleString("en-US");
export const money = (value: string | number | null) =>
  value == null
    ? "—"
    : Number(value).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Number(value) > 0 && Number(value) < 1 ? 4 : 2,
      });
export function percent(value: string | number | null) {
  if (value == null) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : number < 0 ? "−" : ""}${Math.abs(number).toFixed(2)}%`;
}
export const returnClass = (value: string | number | null) =>
  value == null ? "" : Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "";
export function dateLabel(value: Date | string | null, format: "short" | "long" = "short") {
  if (!value) return "To be announced";
  const onlyDate = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("en-US", {
    month: format === "short" ? "short" : "long",
    day: "numeric",
    year: "numeric",
    timeZone: onlyDate ? "UTC" : "America/New_York",
  }).format(new Date(value));
}
