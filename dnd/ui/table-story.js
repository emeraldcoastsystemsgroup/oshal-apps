/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract save-point rewind, Dungeon Master narration, shared dice, natural-voice playback, synchronization, and durable state persistence into a focused module.
 * 2026-07-21 20:02:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Queue authoritative combat rolls behind any active shared die and drain them in order so no player's visible roll is lost.
 * 2026-07-21 19:58:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Decompose the shared-die presentation into explicit setup, choice, roll, reveal, and narration stages while preserving one authoritative result for every viewer.
 * 2026-07-21 20:19:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Use the Gemini natural narrator catalog and discard stale Cloud voice selections instead of requesting an invalid or robotic fallback.
 * 2026-07-21 20:38:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Move the table to OpenAI natural voices with Marin as the quality-first Dungeon Master default.
 * 2026-07-21 20:55:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Finish opening and rewind narration before initiative can unlock restored human controls.
 * 2026-07-21 21:01:12 | roger.murphy@emeraldcoastsystemsgroup.com  | Queue one visible combat die for every multiattack and area-effect attack or saving throw.
 * 2026-07-21 21:08:49 | roger.murphy@emeraldcoastsystemsgroup.com  | Lock a restored controlled hero before the rewind board is rendered.
 * 2026-07-21 21:16:19 | roger.murphy@emeraldcoastsystemsgroup.com  | Remove stale legal movement squares before rendering a rewound turn.
 * 2026-07-21 21:28:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Resolve combat-die jobs only after every authoritative roll has finished its visible presentation.
 * 2026-07-21 21:40:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Drain board and story persistence before snapshots and resume initiative when an active remote seat becomes an AI Companion.
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Reconcile the persisted Dungeon Master presentation gate before shared rolls, turn resumption, or input can continue.
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Delegate authoritative combat dice to the structured presenter and retain roll payloads through local archive writes and synchronized tails.
 * 2026-07-21 22:29:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Delegate natural narration to the fixed Marin/Kore voice module while retaining story and audio-cue consumers.
 * 2026-07-21 22:48:44 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace every stale client archive cursor, echo, story node, and dice key before a rewound branch can present or resume.
 * 2026-07-21 23:04:51 | roger.murphy@emeraldcoastsystemsgroup.com  | Retry required combat and opening archive writes in order, and apply synchronized board movement before presenting its exact dice and narration.
 * 2026-07-21 23:12:03 | roger.murphy@emeraldcoastsystemsgroup.com  | Bound state saves and background polls so a dead connection releases its lock and recovers authoritatively.
 * 2026-07-22 00:10:49 | roger.murphy@emeraldcoastsystemsgroup.com  | Render reconnect and catch-up archive tails silently, then present only the newest unseen beat once after synchronization is live.
 * 2026-07-22 00:36:25 | roger.murphy@emeraldcoastsystemsgroup.com  | Reconcile shared-roll transitions authoritatively, retain resolved dice visibly, and recover abandoned rollers under the current seat controller.
 * 2026-07-22 21:59:59 | roger.murphy@emeraldcoastsystemsgroup.com  | Speak each newly synchronized live Story beat through the same natural narration queue on every seated client.
 * 2026-07-22 01:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Route Saves into read-only playback so viewing history and confirmed restore are visibly separate actions.
 * 2026-07-22 00:50:36 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace the retired tactical DM resolve call with a board-guarded scene-only narration request.
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep synchronized combat math silent, speak only authored prose, and present every new live beat in order so dice and narration cannot hide one another.
 * 2026-07-22 22:49:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Wait through the live storyteller deadline and surface the recoverable chat failure instead of hiding it behind a generic message.
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the current quest above scrolling history and let a player replay a missed scene opening without mutating the campaign.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Follow new conversation in the single vertically scrolling gameplay rail instead of writing to an obsolete nested log scrollbar.
 * 2026-07-23 00:22:11 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep ordinary rules/help conversation text-and-voice only so paid cutaways remain reserved for openings, combat rounds, and confirmed kills.
 * 2026-07-23 11:21:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Preserve active narration across ordinary multiplayer state reconciliation instead of cutting audio on every revision.
 * 2026-07-23 11:36:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Adopt byte-equivalent authoritative replies without cancelling the active dice, narration, or death-save presenter.
 */

'use strict';

// ── Save points / time-warp ──────────────────────────────────────────────────
// The DM auto-captures key beats; the player can save any moment; loading any
// save point rewinds the board + hero sheets and plays forward from there.
// Never ask the server to snapshot until the board revision carrying this beat
// has committed, otherwise a “begins”/“won” save can contain the prior state.
async function prepareSnapshot() {
  if (!isOwner() || !campaign) return null;
  const requestEpoch = campaignEpoch, campaignId = campaign.campaign_id;
  if (!(await flushPendingState())) return null;
  await archivePostQueue;
  if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return null;
  return { requestEpoch, campaignId };
}
async function createSnapshot(label, auto) {
  const prepared = await prepareSnapshot();
  if (!prepared) return null;
  const { requestEpoch, campaignId } = prepared;
  const r = await api('/snapshot', { method: 'POST', body: JSON.stringify({ campaignId, label, auto }) }).catch(() => null);
  if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return null;
  return r;
}
async function autoSnapshot(label) {
  const result = await createSnapshot(label, true);
  return !!(result && result.ok);
}
async function showSaves() {
  if (!campaign) { banner('Start a game first.'); return; }
  await showCurrentCampaignPlayback({ back: closeOverlay, backLabel: 'Back to Table' });
}
function confirmRewind(id, label) {
  overlay(`<h1>Create a playable branch here?</h1><p>Everyone at this table will return to <b>${esc(label || 'that save point')}</b>. Later current-branch history will be replaced, but the campaign itself is never deleted.</p><button class="big" id="rewindConfirm">Confirm Restore / Rewind</button> <button class="big ghost" id="rewindCancel">Cancel</button>`);
  $('rewindCancel').onclick = showSaves;
  $('rewindConfirm').onclick = () => loadSnapshot(id);
}
// ── DM (bot) ─────────────────────────────────────────────────────────────────
async function dmNarrate(message, options) {
  if (presentationGateBlocksInput()) return { ok: false, locked: true };
  const opts = options || {};
  if (sharedRollPending(board) && !opts.rollResult) {
    presentSharedRoll(board.sharedRoll); banner('Finish the visible shared roll before asking the Dungeon Master for another beat.');
    return { ok: false, locked: true };
  }
  const el = pendingBeat();
  const requestEpoch = campaignEpoch, campaignId = campaign && campaign.campaign_id;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 35000) : null;
  try {
    const r = await api('/chat', { method: 'POST', signal: controller && controller.signal,
      body: JSON.stringify({ campaignId, sceneId: board && board.sceneId, mode: 'narrate', message, rollId: opts.rollId || null }) });
    if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return { ok: false, stale: true };
    if (!r || !r.ok) throw new Error((r && r.error) || 'No Dungeon Master response');
    if (r.state && Number.isFinite(Number(r.rev))) applyAuthoritativeState(r.state, r.rev, r.sheets, r.sheetsRev);
    addBeat('narration', r.narration, message, r.archiveEntry && r.archiveEntry.seq);
    speakCaption(r.narration); renderChoices(r.choices || []);
    if (r.grant) {
      boardSheets = r.sheets || boardSheets; sheetsRev = r.sheetsRev || sheetsRev;
      const grantedSheet = boardSheets[r.grant.hero] || sheetOf({ kind: 'pc', slug: r.grant.hero }) || {};
      banner(`🗡 ${r.grant.action.name} added to ${grantedSheet.name || 'your hero'}'s inventory!`); renderDock();
    }
    // A resolved check often contains words such as "Wisdom check". It is an
    // answer, not a request to roll again, so result submissions suppress the
    // prose detector and cannot reopen the die in a loop.
    const proseAsk = opts.rollResult ? null : detectRollAsk(r.narration);
    const ask = opts.rollResult ? null : (r.roll ? { ...(proseAsk || {}), ...r.roll } : proseAsk);
    if (ask) setTimeout(() => ask.id ? presentSharedRoll(ask) : showDice(ask), 500); // the requested roll pauses the scene and takes the board
    return r;
  } catch (error) {
    if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return { ok: false, stale: true };
    // A die result is immutable once rolled. If the DM request is interrupted,
    // keep that exact total visible and let the player retry without rerolling.
    const detail = error && error.message && error.message !== 'No Dungeon Master response'
      ? ` ${error.message}` : '';
    const help = opts.rollResult
      ? `Your roll is safe: ${opts.rollSummary || message} The Dungeon Master’s reply did not arrive. Tap Retry Same Result — you will not reroll.`
      : `The Dungeon Master could not answer.${detail} Try again, or keep playing from the glowing turn guide.`;
    addBeat('narration', help); caption(help); banner(opts.rollResult ? 'DM reply interrupted — your roll is safe. Retry the same result.' : 'The Dungeon Master did not answer yet — try again.');
    return { ok: false, error: help };
  } finally {
    if (timer) clearTimeout(timer);
    el.remove();
  }
}
// Three tappable next-move suggestions from the DM — a choose-your-path layer
// over the tactical board. Tapping sends it to the DM; you can always free-talk.
function renderChoices(list) {
  const el = $('choices');
  if (TV || (board && board.mode === 'combat') || !list || !list.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.innerHTML = '';
  list.slice(0, 3).forEach((txt) => {
    const b = document.createElement('button'); b.className = 'choice'; b.textContent = txt;
    b.onclick = () => { renderChoices([]); openStory(); dmNarrate(txt); };
    el.appendChild(b);
  });
  el.classList.remove('hidden');
}
function sceneRequestContext() {
  const active = board && activeToken();
  return {
    epoch: campaignEpoch, campaignId: campaign && campaign.campaign_id,
    guard: {
      rev: Number(rev) || 0, timelineId: String(board && board.presentationGate && board.presentationGate.id || ''),
      sceneId: String(board && board.sceneId || ''), mode: String(board && board.mode || ''),
      turnSerial: Number(board && board.turnSerial) || 0, actorId: active ? active.id : null,
    },
  };
}
function sceneRequestCurrent(context) {
  const active = board && activeToken(), guard = context.guard;
  return context.epoch === campaignEpoch && campaign && campaign.campaign_id === context.campaignId
    && Number(rev) === guard.rev && String(board && board.sceneId || '') === guard.sceneId
    && String(board && board.mode || '') === guard.mode && Number(board && board.turnSerial) === guard.turnSerial
    && (active ? active.id : null) === guard.actorId;
}
async function dmScene(message) {
  const context = sceneRequestContext();
  await archivePostQueue;
  if (!sceneRequestCurrent(context)) return { ok: false, stale: true };
  const el = pendingBeat();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
  try {
    const r = await api('/chat', { method: 'POST', signal: controller && controller.signal,
      body: JSON.stringify({ campaignId: context.campaignId, sceneId: context.guard.sceneId, mode: 'scene', message,
        requestId: `scene-${context.guard.sceneId}-${context.guard.rev}`, storyGuard: context.guard }) });
    if (!sceneRequestCurrent(context) || (r && r.stale)) return { ok: false, stale: true };
    if (!r || !r.ok || !r.narration) throw new Error((r && r.error) || 'No narration');
    addBeat('narration', r.narration, null, r.archiveEntry && r.archiveEntry.seq);
    await presentPhase(r.narration, 1800, true);
    return r;
  } catch (_error) {
    if (!sceneRequestCurrent(context)) return { ok: false, stale: true };
    const fallback = 'The scene is complete. The Dungeon Master’s optional story beat did not arrive; the saved outcome is unchanged.';
    addBeat('narration', fallback); caption(fallback); banner('Story beat interrupted · the saved outcome still stands.');
    return { ok: false, error: fallback };
  } finally {
    if (timer) clearTimeout(timer);
    el.remove();
  }
}
async function dmRecap(openPanel = true, speakNow = true) {
  if (openPanel) openStory();
  const el = pendingBeat(), controller = typeof AbortController === 'function' ? new AbortController() : null;
  const requestEpoch = campaignEpoch, campaignId = campaign && campaign.campaign_id;
  const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
  try {
    const r = await api('/chat', { method: 'POST', signal: controller && controller.signal,
      body: JSON.stringify({ campaignId, sceneId: board && board.sceneId, mode: 'recap' }) });
    if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return { ok: false, stale: true };
    if (r && r.ok) { addBeat('milestone', r.narration, null, r.archiveEntry && r.archiveEntry.seq); if (speakNow) speakCaption(r.narration); }
    return r || { ok: false };
  } catch (_e) {
    return { ok: false, error: 'The recap took too long. Initiative is continuing from the visible board.' };
  } finally {
    if (timer) clearTimeout(timer);
    el.remove();
  }
}

// ── THE BIG DICE — a giant d20 takes over the board when the story demands it ─
// Auto-opens when the DM asks for a check/save/attack (structured ROLL directive
// or prose), or anytime via 🎲. You tap to roll, it tumbles, your hero's real
// modifier applies, and the result feeds straight back into the DM's story.
const ABIL_SHORT = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
function myHeroes() {
  const pcs = board ? board.tokens.filter((t) => t.kind === 'pc' && isConscious(t)) : [];
  return pcs.filter((t) => controls(t));
}
function requestedRollHero(req) {
  const pcs = board ? board.tokens.filter((t) => t.kind === 'pc' && isConscious(t)) : [];
  const wanted = String(req && (req.actorSlug || req.actor || req.character || req.hero) || '').trim().toLowerCase();
  if (!wanted) return null;
  return pcs.find((t) => [t.id, t.slug, t.name, shortTokenLabel(t)].some((value) => String(value || '').toLowerCase() === wanted)) || null;
}
function rollMod(hero, kind) {
  const s = boardSheets[hero.slug] || sheetOf(hero) || {};
  if (kind === 'attack') return Math.max(...(s.actions || []).filter((a) => a.mode === 'attack').map((a) => a.toHit || 0), 2);
  return (s.mods || {})[ABIL_SHORT[kind]] || 0;
}
function tick(freq, dur, vol) { try { if (!_actx) return; const o = _actx.createOscillator(), g = _actx.createGain(); o.frequency.value = freq; g.gain.value = vol || 0.05; o.connect(g); g.connect(_actx.destination); o.start(); o.stop(_actx.currentTime + (dur || 0.05)); } catch (_e) {} }
function diceActorName(ctx) {
  return ctx.hero ? shortTokenLabel(ctx.hero) : 'the chosen hero';
}
function dicePrompt(ctx) {
  const name = esc(diceActorName(ctx));
  if (ctx.spectator) return `Waiting for ${name}’s roll — everyone will see the same result.`;
  if (ctx.aiRequested) return `${name} is an AI Companion — its roll happens visibly for everyone.`;
  return ctx.dc != null ? `The Dungeon Master calls for ${name} — DC ${ctx.dc}` : 'Fate is in your hands';
}
function sharedRollControllerKey(roll) {
  const actor = requestedRollHero(roll);
  if (!actor) return 'unassigned';
  const seat = claimedBy(actor.slug);
  if (!seat) return `ai:${isOwner() ? 'driver' : 'viewer'}`;
  const identity = seat.seatKey || `${seat.slug || actor.slug}:${seat.name || ''}`;
  return `seat:${identity}:${seat.me ? 'driver' : 'viewer'}`;
}
function sharedRollPresentationKey(roll) {
  const status = String(roll && roll.status || 'missing');
  const controller = ['requested', 'rolled'].includes(status) ? sharedRollControllerKey(roll) : 'complete';
  return `${String(roll && roll.id || '')}:${status}:${controller}`;
}
function createDiceContext(req) {
  const shared = !!(req && req.id), requested = requestedRollHero(req);
  const aiRequested = !!(requested && isAICompanion(requested) && isOwner());
  const rollable = requested ? ((controls(requested) || aiRequested) ? [requested] : []) : myHeroes();
  const spectator = shared && !rollable.length;
  if (!shared && !rollable.length) { banner('Claim a hero to roll — AI Companions roll visibly on the host screen.'); return null; }
  const ctx = { req, shared, requested, aiRequested, rollable, spectator, dc: req && req.dc != null ? Number(req.dc) : null };
  ctx.controllerKey = shared ? sharedRollControllerKey(req) : '';
  ctx.kind = (req && req.ability) || 'dexterity';
  ctx.hero = rollable[0] || requested || null;
  ctx.el = document.createElement('div'); ctx.el.className = 'dicebox'; ctx.el.dataset.rollId = shared ? req.id : '';
  ctx.el.innerHTML = `<div class="dice-ask">${dicePrompt(ctx)}</div><div class="dice-heroes"></div><div class="dice-kinds"></div>
    <div class="die" id="bigDie"><span class="dnum">20</span></div><div class="dice-mod"></div><div class="dice-verdict"></div>
    <div class="dice-actions"><button class="big" id="dieRoll">${spectator ? 'WAITING FOR PLAYER…' : 'ROLL'}</button> <button class="big ghost" id="dieClose">${shared ? 'ROLL STAYS VISIBLE' : 'Hide'}</button></div>`;
  ctx.el._sharedDiceContext = ctx;
  return ctx;
}
function captureDiceElements(ctx) {
  ctx.heroBox = ctx.el.querySelector('.dice-heroes'); ctx.kindBox = ctx.el.querySelector('.dice-kinds');
  ctx.die = ctx.el.querySelector('#bigDie'); ctx.num = ctx.el.querySelector('.dnum');
  ctx.modBox = ctx.el.querySelector('.dice-mod'); ctx.verdict = ctx.el.querySelector('.dice-verdict');
  ctx.rollButton = ctx.el.querySelector('#dieRoll'); ctx.closeButton = ctx.el.querySelector('#dieClose');
}
function makeDiceChoice(label, active, disabled, choose) {
  const button = document.createElement('button'); button.className = 'pill' + (active ? ' on' : '');
  button.textContent = label; button.disabled = disabled; button.onclick = choose; return button;
}
function paintDiceChoices(ctx) {
  ctx.heroBox.innerHTML = '';
  (ctx.rollable.length ? ctx.rollable : ctx.hero ? [ctx.hero] : []).forEach((hero) => {
    const choose = () => { ctx.hero = hero; paintDiceChoices(ctx); };
    ctx.heroBox.appendChild(makeDiceChoice(shortTokenLabel(hero) + (isAICompanion(hero) ? ' · AI' : ''), ctx.hero && ctx.hero.id === hero.id, ctx.spectator || ctx.aiRequested || !!(ctx.req && ctx.req.actorSlug), choose));
  });
  ctx.kindBox.innerHTML = '';
  ['attack', 'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].forEach((kind) => {
    const choose = () => { ctx.kind = kind; paintDiceChoices(ctx); };
    ctx.kindBox.appendChild(makeDiceChoice(kind === 'attack' ? '⚔ attack' : kind.slice(0, 3).toUpperCase(), kind === ctx.kind, ctx.spectator || !!(ctx.req && ctx.req.ability), choose));
  });
  const modifier = ctx.req && ctx.req.modifier != null ? Number(ctx.req.modifier) : ctx.hero ? rollMod(ctx.hero, ctx.kind) : 0;
  ctx.modBox.textContent = `${diceActorName(ctx)} · ${ctx.kind === 'attack' ? 'attack' : ctx.kind} ${modifier >= 0 ? '+' : ''}${modifier}${ctx.dc != null ? ` · DC ${ctx.dc}` : ''}`;
}
function diceResultCopy(ctx, result) {
  const natural = Number(result.natural), modifier = Number(result.modifier) || 0, total = Number(result.total);
  const pass = result.success == null ? null : !!result.success;
  const heroName = diceActorName(ctx), what = ctx.kind === 'attack' ? 'attack roll' : `${ctx.kind} check`;
  const outcome = pass == null ? '' : pass ? ' — success' : ' — failure';
  return { natural, modifier, total, pass,
    resultText: `${heroName} rolled ${total} (${natural}${modifier >= 0 ? '+' : ''}${modifier}) on the ${what}${ctx.dc != null ? ` against DC ${ctx.dc}` : ''}${outcome}${natural === 20 ? ' — a natural twenty!' : natural === 1 ? ' — a natural one!' : ''}.`,
    summary: `${heroName}’s ${what} is ${total}${ctx.dc != null ? ` against DC ${ctx.dc}` : ''}${outcome}.` };
}
async function submitDiceNarration(ctx, copy) {
  if (ctx.submitting) return; ctx.submitting = true; openStory();
  ctx.el.querySelector('.dice-ask').textContent = `${copy.summary} The result is locked. The Dungeon Master is responding…`;
  ctx.rollButton.disabled = true; ctx.rollButton.textContent = 'DM IS RESPONDING…'; ctx.closeButton.textContent = 'Keep result & hide';
  const response = await dmNarrate(copy.resultText, { rollResult: true, rollSummary: copy.summary, rollId: ctx.shared ? ctx.req.id : null });
  if (!ctx.el.isConnected) return;
  if (response && response.ok) {
    ctx.el.querySelector('.dice-ask').textContent = `${copy.summary} The Dungeon Master answered — play continues.`;
    ctx.rollButton.disabled = false; ctx.rollButton.textContent = 'RETURN TO BOARD'; ctx.rollButton.onclick = () => ctx.el.remove();
    clearTimeout(ctx.removeTimer); ctx.removeTimer = setTimeout(() => { if (ctx.el.isConnected) ctx.el.remove(); }, 1400); return;
  }
  ctx.submitting = false; ctx.el.querySelector('.dice-ask').textContent = `${copy.summary} The reply was interrupted, but this exact result is safe.`;
  ctx.rollButton.disabled = false; ctx.rollButton.textContent = 'RETRY SAME RESULT'; ctx.rollButton.onclick = () => void submitDiceNarration(ctx, copy);
}
async function revealDiceResult(ctx, result, narrate) {
  const copy = diceResultCopy(ctx, result);
  ctx.die.classList.remove('tumble'); ctx.num.textContent = copy.natural;
  ctx.die.classList.add(copy.natural === 20 ? 'nat20' : copy.natural === 1 ? 'nat1' : 'landed');
  tick(copy.natural === 20 ? 880 : copy.natural === 1 ? 110 : 440, 0.22, 0.07);
  ctx.verdict.innerHTML = `<b>${copy.natural}</b> ${copy.modifier >= 0 ? '+' : ''}${copy.modifier} = <b>${copy.total}</b>` + (copy.pass == null ? '' : copy.pass ? ' — <span class="ok">SUCCESS</span>' : ' — <span class="bad">FAIL</span>') + (copy.natural === 20 ? ' <span class="ok">NATURAL 20!</span>' : copy.natural === 1 ? ' <span class="bad">NATURAL 1…</span>' : '');
  ctx.done = true; ctx.rolling = false;
  if (!narrate) { ctx.el.querySelector('.dice-ask').textContent = `${copy.summary} Waiting for the Dungeon Master…`; ctx.rollButton.disabled = true; ctx.rollButton.textContent = 'RESULT LOCKED'; return; }
  ctx.rollButton.textContent = 'SENDING RESULT…'; ctx.rollButton.onclick = () => void submitDiceNarration(ctx, copy);
  await submitDiceNarration(ctx, copy);
}
async function finishResolvedDiceContext(ctx) {
  if (!ctx || !ctx.el.isConnected) return;
  if (!ctx.done) await revealDiceResult(ctx, ctx.req, false);
  if (!ctx.el.isConnected) return;
  const copy = diceResultCopy(ctx, ctx.req);
  ctx.el.querySelector('.dice-ask').textContent = `${copy.summary} The Dungeon Master answered — play continues.`;
  ctx.rollButton.disabled = false; ctx.rollButton.textContent = 'RETURN TO BOARD'; ctx.rollButton.onclick = () => ctx.el.remove();
  ctx.closeButton.disabled = false; ctx.closeButton.textContent = 'Return to board'; ctx.closeButton.onclick = () => ctx.el.remove();
  clearTimeout(ctx.removeTimer); ctx.removeTimer = setTimeout(() => { if (ctx.el.isConnected) ctx.el.remove(); }, 1800);
}
async function presentPersistedDice(ctx) {
  if (!ctx || !ctx.el.isConnected || ctx.presentingPersisted) return;
  ctx.presentingPersisted = true;
  try {
    if (!ctx.done) await revealDiceResult(ctx, ctx.req, false);
    if (ctx.req.status === 'resolved') { await finishResolvedDiceContext(ctx); return; }
    if (!ctx.spectator && !ctx.submitting) await submitDiceNarration(ctx, diceResultCopy(ctx, ctx.req));
  } finally { ctx.presentingPersisted = false; }
}
function localDiceResult(ctx) {
  const natural = ENG.die(20), modifier = rollMod(ctx.hero, ctx.kind), total = natural + modifier;
  return { natural, modifier, total, success: ctx.dc == null ? null : total >= ctx.dc };
}
async function performDiceRoll(ctx) {
  if (presentationGateBlocksInput()) return;
  if (ctx.rolling || ctx.done || ctx.spectator || !ctx.hero) return;
  ctx.rolling = true; unlockAudio(); ctx.die.classList.add('tumble'); ctx.verdict.textContent = ''; ctx.rollButton.disabled = true; ctx.rollButton.textContent = 'ROLLING…';
  const flicker = setInterval(() => { ctx.num.textContent = 1 + Math.floor(Math.random() * 20); tick(300 + Math.random() * 500, 0.03, 0.03); }, 90);
  const resultPromise = ctx.shared
    ? api('/roll', { method: 'POST', body: JSON.stringify({ campaignId: campaign.campaign_id, rollId: ctx.req.id }) }).catch(() => null)
    : Promise.resolve({ ok: true, result: localDiceResult(ctx) });
  await waitMs(1450); const response = await resultPromise; clearInterval(flicker);
  if (!response || !response.ok || !(response.result || response.roll)) { ctx.die.classList.remove('tumble'); ctx.rolling = false; ctx.rollButton.disabled = false; ctx.rollButton.textContent = 'RETRY ROLL'; banner(response && response.error || 'The shared die could not roll. Try again.'); return; }
  if (ctx.shared && response.state) {
    applyAuthoritativeState(response.state, response.rev);
    const stored = board && board.sharedRoll;
    if (stored && stored.id === ctx.req.id) {
      ctx.req = stored; ctx.controllerKey = sharedRollControllerKey(stored);
      sharedRollPresentation = sharedRollPresentationKey(stored);
    }
  }
  if (!ctx.el.isConnected) return;
  await revealDiceResult(ctx, response.result || response.roll, true);
}
function wireDiceContext(ctx) {
  ctx.rollButton.disabled = ctx.spectator; ctx.rollButton.onclick = () => void performDiceRoll(ctx);
  ctx.die.onclick = ctx.spectator ? null : () => void performDiceRoll(ctx);
  const locked = ctx.shared && ['requested', 'rolled'].includes(ctx.req && ctx.req.status);
  ctx.closeButton.disabled = locked; ctx.closeButton.onclick = locked ? null : () => ctx.el.remove();
  if (ctx.req && ['rolled', 'resolved'].includes(ctx.req.status) && ctx.req.natural != null) { ctx.rollButton.disabled = true; setTimeout(() => void presentPersistedDice(ctx), 350); }
  else if (ctx.aiRequested) { ctx.rollButton.textContent = 'AI ROLLING…'; setTimeout(() => void performDiceRoll(ctx), 700); }
}
function showDice(req) {
  if (presentationGateBlocksInput()) return;
  if (!req && sharedRollPending(board)) { presentSharedRoll(board.sharedRoll); return; }
  const prev = $('stage').querySelector('.dicebox'); if (prev) prev.remove();
  const ctx = createDiceContext(req); if (!ctx) return;
  renderChoices([]); $('stage').appendChild(ctx.el); captureDiceElements(ctx); paintDiceChoices(ctx); wireDiceContext(ctx);
}
function presentSharedRoll(roll) {
  if (presentationGatePending()) return;
  if (!roll || !roll.id) return;
  if (!['requested', 'rolled', 'resolved'].includes(roll.status)) return;
  const key = sharedRollPresentationKey(roll);
  const visible = $('stage').querySelector(`.dicebox[data-roll-id="${String(roll.id).replace(/"/g, '')}"]`);
  if (sharedRollPresentation === key && (roll.status === 'resolved' || visible)) return;
  const context = visible && visible._sharedDiceContext, controllerKey = sharedRollControllerKey(roll);
  sharedRollPresentation = key;
  if (context && context.controllerKey === controllerKey) {
    context.req = roll;
    if (roll.status === 'resolved') void finishResolvedDiceContext(context);
    else if (roll.status === 'rolled' && !context.rolling && !context.done) void presentPersistedDice(context);
    return;
  }
  showDice(roll);
}
/** Prose fallback: catch the DM asking for a roll in plain English — ability
 *  names, D&D skills (mapped to their ability), saves, and attack rolls, gated on
 *  a roll-ish verb so flavor text doesn't false-trigger. Pulls a DC if stated. */
const SKILL2ABIL = { athletics: 'strength', acrobatics: 'dexterity', 'sleight of hand': 'dexterity', stealth: 'dexterity', arcana: 'intelligence', history: 'intelligence', investigation: 'intelligence', nature: 'intelligence', religion: 'intelligence', 'animal handling': 'wisdom', insight: 'wisdom', medicine: 'wisdom', perception: 'wisdom', survival: 'wisdom', deception: 'charisma', intimidation: 'charisma', performance: 'charisma', persuasion: 'charisma' };
function detectRollAsk(text) {
  const s = String(text || '');
  const asky = /\b(roll|rolls|make|makes|give me|attempt|try|test|need|call for)\b/i.test(s) || /\b(check|save|saving throw|d20)\b/i.test(s);
  if (!asky) return null;
  const direct = s.match(/\bROLL\s*:?\s*(attack|strength|dexterity|constitution|intelligence|wisdom|charisma)(?:\s+(?:DC\s*)?(\d{1,2}))?/i);
  const dcm = s.match(/\bDC\s*(\d{1,2})/i); const dc = dcm ? Number(dcm[1]) : direct && direct[2] ? Number(direct[2]) : null;
  const pcs = board ? board.tokens.filter((t) => t.kind === 'pc') : [];
  const actor = pcs.find((t) => {
    const labels = [t.id, t.slug, t.name, shortTokenLabel(t)].filter(Boolean);
    return labels.some((label) => new RegExp(`\\b${String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s));
  });
  const actorSlug = actor ? actor.slug : null;
  if (direct) return { ability: direct[1].toLowerCase(), dc, actorSlug };
  const ab = s.match(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b/i);
  if (ab) return { ability: ab[1].toLowerCase(), dc, actorSlug };
  for (const sk in SKILL2ABIL) { if (new RegExp('\\b' + sk + '\\b', 'i').test(s)) return { ability: SKILL2ABIL[sk], dc, actorSlug }; }
  if (/\battack roll\b|\broll (?:to|for) (?:hit|attack)\b/i.test(s)) return { ability: 'attack', dc, actorSlug };
  return null;
}

// What each hero DOES — a plain role line + a real effect string per action.
const ROLE = {
  'Fighter': '🛡 Frontline — soaks hits, steady damage', 'Cleric (Life)': '✚ Healer — mends allies + holy damage',
  'Cleric': '✚ Healer — mends allies + holy damage', 'Wizard': '✦ Blaster — big ranged spells, very fragile',
  'Rogue': '🗡 Striker — sneak-attack burst + scout', 'Barbarian': '🪓 Berserker — huge melee, takes a beating',
  'Ranger': '🏹 Hunter — ranged damage, fast', 'Paladin': '🛡 Defender — armor, smite, some healing',
  'Bard': '🎻 Support — buffs, tricks, a bit of all',
};
function roleOf(s) { return (s && (ROLE[s.class] || ROLE[(s.class || '').replace(/\s*\(.*\)/, '')])) || ''; }
function effectStr(a) {
  if (a.mode === 'heal') { const h = a.heal || {}; return 'heal ' + (h.dice === '0d0' ? '+' + h.bonus : (h.dice + (h.bonus ? '+' + h.bonus : ''))); }
  const d = a.damage;
  if (a.mode === 'autohit') return `${a.darts || 1}×${d.dice}${d.bonus ? '+' + d.bonus : ''} ${d.type} · auto-hit`;
  if (a.mode === 'save') return `${a.aoeShape ? a.aoeShape + ' ' : ''}${d.dice} ${d.type} · ${a.save.ability} save`;
  if (d) return `+${a.toHit} hit · ${d.dice}${d.bonus ? '+' + d.bonus : ''} ${d.type}`;
  return a.mode;
}

// ── Story log + voice ────────────────────────────────────────────────────────
function registerArchiveSeq(seq, element) {
  const value = Number(seq);
  if (!Number.isInteger(value) || value < 1) return;
  archiveSeenSeq.add(value);
  if (element) element.dataset.archiveSeq = String(value);
  // Only move the poll cursor through a contiguous run. A direct /chat response
  // can arrive before an older sync beat; keeping the gap open makes sync fetch
  // that older beat instead of silently skipping it forever.
  while (archiveSeenSeq.has(lastSeq + 1)) lastSeq++;
}

/** @description Render the package-authored quest thread independently of transient narration. */
function renderQuestThread() {
  const root = $('questThread'), scene = content && campaign && board ? SC() : null;
  if (!root) return;
  root.classList.toggle('hidden', !scene);
  if (!scene) return;
  $('questTitle').textContent = scene.objective || scene.title || 'Follow the story';
  $('questAnchor').textContent = scene.storyAnchor || scene.opening || '';
  const replay = $('questReplay');
  replay.disabled = !scene.opening;
  replay.onclick = () => {
    openStory();
    if (scene.opening) void presentPhase(scene.opening, 2400, true);
  };
}

function addBeat(kind, text, say, seq, live) {
  rememberPresentationArchiveBeat(kind, text);
  const sequence = Number(seq);
  if (Number.isInteger(sequence) && sequence > 0 && archiveSeenSeq.has(sequence)) return null;
  const el = document.createElement('div'); el.className = 'beat ' + kind;
  if (kind === 'cutaway') { el.innerHTML = `<span class="k">cutaway</span><img src="${esc(text)}" style="max-width:100%;border-radius:10px;border:1px solid var(--line);cursor:pointer">`; el.querySelector('img').onclick = () => showCutaway(text); if (live) showCutaway(text); }
  else el.innerHTML = `<span class="k">${kind.replace('-', ' ')}</span>${say ? `<span class="say">“${esc(say)}”</span><br>` : ''}${esc(text)}`;
  $('log').appendChild(el);
  const rail = $('railScroll');
  if (rail) rail.scrollTop = rail.scrollHeight;
  if (Number.isInteger(sequence) && sequence > 0) registerArchiveSeq(sequence, el);
  return el;
}
let localArchiveEchoes = [], archivePostQueue = Promise.resolve();
let rewindArchiveReloadJob = null;
function archivePostContext() {
  return {
    campaignId: campaign && campaign.campaign_id, epoch: campaignEpoch,
    timelineId: String(board && board.presentationGate && board.presentationGate.id || ''),
  };
}
function archivePostContextCurrent(context) {
  const timelineId = String(board && board.presentationGate && board.presentationGate.id || '');
  return !!campaign && campaign.campaign_id === context.campaignId
    && campaignEpoch === context.epoch && timelineId === context.timelineId;
}
async function sendArchiveBeat(context, kind, content, payload) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
  try {
    const r = await api('/archive', { method: 'POST', signal: controller && controller.signal,
      body: JSON.stringify({ campaignId: context.campaignId, timelineId: context.timelineId, kind, content, payload }) });
    return r && r.entry || null;
  } catch (_error) { return null; }
  finally { if (timer) clearTimeout(timer); }
}
async function sendRequiredArchiveBeat(context, kind, content, payload) {
  let attempt = 0;
  while (archivePostContextCurrent(context)) {
    const entry = await sendArchiveBeat(context, kind, content, payload);
    if (entry) return entry;
    attempt++;
    banner('Connection interrupted · saving this exact result before the turn can continue.');
    await waitMs(Math.min(4000, 500 * (2 ** Math.min(attempt - 1, 3))));
  }
  return null;
}
async function postBeat(kind, content, payload, required) {
  if (!campaign) return null;
  const context = archivePostContext();
  const send = () => required
    ? sendRequiredArchiveBeat(context, kind, content, payload)
    : sendArchiveBeat(context, kind, content, payload);
  const queued = archivePostQueue.then(send, send);
  archivePostQueue = queued.then(() => null, () => null);
  return queued;
}
function recordArchivedBeat(kind, content, payload, required) {
  const element = addBeat(kind, content);
  const marker = { kind, content: String(content), payload, element }; localArchiveEchoes.push(marker);
  return postBeat(kind, content, payload, required).then((entry) => {
    const index = localArchiveEchoes.indexOf(marker);
    if (index < 0) return entry; // the sync tail already matched and consumed it
    localArchiveEchoes.splice(index, 1);
    if (entry && entry.seq) registerArchiveSeq(entry.seq, marker.element);
    return entry;
  });
}
async function recordCombat(content, rollEvent) {
  const diceShown = presentCombatDie(content, null, rollEvent);
  const archived = recordArchivedBeat('combat', content, rollEvent, true);
  const results = await Promise.all([diceShown, archived]);
  return results[0];
}
function pendingBeat() { const el = addBeat('narration', ''); el.innerHTML = '<span class="spin"></span> the Dungeon Master is speaking…'; return el; }

/** @description Return the valid rewind gate for one candidate board. */
function rewindArchiveGate(state) {
  const value = state || board, gate = value && value.presentationGate;
  if (!gate || gate.kind !== 'rewind' || !gate.id) return null;
  if (String(gate.sceneId || '') !== String(value.sceneId || '')) return null;
  if (Number(gate.turnSerial) !== (Number(value.turnSerial) || 0)) return null;
  return gate;
}

/** @description Rebuild every archive-derived client cache from one server branch. */
function rebuildAuthoritativeArchive(rows) {
  resetTurnPresentationMemory(); resetPresentationArchiveMemory(); resetCombatDiceMemory();
  sharedRollPresentation = ''; localArchiveEchoes = [];
  $('log').innerHTML = ''; lastSeq = 0; archiveSeenSeq = new Set();
  rows.forEach((beat) => addBeat(beat.kind, beat.content, null, beat.seq));
  if (rows.length) lastSeq = Math.max(...rows.map((beat) => Number(beat.seq) || 0));
}

/** @description Fetch the full pruned branch and reject stale campaign responses. */
async function fetchRewindArchive(gate) {
  const requestEpoch = campaignEpoch, campaignId = campaign && campaign.campaign_id;
  try {
    await archivePostQueue;
    if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return false;
    const query = `?campaignId=${encodeURIComponent(campaignId)}&rewindGate=${encodeURIComponent(gate.id)}`;
    const result = await api(`/archive${query}`, { cache: 'no-store' });
    if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId) return false;
    if (!result || !Array.isArray(result.archive)) throw new Error('archive unavailable');
    rebuildAuthoritativeArchive(result.archive); finishRewindArchiveTransition(gate, true);
    return true;
  } catch (_error) {
    if (requestEpoch === campaignEpoch && campaign && campaign.campaign_id === campaignId) finishRewindArchiveTransition(gate, false);
    return false;
  }
}

/** @description Single-flight one authoritative archive reload per rewind gate. */
function prepareRewindArchive(state) {
  const gate = rewindArchiveGate(state);
  if (!gate) return Promise.resolve(false);
  if (rewindArchiveReady(gate)) return Promise.resolve(true);
  const key = rewindArchiveKey(gate);
  if (rewindArchiveReloadJob && rewindArchiveReloadJob.key === key) return rewindArchiveReloadJob.promise;
  beginRewindArchiveTransition(state);
  const promise = fetchRewindArchive(gate).finally(() => {
    if (rewindArchiveReloadJob && rewindArchiveReloadJob.promise === promise) rewindArchiveReloadJob = null;
  });
  rewindArchiveReloadJob = { key, promise };
  return promise;
}

// Fixed natural narration lives in table-voice.js, loaded before this consumer.

// ── Sync ─────────────────────────────────────────────────────────────────────
const ARCHIVE_RECONNECT_GAP_MS = 5000;
let syncTimer = null, syncInFlight = false, syncEpoch = 0;
let archivePlaybackLive = false, archiveSyncCompletedAt = 0;
function persistedBoardCopy(value) {
  return value ? JSON.parse(JSON.stringify(value, function (key, item) {
    return key.startsWith('_') && this && this.id && this.kind ? undefined : item;
  })) : null;
}
function rememberConfirmedBoard(state, nextRev, campaignId) {
  confirmedBoard = persistedBoardCopy(state);
  confirmedBoardRev = Number(nextRev) || 0;
  confirmedCampaignId = campaignId || campaign && campaign.campaign_id || '';
}
function boardsEquivalent(left, right) {
  return JSON.stringify(persistedBoardCopy(left)) === JSON.stringify(persistedBoardCopy(right));
}
function applyAuthoritativeState(nextState, nextRev, nextSheets, nextSheetsRev) {
  if (!nextState) return;
  if (board && boardsEquivalent(board, nextState)) {
    if (Number.isFinite(Number(nextRev))) rev = Number(nextRev);
    rememberConfirmedBoard(nextState, rev);
    if (nextSheets) { boardSheets = nextSheets; renderDock(); }
    if (nextSheetsRev) sheetsRev = nextSheetsRev;
    return;
  }
  const previous = board, sceneWas = previous && previous.sceneId, modeWas = previous && previous.mode;
  const priorById = new Map(((previous && previous.tokens) || []).map((t) => [t.id, t]));
  const branchWas = previous && previous.presentationGate && previous.presentationGate.id;
  const branchNow = nextState.presentationGate && nextState.presentationGate.id;
  cancelAutomatedWork(); cancelCombatDice(); telegraph = null; automationPhase = null;
  if (branchWas && branchNow && branchWas !== branchNow) { stopSpeech(); dismissCaption(); }
  turnResolutionPending = null; turnAdvanceInFlight = null;
  board = nextState;
  if (Number.isFinite(Number(nextRev))) rev = Number(nextRev);
  rememberConfirmedBoard(board, rev);
  if (nextSheets) boardSheets = nextSheets;
  if (nextSheetsRev) sheetsRev = nextSheetsRev;
  selected = null; selectedAction = null; inspect = null; clearReachable();
  if (board.sceneId !== sceneWas && ['resolved', 'defeat'].includes($('overlayCard').dataset.screen)) closeOverlay();
  if (board.mode === 'combat' && (modeWas !== 'combat' || board.sceneId !== sceneWas)) setStoryOpen(false);
  if (!sceneWas || board.sceneId !== sceneWas) { indexTerrain(); layout(); }
  updateInitiativeBar();
  const presentationLocked = handleAuthoritativePresentationGate(previous) || !!rewindArchiveTransitionGate;
  if (!presentationLocked && board.sharedRoll) setTimeout(() => presentSharedRoll(board.sharedRoll), 0);
  if (!presentationLocked && !sharedRollPending(board) && board.mode === 'combat') setTimeout(() => beginTurn(), 0);
  else { renderDock(); setTurnFlag(); }
  const newlyDown = board.tokens.find((token) => controls(token) && isDowned(token) && !isDowned(priorById.get(token.id)));
  if (!presentationLocked && newlyDown) void acknowledgeDowned(newlyDown);
  if (modeWas !== board.mode && !TV) {
    if (board.mode === 'resolved' || board.mode === 'complete') showResolvedState();
    else if (board.mode === 'defeat') showDefeatState();
  }
}
async function restoreAuthoritativeBoard() {
  const campaignId = campaign && campaign.campaign_id;
  if (!campaignId) return false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;
  try {
    const r = await api(`/sync?campaignId=${encodeURIComponent(campaignId)}&rev=-1&seq=${Number(lastSeq) || 0}&sheetsRev=${encodeURIComponent(sheetsRev || '')}`, { signal: controller && controller.signal });
    if (r && r.ok && r.state && campaign && campaign.campaign_id === campaignId) {
      if (r.players) players = r.players;
      applyAuthoritativeState(r.state, r.rev, r.sheets, r.sheetsRev);
      return true;
    }
  } catch (_e) { /* fall back to the last confirmed local copy below */ }
  finally { if (timeout) clearTimeout(timeout); }
  if (confirmedBoard && confirmedCampaignId === campaignId) {
    applyAuthoritativeState(persistedBoardCopy(confirmedBoard), confirmedBoardRev);
    return true;
  }
  return false;
}
function resumeCombatAfterSeatChange(changed, stateReconciled) {
  if (changed && !stateReconciled && board && board.mode === 'combat') beginTurn();
}
function localArchiveEchoIndex(beat) {
  const eventId = beat && beat.payload && beat.payload.eventId;
  return localArchiveEchoes.findIndex((entry) => {
    const localEventId = entry.payload && entry.payload.eventId;
    if (eventId || localEventId) return !!eventId && eventId === localEventId;
    return entry.kind === beat.kind && entry.content === String(beat.content);
  });
}
/** @description Allow presentation only while polls are current and fully caught up. */
function archiveResponseMayPresent() {
  return archivePlaybackLive && archiveSyncCompletedAt > 0
    && Date.now() - archiveSyncCompletedAt <= ARCHIVE_RECONNECT_GAP_MS;
}

/** @description Require one silent synchronization pass before presenting live beats. */
function resetArchivePlaybackWindow() {
  archivePlaybackLive = false; archiveSyncCompletedAt = 0;
}

async function syncArchiveBeat(beat, present) {
  const sequence = Number(beat && beat.seq);
  if (!Number.isInteger(sequence) || archiveSeenSeq.has(sequence)) return false;
  const echoAt = localArchiveEchoIndex(beat);
  const shouldPresent = !!present && echoAt < 0;
  let element;
  if (echoAt >= 0) {
    const echo = localArchiveEchoes.splice(echoAt, 1)[0];
    element = echo && echo.element; registerArchiveSeq(sequence, element);
  } else element = addBeat(beat.kind, beat.content, null, sequence, shouldPresent);
  if (shouldPresent && beat.kind === 'combat') await presentCombatDie(beat.content, sequence, beat.payload);
  if (shouldPresent && element && ['narration', 'milestone', 'table-talk'].includes(beat.kind)) {
    const clean = beat.content.replace(/^> .*\n/, '');
    speakCaption(clean);
  }
  return true;
}
async function syncArchiveTail(beats, mayPresent) {
  const unseen = (beats || []).filter((beat) => {
    const sequence = Number(beat && beat.seq);
    return Number.isInteger(sequence) && sequence > 0 && !archiveSeenSeq.has(sequence);
  });
  for (const beat of unseen) await syncArchiveBeat(beat, mayPresent);
  return unseen.length;
}
function syncContextCurrent(epoch, campaignId) {
  return epoch === syncEpoch && campaign && campaign.campaign_id === campaignId;
}

/** @description Reconcile one rewind branch before any stale tail or board render. */
async function reconcileRewindSync(response, epoch, campaignId) {
  const changed = response.changed && Number(response.rev) > Number(rev);
  const incoming = changed ? rewindArchiveGate(response.state) : null;
  const current = rewindArchiveGate(board);
  const gate = incoming || (current && !rewindArchiveReady(current) ? current : null);
  if (!gate) return false;
  const ready = rewindArchiveReady(gate) || await prepareRewindArchive(incoming ? response.state : board);
  if (!syncContextCurrent(epoch, campaignId)) return true;
  if (incoming) applyAuthoritativeState(response.state, response.rev, response.sheets, response.sheetsRev);
  if (!ready) banner('The restored story did not reload yet. The table stays locked and will retry automatically.');
  else if (!incoming) {
    if (pendingPresentationGate()) void resumePendingPresentationGate();
    else applyAuthoritativeState(persistedBoardCopy(board), rev);
  }
  return true;
}

/** @description Apply one poll response in branch-safe deterministic order. */
async function reconcileSyncResponse(response, epoch, campaignId) {
  const responseMayPresent = archiveResponseMayPresent();
  const rewindHandled = await reconcileRewindSync(response, epoch, campaignId);
  let stateReconciled = rewindHandled;
  if (!syncContextCurrent(epoch, campaignId)) return;
  const seatsBefore = JSON.stringify(players), sheetsChanged = !!response.sheets;
  if (response.players) players = response.players;
  const seatsChanged = seatsBefore !== JSON.stringify(players);
  if (seatsChanged) { updateInitiativeBar(); renderDock(); setTurnFlag(); }
  if (response.sheets) { boardSheets = response.sheets; renderDock(); }
  if (response.sheetsRev) sheetsRev = response.sheetsRev;
  if (!rewindHandled && response.changed && response.rev > rev) {
    if (boardsEquivalent(board, response.state)) {
      rev = Number(response.rev); rememberConfirmedBoard(response.state, rev, campaignId);
    } else { applyAuthoritativeState(response.state, response.rev); stateReconciled = true; }
  }
  if (!rewindHandled) {
    const received = await syncArchiveTail(response.archiveTail || [], responseMayPresent);
    archivePlaybackLive = responseMayPresent || received === 0;
    archiveSyncCompletedAt = Date.now();
  }
  if (!syncContextCurrent(epoch, campaignId)) return;
  resumeCombatAfterSeatChange(seatsChanged, stateReconciled);
  if ((seatsChanged || sheetsChanged) && $('overlayCard').dataset.screen === 'lobby') showLobby();
  if (board.mode === 'combat' && ['lobby', 'tv-lobby', 'character-import', 'claim-heroes'].includes($('overlayCard').dataset.screen)) closeOverlay();
}

/** @description Invalidate any pre-rewind poll before its abandoned tail can land. */
function pauseSyncForRewind() {
  clearInterval(syncTimer); syncTimer = null; syncEpoch++; syncInFlight = false;
}
function startSync() {
  clearInterval(syncTimer);
  resetArchivePlaybackWindow();
  const epoch = ++syncEpoch, campaignId = campaign && campaign.campaign_id;
  syncInFlight = false;
  const poll = async () => {
    if (!campaign || campaign.campaign_id !== campaignId || document.hidden || syncInFlight) return;
    syncInFlight = true;
    try {
      const requestRev = rev, requestSeq = lastSeq, requestSheetsRev = sheetsRev;
      const r = await api(`/sync?campaignId=${campaignId}&rev=${requestRev}&seq=${requestSeq}&sheetsRev=${encodeURIComponent(requestSheetsRev || '')}`, { timeoutMs: 8000 });
      if (epoch !== syncEpoch || !campaign || campaign.campaign_id !== campaignId || !r.ok) return;
      await reconcileSyncResponse(r, epoch, campaignId);
    } catch (_e) { /* transient */ }
    finally { if (epoch === syncEpoch) syncInFlight = false; }
  };
  syncTimer = setInterval(() => void poll(), TV ? 1200 : 1600);
  void poll();
}

// ── Persistence ──────────────────────────────────────────────────────────────
let saveTimer = null, saveInFlight = false, saveAgain = false, lastSaveSucceeded = false;
let saveDrainWaiters = [];
function settleSaveDrain() {
  if (saveInFlight || saveAgain || saveTimer) return;
  const waiters = saveDrainWaiters.splice(0);
  waiters.forEach((resolve) => resolve(lastSaveSucceeded));
}
function waitForSaveDrain() {
  if (!saveInFlight && !saveAgain && !saveTimer) return Promise.resolve(lastSaveSucceeded);
  return new Promise((resolve) => saveDrainWaiters.push(resolve));
}
function scheduleStateFlush(delay) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void flushState(); }, delay);
}
function persist() {
  if (!campaign || TV) return;
  scheduleStateFlush(250);
}
async function flushPendingState() {
  if (!campaign || TV) return false;
  clearTimeout(saveTimer); saveTimer = null;
  const saved = await flushState();
  if (saveInFlight || saveAgain || saveTimer) return waitForSaveDrain();
  return saved;
}
function serializeBoardForSave() {
  return JSON.stringify(board, function (key, value) {
    return key.startsWith('_') && this && this.id && this.kind ? undefined : value;
  });
}
async function flushState() {
  if (!campaign || TV) { lastSaveSucceeded = false; settleSaveDrain(); return false; }
  if (saveInFlight) { saveAgain = true; return waitForSaveDrain(); }
  clearTimeout(saveTimer); saveTimer = null;
  saveInFlight = true;
  let saved = false, authoritativeApplied = false;
  const expectedRev = rev, payload = serializeBoardForSave();
  const saveCampaignId = campaign.campaign_id, saveCampaignEpoch = campaignEpoch;
  const contextCurrent = () => campaignEpoch === saveCampaignEpoch && campaign && campaign.campaign_id === saveCampaignId;
  try {
    const r = await api('/state', { method: 'POST', timeoutMs: 15000,
      body: JSON.stringify({ campaignId: saveCampaignId, expectedRev, state: JSON.parse(payload) }) });
    if (!contextCurrent()) return false;
    if (r && r.conflict && r.state) {
      saveAgain = false;
      applyAuthoritativeState(r.state, r.rev, r.sheets, r.sheetsRev);
      authoritativeApplied = true;
      banner('The table changed on another device — synced to the latest turn.');
    } else if (r && r.ok && Number.isFinite(Number(r.rev))) {
      rev = Number(r.rev); saved = true; rememberConfirmedBoard(JSON.parse(payload), rev, saveCampaignId);
    }
    else if (r && r.error) banner(r.error);
  } catch (_e) { if (contextCurrent()) banner('Could not sync that move — reconnecting to the table…'); }
  finally {
    if (contextCurrent()) {
      if (!saved && !authoritativeApplied) {
        saveAgain = false;
        await restoreAuthoritativeBoard();
      }
      saveInFlight = false; lastSaveSucceeded = saved;
      if (saveAgain) { saveAgain = false; scheduleStateFlush(0); }
      else settleSaveDrain();
    }
  }
  return saved;
}

function resetCampaignPipelines() {
  campaignEpoch++;
  resetPresentationGateController(true); resetPresentationArchiveMemory(); resetRewindArchiveBarrier();
  clearInterval(syncTimer); syncTimer = null; syncEpoch++; syncInFlight = false;
  cancelAutomatedWork(); resetTurnPresentationMemory(); stopSpeech(); dismissCaption();
  clearTimeout(saveTimer); saveTimer = null; saveInFlight = false; saveAgain = false; lastSaveSucceeded = false;
  saveDrainWaiters.splice(0).forEach((resolve) => resolve(false));
  archivePostQueue = Promise.resolve(); localArchiveEchoes = []; rewindArchiveReloadJob = null;
  resetArchivePlaybackWindow();
  confirmedBoard = null; confirmedBoardRev = 0; confirmedCampaignId = '';
  sharedRollPresentation = '';
  resetCombatDiceMemory();
  $('stage').querySelectorAll('.dicebox').forEach((die) => die.remove());
  advanceInFlight = false;
}
