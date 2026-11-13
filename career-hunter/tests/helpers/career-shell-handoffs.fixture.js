/**
 * Recovery checkpoint snapshot: shell_handoffs.js, sha256 bd734ad556853092313d03b51961abfa2595b5996f835fe28d21be352e9ef4c0.
 * Test fixture only; the native shell owns this listener.
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Answer "Continue in another app" in the native cockpit shell. Every application's connected action posts `oshal:request-app-context` to its parent and waits 8 s for `oshal:app-context-result`; only the retired cockpit listened, so every hand-off in /cockpit/ ended in "The cockpit did not respond". Ported from the platform's bindAppHandoffs/stageHandoff/deliverHandoff: bound to exactly #active-app-frame, the offer re-read from the caller's current Home plan, the context staged in memory, a real result (or the real refusal) sent back, the receiving application opened on the offer's surface, and the draft delivered to that frame once it loads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Answer the `{type:'app-navigate', tool, query?}` dialect packaged screens use to move between their own screens (Create's template cards, Home studio buttons and "← Create Home"; Career's Job Board link). Only the retired cockpit listened, so every such click toasted "Opening …" and the frame never moved. Accepted from exactly the bound frame and origin; the tool must be a manifest tool id; the query a bounded string without '#'; the open application's profile is re-read fresh and only its own local tile opens (exact toolName, or `<member>--<tool>` in a suite), with the query appended after the tile's own parameters. An unknown tool is logged and ignored, never opened as a URL.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The Home plan read that resolves a connected action is bounded at HANDOFF_PLAN_READ_MS (15 s), not 8 s: the sending page waits 20 s for the shell's answer (app-workflows.js HANDOFF_WAIT_MS) and words a timed-out read as a busy server, so the 8 s bound refused hand-offs the page was still waiting for (live sweep: youtube-kids "Discuss gift ideas" refused with TimeoutError at 8000 ms under load; the same action opened Purchasing when the box was quieter). The bound stays under the page's wait so the refusal still reaches the page.
 */
'use strict';
/** Longest wait for the Home plan read behind a connected action. The sending page waits 20 s
 * (app-workflows.js HANDOFF_WAIT_MS) for the answer, so this stays under that wait and the page
 * still receives the refusal when the read times out. */
const HANDOFF_PLAN_READ_MS = 15000;
/** Staged context lives this long; a receiver also refuses anything older. */
const HANDOFF_TTL_MS = 120000;
/** The one staged hand-off, delivered once to the receiving frame and then forgotten. */
let pendingHandoff = null;
/** The current frame binding; replaced on every navigation of the application frame. */
let shellHandoffBinding = null;

function handoffLog(level, event, started, error) {
  const record = { module: 'shell.handoffs', level, event, duration_ms: Math.round(performance.now() - started) };
  if (error) record.error = { name: error.name, message: error.message, stack: error.stack };
  console[level](JSON.stringify(record));
}

/** @description The caller's connected-action sources from the current Home plan (never a cached copy).
 * @returns {Promise<object[]>} Every `integrationSources` entry the plan admits for this caller. */
async function handoffSources() {
  const response = await fetch('/api/swarm/apps/home-plan', {
    headers: getAuthHeaders(), credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(HANDOFF_PLAN_READ_MS),
  });
  if (!response.ok) throw new Error(`Could not check connected applications (${response.status}).`);
  const data = await response.json();
  return (Array.isArray(data.apps) ? data.apps : []).flatMap(entry => entry.integrationSources || []);
}

/** @description Whether the frame's current page is one of the source application's declared surfaces,
 * declared query selectors included.
 * @param {object} source One integration source from the Home plan.
 * @param {string} frameUrl The sending frame's current location.
 * @returns {boolean} True only for a same-origin declared surface. */
function handoffOwnsSurface(source, frameUrl) {
  try {
    const actual = new URL(frameUrl, location.origin);
    if (actual.origin !== location.origin) return false;
    return (source.surfaces || []).some(surface => {
      const declared = new URL(surface.url, location.origin);
      return declared.origin === actual.origin && declared.pathname === actual.pathname
        && [...declared.searchParams].every(([key, value]) => actual.searchParams.get(key) === value);
    });
  } catch (error) {
    return false;
  }
}

/** @description The receiver's declared fields only, as bounded text; anything else refuses the whole context.
 * @param {string[]} fields Fields the receiving action accepts.
 * @param {unknown} value Context the source application sent.
 * @returns {object|null} A plain copy, or null when the context does not fit the contract. */
function handoffContext(fields, value) {
  if (!Array.isArray(fields) || !fields.length || fields.length > 12 || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length > 12 || keys.some(key => !fields.includes(key))) return null;
  const result = {};
  for (const key of keys) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || typeof value[key] !== 'string' || value[key].length > 2000) return null;
    result[key] = value[key];
  }
  return keys.length ? result : null;
}

/** @description Stage one resolved offer's context for the receiving surface.
 * @param {object} offer An available offer from the current Home plan.
 * @param {unknown} value The context the source sent.
 * @returns {boolean} Whether a hand-off is now staged. */
function stageShellHandoff(offer, value) {
  pendingHandoff = null;
  const context = handoffContext(offer && offer.fields, value);
  if (!offer || offer.state !== 'available' || !offer.surface || !context) return false;
  pendingHandoff = { type: 'oshal:app-context', sourceApp: offer.sourceApp, targetApp: offer.targetApp,
    action: offer.targetAction, contextType: offer.contextType, version: offer.version,
    surface: offer.surface, surfaceUrl: offer.surfaceUrl, context, expiresAt: Date.now() + HANDOFF_TTL_MS };
  return true;
}

function samePage(left, right) {
  try {
    const a = new URL(left, location.origin);
    const b = new URL(right, location.origin);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  } catch (error) {
    return false;
  }
}

function frameLocation(frame) {
  try { return frame.contentWindow ? String(frame.contentWindow.location.href) : ''; } catch (error) { return ''; }
}

/** @description Consume the staged hand-off on a navigation of the application frame; deliver it when
 * that navigation is the offer's surface, once the receiving page has loaded.
 * @param {HTMLIFrameElement} frame The application frame.
 * @param {string} url The local route the frame is navigating to.
 * @param {string} [surface] The tile's tool name, when the navigation came from a tile.
 * @returns {boolean} Whether a delivery is waiting on the frame's load. */
function deliverShellHandoff(frame, url, surface) {
  const message = pendingHandoff;
  pendingHandoff = null;
  if (!message || message.expiresAt < Date.now()) return false;
  if (message.surface !== surface && !samePage(url, message.surfaceUrl)) return false;
  const deliver = () => {
    const at = frameLocation(frame);
    if (!at || at === 'about:blank') return;
    frame.removeEventListener('load', deliver);
    if (message.expiresAt < Date.now() || new URL(at).origin !== location.origin) return;
    const { surfaceUrl, ...sent } = message;
    frame.contentWindow.postMessage(sent, location.origin);
  };
  frame.addEventListener('load', deliver);
  return true;
}

/** @description Re-read the plan and resolve one request to an available, staged offer.
 * @param {object} binding The frame binding the request arrived on.
 * @param {object} request The `oshal:request-app-context` message.
 * @returns {Promise<object>} The offer to open; throws with the reason otherwise. */
async function resolveShellHandoff(binding, request) {
  const senderUrl = frameLocation(binding.frame);
  const sources = await handoffSources();
  const source = sources.find(item => item && item.app === request.app);
  if (!binding.active || frameLocation(binding.frame) !== senderUrl || !source || !handoffOwnsSurface(source, senderUrl)) {
    throw new Error('The source application is no longer available.');
  }
  const offer = (source.offers || []).find(item => item.id === request.offer);
  if (!offer) throw new Error('This connected action is not offered to you.');
  if (offer.state !== 'available') {
    const why = offer.state === 'incompatible' ? 'needs a compatible action' : 'is not loaded or not open to you';
    throw new Error(`${offer.label}: the receiving application ${why}.`);
  }
  if (!stageShellHandoff(offer, request.context)) throw new Error('This connected action\'s context is invalid.');
  return offer;
}

/** @description Open the receiving application on the offer's surface; the staged context is delivered
 * when that surface loads.
 * @param {object} offer The resolved offer.
 * @returns {Promise<void>} */
async function openShellHandoffTarget(offer) {
  if (typeof activateShellTab === 'function') activateShellTab('surfaces');
  await launchApp(offer.targetApp, { surface: offer.surface, url: offer.surfaceUrl });
}

async function answerShellHandoff(binding, event) {
  const request = event.data;
  if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 80) return;
  const reply = body => event.source.postMessage({ type: 'oshal:app-context-result', requestId: request.requestId, ...body }, event.origin);
  if (binding.busy) return reply({ error: 'Another connected action is still opening. Please wait a moment.' });
  binding.busy = true;
  const started = performance.now();
  try {
    const offer = await resolveShellHandoff(binding, request);
    reply({ ok: true });
    handoffLog('info', 'handoff_staged', started);
    await openShellHandoffTarget(offer);
  } catch (error) {
    handoffLog('error', 'handoff_refused', started, error);
    if (binding.active) reply({ error: error.message || 'Could not open the receiving application.' });
  } finally {
    binding.busy = false;
  }
}

/** A packaged screen names a sibling screen by its manifest tool id, never by a URL. */
const APP_NAVIGATE_TOOL = /^[a-z0-9-]{1,80}$/;
/** Longest query a screen may ask to append to the sibling screen's own route. */
const APP_NAVIGATE_QUERY_MAX = 512;

/** @description The query a screen asked to append, as parameters; absent means none.
 * @param {unknown} query The message's `query`.
 * @returns {URLSearchParams|null} The parameters, or null when the query is not a bounded plain string. */
function appNavigateQuery(query) {
  if (query === undefined || query === null || query === '') return new URLSearchParams();
  if (typeof query !== 'string' || query.length > APP_NAVIGATE_QUERY_MAX || query.includes('#')) return null;
  return new URLSearchParams(query);
}

/** @description The open application's screen a tool id names: the tile itself, or for a suite the member
 * tile `<member>--<tool>`; when several members offer that tool, the sender's own member.
 * @param {object[]} tiles The profile's tiles.
 * @param {string} tool The requested tool id.
 * @param {string} senderUrl The sending frame's current location.
 * @returns {object|null} The tile to open, or null when the profile has no such local screen. */
function appNavigateTile(tiles, tool, senderUrl) {
  const local = (Array.isArray(tiles) ? tiles : [])
    .filter(tile => tile && typeof tile.toolName === 'string' && localAppUrl(tile.iframeUrl));
  const exact = local.find(tile => tile.toolName === tool);
  if (exact) return exact;
  const members = local.filter(tile => tile.toolName.endsWith(`--${tool}`));
  if (members.length <= 1) return members[0] || null;
  const sender = local.find(tile => tile.toolName.includes('--') && samePath(tile.iframeUrl, senderUrl));
  const member = sender ? sender.toolName.slice(0, sender.toolName.indexOf('--') + 2) : '';
  return member ? members.find(tile => tile.toolName.startsWith(member)) || null : null;
}

function samePath(left, right) {
  try {
    const a = new URL(left, location.origin);
    const b = new URL(right, location.origin);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch (error) {
    return false;
  }
}

/** @description The tile's own local route with the requested parameters appended; the tile's declared
 * parameters stay first, so a requested duplicate never replaces them.
 * @param {object} tile The resolved tile.
 * @param {URLSearchParams} params The sanitized requested parameters.
 * @returns {string} A local route. */
function appNavigateUrl(tile, params) {
  const url = new URL(localAppUrl(tile.iframeUrl), location.origin);
  for (const [key, value] of params) url.searchParams.append(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** @description The open application's profile, read fresh so a revoked or reloaded screen is never opened.
 * @param {string} name The open application.
 * @returns {Promise<object>} The admitted profile; throws otherwise. */
async function appNavigateProfile(name) {
  const response = await fetch(`/api/ui/profile?name=${encodeURIComponent(name)}`, {
    headers: getAuthHeaders(), credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Could not check the application's screens (${response.status}).`);
  const profile = await response.json();
  if (!profile || profile.planAdmission !== 'granted') throw new Error('Application access or a required component is unavailable.');
  return profile;
}

/** @description Move the application frame to the sibling screen a packaged screen asked for with the
 * `{type:'app-navigate', tool, query?}` dialect. Only a tile of the open application's current profile
 * opens; an unknown tool, a malformed query, or a sender that has since navigated away is ignored.
 * @param {object} binding The frame binding the request arrived on.
 * @param {object} data The `app-navigate` message.
 * @returns {Promise<void>} */
async function answerAppNavigate(binding, data) {
  const started = performance.now();
  handoffLog('info', 'app_navigate_start', started);
  const params = appNavigateQuery(data.query);
  const app = activeAppName;
  try {
    if (typeof data.tool !== 'string' || !APP_NAVIGATE_TOOL.test(data.tool) || !params) throw new Error('Malformed app-navigate request.');
    if (!app) throw new Error('No application is open.');
    const senderUrl = frameLocation(binding.frame);
    const profile = await appNavigateProfile(app);
    if (!binding.active || activeAppName !== app || frameLocation(binding.frame) !== senderUrl) {
      return handoffLog('info', 'app_navigate_superseded', started);
    }
    const tile = appNavigateTile(profile.tiles, data.tool, senderUrl);
    if (!tile) throw new Error(`${app} has no screen named ${data.tool}.`);
    navigateAppTile(appNavigateUrl(tile, params), tile.toolName);
    handoffLog('info', 'app_navigate_complete', started);
  } catch (error) {
    handoffLog('error', 'app_navigate_refused', started, error);
  }
}

/** @description Listen for connected-action requests and in-application navigation from exactly this
 * frame's current page, replacing any earlier binding.
 * @param {HTMLIFrameElement} frame The application frame.
 * @returns {() => void} Disposes the binding. */
function bindShellHandoffs(frame) {
  disposeShellHandoffs();
  const binding = { frame, active: true, busy: false };
  binding.listener = event => {
    const data = event.data;
    if (!binding.active || !frame.contentWindow || event.source !== frame.contentWindow
      || event.origin !== location.origin || !data || typeof data !== 'object') return;
    if (data.type === 'oshal:request-app-context') void answerShellHandoff(binding, event);
    else if (data.type === 'app-navigate') void answerAppNavigate(binding, data);
  };
  window.addEventListener('message', binding.listener);
  shellHandoffBinding = binding;
  return disposeShellHandoffs;
}

/** @description Stop answering for the previous frame page.
 * @returns {void} */
function disposeShellHandoffs() {
  const binding = shellHandoffBinding;
  shellHandoffBinding = null;
  if (!binding) return;
  binding.active = false;
  window.removeEventListener('message', binding.listener);
}

window.bindShellHandoffs = bindShellHandoffs;
window.deliverShellHandoff = deliverShellHandoff;
