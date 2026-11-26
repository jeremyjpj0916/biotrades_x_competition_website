import { percent } from "@/lib/format";

type Point = { date: string; [series: string]: string | null };
const colors = ["#a78bfe", "#4dd6a0", "#f59ab7", "#80b8fd"];
export function SeriesChart({
  points,
  series,
  title,
  valueLabel = percent,
}: {
  points: Point[];
  series: [string, string][];
  title: string;
  valueLabel?: (value: string) => string;
}) {
  const valid = points.map((point) =>
    Object.entries(point)
      .filter(([key, value]) => key !== "date" && value != null)
      .map(([, value]) => Number(value)),
  );
  const numbers = valid.flat().filter(Number.isFinite);
  if (!numbers.length) return <p className="muted">Waiting for verified session data.</p>;
  const min = Math.min(...numbers),
    max = Math.max(...numbers);
  const y = (value: number) => 117 - ((value - min) / (max - min || 1)) * 103;
  const x = (index: number) => 12 + (points.length === 1 ? 0.5 : index / (points.length - 1)) * 576;
  return (
    <figure className="chart-wrap">
      <svg viewBox="0 0 600 130" role="img" aria-label={title} preserveAspectRatio="none">
        {[14, 48, 82, 117].map((height) => (
          <line key={height} x1="10" x2="590" y1={height} y2={height} stroke="var(--border)" />
        ))}
        {series.map(([key, label], seriesIndex) => {
          let path = "";
          let continuous = false;
          return (
            <g key={key} fill={colors[seriesIndex]}>
              {points.map((point, index) => {
                const value = point[key];
                if (value == null || !Number.isFinite(Number(value))) {
                  continuous = false;
                  return null;
                }
                const d = `${x(index)} ${y(Number(value))}`;
                path += `${continuous ? " L" : " M"}${d}`;
                continuous = true;
                return (
                  <circle
                    key={point.date}
                    cx={x(index)}
                    cy={y(Number(value))}
                    r={points.length > 100 ? 1 : 2}
                  >
                    <title>{`${label}, ${point.date}, ${valueLabel(value)}`}</title>
                  </circle>
                );
              })}
              <path d={path} stroke={colors[seriesIndex]} strokeWidth="2" fill="none" />
            </g>
          );
        })}
      </svg>
      <figcaption className="inline-list">
        {series.map(([key, label], index) => (
          <span className="tag" key={key}>
            <span style={{ color: colors[index] }}>●</span>
            {label}
          </span>
        ))}
      </figcaption>
      <details>
        <summary>View chart data</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                {series.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}</td>
                  {series.map(([key]) => (
                    <td key={key}>{point[key] == null ? "—" : valueLabel(point[key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
export function Bars({
  data,
  maximum,
}: {
  data: { label: string; value: number; text: string; kind?: string }[];
  maximum?: number;
}) {
  const max = Math.max(1, maximum ?? Math.max(...data.map(({ value }) => Math.abs(value))));
  return (
    <ul className="chart-list">
      {data.map(({ label, value, text, kind }) => (
        <li key={label}>
          <span>{label}</span>
          <div className="chart-track" aria-hidden="true">
            <div
              className={`chart-bar ${kind ?? ""}`}
              style={{ width: `${(Math.abs(value) / max) * 100}%` }}
            />
          </div>
          <strong className="numeric">{text}</strong>
        </li>
      ))}
    </ul>
  );
}
