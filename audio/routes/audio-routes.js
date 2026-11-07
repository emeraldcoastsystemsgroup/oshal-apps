/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Studio surface, CAS media streaming, famous voice TTS synthesis, and live stream modulation routes for Audio Studio.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Enforce two-arm owner verification and HTTP 206 byte-range streaming on /blobs/:hash, wire real Kokoro TTS + voice persona DSP, and support container/PCM live modulation.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

let createRouter;
let jsonMiddleware;
try {
  const express = require('express');
  createRouter = express.Router;
  jsonMiddleware = express.json;
} catch {
  const mini = require('../lib/router.js');
  createRouter = mini.createRouter;
  jsonMiddleware = () => (_req, _res, next) => next();
}

const { createAudioRepository } = require('../lib/db.js');
const { BlobStore } = require('../lib/blob_store.js');
const DSPEngine = require('../lib/dsp_engine.js');
const { decodeLivePayload, synthesizeSpeechViaService } = require('../lib/audio_io.js');
const { authorizeRequest } = require('../lib/security.js');
const { createHomeSummaryRoutes } = require('./home-summary.js');
const { createAudioEditorRoutes, renderProjectMixdownToCas, ingestStemPayload, compactPeaks } = require('./audio-editor-routes.js');

function serveStudioAsset(pkgDir, toolsDir, req, res) {
  const rawName = path.basename(req.params.file || req.params.asset || req.path || '');
  const aliasMap = {
    'style.css': path.join(toolsDir, 'audio.css'),
    'audio.css': path.join(toolsDir, 'audio.css'),
    'app.js': path.join(toolsDir, 'audio.js'),
    'audio.js': path.join(toolsDir, 'audio.js'),
    'audio-ui-helpers.js': path.join(toolsDir, 'audio-ui-helpers.js'),
    'editor-handoff.mjs': path.join(toolsDir, 'editor-handoff.mjs'),
    'dsp_engine.js': path.join(pkgDir, 'lib', 'dsp_engine.js'),
    'dsp_synth.js': path.join(pkgDir, 'lib', 'dsp_synth.js'),
  };
  const filePath = aliasMap[rawName] || path.join(toolsDir, rawName);
  if (!filePath.startsWith(toolsDir) && !filePath.startsWith(path.join(pkgDir, 'lib'))) {
    return res.status(404).send('Asset not found');
  }
  if (!fs.existsSync(filePath)) return res.status(404).send('Asset not found');
  if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(filePath);
}

function sendBlobWithRange(req, res, blob, mimeType) {
  const buf = blob.data;
  const total = buf.length;
  res.setHeader('Content-Type', mimeType || blob.mimeType || 'audio/wav');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const rangeHeader = req.headers?.range;
  if (typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
    const [startStr, endStr] = rangeHeader.slice(6).split('-');
    const start = startStr ? parseInt(startStr, 10) : 0;
    const end = endStr ? Math.min(total - 1, parseInt(endStr, 10)) : total - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= total || end < start) {
      res.setHeader('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    const slice = buf.subarray(start, end + 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(slice.length));
    return res.send(slice);
  }
  res.setHeader('Content-Length', String(total));
  return res.send(buf);
}

function registerProjectRoutes(router, ctx, repo, blobStore) {
  router.get('/projects', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'studio.read');
    if (!actor) return;
    res.json({ projects: await repo.listProjects(actor) });
  });

  router.post('/projects', jsonMiddleware(), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.create');
    if (!actor) return;
    const { title, tempo, sampleRate } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
    const project = await repo.createProject(actor, { title: title.trim(), tempo: tempo || 120, sampleRate: sampleRate || 48000 });
    res.status(201).json({ project });
  });

  router.get('/projects/:id', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'studio.read');
    if (!actor) return;
    const project = await repo.getProject(actor, req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    res.json({ project });
  });

  router.post('/projects/:id/stems', jsonMiddleware({ limit: '50mb' }), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.change');
    if (!actor) return;
    const project = await repo.getProject(actor, req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!req.body?.name || !req.body?.audioBase64) return res.status(400).json({ error: 'name and audioBase64 required' });
    try {
      const out = await ingestStemPayload(repo, blobStore, actor, project, req.body);
      res.status(201).json({ stem: out.stem, blob: out.blob, blobHash: out.blobHash });
    } catch (err) {
      res.status(err.status || 422).json({ error: err.code || 'stem_ingest_failed', message: err.message });
    }
  });
}

function registerMixdownAndBlobRoutes(router, ctx, repo, blobStore) {
  router.get('/projects/:id/mixdown', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'studio.read');
    if (!actor) return;
    const mixdowns = await repo.listMixdowns(actor, req.params.id);
    res.json({ mixdowns, latest: mixdowns[0] || null });
  });

  router.post('/projects/:id/mixdown', jsonMiddleware(), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.export');
    if (!actor) return;
    const project = await repo.getProject(actor, req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    try {
      res.status(201).json(await renderProjectMixdownToCas(repo, blobStore, actor, project, req.body || {}));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.code || 'render_failed', message: err.message });
    }
  });

  router.get('/blobs/:hash', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'studio.read');
    if (!actor) return;
    let owned;
    try { owned = await repo.getOwnedBlobMeta(actor, req.params.hash); } catch { return res.status(404).json({ error: 'blob_not_found' }); }
    if (!owned) return res.status(404).json({ error: 'blob_not_found' });
    const blob = blobStore.get(req.params.hash, owned.mime_type);
    if (!blob) return res.status(404).json({ error: 'blob_not_found' });
    return sendBlobWithRange(req, res, blob, owned.mime_type);
  });
}

function registerVoiceRoutes(router, ctx, repo, blobStore) {
  router.get('/personas', async (req, res) => {
    if (!(await authorizeRequest(ctx, req, res, 'studio.view'))) return;
    res.json({
      personas: Object.entries(DSPEngine.VOICE_PERSONAS).map(([key, p]) => ({
        key, name: p.name, description: p.description, semitones: p.semitones, tubeWarmthDb: p.tubeWarmthDb,
      })),
    });
  });

  router.post('/tts/generate', jsonMiddleware({ limit: '10mb' }), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.create');
    if (!actor) return;
    const { text, persona, projectId, trackName } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text_required', message: 'Non-empty text is required for speech synthesis.' });
    }
    const personaKey = persona || 'morgan_freeman';
    try {
      const synth = await synthesizeSpeechViaService({ text: text.trim(), personaKey, sampleRate: 48000 });
      const blob = blobStore.put(synth.wavBuffer, 'audio/wav');
      await repo.upsertBlob(actor, blob);
      let stem = null;
      const project = projectId ? await repo.getProject(actor, projectId) : null;
      if (project) {
        const decoded = DSPEngine.decodeWav(synth.wavBuffer);
        stem = await repo.addStem(actor, project.id, {
          name: `${personaKey}_voice.wav`, trackName: trackName || 'vocals', blobHash: blob.hash,
          durationSeconds: synth.durationSeconds, sampleRate: synth.sampleRate, channels: 2, hpf: true, peaks: compactPeaks(decoded.channels[0], 140),
        });
      }
      res.status(201).json({ stem, blobHash: blob.hash, byteSize: blob.byteSize, durationSeconds: synth.durationSeconds, downloadUrl: `/api/audio/blobs/${blob.hash}`, persona: personaKey });
    } catch (err) {
      res.status(err.status || 503).json({ error: err.code || 'speech_service_unavailable', message: err.message });
    }
  });
}

function registerLiveStreamRoutes(router, ctx, repo, blobStore) {
  router.post('/live/modulate', jsonMiddleware({ limit: '20mb' }), async (req, res) => {
    if (!(await authorizeRequest(ctx, req, res, 'studio.view'))) return;
    const { audioBase64, persona, pitchShiftSemitones, tubeDriveDb, gateThresholdDb, outputFormat } = req.body || {};
    if (!audioBase64) return res.status(400).json({ error: 'audioBase64_required' });
    try {
      const inBuf = Buffer.from(String(audioBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
      const { pcm, sampleRate } = decodeLivePayload(inBuf, 48000);
      const startNs = process.hrtime.bigint();
      const processed = DSPEngine.applyLiveModulationRack(pcm, sampleRate, { persona, pitchShiftSemitones, tubeDriveDb, gateThresholdDb });
      const latencyMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      const outBytes = outputFormat === 'wav' ? Buffer.from(DSPEngine.encodeWav([processed, processed], sampleRate)) : Buffer.from(processed.buffer, processed.byteOffset, processed.byteLength);
      res.json({ processedAudioBase64: outBytes.toString('base64'), format: outputFormat === 'wav' ? 'wav' : 'f32le', sampleRate, sampleCount: processed.length, latencyMs: Number(latencyMs.toFixed(2)) });
    } catch (err) {
      res.status(err.status || 422).json({ error: err.code || 'live_modulate_failed', message: err.message });
    }
  });

  router.post('/live/publish', jsonMiddleware({ limit: '50mb' }), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.export');
    if (!actor) return;
    const { projectId, audioBase64, name, synthesizePersona } = req.body || {};
    if (!projectId || !audioBase64) return res.status(400).json({ error: 'projectId and audioBase64 are required' });
    const project = await repo.getProject(actor, projectId);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    try {
      const inBuf = Buffer.from(String(audioBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
      const sr = project.sampleRate || 48000;
      let { pcm } = decodeLivePayload(inBuf, sr);
      if (synthesizePersona && synthesizePersona !== 'none') pcm = DSPEngine.applyVoicePersona(pcm, sr, synthesizePersona);
      const left = new Float32Array(pcm), right = new Float32Array(pcm);
      const stats = DSPEngine.normalizeStereoLoudness(left, right, -14.0, -1.0, sr);
      const mixBlob = blobStore.put(Buffer.from(DSPEngine.encodeWav([left, right], sr)), 'audio/wav');
      await repo.upsertBlob(actor, mixBlob);
      const mixdown = await repo.recordMixdown(actor, project.id, {
        blobHash: mixBlob.hash, format: 'wav', durationSeconds: Number((left.length / sr).toFixed(3)), sampleRate: sr,
        lufsIntegrated: Number(stats.lufsIntegrated.toFixed(2)), truePeakDb: Number(stats.truePeakDb.toFixed(2)),
      });
      res.status(201).json({ success: true, published: true, mixdown, downloadUrl: `/api/audio/blobs/${mixBlob.hash}` });
    } catch (err) {
      res.status(err.status || 422).json({ error: err.code || 'live_publish_failed', message: err.message });
    }
  });
}

function createAudioRoutes(ctx) {
  const router = createRouter();
  const pkgDir = ctx?.appPackageDir || path.resolve(__dirname, '..');
  const toolsDir = path.join(pkgDir, 'tools');
  const blobStore = ctx?.blobStore || new BlobStore(ctx?.vaultDir);
  const repo = ctx?.repo || createAudioRepository(ctx);
  const sharedSubCtx = Object.assign({}, ctx, { appPackageDir: pkgDir, repo, blobStore });

  router.use('/home-summary', createHomeSummaryRoutes(sharedSubCtx));
  router.use('/editor', createAudioEditorRoutes(sharedSubCtx));

  router.get('/ui', async (req, res) => {
    if (!(await authorizeRequest(ctx, req, res, 'studio.view'))) return;
    res.sendFile(path.join(toolsDir, 'audio.html'));
  });

  const assetHandler = async (req, res) => {
    if (!(await authorizeRequest(ctx, req, res, 'studio.view'))) return;
    serveStudioAsset(pkgDir, toolsDir, req, res);
  };
  for (const assetRoute of ['/ui/:asset', '/assets/:file', '/audio.css', '/style.css', '/audio.js', '/app.js', '/audio-ui-helpers.js', '/dsp_engine.js', '/dsp_synth.js', '/editor-handoff.mjs']) {
    router.get(assetRoute, assetHandler);
  }

  registerProjectRoutes(router, ctx, repo, blobStore);
  registerMixdownAndBlobRoutes(router, ctx, repo, blobStore);
  registerVoiceRoutes(router, ctx, repo, blobStore);
  registerLiveStreamRoutes(router, ctx, repo, blobStore);
  return router;
}

module.exports = { createAudioRoutes };
