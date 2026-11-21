#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Whether Career's submission path really sends an application, proved live on the test slot against the stand-in employer (career-submit-standin.cjs), never a real one. A made-up person with a made-up résumé; one stand-in posting per variant in the slot's Career corpus (a recorded maintenance edit, removed after); a real packet generation; Connect a computer as that person (join code, join with harness browser-form-v1 and browse, bind to the Career browser bot); a SECOND helper unit for that person, installed by install-browser-worker.py from this checkout and pointed at the slot; Approve & submit through Career's own routes (/submission-queue, /bind, /start, the three writes the page's Approve and submit makes); the outcome read with /sync, the native ticket, the job, the retained pictures and the stand-in's log; then everything removed. --local runs the helper library in this process instead of a unit, its browser reaching only the stand-in over an exact-name TLS tunnel, so the chain is checked before a public name exists. --unexposed runs the installed unit against a name that does not resolve yet: each variant must come back needs you with no press and no request anywhere (the helper's own network guard refuses it), which proves the unit, its enrolment and the native claim without an employer.
 *
 * Usage (a loopback test slot only; never 38788. The administrator credential is read by name from the slot's env file
 * and never printed; the person's and the device's credentials stay in 0600 files in <out>/state):
 *   node career-hunter/tests/live/career-submit-proof.mjs check  --employer https://<public name> [--standin-port 47931] [--standin-host 127.0.0.1]
 *   node career-hunter/tests/live/career-submit-proof.mjs all    --employer https://<public name> [--standin-port 47931] [--standin-host 127.0.0.1] [--variants a,b,c]
 *   node career-hunter/tests/live/career-submit-proof.mjs all    --local [--variants a,b,c]
 *   node career-hunter/tests/live/career-submit-proof.mjs all    --employer https://<name not yet exposed> --unexposed --variants a
 *   node career-hunter/tests/live/career-submit-proof.mjs remove --out <the run's folder>
 * Common: [--slot http://127.0.0.1:38798] [--env ~/.local/state/oshal-native-green/oshald.env] [--out <folder>] [--keep]
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID, randomInt, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url)), CAREER = path.resolve(HERE, '../..'), STORE = path.resolve(CAREER, '..');
const standin = require('./career-submit-standin.cjs');
const BOT = 'cb000000-0000-0000-0000-000000000004', ROGERS_HELPER = '79e24027-38a8-5171-bae3-961aee061ae9';
const HELPER_BASE = path.join(os.homedir(), '.local/state/oshal-native/career-browser');
const LOCAL_NAME = 'jobs.example.com', TERMINAL = new Set(['submitted', 'needs_you', 'unknown', 'failed', 'cancelled']);
const EXPECT = { a: { status: 'submitted', posts: 1, kinds: ['submit'] }, b: { status: 'submitted', posts: 1, kinds: ['continue', 'submit'] }, c: { status: 'needs_you', posts: 0, kinds: ['open'] } };
// Made-up data; nothing here is anyone's.
const RESUME = `Sam Example
Operations coordinator | Sampletown, USA | sam.example@example.com | 555-010-0142
SUMMARY
Coordinates schedules, suppliers and office operations for small teams (a made-up résumé for a test).
EXPERIENCE
Operations Coordinator, Example Logistics, 2020-02 to present
- Schedules a team of eight across purchasing and facilities.
- Cut supplier costs 12% by consolidating vendors.
Office Coordinator, Placeholder Health, 2016-05 to 2020-01
- Opened two new clinics on time and on budget.
SKILLS
Scheduling, vendor management, budgeting, spreadsheets
EDUCATION
B.A. Business, Sample State University, 2015
`;
const DESCRIPTION = 'Stand-in posting for a Career submission test; there is no real job. The Operations Coordinator keeps schedules, '
  + 'suppliers and office operations running for a small team: planning weekly schedules, ordering supplies, tracking budgets in '
  + 'spreadsheets, coordinating facilities work and keeping vendors on time. Two or more years of operations or office coordination '
  + 'experience; strong scheduling and vendor management; comfortable with budgets and spreadsheets. Remote, United States.';

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);
const [MODE, ...ARGS] = process.argv.slice(2);
const opt = (name, fallback) => { const i = ARGS.indexOf(`--${name}`); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : fallback; };
const flag = (name) => ARGS.includes(`--${name}`);

/** @description A JSON file only this user can read. @param {string} file @param {object} value @returns {void} */
function privateWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
/** @description One named value from an env file, unquoted; values are never printed. */
function envValue(file, name) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((value) => value.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2') : '';
}
/** @description The test slot's origin from --slot and its env file, or a refusal: loopback, never production's port, and the env file's own bind. */
function slot(base, envFile) {
  const origin = new URL(base).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || new URL(origin).port === '38788') throw new Error('this proof writes; it runs on the loopback test slot (http://127.0.0.1:38798), never on production');
  if (envValue(envFile, 'OSHAL_BIND') !== new URL(origin).host) throw new Error('the env file is not this slot\'s (its OSHAL_BIND differs)');
  const careerData = envValue(envFile, 'OSHAL_CAREER_DATA_DIR');
  if (!careerData || !/oshal-native-green/.test(careerData) || !fs.existsSync(path.join(careerData, 'corpus.db'))) throw new Error('the slot env names no test-slot Career corpus');
  return { origin, careerData };
}
/** @description Poll until a check answers truthy; a thrown `Stop` ends the wait at once. */
async function until(check, ms, label) {
  const end = Date.now() + ms;
  for (;;) {
    let value = null;
    try { value = await check(); } catch (error) { if (error && error.stop) throw error; }
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await wait(3000);
  }
}
const stop = (text) => Object.assign(new Error(text), { stop: true });
/** @description One request to the slot's own origin; a failure names the method, the route and the status, nothing else. */
async function call(ctx, credential, method, route, { body, form, accepted = [200], raw = false, headers = {} } = {}) {
  const url = new URL(route, ctx.origin);
  if (url.origin !== ctx.origin) throw new Error('refusing a request outside the slot');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(240000),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : form ? { body: form } : {}) });
  if (raw) return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  const text = await response.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!accepted.includes(response.status)) {
    const code = parsed && (parsed.code || parsed.reason) ? ` ${parsed.code || parsed.reason}` : '';
    throw Object.assign(new Error(`${method} ${url.pathname.replace(/\/people\/invitations\/[^/]+\/accept/, '/people/invitations/:private/accept')}: ${response.status}${code}`), { status: response.status, code: parsed && parsed.code });
  }
  return { status: response.status, body: parsed };
}
const save = (ctx) => privateWrite(path.join(ctx.stateDir, 'state.json'), ctx.state);
const me = (ctx) => ctx.person && ctx.person.token;

/** @description Assign or take back one application role (preview, then apply; a revoke is apply alone). */
async function grant(ctx, held, action = 'assign') {
  const catalog = (await call(ctx, ctx.admin, 'GET', '/api/authorization/composites')).body;
  const input = { target: ctx.state.person.principal, assignment_id: held.id, action, expected_revision: catalog.revision, reason: 'Career submission proof (test person)',
    idempotency_key: randomUUID(), ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app: held.app, role: held.role } }) };
  if (action !== 'revoke') input.expected_plan_revision = (await call(ctx, ctx.admin, 'POST', '/api/authorization/composites/preview', { body: input })).body.plan_revision;
  await call(ctx, ctx.admin, 'POST', '/api/authorization/composites/apply', { body: input });
}
/** @description The made-up person: an invitation, Career's member role, the made-up résumé through Career's own upload and indexing. */
async function newPerson(ctx) {
  const subject = `careersubmit1-${ctx.stamp}`;
  const invite = (await call(ctx, ctx.admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await call(ctx, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Sam Example (submission proof test)' } })).body;
  ctx.person = { token: accepted.token };
  privateWrite(path.join(ctx.stateDir, 'person.json'), ctx.person);
  ctx.state.person = { subject, principal: accepted.principal };
  const held = { id: `careersubmit1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  ctx.state.grants = [held]; save(ctx);
  await grant(ctx, held);
  await call(ctx, me(ctx), 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'sam-example-resume.txt');
  await call(ctx, me(ctx), 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => { const s = (await call(ctx, me(ctx), 'GET', '/api/career-hunter/resume/state')).body; return s && s.hasResume === true && !s.indexing; }, 900000, 'Career indexing the made-up résumé');
  await ensureStore(ctx);
  applyProfile(ctx);
  const profile = (await call(ctx, me(ctx), 'GET', '/api/career-hunter/autofill/bookmarklet', { accepted: [200, 409] })).body || {};
  ctx.state.person.profileFields = profile.populatedFields || [];
  save(ctx);
  say('test person', { subject, profileFields: ctx.state.person.profileFields });
  if (!ctx.state.person.profileFields.includes('email')) throw new Error('the made-up person has no Apply Profile email');
}
const APPLY_PY = `
import fcntl, os, sys
person, payload = sys.argv[1], sys.argv[2]
with open(os.path.join(person, '.request-lock'), 'a+') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    generation = open(os.path.join(person, 'current')).read().strip()
    if not generation or '/' in generation or generation.startswith('.'): raise SystemExit('no_generation')
    fd = os.open(os.path.join(person, 'generations', generation, 'apply_profile.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(fd, payload.encode()); os.close(fd)
`;
/**
 * @description The made-up person's Apply Profile email and phone. Career keeps neither from a résumé (the indexing schema in
 * engine/jobhunter/profile.py has name, credential, location, clearance, citizenship and summary) and no screen or route writes
 * apply_profile.json, yet Approve & submit needs an email (lib/career-submission-native.js review). So this test person's file is
 * written into their own current Career generation on the slot, under the kernel's owner request lock.
 */
function applyProfile(ctx) {
  const principal = ctx.state.person.principal;
  if (!/^[a-f0-9-]{36}$/.test(principal)) throw new Error('no test person');
  const tenant = fs.readdirSync(ctx.careerData).find((t) => fs.existsSync(path.join(ctx.careerData, t, 'people', principal, 'current')));
  if (!tenant) throw new Error('the test person has no Career folder yet');
  execFileSync('python3', ['-I', '-c', APPLY_PY, path.join(ctx.careerData, tenant, 'people', principal), JSON.stringify({ email: 'sam.example@example.com', phone: '555-010-0142' })], { stdio: 'pipe', timeout: 30000, cwd: os.tmpdir() });
  ctx.state.person.applyProfileWritten = true; save(ctx);
}
/** @description A new person has no Career store until Career's first run of theirs: made-up target titles and one manual score. */
async function ensureStore(ctx) {
  const ready = async () => { const stats = (await call(ctx, me(ctx), 'GET', '/api/career-hunter/jobs/stats')).body; return stats && stats.empty !== true; };
  if (await ready().catch(() => false)) return;
  await call(ctx, me(ctx), 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: ['Operations Coordinator', 'Office Coordinator', 'Office Manager'] } });
  await call(ctx, me(ctx), 'POST', '/api/career-hunter/run/score', { body: { limit: 1 }, accepted: [200, 202] });
  await until(ready, 300000, "the person's Career store");
}

const CORPUS_PY = `
import sqlite3, json, sys, datetime
corpus, action, p = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
c = sqlite3.connect(':memory:', timeout=60)
c.execute('ATTACH DATABASE ? AS corpus', (corpus,))
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
ids = [x['id'] for x in p['postings']]
marks = ','.join('?' * len(ids))
with c:
    if action == 'add':
        taken = c.execute('SELECT count(*) FROM corpus.postings_corpus WHERE id IN (%s)' % marks, ids).fetchone()[0]
        taken += c.execute('SELECT count(*) FROM corpus.companies WHERE id=? OR name=?', (p['company']['id'], p['company']['name'])).fetchone()[0]
        if taken: raise SystemExit('ids_taken')
        c.execute("INSERT INTO corpus.companies(id,name,domain,homepage,careers_url,discover_status,created_at) VALUES(?,?,?,?,?,'manual',?)",
                  (p['company']['id'], p['company']['name'], p['company']['domain'], p['company']['homepage'], p['company']['homepage'], now))
        for x in p['postings']:
            c.execute('INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,location,remote,url,description,posted_at,posted_date,target_role,first_seen_at,last_seen_at,active) VALUES(?,?,?,?,?,1,?,?,?,?,1,?,?,1)',
                      (x['id'], p['company']['id'], x['ats'], x['title'], 'Remote, United States', x['url'], p['description'], now, now[:10], now, now))
    else:
        c.execute('DELETE FROM corpus.postings_corpus WHERE company_id=? AND id IN (%s)' % marks, [p['company']['id'], *ids])
        c.execute('DELETE FROM corpus.companies WHERE id=? AND name=?', (p['company']['id'], p['company']['name']))
left = c.execute('SELECT count(*) FROM corpus.postings_corpus WHERE id IN (%s)' % marks, ids).fetchone()[0]
print(json.dumps({'action': action, 'postingsPresent': left}))
`;
/** @description Add or remove this run's stand-in company and postings in the slot's corpus, as a recorded maintenance edit. */
function corpus(ctx, action) {
  const record = ctx.state.corpus, file = path.join(ctx.careerData, 'corpus.db');
  const out = execFileSync('python3', ['-I', '-c', CORPUS_PY, file, action, JSON.stringify({ ...record, description: DESCRIPTION })], { encoding: 'utf8', timeout: 180000, cwd: os.tmpdir() });
  const result = JSON.parse(out.trim().split('\n').at(-1));
  privateWrite(path.join(record.maintenance, action === 'add' ? 'record.json' : 'removed.json'), { by: '@career-submit-proof', at: new Date().toISOString(),
    reason: 'Career submission proof: a stand-in employer and its postings for a made-up person on the test slot (no real job).', company: record.company,
    postings: record.postings, result, removeWith: `node career-hunter/tests/live/career-submit-proof.mjs remove --out ${ctx.out}` });
  return result;
}
/** @description One stand-in company and one posting per variant, each with its own run token in the address. */
function addJobs(ctx) {
  const n = randomInt(0, 99999), host = new URL(ctx.employer).hostname;
  ctx.state.corpus = { maintenance: path.join(ctx.careerData, 'maintenance', `submit-proof-${ctx.stamp}`),
    company: { id: 990000 + n, name: `Stand-in Employer (submission proof ${ctx.stamp})`, domain: host, homepage: ctx.employer },
    postings: ctx.variants.map((v, i) => { const run = `r${randomUUID().slice(0, 8)}`;
      return { variant: v, id: 990000000 + n * 10 + i, run, ats: `submit-proof-${ctx.stamp}-${v}`, title: `Operations Coordinator (stand-in ${v})`, url: `${ctx.employer}/${v}/${run}/apply` }; }) };
  ctx.state.corpusAdded = false; save(ctx);
  fs.mkdirSync(ctx.state.corpus.maintenance, { recursive: true, mode: 0o700 });
  const result = corpus(ctx, 'add');
  ctx.state.corpusAdded = true; save(ctx);
  say('stand-in postings added to the slot corpus', { ids: ctx.state.corpus.postings.map((p) => p.id), result });
}
/** @description Save the job, generate its packet with Career's own Generate, confirm a flagged cover letter the way the Send step does, read the packet. */
async function prepareJob(ctx, posting) {
  const id = posting.id, route = `/api/career-hunter/jobs/${id}`;
  await call(ctx, me(ctx), 'POST', `${route}/status`, { body: { favorite: true } });
  const bank = (await call(ctx, me(ctx), 'GET', '/api/career-hunter/experience-bank')).body;
  const since = Date.now();
  // 409 is Career busy with this person's previous run (its first score); anything else ends the wait.
  await until(() => call(ctx, me(ctx), 'POST', `${route}/generate`, { body: { experienceIds: [], experienceRevision: bank.revision, experienceChosen: true }, accepted: [202] })
    .then(() => true, (error) => { if (error.status === 409) return null; throw stop(message(error)); }), 600000, 'Career to accept Generate');
  const job = await until(async () => {
    const j = (await call(ctx, me(ctx), 'GET', route)).body.job, board = j.board || {};
    if (board.completedAt && Date.parse(board.completedAt) >= since && board.phase === 'failed') throw stop(`generation failed: ${board.error || 'unknown'}`);
    return board.completedAt && Date.parse(board.completedAt) >= since && board.phase === 'ready' && j;
  }, 20 * 60000, `the packet for job ${id}`);
  const claims = job.application && job.application.claims;
  if (claims && claims.needsReview) { await call(ctx, me(ctx), 'POST', `${route}/status`, { body: { applicationReview: { claims: claims.digest } } }); posting.claimsConfirmed = true; }
  const review = (await call(ctx, me(ctx), 'GET', `/api/career-hunter/submission-review/${id}`)).body;
  posting.packetDigest = review.packetDigest;
  posting.documents = review.documents.map((d) => ({ kind: d.kind, name: d.name, sha256: d.sha256, byteLength: d.byteLength }));
  posting.profileFields = Object.keys(review.profile || {});
  save(ctx);
  say('packet ready', { variant: posting.variant, id, documents: posting.documents.map((d) => `${d.name} ${d.byteLength} B`), claimsConfirmed: !!posting.claimsConfirmed });
}

/** @description Connect a computer the way Career's Connect a computer does: join code, join as browser-form-v1 with browse, bind to the Career browser bot. */
async function connectComputer(ctx) {
  const invite = (await call(ctx, me(ctx), 'POST', '/nodes/join-codes', { body: { capabilities: [], lifetime_ms: 300000 } })).body;
  const joined = (await call(ctx, '', 'POST', '/nodes/join', { body: { code: invite.code, kind: 'remote', harness: { custom: 'browser-form-v1' }, capabilities: { browse: true } } })).body;
  ctx.state.node = { id: joined.node.id, owner: joined.node.owner }; save(ctx);
  privateWrite(path.join(ctx.stateDir, 'device.json'), { version: 1, kernelUrl: ctx.origin, nodeId: joined.node.id, deviceToken: joined.token, botId: BOT, owner: joined.node.owner, tenant: joined.node.tenant });
  await call(ctx, me(ctx), 'POST', `/nodes/${joined.node.id}/bots/${BOT}`, { body: {} });
  say('computer connected', { node: joined.node.id, owner: joined.node.owner, harness: 'browser-form-v1' });
}
/** @description The device's own kernel profile, read with its own header credential (as the installer reads it). */
async function deviceProfile(ctx) {
  const device = JSON.parse(fs.readFileSync(path.join(ctx.stateDir, 'device.json'), 'utf8'));
  return (await call(ctx, '', 'GET', `/nodes/${device.nodeId}/profile`, { headers: { 'x-oshal-node-token': device.deviceToken } })).body;
}
/** @description Install the SECOND helper for this person with the shipped installer (its own unit, profile and work folder), start it and wait until the slot sees it ready. */
async function installHelper(ctx) {
  const releases = () => (fs.existsSync(path.join(HELPER_BASE, 'releases')) ? fs.readdirSync(path.join(HELPER_BASE, 'releases')) : []);
  ctx.state.helper = { releasesBefore: releases(), owner: ctx.state.node.owner, service: `oshal-career-browser-${ctx.state.node.owner}.service` };
  if (ctx.state.helper.owner === ROGERS_HELPER || ctx.state.helper.owner !== ctx.state.person.principal) throw new Error('the helper would not be the test person\'s');
  save(ctx);
  let out;
  try {
    out = execFileSync('python3', [path.join(CAREER, 'bin/install-browser-worker.py'), '--config', path.join(ctx.stateDir, 'device.json'),
      '--node-modules', path.join(HELPER_BASE, 'runtime-1.59.1/node_modules'), '--start'], { encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) { throw new Error(`installer refused: ${String(error.stderr || '').trim().split('\n').at(-1)}`); }
  const installed = JSON.parse(out.trim().split('\n').at(-1));
  Object.assign(ctx.state.helper, { service: installed.service, fingerprint: installed.fingerprint, started: installed.started, releasesAfter: releases() });
  save(ctx);
  const node = await until(async () => { const n = await deviceProfile(ctx); return n && n.status === 'connected' && n.work_ready === true
    && Array.isArray(n.generation) && Buffer.from(n.generation).toString('hex') === installed.fingerprint && n; }, 180000, 'the second helper to report ready');
  const workers = (await call(ctx, me(ctx), 'GET', '/api/apply-operator/workers')).body;
  const mine = (workers.workers || []).find((w) => String(w.id || w.clientId) === ctx.state.node.id);
  say('second helper ready', { service: installed.service, fingerprint: installed.fingerprint.slice(0, 12), harness: node.harness, boundBots: node.bound_bots, careerSees: mine ? { available: mine.available } : null });
}

/** @description --local: the stand-in over TLS for the one made-up name, behind a CONNECT tunnel that admits only that name. */
async function localEmployer(ctx) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'submit-proof-tls-')), key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  ctx.closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${LOCAL_NAME}`], { stdio: 'ignore' });
  const employer = await standin.start({ port: 0, log: ctx.standinLog, tls: { key: fs.readFileSync(key), cert: fs.readFileSync(cert) } });
  ctx.closers.push(() => employer.close());
  const sockets = new Set(), tunnel = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
  tunnel.on('connect', (req, socket, head) => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    if (req.url !== `${LOCAL_NAME}:443`) { socket.destroy(); return; }
    const upstream = net.connect(employer.port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
    sockets.add(upstream); upstream.on('error', () => socket.destroy()); socket.once('close', () => upstream.destroy());
  });
  await new Promise((resolve) => tunnel.listen(0, '127.0.0.1', resolve));
  ctx.closers.push(() => new Promise((resolve) => { for (const s of sockets) s.destroy(); tunnel.close(resolve); }));
  return tunnel.address().port;
}
/** @description --local: the helper library's own claim loop (bin/career-browser-worker.cjs) in this process, its Chromium reaching only the stand-in. */
async function localHelper(ctx) {
  const worker = require('../../lib/career-browser-worker');
  const deps = createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(STORE, 'scripts/toolchain'), 'package.json'));
  const { chromium } = deps('playwright'), version = deps('playwright/package.json').version;
  const device = JSON.parse(fs.readFileSync(path.join(ctx.stateDir, 'device.json'), 'utf8')), send = worker.client(device);
  const generation = [...Buffer.from(worker.fingerprint(version, chromium.executablePath()), 'hex')];
  const tunnelPort = await localEmployer(ctx), root = worker.privateDirectory(path.join(ctx.stateDir, 'local-helper-work'));
  const browser = await chromium.launch({ headless: true, proxy: { server: `http://127.0.0.1:${tunnelPort}` } });
  ctx.closers.push(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'block', ignoreHTTPSErrors: true, acceptDownloads: false, viewport: { width: 1280, height: 900 } });
  await context.route('**/*', (route) => (new URL(route.request().url()).hostname === LOCAL_NAME ? route.fallback() : route.abort('blockedbyclient')));
  await send('heartbeat', { generation });
  const beat = setInterval(() => send('heartbeat', { generation }).catch(() => {}), 10000);
  ctx.closers.push(() => clearInterval(beat));
  const state = { stopped: false };
  ctx.closers.push(() => { state.stopped = true; });
  (async () => {
    while (!state.stopped) {
      try {
        await worker.recover(send, root);
        const { envelope } = await send('claim', { bot: BOT });
        if (envelope) { const done = await worker.execute(send, envelope, context, { generation, root }); say('local helper finished one', { status: done.status, actions: done.actions }); }
        else await wait(1000);
      } catch (error) { if (!state.stopped) say('local helper waiting', { code: message(error) }); await wait(2000); }
    }
  })();
  await until(async () => (await deviceProfile(ctx)).work_ready === true, 60000, 'the local helper to report ready');
  say('local helper ready', { generation: Buffer.from(generation).toString('hex').slice(0, 12), employer: `https://${LOCAL_NAME} through an exact-name tunnel` });
}

/** @description The public name serves THIS stand-in from a public address, to a plain client and to headless Chromium alike, before anything is approved. */
async function checkPublic(ctx, employer) {
  const name = new URL(ctx.employer).hostname, addresses = await dns.lookup(name, { all: true }).catch(() => []);
  const privateAddress = (a) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.)/.test(a) || /^(::1|f[cd]|fe80)/i.test(a);
  if (!addresses.length || addresses.some((a) => privateAddress(a.address))) throw new Error(`${name} does not resolve to public addresses only (the helper refuses anything else)`);
  const probe = `probe-${randomUUID().slice(0, 8)}`, seen = () => employer.events.filter((e) => e.run === probe).length;
  const response = await fetch(`${ctx.employer}/a/${probe}/apply`, { redirect: 'error', headers: { 'user-agent': 'curl/8.5.0' }, signal: AbortSignal.timeout(20000) });
  if (response.status !== 200 || !/Stand-in Employer/.test(await response.text()) || seen() !== 1) throw new Error(`${ctx.employer} does not reach this stand-in (HTTP ${response.status}, ${seen()} requests seen here)`);
  const deps = createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(STORE, 'scripts/toolchain'), 'package.json'));
  const browser = await deps('playwright').chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.goto(`${ctx.employer}/b/${probe}/apply`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const words = await page.locator('body').innerText();
    if (!/Step 1 of 2/.test(words) || seen() !== 2) throw new Error(`headless Chromium does not get the stand-in's page at ${ctx.employer} (a challenge page in front of it?)`);
  } finally { await browser.close(); }
  say('public name reaches this stand-in', { name, addresses: addresses.map((a) => a.address), plainClient: 'ok', headlessChromium: 'ok' });
}
/** @description Public mode: the stand-in on the agreed local port, then the public name checked against it. */
async function publicEmployer(ctx) {
  const employer = await standin.start({ port: Number(opt('standin-port', '47931')), host: opt('standin-host', '127.0.0.1'), log: ctx.standinLog });
  ctx.closers.push(() => employer.close());
  say('stand-in listening', { host: opt('standin-host', '127.0.0.1'), port: employer.port });
  await checkPublic(ctx, employer);
}

/** @description Approve & submit one job through Career's three routes, wait for the outcome, and read the ticket, the job, the pictures and the stand-in log. */
async function submitOne(ctx, posting) {
  const q = '/api/career-hunter/submission-queue', sub = posting.submission = {};
  const approved = (await call(ctx, me(ctx), 'POST', q, { body: { postingId: posting.id, packetDigest: posting.packetDigest, approved: true } })).body;
  sub.id = approved.item.id; save(ctx);
  sub.ticket = (await call(ctx, me(ctx), 'POST', `${q}/${sub.id}/bind`, { body: {} })).body.item.nativeTicketId; save(ctx);
  sub.work = (await call(ctx, me(ctx), 'POST', `${q}/${sub.id}/start`, { body: {} })).body.item.nativeWorkId; save(ctx);
  const started = Date.now();
  const item = await until(async () => { const i = (await call(ctx, me(ctx), 'POST', `${q}/${sub.id}/sync`, { body: {} })).body.item; return TERMINAL.has(i.status) && i; }, 6 * 60000, `the outcome of ${posting.variant}`);
  sub.seconds = Math.round((Date.now() - started) / 1000);
  const ticket = ((await call(ctx, me(ctx), 'GET', `/tickets/${sub.ticket}`, { accepted: [200, 403, 404] })).body || {}).ticket || {};
  const job = (await call(ctx, me(ctx), 'GET', `/api/career-hunter/jobs/${posting.id}`)).body.job;
  const pictures = await savePictures(ctx, posting, item);
  const log = fs.existsSync(ctx.standinLog) ? fs.readFileSync(ctx.standinLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.run === posting.run) : [];
  Object.assign(sub, { status: item.status, reason: item.reason || null, presses: (item.presses || []).map((p) => ({ step: p.step, kind: p.kind, label: p.label, result: p.result })),
    ticket: { id: sub.ticket, ...pick(ticket, ['kind', 'status', 'statusLabel', 'position', 'phaseLabel', 'revision']) },
    job: { status: job.status, applicationSource: job.application_source || null, confirmation: !!job.confirmation_path, applicationTask: job.application_task_id || null },
    pictures, employer: log.map((e) => ({ method: e.method, path: e.path.replace(posting.run, ':run'), fields: e.fields, files: e.files })) });
  save(ctx);
  return verdict(posting, ctx.unexposed);
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
/** @description The retained pictures Career serves for this submission, each checked against its digest and kept in the evidence folder. */
async function savePictures(ctx, posting, item) {
  const q = `/api/career-hunter/submission-queue/${item.id}`, kept = [];
  const keep = async (route, name, digest) => {
    const got = await call(ctx, me(ctx), 'GET', route, { raw: true });
    if (got.status !== 200) return kept.push({ name, status: got.status });
    const sha = createHash('sha256').update(got.bytes).digest('hex');
    fs.writeFileSync(path.join(ctx.out, `${posting.variant}-${name}`), got.bytes, { mode: 0o600 });
    kept.push({ name, bytes: got.bytes.length, sha256: sha, matches: digest ? sha === digest : null });
  };
  if (item.status === 'submitted') await keep(`${q}/confirmation`, 'confirmation.png', item.confirmationSha256);
  for (const p of item.presses || []) if (p.afterSha256) await keep(`${q}/press-picture/${p.step}`, `press-${p.step}.png`, p.afterSha256);
  if (item.outcomeFile || item.outcomeSha256) await keep(`${q}/outcome-picture`, 'outcome.png', item.outcomeSha256);
  return kept;
}
/** @description Expected against seen, per variant: status, POSTs, documents equal to the approved packet's, ticket, job and picture. */
function verdict(posting, unexposed) {
  const want = unexposed ? { status: 'needs_you', posts: 0, kinds: [] } : EXPECT[posting.variant], sub = posting.submission, posts = sub.employer.filter((e) => e.method === 'POST'), problems = [];
  if (sub.status !== want.status) problems.push(`outcome ${sub.status}, wanted ${want.status} (${sub.reason || 'no reason'})`);
  if (posts.length !== want.posts) problems.push(`${posts.length} POSTs at the stand-in, wanted ${want.posts}`);
  if (JSON.stringify(sub.presses.map((p) => p.kind)) !== JSON.stringify(want.kinds)) problems.push(`presses ${sub.presses.map((p) => p.kind).join(',') || 'none'}, wanted ${want.kinds.join(',')}`);
  if (want.posts === 1 && posts.length === 1) {
    const digest = (kind) => (posting.documents.find((d) => d.kind === kind) || {}).sha256, sent = (field) => (posts[0].files.find((f) => f.field === field) || {}).sha256;
    if (sent('resume') !== digest('resume')) problems.push('the résumé the stand-in received differs from the approved packet');
    if (sent('cover_letter') !== digest('cover')) problems.push('the cover letter the stand-in received differs from the approved packet');
  }
  if (want.status === 'submitted') {
    if (sub.job.status !== 'applied' || sub.job.applicationSource !== 'worker-reported') problems.push(`the job reads ${sub.job.status}/${sub.job.applicationSource}, wanted applied/worker-reported (Sent)`);
    if (!sub.pictures.some((p) => p.name === 'confirmation.png' && p.matches === true)) problems.push('no digest-checked confirmation picture');
  }
  const result = { variant: posting.variant, pass: problems.length === 0, problems, status: sub.status, reason: sub.reason, seconds: sub.seconds, presses: sub.presses,
    ticket: sub.ticket, job: sub.job, posts: posts.map((p) => ({ path: p.path, fields: p.fields, files: p.files })), packet: posting.documents, pictures: sub.pictures };
  say('verdict', result);
  return result;
}

/** @description Remove everything this run made, in reverse; each step is attempted and reported, none stops the rest. */
async function removeAll(ctx) {
  const done = [], step = async (name, fn) => { try { const r = await fn(); if (r !== false) done.push(name); } catch (error) { say('remove step failed', { name, message: message(error) }); } };
  const s = ctx.state;
  await step('helper unit and its files', () => removeHelper(ctx));
  await step('open native tickets cancelled', () => cancelOpen(ctx));
  await step('node', async () => { if (!s.node || !me(ctx)) return false; await call(ctx, me(ctx), 'DELETE', `/api/computers/${s.node.id}`, { accepted: [200, 204, 404] }); s.node.removed = true; save(ctx); });
  await step('stand-in postings', () => { if (!s.corpus || !s.corpusAdded) return false; const r = corpus(ctx, 'remove'); if (r.postingsPresent) throw new Error('postings still present'); s.corpusAdded = false; save(ctx); });
  await step('grants', async () => { if (!s.grants || !s.person) return false; for (const held of s.grants) await grant(ctx, held, 'revoke'); s.grants = []; save(ctx); });
  await step('person erased', () => erasePerson(ctx));
  await step('credentials deleted', () => { for (const f of ['person.json', 'device.json']) fs.rmSync(path.join(ctx.stateDir, f), { force: true }); fs.rmSync(path.join(ctx.stateDir, 'local-helper-work'), { recursive: true, force: true }); });
  s.removed = { at: new Date().toISOString(), done }; save(ctx);
  say('removed', { done, nodeRecords: nodeRecords(ctx) });
}
/** @description Stop and delete the second helper: its unit, its person folder, and a program release only this run added. Never Roger's. */
function removeHelper(ctx) {
  const h = ctx.state.helper;
  if (!h) return false;
  if (h.owner === ROGERS_HELPER || h.owner !== ctx.state.person.principal || h.service !== `oshal-career-browser-${h.owner}.service`) throw new Error('refusing: not the test person\'s helper');
  const unit = path.join(os.homedir(), '.config/systemd/user', h.service);
  execFileSync('systemctl', ['--user', 'disable', '--now', h.service], { stdio: 'ignore' }); fs.rmSync(unit, { force: true });
  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  try { execFileSync('systemctl', ['--user', 'reset-failed', h.service], { stdio: 'ignore' }); } catch { /* nothing failed */ }
  fs.rmSync(path.join(HELPER_BASE, 'people', h.owner), { recursive: true, force: true });
  for (const release of (h.releasesAfter || []).filter((r) => !(h.releasesBefore || []).includes(r))) {
    const dir = path.join(HELPER_BASE, 'releases', release);
    execFileSync('chmod', ['-R', 'u+w', dir]); fs.rmSync(dir, { recursive: true, force: true });
  }
  h.removed = true; save(ctx);
}
/** @description A submission that never reached an outcome has its native ticket cancelled, so nothing is left to claim. */
async function cancelOpen(ctx) {
  const open = (ctx.state.corpus ? ctx.state.corpus.postings : []).map((p) => p.submission).filter((s) => s && s.ticket && !TERMINAL.has(s.status));
  if (!open.length || !me(ctx)) return false;
  for (const sub of open) {
    const proof = (await call(ctx, me(ctx), 'POST', '/confirmations', { body: {} })).body.confirmation;
    await call(ctx, me(ctx), 'POST', `/tickets/${typeof sub.ticket === 'string' ? sub.ticket : sub.ticket.id}/cancel`, { headers: { 'x-oshal-confirm': proof }, accepted: [200, 404, 409] });
  }
}
/** @description Sign the person out everywhere, erase the account and its data, check its credential is refused, and clear its Career folder. */
async function erasePerson(ctx) {
  const p = ctx.state.person;
  if (!p || !p.principal) return false;
  if (me(ctx)) await call(ctx, me(ctx), 'POST', '/api/auth/signout-everywhere', { body: {}, accepted: [200, 204, 401, 403] }).catch(() => null);
  const proof = (await call(ctx, ctx.admin, 'POST', '/confirmations', { body: {} })).body.confirmation;
  const erased = (await call(ctx, ctx.admin, 'DELETE', `/people/${p.principal}`, { headers: { 'x-oshal-confirm': proof }, accepted: [200, 404] })).body;
  p.erased = erased ? pick(erased, ['status', 'account', 'revoked']) : 'not found';
  if (me(ctx)) p.tokenAfter = (await call(ctx, me(ctx), 'GET', '/api/authorization/me', { accepted: [200, 401, 403] })).status;
  for (const tenant of fs.readdirSync(ctx.careerData)) {
    const dir = path.join(ctx.careerData, tenant, 'people', p.principal);
    if (/^[a-f0-9-]{36}$/.test(p.principal) && fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); p.careerFolderRemoved = true; }
  }
  save(ctx);
  if (p.tokenAfter === 200) throw new Error('the person\'s credential still answers');
}
/** @description Read-only: rows for this run's node in each slot's kernel records (the two slots copy device records both ways). */
function nodeRecords(ctx) {
  if (!ctx.state.node) return null;
  const id = ctx.state.node.id;
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const count = (container) => { try { return execFileSync('docker', ['exec', container, 'psql', '-U', 'kernel', '-d', 'kernel', '-At', '-c', `select collection||':'||count(*) from documents where id='${id}' group by collection`], { encoding: 'utf8', timeout: 30000 }).trim().split('\n').filter(Boolean); } catch { return 'unreadable'; } };
  return { testSlot: count('oshal-kernel-pg-green'), production: count('oshal-kernel-pg') };
}

/** @description The run's context: the slot, its credential, the evidence folder and its private state. */
function context() {
  const envFile = opt('env', path.join(os.homedir(), '.local/state/oshal-native-green/oshald.env'));
  const { origin, careerData } = slot(opt('slot', 'http://127.0.0.1:38798'), envFile);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const out = path.resolve(opt('out', path.join(os.homedir(), '.local/state/oshal-proofs', `career-submit-proof-${stamp}`)));
  const stateDir = path.join(out, 'state');
  const saved = fs.existsSync(path.join(stateDir, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8')) : null;
  const person = fs.existsSync(path.join(stateDir, 'person.json')) ? JSON.parse(fs.readFileSync(path.join(stateDir, 'person.json'), 'utf8')) : null;
  const ctx = { origin, careerData, out, stateDir, admin: envValue(envFile, 'OSHAL_ADMIN_TOKEN'), person, closers: [], standinLog: path.join(out, 'stand-in.jsonl'),
    stamp: saved ? saved.stamp : stamp, state: saved || { stamp, mode: flag('local') ? 'local' : 'public' } };
  if (!ctx.admin) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  ctx.local = ctx.state.mode === 'local';
  ctx.unexposed = !ctx.local && (flag('unexposed') || ctx.state.unexposed === true);
  ctx.state.unexposed = ctx.unexposed;
  ctx.employer = ctx.local ? `https://${LOCAL_NAME}` : (saved && saved.employer) || (/^https:\/\//.test(opt('employer', '')) ? new URL(opt('employer')).origin : '');
  if (!ctx.local && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(ctx.employer)) throw new Error('--employer must be the stand-in\'s public https name (or use --local)');
  ctx.state.employer = ctx.employer;
  ctx.variants = (saved && saved.variants) || opt('variants', 'a,b,c').split(',').filter((v) => EXPECT[v]);
  ctx.state.variants = ctx.variants;
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 }); fs.chmodSync(out, 0o700); fs.chmodSync(stateDir, 0o700);
  return ctx;
}
/** @description `all`: employer, person, postings and packets, computer, helper, then each variant; removal always follows unless --keep. */
async function all(ctx) {
  const results = [];
  try {
    if (!ctx.local && !ctx.unexposed) await publicEmployer(ctx);
    if (ctx.unexposed && (await dns.lookup(new URL(ctx.employer).hostname).then(() => true, () => false))) throw new Error('--unexposed needs a name that does not resolve yet');
    await newPerson(ctx);
    addJobs(ctx);
    for (const posting of ctx.state.corpus.postings) await prepareJob(ctx, posting);
    await connectComputer(ctx);
    if (ctx.local) await localHelper(ctx); else await installHelper(ctx);
    for (const posting of ctx.state.corpus.postings) results.push(await submitOne(ctx, posting));
  } catch (error) {
    say('stopped', { message: message(error) });
    results.push({ pass: false, problems: [message(error)] });
  } finally {
    for (const close of ctx.closers.reverse()) await Promise.resolve().then(close).catch(() => {});
    if (!flag('keep')) await removeAll(ctx);
    const receipt = { at: new Date().toISOString(), slot: ctx.origin, mode: ctx.unexposed ? 'unexposed' : ctx.state.mode, employer: ctx.employer, person: ctx.state.person && ctx.state.person.subject,
      pass: results.length === ctx.variants.length && results.every((r) => r.pass), results, removed: ctx.state.removed || null };
    privateWrite(path.join(ctx.out, 'receipt.json'), receipt);
    say('receipt', { file: path.join(ctx.out, 'receipt.json'), pass: receipt.pass });
    process.exitCode = receipt.pass ? 0 : 1;
  }
}

try {
  if (!['all', 'remove', 'check'].includes(MODE)) throw new Error('usage: all --employer https://<name> | all --local | check --employer https://<name> | remove --out <folder> (see the file header)');
  const ctx = context();
  if (MODE === 'all') await all(ctx);
  else if (MODE === 'remove') await removeAll(ctx);
  else {
    try { await publicEmployer(ctx); } finally {
      for (const close of ctx.closers.reverse()) await Promise.resolve().then(close).catch(() => {});
      fs.rmSync(ctx.stateDir, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(`career-submit-proof: ${message(error)}`);
  process.exitCode = 1;
}
