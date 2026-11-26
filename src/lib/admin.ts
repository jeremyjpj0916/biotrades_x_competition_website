import { z } from "zod";
import { one, query, transaction, type Database } from "./db";
import { HttpError } from "./http";
import { finalizeSeason } from "./standings";

const reason = z.string().trim().min(8).max(400);
const year = z.number().int().min(1900).max(9999);
const decimal = z
  .string()
  .trim()
  .regex(/^\d{1,18}(\.\d{1,12})?$/)
  .refine((value) => Number.isFinite(Number(value)));
const kind = z.enum([
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
]);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), profile: z.uuid(), suspend: z.boolean(), reason }),
  z.object({ action: z.literal("eligibility"), security: z.uuid(), eligible: z.boolean(), reason }),
  z.object({
    action: z.literal("resolve"),
    id: z.string().regex(/^\d+$/),
    disqualify: z.boolean().default(false),
    reason,
  }),
  z.object({
    action: z.literal("corporate"),
    security: z.uuid(),
    date: z.iso.date(),
    kind,
    ratio: decimal.optional(),
    cash: decimal.optional(),
    successor: z.uuid().optional(),
    reason,
  }),
  z.object({ action: z.literal("void-action"), id: z.string().regex(/^\d+$/), reason }),
  z.object({ action: z.literal("queue"), year, start: z.iso.date(), end: z.iso.date(), reason }),
  z.object({ action: z.literal("publish"), year, reason }),
  z.object({ action: z.literal("verify-action-coverage"), year, reason }),
  z.object({
    action: z.literal("future-rules"),
    year,
    sections: z
      .array(z.tuple([z.string().trim().min(4).max(120), z.string().trim().min(10).max(3000)]))
      .min(1)
      .max(12),
    reason,
  }),
]);

export async function audit(db: Database, actor: string, action: string, target: string, details: unknown) {
  await db.query("INSERT INTO audit_log(actor,action,target,details) VALUES($1,$2,$3,$4)", [
    actor,
    action,
    target,
    JSON.stringify(details),
  ]);
}
async function affected(db: Database, sql: string, params: unknown[]) {
  const result = await db.query(sql, params);
  if (!result.rowCount) throw new HttpError(404, "No matching record was changed.");
}
export async function runAdmin(actor: string, raw: unknown) {
  const data = input.parse(raw);
  if (data.action === "publish") {
    const result = await finalizeSeason(data.year, { actor, reason: data.reason });
    if (!result)
      throw new HttpError(
        409,
        "Use correction publication only after finalization and resolution of all reviews.",
      );
    return `Published revision ${result.revision}.`;
  }
  return transaction(async (db) => {
    switch (data.action) {
      case "suspend": {
        const identity = await one<{ auth_user_id: string | null }>(
          "SELECT auth_user_id FROM profiles WHERE id=$1 AND NOT removed FOR UPDATE",
          [data.profile],
          db,
        );
        if (!identity || identity.auth_user_id === actor)
          throw new HttpError(400, "Select another active player.");
        await affected(db, "UPDATE profiles SET suspended=$2 WHERE id=$1", [data.profile, data.suspend]);
        if (data.suspend && identity.auth_user_id)
          await db.query('DELETE FROM session WHERE "userId"=$1', [identity.auth_user_id]);
        await audit(db, actor, data.action, data.profile, { suspended: data.suspend, reason: data.reason });
        break;
      }
      case "eligibility":
        await affected(
          db,
          `UPDATE securities SET eligibility_override=$2 WHERE id=$1 AND NOT benchmark AND
          (instrument LIKE 'common:%' OR instrument='ADR' OR instrument='CS' OR instrument='ADRC')`,
          [data.security, data.eligible],
        );
        await audit(db, actor, data.action, data.security, data);
        break;
      case "resolve": {
        const issue = await one<{
          year: number;
          security_id: string;
          category: string;
          final_revision: number | null;
          locked: boolean;
        }>(
          `SELECT r.*,s.final_revision,s.locks_at<=now() AS locked
          FROM security_reviews r JOIN seasons s ON s.year=r.year WHERE r.id=$1 AND r.resolved_at IS NULL FOR UPDATE OF r,s`,
          [data.id],
          db,
        );
        if (!issue) throw new HttpError(404, "Open review not found.");
        if (data.disqualify) {
          if (issue.category !== "eligibility" || issue.final_revision || !issue.locked)
            throw new HttpError(400, "Only confirmed eligibility failures after lock can be disqualified.");
          await affected(
            db,
            "UPDATE entries SET disqualified_reason=$3 WHERE season_year=$1 AND security_id=$2",
            [issue.year, issue.security_id, data.reason],
          );
        }
        await db.query("UPDATE security_reviews SET resolved_at=now(),resolution=$2 WHERE id=$1", [
          data.id,
          data.reason,
        ]);
        if (!issue.final_revision)
          await db.query(
            "UPDATE sync_jobs SET status='pending',available_at=now() WHERE year=$1 AND status='failed'",
            [issue.year],
          );
        await audit(db, actor, data.action, data.id, data);
        break;
      }
      case "corporate": {
        const ratioRequired =
          ["split", "stock", "mixed", "spin_off"].includes(data.kind) ||
          (data.kind === "delist" && Boolean(data.successor));
        const cashRequired = ["cash", "mixed", "distribution"].includes(data.kind);
        if (
          (ratioRequired && (!data.ratio || Number(data.ratio) <= 0)) ||
          (cashRequired && data.cash === undefined) ||
          (["stock", "mixed", "spin_off"].includes(data.kind) && !data.successor) ||
          (data.kind === "delist" && !data.successor && data.cash === undefined)
        ) {
          throw new HttpError(
            400,
            "Supply all verified ratios, proceeds and successor fields for this action.",
          );
        }
        if (data.successor === data.security)
          throw new HttpError(400, "Select a different successor security.");
        // Serialize same-security sequencing and keep the original evidence on amendments.
        await affected(db, "SELECT id FROM securities WHERE id=$1 FOR UPDATE", [data.security]);
        if (data.kind === "split") {
          const existing = await one<{ id: string; source: string }>(
            `SELECT id,source FROM corporate_actions
            WHERE security_id=$1 AND effective_date=$2 AND kind='split' AND voided_at IS NULL FOR UPDATE`,
            [data.security, data.date],
            db,
          );
          if (existing?.source === "Verified admin review")
            throw new HttpError(409, "Void the existing verified split before recording a replacement.");
          if (existing)
            await db.query("UPDATE corporate_actions SET voided_at=now() WHERE id=$1", [existing.id]);
        }
        const record = await one<{ id: string }>(
          `INSERT INTO corporate_actions(security_id,effective_date,sequence,kind,ratio,cash,successor_id,source,notes)
          SELECT $1,$2,coalesce(max(sequence),-1)+1,$3,$4,$5,$6,'Verified admin review',$7
          FROM corporate_actions WHERE security_id=$1 AND effective_date=$2 RETURNING id`,
          [
            data.security,
            data.date,
            data.kind,
            data.ratio ?? null,
            data.cash ?? null,
            data.successor ?? null,
            data.reason,
          ],
          db,
        );
        await audit(db, actor, data.action, record.id, data);
        break;
      }
      case "void-action":
        await affected(db, "UPDATE corporate_actions SET voided_at=now() WHERE id=$1 AND voided_at IS NULL", [
          data.id,
        ]);
        await audit(db, actor, data.action, data.id, data);
        break;
      case "queue":
        if (data.start > data.end) throw new HttpError(400, "Choose a valid date range.");
        await affected(
          db,
          `INSERT INTO sync_jobs(year,session_date)
          SELECT m.year,m.session_date FROM market_sessions m JOIN seasons s USING(year)
          WHERE m.year=$1 AND s.final_revision IS NULL AND m.session_date BETWEEN $2 AND $3 AND m.closes_at<=now()
          ON CONFLICT(year,session_date) DO UPDATE SET status='pending',available_at=now()
          WHERE sync_jobs.status<>'running'`,
          [data.year, data.start, data.end],
        );
        await audit(db, actor, data.action, String(data.year), data);
        break;
      case "verify-action-coverage": {
        const closed = await one(
          "SELECT 1 FROM seasons WHERE year=$1 AND ends_at<=now() FOR UPDATE",
          [data.year],
          db,
        );
        if (!closed) throw new HttpError(400, "The season must have reached its final session.");
        await audit(db, actor, data.action, String(data.year), { reason: data.reason });
        break;
      }
      case "future-rules": {
        await db.query("SELECT pg_advisory_xact_lock(244803)");
        const row = await one<{ version: number }>(
          `INSERT INTO rulesets(version,title,sections)
          SELECT max(version)+1,'Annual stock competition',$1 FROM rulesets RETURNING version`,
          [JSON.stringify(data.sections)],
          db,
        );
        await affected(
          db,
          "UPDATE seasons SET rules_version=$2 WHERE year=$1 AND registration_at>clock_timestamp()",
          [data.year, row.version],
        );
        await audit(db, actor, data.action, String(data.year), { version: row.version, reason: data.reason });
        break;
      }
    }
    return "Change saved.";
  });
}
export async function adminOverview() {
  return Promise.all([
    query<{
      id: string;
      username: string;
      suspended: boolean;
      display_name: string | null;
      bio: string | null;
    }>(
      `SELECT id,username,suspended,display_name,bio FROM profiles WHERE NOT removed ORDER BY joined_at DESC LIMIT 100`,
    ),
    query<{
      id: string;
      year: number;
      symbol: string;
      security_id: string;
      category: string;
      message: string;
    }>(`SELECT r.id,r.year,s.symbol,r.security_id,r.category,r.message FROM security_reviews r
      JOIN securities s ON s.id=r.security_id WHERE r.resolved_at IS NULL ORDER BY r.created_at LIMIT 100`),
    query<{
      year: number;
      date: string;
      status: string;
      attempts: number;
      last_error: string | null;
    }>(`SELECT year,session_date::text AS date,status,attempts,last_error FROM sync_jobs
      ORDER BY CASE WHEN status='failed' THEN 0 ELSE 1 END,session_date DESC LIMIT 60`),
    query<{ name: string; ran_at: Date; last_error: string | null }>(
      "SELECT * FROM worker_health ORDER BY name",
    ),
    query<{
      id: string;
      actor: string;
      action: string;
      target: string;
      happened_at: Date;
      details: { reason?: string };
    }>("SELECT * FROM audit_log ORDER BY id DESC LIMIT 40"),
    query<{
      id: string;
      symbol: string;
      name: string;
      active: boolean;
      eligible: boolean;
    }>(`SELECT id,symbol,name,active,
      coalesce(eligibility_override,provider_eligible) AS eligible FROM securities ORDER BY symbol LIMIT 1500`),
  ]);
}
