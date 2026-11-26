/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Validate and sanitize deeper-spellcasting token fields (concentration, conditions, reactionUsed, tempAcBonus), sphere AoE reachability, and buff/concentration action transitions for the server multiplayer guard.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve incoming property order in sanitizeConcentration and sanitizeConditionEntry so PostgreSQL JSONB sorted-key round-trips stay JSON.stringify-identical across presentation-gate and turn-guard checks.
 */

'use strict';

const ENG = require('../ui/engine.js');

const SPELLCASTING_KEYS = ['concentration', 'conditions', 'reactionUsed', 'tempAcBonus'];
const CONDITION_SET = new Set(ENG.CONDITIONS || []);
const CONCENTRATION_KEYS = new Set(['spellId', 'spellName', 'startedRound', 'targetIds']);
const CONDITION_KEYS = new Set(['id', 'sourceId', 'spellId', 'concentration', 'duration']);
const MAX_CONDITIONS = 16;

/** @description True for bounded non-empty identifiers without control characters. */
function cleanText(value, maxLen) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLen && !/[\u0000-\u001f\u007f]/.test(value);
}

/** @description Sanitize one concentration object, preserving incoming key order for JSONB parity. */
function sanitizeConcentration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!cleanText(value.spellId, 80) || !cleanText(value.spellName, 120)) return null;
  const out = {};
  for (const key of Object.keys(value)) {
    if (key === 'spellId') out.spellId = value.spellId;
    else if (key === 'spellName') out.spellName = value.spellName;
    else if (key === 'startedRound' && Number.isInteger(Number(value.startedRound)) && Number(value.startedRound) >= 1) {
      out.startedRound = Number(value.startedRound);
    } else if (key === 'targetIds' && Array.isArray(value.targetIds)) {
      out.targetIds = value.targetIds.filter((id) => cleanText(id, 120)).slice(0, 24);
    }
  }
  return out;
}

/** @description Sanitize one condition entry against the canonical allowlist, preserving key order. */
function sanitizeConditionEntry(entry) {
  if (!entry) return null;
  const raw = typeof entry === 'string' ? { id: entry } : entry;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
  if (!CONDITION_SET.has(id)) return null;
  const out = {};
  for (const key of Object.keys(raw)) {
    if (key === 'id') out.id = id;
    else if (key === 'sourceId' && cleanText(raw.sourceId, 120)) out.sourceId = raw.sourceId;
    else if (key === 'spellId' && cleanText(raw.spellId, 80)) out.spellId = raw.spellId;
    else if (key === 'concentration' && raw.concentration === true) out.concentration = true;
    else if (key === 'duration' && cleanText(raw.duration, 40)) out.duration = raw.duration;
  }
  return out;
}

/** @description Preserve valid spellcasting fields on a token without injecting absent keys. */
function sanitizeSpellcastingFields(token) {
  if (!token || typeof token !== 'object') return token;
  if (Object.prototype.hasOwnProperty.call(token, 'concentration')) {
    const clean = sanitizeConcentration(token.concentration);
    if (clean) token.concentration = clean;
    else delete token.concentration;
  }
  if (Object.prototype.hasOwnProperty.call(token, 'conditions')) {
    token.conditions = Array.isArray(token.conditions)
      ? token.conditions.map(sanitizeConditionEntry).filter(Boolean).slice(0, MAX_CONDITIONS)
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(token, 'reactionUsed')) {
    token.reactionUsed = !!token.reactionUsed;
  }
  if (Object.prototype.hasOwnProperty.call(token, 'tempAcBonus')) {
    const bonus = Math.trunc(Number(token.tempAcBonus) || 0);
    token.tempAcBonus = Math.max(0, Math.min(10, bonus));
  }
  return token;
}

/** @description Validate strict schema bounds on all proposed spellcasting token fields. */
function spellcastingStateValid(token) {
  if (!token || typeof token !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(token, 'concentration') && token.concentration !== null) {
    const c = token.concentration;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    if (Object.keys(c).some((k) => !CONCENTRATION_KEYS.has(k))) return false;
    if (!sanitizeConcentration(c)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(token, 'conditions')) {
    if (!Array.isArray(token.conditions) || token.conditions.length > MAX_CONDITIONS) return false;
    for (const item of token.conditions) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      if (Object.keys(item).some((k) => !CONDITION_KEYS.has(k))) return false;
      if (!sanitizeConditionEntry(item)) return false;
    }
  }
  if (Object.prototype.hasOwnProperty.call(token, 'reactionUsed') && typeof token.reactionUsed !== 'boolean') return false;
  if (Object.prototype.hasOwnProperty.call(token, 'tempAcBonus')) {
    if (!Number.isInteger(token.tempAcBonus) || token.tempAcBonus < 0 || token.tempAcBonus > 10) return false;
  }
  return true;
}

/** @description True when a non-actor token legally spent one spell slot on a newly used reaction. */
function reactionSlotChangeValid(before, after) {
  if (!after || !after.reactionUsed || (before && before.reactionUsed)) return false;
  const oldSlots = (before && before.slots) || {}, newSlots = after.slots || {};
  const keys = new Set(Object.keys(oldSlots).concat(Object.keys(newSlots)));
  let spent = 0;
  for (const key of keys) {
    const diff = Number(oldSlots[key] || 0) - Number(newSlots[key] || 0);
    if (diff < 0 || diff > 1 || Number(newSlots[key] || 0) < 0) return false;
    spent += diff;
  }
  return spent === 1;
}

/** @description Find a legal cone direction or in-range sphere center covering every damaged target. */
function aoeCanReach(beforeWorld, afterWorld, beforeActor, afterActor, action, changed) {
  const isSphere = action.aoeShape === 'sphere';
  return [beforeWorld, afterWorld].some((world, index) => {
    const actor = index ? afterActor : beforeActor;
    for (let x = 0; x < world.grid.w; x++) {
      for (let y = 0; y < world.grid.h; y++) {
        if (isSphere && !ENG.inRange(action, actor, { x, y })) continue;
        const list = isSphere ? ENG.sphereTargets(world, actor, action, { x, y })
          : ENG.coneTargets(world, actor, action, { x, y });
        const ids = new Set(list.map((t) => t.id));
        if (changed.every(({ old }) => ids.has(old.id))) return true;
      }
    }
    return false;
  });
}

/** @description Validate a roll-free buff spell (e.g. Bless) that spends a slot without HP deltas. */
function buffActionMatches(actions, active, actor, changed, slotsMatchFn) {
  if (changed && changed.length) return null;
  return (actions || []).find((action) => action && action.mode === 'buff'
    && slotsMatchFn(action, active.slots, actor.slots)) || null;
}

/** @description True when a structured roll record is a valid concentration save triggered during combat. */
function isConcentrationSaveRoll(roll) {
  return !!(roll && roll.kind === 'save' && roll.targetKind === 'dc'
    && /^Concentration:/i.test(String(roll.actionName || '')));
}

module.exports = {
  SPELLCASTING_KEYS,
  sanitizeSpellcastingFields,
  spellcastingStateValid,
  reactionSlotChangeValid,
  aoeCanReach,
  buffActionMatches,
  isConcentrationSaveRoll,
};
