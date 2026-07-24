/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 17:37:06 | roger.murphy@emeraldcoastsystemsgroup.com  | Validate player-owned board transitions against turn structure, terrain, ranges, resources, and effect bounds; strip transient renderer fields.
 * 2026-07-21 18:45:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Validate canonical PC downed/stable/death-save transitions and keep final or legacy-dead heroes out of initiative and healing.
 * 2026-07-21 18:59:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Persist the public Stay Here position marker through claimed-player turn validation.
 * 2026-07-21 19:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Validate durable narration results, defeat transitions, fresh-turn cleanup, and owner-only encounter outcome markers.
 * 2026-07-21 20:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Fence AI Companion movement narration with a validated durable movement-result lease.
 * 2026-07-21 20:04:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Decompose claimed-player effect validation into movement, action, completion, and outcome checks so each guard remains independently reviewable and below the function-size limit.
 * 2026-07-21 21:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Accept only bounded immutable v1 roll events on durable turn results so retries and narration handoffs cannot rewrite authoritative dice.
 * 2026-07-21 22:04:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Enforce durable opening and rewind presentation gates before ordinary setup and combat authorization.
 * 2026-07-21 22:13:13 | roger.murphy@emeraldcoastsystemsgroup.com  | Reject a host's setup-to-combat write while any joined participant is still choosing a hero.
 * 2026-07-21 22:57:10 | roger.murphy@emeraldcoastsystemsgroup.com  | Reject a newly resolved action coalesced with initiative advancement until its proposed result narration is complete.
 * 2026-07-21 23:05:03 | roger.murphy@emeraldcoastsystemsgroup.com  | Fence host-driven NPC initiative advancement behind completed movement and action phases without blocking exact no-op skips.
 * 2026-07-22 00:33:17 | roger.murphy@emeraldcoastsystemsgroup.com  | Make automated position, target, rolled result, narration, and advance writes server-authoritative; require explicit persisted no-action results and exact actor ownership.
 * 2026-07-22 21:59:59 | roger.murphy@emeraldcoastsystemsgroup.com  | Allow a completed automated turn to clear its persisted target after that action defeated the target.
 * 2026-07-23 00:49:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Permit a claimed hero to spend its action at the current square before movement, then spend remaining movement afterward.
 * 2026-07-23 13:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep both combat and investigation openings in the shared lobby until every joined player has claimed a hero.
 * 2026-07-23 13:25:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Restrict a setup-to-investigation write to an empty clue ledger and the unchanged authored board.
 * 2026-07-23 13:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Delegate setup authorization to a focused guard so this rules boundary remains below the executable-line threshold.
 */

'use strict';

const ENG = require('../ui/engine.js');
const { normalizeRollPayload } = require('./dnd-roll-payload');
const { presentationGateDecision } = require('./dnd-presentation-gate');
const { setupWriteDecision } = require('./dnd-setup-guard');

const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (x, y) => `${x},${y}`;
const failure = (error) => ({ ok: false, code: 'STATE_FORBIDDEN', error });
const PC_LIFE_KEYS = ['hp', 'dead', 'downed', 'stable', 'deathSaves'];
const INIT_KEYS = ['acted', 'moved', 'positionSet', 'moveRemaining', 'turnSerial'];
const TURN_KEYS = INIT_KEYS.concat('turnResult', 'movementResult');
const TELEGRAPH_KEYS = ['actionId', 'actionName', 'actorId', 'lease', 'leaseAt', 'targetId', 'turnSerial'].sort();

/** @description True only for a conscious, positive-HP PC death-save reset. */
function deathSavesCleared(token) {
  return !Object.prototype.hasOwnProperty.call(token || {}, 'deathSaves');
}

/** @description Read and bounds-check canonical death-save counters. */
function deathSaveRecord(token, allowInitial) {
  const saves = token && token.deathSaves;
  if (!saves || typeof saves !== 'object' || Array.isArray(saves)) return null;
  const successes = saves.successes, failures = saves.failures;
  if (!Number.isInteger(successes) || !Number.isInteger(failures) || successes < 0 || successes > 3 || failures < 0 || failures > 3) return null;
  const keys = Object.keys(saves).sort();
  const initial = keys.length === 2 && keys[0] === 'failures' && keys[1] === 'successes';
  if (allowInitial && initial) return { successes, failures, lastRoll: null, turnSerial: null, initial: true };
  if (!same(keys, ['failures', 'lastRoll', 'successes', 'turnSerial'])) return null;
  const lastRoll = saves.lastRoll, turnSerial = saves.turnSerial;
  if (!Number.isInteger(lastRoll) || lastRoll < 1 || lastRoll > 20 || !Number.isInteger(turnSerial) || turnSerial < 1) return null;
  return { successes, failures, lastRoll, turnSerial, initial: false };
}

/** @description Validate the durable client lease that keeps a confirmed player
 * action locked until its exact result has finished narrating. */
function turnResultRecord(value, serial) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  const baseKeys = ['complete', 'lease', 'leaseAt', 'serial', 'text'];
  const allowed = baseKeys.concat('downedTargetId', 'lead', 'rollEvent');
  if (!baseKeys.every((key) => keys.includes(key)) || keys.some((key) => !allowed.includes(key))) return null;
  if (Number(value.serial) !== Number(serial) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 2000) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'lead') && (typeof value.lead !== 'string' || !value.lead.trim() || value.lead.length > 2000)) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'rollEvent') && !normalizeRollPayload(value.rollEvent)) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'downedTargetId') && value.downedTargetId !== null && (typeof value.downedTargetId !== 'string' || !value.downedTargetId || value.downedTargetId.length > 120)) return null;
  if (typeof value.lease !== 'string' || !value.lease || value.lease.length > 160 || !Number.isFinite(Number(value.leaseAt))) return null;
  if (typeof value.complete !== 'boolean') return null;
  return value;
}

/** @description A narration-only save may renew/take over the lease and move
 * incomplete -> complete, but it cannot rewrite the confirmed tactical text. */
function turnResultTransition(before, after, serial) {
  const oldResult = turnResultRecord(before, serial), nextResult = turnResultRecord(after, serial);
  return !!(oldResult && nextResult && oldResult.text === nextResult.text &&
    oldResult.lead === nextResult.lead &&
    oldResult.downedTargetId === nextResult.downedTargetId &&
    same(oldResult.rollEvent, nextResult.rollEvent) &&
    !oldResult.complete &&
    Number(nextResult.leaseAt) >= Number(oldResult.leaseAt));
}

/** @description Validate the durable, structured description of one automated
 * movement phase. Coordinates and distance let the server tie the narration
 * marker to the exact legal movement that was committed with it. */
function movementResultRecord(value, serial) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  const expected = ['complete', 'feet', 'fromX', 'fromY', 'lease', 'leaseAt', 'serial', 'text', 'toX', 'toY'].sort();
  if (!same(keys, expected)) return null;
  if (Number(value.serial) !== Number(serial) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 2000) return null;
  if (typeof value.lease !== 'string' || !value.lease || value.lease.length > 160 || !Number.isFinite(Number(value.leaseAt))) return null;
  if (typeof value.complete !== 'boolean' || !Number.isFinite(Number(value.feet)) || Number(value.feet) < 0) return null;
  if (![value.fromX, value.fromY, value.toX, value.toY].every(Number.isInteger)) return null;
  return value;
}

/** @description A movement narration save may only renew/take over its lease
 * or finish; its already-confirmed path and wording are immutable. */
function movementResultTransition(before, after, serial) {
  const oldResult = movementResultRecord(before, serial), nextResult = movementResultRecord(after, serial);
  return !!(oldResult && nextResult && !oldResult.complete &&
    oldResult.text === nextResult.text && Number(oldResult.feet) === Number(nextResult.feet) &&
    oldResult.fromX === nextResult.fromX && oldResult.fromY === nextResult.fromY &&
    oldResult.toX === nextResult.toX && oldResult.toY === nextResult.toY &&
    Number(nextResult.leaseAt) >= Number(oldResult.leaseAt));
}

/** @description Canonical initiative eligibility: unstable downed PCs still roll. */
function canTakeTurn(token) {
  return !!(token && !token.dead && !token.fled && !(token.kind === 'pc' && token.stable));
}

/** @description Validate a PC's mutually exclusive positive/downed/dead state. */
function pcLifeStateValid(token) {
  if (!token || token.kind !== 'pc' || !Number.isFinite(token.hp) || token.hp < 0) return false;
  if (['dead', 'downed', 'stable'].some((key) => Object.prototype.hasOwnProperty.call(token, key) && typeof token[key] !== 'boolean')) return false;
  const hp = token.hp, dead = !!token.dead, downed = !!token.downed, stable = !!token.stable;
  if (dead) {
    if (hp !== 0 || downed || stable) return false;
    // Legacy dead PCs predate deathSaves. They remain valid final casualties.
    if (!Object.prototype.hasOwnProperty.call(token, 'deathSaves')) return true;
    const saves = deathSaveRecord(token, false);
    return !!(saves && saves.failures === 3);
  }
  if (hp > 0) {
    if (downed || stable) return false;
    if (deathSavesCleared(token)) return true;
    // A natural 20 restores 1 HP at the start of the same turn. Retain its
    // serial marker so a client cannot immediately roll another death save.
    const revived = deathSaveRecord(token, false);
    return !!(revived && revived.lastRoll === 20 && revived.successes === 0 && revived.failures === 0);
  }
  if (!downed) return false;
  const saves = deathSaveRecord(token, true);
  if (!saves) return false;
  if (stable) return saves.successes === 3 && saves.failures < 3;
  return saves.successes < 3 && saves.failures < 3;
}

/** @description Final death is irreversible, including pre-canonical dead PCs. */
function finalPcUnchanged(before, after) {
  return before.kind !== 'pc' || !before.dead || same(
    PC_LIFE_KEYS.reduce((out, key) => { if (Object.prototype.hasOwnProperty.call(before, key)) out[key] = before[key]; return out; }, {}),
    PC_LIFE_KEYS.reduce((out, key) => { if (Object.prototype.hasOwnProperty.call(after, key)) out[key] = after[key]; return out; }, {})
  );
}

/** @description Return a JSON object without mutable transition keys. */
function without(value, keys) {
  const out = {};
  Object.keys(value || {}).forEach((key) => { if (!keys.includes(key)) out[key] = value[key]; });
  return out;
}

/** @description Strip client-only token animation fields before comparison. */
function tokenShape(value, keys) {
  const out = without(value, keys);
  Object.keys(out).forEach((key) => { if (key.startsWith('_')) delete out[key]; });
  return out;
}

/** @description Remove transient renderer fields before persisting board JSON. */
function stripTokenPrivateFields(state) {
  if (!state || !Array.isArray(state.tokens)) return state;
  return {
    ...state,
    tokens: state.tokens.map((token) => {
      const clean = {};
      Object.keys(token || {}).forEach((key) => { if (!key.startsWith('_')) clean[key] = token[key]; });
      return clean;
    }),
  };
}

/** @description Read the authoritative sheet for either side of combat. */
function actorSheet(rules, actor) {
  if (!actor) return {};
  return actor.kind === 'pc' ? ((rules && rules.sheets) || {})[actor.slug] || {} : ((rules && rules.monsters) || {})[actor.ref] || {};
}

/** @description Build the shared-engine world from bundled scene terrain. */
function worldFor(state, rules) {
  const scene = (rules && rules.scene) || {};
  const terrain = scene.terrain || {};
  const points = (rows) => new Set((rows || []).map((p) => keyOf(p.x, p.y)));
  return {
    grid: scene.grid || { w: 0, h: 0 },
    blockSet: points(terrain.blocking),
    diffSet: points(terrain.difficult),
    tokens: state.tokens || [],
    sheetFor(token) { return actorSheet(rules, token); },
  };
}

/** @description Validate one durable automated action-and-target declaration. */
function actionTelegraphRecord(state, value, actor, rules, serial) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!same(Object.keys(value).sort(), TELEGRAPH_KEYS)) return null;
  if (!actor || value.actorId !== actor.id || Number(value.turnSerial) !== Number(serial)) return null;
  if (typeof value.lease !== 'string' || !value.lease || value.lease.length > 160 || !Number.isFinite(Number(value.leaseAt))) return null;
  const actions = actorSheet(rules, actor).actions || [];
  const action = actions.find((candidate) => String(candidate.id || '') === value.actionId
    && candidate.name === value.actionName);
  const target = state.tokens.find((candidate) => candidate.id === value.targetId);
  if (!action || !target) return null;
  const legal = ENG.validTargets(worldFor(state, rules), actor, action)
    .some((candidate) => candidate.id === target.id);
  return legal ? { action, target, value } : null;
}

/** @description A lease handoff cannot rewrite the persisted actor/action/target. */
function actionTelegraphTransition(before, after, state, actor, rules, serial) {
  const oldCue = actionTelegraphRecord(state, before, actor, rules, serial);
  const nextCue = actionTelegraphRecord(state, after, actor, rules, serial);
  if (!oldCue || !nextCue || Number(after.leaseAt) < Number(before.leaseAt)) return false;
  return ['actorId', 'targetId', 'turnSerial', 'actionId', 'actionName'].every((key) => same(before[key], after[key]));
}

/** @description Resolve every legal effect target represented by one action cue. */
function actionRollTargets(state, actor, action, target, rules) {
  if (action.aoeShape !== 'cone') return [target];
  return ENG.coneTargets(worldFor(state, rules), actor, action, target);
}

/** @description Bind structured roll actors, targets, and thresholds to the cue. */
function actionRollRecordMatches(roll, actor, action, targets) {
  const target = targets.find((candidate) => candidate.id === (roll.kind === 'save' ? roll.actorId : roll.targetId));
  if (!target || roll.actionName !== action.name) return false;
  if (roll.kind === 'save') {
    return roll.targetId === actor.id && roll.targetKind === 'dc'
      && Number(roll.target) === Number(action.save && action.save.dc);
  }
  if (roll.actorId !== actor.id) return false;
  return roll.kind !== 'attack' || (roll.targetKind === 'ac'
    && Number(roll.target) === Number(target.ac));
}

/** @description Verify attack d20 outcomes and require damage for every hit. */
function attackRollFamilyMatches(payload, action) {
  const attacks = payload.rolls.filter((roll) => roll.kind === 'attack');
  if (!attacks.length) return false;
  const damageOrdinals = new Set(payload.rolls.filter((roll) =>
    ['damage', 'sneak'].includes(roll.kind)).map((roll) => roll.ordinal));
  return attacks.every((roll) => {
    const natural = roll.faces[0];
    const outcome = natural === 20 ? 'critical'
      : natural === 1 || roll.total < roll.target ? 'miss' : 'hit';
    return roll.bonus === Number(action.toHit || 0) && roll.outcome === outcome
      && (outcome === 'miss' ? !damageOrdinals.has(roll.ordinal)
        : damageOrdinals.has(roll.ordinal));
  });
}

/** @description Sum applied rolled effects by the combatant that receives them. */
function rolledEffectAmounts(payload) {
  const amounts = new Map();
  payload.rolls.forEach((roll) => {
    if (!['damage', 'sneak', 'autohit', 'healing'].includes(roll.kind)) return;
    const applied = roll.outcome === 'negated' ? 0
      : roll.outcome === 'halved' ? Math.floor(roll.total / 2) : roll.total;
    amounts.set(roll.targetId, (amounts.get(roll.targetId) || 0) + applied);
  });
  return amounts;
}

/** @description Tie exact rolled totals to every persisted hit-point effect. */
function rolledEffectsMatch(payload, action, changed) {
  const amounts = rolledEffectAmounts(payload), changedIds = new Set(changed.map(({ old }) => old.id));
  for (const { old, next } of changed) {
    const amount = amounts.get(old.id) || 0;
    if (action.mode === 'heal') {
      if (next.hp - old.hp !== Math.min(Number(old.maxHp) - old.hp, amount)) return false;
    } else if (old.hp > 0) {
      if (old.hp - next.hp !== Math.min(old.hp, amount)) return false;
    } else if (amount <= 0) return false;
  }
  return [...amounts].every(([id, amount]) => amount <= 0 || changedIds.has(id));
}

/** @description Bind the optional downed marker to the one newly downed hero. */
function downedTargetMarkerMatches(result, changed) {
  const downed = changed.filter(({ old, next }) => old.kind === 'pc' && old.hp > 0
    && next.hp === 0 && next.downed && !next.dead).map(({ old }) => old.id);
  const expected = downed.length === 1 ? downed[0] : null;
  return Object.prototype.hasOwnProperty.call(result, 'downedTargetId')
    ? result.downedTargetId === expected : expected === null;
}

/** @description Require the exact action's expected structured roll family. */
function actionRollEventMatches(result, state, actor, action, target, rules, changed) {
  const payload = result && normalizeRollPayload(result.rollEvent);
  if (!payload) return false;
  const targets = actionRollTargets(state, actor, action, target, rules);
  if (!targets.length || !payload.rolls.every((roll) =>
    actionRollRecordMatches(roll, actor, action, targets))) return false;
  const required = action.mode === 'heal' ? 'healing'
    : action.mode === 'autohit' ? 'autohit'
      : action.mode === 'save' ? 'save' : 'attack';
  if (!payload.rolls.some((roll) => roll.kind === required)) return false;
  if (action.mode === 'attack' && !attackRollFamilyMatches(payload, action)) return false;
  return rolledEffectsMatch(payload, action, changed || []);
}

/** @description Recognize an explicit durable pass instead of a silent skip. */
function takeNoActionResult(value, actor, serial) {
  const result = turnResultRecord(value, serial);
  return !!(result && !result.rollEvent && !result.lead
    && /\btakes no action\b/i.test(result.text)
    && String(result.text).toLowerCase().includes(String(actor.name || actor.id).toLowerCase()));
}

/** @description Recover the declared target from a claimed hero's exact rolls. */
function rolledActionTarget(state, actor, result) {
  const payload = result && normalizeRollPayload(result.rollEvent);
  if (!payload) return null;
  const ids = payload.rolls.map((roll) => roll.kind === 'save' && roll.targetId === actor.id
    ? roll.actorId : roll.actorId === actor.id ? roll.targetId : null).filter(Boolean);
  const unique = [...new Set(ids)];
  return unique.length ? state.tokens.find((token) => token.id === unique[0]) || null : null;
}

/** @description Position is a persisted prior phase, including narrated automation. */
function turnPositionComplete(token, serial, automated) {
  if (!token || Number(token.turnSerial) !== Number(serial) || !token.positionSet) return false;
  if (!automated) return true;
  const movement = movementResultRecord(token.movementResult, serial);
  return !!(movement && movement.complete && Number(movement.toX) === Number(token.x)
    && Number(movement.toY) === Number(token.y));
}

/** @description Verify one grid move is reachable and return the spent feet. */
function movementCost(state, actor, next, rules, availableFeet) {
  if (!Number.isInteger(next.x) || !Number.isInteger(next.y)) return null;
  if (actor.x === next.x && actor.y === next.y) return 0;
  const moving = { ...actor, speed: Math.max(0, Number(availableFeet) || 0) };
  const cost = ENG.computeMovementCosts(worldFor(state, rules), moving).get(keyOf(next.x, next.y));
  return cost === undefined ? null : cost * Number((((rules || {}).scene || {}).grid || {}).unitFeet || 5);
}

/** @description Max possible result of a dice object/string, optionally critting. */
function diceMax(spec, crit) {
  if (!spec) return 0;
  const dice = typeof spec === 'string' ? spec : spec.dice;
  const match = String(dice || '').match(/^(\d+)d(\d+)$/i);
  const rolled = match ? Number(match[1]) * Number(match[2]) * (crit ? 2 : 1) : 0;
  return rolled + Number(typeof spec === 'object' && spec.bonus || 0);
}

/** @description Verify an action's one permitted spell-slot change. */
function slotsMatch(action, before, after) {
  const oldSlots = before || {}, newSlots = after || {};
  const keys = new Set(Object.keys(oldSlots).concat(Object.keys(newSlots)));
  const slot = action.type === 'spell' && action.slot ? String(action.slot) : null;
  for (const key of keys) {
    const expected = Number(oldSlots[key] || 0) - (key === slot ? 1 : 0);
    if (Number(newSlots[key] || 0) !== expected || expected < 0) return false;
  }
  return !slot || Object.prototype.hasOwnProperty.call(oldSlots, slot);
}

/** @description Bound changed hit points and ensure each target is legal. */
function effectsMatch(action, beforeState, afterState, actorBefore, actorAfter, changed, rules) {
  const beforeWorld = worldFor(beforeState, rules);
  const afterWorld = worldFor({ ...afterState, tokens: beforeState.tokens.map((token) => token.id === actorBefore.id ? actorAfter : token) }, rules);
  const legal = new Set(ENG.validTargets(beforeWorld, actorBefore, action).concat(ENG.validTargets(afterWorld, actorAfter, action)).map((t) => t.id));
  if (!changed.length) return action.aoeShape === 'cone' || legal.size > 0;
  if (action.mode === 'heal') {
    const max = diceMax(action.heal, false);
    return changed.every(({ old, next }) => old.kind === actorBefore.kind && !old.dead && legal.has(old.id) &&
      next.hp > old.hp && next.hp - old.hp <= max && (next.kind !== 'pc'
        || (pcLifeStateValid(next) && deathSavesCleared(next))));
  }
  const foeKind = actorBefore.kind === 'pc' ? 'monster' : 'pc';
  const foes = changed.every(({ old, next }) => old.kind === foeKind && next.hp < old.hp);
  if (!foes) return false;
  let max = diceMax(action.damage, action.mode === 'attack') + diceMax(action.sneak, action.mode === 'attack');
  if (actorBefore.kind === 'monster' && action.mode === 'attack') {
    max *= Math.max(1, Number(action.multiattack) || 1);
  }
  if (action.mode === 'autohit') max = diceMax(action.damage, false) * Math.max(1, Number(action.darts) || 1);
  if (action.aoeShape !== 'cone' && changed.length !== 1) return false;
  if (action.aoeShape !== 'cone' && !legal.has(changed[0].old.id)) return false;
  if (action.aoeShape === 'cone' && !coneCanReach(beforeWorld, afterWorld, actorBefore, actorAfter, action, changed)) return false;
  return changed.every(({ old, next }) => old.hp - next.hp <= max);
}

/** @description Find a legal cone direction containing every damaged target. */
function coneCanReach(beforeWorld, afterWorld, beforeActor, afterActor, action, changed) {
  return [beforeWorld, afterWorld].some((world, index) => {
    const actor = index ? afterActor : beforeActor;
    for (let x = 0; x < world.grid.w; x++) for (let y = 0; y < world.grid.h; y++) {
      const ids = new Set(ENG.coneTargets(world, actor, action, { x, y }).map((t) => t.id));
      if (changed.every(({ old }) => ids.has(old.id))) return true;
    }
    return false;
  });
}

/** @description Return the exact next eligible initiative position. Stable,
 * final-dead, and fled combatants are skipped; unstable downed PCs remain. */
function nextTurn(state, proposedTokens) {
  let index = Number(state.turnIndex) + 1;
  let round = Number(state.round) || 1;
  const order = state.order || [];
  if (index >= order.length) { index = 0; round++; }
  let guard = 0;
  while (guard++ < order.length) {
    const token = proposedTokens.find((candidate) => candidate.id === order[index]);
    if (canTakeTurn(token)) break;
    index++;
    if (index >= order.length) { index = 0; round++; }
  }
  return { index, round, serial: (Number(state.turnSerial) || 1) + 1 };
}

/** @description Ensure all token identity/stat fields remain server-authoritative. */
function tokenStructureMatches(current, proposed, actorId, nextId) {
  if (!Array.isArray(proposed.tokens) || current.tokens.length !== proposed.tokens.length) return false;
  const nextById = new Map(proposed.tokens.map((token) => [token.id, token]));
  if (nextById.size !== current.tokens.length) return false;
  return current.tokens.every((token) => {
    const next = nextById.get(token.id);
    if (!next) return false;
    const mutable = ['hp', 'dead'];
    if (token.kind === 'pc') mutable.push('downed', 'stable', 'deathSaves');
    if (token.id === actorId) mutable.push('x', 'y', 'slots', 'acted', 'moved', 'positionSet', 'moveRemaining', 'turnSerial', 'turnResult', 'movementResult');
    if (token.id === actorId && token.kind === 'monster') mutable.push('fled');
    if (token.id === nextId) mutable.push('acted', 'moved', 'positionSet', 'moveRemaining', 'turnSerial');
    return same(tokenShape(token, mutable), tokenShape(next, mutable));
  });
}

/** @description Validate HP/life-state shape and collect every combat effect. */
function hpChanges(current, proposed, rules) {
  const nextById = new Map(proposed.tokens.map((token) => [token.id, token]));
  const changed = [];
  for (const old of current.tokens) {
    const next = nextById.get(old.id);
    const sheet = old.kind === 'pc' ? ((rules.sheets || {})[old.slug] || {}) : {};
    const max = Number(old.maxHp || sheet.maxHp || old.hp);
    if (!Number.isFinite(Number(next.hp)) || next.hp < 0 || next.hp > max) return null;
    if (old.kind === 'pc') {
      if (!pcLifeStateValid(next) || !finalPcUnchanged(old, next)) return null;
    } else if ((next.hp <= 0) !== !!next.dead) return null;
    const lifeChanged = old.kind === 'pc' && PC_LIFE_KEYS.some((key) => !same(old[key], next[key]));
    if (Number(next.hp) !== Number(old.hp) || !!next.dead !== !!old.dead || lifeChanged) changed.push({ old, next });
  }
  return changed;
}

/** @description True when this PC is at 0 HP and must make death saves. */
function unstableDownedPc(token) {
  return !!(token && token.kind === 'pc' && Number(token.hp) === 0 && token.downed && !token.stable && !token.dead && !token.fled && pcLifeStateValid(token));
}

/** @description A stored save serial prevents a second roll in the same turn. */
function deathSaveCompletedThisTurn(token, serial) {
  const saves = deathSaveRecord(token, false);
  return !!(saves && saves.turnSerial === Number(serial));
}

/** @description Allow only the UI's ordinary fresh-turn marker initialization. */
function deathSaveActorTurnReady(before, after, serial) {
  if (!same(before.x, after.x) || !same(before.y, after.y) || !same(before.slots || {}, after.slots || {})) return false;
  if (Number(before.turnSerial) === Number(serial)) {
    return INIT_KEYS.every((key) => same(before[key], after[key])) && same(before.movementResult, after.movementResult);
  }
  const staleMovementCleared = same(before.movementResult, after.movementResult) ||
    (!!before.movementResult && !!movementResultRecord(before.movementResult, before.movementResult.serial) && before.movementResult.complete && !after.movementResult);
  return staleMovementCleared && Number(after.turnSerial) === Number(serial) &&
    Number(after.moveRemaining) === Number(after.speed || 0) && !after.moved && !after.positionSet && !after.acted;
}

/** @description Derive the engine-authored death-save line for guard matching. */
function deathSaveResultText(before, serial, natural) {
  const copy = clone(before), result = ENG.resolveDeathSave(copy, serial, natural);
  return result && !result.blocked ? result.text : null;
}

/** @description Restrict a death-save write to the actor's life/turn markers and
 * the standard initialization markers of the exact next initiative token. */
function deathSaveTokenShapesMatch(current, proposed, actorId, nextId, outcomeWrite) {
  if (!Array.isArray(proposed.tokens) || current.tokens.length !== proposed.tokens.length) return false;
  const nextById = new Map(proposed.tokens.map((token) => [token.id, token]));
  if (nextById.size !== current.tokens.length) return false;
  return current.tokens.every((token) => {
    const next = nextById.get(token.id);
    if (!next) return false;
    if (token.id === actorId) {
      const mutable = outcomeWrite ? PC_LIFE_KEYS.concat(TURN_KEYS) : (nextId === actorId ? TURN_KEYS : []);
      return same(tokenShape(token, mutable), tokenShape(next, mutable));
    }
    if (token.id === nextId) return same(tokenShape(token, INIT_KEYS), tokenShape(next, INIT_KEYS));
    return same(tokenShape(token, []), tokenShape(next, []));
  });
}

/** @description Verify one raw d20 produces exactly the proposed canonical PC state. */
function deathSaveOutcomeMatches(before, after, serial) {
  if (!unstableDownedPc(before)) return false;
  const prior = deathSaveRecord(before, true), rolled = deathSaveRecord(after, false);
  if (!prior || !rolled || deathSaveCompletedThisTurn(before, serial) || rolled.turnSerial !== Number(serial)) return false;
  const natural = rolled.lastRoll;
  if (natural === 20) {
    return Number(after.hp) === 1 && !after.downed && !after.stable && !after.dead &&
      rolled.successes === 0 && rolled.failures === 0 && pcLifeStateValid(after);
  }
  const successes = Math.min(3, prior.successes + (natural >= 10 ? 1 : 0));
  const failures = Math.min(3, prior.failures + (natural === 1 ? 2 : natural < 10 ? 1 : 0));
  const dead = failures === 3, stable = !dead && successes === 3;
  return Number(after.hp) === 0 && !!after.dead === dead && !!after.stable === stable &&
    !!after.downed === !dead && rolled.successes === successes && rolled.failures === failures && pcLifeStateValid(after);
}

/** @description Match engine defeat: foes remain and no PC is conscious or due
 * another death save. Stable heroes remain alive, but cannot continue combat. */
function deathSaveDefeatReady(tokens) {
  const rows = Array.isArray(tokens) ? tokens : [];
  const foeRemains = rows.some((token) => token.kind === 'monster' && !token.dead && !token.fled);
  const pcCanContinue = rows.some((token) => token.kind === 'pc' && !token.dead && !token.fled &&
    ((Number(token.hp) > 0 && !token.downed && !token.stable) ||
      (Number(token.hp) === 0 && token.downed && !token.stable)));
  return foeRemains && !pcCanContinue;
}

/** @description Validate a fresh death-save outcome, optionally coalesced with
 * initiative advancement by the client's debounced persistence queue. */
function claimedPcDeathSave(current, proposed, active, advanced, nextId, serial) {
  if (proposed.mode !== 'combat' && proposed.mode !== 'defeat') return failure('A death save cannot change the encounter phase except to a final party defeat.');
  const actor = proposed.tokens.find((token) => token.id === active.id);
  if (!actor || !deathSaveTokenShapesMatch(current, proposed, active.id, nextId, true)) return failure('A death save cannot move, act, spend resources, or alter another combatant.');
  if (!deathSaveActorTurnReady(active, actor, serial)) return failure('The downed hero has an invalid turn marker.');
  if (!deathSaveOutcomeMatches(active, actor, serial)) return failure('That is not a legal death-save result for this turn.');
  const result = turnResultRecord(actor.turnResult, serial), priorResult = active.turnResult;
  const staleComplete = Number(active.turnSerial) !== Number(serial) && priorResult &&
    turnResultRecord(priorResult, priorResult.serial) && priorResult.complete;
  const expectedText = deathSaveResultText(active, serial, actor.deathSaves && actor.deathSaves.lastRoll);
  if (!result || result.complete || result.text !== expectedText || (priorResult && !staleComplete)) {
    return failure('A death save must lock its exact result for narration before initiative can continue.');
  }
  if (proposed.mode === 'defeat' && (advanced || !deathSaveDefeatReady(proposed.tokens))) return failure('Defeat requires no conscious or unstable hero able to continue.');
  if (advanced) {
    const nextById = new Map(proposed.tokens.map((token) => [token.id, token]));
    const oldNext = current.tokens.find((token) => token.id === nextId);
    if (!nextTokenReady(nextById.get(nextId), oldNext, Number(proposed.turnSerial))) return failure('The next combatant has an invalid turn marker.');
  }
  return { ok: true };
}

/** @description After a non-natural-20 save is persisted, accept only the exact
 * initiative advance. This supports narration between outcome and next turn. */
function claimedPcFinishedSaveAdvance(current, proposed, active, advanced, nextId) {
  const narrationActor = proposed.tokens.find((token) => token.id === active.id);
  const narrationOnly = !advanced && proposed.mode === 'combat' && narrationActor &&
    current.tokens.every((token) => {
      const next = proposed.tokens.find((candidate) => candidate.id === token.id);
      return !!next && (token.id === active.id
        ? same(tokenShape(token, ['turnResult']), tokenShape(next, ['turnResult']))
        : same(tokenShape(token, []), tokenShape(next, [])));
    }) && turnResultTransition(active.turnResult, narrationActor.turnResult, Number(current.turnSerial));
  if (narrationOnly) return { ok: true };
  const finalResult = turnResultRecord(active.turnResult, Number(current.turnSerial));
  const legacyFinal = active.dead && !active.deathSaves && !active.turnResult;
  if (!legacyFinal && (!finalResult || !finalResult.complete)) return failure('Finish the confirmed death-save narration before initiative or defeat can continue.');
  const resolvingDefeat = !advanced && proposed.mode === 'defeat' && deathSaveDefeatReady(proposed.tokens);
  if (!resolvingDefeat && (!advanced || proposed.mode !== 'combat')) return failure('This downed, stable, or dead hero must advance to the next eligible combatant.');
  if (!deathSaveTokenShapesMatch(current, proposed, active.id, nextId, false)) return failure('A completed death save cannot be changed or used to move or act.');
  const actor = proposed.tokens.find((token) => token.id === active.id);
  if (!actor || PC_LIFE_KEYS.concat(TURN_KEYS).some((key) => !same(active[key], actor[key]))) return failure('A completed death-save result is final for this turn.');
  if (resolvingDefeat) return { ok: true };
  const nextById = new Map(proposed.tokens.map((token) => [token.id, token]));
  const oldNext = current.tokens.find((token) => token.id === nextId);
  if (!nextTokenReady(nextById.get(nextId), oldNext, Number(proposed.turnSerial))) return failure('The next combatant has an invalid turn marker.');
  return { ok: true };
}

/** @description Validate one active-PC movement/action/end-turn transition. */
function claimedPcTurn(current, proposed, active, rules, automatedCompanion) {
  if (same(current, proposed)) return { ok: true };
  const baseSerial = Number(current.turnSerial) || 1;
  const advanced = Number(proposed.turnIndex) !== Number(current.turnIndex) || Number(proposed.round) !== Number(current.round) || Number(proposed.turnSerial) === baseSerial + 1;
  const expected = nextTurn(current, proposed.tokens || []);
  const nextId = advanced ? current.order[expected.index] : null;
  const boardKeys = ['tokens', 'mode', 'round', 'turnIndex', 'turnSerial'];
  if (automatedCompanion) boardKeys.push('telegraph');
  if (!same(without(current, boardKeys), without(proposed, boardKeys))) return failure('Board identity and initiative order cannot change during a combatant turn.');
  if (proposed.mode !== 'combat' && proposed.mode !== 'resolved' && proposed.mode !== 'defeat') return failure('A hero turn cannot change the encounter phase.');
  if (proposed.mode === 'resolved' && advanced) return failure('Resolve victory before advancing initiative.');
  if (advanced && (proposed.mode !== 'combat' || Number(proposed.turnIndex) !== expected.index || Number(proposed.round) !== expected.round || Number(proposed.turnSerial) !== expected.serial)) return failure('Initiative may advance only to the next eligible combatant.');
  if (!advanced && (Number(proposed.turnIndex) !== Number(current.turnIndex) || Number(proposed.round) !== Number(current.round) || Number(proposed.turnSerial) !== baseSerial)) return failure('Round and turn counters are server-authoritative.');
  if (!tokenStructureMatches(current, proposed, active.id, nextId)) return failure('The active combatant cannot alter other positions or combat statistics.');
  if (unstableDownedPc(active) && !deathSaveCompletedThisTurn(active, baseSerial)) {
    return claimedPcDeathSave(current, proposed, active, advanced, nextId, baseSerial);
  }
  if (deathSaveCompletedThisTurn(active, baseSerial) && active.turnResult && !active.turnResult.complete) {
    return claimedPcFinishedSaveAdvance(current, proposed, active, advanced, nextId);
  }
  if (active.dead || active.stable || (unstableDownedPc(active) && deathSaveCompletedThisTurn(active, baseSerial))) {
    return claimedPcFinishedSaveAdvance(current, proposed, active, advanced, nextId);
  }
  return claimedPcEffects(current, proposed, active, rules, advanced ? nextId : null, baseSerial, automatedCompanion);
}

/** @description Build the immutable facts shared by claimed-player effect checks. */
function claimedPcEffectContext(current, proposed, active, rules, nextId, serial, automatedCompanion) {
  const nextById = new Map(proposed.tokens.map((token) => [token.id, token]));
  const actor = nextById.get(active.id);
  const fresh = Number(active.turnSerial) !== serial;
  const baseSpeed = Number(active.speed || actorSheet(rules, active).speed || 0);
  const available = fresh ? baseSpeed : Number.isFinite(Number(active.moveRemaining))
    ? Number(active.moveRemaining) : Number(active.speed || 0);
  const spent = movementCost(current, active, actor, rules, available);
  const wrongMovement = spent === null
    || Number(actor.moveRemaining) !== Math.max(0, available - spent)
    || !!actor.moved !== (available - spent < Number(active.speed || available));
  if (wrongMovement) return { decision: failure('That destination is not reachable with the hero’s remaining movement.') };
  if (Number(actor.turnSerial) !== serial) return { decision: failure('The active hero has an invalid turn marker.') };
  const changed = hpChanges(current, proposed, rules);
  if (!changed) return { decision: failure('Hit points and defeated markers must stay within their legal bounds.') };
  const actedBefore = fresh ? false : !!active.acted;
  const actedNow = !!actor.acted;
  const slotsChanged = !same(active.slots || {}, actor.slots || {});
  const resultChanged = !same(active.turnResult, actor.turnResult);
  const freshResultReset = !!(fresh && active.turnResult
    && turnResultRecord(active.turnResult, active.turnResult.serial)
    && active.turnResult.complete && !actor.turnResult);
  const movementResultChanged = !same(active.movementResult, actor.movementResult);
  const priorMovement = active.movementResult
    && movementResultRecord(active.movementResult, active.movementResult.serial);
  const currentMovement = actor.movementResult && movementResultRecord(actor.movementResult, serial);
  const freshMovementReset = !!(fresh && priorMovement && priorMovement.complete && !actor.movementResult);
  const actionAttempt = !!(changed.length || slotsChanged || actedNow !== actedBefore);
  const telegraphChanged = !same(current.telegraph, proposed.telegraph);
  const priorTelegraph = actionTelegraphRecord(current, current.telegraph, active, rules, serial);
  const nextTelegraph = actionTelegraphRecord(current, proposed.telegraph, active, rules, serial);
  return {
    current, proposed, active, rules, nextId, serial, automatedCompanion,
    nextById, actor, fresh, spent, changed, actedBefore, actedNow, slotsChanged,
    resultChanged, freshResultReset, movementResultChanged, priorMovement,
    currentMovement, freshMovementReset, actionAttempt, telegraphChanged,
    priorTelegraph, nextTelegraph,
    pendingMovement: !!(currentMovement && !currentMovement.complete),
  };
}

/** @description Validate creation or completion of an AI movement narration lease. */
function movementNarrationDecision(context) {
  if (!context.movementResultChanged) return null;
  const narrationOnly = same(
    tokenShape(context.active, ['movementResult']), tokenShape(context.actor, ['movementResult']),
  ) && !context.changed.length && !context.slotsChanged && !context.nextId
    && context.proposed.mode === 'combat';
  if (context.priorMovement && Number(context.priorMovement.serial) === context.serial
      && !context.priorMovement.complete) {
    const valid = context.automatedCompanion && narrationOnly && movementResultTransition(
      context.active.movementResult, context.actor.movementResult, context.serial,
    );
    return valid ? { ok: true }
      : failure('A confirmed AI movement may only finish its own narration lease.');
  }
  const movement = context.currentMovement;
  const exact = !!(context.automatedCompanion && movement && !movement.complete
    && Number(movement.fromX) === Number(context.active.x)
    && Number(movement.fromY) === Number(context.active.y)
    && Number(movement.toX) === Number(context.actor.x)
    && Number(movement.toY) === Number(context.actor.y)
    && Number(movement.feet) === Number(context.spent)
    && context.actor.positionSet && !context.actedNow && !context.changed.length
    && !context.slotsChanged && (!context.priorMovement || (context.fresh
      && context.priorMovement.complete && Number(context.priorMovement.serial) !== context.serial)));
  return !exact && !context.freshMovementReset
    ? failure('Only an unclaimed AI Companion may create an exact pending movement narration marker.')
    : null;
}

/** @description Fence automated action/target selection into its own board write. */
function automatedTelegraphDecision(context) {
  if (!context.automatedCompanion) return context.telegraphChanged
    ? failure('Only an automated combatant may persist an action target on this turn.') : null;
  if (!context.telegraphChanged) return null;
  const stageOnly = !context.nextId && context.proposed.mode === 'combat'
    && same(context.current.tokens, context.proposed.tokens);
  const positionReady = turnPositionComplete(context.active, context.serial, true)
    && !context.active.acted;
  if (stageOnly && positionReady && !context.current.telegraph && context.nextTelegraph) {
    return { ok: true };
  }
  if (stageOnly && positionReady && actionTelegraphTransition(
    context.current.telegraph, context.proposed.telegraph, context.current,
    context.active, context.rules, context.serial,
  )) return { ok: true };
  const finished = turnResultRecord(context.active.turnResult, context.serial);
  const storedCue = context.current.telegraph;
  const ownedCue = storedCue && storedCue.actorId === context.active.id
    && Number(storedCue.turnSerial) === Number(context.serial);
  const clearingAfter = ownedCue && !context.proposed.telegraph
    && finished && finished.complete && (context.nextId || context.proposed.mode !== 'combat');
  return clearingAfter ? null
    : failure('The automated action target must be persisted unchanged between position and advance.');
}

/** @description Validate the only legal mutation after an action awaits narration. */
function actionNarrationDecision(context) {
  if (!context.actedBefore || !context.resultChanged) return null;
  const narrationOnly = same(
    tokenShape(context.active, ['turnResult']), tokenShape(context.actor, ['turnResult']),
  ) && !context.changed.length && !context.slotsChanged && !context.nextId
    && context.proposed.mode === 'combat';
  const valid = narrationOnly && turnResultTransition(
    context.active.turnResult, context.actor.turnResult, context.serial,
  );
  return valid ? { ok: true }
    : failure('A confirmed action may only finish its own narration lease.');
}

/** @description Keep position and movement immutable once action resolution starts. */
function actionPositionUnchanged(context) {
  const keys = ['x', 'y', 'moved', 'moveRemaining', 'turnSerial', 'movementResult'];
  return keys.every((key) => same(context.active[key], context.actor[key]));
}

/** @description Match one legal action, exact target declaration, and roll event. */
function legalActionChoice(context, result) {
  const cue = context.automatedCompanion ? context.priorTelegraph : null;
  if (context.automatedCompanion && (!cue || !context.nextTelegraph)) return null;
  const target = cue ? cue.target : rolledActionTarget(context.current, context.active, result);
  const actions = cue ? [cue.action] : (actorSheet(context.rules, context.active).actions || []);
  if (!target) return null;
  return actions.find((action) => slotsMatch(
    action, context.active.slots, context.actor.slots,
  ) && effectsMatch(
    action, context.current, context.proposed, context.active,
    context.actor, context.changed, context.rules,
  ) && actionRollEventMatches(
    result, context.current, context.active, action, target, context.rules,
    context.changed,
  ) && downedTargetMarkerMatches(result, context.changed)) || null;
}

/** @description Allow only a routing goblin at the east exit to mark itself fled. */
function legalFleeTransition(context) {
  const grid = ((context.rules.scene || {}).grid || {});
  return context.active.kind === 'monster' && context.active.ref === 'goblin' && !context.active.fled
    && context.actor.fled === true && Number(context.active.x) === Number(grid.w) - 1
    && ENG.goblinsShouldFlee(worldFor(context.current, context.rules));
}

/** @description Validate a no-effect choice as an explicit persisted pass. */
function explicitPassDecision(context, result) {
  if (!takeNoActionResult(result, context.active, context.serial)) return null;
  const fledChanged = !same(context.active.fled, context.actor.fled);
  if (context.changed.length || context.slotsChanged || !context.actedNow
      || result.complete || !actionPositionUnchanged(context)
      || (fledChanged && !legalFleeTransition(context))) {
    return failure('Take No Action must persist an untouched pending result after position.');
  }
  return { ok: true };
}

/** @description Validate action timing, resources, effects, and narration-lock creation. */
function actionAttemptDecision(context) {
  if (context.pendingMovement && context.actionAttempt) return failure('Finish position narration before taking an action.');
  if (context.actedBefore && context.actionAttempt) return failure('That combatant has already used an action this turn.');
  if (!context.actionAttempt && context.actedNow !== context.actedBefore) return failure('The action marker is invalid.');
  if (!context.actionAttempt) return null;
  if (!turnPositionComplete(context.actor, context.serial, context.automatedCompanion)
      || !actionPositionUnchanged(context)) return failure('Persist position before choosing an action or Take No Action.');
  const result = turnResultRecord(context.actor.turnResult, context.serial);
  if (!result || !context.actedNow || result.complete) {
    return failure('Those targets, effects, resources, or narration lock do not match a legal action.');
  }
  const pass = explicitPassDecision(context, result);
  if (pass) return pass.ok ? null : pass;
  if (!legalActionChoice(context, result)) return failure('The persisted target, rolls, effects, and resources do not match a legal action.');
  return null;
}

/** @description Reject state mutations that are not backed by a legal action or movement lease. */
function idleEffectDecision(context) {
  if (!context.actionAttempt && context.resultChanged && !context.freshResultReset) {
    return failure('A result cannot change without a legal action, fresh-turn reset, or narration completion.');
  }
  const movedCompanion = context.spent > 0
    || (!!context.actor.positionSet && (context.fresh || !context.active.positionSet));
  if (context.automatedCompanion && !context.actionAttempt && !context.movementResultChanged
      && movedCompanion && !context.currentMovement) {
    return failure('AI Companion movement must include its pending narration marker.');
  }
  const resourceChange = !same(context.active.slots || {}, context.actor.slots || {})
    || context.changed.length;
  return !context.actionAttempt && resourceChange
    ? failure('Combat resources cannot change without an action.')
    : null;
}

/** @description Validate ending the turn and declaring the encounter resolved. */
function turnCompletionDecision(context) {
  if (context.nextId && context.pendingMovement) {
    return failure('Finish the AI Companion movement narration before ending this turn.');
  }
  const finalResult = turnResultRecord(context.active.turnResult, context.serial);
  if (context.nextId && (!turnPositionComplete(
    context.active, context.serial, context.automatedCompanion,
  ) || !context.active.acted || !finalResult || !finalResult.complete)) {
    return failure('Persist position, action or Take No Action, and the completed result before advancing.');
  }
  if (context.nextId && context.automatedCompanion && context.proposed.telegraph) {
    return failure('Clear the completed automated target only while advancing initiative.');
  }
  const next = context.nextById.get(context.nextId);
  const oldNext = context.current.tokens.find((token) => token.id === context.nextId);
  if (context.nextId && !nextTokenReady(next, oldNext, Number(context.proposed.turnSerial))) {
    return failure('The next combatant has an invalid turn marker.');
  }
  const livingMonsters = context.proposed.tokens.some((token) => token.kind === 'monster'
    && !token.dead && !token.fled);
  const livingPcs = context.proposed.tokens.some((token) => token.kind === 'pc'
    && !token.dead && !token.fled);
  if (context.proposed.mode === context.current.mode) return null;
  const separateOutcome = same(context.current.tokens, context.proposed.tokens)
    && !context.nextId && context.active.acted && finalResult && finalResult.complete;
  if (!separateOutcome) return failure('Finish and persist the exact result before changing encounter outcome.');
  if (context.proposed.mode === 'resolved') return livingMonsters || !livingPcs
    ? failure('Victory requires every foe defeated or fled.') : null;
  if (context.proposed.mode === 'defeat') return ENG.checkEnd(worldFor(context.proposed, context.rules)) === 'defeat'
    ? null : failure('Defeat requires no conscious or unstable hero able to continue.');
  return failure('This turn cannot change the encounter outcome.');
}

/** @description Validate movement, resources, action effects, and victory. */
function claimedPcEffects(current, proposed, active, rules, nextId, serial, automatedCompanion) {
  if (proposed.mode === 'defeat' && active.kind === 'pc') return failure('A conscious hero action cannot declare party defeat.');
  const context = claimedPcEffectContext(
    current, proposed, active, rules, nextId, serial, automatedCompanion,
  );
  if (context.decision) return context.decision;
  const telegraph = automatedTelegraphDecision(context);
  if (telegraph) return telegraph;
  const movement = movementNarrationDecision(context);
  if (movement) return movement;
  const narration = actionNarrationDecision(context);
  if (narration) return narration;
  const action = actionAttemptDecision(context);
  if (action) return action;
  const idle = idleEffectDecision(context);
  if (idle) return idle;
  const completion = turnCompletionDecision(context);
  if (completion) return completion;
  return { ok: true };
}

/** @description Accept only the UI's exact next-turn initialization. */
function nextTokenReady(next, old, serial) {
  if (!next || !old) return false;
  const changed = ['acted', 'moved', 'positionSet', 'moveRemaining', 'turnSerial'].some((key) => !same(old[key], next[key]));
  if (!changed) return true;
  return Number(next.turnSerial) === serial && Number(next.moveRemaining) === Number(next.speed || 0) && !next.moved && !next.positionSet && !next.acted;
}

/** @description Permit a player outside combat to move only one legal claimed PC. */
function claimedPcOnlyMove(current, proposed, slug, rules) {
  if (!slug || !current || !proposed || !Array.isArray(current.tokens) || !Array.isArray(proposed.tokens)) return false;
  if (!same(without(current, ['tokens']), without(proposed, ['tokens'])) || current.tokens.length !== proposed.tokens.length) return false;
  const nextById = new Map(proposed.tokens.map((token) => [token.id, token]));
  let found = false;
  for (const token of current.tokens) {
    const next = nextById.get(token.id);
    if (!next) return false;
    if (token.kind === 'pc' && token.slug === slug) {
      found = true;
      if (!same(tokenShape(token, ['x', 'y']), tokenShape(next, ['x', 'y']))) return false;
      if (movementCost(current, token, next, rules, Number(token.speed || ((rules.sheets || {})[slug] || {}).speed || 0) * 8) === null) return false;
    } else if (!same(tokenShape(token, []), tokenShape(next, []))) return false;
  }
  return found;
}

/** @description Accept one immutable host-owned victory/defeat side-effect
 * marker after the encounter mode itself has already been committed. Keeping
 * this as a second write prevents an action save from smuggling unrelated
 * top-level board changes into the final combat transition. */
function ownerOutcomeEffectsTransition(current, proposed, owner) {
  if (!owner || !current || !proposed || current.mode !== proposed.mode) return false;
  const expectedKind = current.mode === 'resolved' ? 'victory' : current.mode === 'defeat' ? 'defeat' : null;
  if (!expectedKind || current.outcomeEffects || !same(without(current, ['outcomeEffects']), without(proposed, ['outcomeEffects']))) return false;
  const marker = proposed.outcomeEffects;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false;
  if (!same(Object.keys(marker).sort(), ['claimedAt', 'kind', 'sceneId'])) return false;
  return marker.kind === expectedKind && marker.sceneId === current.sceneId &&
    Number.isFinite(Number(marker.claimedAt)) && Number(marker.claimedAt) > 0;
}

/** @description Skip only an already ineligible NPC without changing board facts. */
function inactiveNpcAdvanceDecision(current, proposed) {
  const expected = nextTurn(current, proposed.tokens || []);
  if (proposed.mode !== 'combat' || Number(proposed.turnIndex) !== expected.index
      || Number(proposed.round) !== expected.round || Number(proposed.turnSerial) !== expected.serial) {
    return failure('Inactive NPC initiative may advance only to the next eligible combatant.');
  }
  if (!same(current.tokens, proposed.tokens)) return failure('An inactive NPC cannot mutate combat state.');
  const before = without(current, ['round', 'turnIndex', 'turnSerial', 'telegraph']);
  const after = without(proposed, ['round', 'turnIndex', 'turnSerial', 'telegraph']);
  const telegraphCleared = same(current.telegraph, proposed.telegraph)
    || (!!current.telegraph && !proposed.telegraph);
  return same(before, after) && telegraphCleared ? { ok: true }
    : failure('Only the inactive NPC initiative marker may advance.');
}

/** @description Apply the same authoritative phase machine to a living NPC. */
function ownerNpcTurnDecision(current, proposed, active, rules) {
  if (!active || !proposed || !Array.isArray(proposed.tokens)) return failure('The Dungeon Master turn state is invalid.');
  if (same(current, proposed)) return { ok: true };
  const currentResult = turnResultRecord(active.turnResult, Number(current.turnSerial));
  if (!canTakeTurn(active) && !(active.acted && currentResult)) return inactiveNpcAdvanceDecision(current, proposed);
  return claimedPcTurn(current, proposed, active, rules || {}, true);
}

/** @description Decide ownership, then structurally validate untrusted PC writes. */
function stateWriteDecision(campaign, seats, sub, current, proposed, rules) {
  const owner = !!(campaign && (campaign.is_owner || campaign.user_sub === sub));
  const presentation = presentationGateDecision(current, proposed, owner);
  if (presentation) return presentation;
  if (!current || current.mode === 'setup') return setupWriteDecision(owner, seats, current, proposed);
  if (!same(current.outcomeEffects, proposed && proposed.outcomeEffects)) {
    return ownerOutcomeEffectsTransition(current, proposed, owner)
      ? { ok: true }
      : failure('Only the host may record the final encounter outcome after that outcome is saved.');
  }
  if (current.mode === 'combat') {
    const active = Array.isArray(current.tokens) && Array.isArray(current.order) ? current.tokens.find((token) => token.id === current.order[current.turnIndex]) : null;
    if (!active || active.kind !== 'pc') return owner ? ownerNpcTurnDecision(current, proposed, active, rules) : { ok: false, code: 'NOT_YOUR_TURN', error: 'The Dungeon Master is taking this turn.' };
    const claimant = (seats || []).find((seat) => seat.character_slug === active.slug);
    if (claimant ? claimant.user_sub !== sub : !owner) return { ok: false, code: 'NOT_YOUR_TURN', error: `${active.name || 'Another hero'} is taking this turn.` };
    const automatedCompanion = owner && !claimant;
    return claimedPcTurn(current, proposed, active, rules || {}, automatedCompanion);
  }
  const seat = (seats || []).find((candidate) => candidate.user_sub === sub && candidate.character_slug);
  if (seat) return claimedPcOnlyMove(current, proposed, seat.character_slug, rules || {}) ? { ok: true } : failure('You may only move your claimed hero to a legal square outside combat.');
  if (!owner) return failure('You may only move your claimed hero outside combat.');
  const unclaimed = current.tokens.filter((token) => token.kind === 'pc' && !(seats || []).some((seatRow) => seatRow.character_slug === token.slug));
  return unclaimed.some((token) => claimedPcOnlyMove(current, proposed, token.slug, rules || {})) ? { ok: true } : failure('The host may only move one unclaimed companion to a legal square.');
}

module.exports = {
  claimedPcOnlyMove, stateWriteDecision, movementCost, stripTokenPrivateFields,
  canTakeTurn, nextTurn, pcLifeStateValid, deathSaveOutcomeMatches,
  normalizeRollPayload, turnResultRecord, turnResultTransition,
};
