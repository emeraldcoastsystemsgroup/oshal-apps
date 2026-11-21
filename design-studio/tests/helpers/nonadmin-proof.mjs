/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.14 (BACKLOG B12): what the non-administrator check (design-studio-nonadmin-live-proof.mjs) shares between its three modes: the loopback-only address rule (never production's port), the administrator credential read by name and never printed, one request helper whose failures carry the method, the route and the status and nothing else, the one composite assignment (preview, then apply) and its revoke, the reads that say whether each of the five applications admits the person, and Playwright from the store toolchain.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The application that declares the role, the role, and the five applications it must open. */
export const SHELF = { app: 'engineering-shelf', template: 'engineer' };
/** One read per application that an admitted person is answered and anyone else is refused. */
export const OPENS = Object.freeze({
  'design-studio': '/api/design-studio/projects',
  'cad-studio': '/api/cad-studio/models',
  'circuit-lab': '/api/circuit-lab/designs',
  embodied: '/api/embodied/physics/status',
  'scan-to-print': '/api/scan-to-print/printers',
});

export const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @description The first line of an error, bounded; never the error object. @param {unknown} error Anything thrown. @returns {string} */
export const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback kernel's origin, or a refusal (never production's port). @param {string} base An address. @returns {string} */
export function testSlot(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  if (new URL(origin).port === '38788') throw new Error('this proof writes; it runs on the test slot (http://127.0.0.1:38798), never on production');
  return origin;
}

/** @description The administrator credential from an env file, by name; never printed. @param {string} file The env file. @returns {string} */
export function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** @description A JSON file only this user can read. @param {string} file Where. @param {object} value What. @returns {void} */
export function privateWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * @description One request to the kernel's own origin; a failure names the method, the route and the status, nothing else.
 * @param {string} origin The kernel. @param {string} credential A bearer or ''. @param {string} method The method.
 * @param {string} route The path. @param {object} [options] body (JSON), accepted statuses (null accepts any), headers.
 * @returns {Promise<{status:number,body:any}>} The status and the parsed answer.
 */
export async function http(origin, credential, method, route, { body, accepted = [200], headers = {} } = {}) {
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('refusing a request outside the kernel');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(240000),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  if (accepted && !accepted.includes(response.status)) throw new Error(`${method} ${route.split('?')[0].replace(/\/people\/invitations\/[^/]+\/accept/, '/people/invitations/:private/accept')}: ${response.status}`);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; } // an answer that is not JSON has no body to read; its status is what was checked
  return { status: response.status, body: parsed };
}

/**
 * @description Whether each of the five applications answers the person's read: the status per application.
 * @param {string} origin The kernel. @param {string} token The person's credential. @returns {Promise<Record<string, number>>} Status by application.
 */
export async function opens(origin, token) {
  const out = {};
  for (const [app, route] of Object.entries(OPENS)) out[app] = (await http(origin, token, 'GET', route, { accepted: null })).status;
  return out;
}

/**
 * @description The ONE assignment: the engineering shelf's Engineer role for the person, previewed and then applied.
 * @param {string} origin The kernel. @param {string} admin The administrator credential. @param {string} principal The person.
 * @param {string} id The assignment's id. @returns {Promise<{members: Array<{app:string, role:string, tier:string}>}>} What the preview said the one assignment gives.
 */
export async function assignShelf(origin, admin, principal, id) {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  const declared = (catalog.applications || []).find((row) => row.app === SHELF.app);
  if (!declared || !(declared.templates || []).some((template) => template.id === SHELF.template)) throw new Error('this kernel offers no Engineer role: engineering-shelf 1.0.0 is not installed and active on it');
  const input = { target: principal, assignment_id: id, action: 'assign', expected_revision: catalog.revision, reason: 'Design Studio non-administrator proof (test person)',
    idempotency_key: randomUUID(), selection: { kind: 'composite', app: SHELF.app, template: SHELF.template, optional_apps: [] } };
  const preview = (await http(origin, admin, 'POST', '/api/authorization/composites/preview', { body: input })).body;
  input.expected_plan_revision = preview.plan_revision;
  await http(origin, admin, 'POST', '/api/authorization/composites/apply', { body: input });
  return { members: (preview.members || []).map((member) => ({ app: member.app, role: member.role, tier: member.tier })) };
}

/** @description Take the one assignment back, by its own id. @param {string} origin The kernel. @param {string} admin The administrator credential. @param {string} principal The person. @param {string} id The assignment. @returns {Promise<void>} */
export async function revokeShelf(origin, admin, principal, id) {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  await http(origin, admin, 'POST', '/api/authorization/composites/apply', { body: { target: principal, assignment_id: id, action: 'revoke', expected_revision: catalog.revision,
    reason: 'Design Studio non-administrator proof (test person)', idempotency_key: randomUUID() } });
}

/** @description Poll until a check answers truthy; a timeout names the wait and the last thing that went wrong in it. @param {Function} check The check. @param {number} ms How long. @param {string} label What is waited for. @returns {Promise<any>} */
export async function until(check, ms, label) {
  const end = Date.now() + ms;
  let last = '';
  for (;;) {
    const value = await Promise.resolve().then(check).catch((error) => { last = message(error); return null; });
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${label}${last ? ` (${last})` : ''}`);
    await wait(1000);
  }
}

/** @description Playwright from the toolchain the gate names (STORE_CI_TOOLCHAIN, a folder that holds node_modules), or the store's own. @returns {object} The playwright module. */
export function playwright() {
  const roots = [process.env.STORE_CI_TOOLCHAIN && path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'), path.resolve(here, '../../../scripts/toolchain/node_modules')].filter(Boolean);
  for (const root of roots) {
    if (fs.existsSync(path.join(root, 'playwright'))) return createRequire(path.join(root, 'noop.js'))('playwright');
  }
  throw new Error(`BLOCKED: playwright not found (npm ci --prefix scripts/toolchain). Tried ${roots.join(', ')}`);
}
