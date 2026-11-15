/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | One made-up person's calendar for the card and conversation suites (calendar 1.4.0): a stand-in
 *   Google Calendar behind the stand-in kernel egress holding two 3 PM meetings with Dana (a Tuesday and a Wednesday), an
 *   invitation from Morgan and a weekly series; an OSHAL event in a recording pool; the compiled meetings routes; the kernel's
 *   route tools stand-in in front of them; and the kernel's own card code (platform/src/api/jarvis-package-tools.js from
 *   OSHAL_KERNEL_PLATFORM, a read-only export of the kernel's platform folder), which the suites refuse, never skip, without.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { modules, call, nextWeekday, ROOT } = require('./calendar-modules.cjs');
const { standInGoogle, kernelEgress } = require('./google-calendar-standin.cjs');
const { routeTools } = require('./route-tools.cjs');

const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
const ZONE = 'America/Chicago';
const TUE = nextWeekday(2, 3), WED = nextWeekday(3, 4), THU = nextWeekday(4, 5);
const at = (day, time) => ({ dateTime: `${day}T${time}:00`, timeZone: ZONE });
const you = { email: 'you@example.com', displayName: 'You', self: true, responseStatus: 'accepted' };
const dana = { email: 'dana@example.com', displayName: 'Dana Reyes', responseStatus: 'accepted' };
const LUNCH = '6b0d7e2a-1c4f-4a8e-9d3b-5f2e8c1a7b90';

/** The kernel's card text helpers, refusing rather than skipping without the platform folder. */
function kernelCards() {
  const platform = process.env.OSHAL_KERNEL_PLATFORM;
  assert.ok(platform, 'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (refusing rather than skipping)');
  return require(path.join(platform, 'src', 'api', 'jarvis-package-tools.js'));
}

/** A pool with one OSHAL event and no snapshot, answering the statements the meeting routes send. */
function pool() {
  const start = `${THU}T18:00:00.000Z`;
  const rows = [{ id: LUNCH, title: 'Team lunch', starts_at: start, ends_at: `${THU}T19:00:00.000Z`, all_day: false, time_zone: ZONE, location: 'Cafe Rio', notes: null, created_at: new Date().toISOString(), revision: 'o.first1' }];
  const sql = [];
  return { rows, sql, async query(q, values) {
    const text = typeof q === 'string' ? q : q.text, vals = typeof q === 'string' ? values : q.values;
    sql.push({ text, values: vals });
    if (/AND starts_at >= \$2 AND starts_at < \$3/.test(text)) return { rows: rows.filter((r) => r.starts_at >= vals[1] && r.starts_at < vals[2]) };
    if (/WHERE user_sub = \$1 AND id = \$2$/.test(text) && /^SELECT/.test(text)) return { rows: rows.filter((r) => r.id === vals[1]) };
    if (/^UPDATE calendar_own_events/.test(text)) {
      const row = rows.find((r) => r.id === vals[1] && (/IS NULL$/.test(text) ? r.revision == null : r.revision === vals[10]));
      if (!row) return { rowCount: 0 };
      Object.assign(row, { title: vals[2], starts_at: vals[3], ends_at: vals[4], all_day: vals[5], time_zone: vals[6], location: vals[7], notes: vals[8], revision: vals[9] });
      return { rowCount: 1 };
    }
    if (/^DELETE FROM calendar_own_events WHERE user_sub = \$1 AND id = \$2$/.test(text)) {
      const at = rows.findIndex((r) => r.id === vals[1]);
      if (at >= 0) rows.splice(at, 1);
      return { rowCount: at >= 0 ? 1 : 0 };
    }
    if (/^SELECT events,synced_at FROM calendar_preparation_snapshots/.test(text)) return { rows: [] };
    throw new Error('pool cannot answer: ' + text.slice(0, 90));
  } };
}

/** The application's own routes behind the mount, by method and path. */
function dispatcher(routes) {
  return async (method, full, query, body) => {
    const rest = full.replace(/^\/api\/calendar\/meetings/, '') || '/';
    for (const key of Object.keys(routes)) {
      const [verb, pattern] = key.split(' ');
      const names = [], re = new RegExp(`^${pattern.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
      const m = verb === method ? re.exec(rest) : null;
      if (!m) continue;
      const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const out = await call(routes, key, { body, query, params });
      return { status: out.statusCode, body: out.body };
    }
    return { status: 404, body: { error: `no route ${method} ${full}` } };
  };
}

/** The made-up person's world, its routes behind the stand-in kernel route tools, and cleanup. */
async function world() {
  const api = await standInGoogle();
  const ids = {
    coffee: api.seed({ summary: 'Coffee with Dana', start: at(TUE, '15:00'), end: at(TUE, '15:30'), location: 'Blue Bottle', attendees: [you, dana] }),
    budget: api.seed({ summary: 'Budget review with Dana', start: at(WED, '15:00'), end: at(WED, '16:00'), attendees: [you, dana] }),
  };
  const egress = kernelEgress(manifest, 'person-write', api), p = pool();
  const close = async () => { egress.restore(); await api.close(); };
  try {
    const routes = modules().meetings.createMeetingsRoutes({ pool: p }).routes;
    return { api, ids, pool: p, routes, tools: routeTools(manifest, dispatcher(routes)), manifest, close };
  } catch (err) { await close(); throw err; }
}

module.exports = { world, kernelCards, manifest, ZONE, TUE, WED, THU, LUNCH };
