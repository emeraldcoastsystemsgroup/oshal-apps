/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Live 2026-10-11: the review evidence and every brief handed to another app began with a raw ISO timestamp ('saved 2026-10-11T10:50:12.672Z'). The real home-summary route runs with a stubbed router and pool; the saved time must read as a local date with its zone, never an ISO string.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function load() {
  const file = path.join(__dirname, '..', 'routes', 'home-summary.js');
  const mod = { exports: {} };
  let get;
  const express = { Router: () => ({ get: (_path, handler) => { get = handler; } }) };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))((name) => {
    if (name === 'express') return express;
    throw new Error('unexpected dependency ' + name);
  }, mod, mod.exports);
  return { mod, handler: () => get };
}

test('saved times in the evidence and the handed-off brief read as local dates', async () => {
  const { mod, handler } = load();
  const pool = { query: async (q) => (/count\(\*\)/.test(q.text) ? { rows: [{}] }
    : { rows: [{ name: 'Night one', show_id: 'family-feud', status: 'ended', content: 'beat', updated_at: new Date('2026-10-11T10:50:12.672Z') }] }) };
  mod.exports.createHomeSummaryRoutes({ pool });
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; } };
  await handler()({ oidc: { user: { sub: 'alice' }, isAuthenticated: () => true } }, res);
  const item = res.body.items[0];
  const text = JSON.stringify(item);
  assert.doesNotMatch(text, /\d{4}-\d\d-\d\dT\d\d:\d\d/, 'no ISO timestamp in the detail or the brief: ' + text);
  assert.match(item.detail, /Oct 1[01], 2026, \d{1,2}:\d\d [AP]M \S+/);
  assert.match(item.actions[0].context.notes, /Oct 1[01], 2026/);
});
