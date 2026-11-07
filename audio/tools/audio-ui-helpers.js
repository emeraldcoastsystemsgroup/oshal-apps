/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Audio Studio UI helper module for waveform rendering, stem binary I/O, file decoding, and ADR-208 formula presets.
 */
'use strict';

(function (root) {
  const UIHelpers = {};

  UIHelpers.arrayBufferToBase64 = function (arrayBuf) {
    const bytes = arrayBuf instanceof Uint8Array ? arrayBuf : new Uint8Array(arrayBuf);
    const chunkSize = 0x8000;
    const parts = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
    }
    return btoa(parts.join(''));
  };

  UIHelpers.encodeTrackToWavBase64 = function (track, sampleRate) {
    const sr = track.sampleRate || sampleRate || 48000;
    const left = track.rawPcm || new Float32Array(sr);
    const right = track.rawPcmRight || left;
    const wavBuf = root.DSPEngine.encodeWav([left, right], sr);
    return UIHelpers.arrayBufferToBase64(wavBuf);
  };

  UIHelpers.fetchStemPcm = async function (stem, targetSampleRate) {
    const sr = targetSampleRate || 48000;
    if (stem.blobHash) {
      try {
        const res = await fetch(`/api/audio/blobs/${encodeURIComponent(stem.blobHash)}`);
        if (res.ok) {
          const arr = await res.arrayBuffer();
          const decoded = root.DSPEngine.decodeWav(arr);
          const left = root.DSPEngine.resampleChannel(decoded.channels[0], decoded.sampleRate, sr);
          const right = decoded.channels[1]
            ? root.DSPEngine.resampleChannel(decoded.channels[1], decoded.sampleRate, sr)
            : new Float32Array(left);
          return { left, right, sampleRate: sr };
        }
      } catch {}
    }
    const fallbackType = stem.trackName === 'other' ? 'guitar' : (stem.trackName || 'vocals');
    const synth = root.DSPEngine.generateSyntheticAudio(fallbackType, 4.0, sr);
    return { left: synth, right: new Float32Array(synth), sampleRate: sr };
  };

  UIHelpers.decodeBrowserFile = async function (file, audioCtx, targetSampleRate) {
    const rawBuf = await file.arrayBuffer();
    const base64 = UIHelpers.arrayBufferToBase64(rawBuf);
    if (audioCtx && typeof audioCtx.decodeAudioData === 'function') {
      const decoded = await audioCtx.decodeAudioData(rawBuf.slice(0));
      const left = root.DSPEngine.resampleChannel(decoded.getChannelData(0), decoded.sampleRate, targetSampleRate);
      const right = decoded.numberOfChannels > 1
        ? root.DSPEngine.resampleChannel(decoded.getChannelData(1), decoded.sampleRate, targetSampleRate)
        : new Float32Array(left);
      return { left, right, base64, mimeType: file.type || 'audio/wav' };
    }
    const wav = root.DSPEngine.decodeWav(rawBuf);
    const left = root.DSPEngine.resampleChannel(wav.channels[0], wav.sampleRate, targetSampleRate);
    return { left, right: new Float32Array(left), base64, mimeType: file.type || 'audio/wav' };
  };

  UIHelpers.drawTrackWaveform = function (canvas, track, playheadSec) {
    if (!canvas || !track || !track.peaks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const midY = height / 2;
    const styles = getComputedStyle(document.documentElement);
    const bgColor = styles.getPropertyValue('--bg-tertiary').trim() || '#1a1d2e';
    const waveColor = styles.getPropertyValue('--accent-primary').trim() || '#6e7bff';
    const rmsColor = styles.getPropertyValue('--success').trim() || '#34d399';
    const warnColor = styles.getPropertyValue('--error').trim() || '#f87171';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
    const bins = track.peaks.bins || track.peaks.min?.length || 1;
    const barW = Math.max(1, width / bins);

    for (let b = 0; b < bins; b++) {
      const x = b * barW;
      const minV = track.peaks.min[b] || 0;
      const maxV = track.peaks.max[b] || 0;
      const minY = midY + minV * (midY - 4);
      const maxY = midY + maxV * (midY - 4);
      ctx.fillStyle = Math.max(Math.abs(minV), Math.abs(maxV)) >= 0.99 ? warnColor : waveColor;
      ctx.fillRect(x, Math.min(minY, maxY), Math.max(1, barW - 1), Math.max(2, Math.abs(maxY - minY)));
      const rmsH = (track.peaks.rms[b] || 0) * (midY - 4);
      ctx.fillStyle = rmsColor;
      ctx.fillRect(x, midY - rmsH, Math.max(1, barW - 1), Math.max(1, rmsH * 2));
    }
    const dur = Math.max(0.01, (track.processedLeft?.length || 1) / (track.sampleRate || 48000));
    if (playheadSec > 0 && playheadSec <= dur) {
      const px = Math.round((playheadSec / dur) * width);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, 0, 2, height);
    }
  };

  UIHelpers.CLIENT_MACROS = {
    clean_voice: { hpf: true, eqLowDb: -1.5, eqMidDb: 3.0, eqHighDb: 1.5, compRatio: 3.0, reverbMix: 0.05, label: 'Clean Voice (85 Hz HPF + +3 dB presence + 3:1 comp)' },
    auto_duck: { ducking: true, compRatio: 6.0, label: 'Auto-Duck Music (-14 dB sidechain envelope)' },
    punchy: { eqLowDb: 3.5, eqMidDb: -2.0, eqHighDb: 2.0, compRatio: 4.5, label: 'Punchy Rhythm (+3.5 dB low + transient snap)' },
    warm: { distortionMode: 'tube', driveDb: 4.0, eqLowDb: 2.0, eqMidDb: 1.5, eqHighDb: -1.5, compRatio: 3.5, label: 'Warm Vocal (+4 dB tube warmth + +2 dB body)' },
    space: { reverbMix: 0.30, label: 'Acoustic Space (30% Schroeder room reverb)' },
  };

  root.AudioUIHelpers = UIHelpers;
}(typeof window !== 'undefined' ? window : globalThis));
