/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.0: Verify untruncated 1,800+ character work-history bullets across master-edit, master-section, base-save, 0-bullet multi-add, inline-glyph/newline split, interview_prep compaction, and My résumé Main vs Tailored identity banner clarity.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-long-bullets-'));
const pythonBin = process.env.CAREER_TEST_PYTHON || 'python3';

const cliPath = path.join(packageRoot, 'bin/oshal-jobhunter.js');
const cliMod = new Module(cliPath);
cliMod.filename = cliPath;
cliMod.paths = Module._nodeModulePaths(path.dirname(cliPath));
cliMod._compile(fs.readFileSync(cliPath, 'utf8') + '\nmodule.exports.mapping=engineRuns;', cliPath);

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => {
  await browser?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

let storeCount = 0;
function createProfileStore(initial) {
  const dir = path.join(root, `store-${++storeCount}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'career_db.json');
  fs.writeFileSync(file, JSON.stringify(initial, null, 2));
  return { dir, file };
}

function runResumeEngine(store, verb, payload) {
  const args = cliMod.exports.mapping('resume', [verb])[0];
  const res = spawnSync(pythonBin, args, {
    cwd: packageRoot,
    timeout: 20000,
    encoding: 'utf8',
    env: {
      ...process.env,
      JOBHUNTER_DATA: store.dir,
      JOBHUNTER_CAREER_DB: store.file,
      PYTHONPATH: path.join(packageRoot, 'engine'),
      ...(payload !== undefined ? { CH_RESUME_DOC: JSON.stringify(payload) } : {}),
    },
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const start = res.stdout.indexOf('{');
  return JSON.parse(res.stdout.slice(start));
}

test('engine & routes: 1,900+ char bullets on a 0-bullet job read back untruncated and split cleanly on newlines and bullet glyphs', async () => {
  const s = createProfileStore({
    profile: { name: 'Jordan Sample', headline: 'Program Director', experience_summary: 'Leads multi-site programs.', clearance: 'Secret' },
    roles: [
      { title: 'Chief Architect', org: 'Harbor Defense Group', start: '2023-02', end: null, deliverables: [] },
      { title: 'Systems Manager', org: 'Coastal Logistics', start: '2019-01', end: '2023-01', deliverables: ['Managed regional fleet routing'] },
    ],
    skills: { Systems: { items: ['Architecture', 'Integration'] } },
    competencies: ['Program Leadership'],
  });

  const longTail = 'Ran enterprise architecture governance and integrated COTS and GOTS work across five regional operations centers';
  const longBullet = `${'Directed cross-functional engineering modernization, zero-downtime data migration, and automated compliance verification across distributed field teams. '.repeat(12)}${longTail}`;
  assert.ok(longBullet.length > 1850, `expected > 1850 chars, got ${longBullet.length}`);
  const secondBullet = 'Established repeatable release readiness gates that cut deployment rollback incidents by 65 percent across twelve services';

  const overview = runResumeEngine(s, 'base-section', { field: 'overview', index: 0, offset: 0, limit: 20 });
  assert.equal(overview.items[0].value.title, 'Chief Architect');
  assert.equal(runResumeEngine(s, 'base-section', { field: 'experience', index: 0, offset: 0, limit: 20 }).items.length, 0, 'starts as a 0-bullet job');

  const added = runResumeEngine(s, 'base-patch', {
    revision: overview.revision,
    edits: [
      { op: 'add', field: 'experience', roleIndex: 0, roleTitle: 'Chief Architect', roleOrg: 'Harbor Defense Group', before: '', value: longBullet, summary: 'Add detailed architecture bullet' },
      { op: 'add', field: 'experience', roleIndex: 0, roleTitle: 'Chief Architect', roleOrg: 'Harbor Defense Group', before: '', value: secondBullet, summary: 'Add release readiness bullet' },
    ],
  });
  assert.equal(added.ok, true);

  const readBack = runResumeEngine(s, 'base-section', { field: 'experience', index: 0, offset: 0, limit: 20 });
  assert.equal(readBack.items.length, 2);
  assert.equal(readBack.items[0].value, longBullet, 'full 1,900+ char bullet preserved without truncation');
  assert.ok(readBack.items[0].value.endsWith(longTail));
  assert.equal(readBack.items[1].value, secondBullet);

  const baseDoc = runResumeEngine(s, 'base');
  assert.equal(baseDoc.resume.experience[0].bullets[0], longBullet);
  baseDoc.resume.summary = 'Leads multi-site programs across regulated infrastructure.';
  const savedDoc = runResumeEngine(s, 'base-save', { resume: baseDoc.resume });
  assert.equal(savedDoc.ok, true, JSON.stringify(savedDoc));
  const reloadedDoc = runResumeEngine(s, 'base');
  assert.equal(reloadedDoc.resume.experience[0].bullets[0], longBullet, 'base-save preserves full 1,900+ char bullet');

  const inlineGlyphDraft = '• Consolidated three legacy ticketing portals into one operator console • Automated nightly audit reconciliation across 40 field depots • Trained 28 regional leads on incident triage';
  const afterSaveOverview = runResumeEngine(s, 'base-section', { field: 'overview', index: 0, offset: 0, limit: 20 });
  const withInline = runResumeEngine(s, 'base-patch', {
    revision: afterSaveOverview.revision,
    edits: [{ op: 'add', field: 'experience', roleIndex: 1, roleTitle: 'Systems Manager', roleOrg: 'Coastal Logistics', before: '', value: inlineGlyphDraft, summary: 'Paste inline bullet draft' }],
  });
  assert.equal(withInline.ok, true);
  const role1Items = runResumeEngine(s, 'base-section', { field: 'experience', index: 1, offset: 0, limit: 20 });
  assert.deepEqual(role1Items.items.map((item) => item.value), [
    'Managed regional fleet routing',
    'Consolidated three legacy ticketing portals into one operator console',
    'Automated nightly audit reconciliation across 40 field depots',
    'Trained 28 regional leads on incident triage',
  ]);

  const unsplitInline = 'First pasted achievement; • Second inline bullet item • Third inline bullet item ending in COTS and GOTS work';
  const rawProfile = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  rawProfile.roles[1].deliverables.push(unsplitInline);
  fs.writeFileSync(s.file, JSON.stringify(rawProfile, null, 2));
  const revBeforeSplit = runResumeEngine(s, 'base-section', { field: 'overview', index: 0, offset: 0, limit: 20 }).revision;
  const splitRes = runResumeEngine(s, 'base-patch', {
    revision: revBeforeSplit,
    edits: [{ op: 'split', field: 'experience', roleIndex: 1, roleTitle: 'Systems Manager', roleOrg: 'Coastal Logistics', before: unsplitInline, summary: 'Split inline glyph bullet' }],
  });
  assert.equal(splitRes.ok, true);
  const afterSplit = runResumeEngine(s, 'base-section', { field: 'experience', index: 1, offset: 0, limit: 20 });
  assert.deepEqual(afterSplit.items.slice(-3).map((item) => item.value), [
    'First pasted achievement;',
    'Second inline bullet item',
    'Third inline bullet item ending in COTS and GOTS work',
  ]);

  const prepCheck = spawnSync(pythonBin, ['-c', [
    'import json, contextlib',
    'from jobhunter import interview_prep, db, job_context',
    '@contextlib.contextmanager',
    'def fake_conn():',
    '    class C:',
    '        def execute(self, *a):',
    '            class R:',
    '                def fetchone(self): return {"id": 1, "title": "Architect", "company": "Acme", "description": "System design role", "url": "https://acme.example/1"}',
    '            return R()',
    '    yield C()',
    'db.connect = fake_conn',
    'job_context.ensure = lambda r: r',
    '_job, _saved, evidence, _digests = interview_prep.source(1)',
    'print(json.dumps({"len": len(evidence[0]["text"]), "tail": evidence[0]["text"][-60:]}))',
  ].join('\n')], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, JOBHUNTER_DATA: s.dir, JOBHUNTER_CAREER_DB: s.file, PYTHONPATH: path.join(packageRoot, 'engine') },
  });
  assert.equal(prepCheck.status, 0, prepCheck.stderr);
  const parsedPrep = JSON.parse(prepCheck.stdout.trim());
  assert.equal(parsedPrep.len, longBullet.length, 'interview_prep keeps full 1,900+ char bullet');
});

test('studio guided-edit route keeps 2,200-char bullets and up to 24 bullets per role intact', async () => {
  const originalLoad = Module._load;
  let capturedPrompt = '';
  const longGuidedBullet = `${'Led enterprise cutover rehearsals and zero-data-loss verification across regional operations. '.repeat(22)}Completed COTS and GOTS transition on schedule.`;
  assert.ok(longGuidedBullet.length > 2000);
  const twentyBullets = Array.from({ length: 20 }, (_, idx) => idx === 0 ? longGuidedBullet : `Delivered milestone ${idx + 1} across platform services`);
  Module._load = function patchedLoad(request, ...rest) {
    if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {} }) };
    if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => null };
    if (request === '@/app/routes/inline-bot-execution') {
      return {
        executeBotOrInline: async (_ctx, _botClient, _agentId, req) => {
          capturedPrompt = req.text;
          return { response: JSON.stringify({ reply: 'Split and refined all twenty bullets.', actions: [{ op: 'update_experience', index: 1, bullets: twentyBullets }] }) };
        },
      };
    }
    if (request === './career-engine-runner') return {};
    if (request === './career-user-store') return { callerSub: (req) => req.userSub };
    if (request === './career-engine-dispatch') return { runCareerCliAwait: async () => ({ ok: true, out: '{}' }) };
    return originalLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve('../routes/career-resume-studio-routes.js')];
    const studio = require('../routes/career-resume-studio-routes.js');
    const handlers = new Map();
    studio.registerCareerResumeStudio({ get: (p, h) => handlers.set('GET ' + p, h), post: (p, h) => handlers.set('POST ' + p, h) }, { pool: 'fixture' });
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
    const bigResume = { headline: 'Architect', summary: 'x'.repeat(3000), experience: [{ title: 'Architect', org: 'Sample', span: '2020-Present', bullets: [longGuidedBullet, 'y'.repeat(12000)] }] };
    await handlers.get('POST /resume/guide')({ userSub: 'owner-a', body: { postingId: 'master', message: 'Refine my bullets', resume: bigResume, cover: {}, meta: { master: true } } }, res);
    assert.equal(res.code, 200);
    assert.ok(capturedPrompt.length > 14000, 'guidePrompt carries > 12,000 chars of resume JSON without truncating');
    assert.equal(res.body.actions[0].bullets.length, 20, 'keeps all 20 bullets (above old 8-bullet cap)');
    assert.equal(res.body.actions[0].bullets[0], longGuidedBullet, 'keeps full 2,000+ char bullet (above old 600-char cap)');
  } finally {
    Module._load = originalLoad;
  }
});

const MAIN_REVISION = '9f8e7d6c' + '1'.repeat(56);
const MAIN_DOC = {
  revision: MAIN_REVISION,
  resume: {
    headline: 'Enterprise Platform Leader',
    summary: 'Main résumé executive summary synced across all applications.',
    experience: [{ title: 'Chief Architect', org: 'Harbor Works', span: '2021 – Present', bullets: ['Built core platform'] }],
  },
  cover: {},
  meta: { master: true, name: 'Jordan Sample', revision: MAIN_REVISION },
};
const TAILORED_DOC = {
  resume: {
    headline: 'Principal Systems Architect — Defense Mission Systems',
    summary: 'Tailored summary written specifically for Northwind Defense.',
    experience: [{ title: 'Chief Architect', org: 'Harbor Works', span: '2021 – Present', bullets: ['Tailored mission-systems architecture'] }],
  },
  cover: { greeting: 'Dear Hiring Team,', paragraphs: ['Tailored cover paragraph.'], signoff: 'Sincerely,' },
  meta: { postingId: 7, title: 'Principal Systems Architect', company: 'Northwind Defense', name: 'Jordan Sample' },
};

function studioFixture(indexed = true) {
  return ({ url }) => {
    if (url.pathname === '/api/career-hunter/jobs') {
      return { json: { jobs: [{ id: 7, title: 'Principal Systems Architect', company: 'Northwind Defense', has_resume: 1 }] } };
    }
    if (url.pathname === '/api/career-hunter/resume/state') {
      return { json: { hasResume: indexed, indexing: false, revision: indexed ? MAIN_REVISION : null, ingest: { state: 'none' } } };
    }
    if (url.pathname === '/api/career-hunter/resume/doc') {
      if (url.searchParams.get('view') === 'status') {
        return { json: { present: indexed, revision: indexed ? MAIN_REVISION : null, jobs: indexed ? 1 : 0 } };
      }
      if (!indexed) return { json: { resume: {}, cover: {}, meta: { master: true } } };
      return { json: url.searchParams.get('id') === '7' ? TAILORED_DOC : MAIN_DOC };
    }
    return null;
  };
}

for (const [label, size] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: My résumé unmistakably distinguishes Main résumé vs Tailored résumé with one-click return`, async () => {
    const empty = await openScreen(browser, 'career-resume-studio.html', studioFixture(false), size);
    try {
      await empty.page.getByRole('button', { name: 'Upload your résumé (PDF or DOCX)' }).waitFor();
      assert.equal(await empty.page.locator('#docIdentity').isVisible(), false, 'banner stays hidden before a résumé exists');
    } finally { await empty.context.close(); }

    const tailored = await openScreen(browser, 'career-resume-studio.html', studioFixture(true), size, '?id=7');
    try {
      const banner = tailored.page.locator('#docIdentity');
      await banner.waitFor();
      assert.equal(await banner.getAttribute('data-doc-kind'), 'tailored');
      assert.equal((await tailored.page.locator('#docIdentityBadge').innerText()).trim(), 'Tailored résumé');
      assert.match(await tailored.page.locator('#docIdentityDetail').innerText(), /Principal Systems Architect · Northwind Defense/);
      assert.match(await tailored.page.locator('#docIdentityDetail').innerText(), /not your main résumé/);
      assert.match(await tailored.page.locator('#sheet').innerText(), /Tailored summary written specifically for Northwind Defense/);

      const backBtn = tailored.page.locator('#backToMaster');
      assert.equal(await backBtn.isVisible(), true);
      assert.ok((await backBtn.boundingBox()).height >= 44, '44px touch target');
      assert.ok(await tailored.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal overflow');

      if (size === PHONE) await backBtn.tap(); else await backBtn.click();
      await tailored.page.waitForFunction(() => document.getElementById('docIdentity')?.getAttribute('data-doc-kind') === 'main');
      assert.equal((await tailored.page.locator('#docIdentityBadge').innerText()).trim(), 'Main résumé');
      assert.match(await tailored.page.locator('#docIdentityDetail').innerText(), /Synced with Work history · revision 9f8e7d6c/);
      assert.equal(await backBtn.isVisible(), false, 'Back button hides when already on Main résumé');
      assert.equal(await tailored.page.locator('#pick').inputValue(), 'master');
      assert.match(await tailored.page.locator('#sheet').innerText(), /Main résumé executive summary synced across all applications/);
    } finally { await tailored.context.close(); }
  });
}
