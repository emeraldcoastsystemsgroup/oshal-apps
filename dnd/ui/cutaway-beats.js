/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pure combat beat classifier, boss detector, cutaway cap normalization, and deterministic deduplication keys for big combat beats vs cheap local transitions (v0.22.9).
 */

(function initDnDCutawayBeats(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DnDCutawayBeats = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function createCutawayBeats() {
  'use strict';

  const DEFAULT_CUTAWAY_CAP = 20;
  const MIN_CUTAWAY_CAP = 1;
  const MAX_CUTAWAY_CAP = 50;
  const BIG_BEAT_KINDS = Object.freeze(['nat20', 'nat1', 'first-blood', 'hero-down', 'level-up', 'boss-reveal']);
  const LOCAL_BEAT_KINDS = Object.freeze(['local:hit', 'local:miss', 'local:spell', 'local:heal', 'local:advance']);
  const BOSS_TITLE_RE = /\b(boss|warden|captain|chief|commander|overlord|warlord|archmage|champion)\b/i;

  /** @description Clamp a requested per-campaign cutaway cap to a safe integer range. */
  function normalizeCutawayCap(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_CUTAWAY_CAP;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_CUTAWAY_CAP;
    return Math.max(MIN_CUTAWAY_CAP, Math.min(MAX_CUTAWAY_CAP, Math.floor(parsed)));
  }

  /** @description Normalize one deterministic key segment to safe lowercase tokens. */
  function slugPart(value, fallback) {
    const clean = String(value == null ? '' : value)
      .trim().toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return clean || String(fallback || 'unknown');
  }

  /** @description Normalize one display name without introducing markup or overflow. */
  function cleanLabel(value, fallback) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 80);
    return text || String(fallback || '');
  }

  /** @description Normalize one cutaway budget summary into exact non-negative counters. */
  function buildCutawayBudget(used, cap) {
    const safeCap = normalizeCutawayCap(cap);
    const safeUsed = Math.max(0, Math.floor(Number(used) || 0));
    return { used: safeUsed, cap: safeCap, remaining: Math.max(0, safeCap - safeUsed) };
  }

  /** @description Identify whether a combatant qualifies as a boss adversary. */
  function isBossMonster(token, scene, monsters) {
    if (!token || token.kind !== 'monster') return false;
    if (token.boss === true) return true;
    const authored = scene && Array.isArray(scene.monsters)
      ? scene.monsters.find((entry) => entry && entry.instanceId === token.id) : null;
    if (authored && authored.boss === true) return true;
    const entry = monsters && token.ref ? monsters[token.ref] : null;
    if (entry && (entry.boss === true || Number(entry.cr) >= 2)) return true;
    const descriptor = [token.name, token.role, authored && authored.role, entry && entry.name].filter(Boolean).join(' ');
    if (BOSS_TITLE_RE.test(descriptor)) return true;
    return Number(token.maxHp) >= 21;
  }

  /** @description Return all living visible boss tokens currently on the encounter board. */
  function findBossTokens(tokens, scene, monsters) {
    if (!Array.isArray(tokens)) return [];
    return tokens.filter((token) => token && !token.dead && !token.fled && !token.hidden
      && isBossMonster(token, scene, monsters));
  }

  /** @description Build one generated-tier big combat beat with a repeatable dedup key. */
  function bigBeat(beatKind, key, title, caption, prompt, accent) {
    return { tier: 'generated', beatKind, key, title, caption, prompt: String(prompt || caption).slice(0, 650), accent };
  }

  /** @description Build one cheap local-only transition beat (never calls image generation). */
  function localBeat(beatKind, title, caption, accent) {
    return { tier: 'local', beatKind, key: null, title, caption, prompt: '', accent };
  }

  /** @description Classify milestone big beats (level-up, boss-reveal, hero-down). */
  function classifyMilestoneBeat(event, kind, sceneId, sceneTitle, round, note) {
    if (kind === 'level-up' || (Number(event.newLevel) > 1 && (event.heroId || event.heroName))) {
      const heroId = slugPart(event.heroId || event.actorId, 'hero');
      const hero = cleanLabel(event.heroName || event.actorName, 'The hero');
      const lv = Math.max(2, Math.floor(Number(event.newLevel) || 2));
      return bigBeat('level-up', `beat:level-up:${heroId}:lv${lv}`, `Level ${lv} Reached!`,
        `${hero} ascends to Level ${lv}.`,
        `${sceneTitle}. Heroic milestone: ${hero} rises to Level ${lv} in golden torchlight. ${note}`, 'gold');
    }
    if (kind === 'boss-reveal' || event.bossId) {
      const bossId = slugPart(event.bossId || event.targetId || event.actorId, 'boss');
      const boss = cleanLabel(event.bossName || event.targetName || event.actorName, 'The enemy leader');
      const role = cleanLabel(event.bossRole, 'dread commander');
      return bigBeat('boss-reveal', `beat:boss-reveal:${sceneId}:${bossId}`, 'Boss Revealed',
        `${boss} (${role}) steps into the fray!`,
        `${sceneTitle}. Dramatic boss reveal: ${boss}, ${role}, confronts the party. ${note}`, 'crimson');
    }
    if (kind === 'hero-down' || event.heroDown === true) {
      const heroId = slugPart(event.heroId || event.targetId || event.actorId, 'hero');
      const hero = cleanLabel(event.heroName || event.targetName || event.actorName, 'A hero');
      return bigBeat('hero-down', `beat:hero-down:${sceneId}:${heroId}:${round}`, 'Hero Down!',
        `${hero} falls to 0 HP!`,
        `${sceneTitle}. Dramatic fall: ${hero} drops to the stones at 0 HP while allies rush to aid. ${note}`, 'crimson');
    }
    return null;
  }

  /** @description Classify combat roll big beats (nat20, nat1, first-blood). */
  function classifyRollBeat(event, kind, sceneId, sceneTitle, round, note) {
    const actor = cleanLabel(event.actorName, 'A combatant');
    const target = cleanLabel(event.targetName, 'their foe');
    const action = cleanLabel(event.actionName, 'strike');
    if (kind === 'nat20' || Number(event.natural) === 20) {
      const aId = slugPart(event.actorId, 'actor'), tId = slugPart(event.targetId, 'target');
      return bigBeat('nat20', `beat:nat20:${round}:${aId}:${tId}`, 'Natural 20!',
        `${actor} lands a blazing critical ${action} on ${target}!`,
        `${sceneTitle}. Natural 20 critical hit: ${actor} unleashes a decisive ${action} against ${target}. ${note}`, 'gold');
    }
    if (kind === 'nat1' || Number(event.natural) === 1) {
      const aId = slugPart(event.actorId, 'actor'), tId = slugPart(event.targetId, 'target');
      return bigBeat('nat1', `beat:nat1:${round}:${aId}:${tId}`, 'Natural 1!',
        `${actor}'s ${action} goes wildly awry!`,
        `${sceneTitle}. Natural 1 critical fumble: ${actor} stumbles as ${action} misses ${target} dramatically. ${note}`, 'amber');
    }
    if (kind === 'first-blood' || event.firstBlood === true) {
      return bigBeat('first-blood', `beat:first-blood:${sceneId}`, 'First Blood',
        `${actor} draws first blood against ${target}!`,
        `${sceneTitle}. First blood of the battle: ${actor}'s ${action} wounds ${target}. ${note}`, 'crimson');
    }
    return null;
  }

  /** @description Classify one of the six big combat beats eligible for keyed generated art. */
  function classifyBigBeat(event) {
    const kind = String(event.kind || '').trim().toLowerCase();
    const sceneId = slugPart(event.sceneId, 'scene');
    const sceneTitle = cleanLabel(event.sceneTitle, 'The battle');
    const round = Math.max(1, Math.floor(Number(event.round) || 1));
    const note = cleanLabel(event.narration, '');
    return classifyMilestoneBeat(event, kind, sceneId, sceneTitle, round, note)
      || classifyRollBeat(event, kind, sceneId, sceneTitle, round, note);
  }

  /** @description Classify common combat and scene beats into cheap local DOM transitions. */
  function classifyLocalBeat(event) {
    const kind = String(event.kind || '').trim().toLowerCase().replace(/^local:/, '');
    const actor = cleanLabel(event.actorName, 'Combatant');
    const target = cleanLabel(event.targetName, 'target');
    const action = cleanLabel(event.actionName, 'attack');
    const outcome = String(event.outcome || '').toLowerCase();
    const damage = Number(event.damage) || 0;
    const healed = Number(event.healed) || 0;

    if (kind === 'advance') {
      const title = cleanLabel(event.sceneTitle, 'Next Chapter');
      return localBeat('local:advance', 'Onward', `Advancing to ${title}`, 'amber');
    }
    if (kind === 'heal' || event.actionMode === 'heal' || healed > 0) {
      return localBeat('local:heal', 'Healing Surge',
        `${actor} mends ${target}${healed > 0 ? ` (+${healed} HP)` : ''}`, 'emerald');
    }
    if (kind === 'spell' || event.actionType === 'spell') {
      return localBeat('local:spell', action,
        `${actor} casts ${action}${damage > 0 ? ` (${damage} dmg)` : ''}`, 'violet');
    }
    if (kind === 'miss' || /\b(?:miss|saved)\b/.test(outcome)) {
      return localBeat('local:miss', 'Clean Evasion', `${target} evades ${actor}'s ${action}`, 'slate');
    }
    if (kind === 'hit' || damage > 0 || /\b(?:hit|fail|autohit)\b/.test(outcome)) {
      return localBeat('local:hit', 'Strike Lands',
        `${actor} hits ${target} with ${action}${damage > 0 ? ` (-${damage} HP)` : ''}`, 'ember');
    }
    return { tier: 'none', beatKind: 'none', key: null, title: '', caption: '', prompt: '', accent: 'neutral' };
  }

  /** @description Deterministically classify any combat/story beat into generated vs local tier. */
  function classifyCombatBeat(event) {
    if (!event || typeof event !== 'object') {
      return { tier: 'none', beatKind: 'none', key: null, title: '', caption: '', prompt: '', accent: 'neutral' };
    }
    return classifyBigBeat(event) || classifyLocalBeat(event);
  }

  /** @description Read the natural d20 face from a structured roll record when present. */
  function naturalFaceOf(roll) {
    if (!roll || typeof roll !== 'object') return null;
    if (Array.isArray(roll.faces) && roll.faces.length && /d20/i.test(String(roll.dice || '1d20'))) {
      const first = Number(roll.faces[0]);
      if (Number.isInteger(first) && first >= 1 && first <= 20) return first;
    }
    const raw = Number(roll.natural);
    return Number.isInteger(raw) && raw >= 1 && raw <= 20 ? raw : null;
  }

  /** @description Extract total damage and healing from a structured roll list. */
  function rollTotals(rolls) {
    let damage = 0, healed = 0;
    for (const roll of rolls) {
      if (!roll) continue;
      if (roll.kind === 'damage') damage += Math.max(0, Number(roll.total) || 0);
      if (roll.kind === 'healing') healed += Math.max(0, Number(roll.total) || 0);
    }
    return { damage, healed };
  }

  /** @description Derive the primary classified combat beat from one resolved turn outcome. */
  function classifyOutcomeBeat(context) {
    const ctx = context || {};
    const outcome = ctx.outcome || {};
    const rolls = Array.isArray(outcome.rollEvent && outcome.rollEvent.rolls) ? outcome.rollEvent.rolls : [];
    const primary = rolls.find((r) => ['attack', 'save', 'autohit', 'healing', 'death-save'].includes(r && r.kind)) || rolls[0] || null;
    const tokens = Array.isArray(ctx.tokens) ? ctx.tokens : [];
    const findToken = (id) => (id ? tokens.find((t) => t && t.id === id) || null : null);
    const actor = findToken(primary && primary.actorId) || ctx.actor || null;
    const target = findToken((primary && primary.targetId) || outcome.downedTargetId) || null;
    const totals = rollTotals(rolls);
    const natural = primary && (primary.kind === 'attack' || primary.kind === 'death-save') ? naturalFaceOf(primary) : null;
    const downedToken = findToken(outcome.downedTargetId)
      || (target && target.kind === 'pc' && (target.downed || Number(target.hp) <= 0) ? target : null);
    const heroDown = !!(downedToken && downedToken.kind === 'pc' && (downedToken.downed || Number(downedToken.hp) <= 0) && totals.healed === 0);
    const firstBlood = !ctx.firstBloodClaimed && totals.damage > 0;
    const base = {
      sceneId: ctx.sceneId || 'scene', sceneTitle: ctx.sceneTitle || 'The battle', round: ctx.round || 1,
      actorId: actor && actor.id || (primary && primary.actorId) || 'actor',
      actorName: (actor && actor.name) || (primary && primary.actorName) || 'Combatant',
      targetId: target && target.id || (primary && primary.targetId) || '',
      targetName: (target && target.name) || (primary && primary.targetName) || '',
      actionName: (primary && primary.actionName) || ctx.actionName || 'attack',
      actionType: ctx.actionType || (primary && primary.kind === 'save' ? 'spell' : ''),
      actionMode: primary && primary.kind === 'healing' ? 'heal' : '',
      outcome: primary && (primary.outcome || primary.verdict) || '',
      natural, damage: totals.damage, healed: totals.healed,
      heroDown, heroId: downedToken && downedToken.id || '', heroName: downedToken && downedToken.name || '',
      firstBlood, narration: ctx.narration || '',
    };
    return { beat: classifyCombatBeat(base), claimedFirstBlood: totals.damage > 0 };
  }

  return {
    DEFAULT_CUTAWAY_CAP, MIN_CUTAWAY_CAP, MAX_CUTAWAY_CAP,
    BIG_BEAT_KINDS, LOCAL_BEAT_KINDS,
    normalizeCutawayCap, buildCutawayBudget, slugPart,
    isBossMonster, findBossTokens,
    classifyCombatBeat, classifyOutcomeBeat,
  };
});
