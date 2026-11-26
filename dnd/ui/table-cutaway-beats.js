/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Tabletop cutaway beat controller: renders non-blocking local transitions for common beats and cap fallbacks, dispatches keyed big combat beats, and maintains the visible per-campaign cutaway budget badge (v0.22.9).
 */

'use strict';

const CUTAWAY_BEATS = window.DnDCutawayBeats || null;
let currentCutawayBudget = null;
let localBeatBannerTimer = null;
const cutawayBeatMemory = {
  firstBloodScenes: new Set(),
  revealedBosses: new Set(),
  dispatchedKeys: new Set(),
};

/** @description Reset per-campaign cutaway beat deduplication memory on campaign switch. */
function resetCutawayBeatState() {
  cutawayBeatMemory.firstBloodScenes.clear();
  cutawayBeatMemory.revealedBosses.clear();
  cutawayBeatMemory.dispatchedKeys.clear();
  dismissLocalBeatTransition();
}

/** @description Return the current normalized campaign cutaway budget or null when inactive. */
function getCutawayBudget() {
  return currentCutawayBudget ? { ...currentCutawayBudget } : null;
}

/** @description Format the visible cutaway budget badge label and accessible description. */
function formatCutawayBudgetCopy(budget) {
  const used = Math.max(0, Number(budget && budget.used) || 0);
  const cap = CUTAWAY_BEATS ? CUTAWAY_BEATS.normalizeCutawayCap(budget && budget.cap) : (Number(budget && budget.cap) || 20);
  const remaining = Math.max(0, cap - used);
  const capped = remaining === 0;
  return {
    used, cap, remaining, capped,
    label: capped ? `Art ${used}/${cap} (cap reached)` : `Art ${used}/${cap}`,
    ariaLabel: capped
      ? `Campaign cutaway art budget: ${used} of ${cap} used (cap reached)`
      : `Campaign cutaway art budget: ${used} of ${cap} used`,
    title: capped
      ? `Campaign cutaway art limit reached (${used}/${cap}); using local transitions.`
      : `Campaign cutaway art budget: ${used} of ${cap} used (${remaining} remaining).`,
  };
}

/** @description Build the compact HTML badge rendered inside the tabletop initiative strip. */
function cutawayBudgetBadgeHtml() {
  if (!campaign || !currentCutawayBudget) return '';
  const copy = formatCutawayBudgetCopy(currentCutawayBudget);
  return `<span id="cutawayBudgetBadge" class="cutaway-budget${copy.capped ? ' capped' : ''}" role="status" aria-label="${esc(copy.ariaLabel)}" title="${esc(copy.title)}">${esc(copy.label)}</span>`;
}

/** @description Synchronize both the HUD badge and More-menu budget indicator cleanly. */
function renderCutawayBudget() {
  const active = !!(campaign && currentCutawayBudget);
  const copy = active ? formatCutawayBudgetCopy(currentCutawayBudget) : null;
  const badge = $('cutawayBudgetBadge');
  if (badge) {
    badge.classList.toggle('hidden', !active);
    if (copy) {
      badge.classList.toggle('capped', copy.capped);
      badge.textContent = copy.label;
      badge.setAttribute('aria-label', copy.ariaLabel);
      badge.title = copy.title;
    }
  }
  const menuBadge = $('moreCutawayBudget');
  if (menuBadge) {
    menuBadge.classList.toggle('hidden', !active);
    if (copy) {
      menuBadge.classList.toggle('capped', copy.capped);
      menuBadge.textContent = copy.capped ? `Cutaway art: ${copy.used}/${copy.cap} (cap reached)` : `Cutaway art: ${copy.used}/${copy.cap}`;
      menuBadge.setAttribute('aria-label', copy.ariaLabel);
      menuBadge.title = copy.title;
    }
  }
}

/** @description Adopt an authoritative cutaway budget object and refresh visible indicators. */
function setCutawayBudget(budget) {
  if (!budget || typeof budget !== 'object') {
    currentCutawayBudget = null;
    renderCutawayBudget();
    return null;
  }
  currentCutawayBudget = CUTAWAY_BEATS
    ? CUTAWAY_BEATS.buildCutawayBudget(budget.used, budget.cap)
    : { used: Math.max(0, Number(budget.used) || 0), cap: Number(budget.cap) || 20, remaining: Math.max(0, (Number(budget.cap) || 20) - (Number(budget.used) || 0)) };
  renderCutawayBudget();
  return getCutawayBudget();
}

/** @description Infer an initial cutaway budget from loaded archive rows when /state omits one. */
function inferCutawayBudgetFromArchive(rows) {
  const unique = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && String(row.kind) === 'cutaway' && row.content) unique.add(String(row.content).trim());
  }
  return CUTAWAY_BEATS
    ? CUTAWAY_BEATS.buildCutawayBudget(unique.size, CUTAWAY_BEATS.DEFAULT_CUTAWAY_CAP)
    : { used: unique.size, cap: 20, remaining: Math.max(0, 20 - unique.size) };
}

/** @description Clear any visible local combat-beat transition banner immediately. */
function dismissLocalBeatTransition() {
  clearTimeout(localBeatBannerTimer);
  localBeatBannerTimer = null;
  const el = $('localBeatBanner');
  if (!el) return;
  el.classList.remove('show');
  el.classList.add('hidden');
}

/** @description Render a fast, non-blocking local CSS/DOM transition for common beats or cap fallback. */
function showLocalBeatTransition(beat, durationMs) {
  const el = $('localBeatBanner');
  if (!el || !beat || (!beat.title && !beat.caption)) return false;
  clearTimeout(localBeatBannerTimer);
  const accent = String(beat.accent || 'amber').replace(/[^a-z0-9-]/gi, '');
  el.className = `local-beat-banner show accent-${accent}`;
  el.dataset.beatKind = String(beat.beatKind || 'local');
  el.innerHTML = `<span class="local-beat-kicker">${esc(beat.title || 'Combat Beat')}</span><span class="local-beat-copy">${esc(beat.caption || '')}</span>`;
  localBeatBannerTimer = setTimeout(() => {
    el.classList.remove('show');
    el.classList.add('hidden');
    localBeatBannerTimer = null;
  }, Math.max(800, Number(durationMs) || 2400));
  return true;
}

/** @description Dispatch one classified beat: local beats stay local, big beats request keyed art with cap fallback. */
async function dispatchClassifiedCutawayBeat(beat) {
  if (!beat || beat.tier === 'none') return { tier: 'none' };
  if (beat.tier === 'local') {
    showLocalBeatTransition(beat);
    return { tier: 'local', beatKind: beat.beatKind, requested: false };
  }
  const campaignId = campaign && campaign.campaign_id || '';
  const dedupKey = `${campaignId}:${beat.key}`;
  if (cutawayBeatMemory.dispatchedKeys.has(dedupKey)) {
    return { tier: 'generated', beatKind: beat.beatKind, deduplicated: true, requested: false };
  }
  cutawayBeatMemory.dispatchedKeys.add(dedupKey);
  if (currentCutawayBudget && currentCutawayBudget.remaining <= 0) {
    showLocalBeatTransition(beat);
    return { tier: 'local', beatKind: beat.beatKind, capped: true, requested: false };
  }
  if (!campaign || typeof requestCutaway !== 'function') {
    showLocalBeatTransition(beat);
    return { tier: 'local', beatKind: beat.beatKind, requested: false };
  }
  const result = await requestCutaway(beat.prompt, false, beat.key, { beatKind: beat.beatKind, fallbackBeat: beat });
  if (!result || !result.ok) showLocalBeatTransition(beat);
  return { tier: 'generated', beatKind: beat.beatKind, requested: true, result };
}

/** @description Classify one resolved combat outcome and drive either a big cutaway or cheap local transition. */
function handleCombatOutcomeBeats(actor, outcome, narration) {
  if (!CUTAWAY_BEATS || !board || board.mode !== 'combat') return null;
  const scene = typeof SC === 'function' ? SC() : null;
  const sceneId = String(board.sceneId || (scene && scene.id) || 'scene');
  const firstBloodKey = `${campaign && campaign.campaign_id || ''}:${sceneId}`;
  const classified = CUTAWAY_BEATS.classifyOutcomeBeat({
    actor, outcome, narration,
    tokens: board.tokens || [],
    sceneId, sceneTitle: (scene && scene.title) || sceneId,
    round: board.round || 1,
    firstBloodClaimed: cutawayBeatMemory.firstBloodScenes.has(firstBloodKey),
  });
  if (classified.claimedFirstBlood) cutawayBeatMemory.firstBloodScenes.add(firstBloodKey);
  void dispatchClassifiedCutawayBeat(classified.beat);
  return classified.beat;
}

/** @description Trigger one keyed boss-reveal cutaway the first time a boss appears in a combat scene. */
function checkBossRevealBeat() {
  if (!CUTAWAY_BEATS || !board || board.mode !== 'combat') return null;
  const scene = typeof SC === 'function' ? SC() : null;
  const monsters = content && content.monsters || {};
  const bosses = CUTAWAY_BEATS.findBossTokens(board.tokens || [], scene, monsters);
  if (!bosses.length) return null;
  const boss = bosses[0];
  const sceneId = String(board.sceneId || (scene && scene.id) || 'scene');
  const seenKey = `${campaign && campaign.campaign_id || ''}:${sceneId}:${boss.id}`;
  if (cutawayBeatMemory.revealedBosses.has(seenKey)) return null;
  cutawayBeatMemory.revealedBosses.add(seenKey);
  const beat = CUTAWAY_BEATS.classifyCombatBeat({
    kind: 'boss-reveal', sceneId, sceneTitle: (scene && scene.title) || sceneId,
    round: board.round || 1, bossId: boss.id,
    bossName: typeof tokenDisplayName === 'function' ? tokenDisplayName(boss) : boss.name,
    bossRole: typeof tokenRoleLabel === 'function' ? tokenRoleLabel(boss) : boss.role,
  });
  void dispatchClassifiedCutawayBeat(beat);
  return beat;
}

/** @description Trigger keyed level-up cutaways when /advance levels one or more heroes. */
function triggerLevelUpCutaways(levelUps, notes) {
  if (!CUTAWAY_BEATS || !Array.isArray(levelUps) || !levelUps.length) return [];
  const scene = typeof SC === 'function' ? SC() : null;
  const sceneId = String((board && board.sceneId) || (scene && scene.id) || 'scene');
  const sceneTitle = (scene && scene.title) || 'The adventure';
  const note = Array.isArray(notes) && notes[0] ? String(notes[0]) : '';
  const beats = [];
  for (const entry of levelUps) {
    if (!entry || !entry.level) continue;
    const beat = CUTAWAY_BEATS.classifyCombatBeat({
      kind: 'level-up', sceneId, sceneTitle,
      heroId: entry.slug || entry.id || entry.name,
      heroName: entry.name || entry.slug,
      newLevel: Number(entry.level), narration: note,
    });
    beats.push(beat);
    void dispatchClassifiedCutawayBeat(beat);
  }
  return beats;
}
