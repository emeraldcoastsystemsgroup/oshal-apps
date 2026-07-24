/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Separate cinematic Dungeon Master combat prose from exact tactical facts and provide a deterministic fail-soft narration path.
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Silence stationary-position filler and rotate actor-specific movement and action images across turns.
 * 2026-07-22 22:58:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Add one objective-grounded story highlight per round and generated cutaway art every second round.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Generate one deduplicated combat tableau every round and an additional exact kill image when a resolved target falls.
 * 2026-07-23 00:16:04 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace metadata-like "commits to Scimitar" cues with natural weapon phrasing and classify declared melee delivery before generic attacks.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Derive optional spoken action declarations from authoritative structured outcomes.
 */

'use strict';

const combatRoundHighlights = new Set();

/** @description Return the first structured roll that identifies an action. */
function combatPrimaryRoll(outcome) {
  const rolls = outcome && outcome.rollEvent && outcome.rollEvent.rolls;
  if (!Array.isArray(rolls)) return null;
  return rolls.find((roll) => ['attack', 'save', 'autohit', 'healing', 'death-save'].includes(roll.kind))
    || rolls[0] || null;
}

/** @description Find a live board token without trusting prose labels. */
function combatToken(id) {
  return id && board && Array.isArray(board.tokens)
    ? board.tokens.find((token) => token.id === id) || null : null;
}

/** @description Prefer authoritative token labels, then bounded roll labels. */
function combatName(token, fallback) {
  if (token) return shortTokenLabel(token);
  return String(fallback || 'the combatant').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** @description Describe one saved grid displacement in screen-accurate compass terms. */
function combatMovementDirection(movement) {
  const dx = Number(movement && movement.toX) - Number(movement && movement.fromX);
  const dy = Number(movement && movement.toY) - Number(movement && movement.fromY);
  const eastWest = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
  const northSouth = dy > 0 ? 'south' : dy < 0 ? 'north' : '';
  return northSouth && eastWest ? `${northSouth}-${eastWest}` : northSouth || eastWest || '';
}

/** @description Select repeatable prose variety from actor, action, and authoritative turn. */
function combatVariant(actor, action, size) {
  const seed = `${actor && actor.id || ''}:${action || ''}:${board && board.turnSerial || 0}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = ((hash * 31) + seed.charCodeAt(index)) >>> 0;
  return size ? hash % size : 0;
}

/** @description Speak movement only when a token actually changes grid position. */
function combatMovementShouldNarrate(movement) {
  return Number(movement && movement.feet) > 0 && !!combatMovementDirection(movement);
}

/** @description Turn exact movement coordinates into a short battlefield image. */
function combatMovementNarration(actor, movement) {
  const name = combatName(actor), direction = combatMovementDirection(movement);
  if (!combatMovementShouldNarrate(movement)) return '';
  if (actor && actor.kind === 'monster') {
    const lines = [
      `${name} darts ${direction} through the confusion, hunting for a cleaner angle.`,
      `${name} slips ${direction} between roots and flying steel.`,
      `${name} scrambles ${direction}, using the roadside cover to close the gap.`,
    ];
    return lines[combatVariant(actor, direction, lines.length)];
  }
  const lines = [
    `${name} cuts ${direction} across the road, keeping low as the fight closes in.`,
    `${name} drives ${direction} through the churned mud and scattered cloth.`,
    `${name} shifts ${direction}, putting the overturned cart at a better angle.`,
  ];
  return lines[combatVariant(actor, direction, lines.length)];
}

/** @description Classify an action only to choose prose, never to resolve rules. */
function combatActionStyle(candidate) {
  const detail = candidate && typeof candidate === 'object' ? candidate : {};
  const action = String(detail.name || candidate || '').toLowerCase();
  if (detail.mode === 'heal' || detail.delivery === 'self' || /heal|cure|second wind/.test(action)) return 'healing';
  if (/bow|crossbow/.test(action)) return 'bow';
  if (/javelin|spear/.test(action)) return 'thrown';
  if (detail.delivery === 'melee' || /sword|scimitar|rapier|dagger|axe|mace|hammer|club|staff|flail|whip|bite|claw/.test(action)) return 'melee';
  if (/missile|bolt|flame|hands|spell|ray|word|wounds/.test(action)) return 'magic';
  return 'attack';
}

/** @description Turn a sheet action label into a phrase a person would naturally say aloud. */
function combatWeaponPhrase(actionName) {
  const lower = String(actionName || 'weapon').trim().toLowerCase();
  if (/\bbite\b/.test(lower)) return 'their teeth';
  if (/\bclaw/.test(lower)) return 'their claws';
  return `their ${lower}`;
}

/** @description Announce intent cinematically without reading target math aloud. */
function combatActionCueNarration(actor, target, action) {
  const name = combatName(actor), targetName = combatName(target, 'their target');
  const actionName = String(action && action.name || 'attack'), style = combatActionStyle(action);
  const weapon = combatWeaponPhrase(actionName);
  const selfTarget = !!(actor && target && actor.id && actor.id === target.id);
  const lines = {
    bow: [
      `${name} draws the string of ${actionName}, sighting down the shaft at ${targetName}.`,
      `${name} raises ${actionName} and tracks ${targetName} through the chaos.`,
      `${name} nocks an arrow and settles ${actionName} on ${targetName}.`,
    ],
    thrown: [
      `${name} draws back ${actionName}, measuring the gap to ${targetName}.`,
      `${name} weighs ${actionName} once, then fixes on ${targetName}.`,
      `${name} cocks ${actionName} over one shoulder and marks ${targetName}.`,
    ],
    melee: [
      `${name} drives in on ${targetName}, ${weapon} sweeping through the clash.`,
      `${name} closes on ${targetName} and strikes with ${weapon}.`,
      `${name} shoulders through the melee and brings ${weapon} around at ${targetName}.`,
    ],
    magic: [
      `${name} calls up ${actionName}; its power gathers around ${targetName}.`,
      `${name} traces a sharp sigil and bends ${actionName} toward ${targetName}.`,
      `${name} speaks the words of ${actionName}, locking its force onto ${targetName}.`,
    ],
    healing: selfTarget ? [
      `${name} takes one hard breath and draws on ${actionName}.`,
      `${name} steadies, forcing strength back into battered limbs with ${actionName}.`,
      `${name} resets their stance and reaches inward for ${actionName}.`,
    ] : [
      `${name} reaches for ${targetName}, gathering the warmth of ${actionName}.`,
      `${name} speaks ${actionName} over ${targetName} and presses healing power forward.`,
      `${name} turns from the melee long enough to bring ${actionName} to ${targetName}.`,
    ],
    attack: [
      `${name} turns on ${targetName} and attacks with ${actionName}.`,
      `${name} presses ${targetName}, using ${actionName} to force an opening.`,
      `${name} finds ${targetName} in the confusion and launches ${actionName}.`,
    ],
  }[style];
  return lines[combatVariant(actor, actionName, lines.length)];
}

/** @description Build one optional action declaration from the saved roll event. */
function combatOutcomeActionNarration(actor, outcome) {
  const roll = combatPrimaryRoll(outcome);
  if (!roll || roll.kind === 'death-save') return '';
  const acting = combatToken(roll.actorId) || actor;
  const target = combatToken(roll.targetId) || (roll.targetName ? { name: roll.targetName } : null);
  if (!acting || !target) return '';
  return combatActionCueNarration(acting, target, {
    name: roll.actionName || 'attack',
    mode: roll.kind === 'save' ? 'save' : 'attack',
  });
}

/** @description Vary automated turn handoffs without pretending a companion just arrived. */
function combatAutomatedTurnNarration(token) {
  const name = combatName(token), monster = token && token.kind === 'monster';
  const lines = monster ? [
    `${name} sees an opening and moves.`,
    `${name} answers the party's pressure.`,
    `${name} makes its next play.`,
  ] : [
    `${name} reads the field and takes the next move.`,
    `${name} stays with the party and acts.`,
    `${name} finds the next opening in the fight.`,
  ];
  return lines[combatVariant(token, 'turn', lines.length)];
}

/** @description Read the authoritative outcome category from structured dice. */
function combatOutcomeKind(roll) {
  const value = String(roll && (roll.outcome || roll.verdict) || '').toLowerCase();
  if (/critical/.test(value)) return 'critical';
  if (/miss|success|save/.test(value)) return value === 'success' && roll.kind === 'save' ? 'saved' : value;
  if (/hit|fail/.test(value)) return value === 'failure' && roll.kind === 'save' ? 'failed-save' : value;
  return value || 'resolved';
}

/** @description Report final target state from the board, not model inference. */
function combatTargetFalls(target) {
  return !!(target && (target.dead || target.fled || Number(target.hp) <= 0));
}

/** @description Produce reliable story prose when the dynamic DM is unavailable. */
function combatOutcomeFallback(actor, outcome) {
  const roll = combatPrimaryRoll(outcome), acting = combatToken(roll && roll.actorId) || actor;
  const target = combatToken(roll && roll.targetId);
  const name = combatName(acting, roll && roll.actorName), targetName = combatName(target, roll && roll.targetName);
  const action = String(roll && roll.actionName || 'attack'), style = combatActionStyle(action);
  const result = combatOutcomeKind(roll), falls = combatTargetFalls(target);
  if (!roll) {
    return /takes no action|chooses no action|no legal/i.test(String(outcome && outcome.text || ''))
      ? `${name} finds no clean opening and holds back.`
      : `${name}'s move is settled; the battle surges on around them.`;
  }
  if (roll && roll.kind === 'death-save') {
    return /success|stable|revived/.test(result)
      ? `${name} drags in a ragged breath and refuses to slip away.`
      : `${name}'s breath catches; the fight for life grows more desperate.`;
  }
  if (result === 'miss' || result === 'saved') {
    if (style === 'bow' || style === 'thrown') return `${name} lets fly, but ${targetName} twists clear and the shot vanishes into the pines.`;
    if (style === 'magic') return `${action} breaks across ${targetName}'s guard and gutters out without finding purchase.`;
    return `${name} strikes hard, but ${targetName} turns the blow aside at the last instant.`;
  }
  if (falls) return `${name}'s ${action} lands cleanly. ${targetName} crumples out of the fight.`;
  if (style === 'bow' || style === 'thrown') return `${name} releases. The shot finds ${targetName} and drives them back a step.`;
  if (style === 'magic') return `${action} tears across ${targetName}, leaving its light burning in the smoky air.`;
  return `${name}'s ${action} slips through the guard and forces ${targetName} onto the back foot.`;
}

/** @description Recover a previously saved intent without speaking its rules syntax. */
function combatRecoveredCueNarration(actor, lead) {
  const source = String(lead || '');
  const action = (source.match(/\bchooses\s+(.+?)(?:\.| against| for)/i) || [])[1];
  const target = (source.match(/\btargets\s+(.+?)(?:\s*[·.]|$)/i) || [])[1];
  return action
    ? combatActionCueNarration(actor, target ? { name: target } : null, { name: action.replace(target || '', '').trim() })
    : `${combatName(actor)} fixes on an opening and attacks.`;
}

/** @description Capture the exact active-turn cursor for a fail-closed model request. */
function combatTurnGuard(actor) {
  return {
    sceneId: String(board && board.sceneId || ''),
    turnSerial: Number(board && board.turnSerial) || 0,
    actorId: actor && actor.id || null,
  };
}

/** @description Add a server-archived DM beat locally without racing archive polling. */
function acceptCombatNarration(response) {
  const entry = response && response.archiveEntry;
  if (entry && entry.seq) addBeat('narration', response.narration, null, entry.seq);
  return { text: response.narration, archived: !!entry };
}

/** @description Keep a useful story beat when the dynamic round highlight is unavailable. */
function combatRoundFallback() {
  const scene = SC(), anchor = String(scene && scene.storyAnchor || scene && scene.objective || '');
  const livingHeroes = board.tokens.filter((token) => token.kind === 'pc' && !token.dead && !token.fled).length;
  const livingFoes = board.tokens.filter((token) => token.kind === 'monster' && !token.dead && !token.fled).length;
  return `Another exchange crashes across ${scene.title}. ${livingHeroes} heroes still face ${livingFoes} foes, with one purpose holding through the chaos: ${anchor}`;
}

/** @description Create one deduplicated story-and-image highlight when a new round begins. */
async function requestDungeonMasterRoundHighlight() {
  if (TV || !campaign || !board || board.mode !== 'combat') return null;
  const timeline = board.presentationGate && board.presentationGate.id || 'live';
  const key = `${campaign.campaign_id}:${timeline}:${board.sceneId}:${board.round}`;
  if (combatRoundHighlights.has(key)) return null;
  combatRoundHighlights.add(key);
  const fallback = combatRoundFallback();
  const response = await api('/chat', {
    method: 'POST',
    body: JSON.stringify({
      campaignId: campaign.campaign_id, sceneId: board.sceneId, mode: 'combat',
      highlightKind: 'round', message: `Round ${board.round} begins.`,
      requestId: `round-${board.sceneId}-${board.round}`, turnGuard: combatTurnGuard(activeToken()),
    }),
  }).catch(() => null);
  const accepted = response && response.ok && response.narration ? acceptCombatNarration(response) : null;
  const text = accepted && accepted.text || fallback;
  if (!accepted) void Promise.resolve(recordArchivedBeat('narration', text, null, false)).catch(() => null);
  await presentPhase(text, 2200, true);
  requestCutaway(`${SC().title}, round ${board.round}. ${text}`, false, `round:${timeline}:${board.sceneId}:${board.round}`);
  return text;
}

/** @description Paint an exact confirmed defeat without allowing reconnect duplicates. */
function requestCombatKillCutaway(actor, outcome, narration) {
  if (!outcome || !outcome.killed || !campaign || !board) return;
  const roll = combatPrimaryRoll(outcome), target = combatToken(roll && roll.targetId);
  const eventId = outcome.rollEvent && outcome.rollEvent.eventId || turnKey(actor);
  const action = String(roll && roll.actionName || 'decisive blow');
  const prompt = `${SC().title}. ${combatName(actor)} defeats ${combatName(target, roll && roll.targetName)} with ${action}. ${narration}`;
  requestCutaway(prompt, false, `kill:${board.presentationGate && board.presentationGate.id || 'live'}:${eventId}`);
}

/** @description Ask the dynamic DM to dramatize facts while preserving a local fallback. */
async function requestDungeonMasterCombatNarration(actor, outcome) {
  const fallback = combatOutcomeFallback(actor, outcome);
  const eventId = outcome && outcome.rollEvent && outcome.rollEvent.eventId;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
  try {
    const response = await api('/chat', {
      method: 'POST', signal: controller && controller.signal,
      body: JSON.stringify({
        campaignId: campaign && campaign.campaign_id, sceneId: board && board.sceneId,
        mode: 'combat', message: String(outcome && outcome.text || '').slice(0, 1500),
        requestId: String(eventId || turnKey(actor)).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80),
        turnGuard: combatTurnGuard(actor),
      }),
    });
    if (response && response.ok && response.narration) {
      const accepted = acceptCombatNarration(response);
      requestCombatKillCutaway(actor, outcome, accepted.text);
      return accepted;
    }
  } catch (_error) { /* exact rules remain authoritative; use local prose below */ }
  finally { if (timer) clearTimeout(timer); }
  requestCombatKillCutaway(actor, outcome, fallback);
  return { text: fallback, archived: false };
}

if (typeof module !== 'undefined') module.exports = {
  combatActionCueNarration, combatAutomatedTurnNarration, combatMovementNarration, combatMovementShouldNarrate,
  combatOutcomeActionNarration, combatOutcomeFallback, combatRecoveredCueNarration,
};
