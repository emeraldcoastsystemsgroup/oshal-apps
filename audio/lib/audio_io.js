/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Real WAV/FFmpeg (-threads 4) audio container decode/encode and Kokoro TTS voice synthesis adapter for Audio Studio.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const DSPEngine = require('./dsp_engine.js');

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

function isRiffWave(buf) {
  return Buffer.isBuffer(buf)
    && buf.length >= 44
    && buf.subarray(0, 4).toString('ascii') === 'RIFF'
    && buf.subarray(8, 12).toString('ascii') === 'WAVE';
}

function decodeViaFfmpeg(inputBuffer, targetSampleRate = 48000) {
  const sr = Math.max(8000, Number(targetSampleRate || 48000));
  const proc = spawnSync(
    FFMPEG_BIN,
    ['-nostdin', '-v', 'error', '-threads', '4', '-i', 'pipe:0', '-vn', '-ar', String(sr), '-ac', '2', '-f', 'wav', '-acodec', 'pcm_f32le', 'pipe:1'],
    { input: inputBuffer, maxBuffer: 128 * 1024 * 1024, timeout: 30000 }
  );
  if (proc.error || proc.status !== 0 || !proc.stdout || proc.stdout.length < 44) {
    const detail = (proc.stderr ? proc.stderr.toString('utf8').trim() : '') || proc.error?.message || 'decode failed';
    const err = new Error(`Unable to decode audio container: ${detail}`);
    err.status = 422;
    err.code = 'invalid_audio_payload';
    throw err;
  }
  return DSPEngine.decodeWav(proc.stdout);
}

function decodeAudioBuffer(inputBuffer, targetSampleRate = 48000) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length < 12) {
    const err = new Error('Audio payload is empty or truncated');
    err.status = 422;
    err.code = 'invalid_audio_payload';
    throw err;
  }
  const sr = Math.max(8000, Number(targetSampleRate || 48000));
  if (isRiffWave(inputBuffer)) {
    try {
      const decoded = DSPEngine.decodeWav(inputBuffer);
      const channels = decoded.channels.map((ch) => DSPEngine.resampleChannel(ch, decoded.sampleRate, sr));
      return {
        sampleRate: sr,
        channels,
        durationSeconds: (channels[0]?.length || 0) / sr,
      };
    } catch {
      return decodeViaFfmpeg(inputBuffer, sr);
    }
  }
  return decodeViaFfmpeg(inputBuffer, sr);
}

function decodeLivePayload(rawBuf, sampleRate = 48000) {
  if (!Buffer.isBuffer(rawBuf) || rawBuf.length < 4) {
    const err = new Error('Audio buffer is required');
    err.status = 400;
    err.code = 'invalid_audio_payload';
    throw err;
  }
  const magic = rawBuf.subarray(0, 4).toString('ascii');
  const isContainer = isRiffWave(rawBuf)
    || magic.startsWith('ID3')
    || magic === 'OggS'
    || magic === 'fLaC'
    || (rawBuf[0] === 0xff && (rawBuf[1] & 0xe0) === 0xe0)
    || (rawBuf.length >= 8 && rawBuf.subarray(4, 8).toString('ascii') === 'ftyp');
  if (isContainer) {
    const decoded = decodeAudioBuffer(rawBuf, sampleRate);
    return { pcm: decoded.channels[0], sampleRate: decoded.sampleRate };
  }
  if (rawBuf.length % 4 !== 0) {
    const err = new Error('Raw PCM payload must be 32-bit IEEE float aligned or a valid audio container');
    err.status = 422;
    err.code = 'invalid_audio_payload';
    throw err;
  }
  const aligned = new Uint8Array(rawBuf.length);
  aligned.set(rawBuf);
  const floats = new Float32Array(aligned.buffer);
  for (let i = 0; i < floats.length; i++) {
    if (!Number.isFinite(floats[i])) floats[i] = 0;
  }
  return { pcm: floats, sampleRate };
}

function encodeMixdownOutput(left, right, sampleRate = 48000, format = 'wav') {
  const wavBuffer = Buffer.from(DSPEngine.encodeWav([left, right], sampleRate));
  if (format !== 'mp3') {
    return { buffer: wavBuffer, mimeType: 'audio/wav', format: 'wav' };
  }
  const proc = spawnSync(
    FFMPEG_BIN,
    ['-nostdin', '-v', 'error', '-threads', '4', '-f', 'wav', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1'],
    { input: wavBuffer, maxBuffer: 64 * 1024 * 1024, timeout: 30000 }
  );
  if (proc.error || proc.status !== 0 || !proc.stdout || proc.stdout.length < 32) {
    const detail = (proc.stderr ? proc.stderr.toString('utf8').trim() : '') || proc.error?.message || 'MP3 encode failed';
    const err = new Error(`MP3 transcoding failed: ${detail}`);
    err.status = 500;
    err.code = 'mp3_encode_failed';
    throw err;
  }
  return { buffer: proc.stdout, mimeType: 'audio/mpeg', format: 'mp3' };
}

async function synthesizeSpeechViaService({ text, personaKey = 'morgan_freeman', sampleRate = 48000 }) {
  const endpoint = process.env.OSHAL_TTS_URL || 'http://127.0.0.1:8880/v1/audio/speech';
  const persona = DSPEngine.VOICE_PERSONAS[personaKey] || DSPEngine.VOICE_PERSONAS.morgan_freeman;
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kokoro',
        input: String(text).slice(0, 5000),
        voice: persona.kokoroVoice || 'bm_george',
        response_format: 'wav',
        speed: 1.0,
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (cause) {
    const err = new Error(`Speech synthesis service unavailable at ${endpoint}: ${cause.message}`);
    err.status = 503;
    err.code = 'speech_service_unavailable';
    throw err;
  }
  if (!response.ok) {
    const err = new Error(`Speech synthesis service returned HTTP ${response.status}`);
    err.status = 503;
    err.code = 'speech_service_unavailable';
    throw err;
  }
  const rawBytes = Buffer.from(await response.arrayBuffer());
  const decoded = decodeAudioBuffer(rawBytes, sampleRate);
  const morphed = DSPEngine.applyVoicePersona(decoded.channels[0], sampleRate, personaKey);
  DSPEngine.normalizeLoudness(morphed, -16.0, sampleRate);
  const wavBuf = Buffer.from(DSPEngine.encodeWav([morphed, morphed], sampleRate));
  return {
    wavBuffer: wavBuf,
    sampleRate,
    durationSeconds: Number((morphed.length / sampleRate).toFixed(3)),
    personaKey,
  };
}

module.exports = {
  isRiffWave,
  decodeAudioBuffer,
  decodeLivePayload,
  encodeMixdownOutput,
  synthesizeSpeechViaService,
};
