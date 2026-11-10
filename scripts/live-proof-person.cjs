/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Shared helper for the packages' live browser proofs (tests/live/*.cjs): a throwaway test person on a loopback kernel (an invitation at the editor tier, accepted, each named application assigned through the authorization composites preview + apply, signed in as a session cookie on the kernel's origin only), a Chromium context at phone (412x915, touch) or desktop (1440x900) width, and the clean-up (sign out everywhere on the kernel and, because the dev slot copies sessions into production, on the production loopback when named; every assignment revoked). The installer's bearer is read from the env file, sent only to loopback and never printed; errors carry status codes and refusal words only.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STORE = path.resolve(__dirname, '..');
const { chromium } = require(path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));

const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

/**
 * @description Refuse any origin that is not loopback, so the installer's bearer never leaves the machine.
 * @param {string} origin Kernel origin.
 * @returns {string} The same origin.
 */
function loopback(origin) {
  if (new URL(origin).hostname !== '127.0.0.1') throw new Error(`refusing ${origin}: the bearer goes to loopback only`);
  return origin.replace(/\/$/, '');
}

/**
 * @description The installer's bearer from a kernel env file; never printed.
 * @param {string} file oshald.env path.
 * @returns {string} Token.
 */
function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').match(/^OSHAL_ADMIN_TOKEN=(.*)$/m);
  if (!line) throw new Error('no OSHAL_ADMIN_TOKEN in the env file');
  return line[1].trim().replace(/^['"]|['"]$/g, '');
}

/**
 * @description One JSON call; answers status and body, never headers.
 * @param {string} origin Kernel origin.
 * @param {string|null} token Bearer.
 * @param {string} method Verb.
 * @param {string} route Path.
 * @param {object} [body] JSON body.
 * @returns {Promise<{status:number,json:object|null}>} Answer.
 */
async function call(origin, token, method, route, body) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
  const answer = await fetch(loopback(origin) + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await answer.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { text: text.slice(0, 160) }; }
  return { status: answer.status, json };
}

/**
 * @description Assign or revoke one application for a person through the composites preview + apply.
 * @param {string} base Kernel origin.
 * @param {string} admin Installer bearer.
 * @param {object} person Person record.
 * @param {string} app Application id.
 * @param {'assign'|'revoke'} action What to do.
 * @returns {Promise<number>} The apply status, or 0 when the application has no authorization catalog (open to every signed-in person).
 */
async function assignment(base, admin, person, app, action) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await assignmentOnce(base, admin, person, app, action); } catch (error) {
      if (attempt >= 4 || !/refresh the preview|revision/.test(error.message)) throw error;
    }
  }
}

/**
 * @description One preview + apply (a policy or revision change in between asks for a fresh preview; the caller retries).
 * @param {string} base Kernel origin.
 * @param {string} admin Installer bearer.
 * @param {object} person Person record.
 * @param {string} app Application id.
 * @param {'assign'|'revoke'} action What to do.
 * @returns {Promise<number>} The apply status, or 0 for an application without an authorization catalog.
 */
async function assignmentOnce(base, admin, person, app, action) {
  const id = `${person.run}-${app}`;
  const catalog = (await call(base, admin, 'GET', '/api/authorization/composites')).json;
  const entry = (catalog.applications || []).find((row) => row.app === app);
  if (!entry) return 0;
  const role = ['administrator', 'admin'].find((name) => entry.roles.includes(name)) || entry.roles.find((name) => !/reader|viewer/.test(name)) || entry.roles[0];
  const body = { target: person.id, assignment_id: id, action, expected_revision: catalog.revision, reason: person.run, idempotency_key: randomUUID(),
    ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app, role } }) };
  const preview = await call(base, admin, 'POST', '/api/authorization/composites/preview', body);
  if (preview.status !== 200) throw new Error(`${action} ${app} preview refused: ${preview.status} ${JSON.stringify(preview.json).slice(0, 300)}`);
  if (action !== 'revoke') body.expected_plan_revision = preview.json.plan_revision;
  const applied = await call(base, admin, 'POST', '/api/authorization/composites/apply', body);
  if (applied.status !== 200) throw new Error(`${action} ${app} refused: ${applied.status} ${JSON.stringify(applied.json).slice(0, 300)}`);
  return applied.status;
}

/**
 * @description A new signed-in test person holding the named applications.
 * @param {{base:string, env:string, apps:string[], label:string}} options Kernel, env file, applications and a run label.
 * @returns {Promise<object>} Person: id, run, session, cookie name, apps.
 */
async function makePerson({ base, env, apps, label }) {
  const admin = adminToken(env);
  const run = `${label}-${randomUUID().slice(0, 8)}`;
  const invite = await call(base, admin, 'POST', '/people/invitations', { invitee: run, tier: 'editor', lifetime_ms: 3600000 });
  if (invite.status >= 300) throw new Error(`invitation refused: ${invite.status}`);
  const accepted = await call(base, null, 'POST', `/people/invitations/${encodeURIComponent(invite.json.token)}/accept`, { subject: run });
  if (accepted.status >= 300) throw new Error(`accept refused: ${accepted.status}`);
  const person = { id: accepted.json.principal, token: accepted.json.token, run, apps: [], admin };
  for (const app of apps) { if (await assignment(base, admin, person, app, 'assign')) person.apps.push(app); }
  const session = await fetch(`${loopback(base)}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: person.token }) });
  if (session.status !== 201 && session.status !== 200) throw new Error(`person sign-in refused: ${session.status}`);
  person.session = (await session.json()).session;
  person.cookie = (session.headers.get('set-cookie') || 'oshal_session=').split('=')[0];
  return person;
}

/**
 * @description A browser context signed in as the person on the kernel's origin only.
 * @param {object} browser Chromium.
 * @param {string} base Kernel origin.
 * @param {object} person Person.
 * @param {'phone'|'desktop'} width Which width.
 * @returns {Promise<object>} Context.
 */
async function personContext(browser, base, person, width) {
  const context = await browser.newContext(width === 'phone' ? PHONE : DESKTOP);
  await context.addCookies([{ name: person.cookie, value: person.session, domain: new URL(base).hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
  return context;
}

/**
 * @description Serve named package files from this checkout in place of the kernel's copy, inside one browser context only
 * (a proof of a UI change before delivery: nothing on the kernel changes).
 * @param {object} context Playwright context.
 * @param {string} base Kernel origin.
 * @param {Array<{route:string, file:string, type?:string}>} files URL path → checkout file.
 * @returns {Promise<string[]>} The routes substituted.
 */
async function substitute(context, base, files) {
  const origin = loopback(base);
  for (const entry of files) {
    const body = fs.readFileSync(entry.file);
    const type = entry.type || (entry.file.endsWith('.html') ? 'text/html; charset=utf-8' : entry.file.endsWith('.css') ? 'text/css' : 'text/javascript');
    await context.route((url) => url.origin === origin && url.pathname === entry.route, (route) => route.fulfill({ status: 200, contentType: type, body, headers: { 'cache-control': 'no-store' } }));
  }
  return files.map((entry) => entry.route);
}

/**
 * @description Sign the person out everywhere (kernel and production copy) and revoke every assignment.
 * @param {string} base Kernel origin.
 * @param {object} person Person.
 * @param {string} [production] Production loopback origin, when sessions are copied there.
 * @returns {Promise<string[]>} One line per step with its status.
 */
async function cleanUp(base, person, production) {
  const lines = [];
  if (person.session) lines.push(`sign out everywhere: ${(await call(base, person.session, 'POST', '/api/auth/signout-everywhere', {})).status}`);
  if (person.session && production) lines.push(`sign out everywhere (production copy): ${(await call(production, person.session, 'POST', '/api/auth/signout-everywhere', {})).status}`);
  for (const app of person.apps) {
    try { lines.push(`revoke ${app}: ${await assignment(base, person.admin, person, app, 'revoke')}`); } catch (error) { lines.push(String(error.message)); }
  }
  return lines;
}

module.exports = { chromium, PHONE, DESKTOP, STORE, loopback, call, makePerson, personContext, substitute, cleanUp };
