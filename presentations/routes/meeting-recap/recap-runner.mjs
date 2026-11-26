/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: 7-stage Meeting Recap pipeline runner and explicit ADR-108 Save-to-Files handler.
 */
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import {
  detectSceneChanges,
  extractAudioWav,
  extractCroppedKeyframe,
  formatTimestamp,
  normalizeCropMode,
  probeMediaInfo,
  safeMediaExt,
} from './recap-media.mjs';
import {
  assembleTimelineMarkdown,
  buildRecapDeckOutline,
  MAX_DECK_IMAGES,
  renderSummaryMarkdown,
  summarizeRecap,
} from './recap-pipeline.mjs';
import {
  ensureJobWorkspace,
  loadTranscriptText,
  parseMetaJson,
  updateRecapRow,
} from './recap-store.mjs';
import { parseTranscriptInput, transcribeLocalWav } from './recap-transcribe.mjs';

const require = createRequire(import.meta.url);
const DECK_BUILDER_AGENT_ID = 'a0000000-0000-0000-0000-000000000042';
const DECK_SUBFOLDER = `oshal/${DECK_BUILDER_AGENT_ID}`;
const DEFAULT_THEME = 'executive';

/** Lazily load kernel presentation-generation helpers. */
function loadDeckEngine() {
  return require('@/features/presentation-generation');
}

/** Build optional Stage 6 accountable bot runner (text + keyframe metadata only). */
function createDeckBotRunner(ctx, ownerSub) {
  return async (prompt) => {
    const { BotNodeClient, createRegistryEndpointResolver } = require('@/features/agent-management');
    const { executeBotOrInline } = require('@/app/routes/inline-bot-execution');
    const client = new BotNodeClient(createRegistryEndpointResolver());
    const result = await executeBotOrInline(ctx, client, DECK_BUILDER_AGENT_ID, {
      text: prompt,
      taskId: `recap-${ownerSub}`,
      workspaceFolderId: `recap-${ownerSub}`,
      agentId: DECK_BUILDER_AGENT_ID,
      agenticMode: false,
      direct: true,
      userSub: ownerSub,
      max_output_tokens: 4096,
    });
    return String(result?.response || result?.reply || '');
  };
}

/** Stage 2 + 3: Extract 16 kHz mono WAV locally and obtain timestamped segments. */
async function runAudioAndTranscribe({ ctx, ownerSub, jobId, mediaPath, probe, jobDir, opts }) {
  const wavPath = path.join(jobDir, 'tmp', 'audio-16k.wav');
  const providedText = typeof opts.transcriptText === 'string' && opts.transcriptText.trim()
    ? { text: opts.transcriptText, format: opts.transcriptFormat || 'auto' }
    : await loadTranscriptText(ownerSub, jobId);

  if (probe.hasAudio) {
    await updateRecapRow(ctx.pool, ownerSub, jobId, {
      status: 'extracting',
      stageMessage: 'Extracting 16 kHz mono audio locally',
    });
    await extractAudioWav(mediaPath, wavPath);
  } else if (!providedText?.text) {
    const err = new Error('Recording has no audio stream and no local transcript was supplied.');
    err.code = 'no_audio_track';
    throw err;
  }

  await updateRecapRow(ctx.pool, ownerSub, jobId, {
    status: 'transcribing',
    stageMessage: providedText?.text ? 'Parsing supplied local transcript' : 'Transcribing locally (audio stays on device)',
  });

  if (providedText?.text) {
    const segments = parseTranscriptInput(providedText.text, providedText.format);
    if (!segments.length) {
      const err = new Error('Supplied transcript contained no readable timestamped segments.');
      err.code = 'invalid_transcript';
      throw err;
    }
    const mins = Number(((probe.durationSec || segments.at(-1)?.endTime || 0) / 60).toFixed(2));
    await updateRecapRow(ctx.pool, ownerSub, jobId, { minutesProcessed: mins, totalMinutes: mins });
    return { segments, transcriptSource: 'supplied-local', wavPath };
  }

  const res = await transcribeLocalWav(wavPath, {
    voiceService: opts.voiceService,
    onProgress: async ({ minutesProcessed, totalMinutes }) => {
      await updateRecapRow(ctx.pool, ownerSub, jobId, {
        minutesProcessed,
        totalMinutes,
        stageMessage: `Transcribing locally (${minutesProcessed.toFixed(1)} / ${totalMinutes.toFixed(1)} min)`,
      });
    },
  });
  return { segments: res.segments, transcriptSource: 'local-stt', wavPath };
}

/** Stage 4: RGB colour-space scene detection + privacy camera-strip cropping. */
async function runSceneDetection({ ctx, ownerSub, jobId, mediaPath, probe, jobDir, cropConfig, sampleIntervalSec }) {
  if (!probe.hasVideo) return { keyframes: [], keyframeDataUris: new Map(), intervalSec: 15 };
  await updateRecapRow(ctx.pool, ownerSub, jobId, {
    status: 'detecting_scenes',
    stageMessage: 'Detecting colour-space scene changes and cropping camera strip',
  });
  const detected = await detectSceneChanges(mediaPath, {
    durationSec: probe.durationSec,
    sampleIntervalSec,
  });
  const keyframes = [];
  const keyframeDataUris = new Map();
  for (const hit of detected.keyframes) {
    const file = `keyframe-${hit.index}.png`;
    const outPath = path.join(jobDir, 'keyframes', file);
    await extractCroppedKeyframe(mediaPath, hit.timestampSec, outPath, cropConfig);
    const id = `kf-${hit.index}`;
    const label = `Scene ${hit.index} at ${formatTimestamp(hit.timestampSec)}`;
    keyframes.push({
      id,
      index: hit.index,
      timestampSec: hit.timestampSec,
      timestamp: formatTimestamp(hit.timestampSec),
      score: hit.score,
      file,
      label,
      cropMode: cropConfig.mode,
      url: `/api/presentations/recap/jobs/${jobId}/artifacts/${file}`,
    });
    if (keyframeDataUris.size < MAX_DECK_IMAGES) {
      const pngBytes = await readFile(outPath);
      if (pngBytes.length <= 350 * 1024) {
        keyframeDataUris.set(id, `data:image/png;base64,${pngBytes.toString('base64')}`);
      }
    }
  }
  await updateRecapRow(ctx.pool, ownerSub, jobId, {
    keyframesCount: keyframes.length,
    sampleIntervalSec: detected.intervalSec,
  });
  return { keyframes, keyframeDataUris, intervalSec: detected.intervalSec };
}

/** Stage 7: Render themed review.pptx (image + text layouts only, zero charts). */
async function renderReviewDeck({ title, durationSec, notes, keyframes, keyframeDataUris, theme, cropMode, outPath }) {
  const engine = loadDeckEngine();
  const resolvedTheme = typeof engine.isThemeId === 'function' && engine.isThemeId(theme) ? theme : DEFAULT_THEME;
  const outline = buildRecapDeckOutline({ title, durationSec, notes, keyframes, keyframeDataUris, cropMode });
  const pptxBuf = await engine.renderPptx(outline.title, outline.sections, {
    theme: resolvedTheme,
    subtitle: outline.subtitle,
    autoLayout: true,
    slideNumbers: true,
  });
  await writeFile(outPath, pptxBuf);
  return { outline, theme: resolvedTheme, bytes: pptxBuf.length };
}

/** Stage 5 + 6 + 7: Assemble timeline.md, summarize end-to-end notes, and render review.pptx. */
async function runTimelineSummaryAndDeck({ ctx, ownerSub, jobId, row, jobDir, probe, tr, sc, cropConfig, requestedTheme, opts }) {
  await updateRecapRow(ctx.pool, ownerSub, jobId, { status: 'assembling_timeline', stageMessage: 'Assembling chronological timeline.md' });
  const timelineMd = assembleTimelineMarkdown(row.title, tr.segments, sc.keyframes);
  await writeFile(path.join(jobDir, 'timeline.md'), timelineMd, 'utf8');

  await updateRecapRow(ctx.pool, ownerSub, jobId, { status: 'summarizing', stageMessage: 'Building end-to-end chronological notes and highlights' });
  const notes = await summarizeRecap({
    title: row.title, durationSec: probe.durationSec || tr.segments.at(-1)?.endTime || 0,
    segments: tr.segments, keyframes: sc.keyframes,
    botRunner: opts.botRunner || createDeckBotRunner(ctx, ownerSub), useAiSummary: Boolean(opts.useAiSummary),
  });
  const summaryMd = renderSummaryMarkdown(row.title, notes, sc.keyframes);
  await writeFile(path.join(jobDir, 'summary.md'), summaryMd, 'utf8');

  await updateRecapRow(ctx.pool, ownerSub, jobId, { status: 'rendering_deck', stageMessage: 'Rendering review.pptx deck' });
  const deck = await renderReviewDeck({
    title: row.title, durationSec: probe.durationSec || notes.durationSec, notes,
    keyframes: sc.keyframes, keyframeDataUris: sc.keyframeDataUris, theme: requestedTheme,
    cropMode: cropConfig.mode, outPath: path.join(jobDir, 'review.pptx'),
  });
  const artifacts = [
    { name: 'timeline.md', label: 'Timeline (Markdown)', bytes: Buffer.byteLength(timelineMd, 'utf8'), url: `/api/presentations/recap/jobs/${jobId}/artifacts/timeline.md` },
    { name: 'summary.md', label: 'Summary & Quotes (Markdown)', bytes: Buffer.byteLength(summaryMd, 'utf8'), url: `/api/presentations/recap/jobs/${jobId}/artifacts/summary.md` },
    { name: 'review.pptx', label: 'Review Deck (PowerPoint)', bytes: deck.bytes, url: `/api/presentations/recap/jobs/${jobId}/artifacts/review.pptx` },
  ];
  await updateRecapRow(ctx.pool, ownerSub, jobId, {
    status: 'completed', stageMessage: 'Recap ready', theme: deck.theme, keyframesCount: sc.keyframes.length,
    meta: {
      keyframes: sc.keyframes, notes, artifacts, transcriptSource: tr.transcriptSource,
      deckSlides: deck.outline.sections.length, deckSubtitle: deck.outline.subtitle, cropMode: cropConfig.mode,
    },
  });
  return { status: 'completed', artifacts, keyframes: sc.keyframes, notes };
}

/** Execute all 7 deterministic + accountable-reasoning stages for an owner's recap job. */
export async function executeRecapPipeline(ctx, ownerSub, row, opts = {}) {
  const jobId = row.id;
  const ext = safeMediaExt(row.source_filename);
  if (!ext) { const err = new Error('Unsupported recording file extension.'); err.code = 'invalid_media'; throw err; }
  const jobDir = ensureJobWorkspace(ownerSub, jobId);
  const mediaPath = path.join(jobDir, `source${ext}`);
  if (!existsSync(mediaPath) || statSync(mediaPath).size === 0) {
    const err = new Error('Upload recording bytes before running the recap pipeline.');
    err.code = 'media_missing';
    throw err;
  }
  const cropConfig = normalizeCropMode(opts.cropMode ?? row.crop_mode, opts.customCrop);
  const requestedInterval = opts.sampleIntervalSec ?? (row.sample_interval_sec || 'auto');
  const requestedTheme = String(opts.theme || row.theme || DEFAULT_THEME);
  let wavPath = null;
  try {
    const probe = await probeMediaInfo(mediaPath);
    const totalMinutes = Number(((probe.durationSec || 0) / 60).toFixed(2));
    const mediaSha = createHash('sha256').update(await readFile(mediaPath)).digest('hex');
    await updateRecapRow(ctx.pool, ownerSub, jobId, {
      sourceSha256: mediaSha, sourceBytes: statSync(mediaPath).size, durationSeconds: probe.durationSec,
      totalMinutes, cropMode: cropConfig.mode, theme: requestedTheme, errorCode: null, errorMessage: null,
    });
    const tr = await runAudioAndTranscribe({ ctx, ownerSub, jobId, mediaPath, probe, jobDir, opts });
    wavPath = tr.wavPath;
    const sc = await runSceneDetection({
      ctx, ownerSub, jobId, mediaPath, probe, jobDir, cropConfig, sampleIntervalSec: requestedInterval,
    });
    return await runTimelineSummaryAndDeck({
      ctx, ownerSub, jobId, row, jobDir, probe, tr, sc, cropConfig, requestedTheme, opts,
    });
  } catch (err) {
    await updateRecapRow(ctx.pool, ownerSub, jobId, {
      status: 'failed', stageMessage: 'Recap failed',
      errorCode: err?.code || 'recap_pipeline_failed',
      errorMessage: String(err?.message || 'Meeting recap failed').slice(0, 500),
    });
    throw err;
  } finally {
    if (wavPath && existsSync(wavPath)) await rm(wavPath, { force: true }).catch(() => {});
  }
}

/** Record saved deck metadata in oshal_presentations and save optional markdown notes. */
async function recordSavedDeckAndExtras(ctx, ownerSub, row, jobDir, baseSlug, savedName, saved, meta, opts) {
  const previewSections = (meta.notes?.sections || []).map((s, idx) => ({
    title: String(s.title || ''), bullets: Array.isArray(s.bullets) ? s.bullets : [],
    ...(idx === 0 && meta.deckSubtitle ? { coverSubtitle: meta.deckSubtitle } : {}), sourceVersion: 2,
  }));
  await ctx.pool.query(
    `INSERT INTO oshal_presentations (user_sub, title, file_name, provider, download_url, url, slides, outline, theme, format)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      ownerSub, row.title, savedName, saved?.provider || 'oshal-local', saved?.downloadUrl ?? null,
      saved?.url ?? null, Number(meta.deckSlides || previewSections.length || 1),
      JSON.stringify(previewSections), row.theme || DEFAULT_THEME, 'pptx',
    ],
  ).catch(() => {});
  const extras = [];
  if (opts.includeNotes === true) {
    const { saveContent } = require('@/app/routes/storage-target');
    for (const extra of ['timeline.md', 'summary.md']) {
      const p = path.join(jobDir, extra);
      if (!existsSync(p)) continue;
      const res = await saveContent(ctx, ownerSub, 'files', `${baseSlug}_${extra}`, await readFile(p), opts.saveTo, DECK_SUBFOLDER).catch(() => null);
      if (res) extras.push({ name: extra, location: res.location, provider: res.provider });
    }
  }
  return extras;
}

/** Explicit owner act: save review.pptx (and optional markdown artifacts) through ADR-108 storage-target. */
export async function saveRecapDeckToFiles(ctx, ownerSub, row, opts = {}) {
  if (row.status !== 'completed') {
    const err = new Error('Complete the recap pipeline before saving to Files.');
    err.code = 'recap_not_ready'; err.status = 409; throw err;
  }
  const jobDir = ensureJobWorkspace(ownerSub, row.id);
  const deckPath = path.join(jobDir, 'review.pptx');
  if (!existsSync(deckPath)) {
    const err = new Error('Rendered review.pptx was not found in the owner workspace.');
    err.code = 'artifact_missing'; err.status = 404; throw err;
  }
  const { saveContent } = require('@/app/routes/storage-target');
  const baseSlug = String(row.title || 'Meeting_Recap').replace(/[^\w.\- ]/g, '_').trim().slice(0, 72) || 'Meeting_Recap';
  const deckName = `${baseSlug}_Recap.pptx`;
  const saved = await saveContent(ctx, ownerSub, 'files', deckName, await readFile(deckPath), opts.saveTo, DECK_SUBFOLDER);
  const savedName = (saved?.location || '').split('/').pop() || deckName;
  const openUrl = `/cockpit/?app=presentations&open=${encodeURIComponent(savedName)}`;
  const extras = await recordSavedDeckAndExtras(ctx, ownerSub, row, jobDir, baseSlug, savedName, saved, parseMetaJson(row.meta_json), opts);
  await updateRecapRow(ctx.pool, ownerSub, row.id, { savedDeckPath: saved?.location || savedName, savedDeckOpenUrl: openUrl });
  return {
    ok: true, provider: saved?.provider || 'oshal-local', savedTo: saved?.location || savedName,
    downloadUrl: saved?.downloadUrl ?? null, url: saved?.url ?? null, openUrl, extras,
  };
}
