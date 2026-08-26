"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing ops rail (service auth, /api/marketing-ops):
 *     the deterministic daily metrics ingest (Search Console via the gsc spec + caller's google
 *     connection, PostHog via its spec, GitHub traffic via env token — every source fail-soft, a
 *     missing source is recorded NO DATA and never invented) and the weekly review (scorecard
 *     rollup + upsert, then ONE backlog ticket per owner with active campaigns — no bot runs and
 *     nothing publishes until a human approves it in the cockpit). Both are named manifest
 *     service-route schedule handlers AND thin POST wrappers. Ensures the 002 metrics tables at
 *     the lazy-DDL chokepoint (mirrored by migrations/002-marketing-metrics.sql).
 *
 * @module marketing-ops-routes
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMarketingDailyIngest = runMarketingDailyIngest;
exports.runMarketingWeeklyReview = runMarketingWeeklyReview;
exports.createMarketingOpsRoutes = createMarketingOpsRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const request_identity_1 = require("@/shared/services/database/request-identity");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const runtime_1 = require("@/app/connectors/runtime");
const spec_tools_1 = require("@/app/connectors/runtime/spec-tools");
const notifications_1 = require("@/features/notifications");
const marketing_model_1 = require("./marketing-model");
const logger = (0, logger_1.createChildLogger)({ module: 'marketing-ops-routes' });
/** Where connector spec yamls live on the box (env-tunable, container default). */
function connectorSpecDir() {
    return process.env.OSHAL_CONNECTOR_SPEC_DIR || '/app/swarm-apps/connectors';
}
/** Base URL used in operator notifications that deep-link the cockpit (env-tunable). */
function cockpitBaseUrl() {
    return process.env.OSHAL_COCKPIT_BASE_URL || 'http://localhost:35457';
}
// ---------------------------------------------------------------------------
// Schema: the 002 metrics tables, mirrored verbatim by migrations/002-marketing-metrics.sql.
// ---------------------------------------------------------------------------
const EVENTS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS oshal_marketing_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub      TEXT NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL,
  campaign_slug TEXT,
  medium        TEXT,
  event         TEXT NOT NULL,
  value         NUMERIC NOT NULL DEFAULT 0,
  meta          JSONB NOT NULL DEFAULT '{}'
)`;
const SCORECARD_TABLE_DDL = `CREATE TABLE IF NOT EXISTS oshal_marketing_scorecard_weeks (
  user_sub    TEXT NOT NULL,
  week_start  DATE NOT NULL,
  data        JSONB NOT NULL,
  sources     JSONB NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_sub, week_start)
)`;
const RUN_LEDGER_TABLE_DDL = `CREATE TABLE IF NOT EXISTS oshal_marketing_run_ledger (
  run_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub TEXT NOT NULL,
  channel  TEXT NOT NULL,
  action   TEXT NOT NULL,
  outcome  TEXT NOT NULL,
  detail   JSONB NOT NULL DEFAULT '{}',
  ts       TIMESTAMPTZ NOT NULL DEFAULT now()
)`;
/** Ensure the 002 metrics tables + owner FORCE-RLS at the lazy-DDL chokepoint. */
async function ensureOpsSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'marketing-ops',
        statements: [
            EVENTS_TABLE_DDL,
            'CREATE INDEX IF NOT EXISTS idx_oshal_marketing_events_owner_ts ON oshal_marketing_events (user_sub, ts DESC)',
            'CREATE INDEX IF NOT EXISTS idx_oshal_marketing_events_owner_source_ts ON oshal_marketing_events (user_sub, source, ts DESC)',
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_marketing_events', 'user_sub'),
            SCORECARD_TABLE_DDL,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_marketing_scorecard_weeks', 'user_sub'),
            RUN_LEDGER_TABLE_DDL,
            'CREATE INDEX IF NOT EXISTS idx_oshal_marketing_run_ledger_owner_channel_ts ON oshal_marketing_run_ledger (user_sub, channel, ts DESC)',
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_marketing_run_ledger', 'user_sub'),
        ],
        requirements: [
            { table: 'oshal_marketing_events', columns: ['event_id', 'user_sub', 'ts', 'source', 'event', 'value', 'meta'] },
            { table: 'oshal_marketing_scorecard_weeks', columns: ['user_sub', 'week_start', 'data', 'sources'] },
            { table: 'oshal_marketing_run_ledger', columns: ['run_id', 'user_sub', 'channel', 'action', 'outcome', 'detail'] },
        ],
    });
}
let schemaReady = null;
/** Bootstrap the metrics schema once per loaded module; a failure resets so the next run retries. */
function ensureSchemaOnce(ctx) {
    if (!schemaReady) {
        schemaReady = ensureOpsSchema(ctx.pool).catch((err) => {
            schemaReady = null;
            throw err;
        });
    }
    return schemaReady;
}
// ---------------------------------------------------------------------------
// Daily ingest
// ---------------------------------------------------------------------------
/**
 * @description The deterministic daily metrics ingest (manifest schedule `daily-metrics-ingest`,
 * also POST /api/marketing-ops/ingest). Under the system identity it enumerates every marketing
 * owner (active campaigns UNION channel authorization rows) and pulls each configured source
 * fail-soft: Search Console via the gsc connector spec over the caller's google connection,
 * PostHog via its spec, and GitHub traffic via an env token. A source that cannot be read is
 * recorded NO DATA — a number is never invented. Day-bucket rewrites are idempotent (delete the
 * same (owner, source, meta.date) rows, then insert).
 * @param ctx - The per-package app context (GUC-wrapped pool).
 * @param fire - The kernel's schedule fire input (scheduleId/scheduledAtIso/body).
 * @returns A summary line (<=512 chars) for the scheduler.
 */
async function runMarketingDailyIngest(ctx, fire) {
    const startedAt = Date.now();
    logger.info({ scheduleId: fire?.scheduleId ?? 'daily-metrics-ingest' }, 'marketing daily ingest starting');
    return (0, request_identity_1.runWithSystemIdentity)(async () => {
        await ensureSchemaOnce(ctx);
        const subs = await ingestUserSubs(ctx);
        const github = await fetchGithubTraffic();
        const t = {
            gscOk: 0, gscNoData: 0, posthogNoData: 0, githubOk: 0, githubNoData: 0, events: 0, errors: 0,
        };
        for (const sub of subs)
            await ingestForUser(ctx, sub, github, t);
        const summary = [
            `ingest: users=${subs.length}`,
            `gsc ok=${t.gscOk} no_data=${t.gscNoData}`,
            `posthog no_data=${t.posthogNoData}`,
            `github ok=${t.githubOk} no_data=${t.githubNoData}${github.status === 'no_data' ? ` (${github.reason})` : ''}`,
            `events=${t.events}`,
            `errors=${t.errors}`,
        ].join('; ').slice(0, 500);
        logger.info({ durationMs: Date.now() - startedAt, summary }, 'marketing daily ingest complete');
        return { summary };
    });
}
/** All owners the ingest serves: active-campaign owners UNION channel-authorization owners. */
async function ingestUserSubs(ctx) {
    const subs = new Set();
    const arms = [
        "SELECT DISTINCT user_sub FROM oshal_marketing_campaigns WHERE status = 'active'",
        'SELECT DISTINCT user_sub FROM oshal_marketing_channel_authorizations',
    ];
    for (const sql of arms) {
        try {
            const { rows } = await ctx.pool.query(sql);
            for (const row of rows)
                if (row?.user_sub)
                    subs.add(String(row.user_sub));
        }
        catch (err) {
            logger.error({ err, stack: err?.stack }, 'marketing ingest: owner enumeration arm unavailable (001 tables may not be ensured yet)');
        }
    }
    return [...subs].sort();
}
/** Run every source for one owner, fail-soft per source, updating the run tallies. */
async function ingestForUser(ctx, sub, github, t) {
    const gsc = await safeSource('gsc', sub, () => ingestSearchConsole(ctx, sub));
    if (gsc.status === 'ok') {
        t.gscOk += 1;
        t.events += gsc.events;
    }
    else {
        t.gscNoData += 1;
    }
    if (gsc.reason === 'error')
        t.errors += 1;
    const ph = await safeSource('posthog', sub, () => ingestPosthog(ctx, sub));
    if (ph.status === 'no_data')
        t.posthogNoData += 1;
    if (ph.reason === 'error')
        t.errors += 1;
    if (github.status !== 'ok') {
        t.githubNoData += 1;
        return;
    }
    try {
        t.events += await writeGithubEvents(ctx, sub, github.byDate);
        t.githubOk += 1;
    }
    catch (err) {
        logger.error({ err, stack: err?.stack, sub: sub.slice(0, 12) }, 'github event write failed');
        t.githubNoData += 1;
        t.errors += 1;
    }
}
/** Guard one source read: any throw is logged and honestly recorded as no_data, never re-thrown. */
async function safeSource(source, sub, work) {
    try {
        return await work();
    }
    catch (err) {
        logger.error({ err, stack: err?.stack, source, sub: sub.slice(0, 12) }, 'marketing ingest source failed');
        return { status: 'no_data', events: 0, reason: 'error' };
    }
}
/** The last-2-complete-days window Search Console data has settled for (UTC, ~2-day latency). */
function gscWindow(now) {
    const day = (offset) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset))
        .toISOString().slice(0, 10);
    const startDate = day(3);
    const endDate = day(2);
    return { startDate, endDate, dates: [startDate, endDate] };
}
/** Search Console ingest for one owner: sites -> per-date clicks/impressions aggregates. */
async function ingestSearchConsole(ctx, sub) {
    let spec;
    try {
        spec = (0, runtime_1.loadConnectorSpec)(path.join(connectorSpecDir(), 'google-search-console.yaml'));
    }
    catch (err) {
        logger.error({ err, stack: err?.stack }, 'gsc connector spec load failed');
        return { status: 'no_data', events: 0, reason: 'spec_missing' };
    }
    const creds = await (0, spec_tools_1.resolveConnectorSpecCreds)(spec, ctx.pool, sub, connectors_routes_1.getValidAccessToken);
    if (!creds)
        return { status: 'no_data', events: 0, reason: 'not_connected' };
    const window = gscWindow(new Date());
    const sites = await gscSiteUrls(spec, creds);
    if (!sites.length)
        return { status: 'no_data', events: 0, reason: 'no_sites' };
    const { totals, succeeded } = await gscDateTotals(spec, creds, sites, window);
    if (!succeeded)
        return { status: 'no_data', events: 0, reason: 'query_failed' };
    const rows = window.dates.flatMap((date) => [
        { event: 'clicks', date, value: totals.get(date)?.clicks ?? 0, meta: {} },
        { event: 'impressions', date, value: totals.get(date)?.impressions ?? 0, meta: {} },
    ]);
    const written = await replaceDayEvents(ctx, sub, 'gsc', rows);
    return { status: 'ok', events: written };
}
/** The owner's verified Search Console site URLs (unverified permission levels excluded). */
async function gscSiteUrls(spec, creds) {
    const res = await (0, runtime_1.invokeSpecResource)(spec, creds, 'sites', {});
    if (!res?.body?.ok) {
        logger.warn({ status: res?.status }, 'gsc sites listing not ok');
        return [];
    }
    const data = res.body.data;
    const entries = Array.isArray(data?.siteEntry) ? data.siteEntry : [];
    return entries
        .filter((e) => typeof e?.siteUrl === 'string' && e.siteUrl !== '' && e.permissionLevel !== 'siteUnverifiedUser')
        .map((e) => String(e.siteUrl));
}
/** Aggregate clicks/impressions per date across the owner's sites for the settled window. */
async function gscDateTotals(spec, creds, sites, window) {
    const totals = new Map();
    let succeeded = false;
    for (const siteUrl of sites) {
        try {
            const res = await (0, runtime_1.invokeSpecResource)(spec, creds, 'searchanalytics', {
                siteUrl, startDate: window.startDate, endDate: window.endDate, dimensions: ['date'], rowLimit: 100,
            });
            if (!res?.body?.ok) {
                logger.warn({ siteUrl, status: res?.status }, 'gsc searchanalytics query not ok');
                continue;
            }
            succeeded = true;
            const rows = res.body.data?.rows ?? [];
            for (const row of rows) {
                const date = Array.isArray(row?.keys) ? String(row.keys[0] ?? '') : '';
                if (!window.dates.includes(date))
                    continue;
                const bucket = totals.get(date) ?? { clicks: 0, impressions: 0 };
                bucket.clicks += Number(row?.clicks) || 0;
                bucket.impressions += Number(row?.impressions) || 0;
                totals.set(date, bucket);
            }
        }
        catch (err) {
            logger.error({ err, stack: err?.stack, siteUrl }, 'gsc searchanalytics query failed');
        }
    }
    return { totals, succeeded };
}
/**
 * PostHog ingest for one owner. The core posthog.yaml (v1.0.0) declares only unbounded list
 * resources (organizations/projects/events/...); there is no bounded count or trends resource, and
 * a full paginated /events walk is not an honestly bounded daily number — so a connected account is
 * recorded no_data with reason 'resource_unavailable' rather than inventing a figure.
 */
async function ingestPosthog(ctx, sub) {
    let spec;
    try {
        spec = (0, runtime_1.loadConnectorSpec)(path.join(connectorSpecDir(), 'posthog.yaml'));
    }
    catch (err) {
        logger.error({ err, stack: err?.stack }, 'posthog connector spec load failed');
        return { status: 'no_data', events: 0, reason: 'spec_missing' };
    }
    const creds = await (0, spec_tools_1.resolveConnectorSpecCreds)(spec, ctx.pool, sub, connectors_routes_1.getValidAccessToken);
    if (!creds)
        return { status: 'no_data', events: 0, reason: 'not_connected' };
    logger.info({ sub: sub.slice(0, 12) }, 'posthog connected but the spec offers no bounded count resource — recording no_data');
    return { status: 'no_data', events: 0, reason: 'resource_unavailable' };
}
/** Fetch GitHub traffic (views + clones, trailing 14 days) once per run via the env token. */
async function fetchGithubTraffic() {
    const token = process.env.GITHUB_TRAFFIC_TOKEN || process.env.OSHAL_DEV_REPO_TOKEN || '';
    const byDate = new Map();
    if (!token)
        return { status: 'no_data', reason: 'no_token', byDate };
    const repos = (process.env.MARKETING_GITHUB_REPOS || 'emeraldcoastsystemsgroup/oshal')
        .split(',').map((r) => r.trim()).filter(Boolean);
    let succeeded = false;
    for (const repo of repos) {
        for (const kind of ['views', 'clones']) {
            try {
                const res = await fetch(`https://api.github.com/repos/${repo}/traffic/${kind}`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/vnd.github+json',
                        'User-Agent': 'oshal-marketing-engine',
                    },
                    signal: AbortSignal.timeout(15_000),
                });
                if (!res.ok) {
                    logger.warn({ repo, kind, status: res.status }, 'github traffic fetch not ok');
                    continue;
                }
                const payload = (await res.json());
                const buckets = Array.isArray(payload?.[kind])
                    ? payload[kind] : [];
                succeeded = true;
                for (const bucket of buckets)
                    mergeGithubBucket(byDate, kind, bucket);
            }
            catch (err) {
                logger.error({ err, stack: err?.stack, repo, kind }, 'github traffic fetch failed');
            }
        }
    }
    return succeeded ? { status: 'ok', byDate } : { status: 'no_data', reason: 'fetch_failed', byDate };
}
/** Fold one GitHub daily bucket into the per-date totals (dates validated, counts summed). */
function mergeGithubBucket(byDate, kind, bucket) {
    const date = typeof bucket?.timestamp === 'string' ? bucket.timestamp.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return;
    const t = byDate.get(date) ?? { views: 0, viewUniques: 0, clones: 0, cloneUniques: 0 };
    if (kind === 'views') {
        t.views += Number(bucket?.count) || 0;
        t.viewUniques += Number(bucket?.uniques) || 0;
    }
    else {
        t.clones += Number(bucket?.count) || 0;
        t.cloneUniques += Number(bucket?.uniques) || 0;
    }
    byDate.set(date, t);
}
/** Write the GitHub day buckets into one owner's event store (uniques ride in meta). */
async function writeGithubEvents(ctx, sub, byDate) {
    const rows = [];
    for (const [date, t] of byDate) {
        rows.push({ event: 'views', date, value: t.views, meta: { uniques: t.viewUniques } });
        rows.push({ event: 'clones', date, value: t.clones, meta: { uniques: t.cloneUniques } });
    }
    return rows.length ? replaceDayEvents(ctx, sub, 'github', rows) : 0;
}
/** Idempotent day-bucket rewrite: delete the same (owner, source, meta.date) rows, then insert. */
async function replaceDayEvents(ctx, sub, source, rows) {
    if (!rows.length)
        return 0;
    const dates = [...new Set(rows.map((r) => r.date))];
    await ctx.pool.query("DELETE FROM oshal_marketing_events WHERE user_sub = $1 AND source = $2 AND meta->>'date' = ANY($3::text[])", [sub, source, dates]);
    for (const row of rows) {
        await ctx.pool.query(`INSERT INTO oshal_marketing_events (user_sub, ts, source, event, value, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [sub, `${row.date}T00:00:00.000Z`, source, row.event, row.value,
            JSON.stringify({ ...row.meta, date: row.date })]);
    }
    return rows.length;
}
// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------
/**
 * @description The weekly review (manifest schedule `weekly-campaign-review`, also POST
 * /api/marketing-ops/weekly). Under the system identity, for every owner with active campaigns:
 * roll the trailing 8 ISO weeks of events into the current and previous week's scorecard rows,
 * then open ONE `marketing-campaign` ticket in `backlog` — the human front gate: no bot works it
 * and nothing publishes until a human approves it in the cockpit — and notify the operator
 * best-effort with the ticket deep link.
 * @param ctx - The per-package app context (pool + ticketService).
 * @param fire - The kernel's schedule fire input (scheduleId/scheduledAtIso/body).
 * @returns A summary line (<=512 chars) for the scheduler.
 */
async function runMarketingWeeklyReview(ctx, fire) {
    const startedAt = Date.now();
    logger.info({ scheduleId: fire?.scheduleId ?? 'weekly-campaign-review' }, 'marketing weekly review starting');
    return (0, request_identity_1.runWithSystemIdentity)(async () => {
        await ensureSchemaOnce(ctx);
        const owners = await activeCampaignOwners(ctx);
        const week = (0, marketing_model_1.weekStartOf)(new Date().toISOString());
        let tickets = 0;
        let errors = 0;
        for (const sub of owners) {
            try {
                await reviewForOwner(ctx, sub, week, fire);
                tickets += 1;
            }
            catch (err) {
                logger.error({ err, stack: err?.stack, sub: sub.slice(0, 12) }, 'weekly review failed for owner');
                errors += 1;
            }
        }
        const summary = `weekly review: week=${week}; owners=${owners.length}; tickets=${tickets}; errors=${errors}`
            .slice(0, 500);
        logger.info({ durationMs: Date.now() - startedAt, summary }, 'marketing weekly review complete');
        return { summary };
    });
}
/** Owners with at least one active campaign (the only owners a review ticket is opened for). */
async function activeCampaignOwners(ctx) {
    try {
        const { rows } = await ctx.pool.query("SELECT DISTINCT user_sub FROM oshal_marketing_campaigns WHERE status = 'active'");
        return rows.map((r) => String(r.user_sub)).filter(Boolean).sort();
    }
    catch (err) {
        logger.error({ err, stack: err?.stack }, 'weekly review: campaign owner enumeration unavailable (001 tables may not be ensured yet)');
        return [];
    }
}
/** Build one owner's scorecard rows + backlog review ticket, then notify best-effort. */
async function reviewForOwner(ctx, sub, week, fire) {
    const prevWeek = shiftDaysIso(week, -7);
    const windowStart = shiftDaysIso(week, -49);
    const { rows: events } = await ctx.pool.query(`SELECT ts, source, event, medium, campaign_slug, value FROM oshal_marketing_events
      WHERE user_sub = $1 AND ts >= $2 ORDER BY ts LIMIT 20000`, [sub, `${windowStart}T00:00:00.000Z`]);
    const current = (0, marketing_model_1.scorecardRollup)(events, week);
    const previous = (0, marketing_model_1.scorecardRollup)(events, prevWeek);
    await upsertScorecardWeek(ctx, sub, week, current);
    await upsertScorecardWeek(ctx, sub, prevWeek, previous);
    const proposals = await pendingProposalCount(ctx, sub);
    const due = await experimentsDue(ctx, sub);
    const description = buildReviewDescription(week, prevWeek, current, previous, proposals, due);
    if (!ctx.ticketService)
        throw new Error('ticketService unavailable on the app context');
    const ticket = await ctx.ticketService.createTicket({
        title: `Weekly marketing review — ${week}`,
        ticketType: 'marketing-campaign',
        description,
        status: 'backlog',
        priority: 'medium',
        labels: ['marketing'],
        ownerSub: sub,
        metadata: { source: 'schedule', scheduleId: fire?.scheduleId ?? 'weekly-campaign-review', week },
    });
    try {
        await (0, notifications_1.notifyOperator)({
            text: `Marketing weekly review awaits approval: ${cockpitBaseUrl()}/cockpit/?ticket=${ticket.ticketId}`,
        });
    }
    catch (err) {
        logger.error({ err, stack: err?.stack }, 'weekly review notify failed (non-fatal)');
    }
}
/** Upsert one owner's scorecard row for one week (data + honest per-source status). */
async function upsertScorecardWeek(ctx, sub, week, rollup) {
    await ctx.pool.query(`INSERT INTO oshal_marketing_scorecard_weeks (user_sub, week_start, data, sources, computed_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
     ON CONFLICT (user_sub, week_start)
     DO UPDATE SET data = EXCLUDED.data, sources = EXCLUDED.sources, computed_at = now()`, [sub, week, JSON.stringify(rollup.data), JSON.stringify(rollup.sources)]);
}
/** How many budget proposals await a human decision (0 when the 001 table is not ensured yet). */
async function pendingProposalCount(ctx, sub) {
    try {
        const { rows } = await ctx.pool.query("SELECT COUNT(*)::int AS n FROM oshal_marketing_budget_ledger WHERE user_sub = $1 AND status = 'proposed'", [sub]);
        return Number(rows[0]?.n) || 0;
    }
    catch (err) {
        logger.error({ err, stack: err?.stack }, 'pending proposal count unavailable');
        return 0;
    }
}
/** Running/extended experiments whose window has ended (empty when the 001 table is absent). */
async function experimentsDue(ctx, sub) {
    try {
        const { rows } = await ctx.pool.query(`SELECT hypothesis, variable, status, window_end FROM oshal_marketing_experiments
        WHERE user_sub = $1 AND status IN ('running','extended')
          AND window_end IS NOT NULL AND window_end <= CURRENT_DATE
        ORDER BY window_end LIMIT 5`, [sub]);
        return rows.map((r) => ({
            hypothesis: String(r.hypothesis), variable: String(r.variable),
            status: String(r.status), windowEnd: dateOnly(r.window_end),
        }));
    }
    catch (err) {
        logger.error({ err, stack: err?.stack }, 'experiments-due read unavailable');
        return [];
    }
}
/** A pg DATE (Date or string) as 'YYYY-MM-DD'. */
function dateOnly(v) {
    return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
}
/** 'YYYY-MM-DD' shifted by whole days (UTC math). */
function shiftDaysIso(dateIso, days) {
    const ms = Date.parse(`${dateIso}T00:00:00.000Z`);
    return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}
/** A markdown table cell for one source's week: real numbers, or NO DATA — never an invented 0. */
function sourceCell(bucket) {
    return bucket ? `${bucket.events} events / value ${bucket.value}` : 'NO DATA';
}
/** The review ticket body: scorecard tables, pending decisions, and the director's brief. */
function buildReviewDescription(week, prevWeek, current, previous, proposals, due) {
    const lines = [`## Weekly marketing scorecard — week of ${week}`, ''];
    lines.push(`| Source | This week (${week}) | Last week (${prevWeek}) | Status |`, '| --- | --- | --- | --- |');
    const names = [...new Set([...Object.keys(current.sources), ...Object.keys(previous.sources)])].sort();
    for (const s of names) {
        const cur = current.sources[s]?.status === 'ok' ? sourceCell(current.data.bySource[s]) : 'NO DATA';
        const prev = previous.sources[s]?.status === 'ok' ? sourceCell(previous.data.bySource[s]) : 'NO DATA';
        lines.push(`| ${s} | ${cur} | ${prev} | ${current.sources[s]?.status === 'ok' ? 'OK' : 'NO DATA'} |`);
    }
    lines.push('', `Totals this week: ${current.data.totals.events} events (value ${current.data.totals.value}); `
        + `last week: ${previous.data.totals.events} events (value ${previous.data.totals.value}).`);
    lines.push('', '## Pending budget proposals', proposals > 0 ? `${proposals} proposal(s) awaiting a human decision on the Approvals pane.` : 'None.');
    lines.push('', '## Experiments past their window');
    if (due.length) {
        for (const d of due) {
            lines.push(`- [${d.status}] ${d.hypothesis} (variable: ${d.variable}; window ended ${d.windowEnd})`);
        }
    }
    else {
        lines.push('None.');
    }
    lines.push('', '## Instructions for campaign-director', 'You are reviewing, not publishing. Working this ticket, produce:', '1. A short narrative of what moved and why — cite only the numbers above; a NO DATA source stays NO DATA (never invent a figure).', '2. A PROPOSALS section: budget or stage changes as proposals only — a human decides each one on the Approvals pane.', '3. A verdict (extend / kill / scale) with one line of reasoning for each experiment past its window.', 'You never publish content, never change budgets or consent, and never spend. Humans approve everything.');
    return lines.join('\n');
}
// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
/** A manual-run wrapper turning one schedule handler into a service-auth POST endpoint. */
function manualRunHandler(ctx, manualId, handler) {
    return async (req, res) => {
        const startedAt = Date.now();
        logger.info({ manualId }, 'marketing-ops manual run starting');
        try {
            const body = (req.body && typeof req.body === 'object' ? req.body : {});
            const result = await handler(ctx, {
                scheduleId: manualId, scheduledAtIso: new Date().toISOString(), body,
            });
            logger.info({ manualId, durationMs: Date.now() - startedAt }, 'marketing-ops manual run complete');
            res.json(result);
        }
        catch (err) {
            logger.error({ err, stack: err?.stack, manualId, durationMs: Date.now() - startedAt }, 'marketing-ops manual run failed');
            res.status(500).json({ error: 'marketing_ops_failed' });
        }
    };
}
/**
 * @description Route factory for the marketing ops rail, mounted at /api/marketing-ops with
 * `auth: service` (fail-closed without the service secret; browser sessions never reach it).
 * POST /ingest and POST /weekly are thin manual wrappers over the named schedule handlers
 * runMarketingDailyIngest / runMarketingWeeklyReview.
 * @param ctx - The per-package app context.
 * @returns The Express router.
 */
function createMarketingOpsRoutes(ctx) {
    const router = (0, express_1.Router)();
    void ensureSchemaOnce(ctx).catch((err) => {
        logger.error({ err, stack: err?.stack }, 'marketing-ops schema bootstrap failed at mount');
    });
    router.post('/ingest', manualRunHandler(ctx, 'manual-daily-ingest', runMarketingDailyIngest));
    router.post('/weekly', manualRunHandler(ctx, 'manual-weekly-review', runMarketingWeeklyReview));
    return router;
}
