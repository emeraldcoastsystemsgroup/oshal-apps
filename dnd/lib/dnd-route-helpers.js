/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:49:12 | roger.murphy@emeraldcoastsystemsgroup.com   | Extract shared HTTP, campaign DTO, character import, hashing, inventory, scene, transaction, and tactical-prompt helpers from the D&D route factory.
 * 2026-07-21 20:09:06 | roger.murphy@emeraldcoastsystemsgroup.com   | Preserve the full token-status and signed-axis constraints required to keep all Dungeon Master prompt modes aligned with the persisted board.
 * 2026-07-23 00:39:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Resolve saved generic tokens through the authored cast so names, roles, personalities, and continuity hooks remain distinct in every DM prompt.
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carry the selected adventure identity into every newly built scene board.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  CharacterImportError,
  LIMITS: CHARACTER_LIMITS,
  normalizeInternalSheet,
  importCharacter,
  importDndBeyondPdf,
} = require('./character-import');

/** @description Read JSON data without letting a damaged optional asset stop route activation. */
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_err) { return null; }
}

/** @description Write one JSON response with the package's stable content type. */
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

/** @description Serve only a file resolved beneath the package root. */
function serveFile(res, root, rel, contentType, noStore) {
  const abs = path.join(root, rel);
  if (!abs.startsWith(root)) { sendJson(res, 400, { error: 'bad path' }); return; }
  fs.readFile(abs, (err, buf) => {
    if (err) { sendJson(res, 404, { error: 'not found', rel }); return; }
    res.statusCode = 200;
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', noStore ? 'no-store' : 'public, max-age=86400');
    res.end(buf);
  });
}

/** @description Resolve the authenticated OIDC subject used for all data scoping. */
function resolveSub(req) {
  const user = (req.oidc && req.oidc.user) || {};
  return user.sub || user.oid || null;
}

/** @description Resolve a non-sensitive table display name from OIDC claims. */
function resolveName(req) {
  const user = (req.oidc && req.oidc.user) || {};
  return user.name || user.nickname || user.email || 'Adventurer';
}

/** @description Read a JSON request while tolerating an upstream body parser. */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_err) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/** @description Read a bounded raw upload that intentionally bypasses JSON middleware. */
async function readBytes(req, maxBytes) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw new CharacterImportError('INPUT_TOO_LARGE', `Character file exceeds the ${maxBytes}-byte limit.`);
    return req.body;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) tooLarge = true;
      else if (!tooLarge) chunks.push(bytes);
    });
    req.on('end', () => tooLarge
      ? reject(new CharacterImportError('INPUT_TOO_LARGE', `Character file exceeds the ${maxBytes}-byte limit.`))
      : resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new CharacterImportError('INVALID_INPUT', 'The character file upload was interrupted.')));
  });
}

/** @description Parse a bounded local PDF or JSON upload into a normalized preview sheet. */
async function importCharacterFile(req, parsedUrl) {
  const filename = String(parsedUrl.searchParams.get('filename') || '').slice(0, 160);
  const lower = filename.toLowerCase();
  if (!lower.endsWith('.pdf') && !lower.endsWith('.json')) {
    throw new CharacterImportError('UNSUPPORTED_FORMAT', 'Choose a .pdf or .json character file.');
  }
  const bytes = await readBytes(req, CHARACTER_LIMITS.PDF_BYTES);
  if (!bytes.length) throw new CharacterImportError('INVALID_INPUT', 'The character file is empty.');
  return lower.endsWith('.pdf') ? importDndBeyondPdf(bytes) : importCharacter(bytes.toString('utf8'), { format: 'auto' });
}

/** @description Normalize exactly four distinct bundled or imported campaign heroes. */
function campaignParty(body, bundledHeroes, fallbackParty) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (input.customCharacters !== undefined && !Array.isArray(input.customCharacters)) {
    throw new CharacterImportError('INVALID_INPUT', 'customCharacters must be an array.');
  }
  const customRows = input.customCharacters || [];
  if (customRows.length > 4) throw new CharacterImportError('TOO_MANY_ENTRIES', 'A campaign may include at most four imported characters.');
  const available = new Map((bundledHeroes || []).map((hero) => [hero.id, hero]));
  const bundledIds = new Set(available.keys());
  for (const raw of customRows) {
    const sheet = normalizeInternalSheet(raw);
    if (bundledIds.has(sheet.id)) throw new CharacterImportError('DUPLICATE_CHARACTER', `Imported character id "${sheet.id}" conflicts with a bundled hero.`);
    if (available.has(sheet.id)) throw new CharacterImportError('DUPLICATE_CHARACTER', `Imported character id "${sheet.id}" appears more than once.`);
    available.set(sheet.id, sheet);
  }
  const requested = Array.isArray(input.party) && input.party.length ? input.party : fallbackParty;
  const slugs = (requested || []).map((slug) => String(slug || ''));
  if (slugs.length !== 4 || new Set(slugs).size !== 4) throw new CharacterImportError('INVALID_PARTY', 'Choose exactly four different heroes for this quest.');
  const chosen = slugs.map((slug) => available.get(slug));
  if (chosen.some((hero) => !hero)) throw new CharacterImportError('INVALID_PARTY', 'One or more selected heroes are not available.');
  return chosen;
}

/** @description Project campaign fields without exposing the owner's OIDC subject. */
function campaignDto(row) {
  if (!row) return null;
  return {
    campaign_id: row.campaign_id, name: row.name, adventure_id: row.adventure_id,
    status: row.status, join_code: row.join_code || null, created_at: row.created_at,
    updated_at: row.updated_at, is_owner: row.is_owner === true,
  };
}

/** @description Project the compact fields needed by one game-library card. */
function campaignSummaryDto(row) {
  return {
    ...campaignDto(row), my_character: row.my_character || null, mode: row.mode || null,
    scene_id: row.scene_id || null, round: Number(row.round) || 0, rev: Number(row.rev) || 0,
    player_count: Number(row.player_count) || 0, last_played_at: row.last_played_at || row.updated_at,
  };
}

/** @description Project one reusable private character row without ownership fields. */
function characterDto(row) {
  if (!row) return null;
  let sheet = row.sheet;
  if (typeof sheet === 'string') { try { sheet = JSON.parse(sheet); } catch (_err) { sheet = null; } }
  return {
    character_id: row.character_id, slug: row.slug, name: row.name, sheet,
    xp: Number(row.xp) || 0, level: Number(row.level) || 1,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

/** @description Validate private character UUIDs before constructing a uuid-array query. */
function savedCharacterIdsOf(body) {
  const value = body && body.savedCharacterIds;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CharacterImportError('INVALID_INPUT', 'savedCharacterIds must be an array.');
  if (value.length > 4) throw new CharacterImportError('TOO_MANY_ENTRIES', 'A campaign may use at most four saved characters.');
  const ids = value.map((id) => String(id || '').trim().toLowerCase());
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (ids.some((id) => !uuid.test(id))) throw new CharacterImportError('INVALID_CHARACTER_ID', 'One or more saved character ids are invalid.');
  if (new Set(ids).size !== ids.length) throw new CharacterImportError('DUPLICATE_CHARACTER', 'The same saved character was selected more than once.');
  return ids;
}

/** @description Parse a JSONB value returned as either an object or a test-double string. */
function parsedJson(value, fallback) {
  if (typeof value !== 'string') return value == null ? fallback : value;
  try { return JSON.parse(value); } catch (_err) { return fallback; }
}

/** @description Run production work atomically while retaining lightweight legacy test pools. */
async function withTransaction(pool, work) {
  const transactional = !!(pool && typeof pool.connect === 'function');
  const client = transactional ? await pool.connect() : pool;
  try {
    if (transactional) await client.query('BEGIN');
    const value = await work(client, transactional);
    if (transactional) await client.query('COMMIT');
    return value;
  } catch (error) {
    if (transactional) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (transactional) client.release();
  }
}

/** @description Deterministically serialize JSON so equivalent sheet maps hash identically. */
function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',') + '}';
}

/** @description Create a schema-free revision fingerprint for persisted character sheets. */
function sheetsRevFor(sheets) {
  return crypto.createHash('sha256').update(stableJson(sheets || {})).digest('hex');
}

/** @description Resolve the active token from the authoritative stored board. */
function activeTokenFor(state) {
  if (!state || !Array.isArray(state.tokens) || !Array.isArray(state.order)) return null;
  return state.tokens.find((token) => token.id === state.order[state.turnIndex]) || null;
}

/** @description Keep token labels single-line and bounded inside DM prompts. */
function promptTokenLabel(token) {
  return String((token && (token.name || token.slug || token.id)) || 'Unknown token')
    .replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Unknown token';
}

/** @description Find the scene-authored identity corresponding to one persisted board token. */
function sceneTokenDefinition(scene, token) {
  if (!scene || !token) return null;
  const definitions = token.kind === 'monster' ? scene.monsters : token.kind === 'prop' ? scene.props : [];
  if (!Array.isArray(definitions)) return null;
  return definitions.find((entry) => String(entry.instanceId || entry.id) === String(token.id)) || null;
}

/** @description Overlay authored cast identity onto old saved tokens without mutating campaign state. */
function identityToken(scene, token) {
  const definition = sceneTokenDefinition(scene, token);
  if (!definition) return token;
  return {
    ...token,
    name: definition.name || token.name,
    role: definition.role || token.role,
    personality: definition.personality || token.personality,
    storyHook: definition.storyHook || token.storyHook,
  };
}

/** @description Give the DM bounded characterization context while keeping latent hooks unrevealed. */
function characterIdentityLine(token) {
  const role = String(token.role || (token.kind === 'prop' ? 'Scene character' : 'Creature')).trim();
  const personality = String(token.personality || 'Responds according to the established scene.').trim();
  const hook = String(token.storyHook || 'No additional continuity hook.').trim();
  return `- ${promptTokenLabel(token)} — ${role}. Manner: ${personality} Continuity hook: ${hook}`;
}

/** @description Classify whether a stored token may still participate in the scene. */
function tacticalStatus(token) {
  if (!token || typeof token !== 'object') return 'UNKNOWN';
  if (token.fled === true) return 'FLED';
  const hasHp = token.hp !== null && token.hp !== undefined && Number.isFinite(Number(token.hp));
  if (token.kind === 'pc') {
    if (token.dead === true) return 'DEAD';
    if (token.downed === true || (hasHp && Number(token.hp) <= 0)) return token.stable === true ? 'STABLE' : 'DOWN/UNSTABLE';
    return 'LIVING';
  }
  if (token.kind !== 'prop' && (token.dead === true || (hasHp && Number(token.hp) <= 0))) return 'DEFEATED';
  return token.kind === 'prop' ? 'PRESENT' : 'LIVING';
}

/** @description Name the visually dominant screen direction for one signed grid delta. */
function primaryGridDirection(dx, dy) {
  if (!dx && !dy) return 'SAME SQUARE';
  const horizontal = dx > 0 ? 'EAST/RIGHT' : 'WEST/LEFT';
  const vertical = dy > 0 ? 'SOUTH/BOTTOM' : 'NORTH/TOP';
  if (!dy || Math.abs(dx) >= Math.abs(dy) * 2) return horizontal;
  if (!dx || Math.abs(dy) >= Math.abs(dx) * 2) return vertical;
  return `${vertical}-${horizontal}`;
}

/** @description Describe one target relative to an observer without hiding either signed axis. */
function relativeGridPosition(observer, target, unitFeet) {
  const ox = Number(observer && observer.x), oy = Number(observer && observer.y);
  const tx = Number(target && target.x), ty = Number(target && target.y);
  if (![ox, oy, tx, ty].every(Number.isFinite)) return null;
  const dx = tx - ox, dy = ty - oy;
  const squareWord = (number) => Math.abs(number) === 1 ? 'square' : 'squares';
  const offsets = [];
  offsets.push(dx ? `${Math.abs(dx)} ${squareWord(dx)} ${dx > 0 ? 'east/right (+x)' : 'west/left (-x)'}` : 'the same x column');
  offsets.push(dy ? `${Math.abs(dy)} ${squareWord(dy)} ${dy > 0 ? 'south/bottom (+y)' : 'north/top (-y)'}` : 'the same y row');
  const feet = Math.max(Math.abs(dx), Math.abs(dy)) * (Number(unitFeet) > 0 ? Number(unitFeet) : 5);
  return `PRIMARY ${primaryGridDirection(dx, dy)}; exact offset: ${offsets.join(' and ')}; board distance ${feet} ft`;
}

/** @description Build one authoritative tactical token line for the DM prompt. */
function tacticalTokenLine(token) {
  const status = tacticalStatus(token);
  const x = Number(token.x), y = Number(token.y);
  const past = ['DEFEATED', 'DEAD', 'FLED'].includes(status) ? 'last recorded ' : '';
  const location = Number.isFinite(x) && Number.isFinite(y) ? `${past}grid (x=${x}, y=${y})` : 'no recorded grid square';
  const hp = token.kind !== 'prop' && Number.isFinite(Number(token.hp))
    ? `, HP ${Number(token.hp)}/${Number.isFinite(Number(token.maxHp)) ? Number(token.maxHp) : '?'}` : '';
  const warnings = {
    DEFEATED: '; out of play - do not narrate it as alive, moving, attacking, or returning',
    DEAD: '; out of play - do not narrate it as alive, moving, attacking, or returning',
    FLED: '; left the battlefield - do not narrate it as present or acting',
    'DOWN/UNSTABLE': '; remains visible on the map but is unconscious, may only make a death save on its turn, and is not a valid conscious monster target',
    STABLE: '; remains visible on the map but is unconscious, skips turns until healed, and is not a valid conscious monster target',
  };
  const role = token.role ? ` — ${String(token.role).replace(/[\r\n|]+/g, ' ').slice(0, 60)}` : '';
  return `- ${promptTokenLabel(token)}${role} [${String(token.kind || 'token').toUpperCase()}]: ${status}${hp}, ${location}${warnings[status] || ''}.`;
}

/** @description Convert the persisted encounter grid into hard spatial facts for DM narration. */
function buildSpatialBrief(state, scene) {
  const tokens = state && Array.isArray(state.tokens) ? state.tokens.filter(Boolean).map((token) => identityToken(scene, token)) : [];
  const unitFeet = Number(scene && scene.grid && scene.grid.unitFeet) > 0 ? Number(scene.grid.unitFeet) : 5;
  const width = Number(scene && scene.grid && scene.grid.w), height = Number(scene && scene.grid && scene.grid.h);
  const gridSize = Number.isFinite(width) && Number.isFinite(height) ? `${width} columns x ${height} rows, ${unitFeet} ft per square.` : `${unitFeet} ft per square.`;
  const active = activeTokenFor({ ...state, tokens });
  const activeLine = active ? `${promptTokenLabel(active)} (${String(active.kind || 'token').toUpperCase()}, ${tacticalStatus(active)}) at (x=${Number(active.x)}, y=${Number(active.y)}).` : 'No active token is recorded.';
  const livingHeroes = tokens.filter((token) => token.kind === 'pc' && tacticalStatus(token) === 'LIVING');
  const targets = tokens.filter((token) => token.kind !== 'pc' && ['LIVING', 'PRESENT'].includes(tacticalStatus(token)));
  const relativeLines = [];
  for (const hero of livingHeroes) for (const target of targets) {
    const relative = relativeGridPosition(hero, target, unitFeet);
    if (relative) relativeLines.push(`- From ${promptTokenLabel(hero)} to ${promptTokenLabel(target)}: ${relative}.`);
  }
  return `\n\nAUTHORITATIVE TACTICAL MAP (hard facts; never contradict):
SCREEN COMPASS: right/east = +x; left/west = -x; top/north = -y; bottom/south = +y.
GRID: ${gridSize}
BOARD: mode ${String((state && state.mode) || 'unknown').toUpperCase()}, round ${Number(state && state.round) || 0}. ACTIVE TURN: ${activeLine}
TOKEN STATE (from the persisted board right now):
${tokens.length ? tokens.map(tacticalTokenLine).join('\n') : '- No tokens are recorded.'}
CHARACTER IDENTITIES (names are identities; roles are descriptions and must never be used as names):
${tokens.filter((token) => token.kind !== 'pc').length ? tokens.filter((token) => token.kind !== 'pc').map(characterIdentityLine).join('\n') : '- No non-player cast is recorded.'}
IDENTITY CONSTRAINT: Use these names consistently. Let manner shape word choice and behavior. Use continuity hooks only when the current fiction or an action earns them; never reveal a hidden hook for free.
RELATIVE POSITIONS (each target is relative to the named living hero; board distance uses the game grid):
${relativeLines.length ? relativeLines.join('\n') : '- No living hero-to-target relationships are currently available.'}
HARD NARRATION CONSTRAINT: These signed offsets, PRIMARY directions, and token statuses override scene prose, the story log, player wording, and combat-result wording. When using one compass direction, use the listed PRIMARY direction. Never reverse an axis or invent a direction. If a direction is not grounded above, omit it instead of guessing. DEAD, DEFEATED, and FLED tokens cannot act, move, speak, attack, or reappear unless a later authoritative board state marks them LIVING. DOWN/UNSTABLE and STABLE heroes remain visible on the map but are unconscious and are not valid conscious monster targets; only an unstable downed hero may take a death-save turn.`;
}

/** @description Shape an optimistic-concurrency failure with the authoritative board. */
function revConflict(row, error) {
  return { ok: false, code: 'REV_CONFLICT', conflict: true, error: error || 'The table moved before your action landed. The latest board has been restored.', rev: row ? Number(row.rev) : 0, state: row ? row.state : null };
}

/** @description Append a newly granted weapon without replacing existing inventory metadata. */
function inventoryWithLootWeapon(inventory, action) {
  const current = Array.isArray(inventory) ? { items: inventory } : inventory && typeof inventory === 'object' ? inventory : {};
  const items = Array.isArray(current.items) ? current.items : [];
  return { ...current, items: items.concat({ id: action.id, name: action.name, category: 'weapon', quantity: 1, equipped: false, actionId: action.id }) };
}

/** @description Backfill bundled starting gear without replacing live sheet fields or loot. */
function mergeLegacyInventory(sheet, bundled) {
  if (!sheet || typeof sheet !== 'object' || !bundled || !bundled.inventory) return sheet;
  const base = bundled.inventory || {};
  const current = Array.isArray(sheet.inventory) ? { items: sheet.inventory } : sheet.inventory || {};
  const items = Array.isArray(current.items) ? current.items.slice() : [];
  const identity = (item) => [item && item.id, item && item.actionId, item && item.name && String(item.name).toLowerCase()].filter(Boolean);
  for (const item of Array.isArray(base.items) ? base.items : []) {
    const keys = identity(item);
    if (!items.some((existing) => identity(existing).some((key) => keys.includes(key)))) items.push(JSON.parse(JSON.stringify(item)));
  }
  const baseCoins = base.coins && typeof base.coins === 'object' ? base.coins : {};
  const coins = current.coins && typeof current.coins === 'object' ? current.coins : {};
  return { ...sheet, inventory: { ...base, ...current, items, coins: { ...baseCoins, ...coins } } };
}

/** @description Build one scene board from campaign hero sheets and bestiary records. */
function buildSceneState(scene, sheets, monstersRef, adventureId) {
  const seats = scene.partyStart || [];
  const tokens = sheets.map((pc, index) => {
    const at = seats[index] || seats[0] || { x: 0, y: 0 };
    return {
      id: pc.id, kind: 'pc', slug: pc.id, name: pc.name, x: at.x, y: at.y,
      hp: pc.maxHp, maxHp: pc.maxHp, ac: pc.ac, speed: pc.speed,
      color: (pc.token && pc.token.color) || '#3b82f6', glyph: (pc.token && pc.token.glyph) || '@',
      slots: pc.slots ? JSON.parse(JSON.stringify(pc.slots)) : {}, initiative: pc.initiative || 0,
    };
  });
  for (const prop of scene.props || []) tokens.push({
    id: prop.id, kind: 'prop', name: prop.name, role: prop.role,
    personality: prop.personality, storyHook: prop.storyHook,
    x: prop.x, y: prop.y, glyph: prop.glyph || '•', color: prop.color || '#94a3b8', hp: 1, maxHp: 1,
  });
  for (const monster of scene.monsters || []) {
    const ref = monstersRef[monster.ref];
    if (!ref) continue;
    tokens.push({
      id: monster.instanceId, kind: 'monster', ref: monster.ref, name: monster.name || ref.name,
      role: monster.role, personality: monster.personality, storyHook: monster.storyHook,
      x: monster.x, y: monster.y, hp: ref.maxHp, maxHp: ref.maxHp, ac: ref.ac, speed: ref.speed,
      color: '#ef4444', glyph: '☠', hidden: !!monster.hidden, initiative: ref.initiative || 0,
    });
  }
  return {
    adventureId: adventureId || 'goblin-ambush',
    sceneId: scene.id, mode: 'setup', round: 0, turnIndex: 0, order: [], tokens,
  };
}

module.exports = {
  activeTokenFor, buildSceneState, buildSpatialBrief, campaignDto, campaignParty,
  campaignSummaryDto, characterDto, importCharacterFile, inventoryWithLootWeapon,
  mergeLegacyInventory, parsedJson, primaryGridDirection, readBody, readJson,
  relativeGridPosition, resolveName, resolveSub, revConflict, savedCharacterIdsOf,
  sendJson, serveFile, sheetsRevFor, stableJson, tacticalStatus, withTransaction,
};
