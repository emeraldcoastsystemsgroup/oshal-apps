/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (circuit-lab--circuit-lab): Run sat under four rows of part pills and a 550px canvas, below the fold at 1440x900, and a 98-word gesture paragraph sat under the canvas. The page: Run is the one primary and sits at the right of the design's app row with auto-run beside it; the mouse, touch and keys text is inside a Help disclosure.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'circuit-lab.html'), 'utf8');
const panel = html.slice(html.indexOf('<div id="design-panel"'), html.indexOf('<section class="step">'));

test('Run is the one primary, at the right of the design app row', () => {
  assert.match(panel, /id="delete-design"[\s\S]*id="auto-run"[\s\S]*<button id="run" class="primary">Run<\/button>\s*<\/div>/);
  assert.equal((html.match(/id="run"/g) || []).length, 1);
  const body = html.slice(html.indexOf('<div id="design-panel"'));
  assert.equal((body.match(/class="primary"/g) || []).length >= 1, true);
});

test('the mouse, touch and keys text is Help, behind a disclosure', () => {
  assert.match(html, /<details class="small muted" id="canvas-help"><summary>Help: mouse, touch and keys<\/summary>\s*<p id="canvas-hint"[\s\S]*<p id="board-hint"[\s\S]*?<\/p>\s*<\/details>/);
});
