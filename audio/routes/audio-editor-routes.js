/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Multitrack editor, CAS stem ingestion, optimistic revision operations, stereo mixdown rendering, and side-by-side concierge routes.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Replace synthetic/raw-buffer stubs with real WAV/FFmpeg stem decoding, 5-stage ADR-208 multitrack DSP rendering, WAV/MP3 export, and two-arm owner isolation.
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
const { decodeAudioBuffer, encodeMixdownOutput } = require('../lib/audio_io.js');
const { authorizeRequest } = require('../lib/security.js');
const { MACRO_PRESETS, selectTargetStems, applyStemInstruction, buildStemDirectives } = require('./audio-macro-presets.js');

const EDITING_CONTRACT = {
  contractVersion: '2.1.0',
  operations: [
    { type: 'rename', description: 'Update project title', parameters: { title: 'string (1-120 chars)' } },
    { type: 'setTempo', description: 'Set session tempo in BPM', parameters: { tempo: 'number (20-300)' } },
    { type: 'setMaster', description: 'Configure master bus gain and target LUFS', parameters: { masterGainDb: 'number', targetLufs: 'number' } },
    { type: 'addTrack', description: 'Add a stem track with optional instrument synthesis or CAS blobHash', parameters: { name: 'string', instrument: 'string', volume: 'number', pan: 'number' } },
    { type: 'setVolume', description: 'Set linear volume or dB gain for a stem', parameters: { trackId: 'string', volume: 'number', gainDb: 'number' } },
    { type: 'setPan', description: 'Set constant-power stereo pan (-1..1)', parameters: { trackId: 'string', pan: 'number' } },
    { type: 'mute', description: 'Mute or unmute a stem', parameters: { trackId: 'string', muted: 'boolean' } },
    { type: 'solo', description: 'Solo or unsolo a stem', parameters: { trackId: 'string', solo: 'boolean' } },
    { type: 'setEffect', description: 'Configure equalizer, compressor, reverb, distortion, or highpass', parameters: { trackId: 'string', effect: 'string', parameters: 'object' } },
    { type: 'setChannelStrip', description: 'Update full 5-stage channel strip settings on a stem', parameters: { trackId: 'string', config: 'object' } },
    { type: 'applyMacro', description: 'Apply an ADR-208 standard formula macro preset', parameters: { trackId: 'string', macro: 'clean_voice | auto_duck_music | broadcast_master | acoustic_space | vintage_warmth | punchy_drums' } },
    { type: 'trimClip', description: 'Non-destructively trim start/end and fades on a stem', parameters: { trackId: 'string', trimStartSec: 'number', trimEndSec: 'number', fadeInSec: 'number', fadeOutSec: 'number' } },
    { type: 'moveClip', description: 'Shift stem start offset in seconds', parameters: { trackId: 'string', offsetSec: 'number' } },
    { type: 'splitClip', description: 'Split a stem at splitSec into two independent stems', parameters: { trackId: 'string', splitSec: 'number' } },
    { type: 'removeTrack', description: 'Remove a stem track from the project', parameters: { trackId: 'string' } },
  ],
  macros: Object.keys(MACRO_PRESETS),
  dspEffects: {
    equalizer: { bands: ['low', 'mid', 'high'], gainRangeDb: [-24, 24] },
    reverb: { decayRange: [0.2, 6.0], mixRange: [0.0, 1.0] },
    compressor: { thresholdRangeDb: [-60, 0], ratioRange: [1, 20] },
    distortion: { modes: ['bypass', 'tube', 'overdrive', 'bitcrusher'], driveRangeDb: [0, 24] },
    highpass: { frequencyHz: 85, order: 2 },
  },
  limits: {
    maxTracks: 32,
    maxStemsPerTrack: 8,
    maxDurationSeconds: 7200,
    supportedSampleRates: [44100, 48000],
    maxBatchOperations: 32,
  },
};

function compactPeaks(channelData, bins = 120) {
  const p = DSPEngine.computeWaveformPeaks(channelData, bins);
  const roundArr = (arr) => Array.from(arr, (v) => Number(v.toFixed(4)));
  return { bins: p.bins, peakAbs: Number(p.peakAbs.toFixed(4)), clipping: p.clipping, min: roundArr(p.min), max: roundArr(p.max), rms: roundArr(p.rms) };
}

function inferInstrumentFromName(name = '') {
  const s = String(name).toLowerCase();
  if (s.includes('drum') || s.includes('kick')) return 'drums';
  if (s.includes('bass')) return 'bass';
  if (s.includes('vocal') || s.includes('voice') || s.includes('mic') || s.includes('host') || s.includes('guest')) return 'vocals';
  if (s.includes('horn') || s.includes('brass')) return 'horns';
  if (s.includes('piano') || s.includes('key')) return 'piano';
  if (s.includes('guitar') || s.includes('synth')) return 'guitar';
  return null;
}

async function storeSynthesizedStemBlob(repo, blobStore, actor, sampleRate, instrument, durationSec = 4.0) {
  const pcm = instrument
    ? DSPEngine.generateSyntheticAudio(instrument, durationSec, sampleRate)
    : new Float32Array(Math.floor(sampleRate * 2.0));
  const wavBuf = Buffer.from(DSPEngine.encodeWav([pcm, pcm], sampleRate));
  const blob = blobStore.put(wavBuf, 'audio/wav');
  await repo.upsertBlob(actor, blob);
  return { blob, peaks: compactPeaks(pcm, 120), durationSeconds: pcm.length / sampleRate };
}

function applyEffectPatch(op) {
  const p = op.parameters || {};
  const patch = {};
  if (op.effect === 'equalizer') {
    if (p.low !== undefined) patch.eqLowDb = Number(p.low);
    if (p.mid !== undefined) patch.eqMidDb = Number(p.mid);
    if (p.high !== undefined) patch.eqHighDb = Number(p.high);
  } else if (op.effect === 'compressor') {
    if (p.ratio !== undefined) patch.compRatio = Number(p.ratio);
    if (p.threshold !== undefined) patch.compThresholdDb = Number(p.threshold);
    if (p.ducking !== undefined) patch.ducking = Boolean(p.ducking);
  } else if (op.effect === 'reverb') {
    if (p.mix !== undefined) patch.reverbMix = Number(p.mix);
  } else if (op.effect === 'distortion') {
    if (p.mode !== undefined) patch.distortionMode = String(p.mode);
    if (p.driveDb !== undefined) patch.driveDb = Number(p.driveDb);
  } else if (op.effect === 'highpass') {
    patch.hpf = Boolean(p.enabled !== false);
  }
  return patch;
}

async function executeProjectOperation(repo, blobStore, actor, project, op, state) {
  const sr = project.sampleRate || 48000;
  if (op.type === 'rename' && op.title) { state.title = String(op.title).slice(0, 120); return; }
  if (op.type === 'setTempo' && op.tempo !== undefined) { state.master.tempo = Math.max(20, Math.min(300, Number(op.tempo) || 120)); return; }
  if (op.type === 'setMaster') {
    if (op.masterGainDb !== undefined) state.master.masterGainDb = Number(op.masterGainDb);
    if (op.targetLufs !== undefined) state.master.targetLufs = Number(op.targetLufs);
    return;
  }
  if (['addTrack', 'track', 'addStem', 'stem'].includes(op.type)) {
    let blobHash = op.blobHash;
    let durationSeconds = Number(op.durationSeconds || 4.0);
    let peaks = null;
    if (!blobHash || !(await repo.getOwnedBlobMeta(actor, blobHash))) {
      const inst = op.instrument || inferInstrumentFromName(op.name || op.trackName);
      const gen = await storeSynthesizedStemBlob(repo, blobStore, actor, sr, inst, 4.0);
      blobHash = gen.blob.hash;
      durationSeconds = gen.durationSeconds;
      peaks = gen.peaks;
    }
    await repo.addStem(actor, project.id, Object.assign({}, op, {
      name: op.name || op.trackName || 'Track',
      trackName: op.trackName || op.role || op.name || 'Track',
      blobHash,
      sampleRate: sr,
      durationSeconds,
      peaks,
    }));
    return;
  }
  await executeTrackMutationOp(repo, actor, project, op, state);
}

async function executeTrackMutationOp(repo, actor, project, op, state) {
  if (op.type === 'applyMacro' && MACRO_PRESETS[op.macro]) {
    const preset = MACRO_PRESETS[op.macro];
    if (preset.masterPatch) Object.assign(state.master, preset.masterPatch);
    if (preset.trackPatch && op.trackId) await repo.updateStemConfig(actor, project.id, op.trackId, preset.trackPatch);
    return;
  }
  if (!op.trackId) return;
  if (op.type === 'setVolume') {
    const patch = {};
    if (op.volume !== undefined) patch.volume = Number(op.volume);
    if (op.gainDb !== undefined) patch.gainDb = Number(op.gainDb);
    else if (op.volume !== undefined) patch.gainDb = Number((20 * Math.log10(Math.max(0.001, Number(op.volume)))).toFixed(2));
    await repo.updateStemConfig(actor, project.id, op.trackId, patch);
  } else if (op.type === 'setPan' && op.pan !== undefined) {
    await repo.updateStemConfig(actor, project.id, op.trackId, { pan: Number(op.pan) });
  } else if (op.type === 'mute' && op.muted !== undefined) {
    await repo.updateStemConfig(actor, project.id, op.trackId, { muted: Boolean(op.muted) });
  } else if (op.type === 'solo' && op.solo !== undefined) {
    await repo.updateStemConfig(actor, project.id, op.trackId, { solo: Boolean(op.solo) });
  } else if (op.type === 'setEffect') {
    await repo.updateStemConfig(actor, project.id, op.trackId, applyEffectPatch(op));
  } else if (op.type === 'setChannelStrip' && op.config && typeof op.config === 'object') {
    await repo.updateStemConfig(actor, project.id, op.trackId, op.config);
  } else if (op.type === 'trimClip') {
    await repo.updateStemConfig(actor, project.id, op.trackId, {
      trimStartSec: op.trimStartSec, trimEndSec: op.trimEndSec, fadeInSec: op.fadeInSec, fadeOutSec: op.fadeOutSec,
    });
  } else if (op.type === 'moveClip' && op.offsetSec !== undefined) {
    await repo.updateStemConfig(actor, project.id, op.trackId, { offsetSec: Number(op.offsetSec) });
  } else if (op.type === 'splitClip' && op.splitSec !== undefined) {
    const fresh = await repo.getProject(actor, project.id);
    const target = (fresh?.stems || []).find((s) => s.id === op.trackId);
    if (target && Number(op.splitSec) > (target.trimStartSec || 0)) {
      const splitPoint = Number(op.splitSec);
      await repo.updateStemConfig(actor, project.id, target.id, { trimEndSec: splitPoint });
      await repo.addStem(actor, project.id, Object.assign({}, target.channelConfig, {
        name: `${target.name} (Part B)`,
        trackName: target.trackName,
        blobHash: target.blobHash,
        trimStartSec: splitPoint,
        offsetSec: (target.offsetSec || 0) + (splitPoint - (target.trimStartSec || 0)),
      }));
    }
  } else if (op.type === 'removeTrack') {
    await repo.removeStem(actor, project.id, op.trackId);
  }
}

async function renderProjectMixdownToCas(repo, blobStore, actor, project, options = {}) {
  const stems = project.stems || [];
  if (stems.length === 0) {
    const err = new Error('Project has no stems to render');
    err.status = 400;
    err.code = 'empty_project_stems';
    throw err;
  }
  const sampleRate = project.sampleRate || 48000;
  const stemEntries = [];
  for (const stem of stems) {
    const owned = await repo.getOwnedBlobMeta(actor, stem.blobHash);
    const rawBlob = owned ? blobStore.get(stem.blobHash) : null;
    if (!rawBlob) {
      const err = new Error(`Missing audio blob for stem ${stem.id}`);
      err.status = 422;
      err.code = 'missing_stem_blob';
      throw err;
    }
    const decoded = decodeAudioBuffer(rawBlob.data, sampleRate);
    stemEntries.push({ id: stem.id, sampleRate: decoded.sampleRate, channels: decoded.channels, config: stem });
  }
  const masterCfg = Object.assign({}, project.master || {}, {
    normalize: options.normalize !== false,
    targetLufs: options.targetLufs ?? project.master?.targetLufs ?? -14.0,
    ceilingDb: options.ceilingDb ?? project.master?.ceilingDb ?? -1.0,
  });
  const rendered = DSPEngine.renderMultitrackMixdown(stemEntries, sampleRate, masterCfg);
  const format = options.format === 'mp3' ? 'mp3' : 'wav';
  const encoded = encodeMixdownOutput(rendered.left, rendered.right, sampleRate, format);
  const mixBlob = blobStore.put(encoded.buffer, encoded.mimeType);
  await repo.upsertBlob(actor, mixBlob);
  const mixdown = await repo.recordMixdown(actor, project.id, {
    blobHash: mixBlob.hash,
    format: encoded.format,
    durationSeconds: Number(rendered.durationSeconds.toFixed(3)),
    sampleRate,
    lufsIntegrated: rendered.lufsIntegrated,
    truePeakDb: rendered.truePeakDb,
    recipe: { stemCount: stems.length, master: masterCfg },
  });
  return { mixdown, downloadUrl: `/api/audio/blobs/${mixBlob.hash}` };
}

async function ingestStemPayload(repo, blobStore, actor, project, body) {
  const { name, trackName, audioBase64, mimeType, instrument } = body || {};
  if (!name || typeof name !== 'string') {
    const err = new Error('Stem name is required');
    err.status = 400;
    err.code = 'name_required';
    throw err;
  }
  const sr = project.sampleRate || 48000;
  let blob;
  let decoded;
  if (audioBase64) {
    const cleanB64 = String(audioBase64).replace(/^data:[^;]+;base64,/, '');
    const rawBuf = Buffer.from(cleanB64, 'base64');
    decoded = decodeAudioBuffer(rawBuf, sr);
    blob = blobStore.put(rawBuf, mimeType || 'audio/wav');
    await repo.upsertBlob(actor, blob);
  } else {
    const gen = await storeSynthesizedStemBlob(repo, blobStore, actor, sr, instrument || inferInstrumentFromName(name || trackName) || 'guitar', 4.0);
    blob = gen.blob;
    decoded = decodeAudioBuffer(blobStore.get(blob.hash).data, sr);
  }
  const peaks = compactPeaks(decoded.channels[0], 140);
  const stem = await repo.addStem(actor, project.id, Object.assign({}, body, {
    name,
    trackName: trackName || body.role || 'Track 1',
    blobHash: blob.hash,
    durationSeconds: Number(decoded.durationSeconds.toFixed(3)),
    sampleRate: sr,
    channels: decoded.channels.length,
    peaks,
  }));
  return { stem, blob, blobHash: blob.hash, byteSize: blob.byteSize };
}

async function seedDefaultSessionStems(repo, blobStore, actor, project) {
  const sr = project.sampleRate || 48000;
  const defaults = [
    { name: 'Lead Vocals', trackName: 'vocals', inst: 'vocals', gainDb: 0.0, pan: 0.0, hpf: true, eqMidDb: 1.5, eqHighDb: 2.0, compRatio: 3.0, reverbMix: 0.14 },
    { name: 'Acoustic Drums', trackName: 'drums', inst: 'drums', gainDb: 0.0, pan: 0.0, eqLowDb: 2.0, eqMidDb: -1.0, eqHighDb: 1.5, compRatio: 4.0, reverbMix: 0.06 },
    { name: 'Sub Bass', trackName: 'bass', inst: 'bass', gainDb: -1.0, pan: 0.0, eqLowDb: 3.0, eqMidDb: -1.5, compRatio: 4.0, reverbMix: 0.02 },
    { name: 'Stereo Guitar & Keys', trackName: 'other', inst: 'guitar', gainDb: -2.0, pan: 0.25, eqLowDb: -1.5, eqMidDb: 1.0, eqHighDb: 2.0, compRatio: 2.0, reverbMix: 0.20 },
  ];
  for (const dt of defaults) {
    const gen = await storeSynthesizedStemBlob(repo, blobStore, actor, sr, dt.inst, 4.0);
    await repo.addStem(actor, project.id, Object.assign({ blobHash: gen.blob.hash, sampleRate: sr, durationSeconds: gen.durationSeconds, peaks: gen.peaks }, dt));
  }
  return repo.getProject(actor, project.id);
}

function serveEditorUiAsset(pkgDir, toolsDir, req, res) {
  const rawName = path.basename(req.params.asset || '');
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

function registerProjectReadAndMutationRoutes(router, ctx, repo, blobStore) {
  router.get('/projects', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.read');
    if (!actor) return;
    res.json({ projects: await repo.listProjects(actor) });
  });

  router.get('/projects/:id', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.read');
    if (!actor) return;
    const project = await repo.getProject(actor, req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    res.json({ project });
  });

  router.post('/agent-projects', jsonMiddleware(), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.create');
    if (!actor) return;
    const { title, tempo, sampleRate } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'invalid_title' });
    }
    const project = await repo.createProject(actor, { title: title.trim(), tempo: tempo || 120, sampleRate: sampleRate || 48000 });
    res.status(201).json({ project });
  });

  router.post('/projects/:id/operations', jsonMiddleware({ limit: '4mb' }), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.change');
    if (!actor) return;
    const { baseRevision, operations } = req.body || {};
    if (!baseRevision || typeof baseRevision !== 'number') return res.status(400).json({ error: 'base_revision_required' });
    if (!Array.isArray(operations) || operations.length === 0) return res.status(400).json({ error: 'operations_array_required' });
    if (operations.length > 32) return res.status(413).json({ error: 'too_many_operations' });

    const project = await repo.getProject(actor, req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (project.revision !== baseRevision) {
      return res.status(409).json({ error: 'revision_conflict', message: `Current revision is ${project.revision}, expected ${baseRevision}` });
    }
    const state = { title: project.title, master: Object.assign({}, project.master) };
    for (const op of operations) {
      await executeProjectOperation(repo, blobStore, actor, project, op, state);
    }
    const updated = await repo.commitProjectRevision(actor, project.id, {
      title: state.title,
      master: state.master,
      nextRevision: baseRevision + 1,
      action: 'apply_operations',
      details: { baseRevision, nextRevision: baseRevision + 1, opCount: operations.length },
    });
    res.status(201).json({ project: updated });
  });
}

async function handleConciergeInstruction(repo, blobStore, actor, body) {
  const { projectId, instruction, targetTrack, adjustments } = body || {};
  let project = projectId ? await repo.getProject(actor, projectId) : null;
  if (!project) {
    const existing = await repo.listProjects(actor);
    project = existing.length > 0 ? await repo.getProject(actor, existing[0].id) : await repo.createProject(actor, { title: 'Studio Session', tempo: 120, sampleRate: 48000 });
  }
  if (!project.stems || project.stems.length === 0) {
    project = await seedDefaultSessionStems(repo, blobStore, actor, project);
  }
  const textLower = instruction.toLowerCase();
  const master = Object.assign({}, project.master);
  const surfaceDirectives = [];
  const notes = [];

  const bpmMatch = textLower.match(/(\d{2,3})\s*bpm/) || textLower.match(/tempo\s+(?:to\s+)?(\d{2,3})/);
  if (bpmMatch || adjustments?.tempo !== undefined) {
    master.tempo = Math.max(20, Math.min(300, Number(adjustments?.tempo ?? bpmMatch[1])));
    surfaceDirectives.push({ channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'set_field', field: 'tempo', value: String(master.tempo) });
    notes.push(`Set session tempo to ${master.tempo} BPM`);
  }
  if (textLower.includes('lufs') || textLower.includes('master') || adjustments?.masterGainDb !== undefined) {
    const mGain = adjustments?.masterGainDb !== undefined ? Number(adjustments.masterGainDb) : 1.5;
    master.masterGainDb = mGain;
    master.targetLufs = -14.0;
    surfaceDirectives.push({ channel: 'oshal-surface-bridge', v: 1, app: 'audio', op: 'set_field', field: 'masterGainDb', value: String(mGain) });
    notes.push(`Master bus trim ${mGain >= 0 ? '+' : ''}${mGain} dB (-14.0 LUFS target)`);
  }
  for (const stem of selectTargetStems(project.stems, targetTrack, textLower)) {
    const cfg = Object.assign({}, stem.channelConfig);
    notes.push(...applyStemInstruction(cfg, stem.name, textLower, adjustments));
    await repo.updateStemConfig(actor, project.id, stem.id, cfg);
    surfaceDirectives.push(...buildStemDirectives(stem, cfg));
  }
  const nextRevision = (project.revision || 1) + 1;
  const updatedProject = await repo.commitProjectRevision(actor, project.id, {
    title: project.title, master, nextRevision, action: 'concierge_side_by_side_adjust', details: { instruction, nextRevision, notes },
  });
  return { ok: true, summary: notes.join(' · '), revision: nextRevision, project: updatedProject, surfaceDirectives };
}

function registerConciergeAndRenderRoutes(router, ctx, repo, blobStore) {
  router.post('/concierge', jsonMiddleware({ limit: '2mb' }), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.change');
    if (!actor) return;
    if (!req.body?.instruction || typeof req.body.instruction !== 'string' || !req.body.instruction.trim()) {
      return res.status(400).json({ error: 'instruction_required', message: 'Provide a mixing instruction.' });
    }
    res.status(200).json(await handleConciergeInstruction(repo, blobStore, actor, req.body));
  });

  router.post('/projects/:id/render', jsonMiddleware(), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.export');
    if (!actor) return;
    const project = await repo.getProject(actor, req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    try {
      const out = await renderProjectMixdownToCas(repo, blobStore, actor, project, req.body || {});
      res.status(201).json(out);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.code || 'render_failed', message: err.message });
    }
  });

  router.get('/projects/:id/mixdowns', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.read');
    if (!actor) return;
    res.json({ mixdowns: await repo.listMixdowns(actor, req.params.id) });
  });
}

function createAudioEditorRoutes(ctx) {
  const router = createRouter();
  const pkgDir = ctx?.appPackageDir || path.resolve(__dirname, '..');
  const toolsDir = path.join(pkgDir, 'tools');
  const blobStore = ctx?.blobStore || new BlobStore(ctx?.vaultDir);
  const repo = ctx?.repo || createAudioRepository(ctx);

  router.get('/ui', async (req, res) => {
    if (!(await authorizeRequest(ctx, req, res, 'editor.view'))) return;
    res.sendFile(path.join(toolsDir, 'audio.html'));
  });

  router.get('/ui/:asset', async (req, res) => {
    if (!(await authorizeRequest(ctx, req, res, 'editor.view'))) return;
    serveEditorUiAsset(pkgDir, toolsDir, req, res);
  });

  router.get('/editing-contract', async (req, res) => {
    if (!(await authorizeRequest(ctx, req, res, 'editor.view'))) return;
    res.json(EDITING_CONTRACT);
  });

  registerProjectReadAndMutationRoutes(router, ctx, repo, blobStore);
  registerConciergeAndRenderRoutes(router, ctx, repo, blobStore);

  router.post('/projects/:id/stems', jsonMiddleware({ limit: '50mb' }), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.change');
    if (!actor) return;
    const project = await repo.getProject(actor, req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    try {
      const out = await ingestStemPayload(repo, blobStore, actor, project, req.body);
      res.status(201).json({ stem: out.stem, blobHash: out.blobHash, byteSize: out.byteSize });
    } catch (err) {
      res.status(err.status || 422).json({ error: err.code || 'stem_ingest_failed', message: err.message });
    }
  });

  router.delete('/projects/:id', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.delete');
    if (!actor) return;
    const deleted = await repo.deleteProject(actor, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'project_not_found' });
    res.status(204).end();
  });

  router.post('/media/cleanup', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.delete');
    if (!actor) return;
    res.json({ cleaned: await repo.cleanupOrphanBlobs(actor) });
  });

  router.post('/import-artifact', jsonMiddleware({ limit: '50mb' }), async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.change');
    if (!actor) return;
    const { projectId, name, audioBase64, blobSha256, mimeType } = req.body || {};
    let project = projectId ? await repo.getProject(actor, projectId) : null;
    if (!project) {
      const list = await repo.listProjects(actor);
      project = list[0] ? await repo.getProject(actor, list[0].id) : await repo.createProject(actor, { title: 'Imported Audio Session' });
    }
    if (blobSha256) {
      const owned = await repo.getOwnedBlobMeta(actor, blobSha256);
      const raw = owned ? blobStore.get(blobSha256) : null;
      if (!raw) return res.status(404).json({ error: 'artifact_blob_not_found' });
      const dec = decodeAudioBuffer(raw.data, project.sampleRate || 48000);
      const stem = await repo.addStem(actor, project.id, {
        name: name || 'Imported Stem', trackName: 'Imported', blobHash: blobSha256,
        durationSeconds: dec.durationSeconds, sampleRate: dec.sampleRate, peaks: compactPeaks(dec.channels[0], 140),
      });
      return res.status(201).json({ ok: true, projectId: project.id, stem });
    }
    if (!audioBase64) return res.status(400).json({ error: 'audio_payload_required' });
    const out = await ingestStemPayload(repo, blobStore, actor, project, { name: name || 'Imported Stem', trackName: 'Imported', audioBase64, mimeType });
    res.status(201).json({ ok: true, projectId: project.id, stem: out.stem, blobHash: out.blobHash });
  });

  router.get('/artifacts', async (req, res) => {
    const actor = await authorizeRequest(ctx, req, res, 'editor.read');
    if (!actor) return;
    const mixdowns = await repo.listMixdowns(actor);
    const items = mixdowns.map((m) => ({
      name: `Mixdown_${m.id.slice(0, 8)}.${m.format || 'wav'}`,
      type: m.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
      source: `/api/audio/blobs/${m.blobHash}`,
      lufsIntegrated: m.lufsIntegrated,
      durationSeconds: m.durationSeconds,
    }));
    res.json({ items, folders: [], nextCursor: null });
  });

  return router;
}

module.exports = {
  createAudioEditorRoutes,
  renderProjectMixdownToCas,
  ingestStemPayload,
  compactPeaks,
};
