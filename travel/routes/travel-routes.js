"use strict";
/**
 * Travel Routes — Travel Concierge surface API (ADR-059)
 *
 * Backs the Travel surface at /cockpit?app=travel. The framework way:
 *  - FLIGHT SEARCH is REAL via the Duffel air API. The controller resolves the
 *    traveller's/operator's token from the connector store and passes it to the import-safe core
 *    helper as one request-scoped argument. Hotels/cars are demo + deep-link handoffs.
 *  - BOOKING is a DEEP-LINK HANDOFF (Google Flights / Booking.com / a rental search); Duffel can
 *    book via API later without re-architecting.
 *  - Every search + quote is written ANONYMIZED into travel_observations (the swarm-wide price
 *    DB) — that powers "good price / wait" intelligence and the fare-watch cron.
 *  - The BRAIN runs on the travel-concierge bot via ctx.orchestrator; it reasons over real
 *    candidates + the price read and never invents a flight or price.
 *  - Profile / searches / watches / chat persist per-traveller in the DB (scoped by OIDC sub).
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-06-20 | roger.murphy@emeraldcoastsystemsgroup.com | Initial creation — Travel concierge:
 *            | Duffel flight search, swarm price intelligence, fare watches, booking handoff,
 *            | brain via the orchestrator. Mirrors the Movies & TV concierge, screen-shaped.
 * 2026-07-19 19:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into
 *            | the travel app package (ADR-085 Wave 3, "skill with a surface"). The surface
 *            | (tools/travel-app.html) serves from ctx.appPackageDir (load-time env fallback,
 *            | D10). The swarm-shared price ENGINE — ensureTravelSchema / routeKeyFor /
 *            | recordObservations / priceRead — stays kernel-resident in
 *            | @/app/routes/travel-farewatch (with the fare-watch cron) and is imported back
 *            | via the @/ alias; scripts/oshal-duffel.js, the duffel connector + token broker,
 *            | migrations 050/051, and the travel-concierge node stay framework-resident
 *            | (ADR-093).
 * ---------------------------------------------------------------------------
 * 2026-08-06 10:15:00 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: remove Duffel credentials from generic orchestrator dispatch. Flight search resolves a fixed-server-operation credential only inside the deterministic CLI helper; the model receives bounded offers and price intelligence, never a credential map.
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: replace the final credential-bearing Duffel subprocess. Travel operations now call the bounded import-safe provider helper with the current request's explicit token.
 *
 * @module travel-routes
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
exports.createTravelRoutes = createTravelRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const authz_1 = require("@/shared/middleware/authz");
const connector_token_broker_1 = require("@/app/routes/connector-token-broker");
const provider_operation_clients_1 = require("@/app/routes/provider-operation-clients");
const travel_farewatch_1 = require("@/app/routes/travel-farewatch");
const logger = (0, logger_1.createChildLogger)({ module: 'travel-routes' });
/** The travel-concierge agent (seeded by migration 051; inline bot run via the orchestrator). */
const CONCIERGE_AGENT_ID = 'b00c0000-0000-0000-0000-000000000001';
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * Resolve a surface file from the package's tools/ dir (ctx.appPackageDir, captured at
 * factory time per D10), with the load-time env fallback and a final __dirname fallback
 * into this package's own tree.
 */
function packageToolFile(appPackageDir, fileName) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools', fileName) : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', fileName) : '',
        path.resolve(__dirname, '../tools', fileName),
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}
function serveFile(appPackageDir, fileName) {
    return (_req, res) => {
        const filePath = packageToolFile(appPackageDir, fileName);
        res.sendFile(filePath, (err) => {
            if (err) {
                logger.error({ err, fileName }, `Failed to serve ${fileName}`);
                res.status(404).send(`Page not found: ${fileName}`);
            }
        });
    };
}
function resolveViewerSub(req) {
    const trustedSub = (0, authz_1.getTrustedServiceUserSub)(req);
    if (trustedSub)
        return trustedSub;
    const oidc = req.oidc;
    if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
        const u = oidc.user || {};
        const sub = u.sub || u.oid;
        if (sub)
            return String(sub);
    }
    if (process.env.MOCK_OIDC === 'true')
        return 'demo-traveller';
    throw Object.assign(new Error('Not authenticated'), { status: 401 });
}
// ── Duffel provider helper (fixed-operation request token, never model-visible) ─────────
async function duffelProviderOperation(pool, sub, args) {
    const creds = await (0, connector_token_broker_1.resolveServerOperationCreds)(pool, sub, ['duffel'], 'fixed-server-operation');
    return (0, provider_operation_clients_1.runDuffelProviderOperation)(creds.OSHAL_CRED_DUFFEL, args);
}
async function loadProfile(pool, sub) {
    const r = await pool.query(`SELECT * FROM travel_profile WHERE user_sub = $1`, [sub]);
    return r.rows[0] || { user_sub: sub, onboarded: false, preferred_airlines: [], hotel_brands: [], avoid: [], preferred_cabin: 'economy' };
}
function buildConciergePrompt(o) {
    const p = o.profile || {};
    const profileLine = p.onboarded
        ? `home:${p.home_airport || '?'} | cabin:${p.preferred_cabin || 'economy'} | airlines:${(p.preferred_airlines || []).join(',') || 'any'} | avoid:${(p.avoid || []).join(',') || 'none'}`
        : 'NOT ONBOARDED — warmly ask one or two questions first (home airport, cabin, any preferred airline/hotel brand), then save it.';
    const fmt = (c) => o.kind === 'flight'
        ? `- id:${c.id} | ${c.airline} $${c.price} ${c.currency} | ${(c.slices || []).map((s) => `${s.origin}->${s.destination} ${s.departAt || ''} ${s.duration || ''} ${s.stops === 0 ? 'nonstop' : s.stops + ' stop'}`).join(' / ')}`
        : `- id:${c.id} | ${c.name || c.brand} ${c.carClass || ''} $${c.price} ${c.currency}${c.rating ? ` ★${c.rating}` : ''}`;
    const cands = (o.candidates || []).map(fmt).join('\n') || '(no results yet — ask where/when they want to go)';
    const notes = (o.notes || []).map((n) => `- ${n}`).join('\n') || '(none yet)';
    const price = o.price && o.price.verdict !== 'unknown'
        ? `Swarm price read: this is a ${o.price.verdict.toUpperCase()} price. ${o.price.advice} (samples:${o.price.samples}, avg:$${o.price.avg})`
        : 'Swarm price read: not enough history yet to judge.';
    const convo = (o.history || []).map((h) => `${h.role === 'assistant' ? 'You' : 'Traveller'}: ${h.content}`).join('\n');
    return [
        'You are the Travel Concierge — a sharp, honest trip planner. Help the traveller pick the right flight/hotel/car and tell them whether the price is good. Never invent an option or price — only use the CANDIDATES below (real from Duffel, or clearly-flagged demo), by id.',
        'Be conversational and brief. Ask ONE good question when it helps. To recommend, list candidate ids in "show". To track a route for a fare drop, put its id in "watch". Booking is a deep-link handoff the traveller opens — you never book or take payment, and never claim a loyalty balance you were not told.',
        '',
        `CANDIDATES (real/flagged-demo — the ONLY options you may show or watch, by id):\n${cands}`,
        '',
        price,
        `TRAVELLER PROFILE: ${profileLine}`,
        `THINGS THEY TAUGHT YOU:\n${notes}`,
        '',
        convo ? `CONVERSATION SO FAR:\n${convo}` : '',
        '',
        `TRAVELLER: ${o.message}`,
        '',
        'Reply with ONLY a JSON object, nothing around it:',
        '{ "say": "your reply (give a clear pick + the price read; ask a question when useful)", "show": ["candidate id", ...], "watch": ["candidate id to track"], "remember": ["a travel preference to save"] }',
    ].filter(Boolean).join('\n');
}
function parseEnvelope(text) {
    const fallback = { say: (text || '').trim(), show: [], watch: [], remember: [] };
    if (!text)
        return fallback;
    let s = text.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence)
        s = fence[1].trim();
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start === -1 || end === -1)
        return fallback;
    try {
        const o = JSON.parse(s.slice(start, end + 1));
        return {
            say: typeof o.say === 'string' && o.say.trim() ? o.say : fallback.say,
            show: Array.isArray(o.show) ? o.show.map(String) : [],
            watch: Array.isArray(o.watch) ? o.watch.map(String) : [],
            remember: Array.isArray(o.remember) ? o.remember.map(String).filter(Boolean) : [],
        };
    }
    catch {
        return fallback;
    }
}
/** Parse a flight-search query from a request (query or body). */
function flightQuery(src) {
    return {
        origin: String(src.origin || '').toUpperCase(),
        destination: String(src.destination || '').toUpperCase(),
        departDate: String(src.departDate || src.date || ''),
        returnDate: src.returnDate ? String(src.returnDate) : undefined,
        pax: Math.max(1, Math.min(9, Number(src.pax) || 1)),
        cabin: String(src.cabin || 'economy').toLowerCase(),
    };
}
// ── Router ─────────────────────────────────────────────────────────────────────
function createTravelRoutes(ctx) {
    const router = (0, express_1.Router)();
    const pool = ctx.pool;
    const appPackageDir = ctx.appPackageDir;
    (0, travel_farewatch_1.ensureTravelSchema)(pool).catch((err) => logger.warn({ err }, 'Travel schema bootstrap deferred — tables may not exist yet'));
    const traveller = (fn) => async (req, res) => {
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
            logger.error({ err, path: req.path }, 'travel route error');
            res.status(500).json({ error: err.message || 'internal error' });
        }
    };
    // ── Surface ────────────────────────────────────────────────────────────────
    router.get('/app', serveFile(appPackageDir, 'travel-app.html'));
    router.get('/chat', serveFile(appPackageDir, 'travel-app.html'));
    router.get('/config', traveller(async (_req, res, sub) => {
        const st = await duffelProviderOperation(pool, sub, ['status']);
        res.json({ connected: !!st.configured, mode: st.mode || 'demo', live: !!st.live });
    }));
    // ── Flight search (REAL Duffel) + price intelligence ──────────────────────────
    router.get('/flights', traveller(async (req, res, sub) => {
        const q = flightQuery(req.query);
        if (!q.origin || !q.destination || !q.departDate) {
            res.status(400).json({ error: 'origin, destination and departDate are required' });
            return;
        }
        const args = ['flights', q.origin, q.destination, q.departDate];
        if (q.returnDate)
            args.push(q.returnDate);
        args.push(String(q.pax), q.cabin);
        const r = await duffelProviderOperation(pool, sub, args);
        const items = r.items || [];
        const best = items.length ? Math.min(...items.map((i) => Number(i.price))) : null;
        await (0, travel_farewatch_1.recordObservations)(pool, 'flight', q, items, r.source || 'demo');
        const routeKey = (0, travel_farewatch_1.routeKeyFor)('flight', q);
        const price = await (0, travel_farewatch_1.priceRead)(pool, 'flight', routeKey, best);
        await pool.query(`INSERT INTO travel_searches (user_sub, kind, route_key, query, best_price) VALUES ($1,'flight',$2,$3,$4)`, [sub, routeKey, JSON.stringify(q), best]).catch(() => { });
        res.json({ items, source: r.source || 'demo', deepLink: r.deepLink, price, routeKey, error: r.error });
    }));
    router.get('/hotels', traveller(async (req, res, sub) => {
        const q = { city: String(req.query.city || ''), checkIn: String(req.query.checkIn || ''), checkOut: String(req.query.checkOut || ''), guests: Number(req.query.guests) || 2 };
        if (!q.city || !q.checkIn || !q.checkOut) {
            res.status(400).json({ error: 'city, checkIn and checkOut are required' });
            return;
        }
        const r = await duffelProviderOperation(pool, sub, ['hotels', q.city, q.checkIn, q.checkOut, String(q.guests)]);
        await (0, travel_farewatch_1.recordObservations)(pool, 'hotel', q, r.items || [], r.source || 'demo');
        const routeKey = (0, travel_farewatch_1.routeKeyFor)('hotel', q);
        const best = (r.items || []).length ? Math.min(...r.items.map((i) => Number(i.price))) : null;
        res.json({ items: r.items || [], source: r.source || 'demo', deepLink: r.deepLink, price: await (0, travel_farewatch_1.priceRead)(pool, 'hotel', routeKey, best), routeKey });
    }));
    router.get('/cars', traveller(async (req, res, sub) => {
        const q = { city: String(req.query.city || ''), pickupDate: String(req.query.pickupDate || ''), dropoffDate: String(req.query.dropoffDate || ''), carClass: String(req.query.carClass || 'midsize') };
        if (!q.city || !q.pickupDate || !q.dropoffDate) {
            res.status(400).json({ error: 'city, pickupDate and dropoffDate are required' });
            return;
        }
        const r = await duffelProviderOperation(pool, sub, ['cars', q.city, q.pickupDate, q.dropoffDate, q.carClass]);
        await (0, travel_farewatch_1.recordObservations)(pool, 'car', q, r.items || [], r.source || 'demo');
        const routeKey = (0, travel_farewatch_1.routeKeyFor)('car', q);
        const best = (r.items || []).length ? Math.min(...r.items.map((i) => Number(i.price))) : null;
        res.json({ items: r.items || [], source: r.source || 'demo', deepLink: r.deepLink, price: await (0, travel_farewatch_1.priceRead)(pool, 'car', routeKey, best), routeKey });
    }));
    // ── Fare watches ─────────────────────────────────────────────────────────────
    router.get('/watches', traveller(async (_req, res, sub) => {
        const rows = (await pool.query(`SELECT * FROM travel_watches WHERE user_sub = $1 ORDER BY created_at DESC`, [sub])).rows;
        res.json({ items: rows });
    }));
    router.post('/watches', traveller(async (req, res, sub) => {
        const b = req.body || {};
        const kind = ['flight', 'hotel', 'car'].includes(b.kind) ? b.kind : 'flight';
        const q = kind === 'flight' ? flightQuery(b) : b;
        const routeKey = b.routeKey || (0, travel_farewatch_1.routeKeyFor)(kind, q);
        const r = await pool.query(`INSERT INTO travel_watches (user_sub, kind, route_key, query, target_price, last_price)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [sub, kind, routeKey, JSON.stringify(q), b.targetPrice != null ? Number(b.targetPrice) : null, b.lastPrice != null ? Number(b.lastPrice) : null]);
        res.json({ watch: r.rows[0] });
    }));
    router.delete('/watches/:id', traveller(async (req, res, sub) => {
        await pool.query(`DELETE FROM travel_watches WHERE watch_id = $1 AND user_sub = $2`, [req.params.id, sub]);
        const rows = (await pool.query(`SELECT * FROM travel_watches WHERE user_sub = $1 ORDER BY created_at DESC`, [sub])).rows;
        res.json({ items: rows });
    }));
    // ── Profile ────────────────────────────────────────────────────────────────
    router.get('/profile', traveller(async (_req, res, sub) => { res.json({ profile: await loadProfile(pool, sub) }); }));
    router.post('/profile', traveller(async (req, res, sub) => {
        const b = req.body || {};
        const r = await pool.query(`INSERT INTO travel_profile (user_sub, display_name, home_airport, preferred_airlines, preferred_cabin, seat_pref, hotel_brands, avoid, budget_band, loyalty, notes, onboarded, updated_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,'economy'),$6,$7,$8,$9,COALESCE($10,'{}'::jsonb),$11,COALESCE($12,false),NOW())
       ON CONFLICT (user_sub) DO UPDATE SET
         display_name=COALESCE(EXCLUDED.display_name, travel_profile.display_name),
         home_airport=COALESCE(EXCLUDED.home_airport, travel_profile.home_airport),
         preferred_airlines=COALESCE(EXCLUDED.preferred_airlines, travel_profile.preferred_airlines),
         preferred_cabin=COALESCE(EXCLUDED.preferred_cabin, travel_profile.preferred_cabin),
         seat_pref=COALESCE(EXCLUDED.seat_pref, travel_profile.seat_pref),
         hotel_brands=COALESCE(EXCLUDED.hotel_brands, travel_profile.hotel_brands),
         avoid=COALESCE(EXCLUDED.avoid, travel_profile.avoid),
         budget_band=COALESCE(EXCLUDED.budget_band, travel_profile.budget_band),
         loyalty=COALESCE(EXCLUDED.loyalty, travel_profile.loyalty),
         notes=COALESCE(EXCLUDED.notes, travel_profile.notes),
         onboarded=(EXCLUDED.onboarded OR travel_profile.onboarded), updated_at=NOW()
       RETURNING *`, [sub, b.displayName ?? null, b.homeAirport ?? null, b.preferredAirlines ?? null, b.preferredCabin ?? null,
            b.seatPref ?? null, b.hotelBrands ?? null, b.avoid ?? null, b.budgetBand ?? null,
            b.loyalty != null ? JSON.stringify(b.loyalty) : null, b.notes ?? null, b.onboarded ?? null]);
        res.json({ profile: r.rows[0] });
    }));
    // ── Conversational concierge (brain runs on the bot via the orchestrator) ──
    router.post('/chat', traveller(async (req, res, sub) => {
        const message = String(req.body?.message || '').trim();
        if (!message) {
            res.status(400).json({ error: 'message is required' });
            return;
        }
        let conversationId = req.body?.conversationId || '';
        if (conversationId) {
            // IDOR guard: only honor a client-supplied conversationId if it belongs to the caller;
            // otherwise ignore it and start fresh — never read or write another user's conversation.
            const owned = await pool.query(`SELECT 1 FROM travel_conversations WHERE conversation_id = $1 AND user_sub = $2`, [conversationId, sub]);
            if (!owned.rows.length)
                conversationId = '';
        }
        if (!conversationId) {
            const c = await pool.query(`INSERT INTO travel_conversations (user_sub, title) VALUES ($1, $2) RETURNING conversation_id`, [sub, message.slice(0, 80)]);
            conversationId = c.rows[0].conversation_id;
        }
        await pool.query(`INSERT INTO travel_messages (conversation_id, user_sub, role, content) VALUES ($1,$2,'user',$3)`, [conversationId, sub, message]);
        const history = (await pool.query(`SELECT role, content FROM travel_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 12`, [conversationId])).rows.reverse();
        // Candidates: if the surface passed a structured search context, run a real search; the bot
        // then reasons over real options + the swarm price read. Otherwise it converses/onboards.
        const kind = ['flight', 'hotel', 'car'].includes(req.body?.kind) ? req.body.kind : 'flight';
        let candidates = [];
        let price = { verdict: 'unknown' };
        const candById = new Map();
        const search = req.body?.search;
        if (search && kind === 'flight' && search.origin && search.destination && search.departDate) {
            const q = flightQuery(search);
            const args = ['flights', q.origin, q.destination, q.departDate];
            if (q.returnDate)
                args.push(q.returnDate);
            args.push(String(q.pax), q.cabin);
            const r = await duffelProviderOperation(pool, sub, args);
            candidates = r.items || [];
            await (0, travel_farewatch_1.recordObservations)(pool, 'flight', q, candidates, r.source || 'demo');
            const best = candidates.length ? Math.min(...candidates.map((i) => Number(i.price))) : null;
            price = await (0, travel_farewatch_1.priceRead)(pool, 'flight', (0, travel_farewatch_1.routeKeyFor)('flight', q), best);
        }
        candidates.forEach((c) => candById.set(String(c.id), c));
        const profile = await loadProfile(pool, sub);
        const notes = (await pool.query(`SELECT note FROM travel_feedback WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 25`, [sub])).rows.map((r) => r.note);
        const prompt = buildConciergePrompt({ message, history, candidates, kind, profile, notes, price });
        let raw = '';
        try {
            const orchestrator = ctx.orchestrator;
            const result = await orchestrator.processMessage(`travel-${sub}-${(0, crypto_1.randomUUID)()}`, prompt, {
                agenticMode: false, autoApprove: false, source: 'travel', agentId: CONCIERGE_AGENT_ID, userSub: sub,
            });
            raw = String(result?.response || '').trim();
        }
        catch (e) {
            logger.error({ e }, 'travel concierge orchestrate failed');
        }
        const env = parseEnvelope(raw);
        if (!env.say)
            env.say = "I'm having trouble reaching my assistant right now — give me a moment and try again.";
        // Execute the bot's decisions: open a fare watch for any candidate it flagged.
        const watched = [];
        for (const id of env.watch) {
            const c = candById.get(id);
            if (!c || !search)
                continue;
            const q = flightQuery(search);
            const routeKey = (0, travel_farewatch_1.routeKeyFor)('flight', q);
            const w = await pool.query(`INSERT INTO travel_watches (user_sub, kind, route_key, query, last_price) VALUES ($1,'flight',$2,$3,$4) RETURNING *`, [sub, routeKey, JSON.stringify(q), Number(c.price)]);
            watched.push(w.rows[0]);
        }
        for (const note of env.remember) {
            await pool.query(`INSERT INTO travel_feedback (user_sub, note) VALUES ($1,$2) ON CONFLICT (user_sub, lower(note)) DO NOTHING`, [sub, note.slice(0, 300)]);
        }
        await pool.query(`INSERT INTO travel_messages (conversation_id, user_sub, role, content) VALUES ($1,$2,'assistant',$3)`, [conversationId, sub, env.say]);
        await pool.query(`UPDATE travel_conversations SET updated_at = NOW() WHERE conversation_id = $1`, [conversationId]);
        res.json({
            conversationId,
            reply: env.say,
            cards: env.show.map((id) => candById.get(id)).filter(Boolean),
            watched,
            remembered: env.remember,
            price,
        });
    }));
    router.get('/conversation', traveller(async (_req, res, sub) => {
        const conv = (await pool.query(`SELECT conversation_id FROM travel_conversations WHERE user_sub = $1 ORDER BY updated_at DESC LIMIT 1`, [sub])).rows[0];
        if (!conv) {
            res.json({ conversationId: null, messages: [] });
            return;
        }
        const messages = (await pool.query(`SELECT role, content FROM travel_messages WHERE conversation_id = $1 ORDER BY created_at`, [conv.conversation_id])).rows;
        res.json({ conversationId: conv.conversation_id, messages });
    }));
    return router;
}
//# sourceMappingURL=travel-routes.js.map