/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:59:39 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove natural-only browser playback, narration-sized request deadlines, actual backup labels, and caption lifecycle completion at audio end.
 * 2026-07-21 22:29:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove native ended events normalize to a successful narration result.
 * 2026-07-21 23:53:25 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove the paid Google Chirp natural-backup identity is rendered truthfully.
 * 2026-07-22 01:23:52 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove autoplay denial holds exact fetched audio for the next gesture without a false outage, dropped caption, or second paid request.
 * 2026-07-22 01:29:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove campaign changes preserve player-selected mute intent without owner or guest role inference.
 * 2026-07-23 00:41:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove the table identifies Cedar as its folk storyteller and retries that primary after natural failover.
 * 2026-07-23 02:35:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove the table identifies gravelly Cloud Algenib as primary and never offers Kore.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove action, dice, and NPC-pace gameplay preferences persist and affect runtime behavior.
 * 2026-07-23 11:21:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the DM Settings label visible and expose active natural playback as speaking.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'table-voice.js'), 'utf8');
const exportApi = `\n;globalThis.__voiceApi = {
  NATURAL_VOICE_POLICY, speechDeadlineMs, remainingSpeechMs, fetchSelectedNeuralVoice,
  noteActiveNarrator, setNeuralVoiceStatus, initVoiceStatus, applyLocalVoicePreference,
  speak, stopSpeech, retryNaturalVoice, setVoiceMuted,
  dmPlaySetting, setDmPlaySetting, dmNpcPaceMs
};`;

/** @description Build a minimal tabletop browser around the isolated voice module. */
function voiceContext(overrides) {
  const classes = new Set();
  const elements = {
    voiceBtn: { textContent: '', title: '', classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) } },
    voiceStatus: { textContent: '', title: '' },
  };
  const state = { banners: [], timers: [], audio: null, listeners: {}, storage: new Map() };
  class FakeAudio {
    constructor(url) { this.url = url; this.duration = 12; state.audio = this; }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const nativeSetTimeout = setTimeout;
  const context = {
    API: '/api/dnd', AbortController, Audio: FakeAudio, Date, Uint8Array,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    banner: (message) => state.banners.push(message),
    clearTimeout, console, fetch: async () => ({ json: async () => ({ ok: true, audio: 'YXVkaW8=', mime: 'audio/mpeg', provider: 'google-cloud-tts', voiceId: 'en-US-Chirp3-HD-Algenib' }) }),
    localStorage: {
      getItem(key) { return state.storage.has(key) ? state.storage.get(key) : null; },
      setItem(key, value) { state.storage.set(key, String(value)); },
      removeItem(key) { state.storage.delete(key); },
    }, setTimeout: (callback, milliseconds) => {
      state.timers.push(milliseconds); return nativeSetTimeout(callback, milliseconds);
    },
    voiceOn: true, waitMs: () => Promise.resolve(),
    window: {
      addEventListener(name, handler) { state.listeners[name] = handler; },
      AudioContext: null, webkitAudioContext: null,
    },
    $: (id) => elements[id] || null,
    ...(overrides || {}),
  };
  vm.runInNewContext(source + exportApi, context, { filename: 'table-voice.js' });
  return { api: context.__voiceApi, context, elements, state };
}

/** @description Let promise continuations and fake audio playback settle. */
const nextTask = () => new Promise((resolve) => setImmediate(resolve));

test('voice client contains no device synthesizer or fixed 4.5 second cutoff', () => {
  assert.doesNotMatch(source, /window\.speechSynthesis|SpeechSynthesisUtterance/);
  assert.doesNotMatch(source, /4500/);
  assert.match(source, /provider:\s*'google-cloud-tts',\s*voiceId:\s*'en-US-Chirp3-HD-Algenib'/);
  assert.match(source, /provider:\s*'openai-tts',\s*voiceId:\s*'cedar'/);
  assert.match(source, /provider:\s*'gemini-tts',\s*voiceId:\s*'Algenib'/);
  assert.doesNotMatch(source, /voiceId:\s*'Kore'|Chirp3-HD-Kore/);
  assert.doesNotThrow(() => new vm.Script(source));
});

test('the visible status names the paid Google Cloud Algenib primary', () => {
  const fixture = voiceContext();
  fixture.api.noteActiveNarrator({ provider: 'google-cloud-tts', voiceId: 'en-US-Chirp3-HD-Algenib' });
  fixture.api.setNeuralVoiceStatus('ready');
  assert.match(fixture.elements.voiceBtn.textContent, /DM Settings/);
  assert.match(fixture.elements.voiceStatus.title, /server-generated natural narration only/);
});

test('server fetch receives the full remaining narration deadline', async () => {
  const fixture = voiceContext();
  const text = 'x'.repeat(500);
  const budget = fixture.api.speechDeadlineMs(text);
  const deadlineAt = Date.now() + budget;
  const result = await fixture.api.fetchSelectedNeuralVoice(text, deadlineAt);
  assert.equal(result.ok, true);
  assert.ok(fixture.state.timers.some((milliseconds) => milliseconds > 4500));
  assert.ok(fixture.state.timers.some((milliseconds) => milliseconds >= budget - 100));
  assert.ok(fixture.api.remainingSpeechMs(deadlineAt) <= budget);
});

test('the visible status names the actual Gemini Algenib backup', () => {
  const fixture = voiceContext();
  fixture.api.initVoiceStatus();
  assert.match(fixture.elements.voiceStatus.title, /Algenib.*gravelly storyteller/i);
  fixture.api.noteActiveNarrator({ provider: 'gemini-tts', voiceId: 'Algenib' });
  fixture.api.setNeuralVoiceStatus('ready');
  assert.match(fixture.elements.voiceBtn.textContent, /DM Settings/);
  assert.match(fixture.elements.voiceStatus.textContent, /Gemini Algenib/);
  assert.match(fixture.elements.voiceStatus.title, /Algenib will be retried/);
});

test('caption lifecycle remains active until natural audio playback ends', async () => {
  const fixture = voiceContext({
    fetch: async () => ({ json: async () => ({
      ok: true, audio: Buffer.from('natural').toString('base64'), mime: 'audio/mpeg',
      provider: 'gemini-tts', voiceId: 'Algenib',
    }) }),
  });
  let held = false, released = false, resolved = false;
  const spoken = fixture.api.speak('The party follows the torchlight.', false, {
    onStart() { held = true; }, onDone() { held = false; released = true; },
  });
  spoken.then(() => { resolved = true; });
  await nextTask();
  assert.equal(held, true);
  assert.equal(resolved, false);
  assert.ok(fixture.state.audio);
  assert.match(fixture.elements.voiceStatus.textContent, /Dungeon Master speaking.*Gemini Algenib/);
  assert.equal(fixture.elements.voiceBtn.classList.contains('voice-speaking'), true);
  fixture.state.audio.onended({ type: 'ended' });
  assert.equal(await spoken, 'done');
  assert.equal(held, false);
  assert.equal(released, true);
});

test('natural narrator outage stays silent and settles its caption lifecycle', async () => {
  const fixture = voiceContext({
    fetch: async () => ({ json: async () => ({ ok: false, unavailable: true }) }),
  });
  let completed = false;
  const result = await fixture.api.speak('Keep this caption visible.', false, {
    onDone() { completed = true; },
  });
  assert.equal(result, 'unavailable');
  assert.equal(completed, true);
  assert.equal(fixture.state.audio, null);
  assert.match(fixture.state.banners[0], /no robotic substitute/i);
  assert.match(fixture.elements.voiceStatus.textContent, /unavailable/i);
});

test('autoplay denial waits for a gesture and reuses the exact fetched audio', async () => {
  let fetches = 0, playCalls = 0, lastAudio = null;
  class GestureLockedAudio {
    constructor(url) { this.url = url; this.duration = 9; lastAudio = this; }
    play() {
      playCalls++;
      if (playCalls === 1) {
        const error = new Error('play() failed because the user did not interact with the document first');
        error.name = 'NotAllowedError';
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  }
  const fixture = voiceContext({
    Audio: GestureLockedAudio,
    fetch: async () => {
      fetches++;
      return { json: async () => ({
        ok: true, audio: Buffer.from('held-natural-audio').toString('base64'), mime: 'audio/mpeg',
        provider: 'google-cloud-tts', voiceId: 'en-US-Chirp3-HD-Algenib',
      }) };
    },
  });
  let completed = false;
  const spoken = fixture.api.speak('The exact opening waits for the player.', false, {
    onDone() { completed = true; },
  });
  await nextTask(); await nextTask();
  assert.equal(fetches, 1);
  assert.equal(playCalls, 1);
  assert.equal(completed, false);
  assert.match(fixture.elements.voiceBtn.textContent, /Listen · DM Settings/);
  assert.doesNotMatch(fixture.elements.voiceStatus.textContent, /unavailable/i);
  assert.doesNotMatch(fixture.state.banners.join(' '), /no robotic substitute/i);

  fixture.state.listeners.pointerdown();
  await nextTask();
  assert.equal(fetches, 1);
  assert.equal(playCalls, 2);
  assert.match(fixture.elements.voiceStatus.textContent, /Algenib · Gravelly Storyteller/);
  assert.equal(completed, false);
  lastAudio.onended({ type: 'ended' });
  assert.equal(await spoken, 'done');
  assert.equal(completed, true);
});

test('campaign switches preserve player mute but never infer it from seat ownership', () => {
  const fixture = voiceContext();
  fixture.api.applyLocalVoicePreference();
  assert.doesNotMatch(fixture.elements.voiceStatus.textContent, /muted/i);
  fixture.api.setVoiceMuted(true);
  fixture.api.applyLocalVoicePreference();
  assert.match(fixture.elements.voiceStatus.textContent, /muted/i);
  fixture.api.setVoiceMuted(false);
  fixture.api.applyLocalVoicePreference();
  assert.doesNotMatch(fixture.elements.voiceStatus.textContent, /muted/i);
});

test('Dungeon Master gameplay switches persist action, dice, and NPC pace behavior', () => {
  const fixture = voiceContext();
  assert.equal(fixture.api.dmPlaySetting('speakActions'), true);
  assert.equal(fixture.api.dmPlaySetting('speakDice'), false);
  assert.equal(fixture.api.dmNpcPaceMs(1000), 1000);
  fixture.api.setDmPlaySetting('speakActions', false);
  fixture.api.setDmPlaySetting('speakDice', true);
  fixture.api.setDmPlaySetting('npcPace', 'quick');
  assert.equal(fixture.api.dmPlaySetting('speakActions'), false);
  assert.equal(fixture.api.dmPlaySetting('speakDice'), true);
  assert.equal(fixture.api.dmNpcPaceMs(1000), 450);
  assert.match(fixture.state.storage.get('dnd-dm-play-preferences-v1'), /"npcPace":"quick"/);
  fixture.api.setDmPlaySetting('npcPace', 'invalid');
  assert.equal(fixture.api.dmPlaySetting('npcPace'), 'quick');
});
