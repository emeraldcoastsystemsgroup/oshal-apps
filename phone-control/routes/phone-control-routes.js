/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Execution routes, UI surface delivery, query-free Cockpit launcher, CAS screen frames, and Concierge action handlers for Phone & Device Control.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0, every control real or removed. This server keeps the person's phone records, the history of what the page sent and what the computer answered, and each computer's last bridge report; it serves the pages and the bridge files. It never reaches a phone, a radio or a network: the page sends each command to the person's own computer through the kernel's /api/computers. Removed with the made-up behaviour behind them: the drawn screen, the operations batch, frame ingest, the keyword concierge, the screenshot import, the control contract, the bearer fallback and the starter devices.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: mount owner-scoped /sessions and /concierge routes (preferences, chat, whiteboard, saved captures, transfers, and specialized Phone & Connection Concierge turns) and serve modular session scripts (phone-concierge.js, session-computer.js, session-media.js, session-collab.js).
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
  screen: 'screen-info', move: 'pointer-move', click: 'pointer-click',
  drag: 'pointer-drag', type: 'keyboard-type', key: 'keyboard-key', calibrate: 'ble-calibrate'
});
const RDP_ACTIONS = new Set(['click', 'drag', 'move', 'type', 'key', 'scroll', 'snapshot']);

function parseCoord(store, value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 16384) {
    throw store.refusal(400, `${field}_invalid`, `${field} must be a valid pixel coordinate.`);
  }
  return Math.round(parsed);
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
  const action = String(body.action || '').trim().toLowerCase();
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
    args.key = body.key.trim();
  }
  const b64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  return {
    ok: true, action, verb, args, computerNodeId: device.computerNodeId,
    device: { id: device.id, name: device.name, platform: device.platform, form: device.form, address: device.address },
    command: `python3 -I ${BRIDGE_SCRIPT} ${verb} --b64 ${b64}`
  };
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
      const saved = store.savePhone(db, req.owner, req.body || {});
      return res.status(saved.created ? 201 : 200).json({ device: saved.phone, created: saved.created });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.get('/devices/:id', (req, res) => {
    const device = store.getPhone(db, req.owner, req.params.id);
    if (!device) return res.status(404).json({ error: 'device_not_found' });
    return res.json({ device, history: store.listHistory(db, req.owner, { phoneId: device.id, limit: 25 }) });
  });
  router.post('/devices/:id/command-plan', (req, res) => {
    const device = store.getPhone(db, req.owner, req.params.id);
    if (!device) return res.status(404).json({ error: 'device_not_found' });
    try {
      return res.json(buildDeviceCommandPlan(store, device, req.body || {}));
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.post('/rdp/command-plan', (req, res) => {
    try {
      return res.json(buildRdpCommandPlan(store, req.body || {}));
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.post('/devices/:id', (req, res) => {
    try {
      const device = store.updatePhone(db, req.owner, req.params.id, req.body || {});
      return device ? res.json({ device }) : res.status(404).json({ error: 'device_not_found' });
    } catch (error) {
      return refuse(res, error);
    }
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
  mountPages(router, toolsDir);
  mountPhones(router, store, db);
  mountRecords(router, store, db);
  mountBridge(router, files, pkgDir);
  return router;
}

module.exports = { createPhoneControlRoutes };
