/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:14:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract victory, defeat, scene advancement, resolved-state presentation, and cutaway handling from the turn controller.
 * 2026-07-22 01:12:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Make terminal victory and defeat open read-only timeline playback, while keeping fresh-game and saved My Games exits explicit.
 * 2026-07-22 00:50:36 | roger.murphy@emeraldcoastsystemsgroup.com  | Request optional victory color through the scene storyteller mode after the deterministic outcome is durably saved.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Show generated art immediately, suppress replay duplicates, and pass stable story-event identities to the server illustrator.
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Present investigation chapter resolution separately from combat victory and route every next chapter through its authored controller.
 */

'use strict';

// ── End states + arc ─────────────────────────────────────────────────────────
async function victory() {
  board.mode = 'resolved'; persist(); renderChoices([]);
  const saved = await flushPendingState();
  if (!saved || !board || board.mode !== 'resolved') {
    banner('Victory could not be confirmed yet. The shared table was restored; try End Turn again.');
    return false;
  }
  if (TV) { banner('Victory!'); return; }
  showResolvedState();
  return true;
}
async function ensureResolvedEffects() {
  if (!isOwner() || !board || board.mode !== 'resolved' || !SC()) return false;
  const scene = SC(), marker = board.outcomeEffects;
  if (marker && marker.sceneId === scene.id && marker.kind === 'victory') return true;
  board.outcomeEffects = { sceneId: scene.id, kind: 'victory', claimedAt: Date.now() };
  persist();
  if (!(await flushPendingState()) || !board || board.mode !== 'resolved' || board.outcomeEffects.sceneId !== scene.id) return false;
  recordArchivedBeat('milestone', `Victory! ${scene.title} is won.`);
  void autoSnapshot(`✔ ${scene.title} — won`);
  requestCutaway(`Victory tableau: the heroes stand over the defeated. ${scene.afterword || scene.title}`, false,
    `victory:${board.presentationGate && board.presentationGate.id || 'live'}:${scene.id}`);
  void dmScene(`The party has won "${scene.title}". Deliver a short victorious beat and tease what waits ahead.`);
  return true;
}
function showResolvedState() {
  if (!board || !SC() || TV) return;
  const scene = SC(), complete = board.mode === 'complete', pcs = board.tokens.filter((t) => t.kind === 'pc');
  const explored = scene.kind === 'exploration';
  const standing = pcs.filter(isConscious), down = pcs.filter(isDowned), fallen = pcs.filter((t) => t.dead);
  const legacyFallen = fallen.filter((t) => !t.deathSaves);
  const names = (rows) => rows.length ? rows.map((t) => esc(shortTokenLabel(t))).join(', ') : 'none';
  const historyNote = legacyFallen.length
    ? `<div class="legacy-outcome"><b>Why heroes disappeared in this saved battle</b><p>The previous rules treated 0 HP as immediate removal, then automatically finished the remaining initiative. This save remains unchanged as history. In a fresh battle, heroes stay visible as <b>DOWN</b> and roll death saves on their turns.</p></div>`
    : '';
  const canAdvance = !complete;
  const playback = complete ? '<button class="big" id="ovPlayback">Playback Timeline</button>' : '';
  const talk = complete ? '' : '<button class="big ghost" id="ovTalk">Talk to the DM</button>';
  const chapterTitle = complete ? 'The campaign is complete!'
    : explored ? `${esc(scene.title)} — the evidence points onward` : `${esc(scene.title)} — battle complete`;
  const partyOutcome = explored ? '' : `<div class="outcome-grid"><span><b>${standing.length}</b> standing<small>${names(standing)}</small></span><span><b>${down.length}</b> down/stable<small>${names(down)}</small></span><span><b>${fallen.length}</b> fallen<small>${names(fallen)}</small></span></div>${historyNote}`;
  overlay(`<h1>${chapterTitle}</h1><p class="read">${esc(scene.afterword || '')}</p>
    ${partyOutcome}
    <div class="outcome-actions">${canAdvance ? `<button class="big" id="ovAdvance">${isOwner() ? scene.next ? 'Press On →' : 'Complete the Campaign' : 'Waiting for host'}</button>` : ''}${playback}<button class="big ghost" id="ovViewBoard">View the final board</button><button class="big ghost" id="ovFreshResolved">Start a Fresh Campaign</button><button class="big ghost" id="ovResolvedGames">Quit to My Games</button>${talk}</div>`, 'resolved');
  if ($('ovAdvance')) { $('ovAdvance').disabled = !isOwner(); if (isOwner()) $('ovAdvance').onclick = advanceScene; }
  if ($('ovPlayback')) $('ovPlayback').onclick = () => showCurrentCampaignPlayback({ back: showResolvedState, backLabel: 'Back to Summary', allowSave: false });
  $('ovViewBoard').onclick = closeOverlay;
  $('ovFreshResolved').onclick = () => { closeOverlay(); recapDone = true; partyDraft = []; importedHeroes = []; showAdventureLibrary(); };
  $('ovResolvedGames').onclick = () => void quitToGameMenu();
  if ($('ovTalk')) $('ovTalk').onclick = () => {
    closeOverlay(); openStory();
    dmNarrate(explored
      ? 'We have followed the evidence in this chapter. What does it mean now?'
      : 'We won the fight. What happens now?');
  };
  if (!complete && !legacyFallen.length) {
    if (!explored) void ensureResolvedEffects();
  }
}
let advanceInFlight = false;
async function advanceScene() {
  if (advanceInFlight) return;
  advanceInFlight = true;
  const requestEpoch = campaignEpoch, campaignId = campaign && campaign.campaign_id;
  const explored = SC() && SC().kind === 'exploration';
  overlay(explored
    ? '<h1>Following the evidence…</h1><p><span class="spin"></span> The next chapter is opening.</p>'
    : '<h1>Binding wounds…</h1><p><span class="spin"></span> XP, level-ups, and the road ahead.</p>');
  const saved = await flushPendingState();
  if (!saved && board.mode === 'resolved') { advanceInFlight = false; closeOverlay(); banner('Victory is still syncing. Wait a moment, then press on.'); return; }
  const r = await api('/advance', { method: 'POST', body: JSON.stringify({ campaignId }) }).catch(() => null);
  if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return;
  if (!r || !r.ok) { advanceInFlight = false; closeOverlay(); banner(r && r.error || 'Could not advance.'); return; }
  (r.notes || []).forEach((n) => addBeat('level-up', n));
  if (r.done) {
    board = r.state; rev = r.rev; boardSheets = r.sheets || boardSheets; sheetsRev = r.sheetsRev || sheetsRev;
    rememberConfirmedBoard(board, rev);
    advanceInFlight = false; indexTerrain(); layout(); showResolvedState(); return;
  }
  board = r.state; rev = r.rev; boardSheets = r.sheets || boardSheets; sheetsRev = r.sheetsRev || sheetsRev; lastTurnAnnouncement = '';
  rememberConfirmedBoard(board, rev);
  advanceInFlight = false;
  indexTerrain(); layout(); closeOverlay();
  playIntro(() => startScene()); // introduce the next authored investigation or encounter
}
async function defeat() {
  board.mode = 'defeat'; persist(); renderChoices([]);
  const saved = await flushPendingState();
  if (!saved || !board || board.mode !== 'defeat') {
    banner('Defeat could not be confirmed yet. The shared table was restored; try again.');
    return false;
  }
  if (TV) { banner('The party falls…'); return; }
  showDefeatState();
}
function showDefeatState() {
  if (!board || TV) return;
  overlay(`<h1>Darkness takes the party</h1><p class="read">Every hero is dead or stable at 0 HP while enemies remain. The battle is over, but the save is preserved and every fallen hero remains visible on the final board.</p><button class="big" id="ovDefeatPlayback">Playback Timeline</button><button class="big ghost" id="ovDefeatBoard">View the final board</button><button class="big ghost" id="ovRetry">Start a Fresh Campaign</button><button class="big ghost" id="ovDefeatGames">Quit to My Games</button>`, 'defeat');
  $('ovDefeatPlayback').onclick = () => showCurrentCampaignPlayback({ back: showDefeatState, backLabel: 'Back to Summary', allowSave: false });
  $('ovDefeatBoard').onclick = closeOverlay;
  $('ovRetry').onclick = () => { closeOverlay(); recapDone = true; partyDraft = []; importedHeroes = []; showAdventureLibrary(); };
  $('ovDefeatGames').onclick = () => void quitToGameMenu();
  if (isOwner() && !(board.outcomeEffects && board.outcomeEffects.kind === 'defeat' && board.outcomeEffects.sceneId === board.sceneId)) {
    board.outcomeEffects = { sceneId: board.sceneId, kind: 'defeat', claimedAt: Date.now() };
    persist(); void flushPendingState().then((saved) => { if (saved) recordArchivedBeat('milestone', 'The party falls…'); });
  }
}

// ── Cutaway art ──────────────────────────────────────────────────────────────
// A framed illustration that floats OVER the board (board stays visible below),
// fades in, then out. Tap to dismiss early.
const shownCutaways = new Set();
function showCutaway(url) {
  if (!url || shownCutaways.has(url)) return;
  shownCutaways.add(url);
  const img = new Image();
  img.onload = () => {
    const prev = $('stage').querySelector('.cutaway-frame'); if (prev) prev.remove();
    const el = document.createElement('div'); el.className = 'cutaway-frame';
    el.style.cssText = `position:absolute;left:50%;top:14px;transform:translateX(-50%) scale(.96);z-index:34;opacity:0;transition:opacity .6s,transform .6s;cursor:pointer;pointer-events:auto`;
    el.innerHTML = `<img src="${url}" style="display:block;max-width:${TV ? 76 : 56}vw;max-height:${TV ? 70 : 50}vh;border-radius:14px;box-shadow:0 26px 80px rgba(0,0,0,.9);border:2px solid rgba(224,164,76,.55)">`;
    el.onclick = () => el.remove(); $('stage').appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) scale(1)'; });
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }, TV ? 16000 : 11000);
  };
  img.onerror = () => shownCutaways.delete(url);
  img.src = url;
}
// Paint the moment. Milestones (opening/victory) are host-only to avoid dupes;
// a player's "show me" free-talk paints for whoever asked (anyPlayer).
async function requestCutaway(prompt, anyPlayer, eventKey) {
  if (!(anyPlayer || isOwner()) || !campaign) return null;
  const campaignId = campaign.campaign_id, requestEpoch = campaignEpoch;
  const result = await api('/cutaway', {
    method: 'POST',
    body: JSON.stringify({ campaignId, prompt, eventKey: eventKey || null }),
  }).catch(() => null);
  if (result && result.ok && result.url && campaign && campaign.campaign_id === campaignId && campaignEpoch === requestEpoch) {
    showCutaway(result.url);
  }
  return result;
}
