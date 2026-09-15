/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-14 15:20:00 | maintainer@emeraldcoastsystemsgroup.com     | Carry the dock out of table-screens.js, which had grown past the package's own 800 executable-line decomposition guard. The dock is one concern - whose turn it is, what that actor may do right now, and why a control is locked - so it moves whole rather than being trimmed to fit: turn-button state, the identity and hero/downed/automated variants, action selection, and the initiative bar.
 */

'use strict';

// ── Dock ─────────────────────────────────────────────────────────────────────
function configureTurnButtons(active) {
  const resultComplete = active && active.turnResult && active.turnResult.complete;
  if (resultComplete && turnResolutionPending === turnKey(active)) turnResolutionPending = null;
  const inCombat = !!(board && board.mode === 'combat'), storyPending = turnStoryPending(active), movementPending = movementStoryPending(active), presenting = presentationGatePending();
  const announcing = turnAnnouncementActive(active);
  const playerCanEnd = active && active.kind === 'pc' && controls(active) && active.acted;
  $('endTurn').disabled = !(inCombat && !presenting && active && !isDowned(active) && !turnResolutionPending && !movementPending && !storyPending && !announcing && playerCanEnd);
  const watching = active && (active.kind === 'monster' || isAICompanion(active));
  $('endTurn').textContent = watching ? `Watching ${shortTokenLabel(active)}`
    : active && active.kind === 'pc' && !controls(active) ? `Waiting for ${shortTokenLabel(active)}` : 'End Turn';
  const canMove = inCombat && !presenting && active && active.kind === 'pc' && controls(active)
    && !isDowned(active) && (!storyPending || active.acted) && !announcing && movementLeft(active) > 0;
  $('moveBtn').disabled = !canMove;
  $('moveBtn').textContent = active && active.kind === 'pc'
    ? `${active.acted ? 'Move after attack' : 'Move'} · ${movementLeft(active)} ft` : 'Move';
  const canAttackHere = inCombat && !presenting && active && active.kind === 'pc'
    && controls(active) && !isDowned(active) && !storyPending && !announcing
    && !active.acted && !positionChosen(active);
  $('stayBtn').classList.toggle('hidden', !canAttackHere);
  $('stayBtn').disabled = !canAttackHere;
  $('stayBtn').textContent = 'Attack From Here';
}
function renderDockIdentity(t, isActiveMine) {
  const sheet = boardSheets[t.slug] || sheetOf(t) || {};
  const role = t.kind === 'pc' ? roleOf(sheet) : tokenRoleLabel(t);
  const inv = inventoryOf(sheet), controller = t.kind === 'pc' ? controllerLabel(t) : '';
  const condition = isDowned(t) ? (t.stable ? ' · STABLE' : ' · DOWN — death save due') : t.kind === 'pc' && t.dead ? ' · FALLEN' : '';
  $('who').innerHTML = `<div class="who-top"><div><div class="name">${esc(tokenDisplayName(t))}${esc(condition)}</div>${controller ? `<span class="controller-badge ${isAICompanion(t) ? 'ai' : 'human'}">${esc(controller)}</span>` : ''}</div>${t.kind === 'pc' ? `<button id="sheetBtn" class="sheet-btn" title="Open character sheet and inventory">🎒 ${inv.items.length}</button>` : ''}</div>
    <div class="sub">${sheet.race ? esc(sheet.race + ' ' + sheet.class) : esc((content.monsters[t.ref] || {}).type || '')}</div>${role ? `<div class="role">${esc(role)}</div>` : ''}
    <div class="bars">❤ ${t.hp}/${t.maxHp} &nbsp; 🛡 ${t.ac} &nbsp; 👟 ${t.kind === 'pc' && isActiveMine ? movementLeft(t) + '/' : ''}${t.speed}ft${slotStr(t)}</div>`;
  if ($('sheetBtn')) $('sheetBtn').onclick = () => showCharacterSheet(t);
}
function renderDownedDock(t, acts) {
  const score = deathSaveScore(t), mine = controls(t) && !presentationGatePending();
  const instruction = t.stable ? 'This hero remains visible and skips turns until healed.' : mine ? 'Roll one plain d20. 10+ succeeds; 3 successes stabilize; 3 failures mean death.' : isAICompanion(t) ? 'The AI Companion rolls visibly on the host table.' : 'Only the player who controls this hero can roll.';
  acts.innerHTML = `<div class="death-save-dock"><b>${t.stable ? 'Stable at 0 HP' : `Death saves: ${score.successes} successes · ${score.failures} failures`}</b><span>${instruction}</span>${mine && !t.stable ? '<button class="big" id="deathSaveBtn">Roll Death Save</button>' : ''}</div>`;
  if ($('deathSaveBtn')) $('deathSaveBtn').onclick = () => showDeathSave(t, false);
}
function dockLockMessage(t, isActiveMine) {
  if (presentationGatePending()) return `${shortTokenLabel(t)}'s turn is next. The opening is finishing; these options are view-only.`;
  if (turnAnnouncementActive(t)) return 'The Dungeon Master is announcing this turn. Movement and actions unlock when the cue finishes.';
  if ((turnResolutionPending || turnStoryPending(t)) && !(t.acted && movementLeft(t) > 0)) return 'The action is confirmed. Its exact result and Dungeon Master narration must finish before End Turn unlocks.';
  if (isActiveMine) return t.acted
    ? movementLeft(t) > 0 ? 'Action saved — movement remains available while the Dungeon Master finishes speaking.' : 'Action used — End Turn when ready.'
    : `Attack from this square or move first. You have ${movementLeft(t)} ft and one action; unused movement remains after the attack.`;
  if (isAICompanion(t)) return `Watching ${shortTokenLabel(t)}. The AI controls this turn; every available skill stays visible but cannot be selected.`;
  const seat = claimedBy(t.slug); return `🔒 ${seat ? seat.name.split(/[\s@]/)[0] : 'Another player'} controls this hero. Skills are view-only on your device.`;
}
function appendDockAction(acts, action, live, isActiveMine, t) {
  const resource = actionResourceStatus(t, action), usable = live && resource.available;
  const button = document.createElement('button'); button.className = 'act' + (selectedAction === action ? ' sel' : '') + (usable ? '' : ' disabled') + (resource.available ? '' : ' resource-spent'); button.disabled = !usable;
  const icon = action.type === 'spell' ? '✦' : action.type === 'feature' ? '★' : '⚔';
  const range = action.delivery === 'melee' ? 'melee' : action.delivery === 'self' ? 'self' : (action.range + 'ft');
  button.title = !resource.available ? resource.detail : (action.text || '');
  button.innerHTML = `<div class="an">${icon} ${esc(action.name)}</div><div class="ax">${esc(effectStr(action))}</div><div class="ar">${esc(range)}${action.type === 'spell' && action.slot ? ' · L' + action.slot : ''}</div><div class="resource-label ${resource.available ? 'ready' : 'spent'}">${esc(resource.detail)}</div>`;
  if (usable) button.onclick = () => selectAction(action); acts.appendChild(button);
}
function renderHeroDock(t, isActiveMine, acts) {
  acts.innerHTML = '';
  if (isDowned(t)) { renderDownedDock(t, acts); return; }
  const live = !presentationGatePending() && isActiveMine && !t.acted && !turnResolutionPending && !turnStoryPending(t) && !turnAnnouncementActive(t);
  const allActions = actionsOf(t), readyActions = allActions.filter((action) => actionResourceStatus(t, action).available);
  const spentActions = allActions.filter((action) => !actionResourceStatus(t, action).available);
  if (!isActiveMine) appendDockWatchNote(acts, dockLockMessage(t, false));
  (isActiveMine ? readyActions : allActions).forEach((action) => appendDockAction(acts, action, live, isActiveMine, t));
  if (isActiveMine && spentActions.length) {
    const note = document.createElement('div'); note.className = 'watch-note spent-note';
    note.innerHTML = `<b>SPENT SPELLS</b><span>${esc(spentActions.map((action) => action.name).join(', '))}</span><small>${esc(actionResourceStatus(t, spentActions[0]).detail)} · open 🎒 for full potential</small>`;
    acts.appendChild(note);
  }
  if (live || !isActiveMine) return;
  const note = document.createElement('div'); note.style.cssText = 'color:var(--muted);align-self:center;padding:0 8px;font-size:13px';
  note.textContent = dockLockMessage(t, isActiveMine); acts.appendChild(note);
}
function appendDockWatchNote(acts, message) {
  const note = document.createElement('div'); note.className = 'watch-note';
  note.innerHTML = `<b>VIEW ONLY</b><span>${esc(message)}</span>`; acts.appendChild(note);
}
function renderAutomatedDock(t, acts) {
  acts.innerHTML = ''; appendDockWatchNote(acts, `Watching ${shortTokenLabel(t)}. The Dungeon Master controls this turn.`);
  actionsOf(t).forEach((action) => appendDockAction(acts, action, false, false, t));
}
function renderDock() {
  if (TV) return;
  renderQuestThread();
  if (board && board.mode === 'exploration' && activeExploration()) {
    renderExplorationDock(); return;
  }
  setTurnFlag();
  const active = activeToken(), acts = $('actions'); configureTurnButtons(active);
  renderGameplayRail();
  if (!active || active.kind === 'prop') { $('who').innerHTML = '<div class="name">—</div>'; acts.innerHTML = ''; return; }
  const isActiveMine = board.mode === 'combat' && active.kind === 'pc' && controls(active) && !isDowned(active);
  renderDockIdentity(active, isActiveMine);
  if (active.kind !== 'pc') { renderAutomatedDock(active, acts); return; }
  renderHeroDock(active, isActiveMine, acts);
}
function slotStr(t) { if (!t.slots) return ''; const k = Object.keys(t.slots); return k.length ? ' &nbsp; ✦ ' + k.map((l) => `L${l}:${t.slots[l]}`).join(' ') : ''; }
function selectAction(a) {
  if (presentationGateBlocksInput()) return;
  const t = activeToken(); if (!controls(t)) return;
  if (turnAnnouncementActive(t)) { banner('Wait for the Dungeon Master to announce your turn.'); return; }
  if (isDowned(t) || turnStoryPending(t)) { banner(isDowned(t) ? 'Roll the death save first.' : 'The Dungeon Master is still narrating this action.'); return; }
  if (t.acted) { banner('Already acted this turn — End Turn.'); return; }
  const resource = actionResourceStatus(t, a);
  if (!resource.available) { banner(resource.detail); return; }
  selected = t;
  if (a.mode === 'heal' && a.delivery === 'self') { doAction(t); return; }
  selectedAction = selectedAction === a ? null : a;
  const tg = selectedAction ? validTargets(t, a) : [];
  if (selectedAction && !tg.length) { banner('No targets in range — move closer or pick another action.'); selectedAction = null; }
  else if (selectedAction) banner(a.aoeShape ? `Aim ${a.name} — tap an enemy to sweep the ${a.aoeShape} toward them` : `Aim ${a.name} — tap a highlighted target`);
  renderDock();
}
function updateInitiativeBar() {
  const bar = $('initiative');
  const code = campaign && campaign.join_code ? ` &nbsp;·&nbsp; join code <b style="color:var(--amber)">${esc(campaign.join_code)}</b>` : '';
  const scene = SC() ? ` &nbsp;·&nbsp; ${esc(SC().title)}` : '';
  const pcs = board.tokens.filter((t) => t.kind === 'pc' && !t.fled), foes = board.tokens.filter((t) => t.kind === 'monster' && !t.fled);
  const standing = pcs.filter(isConscious).length;
  const down = pcs.filter((t) => isDowned(t) && !t.stable).length;
  const stable = pcs.filter((t) => isDowned(t) && t.stable).length;
  const fallen = pcs.filter((t) => t.dead).length;
  const enemies = foes.filter((t) => !t.dead).length;
  const status = board.mode === 'setup' ? `Party: ${pcs.length} ALIVE`
    : board.mode === 'exploration' ? `Party: ${standing} ALIVE · ${discoveredLeadIds().size}/${explorationRequirement()} essential leads`
      : `Party: ${standing} ALIVE${down ? ` · ${down} DOWN` : ''}${stable ? ` · ${stable} STABLE` : ''}${fallen ? ` · ${fallen} FALLEN` : ''} · Enemies: ${enemies}/${foes.length}`;
  const phase = board.mode === 'setup' ? 'Party lobby' : board.mode === 'exploration' ? 'Investigation'
    : board.mode === 'resolved' ? (SC().kind === 'exploration' ? 'Chapter complete' : 'Battle complete')
      : board.mode === 'complete' ? 'Campaign complete' : board.mode === 'defeat' ? 'Party defeated' : `Round ${board.round || 1}`;
  bar.innerHTML = `<span class="round">${phase}${scene}<small>${status}</small>${code}</span>`;
  board.order.forEach((id) => {
    const t = board.tokens.find((x) => x.id === id); if (!t) return;
    const frac = t.hp / t.maxHp, cls = frac > 0.5 ? '' : frac > 0.25 ? 'hurt' : 'low', img = tokenImg(t);
    const chip = document.createElement('div');
    const defeated = t.dead || t.fled;
    const downed = isDowned(t), score = deathSaveScore(t);
    chip.className = 'init-chip' + (board.mode === 'combat' && canTakeTurn(t) && activeToken() && activeToken().id === id ? ' active' : '') + (defeated ? ' dead' : '') + (downed ? ' downed' : '');
    const face = img && img.complete && img.naturalWidth ? `<span class="face" style="background-image:url('${img.src}')"></span>` : `<span class="glyph">${t.glyph || '@'}</span>`;
    const controller = t.kind === 'pc' ? controllerLabel(t) : tokenRoleLabel(t);
    const hpText = downed ? (t.stable ? 'Stable' : `Down S${score.successes}/F${score.failures}`) : defeated ? (t.fled ? 'Fled' : t.kind === 'pc' ? 'Fallen' : 'Defeated') : t.hp + '/' + t.maxHp;
    chip.innerHTML = `${face}<span class="nm">${esc(shortTokenLabel(t))}</span>${controller ? `<span class="controller ${isAICompanion(t) ? 'ai' : ''}">${esc(controller)}</span>` : ''}<span class="hp ${cls}">${hpText}</span>`;
    if (t.kind === 'pc') {
      chip.classList.add('inspectable'); chip.tabIndex = 0; chip.title = `${controller}: open ${t.name}'s character sheet and inventory`;
      chip.onclick = () => showCharacterSheet(t);
      chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCharacterSheet(t); } };
    } else if (controller) {
      chip.title = `${tokenDisplayName(t)} · ${controller}`;
    }
    bar.appendChild(chip);
  });
}
