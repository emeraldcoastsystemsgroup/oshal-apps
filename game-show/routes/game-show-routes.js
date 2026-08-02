/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:32:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Game Show route factory: serve the CSP-safe multi-surface document, dispatch room/seat/presence reads and writes, player actions, judged answers, host-bot transitions, and TTS. Self-contained except for the framework AppContext (pool, orchestrator, logger).
 * 2026-07-22 02:54:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Route host overrides (owner-only, never through the show reducer) with plain-language rejections, serve the new controls surface script, and let the host remove a stuck podium.
 * 2026-07-24 11:45:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog burn-down: per-show UI moved to a client registry (gs-shows.js + one gs-show-<id>.js each — the ADR-112 table collapse now that shows #3/#4 exist); new endpoints /react (audience reactions), /speaker (single-TTS-speaker lease), /cost (owner-only room spend); host mode 'manual' accepts host-typed content.
 * 2026-07-25 02:20:00 | codex                                      | Serve the allowlisted optional MP4 cutaway catalog and load its fail-soft browser player.
 * 2026-07-26 [rebuild] | roger.murphy@emeraldcoastsystemsgroup.com  | Player-experience rebuild: GET /qr renders the room's join link as an SVG QR (platform `qrcode` dependency, fail-soft to nothing so the code text always suffices) and the new gs-play.js player surface joins the inline script order.
 * 2026-07-26 19:15:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Broadcast chrome wiring: gs-play.js sits after the show files and before gs-surfaces.js (matching stage.html), and every chrome/set stylesheet (UI_STYLES — game-show-play.css + the four gs-set-*.css) is served no-store exactly like game-show.css always was.
 * 2026-07-31 22:45:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog #11: GET /leaderboard — the caller-scoped cross-game hall of fame read (gameshow_seats.score snapshots across the caller's ended games), rendered by the lobby.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('../lib/shows/show-registry');
const { createRoomService, resolveActor, MAX_PRESENCE_BYTES } = require('../lib/room-service');
const { createHostService } = require('../lib/host-service');
const { createMediaService } = require('../lib/media-service');
const { createLeaseStore } = require('../lib/speaker-lease');
const cutaways = require('../lib/cutaway-catalog');
const hostOverride = require('../lib/host-override');
const { resolveSub, resolveName, sendJson, serveFile, readBody, readBytes } = require('../lib/route-helpers');

const FALLBACK_ROOT = process.env.OSHAL_APP_PACKAGE_DIR || path.resolve(__dirname, '..');
// Order matters: core → presence/controls → the show-UI registry → one file per
// show → the surfaces that consume the registry → boot.
const UI_SCRIPTS = [
  'gs-core.js', 'gs-presence.js', 'gs-controls.js', 'gs-cutaways.js', 'gs-shows.js',
  'gs-show-feud.js', 'gs-show-jeopardy.js', 'gs-show-wheel.js', 'gs-show-whammy.js',
  'gs-play.js', 'gs-surfaces.js', 'gs-app.js',
];
// The shared sheet, the broadcast chrome sheet, and one set sheet per show.
const UI_STYLES = [
  'game-show.css', 'game-show-play.css',
  'gs-set-feud.css', 'gs-set-jeopardy.css', 'gs-set-wheel.css', 'gs-set-whammy.css',
];

/** @description Plain-language reasons an override could not be applied. */
const OVERRIDE_ERRORS = {
  NO_TIMER: 'There is no clock running to change.',
  NO_LIVE_CLUE: 'No clue is live right now.',
  NO_SUCH_ANSWER: 'That answer is not on this board.',
  ALREADY_REVEALED: 'That one is already up.',
  NO_CONTROL_TEAM: 'Nobody has the board yet.',
  BAD_TEAM: 'Pick Team A or Team B.',
  BAD_SEAT: 'Pick a podium first.',
  SHOW_HAS_NO_OVERRIDES: 'This show has no host overrides.',
  UNKNOWN_OVERRIDE: 'That is not something the host can do.',
};

/** @description Read all surface scripts for CSP-safe inline delivery. */
function loadUiSources(root) {
  const sources = new Map();
  for (const file of UI_SCRIPTS) {
    try { sources.set(file, fs.readFileSync(path.join(root, 'ui', file), 'utf8')); }
    catch (_error) { sources.set(file, ''); }
  }
  return sources;
}

/**
 * @description Replace external surface script tags with their same-source inline
 *   bodies. The replacement is a FUNCTION, never a string: a source containing
 *   `$'` (e.g. `'$' + clue.value`) would otherwise trigger String.replace's
 *   $-substitution and splice the rest of the document into the script — the
 *   leaked-source wall the browser playthrough now guards against.
 */
function inlineUiScripts(html, sources) {
  return UI_SCRIPTS.reduce((doc, file) => doc.replace(
    `<script src="/api/game-show/${file}"></script>`,
    () => `<script data-gs-source="${file}">\n${sources.get(file) || ''}\n</script>`
  ), html);
}

/** @description Assemble the bounded backend services from the AppContext. */
function buildEnvironment(ctx) {
  const context = ctx || {};
  const root = context.appPackageDir || FALLBACK_ROOT;
  const room = createRoomService({ pool: context.pool });
  const host = createHostService({ pool: context.pool, orchestrator: context.orchestrator, room, logger: context.logger });
  // Try the API-key voice first, then the OAuth one — deployments differ in which is authenticated.
  const media = createMediaService({ ttsProviderIds: ['gemini-tts', 'google-cloud-tts'], logger: context.logger });
  const speaker = createLeaseStore();
  return { context, root, pool: context.pool, room, host, media, speaker, uiSources: loadUiSources(root) };
}

/** @description Serve the CSP-safe multi-surface document with all local logic inline. */
async function serveStage(env, res) {
  try {
    const html = await fs.promises.readFile(path.join(env.root, 'ui', 'stage.html'), 'utf8');
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(inlineUiScripts(html, env.uiSources));
  } catch (_error) {
    sendJson(res, 404, { error: 'surface missing' });
  }
}

/** @description Serve one public surface, script, or stylesheet request. */
async function servePublic(env, method, pathname, res) {
  if (method === 'GET' && (pathname === '/' || pathname === '/stage' || pathname.startsWith('/stage/'))) {
    await serveStage(env, res); return true;
  }
  if (method === 'GET' && UI_STYLES.some((file) => pathname === `/${file}`)) {
    serveFile(res, env.root, `ui/${pathname.slice(1)}`, 'text/css; charset=utf-8', true); return true;
  }
  if (method === 'GET' && pathname === '/cutaways/catalog') {
    sendJson(res, 200, { ok: true, items: cutaways.listCutaways(env.root) }); return true;
  }
  if (method === 'GET' && pathname.startsWith('/cutaways/') && pathname.endsWith('.mp4')) {
    const id = path.basename(pathname, '.mp4');
    if (!cutaways.resolveCutawayFile(env.root, id)) {
      sendJson(res, 404, { error: 'cutaway unavailable' }); return true;
    }
    serveFile(res, env.root, `ui/cutaways/${id}.mp4`, 'video/mp4', false); return true;
  }
  if (method === 'GET' && UI_SCRIPTS.some((file) => pathname === `/${file}`)) {
    serveFile(res, env.root, `ui/${pathname.slice(1)}`, 'application/javascript; charset=utf-8', true); return true;
  }
  return false;
}

/** @description Apply one host override (owner only) under the room lock. */
async function handleOverride(env, sub, body) {
  return env.room.mutate(body.roomId, sub, async ({ state, seats, room }) => {
    const show = registry.get(room.show_id);
    if (!show) return { ok: false, status: 400, error: 'Unknown show.' };
    const result = hostOverride.apply(show, state, body.action || {}, { seats }, Date.now());
    if (!result.ok) return { ok: false, status: 409, error: OVERRIDE_ERRORS[result.error] || 'That override does not apply right now.' };
    return { ok: true, state: result.state, events: result.event ? [result.event] : [], host: result.host, cue: result.cue };
  }, { ownerOnly: true });
}

/** @description Apply one pure player/host action through the show reducer under the room lock. */
async function handleAction(env, sub, body) {
  // A host override is not a game move — it never reaches the show's reducer.
  if (hostOverride.isOverride(body.action && body.action.type)) return handleOverride(env, sub, body);
  return env.room.mutate(body.roomId, sub, async ({ state, seats, room }) => {
    const show = registry.get(room.show_id);
    if (!show) return { ok: false, status: 400, error: 'Unknown show.' };
    const resolved = resolveActor(seats, room, sub, body.actorSeatId);
    if (resolved.error) return { ok: false, status: 403, error: resolved.error };
    // Pass the seat roster as context — shows with per-player mechanics (Jeopardy's
    // Final wagers) need to know who is still in; team shows simply ignore it.
    const result = show.reduce(state, body.action || {}, resolved.actor, Date.now(), { seats: seats });
    if (!result.ok) return { ok: false, status: 409, error: result.error || 'That move is not allowed now.' };
    return { ok: true, state: result.state, events: result.event ? [result.event] : [], host: result.host, cue: result.cue };
  });
}

/**
 * @description Claim/renew the room's single TTS speaker lease for one device.
 *   Membership-gated: a device must be in the room to become its voice.
 */
async function handleSpeaker(env, sub, body) {
  const room = await env.room.access(sub, body.roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  const deviceId = String(body.deviceId || '').slice(0, 64);
  if (!deviceId) return { ok: false, status: 400, error: 'No device id.' };
  if (body.release) return { ok: true, ...env.speaker.release(body.roomId, deviceId), speaker: false };
  const priority = Math.max(0, Math.min(Number(body.priority) || 0, 9));
  return { ok: true, ...env.speaker.claim(body.roomId, deviceId, priority) };
}

/** @description Request-local JSON-body POST handlers. */
function postHandlers(env, sub, name) {
  return {
    '/rooms': (body) => env.room.createRoom(sub, name, body),
    '/join': (body) => env.room.joinByCode(sub, name, body),
    '/podium': (body) => env.room.addPodium(sub, body.roomId, body),
    '/seat': (body) => env.room.updateSeat(sub, body.roomId, body),
    '/leave': (body) => env.room.leaveRoom(sub, body.roomId),
    '/podium/remove': (body) => env.room.removeSeat(sub, body.roomId, body.seatId),
    '/status': (body) => env.room.setStatus(sub, body.roomId, body.status),
    '/action': (body) => handleAction(env, sub, body),
    '/answer': (body) => env.host.judge(sub, body.roomId, body),
    '/host': (body) => env.host.run(sub, body.roomId, body.mode, body.payload),
    '/tts': (body) => env.media.synthesizeHostLine(body),
    '/react': (body) => env.room.react(sub, name, body.roomId, body.emoji),
    '/speaker': (body) => handleSpeaker(env, sub, body),
  };
}

/** @description Store one raw camera still for a podium (bypasses JSON middleware). */
async function handlePresenceUpload(env, sub, req, res, parsed) {
  const roomId = parsed.searchParams.get('roomId');
  const seatId = parsed.searchParams.get('seatId');
  let bytes;
  try { bytes = await readBytes(req, MAX_PRESENCE_BYTES); }
  catch (_error) { return sendJson(res, 413, { error: 'Frame too large.' }); }
  const mime = String(req.headers['content-type'] || 'image/jpeg').split(';')[0];
  const result = await env.room.storePresence(sub, roomId, seatId, bytes, mime);
  sendJson(res, result.ok ? 200 : (result.status || 400), result);
}

/**
 * @description Render a room's join link as an SVG QR for the lobby screens.
 *   Uses the platform's `qrcode` dependency; when it is absent the endpoint 404s
 *   and the surfaces simply keep showing the 6-letter code — QR is sugar, the
 *   code is the contract.
 */
async function serveJoinQr(env, sub, res, parsed) {
  const roomId = parsed.searchParams.get('roomId');
  const room = await env.room.access(sub, roomId);
  if (!room || !room.join_code) return sendJson(res, 404, { error: 'Room not found.' });
  let toString;
  try { toString = require('qrcode').toString; } catch (_error) { return sendJson(res, 404, { error: 'qr unavailable' }); }
  const origin = String(parsed.searchParams.get('origin') || '').slice(0, 120);
  const link = `${/^https?:\/\/[\w.:-]+$/.test(origin) ? origin : ''}/api/game-show/stage?join=${room.join_code}`;
  const svg = await toString(link, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 220 });
  res.statusCode = 200;
  res.setHeader('content-type', 'image/svg+xml');
  res.setHeader('cache-control', 'no-store');
  res.end(svg);
}

/** @description Serve one podium's latest camera still. */
async function servePresence(env, sub, pathname, res) {
  const parts = pathname.split('/').filter(Boolean);   // presence/<roomId>/<seatId>.jpg
  const roomId = parts[1];
  const seatId = path.basename(parts[2] || '').replace(/\.jpg$/i, '');
  const frame = await env.room.loadPresence(sub, roomId, seatId);
  if (!frame) { sendJson(res, 404, { error: 'no frame' }); return; }
  res.statusCode = 200;
  res.setHeader('content-type', frame.mime);
  res.setHeader('cache-control', 'no-store');
  res.end(frame.frame);
}

/** @description Dispatch authenticated GET reads. */
async function dispatchGet(env, sub, res, parsed) {
  const pathname = parsed.pathname;
  const roomId = parsed.searchParams.get('roomId');
  const handlers = {
    '/shows': () => ({ ok: true, shows: registry.list() }),
    '/rooms': () => env.room.listRooms(sub),
    '/leaderboard': () => env.room.leaderboard(sub),
    '/state': () => env.room.loadState(sub, roomId),
    '/sync': () => env.room.sync(sub, roomId, Number(parsed.searchParams.get('rev') || 0), Number(parsed.searchParams.get('seq') || 0)),
    '/cost': () => env.host.cost(sub, roomId),
  };
  if (handlers[pathname]) {
    const result = await handlers[pathname]();
    sendJson(res, result.ok === false ? (result.status || 400) : 200, result); return true;
  }
  if (pathname === '/qr') { await serveJoinQr(env, sub, res, parsed); return true; }
  if (pathname.startsWith('/presence/')) { await servePresence(env, sub, pathname, res); return true; }
  return false;
}

/** @description Dispatch authenticated POST writes. */
async function dispatchPost(env, sub, req, res, parsed) {
  if (parsed.pathname === '/presence') { await handlePresenceUpload(env, sub, req, res, parsed); return true; }
  const handler = postHandlers(env, sub, resolveName(req))[parsed.pathname];
  if (!handler) return false;
  const result = await handler(await readBody(req));
  sendJson(res, result.ok === false ? (result.status || 400) : 200, result);
  return true;
}

/**
 * @description Factory for the Game Show app's Express-compatible route handler.
 * @param {object} ctx - Swarm AppContext with pool, orchestrator, and package path.
 * @returns {Function} Request handler mounted at /api/game-show.
 */
function createGameShowRoutes(ctx) {
  const env = buildEnvironment(ctx);
  return async function gameShowRouter(req, res, next) {
    const parsed = new URL(req.url, 'http://game-show.local');
    const method = req.method || 'GET';
    if (await servePublic(env, method, parsed.pathname, res)) return;
    const sub = resolveSub(req);
    if (!sub) return sendJson(res, 401, { error: 'not signed in' });
    if (!env.pool) return sendJson(res, 503, { error: 'database unavailable' });
    try {
      if (method === 'GET' && await dispatchGet(env, sub, res, parsed)) return;
      if (method === 'POST' && await dispatchPost(env, sub, req, res, parsed)) return;
    } catch (error) {
      if (env.context.logger && env.context.logger.error) env.context.logger.error({ err: error }, 'Game Show route failed');
      return sendJson(res, 500, { error: 'server error' });
    }
    return next();
  };
}

exports.createGameShowRoutes = createGameShowRoutes;
