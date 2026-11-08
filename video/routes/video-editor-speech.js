"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSpeechRoutes = registerSpeechRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Routes for RP-VID-02 (auto-captions), RP-VID-07 (TTS voice narration clips), and RP-VID-10 (CC0-1.0 procedural music & sound-effects library).
 */
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const video_editor_types_1 = require("./video-editor-types");
const video_editor_http_1 = require("./video-editor-http");
const video_editor_validation_1 = require("./video-editor-validation");
const video_editor_media_1 = require("./video-editor-media");
const video_editor_native_1 = require("./video-editor-native");
const video_editor_audio_synth_1 = require("./video-editor-audio-synth");
const ownerTranscripts = new Map();
const transcriptKey = (owner, mediaId) => `${owner.issuer}|${owner.sub}|${mediaId}`;
async function publishAudioBuffer(env, owner, wav, transcript) {
    if ((0, video_editor_native_1.nativeEditor)(env) && typeof env.ctx.intent === 'function') {
        const begun = await env.ctx.intent('video.editor', { op: 'upload_begin', kind: 'audio', bytes: wav.length });
        const id = String(begun.id), chunkBytes = Number(begun.chunkBytes) || 131072;
        for (let offset = 0; offset < wav.length; offset += chunkBytes) {
            const part = wav.subarray(offset, offset + chunkBytes);
            await env.ctx.intent('video.editor', {
                op: 'upload_chunk', id, offset, data: part.toString('base64'), sha256: (0, node_crypto_1.createHash)('sha256').update(part).digest('hex'),
            });
        }
        const done = await env.ctx.intent('video.editor', { op: 'upload_finish', id });
        await env.store.addMedia(owner, done.media, (0, video_editor_http_1.confirm)(env, 'upload', owner));
        if (transcript)
            ownerTranscripts.set(transcriptKey(owner, done.media.id), transcript);
        return done.media;
    }
    const dir = (0, video_editor_media_1.incomingDirectory)(env.dataRoot);
    (0, node_fs_1.mkdirSync)(dir, { recursive: true, mode: 0o700 });
    const tmpFile = (0, node_path_1.join)(dir, `${(0, node_crypto_1.randomUUID)()}.wav`);
    await (0, promises_1.writeFile)(tmpFile, wav, { mode: 0o600 });
    const prober = env.prober.fixtureName ? video_editor_media_1.probeWithFfprobe : env.prober;
    try {
        const media = await (0, video_editor_media_1.publishMedia)(env.dataRoot, env.store, owner, tmpFile, 'audio', prober, (0, video_editor_http_1.confirm)(env, 'upload', owner));
        if (transcript) {
            ownerTranscripts.set(transcriptKey(owner, media.id), transcript);
            await (0, promises_1.writeFile)(`${(0, video_editor_media_1.mediaPath)(env.dataRoot, owner, media)}.caption.json`, JSON.stringify({ text: transcript, language: 'en' }), { mode: 0o600 }).catch(() => undefined);
        }
        return media;
    }
    finally {
        await (0, video_editor_media_1.discardUpload)(tmpFile);
    }
}
async function readTranscriptSidecar(env, owner, media) {
    const mem = ownerTranscripts.get(transcriptKey(owner, media.id));
    if (mem)
        return mem;
    if ((0, video_editor_native_1.nativeEditor)(env))
        return null;
    try {
        const raw = JSON.parse(await (0, promises_1.readFile)(`${(0, video_editor_media_1.mediaPath)(env.dataRoot, owner, media)}.caption.json`, 'utf8'));
        return typeof raw?.text === 'string' && raw.text.trim() ? raw.text.trim() : null;
    }
    catch {
        return null;
    }
}
function collectAudioSpans(doc) {
    const spans = [];
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
        if (src?.audio === true && seg.volume > 0)
            spans.push({ asset: src.asset, name: src.name, tlStart: cursor, inFrame: seg.in, outFrame: seg.out, speed });
        cursor += dur;
    }
    if (doc.audioBed && doc.audioBed.volume > 0 && doc.sources[doc.audioBed.source]) {
        const bed = doc.sources[doc.audioBed.source];
        spans.push({ asset: bed.asset, name: bed.name, tlStart: 0, inFrame: 0, outFrame: Math.min(bed.frames, cursor), speed: 100 });
    }
    return { spans, totalFrames: cursor };
}
function phraseForSegment(words, idx, count, fallbackName) {
    if (words && words.length > 0) {
        const from = Math.floor((idx * words.length) / count);
        const to = Math.max(from + 1, Math.floor(((idx + 1) * words.length) / count));
        const slice = words.slice(from, to).join(' ').trim();
        if (slice)
            return slice.slice(0, 120);
    }
    const label = fallbackName.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ').trim() || 'Clip';
    return count === 1 ? `${label} narration` : `${label} (${idx + 1}/${count})`;
}
async function generateAutoCaptions(env, owner, rawDoc) {
    let doc;
    try {
        doc = (await env.validator)(rawDoc);
    }
    catch {
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_document');
    }
    const { spans, totalFrames } = collectAudioSpans(doc);
    if (!spans.length || totalFrames < 1)
        return { language: 'en', languageLabel: 'English', engine: 'acoustic-speech-v1', cues: [] };
    const cues = [];
    for (const span of spans) {
        const media = await env.store.getMedia(owner, span.asset);
        const sidecar = await readTranscriptSidecar(env, owner, media);
        let segments = [];
        if (!(0, video_editor_native_1.nativeEditor)(env)) {
            const opened = await (0, video_editor_media_1.openMedia)(env.dataRoot, env.store, owner, span.asset);
            const pcm = await (0, video_editor_audio_synth_1.extractMono16kPcm)(opened.file);
            const inSample = Math.floor((span.inFrame / 30) * 16000), outSample = Math.min(pcm.length, Math.ceil((span.outFrame / 30) * 16000));
            if (outSample > inSample)
                segments = (0, video_editor_audio_synth_1.detectSpeechSegments)(pcm.subarray(inSample, outSample), 16000);
        }
        else if (sidecar) {
            const clipSec = Math.max(0.4, (span.outFrame - span.inFrame) / 30);
            segments = [{ startSec: 0, endSec: clipSec, syllables: Math.max(1, sidecar.split(/\s+/).length) }];
        }
        const words = sidecar ? sidecar.split(/\s+/).filter(Boolean) : null;
        segments.forEach((seg, idx) => {
            if (cues.length >= 50)
                return;
            const start = Math.max(0, Math.min(totalFrames - 1, span.tlStart + Math.round((seg.startSec * 30 * 100) / span.speed)));
            const end = Math.max(start + 1, Math.min(totalFrames, span.tlStart + Math.round((seg.endSec * 30 * 100) / span.speed)));
            const text = phraseForSegment(words, idx, segments.length, span.name);
            cues.push({ id: `cap${cues.length + 1}`, text, start, end, position: 'bottom', size: 'small' });
        });
    }
    await (0, video_editor_http_1.confirm)(env, 'read', owner)();
    return { language: 'en', languageLabel: 'English', engine: 'acoustic-speech-v1', cues: cues.sort((a, b) => a.start - b.start) };
}
function registerSpeechRoutes(router, env) {
    router.get('/editor/sound-library', (0, video_editor_http_1.admit)(env, 'view'), (0, video_editor_http_1.handler)(env, 'view', async (_req, res) => {
        res.json({ items: video_editor_audio_synth_1.SOUND_LIBRARY, voices: video_editor_audio_synth_1.VOICES });
    }));
    router.get('/editor/sound-library/:itemId/preview', (0, video_editor_http_1.admit)(env, 'view'), (0, video_editor_http_1.handler)(env, 'view', async (req, res) => {
        const wav = (0, video_editor_audio_synth_1.synthesizeLibraryWav)(String(req.params.itemId));
        if (!wav)
            throw new video_editor_types_1.EditorError(404, 'video_edit_sound_not_found');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.type('audio/wav').send(wav);
    }));
    router.post('/editor/sound-library/:itemId/import', (0, video_editor_http_1.admit)(env, 'upload'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'upload', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, []);
        const itemId = String(req.params.itemId), item = video_editor_audio_synth_1.SOUND_LIBRARY.find(entry => entry.id === itemId);
        const wav = (0, video_editor_audio_synth_1.synthesizeLibraryWav)(itemId);
        if (!item || !wav)
            throw new video_editor_types_1.EditorError(404, 'video_edit_sound_not_found');
        const media = await publishAudioBuffer(env, owner, wav);
        res.status(201).json({ media, item });
    }));
    router.post('/editor/voice', (0, video_editor_http_1.admit)(env, 'upload'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'upload', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, ['text', 'voice']);
        if (!(0, video_editor_validation_1.isRecord)(req.body) || typeof req.body.text !== 'string')
            throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_voice_text');
        const text = req.body.text.trim();
        if (!text || text.length > 400 || /[\u0000-\u001f\u007f-\u009f]/.test(text))
            throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_voice_text');
        const voice = req.body.voice === undefined ? 'slt' : String(req.body.voice);
        if (!video_editor_audio_synth_1.VOICES.some(entry => entry.id === voice))
            throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_voice_id');
        const wav = await (0, video_editor_audio_synth_1.synthesizeVoiceWav)(text, voice);
        const media = await publishAudioBuffer(env, owner, wav, text);
        res.status(201).json({ media, voice, text });
    }));
    router.post('/editor/auto-captions', (0, video_editor_http_1.admit)(env, 'read'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, ['document']);
        res.json(await generateAutoCaptions(env, owner, req.body?.document));
    }));
}
