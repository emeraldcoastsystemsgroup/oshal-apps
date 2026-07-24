/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Validate and canonicalize bounded versioned combat-roll events for board state, archive persistence, synchronization, and replay.
 */

'use strict';

/** @description Maximum serialized characters accepted for one archive event. */
const MAX_EVENT_LENGTH = 32768;
/** @description Maximum exact roll groups accepted in one event. */
const MAX_ROLLS = 64;
const ROLL_KEYS = [
  'actionName', 'actorId', 'actorName', 'bonus', 'count', 'dice', 'faces',
  'kind', 'ordinal', 'outcome', 'target', 'targetId', 'targetKind',
  'targetName', 'total',
].sort();
const OUTCOMES = {
  initiative: new Set(['rolled']),
  attack: new Set(['hit', 'miss', 'critical']),
  save: new Set(['save', 'fail']),
  damage: new Set(['damage', 'halved', 'negated']),
  healing: new Set(['healed']),
  autohit: new Set(['autohit']),
  sneak: new Set(['damage']),
  'death-save': new Set(['success', 'failure', 'stable', 'dead', 'revived']),
};

/** @description Recognize an ordinary JSON object without arrays. */
function objectValue(value) {
  return !!(value && typeof value === 'object' && !Array.isArray(value));
}

/** @description Compare small sorted key lists without prototype-sensitive reads. */
function exactKeys(value, expected) {
  return objectValue(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

/** @description Accept bounded display identifiers without control characters. */
function boundedText(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

/** @description Accept a nullable bounded display identifier. */
function nullableText(value, maximum) {
  return value === null || boundedText(value, maximum);
}

/** @description Parse and validate one concrete dice notation. */
function diceDefinition(notation) {
  const match = /^(\d{1,2})d(\d{1,3})$/.exec(notation);
  if (!match) return null;
  const count = Number(match[1]), size = Number(match[2]);
  if (count > 20 || (count === 0 ? size !== 0 : size < 2 || size > 100)) return null;
  return { count, size };
}

/** @description Verify exact die faces and arithmetic for one roll group. */
function rollMathValid(value) {
  const dice = diceDefinition(value.dice);
  if (!dice || !Array.isArray(value.faces) || value.faces.length !== dice.count) return false;
  if (!value.faces.every((face) => Number.isInteger(face) && face >= 1 && face <= dice.size)) return false;
  if (!Number.isInteger(value.bonus) || value.bonus < -100 || value.bonus > 100) return false;
  if (!Number.isInteger(value.total) || value.total < -100 || value.total > 10000) return false;
  return value.total === value.faces.reduce((sum, face) => sum + face, value.bonus);
}

/** @description Verify target and ordering fields shared by all roll groups. */
function rollContextValid(value) {
  const pairedTarget = value.targetId === null && value.targetName === null
    || boundedText(value.targetId, 120) && boundedText(value.targetName, 120);
  const threshold = value.targetKind === null && value.target === null
    || ['ac', 'dc'].includes(value.targetKind) && Number.isInteger(value.target)
      && value.target >= 1 && value.target <= 100;
  return pairedTarget && threshold && nullableText(value.actionName, 120)
    && Number.isInteger(value.ordinal) && Number.isInteger(value.count)
    && value.ordinal >= 1 && value.count >= value.ordinal && value.count <= MAX_ROLLS;
}

/** @description Enforce per-kind outcomes and d20 semantics. */
function rollKindValid(value) {
  const outcomes = OUTCOMES[value.kind];
  if (!outcomes || !outcomes.has(value.outcome)) return false;
  if (['initiative', 'attack', 'save', 'death-save'].includes(value.kind)) {
    if (value.dice !== '1d20' || value.faces.length !== 1) return false;
  }
  if (value.kind === 'initiative') return value.actionName === null && value.targetId === null && value.targetKind === null;
  if (value.kind === 'death-save') return value.actionName === null && value.targetId === null && value.targetKind === 'dc' && value.target === 10;
  if (['attack', 'save'].includes(value.kind) && value.targetKind === null) return false;
  return !['attack', 'save', 'damage', 'healing', 'autohit', 'sneak'].includes(value.kind)
    || value.actionName !== null && value.targetId !== null;
}

/**
 * @description Canonicalize one exact roll group or reject it.
 * @param {*} value - Untrusted roll object.
 * @returns {object|null} A detached canonical roll, or null when invalid.
 */
function normalizeRoll(value) {
  if (!exactKeys(value, ROLL_KEYS)) return null;
  if (!boundedText(value.actorId, 120) || !boundedText(value.actorName, 120)) return null;
  if (!rollMathValid(value) || !rollContextValid(value) || !rollKindValid(value)) return null;
  return {
    kind: value.kind, actorId: value.actorId, actorName: value.actorName,
    targetId: value.targetId, targetName: value.targetName,
    actionName: value.actionName, dice: value.dice, faces: value.faces.slice(),
    bonus: value.bonus, total: value.total, targetKind: value.targetKind,
    target: value.target, outcome: value.outcome,
    ordinal: value.ordinal, count: value.count,
  };
}

/**
 * @description Canonicalize one v1 roll event while enforcing size and count bounds.
 * @param {*} value - Untrusted versioned event payload.
 * @returns {object|null} Detached canonical payload, or null when invalid.
 */
function normalizeRollPayload(value) {
  if (!exactKeys(value, ['eventId', 'rolls', 'v'])) return null;
  if (value.v !== 1 || !boundedText(value.eventId, 160)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.eventId)) return null;
  if (!Array.isArray(value.rolls) || !value.rolls.length || value.rolls.length > MAX_ROLLS) return null;
  let encoded;
  try { encoded = JSON.stringify(value); } catch (_error) { return null; }
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_EVENT_LENGTH) return null;
  const rolls = value.rolls.map(normalizeRoll);
  return rolls.every(Boolean) ? { v: 1, eventId: value.eventId, rolls } : null;
}

/**
 * @description Test whether a value is an accepted versioned combat-roll event.
 * @param {*} value - Candidate event payload.
 * @returns {boolean} True only when normalization succeeds.
 */
function isRollPayload(value) {
  return !!normalizeRollPayload(value);
}

module.exports = { MAX_EVENT_LENGTH, MAX_ROLLS, normalizeRoll, normalizeRollPayload, isRollPayload };
