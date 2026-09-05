/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-137 amendment A guard at the LAUNCHER boundary: bin/oshal-jobhunter.js builds the Python child's environment itself, so the runner's carve is only real if this file yields its .brokered-auth-only wall — and only to the runner's exact OSHAL_PORTAL_LOGINS=1 verdict. The 1.12.4 release proved a runner-only guard is not closure evidence: live scoring still raised "No AI auth found".
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
const savedEnv = Object.fromEntries([
  'JOBHUNTER_STORE_ROOT', 'CAREER_HUNTER_BROKER_COMPLETE', 'OSHAL_CRED_ANTHROPIC', 'OSHAL_CRED_FIRECRAWL',
  'OSHAL_PORTAL_LOGINS', 'HOME', 'USERPROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR',
].map((key) => [key, process.env[key]]));

process.env.JOBHUNTER_STORE_ROOT = path.join(fixtureRoot, 'store');
// The controller already brokered this caller's secrets: the launcher must not go looking for more.
process.env.CAREER_HUNTER_BROKER_COMPLETE = '1';
process.env.OSHAL_CRED_ANTHROPIC = 'brokered-anthropic';
delete process.env.OSHAL_CRED_FIRECRAWL;
delete process.env.CODEX_HOME;
delete process.env.CLAUDE_CONFIG_DIR;
process.env.HOME = path.join(fixtureRoot, 'home');
process.env.USERPROFILE = process.env.HOME;

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
const userDir = path.join(fixtureRoot, 'store', 'default', 'user-1');
const store = {
  userDir,
  careerDb: path.join(userDir, 'career_db.json'),
  corpusDb: path.join(fixtureRoot, 'store', 'default', 'corpus.db'),
  userDb: path.join(userDir, 'user-user-1.db'),
};
const walled = {
  CLAUDE_CONFIG_DIR: path.join(userDir, '.brokered-auth-only', 'claude'),
  CODEX_HOME: path.join(userDir, '.brokered-auth-only', 'codex'),
};

async function engineEnv() {
  return buildEngineEnv('user-1', 'default', 'score', store, Date.now() + 60_000);
}

test('without the runner verdict the launcher walls the engine into the empty per-user sandbox', async () => {
  delete process.env.OSHAL_PORTAL_LOGINS;
  const env = await engineEnv();
  assert.equal(env.CLAUDE_CONFIG_DIR, walled.CLAUDE_CONFIG_DIR);
  assert.equal(env.CODEX_HOME, walled.CODEX_HOME);
  assert.equal(env.ANTHROPIC_API_KEY, 'brokered-anthropic', 'the brokered key still reaches the engine under the wall');
  assert.equal(env.OSHAL_USER_SUB, 'user-1');
});

test('only the exact OSHAL_PORTAL_LOGINS=1 verdict lifts the wall, and then the mounted logins reach the engine through HOME', async () => {
  process.env.OSHAL_PORTAL_LOGINS = '1';
  const lifted = await engineEnv();
  assert.equal(lifted.CLAUDE_CONFIG_DIR, undefined, 'no sandboxed ~/.claude under the portal fallback');
  assert.equal(lifted.CODEX_HOME, undefined, 'no sandboxed ~/.codex under the portal fallback');
  assert.equal(lifted.HOME, process.env.HOME, 'HOME is what Path.home() resolves the mounted logins from');
  assert.equal(lifted.ANTHROPIC_API_KEY, 'brokered-anthropic', 'brokered keys are unaffected by the carve');

  process.env.CODEX_HOME = path.join(fixtureRoot, 'explicit-codex');
  const explicit = await engineEnv();
  assert.equal(explicit.CODEX_HOME, process.env.CODEX_HOME, 'an explicit controller login location passes through under the carve');
  delete process.env.CODEX_HOME;

  for (const notTheVerdict of ['true', 'yes', '0', '', ' 1']) {
    process.env.OSHAL_PORTAL_LOGINS = notTheVerdict;
    const env = await engineEnv();
    assert.deepEqual({ CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR, CODEX_HOME: env.CODEX_HOME }, walled,
      `OSHAL_PORTAL_LOGINS=${JSON.stringify(notTheVerdict)} must not lift the wall`);
  }
  delete process.env.OSHAL_PORTAL_LOGINS;
});

test('the launcher source keeps the verdict as the single key to its wall', () => {
  const source = fs.readFileSync(binPath, 'utf8');
  assert.match(source, /process\.env\.OSHAL_PORTAL_LOGINS === '1'/);
  // The CHANGE LOG may name the wall; the code may define it exactly once, behind the verdict.
  assert.equal((source.match(/path\.join\(store\.userDir, '\.brokered-auth-only'\)/g) || []).length, 1,
    'exactly one wall definition in the launcher');
});
