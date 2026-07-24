/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-20 22:25:05 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial D&D app routes for the tabletop surface, SRD content, persistence, story archive, and live Dungeon Master calls.
 * 2026-07-20 23:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Added multiplayer join codes, hero claims, revision polling, recaps, and inline bot dispatch.
 * 2026-07-21 19:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Added multi-scene arcs, durable XP and level progression, and scene-aware prompts.
 * 2026-07-21 17:04:19 | roger.murphy@emeraldcoastsystemsgroup.com   | Hardened state writes with optimistic revisions, turn/claim authorization, and stable sheet fingerprints.
 * 2026-07-21 17:11:01 | roger.murphy@emeraldcoastsystemsgroup.com   | Persisted DM-granted weapon actions without replacing inventory metadata.
 * 2026-07-21 17:37:06 | roger.murphy@emeraldcoastsystemsgroup.com   | Validated multiplayer transitions, claims, restores, advancement, legacy inventory, and archive responses.
 * 2026-07-21 18:12:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Grounded Dungeon Master prompts in the authoritative grid and living-token state.
 * 2026-07-21 18:42:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Serialized archive numbering and made scene rewards transactionally idempotent.
 * 2026-07-21 18:59:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Guarded combat narration against scene, actor, and turn changes during model calls.
 * 2026-07-21 19:55:31 | roger.murphy@emeraldcoastsystemsgroup.com   | Reduced the route to HTTP composition, delegated backend domains to bounded services, loaded all classic tabletop scripts in dependency order, and adopted server-provider TTS.
 * 2026-07-21 20:09:06 | roger.murphy@emeraldcoastsystemsgroup.com   | Keep generic server failures private while emitting structured errors through an optional AppContext logger.
 * 2026-07-21 20:13:31 | roger.murphy@emeraldcoastsystemsgroup.com   | Inline classic scripts through a replacement callback so JavaScript `$&` literals cannot be expanded into script tags and corrupt the served table.
 * 2026-07-21 20:19:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Route narration through the key-backed Gemini natural server provider configured by the package manifest.
 * 2026-07-21 20:38:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Route narration through the distinct OpenAI natural server provider chosen for launch.
 * 2026-07-21 21:56:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carry validated structured roll events through archive writes and reads, and load the durable presentation-gate script before turn logic.
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com   | Serve the focused structured-dice presenter immediately after shared tabletop runtime state.
 * 2026-07-21 22:29:50 | roger.murphy@emeraldcoastsystemsgroup.com   | Serve the fixed natural-narrator client before dice, presentation, and story consumers.
 * 2026-07-21 23:07:08 | roger.murphy@emeraldcoastsystemsgroup.com   | Expose the authenticated host-only abandoned-seat takeover and its focused tabletop controls.
 * 2026-07-21 23:12:50 | roger.murphy@emeraldcoastsystemsgroup.com   | Reject archive posts from an abandoned presentation-gate branch after a rewind.
 * 2026-07-22 01:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Serve an authenticated GET-only campaign playback feed and the focused read-only timeline client.
 * 2026-07-22 00:50:36 | roger.murphy@emeraldcoastsystemsgroup.com   | Bind authenticated /chat storytelling to the exact package persona, bounded reason-only runtime, and campaign-timeline request scope while retaining /dm as a compatibility alias.
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Serve the cinematic combat-narration client before tactical automation.
 * 2026-07-22 23:30:56 | roger.murphy@emeraldcoastsystemsgroup.com  | Serve the focused full-character and current-resource client before tabletop screens.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Serve the immersive table and gameplay-rail controller before final screen wiring.
 * 2026-07-23 02:35:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Bind narration to the configured Google Cloud provider used by the Algenib-first voice chain.
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Serve an adventure catalog and shared pre-combat exploration service across multiple campaign worlds.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { CharacterImportError, normalizeInternalSheet } = require('../lib/character-import');
const {
  loadAdventureCatalog, resolveAdventure, resolveScene,
} = require('../lib/dnd-adventure-catalog');
const { claimedPcOnlyMove, stateWriteDecision } = require('../lib/multiplayer-guard');
const { createCampaignService } = require('../lib/dnd-campaign-service');
const { createDmService, parseDirectives } = require('../lib/dnd-dm-service');
const { createExplorationService } = require('../lib/dnd-exploration-service');
const { createMediaService } = require('../lib/dnd-media-service');
const { createTimelineService } = require('../lib/dnd-timeline-service');
const {
  activeTokenFor, buildSpatialBrief, campaignParty, importCharacterFile,
  inventoryWithLootWeapon, mergeLegacyInventory, primaryGridDirection, readBody,
  readJson, relativeGridPosition, resolveName, resolveSub, revConflict, sendJson,
  serveFile, sheetsRevFor, stableJson, tacticalStatus,
} = require('../lib/dnd-route-helpers');

const FALLBACK_ROOT = process.env.OSHAL_APP_PACKAGE_DIR || path.resolve(__dirname, '..');
const UI_SCRIPTS = [
  'engine.js',
  'table-runtime.js',
  'table-voice.js',
  'table-dice.js',
  'table-presentation.js',
  'table-turns.js',
  'table-combat-narration.js',
  'table-automation.js',
  'table-outcomes.js',
  'table-story.js',
  'table-exploration.js',
  'table-character-sheet.js',
  'table-campaigns.js',
  'table-seats.js',
  'table-playback.js',
  'table-immersive.js',
  'table-screens.js',
];

/** @description Read immutable adventure and SRD data once for a route instance. */
function loadContent(root) {
  const dataDir = path.join(root, 'data');
  const party = (readJson(path.join(dataDir, 'party.json')) || {}).party || [];
  const roster = (readJson(path.join(dataDir, 'srd-roster.json')) || {}).roster || [];
  const heroes = party.concat(roster);
  const catalog = loadAdventureCatalog(dataDir, readJson);
  return {
    heroes,
    defaultParty: party.map((hero) => hero.id),
    bestiary: (readJson(path.join(dataDir, 'srd-monsters.json')) || {}).monsters || {},
    ...catalog,
    leveling: readJson(path.join(dataDir, 'srd-leveling.json')) || { thresholds: {}, level2: {} },
  };
}

/** @description Read all classic scripts used by CSP-safe inline table delivery. */
function loadUiSources(root) {
  const sources = new Map();
  for (const file of UI_SCRIPTS) {
    try { sources.set(file, fs.readFileSync(path.join(root, 'ui', file), 'utf8')); }
    catch (_error) { sources.set(file, ''); }
  }
  return sources;
}

/** @description Replace classic script tags with their same-source inline bodies. */
function inlineUiScripts(html, sources) {
  return UI_SCRIPTS.reduce((document, file) => {
    const tag = `<script src="/api/dnd/${file}"></script>`;
    const inline = `<script data-dnd-source="${file}">\n${sources.get(file) || ''}\n</script>`;
    return document.replace(tag, () => inline);
  }, html);
}

/** @description Assemble immutable content helpers and bounded backend services. */
function buildEnvironment(ctx) {
  const context = ctx || {};
  const root = context.appPackageDir || FALLBACK_ROOT;
  const content = loadContent(root);
  const heroBySlug = new Map(content.heroes.map((hero) => [hero.id, hero]));
  const adventureById = (id) => resolveAdventure(content, id);
  const sceneById = (id) => resolveScene(content, id);
  const hydratedSheet = (slug, sheet) => mergeLegacyInventory(sheet, heroBySlug.get(slug));
  const base = { ...content, pool: context.pool, adventureById, sceneById, hydratedSheet };
  const campaign = createCampaignService(base);
  const exploration = createExplorationService({ ...base, campaign });
  return {
    ...base, context, root, campaign, exploration, uiSources: loadUiSources(root),
    contentBundle: {
      heroes: content.heroes, defaultParty: content.defaultParty,
      monsters: content.bestiary, adventure: content.adventure,
      adventures: content.adventures,
    },
    dm: createDmService({
      ...base, root, campaign, orchestrator: context.orchestrator, logger: context.logger,
      dndRollD20: context.dndRollD20, dmDeadlineMs: context.dndDmDeadlineMs,
    }),
    media: createMediaService({ pool: context.pool, campaign, logger: context.logger, ttsProviderId: 'google-cloud-tts' }),
    timeline: createTimelineService({ ...base, campaign }),
  };
}

/** @description Serve the CSP-safe tabletop document with all local logic inline. */
async function serveTable(env, res) {
  try {
    const html = await fs.promises.readFile(path.join(env.root, 'ui', 'table.html'), 'utf8');
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(inlineUiScripts(html, env.uiSources));
  } catch (_error) {
    sendJson(res, 404, { error: 'surface missing' });
  }
}

/** @description Serve one public tabletop surface, script, style, art, or content request. */
async function servePublic(env, method, pathname, res) {
  if (method === 'GET' && (pathname === '/' || pathname === '/table' || pathname.startsWith('/table/'))) {
    await serveTable(env, res); return true;
  }
  if (method === 'GET' && pathname === '/dnd.css') {
    serveFile(res, env.root, 'ui/dnd.css', 'text/css; charset=utf-8', true); return true;
  }
  if (method === 'GET' && UI_SCRIPTS.some((file) => pathname === `/${file}`)) {
    serveFile(res, env.root, `ui/${pathname.slice(1)}`, 'application/javascript; charset=utf-8', true); return true;
  }
  if (method === 'GET' && pathname.startsWith('/art/')) {
    serveArt(env, pathname, res); return true;
  }
  if (method === 'GET' && pathname === '/content') {
    sendJson(res, 200, env.contentBundle); return true;
  }
  return false;
}

/** @description Serve one sanitized bundled token or map image. */
function serveArt(env, pathname, res) {
  const parts = pathname.split('/').filter(Boolean);
  const id = (parts[2] || '').replace(/[^a-z0-9-]/gi, '');
  if (parts[1] === 'token' && id) return serveFile(res, env.root, `data/tokens/${id}.png`, 'image/png');
  if (parts[1] === 'map' && id) return serveFile(res, env.root, `data/maps/${id}.jpg`, 'image/jpeg');
  return sendJson(res, 404, { error: 'not found' });
}

/** @description Build request-local POST handlers that consume a parsed JSON body. */
function postHandlers(env, sub, displayName) {
  return {
    '/character/seat': (body) => env.campaign.seatImportedCharacter(sub, displayName, body),
    '/characters': (body) => env.campaign.saveCharacter(sub, body),
    '/campaign': (body) => env.campaign.createCampaign(sub, body),
    '/campaign/leave': (body) => env.campaign.leaveCampaign(sub, body),
    '/campaign/release-seat': (body) => env.campaign.releaseGuestSeat(sub, body),
    '/join': (body) => env.campaign.joinCampaign(sub, displayName, body),
    '/claim': (body) => env.campaign.claimHero(sub, displayName, body),
    '/roll': (body) => env.dm.rollShared(sub, body),
    '/state': (body) => env.campaign.saveState(sub, body),
    '/explore': (body) => env.exploration.act(sub, body),
    '/advance': (body) => env.timeline.advance(sub, body),
    '/snapshot': (body) => env.timeline.saveSnapshot(sub, body),
    '/restore': (body) => env.timeline.restoreSnapshot(sub, body),
    '/cutaway': (body) => env.media.generateCutaway(sub, body),
    '/tts': (body) => env.media.synthesizeNarration(body),
    '/chat': (body) => env.dm.dungeonMaster(sub, body),
    '/dm': (body) => env.dm.dungeonMaster(sub, body), // compatibility for saved/older clients
  };
}

/** @description Handle character import endpoints whose request shape is special. */
async function dispatchCharacterImport(env, req, res, parsed) {
  if (parsed.pathname === '/character/import-file') {
    sendJson(res, 200, { ok: true, sheet: await importCharacterFile(req, parsed) }); return true;
  }
  if (parsed.pathname !== '/character/import') return false;
  const body = await readBody(req);
  if (!body.character || typeof body.character !== 'object' || Array.isArray(body.character)) {
    throw new CharacterImportError('INVALID_INPUT', 'Character details are required.');
  }
  sendJson(res, 200, { ok: true, sheet: normalizeInternalSheet(body.character) });
  return true;
}

/** @description Handle UUID-addressed saved-character mutations. */
async function dispatchSavedCharacter(env, sub, req, res, pathname) {
  const match = pathname.match(/^\/characters\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!match) return false;
  const id = match[1].toLowerCase();
  if (req.method === 'PATCH') {
    sendJson(res, 200, await env.campaign.updateSavedCharacter(sub, id, await readBody(req))); return true;
  }
  if (req.method === 'DELETE') {
    sendJson(res, 200, await env.campaign.deleteSavedCharacter(sub, id)); return true;
  }
  return false;
}

/** @description Dispatch JSON-body POST endpoints to their domain service. */
async function dispatchPost(env, sub, req, res, parsed) {
  if (await dispatchCharacterImport(env, req, res, parsed)) return true;
  const handler = postHandlers(env, sub, resolveName(req))[parsed.pathname];
  if (handler) {
    sendJson(res, 200, await handler(await readBody(req))); return true;
  }
  if (parsed.pathname === '/archive') {
    const body = await readBody(req);
    if (!(await env.campaign.access(sub, body.campaignId))) {
      sendJson(res, 403, { error: 'No seat at this table.' }); return true;
    }
    const entry = await env.campaign.archive(
      sub, body.campaignId, String(body.kind || 'narration'),
      String(body.content || ''), body.payload, body.timelineId,
    );
    sendJson(res, 200, entry ? { ok: true, entry }
      : { ok: false, code: 'STALE_TIMELINE', error: 'The table rewound before this story beat arrived.' });
    return true;
  }
  return false;
}

/** @description Return the cheap polling response from URL cursor parameters. */
async function getSync(env, sub, parsed) {
  return env.campaign.sync(
    sub, parsed.searchParams.get('campaignId'), Number(parsed.searchParams.get('rev') || 0),
    Number(parsed.searchParams.get('seq') || 0), parsed.searchParams.get('sheetsRev')
  );
}

/** @description Read one authorized campaign's chronological story archive. */
async function getArchive(env, sub, campaignId) {
  if (!(await env.campaign.access(sub, campaignId))) return { status: 403, value: { error: 'No seat at this table.' } };
  const result = await env.pool.query(
    'SELECT seq, kind, content, payload, created_at FROM dnd_archive WHERE campaign_id=$1 ORDER BY seq ASC',
    [campaignId]
  );
  return { status: 200, value: { archive: result.rows } };
}

/** @description Serve one authorized generated cutaway file. */
async function getCutaway(env, sub, pathname, res) {
  const parts = pathname.split('/').filter(Boolean);
  const campaignId = parts[1], file = path.basename(parts[2] || '');
  if (!campaignId || !file.endsWith('.png')) { sendJson(res, 400, { error: 'bad path' }); return; }
  if (!(await env.campaign.access(sub, campaignId))) { sendJson(res, 403, { error: 'No seat at this table.' }); return; }
  serveFile(res, env.media.cutawayDir(campaignId), file, 'image/png');
}

/** @description Dispatch authenticated read endpoints. */
async function dispatchGet(env, sub, res, parsed) {
  const pathname = parsed.pathname, campaignId = parsed.searchParams.get('campaignId');
  const handlers = {
    '/campaigns': () => env.campaign.listCampaigns(sub),
    '/state': () => env.campaign.loadState(sub, campaignId),
    '/sync': () => getSync(env, sub, parsed),
    '/characters': () => env.campaign.listSavedCharacters(sub),
    '/snapshots': () => env.timeline.listSnapshots(sub, campaignId),
  };
  if (handlers[pathname]) { sendJson(res, 200, await handlers[pathname]()); return true; }
  if (pathname === '/playback') {
    const result = await env.timeline.playback(sub, campaignId);
    sendJson(res, result.code === 'NO_ACCESS' ? 403 : result.code === 'CAMPAIGN_REQUIRED' ? 400 : 200, result); return true;
  }
  if (pathname === '/archive') {
    const result = await getArchive(env, sub, campaignId);
    sendJson(res, result.status, result.value); return true;
  }
  if (pathname.startsWith('/cutaway/')) { await getCutaway(env, sub, pathname, res); return true; }
  return false;
}

/** @description Log an unexpected route failure only when AppContext supplies a logger. */
function logRouteError(env, error) {
  const logger = env.context && env.context.logger;
  if (logger && typeof logger.error === 'function') {
    logger.error({ err: error, code: error && error.code }, 'D&D route request failed');
  }
}

/** @description Serialize known input errors without leaking implementation details. */
function sendRouteError(env, res, error) {
  if (error instanceof CharacterImportError) {
    sendJson(res, error.statusCode || 400, { ok: false, code: error.code, field: error.field, error: error.message });
    return;
  }
  logRouteError(env, error);
  sendJson(res, 500, { error: 'server error' });
}

/** @description Dispatch an authenticated request through the bounded route tables. */
async function dispatchAuthenticated(env, sub, req, res, parsed) {
  if (await dispatchSavedCharacter(env, sub, req, res, parsed.pathname)) return true;
  if (req.method === 'POST') return dispatchPost(env, sub, req, res, parsed);
  if (req.method === 'GET') return dispatchGet(env, sub, res, parsed);
  return false;
}

/**
 * @description Factory for the D&D app's Express-compatible route handler.
 * @param {object} ctx - Swarm AppContext with pool, orchestrator, and package path.
 * @returns {Function} Request handler mounted at /api/dnd.
 */
function createDndRoutes(ctx) {
  const env = buildEnvironment(ctx);
  createDndRoutes._parseDirectives = parseDirectives;
  return async function dndRouter(req, res, next) {
    const parsed = new URL(req.url, 'http://dnd.local');
    const method = req.method || 'GET';
    if (await servePublic(env, method, parsed.pathname, res)) return;
    const sub = resolveSub(req);
    if (!sub) return sendJson(res, 401, { error: 'not signed in' });
    if (!env.pool) return sendJson(res, 503, { error: 'database unavailable' });
    try {
      if (await dispatchAuthenticated(env, sub, req, res, parsed)) return;
    } catch (error) {
      sendRouteError(env, res, error); return;
    }
    return next();
  };
}

createDndRoutes._parseDirectives = parseDirectives;
exports.createDndRoutes = createDndRoutes;

/**
 * @description Pure multiplayer and tactical helpers exposed for offline contract tests.
 * @returns {object} Deterministic guard and formatting functions with no route side effects.
 */
exports._test = {
  stableJson, sheetsRevFor, activeTokenFor, claimedPcOnlyMove, stateWriteDecision,
  revConflict, inventoryWithLootWeapon, mergeLegacyInventory, campaignParty,
  tacticalStatus, primaryGridDirection, relativeGridPosition, buildSpatialBrief,
};
