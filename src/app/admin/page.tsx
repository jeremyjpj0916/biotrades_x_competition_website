import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminForm } from "@/components/admin-forms";
import { Empty, PageHeading, Phase } from "@/components/ui";
import { adminOverview } from "@/lib/admin";
import { listSeasons } from "@/lib/calendar";
import { dateLabel } from "@/lib/format";
import { ruleSections } from "@/lib/rules";
import { isAdmin, session } from "@/lib/session";

export const metadata = { title: "Administration", robots: { index: false } };
const reason = { name: "reason", label: "Audited reason or evidence URL", required: true };
export default async function AdminPage() {
  const current = await session();
  if (!current || !isAdmin(current.user)) notFound();
  const [[profiles, reviews, jobs, health, logs, securities], seasons] = await Promise.all([
    adminOverview(),
    listSeasons(),
  ]);
  const securityOptions = securities.map((s) => ({
    value: s.id,
    label: `${s.symbol} · ${s.name} · ${s.active ? (s.eligible ? "Eligible" : "Ineligible") : "Inactive"}`,
  }));
  const participantOptions = profiles.map((p) => ({
    value: p.id,
    label: `${p.username}${p.suspended ? " (suspended)" : ""}`,
  }));
  const booleanOptions = [
    { value: "true", label: "Yes" },
    { value: "false", label: "No" },
  ];
  return (
    <div className="page">
      <PageHeading
        tag="Operations"
        title="Administration"
        description="Review eligibility, market synchronization, corporate actions, and published seasons."
      />
      <div className="cards-grid">
        {seasons.map((season) => (
          <Link className="panel card-link" href={`/competitions/${season.year}`} key={season.year}>
            <div className="section-heading">
              <h2>{season.year}</h2>
              <Phase phase={season.phase} />
            </div>
            <p className="muted">
              Rules v{season.rules_version} · {season.data_mode === "free" ? "Free data" : "Official feed"}
            </p>
          </Link>
        ))}
      </div>
      <section className="panel page-panel">
        <h2>Market-data health</h2>
        {health.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Last run</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {health.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{dateLabel(row.ran_at)}</td>
                    <td>{row.last_error ?? "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Worker has yet to run"
            text="The worker writes its health when it checks the market calendar and data queues."
          />
        )}
      </section>
      <section className="panel page-panel">
        <h2>Open security reviews</h2>
        {reviews.length ? (
          reviews.map((row) => (
            <AdminForm
              key={row.id}
              action="resolve"
              title={`${row.year} · ${row.symbol} · ${row.message}`}
              fixed={{ id: row.id }}
              fields={[
                ...(row.category === "eligibility"
                  ? [
                      {
                        name: "disqualify",
                        label: "Disqualify affected entries after lock",
                        type: "checkbox",
                      },
                    ]
                  : []),
                reason,
              ]}
              label="Resolve review"
            />
          ))
        ) : (
          <p className="muted">No open security reviews.</p>
        )}
      </section>
      <section className="panel page-panel">
        <h2>Recent synchronization jobs</h2>
        {jobs.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((row) => (
                  <tr key={`${row.year}/${row.date}`}>
                    <td>{row.year}</td>
                    <td>{row.date}</td>
                    <td>{row.status}</td>
                    <td>{row.attempts}</td>
                    <td>{row.last_error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No trading sessions have reached the synchronization window.</p>
        )}
      </section>
      <div className="cards-grid">
        <AdminForm
          action="suspend"
          title="Moderate a player profile"
          fields={[
            { name: "profile", label: "Participant", options: participantOptions, required: true },
            {
              name: "suspend",
              label: "Suspend account",
              type: "boolean",
              options: booleanOptions,
              required: true,
            },
            reason,
          ]}
        />
        <AdminForm
          action="eligibility"
          title="Review stock eligibility"
          fields={[
            { name: "security", label: "Security", options: securityOptions, required: true },
            { name: "eligible", label: "Eligible", options: booleanOptions, type: "boolean", required: true },
            reason,
          ]}
        />
        <AdminForm
          action="queue"
          title="Retry or backfill market sessions"
          fields={[
            { name: "year", label: "Season", type: "number", required: true },
            { name: "start", label: "Start date", type: "date", required: true },
            { name: "end", label: "End date", type: "date", required: true },
            reason,
          ]}
        />
        <AdminForm
          action="corporate"
          title="Record a corporate action"
          fields={[
            { name: "security", label: "Security", options: securityOptions, required: true },
            { name: "date", label: "Effective date", type: "date", required: true },
            {
              name: "kind",
              label: "Action",
              options: [
                "split",
                "cash",
                "stock",
                "mixed",
                "halt",
                "resume",
                "cancel",
                "delist",
                "distribution",
                "spin_off",
                "review",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
              required: true,
            },
            { name: "ratio", label: "New shares per original share" },
            { name: "cash", label: "Cash per share in USD" },
            { name: "successor", label: "Successor", options: securityOptions },
            reason,
          ]}
        />
        <AdminForm
          action="void-action"
          title="Void an incorrect corporate action"
          fields={[{ name: "id", label: "Corporate action ID", required: true }, reason]}
        />
        <AdminForm
          action="future-rules"
          title="Version rules for an upcoming season"
          fields={[
            { name: "year", label: "Season", type: "number", required: true },
            {
              name: "sections",
              label: "Rule sections JSON",
              type: "sections",
              defaultValue: JSON.stringify(ruleSections, null, 2),
              required: true,
            },
            reason,
          ]}
        />
        <AdminForm
          action="verify-action-coverage"
          title="Confirm year-end corporate-action coverage"
          fields={[{ name: "year", label: "Season", type: "number", required: true }, reason]}
          label="Record verified coverage"
        />
        <AdminForm
          action="publish"
          title="Publish an audited correction"
          fields={[{ name: "year", label: "Completed season", type: "number", required: true }, reason]}
          label="Publish result revision"
        />
      </div>
      {profiles.length > 0 && (
        <section className="panel page-panel">
          <h2>Recent profiles</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Display name</th>
                  <th>Bio</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>{profile.username}</td>
                    <td>{profile.display_name}</td>
                    <td>{profile.bio}</td>
                    <td>{profile.suspended ? "Suspended" : "Active"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel page-panel">
        <h2>Audit trail</h2>
        {logs.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => (
                  <tr key={row.id}>
                    <td>{dateLabel(row.happened_at)}</td>
                    <td>{row.action}</td>
                    <td>{row.target}</td>
                    <td>{row.details.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Audited actions appear here.</p>
        )}
      </section>
    </div>
  );
}
