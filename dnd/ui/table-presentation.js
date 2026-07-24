/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Add a persisted, leased Dungeon Master presentation gate shared by opening, rewind, reload, and multiplayer synchronization flows.
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Present and archive exact persisted initiative dice before opening narration or controls can advance.
 * 2026-07-21 22:48:44 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep every rewind locked until its authoritative pruned story branch has replaced stale local playback state.
 * 2026-07-21 23:04:51 | roger.murphy@emeraldcoastsystemsgroup.com  | Await durable opening narration before remembering, voicing, or completing its shared presentation gate.
 * 2026-07-22 00:18:41 | roger.murphy@emeraldcoastsystemsgroup.com  | Release presentation gates after a bounded caption window, run natural narration asynchronously, and recover leases or state writes without replaying media.
 * 2026-07-22 00:15:33 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the first active actor and their next Move and Choose stages visible while opening or rewind media is presented.
 * 2026-07-23 00:49:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Describe movement and action as simultaneous budgets while the opening temporarily locks both.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Give the opening illustration a stable event identity so reconnecting players cannot purchase duplicate round-one art.
 */

'use strict';

const PRESENTATION_LEASE_MS = 20000;
const PRESENTATION_RECOVERY_MS = 1200;
const PRESENTATION_SESSION_KEY = 'dnd-presentation-client';
let presentationGateJob = null, presentationGateRetryTimer = null;
let presentationGateFailure = null, presentationGateEpoch = 0;
let presentationGateWriteInFlight = false;
let presentedGateIds = new Set(), presentationAudioRetry = null;
let presentationArchiveSignatures = new Set();
let rewindArchiveTransitionGate = null, rewindArchiveReadyKey = '', rewindArchiveFailureKey = '';

/** @description Keep one presenter identity across reloads in the same tab. */
function presentationClientIdentity() {
  try {
    let id = sessionStorage.getItem(PRESENTATION_SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(PRESENTATION_SESSION_KEY, id);
    }
    return id;
  } catch (_error) {
    try { return crypto.randomUUID(); }
    catch (_fallbackError) { return `presenter-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  }
}
const presentationClientId = presentationClientIdentity();
function newPresentationGateId() {
  try { return crypto.randomUUID(); }
  catch (_error) { return `${presentationClientId}-${Date.now()}`.slice(0, 80); }
}

/** @description Remember loaded and locally queued story beats across retries. */
function presentationArchiveSignature(kind, content) { return `${kind}\u0000${String(content)}`; }
function rememberPresentationArchiveBeat(kind, content) {
  presentationArchiveSignatures.add(presentationArchiveSignature(kind, content));
}
function presentationArchiveHas(kind, content) {
  return presentationArchiveSignatures.has(presentationArchiveSignature(kind, content));
}
function resetPresentationArchiveMemory() { presentationArchiveSignatures = new Set(); }

/** @description Return the valid gate currently locking this exact board beat. */
function pendingPresentationGate(state) {
  const value = state || board, gate = value && value.presentationGate;
  if (!gate || gate.complete !== false || !['opening', 'rewind'].includes(gate.kind)) return null;
  if (!gate.id || !gate.message || String(gate.sceneId || '') !== String(value.sceneId || '')) return null;
  if (Number(gate.turnSerial) !== (Number(value.turnSerial) || 0)) return null;
  return gate;
}
function presentationGatePending(state) { return !!pendingPresentationGate(state); }

/** @description Key archive readiness to one campaign and unique rewind gate. */
function rewindArchiveKey(gate) {
  return gate ? `${campaign && campaign.campaign_id || ''}:${gate.id}` : '';
}
function rewindArchiveReady(gate) {
  return !!(gate && gate.kind === 'rewind' && rewindArchiveReadyKey === rewindArchiveKey(gate));
}
function rewindArchiveFailed(gate) {
  return !!(gate && rewindArchiveFailureKey === rewindArchiveKey(gate));
}

/** @description Lock the old board while a newly observed rewind branch loads. */
function beginRewindArchiveTransition(state) {
  const gate = rewindArchiveGate(state);
  if (!gate || gate.kind !== 'rewind') return null;
  rewindArchiveTransitionGate = { ...gate };
  cancelAutomatedWork(); cancelCombatDice();
  selected = null; selectedAction = null; inspect = null; clearReachable(); renderChoices([]);
  updateInitiativeBar(); renderDock();
  banner('The shared timeline changed. Reloading the restored story; controls are locked.');
  return gate;
}

/** @description Record whether one rewind branch is safe to present. */
function finishRewindArchiveTransition(gate, ready) {
  const key = rewindArchiveKey(gate);
  if (ready) { rewindArchiveReadyKey = key; rewindArchiveFailureKey = ''; }
  else { rewindArchiveFailureKey = key; if (rewindArchiveReadyKey === key) rewindArchiveReadyKey = ''; }
  if (ready && rewindArchiveTransitionGate && rewindArchiveTransitionGate.id === gate.id) rewindArchiveTransitionGate = null;
}
function resetRewindArchiveBarrier() {
  rewindArchiveTransitionGate = null; rewindArchiveReadyKey = ''; rewindArchiveFailureKey = '';
}

/** @description Create the opening lock inside the first combat state write. */
function installOpeningPresentationGate(message) {
  const now = Date.now();
  board.presentationGate = {
    id: newPresentationGateId(), kind: 'opening', sceneId: board.sceneId,
    turnSerial: Number(board.turnSerial) || 0, message: String(message || '').slice(0, 900),
    createdAt: now, complete: false, lease: presentationClientId, leaseAt: now,
  };
  return board.presentationGate;
}

/** @description Identify whether this tab owns the active presenter lease. */
function ownsPresentationGate(gate) {
  return !!(gate && gate.lease === presentationClientId);
}
function presentationLeaseExpired(gate) {
  return !gate || !gate.lease || Date.now() - Number(gate.leaseAt || 0) >= PRESENTATION_LEASE_MS;
}
function currentPresentationGate(id) {
  const gate = pendingPresentationGate();
  return gate && gate.id === id ? gate : null;
}

/** @description Cancel local timers and invalidate a presenter from an old campaign. */
function resetPresentationGateController(resetWrite) {
  presentationGateEpoch++;
  clearTimeout(presentationGateRetryTimer); presentationGateRetryTimer = null;
  presentationGateJob = null; presentationGateFailure = null;
  if (resetWrite) {
    presentationGateWriteInFlight = false; presentedGateIds = new Set(); presentationAudioRetry = null;
  }
}

/** @description Remember failed natural narration without changing board state. */
function notePresentationAudioResult(gate, status) {
  if (!gate || !gate.id) return;
  if (['unavailable', 'dropped'].includes(status)) {
    presentationAudioRetry = { id: gate.id, message: gate.message };
    banner('Natural narration is unavailable. Captions are on and the table will continue; tap Voice to retry this narration.');
  } else if (status === 'done' && presentationAudioRetry && presentationAudioRetry.id === gate.id) {
    presentationAudioRetry = null;
  }
}
function presentationAudioRetryText() {
  return presentationAudioRetry && presentationAudioRetry.message || '';
}

/** @description Replay only failed audio; never reopen or mutate a presentation gate. */
async function retryPresentationNarration() {
  const retry = presentationAudioRetry;
  if (!retry) return retryNaturalVoice();
  setVoiceMuted(false);
  let status = 'unavailable';
  try { status = await speakCaption(retry.message, true); } catch (_error) {}
  notePresentationAudioResult(retry, status);
  return status;
}

/** @description Render presentation status without replacing the authoritative actor directive. */
function renderPresentationGateFlag(flag, suppliedActor) {
  const gate = pendingPresentationGate() || rewindArchiveTransitionGate;
  if (!gate) return false;
  const actor = suppliedActor || (board && board.order && board.order.length ? activeToken() : null);
  const name = actor ? shortTokenLabel(actor) : 'First hero';
  const archiveWaiting = gate.kind === 'rewind' && !rewindArchiveReady(gate);
  const failed = presentationGateFailure === gate.id || rewindArchiveFailed(gate);
  const audioRetry = presentationAudioRetry && presentationAudioRetry.id === gate.id;
  const ownerCopy = archiveWaiting
    ? failed ? 'The restored story is reconnecting. The table remains safely locked.' : 'Reloading the restored story before anyone can continue.'
    : failed ? `The introduction was interrupted. ${name}'s turn is unlocking automatically.`
      : `${name}'s turn is next. The Dungeon Master is finishing the opening.`;
  flag.className = 'waiting';
  const cue = failed && !archiveWaiting ? 'Reconnecting the shared table; it will unlock automatically and narration will not replay.' : ownerCopy;
  flag.innerHTML = `<div class="turn-copy"><span class="turn-kicker">${gate.kind === 'rewind' ? 'Timeline rewind' : 'Dungeon Master opening'}</span><strong>${esc(name)}'s turn</strong><span class="turn-cue">${esc(cue)}</span></div><div class="turn-steps"><span class="turn-step current">Opening <b>${failed ? 'recovering' : 'playing'}</b></span><span class="turn-step locked">Movement + action <b>unlock together</b></span>${audioRetry ? '<button class="big" data-presentation-audio-retry>Retry Narration</button>' : ''}</div>`;
  const retry = flag.querySelector('[data-presentation-audio-retry]');
  if (retry) retry.onclick = () => { void retryPresentationNarration(); };
  return true;
}

/** @description Clear every actionable selection while leaving sheets inspectable. */
function lockPendingPresentationGate() {
  const gate = pendingPresentationGate();
  if (!gate) return false;
  cancelAutomatedWork();
  if (!initiativeDiceForGate(gate)) cancelCombatDice();
  selected = null; selectedAction = null; inspect = null; clearReachable(); renderChoices([]);
  updateInitiativeBar(); renderDock();
  const message = gate.kind === 'rewind' && !rewindArchiveReady(gate)
    ? 'Reloading the restored story. Position, actions, rolls, and End Turn are locked.'
    : gate.kind === 'rewind' ? 'The Dungeon Master is presenting the restored moment. Controls are locked.' : 'The Dungeon Master is opening the scene. Controls are locked.';
  banner(message);
  return true;
}

/** @description Reject an input without hiding inspectable character sheets. */
function presentationGateBlocksInput() {
  const gate = pendingPresentationGate();
  if (!gate && !rewindArchiveTransitionGate) return false;
  if ((gate && gate.kind === 'rewind' && !rewindArchiveReady(gate)) || rewindArchiveTransitionGate) {
    banner('The restored story is still loading. Position, actions, rolls, and End Turn are locked.');
    return true;
  }
  banner('Listen to the Dungeon Master first. Position, actions, rolls, and End Turn are locked.');
  return true;
}

/** @description Retry lease observation without creating duplicate host narration. */
function schedulePresentationGateRetry(gate) {
  if (!isOwner() || !gate) return;
  clearTimeout(presentationGateRetryTimer);
  const remaining = PRESENTATION_LEASE_MS - (Date.now() - Number(gate.leaseAt || 0));
  presentationGateRetryTimer = setTimeout(() => {
    presentationGateRetryTimer = null;
    if (currentPresentationGate(gate.id)) void resumePendingPresentationGate();
  }, Math.min(5000, Math.max(800, remaining + 50)));
}

/** @description Retry a failed authoritative completion without replaying media. */
function schedulePresentationGateRecovery(gate) {
  if (!isOwner() || !gate) return;
  clearTimeout(presentationGateRetryTimer);
  presentationGateRetryTimer = setTimeout(() => {
    presentationGateRetryTimer = null;
    if (currentPresentationGate(gate.id)) void resumePendingPresentationGate();
  }, PRESENTATION_RECOVERY_MS);
}

/** @description Claim an absent or expired host presenter lease authoritatively. */
async function claimPresentationGate(gate) {
  const live = currentPresentationGate(gate.id);
  if (!live || !presentationLeaseExpired(live)) return ownsPresentationGate(live);
  const previous = { ...live }, previousRev = Number(rev) || 0;
  live.lease = presentationClientId; live.leaseAt = Date.now(); persist();
  presentationGateWriteInFlight = true;
  const saved = await flushPendingState().finally(() => { presentationGateWriteInFlight = false; });
  const confirmed = currentPresentationGate(gate.id);
  if ((saved || Number(rev) > previousRev) && ownsPresentationGate(confirmed)) return true;
  if (confirmed && !ownsPresentationGate(confirmed)) schedulePresentationGateRetry(confirmed);
  else {
    if (board && board.presentationGate && board.presentationGate.id === gate.id) board.presentationGate = previous;
    presentationGateFailure = gate.id; lockPendingPresentationGate();
    schedulePresentationGateRetry(previous);
  }
  return false;
}

/** @description Present the exact persisted opening or rewind sentence. */
async function narratePresentationGate(gate) {
  setStoryOpen(false); renderChoices([]);
  if (gate.kind === 'opening') {
    const firstPresentation = !presentationArchiveHas('narration', gate.message);
    if (firstPresentation) {
      rememberPresentationArchiveBeat('narration', gate.message);
      void Promise.resolve(recordArchivedBeat('narration', gate.message, null, false)).catch(() => null);
      requestCutaway(`${SC().title}. ${gate.message}`, false,
        `opening:${campaign && campaign.campaign_id || ''}:${gate.id}:${gate.sceneId}`);
    }
  }
  return presentPhase(gate.message, gate.kind === 'opening' ? 2400 : 1600, true,
    (status) => notePresentationAudioResult(gate, status));
}

/** @description Resume the restored board only after completion is persisted. */
function resumeBoardAfterPresentation(gate) {
  if (gate.kind === 'opening') renderChoices(SC().openingChoices || []);
  updateInitiativeBar(); renderDock();
  if (board.mode === 'combat') beginTurn();
  else if (board.mode === 'setup') {
    if (TV) overlay('<h1>The party is gathering…</h1><p class="read">Waiting for the host to start the quest.</p><p><span class="spin"></span></p>', 'tv-lobby');
    else showLobby();
  }
  else if (board.mode === 'resolved' || board.mode === 'complete') showResolvedState();
  else if (board.mode === 'defeat') showDefeatState();
  if (gate.kind === 'opening') void autoSnapshot(`▶ ${SC().title} — begins`);
}

/** @description Persist the sole allowed pending-to-complete gate transition. */
async function completePresentationGate(gate) {
  const live = currentPresentationGate(gate.id);
  if (!live || !ownsPresentationGate(live)) return false;
  const previous = { ...live }, previousRev = Number(rev) || 0;
  live.complete = true; live.completedAt = Date.now(); persist();
  presentationGateWriteInFlight = true;
  const saved = await flushPendingState().finally(() => { presentationGateWriteInFlight = false; });
  if (!saved) {
    const authoritative = board && board.presentationGate;
    if (Number(rev) > previousRev && authoritative && authoritative.id === gate.id && authoritative.complete === true) return true;
    if (board && board.presentationGate && board.presentationGate.id === gate.id) board.presentationGate = previous;
    presentationGateFailure = gate.id;
    lockPendingPresentationGate();
    schedulePresentationGateRecovery(previous);
    return false;
  }
  presentationGateFailure = null;
  resumeBoardAfterPresentation(live);
  return true;
}

/** @description Run one narration job for one gate on its leased host tab. */
function presentOwnedGate(gate) {
  if (presentationGateJob && presentationGateJob.id === gate.id) return presentationGateJob.promise;
  const epoch = presentationGateEpoch, campaignId = campaign && campaign.campaign_id;
  const promise = (async () => {
    if (!presentedGateIds.has(gate.id)) {
      presentedGateIds.add(gate.id);
      try {
        if (gate.kind === 'opening') void Promise.resolve(presentOpeningInitiative(gate, false)).catch(() => null);
        await narratePresentationGate(gate);
      } catch (_error) {
        caption(gate.message);
        presentationAudioRetry = { id: gate.id, message: gate.message };
      }
    }
    const live = currentPresentationGate(gate.id);
    if (epoch !== presentationGateEpoch || !campaign || campaign.campaign_id !== campaignId || !ownsPresentationGate(live)) return false;
    return completePresentationGate(live);
  })().finally(() => { if (presentationGateJob && presentationGateJob.promise === promise) presentationGateJob = null; });
  presentationGateJob = { id: gate.id, promise };
  return promise;
}

/** @description Lock every client and start or recover only the leased host presenter. */
async function resumePendingPresentationGate() {
  const gate = pendingPresentationGate();
  if (!gate) return false;
  lockPendingPresentationGate();
  if (gate.kind === 'rewind' && !rewindArchiveReady(gate)) return false;
  if (!isOwner()) { await presentOpeningInitiative(gate, false); return false; }
  if (ownsPresentationGate(gate)) return presentOwnedGate(gate);
  if (!presentationLeaseExpired(gate)) { schedulePresentationGateRetry(gate); return false; }
  return (await claimPresentationGate(gate)) ? presentOwnedGate(currentPresentationGate(gate.id)) : false;
}

/** @description Reconcile a synchronized gate before any turn may resume. */
function handleAuthoritativePresentationGate(previous) {
  const before = previous && previous.presentationGate, after = board && board.presentationGate;
  if (before && (!after || before.id !== after.id || before.complete !== after.complete)) resetPresentationGateController();
  if (!pendingPresentationGate()) return false;
  lockPendingPresentationGate();
  if (!presentationGateWriteInFlight) void resumePendingPresentationGate();
  return true;
}

/** @description Restore one save point with its server-created shared narration lock. */
async function loadSnapshot(id) {
  if (presentationGateBlocksInput()) return false;
  const requestEpoch = campaignEpoch, campaignId = campaign && campaign.campaign_id;
  await archivePostQueue;
  if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return false;
  const r = await api('/restore', { method: 'POST', body: JSON.stringify({ campaignId, snapshotId: id, presenterId: presentationClientId }) });
  if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return false;
  if (!r || !r.ok) { banner((r && r.error) || 'Could not rewind.'); return false; }
  pauseSyncForRewind();
  const gate = rewindArchiveGate(r.state);
  const archiveReady = !!gate && await prepareRewindArchive(r.state);
  if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return false;
  cancelAutomatedWork(); resetPresentationGateController(true); telegraph = null;
  applyAuthoritativeState(r.state, r.rev, r.sheets, r.sheetsRev);
  indexTerrain(); layout(); closeOverlay(); updateInitiativeBar(); renderDock();
  startSync();
  banner(archiveReady ? `⟲ Rewound to: ${r.label} · the Dungeon Master is presenting it now`
    : `⟲ Rewound to: ${r.label} · restored story is reconnecting; controls remain locked`);
  if (!gate || !pendingPresentationGate()) { banner('The rewind was restored without its shared presentation lock. Reload the table before continuing.'); return false; }
  if (!archiveReady) return false;
  return resumePendingPresentationGate();
}
