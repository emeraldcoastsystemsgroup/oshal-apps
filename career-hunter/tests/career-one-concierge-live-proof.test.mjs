/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0: the live walk (tests/career-one-concierge-live-proof.mjs) is itself checked, so the first run on an installed Career is not the first run of the walk. It runs as a child process against a stand-in kernel on a loopback port that answers the kernel's own addresses (sign-in, the application list, the concierge ask, a card and its Approve at /api/jarvis/package-tools/execute) with a scripted concierge and Career's real engine on a made-up person's disposable profile: the walk passes, two cards from one reading both apply through the real engine, and the profile is back to the byte; a concierge that answers "I can't see that document from here" is refused and the profile is still put back; an older Career and a base that is not a loopback address are refused before anything is asked.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url)), walk = path.join(packageRoot, 'tests/career-one-concierge-live-proof.mjs');
const { resumeStatus } = createRequire(import.meta.url)('../lib/career-resume-source.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-live-walk-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const filename = path.join(packageRoot, 'bin/oshal-jobhunter.js'), cli = new Module(filename);
cli.filename = filename; cli.paths = Module._nodeModulePaths(path.dirname(filename));
cli._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.mapping=engineRuns;', filename);
const fixture = {
  profile: { name: 'Pat Example', headline: 'Engineer', experience_summary: 'Made-up summary.', clearance: 'None' },
  roles: [{ title: 'Principal Engineer', org: 'Example Freight Co', start: '2019-03', end: null, deliverables: ['Shipped the routing service'] }],
  skills: { Core: { items: ['Rust'] } },
};
const ADMIN = 'made-up-admin-token', SESSION = 'made-up-session-token';

/** A stand-in kernel: the addresses the walk calls, a scripted concierge, Career's real engine behind its routes. */
async function kernel({ version = '1.62.0', blind = false } = {}) {
  const dir = fs.mkdtempSync(path.join(root, 'person-')), file = path.join(dir, 'career_db.json');
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2));
  const engine = (verb, input = {}) => {
    const out = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3', cli.exports.mapping('resume', [verb])[0], { cwd: packageRoot, encoding: 'utf8', timeout: 20000,
      env: { ...process.env, JOBHUNTER_DATA: dir, JOBHUNTER_CAREER_DB: file, PYTHONPATH: path.join(packageRoot, 'engine'), CH_RESUME_DOC: JSON.stringify(input) } });
    return JSON.parse(out.stdout.trim());
  };
  const cards = new Map(), asked = [];
  const job = { roleIndex: 0, roleTitle: 'IL6 Platform Engineer', roleOrg: 'Demo Defense Cloud' };
  /** The scripted concierge: what a model that follows its persona does for each of the walk's four sentences. */
  function concierge(message) {
    const text = message.split('\nCurrent saved document and selection: ')[0], revision = engine('base').revision, made = [];
    const card = (edits) => { const id = `card-${cards.size + 1}`; cards.set(id, { id, app: 'career-hunter', toolName: 'career_resume_patch', input: { revision, edits } }); made.push(id); };
    const quoted = [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    if (/^Add a job/.test(text)) {
      card([{ op: 'add', field: 'role', index: 0, before: '', value: job.roleTitle, summary: 'Add the job' },
        { op: 'set', field: 'role', roleIndex: 0, roleTitle: job.roleTitle, key: 'org', before: '', value: job.roleOrg, summary: 'Employer' },
        { op: 'set', field: 'role', roleIndex: 0, roleTitle: job.roleTitle, key: 'start', before: '', value: '2025-06', summary: 'Start' },
        ...quoted.map((value, index) => ({ op: 'add', field: 'experience', roleIndex: 0, roleTitle: job.roleTitle, index, before: '', value, summary: 'Bullet' }))]);
      return { reply: 'I proposed the new job on a card.', used: ['career_resume_section'], made };
    }
    if (/^Make a new version/.test(text)) {
      return blind ? { reply: "I can't see that document from here.", used: ['career_resume_read'], made }
        : { reply: `Your main résumé holds ${engine('base').resume.experience.length} jobs, the newest ${job.roleTitle}. The document on My résumé is that version.`, used: ['career_resume_read', 'career_resume_section'], made };
    }
    if (/^Two separate changes/.test(text)) {
      card([{ op: 'add', field: 'experience', ...job, index: 2, before: '', value: quoted[0], summary: 'Add a bullet' }]);
      card([{ op: 'set', field: 'role', ...job, key: 'start', before: '2025-06', value: '2025-05', summary: 'Start month' }]);
      return { reply: 'Two cards, one for each change.', used: ['career_resume_section'], made };
    }
    return { reply: 'You have saved 2 jobs.', used: ['career_database'], made };
  }
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), input = body ? JSON.parse(body) : {}, key = `${req.method} ${url.pathname}`;
      const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (key === 'POST /api/auth/switch') return req.headers.authorization === 'Bearer ' + ADMIN && input.persona === 'operator' ? send(200, { token: SESSION }) : send(401, {});
      if (req.headers.authorization !== 'Bearer ' + SESSION) return send(401, { error: 'sign in' });
      if (key === 'GET /api/swarm/apps') return send(200, { apps: [{ name: 'career-hunter', version }] });
      if (key === 'GET /api/career-hunter/resume/doc') return send(200, url.searchParams.get('view') === 'status' ? resumeStatus(dir) : engine('base'));
      if (key === 'POST /api/career-hunter/resume/master-undo') { const answer = engine('base-undo', input); return send(answer.ok ? 200 : 409, answer); }
      if (key === 'POST /api/swarm/bots/career-concierge/ask') {
        asked.push(input);
        const turn = concierge(input.message);
        return send(200, { bot: 'career-concierge', reply: turn.reply, toolsUsed: turn.used.map((tool) => ({ tool })), packageToolProposals: turn.made, status: 'completed' });
      }
      const one = url.pathname.match(/^\/api\/jarvis\/package-tools\/proposals\/(.+)$/);
      if (req.method === 'GET' && one) return cards.has(one[1]) ? send(200, { proposal: cards.get(one[1]) }) : send(404, {});
      if (key === 'POST /api/jarvis/package-tools/execute') {
        if (req.headers['x-oshal-package-tool'] !== '1' || !cards.has(input.proposalId)) return send(400, { error: 'not a card' });
        const result = engine('base-patch', cards.get(input.proposalId).input);
        return send(200, { status: result.ok ? 200 : 409, result, expiresAt: new Date(Date.now() + 60000).toISOString() });
      }
      return send(404, { error: `not in the stand-in: ${key}` });
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const env = path.join(dir, 'slot.env'); fs.writeFileSync(env, `OTHER=1\nOSHAL_ADMIN_TOKEN=${ADMIN}\n`, { mode: 0o600 });
  return { base: 'http://127.0.0.1:' + server.address().port, env, file, asked, close: () => new Promise((done) => server.close(done)) };
}
function run(base, envFile) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [walk], { env: { ...process.env, CAREER_LIVE_BASE: base, CAREER_LIVE_ENV: envFile || '' } });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => done({ code, out }));
  });
}

test('the walk passes against a concierge that does its job, through the real engine, and leaves the résumé as it found it', async () => {
  const k = await kernel(), before = fs.readFileSync(k.file, 'utf8');
  try {
    const { code, out } = await run(k.base, k.env);
    assert.equal(code, 0, out);
    assert.match(out, /PASSED: one concierge, one résumé, two cards in turn\./);
    assert.match(out, /3 two cards approved in turn: .*"secondRebased":true/);
    assert.match(out, /The main résumé is back exactly as it was\./);
    assert.equal(fs.readFileSync(k.file, 'utf8'), before, 'to the byte');
    assert.equal(k.asked.length, 4);
    assert.deepEqual(k.asked.map((turn) => [turn.sessionId, turn.context.recordId, turn.context.surface]),
      [['doc:career-hunter:master', 'master', 'resume-studio'], ['doc:career-hunter:master', 'master', 'work-history'],
        ['doc:career-hunter:master', 'master', 'work-history'], ['doc:career-hunter:master', 'master', 'resume-studio']], 'one conversation, as the pane sends it');
    assert.doesNotMatch(out, new RegExp(`${ADMIN}|${SESSION}|Shipped the routing service|Bearer`), 'no token and none of the person\'s own résumé text is printed');
  } finally { await k.close(); }
});

test('a concierge that cannot see the document is refused, and the résumé is still put back', async () => {
  const k = await kernel({ blind: true }), before = fs.readFileSync(k.file, 'utf8');
  try {
    const { code, out } = await run(k.base, k.env);
    assert.equal(code, 1);
    assert.match(out, /REFUSED: it never says it cannot see the résumé/);
    assert.match(out, /The main résumé is back exactly as it was\./);
    assert.equal(fs.readFileSync(k.file, 'utf8'), before);
  } finally { await k.close(); }
});

test('an older Career, and a base that is not a test slot on this machine, are refused before anything is asked', async () => {
  const k = await kernel({ version: '1.61.2' });
  try {
    const older = await run(k.base, k.env);
    assert.equal(older.code, 1);
    assert.match(older.out, /REFUSED: this walk is for Career 1\.62\.0 or later; 1\.61\.2 is installed/);
    assert.equal(k.asked.length, 0);
    const away = await run('https://career.example.com', k.env);
    assert.equal(away.code, 1);
    assert.match(away.out, /REFUSED: CAREER_LIVE_BASE must be a loopback address of a test slot/);
  } finally { await k.close(); }
});
