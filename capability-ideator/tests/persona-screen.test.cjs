/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 11: the Capability Ideation concierge (this persona) answered a screen question with
 *     |                                             | two counts ('46 collapsed sections', then '66' from the snapshot), quoted the snapshot's label
 *     |                                             | ('Counted on the whole screen') and ended in the third person ('The person is looking at ...').
 *     |                                             | The served persona gives one count from the whole-screen line, never the block's wording, and
 *     |                                             | speaks to "you". Run: node --test capability-ideator/tests/persona-screen.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'capability-ideator.yaml'), 'utf8');
const screen = persona.slice(persona.indexOf('## Questions about the screen'), persona.indexOf('## Answering in this app')).replace(/\s+/g, ' ');

test('screen answers speak to "you", give one count from the whole-screen line and quote no block wording', () => {
  assert.ok(screen.length > 40, 'the persona has a Questions about the screen section before Answering');
  assert.match(screen, /Speak to the person as "you" and "your screen"\. Never call them "the person" or "the user"/);
  assert.match(screen, /A count comes from one place and is said once/);
  assert.match(screen, /that number is the count: give it, never a second figure of your own, and never quote the block's own wording or labels/);
  assert.match(screen, /Do not inventory every control/);
});

test('the capability-ideation screen names this persona as its concierge', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', '..', 'capability-ideation', 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /^chatBot: capability-ideator\b/m);
});
