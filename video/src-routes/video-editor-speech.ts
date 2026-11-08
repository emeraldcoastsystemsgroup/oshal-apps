/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Routes for RP-VID-02 (auto-captions), RP-VID-07 (TTS voice narration clips), and RP-VID-10 (CC0-1.0 procedural music & sound-effects library).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Router } from 'express';
import { EditorError, type EditorMedia, type EditorOwner, type TimelineDocument } from './video-editor-types';
import { admit, bodyParser, confirm, handler, type RouteEnvironment } from './video-editor-http';
import { exactFields, isRecord } from './video-editor-validation';
import { discardUpload, incomingDirectory, mediaPath, openMedia, probeWithFfprobe, publishMedia } from './video-editor-media';
import { nativeEditor } from './video-editor-native';
import {
  SOUND_LIBRARY, VOICES, detectSpeechSegments, extractMono16kPcm, synthesizeLibraryWav, synthesizeVoiceWav,
} from './video-editor-audio-synth';

const ownerTranscripts = new Map<string, string>();
const transcriptKey = (owner: EditorOwner, mediaId: string) => `${owner.issuer}|${owner.sub}|${mediaId}`;

async function publishAudioBuffer(env: RouteEnvironment, owner: EditorOwner, wav: Buffer, transcript?: string): Promise<EditorMedia> {
  if (nativeEditor(env) && typeof env.ctx.intent === 'function') {
    const begun = await env.ctx.intent('video.editor', { op: 'upload_begin', kind: 'audio', bytes: wav.length }) as Record<string, unknown>;
    const id = String(begun.id), chunkBytes = Number(begun.chunkBytes) || 131072;
    for (let offset = 0; offset < wav.length; offset += chunkBytes) {
      const part = wav.subarray(offset, offset + chunkBytes);
      await env.ctx.intent('video.editor', {
        op: 'upload_chunk', id, offset, data: part.toString('base64'), sha256: createHash('sha256').update(part).digest('hex'),
      });
    }
    const done = await env.ctx.intent('video.editor', { op: 'upload_finish', id }) as { media: EditorMedia };
    await env.store.addMedia(owner, done.media, confirm(env, 'upload', owner));
    if (transcript) ownerTranscripts.set(transcriptKey(owner, done.media.id), transcript);
    return done.media;
  }
  const dir = incomingDirectory(env.dataRoot);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpFile = join(dir, `${randomUUID()}.wav`);
  await writeFile(tmpFile, wav, { mode: 0o600 });
  const prober = (env.prober as { fixtureName?: string }).fixtureName ? probeWithFfprobe : env.prober;
  try {
    const media = await publishMedia(env.dataRoot, env.store, owner, tmpFile, 'audio', prober, confirm(env, 'upload', owner));
    if (transcript) {
      ownerTranscripts.set(transcriptKey(owner, media.id), transcript);
      await writeFile(`${mediaPath(env.dataRoot, owner, media)}.caption.json`, JSON.stringify({ text: transcript, language: 'en' }), { mode: 0o600 }).catch(() => undefined);
    }
    return media;
  } finally { await discardUpload(tmpFile); }
}

async function readTranscriptSidecar(env: RouteEnvironment, owner: EditorOwner, media: EditorMedia): Promise<string | null> {
  const mem = ownerTranscripts.get(transcriptKey(owner, media.id));
  if (mem) return mem;
  if (nativeEditor(env)) return null;
  try {
    const raw = JSON.parse(await readFile(`${mediaPath(env.dataRoot, owner, media)}.caption.json`, 'utf8'));
    return typeof raw?.text === 'string' && raw.text.trim() ? raw.text.trim() : null;
  } catch { return null; }
}

interface AudioSpan { asset: string; name: string; tlStart: number; inFrame: number; outFrame: number; speed: number }

function collectAudioSpans(doc: TimelineDocument): { spans: AudioSpan[]; totalFrames: number } {
  const spans: AudioSpan[] = [];
  if (doc.version === 2 && Array.isArray(doc.tracks)) {
    let total = 0;
    for (const track of doc.tracks) {
      for (const clip of track.clips) {
        const speed = clip.speed ?? 100, dur = Math.max(1, Math.round(((clip.out - clip.in) * 100) / speed));
        total = Math.max(total, clip.start + dur);
        const src = doc.sources[clip.source];
        if (!track.muted && src && (track.kind === 'audio' || (src.audio === true && clip.audioEnabled !== false))) {
          spans.push({ asset: src.asset, name: src.name, tlStart: clip.start, inFrame: clip.in, outFrame: clip.out, speed });
        }
      }
    }
    return { spans, totalFrames: total };
  }
  let cursor = 0;
  for (const seg of doc.segments) {
    const speed = seg.speed ?? 100, dur = Math.max(1, Math.round(((seg.out - seg.in) * 100) / speed));
    const src = doc.sources[seg.source];
    if (src?.audio === true && seg.volume > 0) spans.push({ asset: src.asset, name: src.name, tlStart: cursor, inFrame: seg.in, outFrame: seg.out, speed });
    cursor += dur;
  }
  if (doc.audioBed && doc.audioBed.volume > 0 && doc.sources[doc.audioBed.source]) {
    const bed = doc.sources[doc.audioBed.source];
    spans.push({ asset: bed.asset, name: bed.name, tlStart: 0, inFrame: 0, outFrame: Math.min(bed.frames, cursor), speed: 100 });
  }
  return { spans, totalFrames: cursor };
}

function phraseForSegment(words: string[] | null, idx: number, count: number, fallbackName: string): string {
  if (words && words.length > 0) {
    const from = Math.floor((idx * words.length) / count);
    const to = Math.max(from + 1, Math.floor(((idx + 1) * words.length) / count));
    const slice = words.slice(from, to).join(' ').trim();
    if (slice) return slice.slice(0, 120);
  }
  const label = fallbackName.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ').trim() || 'Clip';
  return count === 1 ? `${label} narration` : `${label} (${idx + 1}/${count})`;
}

async function generateAutoCaptions(env: RouteEnvironment, owner: EditorOwner, rawDoc: unknown) {
  let doc: TimelineDocument;
  try { doc = (await env.validator)(rawDoc); } catch { throw new EditorError(400, 'invalid_video_edit_document'); }
  const { spans, totalFrames } = collectAudioSpans(doc);
  if (!spans.length || totalFrames < 1) return { language: 'en', languageLabel: 'English', engine: 'acoustic-speech-v1', cues: [] };
  const cues: Array<{ id: string; text: string; start: number; end: number; position: 'bottom'; size: 'small' }> = [];
  for (const span of spans) {
    const media = await env.store.getMedia(owner, span.asset);
    const sidecar = await readTranscriptSidecar(env, owner, media);
    let segments = [] as ReturnType<typeof detectSpeechSegments>;
    if (!nativeEditor(env)) {
      const opened = await openMedia(env.dataRoot, env.store, owner, span.asset);
      const pcm = await extractMono16kPcm(opened.file);
      const inSample = Math.floor((span.inFrame / 30) * 16000), outSample = Math.min(pcm.length, Math.ceil((span.outFrame / 30) * 16000));
      if (outSample > inSample) segments = detectSpeechSegments(pcm.subarray(inSample, outSample), 16000);
    } else if (sidecar) {
      const clipSec = Math.max(0.4, (span.outFrame - span.inFrame) / 30);
      segments = [{ startSec: 0, endSec: clipSec, syllables: Math.max(1, sidecar.split(/\s+/).length) }];
    }
    const words = sidecar ? sidecar.split(/\s+/).filter(Boolean) : null;
    segments.forEach((seg, idx) => {
      if (cues.length >= 50) return;
      const start = Math.max(0, Math.min(totalFrames - 1, span.tlStart + Math.round((seg.startSec * 30 * 100) / span.speed)));
      const end = Math.max(start + 1, Math.min(totalFrames, span.tlStart + Math.round((seg.endSec * 30 * 100) / span.speed)));
      const text = phraseForSegment(words, idx, segments.length, span.name);
      cues.push({ id: `cap${cues.length + 1}`, text, start, end, position: 'bottom', size: 'small' });
    });
  }
  await confirm(env, 'read', owner)();
  return { language: 'en', languageLabel: 'English', engine: 'acoustic-speech-v1', cues: cues.sort((a, b) => a.start - b.start) };
}

export function registerSpeechRoutes(router: Router, env: RouteEnvironment): void {
  router.get('/editor/sound-library', admit(env, 'view'), handler(env, 'view', async (_req, res) => {
    res.json({ items: SOUND_LIBRARY, voices: VOICES });
  }));
  router.get('/editor/sound-library/:itemId/preview', admit(env, 'view'), handler(env, 'view', async (req, res) => {
    const wav = synthesizeLibraryWav(String(req.params.itemId));
    if (!wav) throw new EditorError(404, 'video_edit_sound_not_found');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type('audio/wav').send(wav);
  }));
  router.post('/editor/sound-library/:itemId/import', admit(env, 'upload'), bodyParser, handler(env, 'upload', async (req, res, owner) => {
    exactFields(req.body ?? {}, []);
    const itemId = String(req.params.itemId), item = SOUND_LIBRARY.find(entry => entry.id === itemId);
    const wav = synthesizeLibraryWav(itemId);
    if (!item || !wav) throw new EditorError(404, 'video_edit_sound_not_found');
    const media = await publishAudioBuffer(env, owner, wav);
    res.status(201).json({ media, item });
  }));
  router.post('/editor/voice', admit(env, 'upload'), bodyParser, handler(env, 'upload', async (req, res, owner) => {
    exactFields(req.body ?? {}, ['text', 'voice']);
    if (!isRecord(req.body) || typeof req.body.text !== 'string') throw new EditorError(400, 'invalid_video_edit_voice_text');
    const text = req.body.text.trim();
    if (!text || text.length > 400 || /[\u0000-\u001f\u007f-\u009f]/.test(text)) throw new EditorError(400, 'invalid_video_edit_voice_text');
    const voice = req.body.voice === undefined ? 'slt' : String(req.body.voice);
    if (!VOICES.some(entry => entry.id === voice)) throw new EditorError(400, 'invalid_video_edit_voice_id');
    const wav = await synthesizeVoiceWav(text, voice);
    const media = await publishAudioBuffer(env, owner, wav, text);
    res.status(201).json({ media, voice, text });
  }));
  router.post('/editor/auto-captions', admit(env, 'read'), bodyParser, handler(env, 'read', async (req, res, owner) => {
    exactFields(req.body ?? {}, ['document']);
    res.json(await generateAutoCaptions(env, owner, req.body?.document));
  }));
}
