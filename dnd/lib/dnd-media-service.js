/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:55:31 | roger.murphy@emeraldcoastsystemsgroup.com   | Extract fail-soft cutaway generation and route narration through the configured natural server TTS provider without browser or API-key fallbacks.
 * 2026-07-21 20:09:06 | roger.murphy@emeraldcoastsystemsgroup.com   | Bound narration input, allowlist configured DM voices, validate synthesis controls, and log fail-soft provider outages when a logger is available.
 * 2026-07-21 20:19:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Select the configured Gemini natural narrator, allowlist its supported voices, and migrate narration to its fixed language contract.
 * 2026-07-21 20:38:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Select OpenAI natural voices and coalesce/cache identical narration so multiplayer listeners share one paid synthesis.
 * 2026-07-21 21:59:39 | roger.murphy@emeraldcoastsystemsgroup.com   | Prefer OpenAI Marin, safely fall back to Gemini Kore, report the actual natural narrator, and expire fallback audio so the primary can recover.
 * 2026-07-21 23:53:25 | roger.murphy@emeraldcoastsystemsgroup.com   | Add billed Google Cloud Chirp 3 HD narration ahead of quota-limited Gemini so a long game keeps a natural voice.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com   | Deduplicate story-event illustrations across players and reconnects while returning completed art directly to the requesting table.
 * 2026-07-23 00:41:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Direct Cedar as a slower, grave folk storyteller while preserving natural server-only failover.
 * 2026-07-23 02:35:01 | roger.murphy@emeraldcoastsystemsgroup.com   | Make the configured gravelly Algenib narrator primary and remove the unwanted bright Kore voice from every fallback.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CharacterImportError } = require('./character-import');

const DM_AGENT_ID = 'dd000000-0000-0000-0000-000000000001';
const DM_LANGUAGE = 'en-US';
const MAX_NARRATION_CACHE = 48;
const FALLBACK_CACHE_MS = 30000;
const DM_PERFORMANCE = 'Tell this as dark fireside folklore: low, intimate, weathered, and unhurried. Keep joy rare and earned. Treat danger, injury, and death with gravity, never cheerfulness. Use restrained dramatic emphasis and clear character distinction. Never sound like an announcer, assistant, or computer. Read the supplied words exactly.';
const DM_VOICE_IDS = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova',
  'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);
const NATURAL_NARRATORS = Object.freeze([
  { providerId: 'google-cloud-tts', voiceId: 'en-US-Chirp3-HD-Algenib', primary: true },
  { providerId: 'openai-tts', voiceId: 'cedar', primary: false },
  { providerId: 'gemini-tts', voiceId: 'Algenib', primary: false },
]);

/** @description Lazily obtain optional framework image-generation helpers. */
function imageFramework() {
  try {
    const feature = require('@/features/video-generation');
    return {
      resolve: feature.resolveStoryboardImageProvider || null,
      recordCost: feature.recordStoryboardImageCost || null,
    };
  } catch (_error) {
    return { resolve: null, recordCost: null };
  }
}

/** @description Resolve the manifest-selected natural server voice provider. */
function naturalVoiceProvider(providerId) {
  try {
    const { getTTSProviderRegistry } = require('@/features/voice-providers');
    const provider = getTTSProviderRegistry().get(providerId);
    return provider && provider.kind === 'server' ? provider : null;
  } catch (_error) {
    return null;
  }
}

/** @description Convert an optional finite number without altering its value. */
function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** @description Reject malformed or unapproved narration synthesis controls. */
function synthesisRequest(body) {
  if (!body || typeof body !== 'object' || typeof body.text !== 'string') {
    throw new CharacterImportError('INVALID_TTS_REQUEST', 'Narration text is required.');
  }
  if (!body.text.trim() || body.text.length > 900) {
    throw new CharacterImportError('INVALID_TTS_REQUEST', 'Narration text must contain 1 to 900 characters.');
  }
  const selected = body.voiceId !== undefined ? body.voiceId : body.voice;
  const requestedVoice = selected === undefined ? 'cedar' : String(selected);
  if (!DM_VOICE_IDS.has(requestedVoice)) {
    throw new CharacterImportError('INVALID_TTS_VOICE', 'Choose one of the configured Dungeon Master voices.');
  }
  const selectedLanguage = body.languageCode !== undefined ? body.languageCode : body.language;
  const languageCode = selectedLanguage === undefined ? DM_LANGUAGE : String(selectedLanguage);
  if (languageCode !== DM_LANGUAGE) {
    throw new CharacterImportError('INVALID_TTS_LANGUAGE', 'Dungeon Master narration is configured for en-US.');
  }
  const speakingRate = body.speakingRate === undefined ? 0.9 : optionalNumber(body.speakingRate);
  const pitch = body.pitch === undefined ? -3 : optionalNumber(body.pitch);
  if (speakingRate === undefined || speakingRate < 0.25 || speakingRate > 4) {
    throw new CharacterImportError('INVALID_TTS_RATE', 'Narration speaking rate is outside the supported range.');
  }
  if (pitch === undefined || pitch < -20 || pitch > 20) {
    throw new CharacterImportError('INVALID_TTS_PITCH', 'Narration pitch is outside the supported range.');
  }
  return { text: body.text, languageCode, speakingRate, pitch, performanceInstructions: DM_PERFORMANCE };
}

/** @description Emit a structured provider warning only when AppContext supplied a logger. */
function warnUnavailable(deps, candidate, reason) {
  const logger = deps.logger;
  if (logger && typeof logger.warn === 'function') {
    logger.warn({ providerId: candidate.providerId, voiceId: candidate.voiceId, reason },
      'D&D natural narration unavailable');
  }
}

/** @description Classify which OpenAI failures may safely use the natural backup. */
function fallbackCategory(error) {
  const message = String((error && error.message) || error || 'unknown provider error');
  const statusMatch = message.match(/(?:HTTP|returned)\s+(\d{3})/i);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if ([401, 403, 404].includes(status)) return { eligible: true, kind: 'unconfigured', message };
    if ([408, 409, 425, 429].includes(status) || status >= 500) return { eligible: true, kind: 'transient', message };
    return { eligible: false, kind: 'permanent', message };
  }
  const name = String(error && error.name || '');
  if (/Abort|Timeout/i.test(name) || /timed?\s*out|fetch failed|network|ECONN|EAI_AGAIN|socket/i.test(message)) {
    return { eligible: true, kind: 'transient', message };
  }
  if (/API_KEY.*(?:required|missing|empty|rejected)|not configured/i.test(message)) {
    return { eligible: true, kind: 'unconfigured', message };
  }
  return { eligible: false, kind: 'permanent', message };
}

/** @description Try one exact server-side narrator without browser fallback. */
async function synthesizeCandidate(request, candidate) {
  const provider = naturalVoiceProvider(candidate.providerId);
  if (!provider) {
    return { ok: false, eligible: true, kind: 'unconfigured', reason: 'server provider missing' };
  }
  try {
    const status = await provider.getStatus();
    if (!status || !status.configured) {
      return { ok: false, eligible: true, kind: 'unconfigured', reason: (status && status.reason) || 'provider not configured' };
    }
    const result = await provider.synthesize({ ...request, voiceId: candidate.voiceId });
    if (!result || !Buffer.isBuffer(result.audio)) {
      return { ok: false, eligible: true, kind: 'transient', reason: 'provider returned no audio' };
    }
    return {
      ok: true, audio: result.audio.toString('base64'), mime: result.audioFormat || 'audio/mpeg',
      provider: result.providerId || candidate.providerId,
      voiceId: result.voiceId || candidate.voiceId,
    };
  } catch (error) {
    const category = fallbackCategory(error);
    return { ok: false, eligible: category.eligible, kind: category.kind, reason: category.message.slice(0, 160) };
  }
}

/** @description Synthesize through the ordered quality-approved natural narrator chain. */
async function synthesizeNarration(deps, body) {
  const request = synthesisRequest(body);
  let failure = null;
  for (const candidate of NATURAL_NARRATORS) {
    const result = await synthesizeCandidate(request, candidate);
    if (result.ok) return result;
    failure = result; warnUnavailable(deps, candidate, result.reason);
    if (candidate.primary && !result.eligible) break;
  }
  const temporary = failure && failure.kind === 'transient';
  return { ok: false, unavailable: true,
    error: temporary ? 'The natural narrator is temporarily unavailable.' : 'The natural narrator voice is unavailable.' };
}

/** @description Derive a non-reversible key from validated synthesis controls. */
function narrationCacheKey(body) {
  const request = synthesisRequest(body);
  return crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

/** @description Read one cached response while refreshing its bounded LRU position. */
function cachedNarration(deps, cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  if (entry.expiresAt <= now) { cache.delete(key); return null; }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

/** @description Store one successful narration without allowing unbounded audio growth. */
function rememberNarration(deps, cache, key, value) {
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const expiresAt = value.provider === NATURAL_NARRATORS[0].providerId ? Infinity : now + FALLBACK_CACHE_MS;
  cache.set(key, { value, expiresAt });
  while (cache.size > MAX_NARRATION_CACHE) cache.delete(cache.keys().next().value);
}

/** @description Share identical active requests and reuse successful natural audio. */
async function synthesizeShared(deps, cache, pending, body) {
  const key = narrationCacheKey(body);
  const hit = cachedNarration(deps, cache, key);
  if (hit) return hit;
  if (pending.has(key)) return pending.get(key);
  const task = synthesizeNarration(deps, body).then((result) => {
    if (result && result.ok) rememberNarration(deps, cache, key, result);
    return result;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

/** @description Resolve and create the campaign-scoped cutaway directory. */
function cutawayDir(campaignId) {
  const base = process.env.CLINE_WORKSPACE_ROOT || path.resolve(process.cwd(), 'workspace-shared');
  const safeId = String(campaignId || '').replace(/[^a-f0-9-]/gi, '');
  const directory = path.join(base, 'dnd-cutaways', safeId);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/** @description Generate one provider image and normalize its metadata. */
async function renderCutaway(provider, prompt) {
  if (provider.generateWithMeta) return provider.generateWithMeta(prompt, null);
  return { image: await provider.generate(prompt, null), costUsd: null, model: provider.id || 'unknown' };
}

/** @description Record a generated illustration's cost when the framework supports it. */
async function recordCost(deps, recorder, provider, meta, sub, id) {
  if (!recorder || typeof meta.costUsd !== 'number' || meta.costUsd <= 0) return;
  await recorder(deps.pool, {
    taskId: `dnd-cutaway-${id}`,
    agentId: DM_AGENT_ID,
    ownerSub: sub,
    providerId: `image-provider:${provider.id || 'storyboard'}`,
    model: meta.model,
    costUsd: meta.costUsd,
  });
}

/** @description Derive a repeatable file identity for one authoritative story event. */
function cutawayIdentity(body) {
  const eventKey = String(body && body.eventKey || '').trim().slice(0, 180);
  if (!eventKey) return crypto.randomUUID();
  return crypto.createHash('sha256').update(`${body.campaignId}:${eventKey}`).digest('hex').slice(0, 32);
}

/** @description Render, store, archive, and cost one new cinematic cutaway. */
async function createCutaway(deps, framework, sub, body, id, file) {
  const provider = await framework.resolve();
  const scene = String(body.prompt || '').slice(0, 700);
  const prompt = `Cinematic dark-fantasy illustration, painterly, dramatic torchlight, no text, no UI. Scene: ${scene}`;
  const meta = await renderCutaway(provider, prompt);
  fs.writeFileSync(file, meta.image);
  const url = `/api/dnd/cutaway/${body.campaignId}/${id}.png`;
  await deps.campaign.archive(sub, body.campaignId, 'cutaway', url);
  await recordCost(deps, framework.recordCost, provider, meta, sub, id);
  return { ok: true, url, eventKey: String(body.eventKey || '') || null };
}

/** @description Generate and archive a fail-soft cinematic story cutaway. */
async function generateCutaway(deps, sub, body) {
  if (!(await deps.campaign.access(sub, body.campaignId))) return { ok: false, error: 'No seat at this table.' };
  const framework = deps.imageFramework || imageFramework();
  if (!framework.resolve) return { ok: false, soft: true, error: 'Cutaway art is not available on this swarm.' };
  const id = cutawayIdentity(body), file = path.join(cutawayDir(body.campaignId), `${id}.png`);
  const url = `/api/dnd/cutaway/${body.campaignId}/${id}.png`;
  if (fs.existsSync(file)) return { ok: true, url, deduplicated: true, eventKey: String(body.eventKey || '') || null };
  if (deps.pendingCutaways.has(id)) {
    return deps.pendingCutaways.get(id).then((result) => ({ ...result, deduplicated: true }));
  }
  const task = createCutaway(deps, framework, sub, body, id, file)
    .catch((error) => {
      const detail = String((error && error.message) || error).slice(0, 120);
      return { ok: false, soft: true, error: `The illustrator is resting (${detail})` };
    })
    .finally(() => deps.pendingCutaways.delete(id));
  deps.pendingCutaways.set(id, task);
  try {
    return await task;
  } catch (error) {
    const detail = String((error && error.message) || error).slice(0, 120);
    return { ok: false, soft: true, error: `The illustrator is resting (${detail})` };
  }
}

/**
 * @description Bind narration audio and cutaway media operations.
 * @param {object} deps - Pool, campaign service, and manifest voice provider id.
 * @returns {object} Media methods consumed by the D&D router.
 */
function createMediaService(deps) {
  const narrationCache = new Map();
  const pendingNarration = new Map();
  const runtime = { ...deps, pendingCutaways: new Map() };
  return {
    cutawayDir,
    generateCutaway: (sub, body) => generateCutaway(runtime, sub, body),
    synthesizeNarration: (body) => synthesizeShared(deps, narrationCache, pendingNarration, body),
  };
}

module.exports = { createMediaService, _test: { cutawayIdentity } };
