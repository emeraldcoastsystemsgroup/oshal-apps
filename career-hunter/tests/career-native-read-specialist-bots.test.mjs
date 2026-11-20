/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.21: contract regression test asserting createNativeCareerReadRoutes registers a specialistContext reader for EVERY model-bearing bot declared in career-hunter/oshal-app.yaml (career-hunter 0001, career-concierge 0005, career-resume-reviewer 0006) so oshald never rejects a bot turn with 503 required specialist reader is missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';

const here = import.meta.dirname;
const pkgRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pkgRoot, '..');
const require = createRequire(import.meta.url);
const yaml = require(require.resolve('js-yaml', { paths: [here, path.join(repoRoot, 'scripts', 'toolchain')] }));

/** Load native-career-read with stubbed native sqlite + platform logger so it runs dependency-free. */
function loadNativeCareerRead() {
  const originalLoad = Module._load;
  Module._load = function stubbed(request, ...rest) {
    if (request === 'better-sqlite3') return class StubSqlite {};
    if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {} }) };
    return originalLoad.call(this, request, ...rest);
  };
  try {
    return require('../lib/native-career-read.js');
  } finally {
    Module._load = originalLoad;
  }
}

test('createNativeCareerReadRoutes registers specialistContext reader for every model-bearing bot in oshal-app.yaml', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(pkgRoot, 'oshal-app.yaml'), 'utf8'));
  assert.ok(Array.isArray(manifest.uses) && manifest.uses.includes('specialist-context'), 'package declares specialist-context');

  const modelBearingBots = (manifest.bots || []).filter(
    (bot) => typeof bot.persona === 'string' && bot.persona.endsWith('.yaml') && bot.name !== 'career-submission-browser',
  );
  assert.ok(modelBearingBots.length >= 3, 'manifest declares all model-bearing bots');
  const expectedIds = modelBearingBots.map((bot) => bot.agentId).sort();
  assert.deepEqual(expectedIds, [
    'cb000000-0000-0000-0000-000000000001',
    'cb000000-0000-0000-0000-000000000005',
    'cb000000-0000-0000-0000-000000000006',
  ]);

  const reader = loadNativeCareerRead();
  const registered = new Map();
  let registeredTool = null;
  reader.createNativeCareerReadRoutes({
    pool: { query: async () => ({ rows: [] }) },
    tools: { register: (name, fn) => { registeredTool = { name, fn }; } },
    specialistContext: {
      register: (entry) => {
        registered.set(entry.agentId, entry);
      },
    },
    intent: async () => ({ principal: null }),
  });

  assert.equal(registeredTool?.name, 'career_database');
  for (const bot of modelBearingBots) {
    const entry = registered.get(bot.agentId);
    assert.ok(entry, `specialistContext reader missing for ${bot.name} (${bot.agentId})`);
    assert.equal(entry.toolName, 'career_database', `${bot.name} binds career_database`);
    assert.deepEqual(entry.facts, [...reader.FACTS], `${bot.name} exposes complete FACTS list`);
    assert.equal(typeof entry.read, 'function', `${bot.name} registers a read function`);
  }
});
