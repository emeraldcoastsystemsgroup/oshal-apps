/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The compiled calendar routes (calendar/routes/*.js) loaded with only their declared
 *   dependencies, for the meeting change and cancel suites (1.4.0): any other import fails the test. `express` is a recording
 *   router stub unless a real express is given.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: the Home summary is loaded too, for the suite that reads what every answer
 *   calls the product (tests/product-name-events.test.cjs).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: the live Google reader (routes/google-live.js), which the Home summary and the agenda
 *   (routes/own-events.js) now read.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const logger = { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) };

/** A router that records each handler by "METHOD /path". */
const router = () => { const routes = {}; const add = (m) => (p, f) => { routes[`${m} ${p}`] = f; }; return { routes, get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') }; };

/**
 * @description Every calendar route module, each loaded from its compiled file with only the modules it names.
 * @param {object} [express] - A real express, or the recording stub.
 * @returns {Record<string, any>} The modules by file name.
 */
function modules(express = { Router: router }) {
  const loaded = {};
  const deps = {
    'event-time': [], 'meeting-change': ['./event-time'], 'google-events': ['express', 'crypto', '@/shared/logger', './event-time'],
    'google-meeting-edit': ['./event-time', './google-events', './meeting-change'], sync: ['express', '@/shared/logger'],
    'google-live': ['@/shared/logger', './google-events', './event-time', './sync'],
    'own-events': ['express', 'crypto', '@/shared/logger', './event-time', './google-live'], 'home-summary': ['express', '@/shared/logger', './own-events', './google-live', './event-time'],
    'own-event-changes': ['@/shared/logger', './event-time', './meeting-change', './own-events'],
    'google-meetings': ['@/shared/logger', './google-events', './google-meeting-edit', './meeting-change', './sync'],
    meetings: ['express', '@/shared/logger', './event-time', './google-events', './google-meeting-edit', './google-meetings', './own-event-changes'],
  };
  const load = (name) => {
    if (loaded[name]) return loaded[name];
    const m = { exports: {} };
    loaded[name] = m.exports;
    new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes', `${name}.js`), 'utf8'))((id) => {
      if (!deps[name].includes(id)) throw new Error(`${name} requires ${id}, which it does not declare here`);
      if (id === 'express') return express;
      if (id === 'crypto') return require('node:crypto');
      if (id === '@/shared/logger') return logger;
      return load(id.slice(2));
    }, m, m.exports);
    loaded[name] = m.exports;
    return m.exports;
  };
  for (const name of Object.keys(deps)) load(name);
  return loaded;
}

const caller = (sub = 'alice') => ({ oidc: { user: { sub }, isAuthenticated: () => true } });
function res() { return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } }; }

/** Call one recorded route handler as a signed-in person. */
async function call(routes, key, { body, query, params, sub = 'alice' } = {}) {
  const out = res();
  await routes[key]({ ...caller(sub), body, query: query || {}, params: params || {}, headers: {} }, out);
  return out;
}

/** A date some days ahead in a zone: 'YYYY-MM-DD'. */
function dayAhead(days, zone = 'America/Chicago') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86_400_000));
  return parts;
}
/** The next date on or after `days` ahead that falls on a weekday (0 Sunday .. 6 Saturday). */
function nextWeekday(weekday, days = 2, zone = 'America/Chicago') {
  for (let i = days; i < days + 7; i++) { const d = dayAhead(i, zone); if (new Date(`${d}T00:00:00Z`).getUTCDay() === weekday) return d; }
  throw new Error('no weekday');
}

module.exports = { modules, router, call, res, caller, dayAhead, nextWeekday, logger, ROOT };
