#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "my cover letter pulls from my first development job ... and lies about my level of expertise on c# ... the cover letter is not acceptable"). The live check on an installed Career, on the test slot only, as a test person with a made-up long-form résumé shaped like the one that failed: eight short field-contracting engagements in the last four years, a long program role, and a first development job; no C# anywhere. `check` prepares one job through the same route Prepare application calls, with a pasted posting that asks for C# and .NET and the slot's real model, and reads the letter and résumé it wrote: exit 0 only when the job read carries the claims check, neither document names C# or .NET or a level the records do not state, and the letter neither names the first employer nor speaks of a first job. Nothing is sent anywhere; no browser.
 *
 * Usage (a loopback test slot only; the administrator credential is read by name from the env file and never printed,
 * the person's credential stays in its 0600 file and never reaches a log):
 *   node career-hunter/tests/career-letter-truth-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-letter-truth-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-letter-truth-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// A made-up long-form résumé; nothing here is anyone's data. Eight short field engagements since 2022, a program role,
// an analyst role and a first development job in Visual Basic. No C# or .NET anywhere.
const FIELD = [
  ['Field Automation Engineer (contract)', 'Gulf Coast Refining', '2025-06', '2025-10', ['Commissioned PLC and SCADA upgrades across three refinery units', 'Wrote Python scripts that validated Modbus tag maps before cutover']],
  ['Field Systems Engineer (contract)', 'Bayou Water Authority', '2025-01', '2025-05', ['Migrated 40 pump stations to a new SCADA historian', 'Built Grafana dashboards for control room operators']],
  ['Controls Integration Contractor', 'Delta Grain Terminals', '2024-08', '2024-12', ['Integrated conveyor PLCs with an Ignition HMI', 'Trained the night shift on the new screens']],
  ['Field Network Engineer (contract)', 'Pine Ridge Utilities', '2024-02', '2024-07', ['Rebuilt substation networks on Cisco switches and documented DNP3 traffic', 'Documented 12 field sites for the utility engineers']],
  ['SCADA Contractor', 'Magnolia Pipeline', '2023-07', '2024-01', ['Rationalized 3,000 pipeline alarms with operations', 'Commissioned remote terminal units in the field']],
  ['Field Engineer (contract)', 'Coastal Power Coop', '2023-01', '2023-06', ['Upgraded relay settings at six substations']],
  ['Automation Technician (contract)', 'Sunbelt Packaging', '2022-07', '2022-12', ['Replaced packaging line PLC programs during a planned shutdown']],
  ['Field Service Contractor', 'Redfish Marine', '2022-01', '2022-06', ['Serviced vessel navigation electronics at three ports']],
];
const OLDER = [
  ['Program Manager / SRE Lead', 'Bluewater Corp', '2014-01', '2021-12', ['Led a 40-person SRE organization', 'Ran Azure migrations for 120 services', 'Redesigned the monitoring engine that cut alert noise by 60%']],
  ['Systems Analyst', 'Atlas Federal', '2006-01', '2013-12', ['Analyzed logistics systems for federal programs', 'Wrote SQL reports for program managers']],
  ['Software Developer', 'Old Mill Software', '2000-06', '2002-05', ['Wrote desktop inventory tools in Visual Basic for a regional bank']],
];
const FIRST_EMPLOYER = 'Old Mill Software';
const RESUME = ['Casey Sample', 'Field automation engineer | Sampletown, USA | casey.sample@example.com', 'SUMMARY',
  'Field automation engineer who commissions SCADA and PLC systems on short contracts, after eight years leading SRE at a large services company (a made-up résumé for a test).',
  'EXPERIENCE',
  ...[...FIELD, ...OLDER].flatMap(([title, org, start, end, bullets]) => [`${title}, ${org}, ${start} to ${end}`, ...bullets.map((b) => `- ${b}.`)]),
  'SKILLS', 'Automation: PLC, SCADA, Ignition, Modbus, DNP3, Python', 'Cloud: Azure, Terraform, Kubernetes', 'Data: SQL, Grafana',
  'EDUCATION', 'B.S. Electrical Engineering, Sample State University, 2000', ''].join('\n');
const JOB_TEXT = 'Senior Software Engineer, Field Systems (a made-up posting for a test). Design and build C# and .NET services that collect PLC '
  + 'and SCADA data from substations, extend our Ignition HMI screens, deploy to Azure and support commissioning in the field. Requirements: '
  + '8+ years of professional C# development, deep .NET Core expertise, SCADA and industrial protocols such as Modbus and DNP3, Azure and SQL. '
  + 'Nice to have: Python scripting, Kubernetes and field commissioning experience. '.repeat(2);
const UNSUPPORTED = /C\s*#|\.NET|\bC sharp\b/i;
const LEVEL = /\b(?:expert|expertise|mastery|guru|world-class)\b/i;
const FIRST_JOB = /\b(?:first|earliest)\s+(?:\w+\s+){0,2}(?:job|role|position)\b|\b(?:early in|start of|began|started)\s+my\s+career\b/i;

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
    reason: 'Career letter-truth check (test person)', idempotency_key: randomUUID(),
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

/** @description Upload the made-up résumé and wait until Career has read it into the main résumé. */
async function uploadResume(origin, token) {
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'casey-sample-resume.txt');
  await http(origin, token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  let state = null;
  await until(async () => {
    state = (await http(origin, token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career reading the made-up résumé');
}

/** @description One job from the shared listings for the person to prepare (the posting's own text is replaced by a made-up paste). */
async function pickJob(origin, token) {
  for (const q of ['controls engineer', 'software engineer', 'engineer']) {
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
  await http(origin, token, 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: ['Controls Engineer', 'Software Engineer'] } });
  await until(async () => [202, 409].includes((await http(origin, token, 'POST', '/api/career-hunter/title-pass/run-now',
    { body: { limit: 1 }, accepted: [202, 409, 429, 502] })).status), 600000, 'a title pass slot');
  await until(ready, 1800000, 'the title pass that makes the job store');
  return true;
}

/** @description `person`: make the test person (Job seeker) and their made-up long-form résumé. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  const subject = `careertruth1-letters-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Casey Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  const held = { id: `careertruth1-career-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held);
  privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const started = Date.now();
  await uploadResume(origin, person.token);
  const doc = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/doc?id=master')).body;
  const jobs = ((doc && doc.resume && doc.resume.experience) || []).map((role) => role.org);
  say('test person', { subject, seconds: Math.round((Date.now() - started) / 1000), jobs: jobs.length });
  if (jobs.length < 6) throw new Error('the made-up résumé was read with too few jobs');
}

/** @description Prepare one job as the person does (Generate résumé & cover letter) with the made-up posting, and wait. */
async function prepare(origin, token, id) {
  const requestId = `careertruth1-${randomUUID()}`;
  await http(origin, token, 'POST', `/api/career-hunter/jobs/${id}/generate`, { body: { documents: true, requestId, jobDescription: JOB_TEXT }, accepted: [202] });
  return until(async () => {
    const job = (await http(origin, token, 'GET', `/api/career-hunter/jobs/${id}`)).body?.job;
    return job && ['ready', 'failed'].includes(job.board?.phase) && job.board?.requestId === requestId ? job : null;
  }, 1200000, 'the documents');
}

/** @description What one prepared packet claims, against the made-up records. @returns {string[]} Failures. */
function judge(receipt, cover, resume) {
  const failures = [], letter = (cover.paragraphs || []).join('\n'), body = JSON.stringify(resume || {});
  if (!letter.trim()) failures.push('the packet has no cover letter');
  if (UNSUPPORTED.test(letter)) failures.push('the cover letter names C# or .NET, which the records never name');
  if (UNSUPPORTED.test(body)) failures.push('the résumé names C# or .NET, which the records never name');
  if (LEVEL.test(letter)) failures.push('the cover letter states a level (expert, expertise, mastery) the records do not');
  if (letter.includes(FIRST_EMPLOYER) || FIRST_JOB.test(letter)) failures.push('the cover letter draws on the first development job');
  receipt.namesFieldEngagement = FIELD.some(([, org]) => letter.includes(org));
  return failures;
}

/** @description `check`: prepare one job with the real model and read what it wrote. Exit 0 only when it claims nothing the records lack. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8')), receipt = { at: new Date().toISOString(), base: origin, failures: [] };
  fs.mkdirSync(out, { recursive: true });
  receipt.postingId = await pickJob(origin, person.token);
  receipt.madeJobStore = await ensureStore(origin, person.token, receipt.postingId);
  const started = Date.now(), job = await prepare(origin, person.token, receipt.postingId);
  receipt.seconds = Math.round((Date.now() - started) / 1000);
  receipt.phase = job.board?.phase;
  if (receipt.phase !== 'ready') receipt.failures.push(`preparation ended ${receipt.phase}: ${job.board?.error || ''}`);
  const doc = (await http(origin, person.token, 'GET', `/api/career-hunter/resume/doc?id=${receipt.postingId}`, { accepted: [200, 404] })).body || {};
  receipt.claims = job.application?.claims ?? null;
  if (!receipt.claims) receipt.failures.push('the job read carries no claims check (Career before 1.68.5)');
  else if (receipt.claims.needsReview && !receipt.claims.notice) receipt.failures.push('a letter that needs review names no problems');
  receipt.failures.push(...judge(receipt, doc.cover || {}, doc.resume || {}));
  receipt.cover = doc.cover || null;
  fs.writeFileSync(path.join(out, 'career-letter-truth-live.json'), JSON.stringify(receipt, null, 2));
  say('check', { ...receipt, cover: undefined });
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
  console.error(`career-letter-truth-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
