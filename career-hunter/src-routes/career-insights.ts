/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Insights read off covering indexes. Live 2026-10-12 GET /analytics answered 503 "package response stalled before the next protocol message" after ~10 s on every call and Insights showed all zeros: five aggregates joined the corpus rows, whose lane columns sit after each posting's inline description, so a cold read dragged the 7.4 GB corpus through the page cache (44.3 s measured on a copy of the live corpus, 0.5 s warm). The lane is now read from idx_corpus_insights (active, target_role, company_id, posted_date, state, salary_max), which the engine's CORPUS_SCHEMA creates at the nightly ingest; the caller's scores are read in one sequential pass of user_signals; the five answers are computed from those two reads (2.4 s cold on the same copy). Before the index exists the read refuses at once with InsightsNotReady instead of stalling.
 */

/**
 * Career Insights: the in-lane headline, funnel, top companies, states and salary bands.
 * @module career-insights
 */

/** The covering index every Insights read plans against (engine/jobhunter/db.py CORPUS_SCHEMA). */
export const INSIGHTS_INDEX = 'idx_corpus_insights';

/** The label a posting with no state is counted under. */
const NO_STATE = '(remote/\u2014)';
const FUNNEL_STATUSES = ['generated', 'applied', 'interview', 'offer', 'promoted'];
const TOP = 12;

/** Raised when the corpus has no Insights index yet: the route answers 503 with this message instead of scanning. */
export class InsightsNotReady extends Error {
  readonly code = 'insights_index_missing';
  constructor() {
    super('Insights are not ready yet: the job corpus gains the index Insights reads at its next nightly refresh.');
  }
}

interface LaneRow { id: number; company_id: number; posted_date: string | null; state: string | null; salary_max: number | null }
interface Group { roles: number; scoreSum: number }

/** Pay as the board counts it: a positive maximum up to $1M, else none. */
function payOf(row: LaneRow): number | null {
  const pay = Number(row.salary_max);
  return row.salary_max !== null && pay > 0 && pay <= 1000000 ? pay : null;
}

/** The salary band a fit-70 posting falls in. */
function bandOf(pay: number | null): string {
  if (pay === null) return 'n/a';
  if (pay < 150000) return '<150k';
  if (pay < 200000) return '150-200k';
  if (pay < 250000) return '200-250k';
  if (pay < 350000) return '250-350k';
  return '350k+';
}

/** Counts as rows, most first (ties by name, so the answer is stable). */
function ranked(counts: Map<string, number>, key: string, limit = Infinity): Record<string, unknown>[] {
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit).map(([name, n]) => ({ [key]: name, n }));
}

/**
 * @description Refuses at once when the corpus has no Insights index (it arrives with the next nightly ingest).
 * @param db - A handle with the corpus attached as `corpus`.
 * @returns Nothing; throws InsightsNotReady when the index is absent.
 */
function requireIndex(db: any): void {
  const found = db.prepare("SELECT 1 AS ok FROM corpus.sqlite_master WHERE type='index' AND name=?").get(INSIGHTS_INDEX);
  if (!found) throw new InsightsNotReady();
}

/**
 * @description The caller's scores for in-lane postings: one sequential pass of user_signals (`+posting_id` keeps
 * SQLite from probing the table by key 160K times, which is what made a cold read slow).
 * @param db - The caller's signals database with the corpus attached.
 * @returns posting id to COALESCE(ai_fit_score, fit_score, 0).
 */
function laneScores(db: any): Map<number, number> {
  const rows = db.prepare(
    `SELECT posting_id AS id, COALESCE(ai_fit_score, fit_score, 0) AS score FROM user_signals
      WHERE +posting_id IN (SELECT id FROM corpus.postings_corpus INDEXED BY ${INSIGHTS_INDEX}
                             WHERE active=1 AND target_role=1)`,
  ).all() as { id: number; score: number }[];
  return new Map(rows.map((row) => [Number(row.id), Number(row.score) || 0]));
}

/**
 * @description The twelve companies with the most in-lane roles that have a company record, as the board shows them.
 * @param db - Handle with the corpus attached. @param groups - Roles and score sums per company id.
 * @returns [{company, roles, avg_fit, referral}].
 */
function topCompanies(db: any, groups: Map<number, Group>): Record<string, unknown>[] {
  const ids = [...groups.keys()];
  const known = new Map((db.prepare(
    'SELECT id, name, COALESCE(referral, 0) AS referral FROM corpus.companies WHERE id IN (SELECT value FROM json_each(?))',
  ).all(JSON.stringify(ids)) as { id: number; name: string; referral: number }[]).map((c) => [Number(c.id), c]));
  return ids.filter((id) => known.has(id))
    .map((id) => {
      const g = groups.get(id) as Group;
      const c = known.get(id) as { name: string; referral: number };
      return { company: c.name, roles: g.roles, avg_fit: Math.trunc(g.scoreSum / g.roles), referral: Number(c.referral) || 0 };
    })
    .sort((a, b) => b.roles - a.roles || b.avg_fit - a.avg_fit || (a.company < b.company ? -1 : 1))
    .slice(0, TOP);
}

/**
 * @description The caller's pipeline counts by status.
 * @param db - The caller's signals database. @returns status to count.
 */
function statusCounts(db: any): Map<string, number> {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS n FROM user_signals WHERE status IN (${FUNNEL_STATUSES.map(() => '?').join(',')}) GROUP BY status`,
  ).all(...FUNNEL_STATUSES) as { status: string; n: number }[];
  return new Map(rows.map((row) => [row.status, Number(row.n)]));
}

/**
 * @description Reads Career Insights for one caller from covering indexes only.
 * @param db - The caller's signals database with the tenant corpus attached as `corpus`.
 * @returns {headline, funnel, topCompanies, states, salaryBands}, the shapes the Insights page reads.
 */
export function readAnalytics(db: any): Record<string, unknown> {
  requireIndex(db);
  const lane = db.prepare(
    `SELECT id, company_id, posted_date, state, salary_max FROM corpus.postings_corpus INDEXED BY ${INSIGHTS_INDEX}
      WHERE active=1 AND target_role=1`,
  ).all() as LaneRow[];
  const scores = laneScores(db);
  const fresh = (db.prepare("SELECT date('now','-7 days') AS d").get() as { d: string }).d;
  const groups = new Map<number, Group>();
  const states = new Map<string, number>();
  const bands = new Map<string, number>();
  let fit70 = 0; let fit80 = 0; let fresh7d = 0; let paySum = 0; let payCount = 0;
  for (const row of lane) {
    const score = scores.get(Number(row.id)) || 0;
    const group = groups.get(row.company_id) || { roles: 0, scoreSum: 0 };
    group.roles += 1; group.scoreSum += score;
    groups.set(row.company_id, group);
    const state = row.state === null || row.state === '' ? NO_STATE : String(row.state);
    states.set(state, (states.get(state) || 0) + 1);
    if (row.posted_date !== null && String(row.posted_date) >= fresh) fresh7d += 1;
    if (score >= 80) fit80 += 1;
    if (score < 70) continue;
    fit70 += 1;
    const pay = payOf(row);
    if (pay !== null) { paySum += pay; payCount += 1; }
    bands.set(bandOf(pay), (bands.get(bandOf(pay)) || 0) + 1);
  }
  const status = statusCounts(db);
  const funnel: Record<string, number> = { sourced: lane.length, qualified: fit70 };
  for (const name of FUNNEL_STATUSES) funnel[name] = status.get(name) || 0;
  return {
    headline: {
      inlane: lane.length, fit70, fit80, fresh7d,
      avg_pay_fit70: payCount ? Math.trunc(paySum / payCount) : null, companies: groups.size,
    },
    funnel,
    topCompanies: topCompanies(db, groups),
    states: ranked(states, 'state', TOP),
    salaryBands: ranked(bands, 'band'),
  };
}
