/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract character sheets, campaign library, join and party screens, control wiring, boot, and the animation scheduler into a focused tabletop module.
 * 2026-07-21 19:59:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Separate dock controls, character details, action availability, and turn-status variants so each visible phase has one focused renderer.
 * 2026-07-21 20:55:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Show the Dungeon Master announcement phase and lock movement, actions, and End Turn until it completes.
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Render the shared Dungeon Master presentation phase and keep every actionable control disabled until its persisted completion.
 * 2026-07-21 22:29:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep overview cards visible through narration and expose fixed natural narrator status, mute, and retry controls.
 * 2026-07-21 22:36:06 | roger.murphy@emeraldcoastsystemsgroup.com  | Adopt claim-driven encounter revisions before an immediate Start so lobby ownership changes cannot create a false conflict.
 * 2026-07-21 23:07:08 | roger.murphy@emeraldcoastsystemsgroup.com  | Surface host-only abandoned-seat recovery on both the setup Lobby and in-progress Party screens.
 * 2026-07-21 23:31:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Resume live initiative before generating a catch-up recap so narration can never strand a solo player behind an unfinished AI phase.
 * 2026-07-22 00:11:24 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the active actor's options visible as read-only controls and replace ambiguous automation buttons with explicit watching labels.
 * 2026-07-22 00:18:41 | roger.murphy@emeraldcoastsystemsgroup.com  | Let Voice retry an interrupted scene narration without reopening or relocking its completed gameplay gate.
 * 2026-07-22 01:11:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Make My Games distinguish Resume, end-state Playback, Start New, Join by Code, Quit to My Games, and permanent Leave Campaign actions.
 * 2026-07-22 01:29:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Enable natural narration for every participant and preserve only an explicit local mute when switching between owned and joined campaigns.
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Refresh the persistent quest thread with every dock render and campaign transition.
 * 2026-07-22 23:04:49 | roger.murphy@emeraldcoastsystemsgroup.com  | Wire a table-only full-screen control with honest state and Escape recovery.
 * 2026-07-22 23:30:56 | roger.murphy@emeraldcoastsystemsgroup.com  | Load the full character sheet and lock resource-spent actions with an explicit reason.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the immersive gameplay rail synchronized and make DM conversation discoverable without duplicate full-screen wiring.
 * 2026-07-23 00:31:18 | roger.murphy@emeraldcoastsystemsgroup.com  | Show authored NPC names as initiative and dock identity while retaining monster jobs as secondary tactical roles.
 * 2026-07-23 00:41:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Describe Cedar as the table's darker folk storyteller in the voice settings.
 * 2026-07-23 02:35:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Describe the actual Algenib-first narrator chain and remove every Kore reference.
 * 2026-07-23 00:49:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Unlock movement and action together, keep remaining movement after an action, and stop presenting position as a one-way phase.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Release stale completed-action locks, expose Attack From Here, and add functional spoken-action, dice-math, and NPC-pace controls.
 * 2026-07-23 11:21:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep post-action movement live during narration and label the voice panel as Dungeon Master Settings.
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Require an explicit campaign choice before party building and activate the saved campaign's authored world on resume.
 * 2026-07-27 22:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Confirm a successful join on the join screen itself, report a failed table load instead of freezing on the code, and show a joined player their seat rather than the host's join-code instructions.
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
function banner(msg) { const b = $('banner'); b.textContent = msg; b.classList.remove('hidden'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.add('hidden'), 3600); }

// ── Opening titles: Ken-Burns character intro + villains tease ───────────────
// A skippable cinematic before the fight — each hero's portrait sweeps the
// screen with name, epithet (read by the DM's voice), and signature moves;
// then the villains; then "Roll for initiative!".
let _introEl = null;
function introCard(html, bgUrl) {
  return `<div class="intro-card">${bgUrl ? `<div class="intro-bg" style="background-image:url('${bgUrl}')"></div>` : ''}<div class="intro-content">${html}</div></div>`;
}
function playIntro(onDone) {
  const scene = SC();
  const partyToks = board.tokens.filter((t) => t.kind === 'pc');
  const villains = [...new Set(board.tokens.filter((t) => t.kind === 'monster').map((t) => t.ref))];
  const cards = [];
  cards.push({ html: introCard(`<div class="intro-kicker">${esc(content.adventure.theme && content.adventure.theme.label || 'An OSHAL Dungeon Master adventure')}</div><h1 class="intro-title">${esc(content.adventure.title)}</h1><div class="intro-sub">${esc(scene.objective || '')}</div>`, `${API}/art/map/${scene.id}`), say: content.adventure.title });
  partyToks.forEach((t) => {
    const h = boardSheets[t.slug] || sheetOf(t) || {};
    const ab = h.abilities ? `<div class="intro-stats">${['str','dex','con','int','wis','cha'].map((k) => `<span><b>${k.toUpperCase()}</b> ${h.abilities[k]}</span>`).join('')}</div>` : '';
    const sig = (h.actions || []).slice(0, 3).map((a) => a.name).join(' · ');
    cards.push({ html: introCard(`<div class="intro-portrait kb" style="background-image:url('${API}/art/token/${t.slug}')"></div>
      <h1 class="intro-name" style="color:${t.color}">${esc(h.name || t.name)}</h1>
      <div class="intro-class">${esc(h.race || '')} ${esc(h.class || '')} · Level ${h.level || 1} · ❤${h.maxHp} 🛡${h.ac}</div>
      <div class="intro-epithet">“${esc(h.epithet || '')}”</div>${ab}<div class="intro-sig">${esc(sig)}</div>`), say: `${h.name}. ${h.epithet || ''}` });
  });
  if (villains.length) {
    const vs = villains.map((ref) => `<div class="intro-villain"><span class="vp kb" style="background-image:url('${API}/art/token/${ref}')"></span><div class="vn">${esc((content.monsters[ref] || {}).name || ref)}</div><div class="ve">${esc((content.monsters[ref] || {}).epithet || '')}</div></div>`).join('');
    cards.push({ html: introCard(`<div class="intro-kicker" style="color:#ef5030">Standing in their way</div><div class="intro-villains">${vs}</div>`), say: 'But the road is watched. ' + villains.map((r) => (content.monsters[r] || {}).epithet || '').join(' ') });
  }
  const begins = scene.kind === 'exploration' ? 'The story begins' : 'Roll for initiative!';
  cards.push({ html: introCard(`<h1 class="intro-title" style="color:var(--amber)">${begins}</h1>`), say: begins });
  runIntroCards(cards, onDone);
}
function runIntroCards(cards, onDone, ms) {
  if (_introEl && _introEl._finish) _introEl._finish(true);
  else if (_introEl) _introEl.remove();
  const el = document.createElement('div'); el.className = 'intro'; _introEl = el;
  el.innerHTML = `<div class="intro-stage"></div><button class="big ghost intro-skip">Skip ▸</button>`;
  $('stage').appendChild(el);
  const stagebox = el.querySelector('.intro-stage');
  let i = -1, generation = 0, finished = false;
  const finish = (cancelSpeech) => {
    if (finished) return; finished = true; generation++;
    if (cancelSpeech) stopSpeech();
    el.remove(); if (_introEl === el) _introEl = null; if (onDone) onDone();
  };
  el._finish = finish;
  const next = async () => {
    if (finished) return;
    const token = ++generation;
    i++;
    if (i >= cards.length) { finish(false); return; }
    stagebox.innerHTML = cards[i].html;
    const minimum = ms || 5200;
    const spoken = cards[i].say ? speak(cards[i].say) : Promise.resolve('silent');
    await Promise.all([waitMs(minimum), spoken]);
    if (token !== generation || finished) return;
    void next();
  };
  el.querySelector('.intro-skip').onclick = () => finish(true);
  stagebox.onclick = () => { if (finished) return; generation++; stopSpeech(); void next(); };
  void next();
}
/** "Previously on…" stays in the Story rail beside the map. It never lays a
 *  paragraph over the board, and the rail remains open until the voice ends. */
function playCatchup(onDone, narration, speakNow = true) {
  openStory();
  const log = $('log'); if (log) log.scrollTop = log.scrollHeight;
  banner('Previously on… · the full recap is in Story');
  const spoken = narration && speakNow ? speakCaption(narration) : Promise.resolve('silent');
  void Promise.resolve(spoken).catch(() => 'speech-error').then(() => {
    if (onDone) { setStoryOpen(false); onDone(); }
  });
}
async function playCatchupRecap(onDone, speakNow = true) {
  try {
    const recap = await dmRecap(false, false);
    if (recap && recap.ok) playCatchup(onDone, recap.narration, speakNow);
    else playCatchup(onDone, '', speakNow);
  } catch (_e) { playCatchup(onDone, '', speakNow); }
}

// ── Screens ──────────────────────────────────────────────────────────────────
function overlay(html, screen) {
  $('overlayCard').classList.remove('sheet-wide', 'character-full', 'playback-wide'); $('overlayCard').dataset.screen = screen || '';
  $('overlayCard').innerHTML = html; $('overlay').classList.remove('hidden');
}
function closeOverlay() { $('overlay').classList.add('hidden'); $('overlayCard').classList.remove('sheet-wide', 'character-full', 'playback-wide'); $('overlayCard').dataset.screen = ''; }
function setStoryOpen(open) {
  if (TV) return;
  const next = !!open, story = $('story'), playfield = $('playfield');
  syncDmPanelButton(next, false);
  if (story.classList.contains('open') === next && playfield.classList.contains('story-open') === next) return;
  story.classList.toggle('open', next); playfield.classList.toggle('story-open', next);
  const relayout = () => { if (content && board) layout(); };
  requestAnimationFrame(relayout);
  clearTimeout(setStoryOpen._layoutTimer); setStoryOpen._layoutTimer = setTimeout(relayout, 280);
}
function openStory() { setStoryOpen(true); }
let partyDraft = [], importedHeroes = [];
function heroCard(h, extra) {
  const inv = inventoryOf(h), actionNames = (h.actions || []).map((a) => esc(a.name)).join(' · ');
  return `<div class="herocard"><span class="portrait" style="background-image:url('${API}/art/token/${encodeURIComponent(h.id)}')"></span>
    <div class="meta"><div class="hn" style="color:${(h.token && h.token.color) || 'var(--amber)'}">${esc(h.name)}</div>
    <div class="hr">${esc(h.race)} ${esc(h.class)} · ❤${h.maxHp} 🛡${h.ac}</div>
    <div class="ha">${actionNames}${inv.items.length ? ` · 🎒 ${inv.items.length}` : ''}</div>${extra || ''}</div></div>`;
}
function libraryRow(raw) {
  if (!raw || !raw.sheet) return null;
  return { ...raw, character_id: String(raw.character_id || ''), sheet: { ...raw.sheet } };
}
function partyCatalog() {
  const out = new Map((content && content.heroes || []).map((hero) => [hero.id, hero]));
  savedCharacters.forEach((row) => { if (row && row.sheet && !out.has(row.sheet.id)) out.set(row.sheet.id, { ...row.sheet, _libraryCharacterId: row.character_id }); });
  importedHeroes.forEach((hero) => { if (hero && hero.id && !out.has(hero.id)) out.set(hero.id, hero); });
  return Array.from(out.values());
}
function installSavedCharacter(raw) {
  const row = libraryRow(raw); if (!row) return null;
  savedCharacters = savedCharacters.filter((item) => item.character_id !== row.character_id).concat(row);
  return row;
}
async function fetchSavedCharacters() {
  const r = await api('/characters').catch(() => null);
  savedCharacters = ((r && r.characters) || []).map(libraryRow).filter(Boolean);
  return savedCharacters;
}
function clearSessionSurface() {
  campaign = null; board = null; players = []; boardSheets = {}; rev = 0; sheetsRev = ''; lastSeq = 0;
  selected = null; selectedAction = null; inspect = null; reachable = new Set(); movementCosts = new Map();
  $('initiative').innerHTML = '<span class="round">My Games<small>No campaign is running on this screen.</small></span>';
  $('turnflag').className = 'hidden'; $('who').innerHTML = '<div class="name">Choose a campaign</div>';
  $('actions').innerHTML = ''; ['endTurn','stayBtn','moveBtn'].forEach((id) => { if ($(id)) $(id).disabled = true; });
  $('log').innerHTML = ''; renderChoices([]); renderGameplayRail(); setStoryOpen(false);
}
async function quitToGameMenu() {
  if (campaign && board && (saveTimer || saveInFlight || saveAgain)) {
    await Promise.race([flushPendingState().catch(() => false), waitMs(4000)]);
  }
  resetCampaignPipelines(); clearSessionSurface(); recapDone = false;
  await showGameMenu();
}
function campaignPlace(row) {
  const mode = String(row.mode || 'setup');
  if (row.status === 'archived' && !['complete', 'defeat'].includes(mode)) return 'Archived campaign · playback only';
  if (mode === 'setup') return 'Lobby · choose heroes';
  if (mode === 'exploration') return `${row.scene_title || row.scene_id || 'Investigation'} · following leads`;
  if (mode === 'resolved') return 'Battle won · ready for the next scene';
  if (mode === 'complete') return 'Campaign complete';
  if (mode === 'defeat') return 'Party defeated · timeline available';
  return `${row.scene_title || row.scene_id || 'Adventure'}${row.round ? ` · round ${row.round}` : ''}`;
}
function campaignPlaybackOnly(row) {
  return row && (row.status === 'archived' || ['complete', 'defeat'].includes(String(row.mode || '')));
}
async function showGameMenu() {
  const requestId = ++menuRequest;
  overlay('<h1>My Games</h1><p><span class="spin"></span> Loading your campaigns and saved characters…</p>', 'game-library');
  const [gamesResult] = await Promise.all([api('/campaigns').catch(() => null), fetchSavedCharacters().catch(() => [])]);
  if (requestId !== menuRequest || campaign) return;
  const campaigns = (gamesResult && gamesResult.campaigns) || [];
  const rows = campaigns.length ? campaigns.map((row) => {
    const role = row.is_owner ? 'Host' : row.my_character ? `Playing ${row.my_character}` : 'Joined';
    const primary = campaignPlaybackOnly(row) ? `<button data-playback="${esc(row.campaign_id)}">Playback</button>` : `<button data-resume="${esc(row.campaign_id)}">Resume</button>`;
    return `<div class="campaign-row"><div><h2>${esc(row.name || 'Untitled campaign')}<span class="campaign-role">${esc(role)}</span></h2><p>${esc(campaignPlace(row))}${row.player_count ? ` · ${Number(row.player_count)} player${Number(row.player_count) === 1 ? '' : 's'}` : ''}</p></div><div class="campaign-actions">${primary}${row.is_owner ? '' : `<button class="leave" data-leave="${esc(row.campaign_id)}" data-name="${esc(row.name || 'this campaign')}">Leave Campaign</button>`}</div></div>`;
  }).join('') : '<div class="library-empty">No campaigns yet. Start one, or join a friend with their six-character code.</div>';
  overlay(`<h1>My Games</h1><p style="margin-top:0">Choose what to play. Signing in never drops you into a campaign automatically.</p>
    <div class="campaign-list">${rows}</div>
    <div class="library-actions"><button class="big" id="menuNew">＋ Start New Campaign</button><button class="big ghost" id="menuJoin">Join with Code</button><button class="big ghost" id="menuCharacters">My Characters (${savedCharacters.length})</button><button class="big ghost" id="menuHelp">How to Play</button></div>`, 'game-library');
  document.querySelectorAll('[data-resume]').forEach((button) => { button.onclick = async () => { button.disabled = true; button.textContent = 'Opening…'; if (!(await enterCampaign(button.dataset.resume))) { button.disabled = false; button.textContent = 'Resume'; banner('That campaign could not be opened.'); } }; });
  document.querySelectorAll('[data-playback]').forEach((button) => { button.onclick = () => showCampaignPlayback(button.dataset.playback, { back: showGameMenu, backLabel: 'Back to My Games' }); });
  document.querySelectorAll('[data-leave]').forEach((button) => { button.onclick = () => confirmLeaveCampaign(button.dataset.leave, button.dataset.name); });
  $('menuNew').onclick = () => { partyDraft = []; importedHeroes = []; showAdventureLibrary(); };
  $('menuJoin').onclick = () => showJoin(''); $('menuCharacters').onclick = showCharacterLibrary; $('menuHelp').onclick = showHelp;
}
function showTitle() { void showGameMenu(); }
function confirmLeaveCampaign(campaignId, name) {
  overlay(`<h1>Leave ${esc(name)}?</h1><p>You will give up your seat and character claim. The campaign and its story stay with the host. Quitting to My Games does <b>not</b> leave a campaign.</p><button class="big" id="leaveConfirm">Leave Campaign</button> <button class="big ghost" id="leaveCancel">Cancel</button>`);
  $('leaveCancel').onclick = () => void showGameMenu();
  $('leaveConfirm').onclick = async () => {
    $('leaveConfirm').disabled = true;
    const r = await api('/campaign/leave', { method: 'POST', body: JSON.stringify({ campaignId }) }).catch(() => null);
    if (!r || !r.ok) { banner(r && r.error || 'Could not leave that campaign.'); void showGameMenu(); return; }
    banner('You left the campaign. Its character is now an AI Companion.'); void showGameMenu();
  };
}
function showCharacterLibrary() {
  const cards = savedCharacters.length ? savedCharacters.map((row) => heroCard(row.sheet, `<div class="seat-tag mine">Saved character</div><div class="campaign-actions" style="margin-top:7px"><button data-use-character="${esc(row.character_id)}">Use in New Game</button><button class="leave" data-delete-character="${esc(row.character_id)}">Delete</button></div>`)).join('') : '<div class="library-empty">No saved characters yet. Import a D&amp;D Beyond PDF/JSON or enter one by hand.</div>';
  overlay(`<h1>My Characters</h1><p>These belong to your account, not to one campaign. Starting a game copies a character into that campaign, so the saved original remains here.</p><div class="herogrid">${cards}</div><div class="library-actions"><button class="big" id="libraryImport">＋ Import Character</button><button class="big ghost" id="libraryBack">Back to My Games</button></div>`, 'character-library');
  document.querySelectorAll('[data-use-character]').forEach((button) => { button.onclick = () => {
    const row = savedCharacters.find((item) => item.character_id === button.dataset.useCharacter); if (!row) return;
    const defaults = (content.defaultParty || content.heroes.slice(0, 4).map((hero) => hero.id)).filter((id) => id !== row.sheet.id).slice(0, 3);
    partyDraft = defaults.concat(row.sheet.id); importedHeroes = []; showAdventureLibrary();
  }; });
  document.querySelectorAll('[data-delete-character]').forEach((button) => { button.onclick = () => confirmDeleteCharacter(button.dataset.deleteCharacter); });
  $('libraryImport').onclick = () => showImportCharacter('library'); $('libraryBack').onclick = () => void showGameMenu();
}
function confirmDeleteCharacter(characterId) {
  const row = savedCharacters.find((item) => item.character_id === characterId); if (!row) return;
  overlay(`<h1>Delete ${esc(row.sheet.name)}?</h1><p>This removes the saved character from your account library. Existing campaign copies are not changed.</p><button class="big" id="characterDeleteConfirm">Delete Saved Character</button> <button class="big ghost" id="characterDeleteCancel">Cancel</button>`);
  $('characterDeleteCancel').onclick = showCharacterLibrary;
  $('characterDeleteConfirm').onclick = async () => {
    const r = await api(`/characters/${encodeURIComponent(characterId)}`, { method: 'DELETE' }).catch(() => null);
    if (!r || !r.ok) { banner(r && r.error || 'Could not delete that character.'); showCharacterLibrary(); return; }
    savedCharacters = savedCharacters.filter((item) => item.character_id !== characterId); banner('Saved character deleted.'); showCharacterLibrary();
  };
}
function showPartyBuilder() {
  const adventure = adventureById(selectedAdventureId || content.adventure.id);
  activateAdventure(adventure.id);
  if (!partyDraft.length) partyDraft = (content.defaultParty || content.heroes.slice(0, 4).map((h) => h.id)).slice(0, 4);
  const cards = partyCatalog().map((h) => {
    const chosen = partyDraft.includes(h.id);
    const saved = savedCharacters.some((row) => row.sheet.id === h.id);
    return heroCard(h, `${saved ? '<div class="seat-tag mine">Saved to My Characters</div>' : ''}<button class="big ${chosen ? '' : 'ghost'} draft-pick" data-draft="${h.id}" style="margin-top:6px;font-size:12px;padding:6px 10px">${chosen ? '✓ In the party' : 'Add hero'}</button>`);
  }).join('');
  overlay(`<h1>Build the party</h1><p><b>${esc(adventure.title)}</b> · Choose four heroes for this quest. Friends will claim one after they join the lobby.</p>
    <div class="party-count"><b id="draftCount">${partyDraft.length}/4 selected</b><span>Custom D&amp;D Beyond sheets can be imported here too.</span></div>
    <div class="herogrid">${cards}</div><p id="draftErr" style="color:var(--blood);min-height:18px"></p>
    <button class="big" id="ovCreateLobby" ${partyDraft.length === 4 ? '' : 'disabled'}>Create Multiplayer Lobby</button>
    <button class="big ghost" id="ovImportHero">＋ Import Character</button>
    <button class="big ghost" id="ovBuilderBack">Back</button>`, 'party-builder');
  document.querySelectorAll('[data-draft]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.draft, at = partyDraft.indexOf(id);
      if (at >= 0) partyDraft.splice(at, 1);
      else if (partyDraft.length < 4) partyDraft.push(id);
      else { $('draftErr').textContent = 'The starter adventure has four seats — remove one hero first.'; return; }
      showPartyBuilder();
    };
  });
  $('ovCreateLobby').onclick = () => partyDraft.length === 4 && newCampaign(partyDraft.slice());
  $('ovImportHero').onclick = () => showImportCharacter('builder');
  $('ovBuilderBack').onclick = showAdventureLibrary;
}
function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}
async function saveCharacterToLibrary(sheet) {
  const r = await api('/characters', { method: 'POST', body: JSON.stringify({ character: sheet }) }).catch(() => null);
  return r && r.ok ? installSavedCharacter(r.character || r.savedCharacter) : null;
}
async function acceptImportedHero(sheet) {
  if (!sheet || !sheet.id) return;
  const saved = await saveCharacterToLibrary(sheet);
  if (saved) importedHeroes = importedHeroes.filter((h) => h.id !== sheet.id);
  else importedHeroes = importedHeroes.filter((h) => h.id !== sheet.id).concat(sheet);
  if (!partyDraft.includes(sheet.id)) {
    if (partyDraft.length >= 4) partyDraft.pop();
    partyDraft.push(sheet.id);
  }
  showPartyBuilder();
  banner(saved ? `${sheet.name} was saved to My Characters and added to this party.` : `${sheet.name} joined this party. Saving the account copy was interrupted.`);
}
async function uploadCharacterFile(file) {
  const r = await fetch(`${API}/character/import-file?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/octet-stream' }, body: file,
  });
  return r.json();
}
async function seatImportedHero(sheet) {
  if (!board || board.mode !== 'setup') { banner('Character claims lock when the quest begins.'); closeOverlay(); return false; }
  overlay('<h1>Adding your hero to the lobby…</h1><p><span class="spin"></span> Finding an open seat and synchronizing the party.</p>');
  const r = await api('/character/seat', { method: 'POST', body: JSON.stringify({ campaignId: campaign.campaign_id, character: sheet }) });
  if (!r.ok) {
    overlay(`<h1>Could not take a seat</h1><p>${esc(r.error || 'The lobby changed before that character could be added.')}</p><button class="big" id="importSeatBack">Back to the lobby</button>`);
    $('importSeatBack').onclick = showLobby;
    return;
  }
  board = r.state || board; rev = Number(r.rev) || rev; players = r.players || players;
  rememberConfirmedBoard(board, rev);
  boardSheets = r.sheets || boardSheets; sheetsRev = r.sheetsRev || sheetsRev;
  indexTerrain(); layout(); updateInitiativeBar(); renderDock(); showLobby();
  banner(`${sheet.name} joined the party — that character is yours.`);
}
function showImportCharacter(destination) {
  const forLobby = destination === 'lobby';
  const forLibrary = destination === 'library';
  const abilityInputs = ['str','dex','con','int','wis','cha'].map((k) => `<label>${k.toUpperCase()}<input id="imp-${k}" type="number" min="1" max="30" value="10"></label>`).join('');
  overlay(`<h1>Import your character</h1>
    <p class="read"><b>D&amp;D Beyond:</b> open the character sheet, choose <b>Manage → Export to PDF</b>, then upload that PDF here. A JSON export is accepted too. Review imported stats before the quest starts.</p>
    <div class="import-drop"><input id="importFile" type="file" accept=".pdf,.json,application/pdf,application/json"><button class="big" id="importUpload">Read Character File</button><small>PDF or JSON · 6 MB maximum · processed on your own OSHAL server</small></div>
    <div class="import-divider"><span>or enter the essentials</span></div>
    <div class="quick-character"><label class="wide">Character name<input id="imp-name" maxlength="60" placeholder="Aria Nightwind"></label><label>Race<input id="imp-race" maxlength="40" placeholder="Elf"></label><label>Class<input id="imp-class" maxlength="50" placeholder="Ranger"></label><label>Level<input id="imp-level" type="number" min="1" max="20" value="1"></label><label>Armor class<input id="imp-ac" type="number" min="1" max="30" value="14"></label><label>Max HP<input id="imp-hp" type="number" min="1" max="999" value="10"></label><label>Speed<input id="imp-speed" type="number" min="5" max="120" step="5" value="30"></label><label class="wide">Starter weapon<select id="imp-weapon"><option value="longsword">Longsword</option><option value="rapier">Rapier</option><option value="mace">Mace</option><option value="shortbow">Shortbow</option><option value="dagger">Dagger</option></select></label><div class="ability-inputs">${abilityInputs}</div></div>
    <p id="importErr" class="import-error"></p><button class="big" id="importManual">Create Import Preview</button> <button class="big ghost" id="importBack">Back</button>`, 'character-import');
  $('importBack').onclick = forLobby ? showLobby : forLibrary ? showCharacterLibrary : showPartyBuilder;
  $('importUpload').onclick = async () => {
    const file = $('importFile').files && $('importFile').files[0];
    if (!file) { $('importErr').textContent = 'Choose a D&D Beyond PDF or JSON file first.'; return; }
    if (file.size > 6 * 1024 * 1024) { $('importErr').textContent = 'That file is larger than 6 MB.'; return; }
    $('importErr').innerHTML = '<span class="spin"></span> Reading the character sheet…';
    try {
      const r = await uploadCharacterFile(file);
      if (!r.ok || !r.sheet) { $('importErr').textContent = r.error || 'The sheet could not be read. Use the quick form below.'; return; }
      if (forLobby) { await saveCharacterToLibrary(r.sheet); await seatImportedHero(r.sheet); }
      else if (forLibrary) { const saved = await saveCharacterToLibrary(r.sheet); if (!saved) { $('importErr').textContent = 'The character was read, but could not be saved. Try again.'; return; } banner(`${r.sheet.name} saved to My Characters.`); showCharacterLibrary(); }
      else await acceptImportedHero(r.sheet);
    } catch (_e) { $('importErr').textContent = 'The sheet could not be read. Use the quick form below.'; }
  };
  $('importManual').onclick = async () => {
    const weapon = $('imp-weapon').value, ranged = weapon === 'shortbow';
    const character = { name: $('imp-name').value, race: $('imp-race').value, class: $('imp-class').value,
      level: Number($('imp-level').value), ac: Number($('imp-ac').value), maxHp: Number($('imp-hp').value), speed: Number($('imp-speed').value), abilities: {},
      actions: [{ name: weapon[0].toUpperCase() + weapon.slice(1), type: 'weapon', mode: 'attack', delivery: ranged ? 'ranged' : 'melee' }] };
    ['str','dex','con','int','wis','cha'].forEach((k) => { character.abilities[k] = Number($(`imp-${k}`).value); });
    $('importErr').innerHTML = '<span class="spin"></span> Building the sheet…';
    const r = await api('/character/import', { method: 'POST', body: JSON.stringify({ character, source: 'manual' }) });
    if (!r.ok || !r.sheet) { $('importErr').textContent = r.error || 'Add a name and check the highlighted stats.'; return; }
    if (forLobby) { await saveCharacterToLibrary(r.sheet); await seatImportedHero(r.sheet); }
    else if (forLibrary) { const saved = await saveCharacterToLibrary(r.sheet); if (!saved) { $('importErr').textContent = 'The character could not be saved. Try again.'; return; } banner(`${r.sheet.name} saved to My Characters.`); showCharacterLibrary(); }
    else await acceptImportedHero(r.sheet);
  };
}
function showJoin(prefill) {
  const invited = String(typeof prefill === 'string' ? prefill : params.get('join') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  overlay(`<h1>Join a game</h1><p>Ask the host for the 6-character join code (top bar and TV).</p>
    <p><input id="joinCode" value="${esc(invited)}" placeholder="e.g. 7F3A2C" maxlength="6" style="text-transform:uppercase;background:#0f0c0a;border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:12px;font-size:20px;text-align:center;letter-spacing:4px;width:220px"></p>
    <button class="big" id="ovDoJoin">Sit at the Table</button> <button class="big ghost" id="ovBack">Back</button><p id="joinErr" style="color:var(--blood)"></p>`);
  $('ovBack').onclick = showTitle;
  $('ovDoJoin').onclick = () => void submitJoinCode();
}

/** @description Seat this device at a shared table and always report the outcome on the join screen. */
async function submitJoinCode() {
  const button = $('ovDoJoin'), fail = (message) => { if ($('joinErr')) $('joinErr').textContent = message; if (button) button.disabled = false; };
  if (button) { button.disabled = true; button.textContent = 'Sitting down…'; }
  if ($('joinErr')) $('joinErr').textContent = '';
  const r = await api('/join', { method: 'POST', body: JSON.stringify({ code: $('joinCode').value }) }).catch(() => null);
  if (button) button.textContent = 'Sit at the Table';
  if (!r || !r.ok) { fail((r && r.error) || 'Could not reach the table. Check the code and try again.'); return; }
  try { history.replaceState(null, '', location.pathname); } catch (_e) {}
  const entered = await enterCampaign(r.campaignId).catch(() => false);
  if (!entered) { fail('You are seated, but this table did not load. Tap Sit at the Table again.'); return; }
  banner(`You are at the table — ${campaign && campaign.name ? campaign.name : 'the campaign'}.`);
  if (!myClaims().length) showHeroes(true);
}
function acceptClaimResponse(result) {
  if (!result || !result.ok) return false;
  players = result.players || players;
  if (Number.isFinite(Number(result.rev))) {
    rev = Number(result.rev); rememberConfirmedBoard(board, rev);
  }
  return true;
}
async function claimCharacter(slug, returnToLobby) {
  if (!board || board.mode !== 'setup') { banner('Character claims lock when the quest begins.'); return false; }
  const r = await api('/claim', { method: 'POST', body: JSON.stringify({ campaignId: campaign.campaign_id, slug }) });
  if (!r.ok) { banner(r.error || 'Could not claim that hero.'); return false; }
  acceptClaimResponse(r); updateInitiativeBar(); renderDock();
  banner('You are seated — your hero will glow on your turn.');
  if (returnToLobby || (board && board.mode === 'setup')) showLobby(); else closeOverlay();
  return true;
}
function showHeroes(claiming) {
  const canClaim = !!(claiming && board && board.mode === 'setup');
  const campaignHeroes = board ? board.tokens.filter((t) => t.kind === 'pc').map((t) => boardSheets[t.slug] || content.heroes.find((h) => h.id === t.slug)).filter(Boolean) : [];
  const list = claiming && campaignHeroes.length ? campaignHeroes : content.heroes;
  const cards = list.map((h) => {
    const taken = claimedBy(h.id), inParty = board && board.tokens.some((t) => t.slug === h.id);
    const btn = canClaim && inParty && !taken ? `<div class="seat-tag companion">AI Companion · available to claim</div><button class="big" style="margin-top:6px;font-size:13px;padding:6px 10px" data-claim="${h.id}">Play as ${esc(h.name.split(' ')[0])}</button>`
      : taken ? `<div style="color:var(--amber);font-size:11px;margin-top:4px">${taken.me ? '✓ You' : `claimed by ${esc(taken.name)}`}</div>${hostSeatReleaseButton(taken)}`
      : claiming && inParty && !canClaim ? '<div class="seat-tag companion">AI Companion · host-controlled automation</div>'
      : claiming && !inParty ? `<div style="color:var(--muted);font-size:11px;margin-top:4px">not in this party</div>` : '';
    return heroCard(h, btn);
  }).join('');
  const seats = claiming && campaign ? `<div class="seat-summary"><b>Join code ${esc(campaign.join_code || '')}</b><span>${players.length ? players.map((p) => `${esc(p.name.split(/[\s@]/)[0])}${p.slug ? ` → ${esc((boardSheets[p.slug] || content.heroes.find((h) => h.id === p.slug) || { name: p.slug }).name.split(' ')[0])}` : ' → choosing…'}`).join(' · ') : 'No friends seated yet'}</span></div>` : '';
  overlay(`<h1>${canClaim ? 'Choose your hero' : claiming ? 'The Party' : 'The Heroes'}</h1>${seats}<div class="herogrid">${cards}</div>
    <p style="margin-top:12px"><button class="big ghost" id="ovBack2">${claiming ? 'Back to the table' : 'Back'}</button></p>`, canClaim ? 'claim-heroes' : 'party');
  $('ovBack2').onclick = () => { closeOverlay(); if (!campaign) showTitle(); };
  document.querySelectorAll('[data-claim]').forEach((b) => { b.onclick = () => claimCharacter(b.dataset.claim, false); });
  bindHostSeatReleaseControls('party');
}
/** @description Return this device's claimed hero name, so a joined player sees who they are playing. */
function seatedHeroName() {
  const slug = myClaims()[0];
  if (!slug) return '';
  const sheet = boardSheets[slug] || (content.heroes || []).find((h) => h.id === slug);
  return (sheet && sheet.name) || slug;
}
function showLobby() {
  if (!campaign || !board) return;
  const acceptingClaims = board.mode === 'setup';
  const heroes = board.tokens.filter((t) => t.kind === 'pc').map((t) => boardSheets[t.slug] || content.heroes.find((h) => h.id === t.slug)).filter(Boolean);
  const cards = heroes.map((h) => {
    const seat = claimedBy(h.id);
    const extra = seat
      ? `<div class="seat-tag ${seat.me ? 'mine' : ''}">${seat.me ? '✓ You are playing' : `🎭 ${esc(seat.name.split(/[\s@]/)[0])} is playing`} ${esc(h.name.split(' ')[0])}</div>${hostSeatReleaseButton(seat)}`
      : acceptingClaims ? `<div class="seat-tag companion">AI Companion · available to claim</div><button class="big ghost" data-lobby-claim="${h.id}" style="margin-top:6px;font-size:12px;padding:6px 10px">Claim ${esc(h.name.split(' ')[0])}</button>`
        : '<div class="seat-tag companion">AI Companion · moves and casts automatically</div>';
    return heroCard(h, extra);
  }).join('');
  const waitingSeats = waitingSeatRoster();
  const readyToLaunch = myClaims().length > 0 && !players.some((p) => !p.slug);
  const ownerControls = acceptingClaims
    ? campaign.is_owner ? `<button class="big" id="ovLaunch" ${readyToLaunch ? '' : 'disabled'}>Start the Quest</button>${readyToLaunch ? '' : `<span class="lobby-wait">${myClaims().length ? 'A seated player is still choosing a hero.' : 'Claim the one hero you will control first.'}</span>`}`
      : '<p class="lobby-wait"><span class="spin"></span> Waiting for the host to start the quest…</p>'
    : '<p class="lobby-wait">Quest in progress · claims locked</p>';
  const importControl = acceptingClaims ? '<button class="big ghost" id="ovLobbyImport">Import My Character</button>' : '';
  // The join code and the "how friends join" steps are HOST instructions. A player
  // who just typed that code needs the opposite: confirmation that they landed.
  const header = campaign.is_owner
    ? `<div class="lobby-code"><span>Multiplayer join code</span><strong>${esc(campaign.join_code || '')}</strong><button id="copyJoin">Copy</button></div>
      <div class="join-steps"><b>How friends join</b><ol><li>Tap <b>Copy Invite Link</b> and send it.</li><li>Your friend signs in and opens the link.</li><li>They choose one available hero; the rest stay AI Companions.</li></ol></div>`
    : `<div class="lobby-code seated"><span>✓ You are seated at this table</span><strong>${esc(seatedHeroName() || 'Choose your hero')}</strong><small>${esc(campaign.name || 'Campaign')} · ${acceptingClaims ? 'the host starts when the party is ready' : 'quest in progress'}</small></div>`;
  overlay(`${header}
    <h1>${acceptingClaims ? 'Choose your character' : 'The Party'}</h1><p>${campaign.is_owner ? 'Share the code and claim your hero, then start when the table is ready.' : 'Pick the one hero you will control. Your phone will light up when it is your turn, and this screen clears by itself the moment the host begins.'} Unclaimed heroes are labeled <b>AI Companion</b>: you can inspect them, but only the host automation moves and casts for them.</p>
    ${waitingSeats}<div class="herogrid lobby-grid">${cards}</div>
    <div class="lobby-actions">${ownerControls}${campaign.is_owner ? '<button class="big ghost" id="copyInvite">Copy Invite Link</button>' : ''}${importControl}<button class="big ghost" id="ovLobbyClose">Look at the board</button><button class="big ghost" id="ovLobbyQuit">Quit to My Games</button>${campaign.is_owner ? '' : '<button class="big ghost" id="ovLobbyLeave">Leave Campaign</button>'}</div>`, 'lobby');
  document.querySelectorAll('[data-lobby-claim]').forEach((b) => { b.onclick = () => claimCharacter(b.dataset.lobbyClaim, true); });
  bindHostSeatReleaseControls('lobby');
  if ($('copyJoin')) $('copyJoin').onclick = async () => { try { await navigator.clipboard.writeText(campaign.join_code || ''); banner('Join code copied.'); } catch (_e) { banner(`Join code: ${campaign.join_code}`); } };
  if ($('copyInvite')) $('copyInvite').onclick = async () => { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('join', campaign.join_code || ''); try { await navigator.clipboard.writeText(u.toString()); banner('Invite link copied — send it to a friend.'); } catch (_e) { banner(`Invite link: ${u}`); } };
  if ($('ovLobbyImport')) $('ovLobbyImport').onclick = () => showImportCharacter('lobby');
  $('ovLobbyClose').onclick = closeOverlay;
  $('ovLobbyQuit').onclick = () => void quitToGameMenu();
  if ($('ovLobbyLeave')) $('ovLobbyLeave').onclick = confirmLeaveCurrentCampaign;
  if ($('ovLaunch')) $('ovLaunch').onclick = () => { closeOverlay(); playIntro(() => startScene()); };
}
function showSessionMenu() {
  if (!campaign) { void showGameMenu(); return; }
  overlay(`<h1>${esc(campaign.name || 'Campaign')}</h1><p><b>Quit to My Games</b> stops this screen and keeps the campaign saved. It never erases the story or gives up your seat. <b>Leave Campaign</b> is the separate permanent membership action.</p><div class="library-actions"><button class="big" id="sessionReturn">Return to Table</button><button class="big ghost" id="sessionTimeline">Timeline Playback</button><button class="big ghost" id="sessionParty">Party &amp; Join Code</button><button class="big ghost" id="sessionQuit">Quit to My Games</button>${campaign.is_owner ? '' : '<button class="big ghost" id="sessionLeave">Leave Campaign</button>'}</div>`, 'session-menu');
  $('sessionReturn').onclick = closeOverlay;
  $('sessionTimeline').onclick = showSaves;
  $('sessionParty').onclick = () => board && board.mode === 'setup' ? showLobby() : showHeroes(true);
  $('sessionQuit').onclick = () => void quitToGameMenu();
  if ($('sessionLeave')) $('sessionLeave').onclick = confirmLeaveCurrentCampaign;
}
function confirmLeaveCurrentCampaign() {
  if (!campaign || campaign.is_owner) return;
  const campaignId = campaign.campaign_id, name = campaign.name || 'this campaign';
  overlay(`<h1>Leave ${esc(name)}?</h1><p>Your seat and claim will be released. The hero remains in the party as an AI Companion. Use <b>Quit to My Games</b> instead if you only want to stop playing for now.</p><button class="big" id="currentLeaveConfirm">Leave Campaign</button> <button class="big ghost" id="currentLeaveCancel">Cancel</button>`);
  $('currentLeaveCancel').onclick = showSessionMenu;
  $('currentLeaveConfirm').onclick = async () => {
    $('currentLeaveConfirm').disabled = true;
    const r = await api('/campaign/leave', { method: 'POST', body: JSON.stringify({ campaignId }) }).catch(() => null);
    if (!r || !r.ok) { banner(r && r.error || 'Could not leave the campaign.'); showSessionMenu(); return; }
    resetCampaignPipelines(); clearSessionSurface(); banner('You left the campaign.'); await showGameMenu();
  };
}
function showVoiceStatus() {
  const current = activeNarrator || NATURAL_VOICE_POLICY.primary, retryText = presentationAudioRetryText();
  overlay(`<h1>Dungeon Master Settings</h1>
    <p class="voice-device"><span><b id="voiceActive">${esc(narratorLabel(current))}</b><br><small>Natural server narration only. Google Cloud's gravelly Algenib storyteller is tried first, then OpenAI Cedar when configured, then Gemini Algenib. If none is available, captions remain and the table stays silent.</small></span></p>
    <p id="voiceResult" class="voice-result">${retryText ? 'The table continued safely. Retry replays only the missed narration.' : 'No device or robotic substitute is ever used.'}</p>
    <div class="dm-play-settings">
      <b>WHAT THE DM SAYS</b>
      <label><input type="checkbox" id="vcActions" ${dmPlaySetting('speakActions') ? 'checked' : ''}> Announce actions — “Bram attacks Tallow with Longsword.”</label>
      <label><input type="checkbox" id="vcDice" ${dmPlaySetting('speakDice') ? 'checked' : ''}> Read dice and targets — “d20 + 5 against AC 15.”</label>
      <label>NPC turn pace <select id="vcPace"><option value="quick">Quick</option><option value="standard">Standard</option><option value="cinematic">Cinematic</option></select></label>
      <small>Dice always remain visible. These switches control spoken detail and automated pacing on this device.</small>
    </div>
    <p style="margin-top:10px"><label style="color:var(--muted);font-size:13px;cursor:pointer"><input type="checkbox" id="vcMute" ${voiceOn ? '' : 'checked'}> mute the Dungeon Master</label></p>
    <button class="big" id="vcRetry">${retryText ? 'Retry missed narration' : 'Retry / test natural voice'}</button> <button class="big ghost" id="vcDone">Done</button>`, 'voice-status');
  $('vcMute').onchange = (event) => setVoiceMuted(event.target.checked);
  $('vcActions').onchange = (event) => setDmPlaySetting('speakActions', event.target.checked);
  $('vcDice').onchange = (event) => setDmPlaySetting('speakDice', event.target.checked);
  $('vcPace').value = dmPlaySetting('npcPace');
  $('vcPace').onchange = (event) => setDmPlaySetting('npcPace', event.target.value);
  $('vcRetry').onclick = async () => {
    const button = $('vcRetry'); button.disabled = true; $('vcMute').checked = false;
    const result = retryText ? await retryPresentationNarration() : await retryNaturalVoice();
    if ($('voiceActive')) $('voiceActive').textContent = narratorLabel(activeNarrator || NATURAL_VOICE_POLICY.primary);
    if ($('voiceResult')) $('voiceResult').textContent = result === 'done'
      ? 'Natural narration played successfully.' : 'Natural narration is unavailable; captions remain on.';
    if ($('vcRetry')) $('vcRetry').disabled = false;
  };
  $('vcDone').onclick = () => closeOverlay();
}
function showHelp() {
  overlay(`<h1>How to play</h1><p class="read">
    • The green turn row always names the active hero and shows <b>movement left</b>, <b>action status</b>, and who must end the turn.<br>
    • On your turn, movement and one action unlock together. Every outlined <b>blue tile is a legal destination</b>; its label is the distance cost. You may move, act, then spend remaining movement—or act first and move afterward.<br>
    • <b>End Turn</b> passes play; monsters and clearly labeled <b>AI Companions</b> act on the host's device.<br>
    • Enemy attacks telegraph their target first. D&amp;D defense normally compares the attack to <b>Armor Class (AC)</b>, or asks for a listed <b>saving throw</b>; there is not a separate defense roll for every hit.<br>
    • Tap <b>🎒</b>, a hero on the board, or a portrait in initiative to see inventory, coins, abilities, features, and spells.<br>
    • <b>🧙 Party</b> shows the join code and character sheets; claims lock when the quest begins.<br>
    • <b>📜 Story</b> = the log, <b>⟲ recap</b> = "Previously, on…", and you can <b>talk to the DM</b> in your own words.<br>
    • Friends sign in on their phones and enter the <b>join code</b>. Each person controls only their claimed hero; everyone may inspect AI Companion sheets, but the host automation alone moves and casts for them. New games can import a D&amp;D Beyond PDF. Open with <code>&amp;mode=tv</code> to cast the board to a TV.</p>
    <button class="big" id="ovClose">Got it</button> <button class="big ghost" id="ovFresh">✦ Start a Fresh Campaign</button>`);
  $('ovClose').onclick = () => { closeOverlay(); if (!campaign) showTitle(); };
  $('ovFresh').onclick = () => { closeOverlay(); recapDone = true; partyDraft = []; importedHeroes = []; showAdventureLibrary(); };
}

async function newCampaign(partySlugs) {
  menuRequest++;
  overlay('<h1>Rolling up the table…</h1><p><span class="spin"></span> Seeding the party and the map.</p>');
  const selectedParty = partySlugs || partyDraft;
  const customCharacters = importedHeroes.filter((h) => selectedParty.includes(h.id));
  const savedCharacterIds = savedCharacters.filter((row) => selectedParty.includes(row.sheet.id)).map((row) => row.character_id);
  const r = await api('/campaign', { method: 'POST', body: JSON.stringify({
    name: content.adventure.title, adventureId: content.adventure.id,
    party: selectedParty, customCharacters, savedCharacterIds,
  }) });
  if (!r || !r.campaign) { overlay(`<h1>Could not create the table</h1><p>${esc((r && r.error) || 'Try again in a moment.')}</p><button class="big" id="ovRetryCreate">Back</button>`); $('ovRetryCreate').onclick = showPartyBuilder; return; }
  resetCampaignPipelines();
  campaign = r.campaign; board = r.state; rev = r.rev || 1; players = []; boardSheets = r.sheets || {}; sheetsRev = r.sheetsRev || ''; localArchiveEchoes = [];
  activateAdventure(campaign.adventure_id || board.adventureId);
  applyLocalVoicePreference();
  rememberConfirmedBoard(board, rev);
  indexTerrain(); layout(); $('log').innerHTML = ''; lastSeq = 0; archiveSeenSeq = new Set(); updateInitiativeBar(); renderDock(); startSync();
  showLobby();
}
async function bootstrapLegacyOwnerClaim() {
  if (TV || !campaign || !campaign.is_owner || !board || board.mode !== 'combat' || players.some((p) => p.slug)) return true;
  const hero = board.tokens.find((t) => t.kind === 'pc' && isConscious(t));
  if (!hero) return false;
  const r = await api('/claim', { method: 'POST', body: JSON.stringify({ campaignId: campaign.campaign_id, slug: hero.slug }) }).catch(() => null);
  acceptClaimResponse(r);
  return !!(r && r.ok && players.some((p) => p.slug));
}
function showClaimRecovery() {
  overlay(`<h1>Choose a hero before initiative continues</h1><p class="read">This older saved table has no confirmed player claim. The battle is paused so the whole party cannot run as AI Companions without you.</p><button class="big" id="ovRetryClaim">Claim a hero and continue</button><button class="big ghost" id="ovFreshClaim">Start a Fresh Campaign</button>`, 'claim-recovery');
  $('ovRetryClaim').onclick = async () => { $('ovRetryClaim').disabled = true; if (await bootstrapLegacyOwnerClaim()) { closeOverlay(); updateInitiativeBar(); beginTurn(); } else { $('ovRetryClaim').disabled = false; banner('A hero could not be claimed yet. Check your connection and try again.'); } };
  $('ovFreshClaim').onclick = () => { closeOverlay(); recapDone = true; partyDraft = []; importedHeroes = []; showAdventureLibrary(); };
}
async function enterCampaign(campaignId) {
  menuRequest++;
  const st = await api('/state' + (campaignId ? `?campaignId=${campaignId}` : ''));
  if (!st || !st.campaign) return false;
  resetCampaignPipelines();
  campaign = st.campaign; board = st.state; rev = st.rev || 0; players = st.players || []; boardSheets = st.sheets || {}; sheetsRev = st.sheetsRev || ''; localArchiveEchoes = [];
  activateAdventure(campaign.adventure_id || board.adventureId);
  rememberConfirmedBoard(board, rev);
  lastTurnAnnouncement = '';
  applyLocalVoicePreference();
  $('log').innerHTML = ''; lastSeq = 0; archiveSeenSeq = new Set();
  const initialArchive = st.archive || [];
  initialArchive.forEach((b) => addBeat(b.kind, b.content, null, b.seq));
  // /state intentionally returns a recent window. Treat that loaded window as
  // the baseline, then use contiguous tracking for every newly arriving beat.
  if (initialArchive.length) lastSeq = Math.max(...initialArchive.map((b) => Number(b.seq) || 0));
  const claimReady = await bootstrapLegacyOwnerClaim();
  indexTerrain(); layout(); closeOverlay(); updateInitiativeBar(); renderDock(); startSync();
  const needsCatchup = !TV && !recapDone && campaign.is_owner && (st.archive || []).length >= 5 && board.mode !== 'setup';
  if (board.mode === 'combat' && !claimReady) showClaimRecovery();
  else if (presentationGatePending()) {
    setStoryOpen(false); void resumePendingPresentationGate();
  } else if (board.mode === 'setup') {
    if (TV) overlay('<h1>The party is gathering…</h1><p class="read">Waiting for the host to start the quest.</p><p><span class="spin"></span></p>', 'tv-lobby');
    else showLobby();
  } else if (board.mode === 'exploration') {
    resumeExploration();
  } else if (board.mode === 'combat') {
    setStoryOpen(false);
    beginTurn();
    if (needsCatchup) { recapDone = true; void playCatchupRecap(() => {}, false); }
  } else if (board.mode === 'resolved') {
    setStoryOpen(false);
    if (needsCatchup) { recapDone = true; void playCatchupRecap(() => showResolvedState()); }
    else showResolvedState();
  } else if (board.mode === 'complete') {
    setStoryOpen(false); void showCurrentCampaignPlayback({ back: showResolvedState, backLabel: 'Back to Summary', allowSave: false });
  } else if (board.mode === 'defeat') {
    setStoryOpen(false); void showCurrentCampaignPlayback({ back: showDefeatState, backLabel: 'Back to Summary', allowSave: false });
  } else if (needsCatchup) { recapDone = true; void playCatchupRecap(); }
  return true;
}
async function bootTv() {
  document.body.classList.add('tv');
  if (!(await enterCampaign(null))) {
    overlay(`<h1>Dungeon Master</h1><p class="read">Waiting for a game to start…<br>Start one on any phone — this screen will join by itself.</p><p><span class="spin"></span></p>`);
    const wait = setInterval(async () => { if (await enterCampaign(null)) { clearInterval(wait); closeOverlay(); } }, 5000);
  }
}
async function boot() {
  content = await api('/content');
  if (!content || !content.adventure) { overlay('<h1>Failed to load</h1><p>Could not load the adventure content.</p>'); return; }
  loadArt(); indexTerrain(); layout();
  if (TV) return bootTv();
  const inviteCode = String(params.get('join') || '').trim().toUpperCase();
  if (inviteCode) { showJoin(inviteCode); return; }
  if (params.get('panel') === 'help') { showHelp(); return; }
  if (params.get('panel') === 'party') { await fetchSavedCharacters().catch(() => []); showCharacterLibrary(); return; }
  clearSessionSurface(); await showGameMenu();
}

// ── Wire controls ────────────────────────────────────────────────────────────
$('endTurn').onclick = () => {
  if (board && board.mode === 'exploration') { void completeExplorationScene(); return; }
  if (!board || board.mode !== 'combat') return;
  if (presentationGateBlocksInput()) return;
  const t = activeToken();
  if (turnAnnouncementActive(t)) { banner('Wait for the Dungeon Master to announce this turn.'); return; }
  if (movementStoryPending(t)) { banner('The saved movement is being recovered and narrated before this turn can advance.'); return; }
  if (turnStoryPending(t)) { banner('Wait for the exact result and Dungeon Master narration to finish before ending this turn.'); return; }
  if (isDowned(t)) { banner('A downed hero must roll the death save shown on screen.'); return; }
  if (!controls(t) && !(t && t.kind === 'monster' && isOwner())) { banner('Not your turn.'); return; }
  if (t.kind === 'pc' && !t.acted) { banner('Use your action before ending the turn. You may move before or after it.'); return; }
  selectedAction = null; void nextTurn();
};
$('stayBtn').onclick = () => {
  if (presentationGateBlocksInput()) return;
  const t = activeToken();
  if (!board || board.mode !== 'combat' || !t || !controls(t) || isDowned(t) || turnAnnouncementActive(t) || turnStoryPending(t)) { banner(isDowned(t) ? 'Roll this hero’s death save first.' : 'Attack From Here unlocks after the Dungeon Master announces your turn.'); return; }
  t.positionSet = true; selected = t; inspect = null; selectedAction = null; computeReachable(t); persist(); renderDock();
  banner('Current square confirmed — choose a weapon or spell; only legal targets glow red.');
};
$('moveBtn').onclick = () => {
  if (presentationGateBlocksInput()) return;
  const t = activeToken();
  if (!board || board.mode !== 'combat' || !t || !controls(t) || isDowned(t)
      || turnAnnouncementActive(t) || (turnStoryPending(t) && !t.acted)) {
    banner(isDowned(t) ? 'A downed hero cannot move; roll the death save.' : 'Movement unlocks after the Dungeon Master announces your turn.'); return;
  }
  selected = t; inspect = null; selectedAction = null; computeReachable(t); renderDock();
  banner(reachable.size ? `Blue tiles are legal · ${movementLeft(t)} ft ${t.acted ? 'remain after the attack' : 'available'}${diffSet.size ? ' · brush costs extra' : ''}` : 'No movement left this turn.');
};
$('gamesBtn').onclick = showSessionMenu;
$('helpBtn').onclick = () => showHelp();
$('diceBtn').onclick = () => showDice(null);
$('savesBtn').onclick = () => showSaves();
$('partyBtn').onclick = () => campaign && board && board.mode === 'setup' ? showLobby() : campaign ? showHeroes(true) : showHeroes(false);
$('closeStory').onclick = () => setStoryOpen(false);
$('recapBtn').onclick = () => dmRecap();
$('voiceBtn').onclick = () => showVoiceStatus();
$('sendTalk').onclick = sendTalk;
$('talkInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTalk(); });
function sendTalk() {
  const input = $('talkInput'), value = input.value.trim();
  openStory();
  if (!value) { input.focus(); return; }
  if (presentationGateBlocksInput()) {
    banner('Finish the visible opening or rewind presentation, then ask the Dungeon Master.');
    input.focus(); return;
  }
  input.value = '';
  banner('The Dungeon Master is listening…');
  void dmNarrate(value).finally(() => input.focus());
}
$('micBtn').onclick = startMic;
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { banner('Voice input is not available in this browser — type instead.'); return; }
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false; $('micBtn').textContent = '●';
  rec.onresult = (e) => { $('talkInput').value = e.results[0][0].transcript; sendTalk(); };
  rec.onend = () => { $('micBtn').textContent = '🎙'; }; rec.onerror = () => { $('micBtn').textContent = '🎙'; };
  rec.start();
}
window.addEventListener('resize', () => { if (content && board) layout(); });

// ── The show: one animation loop drives the whole board ──────────────────────
let _last = now();
function frame() {
  const t = now(), dt = Math.min(50, t - _last); _last = t;
  try { if (!document.hidden && content && board) { easeAll(dt); draw(); } } catch (_e) { /* one bad frame must NEVER kill the loop */ }
  requestAnimationFrame(frame); // always reschedule
}
requestAnimationFrame(frame);
// Global safety net — if anything throws, tell the player how to recover instead
// of leaving a silently dead board.
window.addEventListener('error', () => { try { banner('⚠ Something glitched. If the board looks stuck, tap ? Help → ✦ Fresh Campaign, or refresh.'); } catch (_e) {} });
initVoiceStatus();
boot();
