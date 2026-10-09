/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Export routes for the manual video editor (CREATE-EDIT-05c): request an export or a low-resolution preview of one saved revision, read a job and its live progress, cancel only an owned job, and download a verified success. A job resolves and re-hashes the owner's media only after it has re-checked current authority at start; polling never creates or retries work.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve legacy routes while enabling bounded original-owner native media transport.
 */
import type { Router } from 'express';
import { lstat, unlink } from 'node:fs/promises';
import { createChildLogger } from '@/shared/logger';
import { EditorError, type EditorOwner } from './video-editor-types';
import { admit, bodyParser, confirm, handler, sendFile, type RouteEnvironment } from './video-editor-http';
import { baseRevision, editorId, exactFields } from './video-editor-validation';
import { exportPath, openMedia, verifyMediaDigest } from './video-editor-media';
import type { PreparedExport } from './video-edit-export-jobs';
import type { ExportRecord } from './video-editor-export-store';
import { nativeExportRoutes } from './video-editor-native';

const logger = createChildLogger({ module: 'video-editor-export-routes' });

function variant(value: unknown): 'export' | 'preview' {
  if (value === undefined || value === 'export') return 'export';
  if (value === 'preview') return 'preview';
  throw new EditorError(400, 'invalid_video_edit_export_variant');
}

/** Resolve and verify everything one job reads, as the job, after its start-time authority check. */
async function prepare(env: RouteEnvironment, owner: EditorOwner, job: ExportRecord, sha256: string): Promise<PreparedExport> {
  const snapshot = await env.exportStore.verifiedSnapshot(owner, job.projectId, job.revision, sha256);
  const media: Record<string, string> = {};
  for (const [key, source] of Object.entries(snapshot.document.sources)) {
    const { file, media: row } = await openMedia(env.dataRoot, env.store, owner, editorId(source.asset));
    await verifyMediaDigest(file, row);
    media[key] = file;
  }
  return { document: snapshot.document, media, variant: job.variant, outputFile: exportPath(env.dataRoot, owner, job.id) };
}

async function removePruned(env: RouteEnvironment, owner: EditorOwner, pruned: Array<{ id: string }>): Promise<void> {
  for (const row of pruned) {
    await unlink(exportPath(env.dataRoot, owner, row.id)).catch(error => {
      if (error?.code !== 'ENOENT') logger.error({ err: error, exportId: row.id }, 'removing a pruned export file failed');
    });
  }
}

/** Overlay this process's live progress; a finished job reports its own counts. */
function withProgress(env: RouteEnvironment, row: ExportRecord): ExportRecord & { progressFrames: number | null } {
  return { ...row, progressFrames: row.status === 'succeeded' ? row.totalFrames : env.exports.progress(row.id) };
}

/**
 * @description Mount the export routes on the editor router with the editor's own admission.
 * @param router - Editor router. @param env - Route environment. @returns void
 */
export function registerExportRoutes(router: Router, env: RouteEnvironment): void {
  if (nativeExportRoutes(router, env)) return;
  router.post('/editor/projects/:id/exports', admit(env, 'export'), bodyParser, handler(env, 'export', async (req, res, owner) => {
    exactFields(req.body ?? {}, ['revision', 'variant']);
    const projectId = editorId(req.params.id), revision = baseRevision(req.body.revision), kind = variant(req.body.variant);
    if (env.exports.holds(owner)) throw new EditorError(409, 'video_edit_export_in_progress');
    const created = await env.exportStore.create(owner, projectId, revision, kind, env.exports.epoch, confirm(env, 'export', owner));
    await removePruned(env, owner, created.pruned);
    try {
      env.exports.admit({ id: created.record.id, owner, authorize: confirm(env, 'export', owner),
        prepare: () => prepare(env, owner, created.record, created.snapshot.sha256) });
    } catch (error) {
      const code = error instanceof EditorError ? error.code : 'video_edit_export_failed';
      await env.exportStore.finishExport(owner, created.record.id, env.exports.epoch, { status: 'failed', error: code });
      throw error;
    }
    res.status(202).json({ export: withProgress(env, created.record) });
  }));
  router.get('/editor/projects/:id/exports', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const rows = await env.exportStore.list(owner, editorId(req.params.id), env.exports.epoch);
    await confirm(env, 'read', owner)(); res.json({ exports: rows.map(row => withProgress(env, row)) });
  }));
  router.get('/editor/exports/:id', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const row = await env.exportStore.get(owner, editorId(req.params.id), env.exports.epoch);
    await confirm(env, 'read', owner)(); res.json({ export: withProgress(env, row) });
  }));
  router.post('/editor/exports/:id/cancel', admit(env, 'export'), bodyParser, handler(env, 'export', async (req, res, owner) => {
    exactFields(req.body ?? {}, []);
    const row = await env.exportStore.requestCancel(owner, editorId(req.params.id), env.exports.epoch, confirm(env, 'export', owner));
    if (row.status === 'queued' || row.status === 'running' || row.status === 'cancelled') env.exports.cancel(row.id);
    res.status(202).json({ export: withProgress(env, row) });
  }));
  router.get('/editor/exports/:id/download', admit(env, 'export'), handler(env, 'export', async (req, res, owner) => {
    const row = await env.exportStore.get(owner, editorId(req.params.id), env.exports.epoch);
    if (row.status !== 'succeeded' || !row.outputBytes) throw new EditorError(409, 'video_edit_export_not_ready');
    const file = exportPath(env.dataRoot, owner, row.id), stat = await lstat(file).catch(() => null);
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size !== row.outputBytes) throw new EditorError(503, 'video_edit_storage_unavailable');
    await confirm(env, 'export', owner)();
    res.set('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="video-${row.variant}-${row.id}.mp4"`);
    sendFile(req, res, file, { bytes: row.outputBytes, type: 'video/mp4' });
  }));
}
