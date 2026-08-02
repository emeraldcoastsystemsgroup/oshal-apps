/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-26 22:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Leads stop being anonymous checkboxes: derive the skill a lead really tests, score every hero against it so the table can COAX the right player instead of letting whoever taps first (or an idle companion) green-light it, place each lead on the map so free-roam heroes have somewhere to walk, and set the DC its roll is contested against. Pure + deterministic so the shared table agrees without a round trip; dual-export so the browser surface and the authoritative server run the SAME code.
 * 2026-07-28 00:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Read authored terrain and party seats as the {x,y} objects they actually are — the [0]/[1] array read made blocked-cell avoidance a silent no-op, dropping lead figures inside walls and onto spawn squares.
 */

'use strict';

(function () {
  // Every lead is a question put to ONE hero. Which hero is not a matter of who
  // is fastest with a mouse — it is whichever character the fiction would send,
  // so the skill has to be derivable before anyone can be nominated.
  var SKILL_ABILITY = {
    perception: 'wis', investigation: 'int', insight: 'wis', persuasion: 'cha',
    arcana: 'int', history: 'int', nature: 'wis', religion: 'int', medicine: 'wis',
    survival: 'wis', stealth: 'dex', athletics: 'str', deception: 'cha', intimidation: 'cha',
  };

  // A lead's authored `type` already says what it is; that is enough to know what
  // it tests. Talking to someone is persuasion, a thing is investigation, a place
  // is perception. Authors override with `lead.skill` when the fiction disagrees.
  var TYPE_SKILL = { person: 'persuasion', object: 'investigation', place: 'perception' };

  // Simplified SRD-flavored class proficiencies. The point is not rules fidelity —
  // it is that the party's specialist is VISIBLY better at their thing, so being
  // nominated feels earned rather than arbitrary.
  var CLASS_SKILLS = {
    fighter: ['athletics', 'intimidation', 'perception', 'survival'],
    barbarian: ['athletics', 'intimidation', 'nature', 'survival'],
    rogue: ['investigation', 'perception', 'stealth', 'deception', 'insight'],
    ranger: ['nature', 'perception', 'survival', 'stealth'],
    monk: ['stealth', 'athletics', 'insight', 'religion'],
    wizard: ['arcana', 'history', 'investigation', 'religion'],
    sorcerer: ['arcana', 'deception', 'persuasion', 'intimidation'],
    warlock: ['arcana', 'deception', 'history', 'religion'],
    bard: ['persuasion', 'deception', 'history', 'insight', 'investigation'],
    cleric: ['religion', 'insight', 'medicine', 'persuasion'],
    druid: ['nature', 'perception', 'medicine', 'survival'],
    paladin: ['persuasion', 'intimidation', 'religion', 'athletics'],
  };

  /** @description The skill a lead tests — authored, else inferred from its type. */
  function leadSkill(lead) {
    var authored = String(lead && lead.skill || '').toLowerCase();
    if (SKILL_ABILITY[authored]) return authored;
    return TYPE_SKILL[lead && lead.type] || 'investigation';
  }

  /** @description Whether a class would plausibly be trained in this skill. */
  function classProficient(heroClass, skill) {
    var list = CLASS_SKILLS[String(heroClass || '').toLowerCase()] || [];
    return list.indexOf(skill) >= 0;
  }

  /** @description One hero's ability modifier, tolerating sheets that carry only raw scores. */
  function abilityMod(hero, ability) {
    var mods = hero && hero.mods;
    if (mods && typeof mods[ability] === 'number') return mods[ability];
    var score = hero && hero.abilities && hero.abilities[ability];
    return Math.floor(((typeof score === 'number' ? score : 10) - 10) / 2);
  }

  /** @description What this hero adds to the lead's roll (ability + proficiency when trained). */
  function heroSkillMod(hero, skill) {
    var bonus = classProficient(hero && hero.class, skill) ? Number(hero && hero.prof) || 2 : 0;
    return abilityMod(hero, SKILL_ABILITY[skill] || 'wis') + bonus;
  }

  /**
   * @description Rank the party for one lead, best first. Ties break on hero id so
   *   every device nominates the SAME hero without asking the server.
   * @param {object} lead - Authored lead.
   * @param {object[]} heroes - Party sheets.
   * @returns {Array<{hero:object, mod:number, skill:string, trained:boolean}>}
   */
  function rankHeroesForLead(lead, heroes) {
    var skill = leadSkill(lead);
    return (heroes || []).map(function (hero) {
      return {
        hero: hero, skill: skill, mod: heroSkillMod(hero, skill),
        trained: classProficient(hero && hero.class, skill),
      };
    }).sort(function (a, b) {
      if (b.mod !== a.mod) return b.mod - a.mod;
      return String(a.hero && a.hero.id).localeCompare(String(b.hero && b.hero.id));
    });
  }

  /** @description The hero the table should be coaxed to send, or null with no party. */
  function nominee(lead, heroes) {
    return rankHeroesForLead(lead, heroes)[0] || null;
  }

  /** @description Difficulty: authored, else harder for leads gated behind other clues. */
  function leadDc(lead) {
    var authored = Number(lead && lead.dc);
    if (Number.isFinite(authored) && authored > 0) return authored;
    return (lead && lead.requires && lead.requires.length) ? 14 : 12;
  }

  /** @description Stable 32-bit hash so derived map spots agree on every device. */
  function hashId(text) {
    var hash = 0, source = String(text || '');
    for (var i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
    return hash;
  }

  /** @description Cells a lead must not occupy: blocking terrain and the party's start. */
  function blockedCells(scene) {
    var taken = {};
    var terrain = scene && scene.terrain || {};
    // Authored cells are {x,y} objects everywhere in shipped data; the array shape
    // is tolerated for safety. Reading [0]/[1] on objects made this a no-op and let
    // the scatter drop figures inside walls and on top of the party's start seats.
    var mark = function (cell) {
      var x = Number.isFinite(Number(cell && cell.x)) ? cell.x : cell && cell[0];
      var y = Number.isFinite(Number(cell && cell.y)) ? cell.y : cell && cell[1];
      if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) taken[x + ',' + y] = true;
    };
    (terrain.blocking || []).forEach(mark);
    ((terrain.difficult || [])).forEach(mark);
    (scene && scene.partyStart || []).forEach(mark);
    return taken;
  }

  /**
   * @description Where a lead stands on the map. Authored `lead.spot` wins; otherwise
   *   a deterministic scatter that avoids blocking terrain, the party's start, and
   *   other leads — so 64 already-authored leads gain a physical location with no
   *   data churn, and a hero has somewhere to actually walk to.
   * @param {object} lead - Authored lead.
   * @param {object} scene - The scene (grid, terrain, partyStart).
   * @param {object[]} siblings - Every lead in the chapter, for spacing.
   * @returns {{x:number, y:number}} A walkable-ish cell inside the grid.
   */
  function leadSpot(lead, scene, siblings) {
    var grid = scene && scene.grid || { w: 18, h: 12 };
    var width = Math.max(2, Number(grid.w) || 18), height = Math.max(2, Number(grid.h) || 12);
    if (lead && lead.spot && Number.isFinite(Number(lead.spot.x))) {
      return {
        x: Math.max(0, Math.min(width - 1, Math.round(Number(lead.spot.x)))),
        y: Math.max(0, Math.min(height - 1, Math.round(Number(lead.spot.y)))),
      };
    }
    var taken = blockedCells(scene);
    // Earlier siblings claim their cells first so the scatter never stacks two
    // leads on one square — iteration order is authored order, identical everywhere.
    var list = siblings || [];
    for (var s = 0; s < list.length; s++) {
      if (String(list[s].id) === String(lead && lead.id)) break;
      if (list[s].spot) continue;
      var prior = derive(list[s], width, height, taken);
      taken[prior.x + ',' + prior.y] = true;
    }
    return derive(lead, width, height, taken);
  }

  /** @description Spiral out from a hashed cell until an unclaimed square appears. */
  function derive(lead, width, height, taken) {
    var hash = hashId(lead && lead.id);
    // Keep leads off the outermost ring so a token can always stand beside one.
    var baseX = 1 + (hash % Math.max(1, width - 2));
    var baseY = 1 + ((hash >>> 8) % Math.max(1, height - 2));
    for (var radius = 0; radius < Math.max(width, height); radius++) {
      for (var dx = -radius; dx <= radius; dx++) {
        for (var dy = -radius; dy <= radius; dy++) {
          var x = baseX + dx, y = baseY + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          if (!taken[x + ',' + y]) return { x: x, y: y };
        }
      }
    }
    return { x: baseX, y: baseY };
  }

  /**
   * @description Resolve one lead attempt. The SERVER owns this roll — a shared
   *   table cannot trust a client for whether a clue was found.
   * @param {object} lead - Authored lead.
   * @param {object} hero - The acting hero's sheet.
   * @param {function():number} rng - Injectable [0,1) source (deterministic in tests).
   * @returns {{roll:number, mod:number, total:number, dc:number, success:boolean, skill:string, crit:string}}
   */
  function resolveLeadAttempt(lead, hero, rng) {
    var skill = leadSkill(lead), dc = leadDc(lead);
    var roll = 1 + Math.floor((typeof rng === 'function' ? rng() : Math.random()) * 20);
    var mod = hero ? heroSkillMod(hero, skill) : 0;
    var total = roll + mod;
    return {
      roll: roll, mod: mod, total: total, dc: dc, skill: skill,
      // A natural 20 always finds it and a natural 1 always fumbles — the table
      // remembers those two rolls and nothing else.
      success: roll === 20 || (roll !== 1 && total >= dc),
      crit: roll === 20 ? 'nat20' : roll === 1 ? 'nat1' : '',
    };
  }

  var DnDLeads = {
    SKILL_ABILITY: SKILL_ABILITY, TYPE_SKILL: TYPE_SKILL, CLASS_SKILLS: CLASS_SKILLS,
    leadSkill: leadSkill, classProficient: classProficient, heroSkillMod: heroSkillMod,
    rankHeroesForLead: rankHeroesForLead, nominee: nominee, leadDc: leadDc,
    leadSpot: leadSpot, resolveLeadAttempt: resolveLeadAttempt, hashId: hashId,
  };
  if (typeof module === 'object' && module.exports) module.exports = DnDLeads;
  else if (typeof globalThis !== 'undefined') globalThis.DnDLeads = DnDLeads;
})();
