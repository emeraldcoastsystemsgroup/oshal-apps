/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Execution routes, UI surface delivery, query-free Cockpit launcher, CAS screen frames, and Concierge action handlers for Phone & Device Control.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0, every control real or removed. This server keeps the person's phone records, the history of what the page sent and what the computer answered, and each computer's last bridge report; it serves the pages and the bridge files. It never reaches a phone, a radio or a network: the page sends each command to the person's own computer through the kernel's /api/computers. Removed with the made-up behaviour behind them: the drawn screen, the operations batch, frame ingest, the keyword concierge, the screenshot import, the control contract, the bearer fallback and the starter devices.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: mount owner-scoped /sessions and /concierge routes (preferences, chat, whiteboard, saved captures, transfers, and specialized Phone & Connection Concierge turns) and serve modular session scripts (phone-concierge.js, session-computer.js, session-media.js, session-collab.js).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2: add POST /provision (phone-provision tool) for one-click and Jarvis zero-touch ADB APK push & auto-sign-in over the enrolled Linux computer.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2: allow POST /devices (phone-control-register-device) to auto-resolve computerNodeId from the owner's computer reports or existing devices when omitted, default platform/form, normalize bare Android IPv4 addresses to :5555, and add POST /devices/:id/execute (phone-control-execute-device) for single-step and multi-step Swarm device control.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: a device registered without computerNodeId resolves to one of the caller's own computers (their bridge reports, then their saved devices) or is refused with words (400 computer_required); the fixed fallback computer id, one person's own computer, is gone. The serial refusal's example address is a neutral one.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.6.0: serve phone-home.js, the first screen's tree and details.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.7.0 (T45 part 3; Roger, 2026-11-11: "deep links that open the actual film on the TV"): POST /devices/:id/open-link plans a link opened on a saved Android or Fire TV, in the named streaming app (netflix, prime, disney, max, hulu, youtube), from the TV's own computer through lan-control launch_url, which wakes the TV first.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | 1.9.0 (T45 part 2; Roger, 2026-11-10: "plays it on any device in his connected devices"): open-link takes app oshal for a Marquee page (its own page or a #/ screen of letters, digits, / _ and -), which the TV's oshal app opens in the person's own session; any other address with app oshal is refused in words.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | 1.11.0 (T80; Roger, 2026-11-12: "make it do that"): POST /devices/:id/play plans lan-control play_title on a saved Android or Fire TV: a show or film by its name in Prime Video (the app\'s search, the matching result, Resume or Play), answered with what the TV says is playing.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | 1.12.0 (T79, the device inventory, first slice): POST /devices/:id/apps plans lan-control tv_apps on a saved Android or Fire TV: which streaming apps it has (netflix, prime, disney, max, hulu, youtube and the oshal TV app), read from its package list through the bridge's closed list without pressing anything, so Jarvis can say what the TV can play and pick the app.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | 1.13.0 (T79, the device inventory): the What a TV can play plan names the TV's own computer (`computer`), so the kernel's computer.run_plan runs it there, and its next step says to record the computer's answer with phone-control-tv-apps-record; POST /devices/:id/apps/record (phone-control-inventory.js) keeps that answer against the TV and in the person's device inventory.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (T83): POST /provision never names a fixed installation. Until now a caller that sent no serverUrl (the phone-provision tool, as Jarvis calls it) got one installation's public address written into the plan, so on any other installation the person's TV would be sent to a server that is not theirs. The server is now what the caller sent, else what the kernel says this installation's public origin is (x-oshal-public-origin, which the kernel puts on a tool call and an approved action and never forwards from a browser), else the public host name the request arrived on as https (the kernel ends TLS and hands the package protocol http, so the request's protocol is never read); when none of these is known the route answers 400 server_required in words and plans nothing.
 * 14 | maintainer@emeraldcoastsystemsgroup.com | Device and TV plans explicitly remain unexecuted and leave execution history to actual computer outcomes.
 * 15 | maintainer@emeraldcoastsystemsgroup.com | TV link/show plans name their saved computer for the existing closed one-use runner; planning alone remains unexecuted.
 * 16 | maintainer@emeraldcoastsystemsgroup.com | Mount closed native saved-relay routes behind the existing verified-owner middleware, separately from Linux bridge plans.
 * 17 | maintainer@emeraldcoastsystemsgroup.com | Mount the read-only remote-app operating packet behind the same verified-owner middleware.
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

let createRouter;
try {
  createRouter = require('express').Router;
} catch {
  createRouter = require('../lib/router.js').createRouter;
}

const ASSETS = Object.freeze({
  'phone-control.css': 'text/css; charset=utf-8',
  'phone-control.js': 'application/javascript; charset=utf-8',
  'computer-link.js': 'application/javascript; charset=utf-8',
  'phone-stage.js': 'application/javascript; charset=utf-8',
  'phone-home.js': 'application/javascript; charset=utf-8',
  'phone-setup.js': 'application/javascript; charset=utf-8',
  'phone-rdp.js': 'application/javascript; charset=utf-8',
  'phone-concierge.js': 'application/javascript; charset=utf-8',
  'session-computer.js': 'application/javascript; charset=utf-8',
  'session-media.js': 'application/javascript; charset=utf-8',
  'session-collab.js': 'application/javascript; charset=utf-8',
  'editor-handoff.mjs': 'application/javascript; charset=utf-8'
});

/**
 * @description Answer a store refusal in words, or let anything else reach the runner's error path.
 * @param {object} res The response.
 * @param {Error} error What went wrong.
 * @returns {object} The response.
 */
function refuse(res, error) {
  if (!error.status) throw error;
  return res.status(error.status).json({ error: error.code, message: error.message });
}

/**
 * @description Mount the page, its assets and the query-free launcher.
 * @param {object} router The router.
 * @param {string} toolsDir The page folder.
 * @returns {void}
 */
function mountPages(router, toolsDir) {
  router.get('/cockpit', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Phone &amp; Device Control</title></head>'
      + '<body><script>window.top.location.replace("/cockpit/?app=phone-control");</script>'
      + '<noscript><a href="/cockpit/?app=phone-control">Open Phone &amp; Device Control</a></noscript></body></html>');
  });
  router.get('/ui', (req, res) => res.sendFile(path.join(toolsDir, 'phone-control.html')));
  router.get('/ui/:asset', (req, res) => {
    const type = ASSETS[req.params.asset];
    if (!type) return res.status(404).json({ error: 'asset_not_found' });
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(path.join(toolsDir, req.params.asset));
  });
}

const BRIDGE_SCRIPT = '"$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py"';
const PLAN_ACTIONS = Object.freeze({
  screen: 'screen-info', move: 'pointer-move', click: 'pointer-click', tap: 'pointer-click',
  drag: 'pointer-drag', swipe: 'pointer-drag', type: 'keyboard-type', key: 'keyboard-key', calibrate: 'ble-calibrate'
});
const KEY_ALIASES = Object.freeze({
  DPAD_UP: 'UP', DPAD_DOWN: 'DOWN', DPAD_LEFT: 'LEFT', DPAD_RIGHT: 'RIGHT',
  DPAD_CENTER: 'OK', SELECT: 'OK', OK: 'OK', RETURN: 'ENTER', PLAYPAUSE: 'PLAY_PAUSE'
});
const COUNT_WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5 });
const RDP_ACTIONS = new Set(['click', 'drag', 'move', 'type', 'key', 'scroll', 'snapshot']);

function parseCoord(store, value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 16384) {
    throw store.refusal(400, `${field}_invalid`, `${field} must be a valid pixel coordinate.`);
  }
  return Math.round(parsed);
}

function normalizePlanKey(platform, rawKey) {
  const trimmed = String(rawKey || '').trim();
  const upper = trimmed.toUpperCase().replace(/-/g, '_');
  if (platform === 'android' && KEY_ALIASES[upper]) return KEY_ALIASES[upper];
  if (upper.startsWith('DPAD_')) {
    return platform === 'ios'
      ? ({ DPAD_UP: 'Up', DPAD_DOWN: 'Down', DPAD_LEFT: 'Left', DPAD_RIGHT: 'Right', DPAD_CENTER: 'Select' }[upper] || trimmed)
      : (KEY_ALIASES[upper] || trimmed);
  }
  return trimmed;
}

function buildRdpCommandPlan(store, body = {}) {
  const rdpSessionId = String(body.rdpSessionId || '').trim();
  if (!/^[A-Za-z0-9._:-]{3,96}$/.test(rdpSessionId)) {
    throw store.refusal(400, 'rdp_session_invalid', 'rdpSessionId must be a valid RDP session identifier.');
  }
  const action = String(body.action || '').trim().toLowerCase();
  if (!RDP_ACTIONS.has(action)) {
    throw store.refusal(400, 'action_invalid', 'action must be click, drag, move, type, key, scroll or snapshot.');
  }
  const payload = { action };
  if (action === 'click' || action === 'move') {
    payload.x = parseCoord(store, body.x, 'x');
    payload.y = parseCoord(store, body.y, 'y');
  } else if (action === 'drag') {
    payload.x1 = parseCoord(store, body.x1, 'x1'); payload.y1 = parseCoord(store, body.y1, 'y1');
    payload.x2 = parseCoord(store, body.x2, 'x2'); payload.y2 = parseCoord(store, body.y2, 'y2');
  } else if (action === 'type') {
    if (typeof body.text !== 'string' || !body.text || body.text.length > 300) {
      throw store.refusal(400, 'text_invalid', 'text must be 1 to 300 characters.');
    }
    payload.text = body.text;
    payload.enter = Boolean(body.enter);
  } else if (action === 'key') {
    if (typeof body.key !== 'string' || !body.key.trim() || body.key.length > 32) {
      throw store.refusal(400, 'key_invalid', 'key is required.');
    }
    payload.key = body.key.trim();
  } else if (action === 'scroll') {
    const amount = Number(body.amount ?? -3);
    if (!Number.isFinite(amount) || amount < -50 || amount > 50) {
      throw store.refusal(400, 'amount_invalid', 'amount must be between -50 and 50.');
    }
    payload.amount = Math.round(amount);
  }
  return {
    ok: true, rdpSessionId, action,
    endpoint: `/api/rdp/sessions/${encodeURIComponent(rdpSessionId)}/input`,
    method: 'POST', body: payload
  };
}

function buildDeviceCommandPlan(store, device, body = {}) {
  if (!device.controlEnabled) throw store.refusal(409, 'control_disabled', 'Control is turned off for this device.');
  const rawAction = String(body.action || '').trim().toLowerCase();
  const action = rawAction === 'tap' ? 'click' : rawAction === 'swipe' ? 'drag' : rawAction;
  const verb = PLAN_ACTIONS[action];
  if (!verb) throw store.refusal(400, 'action_invalid', 'action must be screen, move, click, drag, type, key or calibrate.');
  if (action === 'calibrate' && device.platform !== 'ios') {
    throw store.refusal(400, 'calibration_not_needed', 'Android devices use direct pixel coordinates without Bluetooth pointer calibration.');
  }
  const target = device.platform === 'android' ? { platform: 'android', serial: device.address } : { platform: 'ios', address: device.address };
  const args = action === 'calibrate' ? { address: device.address } : { ...target };
  const num = (v, field) => parseCoord(store, v, field);
  if (action === 'move' || action === 'click') { args.x = num(body.x, 'x'); args.y = num(body.y, 'y'); }
  if (action === 'drag') {
    args.x1 = num(body.x1, 'x1'); args.y1 = num(body.y1, 'y1'); args.x2 = num(body.x2, 'x2'); args.y2 = num(body.y2, 'y2');
    if (body.holdMs !== undefined) args.holdMs = num(body.holdMs, 'holdMs');
  }
  if (body.width !== undefined) args.width = num(body.width, 'width');
  if (body.height !== undefined) args.height = num(body.height, 'height');
  if (action === 'type') {
    if (typeof body.text !== 'string' || !body.text || body.text.length > 300) throw store.refusal(400, 'text_invalid', 'text must be 1 to 300 characters.');
    args.text = body.text; args.enter = Boolean(body.enter);
  }
  if (action === 'key') {
    if (typeof body.key !== 'string' || !body.key.trim() || body.key.length > 32) throw store.refusal(400, 'key_invalid', 'key is required.');
    args.key = normalizePlanKey(device.platform, body.key);
  }
  const b64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  return {
    ok: true, action, verb, args, computerNodeId: device.computerNodeId,
    device: { id: device.id, name: device.name, platform: device.platform, form: device.form, address: device.address },
    command: `python3 -I ${BRIDGE_SCRIPT} ${verb} --b64 ${b64}`
  };
}

function resolveDevice(store, db, owner, rawId) {
  const id = String(rawId || '').trim();
  const exact = store.getPhone(db, owner, id);
  if (exact) return exact;
  const phones = store.listPhones(db, owner);
  const lower = id.toLowerCase();
  const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return phones.find((p) => p.address.toLowerCase() === lower || p.address.toLowerCase() === `${lower}:5555`)
    || phones.find((p) => p.name.toLowerCase() === lower || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === slug)
    || (lower === 'tv' || lower === 'phone' ? phones.find((p) => p.form === lower) : null)
    || null;
}

function parsePromptSteps(promptText) {
  const clauses = String(promptText || '').trim().split(/\s*(?:,\s*(?:and\s+|then\s+)?|\b(?:and\s+then|then|and)\b)\s*/i).filter(Boolean);
  const steps = [];
  for (const clause of clauses) {
    const dir = /^(?:(?:move|go|press|step|cursor|dpad)\s+)?(up|down|left|right|dpad_up|dpad_down|dpad_left|dpad_right)(?:\s+(?:by\s+)?(one|two|three|four|five|\d+)(?:\s+(?:times?|steps?|rows?|items?))?)?$/i.exec(clause);
    if (dir) {
      const count = Math.max(1, Math.min(5, COUNT_WORDS[String(dir[2] || '').toLowerCase()] || Number(dir[2]) || 1));
      for (let i = 0; i < count && steps.length < 10; i += 1) steps.push({ action: 'key', key: dir[1].toUpperCase() });
      continue;
    }
    const key = /^(?:(?:press|hit|tap|click)\s+)?(select|ok|enter|dpad_center|back|home|menu|play\/pause|play|pause|escape|esc|tab)(?:\s+(?:it|that|this|item))?$/i.exec(clause);
    if (key && steps.length < 10) steps.push({ action: 'key', key: key[1].toUpperCase() });
  }
  return steps;
}

function executeDeviceSteps(store, db, owner, device, body = {}) {
  const fromPrompt = typeof body.prompt === 'string' && body.prompt.trim() ? parsePromptSteps(body.prompt) : [];
  const rawSteps = Array.isArray(body.steps) && body.steps.length ? body.steps : (fromPrompt.length ? fromPrompt : [body]);
  const plans = rawSteps.slice(0, 10).map((step) => buildDeviceCommandPlan(store, device, step || {}));
  const command = plans.map((p) => p.command).join(' && ');
  const mode = body.mode === 'background' ? 'background' : 'foreground';
  return {
    ok: true, planned: true, executed: false, status: 'planned', mode, computerNodeId: device.computerNodeId,
    device: plans[0].device, steps: plans, command,
    computerRunRequest: {
      endpoint: `/api/computers/${encodeURIComponent(device.computerNodeId)}/run`,
      method: 'POST', body: { tool: 'shell.exec', arguments: { command, timeout_ms: 45000 }, limit_ms: 50000 }
    }
  };
}

/** The streaming apps a link can be opened in on an Android or Fire TV (the bridge's oshal_phone_links.py). */
const STREAMING_APPS = Object.freeze(['netflix', 'prime', 'disney', 'max', 'hulu', 'youtube', 'oshal']);

/**
 * @description 1.7.0 (T45 part 3): the plan that opens a link on a saved Android or Fire TV, in the named streaming app
 * when one is named, from the TV's own computer (the bridge's lan-control launch_url, which wakes the TV first).
 * @param {object} store The store module. @param {object} db The store. @param {object} owner The caller.
 * @param {object} device The saved TV. @param {{url:string, app?:string}} body The link and its app.
 * @returns {object} The command and the computer run request that sends it.
 */
function openLinkPlan(store, db, owner, device, body = {}) {
  if (device.platform !== 'android' || device.form !== 'tv') throw store.refusal(400, 'not_android_tv', 'Links open on a saved Android or Fire TV.');
  if (!device.controlEnabled) throw store.refusal(409, 'control_disabled', 'Control is turned off for this device.');
  const url = String(body.url || '').trim();
  if (url.length > 256 || !/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~!$&()*+,;=:@%/?#-]*)?$/.test(url)) {
    throw store.refusal(400, 'url_invalid', 'Only an https address of at most 256 characters can be opened on a TV.');
  }
  const app = body.app === undefined || body.app === null || body.app === '' ? '' : String(body.app).toLowerCase();
  if (app && !STREAMING_APPS.includes(app)) throw store.refusal(400, 'app_invalid', `Name the streaming app: ${STREAMING_APPS.join(', ')}.`);
  if (app === 'oshal' && !/^https:\/\/[^/]+\/api\/free-library\/app(?:#\/[A-Za-z0-9/_-]*)?$/.test(url)) {
    throw store.refusal(400, 'url_invalid', 'The oshal TV app opens only Marquee\'s own page.');
  }
  const address = String(device.address || '').replace(/:\d+$/, '');
  const args = { kind: 'android-tv', address, action: 'launch_url', url, ...(app ? { app } : {}) };
  const command = `python3 -I ${BRIDGE_SCRIPT} lan-control --b64 ${Buffer.from(JSON.stringify(args), 'utf8').toString('base64')}`;
  return {
    ok: true, planned: true, executed: false, status: 'planned', verb: 'lan-control', args, command, computerNodeId: device.computerNodeId,
    computer: { id: device.computerNodeId },
    next: 'Planned, not executed. When computer.run_plan is offered, call it once with the planId this answer carries. '
      + 'It runs this exact command on the saved TV computer. Report only the actual reply; an unknown result is not success and must not be retried automatically.',
    device: { id: device.id, name: device.name, platform: device.platform, form: device.form, address: device.address },
    computerRunRequest: {
      endpoint: `/api/computers/${encodeURIComponent(device.computerNodeId)}/run`,
      method: 'POST', body: { tool: 'shell.exec', arguments: { command, timeout_ms: 45000 }, limit_ms: 50000 }
    }
  };
}

/**
 * @description 1.11.0 (T80; Roger, 2026-11-12: "hey jarvis in the game room open rings of power season 3 where i left off"):
 * the plan that plays a show or film by its name on a saved Android or Fire TV, from the TV's own computer (the bridge's
 * lan-control play_title: the app's search, the matching result, Resume or Play, then what the TV says is playing).
 * @param {object} store The store module. @param {object} db The store. @param {object} owner The caller.
 * @param {object} device The saved TV. @param {{title:string, app?:string}} body The show's name and its app (prime).
 * @returns {object} The command and the computer run request that sends it.
 */
function playShowPlan(store, db, owner, device, body = {}) {
  if (device.platform !== 'android' || device.form !== 'tv') throw store.refusal(400, 'not_android_tv', 'A show plays by name on a saved Android or Fire TV.');
  if (!device.controlEnabled) throw store.refusal(409, 'control_disabled', 'Control is turned off for this device.');
  const title = String(body.title || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 80) throw store.refusal(400, 'title_invalid', 'Name the show or film (2 to 80 characters).');
  const app = body.app === undefined || body.app === null || body.app === '' ? 'prime' : String(body.app).toLowerCase();
  if (!PLAY_APPS.includes(app)) throw store.refusal(400, 'app_invalid', `A show plays by name in ${PLAY_APPS.join(', ')} so far; for another app open its link.`);
  const address = String(device.address || '').replace(/:\d+$/, '');
  const args = { kind: 'android-tv', address, action: 'play_title', title, app };
  const command = `python3 -I ${BRIDGE_SCRIPT} lan-control --b64 ${Buffer.from(JSON.stringify(args), 'utf8').toString('base64')}`;
  return {
    ok: true, planned: true, executed: false, status: 'planned', verb: 'lan-control', args, command, computerNodeId: device.computerNodeId,
    computer: { id: device.computerNodeId },
    next: 'Planned, not executed. When computer.run_plan is offered, call it once with the planId this answer carries. '
      + 'It runs this exact command on the saved TV computer. Report only the actual reply; an unknown result is not success and must not be retried automatically.',
    device: { id: device.id, name: device.name, platform: device.platform, form: device.form, address: device.address },
    computerRunRequest: {
      endpoint: `/api/computers/${encodeURIComponent(device.computerNodeId)}/run`,
      method: 'POST', body: { tool: 'shell.exec', arguments: { command, timeout_ms: 55000 }, limit_ms: 60000 }
    }
  };
}

/** The apps a show plays in by its name (the bridge's oshal_phone_play.py). */
const PLAY_APPS = Object.freeze(['prime']);

/**
 * @description 1.12.0 (T79, the device inventory): the plan that reads which streaming apps a saved Android or Fire TV
 * has, from the TV's own computer (the bridge's lan-control tv_apps: the TV's package list once, mapped through a closed
 * list of known apps; every other package is only counted). It presses nothing on the TV, so it carries no body.
 * @param {object} store The store module. @param {object} db The store. @param {object} owner The caller.
 * @param {object} device The saved TV.
 * @returns {object} The command and the computer run request that sends it.
 */
function tvAppsPlan(store, db, owner, device) {
  if (device.platform !== 'android' || device.form !== 'tv') throw store.refusal(400, 'not_android_tv', 'Which streaming apps a TV has is read on a saved Android or Fire TV.');
  const address = String(device.address || '').replace(/:\d+$/, '');
  const args = { kind: 'android-tv', address, action: 'tv_apps' };
  const command = `python3 -I ${BRIDGE_SCRIPT} lan-control --b64 ${Buffer.from(JSON.stringify(args), 'utf8').toString('base64')}`;
  const next = 'Planned, not read yet. When computer.run_plan is offered, pass the planId this answer carries to computer.run_plan: '
    + 'the read runs at once on the TV\'s own computer, which this plan names. Then call phone-control-tv-apps-record with '
    + `${JSON.stringify({ id: device.id })} and "reply" set to the one JSON line the computer printed, and report what it answers. `
    + 'Without computer.run_plan or a planId nothing ran: say the read is planned, never that it was done.';
  return {
    ok: true, planned: true, executed: false, status: 'planned', verb: 'lan-control', args, command, computerNodeId: device.computerNodeId,
    computer: { id: device.computerNodeId }, next,
    device: { id: device.id, name: device.name, platform: device.platform, form: device.form, address: device.address },
    computerRunRequest: {
      endpoint: `/api/computers/${encodeURIComponent(device.computerNodeId)}/run`,
      method: 'POST', body: { tool: 'shell.exec', arguments: { command, timeout_ms: 45000 }, limit_ms: 50000 }
    }
  };
}

/** A web origin as the kernel declares its own: a scheme, a host and an optional port. */
const DECLARED_ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;
/** A host name with an optional port, ending in a top-level name of letters: never an IP address or a bare name. */
const NAMED_HOST = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,})(?::\d{1,5})?$/;
/** Endings a home network or a test gives a name: not a public address, so its scheme is not known. */
const PRIVATE_ENDINGS = new Set(['local', 'localhost', 'localdomain', 'lan', 'home', 'internal', 'test', 'invalid', 'example']);

/**
 * @description The address of the installation this request arrived on, for a device that is told where to sign in
 * and a caller that named no server. First what the kernel says its public origin is (x-oshal-public-origin: the
 * kernel puts it on a tool call and an approved action, and does not forward it from a browser). Else the public
 * host name the request arrived on, as https: the kernel ends TLS and hands the package protocol http, so the
 * request's own protocol is never read. Never a fixed address.
 * @param {object} req The request.
 * @returns {string} The origin, or '' when this installation's public address cannot be known.
 */
function installationOrigin(req) {
  const header = (name) => {
    const found = Object.entries(req?.headers || {}).find(([key]) => key.toLowerCase() === name);
    return String(found?.[1] ?? '').split(',')[0].trim();
  };
  const declared = header('x-oshal-public-origin').replace(/\/+$/, '');
  if (DECLARED_ORIGIN.test(declared)) return declared;
  const host = header('host').toLowerCase();
  const ending = NAMED_HOST.exec(host)?.[1];
  return ending && !PRIVATE_ENDINGS.has(ending) ? `https://${host}` : '';
}

function buildProvisionCommandPlan(store, db, owner, body = {}, installation = '') {
  const rawTarget = String(body.serialOrIp || body.serial || body.address || '').trim();
  if (!/^[A-Za-z0-9._:-]{3,96}$/.test(rawTarget)) {
    throw store.refusal(400, 'serial_invalid', 'Provide a valid TV/phone IP address or ADB serial (for example 192.168.1.42).');
  }
  const serial = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(rawTarget) ? `${rawTarget}:5555` : rawTarget;
  const reports = store.listComputerReports(db, owner);
  const phones = store.listPhones(db, owner);
  const computerNodeId = String(
    body.computerNodeId
    || phones.find((p) => p.address === serial)?.computerNodeId
    || reports[0]?.computerNodeId
    || ''
  ).trim();
  const serverUrl = String(body.serverUrl || '').trim() || installation;
  if (!serverUrl) {
    throw store.refusal(400, 'server_required', `Say which server this ${body.preferAndroid ? 'phone' : 'TV'} should connect to. `
      + 'This installation\'s public address is not known from here, so nothing was guessed: give serverUrl, the address you open oshal at.');
  }
  const joinCode = String(body.joinCode || body.bearerToken || '').trim();
  const args = {
    serial,
    stageId: 'local',
    preferAndroid: Boolean(body.preferAndroid),
    launchPackage: 'com.oshal.remote',
    serverUrl,
    ...(joinCode ? { joinCode } : {})
  };
  const b64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  return {
    ok: true,
    serial,
    computerNodeId: computerNodeId || null,
    verb: 'adb-install-apk',
    args,
    command: `adb connect ${serial} >/dev/null 2>&1 || true; python3 -I ${BRIDGE_SCRIPT} adb-install-apk --b64 ${b64}`
  };
}

/**
 * @description The computer that connects a device being registered without one: one of the caller's own computers,
 * from their bridge reports or their saved devices, or a refusal in words. Never another person's computer and never
 * a fixed id: a device must belong to a computer the person has used here.
 * @param {object} store The store module.
 * @param {object} db The store.
 * @param {object} owner The caller.
 * @returns {string} The computer id.
 */
function ownComputerNodeId(store, db, owner) {
  const node = store.listComputerReports(db, owner)[0]?.computerNodeId || store.listPhones(db, owner)[0]?.computerNodeId;
  if (node) return node;
  throw store.refusal(400, 'computer_required', 'Say which of your computers connects this device. None of your '
    + 'computers has used Phone & Device Control yet: open Phone & Device Control on a computer of yours with oshal Node '
    + 'signed in and press Set up this computer, then add the device again.');
}

function normalizeDeviceRegistration(store, db, owner, raw = {}) {
  const body = { ...(raw || {}) };
  if (body.computerNodeId === undefined || body.computerNodeId === null || body.computerNodeId === '') {
    body.computerNodeId = ownComputerNodeId(store, db, owner);
  }
  if (body.platform === undefined || body.platform === null || body.platform === '') {
    body.platform = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(String(body.address || '').trim()) ? 'ios' : 'android';
  }
  if (body.form === undefined || body.form === null || body.form === '') {
    body.form = /tv|fire|stick|shield|chromecast|bravia|roku/i.test(String(body.name || '')) ? 'tv' : 'phone';
  }
  if (body.platform === 'android' && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(body.address || '').trim())) {
    body.address = `${String(body.address).trim()}:5555`;
  }
  return body;
}

/**
 * @description Mount the phone records.
 * @param {object} router The router.
 * @param {object} store The store module.
 * @param {object} db The store.
 * @returns {void}
 */
function mountPhones(router, store, db) {
  router.get('/devices', (req, res) => res.json({ devices: store.listPhones(db, req.owner) }));
  router.post('/devices', (req, res) => {
    try {
      const normalized = normalizeDeviceRegistration(store, db, req.owner, req.body || {});
      const saved = store.savePhone(db, req.owner, normalized);
      const phone = typeof normalized.controlEnabled === 'boolean' && normalized.controlEnabled !== saved.phone.controlEnabled
        ? store.updatePhone(db, req.owner, saved.phone.id, { controlEnabled: normalized.controlEnabled })
        : saved.phone;
      return res.status(saved.created ? 201 : 200).json({ device: phone, created: saved.created });
    } catch (error) { return refuse(res, error); }
  });
  router.get('/devices/:id', (req, res) => {
    const device = resolveDevice(store, db, req.owner, req.params.id);
    if (!device) return res.status(404).json({ error: 'device_not_found' });
    return res.json({ device, history: store.listHistory(db, req.owner, { phoneId: device.id, limit: 25 }) });
  });
  router.post('/devices/:id/command-plan', (req, res) => {
    const device = resolveDevice(store, db, req.owner, req.params.id);
    if (!device) return res.status(404).json({ error: 'device_not_found' });
    try { return res.json(buildDeviceCommandPlan(store, device, req.body || {})); } catch (error) { return refuse(res, error); }
  });
  router.post('/devices/:id/execute', (req, res) => {
    const device = resolveDevice(store, db, req.owner, req.params.id);
    if (!device) return res.status(404).json({ error: 'device_not_found' });
    try { return res.json(executeDeviceSteps(store, db, req.owner, device, req.body || {})); } catch (error) { return refuse(res, error); }
  });
  router.post('/devices/:id/open-link', (req, res) => {
    const device = resolveDevice(store, db, req.owner, req.params.id);
    if (!device) return res.status(404).json({ error: 'device_not_found' });
    try { return res.json(openLinkPlan(store, db, req.owner, device, req.body || {})); } catch (error) { return refuse(res, error); }
  });
  router.post('/devices/:id/play', (req, res) => {
    const device = resolveDevice(store, db, req.owner, req.params.id);
    if (!device) return res.status(404).json({ error: 'device_not_found' });
    try { return res.json(playShowPlan(store, db, req.owner, device, req.body || {})); } catch (error) { return refuse(res, error); }
  });
  router.post('/devices/:id/apps', (req, res) => {
    const device = resolveDevice(store, db, req.owner, req.params.id);
    if (!device) return res.status(404).json({ error: 'device_not_found' });
    try { return res.json(tvAppsPlan(store, db, req.owner, device)); } catch (error) { return refuse(res, error); }
  });
  router.post('/rdp/command-plan', (req, res) => {
    try { return res.json(buildRdpCommandPlan(store, req.body || {})); } catch (error) { return refuse(res, error); }
  });
  router.post('/provision', (req, res) => {
    try { return res.json(buildProvisionCommandPlan(store, db, req.owner, req.body || {}, installationOrigin(req))); } catch (error) { return refuse(res, error); }
  });
  router.post('/devices/:id', (req, res) => {
    const target = resolveDevice(store, db, req.owner, req.params.id);
    try {
      const device = store.updatePhone(db, req.owner, target?.id || req.params.id, req.body || {});
      return device ? res.json({ device }) : res.status(404).json({ error: 'device_not_found' });
    } catch (error) { return refuse(res, error); }
  });
  router.delete('/devices/:id', (req, res) => (store.deletePhone(db, req.owner, req.params.id)
    ? res.status(204).end()
    : res.status(404).json({ error: 'device_not_found' })));
}

/**
 * @description Mount the history and the bridge reports.
 * @param {object} router The router.
 * @param {object} store The store module.
 * @param {object} db The store.
 * @returns {void}
 */
function mountRecords(router, store, db) {
  router.get('/history', (req, res) => res.json({
    history: store.listHistory(db, req.owner, { phoneId: req.query?.deviceId, limit: req.query?.limit })
  }));
  router.post('/history', (req, res) => {
    try {
      return res.status(201).json({ event: store.recordHistory(db, req.owner, req.body || {}) });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.get('/computers/reports', (req, res) => res.json({ reports: store.listComputerReports(db, req.owner) }));
  router.post('/computers/:node/report', (req, res) => {
    try {
      return res.json(store.saveComputerReport(db, req.owner, req.params.node, req.body?.report));
    } catch (error) {
      return refuse(res, error);
    }
  });
}

/**
 * @description Mount the bridge files: their manifest (what the page installs) and each file to read.
 * @param {object} router The router.
 * @param {object} files The bridge-files module.
 * @param {string} pkgDir The package folder.
 * @returns {void}
 */
function mountBridge(router, files, pkgDir) {
  router.get('/bridge/manifest.json', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(files.bridgeManifest(pkgDir));
  });
  router.get('/bridge/files/:file', (req, res) => {
    const bytes = files.bridgeFile(pkgDir, req.params.file);
    if (!bytes) return res.status(404).json({ error: 'bridge_file_not_found' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(bytes.toString('utf8'));
  });
}

/**
 * @description The package's routes under /api/phone-control.
 * @param {object} ctx The package context from the kernel's runner.
 * @returns {object} The router.
 */
function createPhoneControlRoutes(ctx) {
  const router = createRouter();
  const pkgDir = ctx?.appPackageDir || path.resolve(__dirname, '..');
  const toolsDir = path.join(pkgDir, 'tools');
  const store = require(path.join(pkgDir, 'lib', 'db.js'));
  const files = require(path.join(pkgDir, 'lib', 'bridge-files.js'));
  const { registerPhoneControlAuthorization, requireOwner } = require(path.join(pkgDir, 'lib', 'security.js'));
  const { createHomeSummaryRoutes } = require(path.join(pkgDir, 'routes', 'home-summary.js'));
  const { createPhoneControlConfigRoutes } = require(path.join(pkgDir, 'routes', 'phone-control-config-routes.js'));
  const { createPhoneControlSessionRoutes } = require(path.join(pkgDir, 'routes', 'phone-control-session-routes.js'));
  const { createPhoneControlConciergeRoutes } = require(path.join(pkgDir, 'routes', 'phone-control-concierge-routes.js'));
  if (!fs.existsSync(path.join(toolsDir, 'phone-control.html'))) throw new Error('phone-control page is missing');
  registerPhoneControlAuthorization(ctx?.authorization);
  const db = ctx?.db || store.getDatabase();
  router.use(requireOwner(ctx));
  router.use('/home-summary', createHomeSummaryRoutes({ ...ctx, appPackageDir: pkgDir, db }));
  router.use('/config', createPhoneControlConfigRoutes({ ...ctx, appPackageDir: pkgDir }));
  router.use('/sessions', createPhoneControlSessionRoutes({ ...ctx, appPackageDir: pkgDir, db }));
  router.use('/concierge', createPhoneControlConciergeRoutes({ ...ctx, appPackageDir: pkgDir, db }));
  require(path.join(pkgDir, 'routes', 'phone-control-relay-routes.js')).mountNativeRelay(router, ctx);
  require(path.join(pkgDir, 'routes', 'phone-control-remote-guides.js')).mountRemoteGuides(router);
  mountPages(router, toolsDir);
  mountPhones(router, store, db);
  require(path.join(pkgDir, 'routes', 'phone-control-inventory.js')).mountInventory(router, { store, db, ctx, resolveDevice, refuse });
  mountRecords(router, store, db);
  mountBridge(router, files, pkgDir);
  return router;
}

module.exports = { createPhoneControlRoutes };
