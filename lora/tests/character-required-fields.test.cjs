/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 7: Save character with the Hero image field empty sent nothing and showed nothing (the browser's validity bubble did not show in the docked frame). Runs the page's own requiredGaps and saveCharacter (tools/lora.html): an empty required field is named by its label and focused and no request is sent; a filled form posts.
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
const SOURCE = pick(/function requiredGaps\(form\)\{[\s\S]*?\n\}\n/) + pick(/async function saveCharacter\(event\)\{[\s\S]*?\n\}\n/);

/** A labelled input double. */
function field(name, label, value, required) {
  const f = { name, value, required, focused: false, focus() { this.focused = true; } };
  f.closest = () => ({ firstChild: { textContent: label } });
  return f;
}

function run(fields) {
  const els = {
    characterFields: { disabled: false },
    characterForm: { querySelectorAll: (sel) => (sel === '[required]' ? fields.filter((f) => f.required) : []), reset() {} },
    createResult: { className: '', textContent: '' },
  };
  const calls = [];
  const sandbox = {
    $: (id) => els[id],
    creationResult: (kind, msg) => { els.createResult.className = 'result ' + kind; els.createResult.textContent = msg; },
    api: async (p, init) => { calls.push([p, init]); return { ok: true, j: { subject: 'hero', message: 'Character saved. No training was started.' } }; },
    loadChars: async () => true, select: async () => undefined,
    FormData: function () { return fields.map((f) => [f.name, f.value])[Symbol.iterator](); },
  };
  const save = new Function(...Object.keys(sandbox), `${SOURCE}\nreturn saveCharacter;`)(...Object.values(sandbox));
  return { save, els, calls };
}

const form = (hero) => [field('subject', 'Subject slug', 'hero', true), field('displayName', 'Display name', '', false),
  field('heroImage', 'Hero image on the worker', hero, true), field('identPrompt', 'Identity sentence', 'a hero', true)];

test('an empty Hero image is named, focused and nothing is sent', async () => {
  const fields = form('   ');
  const { save, els, calls } = run(fields);
  await save({ preventDefault() {} });
  assert.equal(els.createResult.textContent, 'Fill in Hero image on the worker to save the character. Nothing was saved.');
  assert.match(els.createResult.className, /err/);
  assert.equal(fields[2].focused, true);
  assert.equal(calls.length, 0);
});

test('a filled form posts the character', async () => {
  const { save, els, calls } = run(form('/data/hero.png'));
  await save({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/characters');
  assert.match(els.createResult.textContent, /Character saved/);
});

test('the form is novalidate so the page, not a hidden bubble, reports the gap', () => {
  assert.match(HTML, /<form id="characterForm" novalidate>/);
});
