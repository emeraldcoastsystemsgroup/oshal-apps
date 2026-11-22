/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.9.7 (R21): unit and real Chromium browser guards for response-plan manifests (buildManifest, bundleDigest), bounded line-by-line unified diffing (unifiedDiff), plan-to-plan comparison (comparePlans), explicit non-authorization notice, hostile-script textContent escaping, 401/403 refusal clearing, stale out-of-order response protection, and zero horizontal overflow at 1440x900 and 412x915.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { fixture, loadExperience, dependency, root } = require('./fixtures/intake.cjs');
const Manifest = require('../ui/response-manifest.js');
const Artifacts = require('../ui/response-artifacts.js');
const { saveScan } = require('../routes/topology-store.js');
const X = require('../routes/execution.js');

const sha = t => createHash('sha256').update(t).digest('hex');
const UID = '7b4e2d10-2222-4333-8444-555566667777';

const ANSWER_V1 = [
  '# CPU pressure on api-worker-1',
  'MODE: A (remediation)',
  'Approval required before remediate.sh runs.',
  '',
  '```sh file=remediate.sh',
  'echo "step 1: quiesce"',
  ': > /run/pressure/stop',
  '```',
  '',
  '```sh file=verify.sh',
  'test -f /run/pressure/stop',
  '```',
  '',
  '```md file=rollback.md',
  'Restart the drill pod to resume load.',
  '```',
  '',
  '```md file=verify.md',
  'Confirm resolved alert and flat CPU.',
  '```',
  '',
].join('\n');

const ANSWER_V2 = [
  '# CPU pressure on api-worker-1 (revised)',
  'MODE: A (remediation)',
  'Approval required before remediate.sh runs.',
  '',
  '```sh file=remediate.sh',
  'echo "step 1: quiesce"',
  'echo "step 2: flush queue"',
  ': > /run/pressure/stop-v2',
  '```',
  '',
  '```sh file=verify.sh',
  'test -f /run/pressure/stop',
  '```',
  '',
  '```md file=rollback.md',
  'Restart the drill pod and check <script>window.__xss=1</script><img src=x onerror="window.__xss=2"> safely.',
  '```',
  '',
  '```md file=verify.md',
  'Confirm resolved alert and flat CPU.',
  '```',
  '',
  '```sh file=diagnose.sh',
  'ps aux | head -n 5',
  '```',
  '',
].join('\n');

const ANSWER_V3 = [
  '# CPU pressure on api-worker-1 (alt)',
  'MODE: A (remediation)',
  'Approval required before remediate.sh runs.',
  '',
  '```sh file=remediate.sh',
  'echo "alt-plan-3"',
  ': > /run/pressure/stop-v3',
  '```',
  '',
  '```sh file=verify.sh',
  'test -f /run/pressure/stop',
  '```',
  '',
  '```md file=rollback.md',
  'Alt rollback plan 3.',
  '```',
  '',
  '```md file=verify.md',
  'Confirm resolved alert and flat CPU.',
  '```',
  '',
].join('\n');

test('sha256Hex and bundleDigest match Node crypto and remain order-independent', () => {
  for (const sample of ['', 'hello\n', 'αβγ 🚀\n', ANSWER_V2]) {
    assert.equal(Manifest.sha256Hex(sample), sha(sample));
  }
  const filesA = [{ name: 'b.sh', sha256: sha('b'), bytes: 1 }, { name: 'a.sh', sha256: sha('a'), bytes: 1 }];
  const filesB = [filesA[1], filesA[0]];
  assert.equal(Manifest.bundleDigest(filesA), Manifest.bundleDigest(filesB));
  assert.match(Manifest.bundleDigest(filesA), /^[a-f0-9]{64}$/);
  assert.equal(Manifest.buildManifest, Artifacts.buildManifest);
  assert.equal(Manifest.unifiedDiff, Artifacts.unifiedDiff);
  assert.equal(Manifest.comparePlans, Artifacts.comparePlans);
});

test('buildManifest preserves exact file order, metadata, provenance, ranges, line counts and non-authorization notice', () => {
  const plan = {
    id: 'a'.repeat(64),
    ticketId: '11111111-1111-4111-8111-111111111111',
    ticketRevision: 4,
    workId: '22222222-2222-4222-8222-222222222222',
    phase: 'revise',
    answerVerifiedByServer: true,
    answerSha256: 'b'.repeat(64),
    answerReceipt: 'rcpt-1',
    target: { pod: 'api-worker-1', namespace: 'ops-demo', container: 'worker', uid: UID },
    artifacts: [
      { name: 'remediate.sh', sha256: sha('echo ok\n'), bytes: 8, range: { start: 100, end: 112 }, origin: 'workflow-answer-section' },
      { name: 'verify.sh', sha256: sha('true\n'), bytes: 5, range: { start: 130, end: 138 }, origin: 'workflow-answer-section' },
    ],
    downloads: [
      { name: 'remediate.sh', sha256: sha('echo ok\n'), bytes: 8, path: '/executions/plans/' + 'a'.repeat(64) + '/artifacts/remediate.sh' },
      { name: 'verify.sh', sha256: sha('true\n'), bytes: 5, path: '/executions/plans/' + 'a'.repeat(64) + '/artifacts/verify.sh' },
    ],
  };
  const unloaded = Manifest.buildManifest(plan);
  assert.equal(unloaded.planId, plan.id);
  assert.equal(unloaded.ticketRevision, 4);
  assert.equal(unloaded.answerVerifiedByServer, true);
  assert.equal(unloaded.executionAuthorized, false);
  assert.match(unloaded.authorizationNotice, /does not authorize execution/i);
  assert.deepEqual(unloaded.files.map(f => f.name), ['remediate.sh', 'verify.sh']);
  assert.deepEqual(unloaded.files[0].range, { start: 100, end: 112 });
  assert.equal(unloaded.files[0].lines, null);
  assert.equal(unloaded.files[0].downloadUrl, '/api/intelligent-operations/executions/plans/' + plan.id + '/artifacts/remediate.sh');
  assert.deepEqual(unloaded.files[0].provenance, { ticketId: plan.ticketId, workId: plan.workId, phase: 'revise', origin: 'workflow-answer-section' });
  const loaded = Manifest.buildManifest(plan, { 'remediate.sh': 'line1\nline2\n', 'verify.sh': 'true' });
  assert.equal(loaded.files[0].lines, 2);
  assert.equal(loaded.files[1].lines, 1);
  assert.equal(loaded.bundleDigest, unloaded.bundleDigest);
});

test('unifiedDiff handles unchanged, added, removed, modified hunks, CRLF/no-trailing-newline and maxLines truncation', () => {
  const same = Manifest.unifiedDiff('a\nb\n', 'a\nb\n', { oldLabel: 'a/f', newLabel: 'b/f' });
  assert.equal(same.changed, false);
  assert.equal(same.added, 0);
  assert.equal(same.removed, 0);
  assert.equal(same.unchanged, 2);
  assert.equal(same.hunks.length, 0);
  assert.equal(same.text, '');

  const added = Manifest.unifiedDiff('', 'one\ntwo\n', { oldLabel: '/dev/null', newLabel: 'b/new.sh' });
  assert.equal(added.changed, true);
  assert.equal(added.added, 2);
  assert.equal(added.removed, 0);
  assert.match(added.text, /^--- \/dev\/null\n\+\+\+ b\/new\.sh\n@@ -0,0 \+1,2 @@\n\+one\n\+two$/);

  const removed = Manifest.unifiedDiff('gone\n', '', { oldLabel: 'a/old.sh', newLabel: '/dev/null' });
  assert.equal(removed.changed, true);
  assert.equal(removed.removed, 1);
  assert.match(removed.text, /@@ -1,1 \+0,0 @@\n-gone/);

  const mod = Manifest.unifiedDiff('l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n', 'l1\nl2-edit\nl3\nl4\nl5\nl6\nl7\nl8-edit\n', { contextLines: 1 });
  assert.equal(mod.changed, true);
  assert.equal(mod.added, 2);
  assert.equal(mod.removed, 2);
  assert.equal(mod.unchanged, 6);
  assert.equal(mod.hunks.length, 2);
  assert.match(mod.text, /-l2\n\+l2-edit/);
  assert.match(mod.text, /-l8\n\+l8-edit/);

  const crlf = Manifest.unifiedDiff('alpha\r\nbeta\r\n', 'alpha\nbeta\n');
  assert.equal(crlf.changed, false);

  const noNl = Manifest.unifiedDiff('alpha\nbeta', 'alpha\nbeta\n');
  assert.equal(noNl.changed, true);
  assert.match(noNl.text, /\\ No newline at end of file/);

  const hugeA = Array.from({ length: 40 }, (_, i) => 'old-' + i).join('\n') + '\n';
  const hugeB = Array.from({ length: 40 }, (_, i) => 'new-' + i).join('\n') + '\n';
  const trunc = Manifest.unifiedDiff(hugeA, hugeB, { maxLines: 10 });
  assert.equal(trunc.truncated, true);
  assert.match(trunc.truncationNotice, /truncated at 10 lines/i);
  assert.match(trunc.text, /truncated at 10 lines/i);
});

test('comparePlans classifies unchanged, modified, added and removed files with exact unified diffs', () => {
  const basePlan = {
    id: '1'.repeat(64), ticketId: 't-1', ticketRevision: 2, workId: 'w-1', phase: 'revise', answerVerifiedByServer: true,
    target: { pod: 'p1', namespace: 'ns', container: 'c1', uid: UID },
    artifacts: [
      { name: 'remediate.sh', sha256: sha('old\n'), bytes: 4, range: { start: 1, end: 5 } },
      { name: 'verify.sh', sha256: sha('same\n'), bytes: 5, range: { start: 6, end: 11 } },
      { name: 'legacy.md', sha256: sha('drop\n'), bytes: 5, range: { start: 12, end: 17 } },
    ],
  };
  const targetPlan = {
    id: '2'.repeat(64), ticketId: 't-1', ticketRevision: 2, workId: 'w-2', phase: 'revise', answerVerifiedByServer: true,
    target: { pod: 'p1', namespace: 'ns', container: 'c1', uid: UID },
    artifacts: [
      { name: 'remediate.sh', sha256: sha('new\n'), bytes: 4, range: { start: 1, end: 5 } },
      { name: 'verify.sh', sha256: sha('same\n'), bytes: 5, range: { start: 6, end: 11 } },
      { name: 'diagnose.sh', sha256: sha('ps\n'), bytes: 3, range: { start: 12, end: 15 } },
    ],
  };
  const content = {
    [basePlan.id]: { 'remediate.sh': 'old\n', 'verify.sh': 'same\n', 'legacy.md': 'drop\n' },
    [targetPlan.id]: { 'remediate.sh': 'new\n', 'verify.sh': 'same\n', 'diagnose.sh': 'ps\n' },
  };
  const cmp = Manifest.comparePlans(basePlan, targetPlan, content);
  assert.deepEqual(cmp.summary, { unchanged: 1, modified: 1, added: 1, removed: 1, total: 4 });
  assert.equal(cmp.executionAuthorized, false);
  const byName = new Map(cmp.files.map(f => [f.name, f]));
  assert.equal(byName.get('verify.sh').status, 'unchanged');
  assert.equal(byName.get('verify.sh').diff, null);
  assert.equal(byName.get('remediate.sh').status, 'modified');
  assert.match(byName.get('remediate.sh').diff.text, /-old\n\+new/);
  assert.equal(byName.get('diagnose.sh').status, 'added');
  assert.match(byName.get('diagnose.sh').diff.text, /\+ps/);
  assert.equal(byName.get('legacy.md').status, 'removed');
  assert.match(byName.get('legacy.md').diff.text, /-drop/);
});

async function setupMultiPlanBrowser() {
  const f = await fixture();
  const pool = f.caller('alice');
  const source = loadExperience().sourceDefinition({ name: 'Manifest lab', source: 'urn:triagenorth:manifest:' + randomUUID(), environment: 'local-lab' });
  const pod = { provider: 'kubernetes', scope: 'cluster-uid', kind: 'pod', nativeId: UID, name: 'api-worker-1', health: 'degraded', properties: { namespace: 'operations-demo' } };
  const node = { provider: 'kubernetes', scope: 'cluster-uid', kind: 'node', nativeId: 'node-1', name: 'worker-node', health: 'healthy' };
  await saveScan(pool, 'alice', source, { scanId: 'scan-' + randomUUID(), collectionId: 'cluster-uid/operations-demo', observedAt: '2026-01-01T00:00:01.000Z', complete: true, assets: [pod, node], relationships: [{ from: pod, to: node, type: 'RUNS_ON', evidence: 'observed' }] });
  const ticketId = randomUUID();
  const current = { id: ticketId, ticketType: 'intelligent-operations', status: 'awaiting_approval', revision: 7, position: { name: 'queue-deliver', index: 3 } };
  const answersByWork = new Map();
  const ticketService = {
    async getTicket(id) { return id === ticketId ? { ...current } : null; },
    async getAcceptedWork(tid, wid) {
      if (tid !== ticketId || !answersByWork.has(wid)) return null;
      const answer = answersByWork.get(wid);
      return { ticketId: tid, workId: wid, phase: { index: 2, name: 'revise' }, answer, answerSha256: sha(answer), receipt: 'rcpt-' + wid.slice(0, 8), source: 'accepted-work-answer.md' };
    },
  };
  const ctx = { pool, ticketService };
  const target = { namespace: 'operations-demo', pod: 'api-worker-1', uid: UID, container: 'worker' };
  const makePlan = async (answer, createdIso) => {
    const wid = randomUUID();
    answersByWork.set(wid, answer);
    const plan = await X.preparePlan(ctx, 'alice', { ticketId, workId: wid, target });
    await f.inspect.query('UPDATE operations_action_plans SET created_at=$2::timestamptz, record=jsonb_set(record,\'{createdAt}\',to_jsonb($3::text)) WHERE id=$1', [plan.id, createdIso, createdIso]);
    return plan;
  };
  const plan1 = await makePlan(ANSWER_V1, '2026-11-20T10:00:00.000Z');
  const plan3 = await makePlan(ANSWER_V3, '2026-11-20T10:05:00.000Z');
  const plan2 = await makePlan(ANSWER_V2, '2026-11-20T10:10:00.000Z');
  const express = dependency('express');
  const app = express();
  const writes = [];
  let denyArtifacts = false;
  let holdPlanId = null;
  const heldReleases = [];
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') writes.push({ method: req.method, path: req.path });
    next();
  });
  app.get('/api/tickets', (_req, res) => res.json({ tickets: [current] }));
  app.get('/tickets/:id/work', (_req, res) => res.json({ work: [] }));
  app.get('/connectors', (_req, res) => res.json({ connections: [{ connector: 'kubernetes', account: 'primary', shared: false, status: 'connected' }], httpServices: [] }));
  app.use('/api/intelligent-operations/executions/plans/:planId/artifacts/:name', async (req, res, next) => {
    if (denyArtifacts) return res.status(403).json({ error: 'Access withdrawn' });
    if (holdPlanId && req.params.planId === holdPlanId) {
      await new Promise(resolve => heldReleases.push(resolve));
    }
    next();
  });
  app.use((req, _res, next) => { req.oidc = { user: { sub: 'alice' } }; next(); });
  app.use('/api/intelligent-operations', loadExperience().createOperationsExperienceRoutes({ ...ctx, appPackageDir: root, authorization: { registerResource() {} }, store: { query: async () => [], put: async () => {} } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { chromium } = dependency('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    browser, origin, plan1, plan2, plan3, writes,
    setDenyArtifacts(v) { denyArtifacts = v; },
    setHoldPlanId(id) { holdPlanId = id; },
    releaseHeld() { while (heldReleases.length) heldReleases.shift()(); },
    async close() { this.releaseHeld(); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); await f.close(); },
  };
}

test('shipped Response panel renders manifest table, non-authorization notice, XSS-safe unified diff, stale-response guard, 403 clearing, and fits desktop and phone', { timeout: 120000 }, async () => {
  const env = await setupMultiPlanBrowser();
  try {
    const page = await env.browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(env.origin + '/api/intelligent-operations/app#incidents');
    await page.locator('#status', { hasText: /^Updated / }).waitFor();
    await page.getByRole('button', { name: 'Refresh response plans', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('response-panel').getAttribute('aria-busy') === 'false');
    await page.locator(`#response-plans .card[data-plan-id="${env.plan2.id}"]`).waitFor();

    const card = page.locator(`#response-plans .card[data-plan-id="${env.plan2.id}"]`);
    await card.locator('.response-manifest > summary').click();
    await card.locator('.response-auth-notice').waitFor({ state: 'visible' });
    assert.match(await card.locator('.response-auth-notice').textContent(), /does not authorize execution/i);
    assert.match(await card.locator('.response-provenance-badge').textContent(), /Server-verified accepted work/);

    // Verify manifest rows: filename, sha256 prefix + full title, exact bytes, byte range, download href
    const remRow = card.locator('tr[data-manifest-file="remediate.sh"]');
    const remArt = env.plan2.artifacts.find(a => a.name === 'remediate.sh');
    assert.equal(await remRow.locator('.response-digest').textContent(), remArt.sha256.slice(0, 12));
    assert.equal(await remRow.locator('.response-digest').getAttribute('title'), remArt.sha256);
    assert.match(await remRow.textContent(), new RegExp(String(remArt.bytes) + ' B'));
    assert.match(await remRow.textContent(), new RegExp(`${remArt.range.start}\\.\\.${remArt.range.end}`));
    assert.equal(await remRow.locator('a').getAttribute('href'), `/api/intelligent-operations/executions/plans/${env.plan2.id}/artifacts/remediate.sh`);
    assert.equal(env.writes.length, 0, 'opening manifest triggers zero approve/execute or write requests');

    // Default compare selection is the immediately preceding plan (plan3 at 10:05, right before plan2 at 10:10)
    assert.equal(await card.locator('.response-compare-select').inputValue(), env.plan3.id, 'defaults to immediately preceding plan for the same ticket');

    // Select plan1 and click Show diff; verify unchanged/modified/added and XSS safety
    await card.locator('.response-compare-select').selectOption(env.plan1.id);
    await card.locator('.response-show-diff').click();
    await card.locator('.response-diff-results').waitFor({ state: 'visible' });

    assert.equal(await card.locator('.response-diff-file[data-diff-file="verify.sh"] .response-diff-pill').textContent(), 'unchanged');
    assert.equal(await card.locator('.response-diff-file[data-diff-file="remediate.sh"] .response-diff-pill').textContent(), 'modified');
    assert.equal(await card.locator('.response-diff-file[data-diff-file="diagnose.sh"] .response-diff-pill').textContent(), 'added');
    assert.equal(await card.locator('.response-diff-file[data-diff-file="rollback.md"] .response-diff-pill').textContent(), 'modified');

    const remDiffText = await card.locator('.response-diff-file[data-diff-file="remediate.sh"] .response-diff-code').textContent();
    assert.match(remDiffText, /-: > \/run\/pressure\/stop/);
    assert.match(remDiffText, /\+: > \/run\/pressure\/stop-v2/);

    const rollbackDiffText = await card.locator('.response-diff-file[data-diff-file="rollback.md"] .response-diff-code').textContent();
    assert.match(rollbackDiffText, /<script>window\.__xss=1<\/script>/);
    const xssCheck = await page.evaluate(() => ({
      xss: window.__xss ?? null,
      scripts: document.querySelectorAll('.response-diff-output script').length,
      imgs: document.querySelectorAll('.response-diff-output img').length,
    }));
    assert.deepEqual(xssCheck, { xss: null, scripts: 0, imgs: 0 }, 'hostile HTML/script renders strictly as textContent');
    assert.equal(env.writes.length, 0, 'showing diff triggers zero approve/execute or write requests');
    assert.equal(await card.getByRole('button', { name: 'Approve this exact action', exact: true }).isEnabled(), true);
    assert.equal(await card.getByRole('button', { name: 'Execute approved action', exact: true }).isDisabled(), true);

    // Check desktop (1440x900) and phone (412x915) zero horizontal overflow with manifest & diff open
    const desktopFit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(desktopFit.scroll <= desktopFit.client, `desktop horizontal overflow: ${desktopFit.scroll} > ${desktopFit.client}`);
    await page.setViewportSize({ width: 412, height: 915 });
    const phoneFit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(phoneFit.scroll <= phoneFit.client, `phone horizontal overflow: ${phoneFit.scroll} > ${phoneFit.client}`);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Stale out-of-order response guard: hold plan1 fetch, switch to plan3 and complete it, then release plan1
    env.setHoldPlanId(env.plan1.id);
    await card.locator('.response-compare-select').selectOption(env.plan1.id);
    await card.locator('.response-show-diff').click();
    await card.locator('.response-diff-status', { hasText: /Loading authenticated/ }).waitFor();
    await card.locator('.response-compare-select').selectOption(env.plan3.id);
    await card.locator('.response-show-diff').click();
    await card.locator('.response-diff-summary', { hasText: env.plan3.id.slice(0, 12) }).waitFor();
    env.setHoldPlanId(null);
    env.releaseHeld();
    await page.waitForTimeout(150);
    assert.match(await card.locator('.response-diff-summary').textContent(), new RegExp(env.plan3.id.slice(0, 12)));
    assert.match(await card.locator('.response-diff-file[data-diff-file="remediate.sh"] .response-diff-code').textContent(), /-echo "alt-plan-3"/);

    // 403 refusal during Show diff clears manifest & diff DOM cleanly
    env.setDenyArtifacts(true);
    await card.locator('.response-show-diff').click();
    await page.waitForFunction(() => document.getElementById('response-plans').childElementCount === 0);
    assert.equal(await page.locator('.response-manifest').count(), 0);
    assert.equal(await page.locator('.response-diff-output').count(), 0);
    assert.equal(env.writes.length, 0);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await env.close();
  }
});
