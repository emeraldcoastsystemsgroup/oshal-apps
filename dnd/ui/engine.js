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
 *
 * `world` is the state handle every function reads:
 *   { grid:{w,h}, blockSet:Set<"x,y">, diffSet:Set<"x,y">, tokens:[...],
 *     sheetFor:(token)=>statSheet }   // statSheet supplies .mods and .actions
 */

'use strict';

{

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
    const budget = Math.max(0, Math.floor((Number(t.speed) || 0) / 5));
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
    // Healing reaches conscious, downed, or stable allies, but never resurrects
    // a legacy/final `dead:true` character.
    if (action.mode === 'heal') return world.tokens.filter((t) =>
      t.kind === actor.kind && !t.dead && !t.fled &&
      t.hp < t.maxHp && inRange(action, actor, t));
    const foeKind = actor.kind === 'pc' ? 'monster' : 'pc';
    return living(world, foeKind).filter((t) => inRange(action, actor, t));
  }
  function sneakEligible(world, actor, target) {
    return actor.kind === 'pc' && living(world, 'pc').some((a) => a.id !== actor.id && isConscious(a) && cheb(a, target) <= 1);
  }

  // ── Resolution ─────────────────────────────────────────────────────────────
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
      return { hp: 0, dead: !!t.dead, downed: isDowned(t), newlyDowned: false, killed: !before.dead && !!t.dead };
    }

    t.hp = Math.max(0, before.hp - amount);
    if (t.kind === 'pc' && t.hp <= 0) {
      t.dead = false; t.downed = true; t.stable = false;
      t.deathSaves = { successes: 0, failures: 0 };
      return { hp: 0, dead: false, downed: true, newlyDowned: true, killed: false };
    }
    if (t.hp <= 0) t.dead = true;
    return { hp: t.hp, dead: !!t.dead, downed: isDowned(t), newlyDowned: false, killed: !before.dead && !!t.dead };
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
    const dc = action.save.dc, mod = modsOf(world, target)[action.save.ability.toLowerCase()] || 0;
    const sv = die(20);
    const pass = sv + mod >= dc;
    const roll = d20Record('save', sv, mod, {
      actor: target, target: source, actionName: action.name,
      targetKind: 'dc', threshold: dc, outcome: pass ? 'save' : 'fail',
      ordinal, count,
    });
    return { sv, mod, pass, dc, roll };
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
      const impact = damage > 0 ? applyDamage(token, damage) : null;
      killed = killed || !!(impact && (impact.killed || impact.newlyDowned));
      rolls.push(save.roll, rolled.roll);
      lines.push(`${token.name}: ${save.sv}${save.mod >= 0 ? '+' + save.mod : save.mod} vs DC ${save.dc} — ${save.pass ? 'saves' : 'fails'}, ${damage} ${action.damage.type}${damageStatusText(token)}`);
    }
    return { blocked: false, text: lines.join(' '), killed, rolls };
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
  function resolveAutohitAction(actor, action, target) {
    const count = Math.max(1, Number(action.darts) || 1), rolls = []; let damage = 0;
    for (let i = 0; i < count; i++) {
      const rolled = rollSpec('autohit', action.damage, false, {
        actor, target, actionName: action.name, outcome: 'autohit', ordinal: i + 1, count,
      });
      damage += rolled.value.total; rolls.push(rolled.roll);
    }
    const impact = applyDamage(target, damage);
    return {
      blocked: false, killed: !!(impact.killed || impact.newlyDowned), rolls,
      text: `${actor.name}'s ${action.name} strikes ${target.name} automatically for ${damage} ${action.damage.type}${damageStatusText(target)}`,
    };
  }
  function resolveSaveAction(world, actor, action, target) {
    const save = saveVs(world, action, target, actor, 1, 1);
    const rolled = rollSpec('damage', action.damage, false, {
      actor, target, actionName: action.name, outcome: 'damage',
    });
    let damage = rolled.value.total;
    if (save.pass) damage = action.save.half ? Math.floor(damage / 2) : 0;
    rolled.roll.outcome = save.pass ? (action.save.half ? 'halved' : 'negated') : 'damage';
    const impact = damage > 0 ? applyDamage(target, damage) : null;
    const killed = !!(impact && (impact.killed || impact.newlyDowned));
    return {
      blocked: false, killed, rolls: [save.roll, rolled.roll],
      text: `${actor.name} casts ${action.name}. ${target.name}: ${save.sv}${save.mod >= 0 ? '+' + save.mod : save.mod} vs DC ${save.dc} — ${save.pass ? 'saves' : 'fails'}, ${damage} ${action.damage.type}${damageStatusText(target)}`,
    };
  }
  function attackDamage(world, actor, action, target, critical, ordinal, count) {
    const rolled = rollSpec('damage', action.damage, critical, {
      actor, target, actionName: action.name, outcome: 'damage', ordinal, count,
    });
    let damage = rolled.value.total, sneakNote = ''; const rolls = [rolled.roll];
    if (action.sneak && sneakEligible(world, actor, target)) {
      const sneak = rollSpec('sneak', action.sneak, critical, {
        actor, target, actionName: action.name, outcome: 'damage', ordinal, count,
      });
      damage += sneak.value.total; sneakNote = ` (+${sneak.value.total} sneak)`; rolls.push(sneak.roll);
    }
    return { damage, sneakNote, rolls };
  }
  function resolveAttackAction(world, actor, action, target) {
    const swings = action.multiattack && actor.kind === 'monster' ? action.multiattack : 1;
    const lines = [], rolls = []; let killed = false;
    for (let swing = 0; swing < swings && !target.dead; swing++) {
      const natural = die(20), total = natural + (action.toHit || 0), critical = natural === 20;
      const hit = critical || (natural !== 1 && total >= target.ac);
      rolls.push(d20Record('attack', natural, action.toHit || 0, {
        actor, target, actionName: action.name, targetKind: 'ac', threshold: target.ac,
        outcome: critical ? 'critical' : hit ? 'hit' : 'miss', ordinal: swing + 1, count: swings,
      }));
      if (!hit) { lines.push(`${actor.name}'s ${action.name}: ${natural}+${action.toHit}=${total} vs AC ${target.ac} — miss.`); continue; }
      const strike = attackDamage(world, actor, action, target, critical, swing + 1, swings);
      const impact = applyDamage(target, strike.damage, { critical });
      killed = killed || impact.killed || impact.newlyDowned;
      rolls.push(...strike.rolls);
      lines.push(`${actor.name}'s ${action.name}${critical ? ' CRITS' : ''}: ${natural}+${action.toHit}=${total} vs AC ${target.ac} — hit for ${strike.damage} ${action.damage.type}${strike.sneakNote}${damageStatusText(target)}`);
    }
    return { blocked: false, text: lines.join(' '), killed, rolls };
  }
  /** Resolve one action and mutate only its declared resources and targets. */
  function resolveAction(world, actor, action, target) {
    if (action.mode === 'heal' && (!target || target.dead || target.fled)) {
      return { blocked: true, text: `${target && target.name ? target.name : 'That target'} cannot be healed.`, killed: false, rolls: [] };
    }
    if (!spendSlot(actor, action)) return { blocked: true, text: `${actor.name} has no level-${action.slot} slots left.`, killed: false, rolls: [] };
    if (action.aoeShape === 'cone' && action.mode === 'save') return resolveConeAction(world, actor, action, target);
    if (action.mode === 'heal') return resolveHealingAction(actor, action, target);
    if (action.mode === 'autohit') return resolveAutohitAction(actor, action, target);
    if (action.mode === 'save') return resolveSaveAction(world, actor, action, target);
    return resolveAttackAction(world, actor, action, target);
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
  /** Mirror of the server /advance level-up (data/srd-leveling.json delta). */
  function applyLevelUp(sheet, delta, newLevel) {
    const up = JSON.parse(JSON.stringify(sheet));
    up.level = newLevel;
    if (!delta) return up;
    up.maxHp = (up.maxHp || 0) + (delta.hpGain || 0);
    if (delta.newSlots) up.slots = JSON.parse(JSON.stringify(delta.newSlots));
    if (delta.newActions) up.actions = (up.actions || []).concat(delta.newActions);
    if (delta.newFeatures) up.features = (up.features || []).concat(delta.newFeatures);
    return up;
  }

const DnDEngine = {
  setRng, die, rollDice, keyOf, cheb, living, isDowned, isConscious, deathSaveState, clearDeathSaves, occupied, walkable,
  computeMovementCosts, computeReachable, inRange, coneTargets, validTargets, sneakEligible,
  applyDamage, resolveDeathSave, spendSlot, saveVs, resolveAction,
  rollInitiative, rollInitiativeDetailed, nearestPC, stepToward, pickMonsterAction, goblinsShouldFlee,
  checkEnd, applyLevelUp,
};
if (typeof module === 'object' && module.exports) module.exports = DnDEngine;
else if (typeof globalThis !== 'undefined') globalThis.DnDEngine = DnDEngine;
}
