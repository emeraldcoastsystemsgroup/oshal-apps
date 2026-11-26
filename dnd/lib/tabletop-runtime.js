/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract game-neutral tabletop runtime with versioned GameDefinition contract, adapter registry, and session/seat/turn/roll/story/media/rewind delegation loops (v0.22.10).
 */

'use strict';

const GAME_DEFINITION_SCHEMA_VERSION = 1;
const RUNTIME_CAPABILITIES = Object.freeze([
  'sessions',
  'seats',
  'turns',
  'shared-rolls',
  'story',
  'media',
  'rewind',
  'replay-export',
  'tactical-grid',
  'progression',
]);
const CORE_CAPABILITY_SET = new Set(RUNTIME_CAPABILITIES);
const GAME_ID_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CAPABILITY_SLUG_RE = /^[a-z][a-z0-9-]{1,31}$/;
const REQUIRED_RULES_METHODS = Object.freeze([
  'validateState',
  'resolveTurnAction',
  'classifyBeat',
  'advanceProgression',
  'evaluateEndState',
]);
const REQUIRED_NARRATOR_METHODS = Object.freeze(['narrateTurn', 'describeBeat']);
const REQUIRED_CONTENT_METHODS = Object.freeze(['listAdventures', 'listRoster']);

/** @description Structured error thrown on invalid runtime contracts or lookups. */
class TabletopRuntimeError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'TabletopRuntimeError';
    this.code = code;
    this.details = details || null;
  }
}

/** @description Recognize a plain non-array object. */
function isPlainObject(value) {
  return !!(value && typeof value === 'object' && !Array.isArray(value));
}

/** @description Validate a required non-empty trimmed string within bounds. */
function requireText(value, minLen, maxLen, code, field) {
  if (typeof value !== 'string') {
    throw new TabletopRuntimeError(code, `${field} must be a string.`, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    throw new TabletopRuntimeError(code, `${field} length must be ${minLen}..${maxLen}.`, { field });
  }
  return trimmed;
}

/** @description Validate required callable methods on an adapter object. */
function requireMethods(adapter, methods, code, label) {
  if (!isPlainObject(adapter)) {
    throw new TabletopRuntimeError(code, `${label} must be an object.`, { label });
  }
  for (const name of methods) {
    if (typeof adapter[name] !== 'function') {
      throw new TabletopRuntimeError(code, `${label}.${name} must be a function.`, { label, method: name });
    }
  }
}

/** @description Validate and freeze declared runtime capabilities. */
function validateCapabilities(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 24) {
    throw new TabletopRuntimeError('INVALID_CAPABILITIES', 'capabilities must be a non-empty array (max 24).');
  }
  const seen = new Set();
  const normalized = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !CAPABILITY_SLUG_RE.test(item)) {
      throw new TabletopRuntimeError('INVALID_CAPABILITIES', `Invalid capability token: ${String(item)}.`);
    }
    if (!seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  }
  if (!normalized.some((cap) => CORE_CAPABILITY_SET.has(cap))) {
    throw new TabletopRuntimeError('INVALID_CAPABILITIES', 'capabilities must declare at least one core runtime capability.');
  }
  return Object.freeze(normalized);
}

/** @description Validate narrator adapter methods and voice descriptor. */
function validateNarratorAdapter(adapter) {
  requireMethods(adapter, REQUIRED_NARRATOR_METHODS, 'INVALID_NARRATOR_ADAPTER', 'narratorAdapter');
  const voice = adapter.voiceProfile;
  if (!(typeof voice === 'function' || isPlainObject(voice))) {
    throw new TabletopRuntimeError('INVALID_NARRATOR_ADAPTER', 'narratorAdapter.voiceProfile must be an object or function.');
  }
}

/** @description Validate content pack methods and metadata object. */
function validateContentPack(pack) {
  requireMethods(pack, REQUIRED_CONTENT_METHODS, 'INVALID_CONTENT_PACK', 'contentPack');
  if (!isPlainObject(pack.metadata)) {
    throw new TabletopRuntimeError('INVALID_CONTENT_PACK', 'contentPack.metadata must be an object.');
  }
}

/**
 * @description Strictly validate and freeze a versioned GameDefinition contract.
 * @param {object} def - Candidate ruleset pack definition.
 * @returns {object} Frozen normalized GameDefinition descriptor.
 */
function validateGameDefinition(def) {
  if (!isPlainObject(def)) {
    throw new TabletopRuntimeError('INVALID_DEFINITION', 'Game definition must be an object.');
  }
  if (def.schemaVersion !== GAME_DEFINITION_SCHEMA_VERSION) {
    throw new TabletopRuntimeError(
      'INVALID_SCHEMA_VERSION',
      `schemaVersion must equal ${GAME_DEFINITION_SCHEMA_VERSION}.`,
    );
  }
  if (typeof def.id !== 'string' || !GAME_ID_RE.test(def.id)) {
    throw new TabletopRuntimeError('INVALID_GAME_ID', 'id must match ^[a-z0-9][a-z0-9-]{1,48}$.');
  }
  if (typeof def.version !== 'string' || !SEMVER_RE.test(def.version)) {
    throw new TabletopRuntimeError('INVALID_GAME_VERSION', 'version must be a valid semantic version.');
  }
  const name = requireText(def.name, 1, 80, 'INVALID_GAME_NAME', 'name');
  const description = requireText(def.description, 1, 400, 'INVALID_GAME_DESCRIPTION', 'description');
  const capabilities = validateCapabilities(def.capabilities);
  requireMethods(def.rulesAdapter, REQUIRED_RULES_METHODS, 'INVALID_RULES_ADAPTER', 'rulesAdapter');
  validateNarratorAdapter(def.narratorAdapter);
  validateContentPack(def.contentPack);
  return Object.freeze({
    schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
    id: def.id,
    version: def.version,
    name,
    description,
    capabilities,
    rulesAdapter: Object.freeze({ ...def.rulesAdapter }),
    narratorAdapter: Object.freeze({ ...def.narratorAdapter }),
    contentPack: Object.freeze({ ...def.contentPack, metadata: Object.freeze({ ...def.contentPack.metadata }) }),
  });
}

/** @description Safely clone plain JSON-compatible metadata values. */
function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  } catch (_error) {
    return null;
  }
}

/** @description Read a safe voice profile summary from a narrator adapter. */
function readVoiceProfile(voiceProfile) {
  const raw = typeof voiceProfile === 'function' ? voiceProfile() : voiceProfile;
  return isPlainObject(raw) ? safeClone(raw) : {};
}

/** @description Build a safe public description of one registered ruleset pack. */
function describeGame(game) {
  const adventures = Array.isArray(game.contentPack.listAdventures()) ? game.contentPack.listAdventures() : [];
  const roster = Array.isArray(game.contentPack.listRoster()) ? game.contentPack.listRoster() : [];
  return {
    id: game.id,
    version: game.version,
    name: game.name,
    description: game.description,
    capabilities: game.capabilities.slice(),
    adapters: {
      rules: Object.keys(game.rulesAdapter).sort(),
      narrator: {
        methods: REQUIRED_NARRATOR_METHODS.slice(),
        voiceProfile: readVoiceProfile(game.narratorAdapter.voiceProfile),
      },
      content: {
        methods: REQUIRED_CONTENT_METHODS.slice(),
        metadata: safeClone(game.contentPack.metadata) || {},
      },
    },
    contentSummary: {
      adventureCount: adventures.length,
      rosterCount: roster.length,
      adventures: adventures.map((entry) => ({
        id: String((entry && entry.id) || ''),
        title: String((entry && entry.title) || ''),
      })),
    },
  };
}

/** @description Resolve an injected service method or throw a structured error. */
function requireServiceMethod(services, group, method) {
  const target = services && services[group];
  if (!target || typeof target[method] !== 'function') {
    throw new TabletopRuntimeError('SERVICE_UNAVAILABLE', `Runtime service ${group}.${method} is not configured.`);
  }
  return target[method].bind(target);
}

/** @description Build the session and seat delegation facades. */
function buildSessionAndSeatLoops(services, resolveGame) {
  const sessions = {
    create: (sub, body) => requireServiceMethod(services, 'campaign', 'createCampaign')(sub, body),
    access: (sub, sessionId) => requireServiceMethod(services, 'campaign', 'access')(sub, sessionId),
    list: (sub) => requireServiceMethod(services, 'campaign', 'listCampaigns')(sub),
    loadState: (sub, sessionId) => requireServiceMethod(services, 'campaign', 'loadState')(sub, sessionId),
    saveState: (sub, body) => requireServiceMethod(services, 'campaign', 'saveState')(sub, body),
    remove: (sub, body) => requireServiceMethod(services, 'campaign', 'deleteCampaign')(sub, body),
    validateState: (input, gameId) => resolveGame(gameId).rulesAdapter.validateState(input),
  };
  const seats = {
    claim: (sub, displayName, body) => requireServiceMethod(services, 'campaign', 'claimHero')(sub, displayName, body),
    join: (sub, displayName, body) => requireServiceMethod(services, 'campaign', 'joinCampaign')(sub, displayName, body),
    leave: (sub, body) => requireServiceMethod(services, 'campaign', 'leaveCampaign')(sub, body),
    release: (sub, body) => requireServiceMethod(services, 'campaign', 'releaseGuestSeat')(sub, body),
    check: (sub, sessionId) => requireServiceMethod(services, 'campaign', 'access')(sub, sessionId),
  };
  return { sessions, seats };
}

/** @description Build turn, shared-roll, and story delegation loops. */
function buildPlayLoops(services, resolveGame) {
  const turns = {
    resolve: (input, gameId) => {
      const game = resolveGame(gameId);
      const outcome = game.rulesAdapter.resolveTurnAction(input);
      const tokens = (input && input.tokens) || (outcome && outcome.tokens) || [];
      const endState = game.rulesAdapter.evaluateEndState({ tokens, input, outcome });
      const beat = game.rulesAdapter.classifyBeat({ ...(input || {}), outcome, endState });
      return { gameId: game.id, outcome, endState, beat };
    },
  };
  const rolls = {
    normalize: (payload) => requireServiceMethod(services, 'rolls', 'normalizeRollPayload')(payload),
    isValid: (payload) => requireServiceMethod(services, 'rolls', 'isRollPayload')(payload),
    rollShared: (sub, body) => requireServiceMethod(services, 'rolls', 'rollShared')(sub, body),
  };
  const story = {
    narrate: (input, gameId) => resolveGame(gameId).narratorAdapter.narrateTurn(input),
    describeBeat: (beat, gameId) => resolveGame(gameId).narratorAdapter.describeBeat(beat),
  };
  return { turns, rolls, story };
}

/** @description Build media cutaway and timeline/rewind delegation loops. */
function buildMediaAndRewindLoops(services, resolveGame) {
  const media = {
    classifyBeat: (event, gameId) => resolveGame(gameId).rulesAdapter.classifyBeat(event),
    budget: (sub, sessionId, cap) => requireServiceMethod(services, 'media', 'readCutawayBudget')(sub, sessionId, cap),
    budgetSummary: (sessionId, cap) => requireServiceMethod(services, 'media', 'budgetSummary')(sessionId, cap),
    generate: async (sub, body, gameId) => {
      const beat = resolveGame(gameId).rulesAdapter.classifyBeat((body && body.beat) || body);
      if (beat && beat.tier === 'local') return { ok: true, localOnly: true, beat };
      const generated = await requireServiceMethod(services, 'media', 'generateCutaway')(sub, body);
      return { ...generated, beat };
    },
  };
  const rewind = {
    saveSnapshot: (sub, body) => requireServiceMethod(services, 'timeline', 'saveSnapshot')(sub, body),
    listSnapshots: (sub, sessionId) => requireServiceMethod(services, 'timeline', 'listSnapshots')(sub, sessionId),
    playback: (sub, sessionId) => requireServiceMethod(services, 'timeline', 'playback')(sub, sessionId),
    restoreSnapshot: (sub, body) => requireServiceMethod(services, 'timeline', 'restoreSnapshot')(sub, body),
    exportReplay: (feed, format, opts) => requireServiceMethod(services, 'timeline', 'exportReplay')(feed, format, opts),
    advanceScene: (sub, body) => requireServiceMethod(services, 'timeline', 'advance')(sub, body),
    advanceProgression: (input, gameId) => resolveGame(gameId).rulesAdapter.advanceProgression(input),
  };
  return { media, rewind };
}

/** @description Manage registered GameDefinitions and safe read-only descriptions. */
function createGameRegistry(initialDefaultId) {
  const games = new Map();
  let defaultGameId = initialDefaultId || null;

  function registerGame(def, registerOpts) {
    const validated = validateGameDefinition(def);
    const replace = !!(registerOpts && registerOpts.replace);
    if (games.has(validated.id) && !replace) {
      throw new TabletopRuntimeError('DUPLICATE_GAME', `Game "${validated.id}" is already registered.`, { id: validated.id });
    }
    games.set(validated.id, validated);
    if (!defaultGameId) defaultGameId = validated.id;
    return validated;
  }

  function getGame(id) {
    const targetId = id || defaultGameId;
    const game = targetId ? games.get(targetId) : null;
    if (!game) {
      throw new TabletopRuntimeError('GAME_NOT_FOUND', `Unknown game definition: ${String(targetId || '')}.`, { id: targetId || null });
    }
    return game;
  }

  function listGames() {
    return Object.freeze(Array.from(games.values()));
  }

  function describeRuntime(id) {
    const all = listGames();
    const active = id ? getGame(id) : (defaultGameId && games.get(defaultGameId)) || all[0] || null;
    const summary = {
      schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
      activeGameId: active ? active.id : null,
      games: all.map(describeGame),
    };
    if (id && active) summary.activeGame = describeGame(active);
    return summary;
  }

  return { registerGame, getGame, listGames, describeRuntime };
}

/**
 * @description Create a game-neutral TabletopRuntime registry and loop facade.
 * @param {object} [options] - Optional defaultGameId and injected platform services.
 * @returns {object} Runtime registry and delegation loops.
 */
function createTabletopRuntime(options) {
  const config = options || {};
  const services = config.services || {};
  const registry = createGameRegistry(config.defaultGameId);
  const { sessions, seats } = buildSessionAndSeatLoops(services, registry.getGame);
  const { turns, rolls, story } = buildPlayLoops(services, registry.getGame);
  const { media, rewind } = buildMediaAndRewindLoops(services, registry.getGame);
  return Object.freeze({
    schemaVersion: GAME_DEFINITION_SCHEMA_VERSION,
    ...registry,
    sessions, seats, turns, rolls, story, media, rewind,
  });
}

module.exports = {
  GAME_DEFINITION_SCHEMA_VERSION,
  RUNTIME_CAPABILITIES,
  TabletopRuntimeError,
  validateGameDefinition,
  createTabletopRuntime,
};
