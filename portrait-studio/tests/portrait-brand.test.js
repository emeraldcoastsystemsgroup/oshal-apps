/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the Use my brand colors button with the surface's own script: hidden on refusal, the brand's colors in words appended once, within the field's limit.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'portrait-studio.html'), 'utf8');
const WORDS = { phrase: 'bright violet, bright cyan and coral' };

function field(value = '', maxLength = 300) {
  return { value, maxLength, events: [], focused: 0, dispatchEvent(event) { this.events.push(event.type); }, focus() { this.focused += 1; } };
}
function start(reply, fields) {
  const from = html.indexOf("/* Your brand: Create's brand kit"), code = html.slice(from, html.indexOf('})();', from) + 5);
  const buttons = [...html.matchAll(/class="brand-chip"[^>]*data-brand-target="([A-Za-z]+)"/g)].map(match => ({
    dataset: { brandTarget: match[1] }, hidden: true, title: '', listeners: [], addEventListener(type, fn) { this.listeners.push(fn); }, click() { this.listeners.forEach(fn => fn()); } }));
  const calls = [];
  vm.runInNewContext(code, { Array, Event: class { constructor(type) { this.type = type; } },
    document: { querySelectorAll: () => buttons, getElementById: id => fields[id] },
    fetch: (url, init) => { calls.push({ url, init }); return Promise.resolve(reply ? { ok: true, json: () => Promise.resolve(reply) } : { ok: false, status: 403 }); } });
  return { buttons, calls, settle: () => new Promise(done => setImmediate(done)) };
}

test('the notes field has exactly one brand button, pointed at an existing field', () => {
  const targets = [...html.matchAll(/class="brand-chip"[^>]*data-brand-target="([A-Za-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(targets, ['notes']); assert.ok(html.includes('id="notes"'));
});

test('without Create access or a kit the button stays hidden', async () => {
  for (const reply of [null, { kit: null, words: null }]) {
    const run = start(reply, { notes: field() }); await run.settle();
    assert.equal(run.calls[0].url, '/api/create/brand-kit'); assert.equal(run.calls[0].init.credentials, 'same-origin');
    assert.equal(run.buttons[0].hidden, true);
  }
});

test('with a kit the button appends the brand colors in words once, within the limit', async () => {
  const notes = field('warm smile.'), run = start({ kit: {}, words: WORDS }, { notes }); await run.settle();
  assert.equal(run.buttons[0].hidden, false);
  run.buttons[0].click(); run.buttons[0].click();
  assert.equal(notes.value, 'warm smile, background and accents in bright violet, bright cyan and coral');
  assert.deepEqual(notes.events, ['input']);
  const tight = field('x'.repeat(290), 300), again = start({ kit: {}, words: WORDS }, { notes: tight }); await again.settle();
  again.buttons[0].click(); assert.equal(tight.value.length, 300);
});
