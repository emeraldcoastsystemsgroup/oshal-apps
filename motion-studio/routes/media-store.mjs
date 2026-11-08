/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | RP-MOT-01: persist, reconcile, list and read owned video and audio assets alongside still photos under forced RLS and native person isolation.
 */
import { createHash } from 'node:crypto';

const MEDIA_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/flac', 'audio/aiff'
]);
const digest = value => createHash('sha256').update(value).digest('hex');

export function validateMediaProbe(bytes, probe, limits, fail) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > limits.mediaBytes) fail(413, 'motion_media_limit');
  if (!probe || typeof probe !== 'object' || !['video', 'audio'].includes(probe.kind) || !MEDIA_TYPES.has(probe.mediaType)) {
    fail(400, 'motion_invalid_media');
  }
  const { kind, mediaType, width, height, durationTicks, frameRate, hasVideo, hasAudio, audioSampleRate, audioChannels, codec } = probe;
  if (typeof durationTicks !== 'string' || !/^[1-9][0-9]{0,18}$/.test(durationTicks)) fail(400, 'motion_invalid_media');
  const ticks = BigInt(durationTicks);
  if (ticks <= 0n || ticks > 9223372036854775807n) fail(400, 'motion_invalid_media');
  if (kind === 'video') {
    if (!hasVideo || ![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= limits.dimension) || width * height > limits.pixels) {
      fail(400, 'motion_invalid_media');
    }
    if (!frameRate || ![frameRate.num, frameRate.den].every(n => Number.isSafeInteger(n) && n > 0 && n <= 4294967295)) {
      fail(400, 'motion_invalid_media');
    }
  } else if (width !== 0 || height !== 0 || hasVideo || !hasAudio) {
    fail(400, 'motion_invalid_media');
  }
  return {
    kind, mediaType, width, height, durationTicks,
    fpsNum: Number.isSafeInteger(frameRate?.num) && frameRate.num >= 0 ? frameRate.num : 0,
    fpsDen: Number.isSafeInteger(frameRate?.den) && frameRate.den > 0 ? frameRate.den : 1,
    hasVideo: Boolean(hasVideo), hasAudio: Boolean(hasAudio),
    audioSampleRate: hasAudio ? (Number.isSafeInteger(audioSampleRate) && audioSampleRate > 0 ? audioSampleRate : 48000) : 0,
    audioChannels: hasAudio ? (Number.isSafeInteger(audioChannels) && audioChannels > 0 ? audioChannels : 2) : 0,
    codec: typeof codec === 'string' && codec.trim() ? codec.slice(0, 64) : kind
  };
}

export async function queryMediaBlobHandles(client, owner) {
  const rows = (await client.query(
    'SELECT blob_handle FROM motion_media_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND blob_handle IS NOT NULL',
    owner
  )).rows;
  return rows.map(row => row.blob_handle);
}

export async function queryOwnerAssetUsage(client, owner) {
  const photos = (await client.query(
    'SELECT COUNT(*)::int AS count,COALESCE(SUM(byte_length),0)::bigint AS bytes FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2',
    owner
  )).rows[0];
  const media = (await client.query(
    'SELECT COUNT(*)::int AS count,COALESCE(SUM(byte_length),0)::bigint AS bytes FROM motion_media_assets WHERE owner_issuer=$1 AND owner_sub=$2',
    owner
  )).rows[0];
  return { count: Number(photos.count) + Number(media.count), bytes: Number(photos.bytes) + Number(media.bytes) };
}

export async function resolveRevisionAssetKinds(client, owner, assets, fail) {
  if (!assets.length) return { photoIds: [], mediaIds: [] };
  const photos = (await client.query(
    'SELECT asset_id FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=ANY($3::uuid[])',
    [...owner, assets]
  )).rows.map(row => row.asset_id);
  const media = (await client.query(
    'SELECT asset_id FROM motion_media_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=ANY($3::uuid[])',
    [...owner, assets]
  )).rows.map(row => row.asset_id);
  if (photos.length + media.length !== assets.length) fail(400, 'motion_asset_unavailable');
  return { photoIds: photos, mediaIds: media };
}

export async function readRevisionAllAssets(client, owner, projectId, rev) {
  const photos = (await client.query(
    'SELECT asset_id FROM motion_revision_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND revision=$4 ORDER BY asset_id',
    [...owner, projectId, rev]
  )).rows.map(row => row.asset_id);
  const media = (await client.query(
    'SELECT asset_id FROM motion_revision_media_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND revision=$4 ORDER BY asset_id',
    [...owner, projectId, rev]
  )).rows.map(row => row.asset_id);
  return [...new Set([...photos, ...media])].sort();
}

export async function queryAllAssetMetadata(client, owner) {
  const photos = (await client.query(
    'SELECT asset_id,media_type,width,height,byte_length,sha256,created_at FROM motion_assets WHERE owner_issuer=$1 AND owner_sub=$2 ORDER BY created_at DESC,asset_id LIMIT 64',
    owner
  )).rows.map(row => ({
    sortTime: new Date(row.created_at).getTime(),
    entry: { id: row.asset_id, type: row.media_type, width: row.width, height: row.height, bytes: row.byte_length, sha256: row.sha256 }
  }));
  const media = (await client.query(
    `SELECT asset_id,media_kind,media_type,width,height,duration_ticks::text AS duration_ticks,fps_num,fps_den,
      has_video,has_audio,audio_sample_rate,audio_channels,codec,byte_length,sha256,created_at
     FROM motion_media_assets WHERE owner_issuer=$1 AND owner_sub=$2 ORDER BY created_at DESC,asset_id LIMIT 64`,
    owner
  )).rows.map(row => ({
    sortTime: new Date(row.created_at).getTime(),
    entry: {
      id: row.asset_id, kind: row.media_kind, type: row.media_type, width: row.width, height: row.height,
      durationTicks: String(row.duration_ticks), frameRate: { num: row.fps_num, den: row.fps_den },
      hasVideo: row.has_video, hasAudio: row.has_audio, audioSampleRate: row.audio_sample_rate,
      audioChannels: row.audio_channels, codec: row.codec, bytes: row.byte_length, sha256: row.sha256
    }
  }));
  return [...photos, ...media]
    .sort((a, b) => (b.sortTime - a.sortTime) || a.entry.id.localeCompare(b.entry.id))
    .slice(0, 64)
    .map(item => item.entry);
}

export async function readMediaAsset(client, owner, id, blobs, action, fail) {
  const result = await client.query(
    `SELECT asset_id,media_kind,media_type,width,height,duration_ticks::text AS duration_ticks,fps_num,fps_den,
      has_video,has_audio,byte_length,sha256,content_base64,blob_handle
     FROM motion_media_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3`,
    [...owner, id]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if (row.blob_handle && !blobs) fail(503, 'motion_blob_storage_unavailable');
  const bytes = row.blob_handle
    ? await blobs.read({ id: row.blob_handle, sha256: row.sha256, bytes: row.byte_length }, action)
    : Buffer.from(row.content_base64, 'base64');
  if (bytes.length !== row.byte_length || digest(bytes) !== row.sha256) fail(503, 'motion_asset_integrity_error');
  return {
    id: row.asset_id, kind: row.media_kind, type: row.media_type, width: row.width, height: row.height,
    durationTicks: String(row.duration_ticks), frameRate: { num: row.fps_num, den: row.fps_den },
    hasVideo: row.has_video, hasAudio: row.has_audio, sha256: row.sha256, bytes
  };
}

export async function deleteMediaAssetRow(client, owner, id, fail) {
  const refs = await client.query(
    'SELECT COUNT(*)::int AS count FROM motion_revision_media_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3',
    [...owner, id]
  );
  if (refs.rows[0].count) fail(409, 'motion_asset_in_use');
  const found = await client.query(
    'SELECT blob_handle,sha256,byte_length FROM motion_media_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3',
    [...owner, id]
  );
  if (!found.rows.length) return null;
  const row = found.rows[0];
  const deleted = await client.query(
    'DELETE FROM motion_media_assets WHERE owner_issuer=$1 AND owner_sub=$2 AND asset_id=$3',
    [...owner, id]
  );
  if (!deleted.rowCount) fail(404, 'motion_asset_not_found');
  return {
    deleted: true,
    retired: row.blob_handle ? { id: row.blob_handle, sha256: row.sha256, bytes: row.byte_length } : null
  };
}
