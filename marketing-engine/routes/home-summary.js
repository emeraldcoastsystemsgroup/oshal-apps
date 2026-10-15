"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Owner-scoped Home summary route (ADR-145): saved-content counts, publish counts from the run ledger, and recent content items with prepare-* integration actions. GET only, bounded queries, no side effects.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Readable, documented, and unit-tested: the shaping is split into exported pure helpers (functions under 50 lines), the footnote now fits the core 120-character item text cap whole (its explanation rides in detail, cap 400) instead of being clipped mid-sentence, tile values are bounded to the 16-character cap, and `as any` is replaced by a typed pg query config. Behaviour is otherwise unchanged. The module stays DELIBERATELY import-free at runtime (express only — the pg and AppContext imports are type-only): the store Home harness (scripts/creative-home.test.cjs) loads every summary with an express-only require, so a Home summary can never reach a logger, connector, or other capability. Do not add runtime imports here.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The summary also counts the owner's campaigns (a fourth owner-scoped, read-only query): one `campaigns` metric (not archived) whose detail splits active/draft/paused and names the five newest, so the concierge and Home read the campaigns the Board shows instead of saying they cannot see them. It rides in `metrics` only; the four tiles are unchanged. A failed campaign read is Unavailable, never zero.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The newest names are a fifth plain query (ORDER BY updated_at DESC LIMIT 5) instead of array_to_string(array_agg(...)): the native kernel's package SQL refuses array_to_string ("unsupported SQL function"), so the campaigns metric read Unavailable live. Not archived is status IN ('active','draft','paused').
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 11: the concierge listed all ten campaigns as "LinkedIn · draft · saved <time>" although only the three newest drafts' times were in this summary; it invented the rest (and a draft for a campaign that has none). Each of the six most recently updated campaigns (archived included, as the Board lists them) is now its own metric carrying its real draft count and its newest draft's saved time, or "No drafts"; campaigns beyond those six are one metric saying their drafts are not listed here. Two more plain owner-scoped SELECTs (the campaigns, and the draft rows' campaign and time) joined here, no GROUP BY or aggregate the native package SQL might refuse.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 12: with six campaigns listed and the rest collapsed into one "Other campaigns: 4" row, the concierge said "No drafts" for three campaigns that each had one and "4 other campaigns not listed on this screen" while all ten were on the Board. Every campaign (newest first, up to 40 read) now carries its status and real draft count and newest draft time, packed into the seven metric rows the concierge keeps (value then detail, 120 characters each, no entry cut); only campaigns past those rows are counted as not in this summary. The packed rows are concierge-only (defaultVisible false) so the Home card is unchanged.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 13: a campaign's newest draft time is an RFC 3339 instant with seconds ("2026-10-12T03:55:00Z"), so the kernel writes it in the person's zone; "2026-10-12T03:55Z" did not parse and the concierge converted it itself, wrongly. Guard: tests/home-summary.test.mjs.
 *
 * @module home-summary
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRAFT_ROW_LIMIT = exports.CONCIERGE_FIELD_CHARS = exports.CAMPAIGN_READ_LIMIT = exports.CAMPAIGN_DRAFT_ROWS = exports.HOME_SUMMARY_QUERIES = exports.CONTENT_ITEM_ACTIONS = exports.HOME_SUMMARY_LIMITS = void 0;
exports.clip = clip;
exports.isoDate = isoDate;
exports.campaignMetric = campaignMetric;
exports.packEntries = packEntries;
exports.campaignDraftMetrics = campaignDraftMetrics;
exports.buildMarketingHomeSummary = buildMarketingHomeSummary;
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
const express_1 = require("express");
/** Core Home caps (framework app-home-plan.ts). Anything longer is clipped by core, so never emit it. */
exports.HOME_SUMMARY_LIMITS = {
    tiles: 4,
    items: 5,
    labelChars: 24,
    valueChars: 16,
    textChars: 120,
    detailChars: 400,
    notesChars: 2000,
    bodyChars: 1500,
};
/** Package identity every item's `fix` link points back to. */
const FIX = 'marketing-engine';
/** Per-query ceiling so one slow table can never hold the Home view open. */
const QUERY_TIMEOUT_MS = 1800;
/** Integration offers a saved content item can hand to (each is declared in integrations.offers). */
exports.CONTENT_ITEM_ACTIONS = ['prepare-document', 'prepare-post', 'prepare-social', 'prepare-video'];
/**
 * The seven owner-scoped, read-only queries, in result order. $1 = caller sub, $2 = request time
 * (rows newer than the request are excluded so the counts and the item list agree).
 */
exports.HOME_SUMMARY_QUERIES = [
    "SELECT count(*) FILTER (WHERE c.status='draft')::text AS drafts, count(*) FILTER (WHERE c.status='approved')::text AS approved FROM oshal_marketing_content c WHERE c.user_sub = $1 AND c.created_at <= $2 AND c.updated_at <= $2 AND (c.campaign_id IS NULL OR EXISTS (SELECT 1 FROM oshal_marketing_campaigns p WHERE p.campaign_id=c.campaign_id AND p.user_sub = $1))",
    "SELECT count(*) FILTER (WHERE outcome='published' AND ts > $2::timestamptz - interval '24 hours')::text AS day, count(*) FILTER (WHERE outcome='published')::text AS five FROM oshal_marketing_run_ledger WHERE user_sub = $1 AND ts <= $2 AND ts > $2::timestamptz - interval '120 hours'",
    "SELECT c.title, c.body, c.channel, c.status, c.updated_at FROM oshal_marketing_content c WHERE c.user_sub = $1 AND c.created_at <= $2 AND c.updated_at <= $2 AND (c.campaign_id IS NULL OR EXISTS (SELECT 1 FROM oshal_marketing_campaigns p WHERE p.campaign_id=c.campaign_id AND p.user_sub = $1)) ORDER BY (c.status IN ('draft','approved')) DESC, c.updated_at DESC, c.item_id LIMIT 3",
    "SELECT count(*) FILTER (WHERE status IN ('active','draft','paused'))::text AS live, count(*) FILTER (WHERE status='active')::text AS active, count(*) FILTER (WHERE status='draft')::text AS draft, count(*) FILTER (WHERE status='paused')::text AS paused, count(*)::text AS total FROM oshal_marketing_campaigns WHERE user_sub = $1 AND created_at <= $2",
    "SELECT name FROM oshal_marketing_campaigns WHERE user_sub = $1 AND created_at <= $2 AND status IN ('active','draft','paused') ORDER BY updated_at DESC, campaign_id LIMIT 5",
    "SELECT campaign_id, name, status FROM oshal_marketing_campaigns WHERE user_sub = $1 AND created_at <= $2 ORDER BY updated_at DESC, campaign_id LIMIT 40",
    "SELECT c.campaign_id, c.updated_at FROM oshal_marketing_content c WHERE c.user_sub = $1 AND c.status = 'draft' AND c.created_at <= $2 AND c.updated_at <= $2 AND c.campaign_id IS NOT NULL AND EXISTS (SELECT 1 FROM oshal_marketing_campaigns p WHERE p.campaign_id=c.campaign_id AND p.user_sub = $1) ORDER BY c.updated_at DESC LIMIT 500",
];
/** Metric rows the campaign entries fill: the concierge keeps twelve, less the four tiles and the campaigns metric. */
exports.CAMPAIGN_DRAFT_ROWS = 7;
/** Campaigns read for those rows, newest first (the sixth query's LIMIT); the Board holds any beyond. */
exports.CAMPAIGN_READ_LIMIT = 40;
/** Characters the concierge keeps from one metric value and from one detail (crates/api/src/concierge_summary.rs). */
exports.CONCIERGE_FIELD_CHARS = 120;
/** Draft rows read per summary; at this many the counts say "or more". */
exports.DRAFT_ROW_LIMIT = 500;
/** Tile definitions: [query index, column, id, label]. */
const METRICS = [
    [0, 'drafts', 'content-drafts', 'Drafts to review'],
    [0, 'approved', 'content-approved', 'Approved content'],
    [1, 'day', 'published-24h', 'Published / 24h'],
    [1, 'five', 'published-5d', 'Published / 5 days'],
];
/** The standing footnote: a line that fits the text cap, with the full explanation in detail. */
const FOOTNOTE = {
    text: 'Counts come from saved content and recorded publish outcomes.',
    detail: 'Review counts reflect current saved content states. Publish counts come only from recorded '
        + 'published outcomes, not drafts or skipped attempts. Connected actions prepare editable drafts; '
        + 'destination consent and publishing controls still apply.',
    tone: 'neutral',
    fix: FIX,
};
/**
 * @description Collapse whitespace and bound a value to a character cap.
 * @param value - Any row value (null/undefined become '')
 * @param cap - Maximum characters kept
 * @returns The trimmed, single-spaced, bounded string
 */
function clip(value, cap) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
}
/**
 * @description Render a row timestamp as ISO-8601, or an honest placeholder when it is unparseable.
 * @param value - A Date, ISO string, or anything else
 * @returns ISO timestamp or 'date unavailable'
 */
function isoDate(value) {
    const parsed = new Date(String(value));
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : 'date unavailable';
}
/** Build the four count tiles; a failed query reads 'Unavailable', never a guessed zero. */
function metricTiles(results) {
    return METRICS.map(([index, column, id, label]) => {
        const rows = results[index];
        const value = rows === null ? 'Unavailable' : String(rows[0]?.[column] ?? '0');
        return { id, label, value: clip(value, exports.HOME_SUMMARY_LIMITS.valueChars) };
    });
}
/** Label of the campaigns metric (fits the 24-character label cap). */
const CAMPAIGN_LABEL = 'Campaigns (not archived)';
/**
 * @description The campaigns metric (in `metrics` only, never a tile): campaigns not archived, the
 * active/draft/paused split (fourth query) and the five newest names (fifth query). A failed count is Unavailable;
 * failed names leave the split without names.
 * @param rows - The campaign count query's rows, null when it failed, undefined when it was not run
 * @param names - The newest campaign names' rows, null when that read failed
 * @returns One metric with its split in `detail`
 */
function campaignMetric(rows, names) {
    if (rows === null)
        return { id: 'campaigns', label: CAMPAIGN_LABEL, value: 'Unavailable' };
    const row = rows?.[0] ?? {};
    const split = `${clip(row.active ?? '0', 8)} active, ${clip(row.draft ?? '0', 8)} draft, ${clip(row.paused ?? '0', 8)} paused`;
    const newest = clip((names ?? []).map((name) => clip(name.name, 60)).filter(Boolean).join(' | '), 300);
    return {
        id: 'campaigns',
        label: CAMPAIGN_LABEL,
        value: clip(row.live ?? '0', exports.HOME_SUMMARY_LIMITS.valueChars),
        detail: clip(newest ? `${split}; newest: ${newest}` : split, exports.HOME_SUMMARY_LIMITS.detailChars),
    };
}
/** Each campaign's draft count and newest draft time, from the draft rows (newest first). */
function draftsByCampaign(rows) {
    const drafts = new Map();
    for (const row of rows ?? []) {
        const id = String(row.campaign_id ?? '');
        const held = drafts.get(id);
        if (held)
            held.count += 1;
        else
            drafts.set(id, { count: 1, newest: row.updated_at });
    }
    return drafts;
}
/**
 * A row time to the minute as an RFC 3339 instant ("2026-10-13T03:12:00Z"), or the honest placeholder. The seconds are
 * written (as :00) because the kernel writes a summary instant in the person's zone only when it parses as RFC 3339:
 * sweep 13's "2026-10-12T03:55Z" stayed UTC and the concierge converted it itself, wrongly (10:55 AM CDT for 10:55 PM).
 */
function minuteStamp(value) {
    const iso = isoDate(value);
    return iso.length === 24 ? `${iso.slice(0, 16)}:00Z` : iso;
}
/** One campaign's entry: its name and status with its real draft count and newest draft time, or none. */
function campaignEntry(row, counted, more) {
    const head = `${clip(row.name || 'Untitled campaign', 40)} (${clip(row.status, 12)})`;
    if (!counted)
        return `${head}: drafts could not be read`;
    const held = counted.get(String(row.campaign_id ?? ''));
    if (!held)
        return `${head}: no drafts`;
    return `${head}: ${held.count}${more} draft${held.count === 1 && !more ? '' : 's'}, newest saved ${minuteStamp(held.newest)}`;
}
/**
 * @description Pack entries in order into at most `rows` rows, filling each row's value and then its detail up to the
 * characters the concierge keeps, so no entry is cut and none is skipped.
 * @param entries - Campaign entries, newest first
 * @param rows - Rows available
 * @returns The packed rows
 */
function packEntries(entries, rows) {
    const packed = [];
    let at = 0;
    while (at < entries.length && packed.length < rows) {
        const row = { value: '', detail: '', first: at + 1, last: at };
        for (const field of ['value', 'detail']) {
            while (at < entries.length) {
                const next = row[field] ? `${row[field]}; ${entries[at]}` : entries[at];
                if (next.length > exports.CONCIERGE_FIELD_CHARS && row[field])
                    break;
                row[field] = clip(next, exports.CONCIERGE_FIELD_CHARS);
                at += 1;
                row.last = at;
            }
        }
        packed.push(row);
    }
    return packed;
}
/** The packed rows as concierge-only metrics (kept off the Home card unless chosen). */
function packedMetrics(packed) {
    return packed.map((row, index) => ({
        id: `campaign-drafts-${index + 1}`,
        label: `Campaign drafts, campaigns ${row.first} to ${row.last} (newest first)`,
        value: row.value,
        ...(row.detail ? { detail: row.detail } : {}),
        defaultVisible: false,
    }));
}
/**
 * @description Every campaign, newest first, with its status and real draft count and newest draft's saved time (or "no
 * drafts"), packed into the rows the concierge keeps. Sweep 11: with only the three newest drafts' times the concierge
 * extended them to every campaign; sweep 12: with six campaigns listed and the rest one "Other campaigns" row it said
 * "No drafts" for campaigns that each had one. Only campaigns past what the rows hold (or past the read limit) are
 * named as not in this summary, with how many.
 * @param campaigns - The sixth query's rows (newest campaigns, any status), null when it failed
 * @param drafts - The seventh query's draft rows, null when that read failed
 * @param total - The owner's campaign count from the fourth query, when it was read
 * @returns The metrics; none when the campaigns could not be read
 */
function campaignDraftMetrics(campaigns, drafts, total) {
    if (!campaigns)
        return [];
    const counted = drafts ? draftsByCampaign(drafts) : null;
    const more = drafts && drafts.length >= exports.DRAFT_ROW_LIMIT ? ' or more' : '';
    const entries = campaigns.slice(0, exports.CAMPAIGN_READ_LIMIT).map((row) => campaignEntry(row, counted, more));
    const known = Number.isFinite(Number(total)) ? Math.max(Number(total), entries.length) : entries.length;
    let packed = packEntries(entries, exports.CAMPAIGN_DRAFT_ROWS);
    if (known - (packed.at(-1)?.last ?? 0) > 0)
        packed = packEntries(entries, exports.CAMPAIGN_DRAFT_ROWS - 1);
    const metrics = packedMetrics(packed);
    const unlisted = known - (packed.at(-1)?.last ?? 0);
    if (unlisted > 0) {
        metrics.push({ id: 'campaign-drafts-unlisted', label: 'Older campaigns not in this summary', value: clip(String(unlisted), exports.HOME_SUMMARY_LIMITS.valueChars),
            detail: 'Their drafts and saved times are not in this summary; each one shows them on the Board.', defaultVisible: false });
    }
    return metrics;
}
/** Shape one saved content row into a list line whose actions hand the draft to other apps. */
function contentItem(row) {
    const text = clip(row.title || 'Untitled content', exports.HOME_SUMMARY_LIMITS.textChars);
    const detail = `${clip(row.channel, 60)} · ${clip(row.status, 40)} · saved ${isoDate(row.updated_at)}`;
    const notes = clip(`${detail}\n${clip(row.body, exports.HOME_SUMMARY_LIMITS.bodyChars)}`, exports.HOME_SUMMARY_LIMITS.notesChars);
    return {
        text,
        detail: clip(detail, exports.HOME_SUMMARY_LIMITS.detailChars),
        tone: 'neutral',
        fix: FIX,
        actions: exports.CONTENT_ITEM_ACTIONS.map((integration) => ({ integration, context: { title: text, notes } })),
    };
}
/**
 * @description Shape the three query outcomes into the bounded ADR-145 Home summary. A failed
 * query degrades its tiles to 'Unavailable' and adds one warning line; when every query failed the
 * status is 503 so Home shows the app as unavailable rather than as empty.
 * @param results - Rows per HOME_SUMMARY_QUERIES entry, null where that query failed
 * @param now - The request time the queries were bounded by
 * @returns The status and JSON body for the route
 */
function buildMarketingHomeSummary(results, now) {
    const tiles = metricTiles(results);
    const metrics = [...tiles, campaignMetric(results[3], results[4]), ...campaignDraftMetrics(results[5], results[6], results[3]?.[0]?.total)];
    const items = (results[2] ?? []).slice(0, 3).map(contentItem);
    const failed = exports.HOME_SUMMARY_QUERIES.filter((_query, index) => results[index] === null).length;
    if (failed > 0)
        items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: FIX });
    else if (items.length === 0)
        items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: FIX });
    items.push(FOOTNOTE);
    return {
        status: failed === exports.HOME_SUMMARY_QUERIES.length ? 503 : 200,
        body: { metrics, tiles, items, asOf: now.toISOString(), partial: failed > 0 },
    };
}
/** The caller's subject, only when the session reports itself authenticated (the store Home gate). */
function authenticatedSub(req) {
    const oidc = req.oidc;
    const sub = oidc?.user?.sub || oidc?.user?.oid;
    return sub && oidc?.isAuthenticated?.() === true ? String(sub) : null;
}
/** Run the seven bounded queries for one owner; a failed query reads as null, never as zero. */
async function loadSummaryRows(ctx, sub, now) {
    const settled = await Promise.allSettled(exports.HOME_SUMMARY_QUERIES.map((text) => {
        const config = { text, values: [sub, now], query_timeout: QUERY_TIMEOUT_MS };
        return ctx.pool.query(config);
    }));
    return settled.map((outcome) => (outcome.status === 'fulfilled' ? outcome.value.rows : null));
}
/**
 * @description Mount the Home summary for the signed-in owner. Answers 401 unless the session is
 * authenticated; every query is filtered to that subject (FORCE RLS backs it), so one owner can
 * never read another's counts or drafts. Never writes.
 * @param ctx - Framework context (the controller pool)
 * @returns Router exposing GET /
 */
function createHomeSummaryRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const sub = authenticatedSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const now = new Date();
        const summary = buildMarketingHomeSummary(await loadSummaryRows(ctx, sub, now), now);
        res.status(summary.status).json(summary.body);
    });
    return router;
}
