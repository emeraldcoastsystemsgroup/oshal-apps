/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | An application with tools declares routing words on a bot (the manifest bot entry's routingKeywords, or its persona's routing_keywords). Jarvis hands a request to the application whose declared words it matches; Sat Ops, Aero Lab, Calling Assistant and Smart Home declared none, so "When is the next ISS pass?" went to an unrelated application on a 2-point match and their tools were never offered.
 *
 * Plain `node --test` suite; js-yaml comes from the store toolchain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yaml = createRequire(path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain')), 'package.json'))('js-yaml');

/** The routing words one bot declares, from its manifest entry and its packaged persona. */
function words(app, bot) {
  const declared = Array.isArray(bot.routingKeywords) ? bot.routingKeywords : [];
  const file = bot.persona ? path.join(ROOT, app, bot.persona) : null;
  const persona = file && fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) || {} : {};
  return [...declared, ...(Array.isArray(persona.routing_keywords) ? persona.routing_keywords : [])].filter((w) => typeof w === 'string' && w.trim());
}

/** Every application manifest with its directory. */
function manifests() {
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, e.name, 'oshal-app.yaml')))
    .map((e) => [e.name, yaml.load(fs.readFileSync(path.join(ROOT, e.name, 'oshal-app.yaml'), 'utf8')) || {}]);
}

test('every application with tools declares routing words on a bot', () => {
  const silent = manifests()
    .filter(([, m]) => Array.isArray(m.tools) && m.tools.length && Array.isArray(m.bots) && m.bots.length)
    .filter(([app, m]) => !m.bots.some((bot) => words(app, bot).length))
    .map(([app]) => app);
  assert.deepEqual(silent, [], 'Jarvis can hand these applications a request only when it names them');
});

test('Sat Ops is reached by satellite words', () => {
  const [, sat] = manifests().find(([app]) => app === 'sat-ops');
  assert.ok(words('sat-ops', sat.bots[0]).includes('satellite'));
});
