/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A workflow application whose own workflow bot runs inline declares it as its chatBot. The native kernel sends a Jarvis request that asks to make, build, order or plan something only to a workflow application's chatBot; with none it keeps the request with the assistant (jarvis_creation_kept), so "order food" never reached the Eats concierge and Jarvis answered without Eats' tools. Fifteen applications had none. A node-posture worker is exempt: a chatBot must run inline.
 *
 * Plain `node --test` suite; js-yaml comes from the store toolchain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { posture } from './check-store-bots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yaml = createRequire(path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain')), 'package.json'))('js-yaml');

/** Every application manifest in the store, by package directory. */
function manifests() {
  return new Map(fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(ROOT, entry.name, 'oshal-app.yaml')))
    .map((entry) => [entry.name, yaml.load(fs.readFileSync(path.join(ROOT, entry.name, 'oshal-app.yaml'), 'utf8')) || {}]));
}

test('every workflow application with an inline workflow bot names a chatBot', () => {
  const missing = [];
  for (const [app, manifest] of manifests()) {
    if (!manifest.ticketType || !Array.isArray(manifest.bots) || !manifest.bots.length) continue;
    if (typeof manifest.chatBot === 'string' && manifest.chatBot.trim()) continue;
    const worker = manifest.workflow?.workerBot;
    const bot = manifest.bots.find((b) => b.name === worker) || manifest.bots[0];
    if (posture(bot) === 'inline') missing.push(`${app} (${bot.name})`);
  }
  assert.deepEqual(missing, [], 'creation requests from Jarvis never reach these applications');
});

test('the Eats concierge is the Eats chatBot', () => {
  const eats = manifests().get('eats');
  assert.equal(eats.chatBot, 'eats-concierge');
});
