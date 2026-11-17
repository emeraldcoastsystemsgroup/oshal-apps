/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.58.1 live check of the account details comparison read on the test slot (:38798 only; it refuses production and any other address), as a throwaway test person who holds only Intelligent Trades (invitation, then the application's @app-admin role through /api/authorization/composites preview and apply, removed at the end, also when the role is refused). With that person's own session, GET and HEAD only: the account details script the kernel serves reads a holding's daily prices from /api/trading-charts/bars and never through api('/bars'); GET /api/trading/bars is not served (the address 1.58.0 read); GET /api/trading-charts/bars answers the person with daily bars, a stored-price line or a refusal in words. Prints statuses, counts and labels only; never a token, a price or a header.
 * -----------------------------------------------------------------------------
 *
 * usage: node trading/tests/live/details-bars-live.cjs --env=<oshald.env of the test slot> --out=<proof dir> [--base=http://127.0.0.1:38798]
 * Exit 0 when every check holds. A test person has no Schwab account, so the page itself is proven by
 * tests/native-account-details-browser.test.js; this proves the delivered file and the two addresses on the kernel.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const BASE = args.base || 'http://127.0.0.1:38798';
const APP = 'intelligent-trades';
const run = `trades-details-bars-${randomUUID().slice(0, 8)}`;
const receipt = { base: BASE, run, startedAt: new Date().toISOString(), checks: [], cleanup: [], problems: [] };

/** @description The installer's bearer from the kernel's env file, for the person's set-up and removal only; never printed. @returns {string} Token. */
function adminToken() {
  const line = fs.readFileSync(args.env, 'utf8').match(/^OSHAL_ADMIN_TOKEN=(.*)$/m);
  if (!line) throw new Error('no OSHAL_ADMIN_TOKEN in the env file');
  return line[1].trim().replace(/^['"]|['"]$/g, '');
}

/**
 * @description One call to the kernel; answers status, the content type and the body, never headers.
 * @param {string|null} token Bearer. @param {string} method Verb. @param {string} route Path. @param {object} [body] JSON. @param {object} [extra] Headers.
 * @returns {Promise<{status:number,type:string,text:string,json:object|null}>} The answer.
 */
async function call(token, method, route, body, extra = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra };
  const answer = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await answer.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: answer.status, type: answer.headers.get('content-type') || '', text, json };
}

/** @description A new person (an accepted invitation), not yet holding anything. @param {string} admin Bearer. @returns {Promise<{id:string,token:string,assignment:string}>} The person. */
async function makePerson(admin) {
  const invite = await call(admin, 'POST', '/people/invitations', { invitee: run, tier: 'editor', lifetime_ms: 3600000 });
  if (invite.status >= 300) throw new Error(`invitation refused: ${invite.status}`);
  const accepted = await call(null, 'POST', `/people/invitations/${encodeURIComponent(invite.json.token)}/accept`, { subject: run });
  if (accepted.status >= 300) throw new Error(`accept refused: ${accepted.status}`);
  return { id: accepted.json.principal, token: accepted.json.token, assignment: `${run}-trades` };
}

/** @description Give the person Intelligent Trades (its @app-admin role). @param {string} admin Bearer. @param {object} person The person. @returns {Promise<void>} */
async function grantTrades(admin, person) {
  const catalog = (await call(admin, 'GET', '/api/authorization/composites')).json;
  const body = { target: person.id, assignment_id: person.assignment, action: 'assign', expected_revision: catalog.revision, reason: run,
    idempotency_key: randomUUID(), selection: { kind: 'granular', app: APP, role: '@app-admin' } };
  body.expected_plan_revision = (await call(admin, 'POST', '/api/authorization/composites/preview', body)).json.plan_revision;
  const applied = await call(admin, 'POST', '/api/authorization/composites/apply', body);
  if (applied.status !== 200) throw new Error(`role refused: ${applied.status}`);
}

/** @description Record one check as a label and whether it held. @param {string} label Words. @param {boolean} held Result. @param {object} [seen] Statuses and counts. @returns {void} */
function check(label, held, seen = {}) {
  receipt.checks.push({ label, held, ...seen });
  if (!held) receipt.problems.push(label);
}

/**
 * @description The read-only checks with the person's own session: the delivered script, the unserved address, the served one.
 * @param {string} session The person's session bearer. @returns {Promise<void>}
 */
async function readChecks(session) {
  const script = await call(session, 'GET', '/api/trading/ui/native-account-details.js');
  const body = script.status === 200 ? script.text : '';
  const stockRead = (body.match(/async function loadNativeStockComparison[\s\S]*?\n}\n/) || [''])[0];
  check('the served account details script reads a holding\'s daily prices from /api/trading-charts/bars', script.status === 200
    && stockRead.includes("fetch('/api/trading-charts/bars?'") && !stockRead.includes("api('/bars"), { status: script.status, bytes: body.length });
  const old = await call(session, 'GET', '/api/trading/bars?symbol=SPY&timeframe=1Day');
  check('GET /api/trading/bars is not served (the address 1.58.0 read)', old.status === 404, { status: old.status });
  const bars = await call(session, 'GET', '/api/trading-charts/bars?symbol=SPY&timeframe=1Day');
  const count = Array.isArray(bars.json?.bars) ? bars.json.bars.length : Array.isArray(bars.json?.line) ? bars.json.line.length : null;
  const shape = Array.isArray(bars.json?.bars) ? 'bars' : Array.isArray(bars.json?.line) ? 'stored-price line' : bars.json?.message ? 'refusal in words' : 'other';
  check('GET /api/trading-charts/bars answers the person (daily bars, a stored-price line, or a refusal in words)',
    (bars.status === 200 && count !== null) || (bars.status >= 400 && bars.status !== 404 && Boolean(bars.json?.message)), { status: bars.status, shape, points: count });
}

/** @description Remove the person's sessions, its role and the person. @param {string} admin Bearer. @param {object} person The person. @param {string|null} session Its session. @returns {Promise<void>} */
async function cleanUp(admin, person, session) {
  const note = (what, answer) => receipt.cleanup.push(`${what}: ${answer.status}`);
  if (session) note('sign out everywhere', await call(session, 'POST', '/api/auth/signout-everywhere', {}));
  const catalog = (await call(admin, 'GET', '/api/authorization/composites')).json;
  note('revoke role', await call(admin, 'POST', '/api/authorization/composites/apply', { target: person.id, assignment_id: person.assignment,
    action: 'revoke', expected_revision: catalog.revision, reason: run, idempotency_key: randomUUID() }));
  for (const [method, route] of [['DELETE', `/people/${person.id}`], ['POST', `/people/${person.id}/deactivate`]]) {
    const confirmation = (await call(admin, 'POST', '/confirmations', {})).json.confirmation;
    note(`${method} ${route.replace(person.id, '<person>')}`, await call(admin, method, route, method === 'POST' ? {} : undefined, { 'x-oshal-confirm': confirmation }));
  }
}

/** @description The check: make the person, read with its session, clean up, write the receipt. @returns {Promise<void>} */
async function main() {
  if (BASE !== 'http://127.0.0.1:38798') throw new Error(`refusing ${BASE}: the test slot (http://127.0.0.1:38798) only, never production`);
  if (!args.env || !args.out) throw new Error('usage: --env=<oshald.env> --out=<dir> [--base=http://127.0.0.1:38798]');
  fs.mkdirSync(args.out, { recursive: true });
  const admin = adminToken();
  receipt.packageVersion = ((await call(admin, 'GET', '/packages')).json?.packages || []).find((p) => p.name === APP)?.version;
  let person = null, session = null;
  try {
    person = await makePerson(admin);
    await grantTrades(admin, person);
    session = (await call(null, 'POST', '/sessions', { token: person.token })).json?.session || null;
    if (!session) throw new Error('the person could not sign in');
    await readChecks(session);
  } catch (error) {
    receipt.problems.push(`run stopped: ${String(error.message || error).split('\n')[0].slice(0, 200)}`);
  } finally {
    if (person) await cleanUp(admin, person, session).catch((error) => receipt.problems.push(`clean-up: ${error.message}`));
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(args.out, 'receipt-details-bars.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = receipt.problems.length ? 1 : 0;
  }
}

if (require.main === module) main().catch((error) => { console.error(String(error.message || error).split('\n')[0]); process.exitCode = 1; });
