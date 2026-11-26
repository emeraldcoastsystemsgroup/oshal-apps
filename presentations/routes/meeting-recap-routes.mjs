/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: mount owner-scoped Meeting Recap HTTP routes at /api/presentations/recap under existing document.* and legacy.access permissions with strictly read-only GET handlers.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { access, legacyAccess } from './office-editor/authorization.mjs';
import { normalizeCropMode, safeMediaExt } from './meeting-recap/recap-media.mjs';
import { executeRecapPipeline, saveRecapDeckToFiles } from './meeting-recap/recap-runner.mjs';
import {
  appendMediaChunk,
  deleteOwnerRecap,
  ensureJobWorkspace,
  getOwnerRecap,
  insertRecapRow,
  isValidJobId,
  listOwnerRecaps,
  removeJobWorkspace,
  resolveArtifactFile,
  saveTranscriptText,
  serializeRecapRow,
  updateRecapRow,
} from './meeting-recap/recap-store.mjs';

const require = createRequire(import.meta.url);
const { Router, json, raw } = require('express');

const ASSETS = new Map([
  ['meeting-recap.mjs', 'text/javascript; charset=utf-8'],
  ['meeting-recap.css', 'text/css; charset=utf-8'],
]);
const SPOOF_KEYS = new Set(['tenant', 'tenantid', 'owner', 'ownersub', 'issuer', 'workspace']);
const SPOOF_HEADERS = ['x-oshal-tenant-id', 'x-tenant-id'];
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_INLINE_MEDIA_BYTES = 10 * 1024 * 1024;
const jsonBody = json({ limit: '15mb', strict: true });
const rawChunkBody = raw({ type: () => true, limit: MAX_CHUNK_BYTES });

/** Run Express middleware cleanly in both live Express and host-process shim. */
function runMiddleware(mw, req, res) {
  return new Promise((resolve, reject) => mw(req, res, (err) => (err ? reject(err) : resolve())));
}

/** Reject caller-supplied tenant/owner spoofing headers, query params, or JSON keys with 400. */
function rejectSpoofedScope(req) {
  const headers = req.headers || {};
  for (const name of SPOOF_HEADERS) {
    if (headers[name] !== undefined && String(headers[name]).trim() !== '') {
      const err = new Error('Caller-supplied tenant scope headers are not permitted.');
      err.code = 'recap_scope_spoof_rejected';
      err.status = 400;
      throw err;
    }
  }
  for (const bag of [req.query, req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object' ? req.body : null]) {
    if (!bag) continue;
    for (const key of Object.keys(bag)) {
      if (SPOOF_KEYS.has(key.toLowerCase())) {
        const err = new Error(`Caller-supplied scope field "${key}" is not permitted.`);
        err.code = 'recap_scope_spoof_rejected';
        err.status = 400;
        throw err;
      }
    }
  }
}

/** Verify active original actor, required document.* permission, and optional legacy.access. */
async function authorizeRecap(ctx, action, requireLegacy = false) {
  const original = await access(ctx, action);
  if (requireLegacy && !(await legacyAccess(ctx))) {
    const err = new Error('Your current role does not allow this Meeting Recap action.');
    err.code = 'office_permission_denied';
    err.status = 403;
    throw err;
  }
  return original;
}

/** Map structured errors into clean HTTP JSON responses. */
function sendError(res, err) {
  if (res.headersSent) return;
  const status = Number.isInteger(err?.status) ? err.status : (err?.statusCode || 500);
  const code = err?.code || 'recap_request_failed';
  const message = String(err?.message || 'Meeting recap request failed.');
  res.status(status).json({ error: code, message });
}

/** Extract binary chunk bytes from raw Buffer or JSON `{ chunkBase64 }` payload. */
function extractChunkBuffer(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const ct = String(req.headers?.['content-type'] || '').toLowerCase();
  if (ct.includes('application/json') && req.body && typeof req.body.chunkBase64 === 'string') {
    return Buffer.from(req.body.chunkBase64, 'base64');
  }
  if (typeof req.body === 'string' && req.body.length) return Buffer.from(req.body, 'base64');
  return null;
}

/** Sanitize download attachment filename header. */
function attachmentHeader(name) {
  const safe = String(name).replace(/[^A-Za-z0-9_.\-]/g, '_').slice(0, 120);
  return `attachment; filename="${safe}"`;
}

/** Validate and decode optional inline base64 media payload for small single-request uploads. */
function decodeInlineMedia(rawBase64) {
  if (typeof rawBase64 !== 'string' || !rawBase64.trim()) return null;
  const buf = Buffer.from(rawBase64.trim(), 'base64');
  if (!buf.length || buf.length > MAX_INLINE_MEDIA_BYTES) {
    const err = new Error('Inline mediaBase64 must be between 1 byte and 10 MiB; use chunked mode for larger recordings.');
    err.code = 'recap_payload_limit';
    err.status = 413;
    throw err;
  }
  return buf;
}

/** Handle POST /jobs (single-shot base64 intake or multi-GB chunked upload init). */
async function handleCreateJob(ctx, original, req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const filename = path.basename(String(body.sourceFilename || body.filename || '').trim());
  const ext = safeMediaExt(filename);
  if (!ext) {
    res.status(400).json({ error: 'invalid_media_filename', message: 'Upload an .mp4, .mov, .webm, .mkv, .wav, .mp3, or .m4a recording.' });
    return;
  }
  const title = String(body.title || filename.replace(/\.[^.]+$/, '') || 'Meeting Recap').trim().slice(0, 140);
  const crop = normalizeCropMode(body.cropMode, body.customCrop);
  const interval = body.sampleIntervalSec === 'auto' || body.sampleIntervalSec == null ? 15 : Math.max(1, Math.min(60, Math.round(Number(body.sampleIntervalSec) || 15)));
  const theme = String(body.theme || 'executive').trim().slice(0, 60) || 'executive';
  const id = randomUUID();
  const mode = body.mode === 'chunked' ? 'chunked' : 'inline';
  const inlineBuf = mode === 'inline' ? decodeInlineMedia(body.mediaBase64) : null;

  ensureJobWorkspace(original.sub, id);
  let bytes = 0;
  if (inlineBuf) bytes = (await appendMediaChunk(original.sub, id, ext, inlineBuf)).totalBytes;
  if (typeof body.transcriptText === 'string' && body.transcriptText.trim()) {
    await saveTranscriptText(original.sub, id, body.transcriptText, body.transcriptFormat || 'auto');
  }
  await insertRecapRow(ctx.pool, {
    id, ownerSub: original.sub, title, sourceFilename: filename, sourceBytes: bytes,
    status: 'queued', stageMessage: mode === 'chunked' ? 'Awaiting media chunks' : 'Recording received',
    cropMode: crop.mode, sampleIntervalSec: interval, theme, meta: { mode },
  });

  if (mode === 'inline' && inlineBuf && body.autoRun !== false) {
    const row = await getOwnerRecap(ctx.pool, original.sub, id);
    await executeRecapPipeline(ctx, original.sub, row, {
      cropMode: crop.mode, customCrop: body.customCrop, sampleIntervalSec: body.sampleIntervalSec ?? 'auto',
      theme, useAiSummary: Boolean(body.useAiSummary), transcriptText: body.transcriptText,
      transcriptFormat: body.transcriptFormat,
    });
  }
  const fresh = await getOwnerRecap(ctx.pool, original.sub, id);
  res.status(201).json({ job: serializeRecapRow(fresh, true) });
}

/** Handle POST /jobs/:id/chunk (stream-safe raw binary append to owner workspace). */
async function handleAppendChunk(ctx, original, req, res) {
  const row = await getOwnerRecap(ctx.pool, original.sub, req.params.id);
  if (!row) { res.status(404).json({ error: 'recap_not_found', message: 'Meeting recap not found.' }); return; }
  const ext = safeMediaExt(row.source_filename);
  const chunk = extractChunkBuffer(req);
  if (!chunk || !chunk.length || chunk.length > MAX_CHUNK_BYTES) {
    res.status(400).json({ error: 'invalid_chunk', message: 'Send a non-empty binary media chunk up to 16 MiB.' });
    return;
  }
  const { totalBytes } = await appendMediaChunk(original.sub, row.id, ext, chunk);
  await updateRecapRow(ctx.pool, original.sub, row.id, {
    sourceBytes: totalBytes,
    stageMessage: `Uploaded ${(totalBytes / (1024 * 1024)).toFixed(1)} MiB`,
  });
  res.json({ ok: true, id: row.id, bytesReceived: chunk.length, totalBytes });
}

/** Handle POST /jobs/:id/run (execute or re-run the 7-stage recap pipeline). */
async function handleRunJob(ctx, original, req, res) {
  const row = await getOwnerRecap(ctx.pool, original.sub, req.params.id);
  if (!row) { res.status(404).json({ error: 'recap_not_found', message: 'Meeting recap not found.' }); return; }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof body.transcriptText === 'string' && body.transcriptText.trim()) {
    await saveTranscriptText(original.sub, row.id, body.transcriptText, body.transcriptFormat || 'auto');
  }
  await executeRecapPipeline(ctx, original.sub, row, {
    cropMode: body.cropMode, customCrop: body.customCrop, sampleIntervalSec: body.sampleIntervalSec,
    theme: body.theme, useAiSummary: Boolean(body.useAiSummary),
    transcriptText: body.transcriptText, transcriptFormat: body.transcriptFormat,
  });
  const fresh = await getOwnerRecap(ctx.pool, original.sub, row.id);
  res.json({ ok: true, job: serializeRecapRow(fresh, true) });
}

/** Handle GET /jobs/:id/artifacts/:name (strict allowlist, read-only, owner-scoped). */
async function handleDownloadArtifact(ctx, original, req, res) {
  const row = await getOwnerRecap(ctx.pool, original.sub, req.params.id);
  if (!row) { res.status(404).json({ error: 'recap_not_found', message: 'Meeting recap not found.' }); return; }
  const resolved = resolveArtifactFile(original.sub, row.id, req.params.name);
  if (!resolved || !existsSync(resolved.filePath)) {
    res.status(404).json({ error: 'artifact_not_found', message: 'Requested recap artifact is not available.' });
    return;
  }
  const bytes = await readFile(resolved.filePath);
  res.setHeader('Content-Type', resolved.mime);
  res.setHeader('Cache-Control', 'private, no-store');
  if (!resolved.name.endsWith('.png')) res.setHeader('Content-Disposition', attachmentHeader(resolved.name));
  res.send(bytes);
}

/** Register own-scoped documents resource adapter idempotently with host authorization. */
function registerDocumentsResource(ctx) {
  if (typeof ctx.authorization?.registerResource !== 'function') return;
  ctx.authorization.registerResource('documents', {
    authorize: ({ actor: a, operation, grant }) =>
      a.isActive === true && typeof a.issuer === 'string' && Boolean(a.issuer)
      && typeof a.sub === 'string' && Boolean(a.sub)
      && typeof a.principalId === 'string' && Boolean(a.principalId)
      && Array.isArray(a.tenantIds) && a.tenantIds.length === 1
      && grant.scope === 'own' && !grant.fields && !operation.tenantId,
  });
}

/** Handle DELETE /jobs/:id removing both DB row and owner workspace directory. */
async function handleDeleteJob(ctx, original, req, res) {
  if (!isValidJobId(req.params.id)) { res.status(404).json({ error: 'recap_not_found', message: 'Meeting recap not found.' }); return; }
  const removed = await deleteOwnerRecap(ctx.pool, original.sub, req.params.id);
  if (!removed) { res.status(404).json({ error: 'recap_not_found', message: 'Meeting recap not found.' }); return; }
  removeJobWorkspace(original.sub, req.params.id);
  res.json({ ok: true, id: req.params.id });
}

/** Create the Meeting Recap Express router mounted at /api/presentations/recap. */
export function createMeetingRecapRoutes(ctx) {
  registerDocumentsResource(ctx);
  const router = Router();
  const toolsDir = path.resolve(ctx.appPackageDir, 'tools');
  const wrap = (action, requireLegacy, parser, fn) => async (req, res) => {
    try {
      const original = await authorizeRecap(ctx, action, requireLegacy);
      if (parser) await runMiddleware(parser, req, res);
      rejectSpoofedScope(req);
      await fn(req, res, original);
    } catch (err) {
      sendError(res, err);
    }
  };

  router.get('/app', wrap('view', false, null, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(toolsDir, 'meeting-recap.html'));
  }));
  router.get('/assets/:name', wrap('view', false, null, (req, res) => {
    const mime = ASSETS.get(String(req.params.name || ''));
    if (!mime) { res.status(404).json({ error: 'recap_asset_missing' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', mime);
    res.sendFile(path.join(toolsDir, req.params.name));
  }));
  router.get('/jobs', wrap('read', false, null, async (_req, res, o) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ jobs: await listOwnerRecaps(ctx.pool, o.sub) });
  }));
  router.post('/jobs', wrap('create', true, jsonBody, (req, res, o) => handleCreateJob(ctx, o, req, res)));
  router.post('/jobs/:id/chunk', wrap('change', true, rawChunkBody, (req, res, o) => handleAppendChunk(ctx, o, req, res)));
  router.post('/jobs/:id/run', wrap('change', true, jsonBody, (req, res, o) => handleRunJob(ctx, o, req, res)));
  router.get('/jobs/:id', wrap('read', false, null, async (req, res, o) => {
    res.setHeader('Cache-Control', 'no-store');
    const row = await getOwnerRecap(ctx.pool, o.sub, req.params.id);
    if (!row) { res.status(404).json({ error: 'recap_not_found', message: 'Meeting recap not found.' }); return; }
    res.json({ job: serializeRecapRow(row, true) });
  }));
  router.get('/jobs/:id/artifacts/:name', wrap('export', false, null, (req, res, o) => handleDownloadArtifact(ctx, o, req, res)));
  router.post('/jobs/:id/save', wrap('export', true, jsonBody, async (req, res, o) => {
    const row = await getOwnerRecap(ctx.pool, o.sub, req.params.id);
    if (!row) { res.status(404).json({ error: 'recap_not_found', message: 'Meeting recap not found.' }); return; }
    res.json(await saveRecapDeckToFiles(ctx, o.sub, row, req.body || {}));
  }));
  router.delete('/jobs/:id', wrap('delete', false, null, (req, res, o) => handleDeleteJob(ctx, o, req, res)));
  return router;
}
