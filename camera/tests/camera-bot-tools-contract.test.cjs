/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Camera Ops' inline concierge posture, tool schemas, plain-prose rule, and ```tool_call {"tool": ...} fence contract for oshald.
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
  return yaml.load(fs.readFileSync(path.join(PKG, 'personas/camera-operator.yaml'), 'utf8'));
}

test('camera declares inline camera-operator as chatBot with explicit object inputSchema on every tool', () => {
  const manifest = loadManifest();
  assert.equal(manifest.chatBot, 'camera-operator');
  const bot = (manifest.bots || []).find((b) => b.name === 'camera-operator');
  assert.ok(bot, 'camera-operator declared');
  assert.equal(bot.posture, 'inline');
  const expected = ['camera-status', 'camera-fleet-status', 'control-camera', 'camera-assistant'];
  assert.deepEqual((manifest.tools || []).map((t) => t.name), expected);
  for (const tool of manifest.tools) {
    assert.equal(tool.executor?.executorType, 'api');
    assert.match(String(tool.executor?.apiEndpoint || ''), /^(GET|POST) \/api\/camera\//);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} declares an object inputSchema`);
  }
});

test('camera-operator persona teaches plain prose for direct chat and ```tool_call with "tool"', () => {
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
