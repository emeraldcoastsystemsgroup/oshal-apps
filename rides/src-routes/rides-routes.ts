/**
 * Rides Routes — Uber Rides Concierge surface API
 *
 * Backs the Rides surface at /cockpit?app=rides. The framework way:
 *  - Ride OPTIONS/ESTIMATES + the request DEEP LINK come from the connector CLI
 *    (scripts/oshal-uber-rides.js), which resolves the operator's OPTIONAL Uber Rides
 *    config from the connector store via the token broker — NO keys in env/compose.
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
 * @module rides-routes
 */

import { Router, static as expressStatic, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { createChildLogger } from '@/shared/logger';
import { buildOwnerRlsPolicyStatements, runRuntimeSchemaBootstrap } from '@/shared/services/database';
import type { AppContext } from '@/app/composition/app-context';
import type { Pool } from 'pg';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { resolveBotCreds } from '@/app/routes/connector-token-broker';
import { ConciergeStore } from '@/app/routes/concierge-store';
import { cleanConciergeReply } from '@/app/routes/concierge-reply';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';

const logger = createChildLogger({ module: 'rides-routes' });

const CONCIERGE_AGENT_ID = 'b0090000-0000-0000-0000-000000000001';
const RIDES_CLI = 'scripts/oshal-uber-rides.js';
// rides-concierge is now a REAL bot-node (its own rides-bot container, codex, shells out to the CLI).
// Reach it the framework way — BotNodeClient → http://rides-bot:5000/api/swarm-execute — exactly as the
// build queue does, so the surface and Jarvis's tickets hit the same isolated, traceable bot.
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** Serve a static surface file from the package's tools dir (ctx.appPackageDir — D10). */
function serveFile(surfaceDir: string, fileName: string): RequestHandler {
  return (_req: Request, res: Response) => {
    const filePath = path.join(surfaceDir, fileName);
    res.sendFile(filePath, (err: unknown) => {
      if (err) { logger.error({ err, fileName }, `Failed to serve ${fileName}`); res.status(404).send(`Page not found: ${fileName}`); }
    });
  };
}

function resolveRiderSub(req: Request): string {
  const trustedSub = getTrustedServiceUserSub(req);
  if (trustedSub) return trustedSub;
  const oidc = (req as any).oidc;
  if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
    const u = oidc.user || {};
    const sub = u.sub || u.oid;
    if (sub) return String(sub);
  }
  if (process.env.MOCK_OIDC === 'true') return 'demo-rider';
  throw Object.assign(new Error('Not authenticated'), { status: 401 });
}

/** Run the Uber Rides connector CLI with the caller's brokered credential (OSHAL_CRED_UBER_RIDES). */
async function ridesCli(pool: Pool, sub: string, args: string[]): Promise<any> {
  const creds = await resolveBotCreds(pool as unknown as never, sub, ['uber-rides']);
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, OSHAL_USER_SUB: sub };
    if (creds.OSHAL_CRED_UBER_RIDES) env.OSHAL_CRED_UBER_RIDES = creds.OSHAL_CRED_UBER_RIDES;
    execFile('node', [path.resolve(process.cwd(), RIDES_CLI), ...args],
      { env, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        const text = (stdout || '').trim();
        try { resolve(JSON.parse(text || '{}')); }
        catch { resolve({ error: (err && err.message) || 'uber-rides CLI error', raw: text.slice(0, 300) }); }
      });
  });
}

export async function ensureRidesSchema(pool: Pool): Promise<void> {
  await runRuntimeSchemaBootstrap({
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
      ...buildOwnerRlsPolicyStatements('rides_profile', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('rides_requests', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('rides_conversations', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('rides_messages', 'user_sub'),
    ],
    requirements: [
      { table: 'rides_profile', columns: ['user_sub', 'tenant_id', 'display_name', 'home_address', 'work_address', 'default_ride_type', 'onboarded', 'created_at', 'updated_at'] },
      { table: 'rides_requests', columns: ['request_id', 'user_sub', 'pickup', 'dropoff', 'ride_type', 'est_fare_low', 'est_fare_high', 'deep_link', 'created_at'] },
      { table: 'rides_conversations', columns: ['conversation_id', 'user_sub', 'title', 'created_at', 'updated_at'] },
      { table: 'rides_messages', columns: ['message_id', 'conversation_id', 'user_sub', 'role', 'content', 'created_at'] },
    ],
  });
}

async function loadProfile(pool: Pool, sub: string): Promise<any> {
  const r = await pool.query(`SELECT * FROM rides_profile WHERE user_sub = $1`, [sub]);
  return r.rows[0] || { user_sub: sub, onboarded: false };
}

/** Record a ride handoff in history (best-effort; never blocks the deep link). */
async function recordRequest(pool: Pool, sub: string, o: { pickup: string; dropoff: string; rideType?: string; deepLink: string; fareLow?: number; fareHigh?: number }): Promise<void> {
  await pool.query(
    `INSERT INTO rides_requests (user_sub, pickup, dropoff, ride_type, est_fare_low, est_fare_high, deep_link)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [sub, o.pickup, o.dropoff, o.rideType || null, o.fareLow ?? null, o.fareHigh ?? null, o.deepLink]);
}

// ── Concierge brain ────────────────────────────────────────────────────────--

interface RideEnvelope { say: string; pickup?: string; dropoff?: string; rideType?: string; showOptions: boolean; book: boolean; remember: string[]; }

function buildConciergePrompt(o: { message: string; history: Array<{ role: string; content: string }>; profile: any; lastOptions?: any[] }): string {
  const p = o.profile || {};
  const profileLine = p.onboarded || p.home_address || p.work_address
    ? `home:${p.home_address || '?'} | work:${p.work_address || '?'} | prefers:${p.default_ride_type || 'UberX'}`
    : 'NOT ONBOARDED — you may ask their home/work address + preferred ride type once and save it, but do not block a quick ride on it.';
  // A null fare means an address did not geocode. Say so plainly rather than interpolating
  // "$null-null" into the prompt and letting the bot invent a price to paper over it.
  const opts = (o.lastOptions || []).map((x) => (
    x.fareLow === null || x.fareLow === undefined
      ? `- ${x.label}: no fare estimate (the address did not resolve to a location)`
      : `- ${x.label}: ~$${x.fareLow}-${x.fareHigh}`
  )).join('\n') || '(none shown yet)';
  const convo = (o.history || []).map((h) => `${h.role === 'assistant' ? 'You' : 'Rider'}: ${h.content}`).join('\n');
  return [
    'You are the Rides Concierge — a quick, practical Uber trip planner. Confirm pickup + destination, show ride options with ESTIMATED fares, and hand off an Uber deep link. You never request the ride or take payment.',
    'Pickup defaults to "my location". Ask only what you need (destination is required). Set "showOptions": true to display fare estimates; set "book": true ONLY when the rider clearly picks a ride to go. Always note fares are estimates.',
    'Fares are modelled from the MEASURED distance between the two geocoded points. If an option says the address did not resolve, there is no fare — say so and ask for a street number or a city. NEVER invent a dollar figure to fill the gap.',
    '',
    `RIDER PROFILE: ${profileLine}`,
    `LAST OPTIONS SHOWN:\n${opts}`,
    '',
    convo ? `CONVERSATION SO FAR:\n${convo}` : '',
    '',
    `RIDER: ${o.message}`,
    '',
    'Reply with ONLY a JSON object, nothing around it:',
    '{ "say": "your reply", "pickup": "my location", "dropoff": "destination or empty", "rideType": "uberx|comfort|xl|black or empty", "showOptions": false, "book": false, "remember": ["a preference to save"] }',
  ].filter(Boolean).join('\n');
}

function parseEnvelope(text: string): RideEnvelope {
  const fallback: RideEnvelope = { say: cleanConciergeReply(text), showOptions: false, book: false, remember: [] };
  if (!text) return fallback;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return fallback;
  try {
    const o = JSON.parse(s.slice(start, end + 1));
    return {
      say: cleanConciergeReply(o.say, fallback.say),
      pickup: o.pickup ? String(o.pickup) : undefined,
      dropoff: o.dropoff ? String(o.dropoff) : undefined,
      rideType: o.rideType ? String(o.rideType) : undefined,
      showOptions: !!o.showOptions,
      book: !!o.book,
      remember: Array.isArray(o.remember) ? o.remember.map(String).filter(Boolean) : [],
    };
  } catch { return fallback; }
}

export function createRidesRoutes(ctx: AppContext): Router {
  const router = Router();
  const pool = ctx.pool;
  const store = new ConciergeStore(pool, 'rides', false); // rides has no feedback table
  const surfaceDir = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.resolve(process.cwd(), 'tools');

  ensureRidesSchema(pool).catch((err) => logger.warn({ err }, 'Rides schema bootstrap deferred — tables may not exist yet'));

  const rider =
    (fn: (req: Request, res: Response, sub: string) => Promise<void>): RequestHandler =>
    async (req, res) => {
      let sub: string;
      try { sub = resolveRiderSub(req); }
      catch (e: any) { res.status(e.status || 401).json({ error: e.message }); return; }
      try { await fn(req, res, sub); }
      catch (err: any) { logger.error({ err, path: req.path }, 'rides route error'); res.status(500).json({ error: err.message || 'internal error' }); }
    };

  // ── Surface ────────────────────────────────────────────────────────────────
  router.get('/app', serveFile(surfaceDir, 'rides-app.html'));
  router.get('/chat', serveFile(surfaceDir, 'rides-app.html'));
  // Leaflet ships INSIDE the package (tools/vendor/leaflet). Served from here rather than a CDN
  // so the map still draws under OSHAL_STRICT_CSP and on a box with no egress. Immutable bytes at
  // a pinned version, so a long cache is safe; a version bump changes the path in the surface.
  router.use('/vendor', expressStatic(path.join(surfaceDir, 'vendor'), {
    maxAge: '30d', immutable: true, index: false, dotfiles: 'deny', fallthrough: false,
  }));

  router.get('/config', rider(async (_req, res, sub) => {
    const r = await pool.query(`SELECT 1 FROM oshal_connections WHERE provider='uber-rides' AND (user_sub=$1 OR tenant_id IS NOT NULL) LIMIT 1`, [sub]);
    const googleMapsBrowserKey =
      process.env.GOOGLE_MAPS_BROWSER_KEY ||
      process.env.VITE_GOOGLE_MAPS_BROWSER_KEY ||
      '';
    const googleMapsMapId = process.env.GOOGLE_MAPS_MAP_ID || '';
    res.json({
      uberRidesConnected: !!r.rowCount,
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
  // It goes through the framework CLI rather than the browser so Nominatim sees ONE caller
  // honouring its terms — a real User-Agent, ~1 req/s serialized, per-process cached — instead
  // of one uncontrolled caller per rider. Auth-gated like every other route here.
  router.get('/geocode', rider(async (req, res, sub) => {
    const q = String(req.query.q || '').trim();
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }
    if (q.length > 300) { res.status(400).json({ error: 'q is too long' }); return; }
    const r = await ridesCli(pool, sub, ['geocode', q]);
    if (!r || r.error || typeof r.lat !== 'number') { res.status(404).json({ error: r?.error || 'address did not resolve' }); return; }
    res.json({ lat: r.lat, lon: r.lon, label: r.label });
  }));

  router.get('/reverse', rider(async (req, res, sub) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { res.status(400).json({ error: 'lat and lon are required' }); return; }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { res.status(400).json({ error: 'lat/lon out of range' }); return; }
    const r = await ridesCli(pool, sub, ['reverse', String(lat), String(lon)]);
    if (!r || r.error || !r.label) { res.status(404).json({ error: r?.error || 'no address at that point' }); return; }
    res.json({ lat, lon, label: r.label });
  }));

  // ── Estimate + request (via the connector CLI) ──────────────────────────────
  router.get('/estimate', rider(async (req, res, sub) => {
    const pickup = String(req.query.pickup || 'my location');
    const dropoff = String(req.query.dropoff || '');
    if (!dropoff) { res.status(400).json({ error: 'dropoff is required' }); return; }
    const r = await ridesCli(pool, sub, ['estimate', pickup, dropoff]);
    res.json({
      pickup, dropoff, options: r.options || [], source: r.source || 'estimate', error: r.error,
      // The CLI geocoded both ends to measure the trip; hand the pins and the measurement to the
      // map so it draws the route without asking Nominatim the same two questions again.
      coords: r.coords || null,
      distanceKm: r.distanceKm ?? null,
      straightLineKm: r.straightLineKm ?? null,
      basis: r.basis || 'unresolved',
      note: r.note,
    });
  }));

  router.post('/request', rider(async (req, res, sub) => {
    const b = req.body || {};
    const pickup = String(b.pickup || 'my location');
    const dropoff = String(b.dropoff || '');
    const rideType = String(b.rideType || '');
    if (!dropoff) { res.status(400).json({ error: 'dropoff is required' }); return; }
    const r = await ridesCli(pool, sub, ['ride', pickup, dropoff, rideType]);
    if (!r.rideUrl) { res.status(400).json({ error: r.error || 'could not build ride link' }); return; }
    await recordRequest(pool, sub, { pickup, dropoff, rideType, deepLink: r.rideUrl, fareLow: b.fareLow, fareHigh: b.fareHigh });
    res.json({ rideUrl: r.rideUrl, pickup, dropoff, rideType,
      note: 'Opens at Uber — sign in, confirm pickup, and request. This is a handoff, not an in-app charge.' });
  }));

  router.get('/history', rider(async (_req, res, sub) => {
    const r = await pool.query(`SELECT pickup, dropoff, ride_type, est_fare_low, est_fare_high, deep_link, created_at FROM rides_requests WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 20`, [sub]);
    res.json({ trips: r.rows });
  }));

  // ── Profile ────────────────────────────────────────────────────────────────
  router.get('/profile', rider(async (_req, res, sub) => { res.json({ profile: await loadProfile(pool, sub) }); }));

  router.post('/profile', rider(async (req, res, sub) => {
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO rides_profile (user_sub, display_name, home_address, work_address, default_ride_type, notes, onboarded, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,false),NOW())
       ON CONFLICT (user_sub) DO UPDATE SET
         display_name=COALESCE(EXCLUDED.display_name, rides_profile.display_name),
         home_address=COALESCE(EXCLUDED.home_address, rides_profile.home_address),
         work_address=COALESCE(EXCLUDED.work_address, rides_profile.work_address),
         default_ride_type=COALESCE(EXCLUDED.default_ride_type, rides_profile.default_ride_type),
         notes=COALESCE(EXCLUDED.notes, rides_profile.notes),
         onboarded=(EXCLUDED.onboarded OR rides_profile.onboarded), updated_at=NOW()
       RETURNING *`,
      [sub, b.displayName ?? null, b.homeAddress ?? null, b.workAddress ?? null, b.defaultRideType ?? null, b.notes ?? null, b.onboarded ?? null]);
    res.json({ profile: r.rows[0] });
  }));

  // ── Conversational concierge ────────────────────────────────────────────────
  router.post('/chat', rider(async (req, res, sub) => {
    const message = String(req.body?.message || '').trim();
    if (!message) { res.status(400).json({ error: 'message is required' }); return; }

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
    const prompt = buildConciergePrompt({ message: messageWithHints, history, profile });
    const creds = await resolveBotCreds(pool as unknown as never, sub, ['uber-rides']);
    // Dispatch to the REAL rides-bot (codex container). It shells out to oshal-uber-rides.js itself —
    // estimate + the device-aware booking link — and returns a rich markdown answer (options table +
    // links). Cost/audit land under this agent_id; the build queue uses this exact path for tickets.
    let raw = '';
    try {
      const result = await executeBotOrInline(ctx, botClient, CONCIERGE_AGENT_ID, {
        text: prompt,
        taskId: `rides-${sub}-${randomUUID()}`,
        workspaceFolderId: `rides-${sub}`,
        agentId: CONCIERGE_AGENT_ID,
        agenticMode: true,
        direct: true,
        userSub: sub,
        creds,
      });
      raw = String(result?.response || '').trim();
    } catch (e) { logger.error({ e }, 'rides concierge dispatch failed'); }
    const env = parseEnvelope(raw);
    let reply = env.say;
    const pickup = env.pickup || hintedPickup || 'my location';
    const dropoff = env.dropoff || hintedDropoff || '';
    const rideType = env.rideType || '';
    let options: any[] = [];
    if ((env.showOptions || (!env.book && dropoff)) && dropoff) {
      const estimate = await ridesCli(pool, sub, ['estimate', pickup, dropoff]);
      options = estimate.options || [];
    }
    let ride: any = null;
    if (env.book && dropoff) {
      const handoff = await ridesCli(pool, sub, ['ride', pickup, dropoff, rideType]);
      if (handoff.rideUrl) {
        await recordRequest(pool, sub, { pickup, dropoff, rideType, deepLink: handoff.rideUrl });
        ride = { rideUrl: handoff.rideUrl, webUrl: handoff.webUrl, appUrl: handoff.appUrl, pickup, dropoff, rideType };
      }
    }
    if (!reply) reply = "I'm having trouble reaching my assistant right now — give me a moment and try again.";

    await store.addMessage(conversationId, sub, 'assistant', reply);
    await store.touch(conversationId);

    // reply is rich markdown (the shared renderer will surface maps/cards/charts from it later; for now
    // the surface renders the markdown). options/ride kept for response-shape compatibility.
    res.json({ conversationId, reply, trip: { pickup, dropoff, rideType }, options, ride });
  }));

  router.get('/conversation', rider(async (req, res, sub) => {
    // Durable resume by id (else latest), user-scoped — shared ConciergeStore.
    res.json(await store.resume(sub, String(req.query.id || '')));
  }));

  return router;
}
