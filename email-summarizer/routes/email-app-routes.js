"use strict";
/**
 * Email Routes — Email Summarizer app surface (Intelligent Communication, ADR-037).
 *
 * Per-user Gmail + Calendar surface for the `email-summarizer` swarm app. Reads
 * the signed-in user's connected Google account (oshal_connections, via
 * getValidAccessToken) and renders a real email client — inbox, a "My Day"
 * digest, and AI-drafted replies. Reading needs only gmail.readonly; the single
 * mutating action is POST /send (gmail.send scope), used by "email me a copy" —
 * and it is `no-send` 428-gated behind an explicit confirmation.
 *
 * Split of work follows the controller/bot rule: reading Gmail/Calendar stays in
 * the api (no LLM). The AI summary + drafted replies run ON the communications-bot
 * (its harness/model, cost captured to chat_tasks) via executeBotOrInline.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-14 13:10:00 | roger.murphy@agenticfederal.us   | Initial email app surface: GET /inbox + /my-day pages, GET /messages + /message/:id + /digest (live Gmail/Calendar per connected user), POST /summary + /draft (api-side LLM). Read-only; no send.
 * 2026-06-14 14:05:00 | roger.murphy@agenticfederal.us   | Social tab for the Intelligent Communication app: GET /social page + GET /social/profile (Facebook /me via the connector token). Read-only public_profile; richer scopes need Meta App Review.
 * 2026-06-14 15:20:00 | roger.murphy@agenticfederal.us   | ADR-036 rework: reasoning (/summary, /draft) now runs ON the email bot via BotNodeClient -> /api/swarm-execute (its harness/model, cost captured to chat_tasks) instead of the controller claude CLI. Per-user encrypted digest store (oshal_email_digests) so the bot's reasoning is stored + pullable later, isolated by user_sub. GET /summary/cached reads it.
 * 2026-06-15 23:50:00 | roger.murphy@agenticfederal.us   | Token broker: runOnBot now resolves the caller's google access token via the controller (resolveBotCreds) and threads it to the bot (creds), so the bot uses a provided short-lived token instead of needing SESSION_SECRET to decrypt oshal_connections.
 * 2026-06-21 | roger.murphy@emeraldcoastsystemsgroup.com | Added POST /send (Gmail users.messages.send): RFC-2822 MIME builder + optional single attachment, `to` defaults to the caller's own address ("email me a copy"). Needs the gmail.send scope on the Google connection (now in the connector default scopes); a token without it 403s with an actionable "reconnect Google" message. Closes the Test Lab's email-send gap (ADR-063).
 * 2026-07-09 | codex                                     | Added provider message IDs/timestamps and deterministic UNREAD/IMPORTANT/STARRED metadata to list, detail, digest, and bot-summary inputs.
 * 2026-07-11 00:24:00 | roger.murphy@emeraldcoastsystemsgroup.com | runOnBot broker list += 'twilio': the communications-bot's phone/text leg (scripts/oshal-twilio.js) gets the caller's own Twilio secret alongside the Google token.
 * 2026-07-15 16:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | runOnBot broker list += 'outlook' (ADR-037 provider parity): the communications-bot's M365 mail leg (scripts/oshal-outlook.js) gets the caller's own Microsoft Graph token alongside the Google + Twilio creds. Best-effort as ever — a user without an Outlook connection just doesn't get the cred.
 * 2026-07-17 16:50:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-090 addendum (skill profiles): runOnBot composes email-summarizer's declared `email-digest` summarize profile into the SUMMARY prompt (kind==='summary'). email-summarizer ships no schedules, so this interactive chokepoint — not the ticket path — is where its profile takes effect. Pure text composition; the bot still reasons + cost lands via executeBotOrInline (ADR-036). No-op for drafts / when unregistered.
 * 2026-07-19 22:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the email-summarizer app package (ADR-085 Wave 3, "skill with a surface"). Standard (ctx) factory; the surfaces (inbox/my-day/social) serve from ctx.appPackageDir/tools (load-time env fallback, D10). The kernel KEEPS the shared email-send machinery at @/app/routes/email-routes — sendGmail (with the 158fa008 header-injection fence: every header-bound value CRLF-flattened at the ONE MIME builder) + sendOutlookMail + summarizeGmailMetadata — because notify-routes, jarvis-brief-cron, and other store packages (career-hunter, presentations) send through it; this surface IMPORTS those instead of forking the builder, so the fence still covers every packaged send. ensureEmailSchema moved here with the app's own oshal_email_digests store and now appends buildOwnerRlsPolicyStatements (owner-RLS chokepoint). The communications-bot node (email-bot container + BOTH registry blocks + core persona), the gmail/outlook/twilio connectors + scripts/oshal-*.js CLIs, and the inbox-ingest Signals engine stay framework-resident per ADR-093.
 *
 * @module email-app-routes
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
exports.ensureEmailSchema = ensureEmailSchema;
exports.createEmailRoutes = createEmailRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const logger_1 = require("@/shared/logger");
const skill_profiles_1 = require("@/shared/skill-profiles");
const database_1 = require("@/shared/services/database");
const agent_management_1 = require("@/features/agent-management");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const connector_token_broker_1 = require("@/app/routes/connector-token-broker");
const free_tier_rotation_1 = require("@/app/routes/free-tier-rotation");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const email_routes_1 = require("@/app/routes/email-routes");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
const logger = (0, logger_1.createChildLogger)({ module: 'email-app-routes' });
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const FB_GRAPH = `https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION || 'v21.0'}`;
/** The email bot owns all reasoning. We dispatch to it (never the controller LLM). */
const EMAIL_BOT_AGENT_ID = 'b0000000-0000-0000-0000-000000000001';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** The signed-in user's OIDC subject, or null if unauthenticated. */
function callerSub(req) {
    const u = req.oidc?.user;
    return u?.sub ? String(u.sub) : null;
}
/** Serve a static HTML surface from the package tools directory. */
function servePage(dir, file) {
    return (_req, res) => {
        res.sendFile(path.join(dir, file), (err) => {
            if (err) {
                logger.error({ err, file }, 'Failed to serve email surface');
                res.status(404).send('Page not found');
            }
        });
    };
}
/** Resolve the caller's valid Google access token, or send an error and return null. */
async function resolveToken(req, res, ctx) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return null;
    }
    const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'google');
    if (!token) {
        if (req.query.surface === '1') {
            res.json({ connected: false, error: 'no_google_connection', message: 'Connect your Google account at /utilities first.' });
            return null;
        }
        res.status(409).json({ error: 'no_google_connection', message: 'Connect your Google account at /utilities first.' });
        return null;
    }
    return token;
}
/** GET a Google API URL with the bearer token; throws on non-2xx. */
async function gget(token, url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok)
        throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
}
/** Read a header value (case-insensitive) from a Gmail message payload. */
function header(msg, name) {
    const payload = msg.payload;
    const h = (payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h?.value || '';
}
/** base64url → utf8. */
function b64url(data) {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
/** Strip HTML to readable text (fallback when no text/plain part exists). */
function stripHtml(html) {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Walk a Gmail payload tree and return the best plain-text body. */
function extractBody(payload) {
    const p = payload;
    if (!p)
        return '';
    if (p.mimeType === 'text/plain' && p.body?.data)
        return b64url(p.body.data);
    for (const part of p.parts || []) {
        const t = extractBody(part);
        if (t)
            return t;
    }
    if (p.mimeType === 'text/html' && p.body?.data)
        return stripHtml(b64url(p.body.data));
    return '';
}
/** List inbox messages (ids + metadata) for a query. */
async function listInbox(token, q, max) {
    const list = await gget(token, `${GMAIL}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
    const ids = (list.messages || []).map((m) => m.id).slice(0, max);
    const out = [];
    for (const id of ids) {
        const m = await gget(token, `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        out.push((0, email_routes_1.summarizeGmailMetadata)(id, m));
    }
    return out;
}
/** Today's calendar events. */
async function eventsToday(token) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const data = await gget(token, `${CAL}?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}&singleEvents=true&orderBy=startTime`);
    return (data.items || []).map((e) => ({
        summary: e.summary || '(busy)',
        start: e.start?.dateTime || e.start?.date || '',
        location: e.location || '',
    }));
}
/** Count messages by sender display name, top 5. */
function topSenders(msgs) {
    const counts = new Map();
    for (const m of msgs) {
        const name = (m.from.match(/^"?([^"<]+)"?\s*</)?.[1] || m.from || 'unknown').trim();
        counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
}
/** Render the digest as plain text for the LLM summary prompt. */
function digestText(msgs, events) {
    const lines = [`Recent/unread emails (${msgs.length}):`];
    for (const m of msgs.slice(0, 20)) {
        const flags = [m.unread && 'UNREAD', m.important && 'IMPORTANT', m.starred && 'STARRED'].filter(Boolean);
        lines.push(`- ${flags.length ? `[${flags.join(', ')}] ` : ''}${m.from} — ${m.subject}: ${m.snippet.slice(0, 120)}`);
    }
    lines.push('', `Today's calendar (${events.length} events):`);
    for (const e of events)
        lines.push(`- ${e.start} ${e.summary}${e.location ? ` @ ${e.location}` : ''}`);
    return lines.join('\n');
}
/**
 * Run a reasoning prompt ON THE EMAIL BOT (its own harness/model), not in the
 * controller. The bot node executes via /api/swarm-execute and returns the text
 * + its cost; we record that cost to chat_tasks so spend is metered against the
 * bot and the user's configured harness/model applies (ADR-036). The taskId is
 * keyed by user_sub so each user's bot task/workspace is isolated.
 */
async function runOnBot(ctx, kind, sub, prompt) {
    // Token broker: resolve THIS user's short-lived access token(s) here (controller holds
    // SESSION_SECRET) and hand them to the bot so it doesn't need the key to read Gmail.
    // outlook: the comms bot's M365 mail leg (scripts/oshal-outlook.js) — ADR-037 parity.
    // twilio: the comms bot's phone/text leg (scripts/oshal-twilio.js) — BYO account.
    const creds = await (0, connector_token_broker_1.resolveBotCreds)(ctx.pool, sub, ['google', 'outlook', 'twilio']);
    // Bring-Your-Own-LLM: if the caller configured their own OpenAI-compatible endpoint,
    // the email bot's reasoning runs on THEIR endpoint+key+model (cost tracked as
    // provider 'byo-llm'). email-bot is a dedicated node, so this reaches the any-bot
    // TaskController where the BYO override lives. Omitted → the bot's configured harness.
    const byoLlmConnection = await (0, free_tier_rotation_1.resolveUserLlmConnection)(ctx.pool, sub);
    // ADR-090 skill profiles: shape the SUMMARY to email-summarizer's declared `email-digest` domain
    // pattern when the app registered one. This is the app's own interactive summary chokepoint —
    // email-summarizer ships no schedules, so this (not the ticket path) is where its profile must
    // apply. Pure text composition; the bot still does the reasoning and cost still lands on the
    // accountable node via executeBotOrInline (ADR-036). No-op for `draft`, or if unregistered.
    const text = kind === 'summary'
        ? (0, skill_profiles_1.composeSkillProfilePrompt)(prompt, 'summarize', (0, skill_profiles_1.resolveSkillProfileByApp)('email-summarizer', 'summarize'))
        : prompt;
    const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, EMAIL_BOT_AGENT_ID, {
        text,
        taskId: `email-${kind}-${sub}`,
        workspaceFolderId: `email-${sub}`,
        agentId: EMAIL_BOT_AGENT_ID,
        agenticMode: true,
        direct: true,
        userSub: sub, // scope the bot's Gmail reads to THIS user's own connection
        creds, // provided-token path (.oshal-cred-google) — bot skips DB decryption
        byoLlmConnection,
    });
    return result.response;
}
// ── Per-user digest store (the bot's owned, isolated email state) ─────────────
// AES-256-GCM at rest, keyed by user_sub — same discipline as oshal_connections.
function storeKey() {
    return crypto.createHash('sha256').update(process.env.SESSION_SECRET || 'oshal-dev-secret').digest();
}
function enc(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', storeKey(), iv);
    const out = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${out.toString('base64')}`;
}
function dec(blob) {
    const [iv, tag, data] = String(blob).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', storeKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
/**
 * @description Create the per-user digest table if missing. Owner-RLS is appended at this
 * lazy-DDL chokepoint (buildOwnerRlsPolicyStatements) per the ADR-085 packaged-app rule.
 * @param pool - Postgres pool.
 * @returns Resolves when the schema is ensured (or validated in validate-only mode).
 */
async function ensureEmailSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'email routes',
        statements: [
            `CREATE TABLE IF NOT EXISTS oshal_email_digests (
        user_sub TEXT PRIMARY KEY,
        summary TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_email_digests', 'user_sub'),
        ],
        requirements: [
            { table: 'oshal_email_digests', columns: ['user_sub', 'summary', 'updated_at'] },
        ],
    });
}
/** Upsert the latest AI digest for a user (encrypted). */
async function storeDigest(pool, sub, summary) {
    await pool.query(`INSERT INTO oshal_email_digests (user_sub, summary, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_sub) DO UPDATE SET summary = $2, updated_at = now()`, [sub, enc(summary)]);
}
/** Read the cached digest for a user, or null. */
async function readDigest(pool, sub) {
    const row = (await pool.query('SELECT summary, updated_at FROM oshal_email_digests WHERE user_sub = $1', [sub])).rows[0];
    if (!row?.summary)
        return null;
    try {
        return { summary: dec(row.summary), updatedAt: row.updated_at };
    }
    catch {
        return null;
    }
}
/**
 * @description Builds the Email Summarizer app surface router. Serves the inbox +
 * my-day pages and the per-user Gmail/Calendar data + AI summary/draft endpoints.
 * Surfaces serve from the package's tools/ dir (ctx.appPackageDir, D10).
 *
 * @param ctx - App context (db pool for token lookup, appPackageDir for the surfaces).
 * @returns Express router to mount at /api/email (auth-gated by the mounter).
 */
function createEmailRoutes(ctx) {
    const router = (0, express_1.Router)();
    const assetRoot = ctx.appPackageDir
        ? path.join(ctx.appPackageDir, 'tools')
        : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
    ensureEmailSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure email digest schema'));
    router.get('/inbox', servePage(assetRoot, 'email-inbox.html'));
    router.get('/my-day', servePage(assetRoot, 'email-my-day.html'));
    router.get('/messages', async (req, res) => {
        const token = await resolveToken(req, res, ctx);
        if (!token)
            return;
        try {
            const q = typeof req.query.q === 'string' ? req.query.q : 'in:inbox newer_than:7d';
            const max = Math.min(Number(req.query.max) || 25, 50);
            res.json({ messages: await listInbox(token, q, max) });
        }
        catch (err) {
            logger.error({ err }, 'Inbox list failed');
            res.status(502).json({ error: err.message });
        }
    });
    router.get('/message/:id', async (req, res) => {
        const token = await resolveToken(req, res, ctx);
        if (!token)
            return;
        try {
            const m = await gget(token, `${GMAIL}/messages/${encodeURIComponent(req.params.id)}?format=full`);
            const metadata = (0, email_routes_1.summarizeGmailMetadata)(req.params.id, m);
            res.json({
                ...metadata,
                to: header(m, 'To'),
                body: extractBody(m.payload).slice(0, 20000),
            });
        }
        catch (err) {
            logger.error({ err }, 'Message fetch failed');
            res.status(502).json({ error: err.message });
        }
    });
    router.get('/digest', async (req, res) => {
        const token = await resolveToken(req, res, ctx);
        if (!token)
            return;
        try {
            const [signal, events] = await Promise.all([listInbox(token, 'in:inbox newer_than:1d', 25), eventsToday(token).catch(() => [])]);
            const unread = signal.filter((m) => m.unread);
            const important = signal.filter((m) => m.important);
            const starred = signal.filter((m) => m.starred);
            const priority = signal.filter((m) => m.important || m.starred);
            res.json({
                date: new Date().toISOString().slice(0, 10),
                total: signal.length,
                unreadCount: unread.length,
                importantCount: important.length,
                starredCount: starred.length,
                topSenders: topSenders(signal),
                events,
                unread: unread.slice(0, 10),
                important: important.slice(0, 10),
                starred: starred.slice(0, 10),
                priority: priority.slice(0, 10),
            });
        }
        catch (err) {
            logger.error({ err }, 'Digest failed');
            res.status(502).json({ error: err.message });
        }
    });
    // The most recent stored digest (instant; what the bot pulled + reasoned last).
    router.get('/summary/cached', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.json({ cached: await readDigest(ctx.pool, sub) });
    });
    router.post('/summary', async (req, res) => {
        const sub = callerSub(req);
        const token = await resolveToken(req, res, ctx);
        if (!token || !sub)
            return;
        try {
            const [signal, events] = await Promise.all([listInbox(token, 'in:inbox newer_than:1d', 25), eventsToday(token).catch(() => [])]);
            const prompt = [
                'Summarize my day from the email and calendar below. Lead with what needs attention',
                '(replies owed, deadlines, meetings), then one line on the noise. 4-6 short sentences or',
                'tight bullets. No preamble, no sign-off.',
                '',
                digestText(signal, events),
            ].join('\n');
            const summary = (await runOnBot(ctx, 'summary', sub, prompt)) || 'Nothing pressing surfaced in the last day.';
            await storeDigest(ctx.pool, sub, summary);
            res.json({ summary });
        }
        catch (err) {
            logger.error({ err }, 'Summary failed');
            res.status(502).json({ error: err.message });
        }
    });
    router.post('/draft', async (req, res) => {
        const sub = callerSub(req);
        const token = await resolveToken(req, res, ctx);
        if (!token || !sub)
            return;
        const messageId = req.body?.messageId;
        const tone = req.body?.tone || 'professional and concise';
        if (!messageId) {
            res.status(400).json({ error: 'messageId required' });
            return;
        }
        try {
            const m = await gget(token, `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`);
            const prompt = [
                `Draft a ${tone} reply to the email below. Output ONLY the reply body — no subject line,`,
                'no "Here is", no surrounding quotes. Natural and ready to send after a quick read.',
                '',
                `From: ${header(m, 'From')}`,
                `Subject: ${header(m, 'Subject')}`,
                '',
                extractBody(m.payload).slice(0, 8000),
            ].join('\n');
            const draft = await runOnBot(ctx, 'draft', sub, prompt);
            res.json({ draft });
        }
        catch (err) {
            logger.error({ err }, 'Draft failed');
            res.status(502).json({ error: err.message });
        }
    });
    // ── SEND — the one mutating Gmail action (gmail.send scope). Body: { to?, subject, body,
    //    attachment?: { filename, contentBase64, mimeType } }. `to` defaults to the caller's own
    //    address ("email me a copy"). A token without the send scope 403s with an actionable message
    //    (reconnect Google) instead of failing hard — so callers degrade gracefully. The actual MIME
    //    build + send goes through the kernel's ONE fenced builder (sendGmail — header-injection
    //    fence stays framework-resident and covers this packaged route).
    router.post('/send', async (req, res) => {
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-send', 'Sending email'));
            return;
        }
        const token = await resolveToken(req, res, ctx);
        if (!token)
            return;
        const b = (req.body || {});
        const subject = String(b.subject || '').trim();
        const bodyText = String(b.body || '');
        if (!subject && !bodyText) {
            res.status(400).json({ error: 'subject or body required' });
            return;
        }
        try {
            let to = String(b.to || '').trim();
            if (!to) {
                const profile = await gget(token, `${GMAIL}/profile`);
                to = String(profile.emailAddress || '');
            }
            if (!to) {
                res.status(400).json({ error: 'no recipient and could not resolve your own address' });
                return;
            }
            const sent = await (0, email_routes_1.sendGmail)(token, { to, subject: subject || '(no subject)', body: bodyText, attachment: b.attachment });
            res.json({ ok: true, id: sent.id, to });
        }
        catch (err) {
            const msg = err.message || 'send failed';
            if (/insufficient|scope|\b403\b/i.test(msg)) {
                res.status(403).json({ error: 'insufficient_scope', message: 'Your Google connection is read-only. Reconnect Google (the connector now requests gmail.send) to enable sending.' });
                return;
            }
            logger.error({ err }, 'Email send failed');
            res.status(502).json({ error: msg });
        }
    });
    // ── Social (Facebook) — read-only profile via the connector token. Limited to
    //    public_profile until Meta App Review grants feed/posting/messaging scopes.
    //    (The full Social app is its own store package; this tab is the comms app's
    //    lightweight identity view.)
    router.get('/social', servePage(assetRoot, 'email-social.html'));
    router.get('/social/profile', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'facebook');
        if (!token) {
            if (req.query.surface === '1') {
                res.json({ connected: false, error: 'no_facebook_connection', message: 'Connect your Facebook account at /utilities first.' });
                return;
            }
            res.status(409).json({ error: 'no_facebook_connection', message: 'Connect your Facebook account at /utilities first.' });
            return;
        }
        try {
            const r = await fetch(`${FB_GRAPH}/me?fields=id,name,picture.width(160).height(160)&access_token=${encodeURIComponent(token)}`);
            if (!r.ok) {
                res.status(502).json({ error: `facebook ${r.status}` });
                return;
            }
            const me = (await r.json());
            res.json({ id: me.id, name: me.name, picture: me.picture?.data?.url || null });
        }
        catch (err) {
            logger.error({ err }, 'Facebook profile failed');
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=email-app-routes.js.map