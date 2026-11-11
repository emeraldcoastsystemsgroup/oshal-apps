/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Master record's run on bare-metal blue (1.51.0), driven by tests/career-master-record-live-proof.mjs blue. Loopback kernel only; the administrator credential is read by name and never printed; the browser gets a cookie session made from the test person's token, never a header. A throwaway person named guest-… is seeded through Career's own guest-seed route (the bundled made-up profile), given one skill holding semicolons through Career's master save and one library entry; then the page at both sizes, Resume Studio's More item, the rail's save-before-send and Save to master resume, and the Career bot asked for everything. Every session is signed out, the grants revoked and the person deactivated.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The test person's made-up résumé arrives through Resume Studio's own upload on the page and Career's real indexing, now that the upload works on the native kernel; the headline is emptied and the semicolon skill added through Career's master save, so the Word document shows the credential line in place of the headline.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: the status under the document reads "master résumé" with its accents on a build that has the change and without them on one that does not; the two status checks accept either.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { playwright } from './ux-page.mjs';

const MASTER_LINK = '/cockpit/?app=career-hunter&screen=career-master-record';
const STUDIO_LINK = '/cockpit/?app=career-hunter&screen=career-resume-studio';
const CAREER_BOT = 'cb000000-0000-0000-0000-000000000001';
const SEMICOLON_SKILL = 'Agile delivery; Scrum ceremonies; SAFe release trains (made up)';
const ASK = 'give me every bullet and skill with the addendum history';
const RESUME = `Sam Example, PMP, CSM
Senior Program Manager | Testville, USA | sam.example@example.com

SUMMARY
Program manager with eleven years running platform programs for product teams (a made-up résumé for a test).

EXPERIENCE
Senior Program Manager, Example Platforms Inc, 2019-04 to present
- Led a 40-engineer platform program from plan to launch in nine months.
- Cut release lead time from six weeks to two with a staged rollout process.
- Ran quarterly planning across five teams and three time zones.

Program Manager, Sample Logistics Co, 2014-08 to 2019-03
- Delivered a warehouse routing system used in 30 sites.
- Built the vendor scorecard that reduced late shipments by 18%.

SKILLS
Delivery: Agile delivery, Scrum, Kanban
Tools: Jira, Confluence, Smartsheet

EDUCATION
B.S. Industrial Engineering, Example State University, 2014
`;
const SIZES = { desktop: { viewport: { width: 1280, height: 900 } }, phone: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } };
const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16) : null);
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

async function until(check, ms, label) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await Promise.resolve().then(check).catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await wait(500);
  }
}

/** Blue only: every request goes to the loopback kernel, and a failure names the method, route and status, nothing else. */
function kernelClient() {
  const kernel = new URL(process.env.OSHAL_PROOF_KERNEL || 'http://127.0.0.1:38798').origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(kernel)) throw new Error('the live proof runs only against a loopback kernel');
  const envFile = process.env.OSHAL_PROOF_ENV_FILE || path.join(os.homedir(), '.local/state/oshal-native-green/oshald.env');
  const line = fs.readFileSync(envFile, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('blue has no administrator credential in its env file');
  const admin = line.slice('OSHAL_ADMIN_TOKEN='.length).replace(/^(['"])(.*)\1$/, '$2');
  async function http(credential, method, route, body, accepted = [200], headers = {}) {
    const url = new URL(route, kernel);
    if (url.origin !== kernel) throw new Error('refusing a request outside blue');
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(240000),
      headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    if (!accepted.includes(response.status)) {
      throw new Error(`${method} ${route.split('?')[0].replace(/\/people\/invitations\/[^/]+\/accept/, '/people/invitations/:private/accept')}: ${response.status}`);
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    return { status: response.status, bytes: Buffer.byteLength(text), body: parsed };
  }
  return { kernel, admin, http };
}

async function grant(k, person, app, role, action = 'assign', held) {
  const assignment = held || { id: `master-record-proof-${randomUUID()}`, app, role };
  const catalog = (await k.http(k.admin, 'GET', '/api/authorization/composites')).body;
  const input = { target: person.id, assignment_id: assignment.id, action, expected_revision: catalog.revision,
    reason: 'Career master record proof (test person)', idempotency_key: randomUUID(),
    ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app, role } }) };
  const preview = (await k.http(k.admin, 'POST', '/api/authorization/composites/preview', input)).body;
  if (action !== 'revoke') input.expected_plan_revision = preview.plan_revision;
  await k.http(k.admin, 'POST', '/api/authorization/composites/apply', input);
  return assignment;
}

/** A throwaway test person with Career and AI Office. */
async function testPerson(k, state) {
  const subject = `career-master-record-proof-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await k.http(k.admin, 'POST', '/people/invitations', { invitee: subject, tier: 'editor', lifetime_ms: 3600000 })).body;
  const accepted = (await k.http('', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { subject })).body;
  state.person = { id: accepted.principal, token: accepted.token, subject };
  say('test person', { subject, principal: state.person.id });
  for (const [app, role] of [['career-hunter', 'member'], ['presentations', 'editor']]) state.grants.push(await grant(k, state.person, app, role));
  for (const app of ['career-hunter', 'presentations']) await k.http(state.person.token, 'POST', `/packages/${app}/schema`, {}, [200]);
  say('access', { grants: state.grants.map((g) => `${g.app}:${g.role}`) });
}

/** The made-up résumé through Resume Studio's own upload on the page, then Career's real indexing to its end. */
async function uploadThroughPage(k, context, person) {
  const page = await context.newPage(), started = Date.now();
  const studio = await openScreen(k, page, STUDIO_LINK, /\/api\/career-hunter\/resume-studio/, 'Resume Studio');
  await until(() => studio.evaluate(() => { const b = document.getElementById('uploadBtn'); return b && b.getClientRects().length > 0; }), 60000, 'the upload in the empty state');
  const answered = page.waitForResponse((r) => /\/api\/career-hunter\/resume\/upload/.test(r.url()), { timeout: 60000 });
  await studio.setInputFiles('#resumeFile', { name: 'sam-example-resume.txt', mimeType: 'text/plain', buffer: Buffer.from(RESUME) });
  const upload = (await answered).status();
  let state = null;
  await until(async () => {
    state = (await k.http(person.token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error(`indexing failed: ${String(state.ingest.error || '').slice(0, 160)}`);
    return state && state.hasResume === true;
  }, 600000, 'Career indexing the uploaded résumé').catch((error) => { throw new Error(`${error.message}; last ingest state ${JSON.stringify(state && state.ingest)}`); });
  say('uploaded through the page', { file: 'sam-example-resume.txt (made up)', uploadStatus: upload,
    indexedSeconds: Math.round((Date.now() - started) / 1000), ingest: state && state.ingest && state.ingest.state });
  await page.close();
}

/** An empty headline and one skill holding semicolons, both through Career's own master save, and one library entry. */
async function prepare(k, person) {
  const api = '/api/career-hunter';
  const doc = (await k.http(person.token, 'GET', `${api}/resume/doc?id=master`)).body;
  const saved = (await k.http(person.token, 'POST', `${api}/resume/save`, { postingId: 'master',
    resume: { ...doc.resume, headline: '', skills: [...(doc.resume.skills || []), SEMICOLON_SKILL] } })).body;
  const bank = (await k.http(person.token, 'GET', `${api}/experience-bank`)).body;
  await k.http(person.token, 'POST', `${api}/experience-bank`, { operation: 'save', expectedRevision: bank.revision, entry: {
    title: 'Volunteer robotics coach (made up)', kind: 'volunteer', organization: 'Example Youth League', period: '2021 to present',
    facts: 'Coached a made-up team of 12 students through two regional robotics seasons.', skills: ['Coaching', 'Robotics'] } });
  const after = (await k.http(person.token, 'GET', `${api}/resume/doc?id=master`)).body;
  say('prepared', { masterSave: { changed: saved.changed, changelog: saved.changelog }, roles: (doc.resume.experience || []).length,
    bulletsIndexed: (doc.resume.experience || []).reduce((n, role) => n + (role.bullets || []).length, 0),
    documentHeadlineAfterSave: after.resume.headline ? 'shows a line (the credential line stands in for the empty headline)' : 'empty' });
}

/** The record and its concierge pages as the person: every page at most 12 KB and together the Markdown. */
async function recordAndPages(k, person) {
  const whole = (await k.http(person.token, 'GET', '/api/career-hunter/master-record')).body, pages = [];
  for (let n = 1; ; n += 1) {
    const p = await k.http(person.token, 'GET', `/api/career-hunter/master-record?page=${n}`, undefined, [200, 404]);
    if (p.status === 404) break;
    pages.push(p);
  }
  say('record', { counts: whole.counts, pages: pages.length, largestPageBytes: Math.max(...pages.map((p) => p.bytes)),
    pagesJoinedEqualDownload: pages.map((p) => p.body.text).join('') === whole.markdown });
  return whole;
}

/** A browser context signed in as the person by a cookie session; the bearer never enters the browser. */
async function signIn(k, browser, person, size, sessions) {
  const context = await browser.newContext({ ...SIZES[size], acceptDownloads: true });
  const response = await context.request.post(`${k.kernel}/sessions`, { data: { token: person.token } });
  if (response.status() !== 201) throw new Error(`sign-in answered ${response.status()}`);
  const issued = await response.json();
  if (issued.principal !== person.id) throw new Error('sign-in made another principal');
  sessions.push(issued.session);
  return context;
}

const frameOf = (page, pattern) => page.frames().find((frame) => pattern.test(frame.url()));

async function openScreen(k, page, link, pattern, label) {
  await page.goto(k.kernel + link, { waitUntil: 'domcontentloaded' });
  return until(async () => { const f = frameOf(page, pattern); return f && (await f.evaluate(() => document.readyState === 'complete')) && f; }, 90000, label);
}

/** The page at one size: bullets and dates on screen, no sideways scroll, Download's file, Print in More. */
async function masterRecordPage(k, context, size, record, out) {
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(message(error).slice(0, 160)));
  const frame = await openScreen(k, page, MASTER_LINK, /\/api\/career-hunter\/master-record-ui/, 'the Master record screen');
  await frame.locator('#counts').waitFor({ timeout: 60000 });
  const bullets = record.experience.flatMap((role) => role.bullets), dates = record.history.map((h) => h.when);
  const shown = async (items, find) => (await Promise.all(items.map((item) => find(item).first().isVisible()))).filter(Boolean).length;
  const facts = { bullets: bullets.length, bulletsShown: await shown(bullets, (b) => frame.getByText(b, { exact: true })),
    historyDates: dates.length, historyDatesShown: await shown(dates, (d) => frame.getByRole('heading', { name: new RegExp(`^${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })),
    sideways: await frame.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth),
    primary: await frame.locator('.ck-primary').allInnerTexts() };
  await page.screenshot({ path: path.join(out, `${size}-master-record.png`) });
  const [download] = await Promise.all([page.waitForEvent('download'), frame.getByRole('button', { name: 'Download' }).click()]);
  const file = path.join(out, `${size}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const md = fs.readFileSync(file, 'utf8'), wanted = [...bullets, ...record.skills.flatMap((g) => g.items), ...dates];
  const unstamped = (text) => text.replace(/^Everything Career keeps for you, read .*$/m, '');
  facts.download = { name: download.suggestedFilename(), bytes: md.length, missing: wanted.filter((item) => !md.includes(item)).length,
    equalsRecordApartFromReadTime: unstamped(md) === unstamped(record.markdown) };
  await frame.evaluate(() => { window.printed = 0; window.print = () => { window.printed += 1; }; });
  await frame.getByRole('button', { name: 'More' }).click();
  const print = frame.getByRole('menuitem', { name: 'Print or save as PDF' });
  facts.printInMore = await print.isVisible();
  await page.screenshot({ path: path.join(out, `${size}-master-record-more.png`) });
  await print.click();
  facts.printCalled = (await frame.evaluate(() => window.printed)) === 1;
  facts.pageErrors = errors;
  say(`${size} master record page`, facts);
  await page.close();
}

/** Resume Studio's More menu names the Master record and opens it. */
async function moreItem(k, context) {
  const page = await context.newPage(), studio = await openScreen(k, page, STUDIO_LINK, /\/api\/career-hunter\/resume-studio/, 'Resume Studio');
  await studio.getByRole('button', { name: 'More' }).first().click();
  const item = studio.getByRole('menuitem', { name: 'Master record (everything saved)' }), shown = await item.isVisible();
  await item.click();
  const opened = Boolean(await until(() => frameOf(page, /\/api\/career-hunter\/master-record-ui/), 30000, 'the Master record from More').catch(() => null));
  say('resume studio more item', { shown, opensMasterRecord: opened });
  await page.close();
}

/** The person's published Career generation on blue's host (made-up data only). */
function personStore(person) {
  const root = process.env.OSHAL_PROOF_DATA || path.join(os.homedir(), '.local/state/oshal-native-green/data/career');
  for (const tenant of fs.readdirSync(root)) {
    const owner = path.join(root, tenant, 'people', person.id), current = path.join(owner, 'current');
    if (fs.existsSync(current)) return path.join(owner, 'generations', fs.readFileSync(current, 'utf8').trim());
  }
  throw new Error('the test person has no published Career generation');
}

function storeState(dir) {
  const backups = path.join(dir, 'backups');
  return { master: sha(path.join(dir, 'career_db.json')), history: sha(path.join(dir, 'enrichment_log.jsonl')),
    snapshots: fs.existsSync(backups) ? fs.readdirSync(backups).sort().join(',') : '' };
}

/** S2 on blue: the rail's save-before-send (the same beginDocumentHandoff call the rail makes), then Save to master resume. */
async function saveChangesNothing(k, context, person, name, out) {
  const page = await context.newPage(), saves = [], before = storeState(personStore(person));
  page.on('request', (request) => { if (/\/api\/career-hunter\/resume\/save/.test(request.url())) saves.push(request.method()); });
  const studio = await openScreen(k, page, STUDIO_LINK, /\/api\/career-hunter\/resume-studio/, 'Resume Studio');
  await until(() => frameOf(page, /\/api\/presentations\/editor\/app/), 120000, 'the master as a Word document');
  const status = () => studio.evaluate(() => document.getElementById('status').textContent.trim());
  const onOpen = await until(async () => { const t = await status(); return /master r[ée]sum[ée]/i.test(t) && t; }, 90000, 'the document status');
  const office = frameOf(page, /\/api\/presentations\/editor\/app/);
  await until(() => office.evaluate((who) => document.readyState === 'complete' && document.body.innerText.includes(who), name), 90000, 'the document text');
  // A person presses Send once the document shows; AI Office refuses a save while it is still busy, so press again a moment later.
  let handoff = null;
  for (let press = 1; !handoff; press += 1) {
    handoff = await page.evaluate(async () => {
      const { beginDocumentHandoff } = await import('/shared/ui/js/document-handoff.js');
      try {
        const { context: given } = await beginDocumentHandoff({ app: 'career-hunter' });
        return { recordId: given && given.recordId, office: Boolean(given && given.fields && given.fields.officeDocument) };
      } catch (error) { if (/current action to finish/.test(error.message)) return null; return { error: error.message }; }
    });
    if (handoff && handoff.error) throw new Error(`the rail's save-before-send: ${handoff.error}`);
    if (handoff) handoff.presses = press;
    else if (press >= 30) throw new Error('the rail\'s save-before-send: AI Office stayed busy for 60 s');
    else await wait(2000);
  }
  const afterRail = await status();
  await studio.locator('#save').click();
  const afterSave = await until(async () => { const t = await status(); return /^(Matches|Saved to) your master r[ée]sum[ée]/.test(t) && t; }, 90000, 'Save to master resume');
  await page.screenshot({ path: path.join(out, 'desktop-resume-studio-after-save.png') });
  await wait(1500);
  const after = storeState(personStore(person));
  say('save changes nothing', { statusOnOpen: onOpen, railHandoff: handoff, statusAfterRailSave: afterRail, statusAfterSave: afterSave,
    masterSaveRequests: saves.length, masterUnchanged: before.master === after.master, historyUnchanged: before.history === after.history,
    snapshotsUnchanged: before.snapshots === after.snapshots });
  await page.close();
}

/** The Career bot asked for everything, as the person, on the route the rail and the Concierge use. */
async function askCareer(k, person) {
  const started = Date.now();
  const answer = await k.http(person.token, 'POST', `/api/swarm/bots/${CAREER_BOT}/ask`, { message: ASK, sessionId: randomUUID() }, [200, 202]);
  const body = answer.body || {}, json = JSON.stringify(body);
  const reply = String(body.response || body.reply || body.answer || body.text || '');
  say('career bot asked for everything', { status: answer.status, seconds: Math.round((Date.now() - started) / 100) / 10,
    toolNamedInAnswer: json.includes('career_master_record'), linksMasterRecord: json.includes('screen=career-master-record'),
    keys: Object.keys(body).slice(0, 16), reply: reply.slice(0, 900) });
}

async function cleanUp(k, state) {
  let signedOut = 0;
  for (const session of state.sessions) {
    try { await k.http(session, 'DELETE', '/sessions', undefined, [200, 204]); await k.http(session, 'GET', '/api/authorization/me', undefined, [401, 403]); signedOut += 1; }
    catch (error) { say('sign-out failed', { message: message(error) }); }
  }
  say('signed out', { sessions: state.sessions.length, signedOut });
  if (!state.person) return;
  for (const held of state.grants) await grant(k, state.person, held.app, held.role, 'revoke', held).catch((error) => say('revoke failed', { message: message(error) }));
  try {
    const confirmation = (await k.http(k.admin, 'POST', '/confirmations', {})).body;
    const done = (await k.http(k.admin, 'POST', `/people/${state.person.id}/deactivate`, {}, [200], { 'x-oshal-confirm': confirmation.confirmation })).body;
    await k.http(state.person.token, 'GET', '/api/authorization/me', undefined, [401, 403]);
    say('test person deactivated', { status: done && done.status, grantsRevoked: state.grants.length });
  } catch (error) { say('deactivate failed', { message: message(error) }); }
}

/**
 * @description The whole blue run; see the CHANGE LOG above. Exit code 1 on any failed step.
 * @returns {Promise<void>} Resolves after cleanup, whatever happened.
 */
export async function runBlue() {
  const k = kernelClient(), out = process.env.OSHAL_PROOF_OUT || path.join(os.homedir(), '.local/state/oshal-master-record-proof');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const state = { person: null, grants: [], sessions: [] };
  let browser = null;
  try {
    say('blue', { commit: (await k.http('', 'GET', '/version')).body.commit, out });
    await testPerson(k, state);
    browser = await playwright().chromium.launch({ headless: true });
    const uploader = await signIn(k, browser, state.person, 'desktop', state.sessions);
    await uploadThroughPage(k, uploader, state.person);
    await uploader.close();
    await prepare(k, state.person);
    const record = await recordAndPages(k, state.person);
    for (const size of ['phone', 'desktop']) {
      const context = await signIn(k, browser, state.person, size, state.sessions);
      await masterRecordPage(k, context, size, record, out);
      if (size === 'desktop') { await moreItem(k, context); await saveChangesNothing(k, context, state.person, record.person.name, out); }
      await context.close();
    }
    await askCareer(k, state.person);
  } catch (error) {
    say('error', { message: message(error) });
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanUp(k, state);
  }
}
