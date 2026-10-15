"use strict";
/**
 * Social Content Routes — the Workspace's feed, engage, saved-draft and refine backend.
 *
 * The Workspace and Composer screens called the old platform's /api/content/* routes, which the
 * native kernel does not serve ("application is not installed"). This module is the package's own
 * implementation, mounted at /api/social/content:
 *  - focus and settings are the caller's own rows;
 *  - topics are read live from Hacker News and publisher feeds (declared egress hosts, no credential), filtered by the
 *    caller's focus terms and minus the articles they dismissed; a GET never writes;
 *  - engage signals are the caller's captured social notifications, shaped deterministically;
 *  - draft, note and refine run on the package's own social-writer bot (cost metered to the
 *    caller), never on another package's node bot;
 *  - saved drafts are the caller's own rows.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial: the package-owned content routes the Workspace and Composer call (focus, settings, topics, dismiss, signals, note, draft, refine, drafts).
 * -----------------------------------------------------------------------------
 *
 * @module social-content-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FOCUS = exports.SOCIAL_WRITER_AGENT_ID = void 0;
exports.focusTerms = focusTerms;
exports.matchedTerms = matchedTerms;
exports.parseFeed = parseFeed;
exports.rankCandidates = rankCandidates;
exports.topicCard = topicCard;
exports.researchTopics = researchTopics;
exports.draftPrompt = draftPrompt;
exports.refinePrompt = refinePrompt;
exports.notePrompt = notePrompt;
exports.signalCard = signalCard;
exports.createSocialContentRoutes = createSocialContentRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const logger = (0, logger_1.createChildLogger)({ module: 'social-content-routes' });
/** The package's own drafting bot (declared in this manifest). */
exports.SOCIAL_WRITER_AGENT_ID = 'a0000000-0000-0000-0000-000000000040';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
const FEED_TIMEOUT_MS = 8000;
const UA = 'oshal-social/1.0';
/** The default focus when the caller has set none: what the Workspace was built around. */
exports.DEFAULT_FOCUS = ['ai', 'agents', 'llm', 'automation'];
/** Online-communication rules every drafted post follows (accurate, consistent, click-earning). */
const POST_BEST_PRACTICES = [
    'Follow these online-communication best practices:',
    '- HOOK: open with one scroll-stopping line. Earn the click; never bait-and-switch.',
    '- ACCURATE: state ONLY what the article/source supports. Never invent facts, metrics, quotes or dates.',
    '- CONSISTENT VOICE: steady, credible, first-person builder voice. 0-2 purposeful emoji at most.',
    '- SCANNABLE: short lines and white space. One link only.',
    '- CLOSE: a soft call-to-action or a genuine question that invites comments.',
    '- 2-4 specific hashtags at the very end.',
].join('\n');
function callerSub(req) {
    const u = req.oidc?.user;
    return u?.sub ? String(u.sub) : null;
}
/** @description Split a comma-separated focus string into bounded lowercase terms. */
function focusTerms(focus) {
    const terms = String(focus || '').split(',').map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2 && t.length <= 60);
    return terms.length ? terms.slice(0, 8) : exports.DEFAULT_FOCUS;
}
/** @description Which focus terms a title mentions (short terms need a word boundary: "ai" never matches "again"). */
function matchedTerms(text, terms) {
    const t = String(text || '').toLowerCase();
    return terms.filter((f) => (f.length <= 4
        ? new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)
        : t.includes(f)));
}
function decodeXml(s) {
    return String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#(\d{1,7});/g, (_m, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]{1,6});/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).trim();
}
/** @description Parse RSS/Atom items into candidates that mention a focus term. */
function parseFeed(xml, source, terms) {
    const out = [];
    for (const block of String(xml || '').split(/<(?:item|entry)\b/).slice(1, 30)) {
        const pick = (re) => { const m = block.match(re); return m ? decodeXml(m[1] || '') : ''; };
        const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const url = pick(/<link[^>]*href=["']([^"']+)["']/i) || pick(/<link[^>]*>([\s\S]*?)<\/link>/i);
        const matched = matchedTerms(title, terms);
        if (!title || !/^https?:\/\//.test(url) || !matched.length)
            continue;
        const createdAt = pick(/<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i) || null;
        out.push({ title, url, source, createdAt, matched, points: 0 });
    }
    return out;
}
async function fetchText(url) {
    const timeout = new Promise((_r, reject) => setTimeout(() => reject(new Error(`${url} timed out`)), FEED_TIMEOUT_MS));
    const response = await Promise.race([fetch(url, { headers: { 'User-Agent': UA } }), timeout]);
    if (!response.ok)
        throw new Error(`${url} -> ${response.status}`);
    return Promise.race([response.text(), timeout]);
}
async function hackerNews(terms) {
    const d = JSON.parse(await fetchText('https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E15&hitsPerPage=50'));
    return (d.hits || []).map((h) => ({
        title: String(h.title || ''), url: String(h.url || `https://news.ycombinator.com/item?id=${h.objectID}`),
        source: 'Hacker News', createdAt: h.created_at || null, matched: matchedTerms(String(h.title || ''), terms), points: Number(h.points) || 0,
    })).filter((c) => c.title && c.matched.length);
}
/** The publisher feeds read for every caller (all declared egress hosts). */
const FEEDS = [
    'https://techcrunch.com/feed/',
    'https://feeds.arstechnica.com/arstechnica/index',
    'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    'https://simonwillison.net/atom/everything/',
];
async function publisherFeeds(terms) {
    const settled = await Promise.allSettled(FEEDS.map(async (url) => parseFeed(await fetchText(url), new URL(url).hostname.replace(/^www\./, ''), terms)));
    // Every feed failing is a failed source, not "no matching topics".
    if (settled.every((s) => s.status === 'rejected'))
        throw new Error('no publisher feed answered');
    return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
}
/** @description Score, de-duplicate and rank candidates; recency, engagement and focus match. */
function rankCandidates(all, dismissed, now = Date.now()) {
    const seen = new Set();
    const score = (c) => {
        const age = c.createdAt ? (now - Date.parse(c.createdAt)) / 3.6e6 : 168;
        const recency = Number.isFinite(age) ? Math.max(0, 1 - age / 168) : 0;
        return recency * 0.45 + Math.min(1, c.points / 300) * 0.3 + Math.min(1, c.matched.length / 3) * 0.25;
    };
    return all.filter((c) => {
        const key = c.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
        if (!key || seen.has(key) || dismissed.has(c.url))
            return false;
        seen.add(key);
        return true;
    }).sort((a, b) => score(b) - score(a));
}
/** @description The Workspace's topic card for one candidate (deterministic; no model call). */
function topicCard(c) {
    return {
        title: c.title, source: c.source, url: c.url, date: c.createdAt,
        whyItMatters: `Trending now in ${c.matched.slice(0, 3).join(', ')}.`,
        angle: 'Share what this means for the work you do: your concrete, first-hand take.',
        question: "What's your read on this, and does it match what you're seeing?",
    };
}
/** @description Research every source; a failing source is skipped and logged, never fatal. */
async function researchTopics(terms) {
    const settled = await Promise.allSettled([hackerNews(terms), publisherFeeds(terms)]);
    const failed = settled.filter((s) => s.status === 'rejected');
    failed.forEach((s) => logger.warn({ err: s.reason }, 'topic source unavailable'));
    return { candidates: settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [])), failed: failed.length, sources: settled.length };
}
async function runWriter(ctx, kind, sub, prompt) {
    const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, exports.SOCIAL_WRITER_AGENT_ID, {
        text: prompt, taskId: `social-content-${kind}-${sub}`, workspaceFolderId: `social-${sub}`,
        agentId: exports.SOCIAL_WRITER_AGENT_ID, agenticMode: false, direct: true, userSub: sub,
    });
    const text = String(result?.response || '').trim();
    if (!text)
        throw new Error('The writer returned nothing; try again.');
    return text;
}
/** @description The share-post prompt for a picked article, led by the caller's own take. */
function draftPrompt(b) {
    return [
        'You are my personal-branding communications assistant. Write a professional, credible LinkedIn post that shares this article.',
        `Article: ${b.topic}${b.source ? ` (${b.source})` : ''}`,
        b.url ? `Article link: include this exact URL once in the post: ${b.url}` : '',
        b.angle ? `Suggested angle: ${b.angle}` : '',
        b.take ? `MY take (lead with this; the post is my perspective, not a summary):\n${b.take}` : 'I have no deep take: write a confident share with a curiosity hook and one credible line on why it matters.',
        '', POST_BEST_PRACTICES, 'Output ONLY the post text: no preamble, no surrounding quotes.',
    ].filter(Boolean).join('\n');
}
/** @description The one-instruction revision prompt that keeps the caller's voice. */
function refinePrompt(draft, instruction, topic) {
    return [
        'Revise the post below. Apply this one change:', `>> ${instruction}`, '',
        'Keep my voice and the core point. Do NOT invent metrics, quotes or stories.',
        'Output ONLY the revised post text: no preamble, no explanation.',
        topic ? `(Topic: ${topic})` : '', '', 'CURRENT POST:', draft,
    ].filter(Boolean).join('\n');
}
/** @description The short engagement-note prompt for one social signal. */
function notePrompt(b) {
    return [
        'Write a short, warm, genuine note to send or post for this social signal: specific, not generic.',
        `Signal type: ${b.type || 'update'}`, `Notification: ${b.subject}`, b.from ? `From: ${b.from}` : '',
        '', '1-2 sentences, first person, specific to the person and occasion. No hashtags, no preamble. Output ONLY the note text.',
    ].filter(Boolean).join('\n');
}
/** @description Shape a captured social notification into an engage card (deterministic). */
function signalCard(row) {
    const from = String(row.from_addr || '');
    const network = /linkedin/i.test(from) ? 'linkedin' : /(x\.com|twitter)/i.test(from) ? 'twitter' : /(facebook|instagram)/i.test(from) ? 'facebook' : '';
    const person = (from.match(/^"?([^"<]+?)"?\s*</) || [])[1] || '';
    return { type: 'update', person: person.trim(), action: 'Engage', summary: String(row.subject || row.snippet || '').slice(0, 300), network };
}
/** Wrap a handler with the caller check and one error answer; every failure is logged. */
function authed(name, handler) {
    return async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await handler(req, res, sub);
        }
        catch (err) {
            logger.error({ err }, `social content ${name} failed`);
            if (!res.headersSent)
                res.status(502).json({ error: err.message });
        }
    };
}
async function one(ctx, sql, sub) {
    return (await ctx.pool.query(sql, [sub])).rows[0];
}
function mountPreferences(router, ctx) {
    router.get('/focus', authed('focus', async (_req, res, sub) => {
        res.json({ focus: (await one(ctx, 'SELECT focus FROM social_content_focus WHERE user_sub = $1', sub))?.focus || null });
    }));
    router.post('/focus', authed('focus save', async (req, res, sub) => {
        const focus = String(req.body?.focus || '').trim().slice(0, 500) || null;
        await ctx.pool.query(`INSERT INTO social_content_focus (user_sub, focus, updated_at) VALUES ($1, $2, now())
      ON CONFLICT (user_sub) DO UPDATE SET focus = $2, updated_at = now()`, [sub, focus]);
        res.json({ ok: true, focus });
    }));
    router.get('/settings', authed('settings', async (_req, res, sub) => {
        res.json({ emailSocialScan: (await one(ctx, 'SELECT email_social_scan FROM social_content_settings WHERE user_sub = $1', sub))?.email_social_scan === true });
    }));
    router.post('/settings', authed('settings save', async (req, res, sub) => {
        const on = req.body?.emailSocialScan === true;
        await ctx.pool.query(`INSERT INTO social_content_settings (user_sub, email_social_scan, updated_at) VALUES ($1, $2, now())
      ON CONFLICT (user_sub) DO UPDATE SET email_social_scan = $2, updated_at = now()`, [sub, on]);
        res.json({ ok: true, emailSocialScan: on });
    }));
}
function mountFeed(router, ctx) {
    router.get('/topics', authed('topics', async (_req, res, sub) => {
        const focus = (await one(ctx, 'SELECT focus FROM social_content_focus WHERE user_sub = $1', sub))?.focus;
        const dismissed = new Set((await ctx.pool.query('SELECT url FROM social_content_articles WHERE user_sub = $1 AND dismissed = true', [sub])).rows.map((r) => r.url));
        const { candidates, failed, sources } = await researchTopics(focusTerms(focus));
        if (!candidates.length && failed === sources) {
            res.status(502).json({ error: 'No feed answered right now; try again shortly.' });
            return;
        }
        res.json({ cards: rankCandidates(candidates, dismissed).slice(0, 6).map(topicCard), generatedAt: new Date().toISOString(), cached: false });
    }));
    router.post('/dismiss', authed('dismiss', async (req, res, sub) => {
        const url = String(req.body?.url || '').trim();
        if (!url) {
            res.status(400).json({ error: 'url required' });
            return;
        }
        await ctx.pool.query(`INSERT INTO social_content_articles (user_sub, url, dismissed, dismissed_at) VALUES ($1, $2, true, now())
      ON CONFLICT (user_sub, url) DO UPDATE SET dismissed = true, dismissed_at = now()`, [sub, url.slice(0, 2000)]);
        res.json({ ok: true });
    }));
    router.get('/signals', authed('signals', async (_req, res, sub) => {
        const on = (await one(ctx, 'SELECT email_social_scan FROM social_content_settings WHERE user_sub = $1', sub))?.email_social_scan === true;
        if (!on) {
            res.json({ enabled: false, signals: [] });
            return;
        }
        const rows = (await ctx.pool.query(`SELECT from_addr, subject, snippet FROM oshal_inbox_messages
      WHERE user_sub = $1 AND category = 'social' AND received_at > NOW() - interval '21 days'
      ORDER BY received_at DESC LIMIT 25`, [sub]).catch((err) => { logger.warn({ err }, 'social inbox store unavailable'); return { rows: [] }; })).rows;
        res.json({ enabled: true, signals: rows.map(signalCard).slice(0, 8), scanned: rows.length });
    }));
}
function mountWriting(router, ctx) {
    router.post('/draft', authed('draft', async (req, res, sub) => {
        const b = (req.body || {});
        if (!b.topic?.trim()) {
            res.status(400).json({ error: 'topic required' });
            return;
        }
        res.json({ draft: await runWriter(ctx, 'draft', sub, draftPrompt({ ...b, topic: b.topic.trim() })) });
    }));
    router.post('/refine', authed('refine', async (req, res, sub) => {
        const b = (req.body || {});
        if (!b.draft?.trim() || !b.instruction?.trim()) {
            res.status(400).json({ error: 'draft and instruction required' });
            return;
        }
        res.json({ draft: await runWriter(ctx, 'refine', sub, refinePrompt(b.draft.trim(), b.instruction.trim(), b.topic)) });
    }));
    router.post('/note', authed('note', async (req, res, sub) => {
        const b = (req.body || {});
        if (!b.subject?.trim()) {
            res.status(400).json({ error: 'subject required' });
            return;
        }
        res.json({ note: await runWriter(ctx, 'note', sub, notePrompt({ ...b, subject: b.subject.trim() })) });
    }));
    router.get('/drafts', authed('drafts', async (_req, res, sub) => {
        const rows = (await ctx.pool.query('SELECT draft_id, topic, take, draft, created_at FROM social_content_drafts WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 50', [sub])).rows;
        res.json({ drafts: rows });
    }));
    router.post('/drafts', authed('drafts save', async (req, res, sub) => {
        const b = (req.body || {});
        if (!b.draft?.trim()) {
            res.status(400).json({ error: 'draft required' });
            return;
        }
        await ctx.pool.query('INSERT INTO social_content_drafts (user_sub, topic, take, draft) VALUES ($1, $2, $3, $4)', [sub, b.topic || null, b.take || null, b.draft.slice(0, 20000)]);
        res.json({ ok: true });
    }));
}
/**
 * @description Build the content router (mount at /api/social/content, auth: oidc). Every row is
 * the caller's own (user_sub); GETs never write.
 * @param ctx - app context (the package's SQL pool and bot execution).
 * @returns Express router.
 */
function createSocialContentRoutes(ctx) {
    const router = (0, express_1.Router)();
    mountPreferences(router, ctx);
    mountFeed(router, ctx);
    mountWriting(router, ctx);
    return router;
}
