/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard the pinned quest thread and non-mutating scene-opening replay control.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Require every new combat round to receive deduplicated story art instead of alternating-round imagery.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('the current quest stays above history and can replay a missed opening', () => {
  const html = read('ui/table.html');
  const story = read('ui/table-story.js');
  const screens = read('ui/table-screens.js');
  const css = read('ui/dnd.css');

  assert.match(html, /id="questThread"[\s\S]*id="questTitle"[\s\S]*id="questAnchor"/);
  assert.match(html, /id="questReplay"[^>]*>Hear scene opening again/);
  assert.match(story, /function renderQuestThread\(\)[\s\S]*scene\.storyAnchor[\s\S]*presentPhase\(scene\.opening/);
  assert.match(screens, /function renderDock\(\)[\s\S]{0,100}renderQuestThread\(\)/);
  assert.match(css, /\.quest-thread[\s\S]*flex: 0 0 auto/);
  assert.doesNotMatch(story, /questReplay[\s\S]{0,300}api\(/);
});

test('new rounds receive one story highlight and one deduplicated generated image', () => {
  const combat = read('ui/table-combat-narration.js');
  const turns = read('ui/table-turns.js');

  assert.match(combat, /highlightKind:\s*'round'/);
  assert.match(combat, /requestId:\s*`round-\$\{board\.sceneId\}-\$\{board\.round\}`/);
  assert.match(combat, /requestCutaway\(`\$\{SC\(\)\.title\}, round \$\{board\.round\}[\s\S]*`round:\$\{timeline\}:\$\{board\.sceneId\}:\$\{board\.round\}`/);
  assert.doesNotMatch(combat, /board\.round\) % 2/);
  assert.match(combat, /function requestCombatKillCutaway[\s\S]*outcome\.killed[\s\S]*`kill:/);
  assert.match(turns, /Number\(board\.round\) > priorRound[\s\S]*await requestDungeonMasterRoundHighlight\(\)/);
});
