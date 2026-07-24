/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:49:12 | roger.murphy@emeraldcoastsystemsgroup.com   | Extract campaign access, membership, character-library, encounter persistence, archive, and synchronization operations from the HTTP route factory.
 * 2026-07-21 21:56:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Persist validated v1 roll events with idempotent event IDs and return them through state, archive, and sync reads without changing legacy text-only entries.
 * 2026-07-21 22:13:13 | roger.murphy@emeraldcoastsystemsgroup.com   | Serialize lobby joins under campaign and encounter locks so in-progress or full four-seat tables cannot strand another participant.
 * 2026-07-21 22:16:54 | roger.murphy@emeraldcoastsystemsgroup.com   | Invalidate stale setup writes when a new seat joins so a concurrent host cannot start past an unseen participant.
 * 2026-07-21 22:36:06 | roger.murphy@emeraldcoastsystemsgroup.com   | Serialize hero claims with encounter start, reject late claim changes, and invalidate stale Start revisions only when the effective claim changes.
 * 2026-07-21 23:07:08 | roger.murphy@emeraldcoastsystemsgroup.com   | Let only the host transactionally release an opaque guest seat, bump the board revision, and return the abandoned hero to AI control.
 * 2026-07-21 23:12:50 | roger.murphy@emeraldcoastsystemsgroup.com   | Lock archive writes to their presentation-gate branch so a late pre-rewind request cannot repopulate abandoned history.
 * 2026-07-22 01:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Retain archived campaigns in My Games and mark terminal persisted boards archived without deleting membership, characters, state, or history.
 * 2026-07-23 01:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Persist an exact permanent checkpoint in the same transaction that advances into every combat round.
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Create new tables from an allowlisted adventure while preserving the selected story identity in encounter state.
 */

'use strict';

const crypto = require('crypto');
const { CharacterImportError, normalizeInternalSheet } = require('./character-import');
const { captureRoundBoundary } = require('./dnd-checkpoint-store');
const { stateWriteDecision, stripTokenPrivateFields } = require('./multiplayer-guard');
const { normalizeRollPayload } = require('./dnd-roll-payload');
const {
  buildSceneState, campaignDto, campaignParty, campaignSummaryDto, characterDto,
  parsedJson, revConflict, savedCharacterIdsOf, sheetsRevFor, withTransaction,
} = require('./dnd-route-helpers');

/** @description Return an internal owner-or-member campaign row for authorization. */
async function access(deps, sub, campaignId) {
  const result = await deps.pool.query(
    `SELECT c.*, (c.user_sub = $2) AS is_owner FROM dnd_campaigns c
      WHERE c.campaign_id = $1
        AND (c.user_sub = $2 OR EXISTS (
              SELECT 1 FROM dnd_players p WHERE p.campaign_id = c.campaign_id AND p.user_sub = $2))`,
    [campaignId, sub]
  );
  return result.rows[0] || null;
}

/** @description Return the caller's latest active campaign for TV/backward compatibility. */
async function latestCampaign(deps, sub) {
  const result = await deps.pool.query(
    `SELECT c.*, (c.user_sub = $1) AS is_owner FROM dnd_campaigns c
      WHERE c.status = 'active'
        AND (c.user_sub = $1 OR EXISTS (
              SELECT 1 FROM dnd_players p WHERE p.campaign_id = c.campaign_id AND p.user_sub = $1))
      ORDER BY c.updated_at DESC LIMIT 1`,
    [sub]
  );
  return result.rows[0] || null;
}

/** @description List every retained campaign as a sanitized game-library summary. */
async function listCampaigns(deps, sub) {
  const result = await deps.pool.query(
    `SELECT c.campaign_id, c.name, c.adventure_id, c.status, c.join_code,
            c.created_at, c.updated_at, (c.user_sub = $1) AS is_owner,
            me.character_slug AS my_character,
            e.state->>'mode' AS mode, e.state->>'sceneId' AS scene_id,
            COALESCE(e.round, 0) AS round, COALESCE(e.rev, 0) AS rev,
            1 + (SELECT COUNT(*)::int FROM dnd_players seated
                  WHERE seated.campaign_id = c.campaign_id
                    AND seated.user_sub <> c.user_sub) AS player_count,
            GREATEST(c.updated_at, COALESCE(e.updated_at, c.updated_at)) AS last_played_at
       FROM dnd_campaigns c
       LEFT JOIN dnd_players me ON me.campaign_id = c.campaign_id AND me.user_sub = $1
       LEFT JOIN dnd_encounters e ON e.campaign_id = c.campaign_id
      WHERE c.user_sub = $1 OR me.player_id IS NOT NULL
      ORDER BY last_played_at DESC, c.created_at DESC, c.campaign_id`,
    [sub]
  );
  return { ok: true, campaigns: result.rows.map(campaignSummaryDto) };
}

/** @description Read raw table seats for presentation and write authorization. */
async function seatsOf(deps, campaignId, db) {
  const result = await (db || deps.pool).query(
    'SELECT user_sub, display_name, character_slug FROM dnd_players WHERE campaign_id = $1 ORDER BY joined_at',
    [campaignId]
  );
  return result.rows;
}

/** @description Derive a stable opaque handle without exposing an account subject. */
function seatKeyFor(campaignId, userSub) {
  return crypto.createHash('sha256')
    .update(`dnd-seat:v1\0${String(campaignId)}\0${String(userSub)}`)
    .digest('hex').slice(0, 24);
}

/** @description Project locked internal seat rows into safe caller-relative DTOs. */
function playerDtos(seats, campaignId, sub) {
  return (seats || []).map((player) => ({
    seatKey: seatKeyFor(campaignId, player.user_sub),
    name: player.display_name,
    slug: player.character_slug,
    me: player.user_sub === sub,
  }));
}

/** @description Project table seats with a caller-relative me flag. */
async function playersOf(deps, campaignId, sub) {
  const seats = await seatsOf(deps, campaignId);
  return playerDtos(seats, campaignId, sub);
}

/** @description Allocate the next story sequence number on the supplied database client. */
async function nextSeq(_deps, db, campaignId) {
  const result = await db.query('SELECT COALESCE(MAX(seq),0)+1 AS n FROM dnd_archive WHERE campaign_id=$1', [campaignId]);
  return Number(result.rows[0].n);
}

/** @description Reject malformed roll details while preserving absent legacy payloads. */
function validatedArchivePayload(payload) {
  if (payload === undefined || payload === null) return null;
  const normalized = normalizeRollPayload(payload);
  if (!normalized) throw new CharacterImportError(
    'INVALID_ROLL_PAYLOAD', 'Combat roll details are invalid.', 'payload',
  );
  return normalized;
}

/** @description Return the stable public shape of one archive entry. */
function archiveEntry(seq, kind, content, payload) {
  const entry = { seq: Number(seq), kind, content };
  const normalized = payload && normalizeRollPayload(parsedJson(payload, payload));
  if (normalized) entry.payload = normalized;
  return entry;
}

/** @description Reuse an already-saved event so network retries never duplicate dice. */
async function existingRollEvent(db, campaignId, payload) {
  if (!payload) return null;
  const result = await db.query(
    `SELECT seq, kind, content, payload FROM dnd_archive
      WHERE campaign_id=$1 AND payload->>'eventId'=$2 ORDER BY seq ASC LIMIT 1`,
    [campaignId, payload.eventId]
  );
  const row = result.rows[0];
  return row ? archiveEntry(row.seq, row.kind, row.content, row.payload) : null;
}

/** @description Append one story beat while optionally holding the campaign advisory lock. */
async function appendArchive(deps, db, sub, campaignId, kind, content, lock, rawPayload) {
  const payload = validatedArchivePayload(rawPayload);
  if (lock) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('dnd-archive:' || $1::text, 0))", [campaignId]);
  }
  const existing = await existingRollEvent(db, campaignId, payload);
  if (existing) return existing;
  const seq = await nextSeq(deps, db, campaignId);
  await db.query(
    'INSERT INTO dnd_archive (user_sub, campaign_id, seq, kind, content, payload) VALUES ($1,$2,$3,$4,$5,$6)',
    [sub, campaignId, seq, kind, content, payload ? JSON.stringify(payload) : null]
  );
  return archiveEntry(seq, kind, content, payload);
}

/** @description Append one story beat atomically across concurrent presenters. */
async function archiveTimelineCurrent(db, transactional, campaignId, timelineId) {
  if (timelineId === undefined || timelineId === null) return true;
  const candidate = String(timelineId);
  if (candidate.length > 160) return false;
  const result = await db.query(
    `SELECT state FROM dnd_encounters WHERE campaign_id=$1${transactional ? ' FOR SHARE' : ''}`,
    [campaignId]
  );
  if (!result.rowCount) return false;
  const state = parsedJson(result.rows[0].state, {});
  return String(state.presentationGate && state.presentationGate.id || '') === candidate;
}

/** @description Append one story beat atomically only to the caller's current timeline. */
async function archive(deps, sub, campaignId, kind, content, payload, timelineId) {
  return withTransaction(deps.pool, async (db, transactional) => {
    if (!(await archiveTimelineCurrent(db, transactional, campaignId, timelineId))) return null;
    return appendArchive(deps, db, sub, campaignId, kind, content, transactional, payload);
  });
}

/** @description Load and normalize only caller-owned reusable character sheets. */
async function loadSavedSheets(_deps, db, sub, savedIds) {
  if (!savedIds.length) return [];
  const stored = await db.query(
    `SELECT character_id, sheet FROM dnd_characters
      WHERE user_sub=$1 AND campaign_id IS NULL AND character_id = ANY($2::uuid[])`,
    [sub, savedIds]
  );
  if (stored.rowCount !== savedIds.length) throw new CharacterImportError('CHARACTER_NOT_FOUND', 'One or more saved characters are unavailable.');
  const byId = new Map(stored.rows.map((row) => [String(row.character_id).toLowerCase(), row.sheet]));
  return savedIds.map((id) => normalizeInternalSheet(byId.get(id)));
}

/** @description Insert independent campaign character copies for the selected party. */
async function insertCampaignCharacters(_deps, db, sub, campaignId, chosen) {
  for (const hero of chosen) {
    await db.query(
      `INSERT INTO dnd_characters (user_sub, campaign_id, slug, name, sheet, xp, level)
       VALUES ($1,$2,$3,$4,$5,0,$6)`,
      [sub, campaignId, hero.id, hero.name, JSON.stringify(hero), hero.level || 1]
    );
  }
}

/** @description Create every campaign child inside the caller's active transaction. */
async function createCampaignRows(deps, db, sub, body, savedIds) {
  const savedSheets = await loadSavedSheets(deps, db, sub, savedIds);
  const chosen = campaignParty({ ...body, customCharacters: (body.customCharacters || []).concat(savedSheets) }, deps.heroes, deps.defaultParty);
  const adventure = deps.adventureById ? deps.adventureById(body.adventureId) : deps.adventure;
  if (body.adventureId && (!adventure || adventure.id !== body.adventureId)) {
    throw new CharacterImportError('INVALID_ADVENTURE', 'Choose one of the available campaigns.');
  }
  const name = String(body.name || adventure.title || 'A New Adventure').slice(0, 120);
  const code = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  const created = await db.query(
    `INSERT INTO dnd_campaigns (user_sub, name, adventure_id, join_code)
     VALUES ($1,$2,$3,$4)
     RETURNING campaign_id, name, adventure_id, status, join_code, created_at, updated_at`,
    [sub, name, adventure.id, code]
  );
  const campaign = { ...created.rows[0], is_owner: true };
  await insertCampaignCharacters(deps, db, sub, campaign.campaign_id, chosen);
  const scene = (adventure.scenes || [])[0];
  const state = buildSceneState(scene, chosen, deps.bestiary, adventure.id);
  await db.query(
    'INSERT INTO dnd_encounters (campaign_id, user_sub, adventure_id, state, round, rev) VALUES ($1,$2,$3,$4,0,1)',
    [campaign.campaign_id, sub, adventure.id, JSON.stringify(state)]
  );
  await appendArchive(deps, db, sub, campaign.campaign_id, 'milestone', `A new campaign begins: ${scene.title}. Join code: ${code}`, false);
  return { campaign, state };
}

/** @description Create a complete campaign atomically and clone authorized saved sheets. */
async function createCampaign(deps, sub, rawBody) {
  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : {};
  const savedIds = savedCharacterIdsOf(body);
  if (body.customCharacters !== undefined && !Array.isArray(body.customCharacters)) {
    throw new CharacterImportError('INVALID_INPUT', 'customCharacters must be an array.');
  }
  const created = await withTransaction(deps.pool, (db) => createCampaignRows(deps, db, sub, body, savedIds));
  const bundle = await sheetsOfWithRev(deps, created.campaign.campaign_id);
  return {
    campaign: campaignDto(created.campaign), state: created.state, rev: 1,
    sheets: bundle.sheets, sheetsRev: bundle.sheetsRev,
  };
}

/** @description List the caller's private reusable character-library entries. */
async function listSavedCharacters(deps, sub) {
  const result = await deps.pool.query(
    `SELECT character_id, slug, name, sheet, xp, level, created_at, updated_at
       FROM dnd_characters WHERE user_sub=$1 AND campaign_id IS NULL
      ORDER BY updated_at DESC, created_at DESC, character_id`,
    [sub]
  );
  return { ok: true, characters: result.rows.map(characterDto) };
}

/** @description Normalize and insert one private reusable character. */
async function saveCharacter(deps, sub, body) {
  const raw = body && (body.character || body.sheet);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CharacterImportError('INVALID_INPUT', 'Character details are required.');
  const sheet = normalizeInternalSheet(raw);
  const result = await deps.pool.query(
    `INSERT INTO dnd_characters (user_sub, campaign_id, slug, name, sheet, xp, level)
     VALUES ($1,NULL,$2,$3,$4,0,$5)
     RETURNING character_id, slug, name, sheet, xp, level, created_at, updated_at`,
    [sub, sheet.id, sheet.name, JSON.stringify(sheet), sheet.level || 1]
  );
  return { ok: true, character: characterDto(result.rows[0]) };
}

/** @description Replace only a caller-owned private library sheet. */
async function updateSavedCharacter(deps, sub, characterId, body) {
  const raw = body && (body.character || body.sheet);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CharacterImportError('INVALID_INPUT', 'Character details are required.');
  const sheet = normalizeInternalSheet(raw);
  const result = await deps.pool.query(
    `UPDATE dnd_characters SET slug=$3, name=$4, sheet=$5, level=$6, updated_at=now()
      WHERE character_id=$1 AND user_sub=$2 AND campaign_id IS NULL
      RETURNING character_id, slug, name, sheet, xp, level, created_at, updated_at`,
    [characterId, sub, sheet.id, sheet.name, JSON.stringify(sheet), sheet.level || 1]
  );
  if (!result.rowCount) return { ok: false, code: 'CHARACTER_NOT_FOUND', error: 'That saved character is unavailable.' };
  return { ok: true, character: characterDto(result.rows[0]) };
}

/** @description Delete only a caller-owned private library row. */
async function deleteSavedCharacter(deps, sub, characterId) {
  const result = await deps.pool.query(
    `DELETE FROM dnd_characters
      WHERE character_id=$1 AND user_sub=$2 AND campaign_id IS NULL RETURNING character_id`,
    [characterId, sub]
  );
  if (!result.rowCount) return { ok: false, code: 'CHARACTER_NOT_FOUND', error: 'That saved character is unavailable.' };
  return { ok: true, character_id: result.rows[0].character_id };
}

/** @description Release one member seat and wake peers so the hero becomes an AI companion. */
async function leaveCampaignRows(_deps, db, transactional, sub, campaignId) {
  const found = await db.query(
    `SELECT c.campaign_id, c.user_sub, (c.user_sub = $2) AS is_owner
       FROM dnd_campaigns c WHERE c.campaign_id = $1
        AND (c.user_sub = $2 OR EXISTS (
              SELECT 1 FROM dnd_players p WHERE p.campaign_id = c.campaign_id AND p.user_sub = $2))
       ${transactional ? 'FOR UPDATE' : ''}`,
    [campaignId, sub]
  );
  const campaign = found.rows[0];
  if (!campaign) return { ok: false, code: 'NO_ACCESS', error: 'No seat at this table.' };
  if (campaign.is_owner === true || campaign.user_sub === sub) {
    return { ok: false, code: 'OWNER_CANNOT_LEAVE', error: 'Hosts can quit to the game menu, but cannot leave their own campaign.' };
  }
  await db.query('DELETE FROM dnd_players WHERE campaign_id=$1 AND user_sub=$2', [campaignId, sub]);
  const bumped = await db.query(
    'UPDATE dnd_encounters SET rev=rev+1, updated_at=now() WHERE campaign_id=$1 RETURNING rev', [campaignId]
  );
  await db.query('UPDATE dnd_campaigns SET updated_at=now() WHERE campaign_id=$1', [campaignId]);
  return { ok: true, campaignId, rev: bumped.rowCount ? Number(bumped.rows[0].rev) : 0 };
}

/** @description Leave a joined campaign without deleting any campaign-owned history. */
async function leaveCampaign(deps, sub, body) {
  const campaignId = String((body && body.campaignId) || '');
  if (!campaignId) return { ok: false, code: 'CAMPAIGN_REQUIRED', error: 'Choose a campaign to leave.' };
  return withTransaction(deps.pool, (db, transactional) => leaveCampaignRows(deps, db, transactional, sub, campaignId));
}

/** @description Lock a campaign, encounter, and its seats before a host takeover. */
async function lockedHostSeats(db, transactional, campaignId) {
  const table = await db.query(
    `SELECT c.campaign_id, c.user_sub, e.rev FROM dnd_campaigns c
       JOIN dnd_encounters e ON e.campaign_id=c.campaign_id
      WHERE c.campaign_id=$1${transactional ? ' FOR UPDATE OF c, e' : ''}`,
    [campaignId]
  );
  if (!table.rowCount) return { campaign: null, seats: [] };
  const seatRows = await db.query(
    `SELECT user_sub, display_name, character_slug FROM dnd_players
      WHERE campaign_id=$1 ORDER BY joined_at${transactional ? ' FOR UPDATE' : ''}`,
    [campaignId]
  );
  return { campaign: table.rows[0], seats: seatRows.rows || [] };
}

/** @description Remove one non-owner guest while all table ownership rows are locked. */
async function releaseGuestSeatRows(_deps, db, transactional, sub, campaignId, seatKey) {
  const locked = await lockedHostSeats(db, transactional, campaignId);
  if (!locked.campaign) return { ok: false, code: 'CAMPAIGN_NOT_FOUND', error: 'That campaign no longer exists.' };
  if (locked.campaign.user_sub !== sub) {
    return { ok: false, code: 'HOST_REQUIRED', error: 'Only the campaign host can release another player.' };
  }
  const target = locked.seats.find((seat) => seatKeyFor(campaignId, seat.user_sub) === seatKey);
  if (!target) return { ok: false, code: 'SEAT_NOT_FOUND', error: 'That player seat is no longer at the table.' };
  if (target.user_sub === sub || target.user_sub === locked.campaign.user_sub) {
    return { ok: false, code: 'OWNER_SEAT_LOCKED', error: 'The host seat cannot be released.' };
  }
  await db.query('DELETE FROM dnd_players WHERE campaign_id=$1 AND user_sub=$2', [campaignId, target.user_sub]);
  const bumped = await db.query(
    'UPDATE dnd_encounters SET rev=rev+1, updated_at=now() WHERE campaign_id=$1 RETURNING rev', [campaignId]
  );
  await db.query('UPDATE dnd_campaigns SET updated_at=now() WHERE campaign_id=$1', [campaignId]);
  const remaining = locked.seats.filter((seat) => seat !== target);
  return {
    ok: true, campaignId, rev: Number(bumped.rows[0].rev),
    released: { name: target.display_name, slug: target.character_slug || null },
    players: playerDtos(remaining, campaignId, sub),
  };
}

/** @description Let a host convert one claimed guest hero back to an AI companion. */
async function releaseGuestSeat(deps, sub, body) {
  const campaignId = String((body && body.campaignId) || '');
  const seatKey = String((body && body.seatKey) || '').trim();
  if (!campaignId) return { ok: false, code: 'CAMPAIGN_REQUIRED', error: 'Choose a campaign first.' };
  if (!/^[a-f0-9]{24}$/.test(seatKey)) {
    return { ok: false, code: 'SEAT_REQUIRED', error: 'Choose the player seat to release.' };
  }
  return withTransaction(deps.pool,
    (db, transactional) => releaseGuestSeatRows(deps, db, transactional, sub, campaignId, seatKey));
}

/** @description Select the caller's existing setup hero or one currently open seat. */
function setupSeatChoice(state, seats, sub) {
  const own = seats.find((seat) => seat.user_sub === sub && seat.character_slug);
  const claimed = new Set(seats.filter((seat) => seat.user_sub !== sub && seat.character_slug).map((seat) => seat.character_slug));
  const tokens = Array.isArray(state.tokens) ? state.tokens.filter((token) => token.kind === 'pc') : [];
  const oldSlug = own && tokens.some((token) => token.slug === own.character_slug)
    ? own.character_slug : (tokens.find((token) => !claimed.has(token.slug)) || {}).slug;
  return { oldSlug, tokens };
}

/** @description Replace one setup token while preserving its board position. */
function replacementSetupState(state, tokens, oldSlug, sheet) {
  if (tokens.some((token) => token.slug === sheet.id && token.slug !== oldSlug)) {
    throw new CharacterImportError('DUPLICATE_CHARACTER', 'A character with that id is already in this party.');
  }
  const oldToken = tokens.find((token) => token.slug === oldSlug);
  const replacement = {
    ...oldToken, id: sheet.id, slug: sheet.id, name: sheet.name, hp: sheet.maxHp,
    maxHp: sheet.maxHp, ac: sheet.ac, speed: sheet.speed,
    color: (sheet.token && sheet.token.color) || '#3b82f6',
    glyph: (sheet.token && sheet.token.glyph) || '@',
    slots: sheet.slots ? JSON.parse(JSON.stringify(sheet.slots)) : {}, initiative: sheet.initiative || 0,
  };
  return {
    ...state,
    tokens: state.tokens.map((token) => token.kind === 'pc' && token.slug === oldSlug ? replacement : token),
    order: Array.isArray(state.order) ? state.order.map((id) => id === oldToken.id ? sheet.id : id) : [],
  };
}

/** @description Perform a setup-seat replacement under encounter and seat locks. */
async function replaceSetupSeatRows(_deps, db, sub, displayName, body, sheet) {
  const enc = await db.query('SELECT state, rev FROM dnd_encounters WHERE campaign_id=$1 FOR UPDATE', [body.campaignId]);
  if (!enc.rowCount) throw new CharacterImportError('BOARD_MISSING', 'No board exists for this lobby.');
  const current = parsedJson(enc.rows[0].state, {});
  if (current.mode !== 'setup') throw new CharacterImportError('LOBBY_CLOSED', 'Characters can only be imported before the host starts the quest.');
  const seatRows = await db.query('SELECT user_sub, character_slug FROM dnd_players WHERE campaign_id=$1 FOR UPDATE', [body.campaignId]);
  const choice = setupSeatChoice(current, seatRows.rows || [], sub);
  if (!choice.oldSlug) throw new CharacterImportError('NO_OPEN_SEAT', 'Every hero is already claimed. Ask the host to reopen a seat.');
  const state = replacementSetupState(current, choice.tokens, choice.oldSlug, sheet);
  const changed = await db.query(
    `UPDATE dnd_characters SET slug=$1, name=$2, sheet=$3, xp=0, level=$4, updated_at=now()
      WHERE campaign_id=$5 AND slug=$6`,
    [sheet.id, sheet.name, JSON.stringify(sheet), sheet.level || 1, body.campaignId, choice.oldSlug]
  );
  if (!changed.rowCount) throw new CharacterImportError('CHARACTER_MISSING', 'The open character seat no longer exists.');
  await db.query(
    `INSERT INTO dnd_players (campaign_id, user_sub, display_name, character_slug) VALUES ($1,$2,$3,$4)
     ON CONFLICT (campaign_id, user_sub) DO UPDATE SET display_name=EXCLUDED.display_name, character_slug=EXCLUDED.character_slug`,
    [body.campaignId, sub, displayName, sheet.id]
  );
  const saved = await db.query(
    'UPDATE dnd_encounters SET state=$1, rev=rev+1, updated_at=now() WHERE campaign_id=$2 RETURNING rev',
    [JSON.stringify(state), body.campaignId]
  );
  return { state, rev: Number(saved.rows[0].rev) };
}

/** @description Replace one open setup seat with a normalized imported character. */
async function seatImportedCharacter(deps, sub, displayName, body) {
  if (!(await access(deps, sub, body.campaignId))) return { ok: false, error: 'No seat at this table.' };
  const sheet = normalizeInternalSheet(body.character);
  let changed;
  try {
    changed = await withTransaction(deps.pool, (db) => replaceSetupSeatRows(deps, db, sub, displayName, body, sheet));
  } catch (error) {
    if (error instanceof CharacterImportError) throw error;
    if (error && error.code === '23505') throw new CharacterImportError('SEAT_TAKEN', 'That lobby seat was claimed at the same moment. Choose another open seat.');
    throw error;
  }
  const bundle = await sheetsOfWithRev(deps, body.campaignId);
  return { ok: true, ...changed, players: await playersOf(deps, body.campaignId, sub), sheets: bundle.sheets, sheetsRev: bundle.sheetsRev };
}

/** @description Count distinct people while reserving one of four hero seats for the host. */
function participantCount(campaign, seats) {
  return new Set([campaign.user_sub].concat((seats || []).map((seat) => seat.user_sub))).size;
}

/** @description Join one setup lobby while its campaign row serializes capacity decisions. */
async function joinCampaignRows(_deps, db, transactional, sub, name, code) {
  const locked = await db.query(
    `SELECT c.campaign_id, c.user_sub, e.state FROM dnd_campaigns c
       JOIN dnd_encounters e ON e.campaign_id=c.campaign_id
      WHERE c.join_code=$1 AND c.status='active'${transactional ? ' FOR UPDATE OF c, e' : ''}`,
    [code]
  );
  if (!locked.rowCount) return { ok: false, code: 'GAME_NOT_FOUND', error: 'No game found with that code.' };
  const campaign = locked.rows[0], state = parsedJson(campaign.state, {});
  if (state.mode !== 'setup') {
    return { ok: false, code: 'QUEST_IN_PROGRESS', error: 'That quest has already started. Ask the host to invite you to a new lobby.' };
  }
  const seatRows = await db.query(
    `SELECT user_sub, character_slug FROM dnd_players WHERE campaign_id=$1${transactional ? ' FOR UPDATE' : ''}`,
    [campaign.campaign_id]
  );
  const seats = seatRows.rows || [], existingSeat = seats.some((seat) => seat.user_sub === sub);
  const existingParticipant = campaign.user_sub === sub || existingSeat;
  const capacity = (Array.isArray(state.tokens) ? state.tokens : []).filter((token) => token.kind === 'pc').length;
  if (!existingParticipant && (!capacity || participantCount(campaign, seats) >= capacity)) {
    return { ok: false, code: 'TABLE_FULL', error: 'All four player seats are already taken.' };
  }
  await db.query(
    `INSERT INTO dnd_players (campaign_id, user_sub, display_name) VALUES ($1,$2,$3)
     ON CONFLICT (campaign_id, user_sub) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [campaign.campaign_id, sub, name]
  );
  if (existingSeat) return { ok: true, campaignId: campaign.campaign_id };
  const bumped = await db.query(
    'UPDATE dnd_encounters SET rev=rev+1, updated_at=now() WHERE campaign_id=$1 RETURNING rev',
    [campaign.campaign_id]
  );
  return { ok: true, campaignId: campaign.campaign_id, rev: Number(bumped.rows[0].rev) };
}

/** @description Join one active setup campaign atomically by its share code. */
async function joinCampaign(deps, sub, name, body) {
  const code = String((body && body.code) || '').trim().toUpperCase();
  return withTransaction(deps.pool,
    (db, transactional) => joinCampaignRows(deps, db, transactional, sub, name, code));
}

/** @description Validate one requested hero against both campaign sheets and locked board tokens. */
async function validClaim(deps, campaignId, slug, db, lockedState) {
  if (!slug) return true;
  const source = db || deps.pool;
  const result = lockedState
    ? await source.query('SELECT slug FROM dnd_characters WHERE campaign_id=$1 AND slug=$2', [campaignId, slug])
    : await source.query(
      `SELECT c.slug, e.state FROM dnd_characters c JOIN dnd_encounters e ON e.campaign_id = c.campaign_id
        WHERE c.campaign_id=$1 AND c.slug=$2`,
      [campaignId, slug]
    );
  const state = lockedState || parsedJson((result.rows[0] || {}).state, {});
  const tokens = result.rowCount ? (state.tokens || []) : [];
  return result.rowCount && tokens.some((token) => token.kind === 'pc' && token.slug === slug);
}

/** @description Lock one lobby and return the caller's effective claim change. */
async function lockedClaimContext(db, transactional, sub, body) {
  const suffix = transactional ? ' FOR UPDATE' : '';
  const encounter = await db.query(`SELECT state, rev FROM dnd_encounters WHERE campaign_id=$1${suffix}`, [body.campaignId]);
  if (!encounter.rowCount) return { ok: false, code: 'BOARD_MISSING', error: 'No board at this table.' };
  const seats = await db.query(
    `SELECT user_sub, display_name, character_slug FROM dnd_players WHERE campaign_id=$1${suffix}`,
    [body.campaignId],
  );
  const state = parsedJson(encounter.rows[0].state, {}), slug = String(body.slug || '');
  const current = (seats.rows || []).find((seat) => seat.user_sub === sub);
  const changed = String(current && current.character_slug || '') !== slug;
  return { ok: true, state, seats: seats.rows || [], slug, changed, rev: Number(encounter.rows[0].rev) };
}

/** @description Apply one setup-only claim and bump the board revision on change. */
async function claimHeroRows(deps, db, transactional, sub, name, body, campaign) {
  const context = await lockedClaimContext(db, transactional, sub, body);
  if (!context.ok) return context;
  if (context.state.mode !== 'setup') {
    const bootstrap = !!(campaign.is_owner || campaign.user_sub === sub) && !!context.slug
      && !context.seats.some((seat) => seat.character_slug);
    if (!bootstrap) return { ok: false, code: 'CLAIMS_CLOSED', error: 'Hero claims lock when the quest begins.' };
  }
  if (!(await validClaim(deps, body.campaignId, context.slug, db, context.state))) {
    return { ok: false, error: 'That hero is not part of this campaign.' };
  }
  await db.query(
    `INSERT INTO dnd_players (campaign_id, user_sub, display_name, character_slug) VALUES ($1,$2,$3,$4)
     ON CONFLICT (campaign_id, user_sub) DO UPDATE SET character_slug = EXCLUDED.character_slug, display_name = EXCLUDED.display_name`,
    [body.campaignId, sub, name, context.slug || null]
  );
  if (!context.changed) return { ok: true, unchanged: true, rev: context.rev };
  const bumped = await db.query(
    'UPDATE dnd_encounters SET rev=rev+1, updated_at=now() WHERE campaign_id=$1 RETURNING rev',
    [body.campaignId],
  );
  return { ok: true, rev: bumped.rowCount ? Number(bumped.rows[0].rev) : context.rev + 1 };
}

/** @description Claim one setup hero while preserving one-player-per-hero ownership. */
async function claimHero(deps, sub, name, body) {
  const campaign = await access(deps, sub, body.campaignId);
  if (!campaign) return { ok: false, error: 'No seat at this table.' };
  let claimed;
  try {
    claimed = await withTransaction(deps.pool,
      (db, transactional) => claimHeroRows(deps, db, transactional, sub, name, body, campaign));
  } catch (_error) { return { ok: false, error: 'That hero is already claimed.' }; }
  if (!claimed.ok) return claimed;
  return { ...claimed, players: await playersOf(deps, body.campaignId, sub) };
}

/** @description Return campaign sheets plus a deterministic revision fingerprint. */
async function sheetsOfWithRev(deps, campaignId) {
  const result = await deps.pool.query('SELECT slug, sheet FROM dnd_characters WHERE campaign_id=$1 ORDER BY slug', [campaignId]);
  const sheets = {};
  result.rows.forEach((row) => { sheets[row.slug] = deps.hydratedSheet(row.slug, row.sheet); });
  return { sheets, sheetsRev: sheetsRevFor(sheets) };
}

/** @description Return the campaign's persisted sheets keyed by hero slug. */
async function sheetsOf(deps, campaignId) {
  return (await sheetsOfWithRev(deps, campaignId)).sheets;
}

/** @description Load one accessible board with sanitized campaign metadata and story history. */
async function loadState(deps, sub, campaignId) {
  const campaign = campaignId ? await access(deps, sub, campaignId) : await latestCampaign(deps, sub);
  if (!campaign) return { campaign: null };
  const enc = await deps.pool.query('SELECT state, rev FROM dnd_encounters WHERE campaign_id=$1', [campaign.campaign_id]);
  const log = await deps.pool.query(
    'SELECT seq, kind, content, payload, created_at FROM dnd_archive WHERE campaign_id=$1 ORDER BY seq DESC LIMIT 60',
    [campaign.campaign_id]
  );
  const bundle = await sheetsOfWithRev(deps, campaign.campaign_id);
  return {
    campaign: campaignDto(campaign), state: enc.rowCount ? enc.rows[0].state : null,
    rev: enc.rowCount ? Number(enc.rows[0].rev) : 0,
    players: await playersOf(deps, campaign.campaign_id, sub), sheets: bundle.sheets,
    sheetsRev: bundle.sheetsRev, archive: log.rows.reverse(),
  };
}

/** @description Attach authoritative board and sheets to a rejected client state write. */
async function authoritativeFailure(deps, campaignId, row, failure) {
  const bundle = await sheetsOfWithRev(deps, campaignId);
  return { ...failure, conflict: true, rev: row ? Number(row.rev) : 0, state: row ? row.state : null, sheets: bundle.sheets, sheetsRev: bundle.sheetsRev };
}

/** @description Commit one accepted board and its automatic round mark atomically. */
async function commitAcceptedState(deps, db, campaign, body, current, proposed, expectedRev) {
  const saved = await db.query(
    `UPDATE dnd_encounters SET state=$1, round=$2, rev=rev+1, updated_at=now()
      WHERE campaign_id=$3 AND rev=$4 RETURNING rev`,
    [JSON.stringify(proposed), Number(proposed.round) || 0, body.campaignId, expectedRev],
  );
  if (!saved.rowCount) return null;
  const status = ['complete', 'defeat'].includes(proposed.mode) ? 'archived' : 'active';
  await db.query('UPDATE dnd_campaigns SET updated_at=now(), status=$2 WHERE campaign_id=$1', [body.campaignId, status]);
  await captureRoundBoundary(
    deps, db, campaign.user_sub, body.campaignId, current.state, proposed,
  );
  return { ok: true, rev: Number(saved.rows[0].rev) };
}

/** @description Persist a structurally authorized board at exactly one expected revision. */
async function saveState(deps, sub, body) {
  const campaign = await access(deps, sub, body.campaignId);
  if (!campaign) return { ok: false, error: 'No seat at this table.' };
  const currentResult = await deps.pool.query('SELECT state, rev FROM dnd_encounters WHERE campaign_id=$1', [body.campaignId]);
  if (!currentResult.rowCount) return { ok: false, code: 'BOARD_MISSING', error: 'No board at this table.' };
  const current = currentResult.rows[0], expectedRev = Number(body.expectedRev);
  if (body.expectedRev === null || body.expectedRev === '' || !Number.isSafeInteger(expectedRev) || expectedRev < 0) {
    return authoritativeFailure(deps, body.campaignId, current, { ...revConflict(current, 'A board revision is required. Reload the table and try again.'), code: 'REV_REQUIRED' });
  }
  if (expectedRev !== Number(current.rev)) return authoritativeFailure(deps, body.campaignId, current, revConflict(current));
  const proposed = body.state && typeof body.state === 'object' && !Array.isArray(body.state) ? stripTokenPrivateFields(body.state) : null;
  if (!proposed) return { ok: false, code: 'STATE_REQUIRED', error: 'Board state is required.' };
  const [seats, sheets] = await Promise.all([seatsOf(deps, body.campaignId), sheetsOf(deps, body.campaignId)]);
  const decision = stateWriteDecision(campaign, seats, sub, current.state, proposed, { scene: deps.sceneById(current.state && current.state.sceneId), sheets, monsters: deps.bestiary });
  if (!decision.ok) return authoritativeFailure(deps, body.campaignId, current, decision);
  const result = await withTransaction(
    deps.pool, (db) => commitAcceptedState(deps, db, campaign, body, current, proposed, expectedRev),
  );
  if (result) return result;
  const latest = await deps.pool.query('SELECT state, rev FROM dnd_encounters WHERE campaign_id=$1', [body.campaignId]);
  return authoritativeFailure(deps, body.campaignId, latest.rows[0] || current, revConflict(latest.rows[0] || current));
}

/** @description Poll authoritative board, story, seat, and sheet changes. */
async function sync(deps, sub, campaignId, sinceRev, sinceSeq, sinceSheetsRev) {
  if (!(await access(deps, sub, campaignId))) return { ok: false, error: 'No seat at this table.' };
  const enc = await deps.pool.query('SELECT state, rev FROM dnd_encounters WHERE campaign_id=$1', [campaignId]);
  const rev = enc.rowCount ? Number(enc.rows[0].rev) : 0;
  const output = { ok: true, rev, changed: rev > sinceRev };
  if (output.changed) output.state = enc.rows[0].state;
  const tail = await deps.pool.query(
    'SELECT seq, kind, content, payload FROM dnd_archive WHERE campaign_id=$1 AND seq > $2 ORDER BY seq ASC LIMIT 30',
    [campaignId, sinceSeq]
  );
  output.archiveTail = tail.rows;
  output.players = await playersOf(deps, campaignId, sub);
  const bundle = await sheetsOfWithRev(deps, campaignId);
  output.sheetsRev = bundle.sheetsRev;
  if (typeof sinceSheetsRev === 'string' && sinceSheetsRev !== bundle.sheetsRev) output.sheets = bundle.sheets;
  return output;
}

/**
 * @description Bind campaign persistence operations to one immutable dependency set.
 * @param {object} deps - Pool, content, and pure-rule dependencies.
 * @returns {object} Campaign service methods consumed by routes and sibling services.
 */
function createCampaignService(deps) {
  return {
    access: (sub, id) => access(deps, sub, id),
    appendArchive: (db, sub, id, kind, content, lock, payload) => appendArchive(deps, db, sub, id, kind, content, lock, payload),
    archive: (sub, id, kind, content, payload, timelineId) => archive(deps, sub, id, kind, content, payload, timelineId),
    claimHero: (sub, name, body) => claimHero(deps, sub, name, body),
    createCampaign: (sub, body) => createCampaign(deps, sub, body),
    deleteSavedCharacter: (sub, id) => deleteSavedCharacter(deps, sub, id),
    joinCampaign: (sub, name, body) => joinCampaign(deps, sub, name, body),
    leaveCampaign: (sub, body) => leaveCampaign(deps, sub, body),
    listCampaigns: (sub) => listCampaigns(deps, sub),
    listSavedCharacters: (sub) => listSavedCharacters(deps, sub),
    loadState: (sub, id) => loadState(deps, sub, id),
    nextSeq: (db, id) => nextSeq(deps, db, id),
    playersOf: (id, sub) => playersOf(deps, id, sub),
    releaseGuestSeat: (sub, body) => releaseGuestSeat(deps, sub, body),
    saveCharacter: (sub, body) => saveCharacter(deps, sub, body),
    saveState: (sub, body) => saveState(deps, sub, body),
    seatImportedCharacter: (sub, name, body) => seatImportedCharacter(deps, sub, name, body),
    seatsOf: (id, db) => seatsOf(deps, id, db),
    sheetsOf: (id) => sheetsOf(deps, id),
    sheetsOfWithRev: (id) => sheetsOfWithRev(deps, id),
    sync: (sub, id, rev, seq, sheetsRev) => sync(deps, sub, id, rev, seq, sheetsRev),
    updateSavedCharacter: (sub, id, body) => updateSavedCharacter(deps, sub, id, body),
  };
}

module.exports = { createCampaignService };
