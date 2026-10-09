/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Source-level guard for the developer workspace index package: deterministic ids, bounded chunks, exclusion rules, the three-part gate and cited results.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove the guarded corpus: the effective manifest equals the one oshal-app.yaml declares; secret-shaped and identifier-carrying fixtures are skipped per rule while prose, role addresses and placeholders are indexed; the post-build rescan and --verify go red on a poisoned chunk; local publish-gate patterns load fail-closed and are never echoed; a local notes directory is indexed only when named; dev mode is server-held with a TTL that fails closed; the package tool returns a cited doc_id under the full gate and refuses each missing condition, and a forged x-oshal-dev-context header grants nothing.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | /status reports the served index's document count per source: checkout only for an index built without --notes-dir, checkout plus local-notes for one built with it; the manifest's scope is a value the kernel accepts (operator), not the `deployment` 0.2.0 declared.
 */

'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const guard = require('../tools/workspace-guard');
const { readDeclaredManifest } = require('../tools/workspace-manifest');
const { DEFAULT_OUTPUT, PACKAGE_DIR, buildIndex, excludedSegment, parseArgs, verifyIndexFile, writeIndex } = require('../tools/workspace-index');
const { DevModeRegistry, isDevWorkspaceQueryAllowed, refusalReason } = require('../tools/workspace-policy');
const { DEFAULT_INDEX, TOOL_NAME, createDevWorkspaceIndexRoutes, searchIndex } = require('../routes/dev-workspace');

const PKG = path.resolve(__dirname, '..');
const FIXTURE_CHECKOUT = path.join(__dirname, 'fixtures', 'checkout');
const SILENT = { debug() {}, info() {}, warn() {}, error() {} };
// Secret-shaped literals are assembled at runtime so no credential shape is ever committed.
const AWS_KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const GITHUB_TOKEN = 'ghp_' + 'a1'.repeat(15);
const PEM_HEADER = '-----BEGIN RSA ' + 'PRIVATE KEY-----';
const ASSIGNMENT = 'client_secret = ' + 'x9'.repeat(12);
const PERSONAL_EMAIL = 'first.last@mailhost.zz';
const OIDC_SUBJECT = 'google-oauth2|' + '1032547896541'.padEnd(21, '9');
const PHONE = '(415) 867-5309';

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dev-workspace-index-${label}-`));
}
function write(root, relative, text) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
async function withTemp(label, run) {
  const root = tempDir(label);
  try { return await run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('the effective index manifest is the one oshal-app.yaml declares, and ids are deterministic', () => {
  const declared = readDeclaredManifest(PKG);
  const first = buildIndex({ root: FIXTURE_CHECKOUT });
  const second = buildIndex({ root: FIXTURE_CHECKOUT });
  assert.deepEqual(first.manifest.include, declared.include);
  assert.deepEqual(first.manifest.exclude, declared.exclude);
  assert.equal(first.manifest.collection, declared.collection);
  assert.equal(first.collection, 'dev-workspace-local');
  assert.equal(first.manifest.local_notes, null);
  assert.equal(first.counts.documents, 5);
  assert.deepEqual(first.counts.skippedByRule, {});
  assert.deepEqual(first.documents.map((doc) => doc.path).sort(), [
    'CLAUDE.md', 'docs/BACKLOG.md', 'docs/adr/077-self-developing-platform.md',
    'docs/backlog/session-handover-2026-09-26.md', 'docs/runbooks/deploy-parity.md',
  ]);
  assert.deepEqual(first.documents.map((doc) => doc.doc_id), second.documents.map((doc) => doc.doc_id));
  for (const doc of first.documents) {
    assert.match(doc.doc_id, /^dev-workspace:[a-f0-9]{16}$/);
    assert.equal(doc.chunks[0].metadata.doc_id, doc.doc_id);
    assert.ok(doc.chunks.every((chunk) => chunk.text.length <= 1200));
  }
  assert.ok(first.manifest.secret_rules.includes('secret:aws-access-key'));
  assert.ok(first.manifest.identifier_rules.includes('identifier:personal-email'));
});

test('secret-shaped files are skipped per rule; prose, Change Log authors and placeholders are indexed', () => withTemp('secrets', (root) => {
  write(root, 'docs/adr/aws.md', `# Keys\n\nkey ${AWS_KEY} here`);
  write(root, 'docs/adr/github.md', `token ${GITHUB_TOKEN}`);
  write(root, 'docs/adr/pem.md', `${PEM_HEADER}\nMIIE...`);
  write(root, 'docs/adr/assign.md', `config\n${ASSIGNMENT}\n`);
  write(root, 'docs/adr/prose.md', '# Prose\n\nuser-facing copy, the session-engine, account-or-refuse rules.\n * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial\n');
  write(root, 'docs/adr/placeholder.md', `OPENAI_API_KEY=REPLACE_ME_${'x'.repeat(24)}\nSECRET=<your-secret-here-${'y'.repeat(16)}>\n`);
  const index = buildIndex({ root, include: ['docs/adr'] });
  assert.deepEqual(index.counts.skippedByRule, { 'secret:aws-access-key': 1, 'secret:github-token': 1, 'secret:private-key-block': 1, 'secret:assignment': 1 });
  assert.deepEqual(index.documents.map((doc) => doc.path), ['docs/adr/placeholder.md', 'docs/adr/prose.md']);
  assert.ok(!JSON.stringify(index).includes(AWS_KEY), 'a skipped secret never reaches the index');
}));

test('identifier-carrying files are skipped per rule; role, product and example addresses are allowed', () => withTemp('identifiers', (root) => {
  write(root, 'docs/adr/email.md', `mail ${PERSONAL_EMAIL} for details`);
  write(root, 'docs/adr/subject.md', `owner ${OIDC_SUBJECT}`);
  write(root, 'docs/adr/subject-value.md', '{ "sub": "103254789654123456789" }');
  write(root, 'docs/adr/phone.md', `call ${PHONE}`);
  write(root, 'docs/adr/allowed.md', '# Allowed\n\ncontact support@oshal.example.com, oshal@oswarm.ai, oss@oswarm.ai, alice@demo.local, maintainer@emeraldcoastsystemsgroup.com; docs use (202) 555-0142; example-user-sub is a fixture.\n');
  const index = buildIndex({ root, include: ['docs/adr'] });
  assert.deepEqual(index.counts.skippedByRule, { 'identifier:personal-email': 1, 'identifier:oidc-subject': 1, 'identifier:subject-value': 1, 'identifier:phone-number': 1 });
  assert.deepEqual(index.documents.map((doc) => doc.path), ['docs/adr/allowed.md']);
  assert.ok(!JSON.stringify(index).includes(PERSONAL_EMAIL));
}));

test('the post-build rescan and --verify go red on a poisoned chunk and never echo the content', () => withTemp('poison', (root) => {
  const clean = buildIndex({ root: FIXTURE_CHECKOUT });
  const cleanFile = writeIndex(clean, path.join(root, 'clean.json'));
  assert.equal(verifyIndexFile(cleanFile).counts.documents, 5);
  assert.deepEqual(guard.scanIndex(clean, guard.buildRules({ checkoutRoot: root })), []);
  const poisoned = JSON.parse(JSON.stringify(clean));
  poisoned.documents[0].chunks.push({ chunk_id: 'poison:0', text: `leaked ${AWS_KEY}`, metadata: {} });
  const poisonedFile = writeIndex(poisoned, path.join(root, 'poisoned.json'));
  assert.throws(() => verifyIndexFile(poisonedFile, { root }), (error) => {
    assert.equal(error.code, 'DEV_WORKSPACE_GUARD');
    assert.deepEqual(error.hits.map((hit) => [hit.chunk_id, hit.rule]), [['poison:0', 'secret:aws-access-key']]);
    assert.ok(!JSON.stringify(error.hits).includes(AWS_KEY) && !error.message.includes(AWS_KEY));
    return true;
  });
  const cli = spawnSync(process.execPath, [path.join(PKG, 'tools', 'workspace-index.js'), '--verify', poisonedFile, '--root', root], { encoding: 'utf8' });
  assert.equal(cli.status, 1, 'the CLI exits non-zero on a guarded chunk');
  assert.match(cli.stderr, /DEV_WORKSPACE_GUARD/);
  assert.ok(!cli.stderr.includes(AWS_KEY) && !cli.stdout.includes(AWS_KEY));
  const ok = spawnSync(process.execPath, [path.join(PKG, 'tools', 'workspace-index.js'), '--verify', cleanFile, '--root', root], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).documents, 5);
}));

test('the post-build rescan inside buildIndex refuses an identifier carried by a file NAME', () => withTemp('filename', (root) => {
  write(root, `docs/adr/${PERSONAL_EMAIL}.md`, '# Clean body\n\nnothing personal in the text');
  write(root, 'docs/adr/clean.md', 'fine');
  assert.throws(() => buildIndex({ root, include: ['docs/adr'] }), (error) => {
    assert.equal(error.code, 'DEV_WORKSPACE_GUARD');
    assert.deepEqual(error.hits.map((hit) => [hit.chunk_id, hit.rule]), [[null, 'identifier:personal-email']]);
    return true;
  });
}));

test('local publish-gate patterns load fail-closed, count only, and are never echoed', () => withTemp('local', (root) => {
  write(root, 'scripts/publish-gate.local.patterns', '# operator identifiers\nZebraCorp\n\n');
  write(root, 'docs/adr/named.md', 'ZebraCorp signed the order');
  write(root, 'docs/adr/clean.md', 'nothing to see');
  const index = buildIndex({ root, include: ['docs/adr'] });
  assert.equal(index.manifest.local_identifier_rules, 1);
  assert.deepEqual(index.counts.skippedByRule, { 'identifier:local-pattern': 1 });
  assert.deepEqual(index.documents.map((doc) => doc.path), ['docs/adr/clean.md']);
  assert.ok(!JSON.stringify(index).includes('ZebraCorp'), 'the pattern text is not stored in the index');
  const broken = path.join(root, 'broken.patterns');
  fs.writeFileSync(broken, '([\n');
  assert.throws(() => buildIndex({ root, include: ['docs/adr'], localPatterns: broken }), (error) => {
    assert.match(error.message, /does not compile/);
    assert.ok(!error.message.includes('(['));
    return true;
  });
  assert.throws(() => buildIndex({ root, include: ['docs/adr'], localPatterns: path.join(root, 'docs') }), /unreadable/);
  const without = buildIndex({ root: FIXTURE_CHECKOUT });
  assert.equal(without.manifest.local_identifier_rules, 0);
}));

test('a local notes directory is ignored unless named, then indexed under its prefix and guarded', () => withTemp('notes', (root) => {
  const notes = path.join(root, 'session-notes');
  write(notes, 'handover.md', '# Tonight handover\n\nthe lanes finished and the box is quiet');
  write(notes, 'person.md', `met ${PERSONAL_EMAIL}`);
  const silent = buildIndex({ root: FIXTURE_CHECKOUT });
  assert.ok(silent.documents.every((doc) => doc.source === 'checkout'));
  const named = buildIndex({ root: FIXTURE_CHECKOUT, notesDir: notes });
  assert.equal(named.manifest.local_notes, 'local-notes');
  const note = named.documents.find((doc) => doc.path === 'local-notes/handover.md');
  assert.equal(note.source, 'local-notes');
  assert.equal(note.chunks[0].metadata.source, 'local-notes');
  assert.deepEqual(named.skipped, [{ path: 'local-notes/person.md', reason: 'identifier:personal-email' }]);
  assert.throws(() => buildIndex({ root: FIXTURE_CHECKOUT, notesDir: path.join(root, 'missing') }), /not a directory/);
}));

test('COLLABORATE.md stays out unless explicitly lifted, and only at the checkout root', () => withTemp('collab', (root) => {
  write(root, 'COLLABORATE.md', '# Thread\n\nclaims and releases');
  write(root, 'docs/adr/COLLABORATE.md', 'nested copy');
  write(root, 'docs/adr/ok.md', 'fine');
  const closed = buildIndex({ root, include: ['docs/adr'] });
  assert.deepEqual(closed.documents.map((doc) => doc.path), ['docs/adr/ok.md']);
  assert.deepEqual(closed.skipped, [{ path: 'docs/adr/COLLABORATE.md', reason: 'excluded path' }]);
  const lifted = buildIndex({ root, include: ['docs/adr'], includeCollaborate: true });
  assert.deepEqual(lifted.documents.map((doc) => doc.path).sort(), ['COLLABORATE.md', 'docs/adr/ok.md']);
  assert.equal(lifted.manifest.include_collaborate, true);
  assert.deepEqual(lifted.skipped, [{ path: 'docs/adr/COLLABORATE.md', reason: 'excluded path' }]);
}));

test('declared excluded segments and every .env variant are refused anywhere in a path', () => {
  const { exclude } = readDeclaredManifest(PKG);
  for (const relative of ['config-seed/seed.md', '.env.local', 'docs/.env/notes.md', 'lane-clones/x/y.md', 'transcripts/t.md', 'node_modules/p/README.md', 'docs/scratch/a.md']) {
    assert.equal(excludedSegment(relative, exclude), 'excluded path', relative);
  }
  assert.equal(excludedSegment('docs/adr/ok.md', exclude), null);
  assert.equal(excludedSegment('docs/environment.md', exclude), null);
});

test('the CLI default output is the package data file the route reads', () => {
  assert.equal(parseArgs([]).output, path.join(PACKAGE_DIR, DEFAULT_OUTPUT));
  assert.equal(path.join(PKG, DEFAULT_INDEX), path.join(PACKAGE_DIR, DEFAULT_OUTPUT));
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
});

test('dev mode is server-held per issuer and subject, expires by TTL, and a new process starts closed', () => {
  let clock = 1_000;
  const registry = new DevModeRegistry({ ttlMs: 500, now: () => clock });
  const alice = { sub: 'alice', issuer: 'https://identity.example.test', isActive: true };
  assert.equal(registry.isEnabled(alice), false);
  assert.deepEqual(registry.enable(alice), { enabled: true, expiresAt: new Date(1_500).toISOString() });
  assert.equal(registry.isEnabled(alice), true);
  assert.equal(registry.isEnabled({ ...alice, issuer: 'https://other.example.test' }), false, 'same sub, other issuer');
  assert.equal(registry.isEnabled({ ...alice, sub: 'bob' }), false);
  clock = 1_500;
  assert.equal(registry.isEnabled(alice), false, 'expired at the TTL boundary');
  registry.enable(alice);
  assert.equal(new DevModeRegistry({ ttlMs: 500, now: () => clock }).isEnabled(alice), false, 'a restart holds no grants');
  assert.deepEqual(registry.disable(alice), { enabled: false, expiresAt: null });
  assert.throws(() => registry.enable({ sub: '', issuer: '' }), /verified actor/);
  assert.throws(() => new DevModeRegistry({ ttlMs: 0 }), /ttlMs/);
});

test('the gate needs every condition and names the first failing one', () => {
  const all = { devConsoleEnabled: true, superAdmin: true, packageEnabled: true, devMode: true };
  assert.equal(isDevWorkspaceQueryAllowed(all), true);
  assert.equal(refusalReason(all), null);
  assert.equal(refusalReason({ ...all, devConsoleEnabled: false }), 'dev_console_disabled');
  assert.equal(refusalReason({ ...all, superAdmin: false }), 'super_admin_required');
  assert.equal(refusalReason({ ...all, packageEnabled: false }), 'package_disabled');
  assert.equal(refusalReason({ ...all, devMode: false }), 'dev_mode_off');
  assert.equal(isDevWorkspaceQueryAllowed({ ...all, devMode: 'adr-077' }), false, 'a truthy string is not true');
});

test('query results carry doc_id citations and bounded excerpts', () => {
  const index = { documents: [{ doc_id: 'dev-workspace:abc', title: 'ADR-077', path: 'docs/adr/077.md', source: 'checkout', chunks: [{ text: 'Developer console context and cited document.', chunk_id: 'abc:0' }] }] };
  const results = searchIndex(index, 'developer console');
  assert.equal(results.length, 1);
  assert.equal(results[0].doc_id, 'dev-workspace:abc');
  assert.equal(results[0].path, 'docs/adr/077.md');
  assert.ok(results[0].excerpt.length <= 420);
  assert.deepEqual(searchIndex(index, ''), []);
});

function fakeReq(method, url, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { method, url, protocol: 'http', get: (name) => lower[name.toLowerCase()] };
}
function fakeRes() {
  const res = { statusCode: 200, body: null, kind: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.kind = 'json'; res.body = body; return res; };
  res.type = () => res;
  res.send = (body) => { res.kind = 'send'; res.body = body; return res; };
  return res;
}
const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'x-oshal-dev-workspace': '1' };

function routeFixture(root, { notesDir = null } = {}) {
  const index = buildIndex({ root: FIXTURE_CHECKOUT, notesDir });
  const indexFile = writeIndex(index, path.join(root, 'index.json'));
  const previous = { path: process.env.OSHAL_DEV_WORKSPACE_INDEX_PATH, enabled: process.env.OSHAL_DEV_WORKSPACE_INDEX_ENABLED };
  process.env.OSHAL_DEV_WORKSPACE_INDEX_PATH = indexFile;
  process.env.OSHAL_DEV_WORKSPACE_INDEX_ENABLED = 'true';
  const state = { current: { sub: 'alice', issuer: 'https://identity.example.test', isActive: true }, consoleOn: true, clock: 10_000 };
  const tools = {}; const resources = [];
  const ctx = {
    appPackageDir: PKG,
    authorization: { currentActor: () => state.current, registerResource: (name) => resources.push(name) },
    tools: { register: (name, handler) => { tools[name] = handler; } },
    devWorkspaceGates: { devConsoleEnabled: () => state.consoleOn, isSuperAdminSub: (sub) => sub === 'alice' },
    devWorkspaceDevMode: new DevModeRegistry({ ttlMs: 1_000, now: () => state.clock }),
    devWorkspaceLogger: SILENT,
  };
  const handler = createDevWorkspaceIndexRoutes(ctx);
  const call = (method, url, headers) => { const res = fakeRes(); handler(fakeReq(method, url, headers), res, () => { res.statusCode = 404; }); return res; };
  const refusal = (input, code, reason) => assert.rejects(tools[TOOL_NAME](input), (error) => error.code === code && (reason === undefined || error.reason === reason));
  const restore = () => { process.env.OSHAL_DEV_WORKSPACE_INDEX_PATH = previous.path ?? ''; process.env.OSHAL_DEV_WORKSPACE_INDEX_ENABLED = previous.enabled ?? ''; };
  const docId = (relative) => index.documents.find((doc) => doc.path === relative).doc_id;
  return { call, docId, refusal, resources, restore, state, tool: (input) => tools[TOOL_NAME](input), tools };
}

test('the package tool and routes return cited doc_ids once a super-admin turns dev mode on', () => withTemp('route-ok', async (root) => {
  const fx = routeFixture(root);
  try {
    assert.equal(typeof fx.tools[TOOL_NAME], 'function');
    assert.deepEqual(fx.resources, ['workspace']);
    await fx.refusal({ query: 'ADR-077' }, 'dev_workspace_unavailable', 'dev_mode_off');
    assert.equal(fx.call('POST', '/dev-mode').statusCode, 403, 'cross-origin switch refused');
    assert.equal(fx.call('GET', '/query?q=ADR-077', { 'x-oshal-dev-context': 'adr-077' }).body.reason, 'dev_mode_off', 'a forged header is not authority');
    const on = fx.call('POST', '/dev-mode', SAME_ORIGIN);
    assert.equal(on.statusCode, 200); assert.equal(on.body.devMode.enabled, true);
    const adr = await fx.tool({ query: 'ADR-077' });
    assert.equal(adr.results[0].doc_id, fx.docId('docs/adr/077-self-developing-platform.md'));
    assert.match(adr.citation, /doc_id/);
    const handover = await fx.tool({ query: 'tonight handover', limit: 2 });
    assert.equal(handover.results[0].path, 'docs/backlog/session-handover-2026-09-26.md');
    const runbook = fx.call('GET', '/query?q=deploy%20parity');
    assert.equal(runbook.statusCode, 200); assert.equal(runbook.body.results[0].path, 'docs/runbooks/deploy-parity.md');
    assert.equal(fx.call('GET', '/status').body.counts.documents, 5);
    assert.deepEqual(fx.call('GET', '/status').body.sources, { checkout: 5 });
    assert.equal(fx.call('GET', '/dev-mode').body.devMode.enabled, true);
    assert.equal(fx.call('GET', '/elsewhere').statusCode, 404, 'unknown paths fall through');
  } finally { fx.restore(); }
}));

test('/status counts documents per source, so an index built without --notes-dir is visible as such', () => withTemp('route-sources', async (root) => {
  const notes = path.join(root, 'notes');
  write(notes, 'handover.md', '# Tonight handover\n\nthe lanes finished and the box is quiet');
  const fx = routeFixture(root, { notesDir: notes });
  try {
    assert.equal(fx.call('GET', '/status').statusCode, 403, 'status needs dev mode like every read');
    fx.call('POST', '/dev-mode', SAME_ORIGIN);
    const status = fx.call('GET', '/status').body;
    assert.deepEqual(status.sources, { checkout: 5, 'local-notes': 1 });
    assert.equal(status.counts.documents, 6);
    const handover = await fx.tool({ query: 'tonight handover quiet', limit: 3 });
    assert.equal(handover.results[0].path, 'local-notes/handover.md');
    assert.match(handover.results[0].doc_id, /^dev-workspace:[0-9a-f]{16}$/);
  } finally { fx.restore(); }
}));

test('the manifest declares a scope the kernel accepts', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /^scope: operator$/m);
  assert.doesNotMatch(manifest, /^scope: deployment$/m);
});

test('the package tool refuses each missing condition, bad input, an expired TTL and a missing index', () => withTemp('route-refuse', async (root) => {
  const fx = routeFixture(root);
  try {
    fx.call('POST', '/dev-mode', SAME_ORIGIN);
    await fx.refusal({ query: 'x', actor: fx.state.current }, 'invalid_tool_input');
    await fx.refusal({ query: '' }, 'invalid_tool_input');
    fx.state.current = { sub: 'bob', issuer: 'https://identity.example.test', isActive: true };
    await fx.refusal({ query: 'ADR-077' }, 'dev_workspace_unavailable', 'super_admin_required');
    assert.equal(fx.call('POST', '/dev-mode', SAME_ORIGIN).body.reason, 'super_admin_required');
    fx.state.current = { sub: 'alice', issuer: 'https://identity.example.test', isActive: true };
    fx.state.consoleOn = false; await fx.refusal({ query: 'ADR-077' }, 'dev_workspace_unavailable', 'dev_console_disabled');
    fx.state.consoleOn = true; process.env.OSHAL_DEV_WORKSPACE_INDEX_ENABLED = 'false';
    await fx.refusal({ query: 'ADR-077' }, 'dev_workspace_unavailable', 'package_disabled');
    process.env.OSHAL_DEV_WORKSPACE_INDEX_ENABLED = 'true'; fx.state.clock += 1_000;
    await fx.refusal({ query: 'ADR-077' }, 'dev_workspace_unavailable', 'dev_mode_off');
    fx.call('POST', '/dev-mode', SAME_ORIGIN);
    assert.equal(fx.call('DELETE', '/dev-mode', SAME_ORIGIN).body.devMode.enabled, false);
    await fx.refusal({ query: 'ADR-077' }, 'dev_workspace_unavailable', 'dev_mode_off');
    fx.call('POST', '/dev-mode', SAME_ORIGIN);
    process.env.OSHAL_DEV_WORKSPACE_INDEX_PATH = path.join(root, 'missing.json');
    await fx.refusal({ query: 'ADR-077' }, 'dev_workspace_index_missing');
    assert.equal(fx.call('GET', '/query?q=ADR-077').statusCode, 503);
    fx.state.current = undefined;
    await fx.refusal({ query: 'ADR-077' }, 'signed_in_owner_required');
    assert.equal(fx.call('GET', '/dev-mode').statusCode, 401);
  } finally { fx.restore(); }
}));
