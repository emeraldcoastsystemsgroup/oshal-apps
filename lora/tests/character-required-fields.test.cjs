/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 7: Save character with the Hero image field empty sent nothing and showed nothing (the browser's validity bubble did not show in the docked frame). Runs the page's own requiredGaps and saveCharacter (tools/lora.html): an empty required field is named by its label and focused and no request is sent; a filled form posts.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06: step 1 asks for Name, Trigger word and Identity sentence, with Subject slug and Hero image under a closed Advanced. The suite also runs the page's deriveSubject: a blank Subject slug is made from the Name (then the trigger word), a typed one is kept, and the Hero image label reads "Hero image" (no "on the worker"). A gap under Advanced opens it before focusing the field.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'lora.html'), 'utf8');
const pick = (re) => { const m = HTML.match(re); assert.ok(m, `${re} is on the page`); return m[0]; };
const SOURCE = pick(/function requiredGaps\(form\)\{[\s\S]*?\n\}\n/) + pick(/function deriveSubject\(form\)\{[\s\S]*?\n\}\n/) + pick(/async function saveCharacter\(event\)\{[\s\S]*?\n\}\n/);

/** A labelled input double. */
function field(name, label, value, required, advanced) {
  const f = { name, value, required, focused: false, focus() { this.focused = true; } };
  f.closest = (sel) => (sel === 'details' ? (advanced || null) : { firstChild: { textContent: label } });
  return f;
}

function run(fields) {
  const els = {
    characterFields: { disabled: false },
    characterForm: { querySelectorAll: (sel) => (sel === '[required]' ? fields.filter((f) => f.required) : []), reset() {},
      elements: { namedItem: (name) => fields.find((f) => f.name === name) || null } },
    createResult: { className: '', textContent: '' },
  };
  const calls = [];
  const sandbox = {
    loraEditor: null,
    $: (id) => els[id],
    creationResult: (kind, msg) => { els.createResult.className = 'result ' + kind; els.createResult.textContent = msg; },
    api: async (p, init) => { calls.push([p, init]); return { ok: true, j: { subject: 'hero', message: 'Character saved. No training was started.' } }; },
    loadChars: async () => true, select: async () => undefined, showResult: () => undefined,
    FormData: function () { return fields.map((f) => [f.name, f.value])[Symbol.iterator](); },
  };
  const save = new Function(...Object.keys(sandbox), `${SOURCE}\nreturn saveCharacter;`)(...Object.values(sandbox));
  return { save, els, calls };
}

const advanced = () => ({ open: false });
const form = (hero, subject = 'hero', name = '', details = advanced()) => [field('displayName', 'Name', name, true), field('triggerWord', 'Trigger word', '', false),
  field('identPrompt', 'Identity sentence', 'a hero', true), field('subject', 'Subject slug', subject, false, details),
  field('heroImage', 'Hero image', hero, true, details)];

test('an empty Hero image is named, its closed Advanced opens, it is focused and nothing is sent', async () => {
  const details = advanced();
  const fields = form('   ', 'hero', 'Hero', details);
  const { save, els, calls } = run(fields);
  await save({ preventDefault() {} });
  assert.equal(els.createResult.textContent, 'Fill in Hero image to save the character. Nothing was saved.');
  assert.match(els.createResult.className, /err/);
  assert.equal(details.open, true);
  assert.equal(fields[4].focused, true);
  assert.equal(calls.length, 0);
});

test('a blank Subject slug is made from the Name, and a typed one is kept', async () => {
  const fields = form('/data/hero.png', '', '  Ranger Kestrel #2 ');
  const { save, calls } = run(fields);
  await save({ preventDefault() {} });
  assert.equal(fields[3].value, 'ranger-kestrel-2');
  assert.equal(calls.length, 1);
  const kept = form('/data/hero.png', 'my.slug', 'Other name');
  await run(kept).save({ preventDefault() {} });
  assert.equal(kept[3].value, 'my.slug');
});

test('step 1 shows Name, Trigger word and Identity sentence; the other six are under Advanced and no label says "on the worker"', () => {
  const advancedHtml = pick(/<details class="lora-advanced" id="characterAdvanced">[\s\S]*?<\/details>/);
  for (const name of ['subject', 'heroImage', 'negativePrompt', 'identityStructure', 'identityViolation', 'baseModel']) assert.match(advancedHtml, new RegExp('name="' + name + '"'));
  for (const name of ['displayName', 'triggerWord', 'identPrompt']) assert.doesNotMatch(advancedHtml, new RegExp('name="' + name + '"'));
  assert.doesNotMatch(HTML, /<label>[^<]*on the worker/);
  assert.doesNotMatch(HTML, /<details class="lora-advanced" open/);
});

test('a filled form posts the character', async () => {
  const { save, els, calls } = run(form('/data/hero.png', 'hero', 'Hero'));
  await save({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/characters');
  assert.match(els.createResult.textContent, /Character saved/);
});

test('the form is novalidate so the page, not a hidden bubble, reports the gap', () => {
  assert.match(HTML, /<form id="characterForm" novalidate>/);
});
