/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Core DSP signal processing, biquad filtering, loudness normalization, WAV codec, voice persona timbre modeling, and live stream modulation rack.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Upgrade ADR-208 5-stage channel strip, K-weighted BS.1770 stereo loudness mastering, Schroeder room reverb, feed-forward compressor, and chunk-walking RIFF/WAVE codec; remove synthetic beep speech.
 */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp_synth.js'));
  } else {
    root.DSPEngine = factory(root.DSPSynth);
  }
}(typeof self !== 'undefined' ? self : this, function (DSPSynth) {
  const DSPEngine = {};

  DSPEngine.dbToGain = function (db) {
    return Math.pow(10, Number(db || 0) / 20);
  };

  DSPEngine.gainToDb = function (gain) {
    if (!gain || gain <= 0.000001) return -120;
    return 20 * Math.log10(gain);
  };

  DSPEngine.computeWaveformPeaks = function (channelData, targetBins = 240) {
    const total = channelData.length;
    const bins = Math.max(10, Math.min(targetBins || 240, Math.max(10, total)));
    const samplesPerBin = total > 0 ? total / bins : 1;
    const minPeaks = new Float32Array(bins);
    const maxPeaks = new Float32Array(bins);
    const rmsValues = new Float32Array(bins);
    let peakAbs = 0;

    for (let b = 0; b < bins; b++) {
      const start = Math.floor(b * samplesPerBin);
      const end = Math.min(total, Math.max(start + 1, Math.floor((b + 1) * samplesPerBin)));
      let min = 1.0, max = -1.0, sumSq = 0;
      const count = Math.max(0, end - start);
      for (let i = start; i < end && i < total; i++) {
        const val = channelData[i];
        const abs = Math.abs(val);
        if (abs > peakAbs) peakAbs = abs;
        if (val < min) min = val;
        if (val > max) max = val;
        sumSq += val * val;
      }
      minPeaks[b] = count > 0 && min <= max ? min : 0;
      maxPeaks[b] = count > 0 && min <= max ? max : 0;
      rmsValues[b] = count > 0 ? Math.sqrt(sumSq / count) : 0;
    }
    return { bins, samplesPerBin, min: minPeaks, max: maxPeaks, rms: rmsValues, peakAbs, clipping: peakAbs >= 0.999 };
  };

  function computeShelfCoeffs(type, A, cosW0, alpha) {
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
    if (type === 'lowshelf') {
      return {
        b0: A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha),
        b1: 2 * A * ((A - 1) - (A + 1) * cosW0),
        b2: A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha),
        a0: (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha,
        a1: -2 * ((A - 1) + (A + 1) * cosW0),
        a2: (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha,
      };
    }
    return {
      b0: A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha),
      b1: -2 * A * ((A - 1) + (A + 1) * cosW0),
      b2: A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha),
      a0: (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha,
      a1: 2 * ((A - 1) - (A + 1) * cosW0),
      a2: (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha,
    };
  }

  DSPEngine.createBiquadCoefficients = function (type, sampleRate, frequency, Q, gainDb) {
    const sr = Math.max(8000, sampleRate || 48000);
    const freq = Math.max(10, Math.min(sr * 0.48, frequency || 1000));
    const w0 = 2 * Math.PI * (freq / sr);
    const cosW0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * (Q || 0.7071));
    const A = Math.pow(10, (gainDb || 0) / 40);
    let c = { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 };

    if (type === 'highpass') {
      c = { b0: (1 + cosW0) / 2, b1: -(1 + cosW0), b2: (1 + cosW0) / 2, a0: 1 + alpha, a1: -2 * cosW0, a2: 1 - alpha };
    } else if (type === 'lowpass') {
      c = { b0: (1 - cosW0) / 2, b1: 1 - cosW0, b2: (1 - cosW0) / 2, a0: 1 + alpha, a1: -2 * cosW0, a2: 1 - alpha };
    } else if (type === 'peaking') {
      c = { b0: 1 + alpha * A, b1: -2 * cosW0, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cosW0, a2: 1 - alpha / A };
    } else if (type === 'lowshelf' || type === 'highshelf') {
      c = computeShelfCoeffs(type, A, cosW0, alpha);
    }
    return { b0: c.b0 / c.a0, b1: c.b1 / c.a0, b2: c.b2 / c.a0, a1: c.a1 / c.a0, a2: c.a2 / c.a0 };
  };

  DSPEngine.applyBiquad = function (buffer, coeffs) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const { b0, b1, b2, a1, a2 } = coeffs;
    for (let i = 0; i < buffer.length; i++) {
      const x0 = buffer[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      buffer[i] = y0;
    }
    return buffer;
  };

  DSPEngine.resampleChannel = function (channel, fromRate, toRate) {
    if (!fromRate || !toRate || fromRate === toRate || channel.length === 0) return new Float32Array(channel);
    const ratio = fromRate / toRate;
    const outLen = Math.max(1, Math.round(channel.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcPos = i * ratio;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      const s0 = channel[Math.min(idx, channel.length - 1)];
      const s1 = channel[Math.min(idx + 1, channel.length - 1)];
      out[i] = s0 + (s1 - s0) * frac;
    }
    return out;
  };

  DSPEngine.applyDynamicsCompressor = function (buffer, sampleRate, options = {}) {
    const ratio = Math.max(1.0, Number(options.ratio ?? 2.5));
    if (ratio <= 1.01) return buffer;
    const thresholdDb = Number(options.thresholdDb ?? -18.0);
    const attackCoeff = Math.exp(-1 / (Math.max(0.001, (options.attackMs ?? 12) / 1000) * sampleRate));
    const releaseCoeff = Math.exp(-1 / (Math.max(0.005, (options.releaseMs ?? 140) / 1000) * sampleRate));
    const makeup = DSPEngine.dbToGain(options.makeupDb ?? 0);
    let env = 0;
    for (let i = 0; i < buffer.length; i++) {
      const abs = Math.abs(buffer[i]);
      env = abs > env ? (1 - attackCoeff) * abs + attackCoeff * env : (1 - releaseCoeff) * abs + releaseCoeff * env;
      const envDb = DSPEngine.gainToDb(env);
      const overDb = envDb - thresholdDb;
      const grDb = overDb > 0 ? -overDb * (1 - 1 / ratio) : 0;
      buffer[i] *= DSPEngine.dbToGain(grDb) * makeup;
    }
    return buffer;
  };

  DSPEngine.applyNoiseGate = function (buffer, sampleRate, options = {}) {
    const threshold = DSPEngine.dbToGain(options.thresholdDb ?? -42.0);
    const attackCoeff = Math.exp(-1.0 / (((options.attackMs ?? 5.0) / 1000.0) * sampleRate));
    const releaseCoeff = Math.exp(-1.0 / (((options.releaseMs ?? 120.0) / 1000.0) * sampleRate));
    let envelope = 0;
    const out = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const abs = Math.abs(buffer[i]);
      envelope = abs > envelope ? (1 - attackCoeff) * abs + attackCoeff * envelope : (1 - releaseCoeff) * abs + releaseCoeff * envelope;
      const gateGain = envelope > threshold ? 1.0 : Math.pow(envelope / (threshold + 1e-6), 2);
      out[i] = buffer[i] * Math.min(1.0, Math.max(0.0, gateGain));
    }
    return out;
  };

  DSPEngine.applySidechainDucking = function (targetBuffer, triggerBuffer, sampleRate, options = {}) {
    const threshold = DSPEngine.dbToGain(options.thresholdDb ?? -30);
    const duckGain = DSPEngine.dbToGain(options.duckDepthDb ?? -14);
    const detAttack = Math.exp(-1 / (sampleRate * 0.008));
    const detRelease = Math.exp(-1 / (sampleRate * 0.060));
    const gainAttack = Math.exp(-1 / (sampleRate * ((options.attackMs ?? 35) / 1000)));
    const gainRelease = Math.exp(-1 / (sampleRate * ((options.releaseMs ?? 220) / 1000)));
    let envelope = 0, currentGain = 1.0;
    const len = Math.min(targetBuffer.length, triggerBuffer.length);
    for (let i = 0; i < len; i++) {
      const trig = Math.abs(triggerBuffer[i]);
      envelope = trig > envelope ? (1 - detAttack) * trig + detAttack * envelope : (1 - detRelease) * trig + detRelease * envelope;
      const desired = envelope > threshold ? duckGain : 1.0;
      const coeff = desired < currentGain ? gainAttack : gainRelease;
      currentGain = (1 - coeff) * desired + coeff * currentGain;
      targetBuffer[i] *= currentGain;
    }
    return targetBuffer;
  };

  DSPEngine.applyDistortion = function (buffer, mode, driveDb, options = {}) {
    if (!mode || mode === 'bypass' || mode === 'off') return buffer;
    const drive = DSPEngine.dbToGain(driveDb || 6.0);
    const bitDepth = options.bitDepth || 8;
    const downsample = options.downsample || 4;
    if (mode === 'tube') {
      for (let i = 0; i < buffer.length; i++) {
        const x = buffer[i] * drive;
        const y = x >= 0 ? Math.tanh(x) * 0.85 + 0.15 * Math.tanh(x * x) : Math.tanh(x);
        buffer[i] = Math.max(-1, Math.min(1, y));
      }
    } else if (mode === 'bitcrusher') {
      const steps = Math.pow(2, bitDepth);
      let held = 0;
      for (let i = 0; i < buffer.length; i++) {
        if (i % downsample === 0) held = Math.round(buffer[i] * steps) / steps;
        buffer[i] = held;
      }
    } else {
      for (let i = 0; i < buffer.length; i++) buffer[i] = Math.tanh(buffer[i] * drive);
    }
    return buffer;
  };

  function runAllpass(input, delaySamples, feedback) {
    const buf = new Float32Array(Math.max(8, delaySamples));
    const out = new Float32Array(input.length);
    let idx = 0;
    for (let i = 0; i < input.length; i++) {
      const bufOut = buf[idx];
      const x = input[i];
      buf[idx] = x + bufOut * feedback;
      out[i] = -x + bufOut;
      idx = (idx + 1) % buf.length;
    }
    return out;
  }

  DSPEngine.applySchroederReverb = function (buffer, sampleRate, mix = 0.15, decaySec = 1.2) {
    const wetMix = Math.max(0, Math.min(1, Number(mix || 0)));
    if (wetMix <= 0.005 || buffer.length === 0) return buffer;
    const scale = sampleRate / 48000;
    const combDelays = [1427, 1613, 1867, 2053].map((d) => Math.max(16, Math.round(d * scale)));
    const preDelay = Math.max(1, Math.round(0.02 * sampleRate));
    const wet = new Float32Array(buffer.length);
    for (const d of combDelays) {
      const delayLine = new Float32Array(d);
      const g = Math.min(0.92, Math.pow(0.001, (d / sampleRate) / Math.max(0.2, decaySec)));
      let ptr = 0;
      for (let i = 0; i < buffer.length; i++) {
        const delayedIn = i >= preDelay ? buffer[i - preDelay] : 0;
        const y = delayLine[ptr];
        delayLine[ptr] = delayedIn + y * g;
        wet[i] += y * 0.25;
        ptr = (ptr + 1) % d;
      }
    }
    const ap1 = runAllpass(wet, Math.round(241 * scale), 0.5);
    const ap2 = runAllpass(ap1, Math.round(83 * scale), 0.5);
    const dryMix = 1 - wetMix * 0.55;
    for (let i = 0; i < buffer.length; i++) buffer[i] = buffer[i] * dryMix + ap2[i] * wetMix;
    return buffer;
  };

  DSPEngine.sliceBuffer = function (buffer, startSec, endSec, sampleRate) {
    const start = Math.max(0, Math.floor(startSec * sampleRate));
    const end = Math.min(buffer.length, Math.floor(endSec * sampleRate));
    return end <= start ? new Float32Array(0) : buffer.slice(start, end);
  };

  DSPEngine.repeatBuffer = function (buffer, targetDurationSec, sampleRate) {
    const targetLen = Math.max(0, Math.floor(targetDurationSec * sampleRate));
    const out = new Float32Array(targetLen);
    if (buffer.length === 0) return out;
    for (let i = 0; i < targetLen; i++) out[i] = buffer[i % buffer.length];
    return out;
  };

  DSPEngine.insertFiller = function (targetBuffer, fillerBuffer, startSec, sampleRate) {
    const start = Math.max(0, Math.floor(startSec * sampleRate));
    const crossfadeLen = Math.min(480, fillerBuffer.length);
    for (let i = 0; i < fillerBuffer.length; i++) {
      const idx = start + i;
      if (idx >= targetBuffer.length) break;
      const fade = i < crossfadeLen ? i / crossfadeLen : 1;
      targetBuffer[idx] = targetBuffer[idx] * (1 - fade) + fillerBuffer[i] * fade;
    }
    return targetBuffer;
  };

  DSPEngine.shiftBuffer = function (buffer, offsetSeconds, sampleRate) {
    const shiftSamples = Math.floor((offsetSeconds || 0) * sampleRate);
    if (shiftSamples === 0) return new Float32Array(buffer);
    const outLen = Math.max(1, buffer.length + Math.max(0, shiftSamples));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i - shiftSamples;
      out[i] = srcIdx >= 0 && srcIdx < buffer.length ? buffer[srcIdx] : 0;
    }
    return out;
  };

  DSPEngine.applyClipEnvelope = function (buffer, sampleRate, opts = {}) {
    const trimStart = Math.max(0, Number(opts.trimStartSec || 0));
    const trimEnd = opts.trimEndSec !== undefined && opts.trimEndSec !== null
      ? Math.max(trimStart, Number(opts.trimEndSec))
      : buffer.length / sampleRate;
    let out = (trimStart > 0 || trimEnd < buffer.length / sampleRate)
      ? DSPEngine.sliceBuffer(buffer, trimStart, trimEnd, sampleRate)
      : new Float32Array(buffer);
    const fadeIn = Math.min(out.length, Math.floor(Math.max(0, Number(opts.fadeInSec || 0)) * sampleRate));
    const fadeOut = Math.min(out.length, Math.floor(Math.max(0, Number(opts.fadeOutSec || 0)) * sampleRate));
    for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
    for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= i / fadeOut;
    if (opts.offsetSec && opts.offsetSec > 0) out = DSPEngine.shiftBuffer(out, opts.offsetSec, sampleRate);
    return out;
  };

  function kWeightChannel(channel, sampleRate) {
    const sr = sampleRate || 48000;
    const copy = new Float32Array(channel);
    DSPEngine.applyBiquad(copy, DSPEngine.createBiquadCoefficients('highshelf', sr, 1681.97, 0.7071, 4.0));
    DSPEngine.applyBiquad(copy, DSPEngine.createBiquadCoefficients('highpass', sr, 38.13, 0.5, 0));
    return copy;
  }

  DSPEngine.analyzeLoudness = function (channelData, sampleRate = 48000) {
    const kw = kWeightChannel(channelData, sampleRate);
    let sumSq = 0, truePeak = 0;
    const len = Math.max(1, channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > truePeak) truePeak = abs;
      sumSq += kw[i] * kw[i];
    }
    const meanSq = sumSq / len;
    const lufs = meanSq <= 1e-12 ? -120 : -0.691 + 10 * Math.log10(meanSq);
    return {
      rms: Math.sqrt(meanSq),
      rmsDb: DSPEngine.gainToDb(Math.sqrt(meanSq)),
      truePeak,
      truePeakDb: DSPEngine.gainToDb(truePeak),
      estimatedLufs: lufs,
    };
  };

  DSPEngine.analyzeStereoLoudness = function (left, right, sampleRate = 48000) {
    const kwL = kWeightChannel(left, sampleRate);
    const kwR = kWeightChannel(right || left, sampleRate);
    const len = Math.max(1, Math.min(kwL.length, kwR.length));
    let sumL = 0, sumR = 0, truePeak = 0;
    for (let i = 0; i < len; i++) {
      const pk = Math.max(Math.abs(left[i]), Math.abs((right || left)[i]));
      if (pk > truePeak) truePeak = pk;
      sumL += kwL[i] * kwL[i];
      sumR += kwR[i] * kwR[i];
    }
    const energy = (sumL + sumR) / len;
    const lufs = energy <= 1e-12 ? -120 : -0.691 + 10 * Math.log10(energy);
    return { lufsIntegrated: lufs, estimatedLufs: lufs, truePeak, truePeakDb: DSPEngine.gainToDb(truePeak) };
  };

  DSPEngine.applyBrickwallLimiter = function (buffer, ceilingDb = -1.0, releaseMs = 50, sampleRate = 48000) {
    const ceiling = DSPEngine.dbToGain(ceilingDb);
    const releaseCoeff = Math.exp(-1.0 / (((releaseMs || 50) / 1000.0) * sampleRate));
    let env = 0;
    const out = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const abs = Math.abs(buffer[i]);
      env = abs > env ? abs : abs + releaseCoeff * (env - abs);
      const gain = env > ceiling ? ceiling / (env + 1e-6) : 1.0;
      out[i] = Math.max(-ceiling, Math.min(ceiling, buffer[i] * gain));
    }
    return out;
  };

  DSPEngine.applyStereoBrickwallLimiter = function (left, right, ceilingDb = -1.0, releaseMs = 50, sampleRate = 48000) {
    const ceiling = DSPEngine.dbToGain(ceilingDb);
    const releaseCoeff = Math.exp(-1.0 / (((releaseMs || 50) / 1000.0) * sampleRate));
    let env = 0;
    const len = Math.min(left.length, right.length);
    for (let i = 0; i < len; i++) {
      const abs = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      env = abs > env ? abs : abs + releaseCoeff * (env - abs);
      const gain = env > ceiling ? ceiling / (env + 1e-6) : 1.0;
      left[i] = Math.max(-ceiling, Math.min(ceiling, left[i] * gain));
      right[i] = Math.max(-ceiling, Math.min(ceiling, right[i] * gain));
    }
    return { left, right };
  };

  DSPEngine.normalizeLoudness = function (buffer, targetLufs = -14.0, sampleRate = 48000) {
    const analysis = DSPEngine.analyzeLoudness(buffer, sampleRate);
    if (analysis.estimatedLufs <= -100) return { appliedGainDb: 0, newAnalysis: analysis };
    const gainDiffDb = Math.max(-36, Math.min(36, targetLufs - analysis.estimatedLufs));
    const mult = DSPEngine.dbToGain(gainDiffDb);
    for (let i = 0; i < buffer.length; i++) buffer[i] *= mult;
    const limited = DSPEngine.applyBrickwallLimiter(buffer, -1.0, 50, sampleRate);
    buffer.set(limited);
    return { appliedGainDb: gainDiffDb, newAnalysis: DSPEngine.analyzeLoudness(buffer, sampleRate) };
  };

  DSPEngine.normalizeStereoLoudness = function (left, right, targetLufs = -14.0, ceilingDb = -1.0, sampleRate = 48000) {
    const before = DSPEngine.analyzeStereoLoudness(left, right, sampleRate);
    if (before.lufsIntegrated > -100) {
      const gainDiffDb = Math.max(-36, Math.min(36, targetLufs - before.lufsIntegrated));
      const mult = DSPEngine.dbToGain(gainDiffDb);
      for (let i = 0; i < left.length; i++) left[i] *= mult;
      for (let i = 0; i < right.length; i++) right[i] *= mult;
    }
    DSPEngine.applyStereoBrickwallLimiter(left, right, ceilingDb, 50, sampleRate);
    return DSPEngine.analyzeStereoLoudness(left, right, sampleRate);
  };

  function processSingleChannelStrip(rawChan, sampleRate, cfg) {
    let buf = DSPEngine.applyClipEnvelope(rawChan, sampleRate, cfg);
    const gainDb = cfg.gainDb !== undefined
      ? Number(cfg.gainDb)
      : (cfg.volume !== undefined ? DSPEngine.gainToDb(Math.max(0.001, Number(cfg.volume))) : 0);
    const linGain = DSPEngine.dbToGain(gainDb);
    if (Math.abs(linGain - 1.0) > 1e-4) {
      for (let i = 0; i < buf.length; i++) buf[i] *= linGain;
    }
    if (cfg.hpf || cfg.hpf85Hz || (cfg.highpassHz && cfg.highpassHz > 15)) {
      const hz = cfg.highpassHz && cfg.highpassHz > 15 ? Number(cfg.highpassHz) : 85;
      DSPEngine.applyBiquad(buf, DSPEngine.createBiquadCoefficients('highpass', sampleRate, hz, 0.7071, 0));
    }
    if (cfg.gateThresholdDb !== undefined && cfg.gateThresholdDb !== null) {
      buf = DSPEngine.applyNoiseGate(buf, sampleRate, { thresholdDb: Number(cfg.gateThresholdDb) });
    }
    if (cfg.eqLowDb) DSPEngine.applyBiquad(buf, DSPEngine.createBiquadCoefficients('lowshelf', sampleRate, 100, 0.7071, Number(cfg.eqLowDb)));
    if (cfg.eqMidDb) DSPEngine.applyBiquad(buf, DSPEngine.createBiquadCoefficients('peaking', sampleRate, 1500, 1.2, Number(cfg.eqMidDb)));
    if (cfg.eqHighDb) DSPEngine.applyBiquad(buf, DSPEngine.createBiquadCoefficients('highshelf', sampleRate, 8000, 0.7071, Number(cfg.eqHighDb)));
    if (cfg.compRatio && Number(cfg.compRatio) > 1.05) {
      DSPEngine.applyDynamicsCompressor(buf, sampleRate, { thresholdDb: Number(cfg.compThresholdDb ?? -18), ratio: Number(cfg.compRatio) });
    }
    if (cfg.distortionMode && cfg.distortionMode !== 'bypass' && cfg.distortionMode !== 'off' && Number(cfg.driveDb) > 0) {
      DSPEngine.applyDistortion(buf, cfg.distortionMode, Number(cfg.driveDb));
    }
    if (cfg.reverbMix && Number(cfg.reverbMix) > 0.005) {
      DSPEngine.applySchroederReverb(buf, sampleRate, Number(cfg.reverbMix), 1.2);
    }
    return buf;
  }

  DSPEngine.processStemChannel = function (channels, sampleRate, cfg = {}) {
    const chL = processSingleChannelStrip(channels[0] || new Float32Array(0), sampleRate, cfg);
    const chR = channels[1] ? processSingleChannelStrip(channels[1], sampleRate, cfg) : new Float32Array(chL);
    const pan = Math.max(-1, Math.min(1, Number(cfg.pan ?? 0)));
    const angle = ((pan + 1) * Math.PI) / 4;
    const panL = Math.cos(angle);
    const panR = Math.sin(angle);
    const len = Math.min(chL.length, chR.length);
    const monoTrigger = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      monoTrigger[i] = 0.5 * (chL[i] + chR[i]);
      chL[i] *= panL;
      chR[i] *= panR;
    }
    return { left: chL, right: chR, monoTrigger };
  };

  DSPEngine.renderMultitrackMixdown = function (stemEntries, sampleRate = 48000, masterCfg = {}) {
    const anySolo = stemEntries.some((s) => Boolean(s.config?.solo));
    const active = stemEntries.filter((s) => !s.config?.muted && (!anySolo || Boolean(s.config?.solo)));
    const processed = active.map((entry) => {
      const resampled = (entry.channels || []).map((ch) => DSPEngine.resampleChannel(ch, entry.sampleRate || sampleRate, sampleRate));
      const strip = DSPEngine.processStemChannel(resampled, sampleRate, entry.config || {});
      return { id: entry.id, role: String(entry.config?.role || entry.config?.trackName || '').toLowerCase(), config: entry.config || {}, strip };
    });

    const defaultTrigger = processed.find((p) => p.role.includes('vocal') || p.role.includes('voice') || p.role.includes('drum')) || processed[0];
    for (const p of processed) {
      if (!p.config.ducking) continue;
      const trig = (p.config.duckTriggerTrackId && processed.find((c) => c.id === p.config.duckTriggerTrackId)) || defaultTrigger;
      if (trig && trig !== p) {
        DSPEngine.applySidechainDucking(p.strip.left, trig.strip.monoTrigger, sampleRate, { duckDepthDb: p.config.duckDepthDb ?? -14 });
        DSPEngine.applySidechainDucking(p.strip.right, trig.strip.monoTrigger, sampleRate, { duckDepthDb: p.config.duckDepthDb ?? -14 });
      }
    }

    const maxLen = Math.max(1, ...processed.map((p) => p.strip.left.length));
    const mixL = new Float32Array(maxLen);
    const mixR = new Float32Array(maxLen);
    const masterGain = DSPEngine.dbToGain(masterCfg.masterGainDb ?? 0);
    for (const p of processed) {
      for (let i = 0; i < p.strip.left.length; i++) {
        mixL[i] += p.strip.left[i] * masterGain;
        mixR[i] += p.strip.right[i] * masterGain;
      }
    }

    const normalize = masterCfg.normalize !== false;
    const stats = normalize
      ? DSPEngine.normalizeStereoLoudness(mixL, mixR, Number(masterCfg.targetLufs ?? -14.0), Number(masterCfg.ceilingDb ?? -1.0), sampleRate)
      : (() => {
          DSPEngine.applyStereoBrickwallLimiter(mixL, mixR, Number(masterCfg.ceilingDb ?? -1.0), 50, sampleRate);
          return DSPEngine.analyzeStereoLoudness(mixL, mixR, sampleRate);
        })();
    return {
      left: mixL,
      right: mixR,
      sampleRate,
      durationSeconds: maxLen / sampleRate,
      lufsIntegrated: Number(stats.lufsIntegrated.toFixed(2)),
      truePeakDb: Number(stats.truePeakDb.toFixed(2)),
    };
  };

  DSPEngine.encodeWav = function (channels, sampleRate = 48000) {
    const numChannels = Math.max(1, channels.length);
    const numSamples = channels[0] ? channels[0].length : 0;
    const blockAlign = numChannels * 2;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const s = Math.max(-1, Math.min(1, channels[ch][i] || 0));
        view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
        offset += 2;
      }
    }
    return typeof Buffer !== 'undefined' ? Buffer.from(buffer) : buffer;
  };

  function readPcmSample(view, pos, audioFormat, bitsPerSample) {
    if (audioFormat === 3 && bitsPerSample === 32) return Math.max(-1, Math.min(1, view.getFloat32(pos, true)));
    if (bitsPerSample === 8) return (view.getUint8(pos) - 128) / 128;
    if (bitsPerSample === 16) return view.getInt16(pos, true) / 32768;
    if (bitsPerSample === 24) {
      const b0 = view.getUint8(pos), b1 = view.getUint8(pos + 1), b2 = view.getInt8(pos + 2);
      return ((b2 << 16) | (b1 << 8) | b0) / 8388608;
    }
    if (bitsPerSample === 32) return view.getInt32(pos, true) / 2147483648;
    throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
  }

  DSPEngine.decodeWav = function (wavBuf) {
    const u8 = wavBuf instanceof Uint8Array ? wavBuf : new Uint8Array(wavBuf);
    if (u8.byteLength < 44) throw new Error('Invalid RIFF/WAVE container: truncated header');
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const readFourCC = (off) => String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
    if (readFourCC(0) !== 'RIFF' || readFourCC(8) !== 'WAVE') {
      throw new Error('Invalid RIFF/WAVE container: missing RIFF/WAVE magic');
    }
    let audioFormat = 1, numChannels = 0, sampleRate = 48000, bitsPerSample = 16, dataOffset = -1, dataSize = 0;
    let cursor = 12;
    while (cursor + 8 <= u8.byteLength) {
      const id = readFourCC(cursor);
      const size = view.getUint32(cursor + 4, true);
      const body = cursor + 8;
      if (id === 'fmt ' && body + 16 <= u8.byteLength) {
        audioFormat = view.getUint16(body, true);
        numChannels = view.getUint16(body + 2, true);
        sampleRate = view.getUint32(body + 4, true);
        bitsPerSample = view.getUint16(body + 14, true);
        if (audioFormat === 0xfffe && size >= 40 && body + 26 <= u8.byteLength) {
          audioFormat = view.getUint16(body + 24, true);
        }
      } else if (id === 'data') {
        dataOffset = body;
        dataSize = Math.min(size, u8.byteLength - body);
        break;
      }
      cursor = body + size + (size % 2);
    }
    if (!numChannels || dataOffset < 0 || (audioFormat !== 1 && audioFormat !== 3)) {
      throw new Error('Unsupported or incomplete WAV fmt/data chunks');
    }
    const bytesPerSample = bitsPerSample / 8;
    const frameBytes = numChannels * bytesPerSample;
    const numSamples = Math.floor(dataSize / frameBytes);
    const outChannels = Math.min(numChannels, 2);
    const channels = Array.from({ length: outChannels }, () => new Float32Array(numSamples));
    for (let i = 0; i < numSamples; i++) {
      const base = dataOffset + i * frameBytes;
      for (let ch = 0; ch < outChannels; ch++) {
        channels[ch][i] = readPcmSample(view, base + ch * bytesPerSample, audioFormat, bitsPerSample);
      }
    }
    return { sampleRate, channels, durationSeconds: numSamples / sampleRate };
  };

  DSPEngine.applyPitchShift = function (buffer, sampleRate, semitones) {
    if (!semitones || Math.abs(semitones) < 0.05) return buffer;
    const pitchRatio = Math.pow(2, semitones / 12);
    const grainSize = Math.min(2048, Math.max(64, Math.floor(sampleRate * 0.045)));
    const hopSize = Math.max(16, Math.floor(grainSize / 4));
    const total = buffer.length;
    if (total <= grainSize) return new Float32Array(buffer);
    const output = new Float32Array(total);
    const norm = new Float32Array(total);
    const win = new Float32Array(grainSize);
    for (let i = 0; i < grainSize; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
    for (let inPos = 0; inPos < total - grainSize; inPos += hopSize) {
      for (let i = 0; i < grainSize; i++) {
        const readIdx = inPos + Math.floor(i * pitchRatio);
        const outIdx = inPos + i;
        if (readIdx < total && outIdx < total) {
          output[outIdx] += buffer[readIdx] * win[i];
          norm[outIdx] += win[i];
        }
      }
    }
    for (let i = 0; i < total; i++) output[i] = norm[i] > 0.001 ? output[i] / norm[i] : buffer[i];
    return output;
  };

  DSPEngine.applyFormantFilter = function (buffer, sampleRate, options = {}) {
    if (options.chestBoostDb) DSPEngine.applyBiquad(buffer, DSPEngine.createBiquadCoefficients('lowshelf', sampleRate, 120, 0.707, options.chestBoostDb));
    if (options.f1GainDb) DSPEngine.applyBiquad(buffer, DSPEngine.createBiquadCoefficients('peaking', sampleRate, options.f1Freq || 500, 2.0, options.f1GainDb));
    if (options.f2GainDb) DSPEngine.applyBiquad(buffer, DSPEngine.createBiquadCoefficients('peaking', sampleRate, options.f2Freq || 1500, 2.5, options.f2GainDb));
    if (options.f3GainDb) DSPEngine.applyBiquad(buffer, DSPEngine.createBiquadCoefficients('peaking', sampleRate, options.f3Freq || 2500, 3.0, options.f3GainDb));
    if (options.airBoostDb) DSPEngine.applyBiquad(buffer, DSPEngine.createBiquadCoefficients('highshelf', sampleRate, 6500, 0.707, options.airBoostDb));
    return buffer;
  };

  DSPEngine.applyRingModulation = function (buffer, sampleRate, carrierFreq = 80, mix = 0.2) {
    const out = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const carrier = Math.sin(2 * Math.PI * carrierFreq * (i / sampleRate));
      out[i] = buffer[i] * (1 - mix) + buffer[i] * carrier * mix;
    }
    return out;
  };

  DSPEngine.VOICE_PERSONAS = {
    morgan_freeman: {
      name: 'Cinematic Narrator', kokoroVoice: 'bm_george',
      description: 'Deep resonant baritone with chest warmth and broadcast presence.',
      semitones: -2.0, chestBoostDb: 4.0, f1Freq: 420, f1GainDb: 2.5, f2Freq: 980, f2GainDb: 1.5, f3Freq: 2100, f3GainDb: -1.0, airBoostDb: 1.5, tubeWarmthDb: 1.8, reverbMix: 0.10,
    },
    david_attenborough: {
      name: 'Nature Documentarian', kokoroVoice: 'bm_lewis',
      description: 'Intimate natural cadence with crisp upper-midrange articulation.',
      semitones: -0.6, chestBoostDb: 1.0, f1Freq: 520, f1GainDb: 1.0, f2Freq: 1450, f2GainDb: 2.5, f3Freq: 2800, f3GainDb: 2.0, airBoostDb: 3.2, tubeWarmthDb: 0.5, reverbMix: 0.05,
    },
    freddie_mercury: {
      name: 'Rock Opera Tenor', kokoroVoice: 'am_michael',
      description: 'Harmonic upper-tenor bite and analog stage saturation.',
      semitones: 1.8, chestBoostDb: -1.0, f1Freq: 680, f1GainDb: 2.5, f2Freq: 1900, f2GainDb: 4.0, f3Freq: 3200, f3GainDb: 3.5, airBoostDb: 2.0, tubeWarmthDb: 4.0, reverbMix: 0.16,
    },
    vintage_radio: {
      name: '1940s Transatlantic Broadcast', kokoroVoice: 'bm_george',
      description: 'Band-limited AM console response with tube harmonic compression.',
      semitones: 0.0, chestBoostDb: -6.0, f1Freq: 800, f1GainDb: 5.0, f2Freq: 2200, f2GainDb: 6.0, f3Freq: 3100, f3GainDb: 4.0, airBoostDb: -8.0, tubeWarmthDb: 5.5, bandpass: true, reverbMix: 0.02,
    },
    hal_9000: {
      name: 'Cybernetic Mission Voice', kokoroVoice: 'am_adam',
      description: 'Measured synthetic timbre with subtle 75 Hz ring carrier.',
      semitones: 0.0, chestBoostDb: -2.0, f1Freq: 600, f1GainDb: 1.5, f2Freq: 1700, f2GainDb: 3.0, f3Freq: 3000, f3GainDb: 2.5, airBoostDb: 2.5, tubeWarmthDb: 0.0, ringModHz: 75, ringModMix: 0.12, reverbMix: 0.06,
    },
    action_hero: {
      name: 'Trailer Baritone', kokoroVoice: 'am_adam',
      description: 'Sub-pitched chest punch with studio limiter weight.',
      semitones: -3.5, chestBoostDb: 5.5, f1Freq: 380, f1GainDb: 3.5, f2Freq: 880, f2GainDb: 2.0, f3Freq: 1800, f3GainDb: -2.0, airBoostDb: -1.0, tubeWarmthDb: 3.0, reverbMix: 0.08,
    },
  };

  DSPEngine.applyVoicePersona = function (buffer, sampleRate, personaKey, userOverrides = {}) {
    const persona = Object.assign({}, DSPEngine.VOICE_PERSONAS[personaKey] || DSPEngine.VOICE_PERSONAS.morgan_freeman, userOverrides);
    let pcm = new Float32Array(buffer);
    if (persona.semitones) pcm = DSPEngine.applyPitchShift(pcm, sampleRate, persona.semitones);
    pcm = DSPEngine.applyFormantFilter(pcm, sampleRate, persona);
    if (persona.bandpass) {
      DSPEngine.applyBiquad(pcm, DSPEngine.createBiquadCoefficients('highpass', sampleRate, 320, 0.707, 0));
      DSPEngine.applyBiquad(pcm, DSPEngine.createBiquadCoefficients('lowpass', sampleRate, 3400, 0.707, 0));
    }
    if (persona.ringModHz && persona.ringModMix) pcm = DSPEngine.applyRingModulation(pcm, sampleRate, persona.ringModHz, persona.ringModMix);
    if (persona.tubeWarmthDb > 0) DSPEngine.applyDistortion(pcm, 'tube', persona.tubeWarmthDb);
    if (persona.reverbMix > 0) DSPEngine.applySchroederReverb(pcm, sampleRate, persona.reverbMix, 1.0);
    return DSPEngine.applyBrickwallLimiter(pcm, -1.0, 50, sampleRate);
  };

  DSPEngine.applyLiveModulationRack = function (buffer, sampleRate, options = {}) {
    let pcm = new Float32Array(buffer);
    DSPEngine.applyBiquad(pcm, DSPEngine.createBiquadCoefficients('highpass', sampleRate, 85, 0.707, 0));
    pcm = DSPEngine.applyNoiseGate(pcm, sampleRate, { thresholdDb: options.gateThresholdDb ?? -45.0, attackMs: 5.0, releaseMs: 120.0 });
    if (options.persona && options.persona !== 'none') {
      const overrides = options.pitchShiftSemitones !== undefined ? { semitones: options.pitchShiftSemitones } : {};
      pcm = DSPEngine.applyVoicePersona(pcm, sampleRate, options.persona, overrides);
    } else if (options.pitchShiftSemitones) {
      pcm = DSPEngine.applyPitchShift(pcm, sampleRate, options.pitchShiftSemitones);
    }
    const driveDb = options.tubeDriveDb !== undefined ? Number(options.tubeDriveDb) : 1.5;
    if (driveDb > 0) DSPEngine.applyDistortion(pcm, 'tube', driveDb);
    return DSPEngine.applyBrickwallLimiter(pcm, -1.0, 40, sampleRate);
  };

  DSPEngine.generateSyntheticAudio = function (type, durationSec, sampleRate) {
    return DSPSynth.generateSyntheticAudio(type, durationSec, sampleRate);
  };

  DSPEngine.generateRockSongStems = function (durationSec, sampleRate) {
    return DSPSynth.generateRockSongStems(durationSec, sampleRate, DSPEngine.normalizeLoudness);
  };

  return DSPEngine;
}));
