/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:56:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Route host narration through the configured natural server TTS provider (Gemini by default). No browser or API-key fallback: the show reports voice unavailable and stays caption-only rather than using a robotic device voice.
 */

'use strict';

const DEFAULT_HOST_VOICE = 'Orus';       // a bright, hosty timbre from the Gemini catalog
const HOST_LANGUAGE = 'en-US';
const HOST_VOICE_IDS = new Set([
  'Kore', 'Gacrux', 'Algenib', 'Charon', 'Rasalgethi',
  'Sulafat', 'Orus', 'Achernar', 'Vindemiatrix',
]);

/** @description Look up one server-kind voice provider by id. */
function serverProvider(providerId) {
  try {
    const { getTTSProviderRegistry } = require('@/features/voice-providers');
    const provider = getTTSProviderRegistry().get(providerId);
    return provider && provider.kind === 'server' ? provider : null;
  } catch (_error) {
    return null;
  }
}

/**
 * @description First CONFIGURED server voice among the candidates, or null.
 *   Deployments differ in which voice is actually authenticated (google-cloud-tts
 *   needs an OAuth profile; gemini-tts only needs an API key), so try in order
 *   rather than hard-failing on one id.
 * @param {string[]} ids - Candidate provider ids, most preferred first.
 * @returns {Promise<object|null>} A configured provider, or null if none are.
 */
async function resolveVoiceProvider(ids) {
  for (const id of ids || []) {
    const provider = serverProvider(id);
    if (!provider) continue;
    try {
      const status = await provider.getStatus();
      if (status && status.configured) return provider;
    } catch (_error) { /* try the next candidate */ }
  }
  return null;
}

/** @description Convert an optional finite number without altering its value. */
function optionalNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** @description Reject malformed or unapproved narration synthesis controls. */
function synthesisRequest(body) {
  if (!body || typeof body !== 'object' || typeof body.text !== 'string' || !body.text.trim()) {
    return { error: 'Host line text is required.' };
  }
  if (body.text.length > 900) return { error: 'Host line must be 900 characters or fewer.' };
  const selected = body.voiceId !== undefined ? body.voiceId : body.voice;
  const voiceId = selected === undefined ? DEFAULT_HOST_VOICE : String(selected);
  if (!HOST_VOICE_IDS.has(voiceId)) return { error: 'Choose one of the configured host voices.' };
  const speakingRate = optionalNumber(body.speakingRate, 1.04);
  const pitch = optionalNumber(body.pitch, 0);
  if (speakingRate === undefined || speakingRate < 0.25 || speakingRate > 4) return { error: 'Speaking rate is out of range.' };
  if (pitch === undefined || pitch < -20 || pitch > 20) return { error: 'Pitch is out of range.' };
  return { request: { text: body.text, voiceId, languageCode: HOST_LANGUAGE, speakingRate, pitch } };
}

/** @description Emit a structured provider warning only when AppContext supplied a logger. */
function warnUnavailable(deps, reason) {
  if (deps.logger && typeof deps.logger.warn === 'function') {
    deps.logger.warn({ providerIds: deps.ttsProviderIds, reason }, 'Game Show host voice unavailable');
  }
}

/** @description Synthesize the host's voice or explicitly report unavailability. */
async function synthesizeHostLine(deps, body) {
  const parsed = synthesisRequest(body);
  if (parsed.error) return { ok: false, error: parsed.error };
  const provider = await resolveVoiceProvider(deps.ttsProviderIds);
  if (!provider) {
    warnUnavailable(deps, 'no configured server voice provider');
    return { ok: false, unavailable: true, error: 'The host voice is not configured on this swarm.' };
  }
  try {
    const result = await provider.synthesize(parsed.request);
    if (!result || !Buffer.isBuffer(result.audio)) {
      warnUnavailable(deps, 'provider returned no audio');
      return { ok: false, unavailable: true, error: 'The host voice returned no audio.' };
    }
    return {
      ok: true, audio: result.audio.toString('base64'),
      mime: result.audioFormat || 'audio/mpeg',
      provider: result.providerId, voiceId: result.voiceId || parsed.request.voiceId,
    };
  } catch (error) {
    warnUnavailable(deps, String((error && error.message) || error).slice(0, 160));
    return { ok: false, unavailable: true, error: 'The host voice is temporarily unavailable.' };
  }
}

/**
 * @description Bind host-voice synthesis to the manifest voice provider id.
 * @param {object} deps - { ttsProviderId, logger }.
 * @returns {object} Media methods consumed by the router.
 */
function createMediaService(deps) {
  return { synthesizeHostLine: (body) => synthesizeHostLine(deps, body) };
}

module.exports = { createMediaService, HOST_VOICE_IDS };
