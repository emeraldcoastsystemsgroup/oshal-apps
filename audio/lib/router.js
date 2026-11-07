/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Zero-dependency Express-compatible router for Audio Studio standalone and bridge test harnesses.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Decompose request dispatch and response helpers below 50 lines per function and add .mjs/.svg MIME types.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STATIC_MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function attachResponseHelpers(res) {
  if (!res.status) {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.type) {
    res.type = (mime) => {
      res.setHeader('Content-Type', mime);
      return res;
    };
  }
  if (!res.json) {
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
  }
  if (!res.send) {
    res.send = (data) => {
      if (data && typeof data === 'object' && !Buffer.isBuffer(data)) return res.json(data);
      res.end(data);
    };
  }
  if (!res.sendFile) {
    res.sendFile = (filePath) => {
      if (!fs.existsSync(filePath)) {
        res.statusCode = 404;
        return res.end('Not Found');
      }
      const mime = STATIC_MIMES[path.extname(filePath)];
      if (mime) res.setHeader('Content-Type', mime);
      fs.createReadStream(filePath).pipe(res);
    };
  }
}

function invokeHandlers(handlers, req, res, done) {
  let idx = 0;
  const step = (err) => {
    if (err) return done(err);
    if (idx >= handlers.length) return done();
    const fn = handlers[idx++];
    try {
      const ret = fn.length >= 3 ? fn(req, res, step) : fn(req, res);
      if (ret && typeof ret.catch === 'function') ret.catch(done);
    } catch (caught) {
      done(caught);
    }
  };
  step();
}

class MiniRouter {
  constructor() {
    this.routes = [];
  }

  use(...args) {
    if (args.length === 1 && typeof args[0] === 'function') {
      this.routes.push({ method: null, prefix: null, regex: null, paramNames: [], handlers: [args[0]] });
      return;
    }
    if (args.length >= 2 && typeof args[0] === 'string' && args[1]?.handle) {
      const prefix = args[0].replace(/\/+$/, '');
      const sub = args[1];
      this.routes.push({
        method: null,
        prefix,
        handler: (req, res, next) => {
          if (req.url === prefix || req.url.startsWith(`${prefix}/`) || req.url.startsWith(`${prefix}?`)) {
            const origUrl = req.url;
            req.url = req.url.slice(prefix.length) || '/';
            sub.handle(req, res, () => {
              req.url = origUrl;
              next();
            });
          } else {
            next();
          }
        },
      });
    }
  }

  get(pathStr, ...handlers) { this.addRoute('GET', pathStr, handlers); }
  post(pathStr, ...handlers) { this.addRoute('POST', pathStr, handlers); }
  put(pathStr, ...handlers) { this.addRoute('PUT', pathStr, handlers); }
  delete(pathStr, ...handlers) { this.addRoute('DELETE', pathStr, handlers); }

  addRoute(method, pathStr, handlers) {
    const paramNames = [];
    const clean = pathStr === '/' ? '' : pathStr;
    const pattern = clean
      ? clean.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
          paramNames.push(name);
          return '([^/]+)';
        })
      : '';
    this.routes.push({
      method,
      pathStr,
      regex: new RegExp(`^${pattern}/?$`),
      paramNames,
      handlers: handlers.flat(),
    });
  }

  dispatch(req, res, finalNext) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    req.path = parsedUrl.pathname;
    req.query = req.query || Object.fromEntries(parsedUrl.searchParams.entries());
    let cursor = 0;
    const next = (err) => {
      if (err) {
        res.statusCode = err.status || 500;
        return res.json({ error: err.code || 'internal_server_error', message: err.message });
      }
      if (cursor >= this.routes.length) {
        if (finalNext) return finalNext();
        res.statusCode = 404;
        return res.json({ error: 'not_found' });
      }
      const route = this.routes[cursor++];
      if (route.prefix) return route.handler(req, res, next);
      if (route.method && route.method !== req.method) return next();
      if (route.regex) {
        const match = req.path.match(route.regex);
        if (!match) return next();
        req.params = {};
        route.paramNames.forEach((name, idx) => { req.params[name] = decodeURIComponent(match[idx + 1]); });
      }
      invokeHandlers(route.handlers, req, res, next);
    };
    next();
  }

  handle(req, res, finalNext) {
    attachResponseHelpers(res);
    if (req.body === undefined && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const chunks = [];
      let total = 0;
      req.on('data', (chunk) => {
        total += chunk.length;
        if (total <= 64 * 1024 * 1024) chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
        this.dispatch(req, res, finalNext);
      });
      return;
    }
    this.dispatch(req, res, finalNext);
  }
}

function createRouter() {
  return new MiniRouter();
}

function json() {
  return (_req, _res, next) => next();
}

module.exports = { createRouter, json };
