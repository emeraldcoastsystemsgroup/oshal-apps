/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:14:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract AI-companion planning, durable automation leases, and monster action presentation from the core turn controller.
 * 2026-07-21 20:01:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Decompose automated movement, death saves, player results, monster cues, and narration into bounded single-phase helpers.
 * 2026-07-21 21:28:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Await every visible authoritative die before narration completes or initiative advances.
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Persist immutable exact roll events with every resolved turn and pass them through each leased presentation.
 * 2026-07-21 23:31:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Refresh active automation leases faster than the abandoned-tab takeover window so narration stays single-presenter without trapping initiative.
 * 2026-07-22 00:15:33 | roger.murphy@emeraldcoastsystemsgroup.com  | Drive explicit Roll and Result HUD stages around every authoritative combat-die presentation.
 * 2026-07-22 00:32:46 | roger.murphy@emeraldcoastsystemsgroup.com  | Remove tactical model calls and release deterministic movement, defense, action, and death-save outcomes immediately while archive, dice, and natural narration continue asynchronously.
 * 2026-07-22 00:46:51 | roger.murphy@emeraldcoastsystemsgroup.com  | Persist completed position and Take No Action phases for interrupted, targetless, and retreating automated turns before initiative advances.
 * 2026-07-22 01:59:22 | roger.murphy@emeraldcoastsystemsgroup.com  | Choose monster destinations from the authoritative Dijkstra cost map and persist actual terrain cost and remaining movement.
 * 2026-07-22 10:10:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Serialize movement, target, dice, and result presentation at a readable text-aware pace, awaiting natural playback only within a hard deadline.
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep exact combat facts in the ledger while the dynamic Dungeon Master and deterministic fallback provide concise spoken story prose.
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Preserve stationary position facts silently so repeated no-move filler no longer interrupts each automated turn.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Apply spoken-action and dice-detail preferences while scaling only NPC presentation pauses.
 * 2026-07-23 11:36:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Retry a persisted death-save result after an interrupted presenter retires so initiative cannot remain stranded.
 */

'use strict';

const TACTICAL_MIN_MS = 2600;
const TACTICAL_MAX_MS = 24000;

function tacticalReadMs(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const base = Math.min(9000, Math.max(TACTICAL_MIN_MS, 1200 + words * 320));
  const actor = board && board.mode === 'combat' ? activeToken() : null;
  return actor && (actor.kind === 'monster' || isAICompanion(actor)) ? dmNpcPaceMs(base) : base;
}
function tacticalDeadlineMs(text) {
  return Math.min(TACTICAL_MAX_MS, tacticalReadMs(text) + 12000);
}

function companionActionReady(actor, action) {
  if (!action || actor.acted) return false;
  if (action.type !== 'spell' || !action.slot) return true;
  return !!(actor.slots && Number(actor.slots[String(action.slot)]) > 0);
}
function companionTarget(actor, action) {
  let targets = validTargets(actor, action);
  if (action.delivery === 'self') targets = targets.filter((t) => t.id === actor.id);
  targets.sort(action.mode === 'heal'
    ? (a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp)
    : (a, b) => cheb(actor, a) - cheb(actor, b) || a.hp - b.hp);
  return targets[0] || null;
}
function companionHealIntent(actor) {
  const wounded = board.tokens.filter((t) => t.kind === 'pc' && !t.dead && !t.fled && t.hp < t.maxHp);
  if (!wounded.length) return null;
  const heals = actionsOf(actor).filter((a) => a.mode === 'heal' && companionActionReady(actor, a));
  for (const action of heals) {
    const ready = companionTarget(actor, action);
    if (ready) return { action, target: ready, ready: true };
    const options = action.delivery === 'self' ? wounded.filter((t) => t.id === actor.id) : wounded;
    options.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || cheb(actor, a) - cheb(actor, b));
    if (options[0]) return { action, target: options[0], ready: false };
  }
  return null;
}
function companionAttackPlan(actor) {
  const actions = actionsOf(actor).filter((a) => a.mode !== 'heal' && companionActionReady(actor, a));
  actions.sort((a, b) => Number(b.type === 'spell') - Number(a.type === 'spell'));
  for (const action of actions) {
    const target = companionTarget(actor, action);
    if (target) return { action, target, ready: true };
  }
  return null;
}
function nearestMonster(actor) {
  const foes = living('monster');
  return foes.length ? foes.reduce((a, b) => cheb(actor, a) <= cheb(actor, b) ? a : b) : null;
}
function moveAutomatedToward(actor, objective) {
  if (!objective || movementLeft(actor) <= 0) return 0;
  const costs = ENG.computeMovementCosts(W(), { ...actor, speed: movementLeft(actor) });
  let best = { x: actor.x, y: actor.y, cost: 0, distance: cheb(actor, objective) };
  costs.forEach((cost, key) => {
    const [x, y] = key.split(',').map(Number), distance = cheb({ x, y }, objective);
    if (distance < best.distance || (distance === best.distance && cost < best.cost)) best = { x, y, cost, distance };
  });
  if (!best.cost) return 0;
  const spent = best.cost * unitFeet();
  actor.x = best.x; actor.y = best.y;
  actor.moveRemaining = Math.max(0, movementLeft(actor) - spent); actor.moved = true;
  return spent;
}
function automatedTurnCurrent(run) { return !!automationActor(run); }
function gridDirection(dx, dy) {
  const ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
  const ns = dy > 0 ? 'south' : dy < 0 ? 'north' : '';
  return ns && ew ? `${ns}-${ew}` : ns || ew || 'in place';
}
async function automatedFailure(run) {
  const actor = automationActor(run);
  if (!actor) return;
  const text = `${actor.name || actor.id} takes no action because the turn was interrupted; no hidden action occurred.`;
  await finishAutomatedWithoutAction(run, text);
}
function makeTurnResult(run, text, extra, rolls) {
  const result = Object.assign({
    serial: run.serial, text: String(text), lease: automationClientId,
    leaseAt: Date.now(), complete: false,
  }, extra || {});
  const rollEvent = result.rollEvent || makeTurnRollEvent(run, rolls);
  if (rollEvent) result.rollEvent = rollEvent;
  return result;
}
function makeMovementResult(run, text, before, actor, feet) {
  return {
    serial: run.serial, text: String(text),
    fromX: Number(before.x), fromY: Number(before.y), toX: Number(actor.x), toY: Number(actor.y), feet: Number(feet) || 0,
    lease: automationClientId, leaseAt: Date.now(), complete: false,
  };
}
function automatedPositionComplete(actor, run) {
  const movement = actor && actor.movementResult;
  return !!(actor && actor.positionSet && movement && movement.complete
    && Number(movement.serial) === run.serial && Number(movement.toX) === Number(actor.x)
    && Number(movement.toY) === Number(actor.y));
}
async function saveAutomatedStay(run, actor) {
  const before = { x: actor.x, y: actor.y };
  const text = `${actor.name || actor.id} stays at position (${actor.x}, ${actor.y}) · position set.`;
  actor.positionSet = true;
  actor.movementResult = makeMovementResult(run, text, before, actor, 0);
  automationPhase = { id: actor.id, cue: text };
  persist(); renderDock();
  if (!(await flushPendingState()) || !automationActor(run)) return false;
  await finishAutomatedMovement(run);
  return false;
}
async function ensureAutomatedPosition(run) {
  let actor = automationActor(run);
  if (!actor) return null;
  if (movementStoryPending(actor)) {
    await finishAutomatedMovement(run);
    return null;
  }
  if (automatedPositionComplete(actor, run)) return actor;
  await saveAutomatedStay(run, actor);
  return null;
}
async function finishAutomatedWithoutAction(run, text, applyOutcome) {
  let actor = automationActor(run);
  if (!actor) return false;
  if (actor.acted) return finishAutomatedResult(run);
  actor = await ensureAutomatedPosition(run);
  if (!actor) return false;
  if (applyOutcome) applyOutcome(actor);
  actor.acted = true; actor.turnResult = makeTurnResult(run, text);
  automationPhase = { id: actor.id, cue: `Action · ${text}` };
  persist(); renderDock();
  const saved = await flushPendingState();
  if (!saved || !automationActor(run)) return false;
  return finishAutomatedResult(run);
}
function showOutcomeRollStage(actor, outcome) {
  const rolls = outcome && outcome.rollEvent && outcome.rollEvent.rolls;
  const action = Array.isArray(rolls) && rolls[0] && (rolls[0].actionName || rolls[0].kind);
  automationPhase = { id: actor.id, cue: outcome && outcome.rollEvent
    ? `Rolls · ${shortTokenLabel(actor)} rolls for ${action || 'the action'}.`
    : `Result · ${outcome.text}` };
  renderDock();
}
function showOutcomeResultStage(actor, outcome) {
  automationPhase = { id: actor.id, cue: `Result · ${outcome.text}` };
  renderDock();
}
/** @description Preserve one exact tactical fact without holding the live turn. */
function archiveTacticalFact(text, rollEvent) {
  try { return Promise.resolve(recordArchivedBeat('combat', text, rollEvent, false)).catch(() => null); }
  catch (_error) { return Promise.resolve(null); }
}

/** @description Archive asynchronously, but pace the visible phase until its
 * natural audio settles or the hard presentation deadline expires. */
async function presentTacticalPhase(text, rollEvent, narration) {
  void archiveTacticalFact(text, rollEvent);
  let spoken = narration;
  if (typeof spoken === 'function') spoken = await spoken();
  if (!spoken || typeof spoken === 'string') spoken = { text: spoken || text, archived: false };
  if (spoken.text !== text && !spoken.archived) {
    try { void Promise.resolve(recordArchivedBeat('narration', spoken.text, null, false)).catch(() => {}); }
    catch (_error) { /* voice and caption still present the same fallback */ }
  }
  try {
    return await presentPhase(spoken.text, tacticalReadMs(spoken.text), false, null, tacticalDeadlineMs(spoken.text));
  } catch (_error) { return 'unavailable'; }
}
function actionCueAlreadyPresented(actor, run) {
  const prefix = `${turnKey(actor, run.serial)}:`;
  return Array.from(locallyPresentedCues).some((key) => key.startsWith(prefix));
}
/** @description Finish every authoritative die before exposing Result, then
 * retain that exact outcome for one short readable beat. */
async function presentTacticalOutcome(run, outcome, resultKey, lead) {
  let current = automationActor(run);
  if (!current) return null;
  const firstPresentation = !locallyNarratedResults.has(resultKey);
  if (firstPresentation) locallyNarratedResults.add(resultKey);
  if (firstPresentation && lead && dmPlaySetting('speakActions')
      && !actionCueAlreadyPresented(current, run)) {
    await presentTacticalPhase(lead, null, combatRecoveredCueNarration(current, lead));
  }
  if (firstPresentation && !lead && dmPlaySetting('speakActions')
      && !actionCueAlreadyPresented(current, run)) {
    const actionWords = combatOutcomeActionNarration(current, outcome);
    if (actionWords) await presentPhase(
      actionWords, tacticalReadMs(actionWords), false, null, tacticalDeadlineMs(actionWords),
    );
  }
  current = automationActor(run); if (!current) return null;
  showOutcomeRollStage(current, outcome); banner(`Roll now · ${outcome.text}`);
  try {
    const diceWords = dmPlaySetting('speakDice') ? combatDiceNarration(outcome.rollEvent) : '';
    await Promise.all([
      presentCombatDie(outcome.text, null, outcome.rollEvent),
      diceWords ? speakCaption(diceWords, false) : Promise.resolve('dice-muted'),
    ]);
  }
  catch (_error) { /* the persisted exact result still renders below */ }
  current = automationActor(run); if (!current) return null;
  showOutcomeResultStage(current, outcome); banner(outcome.text);
  if (firstPresentation) {
    await presentTacticalPhase(outcome.text, outcome.rollEvent,
      outcome.rollEvent
        ? () => requestDungeonMasterCombatNarration(current, outcome)
        : combatOutcomeFallback(current, outcome));
  }
  else await waitMs(tacticalReadMs(outcome.text));
  return automationActor(run);
}
async function performAutomatedMovementPresentation(run, movementKey) {
  let current = automationActor(run);
  if (!current || !movementStoryPending(current)) return false;
  const exactMovement = current.movementResult;
  automationPhase = { id: current.id, cue: `Position - ${exactMovement.text}` };
  renderDock(); banner(exactMovement.text);
  if (!locallyNarratedMovements.has(movementKey)) {
    locallyNarratedMovements.add(movementKey);
    if (combatMovementShouldNarrate(exactMovement)) {
      await presentTacticalPhase(exactMovement.text, null, combatMovementNarration(current, exactMovement));
    } else void archiveTacticalFact(exactMovement.text, null);
  }
  current = automationActor(run);
  if (!current || !movementStoryPending(current) || current.movementResult.lease !== automationClientId) return false;
  current.movementResult.complete = true; current.movementResult.leaseAt = Date.now();
  persist();
  const completed = await flushPendingState();
  current = automationActor(run);
  if (!completed || !current || movementStoryPending(current)) return false;
  setTimeout(() => {
    const ready = automationActor(run);
    if (ready && !ready.acted && ready.movementResult && ready.movementResult.complete) beginTurn();
  }, 0);
  return true;
}
/** Finish the exact persisted movement sentence before an automated actor may
 * choose a target. A second host waits for the live lease, then takes over the
 * same sentence after expiry instead of silently skipping the movement phase. */
async function finishAutomatedMovement(run) {
  let actor = automationActor(run);
  if (!actor) return false;
  let movement = actor.movementResult;
  if (!movement || Number(movement.serial) !== run.serial || movement.complete) return true;
  const movementKey = `movement:${turnKey(actor, run.serial)}`;
  const foreignLease = movement.lease && movement.lease !== automationClientId;
  const leaseRemaining = AUTOMATION_LEASE_MS - (Date.now() - Number(movement.leaseAt || 0));
  if (foreignLease && leaseRemaining > 0) {
    automationPhase = { id: actor.id, cue: `Position saved - ${movement.text} Another host tab is narrating it.` };
    banner(`${shortTokenLabel(actor)}'s movement is saved. Waiting for the narration already in progress...`); renderDock();
    scheduleAutomatedCallback(actor, actor.kind, Math.min(5000, Math.max(1200, leaseRemaining + 50)), (_current, retryRun) => void finishAutomatedMovement(retryRun));
    return false;
  }
  if (movement.lease !== automationClientId) {
    movement.lease = automationClientId; movement.leaseAt = Date.now();
    persist();
    const claimed = await flushPendingState();
    actor = automationActor(run); movement = actor && actor.movementResult;
    if (!claimed || !actor || !movementStoryPending(actor) || movement.lease !== automationClientId) return false;
  }
  const existingJob = automatedMovementJobs.get(movementKey);
  if (existingJob) {
    const finished = await existingJob.promise;
    actor = automationActor(run);
    if (!finished && actor && movementStoryPending(actor) && existingJob.epoch !== run.epoch) return finishAutomatedMovement(run);
    return finished;
  }
  const stopHeartbeat = maintainResultLease(run, 'movementResult');
  const job = performAutomatedMovementPresentation(run, movementKey).catch(() => {
    const current = automationActor(run);
    if (current && movementStoryPending(current)) {
      banner(`${shortTokenLabel(current)}'s movement is saved. Retrying its narration before the action...`);
      scheduleAutomatedCallback(current, current.kind, 1500, (_actor, retryRun) => void finishAutomatedMovement(retryRun));
    }
    return false;
  }).finally(() => {
    stopHeartbeat();
    const activeJob = automatedMovementJobs.get(movementKey);
    if (activeJob && activeJob.promise === job) automatedMovementJobs.delete(movementKey);
  });
  automatedMovementJobs.set(movementKey, { epoch: run.epoch, promise: job });
  return job;
}
const playerResultJobs = new Map();
function maintainResultLease(run, field) {
  const resultField = field || 'turnResult';
  let updating = false;
  const timer = setInterval(async () => {
    const actor = automationActor(run), result = actor && actor[resultField];
    if (!actor || !result || result.complete || result.lease !== automationClientId) { clearInterval(timer); return; }
    if (updating) return;
    updating = true; result.leaseAt = Date.now(); persist();
    await flushPendingState(); updating = false;
  }, AUTOMATION_HEARTBEAT_MS);
  return () => clearInterval(timer);
}
async function resumeAfterDeathSave(run, current) {
  if (!isConscious(current)) { await nextTurn(); return true; }
  if (isAICompanion(current) && isOwner()) {
    const rise = `${shortTokenLabel(current)} rises with 1 HP. The AI Companion now takes its normal Move then Action turn.`;
    banner(rise); await presentTacticalPhase(rise);
    if (automationActor(run)) await companionTurn(run);
  } else if (controls(current)) {
    selected = current; selectedAction = null; computeReachable(current); renderDock(); setTurnFlag();
    banner(`${shortTokenLabel(current)} rises with 1 HP · now take your normal Move → Action turn.`);
  } else banner(`${shortTokenLabel(current)} rose with 1 HP · waiting for that player to move and act.`);
  return true;
}
async function performDeathSavePresentation(run, resultKey) {
  let current = automationActor(run);
  if (!current || !turnStoryPending(current)) return false;
  const outcome = current.turnResult;
  current = await presentTacticalOutcome(run, outcome, resultKey);
  if (!current || !turnStoryPending(current) || current.turnResult.lease !== automationClientId) return false;
  current.turnResult.complete = true; current.turnResult.leaseAt = Date.now(); persist();
  const completed = await flushPendingState();
  if (!completed || !automationActor(run)) return false;
  automationPhase = null; renderDock();
  if (await checkEnd()) return true;
  current = automationActor(run);
  return current ? resumeAfterDeathSave(run, current) : false;
}
async function finishDeathSaveResult(run) {
  let actor = automationActor(run);
  if (!actor || !hasDeathSaveResult(actor) || !turnStoryPending(actor) || (!controls(actor) && !isOwner())) return false;
  const resultKey = `death-save:${turnKey(actor, run.serial)}`, result = actor.turnResult;
  const foreignLease = result.lease && result.lease !== automationClientId;
  const remaining = AUTOMATION_LEASE_MS - (Date.now() - Number(result.leaseAt || 0));
  if (foreignLease && remaining > 0) {
    banner(`${shortTokenLabel(actor)}’s death save is confirmed. The original presenter is finishing its exact narration…`);
    scheduleAutomatedCallback(actor, 'pc', Math.min(5000, Math.max(1200, remaining + 50)), (_current, retryRun) => void finishDeathSaveResult(retryRun));
    return false;
  }
  if (result.lease !== automationClientId) {
    result.lease = automationClientId; result.leaseAt = Date.now(); persist();
    const claimed = await flushPendingState(); actor = automationActor(run);
    if (!claimed || !actor || !turnStoryPending(actor) || actor.turnResult.lease !== automationClientId) return false;
  }
  if (playerResultJobs.has(resultKey)) return playerResultJobs.get(resultKey);
  const stopHeartbeat = maintainResultLease(run, 'turnResult');
  const job = performDeathSavePresentation(run, resultKey).finally(() => {
    stopHeartbeat();
    if (playerResultJobs.get(resultKey) === job) playerResultJobs.delete(resultKey);
    const active = board && board.mode === 'combat' ? activeToken() : null;
    if (active && active.id === run.actorId && hasDeathSaveResult(active) && turnStoryPending(active)
        && (controls(active) || isOwner())) {
      scheduleAutomatedCallback(active, 'pc', 250, (_current, retryRun) => void finishDeathSaveResult(retryRun));
    }
  });
  playerResultJobs.set(resultKey, job);
  return job;
}
async function performPlayerResultPresentation(run, resultKey, pendingKey) {
  let current = automationActor(run);
  if (!current || !turnStoryPending(current)) return false;
  const outcome = current.turnResult;
  banner('Action confirmed · everyone sees the roll, then the result.');
  current = await presentTacticalOutcome(run, outcome, resultKey);
  if (!current || !turnStoryPending(current) || current.turnResult.lease !== automationClientId) return false;
  current.turnResult.complete = true; persist();
  const completed = await flushPendingState();
  if (!completed || !automationActor(run)) return false;
  if (turnResolutionPending === (pendingKey || turnKey(current, run.serial))) turnResolutionPending = null;
  renderDock();
  if (await checkEnd()) return true;
  banner(movementLeft(current) > 0 ? 'Narration complete · you may still move, then End Turn.' : 'Narration complete · End Turn when ready.');
  return true;
}
async function finishPlayerResult(run, pendingKey) {
  let actor = automationActor(run);
  if (!actor || !controls(actor) || !actor.acted || !turnStoryPending(actor)) return false;
  const resultKey = `player:${turnKey(actor, run.serial)}`, result = actor.turnResult;
  turnResolutionPending = pendingKey || turnKey(actor, run.serial);
  const foreignLease = result.lease && result.lease !== automationClientId;
  const remaining = AUTOMATION_LEASE_MS - (Date.now() - Number(result.leaseAt || 0));
  if (foreignLease && remaining > 0) {
    banner('This action is confirmed. Your other tab is finishing the Dungeon Master narration…'); renderDock();
    scheduleAutomatedCallback(actor, 'pc', Math.min(5000, Math.max(1200, remaining + 50)), (_current, retryRun) => void finishPlayerResult(retryRun, turnKey(_current, retryRun.serial)));
    return false;
  }
  if (result.lease !== automationClientId) {
    result.lease = automationClientId; result.leaseAt = Date.now();
    persist();
    const claimed = await flushPendingState();
    actor = automationActor(run);
    if (!claimed || !actor || !turnStoryPending(actor) || actor.turnResult.lease !== automationClientId) return false;
  }
  if (playerResultJobs.has(resultKey)) return playerResultJobs.get(resultKey);
  const stopHeartbeat = maintainResultLease(run, 'turnResult');
  const job = performPlayerResultPresentation(run, resultKey, pendingKey).finally(() => {
    stopHeartbeat();
    if (playerResultJobs.get(resultKey) === job) playerResultJobs.delete(resultKey);
    const current = board && board.mode === 'combat' ? activeToken() : null;
    if (current && current.id === run.actorId && controls(current) && turnStoryPending(current)) setTimeout(() => beginTurn(), 0);
  });
  playerResultJobs.set(resultKey, job);
  return job;
}
async function performAutomatedResultPresentation(run, resultKey) {
  let current = automationActor(run);
  if (!current || !current.turnResult) return false;
  const outcome = current.turnResult;
  current = await presentTacticalOutcome(run, outcome, resultKey, outcome.lead);
  if (!current) return false;
  if (outcome.downedTargetId) {
    const downedTarget = outcome.downedTargetId && board.tokens.find((token) => token.id === outcome.downedTargetId);
    if (downedTarget && isDowned(downedTarget)) void acknowledgeDowned(downedTarget);
  }
  current = automationActor(run);
  if (!current || !current.turnResult || current.turnResult.lease !== automationClientId) return false;
  current.turnResult.complete = true; persist();
  const completed = await flushPendingState();
  if (!completed || !automationActor(run)) return false;
  if (await checkEnd()) return true;
  await nextTurn();
  return true;
}
async function finishAutomatedResult(run) {
  let actor = automationActor(run);
  if (!actor || !actor.acted || !actor.turnResult || Number(actor.turnResult.serial) !== run.serial) return false;
  const resultKey = turnKey(actor, run.serial), result = actor.turnResult;
  if (result.complete) { await nextTurn(); return true; }
  const foreignLease = result.lease && result.lease !== automationClientId;
  const leaseRemaining = AUTOMATION_LEASE_MS - (Date.now() - Number(result.leaseAt || 0));
  if (foreignLease && leaseRemaining > 0) {
    automationPhase = { id: actor.id, cue: 'Result confirmed · another host tab is finishing the Dungeon Master narration' };
    banner(`${shortTokenLabel(actor)}’s result is confirmed. Waiting for the narration already in progress…`); renderDock();
    scheduleAutomatedCallback(actor, actor.kind, Math.min(5000, Math.max(1200, leaseRemaining + 50)), (_current, retryRun) => void finishAutomatedResult(retryRun));
    return false;
  }
  if (result.lease !== automationClientId) {
    result.lease = automationClientId; result.leaseAt = Date.now();
    persist();
    const claimed = await flushPendingState();
    actor = automationActor(run);
    if (!claimed || !actor || !actor.turnResult || actor.turnResult.lease !== automationClientId) return false;
  }
  if (automatedResultJobs.has(resultKey)) return automatedResultJobs.get(resultKey);
  const stopHeartbeat = maintainResultLease(run, 'turnResult');
  const job = performAutomatedResultPresentation(run, resultKey).finally(() => {
    stopHeartbeat();
    if (automatedResultJobs.get(resultKey) === job) automatedResultJobs.delete(resultKey);
    const current = board && board.mode === 'combat' ? activeToken() : null;
    if (current && current.id === run.actorId && current.acted && current.turnResult && !current.turnResult.complete) setTimeout(() => beginTurn(), 0);
  });
  automatedResultJobs.set(resultKey, job);
  return job;
}
async function companionTurn(run) {
  try {
    let hero = automationActor(run);
    if (!isOwner() || !hero || !isAICompanion(hero)) return;
    if (!isConscious(hero)) {
      if (hero.dead || hero.stable || hero.fled) await nextTurn();
      return;
    }
    // A reconciled tab resumes from the durable phase markers. It never moves
    // the same companion twice or repeats an already-committed attack.
    if (hero.acted) return void await finishAutomatedResult(run);
    if (movementStoryPending(hero)) return void await finishAutomatedMovement(run);
    if (positionChosen(hero)) return void await companionAct(run);
    const name = shortTokenLabel(hero);
    let plan = companionHealIntent(hero) || companionAttackPlan(hero);
    let objective = plan && !plan.ready ? plan.target : null;
    if (!plan) objective = nearestMonster(hero);
    const before = { x: hero.x, y: hero.y };
    const spent = objective && !(plan && plan.ready) ? moveAutomatedToward(hero, objective) : 0;
    hero.positionSet = true;
    const movement = spent > 0
      ? `${name} moves ${spent} ft ${gridDirection(hero.x - before.x, hero.y - before.y)} toward ${shortTokenLabel(objective)} · position (${hero.x}, ${hero.y}) set · AI Companion.`
      : `${name} stays at position (${hero.x}, ${hero.y}) · position set · AI Companion.`;
    hero.movementResult = makeMovementResult(run, movement, before, hero, spent);
    automationPhase = { id: hero.id, cue: movement };
    persist(); renderDock();
    const saved = await flushPendingState();
    hero = automationActor(run);
    if (!saved || !hero) return;
    await finishAutomatedMovement(run);
  } catch (_e) { await automatedFailure(run); }
}
async function companionAct(run) {
  try {
    let hero = automationActor(run);
    if (!isOwner() || !hero || !isAICompanion(hero)) return;
    if (hero.acted) return void await finishAutomatedResult(run);
    const persistedCue = automatedCueForTurn(hero, run);
    const claimed = await claimAutomatedCue(run, hero, persistedCue);
    if (persistedCue && !claimed) return;
    hero = claimed ? claimed.actor : hero;
    const heal = persistedCue ? null : companionHealIntent(hero);
    const plan = persistedCue ? planFromCue(hero, claimed.cue)
      : (heal && heal.ready ? heal : null) || companionAttackPlan(hero);
    if (persistedCue && !plan) throw new Error('The persisted companion target is no longer legal.');
    if (!plan) {
      const text = `${hero.name || hero.id} chooses no action and takes no action; no legal target is in range.`;
      await finishAutomatedWithoutAction(run, text);
      return;
    }
    const choice = companionChoiceText(hero, plan.action, plan.target);
    if (!persistedCue && !(await saveAutomatedActionCue(run, hero, plan.target, plan.action, choice))) return;
    hero = automationActor(run); if (!hero) return;
    if (!(await presentActionCue(hero, run, plan.target, plan.action, choice))) return;
    const action = actionsOf(hero).find((candidate) => candidate.id === plan.action.id || candidate.name === plan.action.name);
    const target = board.tokens.find((candidate) => candidate.id === plan.target.id);
    if (!action || !target) throw new Error('The companion plan changed before it resolved.');
    const res = withShow(hero, action, target, () => resolveAction(hero, action, target));
    hero.acted = true;
    const text = `${shortTokenLabel(hero)} · AI Companion: ${res.text}`;
    hero.turnResult = makeTurnResult(run, text, { lead: choice }, res.rolls);
    automationPhase = { id: hero.id, cue: `Result · ${res.text}` };
    persist(); renderDock();
    const saved = await flushPendingState();
    if (!saved || !automationActor(run)) return;
    await finishAutomatedResult(run);
  } catch (_e) { await automatedFailure(run); }
}

// ── Monster AI (host device only) ────────────────────────────────────────────
function monsterDefenseCue(action, target) {
  if (action.mode === 'save' && action.save) return `${String(action.save.ability || '').replace(/\b\w/g, (c) => c.toUpperCase())} save DC ${action.save.dc}`;
  if (action.mode === 'autohit') return 'automatic hit';
  return `attack vs AC ${target.ac}`;
}
function automatedCueForTurn(actor, run) {
  const cue = board && board.telegraph;
  return cue && cue.actorId === actor.id && Number(cue.turnSerial) === run.serial ? cue : null;
}
function planFromCue(actor, cue) {
  if (!cue) return null;
  const action = actionsOf(actor).find((candidate) => candidate.id === cue.actionId || candidate.name === cue.actionName);
  const target = board.tokens.find((candidate) => candidate.id === cue.targetId);
  return action && target && validTargets(actor, action).some((candidate) => candidate.id === target.id)
    ? { action, target, ready: true } : null;
}
function companionChoiceText(hero, action, target) {
  return `${shortTokenLabel(hero)} chooses ${action.name}. ${shortTokenLabel(hero)} targets ${shortTokenLabel(target)} · legal target · AI Companion.`;
}
function actionCueKey(actor, run, target, action) {
  return `${turnKey(actor, run.serial)}:${target.id}:${action.id || action.name}`;
}
async function presentActionCue(actor, run, target, action, text) {
  const key = actionCueKey(actor, run, target, action);
  automationPhase = { id: actor.id, cue: text }; telegraph = { actorId: actor.id, targetId: target.id };
  renderDock(); banner(text);
  if (!locallyPresentedCues.has(key)) {
    locallyPresentedCues.add(key);
    if (dmPlaySetting('speakActions')) {
      await presentTacticalPhase(text, null, combatActionCueNarration(actor, target, action));
    } else {
      void archiveTacticalFact(text, null);
      await waitMs(dmNpcPaceMs(450));
    }
  }
  return !!automationActor(run);
}
async function saveAutomatedActionCue(run, actor, target, action, text) {
  automationPhase = { id: actor.id, cue: text };
  telegraph = { actorId: actor.id, targetId: target.id };
  board.telegraph = {
    ...telegraph, turnSerial: run.serial, actionId: action.id || '', actionName: action.name,
    lease: automationClientId, leaseAt: Date.now(),
  };
  persist(); renderDock();
  return !!(await flushPendingState()) && !!automationActor(run);
}
async function claimAutomatedCue(run, actor, cue) {
  if (!cue || cue.lease === automationClientId) return cue ? { actor, cue } : null;
  const remaining = AUTOMATION_LEASE_MS - (Date.now() - Number(cue.leaseAt || 0));
  if (remaining > 0) {
    automationPhase = { id: actor.id, cue: 'Target locked · another host tab is resolving it' };
    renderDock();
    scheduleAutomatedCallback(actor, actor.kind, Math.min(5000, Math.max(1200, remaining + 50)),
      (_current, retryRun) => void (actor.kind === 'monster' ? monsterTurn(retryRun) : companionTurn(retryRun)));
    return null;
  }
  cue.lease = automationClientId; cue.leaseAt = Date.now(); persist();
  if (!(await flushPendingState())) return null;
  const current = automationActor(run), persisted = current && automatedCueForTurn(current, run);
  return persisted && persisted.lease === automationClientId ? { actor: current, cue: persisted } : null;
}
async function moveMonsterForTurn(run, monster, target) {
  const melee = (W().sheetFor(monster).actions || []).find((action) => action.delivery === 'melee');
  const before = { x: monster.x, y: monster.y };
  const spent = melee && cheb(monster, target) > 1 ? moveAutomatedToward(monster, target) : 0;
  monster.moved = spent > 0; monster.positionSet = true;
  const position = spent
    ? `${shortTokenLabel(monster)} moves ${spent} ft ${gridDirection(monster.x - before.x, monster.y - before.y)} toward ${shortTokenLabel(target)} · position set.`
    : `${shortTokenLabel(monster)} stays here · position set.`;
  monster.movementResult = makeMovementResult(run, position, before, monster, spent);
  automationPhase = { id: monster.id, cue: position };
  persist(); renderDock();
  const saved = await flushPendingState();
  if (saved && automationActor(run)) await finishAutomatedMovement(run);
}
function monsterCueForTurn(monster, run) {
  return automatedCueForTurn(monster, run);
}
async function claimMonsterCue(run, monster, cue) {
  if (!cue) return { monster, cue: null };
  const claimed = await claimAutomatedCue(run, monster, cue);
  return claimed ? { monster: claimed.actor, cue: claimed.cue } : null;
}
async function saveMonsterDefenseCue(run, monster, target, action, cue) {
  return saveAutomatedActionCue(run, monster, target, action, cue);
}
async function finishMonsterWithoutAction(run, monster, reason) {
  const text = `${monster.name || monster.id} takes no action; ${reason || 'no legal attack remains after movement'}.`;
  await finishAutomatedWithoutAction(run, text);
}
async function presentMonsterChoice(run, monster, fallbackTarget, persistedCue) {
  const action = persistedCue
    ? (W().sheetFor(monster).actions || []).find((candidate) => candidate.id === persistedCue.actionId || candidate.name === persistedCue.actionName)
    : ENG.pickMonsterAction(W(), monster, fallbackTarget);
  if (!action) { await finishMonsterWithoutAction(run, monster, 'no legal attack remains after movement'); return; }
  const target = persistedCue ? board.tokens.find((candidate) => candidate.id === persistedCue.targetId && isConscious(candidate)) : fallbackTarget;
  if (!target) { await finishMonsterWithoutAction(run, monster, 'the declared target is no longer legal'); return; }
  const name = shortTokenLabel(monster);
  const cue = `${name} chooses ${action.name}. ${name} targets ${shortTokenLabel(target)} · defense: ${monsterDefenseCue(action, target)}.`;
  if (!persistedCue && !(await saveMonsterDefenseCue(run, monster, target, action, cue))) return;
  if (!(await presentActionCue(monster, run, target, action, cue))) return;
  await resolveMonsterAction(run, target.id, action.id || '', action.name);
}
async function monsterTurn(run) {
  try {
    let monster = automationActor(run);
    if (!monster) return;
    if (monster.dead || monster.fled) { await nextTurn(); return; }
    if (monster.acted) { await finishAutomatedResult(run); return; }
    if (movementStoryPending(monster)) { await finishAutomatedMovement(run); return; }
    if (monster.ref === 'goblin' && ENG.goblinsShouldFlee(W())) { await flee(run); return; }
    let target = ENG.nearestPC(W(), monster);
    if (!target) { await finishMonsterWithoutAction(run, monster, 'no legal target remains'); return; }
    if (!positionChosen(monster)) { await moveMonsterForTurn(run, monster, target); return; }
    target = ENG.nearestPC(W(), monster);
    if (!target) { await finishMonsterWithoutAction(run, monster, 'no legal target remains after movement'); return; }
    const claimed = await claimMonsterCue(run, monster, monsterCueForTurn(monster, run));
    if (!claimed) return;
    await presentMonsterChoice(run, claimed.monster, target, claimed.cue);
  } catch (_e) { telegraph = null; await automatedFailure(run); }
}
async function resolveMonsterAction(run, targetId, actionId, actionName) {
  try {
    let m = automationActor(run);
    const tgt = board.tokens.find((t) => t.id === targetId && isConscious(t));
    if (!m) return;
    if (m.acted) return void await finishAutomatedResult(run);
    const action = (W().sheetFor(m).actions || []).find((candidate) => candidate.id === actionId || candidate.name === actionName);
    if (!tgt || !action) {
      await finishMonsterWithoutAction(run, m, 'the persisted attack can no longer resolve legally');
      return;
    }
    const wasDowned = isDowned(tgt);
    const res = withShow(m, action, tgt, () => resolveAction(m, action, tgt));
    const newlyDowned = !wasDowned && isDowned(tgt);
    m.acted = true; m.turnResult = makeTurnResult(run, res.text,
      { downedTargetId: newlyDowned ? targetId : null }, res.rolls);
    automationPhase = { id: m.id, cue: `Result · ${res.text}` };
    persist(); renderDock();
    const saved = await flushPendingState();
    m = automationActor(run);
    if (!saved || !m) return;
    await finishAutomatedResult(run);
  } catch (_e) { telegraph = null; await automatedFailure(run); }
}
async function saveRetreatMovement(run, monster) {
  const before = { x: monster.x, y: monster.y }, available = movementLeft(monster);
  const maxSteps = Math.floor(available / unitFeet());
  for (let step = 0; step < maxSteps; step++) {
    if (!ENG.walkable(W(), monster.x + 1, monster.y, monster.id)) break;
    monster.x += 1;
  }
  const feet = Math.max(0, monster.x - before.x) * unitFeet();
  monster.moveRemaining = Math.max(0, available - feet);
  monster.moved = feet > 0; monster.positionSet = true;
  const text = feet > 0
    ? `${monster.name || monster.id} retreats ${feet} ft east · position (${monster.x}, ${monster.y}) set.`
    : `${monster.name || monster.id} holds position (${monster.x}, ${monster.y}) while retreat is blocked · position set.`;
  monster.movementResult = makeMovementResult(run, text, before, monster, feet);
  automationPhase = { id: monster.id, cue: text };
  persist(); renderDock();
  if (!(await flushPendingState()) || !automationActor(run)) return false;
  await finishAutomatedMovement(run);
  return true;
}
async function flee(run) {
  let monster = automationActor(run);
  if (!monster) return;
  if (monster.acted) { await finishAutomatedResult(run); return; }
  if (!automatedPositionComplete(monster, run)) {
    await saveRetreatMovement(run, monster);
    return;
  }
  const escaped = monster.x === SC().grid.w - 1;
  const text = escaped
    ? `${monster.name || monster.id} reaches the east edge and takes no action as it flees the battle.`
    : `${monster.name || monster.id} takes no action after retreating as far east as possible this turn.`;
  await finishAutomatedWithoutAction(run, text, escaped ? (actor) => { actor.fled = true; } : null);
}
