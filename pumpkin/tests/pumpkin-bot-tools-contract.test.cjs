/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Pumpkin's inline concierge posture, tool schemas, and ```tool_call {"tool": ...} fence contract for oshald.
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
  return yaml.load(fs.readFileSync(path.join(PKG, 'personas/pumpkin-bot.yaml'), 'utf8'));
}

test('pumpkin declares inline pumpkin-bot as chatBot with valid api tool schemas', () => {
  const manifest = loadManifest();
  assert.equal(manifest.chatBot, 'pumpkin-bot');
  const bot = (manifest.bots || []).find((b) => b.name === 'pumpkin-bot');
  assert.ok(bot, 'pumpkin-bot declared');
  assert.equal(bot.posture, 'inline');
  const expected = ['pumpkin-rooms', 'pumpkin-speak', 'pumpkin-stop'];
  assert.deepEqual((manifest.tools || []).map((t) => t.name), expected);
  for (const tool of manifest.tools) {
    assert.equal(tool.executor?.executorType, 'api');
    assert.match(String(tool.executor?.apiEndpoint || ''), /^(GET|POST) \/api\/pumpkin\//);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} declares an object inputSchema`);
  }
});

test('pumpkin-bot persona teaches ```tool_call using "tool" (never "name") for declared tools', () => {
  const manifest = loadManifest();
  const toolNames = new Set((manifest.tools || []).map((t) => t.name));
  const prompt = String(loadPersona().perspective || '');
  for (const name of toolNames) {
    assert.match(prompt, new RegExp(`\\b${name}\\b`), `persona names ${name}`);
  }
  const blocks = [...prompt.matchAll(/```tool_call\s*\n([\s\S]*?)\n\s*```/g)];
  assert.ok(blocks.length >= 1, 'persona includes at least one ```tool_call example');
  for (const [, raw] of blocks) {
    const parsed = JSON.parse(raw.trim());
    assert.equal(parsed.name, undefined, 'tool_call fence must use "tool", not "name"');
    assert.equal(typeof parsed.tool, 'string', 'tool_call fence must set "tool"');
    assert.ok(toolNames.has(parsed.tool), `tool_call example references declared tool: ${parsed.tool}`);
  }
});
