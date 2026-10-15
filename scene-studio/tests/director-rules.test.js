/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The director's working rules from the sweep: it created a project unasked, edited main.tscn without reading it, wrote a non-mesh standalone .tres and spent a tool call on scene-capabilities every turn. The persona and the tool usage text the model sees must carry each rule. Plain node.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const persona = fs.readFileSync(path.join(PKG, 'personas', 'scene-studio-director.yaml'), 'utf8').replace(/\s+/g, ' ');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8').replace(/\s+/g, ' ');

test('the director works in the named project, reads before editing and keeps meshes inside the scene', () => {
  assert.match(persona, /Create a project only when the person asks for a new one/);
  assert.match(persona, /Before you edit a scene, READ it/);
  assert.match(persona, /\[sub_resource type="BoxMesh" id="\.\.\."\]/);
  assert.match(persona, /Do not write separate \.tres files unless the person asks for one/);
  assert.match(persona, /\[gd_resource type="BoxMesh" format=3\]/);
  assert.match(persona, /A turn allows six tool calls/);
  assert.match(persona, /Never write a scene you have not read in this turn/);
  assert.match(persona, /Reference only files the project has/);
  assert.match(persona, /material_override = SubResource\("Mat"\)/);
});

test('the tool usage text carries the same rules and no longer demands a capabilities read first', () => {
  assert.doesNotMatch(manifest, /Read this FIRST in a conversation/);
  assert.match(manifest, /Read only if scene-get-project shows the engine disconnected/);
  assert.match(manifest, /usageInstructions: Only when the person asks for a new project\./);
  assert.match(manifest, /Its engine field is the engine's live status\./);
});
