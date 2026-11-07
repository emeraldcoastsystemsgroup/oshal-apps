/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | roger.murphy@emeraldcoastsystemsgroup.com   | Catalog invariants: every preset references only existing layer ids; prompt composition honors overrides; validateOverrides fails closed; notes sanitization strips control chars + caps length. Plain node (the catalog module is framework-free) — `node tests/run.js`.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Catalog v2 + group mode: the contract is now 200 backgrounds / 225 presets (80 professional + 105 character + 40 group) / 110 clothing / 50 headwear / 60 props / 20 finishes / 5 framings; group presets must reference real layer ids and compose a prompt that names the face count, demands every face exactly once, forbids sheet labels in the output and asks for two hands per person; validateSubjects fails closed (below 2, above 6, non-integer, absent, or present outside group mode); a prop in group mode is applied per member while the arrangement stays; the client catalog exposes presets.group + groupLimits.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | 1.17.4: Update enforced counts for `roman-soldier` (`CHARACTER_PRESETS` 106, total 226), `lorica-segmentata` (`CLOTHING` 111), and `galea-helm` (`HEADWEAR` 51), and assert Roman Soldier and Gladiator compose legionary armor prompts.
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

function verifyCountsAndIds(sets) {
  assert.strictEqual(cat.BACKGROUNDS.length, 200, `expected exactly 200 backgrounds, got ${cat.BACKGROUNDS.length}`);
  assert.strictEqual(cat.PROFESSIONAL_PRESETS.length, 80, `expected 80 professional presets, got ${cat.PROFESSIONAL_PRESETS.length}`);
  assert.strictEqual(cat.CHARACTER_PRESETS.length, 106, `expected 106 character presets, got ${cat.CHARACTER_PRESETS.length}`);
  assert.strictEqual(cat.GROUP_PRESETS.length, 40, `expected 40 group presets, got ${cat.GROUP_PRESETS.length}`);
  assert.strictEqual(cat.PROFESSIONAL_PRESETS.length + cat.CHARACTER_PRESETS.length + cat.GROUP_PRESETS.length, 226);
  assert.strictEqual(cat.CLOTHING.length, 111, `expected 111 clothing styles, got ${cat.CLOTHING.length}`);
  assert.strictEqual(cat.HEADWEAR.length, 51, `expected 51 headwear items, got ${cat.HEADWEAR.length}`);
  assert.strictEqual(cat.PROPS.length, 60, `expected 60 props, got ${cat.PROPS.length}`);
  assert.strictEqual(cat.FINISHES.length, 20, `expected 20 finishes, got ${cat.FINISHES.length}`);
  assert.strictEqual(cat.FRAMINGS.length, 5, `expected 5 framings, got ${cat.FRAMINGS.length}`);
  assert.strictEqual(cat.MIN_GROUP_SUBJECTS, 2);
  assert.strictEqual(cat.MAX_GROUP_SUBJECTS, 6);
  for (const list of [cat.BACKGROUNDS, cat.CLOTHING, cat.HEADWEAR, cat.PROPS, cat.FINISHES, cat.FRAMINGS]) {
    for (const item of list) assert.ok(item.group && typeof item.group === 'string', `layer item ${item.id} missing group`);
  }
  for (const p of [...cat.PROFESSIONAL_PRESETS, ...cat.CHARACTER_PRESETS, ...cat.GROUP_PRESETS]) {
    assert.ok(p.group && typeof p.group === 'string', `preset ${p.id} missing group`);
  }
  assert.ok(sets.props.has('pitchfork'), 'the pitchfork is not optional');
  for (const keep of ['studio-gray', 'office-bokeh', 'farmhouse', 'samurai-dojo', 'stage', 'dark-suit', 'kimono', 'crown', 'oil', 'headshot']) {
    assert.ok(sets.backgrounds.has(keep) || sets.clothing.has(keep) || sets.headwear.has(keep) || sets.finishes.has(keep) || sets.framings.has(keep), `legacy layer id ${keep} vanished`);
  }
  for (const keep of ['linkedin', 'executive', 'vintage']) assert.ok(cat.findStyle('professional', keep), `legacy professional preset ${keep} vanished`);
  for (const keep of ['american-gothic', 'samurai', 'superhero', 'race-driver', 'roman-soldier', 'gladiator']) assert.ok(cat.findStyle('character', keep), `legacy character preset ${keep} vanished`);
}

function verifyPresetPrompts(sets, allPresets) {
  ids(cat.PROFESSIONAL_PRESETS, 'professional presets');
  ids(cat.CHARACTER_PRESETS, 'character presets');
  ids(cat.GROUP_PRESETS, 'group presets');
  for (const p of allPresets) {
    assert.ok(sets.backgrounds.has(p.background), `${p.id}: unknown background ${p.background}`);
    assert.ok(sets.clothing.has(p.attire), `${p.id}: unknown attire ${p.attire}`);
    assert.ok(sets.headwear.has(p.headwear), `${p.id}: unknown headwear ${p.headwear}`);
    assert.ok(sets.finishes.has(p.finish), `${p.id}: unknown finish ${p.finish}`);
    assert.ok(sets.framings.has(p.framing), `${p.id}: unknown framing ${p.framing}`);
    const opts = p.mode === 'group' ? { subjects: 4 } : {};
    const prompt = cat.buildPortraitPrompt(p.mode, p.id, opts);
    assert.ok(prompt.length > 100 && /No text, no watermark/.test(prompt), `${p.id}: invalid prompt shape`);
    if (p.mode === 'character') assert.ok(/exactly two hands/.test(prompt) && /photorealistic and faithful/.test(prompt), `${p.id}: character rules`);
    else if (p.mode === 'group') assert.ok(/Group portrait of the 4 people/.test(prompt) && /4 face crops labeled 1 to 4/.test(prompt) && /exactly once — nobody missing, nobody duplicated, no extra people/.test(prompt) && /no numbers or labels carried over from the reference sheet/.test(prompt) && /exactly two hands per person/.test(prompt) && prompt.includes(`The group is ${p.pose}.`), `${p.id}: group rules`);
    else assert.ok(/Identity is paramount/.test(prompt), `${p.id}: professional rules`);
  }
  for (const p of cat.GROUP_PRESETS) {
    assert.ok(p.pose && p.pose.length > 10 && p.framing !== 'headshot', `${p.id}: group arrangement`);
  }
  const romanPrompt = cat.buildPortraitPrompt('character', 'roman-soldier', {});
  assert.ok(/lorica segmentata/.test(romanPrompt) && /galea helmet/.test(romanPrompt), 'roman-soldier prompt must include legionary armor and centurion helmet');
  const gladiatorPrompt = cat.buildPortraitPrompt('character', 'gladiator', {});
  assert.ok(/lorica segmentata/.test(gladiatorPrompt) && !/\btoga\b/.test(gladiatorPrompt), 'gladiator prompt must wear armor rather than a senatorial toga');
}

function verifyOverridesAndSubjects() {
  const swapped = cat.buildPortraitPrompt('character', 'american-gothic', { headwear: 'crown', background: 'castle-hall', finish: 'watercolor' });
  assert.ok(/golden jeweled crown/.test(swapped) && /castle hall/.test(swapped) && /watercolor/.test(swapped) && !/farmhouse/.test(swapped));
  const v2 = cat.buildPortraitPrompt('professional', 'linkedin', { background: 'tokyo-crossing', attire: 'samurai-armor', headwear: 'sombrero', finish: 'comic-ink', framing: 'wide', prop: 'surfboard' });
  for (const frag of ['Tokyo crossing', 'o-yoroi', 'sombrero', 'comic-book', 'cinematic framing with the full scene visible', 'surfboard tucked under one arm']) assert.ok(v2.includes(frag), `v2 layer fragment missing: ${frag}`);
  const withProp = cat.buildPortraitPrompt('professional', 'executive', { prop: 'pitchfork' });
  assert.ok(/pitchfork upright/.test(withProp) && !/arms confidently crossed/.test(withProp));
  const groupProp = cat.buildPortraitPrompt('group', 'superhero-team', { subjects: 3, prop: 'basketball' });
  assert.ok(/Each of the 3 is posed with a basketball spun on one fingertip/.test(groupProp) && /The group is standing shoulder to shoulder/.test(groupProp));
  const groupHeadshot = cat.buildPortraitPrompt('group', 'board-of-directors', { subjects: 2, framing: 'headshot' });
  assert.ok(!/two hands per person/.test(groupHeadshot) && /Group portrait of the 2 people/.test(groupHeadshot));
  assert.ok(cat.buildPortraitPrompt('group', 'pirate-crew', { subjects: 2, notes: 'the tall one gets the parrot' }).includes('the tall one gets the parrot'));
  assert.strictEqual(cat.validateOverrides({}), null);
  assert.strictEqual(cat.validateOverrides({ headwear: '' }), null);
  for (const [k, v, re] of [['headwear', 'propeller-beanie', /unknown headwear/], ['background', 'the-moon', /unknown background/], ['attire', 'birthday-suit', /unknown attire/], ['prop', 'chainsaw-bagpipes', /unknown prop/]]) assert.match(String(cat.validateOverrides({ [k]: v })), re);
  assert.strictEqual(cat.validateSubjects('group', 2), null);
  assert.strictEqual(cat.validateSubjects('group', '6'), null);
  for (const bad of [1, 7, 2.5, 'four', undefined]) assert.match(String(cat.validateSubjects('group', bad)), /between 2 and 6/);
  assert.strictEqual(cat.validateSubjects('professional', undefined), null);
  assert.match(String(cat.validateSubjects('professional', 3)), /only valid in group mode/);
  assert.match(String(cat.validateSubjects('character', 2)), /only valid in group mode/);
  assert.throws(() => cat.buildPortraitPrompt('group', 'pirate-crew', {}), /between 2 and 6/);
  assert.throws(() => cat.buildPortraitPrompt('group', 'pirate-crew', { subjects: 9 }), /between 2 and 6/);
  assert.throws(() => cat.buildPortraitPrompt('character', 'samurai', { subjects: 2 }), /only valid in group mode/);
}

function verifyModesAndClient() {
  assert.ok(cat.isPortraitMode('professional') && cat.isPortraitMode('character') && cat.isPortraitMode('group'));
  assert.ok(!cat.isPortraitMode('team') && !cat.isPortraitMode('') && !cat.isPortraitMode('GROUP'));
  assert.deepStrictEqual([...cat.PORTRAIT_MODES], ['professional', 'character', 'group']);
  assert.throws(() => cat.buildPortraitPrompt('professional', 'american-gothic', {}), /unknown professional preset/);
  assert.throws(() => cat.buildPortraitPrompt('character', 'linkedin', {}), /unknown character preset/);
  assert.throws(() => cat.buildPortraitPrompt('character', 'pirate-crew', {}), /unknown character preset/);
  assert.throws(() => cat.buildPortraitPrompt('group', 'superhero', { subjects: 2 }), /unknown group preset/);
  assert.strictEqual(cat.findStyle('team', 'pirate-crew'), null);
  const noisy = cat.buildPortraitPrompt('professional', 'linkedin', { notes: 'warm' + String.fromCharCode(7) + 'smile ' + 'x'.repeat(500) });
  assert.ok(!Array.from(noisy).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) && noisy.includes('warm smile') && noisy.length < 2200);
  const client = cat.clientCatalog();
  for (const list of [client.backgrounds, client.attire, client.headwear, client.props, client.finishes, client.framings]) {
    for (const item of list) assert.strictEqual(item.prompt, undefined, 'client catalog leaked a prompt fragment');
  }
  assert.strictEqual(client.presets.professional.length, cat.PROFESSIONAL_PRESETS.length);
  assert.strictEqual(client.presets.character.length, cat.CHARACTER_PRESETS.length);
  assert.strictEqual(client.presets.group.length, cat.GROUP_PRESETS.length);
  for (const p of client.presets.group) assert.strictEqual(p.pose, undefined, 'client catalog leaked a group arrangement');
  assert.deepStrictEqual(client.groupLimits, { min: 2, max: 6 });
}

module.exports = function run() {
  const sets = {
    backgrounds: ids(cat.BACKGROUNDS, 'backgrounds'),
    clothing: ids(cat.CLOTHING, 'clothing'),
    headwear: ids(cat.HEADWEAR, 'headwear'),
    props: ids(cat.PROPS, 'props'),
    finishes: ids(cat.FINISHES, 'finishes'),
    framings: ids(cat.FRAMINGS, 'framings'),
  };
  const allPresets = [
    ...cat.PROFESSIONAL_PRESETS.map((p) => ({ ...p, mode: 'professional' })),
    ...cat.CHARACTER_PRESETS.map((p) => ({ ...p, mode: 'character' })),
    ...cat.GROUP_PRESETS.map((p) => ({ ...p, mode: 'group' })),
  ];
  verifyCountsAndIds(sets);
  verifyPresetPrompts(sets, allPresets);
  verifyOverridesAndSubjects();
  verifyModesAndClient();
  return allPresets.length;
};
