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
 * 2026-10-10 18:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Write owner_sub explicitly on every INSERT: the native kernel skips migration 006, whose triggers stamp it on PostgreSQL (where they still override it from the parent campaign).
 * 2026-11-25 14:15:00 | maintainer@emeraldcoastsystemsgroup.com     | Correlate continuous board revisions (rev:*) and cutaway artwork links into read-only playback, keep manual save listings clean, and capture revisions on scene advance.
 * 2026-11-25 15:15:00 | maintainer@emeraldcoastsystemsgroup.com     | Delegate multi-level SRD 5.1 progression (Levels 2-5) to shared ui/engine.js so server /advance and client stay in exact parity across multi-chapter arcs.
 * 2026-11-25 18:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Include normalized cutawayBudget counters on GET /playback responses alongside cutaway coverage counts.
 */

'use strict';

const crypto = require('node:crypto');
const ENG = require('../ui/engine.js');
const { CharacterImportError } = require('./character-import');
const { captureBoardRevision, captureCheckpoint, isBoardRevisionLabel } = require('./dnd-checkpoint-store');
const { DEFAULT_CUTAWAY_CAP, buildCutawayBudget } = require('./dnd-cutaway-beats');
const { _test: replayExportHelpers } = require('./dnd-replay-export');
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
    `SELECT snapshot_id, label, auto, archive_seq, created_at FROM dnd_snapshots
      WHERE campaign_id=$1 AND label NOT LIKE 'rev:%' ORDER BY created_at DESC`,
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

/** @description Extract a validated cutaway link from a persisted cutaway archive beat. */
function cutawayFromArchiveRow(row, previousBeat) {
  if (!row || String(row.kind) !== 'cutaway') return null;
  const url = replayExportHelpers.safeExportUrl(row.content);
  if (!url) return null;
  const basename = url.split('/').pop() || '';
  const key = basename.replace(/\.[^.]+$/, '') || `cutaway-${Number(row.seq) || 0}`;
  const caption = previousBeat && previousBeat.content
    ? String(previousBeat.content).trim().slice(0, 240)
    : 'Scene illustration';
  return {
    url,
    title: previousBeat && previousBeat.kind
      ? `${String(previousBeat.kind).replaceAll('-', ' ')} cutaway`
      : 'Scene illustration',
    caption,
    kind: 'cutaway',
    key,
    archiveSeq: Number(row.seq),
    createdAt: row.created_at,
  };
}

/** @description Build a readable title for a standalone captured board revision. */
function readableRevisionLabel(row) {
  const state = parsedJson(row.state, {});
  const sceneId = String(state.sceneId || 'board').replaceAll('-', ' ');
  const round = Number(state.round) || 0;
  return round > 0 ? `Board revision · ${sceneId} (round ${round})` : `Board revision · ${sceneId}`;
}

/** @description Project an archive fact with its exact board revision and cutaway link when captured. */
function archivePlaybackFrame(row, revision, isOwner, cutaway) {
  const exact = !!revision;
  const frame = {
    id: `archive-${Number(row.seq)}`, type: 'archive', seq: Number(row.seq),
    archiveSeq: Number(row.seq), kind: row.kind, content: row.content,
    createdAt: row.created_at,
    fidelity: exact ? 'exact-board' : 'archive-only',
    board: exact ? playbackBoard(revision.state, isOwner) : null,
    fidelityNote: exact
      ? 'Exact board revision captured alongside this story beat.'
      : 'No exact board revision was captured for this story beat; token positions are not reconstructed.',
  };
  if (exact) frame.boardRevisionId = revision.snapshot_id;
  if (cutaway) frame.cutaway = cutaway;
  const payload = parsedJson(row.payload, null);
  if (payload && typeof payload === 'object') frame.payload = payload;
  return frame;
}

/** @description Project one standalone mid-beat board revision as a non-restorable playback frame. */
function revisionPlaybackFrame(row, isOwner) {
  const cursor = row.archive_seq === null || row.archive_seq === undefined ? null : Number(row.archive_seq);
  return {
    id: `revision-${row.snapshot_id}`, type: 'revision', snapshotId: row.snapshot_id,
    archiveSeq: cursor, label: readableRevisionLabel(row), auto: true, createdAt: row.created_at,
    fidelity: 'exact-board', fidelityNote: 'Exact board revision captured during play.',
    branch: 'current', restorable: false, board: playbackBoard(row.state, isOwner),
  };
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

/** @description Partition persisted snapshots into manual/round marks and current-branch board revisions. */
function partitionSnapshots(rows, archiveBySeq) {
  const manual = [], revisionsBySeq = new Map(), extraRevisions = [];
  let boardRevisions = 0;
  for (const row of rows) {
    const branch = snapshotBranch(row, archiveBySeq);
    if (!isBoardRevisionLabel(row.label)) {
      manual.push({ row, branch });
      continue;
    }
    if (branch !== 'current') continue;
    boardRevisions++;
    const cursor = Number(row.archive_seq);
    if (archiveBySeq.has(cursor) && !revisionsBySeq.has(cursor)) revisionsBySeq.set(cursor, row);
    else extraRevisions.push(row);
  }
  return { manual, revisionsBySeq, extraRevisions, boardRevisions };
}

/** @description Build archive frames with correlated exact board revisions and cutaway links. */
function buildArchiveFrames(archiveRows, revisionsBySeq, isOwner) {
  const frames = [], cutaways = [];
  let lastStoryBeat = null;
  for (const row of archiveRows) {
    const cutaway = cutawayFromArchiveRow(row, lastStoryBeat);
    if (cutaway) cutaways.push(cutaway);
    else lastStoryBeat = row;
    frames.push(archivePlaybackFrame(row, revisionsBySeq.get(Number(row.seq)) || null, isOwner, cutaway));
  }
  return { frames, cutaways };
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
  const { manual, revisionsBySeq, extraRevisions, boardRevisions } = partitionSnapshots(snapshots.rows, archiveBySeq);
  const { frames, cutaways } = buildArchiveFrames(archive.rows, revisionsBySeq, campaign.is_owner);
  manual.forEach(({ row, branch }) => frames.push(snapshotPlaybackFrame(row, branch, campaign.is_owner)));
  extraRevisions.forEach((row) => frames.push(revisionPlaybackFrame(row, campaign.is_owner)));
  const live = encounter.rows[0], state = live && parsedJson(live.state, {});
  const maxSeq = archive.rows.reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0);
  if (live) frames.push({ id: 'current-board', type: 'current', archiveSeq: maxSeq, label: ['complete', 'defeat'].includes(state.mode) ? 'Final saved board' : 'Current saved board', createdAt: live.updated_at, fidelity: 'exact-board', fidelityNote: 'Exact current persisted board at playback load time.', restorable: false, board: playbackBoard(live.state, campaign.is_owner) });
  frames.sort(comparePlaybackFrames);
  const exactBoards = frames.filter((frame) => frame.fidelity === 'exact-board').length;
  const archiveOnlyEntries = frames.filter((frame) => frame.type === 'archive' && frame.fidelity !== 'exact-board').length;
  return {
    ok: true, readOnly: true, campaign: campaignDto(campaign), mode: state && state.mode || null,
    ended: campaign.status === 'archived' || ['complete', 'defeat'].includes(state && state.mode),
    rev: live ? Number(live.rev) : 0, frames, cutaways,
    cutawayBudget: buildCutawayBudget(cutaways.length, DEFAULT_CUTAWAY_CAP),
    coverage: { archiveEntries: archive.rows.length, exactBoards, archiveOnlyEntries, boardRevisions, cutaways: cutaways.length },
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
       INSERT INTO dnd_characters (user_sub, campaign_id, slug, name, sheet, xp, level, owner_sub)
       SELECT $7,$4,$5,$8,$1,$2,$3,$7 WHERE NOT EXISTS (SELECT 1 FROM updated)
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

/** @description Apply all crossed SRD 5.1 level deltas (Levels 2-5) via shared engine rules. */
function applyLevelUp(deps, sheet, targetOrOptions) {
  const result = ENG.applyLevelUp(sheet, deps.leveling || {}, targetOrOptions);
  return {
    sheet: result.sheet,
    levelUps: result.levelUps,
    notes: result.notes,
    note: result.notes.join(' '),
  };
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
    levelUps: Array.isArray(marker.levelUps) ? marker.levelUps : [],
    sceneId: marker.done ? undefined : marker.toSceneId,
    afterword: marker.done ? finished.afterword : undefined,
  };
}

/** @description Award XP and persist every character sheet under the encounter lock. */
async function awardParty(deps, db, campaignId, scene, rows) {
  const perPc = Math.round(((scene.xpReward || 0) + (scene.storyAward || 0)) / rows.length);
  const notes = [], sheets = [], levelUps = [];
  for (const row of rows) {
    const xp = (Number(row.xp) || 0) + perPc;
    let sheet = deps.hydratedSheet(row.slug, row.sheet);
    sheet = { ...sheet, level: Math.max(1, Number(row.level) || Number(sheet.level) || 1), xp };
    const leveled = applyLevelUp(deps, sheet, { xp });
    sheet = { ...leveled.sheet, xp };
    const level = Math.max(1, Number(sheet.level) || 1);
    leveled.notes.forEach((n) => notes.push(n));
    leveled.levelUps.forEach((entry) => levelUps.push({ slug: row.slug, name: sheet.name, ...entry }));
    await db.query(
      'UPDATE dnd_characters SET xp=$1, level=$2, sheet=$3, updated_at=now() WHERE character_id=$4',
      [xp, level, JSON.stringify(sheet), row.character_id]
    );
    sheets.push(sheet);
  }
  return { perPc, notes, levelUps, sheets };
}

/** @description Build the durable progression marker for the completed scene. */
function progressionFor(state, scene, award) {
  const previous = state.progression && typeof state.progression === 'object' ? state.progression : {};
  const awardedScenes = Array.from(new Set(
    (Array.isArray(previous.awardedScenes) ? previous.awardedScenes : []).concat(scene.id)
  ));
  const lastAdvance = {
    fromSceneId: scene.id, toSceneId: scene.next || null, done: !scene.next,
    perPc: award.perPc, notes: award.notes, levelUps: award.levelUps || [],
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
    await captureBoardRevision(db, deps.sub, campaignId, state, 'complete');
    return { ok: true, done: true, alreadyAdvanced: false, state, rev: Number(saved.rows[0].rev), afterword: scene.afterword, notes: award.notes, levelUps: award.levelUps || [] };
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
  const entry = await deps.campaign.appendArchive(db, deps.sub, campaignId, 'milestone', `The party presses on: ${nextScene.title}.`, deps.transactional);
  await captureBoardRevision(db, deps.sub, campaignId, state, 'advance', entry && entry.seq);
  return { ok: true, done: false, alreadyAdvanced: false, state, rev: Number(saved.rows[0].rev), notes: award.notes, levelUps: award.levelUps || [], sceneId: nextScene.id };
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

module.exports = {
  createTimelineService,
  _test: { applyLevelUp, awardParty, levelDeltaFor: ENG.levelDeltaFor },
};
