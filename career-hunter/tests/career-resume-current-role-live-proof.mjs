#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.3 (Roger, 2026-11-16: "the system isnt using my most recent expierence to generate the resume ... it would leave out my active role"). The live check on an installed Career, on the test slot only, as a test person with a made-up résumé shaped like the one that failed: an uploaded history whose newest job ended in 2023, then two current jobs (no end date) added on top through Work history, exactly as a person adds them. `check` prepares one job through the same route Prepare application calls, with the real model, and reads the résumé it wrote: exit 0 only when it starts with the two current roles and the job reads ready with no role left out. Nothing is sent anywhere; no browser.
 *
 * Usage (a loopback test slot only; the administrator credential is read by name from the env file and never printed,
 * the person's credential stays in its 0600 file and never reaches a log):
 *   node career-hunter/tests/career-resume-current-role-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-resume-current-role-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-resume-current-role-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// A made-up résumé; nothing here is anyone's data. Shaped like the one that failed: a long uploaded history whose newest
// job ended in 2023 and whose summary still calls that employer current; the two current jobs are added on top later.
const OLDER = [
  ['Platform Lead', 'Sample Cloud Co', '2019-03', '2023-08'], ['Engineering Manager', 'Sample Cloud Co', '2016-01', '2019-02'],
  ['Senior Engineer', 'Example Freight', '2013-06', '2015-12'], ['Systems Engineer', 'Example Freight', '2010-04', '2013-05'],
  ['Engineer', 'Demo Retail', '2007-01', '2010-03'], ['Support Engineer', 'Demo Retail', '2005-02', '2006-12'],
  ['Analyst', 'Placeholder Media', '2003-06', '2005-01'], ['Junior Developer', 'Placeholder Media', '2001-06', '2003-05'],
];
const RESUME = ['Riley Sample', 'Platform engineering lead | Sampletown, USA | riley.sample@example.com', 'SUMMARY',
  'Currently leads platform delivery at Sample Cloud Co, where Riley runs the shared cloud platform for 40 teams (a made-up résumé for a test).',
  'EXPERIENCE',
  ...OLDER.flatMap(([title, org, start, end], n) => [`${title}, ${org}, ${start} to ${end}`,
    ...[1, 2, 3, 4, 5].map((k) => `- Led delivery milestone ${n + 1}.${k} at ${org}: moved ${10 * k} services, cut incidents by ${5 * k}% and coached ${k + 1} engineers on runbooks, reviews and release planning.`)]),
  'SKILLS', 'Cloud: AWS, Kubernetes, Terraform', 'Languages: Python, Go, SQL',
  'EDUCATION', 'B.S. Computer Science, Sample State University, 2001', ''].join('\n');
// The two jobs added through Work history, newest last so each lands on top: the résumé then starts with the founder role.
const ADDED = [
  { title: 'Board Advisor', org: 'North Pier Labs', start: '2023-09', bullets: ['Advised the founders on platform delivery and hiring'] },
  { title: 'Co-Founder / Principal', org: 'Harbor Light Systems', start: '2024-02', bullets: ['Led the agentic platform build for the company', 'Won two paying pilot customers in 2025'] },
];
const JOB_TEXT = 'Platform Engineering Manager (a made-up posting for a test). Lead a team of eight engineers who run the shared cloud platform: '
  + 'Kubernetes, Terraform and the delivery pipeline. Own reliability targets, on-call and incident review. Hire and coach engineers. '
  + 'Work with product teams on migrations. Requirements: eight years of platform or infrastructure work, three years leading engineers, '
  + 'hands-on AWS and Kubernetes, and a record of delivery without downtime. '.repeat(3);

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback kernel's origin, or a refusal. @param {string} base An address. @returns {string} The origin. */
function loopback(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this check runs only against a loopback kernel, http://127.0.0.1:<port>');
  if (new URL(origin).port === '38788') throw new Error('this check writes a test person\'s documents; it runs on the test slot (http://127.0.0.1:38798), never on production');
  return origin;
}

/** @description The administrator credential from an env file, by name; never printed. @param {string} file @returns {string} */
function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** @description A JSON file only this user can read. @param {string} file @param {object} value @returns {void} */
function privateWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * @description One request to the kernel's own origin; a failure names the method, the route and the status only.
 * @param {string} origin @param {string} credential A bearer or ''. @param {string} method @param {string} route
 * @param {{body?:object,form?:FormData,accepted?:number[],headers?:object}} [options]
 * @returns {Promise<{status:number,body:any}>} The status and the parsed answer.
 */
async function http(origin, credential, method, route, { body, form, accepted = [200], headers = {} } = {}) {
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('refusing a request outside the kernel');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(240000),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : form ? { body: form } : {}) });
  const text = await response.text();
  if (!accepted.includes(response.status)) {
    throw new Error(`${method} ${route.split('?')[0].replace(/\/people\/invitations\/[^/]+\/accept/, '/people/invitations/:private/accept')}: ${response.status}`);
  }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}

/** @description Assign or take back one application role for the person (preview, then apply). */
async function grant(origin, admin, principal, held, action = 'assign') {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  const input = { target: principal, assignment_id: held.id, action, expected_revision: catalog.revision,
    reason: 'Career current-role check (test person)', idempotency_key: randomUUID(),
    ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app: held.app, role: held.role } }) };
  if (action !== 'revoke') input.expected_plan_revision = (await http(origin, admin, 'POST', '/api/authorization/composites/preview', { body: input })).body.plan_revision;
  await http(origin, admin, 'POST', '/api/authorization/composites/apply', { body: input });
}

/** @description Poll until a check answers truthy, or say what it was waiting for. */
async function until(check, ms, label) {
  for (const end = Date.now() + ms; ;) {
    const value = await Promise.resolve().then(check).catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await wait(2000);
  }
}

/** @description Add one job on top of the work history, as the Work history page does (one card on the revision read). */
async function addJob(origin, token, job) {
  const at = { roleIndex: 0, roleTitle: job.title };
  const revision = (await http(origin, token, 'GET', '/api/career-hunter/resume/master-section?field=overview')).body.revision;
  const edits = [{ op: 'add', field: 'role', index: 0, before: '', value: job.title, summary: `Add ${job.title} at ${job.org}` },
    { op: 'set', field: 'role', ...at, key: 'org', before: '', value: job.org },
    { op: 'set', field: 'role', ...at, key: 'start', before: '', value: job.start },
    ...job.bullets.map((value, index) => ({ op: 'add', field: 'experience', ...at, index, before: '', value }))];
  await http(origin, token, 'POST', '/api/career-hunter/resume/master-edit', { body: { revision, edits } });
}

/** @description Upload the made-up résumé and wait until Career has read it into the main résumé. */
async function uploadResume(origin, token) {
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'riley-sample-resume.txt');
  await http(origin, token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  let state = null;
  await until(async () => {
    state = (await http(origin, token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career reading the made-up résumé');
}

/** @description The main résumé's jobs as Career shows them: [title, employer, end] in order. */
async function mainJobs(origin, token) {
  const doc = (await http(origin, token, 'GET', '/api/career-hunter/resume/doc?id=master')).body;
  return ((doc && doc.resume && doc.resume.experience) || []).map((role) => [role.title, role.org, role.end || '']);
}

/** @description `person`: make the test person (Job seeker), its made-up résumé, and the two current jobs on top. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  const subject = `careerresume1-current-role-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Riley Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  const held = { id: `careerresume1-career-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held);
  privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const started = Date.now();
  await uploadResume(origin, person.token);
  for (const job of ADDED) await addJob(origin, person.token, job);
  const jobs = await mainJobs(origin, person.token);
  say('test person', { subject, seconds: Math.round((Date.now() - started) / 1000), mainResumeJobs: jobs });
  if (!jobs.length || jobs[0][0] !== ADDED[1].title || jobs[0][2] !== '') throw new Error('the main résumé does not start with the current job');
}

/** @description One job from the shared listings for the person to prepare (the posting's own text is replaced by a made-up paste). */
async function pickJob(origin, token) {
  for (const q of ['platform engineer', 'engineering manager', 'engineer']) {
    const jobs = (await http(origin, token, 'GET', `/api/career-hunter/browse?q=${encodeURIComponent(q)}&per=20`)).body?.jobs || [];
    const job = jobs.find((row) => Number.isSafeInteger(Number(row.id)) && !['applied', 'interview', 'offer', 'rejected'].includes(row.status));
    if (job) return Number(job.id);
  }
  throw new Error('no listing to prepare on this slot');
}

/**
 * @description A new person's job store is made by their first title pass (a background run on the native kernel; the
 * manual keyword match outlasts a route call there). Save target titles and run a one-job pass when the store is missing.
 */
async function ensureStore(origin, token, id) {
  const ready = async () => (await http(origin, token, 'GET', `/api/career-hunter/jobs/${id}`, { accepted: [200, 404] })).status === 200;
  if (await ready()) return false;
  await http(origin, token, 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: ['Platform Engineer', 'Engineering Manager'] } });
  await until(async () => [202, 409].includes((await http(origin, token, 'POST', '/api/career-hunter/title-pass/run-now',
    { body: { limit: 1 }, accepted: [202, 409, 429, 502] })).status), 600000, 'a title pass slot');
  await until(ready, 1800000, 'the title pass that makes the job store');
  return true;
}

/** @description Prepare one job as the person does (Generate résumé & cover letter) and wait for its documents. */
async function prepare(origin, token, id) {
  const requestId = `careerresume1-${randomUUID()}`;
  await http(origin, token, 'POST', `/api/career-hunter/jobs/${id}/generate`, { body: { documents: true, requestId, jobDescription: JOB_TEXT }, accepted: [202] });
  return until(async () => {
    const job = (await http(origin, token, 'GET', `/api/career-hunter/jobs/${id}`)).body?.job;
    return job && ['ready', 'failed'].includes(job.board?.phase) && job.board?.requestId === requestId ? job : null;
  }, 1200000, 'the documents');
}

/** @description `check`: prepare one job with the real model and read the résumé it wrote. Exit 0 only when it carries both current jobs first. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8')), receipt = { at: new Date().toISOString(), base: origin, failures: [] };
  fs.mkdirSync(out, { recursive: true });
  const fail = (why) => receipt.failures.push(why);
  receipt.mainResumeJobs = await mainJobs(origin, person.token);
  receipt.postingId = await pickJob(origin, person.token);
  receipt.madeJobStore = await ensureStore(origin, person.token, receipt.postingId);
  const started = Date.now(), job = await prepare(origin, person.token, receipt.postingId);
  receipt.seconds = Math.round((Date.now() - started) / 1000);
  receipt.phase = job.board?.phase;
  if (receipt.phase !== 'ready') fail(`preparation ended ${receipt.phase}: ${job.board?.error || ''}`);
  const doc = (await http(origin, person.token, 'GET', `/api/career-hunter/resume/doc?id=${receipt.postingId}`, { accepted: [200, 404] })).body;
  receipt.resumeJobs = ((doc && doc.resume && doc.resume.experience) || []).map((role) => [role.title, role.org, role.span]);
  const first = receipt.resumeJobs.slice(0, 2).map(([title, org]) => `${title} | ${org}`);
  if (first[0] !== `${ADDED[1].title} | ${ADDED[1].org}`) fail(`the résumé starts with ${first[0] || 'nothing'}, not the current role ${ADDED[1].title} at ${ADDED[1].org}`);
  if (first[1] !== `${ADDED[0].title} | ${ADDED[0].org}`) fail(`the résumé's second job is ${first[1] || 'nothing'}, not the other current role`);
  if (!/present/i.test(String((receipt.resumeJobs[0] || [])[2] || ''))) fail('the current role\'s dates do not run to Present');
  receipt.missingRoles = job.application?.missingRoles ?? null;
  if (receipt.missingRoles === null) fail('the job read names no missingRoles (Career before 1.67.3)');
  else if (receipt.missingRoles.length) fail(`the job read says the résumé leaves out ${receipt.missingRoles.map((r) => r.title).join(', ')}`);
  fs.writeFileSync(path.join(out, 'career-resume-current-role-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.failures.length ? 1 : 0;
}

/** @description `remove`: take the grant back and deactivate the test person. */
async function remove(origin, envFile, file) {
  const admin = adminToken(envFile), person = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const held of person.grants || []) await grant(origin, admin, person.principal, held, 'revoke').catch((error) => say('revoke failed', { message: message(error) }));
  const confirmation = (await http(origin, admin, 'POST', '/confirmations', { body: {} })).body;
  await http(origin, admin, 'POST', `/people/${person.principal}/deactivate`, { body: {}, headers: { 'x-oshal-confirm': confirmation.confirmation } });
  await http(origin, person.token, 'GET', '/api/authorization/me', { accepted: [401, 403] });
  fs.rmSync(file, { force: true });
  say('test person removed', { subject: person.subject, grantsRevoked: (person.grants || []).length });
}

const [mode, base, second, third] = process.argv.slice(2);
try {
  const origin = loopback(base);
  if (mode === 'person' && second && third) await makePerson(origin, second, third);
  else if (mode === 'check' && second && third) process.exitCode = await check(origin, second, third);
  else if (mode === 'remove' && second && third) await remove(origin, second, third);
  else throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
} catch (error) {
  console.error(`career-resume-current-role-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
