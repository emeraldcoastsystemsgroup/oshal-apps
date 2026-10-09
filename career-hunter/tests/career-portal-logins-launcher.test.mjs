/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-137 amendment A guard at the LAUNCHER boundary: bin/oshal-jobhunter.js builds the Python child's environment itself, so the runner's carve is only real if this file yields its .brokered-auth-only wall — and only to the runner's exact OSHAL_PORTAL_LOGINS=1 verdict. The 1.12.4 release proved a runner-only guard is not closure evidence: live scoring still raised "No AI auth found".
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Inverted for the Career worker rail (1.24.0): the carve is retired, so this is now the guard that NO verb's engine environment carries a vendor login location or a model-provider key — for the deployment operator under DEMO_MODE too, and even when a caller smuggles the old OSHAL_PORTAL_LOGINS verdict or provider keys into the launcher's own environment. The Firecrawl key (deterministic web search) and the runner-minted rail entries are the only brokered values that pass.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The signed rail (1.25.1): the fleet service secret and the retired bearer token are planted in the launcher's own environment, and the guard is that neither reaches the Python child under any name for any verb — only the URL, the per-run grant, the run id and the client timeout are forwarded — and that neither the launcher nor the runner source names them.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-portal-logins-'));
const hostileEnv = {
  // The retired carve's two gates, and its verdict, all present at once.
  DEMO_MODE: 'true',
  OSHAL_OPERATOR_SUBS: 'operator-1',
  OSHAL_PORTAL_LOGINS: '1',
  // Mounted vendor logins and model keys the controller itself may run with.
  CODEX_HOME: path.join(fixtureRoot, 'mounted', '.codex'),
  CLAUDE_CONFIG_DIR: path.join(fixtureRoot, 'mounted', '.claude'),
  ANTHROPIC_API_KEY: 'controller-anthropic',
  OPENAI_API_KEY: 'controller-openai',
  OSHAL_CRED_ANTHROPIC: 'brokered-anthropic',
  // What the controller legitimately brokered and minted for this run.
  CAREER_HUNTER_BROKER_COMPLETE: '1',
  OSHAL_CRED_FIRECRAWL: 'brokered-firecrawl',
  CAREER_RAIL_URL: 'http://127.0.0.1:5000/api/career-hunter/engine/complete',
  CAREER_RAIL_GRANT: `11111111-1111-4111-8111-111111111111.${'g'.repeat(43)}`,
  CAREER_RAIL_RUN_ID: '11111111-1111-4111-8111-111111111111',
  CAREER_RAIL_TIMEOUT_S: '330',
  // The fleet secret and the retired 1.24.0 rail names, present in the launcher's own environment:
  // none of them may reach the engine.
  SWARM_SERVICE_SECRET: 'fleet-service-secret',
  CAREER_RAIL_TOKEN: 'r'.repeat(43),
  CAREER_RAIL_SERVICE_SECRET: 'fleet-service-secret',
  JOBHUNTER_STORE_ROOT: path.join(fixtureRoot, 'store'),
  HOME: path.join(fixtureRoot, 'home'),
  USERPROFILE: path.join(fixtureRoot, 'home'),
};
const savedEnv = Object.fromEntries(Object.keys(hostileEnv).map((key) => [key, process.env[key]]));
Object.assign(process.env, hostileEnv);

after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Load the launcher without running main() and expose its private environment builder. */
function loadBuildEngineEnv() {
  const launcher = new Module(binPath);
  launcher.filename = binPath;
  launcher.paths = Module._nodeModulePaths(path.dirname(binPath));
  const source = `${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__buildEngineEnv = buildEngineEnv;`;
  launcher._compile(source, binPath);
  return launcher.exports.__buildEngineEnv;
}

const buildEngineEnv = loadBuildEngineEnv();

/** The per-user store layout the launcher's prepareStore returns for one subject. */
function storeFor(subject) {
  const userDir = path.join(fixtureRoot, 'store', 'default', subject);
  return {
    userDir,
    careerDb: path.join(userDir, 'career_db.json'),
    corpusDb: path.join(fixtureRoot, 'store', 'default', 'corpus.db'),
    userDb: path.join(userDir, `user-${subject}.db`),
  };
}

const MODEL_VERBS = ['score', 'score-titles', 'draft', 'tailor', 'rerender', 'guide-actions', 'stories',
  'ingest', 'absorb', 'absorb-batch', 'augment', 'strengthen', 'resume', 'enrich', 'pull', 'match', 'discover'];

test('no verb hands the engine a vendor login or a model-provider key, for the demo operator too', async () => {
  for (const subject of ['operator-1', 'user-7']) {
    const store = storeFor(subject);
    for (const verb of MODEL_VERBS) {
      const env = await buildEngineEnv(subject, 'default', verb, store, Date.now() + 60_000);
      const where = `${subject} ${verb}`;
      assert.equal(env.CLAUDE_CONFIG_DIR, path.join(store.userDir, '.brokered-auth-only', 'claude'), where);
      assert.equal(env.CODEX_HOME, path.join(store.userDir, '.brokered-auth-only', 'codex'), where);
      for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OSHAL_CRED_ANTHROPIC', 'OSHAL_PORTAL_LOGINS', 'DEMO_MODE',
        'SWARM_SERVICE_SECRET', 'CAREER_RAIL_SERVICE_SECRET', 'CAREER_RAIL_TOKEN']) {
        assert.equal(env[key], undefined, `${where}: ${key} must not reach the engine`);
      }
      assert.ok(!Object.values(env).some((value) => /controller-|brokered-anthropic|[\\/]mounted[\\/]|fleet-service-secret/.test(String(value))),
        `${where}: no controller key, fleet secret or mounted login location survives under another name`);
      assert.equal(env.FIRECRAWL_API_KEY, 'brokered-firecrawl', `${where}: deterministic web search keeps its key`);
      assert.equal(env.OSHAL_USER_SUB, subject);
      assert.equal(env.JOBHUNTER_MULTIUSER, '1', `${where}: the engine runs in rail-only multi-user mode`);
    }
  }
});

test('the runner-minted rail entries reach the engine exactly, and nothing else of the rail does', async () => {
  const env = await buildEngineEnv('user-7', 'default', 'score', storeFor('user-7'), Date.now() + 60_000);
  for (const key of ['CAREER_RAIL_URL', 'CAREER_RAIL_GRANT', 'CAREER_RAIL_RUN_ID', 'CAREER_RAIL_TIMEOUT_S']) {
    assert.equal(env[key], hostileEnv[key], `${key} is forwarded unchanged`);
  }
  assert.deepEqual(Object.keys(env).filter((key) => key.startsWith('CAREER_RAIL_')).sort(),
    ['CAREER_RAIL_GRANT', 'CAREER_RAIL_RUN_ID', 'CAREER_RAIL_TIMEOUT_S', 'CAREER_RAIL_URL']);
});

test('the launcher source has no portal-login pass-through and resolves no Anthropic credential', () => {
  const source = fs.readFileSync(binPath, 'utf8');
  const code = source.slice(source.indexOf("'use strict';"));
  assert.doesNotMatch(code, /OSHAL_PORTAL_LOGINS/, 'the retired verdict has no code path');
  assert.doesNotMatch(code, /resolveSecret\('anthropic'|ANTHROPIC_API_KEY/, 'no model key is resolved or injected');
  assert.equal((code.match(/path\.join\(store\.userDir, '\.brokered-auth-only'\)/g) || []).length, 1,
    'exactly one sandbox definition, applied unconditionally');
  assert.doesNotMatch(code, /CAREER_RAIL_SERVICE_SECRET|CAREER_RAIL_TOKEN/,
    'the launcher has no name for the retired engine-child secret or bearer token');
  assert.doesNotMatch(code.slice(code.indexOf('function railEngineEnv')), /SWARM_SERVICE_SECRET/,
    'nothing from the engine environment builder onward reads the fleet secret (runRefresh, above it, is the controller refresh call, not the engine child)');
  for (const file of ['src-routes/career-engine-runner.ts', 'routes/career-engine-runner.js']) {
    const runner = fs.readFileSync(path.join(packageRoot, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(runner, /SWARM_SERVICE_SECRET/, `${file} never reads the fleet secret for an engine child`);
  }
});
