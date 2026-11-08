"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com    | Dedicated /api/email-watches route module: caller-scoped CRUD for deterministic Gmail watch rules (including the TotalConnect security monitor preset) and the zero-LLM POST /check pass that checks live Gmail + stored oshal_email_messages, deduplicates via hit_key, and emits bounded report items only on unseen hits.
 * 2   | maintainer@emeraldcoastsystemsgroup.com    | 1.8.1: keep GET /api/email-watches strictly read-only (SELECT only, zero INSERT/UPDATE) so native-kernel read-only GET admissions never fail when EMAIL_DEFAULT_WATCHES is set; default seeding stays in POST /check and POST /api/email/sync.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCallerWatches = checkCallerWatches;
exports.createMailWatchRoutes = createMailWatchRoutes;
const express_1 = require("express");
const kernel_mail_1 = require("./kernel-mail");
const mail_store_1 = require("./mail-store");
const mail_watches_store_1 = require("./mail-watches-store");
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const INSERT_MESSAGE_SQL = 'INSERT INTO oshal_email_messages (msg_key, user_sub, provider, message_id, sender, subject, snippet, labels, search_text, received_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)';
const MAX_REPORT_ITEMS = 32;
const MAX_REPORT_BYTES = 28000;
const CHECK_BUDGET_MS = 45000;
/** Extract the signed-in caller's OIDC subject, or null if unauthenticated. */
function callerSub(req) {
    const oidc = req.oidc;
    if (!oidc || (typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated() !== true))
        return null;
    const sub = oidc.user?.sub || oidc.user?.oid;
    return sub ? String(sub) : null;
}
function duplicateMessage(err) {
    const e = err;
    return e?.code === '23505' || /23505|unique (constraint|key)|duplicate key/i.test(String(e?.message || ''));
}
/** Build a live Gmail reader over kernel egress or an injected access-token callback when connected. */
async function resolveGmailReader(ctx, sub) {
    if (ctx.gmailReader)
        return ctx.gmailReader;
    if ((0, kernel_mail_1.kernelEgress)()) {
        const meta = await (0, kernel_mail_1.readConnections)(ctx);
        const state = (0, kernel_mail_1.connectionState)(meta, 'google');
        if (state === 'none' || state === 'reconnect')
            return null;
        const kfetch = (0, kernel_mail_1.kernelFetch)('google');
        return buildHttpGmailReader((url) => kfetch(url, { headers: { Accept: 'application/json' } }));
    }
    if (typeof ctx.getAccessToken === 'function') {
        const token = await ctx.getAccessToken(sub, 'google');
        if (!token)
            return null;
        return buildHttpGmailReader((url) => fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }));
    }
    return null;
}
function buildHttpGmailReader(get) {
    const getJson = async (url) => {
        const r = await get(url);
        if (!r.ok)
            throw new Error(`gmail ${r.status}`);
        return (await r.json());
    };
    return {
        list: async (q) => {
            const page = await getJson(`${GMAIL_BASE}/messages?q=${encodeURIComponent(q)}&maxResults=25`);
            return Array.isArray(page.messages) ? page.messages.map((m) => String(m?.id || '')).filter(Boolean) : [];
        },
        metadata: (id) => getJson(`${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`),
    };
}
/** Fetch recent live Gmail matches for one watch and warm `oshal_email_messages` when present. */
async function fetchLiveWatchCandidates(db, sub, reader, query, deadline) {
    const ids = await reader.list(`(${query}) newer_than:2d -in:chats -in:drafts`);
    const found = [];
    for (const id of ids.slice(0, 25)) {
        if (Date.now() >= deadline)
            break;
        let stored;
        try {
            stored = (await db.query('SELECT message_id, sender, subject, snippet, received_at FROM oshal_email_messages WHERE msg_key = $1 AND user_sub = $2', [(0, mail_store_1.messageKey)(sub, 'google', id), sub])).rows[0];
        }
        catch (err) {
            if (!(0, mail_watches_store_1.missingWatchTable)(err))
                throw err;
        }
        if (stored) {
            found.push({
                messageId: String(stored.message_id || id),
                sender: String(stored.sender || ''),
                subject: String(stored.subject || ''),
                snippet: String(stored.snippet || ''),
                receivedAt: new Date(stored.received_at).toISOString(),
            });
            continue;
        }
        const row = (0, mail_store_1.gmailRow)(sub, id, await reader.metadata(id));
        try {
            await db.query(INSERT_MESSAGE_SQL, row.params);
        }
        catch (err) {
            if (!duplicateMessage(err) && !(0, mail_watches_store_1.missingWatchTable)(err))
                throw err;
        }
        found.push({
            messageId: id,
            sender: String(row.params[4] || ''),
            subject: String(row.params[5] || ''),
            snippet: String(row.params[6] || ''),
            receivedAt: String(row.params[9]),
        });
    }
    return found;
}
/** Read candidate messages from the stored Gmail copy over the lookback window. */
async function loadStoredCandidates(db, sub, sinceIso) {
    try {
        const { rows } = await db.query('SELECT message_id, sender, subject, snippet, received_at FROM oshal_email_messages WHERE user_sub = $1 AND received_at >= $2', [sub, sinceIso]);
        return rows
            .filter((r) => r.message_id && r.received_at)
            .map((r) => ({
            messageId: String(r.message_id),
            sender: String(r.sender || ''),
            subject: String(r.subject || ''),
            snippet: String(r.snippet || ''),
            receivedAt: new Date(r.received_at).toISOString(),
        }));
    }
    catch (err) {
        if ((0, mail_watches_store_1.missingWatchTable)(err))
            return [];
        throw err;
    }
}
/** Append unseen hits into the bounded `schedule_completion.rs` report array (`<= 32` items, `< 28 KB`). */
function appendReportItems(target, watch, hits) {
    for (const hit of hits) {
        if (target.length >= MAX_REPORT_ITEMS)
            return;
        const candidate = {
            watchId: watch.watchId,
            label: (0, mail_watches_store_1.bounded)(watch.label, 120),
            account: (0, mail_watches_store_1.bounded)(watch.accountHint || 'gmail', 160),
            category: hit.category,
            messageId: (0, mail_watches_store_1.bounded)(hit.messageId, 128),
            sender: (0, mail_watches_store_1.bounded)(hit.sender, 200),
            subject: (0, mail_watches_store_1.bounded)(hit.subject, 240),
            snippet: (0, mail_watches_store_1.bounded)(hit.snippet, 300),
            receivedAt: hit.receivedAt,
        };
        if (JSON.stringify([...target, candidate]).length > MAX_REPORT_BYTES)
            return;
        target.push(candidate);
    }
}
/** Execute one deterministic check pass across all enabled watches owned by `sub`. */
async function checkCallerWatches(ctx, sub, options = {}) {
    const nowMs = options.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let reader = null;
    if (!options.skipLiveGmail) {
        try {
            reader = await resolveGmailReader(ctx, sub);
        }
        catch (err) {
            ctx.logger?.warn?.({ err }, 'Live Gmail reader unavailable for watch check; using stored mail copy');
        }
    }
    if (options.gmailConnected || reader || !(0, kernel_mail_1.kernelEgress)()) {
        await (0, mail_watches_store_1.ensureDefaultWatches)(ctx.pool, sub, nowIso);
    }
    const enabledWatches = (await (0, mail_watches_store_1.listWatches)(ctx.pool, sub)).filter((w) => w.enabled);
    if (enabledWatches.length === 0) {
        return { checked: 0, newHits: 0, watches: [], hits: [], report: [] };
    }
    const days = Math.max(1, Math.min(30, Number(options.days) || 7));
    const sinceIso = new Date(nowMs - days * 24 * 3600 * 1000).toISOString();
    const deadline = nowMs + CHECK_BUDGET_MS;
    const stored = await loadStoredCandidates(ctx.pool, sub, sinceIso);
    const checkedWatches = [];
    const allHits = [];
    const report = [];
    for (const watch of enabledWatches) {
        const byId = new Map(stored.map((m) => [m.messageId, m]));
        if (reader && Date.now() < deadline) {
            try {
                for (const liveMsg of await fetchLiveWatchCandidates(ctx.pool, sub, reader, watch.query, deadline)) {
                    byId.set(liveMsg.messageId, liveMsg);
                }
            }
            catch (err) {
                ctx.logger?.warn?.({ err, watchId: watch.watchId }, 'Live Gmail query failed for watch; falling back to stored copy');
            }
        }
        const clauses = (0, mail_watches_store_1.parseWatchQuery)(watch.query);
        const matched = [...byId.values()].filter((msg) => (0, mail_watches_store_1.matchesWatchMessage)(clauses, msg));
        const outcome = await (0, mail_watches_store_1.recordWatchCheck)(ctx.pool, sub, watch, matched, nowIso);
        checkedWatches.push(outcome.watch);
        allHits.push(...outcome.newHits);
        appendReportItems(report, outcome.watch, outcome.newHits);
    }
    return { checked: enabledWatches.length, newHits: allHits.length, watches: checkedWatches, hits: allHits, report };
}
/** Build the `/api/email-watches` Express router for Intelligent Communication. */
function createMailWatchRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const [watches, recentHits] = await Promise.all([(0, mail_watches_store_1.listWatches)(ctx.pool, sub), (0, mail_watches_store_1.listRecentHits)(ctx.pool, sub, 25)]);
            res.json({ watches, recentHits, presets: Object.values(mail_watches_store_1.PRESETS) });
        }
        catch (err) {
            ctx.logger?.error?.({ err }, 'Failed to read mailbox watches');
            res.status(503).json({ error: 'watches_unavailable', message: 'Mailbox watches could not be read.' });
        }
    });
    router.post('/', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const parsed = (0, mail_watches_store_1.normalizeWatchInput)(req.body);
        if (!parsed.ok) {
            res.status(parsed.code).json({ error: parsed.error, message: parsed.message });
            return;
        }
        try {
            const { created, watch } = await (0, mail_watches_store_1.saveWatch)(ctx.pool, sub, parsed.value);
            res.json({ ok: true, created, watch });
        }
        catch (err) {
            ctx.logger?.error?.({ err }, 'Failed to save mailbox watch');
            res.status(503).json({ error: 'watch_save_failed', message: 'Mailbox watch could not be saved.' });
        }
    });
    router.delete('/:watchId', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const removed = await (0, mail_watches_store_1.deleteWatch)(ctx.pool, sub, req.params.watchId);
            if (!removed) {
                res.status(404).json({ error: 'not_found', message: 'Mailbox watch not found.' });
                return;
            }
            res.json({ ok: true, deleted: (0, mail_watches_store_1.bounded)(req.params.watchId, 64).toLowerCase() });
        }
        catch (err) {
            ctx.logger?.error?.({ err }, 'Failed to delete mailbox watch');
            res.status(503).json({ error: 'watch_delete_failed', message: 'Mailbox watch could not be deleted.' });
        }
    });
    router.post('/check', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const result = await checkCallerWatches(ctx, sub, { days: req.body?.days });
            res.json(result);
        }
        catch (err) {
            ctx.logger?.error?.({ err }, 'Mailbox watch check failed');
            res.status(503).json({ error: 'watch_check_failed', message: 'Mailbox watch check could not complete.' });
        }
    });
    return router;
}
