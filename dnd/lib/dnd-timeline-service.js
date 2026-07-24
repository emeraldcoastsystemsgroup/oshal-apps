/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:55:31 | roger.murphy@emeraldcoastsystemsgroup.com   | Extract transactionally consistent save, rewind, roster reconciliation, and exactly-once scene advancement from the D&D route factory.
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Inject a fresh leased rewind presentation gate in the same transaction that restores the shared board.
 * 2026-07-22 01:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Expose authenticated read-only playback from exact snapshots and archive facts, label missing board revisions honestly, and reactivate only a confirmed rewind branch.
 * 2026-07-23 01:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Retain every play mark permanently and share image-free exact-state checkpoint persistence with round transitions.
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Preserve the campaign adventure identity when building its next authored scene.
 */

'use strict';

const crypto = require('node:crypto');
const { CharacterImportError } = require('./character-import');
const { captureCheckpoint } = require('./dnd-checkpoint-store');
const { stripTokenPrivateFields } = require('./multiplayer-guard');
const { buildSceneState, campaignDto, parsedJson, withTransaction } = require('./dnd-route-helpers');

/** @description Capture a save point with its exact story cursor. */
async function saveSnapshot(deps, sub, body) {
  const campaign = await deps.campaign.access(sub, body.campaignId);
  if (!campaign) return { ok: false, error: 'No seat at this table.' };
  const label = String(body.label || 'Save point').slice(0, 80);
  const auto = !!body.auto && !!(campaign.is_owner || campaign.user_sub === sub);
  return withTransaction(deps.pool, async (db, transactional) => {
    const encounter = await db.query(
      `SELECT state FROM dnd_encounters WHERE campaign_id=$1${transactional ? ' FOR UPDATE' : ''}`,
      [body.campaignId]
    );
    if (!encounter.rowCount) return { ok: false, error: 'No board to save.' };
    return captureCheckpoint(
      deps, db, campaign.user_sub || sub, body.campaignId,
      encounter.rows[0].state, label, auto,
    );
  });
}

/** @description List every retained play mark for an authorized table member. */
async function listSnapshots(deps, sub, campaignId) {
  if (!(await deps.campaign.access(sub, campaignId))) return { ok: false, error: 'No seat at this table.' };
  const result = await deps.pool.query(
    'SELECT snapshot_id, label, auto, archive_seq, created_at FROM dnd_snapshots WHERE campaign_id=$1 ORDER BY created_at DESC',
    [campaignId]
  );
  return { ok: true, snapshots: result.rows };
}

/** @description Sanitize one exact persisted board for the requesting campaign member. */
function playbackBoard(rawState, isOwner) {
  const state = stripTokenPrivateFields(parsedJson(rawState, {}));
  if (!state || !Array.isArray(state.tokens) || isOwner) return state;
  return { ...state, tokens: state.tokens.filter((token) => !token.hidden) };
}

/** @description Project an archive fact without inventing a board revision for it. */
function archivePlaybackFrame(row) {
  const frame = {
    id: `archive-${Number(row.seq)}`, type: 'archive', seq: Number(row.seq),
    archiveSeq: Number(row.seq), kind: row.kind, content: row.content,
    createdAt: row.created_at, fidelity: 'archive-only', board: null,
    fidelityNote: 'No exact board revision was captured for this story beat; token positions are not reconstructed.',
  };
  const payload = parsedJson(row.payload, null);
  if (payload && typeof payload === 'object') frame.payload = payload;
  return frame;
}

/** @description Classify whether a snapshot cursor still belongs to the current archive branch. */
function snapshotBranch(row, archiveBySeq) {
  if (row.archive_seq === null || row.archive_seq === undefined) return 'legacy';
  const cursor = Number(row.archive_seq);
  if (!Number.isSafeInteger(cursor) || cursor < 0) return 'legacy';
  if (cursor === 0) return 'current';
  const anchor = archiveBySeq.get(cursor);
  if (!anchor) return 'prior';
  const savedAt = Date.parse(row.created_at), archiveAt = Date.parse(anchor.created_at);
  return Number.isFinite(savedAt) && Number.isFinite(archiveAt) && savedAt < archiveAt ? 'prior' : 'current';
}

/** @description Explain how one exact snapshot relates to the surviving story branch. */
function snapshotBranchNote(branch, cursor) {
  if (branch === 'current') return `Exact saved board on the current story branch after archive entry ${cursor}.`;
  if (branch === 'legacy') return 'Exact legacy board; this save predates archive cursors, so its story placement is unknown.';
  return 'Exact saved board from a prior branch; matching later story entries are no longer persisted and are not inferred.';
}

/** @description Project one exact snapshot as a selectable playback frame. */
function snapshotPlaybackFrame(row, branch, isOwner) {
  const cursor = row.archive_seq === null || row.archive_seq === undefined ? null : Number(row.archive_seq);
  return {
    id: `snapshot-${row.snapshot_id}`, type: 'snapshot', snapshotId: row.snapshot_id,
    archiveSeq: cursor, label: row.label, auto: !!row.auto, createdAt: row.created_at,
    fidelity: 'exact-board', fidelityNote: snapshotBranchNote(branch, cursor),
    branch, restorable: !!isOwner && branch !== 'prior', board: playbackBoard(row.state, isOwner),
  };
}

/** @description Sort heterogeneous persisted frames by time, story cursor, then stable identity. */
function comparePlaybackFrames(left, right) {
  const leftAt = Date.parse(left.createdAt), rightAt = Date.parse(right.createdAt);
  if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) return leftAt - rightAt;
  const leftSeq = Number.isFinite(left.archiveSeq) ? left.archiveSeq : Number.MAX_SAFE_INTEGER;
  const rightSeq = Number.isFinite(right.archiveSeq) ? right.archiveSeq : Number.MAX_SAFE_INTEGER;
  return leftSeq - rightSeq || String(left.id).localeCompare(String(right.id));
}

/** @description Return the highest-fidelity read-only timeline available from persisted facts. */
async function playback(deps, sub, campaignId) {
  if (!campaignId) return { ok: false, code: 'CAMPAIGN_REQUIRED', error: 'Choose a campaign to play back.' };
  const campaign = await deps.campaign.access(sub, campaignId);
  if (!campaign) return { ok: false, code: 'NO_ACCESS', error: 'No seat at this table.' };
  const [encounter, snapshots, archive] = await Promise.all([
    deps.pool.query('SELECT state, rev, updated_at FROM dnd_encounters WHERE campaign_id=$1', [campaignId]),
    deps.pool.query('SELECT snapshot_id, label, state, auto, archive_seq, created_at FROM dnd_snapshots WHERE campaign_id=$1 ORDER BY created_at ASC', [campaignId]),
    deps.pool.query('SELECT seq, kind, content, payload, created_at FROM dnd_archive WHERE campaign_id=$1 ORDER BY seq ASC', [campaignId]),
  ]);
  const archiveBySeq = new Map(archive.rows.map((row) => [Number(row.seq), row]));
  const frames = archive.rows.map(archivePlaybackFrame);
  snapshots.rows.forEach((row) => frames.push(snapshotPlaybackFrame(row, snapshotBranch(row, archiveBySeq), campaign.is_owner)));
  const live = encounter.rows[0], state = live && parsedJson(live.state, {}), maxSeq = archive.rows.reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0);
  if (live) frames.push({ id: 'current-board', type: 'current', archiveSeq: maxSeq, label: ['complete', 'defeat'].includes(state.mode) ? 'Final saved board' : 'Current saved board', createdAt: live.updated_at, fidelity: 'exact-board', fidelityNote: 'Exact current persisted board at playback load time.', restorable: false, board: playbackBoard(live.state, campaign.is_owner) });
  frames.sort(comparePlaybackFrames);
  return {
    ok: true, readOnly: true, campaign: campaignDto(campaign), mode: state && state.mode || null,
    ended: campaign.status === 'archived' || ['complete', 'defeat'].includes(state && state.mode),
    rev: live ? Number(live.rev) : 0, frames,
    coverage: { archiveEntries: archive.rows.length, exactBoards: snapshots.rows.length + (live ? 1 : 0), archiveOnlyEntries: archive.rows.length },
  };
}

/** @description Restore one character and reconcile abandoned or newly restored roster rows. */
async function reconcileCharacter(deps, db, campaign, campaignId, slug, character, allSlugs) {
  const sheet = deps.hydratedSheet(slug, character.sheet);
  const name = String((sheet && sheet.name) || slug).slice(0, 120);
  await db.query(
    `WITH updated AS (
       UPDATE dnd_characters SET sheet=$1, xp=$2, level=$3, updated_at=now()
        WHERE campaign_id=$4 AND slug=$5 RETURNING slug
     ), inserted AS (
       INSERT INTO dnd_characters (user_sub, campaign_id, slug, name, sheet, xp, level)
       SELECT $7,$4,$5,$8,$1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM updated)
       ON CONFLICT (campaign_id, slug) DO UPDATE
         SET name=EXCLUDED.name, sheet=EXCLUDED.sheet, xp=EXCLUDED.xp,
             level=EXCLUDED.level, updated_at=now() RETURNING slug
     ), removed AS (
       DELETE FROM dnd_characters WHERE campaign_id=$4 AND NOT (slug = ANY($6::text[])) RETURNING slug
     ), cleared AS (
       UPDATE dnd_players SET character_slug=NULL
        WHERE campaign_id=$4 AND character_slug IS NOT NULL
          AND NOT (character_slug = ANY($6::text[])) RETURNING player_id
     ) SELECT (SELECT COUNT(*) FROM updated) + (SELECT COUNT(*) FROM inserted) AS restored`,
    [JSON.stringify(sheet), Number(character.xp) || 0, Number(character.level) || 1,
      campaignId, slug, allSlugs, campaign.user_sub, name]
  );
}

/** @description Make live campaign characters exactly match a saved roster. */
async function reconcileRoster(deps, db, campaign, campaignId, rawSheets) {
  const sheets = parsedJson(rawSheets, {}) || {};
  const slugs = Object.keys(sheets);
  for (const slug of slugs) {
    await reconcileCharacter(deps, db, campaign, campaignId, slug, sheets[slug], slugs);
  }
  if (!slugs.length) {
    await db.query('DELETE FROM dnd_characters WHERE campaign_id=$1', [campaignId]);
    await db.query('UPDATE dnd_players SET character_slug=NULL WHERE campaign_id=$1', [campaignId]);
  }
}

/** @description Read and lock the selected save point. */
async function lockedSnapshot(db, body, transactional) {
  const result = await db.query(
    `SELECT label, state, sheets, archive_seq FROM dnd_snapshots
      WHERE snapshot_id=$1 AND campaign_id=$2${transactional ? ' FOR UPDATE' : ''}`,
    [body.snapshotId, body.campaignId]
  );
  return result.rows[0] || null;
}

/** @description Validate the restoring host tab that will present the rewind. */
function rewindPresenterId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 80 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new CharacterImportError('PRESENTER_REQUIRED', 'Reload the table before rewinding this campaign.');
  }
  return id;
}

/** @description Replace any snapshotted gate with this rewind transaction's lock. */
function rewindPresentationState(savedState, label, presenterId) {
  const state = { ...savedState }, now = Date.now(), rawSerial = Number(state.turnSerial);
  const turnSerial = Number.isSafeInteger(rawSerial) && rawSerial >= 0 ? rawSerial : 0;
  state.presentationGate = {
    id: crypto.randomUUID(), kind: 'rewind', sceneId: String(state.sceneId || ''), turnSerial,
    message: `The threads of fate rewind to: ${String(label || 'that save point').slice(0, 80)}.`,
    createdAt: now, complete: false, lease: rewindPresenterId(presenterId), leaseAt: now,
  };
  state.turnSerial = turnSerial;
  return state;
}

/** @description Restore board, roster, claims, and story cursor in one transaction. */
async function restoreRows(deps, db, transactional, sub, body, campaign) {
  const snapshot = await lockedSnapshot(db, body, transactional);
  if (!snapshot) return { ok: false, error: 'That save point is gone.' };
  const savedState = parsedJson(snapshot.state, {});
  const state = rewindPresentationState(savedState, snapshot.label, body.presenterId);
  await db.query(
    `SELECT state FROM dnd_encounters WHERE campaign_id=$1${transactional ? ' FOR UPDATE' : ''}`,
    [body.campaignId]
  );
  const board = await db.query(
    'UPDATE dnd_encounters SET state=$1, round=$2, rev=rev+1, updated_at=now() WHERE campaign_id=$3 RETURNING rev',
    [JSON.stringify(state), Number(state.round) || 0, body.campaignId]
  );
  if (!board.rowCount) throw new CharacterImportError('BOARD_MISSING', 'No board exists for this save point.');
  await reconcileRoster(deps, db, campaign, body.campaignId, snapshot.sheets);
  return finishRewind(deps, db, transactional, sub, body, snapshot, state, board);
}

/** @description Truncate abandoned story history and append the visible rewind beat. */
async function finishRewind(deps, db, transactional, sub, body, snapshot, state, board) {
  const cursor = snapshot.archive_seq;
  const hasCursor = cursor !== null && cursor !== undefined && Number.isFinite(Number(cursor));
  if (hasCursor) {
    await db.query('DELETE FROM dnd_archive WHERE campaign_id=$1 AND seq > $2', [body.campaignId, Number(cursor)]);
  }
  const entry = await deps.campaign.appendArchive(
    db, sub, body.campaignId, 'milestone', `The threads of fate rewind to: ${snapshot.label}`, transactional
  );
  await db.query("UPDATE dnd_campaigns SET updated_at=now(), status='active' WHERE campaign_id=$1", [body.campaignId]);
  return {
    ok: true, state, rev: Number(board.rows[0].rev), label: snapshot.label,
    archiveRewound: hasCursor, archiveSeq: entry.seq,
    ...(hasCursor ? {} : { warning: 'This legacy save predates story cursors; the board was restored, but older story history could not be safely truncated.' }),
  };
}

/** @description Rewind a host-owned campaign to one complete save point. */
async function restoreSnapshot(deps, sub, body) {
  const campaign = await deps.campaign.access(sub, body.campaignId);
  if (!campaign) return { ok: false, error: 'No seat at this table.' };
  if (!(campaign.is_owner || campaign.user_sub === sub)) {
    return { ok: false, code: 'OWNER_REQUIRED', error: 'Only the host can restore a save point.' };
  }
  const restored = await withTransaction(deps.pool,
    (db, transactional) => restoreRows(deps, db, transactional, sub, body, campaign));
  if (!restored.ok) return restored;
  const bundle = await deps.campaign.sheetsOfWithRev(body.campaignId);
  return { ...restored, sheets: bundle.sheets, sheetsRev: bundle.sheetsRev };
}

/** @description Apply the supported level delta to a copied character sheet. */
function applyLevelUp(deps, sheet, newLevel) {
  const delta = (deps.leveling.level2 || {})[sheet.class];
  const next = JSON.parse(JSON.stringify(sheet));
  next.level = newLevel;
  if (!delta) return { sheet: next, note: `${sheet.name} reaches level ${newLevel}.` };
  next.maxHp = (next.maxHp || 0) + (delta.hpGain || 0);
  if (delta.newSlots) next.slots = JSON.parse(JSON.stringify(delta.newSlots));
  if (delta.newActions) next.actions = (next.actions || []).concat(delta.newActions);
  if (delta.newFeatures) next.features = (next.features || []).concat(delta.newFeatures);
  const gains = [`+${delta.hpGain || 0} HP`]
    .concat(delta.newSlots ? [`spell slots now L1x${delta.newSlots['1']}`] : [])
    .concat((delta.newActions || []).map((action) => action.name))
    .concat((delta.newFeatures || []).map((feature) => feature.split(':')[0]));
  return { sheet: next, note: `${sheet.name} reaches level ${newLevel}: ${gains.join(', ')}.` };
}

/** @description Recognize an already committed advancement from its durable marker. */
function replayedAdvance(deps, state, rev) {
  const marker = state && state.progression && state.progression.lastAdvance;
  if (!marker || typeof marker !== 'object') return null;
  const finalReplay = marker.done === true && state.mode === 'complete' && marker.fromSceneId === state.sceneId;
  const nextReplay = marker.done === false && state.mode === 'setup' && marker.toSceneId === state.sceneId;
  if (!finalReplay && !nextReplay) return null;
  const finished = deps.sceneById(marker.fromSceneId);
  return {
    ok: true, alreadyAdvanced: true, done: !!marker.done, state, rev: Number(rev) || 0,
    notes: Array.isArray(marker.notes) ? marker.notes : [],
    sceneId: marker.done ? undefined : marker.toSceneId,
    afterword: marker.done ? finished.afterword : undefined,
  };
}

/** @description Award XP and persist every character sheet under the encounter lock. */
async function awardParty(deps, db, campaignId, scene, rows) {
  const perPc = Math.round(((scene.xpReward || 0) + (scene.storyAward || 0)) / rows.length);
  const notes = [], sheets = [];
  for (const row of rows) {
    let xp = Number(row.xp) + perPc, level = Number(row.level);
    let sheet = deps.hydratedSheet(row.slug, row.sheet);
    const target = level + 1, threshold = (deps.leveling.thresholds || {})[String(target)];
    if (threshold && xp >= threshold && target === 2) {
      const leveled = applyLevelUp(deps, sheet, target);
      sheet = leveled.sheet; level = target; notes.push(leveled.note);
    }
    await db.query(
      'UPDATE dnd_characters SET xp=$1, level=$2, sheet=$3, updated_at=now() WHERE character_id=$4',
      [xp, level, JSON.stringify(sheet), row.character_id]
    );
    sheets.push(sheet);
  }
  return { perPc, notes, sheets };
}

/** @description Build the durable progression marker for the completed scene. */
function progressionFor(state, scene, award) {
  const previous = state.progression && typeof state.progression === 'object' ? state.progression : {};
  const awardedScenes = Array.from(new Set(
    (Array.isArray(previous.awardedScenes) ? previous.awardedScenes : []).concat(scene.id)
  ));
  const lastAdvance = {
    fromSceneId: scene.id, toSceneId: scene.next || null, done: !scene.next,
    perPc: award.perPc, notes: award.notes,
  };
  return { ...previous, awardedScenes, lastAdvance };
}

/** @description Persist either campaign completion or the next scene board. */
async function persistAdvance(deps, db, campaignId, current, scene, award) {
  const progression = progressionFor(current, scene, award);
  if (!scene.next) {
    const state = { ...current, mode: 'complete', progression };
    const saved = await db.query(
      'UPDATE dnd_encounters SET state=$1, round=$2, rev=rev+1, updated_at=now() WHERE campaign_id=$3 RETURNING rev',
      [JSON.stringify(state), Number(current.round) || 0, campaignId]
    );
    await db.query("UPDATE dnd_campaigns SET updated_at=now(), status='archived' WHERE campaign_id=$1", [campaignId]);
    return { ok: true, done: true, alreadyAdvanced: false, state, rev: Number(saved.rows[0].rev), afterword: scene.afterword, notes: award.notes };
  }
  const nextScene = deps.sceneById(scene.next);
  const state = {
    ...buildSceneState(nextScene, award.sheets, deps.bestiary, current.adventureId),
    progression,
  };
  const saved = await db.query(
    'UPDATE dnd_encounters SET state=$1, round=0, rev=rev+1, updated_at=now() WHERE campaign_id=$2 RETURNING rev',
    [JSON.stringify(state), campaignId]
  );
  await deps.campaign.appendArchive(db, deps.sub, campaignId, 'milestone', `The party presses on: ${nextScene.title}.`, deps.transactional);
  return { ok: true, done: false, alreadyAdvanced: false, state, rev: Number(saved.rows[0].rev), notes: award.notes, sceneId: nextScene.id };
}

/** @description Resolve one locked advancement attempt. */
async function advanceRows(deps, db, transactional, sub, body) {
  const encounter = await db.query(
    `SELECT state, rev FROM dnd_encounters WHERE campaign_id=$1${transactional ? ' FOR UPDATE' : ''}`,
    [body.campaignId]
  );
  if (!encounter.rowCount) return { ok: false, error: 'No board.' };
  const current = parsedJson(encounter.rows[0].state, {});
  const replay = replayedAdvance(deps, current, encounter.rows[0].rev);
  if (replay) return replay;
  if (current.mode !== 'resolved') return { ok: false, error: 'Finish the current battle first.' };
  const characters = await db.query(
    `SELECT * FROM dnd_characters WHERE campaign_id=$1 ORDER BY created_at${transactional ? ' FOR UPDATE' : ''}`,
    [body.campaignId]
  );
  if (!characters.rowCount) return { ok: false, error: 'No party.' };
  const scene = deps.sceneById(current.sceneId);
  const award = await awardParty(deps, db, body.campaignId, scene, characters.rows);
  await deps.campaign.appendArchive(db, sub, body.campaignId, 'level-up',
    `Each hero earns ${award.perPc} XP.${award.notes.length ? ' ' + award.notes.join(' ') : ''}`, transactional);
  return persistAdvance({ ...deps, sub, transactional }, db, body.campaignId, current, scene, award);
}

/** @description Advance a resolved scene exactly once and return refreshed sheets. */
async function advance(deps, sub, body) {
  const campaign = await deps.campaign.access(sub, body.campaignId);
  if (!campaign) return { ok: false, error: 'No seat at this table.' };
  if (!(campaign.is_owner || campaign.user_sub === sub)) {
    return { ok: false, code: 'OWNER_REQUIRED', error: 'Only the host can advance the quest.' };
  }
  const outcome = await withTransaction(deps.pool,
    (db, transactional) => advanceRows(deps, db, transactional, sub, body));
  if (!outcome || !outcome.ok) return outcome || { ok: false, error: 'Could not advance the quest.' };
  const bundle = await deps.campaign.sheetsOfWithRev(body.campaignId);
  return { ...outcome, sheets: bundle.sheets, sheetsRev: bundle.sheetsRev };
}

/**
 * @description Bind timeline operations to campaign persistence and adventure data.
 * @param {object} deps - Pool, campaign service, content, and sheet helpers.
 * @returns {object} Timeline service methods consumed by the router.
 */
function createTimelineService(deps) {
  return {
    advance: (sub, body) => advance(deps, sub, body),
    listSnapshots: (sub, id) => listSnapshots(deps, sub, id),
    playback: (sub, id) => playback(deps, sub, id),
    restoreSnapshot: (sub, body) => restoreSnapshot(deps, sub, body),
    saveSnapshot: (sub, body) => saveSnapshot(deps, sub, body),
  };
}

module.exports = { createTimelineService };
