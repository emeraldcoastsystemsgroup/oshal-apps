/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the seven-day observation window and its operator status route: the real observe_cutover bounds and window functions write the archive, and the COMPILED route serves it over loopback HTTP - 401 anonymous, 403 non-operator, not-started, observing, reset and complete, with no owner breakdown in the response. Scoped doubles: the Express Router (a recorder served by node:http), the kernel OIDC session (a header-driven stand-in), isOperator (a mirror of the kernel's OSHAL_OPERATOR_SUBS break-glass branch), the logger, and the two modules career-user-store loads but this route never calls (better-sqlite3, caller-sub).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A corrupt window.json must reset the window, not silently restart it: after five in-bounds samples a truncated window.json makes the REAL main() log window-unreadable at ERROR, keep the bad file aside, record the reset and exit 2 (scoped double: take_sample, the database-reading signal collector); valid JSON that is not an object resets the same way, and the next in-bounds sample starts a fresh window.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const archive = mkdtempSync(join(tmpdir(), 'career-cutover-archive-'));
const OPERATOR = 'cutover-operator';
const OWNER = 'cutover-plain-owner';
after(() => rmSync(archive, { recursive: true, force: true }));

/** Load the compiled route with kernel stand-ins (named in the CHANGE LOG). */
function loadRoute() {
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'express') {
      return { Router: () => { const routes = []; return { routes, get: (path, handler) => routes.push({ path, handler }) }; } };
    }
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    if (request === '@/shared/middleware/authz') {
      return {
        isOperator: (req) => (process.env.OSHAL_OPERATOR_SUBS || '').split(',').includes(req.oidc?.user?.sub),
        getTrustedServiceUserSub: () => null,
      };
    }
    if (request === '@/app/routes/caller-sub') return { callerSub: () => null };
    if (request === 'better-sqlite3') return function NeverOpened() { throw new Error('the status route opened SQLite'); };
    return original.call(this, request, ...rest);
  };
  try { return require('../routes/career-cutover-status.js'); } finally { Module._load = original; }
}

const route = loadRoute();

/** Serve GET /api/career-hunter/cutover/status; x-test-user stands in for the OIDC session. */
function serve() {
  const router = route.createCareerCutoverStatusRoutes({});
  const handler = router.routes.find((entry) => entry.path === '/status').handler;
  const server = http.createServer((req, res) => {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    const user = req.headers['x-test-user'];
    req.oidc = user ? { user: { sub: user }, isAuthenticated: () => true } : { isAuthenticated: () => false };
    if (req.url !== '/api/career-hunter/cutover/status') { res.status(404).json({}); return; }
    handler(req, res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function status(server, user) {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/career-hunter/cutover/status`,
    { headers: user ? { 'x-test-user': user } : {} });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), text };
}

/**
 * Record samples through the REAL observe_cutover functions: violations() judges each set of
 * signals and record() writes samples/, latest.json and window.json exactly as a live run does.
 */
function record(signals, dir = archive) {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(join(packageRoot, 'engine', 'sync'))})`,
    'import observe_cutover as o',
    'from pathlib import Path',
    'archive, specs = Path(sys.argv[1]), json.loads(sys.argv[2])',
    'policy = dict(o.DEFAULT_POLICY)',
    'for s in specs:',
    '    sample = {"schemaVersion": 1, "sampledAt": s["at"],',
    '        "nightly": {"completedAt": s["at"] if s.get("marker", True) else None, "ageHours": 1, "ok": s.get("marker", True)},',
    '        "convergence": {"converged": s.get("converged", True), "failures": [], "owners": 2, "seconds": 0.1, "corpus": {}},',
    '        "reverseSync": {"caughtUp": True, "pendingRows": 0, "lagSeconds": s.get("lag", 0), "rowFailures": 0, "lastError": s.get("error"), "outstandingClaims": 0},',
    '        "rls": {"probedOwners": 2, "foreignRowsVisible": 0 if s.get("rls", True) else 3, "byOwner": {"owner-abc": 0}, "ok": s.get("rls", True)},',
    '        "activity": {"postingsIngested": 5}, "archivedReport": None}',
    '    sample["violations"] = o.violations(sample, policy)',
    '    sample["inBounds"] = not sample["violations"]',
    '    window = o.record(archive, sample, policy)',
    'print("WINDOW=" + json.dumps(window))',
  ].join('\n');
  const result = spawnSync('python', ['-c', script, dir, JSON.stringify(signals)], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.split(/\r?\n/).find((line) => line.startsWith('WINDOW=')).slice(7));
}

const day = (n, hour = 1) => new Date(Date.UTC(2026, 9, 1 + n, hour)).toISOString().replace('.000Z', '+00:00');

test('anonymous is 401 and a signed-in non-operator is 403, before the archive is read', async () => {
  // An archive whose window.json is a directory makes any read a 500, so a 401/403 here proves
  // the refusal happened before the route touched the archive.
  const unreadable = mkdtempSync(join(tmpdir(), 'career-cutover-unreadable-'));
  mkdirSync(join(unreadable, 'window.json'));
  process.env.CAREER_CUTOVER_ARCHIVE_DIR = unreadable;
  process.env.OSHAL_OPERATOR_SUBS = OPERATOR;
  const server = await serve();
  try {
    assert.deepEqual(await status(server), { status: 401, body: { error: 'not_authenticated' }, text: '{"error":"not_authenticated"}' });
    assert.equal((await status(server, OWNER)).status, 403);
    assert.equal((await status(server, OPERATOR)).status, 500, 'the operator path does read the archive');
    process.env.CAREER_CUTOVER_ARCHIVE_DIR = archive;
    const empty = await status(server, OPERATOR);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { schemaVersion: 1, state: 'not-started', window: null, latest: null });
  } finally {
    server.close();
    rmSync(unreadable, { recursive: true, force: true });
  }
});

test('in-bounds daily samples observe, and seven days of them complete the window', async () => {
  const window = record(Array.from({ length: 8 }, (_, n) => ({ at: day(n) })));
  assert.equal(window.complete, true);
  assert.equal(window.startedAt, day(0));
  assert.equal(window.completedAt, day(7));
  assert.equal(window.inBoundsSamples, 8);
  const server = await serve();
  try {
    const { status: code, body, text } = await status(server, OPERATOR);
    assert.equal(code, 200);
    assert.equal(body.state, 'complete');
    assert.equal(body.latest.inBounds, true);
    assert.deepEqual(body.latest.rls, { probedOwners: 2, foreignRowsVisible: 0, ok: true });
    assert.doesNotMatch(text, /owner-abc|byOwner/, 'the per-owner probe breakdown must stay in the archive');
  } finally { server.close(); }
});

test('a missing sample, a failed marker, drift, lag or an isolation leak each reset the window', () => {
  const cases = [
    [{ at: day(10) }, ['missing-sample']],
    [{ at: day(11), marker: false }, ['nightly-marker-missing']],
    [{ at: day(12), converged: false }, ['convergence-drift']],
    [{ at: day(13), lag: 5000 }, ['projector-lag']],
    [{ at: day(14), error: 'change 9: unknown table' }, ['projector-failed']],
    [{ at: day(15), rls: false }, ['rls-isolation']],
  ];
  for (const [signals, reasons] of cases) {
    const window = record([signals]);
    assert.equal(window.startedAt, null, JSON.stringify(signals));
    assert.equal(window.complete, false);
    assert.deepEqual(window.resets.at(-1).reasons, reasons);
  }
  const recovered = record([{ at: day(16) }, { at: day(17) }]);
  assert.equal(recovered.startedAt, day(16));
  assert.equal(recovered.complete, false);
});

test('the route reports a reset window as observing with its reasons', async () => {
  record([{ at: day(18), marker: false }]);
  const server = await serve();
  try {
    const { body } = await status(server, OPERATOR);
    assert.equal(body.state, 'observing');
    assert.equal(body.window.startedAt, null);
    assert.deepEqual(body.latest.violations, ['nightly-marker-missing']);
    const stored = JSON.parse(readFileSync(join(archive, 'window.json'), 'utf8'));
    assert.deepEqual(body.window, stored);
  } finally { server.close(); }
});

/**
 * Take one in-bounds sample through the REAL observe_cutover.main(), with only take_sample (the
 * collector that reads PostgreSQL and SQLite) replaced, and return its exit status and output.
 */
function sampleThroughMain(dir, at) {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(join(packageRoot, 'engine', 'sync'))})`,
    'import observe_cutover as o',
    'dir, at = sys.argv[1], sys.argv[2]',
    'def take_sample(args, policy, now, window):',
    '    print("WINDOW_ARG=" + json.dumps(window))',
    '    sample = {"schemaVersion": 1, "sampledAt": at,',
    '        "nightly": {"completedAt": at, "ageHours": 1, "ok": True},',
    '        "convergence": {"converged": True, "failures": [], "owners": 2, "seconds": 0.1, "corpus": {}},',
    '        "reverseSync": {"caughtUp": True, "pendingRows": 0, "lagSeconds": 0, "rowFailures": 0, "lastError": None, "outstandingClaims": 0},',
    '        "rls": {"probedOwners": 2, "foreignRowsVisible": 0, "byOwner": {}, "ok": True},',
    '        "activity": {"postingsIngested": 1}}',
    '    sample["violations"] = o.violations(sample, policy)',
    '    sample["inBounds"] = not sample["violations"]',
    '    return sample, {"converged": True}',
    'o.take_sample = take_sample',
    'sys.exit(o.main(["--data-root", dir, "--database-url", "postgresql://unused.invalid/none", "--archive-dir", dir, "--now", at]))',
  ].join('\n');
  const result = spawnSync('python', ['-c', script, dir, at], { encoding: 'utf8', timeout: 30_000 });
  const line = (prefix) => result.stdout.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  return {
    status: result.status,
    stderr: result.stderr,
    windowArg: JSON.parse(line('WINDOW_ARG=').slice('WINDOW_ARG='.length)),
    window: JSON.parse(line('CAREER_CUTOVER_OBSERVATION=').slice('CAREER_CUTOVER_OBSERVATION='.length)).window,
  };
}

test('an unreadable window.json is logged, kept aside and resets the window; the sample exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-cutover-corrupt-'));
  try {
    const observed = record(Array.from({ length: 5 }, (_, n) => ({ at: day(30 + n) })), dir);
    assert.equal(observed.inBoundsSamples, 5);
    assert.equal(observed.startedAt, day(30));
    writeFileSync(join(dir, 'window.json'), '{ truncated');

    const corrupt = sampleThroughMain(dir, day(35));
    assert.equal(corrupt.status, 2, corrupt.stderr);
    assert.match(corrupt.stderr, /"event": "window-unreadable"/);
    assert.equal(corrupt.windowArg, null, 'nothing from the unreadable window may feed the sample');
    assert.equal(corrupt.window.startedAt, null);
    assert.equal(corrupt.window.inBoundsSamples, 0);
    assert.equal(corrupt.window.lastSampleReset, true);
    assert.deepEqual(corrupt.window.resets.at(-1), { at: day(35), reasons: ['window-unreadable'] });
    const kept = readdirSync(dir).filter((name) => name.startsWith('window.unreadable-'));
    assert.equal(kept.length, 1, 'the unreadable file is kept aside, not overwritten');
    assert.equal(readFileSync(join(dir, kept[0]), 'utf8'), '{ truncated');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'window.json'), 'utf8')), corrupt.window);

    writeFileSync(join(dir, 'window.json'), '[]');
    const notObject = record([{ at: day(36) }], dir);
    assert.deepEqual(notObject.resets.at(-1).reasons, ['window-unreadable']);
    assert.equal(notObject.lastSampleReset, true);

    const fresh = record([{ at: day(37) }], dir);
    assert.equal(fresh.lastSampleReset, false);
    assert.equal(fresh.startedAt, day(37));
    assert.equal(fresh.inBoundsSamples, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
