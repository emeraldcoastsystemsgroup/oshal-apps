/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Execution routes, UI surface delivery, query-free Cockpit launcher, CAS screen frames, and Concierge action handlers for Phone & Device Control.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0, every control real or removed. This server keeps the person's phone records, the history of what the page sent and what the computer answered, and each computer's last bridge report; it serves the pages and the bridge files. It never reaches a phone, a radio or a network: the page sends each command to the person's own computer through the kernel's /api/computers. Removed with the made-up behaviour behind them: the drawn screen, the operations batch, frame ingest, the keyword concierge, the screenshot import, the control contract, the bearer fallback and the starter devices.
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
  if (!fs.existsSync(path.join(toolsDir, 'phone-control.html'))) throw new Error('phone-control page is missing');
  registerPhoneControlAuthorization(ctx?.authorization);
  const db = ctx?.db || store.getDatabase();
  router.use(requireOwner(ctx));
  router.use('/home-summary', createHomeSummaryRoutes({ ...ctx, appPackageDir: pkgDir, db }));
  router.use('/config', createPhoneControlConfigRoutes({ ...ctx, appPackageDir: pkgDir }));
  mountPages(router, toolsDir);
  mountPhones(router, store, db);
  mountRecords(router, store, db);
  mountBridge(router, files, pkgDir);
  return router;
}

module.exports = { createPhoneControlRoutes };
