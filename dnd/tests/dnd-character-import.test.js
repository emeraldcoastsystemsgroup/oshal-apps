/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:04:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard the modular character-import facade across internal JSON, D&D Beyond JSON, extracted PDF text, byte parsing, limits, and playable-action fallbacks.
 */

/**
 * Offline guards for lib/character-import.js.
 *
 * The fixtures are intentionally small, synthetic representations of the two
 * accepted JSON shapes and text extracted from a fillable D&D Beyond PDF. No
 * network, database, browser, or PDF dependency is required.
 */

'use strict';

const {
  CharacterImportError,
  LIMITS,
  safeId,
  normalizeInternalSheet,
  normalizeDndBeyondJson,
  parseDndBeyondPdfText,
  importCharacter,
  extractPdfText,
  importDndBeyondPdf,
} = require('../lib/character-import.js');

let checks = 0;
let failures = 0;

function check(condition, message) {
  checks++;
  if (!condition) { failures++; console.error('  ✗ ' + message); }
}

function throwsCode(fn, code, message) {
  checks++;
  try { fn(); console.error(`  ✗ ${message} (did not throw)`); failures++; }
  catch (err) {
    if (!(err instanceof CharacterImportError) || err.code !== code) {
      console.error(`  ✗ ${message} (got ${err && err.code}: ${err && err.message})`); failures++;
    }
  }
}

async function rejectsCode(fn, code, message) {
  checks++;
  try { await fn(); console.error(`  ✗ ${message} (did not reject)`); failures++; }
  catch (err) {
    if (!(err instanceof CharacterImportError) || err.code !== code) {
      console.error(`  ✗ ${message} (got ${err && err.code}: ${err && err.message})`); failures++;
    }
  }
}

const abilities = { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 };

// Safe, stable slugs: no markup/path punctuation, prototype keys, or unbounded ids.
check(safeId('  Éowyn / ../../ Queen<script> ') === 'eowyn-queen-script', 'safeId strips path/markup punctuation and normalizes Unicode');
check(safeId('__proto__').startsWith('character-'), 'safeId protects prototype-reserved names');
check(safeId('x'.repeat(200)).length === LIMITS.ID, 'safeId enforces the id length cap');
check(LIMITS.PDF_BYTES === 6 * 1024 * 1024, 'PDF byte limit matches the six-megabyte upload UI contract');

// Normalized/internal app sheet: preserves supported actions, fills defaults,
// derives modifiers/resources, strips markup, and derives inventory if absent.
const internal = normalizeInternalSheet({
  id: '../Sir BRAM!!',
  name: 'Sir <b>Bram</b>\u0000 Ironhand',
  race: 'Human',
  class: 'Fighter',
  level: 3,
  ac: 18,
  maxHp: 27,
  speed: 30,
  abilities,
  features: ['Second Wind'],
  actions: [{
    id: 'longsword', name: 'Longsword', type: 'weapon', mode: 'attack', delivery: 'melee',
    reach: 5, toHit: 99, damage: { dice: '99d99', bonus: 99, type: 'fire' },
    text: '<b>Reliable steel.</b>',
  }],
  token: { color: '#ABCDEF', glyph: '⚔' },
});
check(internal.id === 'sir-bram', 'internal id is normalized to a safe slug');
check(internal.name === 'Sir Bram Ironhand', 'display strings are control/markup-free');
check(internal.mods.str === 3 && internal.mods.dex === 2 && internal.prof === 2, 'ability modifiers and proficiency are derived correctly');
check(internal.actions[0].damage.dice === '1d8' && internal.actions[0].damage.type === 'slashing', 'known weapons use the whitelisted SRD profile, not supplied combat numbers');
check(internal.actions[0].toHit === 5 && internal.actions[0].damage.bonus === 3, 'known weapon bonuses derive from validated stats');
check(internal.inventory.items.length === 1 && internal.inventory.items[0].actionId === internal.actions[0].id, 'missing inventory is derived and linked to weapon actions');
check(Object.keys(internal.inventory.coins).join(',') === 'cp,sp,ep,gp,pp' && internal.inventory.coins.gp === 0, 'all imports include the canonical five-denomination coin purse');
check(internal.source.provider === 'internal' && internal.source.format === 'json', 'internal import records source metadata');
check(internal.token.color === '#abcdef', 'valid token colors are normalized');
check(JSON.parse(JSON.stringify(internal)).name === internal.name, 'normalized sheet is plain JSON-serializable data');

const unarmedOnly = normalizeInternalSheet({ name: 'No Gear', abilities: { str: 16 } });
const unarmed = unarmedOnly.actions.find((action) => action.id === 'unarmed-strike');
check(!!unarmed && unarmed.mode === 'attack' && unarmed.delivery === 'melee', 'a sheet with no attacks receives an executable Unarmed Strike');
check(unarmed.toHit === 5 && unarmed.damage.dice === '0d0' && unarmed.damage.bonus === 4 && unarmed.damage.type === 'bludgeoning', 'Unarmed Strike derives bounded SRD attack numbers from STR and proficiency');
check(unarmedOnly.inventory.items.length === 0, 'Unarmed Strike does not invent a carried inventory item');
check(normalizeInternalSheet(unarmedOnly).actions.some((action) => action.id === 'unarmed-strike'), 'a normalized fallback sheet can be safely re-imported');

// Strictly validated custom app actions are supported, but invalid mechanics are not.
const custom = normalizeInternalSheet({
  name: 'Mara Reed', abilities,
  inventory: { items: [{ name: 'Rope', category: 'adventuring-gear', quantity: 2, description: '<i>50 feet</i>' }], coins: { gp: 12, sp: 3 } },
  actions: [{
    id: 'field-blade', name: 'Field Blade', type: 'weapon', mode: 'attack', delivery: 'melee',
    reach: 5, toHit: 4, damage: { dice: '1d6', bonus: 2, type: 'slashing' },
  }],
  slots: { 1: 2 },
});
check(custom.actions[0].damage.dice === '1d6' && custom.actions[0].toHit === 4, 'strict custom internal weapon actions remain usable');
check(custom.inventory.items[0].description === '50 feet' && custom.slots['1'] === 2, 'inventory markup is removed and slots are normalized');
check(custom.inventory.coins.gp === 12 && custom.inventory.coins.cp === 0, 'new inventory-object coins are normalized with missing denominations defaulted');
const legacyInventory = normalizeInternalSheet({ name: 'Legacy Pack', inventory: ['Rope'] });
check(legacyInventory.inventory.items[0].category === 'adventuring-gear' && legacyInventory.inventory.coins.pp === 0, 'legacy inventory arrays upgrade to the canonical object schema');
throwsCode(() => normalizeInternalSheet({ name: 'Bad Dice', actions: [{ name: 'Chaos Blade', type: 'weapon', mode: 'attack', delivery: 'melee', toHit: 3, reach: 5, damage: { dice: '100d100', bonus: 0, type: 'slashing' } }] }), 'INVALID_ACTION', 'unsupported dice are rejected');
throwsCode(() => normalizeInternalSheet({ name: 'Missing Bonus', actions: [{ name: 'Chaos Blade', type: 'weapon', mode: 'attack', delivery: 'melee', reach: 5, damage: { dice: '1d6', bonus: 0, type: 'slashing' } }] }), 'INVALID_STAT', 'required custom action statistics fail closed');

// Common D&D Beyond character-service JSON wrapper. Ability bonuses are applied
// from the usual modifiers collection and executable actions are generated only
// for recognized basic weapons.
const ddbFixture = {
  success: true,
  data: {
    id: 424242,
    name: 'Aelar Moonbrook',
    baseHitPoints: 24,
    bonusHitPoints: 2,
    stats: [
      { id: 1, value: 10 }, { id: 2, value: 15 }, { id: 3, value: 13 },
      { id: 4, value: 12 }, { id: 5, value: 14 }, { id: 6, value: 8 },
    ],
    bonusStats: [{ id: 2, value: 1 }],
    overrideStats: [],
    modifiers: {
      race: [{ type: 'bonus', subType: 'dexterity-score', fixedValue: 2, restriction: null }],
      class: [{ type: 'bonus', subType: 'initiative', fixedValue: 1, restriction: null }],
    },
    classes: [{ level: 3, definition: { name: 'Ranger' } }],
    race: { fullName: 'Wood Elf', weightSpeeds: { normal: { walk: 35 } } },
    armorClass: 15,
    inventory: [
      { id: 11, quantity: 1, equipped: true, definition: { id: 101, name: 'Longbow', filterType: 'Weapon', description: '<p>A yew longbow.</p>' } },
      { id: 12, quantity: 1, equipped: true, definition: { id: 102, name: 'Leather Armor', filterType: 'Armor' } },
      { id: 13, quantity: 1, equipped: false, definition: { id: 103, name: 'Homebrew Star Cannon', filterType: 'Weapon' } },
    ],
    currencies: { gp: 17, sp: 4, cp: 0 },
    feats: [{ definition: { name: 'Observant' } }],
    background: { definition: { name: 'Outlander' } },
  },
};
const ddb = normalizeDndBeyondJson(JSON.stringify(ddbFixture));
check(ddb.id === 'ddb-424242' && ddb.source.externalId === '424242', 'DDB id is namespaced and retained only as safe metadata');
check(ddb.race === 'Wood Elf' && ddb.class === 'Ranger' && ddb.level === 3, 'DDB race/class/level shape is mapped');
check(ddb.abilities.dex === 18 && ddb.mods.dex === 4, 'DDB base, bonus, and unrestricted racial ability modifiers are combined');
check(ddb.maxHp === 26 && ddb.ac === 15 && ddb.speed === 35 && ddb.initiative === 5, 'DDB HP/AC/speed/initiative fields are mapped');
check(ddb.actions.length === 1 && ddb.actions[0].name === 'Longbow' && ddb.actions[0].range === 150, 'only recognized SRD weapons become executable actions');
check(ddb.actions[0].toHit === 6 && ddb.actions[0].damage.bonus === 4, 'DDB weapon action derives safe attack numbers');
check(ddb.inventory.items.some((item) => item.name === 'Homebrew Star Cannon' && item.category === 'adventuring-gear') && !ddb.actions.some((action) => /Star Cannon/.test(action.name)), 'unknown/homebrew equipment remains visible but is demoted to non-executable gear');
check(ddb.inventory.coins.gp === 17 && ddb.inventory.coins.sp === 4 && ddb.inventory.items.every((item) => item.category !== 'currency'), 'DDB currency maps into the coin purse, never fake item rows');
check(ddb.features.includes('Observant') && ddb.features.includes('Background: Outlander'), 'DDB feature names are retained without descriptions/scripts');
check(!JSON.stringify(ddb).includes('<p>'), 'DDB HTML is removed from normalized output');

// Alternate simple DDB/exporter shape, including multiclass and override stats.
const multiclass = normalizeDndBeyondJson({
  id: 'abc-9', name: 'Nyx',
  abilities: { strength: { score: 8 }, dexterity: { score: 17 }, constitution: 12, intelligence: 14, wisdom: 10, charisma: 16 },
  classes: [{ level: 2, definition: { name: 'Rogue' } }, { level: 1, definition: { name: 'Wizard' } }],
  race: { baseRaceName: 'Tiefling' },
  maxHp: 19,
  inventory: [{ name: 'Rapier', filterType: 'Weapon', quantity: 1, equipped: true }],
});
check(multiclass.class === 'Rogue / Wizard' && multiclass.level === 3, 'multiclass DDB levels are summed and names retained');
check(multiclass.actions[0].toHit === 5, 'finesse weapon selects the better validated ability modifier');

// Fillable-PDF text path. The parser accepts both human labels and common compact
// field names, then generates the same normalized schema from equipment text.
const pdfText = `
CHARACTER NAME: Pip Quickstep
CLASS & LEVEL: Rogue 3 / Wizard 2
RACE: Lightfoot Halfling
ARMOR CLASS: 16
HIT POINT MAXIMUM: 31
SPEED: 25 ft.
PROFICIENCY BONUS: +3
INITIATIVE: +4
STRENGTH: 8
DEXTERITY: 18
CONSTITUTION: 14
INTELLIGENCE: 13
WISDOM: 12
CHARISMA: 10
EQUIPMENT
Rapier, Leather Armor, Thieves' Tools, Explorer's Pack
ATTACKS & SPELLCASTING
Rapier +7 1d8+4 piercing
`;
const pdf = parseDndBeyondPdfText(pdfText);
check(pdf.name === 'Pip Quickstep' && pdf.id === 'ddb-pip-quickstep', 'PDF text produces a safe named character');
check(pdf.class === 'Rogue / Wizard' && pdf.level === 5 && pdf.race === 'Lightfoot Halfling', 'PDF class/multiclass/race labels are parsed');
check(pdf.abilities.dex === 18 && pdf.mods.dex === 4 && pdf.prof === 3, 'PDF abilities and proficiency are parsed');
check(pdf.ac === 16 && pdf.maxHp === 31 && pdf.speed === 25 && pdf.initiative === 4, 'PDF combat stats are parsed with units/signs');
check(pdf.actions.length === 1 && pdf.actions[0].name === 'Rapier' && pdf.actions[0].toHit === 7, 'PDF equipment generates a basic finesse weapon action');
check(pdf.inventory.items.some((item) => item.name === "Thieves' Tools" && item.category === 'tool'), 'PDF nonweapon gear remains visible in inventory');
check(pdf.source.provider === 'dndbeyond' && pdf.source.format === 'pdf-text', 'PDF source metadata is explicit');

const compactPdf = parseDndBeyondPdfText(`
CharacterName Arannis
ClassLevel Wizard 4
Race High Elf
AC 14
HPMax 22
Speed 30
STR 9
DEX 16
CON 12
INT 18
WIS 11
CHA 10
Equipment: Dagger; Component Pouch
`);
check(compactPdf.name === 'Arannis' && compactPdf.level === 4 && compactPdf.class === 'Wizard', 'compact fillable-PDF field names are supported');
check(compactPdf.actions[0].name === 'Dagger', 'compact PDF equipment also generates weapon actions');
const modifierFirstPdf = parseDndBeyondPdfText(`
Character Name: Mod First
Class & Level: Fighter 1
Strength
-1
8
Equipment: Club
`);
check(modifierFirstPdf.abilities.str === 8, 'PDF ability parsing skips a signed modifier placed before the actual score');

for (const sheet of [internal, custom, ddb, multiclass, pdf, compactPdf, modifierFirstPdf]) {
  check(sheet.inventory.items.filter((item) => item.category === 'weapon').every((item) =>
    item.actionId && sheet.actions.some((action) => action.id === item.actionId && action.type === 'weapon')),
  `${sheet.name}: every imported weapon item has a resolvable actionId`);
}

// Auto dispatcher accepts object/JSON/text but never interprets a URL or fetches.
check(importCharacter(ddbFixture).source.provider === 'dndbeyond', 'auto dispatcher detects DDB JSON objects');
check(importCharacter(JSON.stringify({ name: 'Local Hero' })).source.provider === 'internal', 'auto dispatcher detects normalized JSON text');
check(importCharacter(pdfText).source.format === 'pdf-text', 'auto dispatcher treats non-JSON text as extracted PDF text');
throwsCode(() => importCharacter('https://www.dndbeyond.com/characters/123'), 'MISSING_NAME', 'URLs are not fetched or treated as an import source');
throwsCode(() => importCharacter({}, { format: 'zip' }), 'UNSUPPORTED_FORMAT', 'unknown formats fail closed');

// Required fields, stats, counts, and total bytes fail closed.
throwsCode(() => normalizeInternalSheet({ race: 'Human' }), 'MISSING_NAME', 'internal sheets require a name');
throwsCode(() => normalizeDndBeyondJson({ data: { stats: [] } }), 'MISSING_NAME', 'DDB JSON requires a name');
throwsCode(() => parseDndBeyondPdfText('CLASS & LEVEL: Fighter 1'), 'MISSING_NAME', 'PDF text requires a name');
throwsCode(() => normalizeInternalSheet({ name: 'Impossible', abilities: { str: 31 } }), 'INVALID_STAT', 'ability scores above 30 are rejected');
throwsCode(() => normalizeInternalSheet({ name: 'Impossible', ac: 999 }), 'INVALID_STAT', 'out-of-range armor class is rejected');
throwsCode(() => normalizeInternalSheet({ name: 'Impossible', maxHp: -1 }), 'INVALID_STAT', 'negative hit points are rejected');
throwsCode(() => normalizeInternalSheet({ name: 'Hoarder', inventory: { items: Array.from({ length: LIMITS.INVENTORY_COUNT + 1 }, (_, i) => `Item ${i}`), coins: {} } }), 'TOO_MANY_ENTRIES', 'inventory entry cap is enforced');
throwsCode(() => normalizeInternalSheet({ name: 'x', ignored: 'y'.repeat(LIMITS.JSON_BYTES) }), 'INPUT_TOO_LARGE', 'total JSON byte cap is enforced');
const polluted = JSON.parse('{"name":"Safe","__proto__":{"polluted":true}}');
normalizeInternalSheet(polluted);
check({}.polluted === undefined, 'prototype-looking input keys cannot pollute output/runtime objects');
const encodedMarkup = normalizeInternalSheet({ name: '&lt;script&gt;Encoded&lt;/script&gt; Hero' });
check(!/[<>]/.test(encodedMarkup.name), 'entity-encoded markup cannot survive string normalization');

async function runAsyncChecks() {
  const fakePdf = Buffer.from('%PDF-1.7\nsynthetic fixture');
  const extracted = await extractPdfText(fakePdf, { pdfParse: async () => ({ text: pdfText }) });
  check(extracted.includes('Pip Quickstep'), 'PDF helper supports an injected parser without an installed dependency');
  const imported = await importDndBeyondPdf(fakePdf, { pdfParse: async () => ({ text: pdfText }) });
  check(imported.name === 'Pip Quickstep' && imported.source.format === 'pdf-text', 'async PDF helper composes extraction and pure text normalization');
  await rejectsCode(() => extractPdfText(Buffer.from('not a pdf'), { pdfParse: async () => ({ text: pdfText }) }), 'INVALID_PDF', 'non-PDF bytes are rejected before parser invocation');
  await rejectsCode(() => extractPdfText(fakePdf, { pdfParse: async () => ({ nope: true }) }), 'INVALID_PDF', 'parser results without text are rejected');
}

runAsyncChecks().then(() => {
  if (failures) { console.error(`\n✗ ${failures} of ${checks} character-import checks failed`); process.exit(1); }
  console.log(`✓ character imports normalize safely — ${checks} checks green (internal JSON, DDB JSON, PDF text/PDF adapter)`);
}).catch((err) => {
  console.error(err); process.exit(1);
});
