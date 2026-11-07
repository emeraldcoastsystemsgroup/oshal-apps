/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: owner-scoped session routes under /api/phone-control/sessions for preferences (pointer mode, quality, lock-on-end, active monitor), chat messages, whiteboard strokes, saved screenshots/recordings, and file transfer records.
 */

'use strict';

const path = require('node:path');

let createRouter;
try {
  createRouter = require('express').Router;
} catch {
  createRouter = require('../lib/router.js').createRouter;
}

function refuse(res, error) {
  if (!error.status) throw error;
  return res.status(error.status).json({ error: error.code, message: error.message });
}

const qTarget = (req) => req.query?.target || req.query?.targetKey;

function mountPreferencesAndChat(router, sessionStore, db) {
  router.get('/preferences', (req, res) => {
    try {
      const target = qTarget(req);
      const list = sessionStore.listPreferences(db, req.owner, target);
      return target ? res.json({ preference: list[0], preferences: list[0] }) : res.json({ preferences: list });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.post('/preferences', (req, res) => {
    try {
      const preference = sessionStore.savePreference(db, req.owner, req.body || {});
      return res.json({ preference, preferences: preference });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.get('/chat', (req, res) => {
    try {
      return res.json({ messages: sessionStore.listChat(db, req.owner, qTarget(req)) });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.post('/chat', (req, res) => {
    try {
      return res.status(201).json({ message: sessionStore.addChat(db, req.owner, req.body || {}) });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.delete('/chat', (req, res) => {
    try {
      return res.json({ cleared: sessionStore.clearChat(db, req.owner, qTarget(req)) });
    } catch (error) {
      return refuse(res, error);
    }
  });
}

function mountWhiteboardRoutes(router, sessionStore, db) {
  router.get('/whiteboard', (req, res) => {
    try {
      const strokes = sessionStore.listWhiteboard(db, req.owner, qTarget(req));
      return res.json({ strokes, whiteboard: { strokes } });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.post('/whiteboard', (req, res) => {
    try {
      if (Array.isArray(req.body?.strokes)) {
        const strokes = sessionStore.replaceWhiteboard(db, req.owner, req.body);
        return res.json({ strokes, whiteboard: { strokes } });
      }
      return res.status(201).json({ stroke: sessionStore.addWhiteboard(db, req.owner, req.body || {}) });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.delete('/whiteboard', (req, res) => {
    try {
      return res.json({ cleared: sessionStore.clearWhiteboard(db, req.owner, qTarget(req)) });
    } catch (error) {
      return refuse(res, error);
    }
  });
}

function mountCapturesRoutes(router, sessionStore, db) {
  router.get('/captures', (req, res) => {
    try {
      return res.json({ captures: sessionStore.listCaptures(db, req.owner, { target: qTarget(req), kind: req.query?.kind }) });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.post('/captures', (req, res) => {
    try {
      return res.status(201).json({ capture: sessionStore.saveCapture(db, req.owner, req.body || {}) });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.get('/captures/:id', (req, res) => {
    const found = sessionStore.readCaptureBytes(db, req.owner, req.params.id);
    if (!found) return res.status(404).json({ error: 'capture_not_found' });
    res.setHeader('Content-Type', found.capture.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${found.capture.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(found.bytes);
  });
  router.delete('/captures/:id', (req, res) => (sessionStore.deleteCapture(db, req.owner, req.params.id)
    ? res.status(204).end()
    : res.status(404).json({ error: 'capture_not_found' })));
}

function mountTransfersRoutes(router, sessionStore, db) {
  router.get('/transfers', (req, res) => {
    try {
      return res.json({ transfers: sessionStore.listTransfers(db, req.owner, qTarget(req)) });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.post('/transfers', (req, res) => {
    try {
      return res.status(201).json({ transfer: sessionStore.saveTransfer(db, req.owner, req.body || {}) });
    } catch (error) {
      return refuse(res, error);
    }
  });
  router.get('/transfers/:id', (req, res) => {
    const found = sessionStore.readTransferBytes(db, req.owner, req.params.id);
    if (!found) return res.status(404).json({ error: 'transfer_not_found' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${found.transfer.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(found.bytes);
  });
  router.delete('/transfers/:id', (req, res) => (sessionStore.deleteTransfer(db, req.owner, req.params.id)
    ? res.status(204).end()
    : res.status(404).json({ error: 'transfer_not_found' })));
}

function createPhoneControlSessionRoutes(ctx) {
  const router = createRouter();
  const pkgDir = ctx?.appPackageDir || path.resolve(__dirname, '..');
  const store = require(path.join(pkgDir, 'lib', 'db.js'));
  const sessionStore = require(path.join(pkgDir, 'lib', 'session-store.js'));
  const db = ctx?.db || store.getDatabase();
  mountPreferencesAndChat(router, sessionStore, db);
  mountWhiteboardRoutes(router, sessionStore, db);
  mountCapturesRoutes(router, sessionStore, db);
  mountTransfersRoutes(router, sessionStore, db);
  return router;
}

module.exports = { createPhoneControlSessionRoutes };
