/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:58:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract canonical sheet assembly and D&D Beyond JSON adaptation from the route-facing character-import facade.
 */

'use strict';

const {
  ABILITIES,
  ABILITY_NAMES,
  COIN_KEYS,
  LIMITS,
  abilityMod,
  asInteger,
  assertSize,
  cleanString,
  externalId,
  fail,
  firstDefined,
  isRecord,
  normalizeAbilities,
  normalizeFeatures,
  normalizeSlots,
  parseJson,
  proficiencyForLevel,
  safeId,
} = require('./character-import-common');
const {
  attachWeaponActions,
  deriveInventoryFromActions,
  ensureExecutableAttack,
  normalizeActions,
  normalizeInventory,
  weaponKey,
} = require('./character-import-items');

/** @description Derive a stable display token without accepting arbitrary visual markup. */
function tokenFor(id, className, raw) {
  const palette = ['#3b82f6', '#8b5cf6', '#14b8a6', '#e8792e', '#d946ef', '#22c55e'];
  let hash = 0;
  for (const character of id) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  const rawToken = isRecord(raw) ? raw : {};
  const color = typeof rawToken.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(rawToken.color)
    ? rawToken.color.toLowerCase()
    : palette[hash % palette.length];
  const glyphs = {
    fighter: '\u2694', barbarian: '\u{1FA93}', ranger: '\u{1F3F9}', rogue: '\u{1F5E1}',
    wizard: '\u2726', cleric: '\u271A', paladin: '\u{1F6E1}', bard: '\u266A',
  };
  const classKey = Object.keys(glyphs).find((key) => className.toLowerCase().includes(key));
  const candidate = cleanString(rawToken.glyph, 4, 'token.glyph', false);
  const glyph = candidate ? Array.from(candidate).slice(0, 2).join('') : (glyphs[classKey] || '@');
  return { color, glyph };
}

/**
 * @description Build provenance metadata without exposing unsafe upstream identifiers.
 * @param {string} provider - Import provider label.
 * @param {string} format - Source format label.
 * @param {*} [id] - Optional external provider identifier.
 * @returns {object} Canonical import provenance.
 */
function sourceMeta(provider, format, id) {
  const source = { kind: 'import', provider, format };
  const external = externalId(id);
  if (external) source.externalId = external;
  return source;
}

/** @description Compute bounded core stats and defaults for a canonical sheet. */
function coreSheetStats(raw, abilities, level) {
  const mods = Object.fromEntries(ABILITIES.map((key) => [key, abilityMod(abilities[key])]));
  const proficiency = asInteger(raw.prof, 'prof', 2, 6, proficiencyForLevel(level));
  const defaultHp = Math.max(1, 8 + mods.con + (level - 1) * Math.max(1, 5 + mods.con));
  return {
    mods,
    proficiency,
    maxHp: asInteger(firstDefined(raw.maxHp, raw.maxHP), 'maxHp', LIMITS.HP_MIN, LIMITS.HP_MAX, defaultHp),
    ac: asInteger(firstDefined(raw.ac, raw.armorClass), 'ac', LIMITS.AC_MIN, LIMITS.AC_MAX, Math.max(1, 10 + mods.dex)),
    speed: asInteger(raw.speed, 'speed', LIMITS.SPEED_MIN, LIMITS.SPEED_MAX, 30),
    initiative: asInteger(raw.initiative, 'initiative', LIMITS.INITIATIVE_MIN, LIMITS.INITIATIVE_MAX, mods.dex),
  };
}

/**
 * @description Assemble one canonical, executable character sheet from validated source fields.
 * @param {object} raw - Provider-neutral source fields.
 * @param {object} source - Canonical provenance metadata.
 * @param {object} [options] - Optional identifier override.
 * @returns {object} Complete playable character sheet.
 */
function buildSheet(raw, source, options) {
  if (!isRecord(raw)) fail('INVALID_INPUT', 'Character data must be an object.');
  const name = cleanString(raw.name, LIMITS.NAME, 'name', true);
  const level = asInteger(raw.level, 'level', LIMITS.LEVEL_MIN, LIMITS.LEVEL_MAX, 1);
  const abilities = normalizeAbilities(raw.abilities);
  const stats = coreSheetStats(raw, abilities, level);
  const race = cleanString(raw.race || 'Unknown ancestry', LIMITS.RACE, 'race', false) || 'Unknown ancestry';
  const className = cleanString(raw.class || 'Adventurer', LIMITS.CLASS, 'class', false) || 'Adventurer';
  const idSeed = options && options.idSeed ? options.idSeed : firstDefined(raw.id, name);
  const id = safeId(idSeed, name);
  const actions = normalizeActions(raw.actions, abilities, stats.proficiency);
  const inventory = raw.inventory === undefined
    ? deriveInventoryFromActions(actions)
    : normalizeInventory(raw.inventory);
  attachWeaponActions(actions, inventory, abilities, stats.proficiency);
  ensureExecutableAttack(actions, abilities, stats.proficiency);
  const sheet = {
    id, name, race, class: className, level, prof: stats.proficiency,
    ac: stats.ac, maxHp: stats.maxHp, speed: stats.speed,
    abilities, mods: stats.mods, initiative: stats.initiative,
    token: tokenFor(id, className, raw.token),
    features: normalizeFeatures(raw.features), actions, inventory, source,
  };
  const slots = normalizeSlots(raw.slots);
  if (Object.keys(slots).length) sheet.slots = slots;
  const epithet = cleanString(raw.epithet, LIMITS.EPITHET, 'epithet', false);
  if (epithet) sheet.epithet = epithet;
  return sheet;
}

/**
 * @description Normalize the app's own character-sheet JSON contract.
 * @param {object|string} input - Internal sheet object or serialized JSON.
 * @returns {object} Canonical playable sheet.
 */
function normalizeInternalSheet(input) {
  assertSize(input, LIMITS.JSON_BYTES, 'Character JSON');
  const raw = parseJson(input);
  if (!isRecord(raw)) fail('INVALID_INPUT', 'Internal character JSON must be an object.');
  return buildSheet(raw, sourceMeta('internal', 'json', raw.id), {});
}

/** @description Unwrap supported D&D Beyond API response envelopes. */
function unwrapDndBeyond(input) {
  let raw = input;
  if (isRecord(raw) && isRecord(raw.data)) raw = raw.data;
  if (isRecord(raw) && isRecord(raw.data) && !raw.name) raw = raw.data;
  if (!isRecord(raw)) fail('INVALID_INPUT', 'D&D Beyond character JSON must be an object.');
  return raw;
}

/** @description Flatten bounded D&D Beyond modifier groups into safe records. */
function modifierRows(raw) {
  if (!isRecord(raw.modifiers)) return [];
  const rows = [];
  for (const value of Object.values(raw.modifiers)) if (Array.isArray(value)) rows.push(...value);
  if (rows.length > 300) {
    fail('TOO_MANY_ENTRIES', 'D&D Beyond modifiers exceed the safe import limit.', 'modifiers');
  }
  return rows.filter(isRecord);
}

/** @description Apply D&D Beyond bonus and override rows to base ability scores. */
function applyDdbStatRows(values, rows, field, replace) {
  if (!Array.isArray(rows)) return;
  rows.forEach((row) => {
    if (!isRecord(row) || row.value === null || row.value === undefined) return;
    const key = ABILITIES[Number(row.id) - 1];
    if (!key) return;
    const value = asInteger(row.value, `${field}.${key}`, replace ? 1 : -10, replace ? 30 : 10);
    values[key] = replace ? value : values[key] + value;
  });
}

/** @description Apply unrestricted D&D Beyond score modifiers to normalized abilities. */
function applyDdbAbilityModifiers(values, raw) {
  for (const modifier of modifierRows(raw)) {
    if (String(modifier.type || '').toLowerCase() !== 'bonus' || modifier.restriction) continue;
    const subtype = String(modifier.subType || '').toLowerCase();
    const key = ABILITIES.find((candidate) => subtype === `${ABILITY_NAMES[candidate]}-score`);
    const amount = firstDefined(modifier.fixedValue, modifier.value);
    if (!key || amount === undefined) continue;
    values[key] += asInteger(amount, `modifiers.${subtype}`, -10, 10);
  }
}

/** @description Convert D&D Beyond stat rows, overrides, and bonuses into six scores. */
function ddbAbilities(raw) {
  const values = {};
  if (Array.isArray(raw.stats)) {
    if (raw.stats.length > 30) {
      fail('TOO_MANY_ENTRIES', 'D&D Beyond stats exceed the safe import limit.', 'stats');
    }
    raw.stats.forEach((row) => {
      if (!isRecord(row)) return;
      const key = ABILITIES[Number(row.id) - 1];
      if (key && row.value !== null && row.value !== undefined) {
        values[key] = asInteger(row.value, `abilities.${key}`, 1, 30);
      }
    });
  } else if (isRecord(raw.stats)) Object.assign(values, normalizeAbilities(raw.stats));
  else if (isRecord(raw.abilities)) Object.assign(values, normalizeAbilities(raw.abilities));
  for (const key of ABILITIES) if (values[key] === undefined) values[key] = 10;
  applyDdbStatRows(values, raw.bonusStats, 'bonusStats', false);
  applyDdbStatRows(values, raw.overrideStats, 'overrideStats', true);
  applyDdbAbilityModifiers(values, raw);
  return normalizeAbilities(values);
}

/** @description Normalize multiclass names and total level from D&D Beyond class rows. */
function ddbClasses(raw) {
  const names = [];
  let total = 0;
  raw.classes.forEach((entry, index) => {
    if (!isRecord(entry)) fail('INVALID_INPUT', `classes[${index}] must be an object.`, `classes[${index}]`);
    const definition = isRecord(entry.definition) ? entry.definition : {};
    names.push(cleanString(firstDefined(definition.name, entry.name), 60, `classes[${index}].name`, true));
    total += asInteger(entry.level, `classes[${index}].level`, 1, 20, 1);
  });
  if (total > 20) fail('INVALID_STAT', 'Combined class level may not exceed 20.', 'level');
  return { className: names.join(' / '), level: total };
}

/** @description Normalize class and level from multiclass or legacy provider shapes. */
function ddbClassAndLevel(raw) {
  if (Array.isArray(raw.classes) && raw.classes.length) {
    if (raw.classes.length > 20) {
      fail('TOO_MANY_ENTRIES', 'A character may not have more than 20 class entries.', 'classes');
    }
    return ddbClasses(raw);
  }
  const classValue = isRecord(raw.class)
    ? firstDefined(raw.class.name, raw.class.definition && raw.class.definition.name)
    : raw.class;
  return {
    className: cleanString(classValue || 'Adventurer', LIMITS.CLASS, 'class', false) || 'Adventurer',
    level: asInteger(raw.level, 'level', 1, 20, 1),
  };
}

/** @description Normalize ancestry from supported D&D Beyond race shapes. */
function ddbRace(raw) {
  const race = isRecord(raw.race) ? raw.race : {};
  return cleanString(firstDefined(
    race.fullName, race.baseRaceName, race.name,
    race.definition && race.definition.name,
    raw.raceName,
    typeof raw.race === 'string' ? raw.race : undefined,
  ), LIMITS.RACE, 'race', false) || 'Unknown ancestry';
}

/** @description Read walking speed from supported D&D Beyond race shapes. */
function ddbSpeed(raw) {
  const race = isRecord(raw.race) ? raw.race : {};
  const definition = isRecord(race.definition) ? race.definition : {};
  return firstDefined(
    raw.speed,
    race.weightSpeeds && race.weightSpeeds.normal && race.weightSpeeds.normal.walk,
    definition.weightSpeeds && definition.weightSpeeds.normal && definition.weightSpeeds.normal.walk,
  );
}

/** @description Sum unrestricted D&D Beyond initiative modifiers. */
function ddbInitiativeBonus(raw) {
  let bonus = 0;
  for (const modifier of modifierRows(raw)) {
    if (modifier.restriction) continue;
    if (String(modifier.subType || '').toLowerCase() !== 'initiative') continue;
    if (!['bonus', 'set'].includes(String(modifier.type || '').toLowerCase())) continue;
    const amount = firstDefined(modifier.fixedValue, modifier.value);
    if (amount !== undefined) bonus += asInteger(amount, 'initiative modifier', -20, 20);
  }
  return bonus;
}

/** @description Collect bounded distinct provider features, feats, and background. */
function ddbFeatures(raw) {
  const features = [];
  const add = (value) => {
    if (!value || features.length >= LIMITS.FEATURE_COUNT) return;
    const text = cleanString(value, LIMITS.FEATURE_LENGTH, 'feature', false);
    if (text && !features.includes(text)) features.push(text);
  };
  if (Array.isArray(raw.features)) {
    raw.features.forEach((value) => add(isRecord(value)
      ? firstDefined(value.name, value.definition && value.definition.name) : value));
  }
  if (Array.isArray(raw.feats)) {
    raw.feats.forEach((value) => add(isRecord(value)
      ? firstDefined(value.name, value.definition && value.definition.name) : value));
  }
  const background = isRecord(raw.background) ? raw.background : {};
  const backgroundName = firstDefined(background.name, background.definition && background.definition.name);
  if (backgroundName) add(`Background: ${backgroundName}`);
  return features;
}

/** @description Add weapon actions omitted from D&D Beyond's inventory collection. */
function mergeDdbItemActions(items, raw) {
  const itemActions = raw.actions && Array.isArray(raw.actions.item) ? raw.actions.item : [];
  for (const action of itemActions) {
    const candidate = isRecord(action)
      ? firstDefined(action.name, action.definition && action.definition.name)
      : null;
    if (!candidate || !weaponKey(candidate)) continue;
    const candidateKey = weaponKey(candidate);
    const present = items.some((item) => weaponKey(firstDefined(
      item && item.name, item && item.definition && item.definition.name,
    )) === candidateKey);
    if (!present) items.push({ name: candidate, category: 'weapon', quantity: 1, equipped: true });
  }
}

/** @description Normalize D&D Beyond inventory and validate its canonical purse. */
function ddbInventory(raw) {
  const items = Array.isArray(raw.inventory) ? raw.inventory.slice() : [];
  if (items.length > LIMITS.INVENTORY_COUNT) {
    fail('TOO_MANY_ENTRIES', `inventory may contain at most ${LIMITS.INVENTORY_COUNT} entries.`, 'inventory');
  }
  mergeDdbItemActions(items, raw);
  if (items.length > LIMITS.INVENTORY_COUNT) {
    fail('TOO_MANY_ENTRIES', `inventory may contain at most ${LIMITS.INVENTORY_COUNT} entries.`, 'inventory');
  }
  const normalized = normalizeInventory({ items, coins: raw.currencies });
  const currencies = isRecord(raw.currencies) ? raw.currencies : {};
  for (const key of COIN_KEYS) {
    if (currencies[key] !== undefined && currencies[key] !== null) {
      asInteger(currencies[key], `currencies.${key}`, 0, LIMITS.QUANTITY, 0);
    }
  }
  return normalized;
}

/** @description Build the provider-neutral fields used for a D&D Beyond JSON sheet. */
function ddbRawSheet(raw, name, abilities, classInfo) {
  const baseHp = firstDefined(
    raw.overrideHitPoints,
    raw.maxHp,
    raw.maxHP,
    raw.baseHitPoints !== undefined
      ? Number(raw.baseHitPoints) + Number(raw.bonusHitPoints || 0)
      : undefined,
  );
  if (baseHp !== undefined && !Number.isFinite(Number(baseHp))) {
    fail('INVALID_STAT', 'maxHp must be numeric.', 'maxHp');
  }
  const initiative = firstDefined(
    raw.initiative,
    raw.initiativeBonus,
    abilityMod(abilities.dex) + ddbInitiativeBonus(raw),
  );
  const external = firstDefined(raw.id, raw.characterId);
  return {
    external,
    sheet: {
      id: external ? `ddb-${externalId(external) || safeId(name)}` : `ddb-${safeId(name)}`,
      name,
      race: ddbRace(raw), class: classInfo.className, level: classInfo.level, abilities,
      prof: firstDefined(raw.proficiencyBonus, raw.prof), maxHp: baseHp,
      ac: firstDefined(raw.armorClass, raw.ac, raw.defense && raw.defense.armorClass),
      speed: ddbSpeed(raw), initiative, features: ddbFeatures(raw),
      inventory: ddbInventory(raw), actions: [], slots: firstDefined(raw.spellSlots, raw.slots),
      epithet: raw.epithet,
    },
  };
}

/**
 * @description Normalize a D&D Beyond JSON export into a canonical playable sheet.
 * @param {object|string} input - Provider object, envelope, or serialized JSON.
 * @returns {object} Canonical playable sheet.
 */
function normalizeDndBeyondJson(input) {
  assertSize(input, LIMITS.JSON_BYTES, 'D&D Beyond JSON');
  const raw = unwrapDndBeyond(parseJson(input));
  const name = cleanString(firstDefined(raw.name, raw.characterName), LIMITS.NAME, 'name', true);
  const abilities = ddbAbilities(raw);
  const classInfo = ddbClassAndLevel(raw);
  const prepared = ddbRawSheet(raw, name, abilities, classInfo);
  return buildSheet(
    prepared.sheet,
    sourceMeta('dndbeyond', 'json', prepared.external),
    { idSeed: prepared.sheet.id },
  );
}

/**
 * @description Detect D&D Beyond-specific structural fields for auto-format selection.
 * @param {*} value - Parsed candidate character payload.
 * @returns {boolean} True when provider-specific structure is present.
 */
function looksLikeDndBeyond(value) {
  const raw = isRecord(value) && isRecord(value.data) ? value.data : value;
  return isRecord(raw) && (
    Array.isArray(raw.stats)
    || Array.isArray(raw.classes)
    || raw.baseHitPoints !== undefined
    || (isRecord(raw.race) && (raw.race.fullName || raw.race.baseRaceName))
    || (Array.isArray(raw.inventory)
      && raw.inventory.some((item) => isRecord(item) && isRecord(item.definition)))
  );
}

module.exports = {
  buildSheet,
  looksLikeDndBeyond,
  normalizeDndBeyondJson,
  normalizeInternalSheet,
  sourceMeta,
};
