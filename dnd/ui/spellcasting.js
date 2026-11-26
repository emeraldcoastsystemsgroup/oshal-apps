/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Implement deterministic SRD 5.1 spellcasting helpers: sphere AoE templates, concentration tracking and Constitution saves, structured conditions, and per-round reactions (Shield, Opportunity Attack, Counterspell) shared by browser and Node.
 */

'use strict';

{
  const CONDITIONS = [
    'prone', 'poisoned', 'blinded', 'restrained',
    'frightened', 'blessed', 'invisible', 'incapacitated',
  ];
  const CONDITION_SET = new Set(CONDITIONS);

  const SRD_SPELLS = {
    fireball: {
      id: 'fireball', name: 'Fireball', type: 'spell', level: 3, slot: 3,
      mode: 'save', delivery: 'ranged', range: 150, aoeShape: 'sphere', aoeSize: 20,
      friendlyFire: true, save: { ability: 'DEX', dc: 15, half: true },
      damage: { dice: '8d6', bonus: 0, type: 'fire' },
      text: '20-ft radius sphere of fire; DEX save for half damage.',
    },
    shatter: {
      id: 'shatter', name: 'Shatter', type: 'spell', level: 2, slot: 2,
      mode: 'save', delivery: 'ranged', range: 60, aoeShape: 'sphere', aoeSize: 10,
      friendlyFire: true, save: { ability: 'CON', dc: 14, half: true },
      damage: { dice: '3d8', bonus: 0, type: 'thunder' },
      text: '10-ft radius ringing blast; CON save for half thunder damage.',
    },
    bless: {
      id: 'bless', name: 'Bless', type: 'spell', level: 1, slot: 1,
      mode: 'buff', delivery: 'ranged', range: 30, concentration: true,
      maxTargets: 3, targetTeam: 'ally',
      applyCondition: { id: 'blessed', concentration: true },
      text: 'Concentration. Up to three allies within 30 ft add 1d4 to attacks and saves.',
    },
    shield: {
      id: 'shield', name: 'Shield', type: 'spell', level: 1, slot: 1,
      mode: 'reaction', delivery: 'self', reactionTrigger: 'attack-hit', acBonus: 5,
      text: 'Reaction when hit by an attack: +5 AC until the start of your next turn.',
    },
    counterspell: {
      id: 'counterspell', name: 'Counterspell', type: 'spell', level: 3, slot: 3,
      mode: 'reaction', delivery: 'ranged', range: 60, reactionTrigger: 'spell-cast',
      text: 'Reaction: interrupt a spell within 60 ft (auto <=3rd level, check for higher).',
    },
    'hold-person': {
      id: 'hold-person', name: 'Hold Person', type: 'spell', level: 2, slot: 2,
      mode: 'save', delivery: 'ranged', range: 60, concentration: true,
      save: { ability: 'WIS', dc: 14, half: false },
      applyCondition: { id: 'incapacitated', concentration: true },
      text: 'Concentration. Target fails a WIS save or is incapacitated.',
    },
    entangle: {
      id: 'entangle', name: 'Entangle', type: 'spell', level: 1, slot: 1,
      mode: 'save', delivery: 'ranged', range: 90, aoeShape: 'sphere', aoeSize: 10,
      friendlyFire: false, concentration: true,
      save: { ability: 'STR', dc: 13, half: false },
      applyCondition: { id: 'restrained', concentration: true },
      text: 'Concentration. Grasping vines restrain foes failing a STR save.',
    },
    blindness: {
      id: 'blindness', name: 'Blindness/Deafness', type: 'spell', level: 2, slot: 2,
      mode: 'save', delivery: 'ranged', range: 30,
      save: { ability: 'CON', dc: 14, half: false },
      applyCondition: { id: 'blinded' },
      text: 'Target fails a CON save or becomes blinded.',
    },
    'faerie-fire': {
      id: 'faerie-fire', name: 'Faerie Fire', type: 'spell', level: 1, slot: 1,
      mode: 'save', delivery: 'ranged', range: 60, aoeShape: 'sphere', aoeSize: 10,
      friendlyFire: false, concentration: true,
      save: { ability: 'DEX', dc: 13, half: false },
      applyCondition: { id: 'blinded', concentration: true },
      text: 'Concentration. 10-ft flare dazzles foes who fail a DEX save.',
    },
  };

  const chebDist = (a, b) => Math.max(Math.abs((a.x || 0) - (b.x || 0)), Math.abs((a.y || 0) - (b.y || 0)));

  /** @description Normalize one condition string or object into a canonical record. */
  function normalizeCondition(cond) {
    if (!cond) return null;
    const rawId = typeof cond === 'string' ? cond : cond.id;
    const id = String(rawId || '').trim().toLowerCase();
    if (!CONDITION_SET.has(id)) return null;
    const out = { id };
    if (typeof cond === 'object') {
      if (cond.sourceId) out.sourceId = String(cond.sourceId);
      if (cond.spellId) out.spellId = String(cond.spellId);
      if (cond.concentration) out.concentration = true;
      if (cond.duration) out.duration = String(cond.duration);
    }
    return out;
  }

  /** @description Return the array of condition records currently on a token. */
  function tokenConditions(token) {
    return Array.isArray(token && token.conditions) ? token.conditions : [];
  }

  /** @description True when a token currently carries the named canonical condition. */
  function hasCondition(token, id) {
    const wanted = String(id || '').trim().toLowerCase();
    return tokenConditions(token).some((entry) => {
      const entryId = typeof entry === 'string' ? entry : (entry && entry.id);
      return String(entryId || '').trim().toLowerCase() === wanted;
    });
  }

  /** @description Attach or refresh a canonical condition on a token. */
  function addCondition(token, cond) {
    const normalized = normalizeCondition(cond);
    if (!token || !normalized) return null;
    const current = tokenConditions(token).filter((entry) => {
      const e = normalizeCondition(entry);
      if (!e) return false;
      if (e.id !== normalized.id) return true;
      return normalized.sourceId ? e.sourceId !== normalized.sourceId : false;
    });
    current.push(normalized);
    token.conditions = current;
    return normalized;
  }

  /** @description Remove matching conditions by id (and optional sourceId) from a token. */
  function removeCondition(token, id, sourceId) {
    if (!token || !Array.isArray(token.conditions)) return false;
    const wanted = String(id || '').trim().toLowerCase();
    const before = token.conditions.length;
    token.conditions = token.conditions.filter((entry) => {
      const e = normalizeCondition(entry);
      if (!e || e.id !== wanted) return true;
      return sourceId ? e.sourceId !== String(sourceId) : false;
    });
    return token.conditions.length !== before;
  }

  /** @description Strip every condition created by a source token (and optional spellId). */
  function removeConditionsBySource(world, sourceId, spellId) {
    const cleared = [];
    const tokens = (world && Array.isArray(world.tokens)) ? world.tokens : [];
    const src = String(sourceId || '');
    const spl = spellId ? String(spellId) : null;
    for (const token of tokens) {
      if (!token || !Array.isArray(token.conditions) || !token.conditions.length) continue;
      const before = token.conditions.length;
      token.conditions = token.conditions.filter((entry) => {
        const e = normalizeCondition(entry);
        if (!e) return false;
        if (e.sourceId !== src) return true;
        return spl ? e.spellId !== spl : false;
      });
      if (token.conditions.length !== before) cleared.push(token.id);
    }
    return cleared;
  }

  /** @description Reset a combatant's per-round reaction and temporary Shield AC bonus. */
  function resetTurnReactions(actor) {
    if (!actor) return;
    if (actor.reactionUsed) actor.reactionUsed = false;
    if (actor.tempAcBonus) actor.tempAcBonus = 0;
  }

  /** @description Advance start-of-turn timers: reset reactions/Shield AC and expire short conditions. */
  function tickTurnConditions(world, actor) {
    if (!actor) return { expired: [], reactionReset: false };
    const hadReaction = !!actor.reactionUsed || Number(actor.tempAcBonus) > 0;
    resetTurnReactions(actor);
    const expired = [];
    if (Array.isArray(actor.conditions) && actor.conditions.length) {
      actor.conditions = actor.conditions.filter((entry) => {
        const e = normalizeCondition(entry);
        if (!e) return false;
        if (e.duration === 'until-next-turn') { expired.push(e.id); return false; }
        return true;
      });
    }
    const tokens = (world && Array.isArray(world.tokens)) ? world.tokens : [];
    for (const token of tokens) {
      if (!token || !Array.isArray(token.conditions) || !token.conditions.length) continue;
      token.conditions = token.conditions.filter((entry) => {
        const e = normalizeCondition(entry);
        if (!e) return false;
        if (e.duration === 'until-source-next-turn' && e.sourceId === actor.id) {
          expired.push(e.id);
          return false;
        }
        return true;
      });
    }
    return { expired, reactionReset: hadReaction };
  }

  /** @description Effective Armor Class including temporary bonuses such as Shield (+5). */
  function effectiveAc(target) {
    return (Number(target && target.ac) || 10) + (Number(target && target.tempAcBonus) || 0);
  }

  /** @description Effective movement speed after restrained, incapacitated, and prone penalties. */
  function effectiveSpeed(token) {
    const base = Math.max(0, Number(token && token.speed) || 0);
    if (!token) return 0;
    if (hasCondition(token, 'restrained') || hasCondition(token, 'incapacitated')) return 0;
    if (hasCondition(token, 'prone')) return Math.floor(base / 2);
    return base;
  }

  /** @description Compute advantage/disadvantage on an attack roll with SRD 5.1 cancellation. */
  function attackRollMode(attacker, target, action) {
    const advantage = [], disadvantage = [];
    if (hasCondition(attacker, 'invisible')) advantage.push('attacker-invisible');
    for (const c of ['blinded', 'poisoned', 'frightened', 'restrained', 'prone']) {
      if (hasCondition(attacker, c)) disadvantage.push(`attacker-${c}`);
    }
    if (hasCondition(target, 'blinded')) advantage.push('target-blinded');
    if (hasCondition(target, 'restrained')) advantage.push('target-restrained');
    if (hasCondition(target, 'invisible')) disadvantage.push('target-invisible');
    if (hasCondition(target, 'prone')) {
      const close = action && action.delivery === 'melee'
        || (attacker && target && chebDist(attacker, target) <= 1 && (!action || action.delivery !== 'ranged'));
      if (close) advantage.push('target-prone-melee');
      else disadvantage.push('target-prone-ranged');
    }
    const net = advantage.length && disadvantage.length ? 'normal'
      : advantage.length ? 'advantage' : disadvantage.length ? 'disadvantage' : 'normal';
    return { advantage, disadvantage, net };
  }

  /** @description Compute advantage/disadvantage on a saving throw from active conditions. */
  function saveRollMode(target, ability) {
    const advantage = [], disadvantage = [];
    const ab = String(ability || '').trim().toUpperCase();
    if (hasCondition(target, 'restrained') && ab === 'DEX') disadvantage.push('restrained-dex-save');
    const net = advantage.length && disadvantage.length ? 'normal'
      : advantage.length ? 'advantage' : disadvantage.length ? 'disadvantage' : 'normal';
    return { advantage, disadvantage, net };
  }

  /** @description Roll one d20 respecting normal, advantage, or disadvantage mode. */
  function rollD20WithMode(dieFn, mode) {
    if (mode === 'advantage' || mode === 'disadvantage') {
      const a = dieFn(20), b = dieFn(20);
      const natural = mode === 'advantage' ? Math.max(a, b) : Math.min(a, b);
      const dropped = mode === 'advantage' ? Math.min(a, b) : Math.max(a, b);
      return { natural, kept: natural, dropped, dice: [a, b], mode };
    }
    const natural = dieFn(20);
    return { natural, kept: natural, dropped: null, dice: [natural], mode: 'normal' };
  }

  /** @description Return every non-blocking grid cell within radiusFt of center (5ft grid). */
  function sphereCells(world, center, radiusFt) {
    const grid = (world && world.grid) || { w: 0, h: 0 };
    if (!center || !Number.isFinite(Number(center.x)) || !Number.isFinite(Number(center.y))) return [];
    const unit = Number(grid.unitFeet) || 5;
    const radiusSq = Math.max(0, Math.floor((Number(radiusFt) || 0) / unit));
    const cx = Number(center.x), cy = Number(center.y);
    const blocked = world && world.blockSet;
    const cells = [];
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > radiusSq) continue;
        if (blocked && blocked.has(`${x},${y}`)) continue;
        cells.push({ x, y });
      }
    }
    return cells;
  }

  /** @description True when a token is a conscious living creature able to be caught in an AoE. */
  function isConsciousCreature(t) {
    if (!t || t.kind === 'prop' || t.dead || t.fled) return false;
    return t.kind !== 'pc' || (Number(t.hp) > 0 && !t.downed && !t.stable);
  }

  /** @description Return all eligible targets inside a sphere template respecting team rules. */
  function sphereTargets(world, actor, action, center) {
    const radiusFt = Number(action && action.aoeSize) || 20;
    const cellKeys = new Set(sphereCells(world, center, radiusFt).map((c) => `${c.x},${c.y}`));
    const allyOnly = action && (action.targetTeam === 'ally' || action.mode === 'buff' || action.mode === 'heal');
    const foeOnly = !allyOnly && action && (action.friendlyFire === false || action.targetTeam === 'enemy');
    return ((world && world.tokens) || []).filter((t) => {
      if (!t || t.kind === 'prop' || t.dead || t.fled) return false;
      if (!cellKeys.has(`${t.x},${t.y}`)) return false;
      if (action && action.mode === 'heal') return t.kind === actor.kind;
      if (!isConsciousCreature(t)) return false;
      if (allyOnly) return t.kind === actor.kind;
      if (foeOnly) return t.kind !== actor.kind;
      return true;
    });
  }

  /** @description End concentration on actor and clear every linked condition across the world. */
  function dropConcentration(world, actor, reason) {
    if (!actor || !actor.concentration) return { dropped: false, note: '', clearedTokenIds: [] };
    const prev = actor.concentration;
    delete actor.concentration;
    const clearedTokenIds = removeConditionsBySource(world, actor.id, prev.spellId);
    const why = reason === 'incapacitated' ? ' (incapacitated)' : '';
    const note = `${actor.name || actor.id} loses concentration on ${prev.spellName || prev.spellId}${why}.`;
    return {
      dropped: true, spellId: prev.spellId, spellName: prev.spellName,
      reason: reason || 'dropped', clearedTokenIds, note,
    };
  }

  /** @description Begin concentration on action, dropping any previously held spell first. */
  function startConcentration(world, actor, action, targetIds, round) {
    if (!actor || !action) return { started: null, droppedNote: '' };
    const prev = actor.concentration ? dropConcentration(world, actor, 'new-spell') : null;
    const started = {
      spellId: String(action.id || action.name || 'spell'),
      spellName: String(action.name || action.id || 'Spell'),
      startedRound: Math.max(1, Number(round) || 1),
      targetIds: Array.isArray(targetIds) ? targetIds.map(String) : [],
    };
    actor.concentration = started;
    return { started, droppedNote: prev ? prev.note : '', previousSpell: prev ? prev.spellName : null };
  }

  /** @description Roll Constitution concentration save DC = max(10, floor(damage / 2)) when damaged. */
  function checkConcentrationOnDamage(world, target, damage, rollD20Fn, helpers) {
    const amount = Number(damage) || 0;
    if (!target || !target.concentration || amount <= 0) return { checked: false, maintained: true };
    const spellName = target.concentration.spellName || target.concentration.spellId || 'spell';
    if (Number(target.hp) <= 0 || target.dead || target.downed || hasCondition(target, 'incapacitated')) {
      const dropped = dropConcentration(world, target, 'incapacitated');
      return { checked: true, dc: null, roll: null, maintained: false, autoBroken: true, droppedSpellName: spellName, note: dropped.note };
    }
    const dc = Math.max(10, Math.floor(amount / 2));
    const sheet = world && typeof world.sheetFor === 'function' ? (world.sheetFor(target) || {}) : {};
    const conMod = Number(sheet.mods && sheet.mods.con) || 0;
    const dieFn = helpers && typeof helpers.die === 'function' ? helpers.die : (n) => 1 + Math.floor(Math.random() * n);
    const natural = typeof rollD20Fn === 'function' ? Number(rollD20Fn()) : dieFn(20);
    const blessBonus = hasCondition(target, 'blessed') ? dieFn(4) : 0;
    const bonus = conMod + blessBonus;
    const total = natural + bonus;
    const maintained = total >= dc;
    const source = (helpers && helpers.source) || target;
    const roll = helpers && typeof helpers.d20Record === 'function'
      ? helpers.d20Record('save', natural, bonus, {
        actor: target, target: source, actionName: `Concentration: ${spellName}`,
        targetKind: 'dc', threshold: dc, outcome: maintained ? 'save' : 'fail',
      })
      : { kind: 'save', actorId: String(target.id || ''), actorName: String(target.name || ''),
        targetId: String(source.id || target.id || ''), targetName: String(source.name || target.name || ''),
        actionName: `Concentration: ${spellName}`, dice: '1d20', faces: [natural],
        bonus, total, targetKind: 'dc', target: dc, outcome: maintained ? 'save' : 'fail', ordinal: 1, count: 1 };
    const drop = maintained ? null : dropConcentration(world, target, 'failed-save');
    const modSign = bonus >= 0 ? `+${bonus}` : `${bonus}`;
    const note = maintained
      ? `${target.name || target.id} maintains concentration on ${spellName} (${natural}${modSign}=${total} vs DC ${dc}).`
      : `${drop.note} (${natural}${modSign}=${total} vs DC ${dc}).`;
    return {
      checked: true, dc, natural, conMod, blessBonus, total, maintained, autoBroken: false,
      roll, droppedSpellName: maintained ? null : spellName, note,
    };
  }

  /** @description True when a combatant is conscious, not incapacitated, and still has a reaction. */
  function canReact(token) {
    return isConsciousCreature(token) && !hasCondition(token, 'incapacitated') && !token.reactionUsed;
  }

  /** @description Lowest available spell slot at or above minLevel, or null if none exist. */
  function lowestAvailableSlot(token, minLevel) {
    const slots = token && token.slots;
    if (!slots || typeof slots !== 'object') return null;
    const levels = Object.keys(slots).map(Number).filter((lvl) => Number.isInteger(lvl) && lvl >= minLevel && Number(slots[String(lvl)]) > 0);
    levels.sort((a, b) => a - b);
    return levels.length ? levels[0] : null;
  }

  /** @description Collect Shield reaction options when an attack would hit within +5 AC. */
  function eligibleShieldReactions(world, ctx) {
    const defender = ctx.target || ctx.defender;
    const attackTotal = Number(ctx.attackTotal);
    if (!canReact(defender) || ctx.critical || !Number.isFinite(attackTotal)) return [];
    const actions = (world.sheetFor(defender) || {}).actions || [];
    const shield = actions.find((a) => a && (a.id === 'shield' || a.reactionTrigger === 'attack-hit'));
    if (!shield) return [];
    const slot = lowestAvailableSlot(defender, Number(shield.slot) || 1);
    if (!slot) return [];
    const curAc = effectiveAc(defender), bonus = Number(shield.acBonus) || 5;
    if (attackTotal < curAc || attackTotal >= curAc + bonus) return [];
    return [{ id: 'shield', actorId: defender.id, spellId: shield.id || 'shield', actionName: shield.name || 'Shield', slot, acBonus: bonus }];
  }

  /** @description Collect Opportunity Attack options when a creature leaves melee reach without Disengage. */
  function eligibleOpportunityAttacks(world, ctx) {
    const mover = ctx.mover || ctx.actor, from = ctx.from || mover, to = ctx.to;
    if (!mover || !to || ctx.disengage || ctx.forced) return [];
    const out = [];
    for (const token of (world.tokens || [])) {
      if (token.kind === mover.kind || !canReact(token)) continue;
      const melee = ((world.sheetFor(token) || {}).actions || []).find((a) => a && a.delivery === 'melee' && a.mode === 'attack');
      if (!melee) continue;
      const reachSq = Math.max(1, Math.floor((Number(melee.reach) || 5) / 5));
      if (chebDist(token, from) <= reachSq && chebDist(token, to) > reachSq) {
        out.push({ id: 'opportunity-attack', actorId: token.id, targetId: mover.id, actionId: melee.id || melee.name, actionName: melee.name });
      }
    }
    return out;
  }

  /** @description Collect Counterspell reaction options from hostile casters within 60 ft. */
  function eligibleCounterspells(world, ctx) {
    const caster = ctx.caster || ctx.actor, spell = ctx.spell || ctx.action;
    if (!caster || !spell || spell.type !== 'spell') return [];
    const targetSpellLevel = Math.max(0, Number(spell.level != null ? spell.level : spell.slot) || 0);
    const out = [];
    for (const token of (world.tokens || [])) {
      if (token.kind === caster.kind || !canReact(token)) continue;
      if (chebDist(token, caster) * 5 > 60) continue;
      const cs = ((world.sheetFor(token) || {}).actions || []).find((a) => a && (a.id === 'counterspell' || a.reactionTrigger === 'spell-cast'));
      if (!cs) continue;
      const slot = lowestAvailableSlot(token, Number(cs.slot) || 3);
      if (!slot) continue;
      out.push({ id: 'counterspell', actorId: token.id, targetId: caster.id, spellId: cs.id || 'counterspell', actionName: cs.name || 'Counterspell', slot, targetSpellLevel });
    }
    return out;
  }

  /** @description List all legal reactions for a trigger ('attack-hit' | 'leave-reach' | 'spell-cast'). */
  function eligibleReactions(world, trigger, context) {
    const ctx = context || {};
    if (trigger === 'attack-hit') return eligibleShieldReactions(world, ctx);
    if (trigger === 'leave-reach') return eligibleOpportunityAttacks(world, ctx);
    if (trigger === 'spell-cast') return eligibleCounterspells(world, ctx);
    return [];
  }

  /** @description Resolve Counterspell against a spell of any level (auto <= slot, check DC 10+level above). */
  function resolveCounterspell(world, reactor, reaction, ctx, helpers) {
    const slot = Number(reaction.slot) || 3;
    if (!reactor.slots || Number(reactor.slots[String(slot)]) <= 0) {
      return { blocked: true, text: `${reactor.name} has no level-${slot} slot for Counterspell.`, rolls: [] };
    }
    reactor.slots[String(slot)] -= 1;
    reactor.reactionUsed = true;
    const spell = (ctx && (ctx.spell || ctx.action)) || {};
    const spellLevel = Number(reaction.targetSpellLevel != null ? reaction.targetSpellLevel : (spell.level || spell.slot || 0));
    const spellName = spell.name || 'the spell';
    if (spellLevel <= slot) {
      return {
        blocked: false, reactionId: 'counterspell', countered: true, autoCountered: true, rolls: [],
        text: `${reactor.name} casts Counterspell (L${slot}) — automatically counters ${spellName}!`,
      };
    }
    const dc = 10 + spellLevel;
    const mods = (world.sheetFor(reactor) || {}).mods || {};
    const mod = Math.max(Number(mods.int) || 0, Number(mods.wis) || 0, Number(mods.cha) || 0);
    const dieFn = helpers && helpers.die ? helpers.die : (n) => 1 + Math.floor(Math.random() * n);
    const natural = dieFn(20), total = natural + mod, countered = total >= dc;
    const caster = (ctx && (ctx.caster || ctx.actor)) || reactor;
    const roll = helpers && helpers.d20Record
      ? helpers.d20Record('save', natural, mod, {
        actor: reactor, target: caster, actionName: 'Counterspell',
        targetKind: 'dc', threshold: dc, outcome: countered ? 'save' : 'fail',
      }) : null;
    const modSign = mod >= 0 ? `+${mod}` : `${mod}`;
    return {
      blocked: false, reactionId: 'counterspell', countered, autoCountered: false, dc, natural, mod, total,
      rolls: roll ? [roll] : [],
      text: `${reactor.name} casts Counterspell (${natural}${modSign}=${total} vs DC ${dc}) — ${countered ? `counters ${spellName}!` : `fails to stop ${spellName}.`}`,
    };
  }

  /** @description Resolve one chosen reaction (Shield, Opportunity Attack, or Counterspell). */
  function resolveReaction(world, reactor, reaction, context, helpers) {
    if (!canReact(reactor)) return { blocked: true, text: `${reactor && reactor.name || 'Creature'} has no reaction available.`, rolls: [] };
    const ctx = context || {};
    if (reaction.id === 'shield') {
      const slot = Number(reaction.slot) || 1;
      if (!reactor.slots || Number(reactor.slots[String(slot)]) <= 0) {
        return { blocked: true, text: `${reactor.name} has no level-${slot} slot for Shield.`, rolls: [] };
      }
      const bonus = Number(reaction.acBonus) || 5;
      reactor.slots[String(slot)] -= 1;
      reactor.reactionUsed = true;
      reactor.tempAcBonus = (Number(reactor.tempAcBonus) || 0) + bonus;
      const newAc = effectiveAc(reactor);
      return {
        blocked: false, reactionId: 'shield', acBonus: bonus, newAc, negated: true, rolls: [],
        text: `${reactor.name} casts Shield as a reaction (+${bonus} AC, now AC ${newAc}) — turning the hit into a miss!`,
      };
    }
    if (reaction.id === 'opportunity-attack') {
      const target = ctx.target || (world.tokens || []).find((t) => t.id === reaction.targetId);
      const melee = ((world.sheetFor(reactor) || {}).actions || []).find((a) => a && (a.id === reaction.actionId || a.name === reaction.actionName || (a.delivery === 'melee' && a.mode === 'attack')));
      if (!target || !melee || !helpers || typeof helpers.resolveAttackAction !== 'function') {
        return { blocked: true, text: 'Opportunity attack cannot resolve without a melee weapon and target.', rolls: [] };
      }
      reactor.reactionUsed = true;
      const strike = helpers.resolveAttackAction(world, reactor, melee, target);
      return { ...strike, reactionId: 'opportunity-attack', text: `Opportunity Attack — ${strike.text}` };
    }
    if (reaction.id === 'counterspell') return resolveCounterspell(world, reactor, reaction, ctx, helpers);
    return { blocked: true, text: `Unsupported reaction: ${reaction.id}`, rolls: [] };
  }

  const DnDSpellcasting = {
    CONDITIONS, SRD_SPELLS,
    normalizeCondition, tokenConditions, hasCondition, addCondition, removeCondition,
    removeConditionsBySource, resetTurnReactions, tickTurnConditions,
    effectiveAc, effectiveSpeed, attackRollMode, saveRollMode, rollD20WithMode,
    sphereCells, sphereTargets,
    startConcentration, dropConcentration, checkConcentrationOnDamage,
    canReact, lowestAvailableSlot, eligibleReactions, resolveReaction,
  };
  if (typeof module === 'object' && module.exports) module.exports = DnDSpellcasting;
  else if (typeof globalThis !== 'undefined') globalThis.DnDSpellcasting = DnDSpellcasting;
}
