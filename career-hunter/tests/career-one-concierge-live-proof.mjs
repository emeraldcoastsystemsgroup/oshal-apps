/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: one concierge for the whole application; the résumé tab, the work history and the database as one thing; "Your main résumé changed" at Approve). A walk on an INSTALLED Career, through the kernel's real concierge and the model the installation runs, as a test person whose résumé is made up: from My résumé's context it asks for a new job with two bullets and approves the card; from Work history's it asks for a new version of the résumé; it asks for two cards from one reading and approves both in turn; from My résumé's it asks about saved jobs. It grades by the tool trace, the cards and the main résumé the routes answer, never by the reply's wording alone, and puts the main résumé back exactly as it found it (one Undo to the revision it started on). It prints tool names, counts, the made-up text it added itself and pass or refuse; never the person's own résumé text, a token or a header.
 *
 * Run it only as a test person with a made-up résumé, on a test slot:
 *   CAREER_LIVE_BASE=http://127.0.0.1:38798 CAREER_LIVE_ENV=$HOME/.local/state/oshal-native-green/oshald.env \
 *     node career-hunter/tests/career-one-concierge-live-proof.mjs [receipt.json]
 * CAREER_LIVE_ENV names the slot's environment file (its OSHAL_ADMIN_TOKEN signs in the operator test persona through
 * /api/auth/switch), or CAREER_LIVE_SESSION_FILE names a 0600 file holding a test person's own session token. It
 * refuses any base that is not a loopback address, and refuses a Career older than 1.62.0.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const BASE = (process.env.CAREER_LIVE_BASE || '').replace(/\/+$/, ''), CAREER = '/api/career-hunter';
const JOB = { title: 'IL6 Platform Engineer', org: 'Demo Defense Cloud', start: '2025-06' };
const BULLETS = ['Stood up the IL6 enclave for a made-up program', 'Wrote the accreditation package for a made-up program'];
const THIRD = 'Passed a made-up first audit with no findings';
const sleep = ms => new Promise(done => setTimeout(done, ms));
const lines = [], receipt = { base: BASE, steps: [] };
const say = text => { lines.push(text); console.log(text); };

function token() {
  if (process.env.CAREER_LIVE_SESSION_FILE) return { session: fs.readFileSync(process.env.CAREER_LIVE_SESSION_FILE, 'utf8').trim() };
  const text = fs.readFileSync(process.env.CAREER_LIVE_ENV, 'utf8');
  const admin = (/^OSHAL_ADMIN_TOKEN=(.*)$/m.exec(text) || [])[1]?.trim().replace(/^"|"$/g, '');
  if (!admin) throw new Error('the environment file names no administrator token');
  return { admin };
}
let session = null;
/** One request to the kernel. Only the status and the parsed JSON come back; nothing of the request is ever printed. */
async function call(path, { method = 'GET', body, bearer, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(BASE + path, { method, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (bearer || session), ...headers } });
  } catch (error) { throw new Error(`${method} ${path.split('?')[0]} did not answer: ${error.cause?.code || error.name}`); }
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json };
}
async function signIn() {
  const held = token();
  if (held.session) { session = held.session; return; }
  const answer = await call('/api/auth/switch', { method: 'POST', body: { persona: 'operator' }, bearer: held.admin });
  session = answer.json && (answer.json.token || answer.json.sessionToken || answer.json.accessToken || answer.json.session?.token);
  if (!session) throw new Error(`the test persona could not sign in (HTTP ${answer.status})`);
}
const master = async () => (await call(`${CAREER}/resume/doc?id=master`)).json;
const jobs = doc => (doc?.resume?.experience || []);
/** What a Career page hands the concierge, as tools/career-concierge.mjs and the pages build it. */
function context(surface, title, revision, count) {
  return { app: 'career-hunter', screen: 'surface', surface, recordId: 'master', title,
    fields: { revision, jobs: count, readOnly: false, draft: false,
      tools: 'career_resume_section career_resume_patch career_resume_read career_resume_undo',
      everywhere: 'The same concierge answers on every Career page and can read or change anything in Career from here.' } };
}
/** One turn with the real concierge, as the pane sends it; waits for a long answer the way the pane does. */
async function ask(text, page) {
  const message = text + '\nCurrent saved document and selection: ' + JSON.stringify(page);
  let result = (await call('/api/swarm/bots/career-concierge/ask', { method: 'POST', headers: { prefer: 'respond-async' },
    body: { message, context: page, sessionId: 'doc:career-hunter:master' } })).json;
  for (let waited = 0; result?.status === 'pending' && result.jobId && waited < 600; waited += 2) {
    await sleep(2000);
    const later = (await call('/api/jarvis/ask/result?jobId=' + encodeURIComponent(result.jobId))).json;
    if (later?.status !== 'pending') result = later;
  }
  const used = (result?.toolsUsed || result?.tool_executions || []).map(item => item.tool || item.name).filter(Boolean);
  const cards = (Array.isArray(result?.packageToolProposals) ? result.packageToolProposals : [result?.packageToolProposal]).filter(Boolean)
    .map(item => (typeof item === 'string' ? item : item.id ?? item.proposalId));
  return { reply: String(result?.reply ?? result?.answer ?? ''), used, cards, bot: result?.bot };
}
async function card(id) { const loaded = (await call('/api/jarvis/package-tools/proposals/' + encodeURIComponent(id))).json; return loaded?.proposal ?? loaded; }
async function approve(id) {
  const answer = await call('/api/jarvis/package-tools/execute', { method: 'POST', headers: { 'x-oshal-package-tool': '1' }, body: { proposalId: id } });
  return { http: answer.status, status: answer.json?.status ?? answer.status, result: answer.json?.result ?? null };
}
function step(name, facts) { receipt.steps.push({ name, ...facts }); say(`  ${name}: ${JSON.stringify(facts)}`); }
const found = doc => jobs(doc).find(role => role.title === JOB.title && role.org === JOB.org);

async function walk(start) {
  // 1. From My résumé: a new job with two bullets, on one card.
  let doc = await master(), turn = await ask(`Add a job to my work history: ${JOB.title} at ${JOB.org}, started June 2025 and still there, with two bullets: "${BULLETS[0]}" and "${BULLETS[1]}".`,
    context('resume-studio', 'Main résumé', doc.revision, jobs(doc).length));
  if (turn.bot) assert.equal(turn.bot, 'career-concierge', 'the one concierge answers');
  assert.ok(turn.used.some(name => name === 'career_resume_section' || name === 'career_resume_read'), `it read the main résumé first (used ${turn.used.join(', ') || 'nothing'})`);
  assert.equal(turn.cards.length, 1, 'one card for the whole change');
  const first = await card(turn.cards[0]);
  assert.equal(first.toolName ?? first.tool, 'career_resume_patch');
  let done = await approve(turn.cards[0]);
  assert.ok(done.status < 400, `the card applied (the application answered ${done.status})`);
  doc = await master();
  assert.deepEqual(found(doc)?.bullets, BULLETS, 'the job and both bullets are in the main résumé, which Work history and My résumé show');
  step('1 add a job from My résumé', { tools: turn.used, cards: 1, applied: done.status, jobs: jobs(doc).length });

  // 2. From Work history: a new version of the résumé. Nothing to change; it answers from the main résumé.
  turn = await ask('Make a new version of my master résumé with my new work history.', context('work-history', 'Work history', doc.revision, jobs(doc).length));
  assert.ok(turn.used.some(name => name.startsWith('career_resume_')), `it read the main résumé (used ${turn.used.join(', ') || 'nothing'})`);
  assert.doesNotMatch(turn.reply, /can(?:'|no)t see|cannot see|unable to (see|access)|another (assistant|agent)/i, 'it never says it cannot see the résumé');
  assert.match(turn.reply, new RegExp(JOB.title), 'it names the new job as part of the résumé');
  assert.match(turn.reply, /My r[eé]sum[eé]/, 'and says where the document is');
  step('2 a new version from Work history', { tools: turn.used, cards: turn.cards.length, namesTheJob: true });

  // 3. Two cards from one reading, approved in turn: the second applies on the revision the first left.
  turn = await ask(`Two separate changes, each on its own card so I can approve them one at a time: first, add the bullet "${THIRD}" under ${JOB.title} at ${JOB.org}; second, change the start month of ${JOB.title} at ${JOB.org} from June 2025 to May 2025.`,
    context('work-history', 'Work history', doc.revision, jobs(doc).length));
  assert.equal(turn.cards.length, 2, `two cards (got ${turn.cards.length}; used ${turn.used.join(', ')})`);
  const outcomes = [];
  for (const id of turn.cards) outcomes.push(await approve(id));
  assert.ok(outcomes.every(item => item.status < 400), `both cards applied (${outcomes.map(item => item.status).join(', ')}): ${outcomes.map(item => String(item.result?.error || '').slice(0, 160)).join(' | ')}`);
  assert.equal(outcomes[1].result?.rebased, true, 'the second was applied on the résumé as the first left it');
  doc = await master();
  assert.deepEqual(found(doc)?.bullets, [...BULLETS, THIRD]);
  assert.equal(found(doc)?.start, '2025-05');
  step('3 two cards approved in turn', { tools: turn.used, applied: outcomes.map(item => item.status), secondRebased: true });

  // 4. From My résumé: a question about saved jobs, answered from the person's own data.
  turn = await ask('How many jobs have I saved?', context('resume-studio', 'Main résumé', doc.revision, jobs(doc).length));
  assert.ok(turn.used.some(name => name === 'career_database' || name === 'career_jobs'), `it read the person's jobs (used ${turn.used.join(', ') || 'nothing'})`);
  assert.match(turn.reply, /\d|\bno\b|\bnone\b/i, 'and gave a count');
  assert.doesNotMatch(turn.reply, /open (My jobs|the My jobs page) to|go to (My jobs|another)/i, 'without sending them to another page for it');
  step('4 saved jobs from My résumé', { tools: turn.used, cards: turn.cards.length });
  void start;
}

/** Put the main résumé back to the exact revision the walk started on: one Undo, from the backups Career keeps. */
async function restore(start) {
  const status = (await call(`${CAREER}/resume/doc?id=master&view=status`)).json;
  if (!status) return false;
  if (status.revision === start) return true;
  const back = await call(`${CAREER}/resume/master-undo`, { method: 'POST', body: { revision: status.revision, restore: start } });
  return back.status < 400 && (await call(`${CAREER}/resume/doc?id=master&view=status`)).json?.revision === start;
}

async function main() {
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(BASE)) throw new Error('CAREER_LIVE_BASE must be a loopback address of a test slot');
  await signIn();
  const apps = (await call('/api/swarm/apps')).json, list = Array.isArray(apps) ? apps : apps?.apps || apps?.applications || [];
  const career = list.find(app => (app.name || app.key || app.id) === 'career-hunter'), version = String(career?.version || '');
  receipt.version = version;
  say(`Career ${version || '(version not listed)'} on ${BASE}`);
  if (version && version.split('.').map(Number).reduce((sum, part, n) => sum + part * [1e6, 1e3, 1][n], 0) < 1062000) throw new Error(`this walk is for Career 1.62.0 or later; ${version} is installed`);
  const first = await master();
  if (!first?.revision) throw new Error('the test person has no main résumé; give them a made-up one first');
  if (found(first)) throw new Error('the made-up job is already there; a previous walk did not put the résumé back');
  receipt.startRevision = first.revision; receipt.startJobs = jobs(first).length;
  let failure = null;
  try { await walk(first.revision); } catch (error) { failure = error; }
  const back = await restore(first.revision);
  receipt.restored = back; receipt.passed = !failure && back;
  say(back ? 'The main résumé is back exactly as it was.' : 'RESTORE FAILED: the main résumé is not back to the revision the walk started on; put it back by Undo on Work history.');
  say(failure ? `REFUSED: ${failure.message}` : back ? 'PASSED: one concierge, one résumé, two cards in turn.' : 'REFUSED: not restored.');
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(receipt, null, 2) + '\n');
  process.exitCode = receipt.passed ? 0 : 1;
}
main().catch(error => { console.error('REFUSED: ' + error.message); process.exitCode = 1; });
