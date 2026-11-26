import Link from "next/link";
import { Trophy } from "lucide-react";
import { getHall, getRecentChampions, stringValue } from "@/lib/public-data";
import { percent, returnClass } from "@/lib/format";
import { Empty, PageHeading } from "@/components/ui";
import type { SearchParams } from "@/components/competition-pages";
export const metadata = { title: "Hall of Fame" };
const categories = [
  "Championships",
  "Elite finishes",
  "Best return",
  "Average return",
  "Profitable seasons",
  "Streak",
];
export default async function HallOfFame({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const input = await searchParams;
  const minimum = Math.min(25, Math.max(1, Math.floor(Number(stringValue(input.minimum)) || 1)));
  const category = categories.includes(stringValue(input.category))
    ? stringValue(input.category)
    : categories[0];
  const [champions, ranking] = await Promise.all([getRecentChampions(), getHall(minimum)]);
  const index = categories.indexOf(category);
  const fields = ["wins", "elite", "best", "average", "profitable", "streak"] as const;
  ranking.sort((a, b) => Number(b[fields[index]]) - Number(a[fields[index]]));
  return (
    <div className="page">
      <PageHeading
        tag="All-time results"
        title="Hall of Fame"
        description="Annual champions, top-10% finishes, and sustained performance across completed seasons."
      />
      {!champions.length ? (
        <div className="panel">
          <Empty
            icon={Trophy}
            title="The first trophies are up for grabs"
            text="The Hall of Fame begins when the first competition results are final."
            href="/join"
            action="Join competition"
          />
        </div>
      ) : (
        <section className="panel page-panel">
          <h2>Annual champions</h2>
          <div className="trophy-list">
            {champions.map((row, index) => (
              <Link key={index} className="tag" href={`/competitions/${row.year}`}>
                <Trophy size={15} />
                {row.year} · {row.username}
              </Link>
            ))}
          </div>
        </section>
      )}
      <form className="toolbar-left page-panel" action="/hall-of-fame">
        <label className="field">
          Minimum completed seasons
          <input type="number" name="minimum" min="1" max="25" defaultValue={minimum} />
        </label>
        <label className="field">
          Order by
          <select name="category" defaultValue={category}>
            {categories.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <button className="button">Apply</button>
      </form>
      {ranking.length > 0 && (
        <section className="panel table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  "Participant",
                  "Seasons",
                  "Wins",
                  "Top 10%",
                  "Best return",
                  "Average return",
                  "Profitable seasons",
                  "Streak",
                ].map((name) => (
                  <th key={name}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranking.map((row) => (
                <tr key={row.username}>
                  <td>
                    <Link className="text-link" href={`/users/${row.username}`}>
                      {row.username}
                    </Link>
                  </td>
                  <td>{row.count}</td>
                  <td>{row.wins}</td>
                  <td>{row.elite}</td>
                  <td className={returnClass(row.best)}>{percent(row.best)}</td>
                  <td className={returnClass(row.average)}>{percent(row.average)}</td>
                  <td>
                    {row.profitable} / {row.count}
                  </td>
                  <td>{row.streak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
