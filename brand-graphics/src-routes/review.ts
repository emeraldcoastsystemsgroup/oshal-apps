/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: serve review surface plus owner-scoped Brand Graphics render creation, job status, MP4 download, and personal brand kit endpoints (CREATE-TOOL-BRAND-04, -05, -06, -07).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Router, json, type Request, type Response } from 'express';
import { requireRenderOwner } from './render-auth';
import { detectRendererCapabilities, renderBrandClipToFile } from './render-ffmpeg';
import {
  assertJobId,
  deleteRenderJob,
  getRenderJob,
  listRenderJobs,
  mp4FilePath,
  resolveOwnerBrandKit,
  saveBrandKit,
  saveRenderJob,
} from './render-store';
import {
  ASPECT_CHOICES,
  FORMAT_CHOICES,
  MUSIC_CHOICES,
  RenderError,
  parseBrandKitPatch,
  validateRenderInput,
  type RenderJobRecord,
} from './render-types';

const parseJson = json({ limit: '64kb', strict: true });

function sendError(res: Response, error: unknown): void {
  if (error instanceof RenderError) {
    res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    return;
  }
  const status = (error as any)?.status;
  if (status === 413) {
    res.status(413).json({ ok: false, error: 'payload_too_large', message: 'Request body exceeds 64 KB limit.' });
    return;
  }
  if (status === 400) {
    res.status(400).json({ ok: false, error: 'invalid_json', message: 'Malformed JSON body.' });
    return;
  }
  res.status(500).json({ ok: false, error: 'render_route_error', message: 'Brand Graphics request failed.' });
}

function slugifyTitle(title: string): string {
  const clean = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return clean || 'brand-clip';
}

function statusSummary(jobs: RenderJobRecord[]): string {
  if (!jobs.length) return 'No brand graphic renders recorded yet.';
  const latest = jobs[0];
  return `Latest build "${latest.title}" (${latest.aspect}, ${latest.durationSec}s, ${latest.brandKit.brandName}) is ${latest.status}.`;
}

function dataDirOf(ctx: any): string | undefined {
  return typeof ctx?.brandGraphicsDataDir === 'string' ? ctx.brandGraphicsDataDir : undefined;
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    fn(req, res).catch((error) => sendError(res, error));
  };
}

async function handleGetBrandKit(ctx: any, req: Request, res: Response): Promise<void> {
  const owner = await requireRenderOwner(ctx, req, ['app.open', 'legacy.read']);
  const brandKit = await resolveOwnerBrandKit(ctx, owner, 'my-brand', null, dataDirOf(ctx));
  res.json({ ok: true, brandKit });
}

async function handleSaveBrandKit(ctx: any, req: Request, res: Response): Promise<void> {
  const owner = await requireRenderOwner(ctx, req, ['app.open', 'source.change']);
  const patch = parseBrandKitPatch(req.body);
  if (!patch) throw new RenderError(400, 'invalid_brand_kit', 'Provide brand kit fields to save.');
  const brandKit = saveBrandKit(owner, patch, dataDirOf(ctx));
  res.json({ ok: true, brandKit });
}

async function handleListRenders(ctx: any, req: Request, res: Response): Promise<void> {
  const owner = await requireRenderOwner(ctx, req, ['app.open', 'legacy.read']);
  const jobs = listRenderJobs(owner, dataDirOf(ctx));
  const caps = detectRendererCapabilities(ctx);
  res.json({
    ok: true,
    jobs,
    count: jobs.length,
    latest: jobs[0] || null,
    summary: statusSummary(jobs),
    capabilities: {
      available: caps.available,
      localFfmpeg: caps.localFfmpeg,
      workerReady: caps.workerReady,
      aspects: [...ASPECT_CHOICES],
      formats: [...FORMAT_CHOICES],
      musicChoices: [...MUSIC_CHOICES],
      minDurationSec: 5,
      maxDurationSec: 60,
    },
  });
}

async function handleCreateRender(ctx: any, req: Request, res: Response): Promise<void> {
  const owner = await requireRenderOwner(ctx, req, ['app.open', 'legacy.execute']);
  const input = validateRenderInput(req.body);
  const caps = detectRendererCapabilities(ctx);
  if (!caps.available) {
    throw new RenderError(
      503,
      'worker_unavailable',
      'No render worker or local renderer is available on this installation, so nothing was queued.',
    );
  }
  const dir = dataDirOf(ctx);
  const brandKit = await resolveOwnerBrandKit(ctx, owner, input.brandStyle, input.brandKit, dir);
  const id = crypto.randomUUID();
  const targetMp4 = mp4FilePath(owner, id, dir);
  const rendered = await renderBrandClipToFile(ctx, input, brandKit, targetMp4);
  const now = new Date().toISOString();
  const downloadPath = `/api/brand-graphics/renders/${id}/download`;
  const job: RenderJobRecord = {
    id,
    status: 'done',
    title: input.title,
    brief: input.brief,
    sourceLink: input.sourceLink,
    brandMode: input.brandMode,
    voiceover: input.voiceover,
    music: input.music,
    brandStyle: input.brandStyle,
    brandKit,
    durationSec: input.durationSec,
    aspect: input.aspect,
    width: rendered.width,
    height: rendered.height,
    format: input.format,
    fileName: `${slugifyTitle(input.title)}-${input.aspect.replace(':', 'x')}.mp4`,
    fileBytes: rendered.fileBytes,
    previewUrl: downloadPath,
    downloadUrl: `${downloadPath}?download=1`,
    renderer: rendered.renderer,
    createdAt: now,
    updatedAt: now,
  };
  saveRenderJob(owner, job, dir);
  res.status(201).json({ ok: true, job, previewUrl: job.previewUrl, downloadUrl: job.downloadUrl });
}

async function handleGetRender(ctx: any, req: Request, res: Response): Promise<void> {
  const owner = await requireRenderOwner(ctx, req, ['app.open', 'legacy.read']);
  const job = getRenderJob(owner, assertJobId(req.params.id), dataDirOf(ctx));
  if (!job) throw new RenderError(404, 'render_not_found', 'Render job was not found for this account.');
  res.json({ ok: true, job });
}

async function handleDownloadRender(ctx: any, req: Request, res: Response): Promise<void> {
  const owner = await requireRenderOwner(ctx, req, ['app.open', 'legacy.read']);
  const id = assertJobId(req.params.id);
  const dir = dataDirOf(ctx);
  const job = getRenderJob(owner, id, dir);
  if (!job) throw new RenderError(404, 'render_not_found', 'Render job was not found for this account.');
  const clip = mp4FilePath(owner, id, dir);
  if (!fs.existsSync(clip)) throw new RenderError(404, 'render_file_missing', 'Rendered MP4 file is missing.');
  res.type('video/mp4');
  const disposition = req.query.download === '1' || req.query.download === 'true' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${job.fileName}"`);
  res.sendFile(clip);
}

async function handleDeleteRender(ctx: any, req: Request, res: Response): Promise<void> {
  const owner = await requireRenderOwner(ctx, req, ['app.open', 'legacy.execute']);
  const deleted = deleteRenderJob(owner, assertJobId(req.params.id), dataDirOf(ctx));
  if (!deleted) throw new RenderError(404, 'render_not_found', 'Render job was not found for this account.');
  res.json({ ok: true, deleted: true });
}

export function createReviewRoutes(ctx: any): Router {
  const router = Router();
  const packageDir = ctx?.appPackageDir;
  router.get('/review', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(packageDir!, 'tools/review.html'));
  });
  router.get('/brand-kit', wrap((req, res) => handleGetBrandKit(ctx, req, res)));
  router.put('/brand-kit', parseJson, wrap((req, res) => handleSaveBrandKit(ctx, req, res)));
  router.get('/renders', wrap((req, res) => handleListRenders(ctx, req, res)));
  router.post('/renders', parseJson, wrap((req, res) => handleCreateRender(ctx, req, res)));
  router.get('/renders/:id', wrap((req, res) => handleGetRender(ctx, req, res)));
  router.get('/renders/:id/download', wrap((req, res) => handleDownloadRender(ctx, req, res)));
  router.delete('/renders/:id', wrap((req, res) => handleDeleteRender(ctx, req, res)));
  router.use((error: unknown, _req: Request, res: Response, _next: any) => sendError(res, error));
  return router;
}
