/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:58:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract shared character-import limits, validation, identifiers, scalar coercion, and stat normalization so format adapters stay focused and below governance limits.
 */

'use strict';

const { Buffer } = require('buffer');

const LIMITS = Object.freeze({
  JSON_BYTES: 512 * 1024,
  TEXT_BYTES: 256 * 1024,
  PDF_BYTES: 6 * 1024 * 1024,
  NAME: 80,
  ID: 48,
  RACE: 80,
  CLASS: 120,
  EPITHET: 180,
  FEATURE_COUNT: 40,
  FEATURE_LENGTH: 240,
  ACTION_COUNT: 32,
  INVENTORY_COUNT: 100,
  ITEM_NAME: 100,
  ITEM_DESCRIPTION: 320,
  QUANTITY: 99999,
  LEVEL_MIN: 1,
  LEVEL_MAX: 20,
  ABILITY_MIN: 1,
  ABILITY_MAX: 30,
  AC_MIN: 1,
  AC_MAX: 40,
  HP_MIN: 1,
  HP_MAX: 1000,
  SPEED_MIN: 0,
  SPEED_MAX: 150,
  INITIATIVE_MIN: -20,
  INITIATIVE_MAX: 30,
});

const ABILITIES = Object.freeze(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const ABILITY_NAMES = Object.freeze({
  str: 'strength', dex: 'dexterity', con: 'constitution',
  int: 'intelligence', wis: 'wisdom', cha: 'charisma',
});
const DAMAGE_TYPES = new Set([
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]);
const INVENTORY_CATEGORIES = new Set([
  'weapon', 'armor', 'ammunition', 'adventuring-gear', 'focus', 'tool', 'clothing',
]);
const COIN_KEYS = Object.freeze(['cp', 'sp', 'ep', 'gp', 'pp']);
const RESERVED_IDS = new Set([
  '__proto__', 'proto', 'constructor', 'prototype', 'null', 'undefined',
]);

/** @description Represent a safe, field-addressable character import failure. */
class CharacterImportError extends Error {
  /**
   * @description Construct a client-safe validation failure.
   * @param {string} code - Stable machine-readable failure code.
   * @param {string} message - Human-readable failure detail.
   * @param {string} [field] - Optional input field responsible for the failure.
   * @returns {CharacterImportError} The initialized validation error.
   */
  constructor(code, message, field) {
    super(message);
    this.name = 'CharacterImportError';
    this.code = code;
    if (field) this.field = field;
    this.statusCode = 400;
  }
}

/**
 * @description Abort normalization with a stable client-facing error.
 * @param {string} code - Stable machine-readable failure code.
 * @param {string} message - Human-readable failure detail.
 * @param {string} [field] - Optional input field responsible for the failure.
 * @returns {never} This helper always throws.
 */
function fail(code, message, field) {
  throw new CharacterImportError(code, message, field);
}

/**
 * @description Distinguish plain records from arrays and binary buffers.
 * @param {*} value - Candidate input value.
 * @returns {boolean} True only for a non-buffer object record.
 */
function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}

/** @description Measure text, bytes, or JSON-compatible data in UTF-8 bytes. */
function byteLength(value) {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
  catch (_err) { fail('INVALID_INPUT', 'Character data must be JSON-serializable.'); }
}

/**
 * @description Reject an import payload before expensive parsing when it exceeds its format limit.
 * @param {*} value - Text, bytes, or JSON-compatible input.
 * @param {number} max - Maximum allowed byte length.
 * @param {string} label - Human-readable input label.
 * @returns {void}
 */
function assertSize(value, max, label) {
  if (byteLength(value) > max) fail('INPUT_TOO_LARGE', `${label} exceeds the ${max}-byte limit.`);
}

/** @description Decode the small safe HTML-entity subset found in exported sheets. */
function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,6});/g, (_match, number) => {
      const codePoint = Number(number);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    });
}

/**
 * @description Normalize untrusted display text while removing markup and control characters.
 * @param {*} value - Candidate text value.
 * @param {number} max - Maximum normalized character count.
 * @param {string} label - Field name used in validation failures.
 * @param {boolean} required - Whether an empty value is forbidden.
 * @returns {string} Safe normalized plain text.
 */
function cleanString(value, max, label, required) {
  const source = value === undefined || value === null ? '' : value;
  if (!['string', 'number'].includes(typeof source)) fail('INVALID_TEXT', `${label} must be text.`, label);
  let out = String(source);
  try { out = out.normalize('NFKC'); } catch (_err) { /* Older runtimes lack normalization. */ }
  out = decodeEntities(out)
    .replace(/<[^>]{0,500}>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (required && !out) fail('MISSING_NAME', `${label} is required.`, label);
  if (out.length > max) fail('TEXT_TOO_LONG', `${label} exceeds ${max} characters.`, label);
  return out;
}

/**
 * @description Produce a bounded prototype-safe slug for imported entities.
 * @param {*} value - Preferred identifier source.
 * @param {*} fallback - Identifier source used when the preferred value is empty.
 * @returns {string} Safe lowercase identifier.
 */
function safeId(value, fallback) {
  let raw = value === undefined || value === null || value === '' ? fallback : value;
  raw = String(raw || 'character');
  try { raw = raw.normalize('NFKD'); } catch (_err) { /* Older runtimes lack normalization. */ }
  let id = raw.toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.ID)
    .replace(/-+$/g, '');
  if (!id) id = 'character';
  if (RESERVED_IDS.has(id)) id = `character-${id}`.slice(0, LIMITS.ID);
  return id;
}

/** @description Retain only safe characters from an upstream provider identifier. */
function externalId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const out = String(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return out || undefined;
}

/**
 * @description Validate and coerce a bounded whole-number field.
 * @param {*} value - Candidate numeric value.
 * @param {string} field - Field name used in failures.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @param {number} [fallback] - Value returned when input is empty.
 * @returns {number|undefined} Validated integer or the supplied fallback.
 */
function asInteger(value, field, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  let number;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) number = Number(value.trim());
  else fail('INVALID_STAT', `${field} must be a whole number.`, field);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    fail('INVALID_STAT', `${field} must be between ${min} and ${max}.`, field);
  }
  return number;
}

/** @description Require and validate a bounded whole-number field. */
function requiredInteger(value, field, min, max) {
  if (value === undefined || value === null || value === '') {
    fail('INVALID_STAT', `${field} is required.`, field);
  }
  return asInteger(value, field, min, max);
}

/** @description Normalize common boolean encodings without treating arbitrary text as true. */
function booleanValue(value, fallback) {
  if (value === undefined || value === null) return !!fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return !!fallback;
}

/** @description Convert an ability score into its D&D modifier. */
function abilityMod(score) { return Math.floor((score - 10) / 2); }

/** @description Derive the standard proficiency bonus from a bounded character level. */
function proficiencyForLevel(level) { return 2 + Math.floor((level - 1) / 4); }

/** @description Return the first meaningful value without discarding numeric zero. */
function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

/** @description Read a numeric value from common nested provider field shapes. */
function nestedNumber(value) {
  if (!isRecord(value)) return value;
  return firstDefined(value.total, value.score, value.value, value.baseValue);
}

/** @description Normalize all six ability scores with safe defaults and bounds. */
function normalizeAbilities(raw) {
  const source = isRecord(raw) ? raw : {};
  const normalized = {};
  for (const key of ABILITIES) {
    const value = firstDefined(source[key], source[ABILITY_NAMES[key]]);
    const numeric = nestedNumber(value);
    if (value !== undefined && value !== null && numeric === undefined) {
      fail('INVALID_STAT', `abilities.${key} must contain a numeric score.`, `abilities.${key}`);
    }
    normalized[key] = asInteger(
      numeric, `abilities.${key}`, LIMITS.ABILITY_MIN, LIMITS.ABILITY_MAX, 10,
    );
  }
  return normalized;
}

/** @description Normalize object or row-array spell slots into a level-keyed record. */
function normalizeSlots(raw) {
  if (raw === undefined || raw === null) return {};
  if (Array.isArray(raw)) return normalizeSlotRows(raw);
  if (!isRecord(raw)) fail('INVALID_STAT', 'slots must be an object or array.', 'slots');
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[1-9]$/.test(key)) fail('INVALID_STAT', 'Spell-slot levels must be 1 through 9.', `slots.${key}`);
    normalized[key] = asInteger(value, `slots.${key}`, 0, 20, 0);
  }
  return normalized;
}

/** @description Normalize provider spell-slot rows without duplicating slot-level validation. */
function normalizeSlotRows(rows) {
  if (rows.length > 9) fail('TOO_MANY_ENTRIES', 'spellSlots may contain at most nine levels.', 'slots');
  const normalized = {};
  for (const row of rows) {
    if (!isRecord(row)) fail('INVALID_STAT', 'Each spell-slot row must be an object.', 'slots');
    const level = requiredInteger(firstDefined(row.level, row.slotLevel), 'slots.level', 1, 9);
    const available = firstDefined(
      row.available,
      row.remaining,
      row.max !== undefined ? Number(row.max) - Number(row.used || 0) : undefined,
    );
    normalized[String(level)] = asInteger(available, `slots.${level}`, 0, 20, 0);
  }
  return normalized;
}

/** @description Normalize feature names while enforcing count and text limits. */
function normalizeFeatures(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail('INVALID_INPUT', 'features must be an array.', 'features');
  if (raw.length > LIMITS.FEATURE_COUNT) {
    fail('TOO_MANY_ENTRIES', `features may contain at most ${LIMITS.FEATURE_COUNT} entries.`, 'features');
  }
  return raw.map((value, index) => {
    const candidate = isRecord(value)
      ? firstDefined(value.name, value.definition && value.definition.name)
      : value;
    return cleanString(candidate, LIMITS.FEATURE_LENGTH, `features[${index}]`, true);
  });
}

/** @description Normalize a bounded dice expression, bonus, and optional damage type. */
function normalizeDamage(raw, field, allowZero) {
  if (!isRecord(raw)) fail('INVALID_ACTION', `${field} must be an object.`, field);
  const dice = cleanString(firstDefined(raw.dice, raw.diceString), 12, `${field}.dice`, true)
    .toLowerCase().replace(/\s/g, '');
  const match = dice.match(/^(\d{1,2})d(\d{1,2})$/);
  if (!match) fail('INVALID_ACTION', `${field}.dice must look like 1d8.`, `${field}.dice`);
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const zero = count === 0 && sides === 0;
  if ((!allowZero || !zero) && (count < 1 || count > 10 || ![4, 6, 8, 10, 12, 20].includes(sides))) {
    fail('INVALID_ACTION', `${field}.dice is outside the supported dice range.`, `${field}.dice`);
  }
  const out = { dice: `${count}d${sides}`, bonus: asInteger(raw.bonus, `${field}.bonus`, -20, 50, 0) };
  if (raw.type === undefined) return out;
  const type = cleanString(raw.type, 20, `${field}.type`, true).toLowerCase();
  if (!DAMAGE_TYPES.has(type)) fail('INVALID_ACTION', `${field}.type is not a supported damage type.`, `${field}.type`);
  out.type = type;
  return out;
}

/** @description Parse bounded character JSON while preserving object inputs. */
function parseJson(value) {
  if (typeof value !== 'string') return value;
  assertSize(value, LIMITS.JSON_BYTES, 'Character JSON');
  try { return JSON.parse(value); }
  catch (_err) { fail('INVALID_JSON', 'Character JSON could not be parsed.'); }
}

module.exports = {
  ABILITIES,
  ABILITY_NAMES,
  COIN_KEYS,
  CharacterImportError,
  INVENTORY_CATEGORIES,
  LIMITS,
  abilityMod,
  asInteger,
  assertSize,
  booleanValue,
  cleanString,
  externalId,
  fail,
  firstDefined,
  isRecord,
  normalizeAbilities,
  normalizeDamage,
  normalizeFeatures,
  normalizeSlots,
  parseJson,
  proficiencyForLevel,
  requiredInteger,
  safeId,
};
