/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0: the routes of the Lists application, mounted at /api/lists. The screen and the concierge's tools call the same routes. Reads are GETs and write nothing (the native kernel admits a GET read-only); every change is a POST whose body names the list, and the item, by id or by the words a person uses, so no name ever travels in an address. The caller is the signed-in person and nobody else. A failure of the store answers 503 in words. The page and its two files are served from tools/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ListsService } from './lists-service.mjs';

const require = createRequire(import.meta.url);
const { Router } = require('express');

/** The files of the screen a browser may ask for, with their media types. */
const FILES = new Map([
  ['lists.css', 'text/css; charset=utf-8'],
  ['lists.js', 'text/javascript; charset=utf-8'],
]);
const UNAVAILABLE = { error: 'lists_unavailable', message: 'Your lists cannot be reached right now. Try again in a moment.' };

/** @description The kernel's structured logger when the package runs on a kernel, else one JSON line on stderr. @returns {{error: Function}} A logger. */
function logger() {
  try { return require('@/shared/logger').createChildLogger({ module: 'lists.routes' }); } catch {
    return { error: (fields, message) => { if (process.env.LISTS_QUIET_LOG !== '1') process.stderr.write(JSON.stringify({ level: 'error', module: 'lists.routes', msg: message, err: String(fields && fields.err && fields.err.message) }) + '\n'); } };
  }
}

/** @description The signed-in person, or null after answering 401. @param {object} req The request. @param {object} res The response. @returns {string|null} Their subject. */
function caller(req, res) {
  const sub = req.oidc && req.oidc.user && req.oidc.user.sub;
  if (!sub || typeof req.oidc.isAuthenticated !== 'function' || req.oidc.isAuthenticated() !== true) {
    res.status(401).json({ error: 'not_authenticated', message: 'Sign in to see your lists.' });
    return null;
  }
  return String(sub);
}

/** @description A request's JSON body as an object. @param {object} req The request. @returns {object} The body, or an empty object. */
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

/**
 * @description One action for the signed-in person: its status and body, or 503 in words when the store fails.
 * @param {{error: Function}} log The logger. @param {(sub: string, req: object) => Promise<{status: number, body: object}>} run The action.
 * @returns {(req: object, res: object) => Promise<void>} The route handler.
 */
function action(log, run) {
  return async (req, res) => {
    const sub = caller(req, res);
    if (!sub) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const out = await run(sub, req);
      res.status(out.status).json(out.body);
    } catch (err) {
      log.error({ err }, 'a Lists action failed');
      res.status(503).json(UNAVAILABLE);
    }
  };
}

/** @description Serve the screen and its two files from the package's tools folder. @param {object} router The router. @param {string} tools The folder. @returns {void} */
function pageRoutes(router, tools) {
  router.get('/app', (req, res) => {
    if (!caller(req, res)) return;
    res.status(200).type('text/html; charset=utf-8').send(fs.readFileSync(path.join(tools, 'lists.html'), 'utf8'));
  });
  router.get('/static/:file', (req, res) => {
    const type = FILES.get(String(req.params.file));
    if (!type) { res.status(404).json({ error: 'not_found' }); return; }
    res.status(200).type(type).send(fs.readFileSync(path.join(tools, String(req.params.file)), 'utf8'));
  });
}

/**
 * @description The Lists routes.
 * @param {{pool: object, appPackageDir?: string}} ctx The package context: its pool and its installed folder.
 * @param {{now?: () => Date, id?: () => string}} [seams] A clock and an id maker, for tests.
 * @returns {import('express').Router} The router, mounted at /api/lists.
 */
export function createListsRoutes(ctx, seams = {}) {
  const router = Router();
  const log = logger();
  const service = new ListsService({ pool: ctx.pool, ...seams });
  // The package folder is taken when the routes are made, never from a request.
  pageRoutes(router, path.join(ctx.appPackageDir ? fs.realpathSync(ctx.appPackageDir) : path.resolve(import.meta.dirname, '..'), 'tools'));
  const on = (run) => action(log, run);

  router.get('/lists', on((sub) => service.all(sub)));
  router.get('/show', on((sub, req) => service.show(sub, req.query && req.query.list)));
  router.post('/lists', on((sub, req) => service.create(sub, body(req))));
  router.post('/rename', on((sub, req) => service.rename(sub, body(req))));
  router.post('/delete', on((sub, req) => service.remove(sub, body(req))));
  router.post('/clear-done', on((sub, req) => service.clearDone(sub, body(req))));
  router.post('/items/add', on((sub, req) => service.addItems(sub, body(req))));
  router.post('/items/check', on((sub, req) => service.setDone(sub, body(req), true)));
  router.post('/items/uncheck', on((sub, req) => service.setDone(sub, body(req), false)));
  router.post('/items/edit', on((sub, req) => service.editItem(sub, body(req))));
  router.post('/items/move', on((sub, req) => service.moveItem(sub, body(req))));
  router.post('/items/remove', on((sub, req) => service.removeItem(sub, body(req))));
  return router;
}
