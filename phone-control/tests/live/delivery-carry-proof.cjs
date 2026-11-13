/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (T83): what a delivery of this release does to the access people already hold, on a disposable oshald + Postgres. The kernel starts with the version before it (REF, 1.13.0: device features at the admin tier), an administrator holds the Device Control Administrator template and a second person holds each role one by one (admin, editor, operator, reader, viewer), as the Application user preset gives them. Then this package's folder replaces the installed one and POST /packages/phone-control/reload publishes it, exactly as a delivery does. Proven: the kernel lists 1.14.0; every assignment whose role grants what was approved stays active with nothing pressed (the admin template and the admin role, whose permissions only moved to a lower minimum tier, and the viewer and reader roles, which did not change); the editor and operator roles, which gain the device permissions, wait for re-approval and say what is new; and the second person keeps using their devices through the admin role meanwhile. It needs a kernel that carries an assignment over a moved minimum tier (kernel a93bdbc8 or later); on an older kernel the admin assignments wait too and this proof fails.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [base, rootToken, outFile] = process.argv.slice(2);
const apps = process.env.OSHAL_PROOF_APPS;
const pkgDir = process.env.OSHAL_PROOF_PACKAGE;
if (!base || !base.startsWith('http://127.0.0.1:') || base.endsWith(':38788') || base.endsWith(':38789') || base.endsWith(':38798')) {
  throw new Error(`delivery-carry-proof only targets a disposable loopback kernel, never ${base}`);
}
if (!apps || !pkgDir || !fs.existsSync(path.join(apps, 'phone-control', 'oshal-app.yaml'))) {
  throw new Error('run through tests/live/isolation-proof.sh with PROOF set: the throwaway applications folder is not named');
}

const ROLES = ['admin', 'editor', 'operator', 'reader', 'viewer'];
const GAINS = ['editor', 'operator'];

async function api(method, route, { token = rootToken, body } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a page */ }
  return { status: response.status, json, text };
}

async function switchPersona(persona) {
  const switched = await fetch(`${base}/api/auth/switch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona }) });
  const json = await switched.json();
  assert.equal(switched.status, 200, `switch ${persona}`);
  return { token: json.token, principalId: json.principal_id };
}

/** Preview one change as root and, unless `previewOnly`, apply it with the previewed plan. */
async function change(target, assignmentId, action, selection, previewOnly = false) {
  const cat = await api('GET', '/api/authorization/composites');
  const req = {
    target, assignment_id: assignmentId, action, selection, expected_revision: cat.json.revision, expected_plan_revision: null,
    expires_at: null, reason: `delivery proof (${action})`, idempotency_key: `carry-${crypto.randomUUID()}`
  };
  const preview = await api('POST', '/api/authorization/composites/preview', { body: req });
  assert.equal(preview.status, 200, preview.text);
  if (previewOnly) return preview.json;
  const applied = await api('POST', '/api/authorization/composites/apply', {
    body: { ...req, expected_plan_revision: preview.json.plan_revision, idempotency_key: `carry-${crypto.randomUUID()}` }
  });
  assert.equal(applied.status, 200, applied.text);
  return preview.json;
}

/** Each of this proof's assignments as /access lists it: status and the plan it is stamped with. */
async function standing() {
  const cat = await api('GET', '/api/authorization/composites');
  assert.equal(cat.status, 200, cat.text);
  const mine = cat.json.assignments.filter((row) => row.assignment.id.startsWith('carry-'));
  return Object.fromEntries(mine.map((row) => [row.assignment.id, { status: row.status, plan: row.assignment.plan_revision, selection: row.assignment.selection }]));
}

async function installedVersion() {
  const listed = await api('GET', '/packages');
  const pkg = (listed.json?.packages || []).find((item) => item.name === 'phone-control');
  assert.equal(pkg?.state, 'active', JSON.stringify(pkg));
  return pkg.version;
}

/** Replace the installed folder with this package's and publish it, as a delivery does. */
async function deliver() {
  const installed = path.join(apps, 'phone-control');
  fs.renameSync(installed, path.join(apps, '..', 'phone-control.before'));
  fs.cpSync(pkgDir, installed, { recursive: true, filter: (source) => !/(^|\/)(__pycache__|node_modules)(\/|$)/.test(source) });
  const reloaded = await api('POST', '/packages/phone-control/reload', { body: {} });
  assert.equal(reloaded.status, 200, reloaded.text);
  assert.equal(reloaded.json?.status, 'reloaded', reloaded.text);
}

async function main() {
  const before = await installedVersion();
  const after = /^version: (\S+)$/m.exec(fs.readFileSync(path.join(pkgDir, 'oshal-app.yaml'), 'utf8'))[1];
  assert.notEqual(before, after, 'start the kernel with the version before this one (REF)');
  const administrator = await switchPersona('operator');
  const person = await switchPersona('trader');
  await change(administrator.principalId, 'carry-template-admin', 'assign', { kind: 'composite', app: 'phone-control', template: 'admin', optional_apps: [] });
  for (const role of ROLES) await change(person.principalId, `carry-role-${role}`, 'assign', { kind: 'granular', app: 'phone-control', role });
  const approved = await standing();
  for (const [id, held] of Object.entries(approved)) assert.equal(held.status, 'active', `${id} before the delivery`);
  assert.equal((await api('GET', '/api/phone-control/devices', { token: person.token })).status, 200);

  await deliver();
  assert.equal(await installedVersion(), after, 'the kernel lists the delivered version');
  const delivered = await standing();
  const statuses = Object.fromEntries(Object.entries(delivered).map(([id, held]) => [id, held.status]));
  for (const id of Object.keys(delivered)) {
    const waits = GAINS.some((role) => id === `carry-role-${role}`);
    assert.equal(delivered[id].status, waits ? 'contract_changed' : 'active', `${id} after the delivery: ${JSON.stringify(statuses)}`);
    if (!waits) assert.notEqual(delivered[id].plan, approved[id].plan, `${id} is stamped with the delivered plan`);
  }
  const stillWorks = await api('GET', '/api/phone-control/devices', { token: person.token });
  assert.equal(stillWorks.status, 200, 'the person keeps their devices through the role that carried over');
  const reasons = {};
  for (const role of GAINS) {
    const verdict = await change(person.principalId, `carry-role-${role}`, 'replace', delivered[`carry-role-${role}`].selection, true);
    assert.equal(verdict.reapproval?.unchanged, false, JSON.stringify(verdict.reapproval));
    assert.match(verdict.reapproval.reason, /would grant something new/);
    reasons[role] = verdict.reapproval.reason.slice(0, 200);
  }
  const receipt = { verifiedAt: new Date().toISOString(), before, after, statuses, waitingReasons: reasons, personDevicesStatusAfter: stillWorks.status };
  fs.writeFileSync(outFile, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
