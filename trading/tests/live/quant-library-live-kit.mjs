/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane QUANTLIB1: the test-slot helpers the quant library's one-command live proof shares (moved out of quant-library-live.mjs when the proof began loading the shelf itself): the loopback test slot only (never :38788), the administrator credential read by name and never printed, made-up people with a Trades tier and named roles given and taken back through the role catalog, the kernel journal's recall count for one person's trading-concierge turns, and the slot's conversation order set and put back.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const APP = 'intelligent-trades', PRINT = 'print-ingest', BOT_ID = '4f8a1e72-3c59-4b8d-9e41-7206c8a31f4e';
const ORDER_KEY = 'inference.order.conversations';
const FIRST = Object.freeze({ swarm: { provider: 'antigravity-account', model: 'gemini-4-argon-medium' }, 'bot-fast': { provider: 'vllm', model: 'bot-fast' } });
export const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
export const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback test slot, never production. @param {string} base Address. @returns {string} Origin. */
export function testSlot(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  if (new URL(origin).port === '38788') throw new Error('this proof writes test people and a shelf; it runs on the test slot (http://127.0.0.1:38798), never on production');
  return origin;
}

/** @description The administrator credential from an env file, by name; never printed. */
export function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** @description One request to the kernel's own origin; answers status, JSON and milliseconds. */
export function request(origin, credential, method, route, { body, headers = {} } = {}) {
  const started = Date.now(), url = new URL(route, origin);
  if (url.origin !== origin) return Promise.reject(new Error('refusing a request outside the kernel'));
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = null; } resolve({ status: res.statusCode, body: parsed, ms: Date.now() - started }); });
    });
    req.on('error', (error) => reject(new Error(`${method} ${route.split('?')[0]} did not answer: ${error.code || error.name}`)));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function confirmed(origin, admin) {
  return { 'x-oshal-confirm': (await request(origin, admin, 'POST', '/confirmations', { body: {} })).body.confirmation };
}

/** @description Sign a person in with their own access token; answers the session. */
export async function signIn(origin, person) {
  const session = await request(origin, '', 'POST', '/sessions', { body: { token: person.token } });
  if (session.status !== 201 && session.status !== 200) throw new Error(`sign-in refused: ${session.status}`);
  person.sessions.push(session.body.session);
  return session.body.session;
}

/** @description A made-up person with a Trades tier, signed in. */
export async function makePerson(origin, admin, label, tier = 'editor') {
  const subject = `quantlib1-${label}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 4)}`;
  const invite = await request(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } });
  if (invite.status >= 300) throw new Error(`invitation refused: ${invite.status}`);
  const accepted = await request(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.body.token)}/accept`, { body: { subject, display_name: `Quant Library ${label} (test)` } });
  if (accepted.status >= 300) throw new Error(`accept refused: ${accepted.status}`);
  const person = { label, subject, principal: accepted.body.principal, token: accepted.body.token, sessions: [], assignments: [] };
  const grant = await request(origin, admin, 'PUT', `/grants/${person.principal}/${APP}`, { body: { tier }, headers: await confirmed(origin, admin) });
  if (grant.status !== 200) throw new Error(`the Trades tier grant was refused: ${grant.status}`);
  await signIn(origin, person);
  say('test person', { label, subject });
  return person;
}

/** @description Give a person a named role through the role catalog; the assignment is kept to take back exactly. */
export async function giveRole(origin, admin, person, app, role) {
  const catalog = (await request(origin, admin, 'GET', '/api/authorization/composites')).body;
  const id = randomUUID();
  const change = { target: person.principal, assignment_id: id, action: 'assign', expected_revision: catalog.revision,
    selection: { kind: 'granular', app, role }, reason: 'quant library live proof (test person)', idempotency_key: `quantlib1-${id}` };
  const preview = await request(origin, admin, 'POST', '/api/authorization/composites/preview', { body: change });
  if (preview.status !== 200) throw new Error(`${app} ${role} preview refused: ${preview.status}`);
  const applied = await request(origin, admin, 'POST', '/api/authorization/composites/apply', { body: { ...change, expected_plan_revision: preview.body.plan_revision } });
  if (applied.status !== 200) throw new Error(`${app} ${role} role refused: ${applied.status}`);
  person.assignments.push(id);
  say('role', { label: person.label, app, role });
}

/** @description Take back the run's own role assignments, sign out, deny the Trades grant and deactivate. */
export async function removePerson(origin, admin, person) {
  for (const id of person.assignments) {
    const catalog = (await request(origin, admin, 'GET', '/api/authorization/composites')).body;
    const revoke = await request(origin, admin, 'POST', '/api/authorization/composites/apply', { body: { target: person.principal, assignment_id: id, action: 'revoke', expected_revision: catalog.revision, reason: 'quant library live proof done', idempotency_key: `quantlib1-revoke-${id}` } });
    say('role revoked', { label: person.label, status: revoke.status });
  }
  for (const session of person.sessions) await request(origin, session, 'DELETE', '/sessions').catch(() => null);
  const deny = await request(origin, admin, 'PUT', `/grants/${person.principal}/${APP}`, { body: { tier: 'deny' }, headers: await confirmed(origin, admin) }).catch((e) => ({ status: message(e) }));
  const off = await request(origin, admin, 'POST', `/people/${person.principal}/deactivate`, { body: {}, headers: await confirmed(origin, admin) });
  say('test person removed', { label: person.label, grantDenied: deny.status, deactivated: off.status });
}

/** @description How many passages the engine recalled into this person's trading-concierge turns between two instants (kernel journal). */
export function recalled(unit, principal, from, to) {
  const out = execFileSync('journalctl', ['--user', '-u', unit, '--since', `@${Math.floor(from / 1000) - 1}`, '-o', 'cat', '--no-pager'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let count = 0, turns = 0;
  for (const line of out.split('\n')) {
    if (!line.includes('rag.completed') || !line.includes(principal)) continue;
    let event = null;
    try { event = JSON.parse(line); } catch { continue; }
    const fields = event.fields || {};
    if (fields.msg === 'rag.completed' && fields.principal === principal && fields.bot === BOT_ID && event.at >= from - 1000 && event.at <= to + 1000) {
      turns += 1;
      count += Number(fields.count || 0);
    }
  }
  return { turns, count };
}

/** @description One trading-concierge turn for a person; answers the reply, the tools that ran and when. */
export async function ask(origin, person, question, tag) {
  const from = Date.now();
  const answer = await request(origin, person.sessions[0], 'POST', '/api/swarm/bots/trading-concierge/ask', { body: { message: question, sessionId: `quantlib1-${tag}-${randomUUID().slice(0, 6)}` } });
  return { answer, from, to: Date.now(), tools: (Array.isArray(answer.body && answer.body.toolsUsed) ? answer.body.toolsUsed : []).map((r) => r.tool || r.name), reply: String((answer.body && answer.body.reply) || '') };
}

/** @description Put a model first in the slot's conversation order; answers the saved value to put back. */
export async function setOrder(origin, admin, order, out) {
  if (order === 'current') return null;
  if (!FIRST[order]) throw new Error('an order is current, swarm or bot-fast');
  const saved = (await request(origin, admin, 'GET', `/settings/${ORDER_KEY}`)).body.value;
  fs.writeFileSync(path.join(out, 'saved-conversation-order.json'), JSON.stringify({ key: ORDER_KEY, value: saved }), { mode: 0o600 });
  const rest = JSON.parse(saved).filter((e) => !(e.provider === FIRST[order].provider && e.model === FIRST[order].model));
  const next = order === 'swarm' ? [FIRST.swarm, FIRST['bot-fast'], ...rest.filter((e) => e.model !== 'bot-fast')] : [FIRST[order], ...rest];
  const put = await request(origin, admin, 'PUT', `/settings/${ORDER_KEY}`, { body: { scope: 'deployment', value: JSON.stringify(next) }, headers: await confirmed(origin, admin) });
  if (put.status !== 200) throw new Error(`the conversation order could not be set: ${put.status}`);
  say('conversation order', { first: `${next[0].provider}/${next[0].model}` });
  return saved;
}

/** @description Put a saved conversation order back; answers the status. */
export async function restoreOrder(origin, admin, saved) {
  if (saved == null) return 200;
  const put = await request(origin, admin, 'PUT', `/settings/${ORDER_KEY}`, { body: { scope: 'deployment', value: saved }, headers: await confirmed(origin, admin) });
  say('conversation order restored', { status: put.status });
  return put.status;
}

/** @description Where this slot's shelf-load state lives (0700 folder, 0600 file), outside any run's out folder. */
export function stateFile(origin) {
  const dir = path.join(os.homedir(), '.local/state/oshal-quantlib1-proof');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, `shelf-${new URL(origin).port}.json`);
}
