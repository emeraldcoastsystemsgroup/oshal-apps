"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.7 pure P3 launch plan,
 *     unified marketing calendar merger, and grounded recorded-numbers-only retro builder:
 *     strict launch plan / milestone / checklist normalization with default launch-coordinator
 *     starter checklist, deterministic deduplicating calendar merger across engine content,
 *     launch milestones, broadcasts, and optional Switchboard posts, and a retro generator
 *     that cites ONLY recorded database counts (emitting explicit NO DATA where unrecorded).
 *
 * @module marketing-launch-model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_LAUNCH_CHECKLIST = exports.CANONICAL_METRIC_SOURCES = exports.CALENDAR_SOURCES = exports.CHECKLIST_CATEGORIES = exports.MILESTONE_STATUSES = exports.LAUNCH_PLAN_STATUSES = void 0;
exports.defaultLaunchChecklist = defaultLaunchChecklist;
exports.isIsoCalendarDate = isIsoCalendarDate;
exports.normalizeMilestone = normalizeMilestone;
exports.normalizeChecklistItem = normalizeChecklistItem;
exports.normalizeLaunchPlan = normalizeLaunchPlan;
exports.normalizeLaunchPlanPatch = normalizeLaunchPlanPatch;
exports.buildUnifiedCalendar = buildUnifiedCalendar;
exports.buildCampaignRetro = buildCampaignRetro;
exports.LAUNCH_PLAN_STATUSES = ['planning', 'ready', 'launched', 'retro_complete'];
exports.MILESTONE_STATUSES = ['pending', 'in_progress', 'done', 'blocked'];
exports.CHECKLIST_CATEGORIES = ['asset', 'channel', 'compliance', 'community'];
exports.CALENDAR_SOURCES = ['engine_content', 'launch_milestone', 'broadcast', 'switchboard'];
exports.CANONICAL_METRIC_SOURCES = ['gsc', 'posthog', 'github'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ID_CLEAN_RE = /[^a-z0-9_-]+/gi;
/** Built-in starter asset checklist derived from personas/launch-coordinator.yaml. */
exports.DEFAULT_LAUNCH_CHECKLIST = [
    {
        id: 'asset-landing-utm',
        label: 'Verify landing page loads, links resolve, and UTM links are built',
        category: 'asset',
        done: false,
    },
    {
        id: 'channel-email-templates',
        label: 'Prepare announcement and launch email templates with plain-text alternative',
        category: 'channel',
        done: false,
    },
    {
        id: 'community-human-drafts',
        label: 'Prepare Show HN, Reddit, and Product Hunt drafts for human posting (never bot-posted)',
        category: 'community',
        done: false,
    },
    {
        id: 'compliance-identity-footer',
        label: 'Verify sender identity, physical postal address, and unsubscribe URL in Compliance',
        category: 'compliance',
        done: false,
    },
    {
        id: 'asset-scorecard-baseline',
        label: 'Capture pre-launch scorecard baseline (recorded sources or NO DATA)',
        category: 'asset',
        done: false,
    },
];
/** Return a fresh mutable copy of the starter launch-coordinator checklist. */
function defaultLaunchChecklist() {
    return exports.DEFAULT_LAUNCH_CHECKLIST.map((item) => ({ ...item }));
}
/** Strict calendar-date check (YYYY-MM-DD and real Gregorian date). */
function isIsoCalendarDate(raw) {
    if (typeof raw !== 'string')
        return false;
    const m = DATE_RE.exec(raw.trim());
    if (!m)
        return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31)
        return false;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
/** Normalize an arbitrary date/timestamp string or Date to YYYY-MM-DD + ISO timestamp. */
function coerceTimestamp(raw, fallbackDate) {
    if (raw instanceof Date && Number.isFinite(raw.getTime())) {
        const iso = raw.toISOString();
        return { date: iso.slice(0, 10), timestamp: iso };
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (isIsoCalendarDate(trimmed)) {
            return { date: trimmed, timestamp: `${trimmed}T09:00:00.000Z` };
        }
        const ms = Date.parse(trimmed);
        if (Number.isFinite(ms)) {
            const iso = new Date(ms).toISOString();
            return { date: iso.slice(0, 10), timestamp: iso };
        }
    }
    if (fallbackDate && isIsoCalendarDate(fallbackDate)) {
        return { date: fallbackDate, timestamp: `${fallbackDate}T09:00:00.000Z` };
    }
    return null;
}
/** Build a stable clean identifier fallback. */
function cleanItemId(raw, fallback) {
    const s = typeof raw === 'string' ? raw.trim().replace(ID_CLEAN_RE, '-').replace(/^-+|-+$/g, '').slice(0, 64) : '';
    return s || fallback;
}
/**
 * @description Normalize and validate a single dated launch milestone.
 */
function normalizeMilestone(raw, index = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'invalid_milestone', message: `Milestone ${index + 1} must be an object.` };
    }
    const b = raw;
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 140) : '';
    if (!title) {
        return { ok: false, error: 'milestone_title_required', message: `Milestone ${index + 1} requires a title.` };
    }
    const dueRaw = typeof b.dueDate === 'string' ? b.dueDate.trim() : (typeof b.due_date === 'string' ? b.due_date.trim() : '');
    if (!isIsoCalendarDate(dueRaw)) {
        return { ok: false, error: 'invalid_milestone_due_date', message: `Milestone "${title}" dueDate must be YYYY-MM-DD.` };
    }
    const ownerRaw = typeof b.ownerRole === 'string' ? b.ownerRole : (typeof b.owner_role === 'string' ? b.owner_role : 'human');
    const ownerRole = ownerRaw.trim().slice(0, 60) || 'human';
    const statusRaw = b.status === undefined || b.status === null || b.status === '' ? 'pending' : String(b.status).trim();
    if (!exports.MILESTONE_STATUSES.includes(statusRaw)) {
        return { ok: false, error: 'invalid_milestone_status', message: `Milestone status must be one of: ${exports.MILESTONE_STATUSES.join(', ')}.` };
    }
    return {
        ok: true,
        milestone: {
            id: cleanItemId(b.id, `ms-${index + 1}`),
            title,
            dueDate: dueRaw,
            ownerRole,
            status: statusRaw,
        },
    };
}
/**
 * @description Normalize and validate a single launch asset checklist item.
 */
function normalizeChecklistItem(raw, index = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'invalid_checklist_item', message: `Checklist item ${index + 1} must be an object.` };
    }
    const b = raw;
    const label = typeof b.label === 'string' ? b.label.trim().slice(0, 200) : '';
    if (!label) {
        return { ok: false, error: 'checklist_label_required', message: `Checklist item ${index + 1} requires a label.` };
    }
    const catRaw = b.category === undefined || b.category === null || b.category === '' ? 'asset' : String(b.category).trim();
    if (!exports.CHECKLIST_CATEGORIES.includes(catRaw)) {
        return { ok: false, error: 'invalid_checklist_category', message: `Checklist category must be one of: ${exports.CHECKLIST_CATEGORIES.join(', ')}.` };
    }
    if (b.done !== undefined && typeof b.done !== 'boolean') {
        return { ok: false, error: 'invalid_checklist_done', message: `Checklist item "${label}" done must be a boolean.` };
    }
    return {
        ok: true,
        item: {
            id: cleanItemId(b.id, `chk-${index + 1}`),
            label,
            category: catRaw,
            done: b.done === true,
        },
    };
}
/** Normalize an array of milestones with unique IDs and chronological ordering. */
function normalizeMilestoneList(raw) {
    if (raw === undefined || raw === null)
        return { ok: true, milestones: [] };
    if (!Array.isArray(raw) || raw.length > 50) {
        return { ok: false, error: 'invalid_milestones', message: 'milestones must be an array of at most 50 items.' };
    }
    const seen = new Set();
    const out = [];
    for (let i = 0; i < raw.length; i += 1) {
        const res = normalizeMilestone(raw[i], i);
        if (!res.ok)
            return res;
        let id = res.milestone.id;
        let suffix = 2;
        while (seen.has(id)) {
            id = `${res.milestone.id}-${suffix}`;
            suffix += 1;
        }
        seen.add(id);
        out.push({ ...res.milestone, id });
    }
    out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
    return { ok: true, milestones: out };
}
/** Normalize an array of checklist items, seeding default launch-coordinator items when omitted. */
function normalizeChecklistArray(raw, seedDefaultWhenUndefined) {
    if (raw === undefined) {
        return { ok: true, checklist: seedDefaultWhenUndefined ? defaultLaunchChecklist() : [] };
    }
    if (!Array.isArray(raw) || raw.length > 50) {
        return { ok: false, error: 'invalid_checklist', message: 'checklist must be an array of at most 50 items.' };
    }
    const seen = new Set();
    const out = [];
    for (let i = 0; i < raw.length; i += 1) {
        const res = normalizeChecklistItem(raw[i], i);
        if (!res.ok)
            return res;
        let id = res.item.id;
        let suffix = 2;
        while (seen.has(id)) {
            id = `${res.item.id}-${suffix}`;
            suffix += 1;
        }
        seen.add(id);
        out.push({ ...res.item, id });
    }
    return { ok: true, checklist: out };
}
/**
 * @description Normalize and validate a full campaign launch plan payload.
 */
function normalizeLaunchPlan(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'invalid_launch_plan', message: 'Request body must be a JSON object.' };
    }
    const b = raw;
    const campaignId = typeof b.campaignId === 'string'
        ? b.campaignId.trim()
        : (typeof b.campaign_id === 'string' ? b.campaign_id.trim() : '');
    if (!UUID_RE.test(campaignId)) {
        return { ok: false, error: 'invalid_campaign_id', message: 'campaignId must be a valid UUID.' };
    }
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '';
    if (!title) {
        return { ok: false, error: 'title_required', message: 'Launch plan title is required (1-120 characters).' };
    }
    const launchDateRaw = typeof b.launchDate === 'string'
        ? b.launchDate.trim()
        : (typeof b.launch_date === 'string' ? b.launch_date.trim() : '');
    if (!isIsoCalendarDate(launchDateRaw)) {
        return { ok: false, error: 'invalid_launch_date', message: 'launchDate must be a valid YYYY-MM-DD calendar date.' };
    }
    const statusRaw = b.status === undefined || b.status === null || b.status === '' ? 'planning' : String(b.status).trim();
    if (!exports.LAUNCH_PLAN_STATUSES.includes(statusRaw)) {
        return { ok: false, error: 'invalid_status', message: `status must be one of: ${exports.LAUNCH_PLAN_STATUSES.join(', ')}.` };
    }
    const ms = normalizeMilestoneList(b.milestones);
    if (!ms.ok)
        return ms;
    const chk = normalizeChecklistArray(b.checklist, true);
    if (!chk.ok)
        return chk;
    return {
        ok: true,
        plan: {
            campaignId,
            title,
            launchDate: launchDateRaw,
            status: statusRaw,
            milestones: ms.milestones,
            checklist: chk.checklist,
        },
    };
}
/** Validate scalar fields (title, launchDate, status) on a launch plan PATCH payload. */
function parseLaunchPlanScalarPatch(b, patch) {
    if (b.title !== undefined) {
        const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '';
        if (!title)
            return { ok: false, error: 'title_required', message: 'title must be non-empty (1-120 chars).' };
        patch.title = title;
    }
    const launchDateRaw = b.launchDate !== undefined ? b.launchDate : b.launch_date;
    if (launchDateRaw !== undefined) {
        if (!isIsoCalendarDate(launchDateRaw)) {
            return { ok: false, error: 'invalid_launch_date', message: 'launchDate must be a valid YYYY-MM-DD date.' };
        }
        patch.launchDate = launchDateRaw.trim();
    }
    if (b.status !== undefined) {
        const st = String(b.status).trim();
        if (!exports.LAUNCH_PLAN_STATUSES.includes(st)) {
            return { ok: false, error: 'invalid_status', message: `status must be one of: ${exports.LAUNCH_PLAN_STATUSES.join(', ')}.` };
        }
        patch.status = st;
    }
    return { ok: true };
}
/**
 * @description Normalize a PATCH payload for an existing launch plan (status, title, launchDate,
 * milestones, or checklist updates).
 */
function normalizeLaunchPlanPatch(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'invalid_patch', message: 'Request body must be a JSON object.' };
    }
    const b = raw;
    const patch = {};
    const scalar = parseLaunchPlanScalarPatch(b, patch);
    if (!scalar.ok)
        return scalar;
    if (b.milestones !== undefined) {
        const ms = normalizeMilestoneList(b.milestones);
        if (!ms.ok)
            return ms;
        patch.milestones = ms.milestones;
    }
    if (b.checklist !== undefined) {
        const chk = normalizeChecklistArray(b.checklist, false);
        if (!chk.ok)
            return chk;
        patch.checklist = chk.checklist;
    }
    if (Object.keys(patch).length === 0) {
        return { ok: false, error: 'no_updatable_fields', message: 'Provide at least one updatable field.' };
    }
    return { ok: true, patch };
}
/** Add one normalized item to the deduplication map if it falls inside [fromDate, toDate]. */
function pushCalendarItem(dedupe, item, fromDate, toDate) {
    if (fromDate && item.date < fromDate)
        return;
    if (toDate && item.date > toDate)
        return;
    const key = `${item.source}:${item.sourceId}`;
    if (!dedupe.has(key))
        dedupe.set(key, item);
}
/** Map engine content rows onto unified calendar items. */
function collectContentCalendarItems(dedupe, rows, fromDate, toDate) {
    for (const r of rows) {
        if (!r || typeof r !== 'object')
            continue;
        const sourceId = String(r.item_id ?? r.itemId ?? r.id ?? '').trim();
        const when = coerceTimestamp(r.scheduled_for ?? r.scheduledFor ?? r.created_at ?? r.createdAt);
        if (!sourceId || !when)
            continue;
        const channel = String(r.channel || 'content').trim();
        const title = String(r.title || '').trim() || `${channel} draft`;
        pushCalendarItem(dedupe, {
            id: `engine_content:${sourceId}`,
            source: 'engine_content',
            sourceId,
            date: when.date,
            timestamp: when.timestamp,
            title: title.slice(0, 140),
            channel,
            status: String(r.status || 'draft'),
            campaignId: r.campaign_id ? String(r.campaign_id) : (r.campaignId ? String(r.campaignId) : null),
        }, fromDate, toDate);
    }
}
/** Map launch plan milestone records onto unified calendar items. */
function collectMilestoneCalendarItems(dedupe, milestones, fromDate, toDate) {
    for (const m of milestones) {
        if (!m || typeof m !== 'object')
            continue;
        const planId = String(m.planId ?? m.plan_id ?? '').trim();
        const msId = String(m.id ?? '').trim();
        const sourceId = planId && msId ? `${planId}:${msId}` : (msId || planId);
        const when = coerceTimestamp(m.dueDate ?? m.due_date);
        if (!sourceId || !when)
            continue;
        const planTitle = typeof m.planTitle === 'string' ? m.planTitle.trim() : '';
        const baseTitle = String(m.title || 'Launch milestone').trim();
        const title = planTitle ? `${baseTitle} (${planTitle})` : baseTitle;
        pushCalendarItem(dedupe, {
            id: `launch_milestone:${sourceId}`,
            source: 'launch_milestone',
            sourceId,
            date: when.date,
            timestamp: when.timestamp,
            title: title.slice(0, 160),
            channel: String(m.ownerRole ?? m.owner_role ?? 'launch'),
            status: String(m.status || 'pending'),
            campaignId: m.campaignId ? String(m.campaignId) : (m.campaign_id ? String(m.campaign_id) : null),
        }, fromDate, toDate);
    }
}
/** Map broadcast message rows onto unified calendar items. */
function collectBroadcastCalendarItems(dedupe, broadcasts, fromDate, toDate) {
    for (const b of broadcasts) {
        if (!b || typeof b !== 'object')
            continue;
        const sourceId = String(b.message_id ?? b.messageId ?? b.id ?? '').trim();
        const when = coerceTimestamp(b.scheduled_for ?? b.created_at ?? b.updated_at);
        if (!sourceId || !when)
            continue;
        pushCalendarItem(dedupe, {
            id: `broadcast:${sourceId}`,
            source: 'broadcast',
            sourceId,
            date: when.date,
            timestamp: when.timestamp,
            title: String(b.subject || 'Email broadcast').trim().slice(0, 140),
            channel: 'email',
            status: String(b.status || 'draft'),
            campaignId: b.campaign_id ? String(b.campaign_id) : (b.campaignId ? String(b.campaignId) : null),
        }, fromDate, toDate);
    }
}
/** Map optional Switchboard scheduled posts onto unified calendar items. */
function collectSwitchboardCalendarItems(dedupe, posts, fromDate, toDate) {
    for (const p of posts) {
        if (!p || typeof p !== 'object')
            continue;
        const sourceId = String(p.post_id ?? p.postId ?? p.id ?? '').trim();
        const when = coerceTimestamp(p.scheduled_at ?? p.scheduledAt ?? p.created_at);
        if (!sourceId || !when)
            continue;
        const platform = String(p.platform || 'social').trim();
        const firstLine = String(p.body || '').split(/\r?\n/)[0].trim();
        const title = (typeof p.title === 'string' && p.title.trim()) || firstLine || `${platform} scheduled post`;
        pushCalendarItem(dedupe, {
            id: `switchboard:${sourceId}`,
            source: 'switchboard',
            sourceId,
            date: when.date,
            timestamp: when.timestamp,
            title: title.slice(0, 140),
            channel: platform,
            status: String(p.status || 'scheduled'),
            campaignId: null,
        }, fromDate, toDate);
    }
}
/**
 * @description Pure deterministic unified calendar merger combining engine scheduled content,
 * launch plan milestones, broadcasts, and optional Switchboard scheduled posts in chronological
 * order with strict (source, sourceId) deduplication.
 */
function buildUnifiedCalendar(input) {
    const fromDate = input.fromDate && isIsoCalendarDate(input.fromDate) ? input.fromDate.trim() : null;
    const toDate = input.toDate && isIsoCalendarDate(input.toDate) ? input.toDate.trim() : null;
    const dedupe = new Map();
    collectContentCalendarItems(dedupe, Array.isArray(input.contentItems) ? input.contentItems : [], fromDate, toDate);
    collectMilestoneCalendarItems(dedupe, Array.isArray(input.milestones) ? input.milestones : [], fromDate, toDate);
    collectBroadcastCalendarItems(dedupe, Array.isArray(input.broadcasts) ? input.broadcasts : [], fromDate, toDate);
    const hasSb = input.switchboardAvailable !== undefined
        ? Boolean(input.switchboardAvailable)
        : Array.isArray(input.switchboardPosts);
    if (Array.isArray(input.switchboardPosts)) {
        collectSwitchboardCalendarItems(dedupe, input.switchboardPosts, fromDate, toDate);
    }
    const items = Array.from(dedupe.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.source.localeCompare(b.source) || a.sourceId.localeCompare(b.sourceId));
    const counts = { total: items.length, engine_content: 0, launch_milestone: 0, broadcast: 0, switchboard: 0 };
    for (const item of items)
        counts[item.source] += 1;
    return { fromDate, toDate, switchboardAvailable: hasSb, counts, items };
}
/** Aggregate recorded metrics rows per source, emitting 'NO DATA' for every source with zero rows. */
function aggregateMetricsBySource(metricsRows) {
    const sums = new Map();
    const counts = new Map();
    for (const src of exports.CANONICAL_METRIC_SOURCES) {
        sums.set(src, 0);
        counts.set(src, 0);
    }
    for (const row of metricsRows) {
        if (!row || typeof row !== 'object')
            continue;
        const src = String(row.source || '').trim();
        const val = Number(row.value);
        if (!src || !Number.isFinite(val))
            continue;
        sums.set(src, (sums.get(src) ?? 0) + val);
        counts.set(src, (counts.get(src) ?? 0) + 1);
    }
    const out = {};
    for (const [src, n] of counts.entries()) {
        out[src] = n > 0 ? Math.round((sums.get(src) ?? 0) * 10000) / 10000 : 'NO DATA';
    }
    return out;
}
/** Tally publish run ledger outcomes strictly from recorded rows. */
function aggregatePublishOutcomes(rows) {
    const out = { published: 0, skippedConsent: 0, skippedCap: 0, skippedCompliance: 0, error: 0 };
    for (const r of rows) {
        const o = String(r?.outcome || '');
        if (o === 'published')
            out.published += 1;
        else if (o === 'skipped_consent')
            out.skippedConsent += 1;
        else if (o === 'skipped_cap')
            out.skippedCap += 1;
        else if (o === 'skipped_compliance')
            out.skippedCompliance += 1;
        else if (o === 'error')
            out.error += 1;
    }
    return out;
}
/** Tally broadcast delivery rows strictly from recorded rows. */
function aggregateBroadcastDeliveries(rows) {
    const out = { sent: 0, dryRun: 0, skippedSuppressed: 0, skippedUnconfirmed: 0, skippedCap: 0 };
    for (const r of rows) {
        const st = String(r?.status || '');
        if (st === 'sent')
            out.sent += 1;
        else if (st === 'dry_run')
            out.dryRun += 1;
        else if (st === 'skipped_suppressed')
            out.skippedSuppressed += 1;
        else if (st === 'skipped_unconfirmed')
            out.skippedUnconfirmed += 1;
        else if (st === 'skipped_cap')
            out.skippedCap += 1;
    }
    return out;
}
/** Tally experiment lifecycle rows strictly from recorded rows. */
function aggregateExperiments(rows) {
    const out = { total: 0, scaled: 0, killed: 0, running: 0 };
    for (const r of rows) {
        if (!r || typeof r !== 'object')
            continue;
        out.total += 1;
        const st = String(r.status || '');
        if (st === 'scaled')
            out.scaled += 1;
        else if (st === 'killed')
            out.killed += 1;
        else if (st === 'running' || st === 'extended')
            out.running += 1;
    }
    return out;
}
/** Format strictly grounded Markdown citing ONLY computed DB figures (or explicit NO DATA). */
function renderRetroMarkdown(facts) {
    const metricLines = Object.entries(facts.metricsBySource)
        .map(([src, val]) => `- **${src}**: ${val === 'NO DATA' ? 'NO DATA' : String(val)}`);
    const p = facts.publishOutcomes;
    const b = facts.broadcastDeliveries;
    const e = facts.experimentsSummary;
    return [
        `# Launch Retro — ${facts.campaignName}`,
        '',
        `- **Launch date:** ${facts.launchDate}`,
        `- **Recorded at:** ${facts.recordedAt}`,
        '- **Grounding rule:** All figures below come strictly from recorded database rows. Unrecorded sources are marked **NO DATA**.',
        '',
        '## Plan completion',
        `- **Milestones completed:** ${facts.milestonesCompleted} / ${facts.milestonesTotal}`,
        `- **Asset checklist completed:** ${facts.checklistCompleted} / ${facts.checklistTotal}`,
        '',
        '## Recorded metrics by source',
        ...metricLines,
        '',
        '## Recorded publish run ledger',
        `- **Published:** ${p.published}`,
        `- **Skipped (consent):** ${p.skippedConsent}`,
        `- **Skipped (daily cap):** ${p.skippedCap}`,
        `- **Skipped (compliance):** ${p.skippedCompliance}`,
        `- **Errors:** ${p.error}`,
        '',
        '## Recorded broadcast deliveries',
        `- **Sent:** ${b.sent}`,
        `- **Dry-run:** ${b.dryRun}`,
        `- **Skipped (suppressed):** ${b.skippedSuppressed}`,
        `- **Skipped (unconfirmed):** ${b.skippedUnconfirmed}`,
        `- **Skipped (daily cap):** ${b.skippedCap}`,
        '',
        '## Recorded experiments',
        `- **Total:** ${e.total} (scaled: ${e.scaled}, killed: ${e.killed}, running: ${e.running})`,
    ].join('\n');
}
/**
 * @description Build a strictly grounded campaign launch retrospective from ONLY recorded DB rows.
 * Never invents, interpolates, or estimates a single number; unrecorded metric sources emit 'NO DATA'.
 */
function buildCampaignRetro(input) {
    const milestones = Array.isArray(input.plan?.milestones) ? input.plan.milestones : [];
    const checklist = Array.isArray(input.plan?.checklist) ? input.plan.checklist : [];
    const launchRaw = input.plan?.launchDate ?? input.plan?.launch_date ?? '';
    const launchDate = launchRaw instanceof Date ? launchRaw.toISOString().slice(0, 10) : String(launchRaw).slice(0, 10);
    const recordedAt = input.recordedAt || new Date().toISOString();
    const base = {
        recordedAt,
        campaignId: String(input.campaign?.campaign_id ?? input.campaign?.campaignId ?? ''),
        campaignName: String(input.campaign?.name || 'Untitled campaign'),
        launchDate,
        milestonesCompleted: milestones.filter((m) => m?.status === 'done').length,
        milestonesTotal: milestones.length,
        checklistCompleted: checklist.filter((c) => c?.done === true).length,
        checklistTotal: checklist.length,
        publishOutcomes: aggregatePublishOutcomes(Array.isArray(input.runLedgerRows) ? input.runLedgerRows : []),
        broadcastDeliveries: aggregateBroadcastDeliveries(Array.isArray(input.broadcastDeliveryRows) ? input.broadcastDeliveryRows : []),
        metricsBySource: aggregateMetricsBySource(Array.isArray(input.metricsRows) ? input.metricsRows : []),
        experimentsSummary: aggregateExperiments(Array.isArray(input.experiments) ? input.experiments : []),
    };
    return { ...base, markdown: renderRetroMarkdown(base) };
}
