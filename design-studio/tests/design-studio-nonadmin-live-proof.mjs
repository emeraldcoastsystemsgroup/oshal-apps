#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.14 (BACKLOG B12, "a person who is not an administrator has never run this"). The check of Design Studio as a person who is not an administrator, on a test slot. `person` makes a made-up person, reads that all five engineering applications refuse them, gives them ONE assignment (the engineering shelf's Engineer role: preview, then apply) and reads that all five now answer and that the person administers nothing. `check` signs in as that person on the slot's own sign-in page at 1440x900 and 412x915 and runs, through Design Studio's own screens, New product (the walkthrough), a part the design partner builds from the rail, Simulate (the mechanism, Build the plant, Run the baselines) and Make the print set; it writes screenshots and a JSON receipt. `remove` deletes what the person made, takes the assignment back and deactivates the person. A step whose engine is not running on the slot is reported as not run, never as passed.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and is typed only into the slot's own sign-in page; all three refuse port 38788):
 *   node design-studio/tests/design-studio-nonadmin-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node design-studio/tests/design-studio-nonadmin-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node design-studio/tests/design-studio-nonadmin-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Exit of `check`: 0 every step ran and passed at both sizes; 2 nothing was refused or broken but a step could not run here
 * (an engine not running on the slot, or the design partner answered without building the part); 1 anything else.
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { adminToken, assignShelf, http, message, OPENS, opens, privateWrite, revokeShelf, say, SHELF, testSlot } from './helpers/nonadmin-proof.mjs';
import { check } from './helpers/nonadmin-steps.mjs';

/** @description `person`: a made-up person who holds nothing, then the ONE assignment, with what each of the five answers before and after. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return 0; }
  const subject = `dsb12-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3 * 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Avery Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, assignment: null, before: null, after: null };
  privateWrite(file, person);
  person.before = await opens(origin, person.token);
  const id = `dsb12-engineer-${randomUUID().slice(0, 8)}`;
  const plan = await assignShelf(origin, admin, person.principal, id);
  person.assignment = { id, ...SHELF, members: plan.members };
  privateWrite(file, person);
  person.after = await opens(origin, person.token);
  const own = (await http(origin, person.token, 'GET', '/api/authorization/composites')).body || {};
  person.administrator = own.administrator === true;
  privateWrite(file, person);
  const failures = [];
  for (const app of Object.keys(OPENS)) {
    if (person.before[app] !== 403) failures.push(`${app} answered ${person.before[app]} before any assignment (a person who holds nothing must be refused, 403)`);
    if (person.after[app] !== 200) failures.push(`${app} answered ${person.after[app]} after the one assignment`);
    if (!plan.members.some((member) => member.app === app)) failures.push(`the one assignment does not name ${app}`);
  }
  if (person.administrator) failures.push('the test person administers this installation; the proof needs a person who does not');
  say('test person', { subject, administrator: person.administrator, assignments: 1, role: `${SHELF.app}/${SHELF.template}`, gives: plan.members, before: person.before, after: person.after, failures });
  return failures.length ? 1 : 0;
}

/** @description Delete what the person made in one application: every record a list names, by its id. */
async function deleteAll(origin, token, list, key, idOf, routeOf) {
  const answer = await http(origin, token, 'GET', list, { accepted: null });
  const rows = answer.status === 200 && answer.body && Array.isArray(answer.body[key]) ? answer.body[key] : [];
  let removed = 0;
  for (const row of rows) { if ((await http(origin, token, 'DELETE', routeOf(idOf(row)), { accepted: null })).status < 300) removed += 1; }
  return { found: rows.length, removed, listStatus: answer.status };
}

/** @description `remove`: delete the person's products, parts and circuits, take the one assignment back and deactivate the person. */
async function remove(origin, envFile, file) {
  const admin = adminToken(envFile), person = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seg = encodeURIComponent, left = {};
  left.products = await deleteAll(origin, person.token, '/api/design-studio/projects', 'projects', (row) => row.id, (id) => `/api/design-studio/projects/${seg(id)}`).catch((error) => ({ error: message(error) }));
  left.parts = await deleteAll(origin, person.token, '/api/cad-studio/models', 'models', (row) => row.model_id, (id) => `/api/cad-studio/models/${seg(id)}`).catch((error) => ({ error: message(error) }));
  left.circuits = await deleteAll(origin, person.token, '/api/circuit-lab/designs', 'designs', (row) => row.design_id, (id) => `/api/circuit-lab/designs/${seg(id)}`).catch((error) => ({ error: message(error) }));
  let revoked = false;
  if (person.assignment) { await revokeShelf(origin, admin, person.principal, person.assignment.id).then(() => { revoked = true; }).catch((error) => say('revoke failed', { message: message(error) })); }
  const afterRevoke = await opens(origin, person.token).catch((error) => ({ error: message(error) }));
  await http(origin, person.token, 'POST', '/api/auth/signout-everywhere', { body: {}, accepted: null }).catch((error) => say('sign-out failed', { message: message(error) }));
  const confirmation = (await http(origin, admin, 'POST', '/confirmations', { body: {} })).body;
  await http(origin, admin, 'POST', `/people/${person.principal}/deactivate`, { body: {}, headers: { 'x-oshal-confirm': confirmation.confirmation } });
  await http(origin, person.token, 'GET', '/api/authorization/me', { accepted: [401, 403] });
  fs.rmSync(file, { force: true });
  say('test person removed', { subject: person.subject, assignmentRevoked: revoked, afterRevoke, deleted: left,
    kept: 'two things have no delete route and stay: the plant-<product id>-* report files in embodied\'s reports folder, and each product\'s print set files under the person\'s folder in Design Studio\'s lasting directory' });
  return 0;
}

const [mode, base, second, third] = process.argv.slice(2);
try {
  if (!['person', 'check', 'remove'].includes(mode) || !base || !second || !third) throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
  const origin = testSlot(base);
  if (mode === 'person') process.exitCode = await makePerson(origin, second, third);
  else if (mode === 'check') process.exitCode = await check(origin, second, third);
  else process.exitCode = await remove(origin, second, third);
} catch (error) {
  console.error(`design-studio-nonadmin-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
