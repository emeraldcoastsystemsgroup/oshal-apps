/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Present every exact authoritative die in event order, deduplicate persisted roll events, and keep initiative and turn progression behind the full visible queue.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Produce optional exact spoken dice, modifier, AC/DC, and outcome summaries.
 */

'use strict';

const COMBAT_ROLL_KEYS = [
  'actionName', 'actorId', 'actorName', 'bonus', 'count', 'dice', 'faces',
  'kind', 'ordinal', 'outcome', 'target', 'targetId', 'targetKind',
  'targetName', 'total',
].sort();
let combatDiceSeen = new Set(), combatDiceJobs = new Map(), combatInitiativeJobs = new Map();
let combatDiceQueue = [], combatDieActive = false, combatDiceCurrent = null, combatDiceTimer = null;

/** @description Scale visual dice pauses only while an automated actor owns the turn. */
function combatDieDelay(milliseconds) {
  const actor = board && board.mode === 'combat' ? activeToken() : null;
  return actor && (actor.kind === 'monster' || isAICompanion(actor))
    ? dmNpcPaceMs(milliseconds) : milliseconds;
}

/** @description Create a short deterministic suffix without exposing unsafe event-id characters. */
function combatEventHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** @description Normalize one readable segment used inside a stable roll-event id. */
function combatEventPart(value) {
  return String(value || 'none').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+/, '').slice(0, 24) || 'none';
}

/** @description Build a branch-aware stable id that survives retries but changes after rewind. */
function combatEventId(scope, run, actorId) {
  const gate = board && board.presentationGate;
  const branch = gate && gate.id || board && board.sceneId || 'table';
  const values = [scope, campaign && campaign.campaign_id, board && board.sceneId, branch,
    run && run.serial, actorId];
  const readable = values.map(combatEventPart).join(':');
  return `dnd:${readable}:${combatEventHash(values.join('\u0000'))}`.slice(0, 160);
}

/** @description Detach exact engine rolls before placing them in authoritative state. */
function makeCombatRollEvent(scope, run, actorId, rolls) {
  if (!Array.isArray(rolls) || !rolls.length) return null;
  return {
    v: 1,
    eventId: combatEventId(scope, run, actorId),
    rolls: JSON.parse(JSON.stringify(rolls)),
  };
}

/** @description Identify action and death-save events independently within one turn. */
function makeTurnRollEvent(run, rolls) {
  const first = Array.isArray(rolls) && rolls[0];
  const scope = first && first.kind === 'death-save' ? 'death-save' : 'action';
  return makeCombatRollEvent(scope, run, run && run.actorId, rolls);
}

/** @description Create the exact initiative event stored in the first combat board write. */
function makeInitiativeRollEvent(rolls) {
  const run = { serial: Number(board && board.turnSerial) || 1 };
  return makeCombatRollEvent('initiative', run, 'table', rolls);
}

/** @description Parse one concrete dice notation used by a structured roll group. */
function combatDiceDefinition(notation) {
  const match = /^(\d{1,2})d(\d{1,3})$/.exec(String(notation || ''));
  if (!match) return null;
  const count = Number(match[1]), sides = Number(match[2]);
  if (count > 20 || (count === 0 ? sides !== 0 : sides < 2 || sides > 100)) return null;
  return { count, sides };
}

/** @description Check the portable v1 fields and arithmetic before rendering server data. */
function structuredCombatGroup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(COMBAT_ROLL_KEYS)) return null;
  const dice = combatDiceDefinition(value.dice);
  if (!dice || !Array.isArray(value.faces) || value.faces.length !== dice.count) return null;
  if (!value.faces.every((face) => Number.isInteger(face) && face >= 1 && face <= dice.sides)) return null;
  if (!Number.isInteger(value.bonus) || !Number.isInteger(value.total)) return null;
  if (value.faces.reduce((sum, face) => sum + face, value.bonus) !== value.total) return null;
  return dice;
}

/** @description Convert exact roll groups into one visible fact per die, in stored order. */
function structuredCombatFacts(payload) {
  if (!payload || payload.v !== 1 || typeof payload.eventId !== 'string' || !Array.isArray(payload.rolls)) return [];
  const facts = [];
  for (let groupIndex = 0; groupIndex < payload.rolls.length; groupIndex++) {
    const roll = payload.rolls[groupIndex], dice = structuredCombatGroup(roll);
    if (!dice) return [];
    const faces = roll.faces.length ? roll.faces : [null];
    faces.forEach((face, faceIndex) => facts.push({
      source: 'structured', eventId: payload.eventId, groupIndex, faceIndex,
      groupCount: payload.rolls.length, dieCount: roll.faces.length,
      dieOrdinal: faceIndex + 1, sides: dice.sides, face, roll,
    }));
  }
  return facts;
}

/** @description Recover a compact legacy label only when no structured payload exists. */
function combatRollLabel(source, index) {
  const before = source.slice(0, index).trim();
  const clause = before.split(/[.!?]\s+/).pop() || '';
  return clause.replace(/[:.]$/, '').trim().split(/\s+/).slice(-7).join(' ');
}

/** @description Parse old prose archives that predate exact roll payloads. */
function combatRollFacts(text) {
  const source = String(text || '');
  const pattern = /(?:^|[:.]\s)(\d{1,2})([+-]\d+)(?:=(-?\d+))?\s+vs\s+(AC|DC)\s+(\d{1,2})/gi;
  const facts = []; let check;
  while ((check = pattern.exec(source))) {
    const tail = source.slice(pattern.lastIndex).split(/(?<=[.!?])\s/, 1)[0];
    facts.push({ label: combatRollLabel(source, check.index || 0), natural: Number(check[1]), modifier: Number(check[2]),
      total: check[3] == null ? Number(check[1]) + Number(check[2]) : Number(check[3]), targetKind: check[4].toUpperCase(), target: Number(check[5]),
      verdict: (/\b(hit|miss|fails|failure|saves|success)\b/i.exec(tail) || [,'resolved'])[1] });
  }
  if (facts.length) return facts;
  const death = source.match(/\brolls (?:a )?(?:natural )?(\d{1,2})\b[^.]*\bdeath save\s+(success|failure|stable|dead|revived)/i);
  return death ? [{ label: 'Death saving throw', natural: Number(death[1]), modifier: 0,
    total: Number(death[1]), targetKind: 'DC', target: 10, verdict: death[2] }] : [];
}

/** @description Prefer exact payloads; prose parsing is reserved for payload-absent history. */
function combatFactsFor(text, payload) {
  if (payload !== undefined && payload !== null) return structuredCombatFacts(payload);
  return combatRollFacts(text).map((fact, index, all) => ({
    source: 'legacy', groupIndex: index, faceIndex: 0, groupCount: all.length,
    dieCount: 1, dieOrdinal: 1, sides: 20, face: fact.natural, legacy: fact,
  }));
}

/** @description Turn compact dice notation into words suited to narration. */
function combatDiceWords(notation) {
  const dice = combatDiceDefinition(notation);
  if (!dice) return String(notation || 'the die');
  return dice.count === 1 ? `a d ${dice.sides}` : `${dice.count} d ${dice.sides}`;
}

/** @description Speak one authoritative roll group without parsing display prose. */
function combatRollNarration(roll) {
  const actor = String(roll.actorName || 'The combatant');
  const action = roll.actionName ? ` for ${roll.actionName}` : '';
  const targetName = String(roll.targetName || '');
  const threshold = roll.targetKind
    ? `${targetName ? `${targetName}'s ` : ''}${String(roll.targetKind).toUpperCase()} ${Number(roll.target)}`
    : targetName;
  const bonus = Number(roll.bonus) || 0;
  const faces = roll.faces.length ? roll.faces.join(' plus ') : 'zero';
  const arithmetic = `${faces}${bonus ? ` ${bonus > 0 ? 'plus' : 'minus'} ${Math.abs(bonus)}` : ''} is ${Number(roll.total)}`;
  const result = String(roll.outcome || 'resolved').replace(/-/g, ' ');
  if (roll.kind === 'damage') return `Damage rolls ${combatDiceWords(roll.dice)}. ${arithmetic}: ${result}.`;
  if (roll.kind === 'healing') return `Healing rolls ${combatDiceWords(roll.dice)}. ${arithmetic}.`;
  return `${actor} rolls ${combatDiceWords(roll.dice)}${action}${threshold ? ` against ${threshold}` : ''}. ${arithmetic}: ${result}.`;
}

/** @description Summarize every validated roll group for optional natural speech. */
function combatDiceNarration(payload) {
  if (!payload || payload.v !== 1 || !Array.isArray(payload.rolls)) return '';
  if (!payload.rolls.every((roll) => structuredCombatGroup(roll))) return '';
  return payload.rolls.map(combatRollNarration).join(' ');
}

/** @description Return a human label for the exact mechanical roll being shown. */
function combatKindLabel(fact) {
  if (fact.source === 'legacy') return fact.legacy.targetKind === 'AC' ? 'Attack roll' : 'Saving throw';
  return ({ initiative: 'Initiative', attack: 'Attack roll', save: 'Saving throw',
    damage: 'Damage roll', healing: 'Healing roll', autohit: 'Automatic-hit damage',
    sneak: 'Sneak Attack damage', 'death-save': 'Death saving throw' })[fact.roll.kind] || 'Roll';
}

/** @description Describe actor, action, target, and multi-roll position without inference. */
function combatFactTitle(fact) {
  if (fact.source === 'legacy') return fact.legacy.label || combatKindLabel(fact);
  const roll = fact.roll, action = roll.actionName ? ` uses ${roll.actionName}` : '';
  const target = roll.targetName ? ` on ${roll.targetName}` : '';
  const group = roll.count > 1 ? ` - roll ${roll.ordinal} of ${roll.count}` : '';
  if (roll.kind === 'save') {
    const source = roll.targetName ? `${roll.targetName}'s ` : '';
    return `${roll.actorName} saves against ${source}${roll.actionName || 'effect'} - Saving throw${group}`;
  }
  return `${roll.actorName}${action}${target} - ${combatKindLabel(fact)}${group}`;
}

/** @description Show current die position and its authoritative threshold or target. */
function combatFactModifier(fact) {
  if (fact.source === 'legacy') {
    const roll = fact.legacy;
    return `${roll.modifier >= 0 ? '+' : ''}${roll.modifier} - vs ${roll.targetKind} ${roll.target}`;
  }
  const roll = fact.roll, die = fact.dieCount ? `d${fact.sides} die ${fact.dieOrdinal} of ${fact.dieCount}` : 'fixed result';
  const threshold = roll.targetKind ? ` - vs ${String(roll.targetKind).toUpperCase()} ${roll.target}` : '';
  return `${die}${threshold}`;
}

/** @description Render the final group arithmetic only after its last exact face lands. */
function combatFactVerdict(fact) {
  if (fact.source === 'legacy') {
    const roll = fact.legacy;
    return `<b>${roll.natural}</b> ${roll.modifier >= 0 ? '+' : ''}${roll.modifier} = <b>${roll.total}</b> - ${esc(String(roll.verdict).toUpperCase())}`;
  }
  const roll = fact.roll, last = !fact.dieCount || fact.dieOrdinal === fact.dieCount;
  if (!last) return `<b>${fact.face}</b> rolled - ${fact.dieOrdinal} of ${fact.dieCount} dice settled`;
  const faces = roll.faces.length ? roll.faces.join(' + ') : '0';
  const bonus = roll.bonus ? ` ${roll.bonus >= 0 ? '+' : '-'} ${Math.abs(roll.bonus)}` : '';
  return `${esc(faces + bonus)} = <b>${roll.total}</b> - ${esc(String(roll.outcome).toUpperCase())}`;
}

/** @description Clear timers and remove one die surface without resolving it twice. */
function clearCombatDieTimers(item) {
  if (!item) return;
  clearInterval(item.flicker); clearTimeout(item.landTimer); clearTimeout(item.finishTimer);
  item.flicker = null; item.landTimer = null; item.finishTimer = null;
  if (item.element && item.element.isConnected) item.element.remove();
  item.element = null;
}

/** @description Resolve one queue job and retain only fully shown dice for deduplication. */
function settleCombatDie(item, status) {
  if (!item || typeof item.resolve !== 'function') return;
  if (status === 'shown') combatDiceSeen.add(item.key);
  combatDiceJobs.delete(item.key);
  const resolve = item.resolve; item.resolve = null; resolve(status);
}

/** @description Schedule another queue pass without stacking drain timers. */
function scheduleCombatDieDrain(delay) {
  clearTimeout(combatDiceTimer);
  combatDiceTimer = setTimeout(drainCombatDice, Number(delay) || 250);
}

/** @description Complete one visible die, then allow the next exact face to render. */
function finishCombatDie(element, item) {
  clearCombatDieTimers(item);
  if (element && element.isConnected) element.remove();
  settleCombatDie(item, 'shown');
  if (combatDiceCurrent !== item) return;
  combatDiceCurrent = null; combatDieActive = false;
  scheduleCombatDieDrain(combatDieDelay(180));
}

/** @description Land one authoritative face after a short cosmetic tumble. */
function landCombatDie(item, die, number, verdict) {
  const fact = item.fact, face = fact.face == null ? fact.roll.total : fact.face;
  clearInterval(item.flicker); item.flicker = null;
  die.classList.remove('tumble'); number.textContent = face;
  const naturalClass = fact.sides === 20 && face === 20 ? 'nat20' : fact.sides === 20 && face === 1 ? 'nat1' : 'landed';
  die.classList.add(naturalClass); verdict.innerHTML = combatFactVerdict(fact);
  tick(naturalClass === 'nat20' ? 880 : naturalClass === 'nat1' ? 110 : 440, .18, .06);
  item.finishTimer = setTimeout(() => finishCombatDie(item.element, item), combatDieDelay(1550));
}

/** @description Render one exact face while identifying its actor and mechanical role. */
function renderCombatDie(item) {
  const fact = item.fact, fixed = fact.face == null;
  const element = document.createElement('div'); element.className = 'dicebox combat-dice-box';
  element.innerHTML = `<div class="dice-ask">${esc(combatFactTitle(fact))} - everyone sees the same die</div><div class="die${fixed ? '' : ' tumble'}"><span class="dnum">${fixed ? fact.roll.total : fact.sides}</span></div><div class="dice-mod">${esc(combatFactModifier(fact))}</div><div class="dice-verdict"></div>`;
  item.element = element; $('stage').appendChild(element);
  const die = element.querySelector('.die'), number = element.querySelector('.dnum');
  const verdict = element.querySelector('.dice-verdict');
  if (!fixed) item.flicker = setInterval(() => {
    number.textContent = 1 + Math.floor(Math.random() * fact.sides);
    tick(280 + Math.random() * 460, .025, .025);
  }, 80);
  item.landTimer = setTimeout(
    () => landCombatDie(item, die, number, verdict),
    combatDieDelay(fixed ? 300 : 720),
  );
}

/** @description Drain exact dice serially and retry if another tabletop die owns the stage. */
function drainCombatDice() {
  combatDiceTimer = null;
  const stage = $('stage');
  if (combatDieActive && !stage.querySelector('.combat-dice-box')) {
    clearCombatDieTimers(combatDiceCurrent);
    combatDiceQueue.unshift(combatDiceCurrent); combatDiceCurrent = null; combatDieActive = false;
  }
  if (combatDieActive || stage.querySelector('.dicebox')) { scheduleCombatDieDrain(300); return; }
  const next = combatDiceQueue.shift();
  if (!next) return;
  combatDieActive = true; combatDiceCurrent = next; renderCombatDie(next);
}

/** @description Reuse an active die promise so archive echoes cannot advance early. */
function queueCombatFact(fact, key) {
  if (combatDiceSeen.has(key)) return Promise.resolve('duplicate');
  const existing = combatDiceJobs.get(key);
  if (existing) return existing.promise;
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const item = { fact, key, resolve, promise };
  combatDiceJobs.set(key, item); combatDiceQueue.push(item);
  return promise;
}

/** @description Queue every exact face and resolve only after the complete event drains. */
function presentCombatDie(text, sequence, payload) {
  const facts = combatFactsFor(text, payload);
  if (!facts.length) return Promise.resolve(payload == null ? 'no-roll' : 'invalid-roll-event');
  const localTurn = board && board.mode === 'combat' ? turnKey(activeToken()) : 'outside-combat';
  const base = payload && payload.eventId ? `event:${payload.eventId}`
    : sequence ? `archive:${Number(sequence)}` : `turn:${localTurn}:text:${String(text)}`;
  const waits = facts.map((fact, index) => queueCombatFact(fact,
    `${base}:group:${fact.groupIndex + 1}:die:${fact.faceIndex + 1}:queue:${index + 1}`));
  drainCombatDice();
  return Promise.all(waits);
}

/** @description Cancel abandoned local surfaces while allowing authoritative replay later. */
function cancelCombatDice() {
  clearTimeout(combatDiceTimer); combatDiceTimer = null;
  clearCombatDieTimers(combatDiceCurrent); settleCombatDie(combatDiceCurrent, 'cancelled'); combatDiceCurrent = null;
  combatDiceQueue.splice(0).forEach((item) => settleCombatDie(item, 'cancelled'));
  combatDieActive = false;
}

/** @description Reset dice dedupe and single-flight state when leaving a campaign. */
function resetCombatDiceMemory() {
  cancelCombatDice(); combatDiceSeen = new Set(); combatDiceJobs = new Map(); combatInitiativeJobs = new Map();
}

/** @description Summarize exact initiative totals for the story archive. */
function initiativeRollSummary(event) {
  const rolls = structuredCombatFacts(event).filter((fact) => fact.faceIndex === 0).map((fact) => fact.roll);
  return 'Initiative! ' + rolls.map((roll) => `${roll.actorName} (${roll.total})`).join(' - ');
}

/** @description Keep repeated gate reconciliations from cancelling initiative mid-roll. */
function initiativeDiceForGate(gate) {
  return !!(gate && combatInitiativeJobs.has(gate.id));
}

/** @description Present persisted initiative before an opening can narrate or unlock. */
function presentOpeningInitiative(gate, archive) {
  if (!gate || gate.kind !== 'opening' || !board || !board.initiativeRollEvent) return Promise.resolve('no-initiative');
  const existing = combatInitiativeJobs.get(gate.id);
  if (existing) return existing;
  const event = board.initiativeRollEvent, text = initiativeRollSummary(event);
  const job = Promise.resolve(archive ? recordCombat(text, event) : presentCombatDie(text, null, event))
    .finally(() => { if (combatInitiativeJobs.get(gate.id) === job) combatInitiativeJobs.delete(gate.id); });
  combatInitiativeJobs.set(gate.id, job);
  return job;
}

if (typeof module !== 'undefined') module.exports = {
  combatDiceNarration,
};
