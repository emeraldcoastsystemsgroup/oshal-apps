/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-17 11:50:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Catalog invariants: every preset references only existing layer ids; prompt composition honors overrides; validateOverrides fails closed; notes sanitization strips control chars + caps length. Plain node (the catalog module is framework-free) — `node tests/run.js`.
 */

'use strict';

const assert = require('node:assert');
const path = require('node:path');

const cat = require(path.join(__dirname, '..', 'routes', 'portrait-catalog.js'));

/** Collect ids of a catalog list, asserting uniqueness. */
function ids(list, label) {
  const seen = new Set();
  for (const item of list) {
    assert.ok(item.id && typeof item.id === 'string', `${label}: item without id`);
    assert.ok(!seen.has(item.id), `${label}: duplicate id ${item.id}`);
    seen.add(item.id);
  }
  return seen;
}

module.exports = function run() {
  const backgrounds = ids(cat.BACKGROUNDS, 'backgrounds');
  const clothing = ids(cat.CLOTHING, 'clothing');
  const headwear = ids(cat.HEADWEAR, 'headwear');
  const props = ids(cat.PROPS, 'props');
  const finishes = ids(cat.FINISHES, 'finishes');
  const framings = ids(cat.FRAMINGS, 'framings');

  // THE CONTRACT (operator, 2026-07-17): 100 backdrops, 100 profiles — enforced, not aspirational.
  assert.strictEqual(cat.BACKGROUNDS.length, 100, `expected exactly 100 backgrounds, got ${cat.BACKGROUNDS.length}`);
  assert.strictEqual(cat.PROFESSIONAL_PRESETS.length + cat.CHARACTER_PRESETS.length, 100,
    `expected exactly 100 presets, got ${cat.PROFESSIONAL_PRESETS.length + cat.CHARACTER_PRESETS.length}`);
  assert.strictEqual(cat.CLOTHING.length, 70, `expected 70 clothing styles, got ${cat.CLOTHING.length}`);
  assert.strictEqual(cat.HEADWEAR.length, 30, `expected 30 headwear items, got ${cat.HEADWEAR.length}`);
  assert.strictEqual(cat.PROPS.length, 26, `expected 26 props, got ${cat.PROPS.length}`);
  assert.strictEqual(cat.FINISHES.length, 12, `expected 12 finishes, got ${cat.FINISHES.length}`);
  assert.strictEqual(cat.FRAMINGS.length, 4, `expected 4 framings, got ${cat.FRAMINGS.length}`);

  // Every layer item and preset carries a picker group.
  for (const list of [cat.BACKGROUNDS, cat.CLOTHING, cat.HEADWEAR, cat.PROPS, cat.FINISHES, cat.FRAMINGS]) {
    for (const item of list) assert.ok(item.group && typeof item.group === 'string', `layer item ${item.id} missing group`);
  }
  for (const p of [...cat.PROFESSIONAL_PRESETS, ...cat.CHARACTER_PRESETS]) {
    assert.ok(p.group && typeof p.group === 'string', `preset ${p.id} missing group`);
  }
  assert.ok(props.has('pitchfork'), 'the pitchfork is not optional');

  // Every preset references only layer ids that exist.
  const allPresets = [
    ...cat.PROFESSIONAL_PRESETS.map((p) => ({ ...p, mode: 'professional' })),
    ...cat.CHARACTER_PRESETS.map((p) => ({ ...p, mode: 'character' })),
  ];
  ids(cat.PROFESSIONAL_PRESETS, 'professional presets');
  ids(cat.CHARACTER_PRESETS, 'character presets');
  for (const p of allPresets) {
    assert.ok(backgrounds.has(p.background), `${p.id}: unknown background ${p.background}`);
    assert.ok(clothing.has(p.attire), `${p.id}: unknown attire ${p.attire}`);
    assert.ok(headwear.has(p.headwear), `${p.id}: unknown headwear ${p.headwear}`);
    assert.ok(finishes.has(p.finish), `${p.id}: unknown finish ${p.finish}`);
    assert.ok(framings.has(p.framing), `${p.id}: unknown framing ${p.framing}`);
  }

  // Every preset composes a non-empty prompt with the craft rules present.
  for (const p of allPresets) {
    const prompt = cat.buildPortraitPrompt(p.mode, p.id, {});
    assert.ok(prompt.length > 100, `${p.id}: suspiciously short prompt`);
    assert.ok(/No text, no watermark/.test(prompt), `${p.id}: missing no-text tail`);
    if (p.mode === 'character') {
      assert.ok(/exactly two hands/.test(prompt), `${p.id}: character prompt missing hands rule`);
      assert.ok(/photorealistic and faithful/.test(prompt), `${p.id}: character prompt missing identity rule`);
    } else {
      assert.ok(/Identity is paramount/.test(prompt), `${p.id}: professional prompt missing identity rule`);
    }
  }

  // Overrides actually land in the composed prompt.
  const swapped = cat.buildPortraitPrompt('character', 'american-gothic', {
    headwear: 'crown', background: 'castle-hall', finish: 'watercolor',
  });
  assert.ok(/golden jeweled crown/.test(swapped), 'headwear override missing from prompt');
  assert.ok(/castle hall/.test(swapped), 'background override missing from prompt');
  assert.ok(/watercolor/.test(swapped), 'finish override missing from prompt');
  assert.ok(!/farmhouse/.test(swapped), 'overridden background still present');

  // A prop override REPLACES the preset pose (and validates fail-closed).
  const withProp = cat.buildPortraitPrompt('professional', 'executive', { prop: 'pitchfork' });
  assert.ok(/pitchfork upright/.test(withProp), 'prop override missing from prompt');
  assert.ok(!/arms confidently crossed/.test(withProp), 'preset pose should be replaced by the prop');

  // validateOverrides fails closed on unknown ids, accepts empty/absent.
  assert.strictEqual(cat.validateOverrides({}), null);
  assert.strictEqual(cat.validateOverrides({ headwear: '' }), null);
  assert.match(String(cat.validateOverrides({ headwear: 'propeller-beanie' })), /unknown headwear/);
  assert.match(String(cat.validateOverrides({ background: 'the-moon' })), /unknown background/);
  assert.match(String(cat.validateOverrides({ attire: 'birthday-suit' })), /unknown attire/);
  assert.match(String(cat.validateOverrides({ prop: 'chainsaw-bagpipes' })), /unknown prop/);

  // Unknown preset throws; wrong-mode preset throws.
  assert.throws(() => cat.buildPortraitPrompt('professional', 'american-gothic', {}), /unknown professional preset/);
  assert.throws(() => cat.buildPortraitPrompt('character', 'linkedin', {}), /unknown character preset/);

  // Notes sanitization: control chars stripped, length capped, legit text kept.
  const bell = String.fromCharCode(7);
  const noisy = cat.buildPortraitPrompt('professional', 'linkedin', { notes: 'warm' + bell + 'smile ' + 'x'.repeat(500) });
  const leaked = Array.from(noisy).some(function (ch) { const n = ch.charCodeAt(0); return n < 32 || n === 127; });
  assert.ok(!leaked, 'control characters leaked into the prompt');
  assert.ok(noisy.includes('warm smile'), 'legit notes text lost');
  assert.ok(noisy.length < 2200, 'notes cap not applied');
  // Client catalog never leaks prompt fragments.
  const client = cat.clientCatalog();
  for (const list of [client.backgrounds, client.attire, client.headwear, client.props, client.finishes, client.framings]) {
    for (const item of list) assert.strictEqual(item.prompt, undefined, 'client catalog leaked a prompt fragment');
  }
  assert.strictEqual(client.presets.professional.length, cat.PROFESSIONAL_PRESETS.length);
  assert.strictEqual(client.presets.character.length, cat.CHARACTER_PRESETS.length);

  return allPresets.length;
};
