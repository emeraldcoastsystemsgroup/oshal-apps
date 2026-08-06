"use strict";
/**
 * Movies Routes — Movies & TV Concierge surface API
 *
 * Backs the Movies surface at /cockpit?app=movies. The framework way:
 *  - DISCOVERY (search, trending, details, trailers, where-to-watch, recommendations) runs
 *    against the free TMDB API with the OPERATOR's key, resolved from the connector store
 *    (a shared/tenant connection) or the TMDB_API_KEY env fallback — no key hardcoded.
 *  - WATCHING + TICKETS are DEEP-LINK HANDOFFS: "Watch" opens TMDB's JustWatch where-to-watch
 *    page (TMDB gives an aggregate link, not per-provider deep links), and "Tickets" opens a
 *    Fandango search for the title. OSHAL never streams or sells.
 *  - The BRAIN runs on the movies-concierge bot via ctx.orchestrator. Candidates come from a
 *    live TMDB search; the bot recommends + fills a watchlist.
 *  - Watchlist / profile / chat persist per-viewer in the DB.
 *
 * Per-user isolation: every row is scoped by the OIDC `sub`. TMDB itself is a shared catalog,
 * so the key may be the operator's tenant connection (or env) — discovery is the same for all.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-06-20 | roger.murphy@emeraldcoastsystemsgroup.com | Initial creation — Movies & TV
 *            | concierge: TMDB discovery, where-to-watch + Fandango ticket handoffs, watchlist,
 *            | brain via the orchestrator. Mirrors the Spotify concierge, screen-shaped.
 * ---------------------------------------------------------------------------
 * 2026-08-06 10:15:00 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: remove TMDB credentials from generic orchestrator dispatch. The controller resolves TMDB only for its bounded catalog call and sends the model sanitized candidate records.
 *
 * @module movies-routes
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
exports.ensureMoviesSchema = ensureMoviesSchema;
exports.parseEnvelope = parseEnvelope;
exports.createMoviesRoutes = createMoviesRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const tmdb_client_1 = require("./tmdb-client");
const concierge_envelope_1 = require("@/app/routes/concierge-envelope");
const concierge_store_1 = require("@/app/routes/concierge-store");
const logger = (0, logger_1.createChildLogger)({ module: 'movies-routes' });
/** The movies-concierge agent (seeded by migration 049; inline bot run via the orchestrator). */
const CONCIERGE_AGENT_ID = 'b00b0000-0000-0000-0000-000000000001';
/** Serve a static surface file from the package's tools dir (ctx.appPackageDir — D10). */
function serveFile(surfaceDir, fileName) {
    return (_req, res) => {
        const filePath = path.join(surfaceDir, fileName);
        res.sendFile(filePath, (err) => {
            if (err) {
                logger.error({ err, fileName }, `Failed to serve ${fileName}`);
                res.status(404).send(`Page not found: ${fileName}`);
            }
        });
    };
}
function resolveViewerSub(req) {
    const oidc = req.oidc;
    if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
        const u = oidc.user || {};
        const sub = u.sub || u.oid;
        if (sub)
            return String(sub);
    }
    if (process.env.MOCK_OIDC === 'true')
        return 'demo-viewer';
    throw Object.assign(new Error('Not authenticated'), { status: 401 });
}
/**
 * The TMDB API key powering discovery: the caller's (or a shared/tenant) TMDB connection
 * first, then the TMDB_API_KEY env fallback. TMDB is a shared read-only catalog, so any one
 * configured key serves everyone — connect it once on /utilities, or set the env.
 */
async function getOperatorTmdbKey(pool, sub) {
    try {
        const tok = await (0, connectors_routes_1.getValidAccessToken)(pool, sub, 'tmdb');
        if (tok)
            return tok;
    }
    catch (err) {
        logger.warn({ err }, 'tmdb key resolve failed');
    }
    // Env fallback — tolerate the names TMDB's own dashboard uses (THEMOVIEDB_API_KEY = v3 key,
    // THEMOVIEDB_API_READ_ACCESS_TOKEN = v4 bearer JWT). Prefer the v4 token (the client detects
    // which by shape). Any one configured key serves all users (shared read-only catalog).
    return process.env.TMDB_API_KEY
        || process.env.THEMOVIEDB_API_READ_ACCESS_TOKEN
        || process.env.THEMOVIEDB_API_KEY
        || null;
}
// ── Schema ───────────────────────────────────────────────────────────────────
async function ensureMoviesSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'movies routes',
        statements: [`
    CREATE TABLE IF NOT EXISTS movies_profile (
      user_sub VARCHAR(255) PRIMARY KEY,
      display_name TEXT, favorite_genres TEXT[] NOT NULL DEFAULT '{}',
      services TEXT[] NOT NULL DEFAULT '{}', notes TEXT,
      onboarded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS movies_watchlist (
      row_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, item_key TEXT NOT NULL, media_type VARCHAR(8),
      tmdb_id INTEGER, title TEXT, year TEXT, poster_url TEXT, tmdb_url TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'want', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_movies_watchlist_user_item ON movies_watchlist (user_sub, item_key);
    CREATE TABLE IF NOT EXISTS movies_conversations (
      conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS movies_messages (
      message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES movies_conversations(conversation_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS movies_feedback (
      feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_movies_feedback_user_note ON movies_feedback (user_sub, lower(note));
  `,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('movies_profile', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('movies_watchlist', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('movies_conversations', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('movies_messages', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('movies_feedback', 'user_sub'),
        ],
        requirements: [
            { table: 'movies_profile', columns: ['user_sub', 'display_name', 'favorite_genres', 'services', 'notes', 'onboarded', 'created_at', 'updated_at'] },
            { table: 'movies_watchlist', columns: ['row_id', 'user_sub', 'item_key', 'media_type', 'tmdb_id', 'title', 'status', 'created_at'] },
            { table: 'movies_conversations', columns: ['conversation_id', 'user_sub', 'title', 'created_at', 'updated_at'] },
            { table: 'movies_messages', columns: ['message_id', 'conversation_id', 'user_sub', 'role', 'content', 'created_at'] },
            { table: 'movies_feedback', columns: ['feedback_id', 'user_sub', 'note', 'created_at'] },
        ],
    });
}
async function loadProfile(pool, sub) {
    const r = await pool.query(`SELECT * FROM movies_profile WHERE user_sub = $1`, [sub]);
    return r.rows[0] || { user_sub: sub, onboarded: false, favorite_genres: [], services: [] };
}
async function addToWatchlist(pool, sub, t) {
    await pool.query(`INSERT INTO movies_watchlist (user_sub, item_key, media_type, tmdb_id, title, year, poster_url, tmdb_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_sub, item_key) DO NOTHING`, [sub, t.key, t.mediaType, t.id, t.title, t.year, t.posterUrl, t.tmdbUrl]);
}
function buildConciergePrompt(o) {
    const p = o.profile || {};
    const profileLine = p.onboarded
        ? `genres:${(p.favorite_genres || []).join(',') || 'any'} | services:${(p.services || []).join(',') || 'any'}`
        : 'NOT ONBOARDED — warmly ask one or two questions first (favorite genres, the streaming services they have, movies vs shows), then save it.';
    const fmt = (t) => `- key:${t.key} | ${t.title}${t.year ? ` (${t.year})` : ''} [${t.mediaType}]${t.rating ? ` ★${t.rating}` : ''} — ${t.overview.slice(0, 110)}`;
    const cands = (o.candidates || []).map(fmt).join('\n') || '(no search results — ask what they\'re in the mood for, or that nothing matched)';
    const notes = (o.notes || []).map((n) => `- ${n}`).join('\n') || '(none yet)';
    const wl = (o.watchlistTitles || []).join(', ') || '(empty)';
    const convo = (o.history || []).map((h) => `${h.role === 'assistant' ? 'You' : 'Viewer'}: ${h.content}`).join('\n');
    return [
        'You are the Movies & TV Concierge — a sharp, spoiler-free film buddy. Help the viewer decide what to watch and where, and keep a watchlist. Never invent a title or key — only use the CANDIDATES below (real, from a live TMDB search), by key.',
        'Be conversational and brief. Ask ONE good question when it helps (movie or show? mood/genre? which services do they have?). To recommend, list candidate keys in "show". To save for later, put keys in "watchlist". Streaming + tickets are deep-link handoffs the viewer opens — you never claim to play a title or buy a ticket. No spoilers.',
        '',
        `CANDIDATES (real, from search — the ONLY titles you may show or save, by key):\n${cands}`,
        '',
        `VIEWER PROFILE: ${profileLine}`,
        `THEIR WATCHLIST: ${wl}`,
        `THINGS THEY TAUGHT YOU:\n${notes}`,
        '',
        convo ? `CONVERSATION SO FAR:\n${convo}` : '',
        '',
        `VIEWER: ${o.message}`,
        '',
        'Reply with ONLY a JSON object, nothing around it:',
        '{ "say": "your reply (ask a question when useful)", "show": ["candidate key", ...], "watchlist": ["candidate key to save"], "remember": ["a taste preference to save"] }',
    ].filter(Boolean).join('\n');
}
/** Parse the Movies concierge reply envelope (shared extraction in concierge-envelope.ts). */
function parseEnvelope(text) {
    const fallbackSay = (text || '').trim();
    const o = (0, concierge_envelope_1.extractEnvelopeJson)(text);
    if (!o)
        return { say: fallbackSay, show: [], watchlist: [], remember: [] };
    return {
        say: (0, concierge_envelope_1.sayOr)(o, fallbackSay),
        show: (0, concierge_envelope_1.asStringArray)(o.show),
        watchlist: (0, concierge_envelope_1.asStringArray)(o.watchlist),
        remember: (0, concierge_envelope_1.asStringArray)(o.remember),
    };
}
// ── Router ─────────────────────────────────────────────────────────────────--
function createMoviesRoutes(ctx) {
    const router = (0, express_1.Router)();
    const pool = ctx.pool;
    const store = new concierge_store_1.ConciergeStore(pool, 'movies');
    const surfaceDir = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.resolve(process.cwd(), 'tools');
    ensureMoviesSchema(pool).catch((err) => logger.warn({ err }, 'Movies schema bootstrap deferred — tables may not exist yet'));
    const viewer = (fn) => async (req, res) => {
        let sub;
        try {
            sub = resolveViewerSub(req);
        }
        catch (e) {
            res.status(e.status || 401).json({ error: e.message });
            return;
        }
        try {
            await fn(req, res, sub);
        }
        catch (err) {
            logger.error({ err, path: req.path }, 'movies route error');
            res.status(500).json({ error: err.message || 'internal error' });
        }
    };
    // ── Surface ────────────────────────────────────────────────────────────────
    router.get('/app', serveFile(surfaceDir, 'movies-app.html'));
    router.get('/chat', serveFile(surfaceDir, 'movies-app.html'));
    router.get('/config', viewer(async (_req, res, sub) => {
        const key = await getOperatorTmdbKey(pool, sub);
        res.json({ connected: !!key });
    }));
    // ── Discovery (TMDB) ─────────────────────────────────────────────────────────
    router.get('/trending', viewer(async (_req, res, sub) => {
        const key = await getOperatorTmdbKey(pool, sub);
        if (!key) {
            res.status(409).json({ error: 'not_configured', items: [] });
            return;
        }
        res.json({ items: await (0, tmdb_client_1.tmdbTrending)(key) });
    }));
    router.get('/search', viewer(async (req, res, sub) => {
        const key = await getOperatorTmdbKey(pool, sub);
        if (!key) {
            res.status(409).json({ error: 'not_configured', items: [] });
            return;
        }
        const items = await (0, tmdb_client_1.tmdbSearch)(key, String(req.query.q || req.query.query || ''), Number(req.query.limit) || 18);
        res.json({ items });
    }));
    /** Full detail panel: details + where-to-watch + trailer + recommendations + a tickets link. */
    router.get('/title', viewer(async (req, res, sub) => {
        const key = await getOperatorTmdbKey(pool, sub);
        if (!key) {
            res.status(409).json({ error: 'not_configured' });
            return;
        }
        const mediaType = (String(req.query.type || 'movie') === 'tv' ? 'tv' : 'movie');
        const id = Number(req.query.id);
        if (!id) {
            res.status(400).json({ error: 'id is required' });
            return;
        }
        const [details, where, trailer, recs] = await Promise.all([
            (0, tmdb_client_1.tmdbDetails)(key, mediaType, id),
            (0, tmdb_client_1.tmdbWhereToWatch)(key, mediaType, id),
            (0, tmdb_client_1.tmdbTrailer)(key, mediaType, id),
            (0, tmdb_client_1.tmdbRecommendations)(key, mediaType, id),
        ]);
        if (!details) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const tickets = mediaType === 'movie' ? (0, tmdb_client_1.buildTicketsUrl)(details.title, String(req.query.location || '')) : null;
        res.json({ title: details, where, trailer, recommendations: recs, tickets });
    }));
    /** A Fandango ticket-search deep link for a movie title (handoff). */
    router.get('/tickets', viewer(async (req, res, _sub) => {
        const title = String(req.query.title || '').trim();
        if (!title) {
            res.status(400).json({ error: 'title is required' });
            return;
        }
        res.json({ url: (0, tmdb_client_1.buildTicketsUrl)(title, String(req.query.location || '')), note: 'Opens a Fandango search — pick a theater + showtime and check out there.' });
    }));
    // ── Watchlist ────────────────────────────────────────────────────────────────
    router.get('/watchlist', viewer(async (_req, res, sub) => {
        const rows = (await pool.query(`SELECT * FROM movies_watchlist WHERE user_sub = $1 ORDER BY created_at DESC`, [sub])).rows;
        res.json({ items: rows });
    }));
    router.post('/watchlist', viewer(async (req, res, sub) => {
        const b = req.body || {};
        if (!b.key || !b.title) {
            res.status(400).json({ error: 'key and title are required' });
            return;
        }
        const mediaType = String(b.mediaType || (String(b.key).split(':')[0]));
        await addToWatchlist(pool, sub, {
            key: String(b.key), mediaType, id: Number(b.id || String(b.key).split(':')[1]) || 0,
            title: String(b.title), year: String(b.year || ''), overview: '', rating: 0, genres: [],
            posterUrl: b.posterUrl || null, backdropUrl: null, tmdbUrl: b.tmdbUrl || '',
        });
        const rows = (await pool.query(`SELECT * FROM movies_watchlist WHERE user_sub = $1 ORDER BY created_at DESC`, [sub])).rows;
        res.json({ items: rows });
    }));
    router.delete('/watchlist/:rowId', viewer(async (req, res, sub) => {
        await pool.query(`DELETE FROM movies_watchlist WHERE row_id = $1 AND user_sub = $2`, [req.params.rowId, sub]);
        const rows = (await pool.query(`SELECT * FROM movies_watchlist WHERE user_sub = $1 ORDER BY created_at DESC`, [sub])).rows;
        res.json({ items: rows });
    }));
    // ── Profile ────────────────────────────────────────────────────────────────
    router.get('/profile', viewer(async (_req, res, sub) => { res.json({ profile: await loadProfile(pool, sub) }); }));
    router.post('/profile', viewer(async (req, res, sub) => {
        const b = req.body || {};
        const r = await pool.query(`INSERT INTO movies_profile (user_sub, display_name, favorite_genres, services, notes, onboarded, updated_at)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,false),NOW())
       ON CONFLICT (user_sub) DO UPDATE SET
         display_name=COALESCE(EXCLUDED.display_name, movies_profile.display_name),
         favorite_genres=COALESCE(EXCLUDED.favorite_genres, movies_profile.favorite_genres),
         services=COALESCE(EXCLUDED.services, movies_profile.services),
         notes=COALESCE(EXCLUDED.notes, movies_profile.notes),
         onboarded=(EXCLUDED.onboarded OR movies_profile.onboarded), updated_at=NOW()
       RETURNING *`, [sub, b.displayName ?? null, b.favoriteGenres ?? null, b.services ?? null, b.notes ?? null, b.onboarded ?? null]);
        res.json({ profile: r.rows[0] });
    }));
    // ── Conversational concierge (brain runs on the bot via the orchestrator) ──
    router.post('/chat', viewer(async (req, res, sub) => {
        const message = String(req.body?.message || '').trim();
        if (!message) {
            res.status(400).json({ error: 'message is required' });
            return;
        }
        const key = await getOperatorTmdbKey(pool, sub);
        if (!key) {
            res.status(409).json({ error: 'not_configured', reply: 'Connect a TMDB key first (the Cloud / Connections page) and I can find what to watch and where.' });
            return;
        }
        // Conversation + message + feedback persistence (durable resume, IDOR guard) is shared — ConciergeStore.
        const conversationId = await store.ensureConversation(sub, req.body?.conversationId || undefined, message);
        await store.addMessage(conversationId, sub, 'user', message);
        const history = await store.loadHistory(conversationId);
        const candidates = await (0, tmdb_client_1.tmdbSearch)(key, message, 14);
        const candByKey = new Map(candidates.map((c) => [c.key, c]));
        const [profile, notes] = await Promise.all([loadProfile(pool, sub), store.loadNotes(sub)]);
        const watchlistTitles = (await pool.query(`SELECT title FROM movies_watchlist WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 20`, [sub])).rows.map((r) => r.title);
        const prompt = buildConciergePrompt({ message, history, candidates, profile, notes, watchlistTitles });
        let raw = '';
        try {
            const orchestrator = ctx.orchestrator;
            const result = await orchestrator.processMessage(`movies-${sub}-${(0, crypto_1.randomUUID)()}`, prompt, {
                agenticMode: false, autoApprove: false, source: 'movies', agentId: CONCIERGE_AGENT_ID, userSub: sub,
            });
            raw = String(result?.response || '').trim();
        }
        catch (e) {
            logger.error({ e }, 'movies concierge orchestrate failed');
        }
        const env = parseEnvelope(raw);
        if (!env.say)
            env.say = "I'm having trouble reaching my assistant right now — give me a moment and try again.";
        const added = [];
        for (const k of env.watchlist) {
            const t = candByKey.get(k);
            if (t) {
                await addToWatchlist(pool, sub, t);
                added.push(t);
            }
        }
        for (const note of env.remember)
            await store.saveNote(sub, note);
        await store.addMessage(conversationId, sub, 'assistant', env.say);
        await store.touch(conversationId);
        res.json({
            conversationId,
            reply: env.say,
            cards: env.show.map((k) => candByKey.get(k)).filter(Boolean),
            added,
            remembered: env.remember,
        });
    }));
    router.get('/conversation', viewer(async (req, res, sub) => {
        // Durable resume by id (else latest), user-scoped — shared ConciergeStore.
        res.json(await store.resume(sub, String(req.query.id || '')));
    }));
    return router;
}
//# sourceMappingURL=movies-routes.js.map