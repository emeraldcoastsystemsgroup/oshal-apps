/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Drone Ops' inline concierge posture, tool schemas, plain-prose rule, and ```tool_call {"tool": ...} fence contract for oshald.
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
  return yaml.load(fs.readFileSync(path.join(PKG, 'personas/drone-operator.yaml'), 'utf8'));
}

test('drone declares inline drone-operator as chatBot with explicit object inputSchema on every tool', () => {
  const manifest = loadManifest();
  assert.equal(manifest.chatBot, 'drone-operator');
  const bot = (manifest.bots || []).find((b) => b.name === 'drone-operator');
  assert.ok(bot, 'drone-operator declared');
  assert.equal(bot.posture, 'inline');
  const expected = ['drone-status', 'drone-fleet-status', 'draft-drone-mission', 'execute-drone-mission'];
  assert.deepEqual((manifest.tools || []).map((t) => t.name), expected);
  for (const tool of manifest.tools) {
    assert.equal(tool.executor?.executorType, 'api');
    assert.match(String(tool.executor?.apiEndpoint || ''), /^(GET|POST) \/api\/drone\//);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} declares an object inputSchema`);
  }
});

test('drone-operator persona teaches plain prose for direct chat and ```tool_call with "tool"', () => {
  const manifest = loadManifest();
  const toolNames = (manifest.tools || []).map((t) => t.name);
  const prompt = String(loadPersona().perspective || '');
  assert.match(prompt, /plain prose/i, 'persona has plain-prose rule for direct chat');
  assert.ok(prompt.includes('```tool_call'), 'persona teaches ```tool_call fence');
  assert.match(prompt, /"tool"/, 'persona teaches the "tool" JSON key');
  for (const name of toolNames) {
    assert.match(prompt, new RegExp(`\\b${name}\\b`), `persona names ${name}`);
  }
});
