/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 01:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Persist permanent image-free round and scene checkpoints with exact-state deduplication.
 */

'use strict';

const TRANSIENT_MEDIA_KEYS = new Set([
  'cutaway', 'cutawayImage', 'cutawayUrl', 'generatedImage', 'generatedImages',
  'imageUrl', 'killImage', 'roundImage',
]);

/** @description Copy playable state while excluding regenerable media references. */
function checkpointState(state) {
  return JSON.parse(JSON.stringify(state || {}, (key, value) => (
    TRANSIENT_MEDIA_KEYS.has(key) ? undefined : value
  )));
}

/** @description Capture every persisted character resource and inventory fact. */
async function checkpointSheets(deps, campaignId, db) {
  const result = await db.query(
    'SELECT slug, sheet, xp, level FROM dnd_characters WHERE campaign_id=$1',
    [campaignId],
  );
  const sheets = {};
  result.rows.forEach((row) => {
    sheets[row.slug] = {
      sheet: deps.hydratedSheet(row.slug, row.sheet),
      xp: Number(row.xp), level: Number(row.level),
    };
  });
  return sheets;
}

/** @description Return the exact surviving story cursor for a play mark. */
async function checkpointCursor(db, campaignId) {
  const result = await db.query(
    'SELECT COALESCE(MAX(seq),0) AS seq FROM dnd_archive WHERE campaign_id=$1',
    [campaignId],
  );
  return Number(result.rows[0].seq) || 0;
}

/** @description Find an identical automatic mark without suppressing new branches. */
async function identicalAutoCheckpoint(db, campaignId, label, state, archiveSeq) {
  const result = await db.query(
    `SELECT snapshot_id, label, auto, archive_seq, created_at FROM dnd_snapshots
      WHERE campaign_id=$1 AND label=$2 AND state=$3::jsonb AND archive_seq=$4
      ORDER BY created_at DESC LIMIT 1`,
    [campaignId, label, JSON.stringify(state), archiveSeq],
  );
  return result.rows[0] || null;
}

/** @description Insert one permanent exact-board checkpoint. */
async function insertCheckpoint(db, ownerSub, campaignId, label, state, sheets, auto, archiveSeq) {
  const saved = await db.query(
    `INSERT INTO dnd_snapshots (campaign_id, user_sub, label, state, sheets, auto, archive_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING snapshot_id, label, auto, archive_seq, created_at`,
    [campaignId, ownerSub, label, JSON.stringify(state), JSON.stringify(sheets), auto, archiveSeq],
  );
  return saved.rows[0];
}

/** @description Persist a complete play mark without retaining generated images. */
async function captureCheckpoint(deps, db, ownerSub, campaignId, rawState, label, auto = true) {
  const state = checkpointState(rawState);
  const archiveSeq = await checkpointCursor(db, campaignId);
  if (auto) {
    const duplicate = await identicalAutoCheckpoint(db, campaignId, label, state, archiveSeq);
    if (duplicate) return { ok: true, deduped: true, snapshot: duplicate };
  }
  const sheets = await checkpointSheets(deps, campaignId, db);
  const snapshot = await insertCheckpoint(
    db, ownerSub, campaignId, String(label || 'Play mark').slice(0, 80),
    state, sheets, !!auto, archiveSeq,
  );
  return { ok: true, snapshot };
}

/** @description Detect entry into combat or the first persisted state of a later round. */
function crossedRoundBoundary(current, proposed) {
  if (!proposed || proposed.mode !== 'combat') return false;
  const nextRound = Number(proposed.round) || 0;
  const priorRound = current && current.mode === 'combat' ? Number(current.round) || 0 : 0;
  return nextRound > 0 && nextRound > priorRound;
}

/** @description Build the player-facing permanent mark label for one round. */
function roundCheckpointLabel(deps, state) {
  const scene = deps.sceneById(state.sceneId);
  return `⏱ ${scene && scene.title || state.sceneId || 'Encounter'} — Round ${Number(state.round) || 1} start`;
}

/** @description Atomically add the automatic mark attached to a round transition. */
async function captureRoundBoundary(deps, db, ownerSub, campaignId, current, proposed) {
  if (!crossedRoundBoundary(current, proposed)) return { ok: true, skipped: true };
  return captureCheckpoint(
    deps, db, ownerSub, campaignId, proposed, roundCheckpointLabel(deps, proposed), true,
  );
}

module.exports = {
  captureCheckpoint, captureRoundBoundary,
  _test: { checkpointState, crossedRoundBoundary, roundCheckpointLabel },
};
