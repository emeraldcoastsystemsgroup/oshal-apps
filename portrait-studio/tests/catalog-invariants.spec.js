/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-17 11:50:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Catalog invariants: every preset references only existing layer ids; prompt composition honors overrides; validateOverrides fails closed; notes sanitization strips control chars + caps length. Plain node (the catalog module is framework-free) — `node tests/run.js`.
 * 2026-08-29 10:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Catalog v2 + group mode: the contract is now 200 backgrounds / 225 presets (80 professional + 105 character + 40 group) / 110 clothing / 50 headwear / 60 props / 20 finishes / 5 framings; group presets must reference real layer ids and compose a prompt that names the face count, demands every face exactly once, forbids sheet labels in the output and asks for two hands per person; validateSubjects fails closed (below 2, above 6, non-integer, absent, or present outside group mode); a prop in group mode is applied per member while the arrangement stays; the client catalog exposes presets.group + groupLimits.
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

  // THE CONTRACT (operator, 2026-07-17: "100 backdrops, 100 profiles"; 2026-08-29: "lots more") —
  // enforced, not aspirational. Change the catalog and this number together, on purpose.
  assert.strictEqual(cat.BACKGROUNDS.length, 200, `expected exactly 200 backgrounds, got ${cat.BACKGROUNDS.length}`);
  assert.strictEqual(cat.PROFESSIONAL_PRESETS.length, 80, `expected 80 professional presets, got ${cat.PROFESSIONAL_PRESETS.length}`);
  assert.strictEqual(cat.CHARACTER_PRESETS.length, 105, `expected 105 character presets, got ${cat.CHARACTER_PRESETS.length}`);
  assert.strictEqual(cat.GROUP_PRESETS.length, 40, `expected 40 group presets, got ${cat.GROUP_PRESETS.length}`);
  assert.strictEqual(cat.PROFESSIONAL_PRESETS.length + cat.CHARACTER_PRESETS.length + cat.GROUP_PRESETS.length, 225);
  assert.strictEqual(cat.CLOTHING.length, 110, `expected 110 clothing styles, got ${cat.CLOTHING.length}`);
  assert.strictEqual(cat.HEADWEAR.length, 50, `expected 50 headwear items, got ${cat.HEADWEAR.length}`);
  assert.strictEqual(cat.PROPS.length, 60, `expected 60 props, got ${cat.PROPS.length}`);
  assert.strictEqual(cat.FINISHES.length, 20, `expected 20 finishes, got ${cat.FINISHES.length}`);
  assert.strictEqual(cat.FRAMINGS.length, 5, `expected 5 framings, got ${cat.FRAMINGS.length}`);
  assert.strictEqual(cat.MIN_GROUP_SUBJECTS, 2);
  assert.strictEqual(cat.MAX_GROUP_SUBJECTS, 6);

  // Every layer item and preset carries a picker group.
  for (const list of [cat.BACKGROUNDS, cat.CLOTHING, cat.HEADWEAR, cat.PROPS, cat.FINISHES, cat.FRAMINGS]) {
    for (const item of list) assert.ok(item.group && typeof item.group === 'string', `layer item ${item.id} missing group`);
  }
  for (const p of [...cat.PROFESSIONAL_PRESETS, ...cat.CHARACTER_PRESETS, ...cat.GROUP_PRESETS]) {
    assert.ok(p.group && typeof p.group === 'string', `preset ${p.id} missing group`);
  }
  assert.ok(props.has('pitchfork'), 'the pitchfork is not optional');
  // The ids the v1.1 gallery rows reference must never disappear.
  for (const keep of ['studio-gray', 'office-bokeh', 'farmhouse', 'samurai-dojo', 'stage', 'dark-suit', 'kimono', 'crown', 'oil', 'headshot']) {
    assert.ok(backgrounds.has(keep) || clothing.has(keep) || headwear.has(keep) || finishes.has(keep) || framings.has(keep), `legacy layer id ${keep} vanished`);
  }
  for (const keep of ['linkedin', 'executive', 'vintage']) assert.ok(cat.findStyle('professional', keep), `legacy professional preset ${keep} vanished`);
  for (const keep of ['american-gothic', 'samurai', 'superhero', 'race-driver']) assert.ok(cat.findStyle('character', keep), `legacy character preset ${keep} vanished`);

  // Every preset references only layer ids that exist.
  const allPresets = [
    ...cat.PROFESSIONAL_PRESETS.map((p) => ({ ...p, mode: 'professional' })),
    ...cat.CHARACTER_PRESETS.map((p) => ({ ...p, mode: 'character' })),
    ...cat.GROUP_PRESETS.map((p) => ({ ...p, mode: 'group' })),
  ];
  ids(cat.PROFESSIONAL_PRESETS, 'professional presets');
  ids(cat.CHARACTER_PRESETS, 'character presets');
  ids(cat.GROUP_PRESETS, 'group presets');
  for (const p of allPresets) {
    assert.ok(backgrounds.has(p.background), `${p.id}: unknown background ${p.background}`);
    assert.ok(clothing.has(p.attire), `${p.id}: unknown attire ${p.attire}`);
    assert.ok(headwear.has(p.headwear), `${p.id}: unknown headwear ${p.headwear}`);
    assert.ok(finishes.has(p.finish), `${p.id}: unknown finish ${p.finish}`);
    assert.ok(framings.has(p.framing), `${p.id}: unknown framing ${p.framing}`);
  }
  // A group scene is an arrangement, never a headshot (hands out of frame makes no sense for a crew).
  for (const p of cat.GROUP_PRESETS) {
    assert.ok(p.pose && p.pose.length > 10, `${p.id}: group preset needs an arrangement`);
    assert.notStrictEqual(p.framing, 'headshot', `${p.id}: group presets are not headshots`);
  }

  // Every preset composes a non-empty prompt with the craft rules present.
  for (const p of allPresets) {
    const opts = p.mode === 'group' ? { subjects: 4 } : {};
    const prompt = cat.buildPortraitPrompt(p.mode, p.id, opts);
    assert.ok(prompt.length > 100, `${p.id}: suspiciously short prompt`);
    assert.ok(/No text, no watermark/.test(prompt), `${p.id}: missing no-text tail`);
    if (p.mode === 'character') {
      assert.ok(/exactly two hands/.test(prompt), `${p.id}: character prompt missing hands rule`);
      assert.ok(/photorealistic and faithful/.test(prompt), `${p.id}: character prompt missing identity rule`);
    } else if (p.mode === 'group') {
      assert.ok(/Group portrait of the 4 people/.test(prompt), `${p.id}: group prompt must name the face count`);
      assert.ok(/4 face crops labeled 1 to 4/.test(prompt), `${p.id}: group prompt must describe the numbered sheet`);
      assert.ok(/exactly once — nobody missing, nobody duplicated, no extra people/.test(prompt), `${p.id}: group prompt missing the every-face-once rule`);
      assert.ok(/no numbers or labels carried over from the reference sheet/.test(prompt), `${p.id}: group prompt must forbid the badges`);
      assert.ok(/exactly two hands per person/.test(prompt), `${p.id}: group prompt missing the per-person hands rule`);
      assert.ok(prompt.includes(`The group is ${p.pose}.`), `${p.id}: arrangement missing from the group prompt`);
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
  // …including the v2 layers, in every mode.
  const v2 = cat.buildPortraitPrompt('professional', 'linkedin', { background: 'tokyo-crossing', attire: 'samurai-armor', headwear: 'sombrero', finish: 'comic-ink', framing: 'wide', prop: 'surfboard' });
  for (const frag of ['Tokyo crossing', 'o-yoroi', 'sombrero', 'comic-book', 'cinematic framing with the full scene visible', 'surfboard tucked under one arm']) {
    assert.ok(v2.includes(frag), `v2 layer fragment missing from prompt: ${frag}`);
  }

  // A prop override REPLACES the preset pose in the solo modes (and validates fail-closed).
  const withProp = cat.buildPortraitPrompt('professional', 'executive', { prop: 'pitchfork' });
  assert.ok(/pitchfork upright/.test(withProp), 'prop override missing from prompt');
  assert.ok(!/arms confidently crossed/.test(withProp), 'preset pose should be replaced by the prop');
  // …but in group mode it is applied to EACH member and the arrangement stays.
  const groupProp = cat.buildPortraitPrompt('group', 'superhero-team', { subjects: 3, prop: 'basketball' });
  assert.ok(/Each of the 3 is posed with a basketball spun on one fingertip/.test(groupProp), 'group prop must be applied per member');
  assert.ok(/The group is standing shoulder to shoulder/.test(groupProp), 'group arrangement must survive a prop override');
  // Headshot framing in group mode drops the hands line (hands are out of frame), keeps everything else.
  const groupHeadshot = cat.buildPortraitPrompt('group', 'board-of-directors', { subjects: 2, framing: 'headshot' });
  assert.ok(!/two hands per person/.test(groupHeadshot), 'headshot framing must not demand hands');
  assert.ok(/Group portrait of the 2 people/.test(groupHeadshot));
  // Free-text notes ride along in group mode too.
  assert.ok(cat.buildPortraitPrompt('group', 'pirate-crew', { subjects: 2, notes: 'the tall one gets the parrot' }).includes('the tall one gets the parrot'));

  // validateOverrides fails closed on unknown ids, accepts empty/absent.
  assert.strictEqual(cat.validateOverrides({}), null);
  assert.strictEqual(cat.validateOverrides({ headwear: '' }), null);
  assert.match(String(cat.validateOverrides({ headwear: 'propeller-beanie' })), /unknown headwear/);
  assert.match(String(cat.validateOverrides({ background: 'the-moon' })), /unknown background/);
  assert.match(String(cat.validateOverrides({ attire: 'birthday-suit' })), /unknown attire/);
  assert.match(String(cat.validateOverrides({ prop: 'chainsaw-bagpipes' })), /unknown prop/);

  // validateSubjects: the face count is a hard contract in group mode and forbidden elsewhere.
  assert.strictEqual(cat.validateSubjects('group', 2), null);
  assert.strictEqual(cat.validateSubjects('group', '6'), null, 'a multipart field arrives as a string');
  assert.match(String(cat.validateSubjects('group', 1)), /between 2 and 6/);
  assert.match(String(cat.validateSubjects('group', 7)), /between 2 and 6/);
  assert.match(String(cat.validateSubjects('group', 2.5)), /between 2 and 6/);
  assert.match(String(cat.validateSubjects('group', 'four')), /between 2 and 6/);
  assert.match(String(cat.validateSubjects('group', undefined)), /between 2 and 6/, 'group mode without a count must fail closed');
  assert.strictEqual(cat.validateSubjects('professional', undefined), null);
  assert.match(String(cat.validateSubjects('professional', 3)), /only valid in group mode/);
  assert.match(String(cat.validateSubjects('character', 2)), /only valid in group mode/);
  assert.throws(() => cat.buildPortraitPrompt('group', 'pirate-crew', {}), /between 2 and 6/, 'a group prompt without a count must throw');
  assert.throws(() => cat.buildPortraitPrompt('group', 'pirate-crew', { subjects: 9 }), /between 2 and 6/);
  assert.throws(() => cat.buildPortraitPrompt('character', 'samurai', { subjects: 2 }), /only valid in group mode/);

  // Mode gate: exactly three modes, nothing else.
  assert.ok(cat.isPortraitMode('professional') && cat.isPortraitMode('character') && cat.isPortraitMode('group'));
  assert.ok(!cat.isPortraitMode('team') && !cat.isPortraitMode('') && !cat.isPortraitMode('GROUP'));
  assert.deepStrictEqual([...cat.PORTRAIT_MODES], ['professional', 'character', 'group']);

  // Unknown preset throws; wrong-mode preset throws (group presets are not reachable from the solo modes and vice versa).
  assert.throws(() => cat.buildPortraitPrompt('professional', 'american-gothic', {}), /unknown professional preset/);
  assert.throws(() => cat.buildPortraitPrompt('character', 'linkedin', {}), /unknown character preset/);
  assert.throws(() => cat.buildPortraitPrompt('character', 'pirate-crew', {}), /unknown character preset/);
  assert.throws(() => cat.buildPortraitPrompt('group', 'superhero', { subjects: 2 }), /unknown group preset/);
  assert.strictEqual(cat.findStyle('team', 'pirate-crew'), null, 'an unknown mode finds nothing');

  // Notes sanitization: control chars stripped, length capped, legit text kept.
  const bell = String.fromCharCode(7);
  const noisy = cat.buildPortraitPrompt('professional', 'linkedin', { notes: 'warm' + bell + 'smile ' + 'x'.repeat(500) });
  const leaked = Array.from(noisy).some(function (ch) { const n = ch.charCodeAt(0); return n < 32 || n === 127; });
  assert.ok(!leaked, 'control characters leaked into the prompt');
  assert.ok(noisy.includes('warm smile'), 'legit notes text lost');
  assert.ok(noisy.length < 2200, 'notes cap not applied');
  // Client catalog never leaks prompt fragments, and carries the group shape the surface needs.
  const client = cat.clientCatalog();
  for (const list of [client.backgrounds, client.attire, client.headwear, client.props, client.finishes, client.framings]) {
    for (const item of list) assert.strictEqual(item.prompt, undefined, 'client catalog leaked a prompt fragment');
  }
  assert.strictEqual(client.presets.professional.length, cat.PROFESSIONAL_PRESETS.length);
  assert.strictEqual(client.presets.character.length, cat.CHARACTER_PRESETS.length);
  assert.strictEqual(client.presets.group.length, cat.GROUP_PRESETS.length);
  for (const p of client.presets.group) assert.strictEqual(p.pose, undefined, 'client catalog leaked a group arrangement');
  assert.deepStrictEqual(client.groupLimits, { min: 2, max: 6 });

  return allPresets.length;
};
