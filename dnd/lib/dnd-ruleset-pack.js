/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Package D&D 5e SRD rules, character import, combat beat classification, Level 2-5 progression, monster tactics, and Dungeon Master narration as the first GameDefinition ruleset pack (v0.22.10).
 */

'use strict';

const ENG = require('../ui/engine.js');
const beats = require('./dnd-cutaway-beats');
const { importCharacter, normalizeInternalSheet } = require('./character-import');
const { stateWriteDecision } = require('./multiplayer-guard');
const { GAME_DEFINITION_SCHEMA_VERSION } = require('./tabletop-runtime');

const DND_GAME_ID = 'dnd-5e-srd';
const DND_GAME_VERSION = '0.22.10';
const DND_CAPABILITIES = Object.freeze([
  'sessions',
  'seats',
  'turns',
  'shared-rolls',
  'story',
  'media',
  'rewind',
  'replay-export',
  'character-import',
  'tactical-grid',
  'spellcasting',
  'progression',
]);

/** @description Resolve one D&D 5e SRD tactical action, sphere spell, or death save. */
function resolveDndTurnAction(input) {
  const req = input || {};
  if (req.kind === 'death-save') {
    return ENG.resolveDeathSave(req.actor, req.turnSerial || 1);
  }
  const world = req.world || {
    tokens: Array.isArray(req.tokens) ? req.tokens : [],
    sheetFor: typeof req.sheetFor === 'function' ? req.sheetFor : null,
  };
  return ENG.resolveAction(world, req.actor, req.action, req.target);
}

/** @description Classify one D&D combat or milestone beat for cutaway vs local presentation. */
function classifyDndBeat(event) {
  if (!event || typeof event !== 'object') return beats.classifyCombatBeat(null);
  if (event.outcome && typeof event.outcome === 'object') {
    return beats.classifyOutcomeBeat(event).beat;
  }
  return beats.classifyCombatBeat(event);
}

/** @description Apply SRD 5.1 Level 2-5 progression to one hero sheet. */
function advanceDndProgression(deps, input) {
  const req = input || {};
  const leveling = req.leveling || deps.leveling || { thresholds: {}, level2: {} };
  const opts = req.options || (
    Number.isFinite(Number(req.xp))
      ? { xp: Number(req.xp) }
      : { targetLevel: Number(req.targetLevel) || ((Number(req.sheet && req.sheet.level) || 1) + 1) }
  );
  return ENG.applyLevelUp(req.sheet, leveling, opts);
}

/** @description Evaluate D&D victory or defeat end state across encounter tokens. */
function evaluateDndEndState(input) {
  const tokens = Array.isArray(input) ? input : (input && Array.isArray(input.tokens) ? input.tokens : []);
  const status = ENG.checkEnd({ tokens });
  return {
    resolved: !!status,
    outcome: status || 'ongoing',
  };
}

/** @description Build the D&D 5e SRD rules adapter encapsulating all SRD mechanics. */
function buildDndRulesAdapter(deps) {
  return {
    validateState(input) {
      const req = input || {};
      const context = req.context || {
        scene: req.scene,
        sheets: req.sheets,
        monsters: req.monsters || deps.bestiary || {},
      };
      return stateWriteDecision(req.campaign, req.seats || [], req.sub, req.current, req.proposed, context);
    },
    resolveTurnAction: resolveDndTurnAction,
    classifyBeat: classifyDndBeat,
    advanceProgression: (input) => advanceDndProgression(deps, input),
    evaluateEndState: evaluateDndEndState,
    importCharacter: (input, options) => importCharacter(input, options),
    normalizeSheet: (sheet) => normalizeInternalSheet(sheet),
    pickMonsterAction: (monster, tokens) => ENG.pickMonsterAction(monster, tokens),
    goblinsShouldFlee: (worldOrTokens) => ENG.goblinsShouldFlee(
      Array.isArray(worldOrTokens) ? { tokens: worldOrTokens } : worldOrTokens,
    ),
  };
}

/** @description Build the D&D Dungeon Master folklore narrator adapter. */
function buildDndNarratorAdapter(deps) {
  return {
    async narrateTurn(input) {
      const req = input || {};
      if (deps.dm && typeof deps.dm.dungeonMaster === 'function') {
        return deps.dm.dungeonMaster(req.sub, req.body || req);
      }
      return { ok: false, code: 'DM_OFFLINE', error: 'The Dungeon Master is offline.' };
    },
    describeBeat(beat) {
      if (!beat || typeof beat !== 'object') return '';
      const title = String(beat.title || '').trim();
      const caption = String(beat.caption || '').trim();
      return title && caption ? `${title} — ${caption}` : caption || title;
    },
    voiceProfile: Object.freeze({
      provider: 'google-cloud-tts',
      role: 'dungeon-master',
      style: 'folklore-narrator',
      naturalOnly: true,
    }),
  };
}

/** @description Build the D&D 5e SRD read-only content pack adapter. */
function buildDndContentPack(deps) {
  const adventures = Array.isArray(deps.adventures) ? deps.adventures : [];
  const heroes = Array.isArray(deps.heroes) ? deps.heroes : [];
  const bestiary = deps.bestiary && typeof deps.bestiary === 'object' ? deps.bestiary : {};
  const defaultParty = Array.isArray(deps.defaultParty) ? deps.defaultParty.slice() : [];
  return {
    listAdventures() {
      return adventures.map((adv) => ({
        id: String((adv && adv.id) || ''),
        title: String((adv && adv.title) || ''),
        tagline: String((adv && adv.tagline) || ''),
        sceneCount: Array.isArray(adv && adv.scenes) ? adv.scenes.length : 0,
      }));
    },
    listRoster() {
      return heroes.map((hero) => ({
        id: String((hero && hero.id) || ''),
        name: String((hero && hero.name) || ''),
        class: String((hero && hero.class) || ''),
        level: Number(hero && hero.level) || 1,
      }));
    },
    metadata: {
      license: 'CC-BY-4.0',
      ruleset: 'D&D SRD 5.1',
      monsterCount: Object.keys(bestiary).length,
      maxLevel: 5,
      defaultParty,
    },
  };
}

/**
 * @description Create the D&D 5e SRD GameDefinition ruleset pack for TabletopRuntime.
 * @param {object} [deps] - Loaded content, bestiary, leveling table, and optional DM service.
 * @returns {object} Versioned GameDefinition for D&D 5e SRD.
 */
function createDndRulesetPack(deps) {
  const safeDeps = deps || {};
  return {
    schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
    id: DND_GAME_ID,
    version: safeDeps.version || DND_GAME_VERSION,
    name: 'Dungeons & Dragons 5e (SRD 5.1)',
    description: 'Open CC-BY-4.0 D&D 5e SRD tabletop ruleset with tactical grid combat, spellcasting, Level 1-5 progression, death saves, and AI Dungeon Master narration.',
    capabilities: DND_CAPABILITIES.slice(),
    rulesAdapter: buildDndRulesAdapter(safeDeps),
    narratorAdapter: buildDndNarratorAdapter(safeDeps),
    contentPack: buildDndContentPack(safeDeps),
  };
}

module.exports = {
  DND_GAME_ID,
  DND_GAME_VERSION,
  DND_CAPABILITIES,
  createDndRulesetPack,
};
