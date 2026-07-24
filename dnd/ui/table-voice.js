/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:59:39 | roger.murphy@emeraldcoastsystemsgroup.com  | Isolate natural-only narration with fixed Marin/Kore policy, truthful provider status, absolute request deadlines, and playback-aware lifecycle completion.
 * 2026-07-21 22:29:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Normalize browser ended events to the successful narration status consumed by retry and overview flows.
 * 2026-07-21 23:31:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Never mark suspended Web Audio as audible, avoid creating it outside a player gesture, and retry natural narration promptly after a transient failure.
 * 2026-07-21 23:53:25 | roger.murphy@emeraldcoastsystemsgroup.com  | Recognize billed Google Cloud Chirp 3 HD as the preferred natural backup before quota-limited Gemini.
 * 2026-07-22 01:23:52 | roger.murphy@emeraldcoastsystemsgroup.com  | Hold already-synthesized narration across browser autoplay denial and replay those exact bytes on the next gesture without reporting a provider outage or paying twice.
 * 2026-07-22 01:29:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Preserve explicit player mute intent without coupling local narration to campaign ownership.
 * 2026-07-22 21:59:59 | roger.murphy@emeraldcoastsystemsgroup.com  | Report an idle narrator as ready, reserving Connecting for an active synthesis request.
 * 2026-07-23 00:41:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Present Cedar as the restrained D&D folk narrator instead of the brighter Marin performance.
 * 2026-07-23 02:35:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Present the configured gravelly Algenib narrator truthfully and eliminate every Kore fallback.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Persist real table narration switches for action calls, dice math, and NPC turn pace.
 * 2026-07-23 11:21:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep DM Settings discoverable while showing an unmistakable active-speaking state.
 */

'use strict';

const NATURAL_VOICE_POLICY = Object.freeze({
  primary: Object.freeze({ provider: 'google-cloud-tts', voiceId: 'en-US-Chirp3-HD-Algenib', label: 'Algenib · Gravelly Storyteller' }),
  cloud: Object.freeze({ provider: 'openai-tts', voiceId: 'cedar', label: 'OpenAI Cedar' }),
  fallback: Object.freeze({ provider: 'gemini-tts', voiceId: 'Algenib', label: 'Gemini Algenib' }),
});
const DM_PLAY_PREFS_KEY = 'dnd-dm-play-preferences-v1';
const DM_PLAY_DEFAULTS = Object.freeze({ speakActions: true, speakDice: false, npcPace: 'standard' });
let dmPlayPreferences = loadDmPlayPreferences();
let activeNarrator = null;
let _speakQ = [], _speaking = false, _activeSpeech = null;
let _actx = null, _curSrc = null, _curAudioEl = null;
let _gesturePlayback = null, _voiceMutedByPlayer = false;
let _voiceWarned = false, _voiceUnavailableUntil = 0;
const VOICE_RETRY_COOLDOWN_MS = 10000;

/** @description Load safe device-local table preferences without blocking boot. */
function loadDmPlayPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(DM_PLAY_PREFS_KEY) || '{}');
    const npcPace = ['quick', 'standard', 'cinematic'].includes(value.npcPace) ? value.npcPace : DM_PLAY_DEFAULTS.npcPace;
    return {
      speakActions: value.speakActions !== false,
      speakDice: value.speakDice === true,
      npcPace,
    };
  } catch (_error) { return { ...DM_PLAY_DEFAULTS }; }
}

/** @description Return one live Dungeon Master gameplay preference. */
function dmPlaySetting(name) {
  return dmPlayPreferences[name];
}

/** @description Persist one allowlisted Dungeon Master gameplay preference. */
function setDmPlaySetting(name, value) {
  if (!Object.hasOwn(DM_PLAY_DEFAULTS, name)) return;
  if (name === 'npcPace') {
    if (!['quick', 'standard', 'cinematic'].includes(value)) return;
    dmPlayPreferences.npcPace = value;
  } else dmPlayPreferences[name] = !!value;
  try { localStorage.setItem(DM_PLAY_PREFS_KEY, JSON.stringify(dmPlayPreferences)); } catch (_error) {}
}

/** @description Scale only automated-table pauses while preserving natural speech. */
function dmNpcPaceMs(milliseconds) {
  const factor = ({ quick: 0.45, standard: 1, cinematic: 1.35 })[dmPlayPreferences.npcPace] || 1;
  return Math.max(120, Math.round((Number(milliseconds) || 0) * factor));
}

/** @description Remove voice choices that could revive an obsolete device voice. */
function retireLegacyVoicePreferences() {
  try { localStorage.removeItem('dnd-voice'); localStorage.removeItem('dnd-device-voice'); } catch (_error) {}
}

/** @description Unlock Web Audio after a player gesture without synthesizing locally. */
function unlockAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!_actx && AudioContextClass) _actx = new AudioContextClass();
    if (_actx && _actx.state === 'suspended') void _actx.resume();
  } catch (_error) {}
  resumeGesturePlayback();
}

/** @description Return a truthful display label for the server narrator used. */
function narratorLabel(narrator) {
  const provider = String(narrator && narrator.provider || '');
  const voiceId = String(narrator && narrator.voiceId || '');
  if (provider === NATURAL_VOICE_POLICY.primary.provider) {
    return voiceId === NATURAL_VOICE_POLICY.primary.voiceId ? NATURAL_VOICE_POLICY.primary.label : `Google Cloud ${voiceId || 'Chirp 3 HD'}`;
  }
  if (provider === NATURAL_VOICE_POLICY.cloud.provider) {
    return voiceId.toLowerCase() === 'cedar' ? NATURAL_VOICE_POLICY.cloud.label : `OpenAI ${voiceId || 'Cedar'}`;
  }
  if (provider === NATURAL_VOICE_POLICY.fallback.provider) {
    const label = voiceId.toLowerCase() === 'algenib' ? NATURAL_VOICE_POLICY.fallback.label : `Gemini ${voiceId || 'Algenib'}`;
    return `${label} (natural backup)`;
  }
  return voiceId ? `${provider || 'Natural narrator'} ${voiceId}` : 'Natural narrator';
}

/** @description Remember only the provider and voice reported by successful server audio. */
function noteActiveNarrator(result) {
  if (!result || !result.provider || !result.voiceId) return;
  activeNarrator = { provider: String(result.provider), voiceId: String(result.voiceId) };
}

/** @description Keep the settings entry stable while exposing live narration state. */
function setDmSettingsButton(button, state, title) {
  if (!button) return;
  button.classList.toggle('voice-speaking', state === 'playing');
  button.textContent = state === 'playing' ? '🎙 DM Speaking · Settings'
    : state === 'checking' ? '◌ DM Settings · Connecting'
      : state === 'awaiting-gesture' ? '▶ Listen · DM Settings' : '⚙ DM Settings';
  button.title = title;
}

/** @description Render mute, connection, outage, or actual narrator status. */
function setNeuralVoiceStatus(state) {
  const button = $('voiceBtn'), status = $('voiceStatus');
  const label = narratorLabel(activeNarrator || NATURAL_VOICE_POLICY.primary);
  const detail = activeNarrator && activeNarrator.provider !== NATURAL_VOICE_POLICY.primary.provider
    ? `${label}; Algenib will be retried automatically.` : `${label}; server-generated natural narration only.`;
  if (!voiceOn || state === 'muted') {
    setDmSettingsButton(button, 'muted', 'Dungeon Master narration is muted; open settings to enable it.');
    if (status) { status.textContent = 'Narration muted'; status.title = button ? button.title : ''; }
    return;
  }
  if (state === 'awaiting-gesture') {
    setDmSettingsButton(button, state, 'Natural narration is ready. Tap anywhere on the table to hear it.');
    if (status) { status.textContent = 'Tap Listen for narration'; status.title = 'The exact server-generated audio is waiting for browser permission.'; }
    return;
  }
  if (state === 'unavailable') {
    setDmSettingsButton(button, state, 'Natural voice unavailable; open DM Settings to retry. Captions remain on.');
    if (status) { status.textContent = 'Natural voice unavailable'; status.title = 'No device or robotic substitute will play.'; }
    return;
  }
  if (state === 'idle') {
    setDmSettingsButton(button, state, `Open narration, dice, action-call, and NPC pace settings. ${detail}`);
    if (status) { status.textContent = 'Natural narrator ready'; status.title = button ? button.title : ''; }
    return;
  }
  setDmSettingsButton(button, state, detail);
  if (status) {
    status.textContent = state === 'checking' ? 'Connecting to natural narrator…'
      : state === 'playing' ? `Dungeon Master speaking · ${label}` : label;
    status.title = detail;
  }
}

/** @description Initialize the fixed narrator display without offering arbitrary voices. */
function initVoiceStatus() {
  retireLegacyVoicePreferences();
  setNeuralVoiceStatus(voiceOn ? (activeNarrator ? 'ready' : 'idle') : 'muted');
}

/** @description Apply only the player's explicit local mute when changing tables. */
function applyLocalVoicePreference() {
  voiceOn = !_voiceMutedByPlayer;
  setNeuralVoiceStatus(voiceOn ? (activeNarrator ? 'ready' : 'idle') : 'muted');
}

/** @description Strip display markup before sending narration to the voice service. */
const forSpeech = (value) => String(value || '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').replace(/—/g, ', ').trim();

/** @description Budget enough time for long narration without a fixed short cutoff. */
const speechDeadlineMs = (text) => Math.min(90000, Math.max(16000, 5000 + String(text || '').length * 110));

/** @description Return the remaining absolute request budget. */
const remainingSpeechMs = (deadlineAt) => Math.max(0, Number(deadlineAt) - Date.now());

/** @description Fetch JSON within the supplied remaining narration deadline. */
async function fetchVoiceJson(url, options, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = Math.max(1, Number(timeoutMs) || 1);
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    const response = await fetch(url, controller ? { ...(options || {}), signal: controller.signal } : options);
    return await response.json();
  } finally { if (timer) clearTimeout(timer); }
}

/** @description Request natural server audio, retrying transport faults within one deadline. */
async function fetchSelectedNeuralVoice(text, deadlineAt) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = remainingSpeechMs(deadlineAt);
    if (remaining < 1000) return null;
    try {
      const result = await fetchVoiceJson(API + '/tts', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }, remaining);
      if (result && result.ok && result.audio) return result;
      if (result && result.unavailable) return null;
    } catch (_error) { /* one bounded retry for transport failure */ }
    if (!attempt) {
      const pause = Math.min(650, Math.max(0, remainingSpeechMs(deadlineAt) - 900));
      if (pause) await waitMs(pause);
    }
  }
  return null;
}

/** @description Complete one queue item and its caption lifecycle exactly once. */
function settleSpeech(item, status) {
  if (!item || item.settled) return;
  if (_gesturePlayback && _gesturePlayback.item === item) _gesturePlayback = null;
  item.settled = true; clearTimeout(item.timeout);
  try {
    if (item.started && item.lifecycle.onDone) item.lifecycle.onDone(status);
    else if (!item.started && item.lifecycle.onSkip) item.lifecycle.onSkip(status);
  } catch (_error) {}
  item.resolve(status);
}

/** @description Stop the currently playing server audio element or buffer source. */
function stopCurrentAudio() {
  if (_curSrc) { try { _curSrc.stop(); } catch (_error) {} _curSrc = null; }
  if (_curAudioEl) { try { _curAudioEl.pause(); } catch (_error) {} _curAudioEl = null; }
}

/** @description Stop queued and active narration while settling every lifecycle. */
function stopSpeech() {
  _speakQ.splice(0).forEach((item) => settleSpeech(item, 'stopped'));
  stopCurrentAudio();
  const active = _activeSpeech;
  if (active && active.cancel) active.cancel('stopped');
  else if (active) settleSpeech(active, 'stopped');
  _activeSpeech = null; _speaking = false;
}

/** @description Queue one caption-linked narration line. */
function speak(text, priority, lifecycle) {
  const cleaned = forSpeech(text), hooks = lifecycle || {};
  if (!cleaned) return Promise.resolve('empty');
  if (!voiceOn) { try { if (hooks.onSkip) hooks.onSkip('muted'); } catch (_error) {} return Promise.resolve('muted'); }
  if (Date.now() < _voiceUnavailableUntil) {
    try { if (hooks.onSkip) hooks.onSkip('unavailable'); } catch (_error) {}
    return Promise.resolve('unavailable');
  }
  let item;
  const result = new Promise((resolve) => {
    item = { text: cleaned, lifecycle: hooks, resolve, started: false, settled: false, timeout: null, cancel: null, promise: null };
    if (priority) _speakQ.unshift(item); else _speakQ.push(item);
    if (_speakQ.length > 4) {
      const dropped = _speakQ.splice(priority ? 4 : 1, _speakQ.length - 4);
      dropped.forEach((old) => settleSpeech(old, 'dropped'));
    }
    pumpSpeech();
  });
  item.promise = result;
  return result;
}

/** @description Calculate a playback watchdog from decoded audio when available. */
function playbackWatchdogMs(text, durationMs) {
  const estimated = speechDeadlineMs(text);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return estimated;
  return Math.min(120000, Math.max(8000, Math.ceil(durationMs) + 5000));
}

/** @description Arm a watchdog that cannot leave narration or captions stuck. */
function armSpeechWatchdog(item, done, timeoutMs) {
  clearTimeout(item.timeout);
  item.timeout = setTimeout(() => { stopCurrentAudio(); noVoice(done); }, Math.max(1000, timeoutMs));
}

/** @description Mark the actual server narrator ready only after playback begins. */
function markPlaybackStarted(result, item, done, durationMs) {
  noteActiveNarrator(result);
  _voiceWarned = false; _voiceUnavailableUntil = 0;
  setNeuralVoiceStatus('playing');
  armSpeechWatchdog(item, done, playbackWatchdogMs(item.text, durationMs));
}

/** @description Identify browser policy denial separately from provider or codec failure. */
function autoplayBlocked(error) {
  const name = String(error && error.name || '');
  const message = String(error && error.message || error || '');
  return name === 'NotAllowedError' || /autoplay|user (?:gesture|interaction)|user didn't interact|not allowed/i.test(message);
}

/** @description Hold exact fetched audio until a real player gesture permits playback. */
function deferPlaybackUntilGesture(item, done, retry) {
  if (!item || item.settled || (done.isDone && done.isDone())) return;
  clearTimeout(item.timeout); item.timeout = null;
  _gesturePlayback = { item, retry };
  setNeuralVoiceStatus('awaiting-gesture');
  banner('Natural narration is ready. Tap anywhere on the table to listen; gameplay remains available.');
}

/** @description Retry held audio synchronously inside the next browser gesture. */
function resumeGesturePlayback() {
  const pending = _gesturePlayback;
  if (!pending || !pending.item || pending.item.settled) return;
  _gesturePlayback = null;
  pending.retry();
}

/** @description Drain one queued line through server synthesis and audio playback. */
function pumpSpeech() {
  if (_speaking || !_speakQ.length || !voiceOn) return;
  const item = _speakQ.shift();
  _speaking = true; _activeSpeech = item; item.started = true;
  try { if (item.lifecycle.onStart) item.lifecycle.onStart(); } catch (_error) {}
  let finished = false;
  const done = (status) => {
    if (finished) return; finished = true; clearTimeout(item.timeout); item.timeout = null;
    if (_activeSpeech === item) _activeSpeech = null;
    _curSrc = null; _curAudioEl = null; settleSpeech(item, status || 'done');
    _speaking = false;
    setNeuralVoiceStatus(status === 'unavailable' ? 'unavailable' : voiceOn ? 'idle' : 'muted');
    pumpSpeech();
  };
  done.isDone = () => finished;
  item.cancel = (status) => done(status || 'stopped');
  const deadlineAt = Date.now() + speechDeadlineMs(item.text);
  armSpeechWatchdog(item, done, remainingSpeechMs(deadlineAt));
  setNeuralVoiceStatus('checking');
  void fetchSelectedNeuralVoice(item.text, deadlineAt).then((result) => {
    if (finished) return;
    if (!voiceOn) { done('muted'); return; }
    if (result && result.audio) playAudio(result, item, done, () => noVoice(done));
    else noVoice(done);
  }).catch(() => noVoice(done));
}

/** @description Decode and play server audio through Web Audio, then HTML audio. */
function playAudio(result, item, done, onFail) {
  if (done.isDone && done.isDone()) return;
  if (_actx && _actx.state === 'running') {
    try {
      const binary = atob(result.audio), bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      _actx.decodeAudioData(bytes.buffer.slice(0), (buffer) => {
        if (done.isDone && done.isDone()) return;
        try {
          const source = _actx.createBufferSource(); source.buffer = buffer; source.connect(_actx.destination);
          source.onended = () => done('done'); _curSrc = source; source.start(0);
          markPlaybackStarted(result, item, done, Number(buffer.duration) * 1000);
        } catch (_error) { playEl(result, item, done, onFail); }
      }, () => playEl(result, item, done, onFail));
      return;
    } catch (_error) { /* use HTML audio */ }
  }
  playEl(result, item, done, onFail);
}

/** @description Play server audio through an HTML audio element with duration tracking. */
function playEl(result, item, done, onFail) {
  if (done.isDone && done.isDone()) return;
  let fail = () => onFail ? onFail() : noVoice(done);
  try {
    const audio = new Audio(`data:${result.mime || 'audio/mpeg'};base64,${result.audio}`);
    let durationMs = 0;
    fail = (error) => {
      if (autoplayBlocked(error)) { deferPlaybackUntilGesture(item, done, start); return; }
      if (onFail) onFail(); else noVoice(done);
    };
    const started = () => markPlaybackStarted(result, item, done, durationMs);
    const start = () => {
      if (done.isDone && done.isDone()) return;
      try {
        const playing = audio.play();
        if (playing && playing.then) playing.then(started).catch(fail); else started();
      } catch (error) { fail(error); }
    };
    audio.onloadedmetadata = () => {
      durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      if (!(done.isDone && done.isDone())) armSpeechWatchdog(item, done, playbackWatchdogMs(item.text, durationMs));
    };
    audio.onended = () => done('done'); audio.onerror = () => fail(); _curAudioEl = audio;
    start();
  } catch (error) { fail(error); }
}

/** @description Stay silent when every natural narrator fails and keep captions usable. */
function noVoice(done) {
  _voiceUnavailableUntil = Date.now() + VOICE_RETRY_COOLDOWN_MS;
  setNeuralVoiceStatus('unavailable');
  if (!_voiceWarned) {
    _voiceWarned = true;
    banner('🔇 Natural narration is unavailable. Captions remain on; no robotic substitute will play. Tap Voice to retry.');
  }
  done('unavailable');
}

/** @description Retry the fixed natural narrator chain after an outage. */
function retryNaturalVoice() {
  _voiceMutedByPlayer = false; voiceOn = true; _voiceWarned = false; _voiceUnavailableUntil = 0;
  setNeuralVoiceStatus('checking');
  if (_gesturePlayback) { const item = _gesturePlayback.item; resumeGesturePlayback(); return item.promise; }
  if (_activeSpeech && !_activeSpeech.settled) return _activeSpeech.promise;
  stopSpeech();
  return speak('The road ahead is dark, but you are not alone. I will be your guide.', true);
}

/** @description Mute or enable narration without changing the fixed narrator policy. */
function setVoiceMuted(muted) {
  _voiceMutedByPlayer = !!muted; voiceOn = !_voiceMutedByPlayer;
  if (_voiceMutedByPlayer) stopSpeech();
  setNeuralVoiceStatus(_voiceMutedByPlayer ? 'muted' : (activeNarrator ? 'ready' : 'idle'));
}

retireLegacyVoicePreferences();
['pointerdown', 'touchstart', 'keydown', 'click'].forEach((eventName) => {
  window.addEventListener(eventName, unlockAudio, { capture: true, passive: true });
});
