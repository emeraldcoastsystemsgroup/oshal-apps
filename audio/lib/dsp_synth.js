/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Modular synthetic stem, riff, and multi-track arrangement generators for Audio Studio DSP engine.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Make percussion noise seeded-deterministic and add distinct slap-funk bass and drum-roll transition synthesis.
 */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DSPSynth = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const DSPSynth = {};

  function createDeterministicNoise(seed) {
    let state = (seed >>> 0) || 0x6d2b79f5;
    return function nextNoise() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state / 0x80000000) - 1.0;
    };
  }

  function synthDrums(data, numSamples, sampleRate, beatDuration, barDuration) {
    const noise = createDeterministicNoise(0x10402080);
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const beatPos = (t % beatDuration) / beatDuration;
      const currentBeatInBar = Math.floor((t % barDuration) / beatDuration);
      const barPos = t % barDuration;
      let kick = 0;
      let snare = 0;
      const isKick = (currentBeatInBar === 0 && beatPos < 0.25)
        || (currentBeatInBar === 2 && beatPos < 0.25)
        || (barPos >= 1.375 && barPos < 1.55);
      if (isKick) {
        const kickT = (barPos >= 1.375 && barPos < 1.55) ? (barPos - 1.375) : (beatPos * beatDuration);
        const pitch = 45 + 105 * Math.exp(-kickT * 40);
        kick = Math.sin(2 * Math.PI * pitch * kickT) * Math.exp(-kickT * 18) * 0.9;
      }
      if ((currentBeatInBar === 1 || currentBeatInBar === 3) && beatPos < 0.35) {
        const snareT = beatPos * beatDuration;
        const body = Math.sin(2 * Math.PI * 185 * snareT) * 0.4;
        snare = (body + noise() * 0.6) * Math.exp(-snareT * 22) * 0.75;
      }
      const hatT = t % (beatDuration / 2);
      const hat = noise() * Math.exp(-hatT * 60) * 0.22;
      data[i] = Math.max(-1, Math.min(1, kick + snare + hat));
    }
  }

  function synthBass(data, numSamples, sampleRate, beatDuration, barDuration) {
    const roots = [41.20, 48.99, 65.41, 73.42];
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const rootFreq = roots[Math.floor(t / barDuration) % 4];
      const noteT = t % (beatDuration / 2);
      const env = Math.exp(-noteT * 7.0);
      const f1 = Math.sin(2 * Math.PI * rootFreq * t);
      const f2 = Math.sin(2 * Math.PI * (rootFreq * 2) * t) * 0.5;
      const f3 = Math.sin(2 * Math.PI * (rootFreq * 3) * t) * 0.25;
      data[i] = Math.max(-1, Math.min(1, (f1 + f2 + f3) * env * 0.72));
    }
  }

  function synthHarmonicInstrument(data, numSamples, sampleRate, barDuration, type) {
    const chords = [
      [164.81, 196.00, 246.94, 329.63],
      [196.00, 246.94, 293.66, 392.00],
      [130.81, 164.81, 196.00, 261.63],
      [146.83, 220.00, 293.66, 369.99],
    ];
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const notes = chords[Math.floor(t / barDuration) % 4];
      const beatAge = (t % barDuration) % 0.5;
      const decay = Math.exp(-beatAge * (type === 'horns' ? 6.5 : 4.2));
      let sum = 0;
      for (let n = 0; n < notes.length; n++) {
        const f = notes[n];
        sum += Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * (f * 2) * t) * 0.4;
      }
      data[i] = (sum / notes.length) * decay * 0.68;
    }
  }

  function synthVocals(data, numSamples, sampleRate, barDuration) {
    const pitches = [329.63, 392.00, 440.00, 293.66];
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const phraseTime = t % 2.0;
      if (phraseTime >= 1.35) {
        data[i] = 0;
        continue;
      }
      const pitch = pitches[Math.floor(t / barDuration) % 4];
      const f0 = pitch + Math.sin(2 * Math.PI * 5.2 * t) * 5.5;
      const f1 = Math.sin(2 * Math.PI * f0 * t) * 0.58;
      const f2 = Math.sin(2 * Math.PI * (f0 * 2) * t) * 0.28;
      const f3 = Math.sin(2 * Math.PI * 2400 * t) * 0.1;
      const env = Math.sin(Math.PI * (phraseTime / 1.35));
      data[i] = (f1 + f2 + f3) * Math.max(0, env) * 0.72;
    }
  }

  function synthFunkOrDrumRoll(data, numSamples, sampleRate, type) {
    const noise = createDeterministicNoise(0x9e3779b9);
    const notes = [55.00, 73.42, 82.41, 98.00, 110.00];
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      if (type === 'filler_drum_roll') {
        const stepT = t % 0.125;
        const crescendo = Math.min(1, 0.25 + (i / Math.max(1, numSamples)) * 0.75);
        const snare = (Math.sin(2 * Math.PI * 195 * stepT) * 0.45 + noise() * 0.65) * Math.exp(-stepT * 26);
        data[i] = Math.max(-1, Math.min(1, snare * crescendo * 0.85));
      } else {
        const step = Math.floor((t % 2.0) / 0.25);
        const stepT = t % 0.25;
        const base = notes[step % notes.length] * (step % 2 === 1 ? 2 : 1);
        const slap = noise() * Math.exp(-stepT * 95) * 0.45;
        const tone = (Math.sin(2 * Math.PI * base * t) + 0.65 * Math.sin(2 * Math.PI * base * 3 * t)) * Math.exp(-stepT * 11);
        data[i] = Math.max(-1, Math.min(1, (tone * 0.65 + slap) * 0.8));
      }
    }
  }

  function synthRiffOrPattern(data, numSamples, sampleRate, type) {
    if (type === 'riff_funk_bass' || type === 'filler_drum_roll') {
      synthFunkOrDrumRoll(data, numSamples, sampleRate, type);
      return;
    }
    const riffNotes = [82.41, 98.00, 110.00, 116.54, 123.47];
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const barPos = t % 2.0;
      const step = Math.floor(barPos / 0.25);
      const f = riffNotes[step % riffNotes.length];
      const decay = Math.exp(-(barPos % 0.25) * 8);
      if (type === 'riff_rock_guitar') {
        const raw = (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 1.5 * t) * 0.8) * decay * 2.5;
        data[i] = Math.tanh(raw) * 0.75;
      } else if (type === 'riff_trap_beat') {
        const kT = barPos % 0.5;
        const pitch = 38 + 55 * Math.exp(-kT * 20);
        data[i] = Math.sin(2 * Math.PI * pitch * kT) * Math.exp(-kT * 4.5) * 0.85;
      } else {
        data[i] = Math.sin(2 * Math.PI * f * 2 * t) * decay * 0.65;
      }
    }
  }

  DSPSynth.generateSyntheticAudio = function (type, durationSec, sampleRate) {
    const sr = sampleRate || 48000;
    const numSamples = Math.max(1, Math.floor((durationSec || 4.0) * sr));
    const data = new Float32Array(numSamples);
    const beatDuration = 0.5;
    const barDuration = 2.0;

    if (type === 'drums') {
      synthDrums(data, numSamples, sr, beatDuration, barDuration);
    } else if (type === 'bass') {
      synthBass(data, numSamples, sr, beatDuration, barDuration);
    } else if (type === 'guitar' || type === 'piano' || type === 'horns' || type === 'music_chord') {
      synthHarmonicInstrument(data, numSamples, sr, barDuration, type);
    } else if (type === 'vocals' || type === 'speech_pulse') {
      synthVocals(data, numSamples, sr, barDuration);
    } else {
      synthRiffOrPattern(data, numSamples, sr, type);
    }
    return data;
  };

  DSPSynth.generateRockSongStems = function (durationSec, sampleRate, normalizeFn) {
    const sr = sampleRate || 48000;
    const dur = durationSec || 6.0;
    const drums = DSPSynth.generateSyntheticAudio('drums', dur, sr);
    const bass = DSPSynth.generateSyntheticAudio('bass', dur, sr);
    const rhythm = DSPSynth.generateSyntheticAudio('riff_rock_guitar', dur, sr);
    const lead = DSPSynth.generateSyntheticAudio('guitar', dur, sr);
    const vocals = DSPSynth.generateSyntheticAudio('vocals', dur, sr);
    const mix = new Float32Array(drums.length);
    for (let i = 0; i < drums.length; i++) {
      mix[i] = (drums[i] * 0.9 + bass[i] * 0.8 + rhythm[i] * 0.7 + lead[i] * 0.65 + vocals[i] * 0.8) / 2.8;
    }
    if (typeof normalizeFn === 'function') normalizeFn(mix, -14.0);
    return { drums, bass, rhythm, lead, vocals, mix };
  };

  return DSPSynth;
}));
