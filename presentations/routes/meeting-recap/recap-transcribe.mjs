/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: local-only WAV chunked transcription via VoiceService (providerId: local-stt) and deterministic transcript parser (.vtt, .srt, JSON, [MM:SS] lines).
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const MAX_CHUNK_SECONDS = 90;

/** Parse HH:MM:SS(.mmm), MM:SS(.mmm), or numeric seconds into seconds. */
export function parseTimestampToSec(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  const text = String(raw ?? '').trim().replace(',', '.');
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Number(text));
  const parts = text.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/** Normalize raw segment objects into bounded chronological transcript segments. */
function normalizeSegments(list) {
  const cleaned = [];
  for (const item of list) {
    const text = String(item?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const startTime = Math.max(0, Number(item.startTime ?? item.start ?? 0) || 0);
    const rawEnd = Number(item.endTime ?? item.end ?? startTime);
    const endTime = Number.isFinite(rawEnd) && rawEnd >= startTime ? rawEnd : startTime;
    const speaker = item.speakerKey || item.speaker ? String(item.speakerKey || item.speaker).trim().slice(0, 80) : undefined;
    cleaned.push({ startTime: Number(startTime.toFixed(2)), endTime: Number(endTime.toFixed(2)), text: text.slice(0, 4000), ...(speaker ? { speakerKey: speaker } : {}) });
  }
  return cleaned.sort((a, b) => a.startTime - b.startTime);
}

/** Parse WebVTT or SubRip cue blocks into segments. */
function parseCueBlocks(text) {
  const blocks = String(text).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split(/\n{2,}/);
  const out = [];
  const timeRe = /^((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length || /^WEBVTT\b/i.test(lines[0]) || /^NOTE\b/i.test(lines[0])) continue;
    const idx = lines.findIndex((l) => timeRe.test(l));
    if (idx < 0) continue;
    const match = timeRe.exec(lines[idx]);
    const body = lines.slice(idx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!body) continue;
    out.push({ startTime: parseTimestampToSec(match[1]), endTime: parseTimestampToSec(match[2]), text: body });
  }
  return normalizeSegments(out);
}

/** Parse timestamped JSON array (`[{startTime, endTime, text, speakerKey?}]`). */
function parseJsonTranscript(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.segments) ? parsed.segments : []);
  return normalizeSegments(rows.map((r) => ({
    startTime: parseTimestampToSec(r.startTime ?? r.start),
    endTime: parseTimestampToSec(r.endTime ?? r.end ?? r.startTime ?? r.start),
    text: r.text ?? r.content ?? '',
    speakerKey: r.speakerKey ?? r.speaker,
  })));
}

/** Parse `[MM:SS] text` or `[HH:MM:SS] Speaker: text` lines. */
function parseBracketLines(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const lineRe = /^\[((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?)\]\s*(.+)$/;
  for (const raw of lines) {
    const m = lineRe.exec(raw.trim());
    if (!m) continue;
    const startTime = parseTimestampToSec(m[1]);
    out.push({ startTime, endTime: startTime, text: m[2].trim() });
  }
  for (let i = 0; i < out.length - 1; i += 1) {
    if (out[i].endTime <= out[i].startTime) out[i].endTime = out[i + 1].startTime;
  }
  return normalizeSegments(out);
}

/** Deterministic local transcript parser supporting .vtt, .srt, JSON, and [MM:SS] text. */
export function parseTranscriptInput(rawText, format = 'auto') {
  const text = String(rawText ?? '').trim();
  if (!text) return [];
  const fmt = String(format || 'auto').toLowerCase().replace(/^\./, '');
  if (fmt === 'json' || (fmt === 'auto' && (text.startsWith('[') || text.startsWith('{')))) {
    try { return parseJsonTranscript(text); } catch { /* fall through */ }
  }
  if (fmt === 'vtt' || fmt === 'srt' || (fmt === 'auto' && /-->/.test(text))) {
    const cues = parseCueBlocks(text);
    if (cues.length) return cues;
  }
  const bracketed = parseBracketLines(text);
  if (bracketed.length) return bracketed;
  const plainLines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  return normalizeSegments(plainLines.map((line, i) => ({ startTime: i * 5, endTime: (i + 1) * 5, text: line })));
}

/** Parse RIFF/WAVE header and locate PCM metadata + data slice bounds. */
function inspectWavBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid WAV header for local transcription');
  }
  let offset = 12;
  let sampleRate = 16000, channels = 1, bitsPerSample = 16;
  let dataStart = -1, dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataStart = body;
      dataSize = Math.min(size, buf.length - body);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (dataStart < 0) throw new Error('WAV file contains no audio data chunk');
  return { sampleRate, channels, bitsPerSample, dataStart, dataSize };
}

/** Build a valid standalone PCM WAV Buffer around raw PCM bytes. */
function wrapPcmWav(pcm, sampleRate, channels, bitsPerSample) {
  const header = Buffer.alloc(44);
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Split a 16 kHz mono WAV into bounded standalone WAV chunks (<= 90 s each). */
export async function sliceWavIntoChunks(wavPath, chunkSec = MAX_CHUNK_SECONDS) {
  const buf = await readFile(wavPath);
  const info = inspectWavBuffer(buf);
  const sec = Math.max(5, Math.min(MAX_CHUNK_SECONDS, Math.floor(Number(chunkSec) || MAX_CHUNK_SECONDS)));
  const bytesPerSec = info.sampleRate * info.channels * (info.bitsPerSample / 8);
  const chunkBytes = Math.max(bytesPerSec, bytesPerSec * sec);
  const chunks = [];
  let pos = 0;
  while (pos < info.dataSize) {
    const end = Math.min(info.dataSize, pos + chunkBytes);
    const pcm = buf.subarray(info.dataStart + pos, info.dataStart + end);
    chunks.push({
      index: chunks.length,
      startSec: Number((pos / bytesPerSec).toFixed(2)),
      endSec: Number((end / bytesPerSec).toFixed(2)),
      buffer: wrapPcmWav(pcm, info.sampleRate, info.channels, info.bitsPerSample),
    });
    pos = end;
  }
  return { totalSeconds: Number((info.dataSize / bytesPerSec).toFixed(2)), chunks };
}

/** Load local VoiceService lazily through the kernel runtime port. */
function resolveLocalVoiceService(override) {
  if (override && typeof override.transcribeAudio === 'function') return override;
  try {
    const mod = require('@/features/voice/services/voice-service');
    if (mod?.VoiceService) return new mod.VoiceService();
  } catch { /* handled below */ }
  const err = new Error('Local transcription (local-stt) is not configured on this host. Configure OSHAL_STT_URL or supply a local transcript (.vtt, .srt, or JSON).');
  err.code = 'local_stt_unavailable';
  throw err;
}

/** Stage 3: Transcribe mono 16 kHz WAV strictly via local-stt — audio never leaves the box. */
export async function transcribeLocalWav(wavPath, opts = {}) {
  const voiceService = resolveLocalVoiceService(opts.voiceService);
  const { totalSeconds, chunks } = await sliceWavIntoChunks(wavPath, opts.chunkSec || MAX_CHUNK_SECONDS);
  const totalMinutes = Number((totalSeconds / 60).toFixed(2));
  const allSegments = [];

  for (const chunk of chunks) {
    let result;
    try {
      result = await voiceService.transcribeAudio(chunk.buffer, 'audio/wav', { providerId: 'local-stt' });
    } catch (cause) {
      const err = new Error(`Local transcription unavailable: ${cause?.message || 'local-stt failed'}. Configure OSHAL_STT_URL or provide a local transcript.`);
      err.code = 'local_stt_unavailable';
      throw err;
    }
    const rawSegs = Array.isArray(result?.segments) && result.segments.length
      ? result.segments
      : (result?.text ? [{ startTime: 0, endTime: chunk.endSec - chunk.startSec, text: result.text }] : []);
    for (const seg of rawSegs) {
      const s = Number(seg.startTime ?? seg.start ?? 0) || 0;
      const e = Number(seg.endTime ?? seg.end ?? s) || s;
      allSegments.push({
        startTime: Number((chunk.startSec + s).toFixed(2)),
        endTime: Number((chunk.startSec + Math.max(s, e)).toFixed(2)),
        text: String(seg.text || '').trim(),
        ...(seg.speakerKey ? { speakerKey: String(seg.speakerKey) } : {}),
      });
    }
    if (typeof opts.onProgress === 'function') {
      await opts.onProgress({ minutesProcessed: Number((chunk.endSec / 60).toFixed(2)), totalMinutes });
    }
  }
  return { segments: normalizeSegments(allSegments), totalSeconds };
}
