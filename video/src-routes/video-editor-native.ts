/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Use original native owner ports for bounded media and durable real exports; keep legacy FFmpeg lifecycle unchanged.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Overlay one complete validated native success receipt instead of mixing fresh success with a stale SQL row.
 */
import type { Router, Request, Response } from 'express';
import { EditorError, type EditorMedia, type EditorOwner } from './video-editor-types';
import { admit, bodyParser, confirm, handler, type RouteEnvironment } from './video-editor-http';
import { baseRevision, editorId, exactFields, isRecord, mediaKind } from './video-editor-validation';
import type { ExportRecord } from './video-editor-export-store';

/** @description Detect only the explicit original native SQL bridge. */
export function nativeEditor(env: RouteEnvironment): boolean {
  return env.ctx.pool.storageModel === 'kernel-scoped-documents';
}
/** @description Forward no identity, path, command or permission claims to the protected native executor. */
async function call(env: RouteEnvironment, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!nativeEditor(env) || typeof env.ctx.intent !== 'function') throw new EditorError(503, 'video_edit_service_unavailable');
  let value: unknown;
  try { value = await env.ctx.intent('video.editor', input); }
  catch (error) {
    const match = /^(refused|invalid|unavailable): ((?:invalid_)?video_edit_[a-z_]+)$/.exec(error instanceof Error ? error.message : '');
    if (!match) throw new EditorError(503, 'video_edit_service_unavailable');
    const status = /limit|too_large/.test(match[2]) ? 413 : match[1] === 'invalid' ? 400 : match[1] === 'unavailable' ? 503
      : /conflict|offset|not_ready/.test(match[2]) ? 409 : 403;
    throw new EditorError(status, match[2]);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EditorError(503, 'video_edit_service_unavailable');
  return value as Record<string, unknown>;
}
/** @description The browser's exact chunk transport; legacy permissions retain their shape. */
export async function nativeMedia(env: RouteEnvironment): Promise<object | undefined> {
  if (!nativeEditor(env)) return undefined;
  const result = await call(env, { op: 'epoch' });
  return { chunkBytes: result.chunkBytes };
}
/** @description Read a current owned protected artifact handle; the HTTP boundary alone streams bytes. */
async function artifact(env: RouteEnvironment, res: Response, id: string, exported: boolean, inline = false): Promise<void> {
  const result = await call(env, exported ? { op: 'open_export', id, inline } : { op: 'open_media', id });
  const target = res as Response & { nativeArtifact?: (handle: string) => void };
  if (typeof target.nativeArtifact !== 'function') throw new EditorError(503, 'video_edit_stream_unavailable');
  if (typeof result.handle !== 'string') throw new EditorError(503, 'video_edit_stream_unavailable');
  target.nativeArtifact(result.handle);
}
/** @description Native upload retains the existing named binding and guarded canonical media insert. */
async function upload(env: RouteEnvironment, req: Request, res: Response, owner: EditorOwner): Promise<void> {
  const body = req.body ?? {};
  if (body.op === 'begin') {
    exactFields(body, ['op', 'bytes']);
    res.status(201).json(await call(env, { op: 'upload_begin', kind: mediaKind(req.query.kind), bytes: body.bytes }));
  } else if (body.op === 'chunk') {
    exactFields(body, ['op', 'id', 'offset', 'data', 'sha256']);
    res.json(await call(env, { op: 'upload_chunk', id: editorId(body.id), offset: body.offset, data: body.data, sha256: body.sha256 }));
  } else if (body.op === 'finish') {
    exactFields(body, ['op', 'id']);
    const result = await call(env, { op: 'upload_finish', id: editorId(body.id) });
    await env.store.addMedia(owner, result.media as EditorMedia, confirm(env, 'upload', owner));
    res.status(201).json({ media: result.media });
  } else throw new EditorError(400, 'invalid_video_edit_upload');
}
/** @description Delete metadata through canonical scoped SQL before pruning unreachable protected bytes. */
async function prune(env: RouteEnvironment, ids: string[]): Promise<void> {
  if (ids.length) await call(env, { op: 'prune', ids });
}
/** @description Mount only native media paths; the legacy multipart and file routes remain unchanged. */
export function nativeMediaRoutes(router: Router, env: RouteEnvironment): boolean {
  if (!nativeEditor(env)) return false;
  router.post('/editor/media', admit(env, 'upload'), bodyParser, handler(env, 'upload', (req, res, owner) => upload(env, req, res, owner)));
  router.get('/editor/media/:id', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const id = editorId(req.params.id); await env.store.getMedia(owner, id); await confirm(env, 'read', owner)(); await artifact(env, res, id, false);
  }));
  router.delete('/editor/media/:id', admit(env, 'delete'), bodyParser, handler(env, 'delete', async (req, res, owner) => {
    exactFields(req.body ?? {}, []); const id = editorId(req.params.id);
    await env.store.deleteMedia(owner, id, async () => undefined, confirm(env, 'delete', owner));
    await prune(env, [id]); res.status(204).end();
  }));
  router.post('/editor/media/cleanup', admit(env, 'delete'), bodyParser, handler(env, 'delete', async (req, res, owner) => {
    exactFields(req.body ?? {}, []);
    const deleted = await env.store.cleanupMedia(owner, async () => undefined, confirm(env, 'delete', owner));
    await prune(env, deleted); res.json({ deleted });
  }));
  return true;
}
/** @description Native project deletion cancels/prunes only owned exports after canonical row commit. */
export async function nativeDeletedExports(env: RouteEnvironment, ids: string[]): Promise<boolean> {
  if (!nativeEditor(env)) return false;
  await prune(env, ids); return true;
}
/** @description Keep native measurements within the shipped 256 MiB, 1800-frame, 30 fps output profile. */
function successOutput(value: unknown): Pick<ExportRecord, 'outputBytes' | 'outputSha256' | 'outputFrames' | 'outputDurationMs'> {
  if (!isRecord(value)) throw new EditorError(503, 'video_edit_export_output_invalid');
  const { outputBytes, outputSha256, outputFrames, outputDurationMs } = value;
  if (typeof outputBytes !== 'number' || !Number.isSafeInteger(outputBytes) || outputBytes < 1 || outputBytes > 268435456
      || typeof outputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(outputSha256)
      || typeof outputFrames !== 'number' || !Number.isSafeInteger(outputFrames) || outputFrames < 1 || outputFrames > 1800
      || typeof outputDurationMs !== 'number' || !Number.isSafeInteger(outputDurationMs) || outputDurationMs < 1
      || Math.abs(outputDurationMs - outputFrames * 1000 / 30) > 2000 / 30) {
    throw new EditorError(503, 'video_edit_export_output_invalid');
  }
  return { outputBytes, outputSha256, outputFrames, outputDurationMs };
}
/** @description Overlay one complete protected receipt; polling never dispatches or retries an encode. */
async function status(env: RouteEnvironment, row: ExportRecord): Promise<ExportRecord & { progressFrames: number | null }> {
  const current = await call(env, { op: 'export_status', id: row.id });
  const state = current.state === 'verified' ? 'running' : typeof current.state === 'string' ? current.state : row.status;
  const output = state === 'succeeded' ? successOutput(current.output) : undefined;
  return { ...row, ...output, status: state,
    error: state === 'succeeded' ? null : typeof current.error === 'string' ? current.error : row.error,
    progressFrames: output?.outputFrames ?? null };
}
/** @description Canonical native export request records actual SQL revision then captures original durable work before202. */
async function start(env: RouteEnvironment, req: Request, res: Response, owner: EditorOwner): Promise<void> {
  exactFields(req.body ?? {}, ['revision', 'variant']);
  const kind = req.body.variant ?? 'export';
  if (!['export', 'preview'].includes(kind)) throw new EditorError(400, 'invalid_video_edit_export_variant');
  const { epoch } = await call(env, { op: 'epoch' });
  const created = await env.exportStore.create(owner, editorId(req.params.id), baseRevision(req.body.revision), kind, String(epoch), confirm(env, 'export', owner));
  if (created.pruned.length) await prune(env, created.pruned.map(row => row.id));
  await call(env, { op: 'export_start', id: created.record.id });
  res.status(202).json({ export: { ...created.record, progressFrames: null } });
}
/** @description Mount native export lifecycle without retaining request callbacks after202. */
export function nativeExportRoutes(router: Router, env: RouteEnvironment): boolean {
  if (!nativeEditor(env)) return false;
  router.post('/editor/projects/:id/exports', admit(env, 'export'), bodyParser, handler(env, 'export', (req, res, owner) => start(env, req, res, owner)));
  router.get('/editor/projects/:id/exports', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const { epoch } = await call(env, { op: 'epoch' });
    const rows = await env.exportStore.list(owner, editorId(req.params.id), String(epoch));
    res.json({ exports: await Promise.all(rows.map(row => status(env, row))) });
  }));
  router.get('/editor/exports/:id', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const { epoch } = await call(env, { op: 'epoch' });
    res.json({ export: await status(env, await env.exportStore.get(owner, editorId(req.params.id), String(epoch))) });
  }));
  router.post('/editor/exports/:id/cancel', admit(env, 'export'), bodyParser, handler(env, 'export', async (req, res, owner) => {
    exactFields(req.body ?? {}, []); const id = editorId(req.params.id); const { epoch } = await call(env, { op: 'epoch' });
    const row = await env.exportStore.requestCancel(owner, id, String(epoch), confirm(env, 'export', owner));
    await call(env, { op: 'export_cancel', id }); res.status(202).json({ export: await status(env, row) });
  }));
  router.get('/editor/exports/:id/download', admit(env, 'export'), handler(env, 'export', async (req, res, owner) => {
    const { epoch } = await call(env, { op: 'epoch' }); const id = editorId(req.params.id);
    const row = await env.exportStore.get(owner, id, String(epoch));
    if (row.status !== 'succeeded') throw new EditorError(409, 'video_edit_export_not_ready');
    await confirm(env, 'export', owner)(); await artifact(env, res, id, true, req.query.inline === '1');
  }));
  return true;
}
