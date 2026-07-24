/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract the deterministic encounter turn loop, AI-companion movement, monster resolution, and outcome transitions into a focused tabletop module.
 * 2026-07-21 20:14:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Split automated actors and terminal outcomes into separate classic-script modules so turn orchestration stays below the proactive decomposition threshold.
 * 2026-07-21 20:55:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep human controls locked until the opening and per-turn Dungeon Master announcements finish.
 * 2026-07-21 21:08:49 | roger.murphy@emeraldcoastsystemsgroup.com  | Fence an opening narration against a campaign change before it resumes initiative.
 * 2026-07-21 21:28:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Cancel abandoned combat-die jobs whenever turn presentation memory is reset.
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Persist the opening presentation lock in the first combat write and block automation until the host completes it.
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Persist exact initiative and turn roll events before their shared presentation begins.
 * 2026-07-21 23:31:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Preserve the automation presenter across same-tab reloads and shorten abandoned-tab leases so a solo table resumes instead of waiting two minutes.
 * 2026-07-22 00:18:41 | roger.murphy@emeraldcoastsystemsgroup.com  | Recover opening gate completion automatically while natural narration continues independently from turn availability.
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace repeated automated arrival language with varied in-battle turn handoffs.
 * 2026-07-22 22:58:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Pause at each new round for one deduplicated story highlight before initiative resumes.
 * 2026-07-22 00:11:24 | roger.murphy@emeraldcoastsystemsgroup.com  | Make actor ownership and Move, Choose, Target, Roll, and Result stages persistent while narration remains non-blocking.
 * 2026-07-22 00:36:25 | roger.murphy@emeraldcoastsystemsgroup.com  | Suspend every automated callback behind requested or rolled shared dice and refresh the visible die when its controlling seat changes.
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace repetitive turn questions with concise in-world handoffs and direct human movement instructions.
 * 2026-07-23 00:49:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace the false linear Move-to-Result checklist with live movement, action, spell-slot, and health budgets that support move-action-move.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Recover completed player actions into remaining movement and honor the selected NPC presentation pace.
 * 2026-07-23 11:36:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Explain death-save failures already recorded before the current d20 so accumulated results cannot look like duplicate rolls.
 */

'use strict';

// ── Turn loop ────────────────────────────────────────────────────────────────
async function startEncounter() {
  const requestEpoch = campaignEpoch, campaignId = campaign && campaign.campaign_id;
  const setupBoard = persistedBoardCopy(board), setupRev = rev;
  telegraph = null; delete board.telegraph;
  board.mode = 'combat'; board.round = 1; board.turnIndex = 0; board.turnSerial = 1;
  installOpeningPresentationGate(SC().opening || `${SC().title} begins.`);
  const initiative = ENG.rollInitiativeDetailed(board.tokens.filter((t) => !t.fled));
  board.order = initiative.order;
  board.initiativeRollEvent = makeInitiativeRollEvent(initiative.rolls);
  setStoryOpen(false); renderChoices([]);
  persist();
  const saved = await flushPendingState();
  if (!saved || !board || board.mode !== 'combat') {
    const restored = await restoreAuthoritativeBoard();
    if (!restored && requestEpoch === campaignEpoch && campaign && campaign.campaign_id === campaignId) {
      board = setupBoard; rev = setupRev; rememberConfirmedBoard(board, rev); indexTerrain(); layout(); renderDock();
    }
    if (board && board.mode === 'setup' && !TV) showLobby();
    banner('The quest did not start on the shared table yet. Nothing was narrated; press Start the Quest again.');
    return false;
  }
  try { await resumePendingPresentationGate(); }
  catch (_error) { banner('The shared table is reconnecting and will unlock automatically; narration will not replay.'); }
  if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId || !board || board.mode !== 'combat') return false;
  if (board.presentationGate) return board.presentationGate.complete === true;
  beginTurn(); void autoSnapshot(`▶ ${SC().title} — begins`);
  return true;
}
let monsterTimer = null;
let lastTurnAnnouncement = '', completedTurnAnnouncement = '', lastTurnSpeech = Promise.resolve('idle');
let automationPhase = null, turnResolutionPending = null, turnAnnouncementPending = null, downNoticeKey = '';
let automationEpoch = 0, turnAdvanceInFlight = null;
const AUTOMATION_SESSION_KEY = 'dnd-automation-client';

/** @description List usable action names so observers know what an automated actor is considering. */
function turnActionNames(token) {
  return actionsOf(token).filter((action) => {
    if (!action || !action.name) return false;
    if (action.type !== 'spell' || !action.slot) return true;
    return !!(token.slots && Number(token.slots[String(action.slot)]) > 0);
  }).map((action) => action.name).slice(0, 4);
}
function turnActionText(token) {
  const names = turnActionNames(token);
  if (!names.length) return 'no available action';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
function currentTurnResult(token) {
  return token && token.turnResult && Number(token.turnResult.serial) === Number(board.turnSerial) ? token.turnResult : null;
}
function sharedRollPending(state) {
  const roll = state && state.sharedRoll;
  return !!(roll && ['requested', 'rolled'].includes(roll.status));
}
function automatedTurnState(token, fallback) {
  const movementPending = movementStoryPending(token), positionReady = positionChosen(token) && !movementPending;
  const persisted = token.movementResult && Number(token.movementResult.serial) === Number(board.turnSerial) ? token.movementResult.text : '';
  const phase = automationPhase && automationPhase.id === token.id ? automationPhase.cue : persisted || fallback;
  return { movementPending, positionReady, phase };
}
function explicitTargetCue(name, phase) {
  const choice = String(phase || '').match(/^(?:.*?·\s*)?(?:AI Companion\s*)?chooses (.+?) (?:against|for) (.+?)\.?$/i);
  return choice ? `${name} targets ${choice[2]} with ${choice[1]}.` : String(phase || '');
}

/** @description Derive one explicit verb stage from shared board facts and local live presentation. */
function turnStageState(token) {
  const name = shortTokenLabel(token), state = automatedTurnState(token, ''), result = currentTurnResult(token);
  const localPhase = automationPhase && automationPhase.id === token.id ? String(automationPhase.cue || '') : '';
  if (result && /^Roll/i.test(localPhase)) return { stage: 'roll', cue: `${name} rolls now. ${localPhase}` };
  if (result) {
    const end = result.complete && controls(token)
      ? movementLeft(token) > 0 ? ' Spend any remaining movement or end your turn.' : ' End your turn when ready.'
      : '';
    return { stage: 'result', cue: `Result: ${result.text}${end}` };
  }
  if (state.movementPending) return { stage: 'move', cue: `${name} is moving. ${state.phase}` };
  if (!state.positionReady) return { stage: 'move', cue: `${name} is moving and choosing a legal destination.` };
  const warning = combatTelegraph();
  if (warning && warning.actorId === token.id) {
    const target = board.tokens.find((candidate) => candidate.id === warning.targetId);
    return { stage: 'target', cue: `${name} targets ${target ? shortTokenLabel(target) : 'a defender'} with ${warning.actionName || 'an attack'}. Defense: ${target ? `${target.ac} AC` : 'pending'}.` };
  }
  if (selectedAction && controls(token)) return { stage: 'target', cue: `${name} targets a highlighted creature with ${selectedAction.name}.` };
  if (/(chooses|targets|target locked)/i.test(localPhase)) return { stage: 'target', cue: explicitTargetCue(name, localPhase) };
  return { stage: 'choose', cue: `${name} is choosing ${turnActionText(token)}.` };
}

/** @description Summarize spell slots as resources rather than implying multiple actions. */
function turnSlotBudget(token) {
  const rows = Object.entries(token && token.slots || {}).sort(([a], [b]) => Number(a) - Number(b));
  return rows.length ? rows.map(([level, count]) => `L${level}: ${Number(count) || 0}`).join(' · ') : 'none';
}

/** @description Render simultaneous turn budgets plus only the currently resolving event. */
function renderTurnResourceSteps(token, stage) {
  const actionLeft = token && token.acted ? 0 : 1;
  const event = stage === 'roll' ? '<span class="turn-step current">Roll <b>now</b></span>'
    : stage === 'result' ? '<span class="turn-step current">Result <b>showing</b></span>' : '';
  return `<span class="turn-step ${movementLeft(token) ? 'current' : 'locked'}">Movement <b>${movementLeft(token)} ft left</b></span>
    <span class="turn-step ${actionLeft ? 'current' : 'locked'}">Action <b>${actionLeft} left</b></span>
    <span class="turn-step current">Spell slots <b>${esc(turnSlotBudget(token))}</b></span>
    <span class="turn-step current">Health <b>${Number(token && token.hp) || 0}/${Number(token && token.maxHp) || 0} HP</b></span>${event}`;
}
function renderSharedRollFlag(flag, roll) {
  if (!roll || !['requested', 'rolled'].includes(roll.status)) return false;
  const presentationKey = sharedRollPresentationKey(roll);
  const visible = $('stage').querySelector(`.dicebox[data-roll-id="${String(roll.id).replace(/"/g, '')}"]`);
  if (sharedRollPresentation !== presentationKey || !visible) setTimeout(() => presentSharedRoll(roll), 0);
  const actor = requestedRollHero(roll), name = actor ? shortTokenLabel(actor) : 'Chosen hero';
  const roller = actor && controls(actor) ? 'You roll now.' : actor && isAICompanion(actor) ? 'The AI Companion rolls visibly now.' : 'Waiting for that player to roll.';
  flag.className = roll.status === 'rolled' ? 'waiting' : actor && controls(actor) ? 'yours' : 'waiting';
  flag.innerHTML = `<div class="turn-copy"><span class="turn-kicker">Shared table roll</span><strong>${esc(name)}'s turn</strong><span class="turn-cue">${roll.status === 'rolled' ? `Result: ${Number(roll.natural)} ${Number(roll.modifier) >= 0 ? '+' : ''}${Number(roll.modifier) || 0} = ${Number(roll.total)}. Everyone sees this same result.` : `${esc(name)} rolls ${esc(roll.ability || 'd20')}${roll.dc != null ? ` against DC ${Number(roll.dc)}` : ''}. ${esc(roller)}`}</span></div><div class="turn-steps">${renderTurnResourceSteps(actor, roll.status === 'rolled' ? 'result' : 'roll')}</div>`;
  return true;
}
function renderDownedTurnFlag(flag, token, name) {
  const score = deathSaveScore(token), mine = controls(token), seat = claimedBy(token.slug);
  flag.className = mine ? 'deathsave yours' : isAICompanion(token) ? 'deathsave companion' : 'deathsave waiting';
  flag.innerHTML = `<div class="turn-copy"><span class="turn-kicker">Death save</span><strong>${esc(name)}'s turn</strong><span class="turn-cue">${mine ? `${esc(name)} rolls one unmodified d20 now.` : isAICompanion(token) ? `${esc(name)} rolls a visible death save now.` : `Waiting for ${esc(seat ? seat.name.split(/[\s@]/)[0] : 'the player')} to roll for ${esc(name)}.`}</span></div><div class="turn-steps"><span class="turn-step current">Successes <b>${score.successes} / 3</b></span><span class="turn-step current">Failures <b>${score.failures} / 3</b></span><span class="turn-step locked">Move + action <b>unavailable at 0 HP</b></span></div>`;
}
function renderControlledTurnFlag(flag, token, name) {
  const state = turnStageState(token), announcing = turnAnnouncementActive(token);
  flag.className = 'yours';
  const cue = announcing
    ? `The Dungeon Master announces ${name}'s turn. Movement and one action unlock together.`
    : !token.acted && !positionChosen(token)
      ? `Move up to ${movementLeft(token)} ft and take one action in either order. You may split movement before and after the action.`
      : state.cue;
  flag.innerHTML = `<div class="turn-copy"><span class="turn-kicker">${announcing ? 'Dungeon Master announcing' : 'Your turn'}</span><strong>${esc(name)}'s turn</strong><span class="turn-cue">${esc(cue)}</span></div><div class="turn-steps">${renderTurnResourceSteps(token, state.stage)}</div>`;
}
function renderCompanionTurnFlag(flag, token, name) {
  const state = turnStageState(token); flag.className = 'companion';
  flag.innerHTML = `<div class="turn-copy"><span class="turn-kicker">AI Companion · watching</span><strong>${esc(name)}'s turn</strong><span class="turn-cue">${esc(state.cue)}</span></div><div class="turn-steps">${renderTurnResourceSteps(token, state.stage)}</div>`;
}
function renderRemoteTurnFlag(flag, token, name) {
  const seat = claimedBy(token.slug), player = seat ? seat.name.split(/[\s@]/)[0] : 'another player', state = turnStageState(token);
  flag.className = 'waiting';
  flag.innerHTML = `<div class="turn-copy"><span class="turn-kicker">Watching ${esc(player)}</span><strong>${esc(name)}'s turn</strong><span class="turn-cue">${esc(state.cue)} Skills below are view-only on your device.</span></div><div class="turn-steps">${renderTurnResourceSteps(token, state.stage)}</div>`;
}
function renderMonsterTurnFlag(flag, token, name) {
  const state = turnStageState(token); flag.className = 'enemy';
  flag.innerHTML = `<div class="turn-copy"><span class="turn-kicker">Dungeon Master · watching</span><strong>${esc(name)}'s turn</strong><span class="turn-cue">${esc(state.cue)}</span></div><div class="turn-steps">${renderTurnResourceSteps(token, state.stage)}</div>`;
}
/** @description Keep turn ownership visible even while another presentation is layered over it. */
function setTurnFlag() {
  const flag = $('turnflag'), token = board && board.mode === 'combat' ? activeToken() : null;
  if (!flag) return;
  if (renderPresentationGateFlag(flag, token) || renderSharedRollFlag(flag, board && board.sharedRoll)) return;
  if (!token || token.dead || token.fled) { flag.className = 'hidden'; return; }
  const name = shortTokenLabel(token);
  if (isDowned(token)) renderDownedTurnFlag(flag, token, name);
  else if (token.kind === 'pc' && controls(token)) renderControlledTurnFlag(flag, token, name);
  else if (token.kind === 'pc' && isAICompanion(token)) renderCompanionTurnFlag(flag, token, name);
  else if (token.kind === 'pc') renderRemoteTurnFlag(flag, token, name);
  else renderMonsterTurnFlag(flag, token, name);
}
function automationClientIdentity() {
  try {
    let id = sessionStorage.getItem(AUTOMATION_SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(AUTOMATION_SESSION_KEY, id);
    }
    return id;
  } catch (_error) {
    try { return crypto.randomUUID(); }
    catch (_fallbackError) { return `${Date.now()}-${Math.random()}`; }
  }
}
const automationClientId = automationClientIdentity();
const automatedResultJobs = new Map(), automatedMovementJobs = new Map();
const locallyNarratedResults = new Set(), locallyNarratedMovements = new Set(), locallyPresentedCues = new Set();
const AUTOMATION_LEASE_MS = 20000;
const AUTOMATION_HEARTBEAT_MS = 5000;
function cancelMonsterTimer() {
  if (monsterTimer) clearTimeout(monsterTimer);
  monsterTimer = null;
}
function turnKey(token, serial) {
  return `${campaign && campaign.campaign_id || ''}:${board && board.sceneId || ''}:${Number(serial == null ? board && board.turnSerial : serial) || 0}:${token && token.id || ''}`;
}
function turnAnnouncementActive(token) {
  return !!(token && turnAnnouncementPending === turnKey(token));
}
function cancelAutomatedWork() {
  automationEpoch++;
  turnAnnouncementPending = null;
  cancelMonsterTimer();
  document.querySelectorAll('.death-save-box').forEach((el) => {
    if (typeof el._cancelRoll === 'function') el._cancelRoll();
    else el.remove();
  });
}
function resetTurnPresentationMemory() {
  cancelCombatDice();
  automatedResultJobs.clear(); automatedMovementJobs.clear(); playerResultJobs.clear();
  locallyNarratedResults.clear(); locallyNarratedMovements.clear(); locallyPresentedCues.clear();
  turnResolutionPending = null; turnAnnouncementPending = null; turnAdvanceInFlight = null; automationPhase = null;
  lastTurnAnnouncement = ''; completedTurnAnnouncement = ''; downNoticeKey = '';
  stopSpeech(); dismissCaption();
}
function automationRun(actor, kind) {
  return {
    epoch: automationEpoch,
    campaignId: campaign && campaign.campaign_id,
    sceneId: board && board.sceneId,
    actorId: actor && actor.id,
    serial: Number(board && board.turnSerial),
    kind: kind || (actor && actor.kind),
  };
}
function automationActor(run) {
  const current = board && board.mode === 'combat' ? activeToken() : null;
  return run && run.epoch === automationEpoch && campaign && campaign.campaign_id === run.campaignId &&
    board && !presentationGatePending() && !sharedRollPending(board) && board.sceneId === run.sceneId && Number(board.turnSerial) === Number(run.serial) &&
    current && current.id === run.actorId && current.kind === run.kind ? current : null;
}
function scheduleMonsterCallback(monster, delay, callback) {
  scheduleAutomatedCallback(monster, 'monster', delay, callback);
}
function scheduleCompanionCallback(companion, delay, callback) {
  scheduleAutomatedCallback(companion, 'pc', delay, callback);
}
function scheduleAutomatedCallback(actor, expectedKind, delay, callback) {
  cancelMonsterTimer();
  const run = automationRun(actor, expectedKind);
  monsterTimer = setTimeout(() => {
    monsterTimer = null;
    const current = automationActor(run);
    if (!current) return;
    if (_introEl) { scheduleAutomatedCallback(current, expectedKind, 500, callback); return; }
    callback(current, run);
  }, delay);
}
function announceTurn(token) {
  const key = `${campaign && campaign.campaign_id || ''}:${board.sceneId || ''}:${Number(board.turnSerial) || 0}:${token.id}`;
  if (key === lastTurnAnnouncement) return lastTurnSpeech;
  lastTurnAnnouncement = key;
  const name = shortTokenLabel(token), seat = token.kind === 'pc' ? claimedBy(token.slug) : null;
  const text = movementStoryPending(token)
    ? `${name} reaches the chosen position.`
    : turnStoryPending(token)
    ? `${name}'s action lands. The Dungeon Master has the result.`
    : isDowned(token)
    ? `${name} lies at the edge of death. Roll the death saving throw.`
    : token.kind === 'monster'
      ? combatAutomatedTurnNarration(token)
      : !seat ? combatAutomatedTurnNarration(token)
        : seat.me ? `${name}, the field is yours. Move and act in either order; you may split your movement.`
          : `${seat.name.split(/[\s@]/)[0]} has control of ${name}.`;
  lastTurnSpeech = Promise.resolve(presentPhase(text, 1300, true)).then((status) => {
    if (lastTurnAnnouncement === key) completedTurnAnnouncement = key;
    return status;
  });
  return lastTurnSpeech;
}
function clearTurnSelection() {
  selected = null; clearReachable(); renderDock(); setTurnFlag();
}
function resumeCompletedDeathSave(token) {
  if (!hasDeathSaveResult(token) || (!turnStoryPending(token) && isConscious(token))) return false;
  clearTurnSelection();
  const score = deathSaveScore(token);
  const result = token.dead ? 'final failure' : token.stable ? 'stable' : `${score.successes} saves · ${score.failures} failures`;
  if (turnStoryPending(token)) {
    banner(`${shortTokenLabel(token)}’s death save is confirmed (${result}) · finishing that exact result and narration before initiative moves`);
    if (controls(token) || isOwner()) void finishDeathSaveResult(automationRun(token, 'pc'));
  } else {
    banner(`${shortTokenLabel(token)}’s death save story is complete (${result}) · initiative is moving on`);
    if (controls(token) || isOwner()) scheduleAutomatedCallback(token, 'pc', 900, (current) => {
      if (hasDeathSaveResult(current) && current.turnResult.complete) void nextTurn();
    });
  }
  return true;
}
function initializeDrivenTurn(token) {
  const drives = (token.kind === 'pc' && (controls(token) || (isOwner() && isAICompanion(token)))) || (token.kind === 'monster' && isOwner());
  if (!drives || Number(token.turnSerial) === Number(board.turnSerial)) return;
  token.turnSerial = Number(board.turnSerial); token.moveRemaining = Number(token.speed) || 0;
  token.moved = false; token.positionSet = false; token.acted = false;
  delete token.turnResult; delete token.movementResult;
}
function beginDownedTurn(token, turnSpeech) {
  clearTurnSelection();
  const score = deathSaveScore(token), cue = `${shortTokenLabel(token)} is DOWN · ${score.successes} saves · ${score.failures} failures`;
  if (controls(token)) {
    banner(`${cue} · roll a death save now`);
    void Promise.resolve(turnSpeech).catch(() => 'speech-error').then(() => showDeathSave(token, false));
    return;
  }
  if (isAICompanion(token) && isOwner()) {
    banner(`${cue} · AI death save`);
    void Promise.resolve(turnSpeech).catch(() => 'speech-error').then(() => scheduleVisibleCompanionDeathSave(token));
    return;
  }
  const who = claimedBy(token.slug);
  banner(`Waiting for ${who ? who.name.split(/[\s@]/)[0] : 'the player'} to roll ${shortTokenLabel(token)}’s death save…`);
}
function scheduleVisibleCompanionDeathSave(token) {
  const current = activeToken();
  if (!current || current.id !== token.id || Number(board.turnSerial) !== Number(token.turnSerial) || !isDowned(current)) return;
  scheduleCompanionCallback(current, dmNpcPaceMs(650), (companion, run) => showDeathSave(companion, true, run));
}
function finishControlledTurnAnnouncement(token, key) {
  const current = activeToken();
  if (!current || current.id !== token.id || turnKey(current) !== key || turnAnnouncementPending !== key) return;
  turnAnnouncementPending = null;
  if (current.acted && turnStoryPending(current)) {
    renderDock();
    banner(`${shortTokenLabel(current)}’s action is confirmed · finishing the exact result and Dungeon Master narration`);
    void finishPlayerResult(automationRun(current, 'pc'), turnKey(current));
    return;
  }
  if (current.acted && current.turnResult && current.turnResult.complete
      && turnResolutionPending === key) turnResolutionPending = null;
  selected = current; computeReachable(current); renderDock();
  banner(current.acted
    ? `${shortTokenLabel(current)} · attack complete — ${movementLeft(current)} ft movement remains`
    : `${shortTokenLabel(current)} · You — attack from here or move first; ${movementLeft(current)} ft available`);
}
function beginControlledHeroTurn(token, turnSpeech) {
  const key = turnKey(token); turnAnnouncementPending = key;
  selected = null; clearReachable(); renderDock();
  banner(`${shortTokenLabel(token)} · Dungeon Master is announcing your turn; controls unlock when the cue finishes`);
  if (completedTurnAnnouncement === key) { finishControlledTurnAnnouncement(token, key); return; }
  void Promise.resolve(turnSpeech).catch(() => 'speech-error').then(() => finishControlledTurnAnnouncement(token, key));
}
function beginCompanionTurn(token, turnSpeech) {
  clearTurnSelection();
  const cue = `${shortTokenLabel(token)} · AI Companion`;
  banner(movementStoryPending(token)
    ? `${cue} — position saved; finishing its exact movement narration before the action`
    : isOwner() ? `${cue} — choosing a position; movement and action will be shown` : `${cue} — watch the host show each movement and action phase`);
  if (!isOwner()) return;
  void Promise.resolve(turnSpeech).catch(() => 'speech-error').then(() => {
    const current = activeToken();
    if (!current || current.id !== token.id || current.kind !== 'pc' || Number(board.turnSerial) !== Number(token.turnSerial) || !isAICompanion(current)) return;
    scheduleCompanionCallback(current, dmNpcPaceMs(650), (_companion, run) => companionTurn(run));
  });
}
function beginRemoteHeroTurn(token) {
  clearTurnSelection();
  const who = claimedBy(token.slug);
  banner(`Waiting on ${who ? who.name.split(/[\s@]/)[0] : 'another player'} (${shortTokenLabel(token)})…`);
}
function beginMonsterTurn(token, turnSpeech) {
  clearTurnSelection();
  if (!isOwner()) { banner(`${shortTokenLabel(token)}'s turn…`); return; }
  banner(movementStoryPending(token) ? `${shortTokenLabel(token)}'s position is saved — narrating it before the attack…` : `${shortTokenLabel(token)}'s turn…`);
  void Promise.resolve(turnSpeech).catch(() => 'speech-error').then(() => {
    const current = activeToken();
    if (!current || current.id !== token.id || current.kind !== 'monster' || Number(board.turnSerial) !== Number(token.turnSerial)) return;
    scheduleMonsterCallback(current, dmNpcPaceMs(650), (_monster, run) => monsterTurn(run));
  });
}
function beginTurn() {
  updateInitiativeBar();
  if (pendingPresentationGate()) { lockPendingPresentationGate(); void resumePendingPresentationGate(); return; }
  if (sharedRollPending(board)) {
    cancelAutomatedWork(); clearTurnSelection(); presentSharedRoll(board.sharedRoll); return;
  }
  const token = activeToken();
  if (resumeCompletedDeathSave(token)) return;
  if (!token || !canTakeTurn(token)) { clearTurnSelection(); if (isOwner()) void nextTurn(); return; }
  selectedAction = null; inspect = null;
  if (!Number.isFinite(Number(board.turnSerial))) board.turnSerial = 1;
  initializeDrivenTurn(token);
  const turnSpeech = announceTurn(token);
  if (TV) { clearTurnSelection(); banner(`${shortTokenLabel(token)}'s turn`); return; }
  if (isDowned(token)) beginDownedTurn(token, turnSpeech);
  else if (token.kind === 'pc' && controls(token)) beginControlledHeroTurn(token, turnSpeech);
  else if (token.kind === 'pc' && isAICompanion(token)) beginCompanionTurn(token, turnSpeech);
  else if (token.kind === 'pc') beginRemoteHeroTurn(token);
  else beginMonsterTurn(token, turnSpeech);
}
async function nextTurn() {
  if (!board || board.mode !== 'combat' || sharedRollPending(board)) return false;
  const priorRound = Number(board.round) || 1;
  const sourceKey = turnKey(activeToken());
  if (turnAdvanceInFlight === sourceKey) return false;
  turnAdvanceInFlight = sourceKey;
  if (await checkEnd()) { turnAdvanceInFlight = null; return true; }
  cancelAutomatedWork(); telegraph = null; delete board.telegraph;
  automationPhase = null; turnResolutionPending = null;
  board.turnIndex++;
  board.turnSerial = (Number(board.turnSerial) || 0) + 1;
  if (board.turnIndex >= board.order.length) { board.turnIndex = 0; board.round++; }
  let guard = 0;
  while (guard++ < board.order.length) { const t = activeToken(); if (canTakeTurn(t)) break; board.turnIndex++; if (board.turnIndex >= board.order.length) { board.turnIndex = 0; board.round++; } }
  persist();
  const saved = await flushPendingState();
  if (turnAdvanceInFlight !== sourceKey) return false;
  turnAdvanceInFlight = null;
  if (!saved) { renderDock(); return false; }
  if (Number(board.round) > priorRound) await requestDungeonMasterRoundHighlight();
  beginTurn();
  return true;
}
async function checkEnd() {
  const e = ENG.checkEnd(W());
  if (e === 'victory') { await victory(); return true; }
  if (e === 'defeat') { await defeat(); return true; }
  return false;
}

function acknowledgeDowned(hero) {
  if (TV || !controls(hero) || !isDowned(hero)) return Promise.resolve('not-local');
  const key = `${campaign && campaign.campaign_id || ''}:${hero.id}:${Number(board.turnSerial) || 0}`;
  if (downNoticeKey === key && acknowledgeDowned.pending) return acknowledgeDowned.pending;
  downNoticeKey = key;
  acknowledgeDowned.pending = new Promise((resolve) => {
    const score = deathSaveScore(hero);
    overlay(`<h1>${esc(shortTokenLabel(hero))} is DOWN — not gone</h1><p class="read">${esc(shortTokenLabel(hero))} remains on the board at 0 HP. On ${esc(shortTokenLabel(hero))}’s turn, roll one unmodified d20 death save: 10–20 succeeds, 1–9 fails, a natural 1 counts twice, and a natural 20 restores 1 HP.</p>
      <div class="outcome-grid"><span><b>${score.successes}/3</b> successes</span><span><b>${score.failures}/3</b> failures</span><span><b>0 HP</b> healing can revive</span></div><button class="big" id="ovDownContinue">I understand — continue</button>`, 'downed-notice');
    $('ovDownContinue').onclick = () => { closeOverlay(); acknowledgeDowned.pending = null; resolve('acknowledged'); };
  });
  return acknowledgeDowned.pending;
}

function showDeathSave(hero, automated, suppliedRun) {
  const activeAtOpen = board && activeToken();
  if (!hero || !board || !activeAtOpen || !isDowned(hero) || hero.stable || hero.dead || activeAtOpen.id !== hero.id || deathSaveResolvedThisTurn(hero)) return Promise.resolve(null);
  const run = suppliedRun || automationRun(activeAtOpen, 'pc');
  if (!automationActor(run)) return Promise.resolve(null);
  const key = `${run.campaignId}:${run.sceneId}:${run.actorId}:${run.serial}:${run.epoch}`;
  const existing = $('stage').querySelector(`.death-save-box[data-roll-key="${key}"]`);
  if (existing) return existing._resultPromise || Promise.resolve(null);
  let finishResult, settled = false, autoTimer = null;
  const resultPromise = new Promise((resolve) => { finishResult = (value) => { if (!settled) { settled = true; resolve(value); } }; });
  const score = deathSaveScore(hero), el = document.createElement('div');
  const priorFailure = score.failures ? ` · ${score.failures} failure${score.failures === 1 ? '' : 's'} already recorded before this roll` : '';
  el.className = 'dicebox death-save-box'; el.dataset.rollKey = key; el._resultPromise = resultPromise;
  el.innerHTML = `<div class="dice-ask"><b>${esc(shortTokenLabel(hero))} is DOWN.</b><br>Death save ${score.successes} successes · ${score.failures} failures${priorFailure} · no modifier</div>
    <div class="die" id="deathDie"><span class="dnum">20</span></div><div class="dice-mod">10+ succeeds · natural 1 = two failures · natural 20 = rise with 1 HP</div><div class="dice-verdict"></div>
    <div class="dice-actions"><button class="big" id="deathRoll">${automated ? 'AI ROLLING…' : 'ROLL DEATH SAVE'}</button></div>`;
  $('stage').appendChild(el);
  const die = el.querySelector('#deathDie'), num = el.querySelector('.dnum'), verdict = el.querySelector('.dice-verdict'), rollButton = el.querySelector('#deathRoll');
  if (automated) rollButton.disabled = true;
  let rolling = false;
  el._cancelRoll = () => { if (autoTimer) clearTimeout(autoTimer); if (el.isConnected) el.remove(); finishResult(null); };
  const doRoll = async () => {
    let rollingHero = automationActor(run);
    if (rolling || !el.isConnected || !rollingHero || !isDowned(rollingHero) || deathSaveResolvedThisTurn(rollingHero) || (!automated && !controls(rollingHero))) return;
    rolling = true; rollButton.disabled = true; rollButton.textContent = 'CONFIRMING ROLL...'; unlockAudio();
    const natural = ENG.die(20), result = ENG.resolveDeathSave(rollingHero, run.serial, natural);
    if (result.blocked) { verdict.textContent = result.error || 'This death save was already resolved.'; el.remove(); finishResult(result); return; }
    num.textContent = '?'; verdict.textContent = 'Locking the exact die with the shared table...';
    automationPhase = { id: rollingHero.id, cue: `Death save result · ${result.text}` };
    rollingHero.turnResult = makeTurnResult(run, result.text, null, result.rolls);
    persist(); updateInitiativeBar(); renderDock();
    const saved = await flushPendingState();
    if (!saved) {
      if (el.isConnected) { verdict.textContent = 'This roll was not confirmed. The shared board was restored; roll again when prompted.'; setTimeout(() => el._cancelRoll(), 1400); }
      finishResult(null);
      return;
    }
    if (el.isConnected) el.remove();
    if (automationActor(run)) await finishDeathSaveResult(run, automated);
    finishResult(result);
  };
  rollButton.onclick = automated ? null : doRoll; die.onclick = automated ? null : doRoll;
  if (automated) autoTimer = setTimeout(() => { autoTimer = null; void doRoll(); }, dmNpcPaceMs(900));
  return resultPromise;
}

async function doAction(target) {
  const actor = selected, action = selectedAction;
  const run = automationRun(actor, 'pc'), pendingKey = turnKey(actor, run.serial);
  if (!automationActor(run) || !controls(actor)) return;
  selectedAction = null;
  const res = withShow(actor, action, target, () => resolveAction(actor, action, target));
  if (res.blocked) { banner(res.text); renderDock(); return; }
  actor.positionSet = true;
  actor.acted = true;
  actor.turnResult = makeTurnResult(run, res.text, null, res.rolls);
  turnResolutionPending = pendingKey;
  persist(); renderDock(); banner('Locking your result with the shared table…');
  const saved = await flushPendingState();
  if (!saved || !automationActor(run)) {
    if (turnResolutionPending === pendingKey) turnResolutionPending = null;
    renderDock(); banner('The action could not be confirmed with the table. Review the synced board before continuing.'); return;
  }
  await finishPlayerResult(run, pendingKey);
}

// Unclaimed heroes are explicitly AI companions. Only the host drives them;
// every delayed phase is tied to both token id and turn serial so a sync, skip,
// defeat, or turn change can never make an old callback act for somebody else.
