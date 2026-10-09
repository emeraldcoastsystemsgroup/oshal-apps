/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Stream bounded private MP4 exports, validate complete container boxes and a video track, and serve immutable files without following file links.
 */
import { constants, createReadStream } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type { Request, Response } from 'express';

export const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
export const artifactRoot = (): string => join(process.env.CLINE_WORKSPACE_ROOT || '/app/workspace-shared', 'vids-artifacts');
export const artifactPath = (id: string): string => {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid artifact identity');
  return join(artifactRoot(), `${id}.mp4`);
};

export async function ensureArtifactRoot(): Promise<string> {
  const root = artifactRoot();
  await mkdir(root, { recursive: true });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Artifact root must be a directory');
  return root;
}

async function bytesAt(file: FileHandle, offset: number, size: number): Promise<Buffer> {
  const bytes = Buffer.alloc(size);
  const read = await file.read(bytes, 0, size, offset);
  if (read.bytesRead !== size) throw new Error('Truncated MP4');
  return bytes;
}

type Box = { kind: string; start: number; payload: number; end: number };
async function boxes(file: FileHandle, start: number, end: number): Promise<Box[]> {
  const out: Box[] = [];
  while (start < end) {
    if (end - start < 8 || out.length >= 10000) throw new Error('Invalid MP4 box boundary');
    const header = await bytesAt(file, start, 8);
    let size = header.readUInt32BE(0), headerSize = 8;
    if (size === 1) {
      if (end - start < 16) throw new Error('Truncated MP4 box');
      const extended = (await bytesAt(file, start + 8, 8)).readBigUInt64BE();
      if (extended > BigInt(MAX_VIDEO_BYTES)) throw new Error('Oversize MP4 box');
      size = Number(extended); headerSize = 16;
    } else if (size === 0) size = end - start;
    if (size < headerSize || start + size > end) throw new Error('Truncated MP4 box');
    out.push({ kind: header.toString('ascii', 4, 8), start, payload: start + headerSize, end: start + size });
    start += size;
  }
  return out;
}

async function hasVideoTrack(file: FileHandle, movie: Box): Promise<boolean> {
  for (const track of (await boxes(file, movie.payload, movie.end)).filter((b) => b.kind === 'trak')) {
    for (const media of (await boxes(file, track.payload, track.end)).filter((b) => b.kind === 'mdia')) {
      for (const handler of (await boxes(file, media.payload, media.end)).filter((b) => b.kind === 'hdlr')) {
        if (handler.end - handler.payload >= 12 && (await bytesAt(file, handler.payload + 8, 4)).toString('ascii') === 'vide') return true;
      }
    }
  }
  return false;
}

/** Container validation is not editorial review or a full decoder. The owner previews before publishing. */
export async function inspectVideo(path: string): Promise<{ sha256: string; byteLength: number }> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_VIDEO_BYTES || stat.size < 32) throw new Error('Invalid MP4 size');
    const top = await boxes(file, 0, stat.size);
    const ftyp = top[0], movie = top.find((b) => b.kind === 'moov');
    if (ftyp?.kind !== 'ftyp' || ftyp.end - ftyp.payload < 8 || !movie
        || !top.some((b) => b.kind === 'mdat' && b.end > b.payload) || !(await hasVideoTrack(file, movie))) throw new Error('A complete MP4 video export is required');
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
    return { sha256: hash.digest('hex'), byteLength: stat.size };
  } finally { await file.close(); }
}

function byteRange(value: string | undefined, size: number): [number, number] | null {
  if (!value) return [0, size - 1];
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? [start, end] : null;
}

export async function serveVideo(req: Request, res: Response, row: { artifact_id: string; byte_length: string | number; sha256: string }): Promise<void> {
  const root = await lstat(artifactRoot());
  if (!root.isDirectory() || root.isSymbolicLink()) { res.status(404).end(); return; }
  const path = artifactPath(row.artifact_id);
  if ((await lstat(path)).isSymbolicLink()) { res.status(404).end(); return; }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let streaming = false;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== Number(row.byte_length)) { res.status(404).end(); return; }
    const range = byteRange(req.headers.range, stat.size);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'video/mp4', 'Content-Disposition': 'inline; filename="video.mp4"', 'Accept-Ranges': 'bytes' });
    if (!range) { res.set('Content-Range', `bytes */${stat.size}`).status(416).end(); return; }
    if (req.headers.range) res.status(206).set('Content-Range', `bytes ${range[0]}-${range[1]}/${stat.size}`);
    res.set('Content-Length', String(range[1] - range[0] + 1));
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(path, { fd: file.fd, autoClose: false, start: range[0], end: range[1] });
    streaming = true;
    const close = () => { stream.destroy(); void file.close().catch(() => undefined); };
    res.once('close', close); stream.once('error', () => res.destroy()); stream.pipe(res);
  } finally { if (!streaming) await file.close(); }
}
