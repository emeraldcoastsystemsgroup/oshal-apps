"use strict";
/**
 * Rides Routes — Uber Rides Concierge surface API
 *
 * Backs the Rides surface at /cockpit?app=rides. The framework way:
 *  - Ride OPTIONS/ESTIMATES + the request DEEP LINK come from the core Uber Rides helper.
 *    The controller resolves the operator's OPTIONAL config for one fixed server operation and
 *    passes it directly as a request-scoped argument; no child environment or model sees it.
 *  - The BRAIN runs on the rides-concierge bot via ctx.orchestrator (caller's provider).
 *  - Profile / request history / chat persist per-rider in the DB.
 *
 * Ordering truth: requesting a ride on a third party's behalf needs Uber for Business; the
 * personal path is a universal m.uber.com/ul/ deep link the rider confirms + pays in their
 * own Uber app. Fares/ETAs are clearly-labelled estimates. Per-user isolation by OIDC `sub`.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-06-19 | roger.murphy@emeraldcoastsystemsgroup.com | Initial creation — Uber Rides
 *            | concierge: estimates + deep-link handoff via the connector CLI, brain via
 *            | the orchestrator.
 * 2026-07-18 11:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-085 carve-out into the
 *            | rides store package (Wave 2 #3). Standard (ctx) factory; surface serves from this
 *            | package's tools/ (ctx.appPackageDir); core-remaining relative imports rewritten to
 *            | @/app/routes aliases (concierge-reply/store/inline-bot-execution are SHARED with
 *            | eats/purchasing — nothing vendors). ensureRidesSchema now appends
 *            | buildOwnerRlsPolicyStatements per table (A1.2 chokepoint). oshal-uber-rides.js
 *            | stays core in the image (the rides-bot + this route both shell it at /app).
 *            | The rides-concierge REAL bot-node (rides-bot container / registries / personas /
 *            | uberRidesToolKit.js) stays core per ADR-093 interim. Logic unchanged.
 * 2026-08-01 20:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | A REAL map. The Google Maps path
 *            | this surface shipped with was gated on GOOGLE_MAPS_BROWSER_KEY, which was set in no
 *            | file in either repo — so /config had only ever answered provider:'fallback' and the
 *            | rider got a CSS grid with two pins at fixed percentages. OpenStreetMap over vendored
 *            | Leaflet is now the DEFAULT provider (keyless: works on a fresh clone, no billing
 *            | account, no partner registration), and Google remains an automatic upgrade when a key
 *            | IS present. Three route additions serve it: a static mount for tools/vendor (the
 *            | Leaflet bytes ship with the package, not from a CDN — an external script tag dies
 *            | under OSHAL_STRICT_CSP and on an air-gapped box), and /geocode + /reverse, which
 *            | proxy the framework CLI's Nominatim contract so pin drags resolve through ONE
 *            | rate-limited, User-Agent'd, cached path instead of every rider's browser hitting the
 *            | public endpoint directly. /estimate now passes through the coords + measured distance
 *            | the CLI already computes, so the map draws its pins without a second round-trip.
 *            | Guard: tests/rides-map-surface.test.js.
 * ---------------------------------------------------------------------------
 * 2026-08-06 10:15:00 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: remove Uber Rides credentials from generic bot dispatch. Estimate/deep-link access resolves a fixed-server-operation credential only inside the deterministic CLI helper; the model receives rider context and never a credential map.
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: replace the final credential-bearing subprocess with the import-safe Uber Rides provider helper. Estimate, geocode, and handoff calls receive only the current request's explicit credential value.
 * 2026-09-26 | maintainer@emeraldcoastsystemsgroup.com | Commerce surfaces (backlog "Consumer commerce native surfaces"): a chat turn in which the concierge sets `book` no longer builds the Uber deep link or writes rides_requests in the same request. It prices the trip with the deterministic estimate and returns a `proposal` (rideProposal: pickup, dropoff, the matching ride type and its fare range) that the surface shows as a confirm card; only the rider's confirm calls POST /request. `ride` stays in the reply (always null) so older surfaces keep their shape.
 * 2026-10-11 | maintainer@emeraldcoastsystemsgroup.com | No Uber connector is not "no rides". When the runtime's Uber Rides `status` answers mode not_connected (the native kernel has no Uber connector and refuses every other operation with 503, which also fails the whole call), the routes never call that operation: geocode, reverse, estimate and the hand-off link run on the package's keyless rail (rides-keyless: Nominatim over the declared egress host, haversine x 1.3 and the platform fare model, Uber's public links). /estimate and /request accept the two map pins (pickupLat/pickupLon/dropoffLat/dropoffLon), so a dropped pin prices with no address lookup. /config answers the rail and its sentence. The concierge prompt states the installation's facts and never tells the rider to connect Uber; the chat no longer 503s before the bot answers. Guard: tests/rides-keyless.test.js.
 * 2026-10-11 | maintainer@emeraldcoastsystemsgroup.com | With no Uber rail the prompt says no pickup ETA is known: live, the concierge put "Est. Arrival 5-10 min" beside the modelled fares while every option's etaPickupMin is null. The prompt also carries the measured distance of the trip on screen (it said "approximately 105 miles" for an 87 km trip) and forbids any other. Guard: tests/rides-keyless.test.js.
 * 2026-10-12 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: an approved hand-off card showed only "Done in Rides." with no way to open Uber. POST /request also answers `url` (the https Uber web link, else the deep link) and `where` (one sentence: open the link to see the price and request; also under Trips), the fields an approval card shows beside its result. Guard: tests/rides-keyless.test.js.
 * 2026-10-16 | maintainer@emeraldcoastsystemsgroup.com | Saved places. "Get me an Uber from home to the airport" geocoded the word "home" (a Washington street) and handed Uber a trip to Helsinki airport. Estimates and ride links read "home" and "work" from the rider's profile, and with none saved they say so and ask for the street address; a dropoff that lands farther than a car ride is refused by the keyless rail. Guard: tests/rides-saved-places.test.js.
 *
 * @module rides-routes
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
exports.HANDOFF_WHERE = void 0;
exports.railIsAbsent = railIsAbsent;
exports.ensureRidesSchema = ensureRidesSchema;
exports.rideProposal = rideProposal;
exports.createRidesRoutes = createRidesRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const authz_1 = require("@/shared/middleware/authz");
const connector_token_broker_1 = require("@/app/routes/connector-token-broker");
const provider_operation_clients_1 = require("@/app/routes/provider-operation-clients");
const concierge_store_1 = require("@/app/routes/concierge-store");
const concierge_reply_1 = require("@/app/routes/concierge-reply");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const rides_keyless_1 = require("./rides-keyless");
const logger = (0, logger_1.createChildLogger)({ module: 'rides-routes' });
const CONCIERGE_AGENT_ID = 'b0090000-0000-0000-0000-000000000001';
// rides-concierge is a real accountable bot-node. This route uses it for tool-disabled reasoning;
// deterministic provider work stays in ridesProviderOperation after the envelope is validated.
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
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
function resolveRiderSub(req) {
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
        return 'demo-rider';
    throw Object.assign(new Error('Not authenticated'), { status: 401 });
}
/** Where an approved hand-off is found, said in every /request answer so an approval card can say it beside the link. */
exports.HANDOFF_WHERE = 'Open the Uber link to see the real price and request the ride in Uber. It is also listed under Trips in Rides.';
/** The package's keyless rail: one per process, so its Nominatim queue and cache are shared. */
const keyless = (0, rides_keyless_1.createKeylessRides)();
/**
 * @description True when the runtime's Uber Rides status says it has no Uber rail at all (the native
 * kernel's not-connected answer). Calling any other operation there refuses with 503 and fails the
 * whole request, so the routes must not.
 * @param status - The provider's `status` answer.
 * @returns Whether the keyless rail serves this request.
 */
function railIsAbsent(status) {
    return !!status && typeof status === 'object' && status.mode === 'not_connected';
}
/**
 * @description The rider's saved place for "home" or "work" (also "my home", "the office"), from the Rides
 * profile, so a trip "home to the airport" starts at their address instead of geocoding the word "home".
 * @param profile - The rider's profile row.
 * @param text - One end of the trip as asked.
 * @returns {text} unchanged for any other place, {text: address} for a saved one, or {missing} naming the
 * place word when its address is not saved.
 */
function savedPlace(profile, text) {
    const word = String(text || '').trim().toLowerCase().replace(/^(my|the|our)\s+/, '');
    const key = ['home', 'house'].includes(word) ? 'home_address' : ['work', 'office', 'job'].includes(word) ? 'work_address' : null;
    if (!key)
        return { text };
    const address = String(profile[key] || '').trim();
    return address ? { text: address } : { missing: key === 'home_address' ? 'home' : 'work' };
}
/**
 * @description Run one Uber Rides operation: the provider helper with the caller's request-scoped
 * credential where the runtime has an Uber rail, the package's keyless rail where it has none.
 * @param pool - The package pool (credential lookup).
 * @param sub - The caller.
 * @param args - The operation and its arguments.
 * @param pins - Map pins the request carried (keyless rail only).
 * @returns The operation's answer in the provider helper's shape.
 */
async function ridesProviderOperation(pool, sub, args, pins) {
    if (args[0] === 'estimate' || args[0] === 'ride') {
        const profile = await loadProfile(pool, sub);
        const ends = [savedPlace(profile, args[1]), savedPlace(profile, args[2])];
        const missing = ends.find((end) => end.missing)?.missing;
        if (missing)
            return { error: `Your ${missing} address is not saved in Rides, so "${missing}" cannot be found on the map. Give the street address, or save it in Rides.`, options: [] };
        args = [args[0], ends[0].text, ends[1].text, ...args.slice(3)];
    }
    const creds = await (0, connector_token_broker_1.resolveServerOperationCreds)(pool, sub, ['uber-rides'], 'fixed-server-operation');
    const status = await (0, provider_operation_clients_1.runUberRidesProviderOperation)(creds.OSHAL_CRED_UBER_RIDES, ['status']);
    if (railIsAbsent(status))
        return keyless.run(args, pins);
    return args[0] === 'status' ? status : (0, provider_operation_clients_1.runUberRidesProviderOperation)(creds.OSHAL_CRED_UBER_RIDES, args);
}
/** The map pins in a query string or body (each end only when both of its numbers are valid). */
function pinsFrom(src) {
    const o = src || {};
    return { pickup: (0, rides_keyless_1.pointFrom)(o.pickupLat, o.pickupLon), dropoff: (0, rides_keyless_1.pointFrom)(o.dropoffLat, o.dropoffLon) };
}
async function ensureRidesSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'rides routes',
        statements: [`
    CREATE TABLE IF NOT EXISTS rides_profile (
      user_sub VARCHAR(255) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
      display_name TEXT, home_address TEXT, work_address TEXT, default_ride_type VARCHAR(20),
      notes TEXT, onboarded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS rides_requests (
      request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, pickup TEXT, dropoff TEXT, ride_type VARCHAR(20),
      est_fare_low NUMERIC(10,2), est_fare_high NUMERIC(10,2), deep_link TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS rides_conversations (
      conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS rides_messages (
      message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES rides_conversations(conversation_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('rides_profile', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('rides_requests', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('rides_conversations', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('rides_messages', 'user_sub'),
        ],
        requirements: [
            { table: 'rides_profile', columns: ['user_sub', 'tenant_id', 'display_name', 'home_address', 'work_address', 'default_ride_type', 'onboarded', 'created_at', 'updated_at'] },
            { table: 'rides_requests', columns: ['request_id', 'user_sub', 'pickup', 'dropoff', 'ride_type', 'est_fare_low', 'est_fare_high', 'deep_link', 'created_at'] },
            { table: 'rides_conversations', columns: ['conversation_id', 'user_sub', 'title', 'created_at', 'updated_at'] },
            { table: 'rides_messages', columns: ['message_id', 'conversation_id', 'user_sub', 'role', 'content', 'created_at'] },
        ],
    });
}
async function loadProfile(pool, sub) {
    const r = await pool.query(`SELECT * FROM rides_profile WHERE user_sub = $1`, [sub]);
    return r.rows[0] || { user_sub: sub, onboarded: false };
}
/** Record a ride handoff in history (best-effort; never blocks the deep link). */
async function recordRequest(pool, sub, o) {
    await pool.query(`INSERT INTO rides_requests (user_sub, pickup, dropoff, ride_type, est_fare_low, est_fare_high, deep_link)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`, [sub, o.pickup, o.dropoff, o.rideType || null, o.fareLow ?? null, o.fareHigh ?? null, o.deepLink]);
}
/**
 * @description Describe the ride the rider would be handing off to Uber, WITHOUT building the deep
 * link or recording anything. The fare is the deterministic estimate's range for the ride type the
 * concierge named (the first option when it named none or an unknown one), and a trip that did not
 * geocode says "no fare estimate" instead of a number. Only the rider's confirm (POST /request)
 * builds the link and writes history.
 * @param trip - The pickup, destination and requested ride type.
 * @param options - The estimate's ride options for that trip.
 * @returns The proposal the surface renders as a confirm card.
 */
function rideProposal(trip, options) {
    const wanted = String(trip.rideType || '').toLowerCase();
    const option = options.find((o) => String(o?.type || '').toLowerCase() === wanted) || options[0] || null;
    const priced = !!option && option.fareLow !== null && option.fareLow !== undefined && option.fareHigh !== null && option.fareHigh !== undefined;
    const label = option?.label ? String(option.label) : null;
    const fare = priced ? `estimated $${option.fareLow}-${option.fareHigh}` : 'no fare estimate for this route';
    return {
        actionId: 'request_ride', pickup: trip.pickup, dropoff: trip.dropoff,
        rideType: option?.type ? String(option.type) : null, label,
        fareLow: priced ? Number(option.fareLow) : null, fareHigh: priced ? Number(option.fareHigh) : null,
        summary: `Open Uber for ${label || 'a ride'} from ${trip.pickup} to ${trip.dropoff} (${fare})? You confirm pickup and pay in the Uber app; nothing is requested or charged here.`,
    };
}
function buildConciergePrompt(o) {
    const p = o.profile || {};
    const profileLine = p.onboarded || p.home_address || p.work_address
        ? `home:${p.home_address || '?'} | work:${p.work_address || '?'} | prefers:${p.default_ride_type || 'UberX'}`
        : 'NOT ONBOARDED — you may ask their home/work address + preferred ride type once and save it, but do not block a quick ride on it.';
    // A null fare means an address did not geocode. Say so plainly rather than interpolating
    // "$null-null" into the prompt and letting the bot invent a price to paper over it.
    const opts = (o.lastOptions || []).map((x) => (x.fareLow === null || x.fareLow === undefined
        ? `- ${x.label}: no fare estimate (the address did not resolve to a location)`
        : `- ${x.label}: ~$${x.fareLow}-${x.fareHigh}`)).join('\n') || '(none shown yet)';
    const convo = (o.history || []).map((h) => `${h.role === 'assistant' ? 'You' : 'Rider'}: ${h.content}`).join('\n');
    const km = typeof o.distanceKm === 'number' && Number.isFinite(o.distanceKm) ? o.distanceKm : null;
    const distance = km === null ? 'MEASURED DISTANCE: none yet. Never state a distance.'
        : `MEASURED DISTANCE: ${km} km (${Math.round(km * 0.621371)} miles), the modelled road distance between the two points. Quote only this distance.`;
    return [
        'You are the Rides Concierge — a quick, practical Uber trip planner. Confirm pickup + destination, show ride options with ESTIMATED fares, and hand off an Uber deep link. You never request the ride or take payment.',
        'Pickup defaults to "my location". Ask only what you need (destination is required). Set "showOptions": true to display fare estimates; set "book": true ONLY when the rider clearly picks a ride to go. Always note fares are estimates.',
        'Fares are modelled from the MEASURED distance between the two geocoded points. If an option says the address did not resolve, there is no fare — say so and ask for a street number or a city. NEVER invent a dollar figure to fill the gap.',
        o.railNote ? `THIS INSTALLATION: ${o.railNote} Never tell the rider to connect Uber or to add an Uber connection: there is no Uber connector to add here. The rider can still see the distance and the modelled fare on the map and open the Uber hand-off. No pickup time (ETA) is known here: never state one, and never add a column or line for it.` : '',
        '',
        `RIDER PROFILE: ${profileLine}`,
        `LAST OPTIONS SHOWN:\n${opts}`,
        distance,
        '',
        convo ? `CONVERSATION SO FAR:\n${convo}` : '',
        '',
        `RIDER: ${o.message}`,
        '',
        'Reply with ONLY a JSON object, nothing around it:',
        '{ "say": "your reply", "pickup": "my location", "dropoff": "destination or empty", "rideType": "uberx|comfort|xl|black or empty", "showOptions": false, "book": false, "remember": ["a preference to save"] }',
    ].filter(Boolean).join('\n');
}
function parseEnvelope(text) {
    const fallback = { say: (0, concierge_reply_1.cleanConciergeReply)(text), showOptions: false, book: false, remember: [] };
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
            say: (0, concierge_reply_1.cleanConciergeReply)(o.say, fallback.say),
            pickup: o.pickup ? String(o.pickup) : undefined,
            dropoff: o.dropoff ? String(o.dropoff) : undefined,
            rideType: o.rideType ? String(o.rideType) : undefined,
            showOptions: !!o.showOptions,
            book: !!o.book,
            remember: Array.isArray(o.remember) ? o.remember.map(String).filter(Boolean) : [],
        };
    }
    catch {
        return fallback;
    }
}
function createRidesRoutes(ctx) {
    const router = (0, express_1.Router)();
    const pool = ctx.pool;
    const store = new concierge_store_1.ConciergeStore(pool, 'rides', false); // rides has no feedback table
    const surfaceDir = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.resolve(process.cwd(), 'tools');
    ensureRidesSchema(pool).catch((err) => logger.warn({ err }, 'Rides schema bootstrap deferred — tables may not exist yet'));
    const rider = (fn) => async (req, res) => {
        let sub;
        try {
            sub = resolveRiderSub(req);
        }
        catch (e) {
            res.status(e.status || 401).json({ error: e.message });
            return;
        }
        try {
            await fn(req, res, sub);
        }
        catch (err) {
            logger.error({ err, path: req.path }, 'rides route error');
            res.status(500).json({ error: err.message || 'internal error' });
        }
    };
    // ── Surface ────────────────────────────────────────────────────────────────
    router.get('/app', serveFile(surfaceDir, 'rides-app.html'));
    router.get('/chat', serveFile(surfaceDir, 'rides-app.html'));
    // Leaflet ships INSIDE the package (tools/vendor/leaflet). Served from here rather than a CDN
    // so the map still draws under OSHAL_STRICT_CSP and on a box with no egress. Immutable bytes at
    // a pinned version, so a long cache is safe; a version bump changes the path in the surface.
    router.use('/vendor', (0, express_1.static)(path.join(surfaceDir, 'vendor'), {
        maxAge: '30d', immutable: true, index: false, dotfiles: 'deny', fallthrough: false,
    }));
    router.get('/config', rider(async (_req, res, sub) => {
        const r = await pool.query(`SELECT 1 FROM oshal_connections WHERE provider='uber-rides' AND (user_sub=$1 OR tenant_id IS NOT NULL) LIMIT 1`, [sub]);
        const googleMapsBrowserKey = process.env.GOOGLE_MAPS_BROWSER_KEY ||
            process.env.VITE_GOOGLE_MAPS_BROWSER_KEY ||
            '';
        const googleMapsMapId = process.env.GOOGLE_MAPS_MAP_ID || '';
        const status = await ridesProviderOperation(pool, sub, ['status']);
        const absent = status?.mode === 'keyless';
        res.json({
            uberRidesConnected: !absent && !!r.rowCount,
            // 'keyless': this installation has no Uber connector; distance, fares and the hand-off link
            // are computed here (railNote says so in words). 'provider': the runtime's Uber Rides helper.
            rail: absent ? 'keyless' : 'provider',
            railNote: absent ? rides_keyless_1.NO_CONNECTOR_NOTE : undefined,
            maps: {
                // 'osm' is a REAL map, not a fallback: keyless OpenStreetMap tiles under the Leaflet
                // build vendored at tools/vendor/leaflet. Google is the upgrade when a key exists —
                // it buys road-routed polylines and Places autocomplete, not the map itself.
                provider: googleMapsBrowserKey ? 'google-maps' : 'osm',
                googleMapsEnabled: Boolean(googleMapsBrowserKey),
                googleMapsBrowserKey: googleMapsBrowserKey || undefined,
                googleMapsMapId: googleMapsMapId || undefined,
                // An operator running their own tile server points OSHAL_MAP_TILE_URL at it; the OSM
                // public tile policy is best-effort and explicitly not for heavy or commercial load.
                tileUrl: process.env.OSHAL_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                tileAttribution: process.env.OSHAL_MAP_TILE_URL
                    ? 'Map data © the configured tile provider'
                    : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19,
            },
        });
    }));
    // ── Geocoding proxy ────────────────────────────────────────────────────────
    // The map drops and drags pins, and every one of those has to become an address (and back).
    // It goes through the core provider helper rather than the browser so Nominatim sees ONE caller
    // honouring its terms — a real User-Agent, ~1 req/s serialized, per-process cached — instead
    // of one uncontrolled caller per rider. Auth-gated like every other route here.
    router.get('/geocode', rider(async (req, res, sub) => {
        const q = String(req.query.q || '').trim();
        if (!q) {
            res.status(400).json({ error: 'q is required' });
            return;
        }
        if (q.length > 300) {
            res.status(400).json({ error: 'q is too long' });
            return;
        }
        const r = await ridesProviderOperation(pool, sub, ['geocode', q]);
        if (!r || r.error || typeof r.lat !== 'number') {
            res.status(404).json({ error: r?.error || 'address did not resolve' });
            return;
        }
        res.json({ lat: r.lat, lon: r.lon, label: r.label });
    }));
    router.get('/reverse', rider(async (req, res, sub) => {
        const lat = Number(req.query.lat);
        const lon = Number(req.query.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            res.status(400).json({ error: 'lat and lon are required' });
            return;
        }
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            res.status(400).json({ error: 'lat/lon out of range' });
            return;
        }
        const r = await ridesProviderOperation(pool, sub, ['reverse', String(lat), String(lon)]);
        if (!r || r.error || !r.label) {
            res.status(404).json({ error: r?.error || 'no address at that point' });
            return;
        }
        res.json({ lat, lon, label: r.label });
    }));
    // ── Estimate + request (via the request-scoped provider helper) ─────────────
    router.get('/estimate', rider(async (req, res, sub) => {
        const pickup = String(req.query.pickup || 'my location');
        const dropoff = String(req.query.dropoff || '');
        if (!dropoff) {
            res.status(400).json({ error: 'dropoff is required' });
            return;
        }
        const r = await ridesProviderOperation(pool, sub, ['estimate', pickup, dropoff], pinsFrom(req.query));
        res.json({
            pickup, dropoff, options: r.options || [], source: r.source || 'estimate', error: r.error, rail: r.rail || 'provider',
            // The provider helper geocoded both ends; hand its pins and measurement to the
            // map so it draws the route without asking Nominatim the same two questions again.
            coords: r.coords || null,
            distanceKm: r.distanceKm ?? null,
            straightLineKm: r.straightLineKm ?? null,
            basis: r.basis || 'unresolved',
            roadFactor: r.roadFactor ?? null,
            note: r.note,
        });
    }));
    router.post('/request', rider(async (req, res, sub) => {
        const b = req.body || {};
        const pickup = String(b.pickup || 'my location');
        const dropoff = String(b.dropoff || '');
        const rideType = String(b.rideType || '');
        if (!dropoff) {
            res.status(400).json({ error: 'dropoff is required' });
            return;
        }
        const r = await ridesProviderOperation(pool, sub, ['ride', pickup, dropoff, rideType], pinsFrom(b));
        if (!r.rideUrl) {
            res.status(400).json({ error: r.error || 'could not build ride link' });
            return;
        }
        await recordRequest(pool, sub, { pickup, dropoff, rideType, deepLink: r.rideUrl, fareLow: b.fareLow, fareHigh: b.fareHigh });
        res.json({ rideUrl: r.rideUrl, webUrl: r.webUrl, appUrl: r.appUrl, url: r.webUrl || r.rideUrl, where: exports.HANDOFF_WHERE,
            pickup, dropoff, rideType, note: 'Opens at Uber — sign in, confirm pickup, and request. This is a handoff, not an in-app charge.' });
    }));
    router.get('/history', rider(async (_req, res, sub) => {
        const r = await pool.query(`SELECT pickup, dropoff, ride_type, est_fare_low, est_fare_high, deep_link, created_at FROM rides_requests WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 20`, [sub]);
        res.json({ trips: r.rows });
    }));
    // ── Profile ────────────────────────────────────────────────────────────────
    router.get('/profile', rider(async (_req, res, sub) => { res.json({ profile: await loadProfile(pool, sub) }); }));
    router.post('/profile', rider(async (req, res, sub) => {
        const b = req.body || {};
        const r = await pool.query(`INSERT INTO rides_profile (user_sub, display_name, home_address, work_address, default_ride_type, notes, onboarded, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,false),NOW())
       ON CONFLICT (user_sub) DO UPDATE SET
         display_name=COALESCE(EXCLUDED.display_name, rides_profile.display_name),
         home_address=COALESCE(EXCLUDED.home_address, rides_profile.home_address),
         work_address=COALESCE(EXCLUDED.work_address, rides_profile.work_address),
         default_ride_type=COALESCE(EXCLUDED.default_ride_type, rides_profile.default_ride_type),
         notes=COALESCE(EXCLUDED.notes, rides_profile.notes),
         onboarded=(EXCLUDED.onboarded OR rides_profile.onboarded), updated_at=NOW()
       RETURNING *`, [sub, b.displayName ?? null, b.homeAddress ?? null, b.workAddress ?? null, b.defaultRideType ?? null, b.notes ?? null, b.onboarded ?? null]);
        res.json({ profile: r.rows[0] });
    }));
    // ── Conversational concierge ────────────────────────────────────────────────
    router.post('/chat', rider(async (req, res, sub) => {
        const message = String(req.body?.message || '').trim();
        if (!message) {
            res.status(400).json({ error: 'message is required' });
            return;
        }
        // Conversation + message persistence (durable resume, IDOR guard) is shared — ConciergeStore.
        const conversationId = await store.ensureConversation(sub, req.body?.conversationId || undefined, message);
        await store.addMessage(conversationId, sub, 'user', message);
        const history = await store.loadHistory(conversationId);
        const profile = await loadProfile(pool, sub);
        const hintedPickup = String(req.body?.pickup || '').trim();
        const hintedDropoff = String(req.body?.dropoff || '').trim();
        const messageWithHints = [
            hintedPickup ? `Current pickup field: ${hintedPickup}` : '',
            hintedDropoff ? `Current destination field: ${hintedDropoff}` : '',
            message,
        ].filter(Boolean).join('\n');
        const pins = pinsFrom(req.body);
        const rail = await ridesProviderOperation(pool, sub, ['status']);
        // The trip already on screen is priced before the turn, so the concierge quotes the same numbers the map shows.
        const onScreen = hintedDropoff ? await ridesProviderOperation(pool, sub, ['estimate', hintedPickup || 'my location', hintedDropoff], pins) : null;
        const prompt = buildConciergePrompt({ message: messageWithHints, history, profile, lastOptions: onScreen?.options,
            distanceKm: onScreen?.distanceKm ?? null, railNote: rail?.mode === 'keyless' ? rides_keyless_1.NO_CONNECTOR_NOTE : '' });
        // Dispatch credential-free reasoning to the accountable rides-bot. The controller validates its
        // envelope, then performs any estimate/deep-link lookup through ridesProviderOperation at the bounded provider
        // boundary below. Cost/audit still land under this agent_id; no model tool receives a token.
        let raw = '';
        try {
            const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, CONCIERGE_AGENT_ID, {
                text: prompt,
                taskId: `rides-${sub}-${(0, crypto_1.randomUUID)()}`,
                workspaceFolderId: `rides-${sub}`,
                agentId: CONCIERGE_AGENT_ID,
                agenticMode: false,
                direct: true,
                userSub: sub,
            });
            raw = String(result?.response || '').trim();
        }
        catch (e) {
            logger.error({ e }, 'rides concierge dispatch failed');
        }
        const env = parseEnvelope(raw);
        let reply = env.say;
        const pickup = env.pickup || hintedPickup || 'my location';
        const dropoff = env.dropoff || hintedDropoff || '';
        const rideType = env.rideType || '';
        let options = [];
        if (dropoff) {
            const same = onScreen && dropoff === hintedDropoff && pickup === (hintedPickup || 'my location');
            // A pin prices only the end the concierge left as it was on screen.
            const kept = { pickup: pickup === (hintedPickup || 'my location') ? pins.pickup : null, dropoff: dropoff === hintedDropoff ? pins.dropoff : null };
            const estimate = same ? onScreen : await ridesProviderOperation(pool, sub, ['estimate', pickup, dropoff], kept);
            options = estimate.options || [];
        }
        // The concierge may decide the rider wants to go; it may not hand off on its own. A proposal
        // (priced by the estimate above) is returned for the surface's confirm card and NOTHING
        // outward-facing happens (no deep link, no rides_requests row) until the rider confirms,
        // which calls POST /request.
        const proposal = env.book && dropoff ? rideProposal({ pickup, dropoff, rideType }, options) : null;
        if (!reply)
            reply = "I'm having trouble reaching my assistant right now — give me a moment and try again.";
        await store.addMessage(conversationId, sub, 'assistant', reply);
        await store.touch(conversationId);
        // reply is rich markdown (the shared renderer will surface maps/cards/charts from it later; for now
        // the surface renders the markdown). `ride` is kept for response-shape compatibility and is
        // always null now: a hand-off is created only by the rider's confirm (POST /request).
        res.json({ conversationId, reply, trip: { pickup, dropoff, rideType }, options, ride: null, proposal });
    }));
    router.get('/conversation', rider(async (req, res, sub) => {
        // Durable resume by id (else latest), user-scoped — shared ConciergeStore.
        res.json(await store.resume(sub, String(req.query.id || '')));
    }));
    return router;
}
//# sourceMappingURL=rides-routes.js.map