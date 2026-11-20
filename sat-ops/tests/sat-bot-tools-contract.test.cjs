/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Sat Ops' inline concierge posture, tool schemas, plain-prose rule, and ```tool_call {"tool": ...} fence contract for oshald.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require(path.resolve(__dirname, '../../scripts/toolchain/node_modules/js-yaml'));

const PKG = path.resolve(__dirname, '..');

function loadManifest() {
  return yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
}

function loadPersona() {
  return yaml.load(fs.readFileSync(path.join(PKG, 'personas/sat-operator.yaml'), 'utf8'));
}

test('sat-ops declares inline sat-operator as chatBot with explicit object inputSchema on every tool', () => {
  const manifest = loadManifest();
  assert.equal(manifest.chatBot, 'sat-operator');
  const bot = (manifest.bots || []).find((b) => b.name === 'sat-operator');
  assert.ok(bot, 'sat-operator declared');
  assert.equal(bot.posture, 'inline');
  const expected = [
    'sat-fleet-status', 'sat-orbit-catalog', 'sat-orbit-track', 'sat-pass-windows',
    'sat-conjunction-screen', 'draft-sat-command', 'sat-point-command', 'sat-mode-command',
  ];
  assert.deepEqual((manifest.tools || []).map((t) => t.name), expected);
  for (const tool of manifest.tools) {
    assert.equal(tool.executor?.executorType, 'api');
    assert.match(String(tool.executor?.apiEndpoint || ''), /^(GET|POST) \/api\/sat\//);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} declares an object inputSchema`);
  }
});

test('sat-operator persona teaches plain prose and ```tool_call with "tool"', () => {
  const prompt = String(loadPersona().perspective || '');
  assert.match(prompt, /plain prose/i);
  assert.ok(prompt.includes('```tool_call'));
  assert.match(prompt, /"tool"/);
});
