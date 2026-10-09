/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the engine half of the Career worker rail: the Python contract (tripwired subprocess/SDK modules, scripted rail fixture, real scorer), an end-to-end completion from the production engine through the COMPILED rail route to the Career bot double with the run owner's attribution, the unchanged standalone provider detection, and a source guard that enrich.py stays the engine's only model chokepoint.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Every Python run now gets a fixture host instead of the test host's: HOME/USERPROFILE/APPDATA/LOCALAPPDATA, CODEX_HOME and CLAUDE_CONFIG_DIR are empty fixture directories, CODEX_CLI_PATH names a file that does not exist, and PATH holds only the interpreter's own directory. The end-to-end and standalone programs also run under the contract's own subprocess/SDK tripwires, and the end-to-end case plants a codex login the engine must ignore. Before this, the host's login and CLI were inherited, so a regression that dropped complete()'s rail-first branch made the guard run a real `codex exec` on the host's login instead of failing fast.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The signed rail (1.25.1): the end-to-end case hands the production engine exactly what the runner mints (no service secret) and the completion it sends is verified by the compiled verifier over the real registry — the Python signer and the JavaScript verifier agree on the canonical string, or nothing is admitted; a settled run's request is refused as the kernel refuses it (callback_signature_invalid).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRailHarness } from './helpers/worker-rail-harness.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const engineRoot = join(packageRoot, 'engine');
const PYTHON = process.env.CAREER_TEST_PYTHON || 'python';
const CONTRACT = join(packageRoot, 'tests', 'career-model-rail-contract.py');
const SECRET = 'model-rail-fixture-secret';
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-model-rail-'));
const savedSecret = process.env.SWARM_SERVICE_SECRET;
process.env.SWARM_SERVICE_SECRET = SECRET;

const harness = loadRailHarness();
let server;
let pythonExe;
let fixtureHost;

/** Resolve the interpreter to an absolute path once, so the engine can run with a PATH of its own directory only. */
function resolvePython() {
  const probe = spawnSync(PYTHON, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  const executable = String(probe.stdout || '').trim();
  assert.ok(probe.status === 0 && executable, `python interpreter not found (${PYTHON}): ${probe.stderr || probe.error}`);
  return executable;
}

/**
 * A host with no logins and no CLIs: empty home, app-data and login directories, a codex CLI path that
 * does not exist. If a regression ever lets the engine look for a provider, it finds nothing of the
 * test host's to run.
 */
function createFixtureHost() {
  const home = join(fixtureRoot, 'host-home');
  const host = {
    HOME: home, USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
    CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
  };
  for (const dir of Object.values(host)) mkdirSync(dir, { recursive: true });
  return { ...host, CODEX_CLI_PATH: join(fixtureRoot, 'no-such-codex', 'codex.js') };
}

before(async () => {
  pythonExe = resolvePython();
  fixtureHost = createFixtureHost();
  server = await harness.startServer();
});
after(async () => {
  await server?.close();
  if (savedSecret === undefined) delete process.env.SWARM_SERVICE_SECRET; else process.env.SWARM_SERVICE_SECRET = savedSecret;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Run Python asynchronously so the in-process rail server keeps serving while it waits. */
function runPython(args, env) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(pythonExe, args, { cwd: packageRoot, env: { ...env, PYTHONPATH: engineRoot, PYTHONIOENCODING: 'utf-8' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: Date.now() - started }); });
  });
}

/**
 * A minimal environment on the fixture host: no provider key, login, CLI or PATH entry of the test
 * host's reaches the engine. Only the OS entries Python needs to start are kept.
 */
function baseEnv(extra) {
  const env = { JOBHUNTER_DATA: join(fixtureRoot, 'data'), PATH: dirname(pythonExe), ...fixtureHost };
  for (const key of ['SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

/**
 * Prefix a program with the contract's own tripwires (every subprocess entry point, the Anthropic
 * and OpenAI SDK modules), armed before the engine is imported. The contract path is argv[1].
 */
function tripwired(body) {
  return [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("career_rail_contract", sys.argv[1])',
    'contract = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(contract)',
    'contract.install_tripwires()',
    body,
  ].join('\n');
}

test('the engine contract holds: rail only, tripwires silent, failures propagate', async () => {
  const result = await runPython([CONTRACT], baseEnv({}));
  assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.deepEqual(report.failed, [], 'every contract check must hold');
  assert.deepEqual(report.tripped, [], 'no provider path may be reached');
  assert.ok(report.checks >= 33, `expected the full contract, ran ${report.checks}`);
});

test('a production engine completion reaches the Career bot through the compiled rail as its owner', async () => {
  harness.state.calls.length = 0;
  harness.state.behavior = async (request) => ({ success: true, response: `scored for ${request.userSub}` });
  const run = harness.runs.registerEngineRun('user-e2e', 'score', { ownerIssuer: 'https://issuer.oshal.example.com' });
  const trapHome = join(fixtureRoot, 'e2e-trap-codex');
  mkdirSync(trapHome, { recursive: true });
  writeFileSync(join(trapHome, 'auth.json'), '{}'); // a login the multi-user engine must ignore
  const env = baseEnv({
    JOBHUNTER_MULTIUSER: '1', OSHAL_USER_SUB: 'user-e2e', CODEX_HOME: trapHome,
    ...harness.runs.railChildEnv(run.runId, run.token, { port: String(server.port) }),
  });
  const program = tripwired('from jobhunter import enrich\nprint(json.dumps({"text": enrich.complete("SYS", "PROMPT"), "tripped": contract.TRIPPED}))');
  const result = await runPython(['-c', program, CONTRACT], env);
  assert.equal(result.code, 0, `exit ${result.code} after ${result.ms} ms\n${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { text: 'scored for user-e2e', tripped: [] });
  assert.equal(harness.state.calls.length, 1);
  const [{ request }] = harness.state.calls;
  assert.deepEqual(
    { userSub: request.userSub, taskId: request.taskId, direct: request.direct, agenticMode: request.agenticMode },
    { userSub: 'user-e2e', taskId: `career-engine-${run.runId}`, direct: true, agenticMode: false },
  );
  assert.equal(harness.runs.engineRunSnapshot(run.runId).railCalls, 1);
  harness.runs.settleEngineRun(run.runId, { code: 0 });

  const refused = await runPython(['-c', program, CONTRACT], env);
  assert.notEqual(refused.code, 0, 'a settled run token cannot complete anything');
  assert.match(refused.stderr, /career worker unavailable: callback_signature_invalid/);
  assert.doesNotMatch(refused.stderr, /tripwire:/);
  assert.equal(harness.state.calls.length, 1);
});

test('the standalone single-user engine keeps its legacy provider detection', async () => {
  const codexHome = join(fixtureRoot, 'standalone-codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'auth.json'), '{}');
  const program = tripwired('from jobhunter import enrich\nprint(json.dumps({"provider": enrich.provider(), "tripped": contract.TRIPPED}))');
  const standalone = await runPython(['-c', program, CONTRACT], baseEnv({ CODEX_HOME: codexHome }));
  assert.equal(standalone.code, 0, standalone.stderr);
  assert.deepEqual(JSON.parse(standalone.stdout.trim()), { provider: 'codex', tripped: [] });
  const multiuser = await runPython(['-c', program, CONTRACT], baseEnv({ CODEX_HOME: codexHome, JOBHUNTER_MULTIUSER: '1' }));
  assert.equal(multiuser.code, 0, multiuser.stderr);
  assert.deepEqual(JSON.parse(multiuser.stdout.trim()), { provider: 'oshal-bot', tripped: [] });
});

test('enrich.py stays the only engine module that can reach a model provider', () => {
  const providerAccess = /\b(?:import|from)\s+(?:anthropic|openai)\b|_codex_cmd|claude_bin|anthropic_auth|has_subscription_login|["']exec["'],\s*["']--json/;
  const offenders = readdirSync(join(engineRoot, 'jobhunter'))
    .filter((name) => name.endsWith('.py') && !['enrich.py', 'config.py'].includes(name))
    .filter((name) => providerAccess.test(readFileSync(join(engineRoot, 'jobhunter', name), 'utf8')));
  assert.deepEqual(offenders, [], 'a module outside the chokepoint reaches a provider directly');
  const enrich = readFileSync(join(engineRoot, 'jobhunter', 'enrich.py'), 'utf8');
  const complete = enrich.slice(enrich.indexOf('def complete('));
  assert.ok(complete.indexOf('if _rail_mode():') >= 0
    && complete.indexOf('if _rail_mode():') < complete.indexOf('_have_codex()'),
  'multi-user mode must take the rail before any provider branch');
});
