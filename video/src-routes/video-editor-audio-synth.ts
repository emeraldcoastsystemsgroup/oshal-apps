/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Procedural CC0-1.0 stereo WAV music/SFX generator, libflite/formant TTS synthesizer, and 16 kHz PCM acoustic speech-band segmenter for auto-captions.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface VoiceOption { id: string; label: string; style: string }
export interface SoundLibraryItem {
  id: string; title: string; category: 'music' | 'sfx'; durationSeconds: number;
  license: 'CC0-1.0'; attribution: 'OSHAL-Procedural'; description: string;
}
export interface SpeechSegment { startSec: number; endSec: number; syllables: number }

export const VOICES: ReadonlyArray<VoiceOption> = Object.freeze([
  { id: 'slt', label: 'Clara', style: 'Clear narration' },
  { id: 'rms', label: 'Marcus', style: 'Warm studio' },
  { id: 'kal16', label: 'Alex', style: 'Crisp presenter' },
  { id: 'awb', label: 'Callum', style: 'Documentary' },
]);

export const SOUND_LIBRARY: ReadonlyArray<SoundLibraryItem> = Object.freeze([
  { id: 'ambient-dawn', title: 'Ambient Dawn', category: 'music', durationSeconds: 6, license: 'CC0-1.0', attribution: 'OSHAL-Procedural', description: 'Warm major-seventh synth pad bed' },
  { id: 'upbeat-pulse', title: 'Upbeat Pulse', category: 'music', durationSeconds: 6, license: 'CC0-1.0', attribution: 'OSHAL-Procedural', description: 'Rhythmic 120 BPM electronic arpeggio' },
  { id: 'cinema-drone', title: 'Cinema Horizon', category: 'music', durationSeconds: 6, license: 'CC0-1.0', attribution: 'OSHAL-Procedural', description: 'Deep orchestral bass swell' },
  { id: 'acoustic-warmth', title: 'Acoustic Warmth', category: 'music', durationSeconds: 6, license: 'CC0-1.0', attribution: 'OSHAL-Procedural', description: 'Plucked harmonic chord progression' },
  { id: 'whoosh-transition', title: 'Whoosh Transition', category: 'sfx', durationSeconds: 1.2, license: 'CC0-1.0', attribution: 'OSHAL-Procedural', description: 'Swept air cut transition' },
  { id: 'chime-ding', title: 'Bright Chime', category: 'sfx', durationSeconds: 1.5, license: 'CC0-1.0', attribution: 'OSHAL-Procedural', description: 'Clean harmonic bell accent' },
  { id: 'pop-accent', title: 'Pop Accent', category: 'sfx', durationSeconds: 0.6, license: 'CC0-1.0', attribution: 'OSHAL-Procedural', description: 'Crisp title pop' },
  { id: 'riser-swell', title: 'Tension Riser', category: 'sfx', durationSeconds: 2.5, license: 'CC0-1.0', attribution: 'OSHAL-Procedural', description: 'Rising pitch reveal' },
]);

const SAMPLE_RATE = 48000;
const wavCache = new Map<string, Buffer>();

export function buildStereoWav(left: Float32Array, right: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const frames = Math.min(left.length, right.length), dataBytes = frames * 4;
  const buf = Buffer.allocUnsafe(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVEfmt ', 8, 'ascii'); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i])), r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  return buf;
}

function sampleMusic(id: string, t: number, dur: number): [number, number] {
  const env = Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.45);
  if (id === 'ambient-dawn') {
    const freqs = [261.63, 329.63, 392.0, 493.88];
    const s = freqs.reduce((acc, f, idx) => acc + Math.sin(2 * Math.PI * f * t + idx * 0.4) * (0.16 - idx * 0.02), 0);
    const lfo = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.35 * t);
    return [s * env * lfo, s * env * (1.6 - lfo) * 0.85];
  }
  if (id === 'upbeat-pulse') {
    const step = Math.floor(t * 4) % 4, local = (t * 4) % 1;
    const notes = [220, 261.63, 329.63, 392.0], f = notes[step];
    const pluck = Math.exp(-local * 5.5) * (Math.sin(2 * Math.PI * f * t) * 0.28 + Math.sin(4 * Math.PI * f * t) * 0.1);
    const bass = Math.sin(2 * Math.PI * 110 * t) * 0.16 * (0.6 + 0.4 * Math.cos(2 * Math.PI * 2 * t));
    return [(pluck + bass) * env, (pluck * 0.92 + bass) * env];
  }
  if (id === 'cinema-drone') {
    const swell = Math.sin((Math.PI * t) / dur);
    const v = (Math.sin(2 * Math.PI * 73.42 * t) * 0.28 + Math.sin(2 * Math.PI * 110 * t) * 0.18 + Math.sin(2 * Math.PI * 146.83 * t) * 0.12) * swell;
    return [v * env, v * env * 0.96];
  }
  const beat = Math.floor(t * 3) % 4, local = (t * 3) % 1, chord = [196.0, 246.94, 293.66, 369.99];
  const tone = Math.exp(-local * 4.2) * (Math.sin(2 * Math.PI * chord[beat] * t) * 0.3 + Math.sin(6 * Math.PI * chord[beat] * t) * 0.06);
  return [tone * env, tone * env * 0.94];
}

function sampleSfx(id: string, t: number, dur: number, seed: number): [number, number] {
  if (id === 'whoosh-transition') {
    const norm = t / dur, bell = Math.sin(Math.PI * norm) ** 2;
    const noise = Math.sin(seed * 12.9898 + t * 43758.5453) % 1;
    const sweep = Math.sin(2 * Math.PI * (140 + 680 * norm) * t) * 0.28 + noise * 0.22;
    return [sweep * bell * (1 - norm * 0.3), sweep * bell * (0.7 + norm * 0.3)];
  }
  if (id === 'chime-ding') {
    const d = Math.exp(-t * 3.4);
    const v = (Math.sin(2 * Math.PI * 880 * t) * 0.32 + Math.sin(2 * Math.PI * 1318.5 * t) * 0.18 + Math.sin(2 * Math.PI * 1760 * t) * 0.1) * d;
    return [v, v * 0.97];
  }
  if (id === 'pop-accent') {
    const freq = 140 + 280 * Math.exp(-t * 18), amp = Math.exp(-t * 11);
    const v = Math.sin(2 * Math.PI * freq * t) * 0.45 * amp;
    return [v, v];
  }
  const norm = t / dur, phase = 2 * Math.PI * (160 * t + 260 * (t * t) / dur);
  const v = (Math.sin(phase) * 0.3 + Math.sin(phase * 1.5) * 0.14) * (norm ** 1.6) * Math.min(1, (dur - t) / 0.08);
  return [v, v * 0.95];
}

export function synthesizeLibraryWav(itemId: string): Buffer | null {
  const item = SOUND_LIBRARY.find(entry => entry.id === itemId);
  if (!item) return null;
  const hit = wavCache.get(itemId);
  if (hit) return hit;
  const frames = Math.round(item.durationSeconds * SAMPLE_RATE);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE;
    const [l, r] = item.category === 'music' ? sampleMusic(item.id, t, item.durationSeconds) : sampleSfx(item.id, t, item.durationSeconds, i + 1);
    left[i] = l; right[i] = r;
  }
  const wav = buildStereoWav(left, right, SAMPLE_RATE);
  wavCache.set(itemId, wav);
  return wav;
}

function fallbackFormantSpeechWav(text: string): Buffer {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const dur = Math.min(28, Math.max(0.8, words.length * 0.38));
  const frames = Math.round(dur * SAMPLE_RATE), left = new Float32Array(frames), right = new Float32Array(frames);
  const wordSpan = dur / Math.max(1, words.length);
  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE, wIdx = Math.min(words.length - 1, Math.floor(t / wordSpan)), local = (t - wIdx * wordSpan) / wordSpan;
    if (local > 0.82) continue;
    const code = (words[wIdx]?.charCodeAt(0) ?? 70) % 5;
    const f0 = 155 + code * 12 + 8 * Math.sin(2 * Math.PI * 3.2 * t), f1 = 480 + code * 90, f2 = 1350 + code * 180;
    const env = Math.sin(Math.PI * (local / 0.82)) ** 0.6;
    const sample = (Math.sin(2 * Math.PI * f0 * t) * 0.24 + Math.sin(2 * Math.PI * f1 * t) * 0.14 + Math.sin(2 * Math.PI * f2 * t) * 0.08) * env;
    left[i] = sample; right[i] = sample;
  }
  return buildStereoWav(left, right, SAMPLE_RATE);
}

export async function synthesizeVoiceWav(text: string, voiceId: string): Promise<Buffer> {
  const token = randomUUID(), txtFile = join(tmpdir(), `oshal-tts-${token}.txt`), wavFile = join(tmpdir(), `oshal-tts-${token}.wav`);
  try {
    await writeFile(txtFile, text, { mode: 0o600 });
    await new Promise<void>((done, fail) => {
      const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `flite=textfile=${txtFile}:voice=${voiceId}`,
        '-af', 'aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,atrim=end=58',
        '-f', 'wav', `file:${wavFile}`];
      execFile(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: 20000, windowsHide: true }, err => (err ? fail(err) : done()));
    });
    return await readFile(wavFile);
  } catch {
    return fallbackFormantSpeechWav(text);
  } finally {
    await unlink(txtFile).catch(() => undefined);
    await unlink(wavFile).catch(() => undefined);
  }
}

export function extractMono16kPcm(filePath: string): Promise<Int16Array> {
  return new Promise(done => {
    const args = ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file', '-i', `file:${filePath}`,
      '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'];
    execFile(process.env.FFMPEG_PATH || 'ffmpeg', args, { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 15000, windowsHide: true }, (err, stdout) => {
      if (err || !Buffer.isBuffer(stdout) || stdout.length < 640) { done(new Int16Array(0)); return; }
      const samples = new Int16Array(Math.floor(stdout.length / 2));
      for (let i = 0; i < samples.length; i++) samples[i] = stdout.readInt16LE(i * 2);
      done(samples);
    });
  });
}

function measureSpeechFrames(pcm: Int16Array, hop: number): { rms: Float32Array; active: Uint8Array; peak: number } {
  const count = Math.floor(pcm.length / hop), rms = new Float32Array(count), band = new Float32Array(count), zcr = new Float32Array(count);
  let peak = 0;
  for (let w = 0; w < count; w++) {
    let sumSq = 0, diffSq = 0, crosses = 0;
    const base = w * hop;
    for (let i = 0; i < hop; i++) {
      const cur = pcm[base + i] / 32768, prev = i > 0 ? pcm[base + i - 1] / 32768 : cur;
      sumSq += cur * cur; diffSq += (cur - prev) * (cur - prev);
      if ((cur >= 0 && prev < 0) || (cur < 0 && prev >= 0)) crosses++;
    }
    rms[w] = Math.sqrt(sumSq / hop); band[w] = Math.sqrt(diffSq / hop); zcr[w] = crosses / hop;
    if (rms[w] > peak) peak = rms[w];
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0, thresh = Math.max(0.012, floor * 2.4, peak * 0.14);
  const active = new Uint8Array(count);
  for (let w = 0; w < count; w++) {
    if (rms[w] >= thresh && band[w] >= rms[w] * 0.06 && zcr[w] >= 0.01 && zcr[w] <= 0.48) active[w] = 1;
  }
  return { rms, active, peak };
}

export function detectSpeechSegments(pcm: Int16Array, sampleRate = 16000): SpeechSegment[] {
  const hop = Math.round(sampleRate * 0.02);
  if (pcm.length < hop * 4) return [];
  const { rms, active, peak } = measureSpeechFrames(pcm, hop);
  if (peak < 0.012) return [];
  const raw: Array<[number, number]> = [];
  let start = -1, gap = 0;
  for (let w = 0; w < active.length; w++) {
    if (active[w]) { if (start < 0) start = w; gap = 0; }
    else if (start >= 0 && ++gap > 12) { raw.push([start, w - gap + 1]); start = -1; gap = 0; }
  }
  if (start >= 0) raw.push([start, active.length - gap]);
  const segments: SpeechSegment[] = [];
  for (const [s0, e0] of raw) {
    if (e0 - s0 < 6) continue;
    for (let cur = s0; cur < e0; cur += 160) {
      const subEnd = Math.min(e0, cur + 160);
      if (subEnd - cur < 5) continue;
      let syllables = 1;
      for (let w = cur + 2; w < subEnd - 2; w++) if (rms[w] > rms[w - 1] && rms[w] >= rms[w + 1] && rms[w] > peak * 0.25) syllables++;
      segments.push({ startSec: (cur * hop) / sampleRate, endSec: (subEnd * hop) / sampleRate, syllables });
    }
  }
  return segments;
}
