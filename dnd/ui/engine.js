/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 18:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Model 0-HP heroes as downed rather than dead, resolve idempotent unmodified death saves by turn serial, and let legal healing return downed heroes to the fight without reviving legacy dead characters.
 * 2026-07-21 17:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Expose minimum movement costs alongside the reachable-set API so the tabletop can show exact legal destinations and remaining movement without duplicating pathfinding rules in the UI.
 * 2026-07-20 20:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extracted the deterministic D&D rules engine out of the tabletop surface into one shared module: dice, movement range, targeting (incl. cone AoE), attack/save/heal/autohit resolution, initiative, monster tactics, end-state, and the level-up mirror. Runs in the browser (window.DnDEngine, used by ui/table.html) AND under plain node (module.exports, tested by tests/dnd-engine.test.js). RNG is injectable (setRng) so tests are fully deterministic. No DOM, no network — pure game logic, the single source of truth for both the live surface and the test suite.
 * 2026-07-21 20:00:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace the whole-module factory with an explicit browser/CommonJS export and decompose action resolution by effect mode.
 * 2026-07-21 20:36:30 | roger.murphy@emeraldcoastsystemsgroup.com  | Block-scope engine internals so its browser export can share a classic-script page with tabletop aliases without fatal top-level redeclarations.
 * 2026-07-21 21:28:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Include the authoritative natural d20 in every terminal and revived death-save result.
 * 2026-07-21 21:48:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Emit exact structured roll groups for initiative, attacks, saves, damage, healing, autohits, sneak attacks, area effects, and death saves.
 * 2026-07-23 11:36:00 | roger.murphy@emeraldcoastsystemsgroup.com  | State how many failed death saves existed before the current d20 when reporting an accumulated failure.
 * 2026-11-25 14:40:00 | maintainer@emeraldcoastsystemsgroup.com     | Wire deeper spellcasting (sphere AoE, concentration checks, conditions, effective AC/speed, advantage/disadvantage, and reactions) via ui/spellcasting.js.
 * 2026-11-25 15:15:00 | maintainer@emeraldcoastsystemsgroup.com     | Support SRD 5.1 Level 3-5 multi-threshold progression, scaling Sneak Attack, Extra Attack swings, and sphere AoE healing.
 *
 * `world` is the state handle every function reads:
 *   { grid:{w,h}, blockSet:Set<"x,y">, diffSet:Set<"x,y">, tokens:[...],
 *     sheetFor:(token)=>statSheet }   // statSheet supplies .mods and .actions
 */

'use strict';

{
  const SP = typeof module === 'object' && module.exports
    ? require('./spellcasting.js')
    : (typeof globalThis !== 'undefined' ? globalThis.DnDSpellcasting : null);

  // ── RNG (injectable for deterministic tests) ───────────────────────────────
  let _rng = Math.random;
  /** Replace the RNG (e.g. a seeded PRNG in tests). Pass nothing to reset. */
  function setRng(fn) { _rng = typeof fn === 'function' ? fn : Math.random; }
  /** A fresh d`n` (1..n inclusive). */
  function die(n) { return 1 + Math.floor(_rng() * n); }
  /** Roll a dice spec ("1d8" or {dice,bonus}); crit doubles the dice count. */
  function rollDice(spec, crit) {
    const dice = typeof spec === 'string' ? spec : spec.dice;
    const bonus = typeof spec === 'string' ? 0 : (spec.bonus || 0);
    const parts = dice.split('d');
    const num = Number(parts[0]) || 0, size = Number(parts[1]) || 0;
    let total = 0; const rolls = [];
    for (let i = 0; i < num * (crit ? 2 : 1) && size > 0; i++) { const r = die(size); rolls.push(r); total += r; }
    return { total: total + bonus, rolls, bonus };
  }

  /** Return the actual dice notation after critical-hit dice are doubled. */
  function rolledNotation(spec, crit) {
    const dice = typeof spec === 'string' ? spec : spec.dice;
    const parts = String(dice || '0d0').split('d');
    const count = (Number(parts[0]) || 0) * (crit ? 2 : 1);
    return `${count}d${Number(parts[1]) || 0}`;
  }

  /** Build one portable record containing the exact faces behind a total. */
  function rollRecord(kind, rolled, facts) {
    const info = facts || {}, actor = info.actor || {}, target = info.target || {};
    return {
      kind, actorId: String(actor.id || ''), actorName: String(actor.name || actor.id || 'Unknown'),
      targetId: target.id == null ? null : String(target.id),
      targetName: target.id == null ? null : String(target.name || target.id),
      actionName: info.actionName == null ? null : String(info.actionName),
      dice: String(info.dice || '1d20'), faces: rolled.rolls.slice(),
      bonus: Number(rolled.bonus) || 0, total: Number(rolled.total) || 0,
      targetKind: info.targetKind || null,
      target: Number.isInteger(info.threshold) ? info.threshold : null,
      outcome: info.outcome || 'rolled', ordinal: Number(info.ordinal) || 1,
      count: Number(info.count) || 1,
    };
  }

  /** Roll a damage/healing dice spec and retain both value and exact faces. */
  function rollSpec(kind, spec, critical, facts) {
    const value = rollDice(spec, critical);
    const info = { ...(facts || {}), dice: rolledNotation(spec, critical) };
    return { value, roll: rollRecord(kind, value, info) };
  }

  /** Describe an already-rolled d20 without consuming RNG again. */
  function d20Record(kind, natural, bonus, facts) {
    return rollRecord(kind, {
      rolls: [Number(natural)], bonus: Number(bonus) || 0,
      total: Number(natural) + (Number(bonus) || 0),
    }, { ...(facts || {}), dice: '1d20' });
  }

  // ── Geometry ───────────────────────────────────────────────────────────────
  const keyOf = (x, y) => x + ',' + y;
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const living = (world, kind) => world.tokens.filter((t) => t.kind === kind && !t.dead && !t.fled);
  const modsOf = (world, t) => (world.sheetFor(t) || {}).mods || {};

  /** A legacy `dead:true` PC stays finally dead; only a non-dead PC at 0 HP is downed. */
  function isDowned(t) {
    return !!(t && t.kind === 'pc' && !t.dead && !t.fled && Number(t.hp) <= 0);
  }
  function isConscious(t) {
    if (!t || t.dead || t.fled) return false;
    return t.kind !== 'pc' || (Number(t.hp) > 0 && !t.downed && !t.stable);
  }
  function deathSaveState(t) {
    const saves = t && t.deathSaves && typeof t.deathSaves === 'object' ? t.deathSaves : {};
    return {
      successes: Math.max(0, Math.min(3, Number(saves.successes) || 0)),
      failures: Math.max(0, Math.min(3, Number(saves.failures) || 0)),
      lastRoll: Number.isInteger(Number(saves.lastRoll)) ? Number(saves.lastRoll) : null,
      turnSerial: Number.isInteger(Number(saves.turnSerial)) ? Number(saves.turnSerial) : null,
    };
  }
  function clearDeathSaves(t) {
    if (!t || t.kind !== 'pc') return t;
    t.downed = false; t.stable = false;
    delete t.deathSaves;
    return t;
  }

  function occupied(world, x, y, exceptId) {
    return world.tokens.some((t) => !t.dead && !t.fled && t.kind !== 'prop' && t.id !== exceptId && t.x === x && t.y === y);
  }
  function walkable(world, x, y, moverId) {
    const g = world.grid;
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
    if (world.blockSet.has(keyOf(x, y))) return false;
    return !occupied(world, x, y, moverId);
  }

  // ── Movement range (Dijkstra; difficult terrain costs 2) ───────────────────
  /** Minimum movement cost, in 5-foot units, for every legal destination. */
  function computeMovementCosts(world, t) {
    const best = new Map();
    if (!t) return best;
    const speed = SP ? SP.effectiveSpeed(t) : Math.max(0, Number(t.speed) || 0);
    const budget = Math.max(0, Math.floor(speed / 5));
    best.set(keyOf(t.x, t.y), 0);
    const q = [{ x: t.x, y: t.y, c: 0 }];
    while (q.length) {
      q.sort((a, b) => a.c - b.c);
      const cur = q.shift();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = cur.x + dx, ny = cur.y + dy, k = keyOf(nx, ny);
        if (!walkable(world, nx, ny, t.id)) continue;
        const step = world.diffSet.has(k) ? 2 : 1;
        const nc = cur.c + step;
        if (nc <= budget && (!best.has(k) || nc < best.get(k))) { best.set(k, nc); q.push({ x: nx, y: ny, c: nc }); }
      }
    }
    return best;
  }

  function computeReachable(world, t) {
    const out = new Set();
    if (!t) return out;
    const start = keyOf(t.x, t.y);
    computeMovementCosts(world, t).forEach((_cost, k) => { if (k !== start) out.add(k); });
    return out;
  }

  // ── Targeting ──────────────────────────────────────────────────────────────
  function inRange(action, from, to) {
    const d = cheb(from, to);
    if (action.delivery === 'melee') return d <= Math.max(1, (action.reach || 5) / 5);
    if (action.delivery === 'ranged') return d * 5 <= (action.range || 30);
    return d <= 1;
  }
  /** Enemies caught in a cone from `actor` toward `aim` (≈90° arc, aoeSize ft deep). */
  function coneTargets(world, actor, action, aim) {
    const depth = Math.max(1, (action.aoeSize || 15) / 5);
    const dirX = Math.sign(aim.x - actor.x), dirY = Math.sign(aim.y - actor.y);
    const foeKind = actor.kind === 'pc' ? 'monster' : 'pc';
    return living(world, foeKind).filter((t) => {
      const dx = t.x - actor.x, dy = t.y - actor.y;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d < 1 || d > depth) return false;
      const alongX = dirX === 0 ? true : Math.sign(dx) === dirX || dx === 0;
      const alongY = dirY === 0 ? true : Math.sign(dy) === dirY || dy === 0;
      if (!alongX || !alongY) return false;
      return dirX === 0 ? Math.abs(dx) <= Math.abs(dy) : dirY === 0 ? Math.abs(dy) <= Math.abs(dx) : true;
    });
  }
  function validTargets(world, actor, action) {
    if (action.mode === 'reaction') return [];
    // Healing reaches conscious, downed, or stable allies, but never resurrects
    // a legacy/final `dead:true` character.
    if (action.mode === 'heal') return world.tokens.filter((t) =>
      t.kind === actor.kind && !t.dead && !t.fled &&
      t.hp < t.maxHp && inRange(action, actor, t));
    if (action.mode === 'buff' || action.targetTeam === 'ally') {
      return world.tokens.filter((t) => t.kind === actor.kind && isConscious(t) && inRange(action, actor, t));
    }
    const foeKind = actor.kind === 'pc' ? 'monster' : 'pc';
    return living(world, foeKind).filter((t) => inRange(action, actor, t));
  }
  function sneakEligible(world, actor, target) {
    return actor.kind === 'pc' && living(world, 'pc').some((a) => a.id !== actor.id && isConscious(a) && cheb(a, target) <= 1);
  }

  // ── Resolution ─────────────────────────────────────────────────────────────
  function attachConcentrationCheck(impact, t, amount, options) {
    if (!SP || !options || !options.world || !t || !t.concentration || amount <= 0) return impact;
    const check = SP.checkConcentrationOnDamage(options.world, t, amount, options.rollD20, {
      die, d20Record, source: options.source || t,
    });
    return { ...impact, concentrationCheck: check };
  }
  /** Apply damage and return the combat-status transition it caused. */
  function applyDamage(t, dmg, options) {
    const amount = Math.max(0, Number(dmg) || 0);
    const before = {
      hp: Number(t && t.hp) || 0,
      dead: !!(t && t.dead),
      downed: isDowned(t),
    };
    if (!t || amount <= 0 || t.dead || t.fled) return { ...before, newlyDowned: false, killed: false };

    // Damage suffered while already at 0 HP causes failed death saves in 5e.
    // Stable creatures lose stability first; a critical hit counts as two.
    if (isDowned(t)) {
      const prior = t.stable ? { successes: 0, failures: 0 } : deathSaveState(t);
      const failures = Math.min(3, prior.failures + ((options && options.critical) ? 2 : 1));
      t.stable = false;
      t.deathSaves = { successes: prior.successes, failures };
      if (failures >= 3) { t.dead = true; t.downed = false; }
      return attachConcentrationCheck({ hp: 0, dead: !!t.dead, downed: isDowned(t), newlyDowned: false, killed: !before.dead && !!t.dead }, t, amount, options);
    }

    t.hp = Math.max(0, before.hp - amount);
    if (t.kind === 'pc' && t.hp <= 0) {
      t.dead = false; t.downed = true; t.stable = false;
      t.deathSaves = { successes: 0, failures: 0 };
      return attachConcentrationCheck({ hp: 0, dead: false, downed: true, newlyDowned: true, killed: false }, t, amount, options);
    }
    if (t.hp <= 0) t.dead = true;
    return attachConcentrationCheck({ hp: t.hp, dead: !!t.dead, downed: isDowned(t), newlyDowned: false, killed: !before.dead && !!t.dead }, t, amount, options);
  }

  /** Derive the visible verdict for a previously resolved death save. */
  function storedDeathSaveOutcome(t, natural) {
    if (Number(natural) === 20 && Number(t && t.hp) > 0) return 'revived';
    if (t && t.dead) return 'dead';
    if (t && t.stable) return 'stable';
    return Number(natural) >= 10 ? 'success' : 'failure';
  }

  /** Build the canonical raw d20 record for one death saving throw. */
  function deathSaveRoll(t, natural, outcome) {
    return d20Record('death-save', natural, 0, {
      actor: t, targetKind: 'dc', threshold: 10,
      outcome: outcome || storedDeathSaveOutcome(t, natural),
    });
  }

  /**
   * Resolve one unmodified death saving throw. The turn serial makes retries,
   * double-clicks, and sync replays idempotent. `forcedNatural` is for replaying
   * a recorded roll in guards/tests; normal callers omit it and use engine RNG.
   */
  function resolveDeathSave(t, turnSerial, forcedNatural) {
    const serial = Number(turnSerial);
    if (!Number.isInteger(serial) || serial < 0) return { blocked: true, error: 'A valid turn serial is required.' };
    if (!t || t.kind !== 'pc' || t.dead || t.fled) return { blocked: true, error: 'Only a living downed hero makes death saves.' };
    if (!isDowned(t) || t.stable) return { blocked: true, error: t.stable ? 'This hero is stable.' : 'This hero is not downed.' };
    const prior = deathSaveState(t);
    if (prior.turnSerial === serial) {
      return {
        blocked: true, duplicate: true, natural: prior.lastRoll,
        successes: prior.successes, failures: prior.failures, status: 'duplicate',
        rolls: [deathSaveRoll(t, prior.lastRoll)],
      };
    }
    const natural = forcedNatural === undefined ? die(20) : Number(forcedNatural);
    if (!Number.isInteger(natural) || natural < 1 || natural > 20) return { blocked: true, error: 'A death save must be a natural d20 roll from 1 to 20.' };

    let successes = prior.successes, failures = prior.failures, status;
    if (natural === 20) {
      t.hp = 1; t.dead = false; t.downed = false; t.stable = false;
      // Retain the turn marker even though the active counters reset. The hero
      // may take their normal turn now, and a sync/retry cannot roll again.
      t.deathSaves = { successes: 0, failures: 0, lastRoll: natural, turnSerial: serial };
      return {
        blocked: false, natural, successes: 0, failures: 0, status: 'revived',
        text: `${t.name || 'The hero'} rolls a natural 20: death save revived (rises with 1 HP).`,
        rolls: [deathSaveRoll(t, natural, 'revived')],
      };
    }
    if (natural === 1) { failures = Math.min(3, failures + 2); status = 'failure'; }
    else if (natural >= 10) { successes = Math.min(3, successes + 1); status = 'success'; }
    else { failures = Math.min(3, failures + 1); status = 'failure'; }

    t.deathSaves = { successes, failures, lastRoll: natural, turnSerial: serial };
    if (failures >= 3) {
      t.dead = true; t.downed = false; t.stable = false; status = 'dead';
    } else if (successes >= 3) {
      t.downed = true; t.stable = true; status = 'stable';
    }
    const text = status === 'dead' ? `${t.name || 'The hero'} rolls ${natural}: death save dead (${successes} successes, ${failures} failures).`
      : status === 'stable' ? `${t.name || 'The hero'} rolls ${natural}: death save stable (${successes} successes, ${failures} failures).`
        : `${t.name || 'The hero'} rolls ${natural}: death save ${status} (${successes} successes, ${failures} failures${prior.failures && failures > prior.failures ? `; ${prior.failures} before this roll + ${failures - prior.failures} now` : ''}).`;
    return {
      blocked: false, natural, successes, failures, status, text,
      rolls: [deathSaveRoll(t, natural, status)],
    };
  }
  function spendSlot(actor, action) {
    if (action.type !== 'spell' || !action.slot) return true;
    const lvl = String(action.slot);
    if (!actor.slots || !actor.slots[lvl] || actor.slots[lvl] <= 0) return false;
    actor.slots[lvl] -= 1; return true;
  }
  function saveVs(world, action, target, source, ordinal, count) {
    const dc = action.save.dc, baseMod = modsOf(world, target)[action.save.ability.toLowerCase()] || 0;
    const mode = SP ? SP.saveRollMode(target, action.save.ability).net : 'normal';
    const rolled = SP ? SP.rollD20WithMode(die, mode) : { natural: die(20), dice: [], mode: 'normal' };
    const bless = SP && SP.hasCondition(target, 'blessed') ? die(4) : 0;
    const sv = rolled.natural, mod = baseMod + bless;
    const pass = sv + mod >= dc;
    const roll = d20Record('save', sv, mod, {
      actor: target, target: source, actionName: action.name,
      targetKind: 'dc', threshold: dc, outcome: pass ? 'save' : 'fail',
      ordinal, count,
    });
    return { sv, mod, baseMod, blessBonus: bless, mode, dice: rolled.dice, pass, dc, roll };
  }
  function applyActionCondition(actor, action, target) {
    if (!SP || !action.applyCondition || !target || target.dead || target.fled) return null;
    const spec = typeof action.applyCondition === 'string' ? { id: action.applyCondition } : action.applyCondition;
    return SP.addCondition(target, {
      ...spec, sourceId: actor.id, spellId: action.id || action.name,
      concentration: !!(action.concentration || spec.concentration),
    });
  }
  function recordConcentrationImpact(impact, rolls, lines) {
    const check = impact && impact.concentrationCheck;
    if (!check || !check.checked) return;
    if (check.roll) rolls.push(check.roll);
    if (check.note) lines.push(check.note);
  }
  function damageStatusText(t) {
    if (t.kind === 'pc' && t.dead) return ` — ${t.name} dies!`;
    if (isDowned(t)) return ` — ${t.name} is DOWN at 0 HP; death saves begin on their turn!`;
    if (t.dead) return ` — ${t.name} is defeated!`;
    return ` (${t.hp}/${t.maxHp}).`;
  }
  function resolveConeAction(world, actor, action, target) {
    const caught = coneTargets(world, actor, action, target);
    if (!caught.length) return { blocked: false, text: `${actor.name}'s ${action.name} roars into empty air.`, killed: false, rolls: [] };
    const lines = [`${actor.name} unleashes ${action.name}!`], rolls = []; let killed = false;
    for (let index = 0; index < caught.length; index++) {
      const token = caught[index], ordinal = index + 1;
      const save = saveVs(world, action, token, actor, ordinal, caught.length);
      const rolled = rollSpec('damage', action.damage, false, {
        actor, target: token, actionName: action.name, outcome: 'damage',
        ordinal, count: caught.length,
      });
      let damage = rolled.value.total;
      if (save.pass) damage = action.save.half ? Math.floor(damage / 2) : 0;
      rolled.roll.outcome = save.pass ? (action.save.half ? 'halved' : 'negated') : 'damage';
      const impact = damage > 0 ? applyDamage(token, damage, { world, source: actor }) : null;
      killed = killed || !!(impact && (impact.killed || impact.newlyDowned));
      rolls.push(save.roll, rolled.roll);
      lines.push(`${token.name}: ${save.sv}${save.mod >= 0 ? '+' + save.mod : save.mod} vs DC ${save.dc} — ${save.pass ? 'saves' : 'fails'}, ${damage} ${action.damage.type}${damageStatusText(token)}`);
      recordConcentrationImpact(impact, rolls, lines);
    }
    return { blocked: false, text: lines.join(' '), killed, rolls };
  }
  function resolveSphereBuff(world, actor, action, caught) {
    const limit = Math.max(1, Number(action.maxTargets) || caught.length);
    const chosen = caught.slice(0, limit);
    const lines = [];
    if (action.concentration && SP) {
      const started = SP.startConcentration(world, actor, action, chosen.map((t) => t.id), world.round);
      if (started.droppedNote) lines.push(started.droppedNote);
    }
    chosen.forEach((token) => applyActionCondition(actor, action, token));
    lines.push(`${actor.name} casts ${action.name} on ${chosen.map((t) => t.name).join(', ')}.`);
    return { blocked: false, killed: false, rolls: [], buffedIds: chosen.map((t) => t.id), caughtIds: chosen.map((t) => t.id), text: lines.join(' ') };
  }
  function resolveSphereHeal(actor, action, caught) {
    const limit = Math.max(1, Number(action.maxTargets) || caught.length);
    const chosen = caught.filter((t) => !t.dead && !t.fled && t.hp < t.maxHp).slice(0, limit);
    if (!chosen.length) return { blocked: false, killed: false, rolls: [], healedIds: [], text: `${actor.name}'s ${action.name} washes over allies already at full health.` };
    const shared = rollDice(action.heal, false), diceNote = rolledNotation(action.heal, false);
    const rolls = [], parts = [];
    chosen.forEach((token, index) => {
      const before = Number(token.hp) || 0;
      token.hp = Math.min(token.maxHp, before + shared.total);
      if (token.kind === 'pc' && token.hp > 0) { token.dead = false; clearDeathSaves(token); }
      rolls.push(rollRecord('healing', shared, {
        actor, target: token, actionName: action.name, dice: diceNote,
        outcome: 'healed', ordinal: index + 1, count: chosen.length,
      }));
      parts.push(`${token.name} +${token.hp - before} HP (${token.hp}/${token.maxHp})`);
    });
    return { blocked: false, killed: false, rolls, healedIds: chosen.map((t) => t.id), text: `${actor.name} casts ${action.name}: ${parts.join(', ')}.` };
  }
  function resolveSphereAction(world, actor, action, target) {
    const caught = SP ? SP.sphereTargets(world, actor, action, target) : [];
    if (!caught.length) return { blocked: false, text: `${actor.name}'s ${action.name} bursts over empty ground.`, killed: false, rolls: [], caughtIds: [] };
    if (action.mode === 'buff') return resolveSphereBuff(world, actor, action, caught);
    if (action.mode === 'heal') return resolveSphereHeal(actor, action, caught);
    const lines = [], rolls = []; let killed = false;
    if (action.concentration && SP) {
      const started = SP.startConcentration(world, actor, action, caught.map((t) => t.id), world.round);
      if (started.droppedNote) lines.push(started.droppedNote);
    }
    lines.push(`${actor.name} unleashes ${action.name}!`);
    const shared = action.damage ? rollDice(action.damage, false) : null;
    const diceNote = action.damage ? rolledNotation(action.damage, false) : null;
    const halfOnSave = action.save && action.save.half !== false;
    for (let index = 0; index < caught.length; index++) {
      const token = caught[index], ordinal = index + 1;
      const save = saveVs(world, action, token, actor, ordinal, caught.length);
      rolls.push(save.roll);
      let damage = 0, condText = '';
      if (shared) {
        damage = save.pass ? (halfOnSave ? Math.floor(shared.total / 2) : 0) : shared.total;
        rolls.push(rollRecord('damage', shared, {
          actor, target: token, actionName: action.name, dice: diceNote,
          outcome: save.pass ? (halfOnSave ? 'halved' : 'negated') : 'damage', ordinal, count: caught.length,
        }));
      }
      if (!save.pass && action.applyCondition) {
        const applied = applyActionCondition(actor, action, token);
        if (applied) condText = ` (${applied.id})`;
      }
      const impact = damage > 0 ? applyDamage(token, damage, { world, source: actor }) : null;
      killed = killed || !!(impact && (impact.killed || impact.newlyDowned));
      const dmgText = shared ? `, ${damage} ${action.damage.type}${damageStatusText(token)}` : `${condText || '.'}`;
      lines.push(`${token.name}: ${save.sv}${save.mod >= 0 ? '+' + save.mod : save.mod} vs DC ${save.dc} — ${save.pass ? 'saves' : 'fails'}${dmgText}`);
      recordConcentrationImpact(impact, rolls, lines);
    }
    return { blocked: false, text: lines.join(' '), killed, rolls, caughtIds: caught.map((t) => t.id), sharedDamage: shared ? shared.total : 0 };
  }
  function resolveBuffAction(world, actor, action, target) {
    const allies = validTargets(world, actor, action);
    const limit = Math.max(1, Number(action.maxTargets) || 1);
    const chosen = target && allies.some((a) => a.id === target.id) ? [target] : [];
    for (const ally of allies) {
      if (chosen.length >= limit) break;
      if (!chosen.some((c) => c.id === ally.id)) chosen.push(ally);
    }
    if (!chosen.length) return { blocked: true, text: `${actor.name} has no eligible ally in range for ${action.name}.`, killed: false, rolls: [] };
    const lines = [];
    if (action.concentration && SP) {
      const started = SP.startConcentration(world, actor, action, chosen.map((t) => t.id), world.round);
      if (started.droppedNote) lines.push(started.droppedNote);
    }
    chosen.forEach((ally) => applyActionCondition(actor, action, ally));
    lines.push(`${actor.name} casts ${action.name} on ${chosen.map((t) => t.name).join(', ')}.`);
    return { blocked: false, killed: false, rolls: [], buffedIds: chosen.map((t) => t.id), text: lines.join(' ') };
  }
  function resolveHealingAction(actor, action, target) {
    const wasDowned = isDowned(target), beforeHp = Number(target.hp) || 0;
    const rolled = rollSpec('healing', action.heal, false, {
      actor, target, actionName: action.name, outcome: 'healed',
    });
    target.hp = Math.min(target.maxHp, target.hp + rolled.value.total);
    if (target.kind === 'pc' && target.hp > 0) { target.dead = false; clearDeathSaves(target); }
    const restored = target.hp - beforeHp;
    return {
      blocked: false, killed: false,
      text: `${actor.name} channels ${action.name} into ${target.name}: +${restored} HP (now ${target.hp}/${target.maxHp})${wasDowned && target.hp > 0 ? ' — back on their feet.' : '.'}`,
      rolls: [rolled.roll],
    };
  }
  function resolveAutohitAction(world, actor, action, target) {
    const count = Math.max(1, Number(action.darts) || 1), rolls = []; let damage = 0;
    for (let i = 0; i < count; i++) {
      const rolled = rollSpec('autohit', action.damage, false, {
        actor, target, actionName: action.name, outcome: 'autohit', ordinal: i + 1, count,
      });
      damage += rolled.value.total; rolls.push(rolled.roll);
    }
    const impact = applyDamage(target, damage, { world, source: actor });
    const lines = [`${actor.name}'s ${action.name} strikes ${target.name} automatically for ${damage} ${action.damage.type}${damageStatusText(target)}`];
    recordConcentrationImpact(impact, rolls, lines);
    return { blocked: false, killed: !!(impact.killed || impact.newlyDowned), rolls, text: lines.join(' ') };
  }
  function resolveSaveAction(world, actor, action, target) {
    const lines = [], rolls = [];
    if (action.concentration && SP) {
      const started = SP.startConcentration(world, actor, action, [target.id], world.round);
      if (started.droppedNote) lines.push(started.droppedNote);
    }
    const save = saveVs(world, action, target, actor, 1, 1);
    rolls.push(save.roll);
    let damage = 0, dmgText = '';
    if (action.damage) {
      const rolled = rollSpec('damage', action.damage, false, { actor, target, actionName: action.name, outcome: 'damage' });
      damage = save.pass ? (action.save.half ? Math.floor(rolled.value.total / 2) : 0) : rolled.value.total;
      rolled.roll.outcome = save.pass ? (action.save.half ? 'halved' : 'negated') : 'damage';
      rolls.push(rolled.roll);
      dmgText = `, ${damage} ${action.damage.type}${damageStatusText(target)}`;
    }
    let condNote = '';
    if (!save.pass && action.applyCondition) {
      const applied = applyActionCondition(actor, action, target);
      if (applied) condNote = ` (${applied.id})`;
    }
    const impact = damage > 0 ? applyDamage(target, damage, { world, source: actor }) : null;
    const killed = !!(impact && (impact.killed || impact.newlyDowned));
    lines.push(`${actor.name} casts ${action.name}. ${target.name}: ${save.sv}${save.mod >= 0 ? '+' + save.mod : save.mod} vs DC ${save.dc} — ${save.pass ? 'saves' : 'fails'}${dmgText || (condNote ? condNote + '.' : '.')}`);
    recordConcentrationImpact(impact, rolls, lines);
    return { blocked: false, killed, rolls, text: lines.join(' ') };
  }
  function attackDamage(world, actor, action, target, critical, ordinal, count) {
    const rolled = rollSpec('damage', action.damage, critical, {
      actor, target, actionName: action.name, outcome: 'damage', ordinal, count,
    });
    let damage = rolled.value.total, sneakNote = ''; const rolls = [rolled.roll];
    const sheet = world && typeof world.sheetFor === 'function' ? (world.sheetFor(actor) || {}) : {};
    const sneakDice = action.sneak ? (sheet.sneakDice || action.sneak) : null;
    if (sneakDice && sneakEligible(world, actor, target)) {
      const sneak = rollSpec('sneak', sneakDice, critical, {
        actor, target, actionName: action.name, outcome: 'damage', ordinal, count,
      });
      damage += sneak.value.total; sneakNote = ` (+${sneak.value.total} sneak)`; rolls.push(sneak.roll);
    }
    return { damage, sneakNote, rolls };
  }
  function resolveAttackAction(world, actor, action, target) {
    const sheet = world && typeof world.sheetFor === 'function' ? (world.sheetFor(actor) || {}) : {};
    const pcSwings = actor.kind === 'pc' && action.type === 'weapon' ? Math.max(1, Number(sheet.attacksPerAction) || 1) : 1;
    const swings = actor.kind === 'monster' ? Math.max(1, Number(action.multiattack) || 1) : pcSwings;
    const lines = [], rolls = []; let killed = false;
    const targetAc = SP ? SP.effectiveAc(target) : target.ac;
    const rollMode = SP ? SP.attackRollMode(actor, target, action).net : 'normal';
    for (let swing = 0; swing < swings && !target.dead; swing++) {
      const rolled = SP ? SP.rollD20WithMode(die, rollMode) : { natural: die(20) };
      const bless = SP && SP.hasCondition(actor, 'blessed') ? die(4) : 0;
      const natural = rolled.natural, bonus = (action.toHit || 0) + bless, total = natural + bonus;
      const critical = natural === 20, hit = critical || (natural !== 1 && total >= targetAc);
      rolls.push(d20Record('attack', natural, bonus, {
        actor, target, actionName: action.name, targetKind: 'ac', threshold: targetAc,
        outcome: critical ? 'critical' : hit ? 'hit' : 'miss', ordinal: swing + 1, count: swings,
      }));
      if (!hit) { lines.push(`${actor.name}'s ${action.name}: ${natural}+${bonus}=${total} vs AC ${targetAc} — miss.`); continue; }
      const strike = attackDamage(world, actor, action, target, critical, swing + 1, swings);
      const impact = applyDamage(target, strike.damage, { critical, world, source: actor });
      if (action.applyCondition) applyActionCondition(actor, action, target);
      killed = killed || impact.killed || impact.newlyDowned;
      rolls.push(...strike.rolls);
      lines.push(`${actor.name}'s ${action.name}${critical ? ' CRITS' : ''}: ${natural}+${bonus}=${total} vs AC ${targetAc} — hit for ${strike.damage} ${action.damage.type}${strike.sneakNote}${damageStatusText(target)}`);
      recordConcentrationImpact(impact, rolls, lines);
    }
    return { blocked: false, text: lines.join(' '), killed, rolls, rollMode };
  }
  /** Resolve one action and mutate only its declared resources and targets. */
  function resolveAction(world, actor, action, target) {
    if (action.mode === 'reaction') {
      return { blocked: true, text: `${action.name} is a reaction and triggers off-turn.`, killed: false, rolls: [] };
    }
    if (action.mode === 'heal' && action.aoeShape !== 'sphere' && (!target || target.dead || target.fled)) {
      return { blocked: true, text: `${target && target.name ? target.name : 'That target'} cannot be healed.`, killed: false, rolls: [] };
    }
    if (!spendSlot(actor, action)) return { blocked: true, text: `${actor.name} has no level-${action.slot} slots left.`, killed: false, rolls: [] };
    if (action.aoeShape === 'sphere') return resolveSphereAction(world, actor, action, target);
    if (action.aoeShape === 'cone' && action.mode === 'save') return resolveConeAction(world, actor, action, target);
    if (action.mode === 'buff') return resolveBuffAction(world, actor, action, target);
    if (action.mode === 'heal') return resolveHealingAction(actor, action, target);
    if (action.mode === 'autohit') return resolveAutohitAction(world, actor, action, target);
    if (action.mode === 'save') return resolveSaveAction(world, actor, action, target);
    return resolveAttackAction(world, actor, action, target);
  }
  function checkConcentrationOnDamage(world, target, damage, rollD20Fn, source) {
    return SP ? SP.checkConcentrationOnDamage(world, target, damage, rollD20Fn, { die, d20Record, source }) : { checked: false, maintained: true };
  }
  function resolveReaction(world, reactor, reaction, context) {
    return SP ? SP.resolveReaction(world, reactor, reaction, context, { die, d20Record, resolveAttackAction }) : { blocked: true, text: 'Reactions unavailable.', rolls: [] };
  }

  // ── Initiative + turn helpers ──────────────────────────────────────────────
  /** Roll initiative once and retain every combatant's exact d20 result. */
  function rollInitiativeDetailed(tokens) {
    const alive = tokens.filter((t) => t.kind !== 'prop' && !t.dead);
    const count = alive.length, rolls = [];
    alive.forEach((token, index) => {
      const natural = die(20), bonus = token.initiative || 0;
      token.initRoll = natural + bonus;
      rolls.push(d20Record('initiative', natural, bonus, {
        actor: token, outcome: 'rolled', ordinal: index + 1, count,
      }));
    });
    alive.sort((a, b) => b.initRoll - a.initRoll || (b.initiative || 0) - (a.initiative || 0) || (a.kind === 'pc' ? -1 : 1));
    return { order: alive.map((t) => t.id), rolls };
  }
  /** Roll initiative for legacy callers that only consume ordered ids. */
  function rollInitiative(tokens) {
    return rollInitiativeDetailed(tokens).order;
  }

  // ── Monster tactics ────────────────────────────────────────────────────────
  const nearestPC = (world, m) => {
    const pcs = living(world, 'pc').filter(isConscious);
    return pcs.length ? pcs.reduce((a, b) => (cheb(m, a) <= cheb(m, b) ? a : b)) : null;
  };
  /** Advance a monster up to its speed toward `tgt`, greedily, respecting terrain. */
  function stepToward(world, m, tgt) {
    const budget = Math.floor(m.speed / 5);
    for (let s = 0; s < budget; s++) {
      if (cheb(m, tgt) <= 1) break;
      const sx = Math.sign(tgt.x - m.x), sy = Math.sign(tgt.y - m.y);
      const tries = [[sx, sy], [sx, 0], [0, sy]].filter(([dx, dy]) => dx || dy);
      let moved = false;
      for (const [dx, dy] of tries) { if (walkable(world, m.x + dx, m.y + dy, m.id)) { m.x += dx; m.y += dy; moved = true; break; } }
      if (!moved) break;
    }
  }
  /** Choose the monster's action against tgt AFTER any movement (null = no play). */
  function pickMonsterAction(world, m, tgt) {
    const acts = (world.sheetFor(m) || {}).actions || [];
    const melee = acts.find((a) => a.delivery === 'melee');
    const ranged = acts.find((a) => a.delivery === 'ranged');
    if (melee && cheb(m, tgt) <= 1) return melee;
    if (ranged && inRange(ranged, m, tgt)) return ranged;
    return null;
  }
  /** True when the goblin rank-and-file should rout (their boss is down). */
  function goblinsShouldFlee(world) {
    return world.tokens.some((t) => t.ref === 'goblin-boss' && (t.dead || t.fled));
  }

  // ── End-state + level-up ───────────────────────────────────────────────────
  function checkEnd(world) {
    if (!living(world, 'monster').length) return 'victory';
    // An unstable downed hero still gets death-save turns. Once nobody is
    // conscious and every survivor is stable (or finally dead), the fight is a
    // defeat/capture rather than an endless initiative loop.
    const survivors = world.tokens.filter((t) => t.kind === 'pc' && !t.dead && !t.fled);
    if (!survivors.some((t) => isConscious(t) || (isDowned(t) && !t.stable))) return 'defeat';
    return null;
  }
  /** Look up one class level delta from srd-leveling.json (level2..level5). */
  function levelDeltaFor(leveling, targetLevel, className) {
    if (!leveling || typeof leveling !== 'object') return null;
    const bucket = leveling[`level${Number(targetLevel)}`];
    if (!bucket || typeof bucket !== 'object') return null;
    return bucket[className] || null;
  }
  /** Resolve standard SRD 5.1 proficiency bonus for a character level. */
  function proficiencyForLevel(leveling, level) {
    const lvl = Math.max(1, Number(level) || 1);
    const map = leveling && leveling.proficiencyByLevel;
    if (map && Number.isFinite(Number(map[String(lvl)]))) return Number(map[String(lvl)]);
    return 2 + Math.floor((lvl - 1) / 4);
  }
  /** Determine the highest level reached for a given total XP. */
  function targetLevelForXp(leveling, xp, currentLevel) {
    let target = Math.max(1, Number(currentLevel) || 1);
    const thresholds = (leveling && leveling.thresholds) || {};
    const levels = Object.keys(thresholds).map(Number).filter((n) => Number.isInteger(n) && n > target).sort((a, b) => a - b);
    for (const lvl of levels) {
      if (Number(xp) >= Number(thresholds[String(lvl)])) target = lvl;
    }
    return target;
  }
  /** Merge new spell slot capacities without losing existing lower-level pools. */
  function mergeSpellSlots(existing, incoming) {
    const merged = existing && typeof existing === 'object' ? JSON.parse(JSON.stringify(existing)) : {};
    if (!incoming || typeof incoming !== 'object') return merged;
    Object.keys(incoming).sort((a, b) => Number(a) - Number(b)).forEach((tier) => {
      const cap = Math.max(0, Number(incoming[tier]) || 0);
      merged[String(tier)] = Math.max(Number(merged[String(tier)]) || 0, cap);
    });
    return merged;
  }
  /** Format a concise human-readable level-up summary note. */
  function formatLevelUpNote(name, newLevel, delta, nextProf, profDelta) {
    if (!delta) return `${name} reaches level ${newLevel}.`;
    const gains = [`+${delta.hpGain || 0} HP`];
    if (profDelta > 0) gains.push(`proficiency +${nextProf}`);
    if (delta.newSlots) {
      const summary = Object.keys(delta.newSlots).sort((a, b) => Number(a) - Number(b))
        .map((lvl) => `L${lvl}x${delta.newSlots[lvl]}`).join('/');
      gains.push(`spell slots ${summary}`);
    }
    if (delta.sneakDice) gains.push(`Sneak Attack ${delta.sneakDice}`);
    (delta.newActions || []).forEach((action) => gains.push(action.name));
    (delta.newFeatures || []).forEach((feature) => gains.push(String(feature).split(':')[0]));
    return `${name} reaches level ${newLevel}: ${gains.join(', ')}.`;
  }
  /** Apply one level's SRD delta to a cloned sheet, updating stats, slots, and actions. */
  function applySingleLevelDelta(sheet, delta, newLevel, leveling) {
    const up = JSON.parse(JSON.stringify(sheet || {}));
    const fromLevel = Math.max(1, Number(up.level) || 1);
    const toLevel = Math.max(fromLevel, Number(newLevel) || fromLevel);
    const prevProf = Number(up.proficiencyBonus != null ? up.proficiencyBonus : up.prof) || proficiencyForLevel(leveling, fromLevel);
    const nextProf = delta && Number.isFinite(Number(delta.proficiencyBonus)) ? Number(delta.proficiencyBonus) : proficiencyForLevel(leveling, toLevel);
    const profDelta = Math.max(0, nextProf - prevProf);
    up.level = toLevel; up.prof = nextProf; up.proficiencyBonus = nextProf;
    const hpGain = Number(delta && delta.hpGain) || 0;
    if (hpGain) { up.maxHp = (Number(up.maxHp) || 0) + hpGain; if (up.hp !== undefined) up.hp = Math.min(up.maxHp, (Number(up.hp) || 0) + hpGain); }
    const atkGain = profDelta + (Number(delta && delta.attackBonusGain) || 0);
    const dcGain = profDelta + (Number(delta && delta.saveDcGain) || 0);
    if (atkGain && Number.isFinite(Number(up.spellAttack))) up.spellAttack = Number(up.spellAttack) + atkGain;
    if (dcGain && Number.isFinite(Number(up.spellSaveDc))) up.spellSaveDc = Number(up.spellSaveDc) + dcGain;
    up.actions = Array.isArray(up.actions) ? up.actions : [];
    up.actions.forEach((a) => {
      if (atkGain && typeof a.toHit === 'number') a.toHit += atkGain;
      if (dcGain && a.save && typeof a.save.dc === 'number') a.save.dc += dcGain;
      if (delta && delta.sneakDice && a.sneak) a.sneak = delta.sneakDice;
    });
    if (delta && delta.sneakDice) up.sneakDice = delta.sneakDice;
    if (delta && delta.attacksPerAction) up.attacksPerAction = Math.max(Number(up.attacksPerAction) || 1, Number(delta.attacksPerAction));
    if (delta && delta.speedGain) up.speed = (Number(up.speed) || 30) + Number(delta.speedGain);
    if (delta && delta.newSlots) up.slots = mergeSpellSlots(up.slots, delta.newSlots);
    const seenIds = new Set(up.actions.map((a) => a && a.id).filter(Boolean));
    const addedActions = (delta && delta.newActions || []).filter((a) => a && (!a.id || !seenIds.has(a.id)));
    addedActions.forEach((a) => { up.actions.push(JSON.parse(JSON.stringify(a))); if (a.id) seenIds.add(a.id); });
    up.features = Array.isArray(up.features) ? up.features : [];
    const seenFeats = new Set(up.features);
    const addedFeatures = (delta && delta.newFeatures || []).filter((f) => f && !seenFeats.has(f));
    addedFeatures.forEach((f) => { up.features.push(f); seenFeats.add(f); });
    const note = formatLevelUpNote(up.name || 'Hero', toLevel, delta, nextProf, profDelta);
    const record = {
      fromLevel, toLevel, hpGain, proficiencyBonus: nextProf,
      newFeatures: addedFeatures, newActions: addedActions.map((a) => JSON.parse(JSON.stringify(a))),
      newSlots: delta && delta.newSlots ? JSON.parse(JSON.stringify(up.slots)) : null,
      note,
    };
    return { sheet: up, record, note };
  }
  /** Multi-level advancement (shared by server /advance and client). Preserves legacy 3-arg single-delta form. */
  function applyLevelUp(sheet, levelingOrDelta, targetOrOptions) {
    const isTable = !!(levelingOrDelta && typeof levelingOrDelta === 'object' && (levelingOrDelta.thresholds || levelingOrDelta.level2));
    if (!isTable) {
      return applySingleLevelDelta(sheet, levelingOrDelta, targetOrOptions, null).sheet;
    }
    const leveling = levelingOrDelta;
    let current = JSON.parse(JSON.stringify(sheet || {}));
    const startLevel = Math.max(1, Number(current.level) || 1);
    const opts = targetOrOptions && typeof targetOrOptions === 'object' ? targetOrOptions : null;
    const targetLevel = opts && Number.isFinite(Number(opts.xp))
      ? targetLevelForXp(leveling, Number(opts.xp), startLevel)
      : Math.max(startLevel, Number(opts ? opts.targetLevel : targetOrOptions) || startLevel);
    const levelUps = [], notes = [];
    for (let lvl = startLevel + 1; lvl <= targetLevel; lvl++) {
      const delta = levelDeltaFor(leveling, lvl, current.class);
      const step = applySingleLevelDelta(current, delta, lvl, leveling);
      current = step.sheet;
      levelUps.push(step.record);
      notes.push(step.note);
    }
    if (opts && Number.isFinite(Number(opts.xp))) current.xp = Number(opts.xp);
    return { sheet: current, levelUps, notes };
  }
  /** Compute current level, XP, and next XP threshold for UI display. */
  function levelProgress(leveling, level, xp) {
    const curLevel = Math.max(1, Number(level) || 1), curXp = Math.max(0, Number(xp) || 0);
    const thresholds = (leveling && leveling.thresholds) || { 2: 300, 3: 900, 4: 2700, 5: 6500 };
    const levels = Object.keys(thresholds).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
    const maxLevel = levels.length ? levels[levels.length - 1] : 5;
    const nextLevel = levels.find((lvl) => lvl > curLevel) || null;
    return {
      level: curLevel, xp: curXp, nextLevel, maxLevel, isMax: !nextLevel,
      nextThreshold: nextLevel ? Number(thresholds[String(nextLevel)]) : null,
    };
  }

const DnDEngine = {
  ...(SP || {}),
  setRng, die, rollDice, keyOf, cheb, living, isDowned, isConscious, deathSaveState, clearDeathSaves, occupied, walkable,
  computeMovementCosts, computeReachable, inRange, coneTargets, validTargets, sneakEligible,
  applyDamage, resolveDeathSave, spendSlot, saveVs, resolveAction, resolveSphereAction, resolveBuffAction,
  checkConcentrationOnDamage, resolveReaction,
  rollInitiative, rollInitiativeDetailed, nearestPC, stepToward, pickMonsterAction, goblinsShouldFlee,
  checkEnd, levelDeltaFor, proficiencyForLevel, targetLevelForXp, levelProgress, applyLevelUp,
};
if (typeof module === 'object' && module.exports) module.exports = DnDEngine;
else if (typeof globalThis !== 'undefined') globalThis.DnDEngine = DnDEngine;
}
