/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owned media for the manual video editor: an upload lands in a private temporary file, its container signature is checked, its actual bytes are hashed and probed with ffprobe through the file protocol and a forced demuxer (argument array, no shell, no network), its metadata is held to the first-slice bounds (H.264 MP4 clips of at most 30 s with at most one AAC track, PCM WAV beds of at most 60 s), and only then is it published as an immutable UUID file under a per-owner directory outside the package.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05c: exportPath names where a verified export is published, beside the owner's media and under the same per-owner directory.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { EditorError, EDITOR_LIMITS, type ConfirmEditorAccess, type EditorMedia, type EditorOwner } from './video-editor-types';
import type { VideoEditorStore } from './video-editor-store';

export type MediaKind = 'video' | 'audio';
/** @description The ffprobe JSON fields this module reads. */
export interface ProbeStream { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string;
  duration?: string; channels?: number; sample_rate?: string }
export interface ProbeResult { format?: { format_name?: string; duration?: string }; streams?: ProbeStream[] }
/** @description Reads a local file's container/stream metadata; production runs ffprobe, a test may name its own. */
export type MediaProber = (file: string, kind: MediaKind) => Promise<ProbeResult>;

const FPS = 30;
const PCM = new Set(['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le']);

/**
 * @description The private media root: an operator-selected directory, else the shared workspace. Never under the package.
 * @param env - Environment. @returns Absolute directory.
 */
export function mediaRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VIDEO_EDIT_DATA_DIR?.trim()) return resolve(env.VIDEO_EDIT_DATA_DIR);
  const shared = env.CLINE_WORKSPACE_ROOT || env.SHARED_WORKSPACE_ROOT
    || (existsSync('/app/workspace-shared') ? '/app/workspace-shared' : resolve(process.cwd(), 'workspace-shared'));
  return join(resolve(shared), 'video-edit');
}

/** @description The directory multipart uploads stream into before inspection. @param root - Media root. @returns Directory. */
export function incomingDirectory(root: string): string { return join(root, '.incoming'); }

function ownerDirectory(root: string, owner: EditorOwner): string {
  return join(root, createHash('sha256').update(JSON.stringify([owner.issuer, owner.sub])).digest('hex'));
}

/** @description Where one published file lives. @param root - Root. @param owner - Owner. @param media - Its id and kind. @returns Path. */
export function mediaPath(root: string, owner: EditorOwner, media: { id: string; kind: MediaKind }): string {
  if (!/^[0-9a-f-]{36}$/.test(media.id)) throw new EditorError(400, 'invalid_video_edit_id');
  return join(ownerDirectory(root, owner), `${media.id}.${media.kind === 'video' ? 'mp4' : 'wav'}`);
}

/** @description Where one verified export lives. @param root - Root. @param owner - Owner. @param id - Export UUID. @returns Path. */
export function exportPath(root: string, owner: EditorOwner, id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new EditorError(400, 'invalid_video_edit_id');
  return join(ownerDirectory(root, owner), 'exports', `${id}.mp4`);
}

/** @description Run the runtime's ffprobe on one local file with a forced demuxer; FFPROBE_PATH overrides the binary like the core renderer's FFMPEG_PATH. */
export const probeWithFfprobe: MediaProber = (file, kind) => new Promise((done, fail) => {
  const args = ['-v', 'error', '-protocol_whitelist', 'file', '-f', kind === 'video' ? 'mov' : 'wav',
    '-print_format', 'json', '-show_format', '-show_streams', `file:${file}`];
  execFile(process.env.FFPROBE_PATH || 'ffprobe', args, { timeout: 15000, maxBuffer: 1048576, windowsHide: true }, (error, stdout) => {
    if (error) { fail(new EditorError(400, 'video_edit_media_unsupported')); return; }
    try { done(JSON.parse(stdout) as ProbeResult); } catch { fail(new EditorError(400, 'video_edit_media_unsupported')); }
  });
});

/** Container signature check before any decoder sees the bytes: an ISO-BMFF ftyp box, or RIFF/WAVE. */
async function sniff(file: string, kind: MediaKind): Promise<void> {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    const ok = bytesRead === 12 && (kind === 'video' ? header.toString('latin1', 4, 8) === 'ftyp'
      : header.toString('latin1', 0, 4) === 'RIFF' && header.toString('latin1', 8, 12) === 'WAVE');
    if (!ok) throw new EditorError(400, 'video_edit_media_unsupported');
  } finally { await handle.close(); }
}

function hashFile(file: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', fail).on('end', () => done(hash.digest('hex')));
  });
}

function rate(value: string | undefined): number {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '');
  return match && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : NaN;
}
function seconds(...values: Array<string | undefined>): number {
  const found = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  return found.length ? Math.min(...found) : NaN;
}

function assessVideo(probe: ProbeResult, streams: ProbeStream[]): Omit<EditorMedia, 'id' | 'bytes' | 'sha256'> {
  const video = streams.filter(stream => stream.codec_type === 'video'), audio = streams.filter(stream => stream.codec_type === 'audio');
  const clip = video[0];
  if (!/(^|,)(mov|mp4)(,|$)/.test(probe.format?.format_name ?? '') || video.length !== 1 || audio.length > 1
    || streams.length !== video.length + audio.length || clip.codec_name !== 'h264' || (audio[0] && audio[0].codec_name !== 'aac')) {
    throw new EditorError(400, 'video_edit_media_unsupported');
  }
  const width = Number(clip.width), height = Number(clip.height), fps = rate(clip.avg_frame_rate) || rate(clip.r_frame_rate);
  const duration = seconds(clip.duration, probe.format?.duration);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || Math.max(width, height) > EDITOR_LIMITS.maxDimension
    || width * height > EDITOR_LIMITS.maxPixels || !(fps > 0 && fps <= EDITOR_LIMITS.maxFps)) throw new EditorError(400, 'video_edit_media_unsupported');
  if (!(duration > 0) || duration > EDITOR_LIMITS.clipSeconds + 0.05) throw new EditorError(400, 'video_edit_media_too_long');
  const frames = Math.min(Math.floor(duration * FPS + 1e-6), EDITOR_LIMITS.clipSeconds * FPS);
  if (frames < 1) throw new EditorError(400, 'video_edit_media_too_short');
  return { kind: 'video', container: 'mp4', videoCodec: 'h264', audioCodec: audio[0] ? 'aac' : null, width, height,
    frames, durationMs: Math.max(1, Math.round(duration * 1000)), hasAudio: audio.length === 1 };
}

function assessAudio(probe: ProbeResult, streams: ProbeStream[]): Omit<EditorMedia, 'id' | 'bytes' | 'sha256'> {
  const track = streams[0];
  if (probe.format?.format_name !== 'wav' || streams.length !== 1 || track.codec_type !== 'audio' || !PCM.has(track.codec_name ?? '')
    || !(Number(track.channels) >= 1 && Number(track.channels) <= 2) || !(Number(track.sample_rate) >= 8000 && Number(track.sample_rate) <= 96000)) {
    throw new EditorError(400, 'video_edit_media_unsupported');
  }
  const duration = seconds(track.duration, probe.format?.duration);
  if (!(duration > 0) || duration > EDITOR_LIMITS.bedSeconds + 0.05) throw new EditorError(400, 'video_edit_media_too_long');
  const frames = Math.min(Math.floor(duration * FPS + 1e-6), EDITOR_LIMITS.bedSeconds * FPS);
  if (frames < 1) throw new EditorError(400, 'video_edit_media_too_short');
  return { kind: 'audio', container: 'wav', videoCodec: null, audioCodec: track.codec_name!, width: null, height: null,
    frames, durationMs: Math.max(1, Math.round(duration * 1000)), hasAudio: true };
}

/**
 * @description Hold probed metadata to the first-slice bounds. Anything unexpected (another codec, an extra
 * audio or subtitle stream, an over-long or over-large file) is refused rather than silently dropped.
 * @param kind - Declared kind. @param probe - ffprobe JSON. @returns Verified metadata without identity or bytes.
 */
export function assessProbe(kind: MediaKind, probe: ProbeResult): Omit<EditorMedia, 'id' | 'bytes' | 'sha256'> {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  return kind === 'video' ? assessVideo(probe, streams) : assessAudio(probe, streams);
}

/**
 * @description Inspect a received upload: size, signature, hash of the actual bytes and probed metadata.
 * @param file - The private temporary file. @param kind - Declared kind. @param prober - Metadata reader.
 * @returns Verified metadata with a fresh UUID.
 */
export async function inspectUpload(file: string, kind: MediaKind, prober: MediaProber): Promise<EditorMedia> {
  const stat = await lstat(file);
  const ceiling = kind === 'video' ? EDITOR_LIMITS.clipBytes : EDITOR_LIMITS.bedBytes;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) throw new EditorError(400, 'video_edit_media_unsupported');
  if (stat.size > ceiling) throw new EditorError(413, 'video_edit_media_too_large');
  await sniff(file, kind);
  const sha256 = await hashFile(file);
  const verified = assessProbe(kind, await prober(file, kind));
  return { id: randomUUID(), bytes: stat.size, sha256, ...verified };
}

/**
 * @description Publish an inspected upload: re-authorize, move it into the owner's directory under its new UUID, then
 * record it. A refused admission removes only the file this call created.
 * @param root - Media root. @param store - Editor store. @param owner - Verified owner. @param file - Temporary upload.
 * @param kind - Declared kind. @param prober - Metadata reader. @param confirm - Current-authorization recheck.
 * @returns The published media.
 */
export async function publishMedia(root: string, store: VideoEditorStore, owner: EditorOwner, file: string, kind: MediaKind,
  prober: MediaProber, confirm: ConfirmEditorAccess): Promise<EditorMedia> {
  const media = await inspectUpload(file, kind, prober);
  await confirm();
  const directory = ownerDirectory(root, owner), target = mediaPath(root, owner, media);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new EditorError(503, 'video_edit_storage_unavailable');
  await rename(file, target);
  try { await store.addMedia(owner, media, confirm); return media; }
  catch (error) { await unlink(target).catch(() => undefined); throw error; }
}

/**
 * @description Resolve an owned file for reading after the database owner check; a replaced, linked or resized file is never served.
 * @param root - Media root. @param store - Store. @param owner - Owner. @param id - Media UUID. @returns Path and metadata.
 */
export async function openMedia(root: string, store: VideoEditorStore, owner: EditorOwner, id: string): Promise<{ file: string; media: EditorMedia }> {
  const media = await store.getMedia(owner, id), file = mediaPath(root, owner, media);
  const stat = await lstat(file).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size !== media.bytes) throw new EditorError(503, 'video_edit_storage_unavailable');
  return { file, media };
}

/** @description Remove one owned file; an already-missing file is not an error. @returns void */
export async function removeMediaFile(root: string, owner: EditorOwner, media: { id: string; kind: MediaKind }): Promise<void> {
  try { await unlink(mediaPath(root, owner, media)); }
  catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
}

/** @description Remove a temporary upload if it is still there. @param file - Path. @returns void */
export async function discardUpload(file: string | undefined): Promise<void> {
  if (file) await unlink(file).catch(() => undefined);
}

/**
 * @description Verify a published file still hashes to its recorded digest (used before encoding it).
 * @param file - Path. @param media - Recorded metadata. @returns void; a mismatch is 503.
 */
export async function verifyMediaDigest(file: string, media: EditorMedia): Promise<void> {
  if ((await hashFile(file)) !== media.sha256) throw new EditorError(503, 'video_edit_storage_unavailable');
}
