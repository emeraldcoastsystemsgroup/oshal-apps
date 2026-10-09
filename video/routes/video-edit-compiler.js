"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compile a validated manual timeline into one fixed FFmpeg argument array and filter graph. The only document values that reach the graph are range-checked integers; title text is written to server-named files read with drawtext expansion off, media are server-resolved local files forced through the file protocol and an explicit demuxer, and nothing is ever run through a shell.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUTPUT_NAME = exports.SAMPLES_PER_FRAME = exports.SAMPLE_RATE = exports.TIMELINE_FPS = exports.TimelineCompileError = void 0;
exports.compileTimeline = compileTimeline;
/** A compile refusal with a stable code; the job layer reports it without echoing document content. */
class TimelineCompileError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
exports.TimelineCompileError = TimelineCompileError;
exports.TIMELINE_FPS = 30;
exports.SAMPLE_RATE = 48000;
exports.SAMPLES_PER_FRAME = exports.SAMPLE_RATE / exports.TIMELINE_FPS;
exports.OUTPUT_NAME = 'output.mp4';
const MAX_FRAMES = 1800;
const PROFILES = Object.freeze({
    export: Object.freeze({ width: 1280, height: 720, preset: 'veryfast', crf: 23, audioBitrate: '128k' }),
    preview: Object.freeze({ width: 640, height: 360, preset: 'ultrafast', crf: 32, audioBitrate: '96k' }),
});
/** Title height divisors: a small title is 1/24 of the frame height, a large one 1/10. */
const TITLE_DIVISORS = Object.freeze({ small: 24, medium: 16, large: 10 });
const FONT_PATH = /^\/[A-Za-z0-9/_.-]{1,255}\.(?:ttf|otf)$/;
/**
 * @description Refuse anything but a safe integer inside the range. Every number that enters the graph passes here.
 * @param value Candidate. @param min Inclusive minimum. @param max Inclusive maximum.
 * @returns The integer.
 */
function int(value, min, max) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        throw new TimelineCompileError('timeline_invalid');
    return value;
}
/** Input arguments for one server-chosen file; the file protocol and an explicit demuxer keep playlists and URLs out. */
function mediaInput(media, key, demuxer) {
    const file = Object.prototype.hasOwnProperty.call(media, key) ? media[key] : undefined;
    if (typeof file !== 'string' || !/^(?:\/|[A-Za-z]:[\\/])/.test(file) || /[\0\r\n]/.test(file))
        throw new TimelineCompileError('timeline_media_unavailable');
    return ['-protocol_whitelist', 'file', '-f', demuxer, '-i', `file:${file}`];
}
/** Normalize one clip once (frame rate, fit into the canvas, sample format) and split it per using segment. */
function sourceChain(graph, input, key, uses, size) {
    const source = input.document.sources[key];
    if (!source || source.kind !== 'video')
        throw new TimelineCompileError('timeline_invalid');
    const index = graph.count++;
    graph.inputs.push(...mediaInput(input.media, key, 'mov'));
    const frames = int(source.frames, 1, 900), { width, height } = size;
    const video = Array.from({ length: uses }, (_, use) => `v${index}_${use}`);
    graph.parts.push(`[${index}:v:0]fps=${exports.TIMELINE_FPS},scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,`
        + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,split=${uses}${video.map(label => `[${label}]`).join('')}`);
    if (source.audio !== true)
        return { video, audio: null };
    const audio = Array.from({ length: uses }, (_, use) => `a${index}_${use}`);
    graph.parts.push(`[${index}:a:0]aresample=${exports.SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,`
        + `apad=whole_len=${frames * exports.SAMPLES_PER_FRAME},asplit=${uses}${audio.map(label => `[${label}]`).join('')}`);
    return { video, audio };
}
/** Trim every segment to its exact integer frame and sample range; a silent clip gets exact-length silence. */
function segmentChains(graph, input, size) {
    const uses = new Map();
    for (const segment of input.document.segments)
        uses.set(segment.source, (uses.get(segment.source) ?? 0) + 1);
    const labels = new Map();
    for (const [key, count] of uses)
        labels.set(key, sourceChain(graph, input, key, count, size));
    const taken = new Map();
    let total = 0;
    const pairs = input.document.segments.map((segment, position) => {
        const source = input.document.sources[segment.source];
        const start = int(segment.in, 0, source.frames - 1), end = int(segment.out, start + 1, source.frames);
        const volume = int(segment.volume, 0, 200), use = taken.get(segment.source) ?? 0, own = labels.get(segment.source);
        taken.set(segment.source, use + 1);
        total += end - start;
        graph.parts.push(`[${own.video[use]}]trim=start_frame=${start}:end_frame=${end},setpts=PTS-STARTPTS[s${position}]`);
        graph.parts.push(own.audio
            ? `[${own.audio[use]}]atrim=start_sample=${start * exports.SAMPLES_PER_FRAME}:end_sample=${end * exports.SAMPLES_PER_FRAME},asetpts=PTS-STARTPTS,volume=${volume}/100[c${position}]`
            : `anullsrc=channel_layout=stereo:sample_rate=${exports.SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,`
                + `atrim=end_sample=${(end - start) * exports.SAMPLES_PER_FRAME},asetpts=PTS-STARTPTS[c${position}]`);
        return `[s${position}][c${position}]`;
    });
    int(total, 1, MAX_FRAMES);
    graph.parts.push(`${pairs.join('')}concat=n=${pairs.length}:v=1:a=1[vcat][acat]`);
    return total;
}
/** Burn each title from its own server-named text file, only on its integer frame range, with text expansion off. */
function titleChain(graph, input, total, height) {
    if (!input.document.titles.length) {
        graph.parts.push('[vcat]null[vtitled]');
        return [];
    }
    if (!FONT_PATH.test(input.fontFile))
        throw new TimelineCompileError('timeline_font_unavailable');
    const margin = Math.round(height / 12), files = [];
    const filters = input.document.titles.map((title, index) => {
        const start = int(title.start, 0, total - 1), end = int(title.end, start + 1, total);
        const size = Math.round(height / TITLE_DIVISORS[title.size]);
        if (!size)
            throw new TimelineCompileError('timeline_invalid');
        const y = title.position === 'top' ? `${margin}` : title.position === 'center' ? '(h-text_h)/2' : `h-text_h-${margin}`;
        const name = `title-${index}.txt`;
        files.push({ name, text: title.text });
        return `drawtext=textfile=${name}:expansion=none:fontfile=${input.fontFile}:fontsize=${size}:fontcolor=white:borderw=3:bordercolor=black:`
            + `x=(w-text_w)/2:y=${y}:enable='between(n,${start},${end - 1})'`;
    });
    graph.parts.push(`[vcat]${filters.join(',')}[vtitled]`);
    return files;
}
/** Mix the optional bed under the clip audio, padded or cut to exactly the timeline length; clip audio is never normalized down. */
function audioChain(graph, input, total) {
    const bed = input.document.audioBed;
    if (!bed) {
        graph.parts.push('[acat]anull[aout]');
        return;
    }
    const source = input.document.sources[bed.source];
    if (!source || source.kind !== 'audio')
        throw new TimelineCompileError('timeline_invalid');
    const index = graph.count++;
    graph.inputs.push(...mediaInput(input.media, bed.source, 'wav'));
    const samples = total * exports.SAMPLES_PER_FRAME, volume = int(bed.volume, 0, 100);
    graph.parts.push(`[${index}:a:0]aresample=${exports.SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_len=${samples},`
        + `atrim=end_sample=${samples},asetpts=PTS-STARTPTS,volume=${volume}/100[bed]`);
    graph.parts.push('[acat][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]');
}
/**
 * @description Compile one validated timeline into FFmpeg arguments for the export or the preview variant.
 * @param input Document, resolved media paths, variant, font and thread count.
 * @returns The argument array, the graph, the title files to write, and the exact expected frame/sample counts.
 */
function compileTimeline(input) {
    const document = input.document;
    if (!document || document.version !== 1 || document.profile !== 'hd720p30' || !Array.isArray(document.segments))
        throw new TimelineCompileError('timeline_invalid');
    if (!document.segments.length)
        throw new TimelineCompileError('timeline_empty');
    const profile = PROFILES[input.variant];
    if (!profile)
        throw new TimelineCompileError('timeline_invalid');
    const threads = int(input.threads ?? 2, 1, 4);
    const graph = { parts: [], inputs: [], count: 0 };
    const total = segmentChains(graph, input, profile);
    const files = titleChain(graph, input, total, profile.height);
    audioChain(graph, input, total);
    graph.parts.push('[vtitled]format=yuv420p[vout]');
    const filterGraph = graph.parts.join(';');
    const args = ['-hide_banner', '-nostdin', '-n', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
        '-filter_complex_threads', '1', ...graph.inputs, '-filter_complex', filterGraph, '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', profile.preset, '-crf', String(profile.crf), '-pix_fmt', 'yuv420p', '-r', String(exports.TIMELINE_FPS),
        '-frames:v', String(total), '-threads', String(threads), '-c:a', 'aac', '-b:a', profile.audioBitrate, '-ar', String(exports.SAMPLE_RATE),
        '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', `file:${exports.OUTPUT_NAME}`];
    return { args, filterGraph, files, output: exports.OUTPUT_NAME, frames: total, samples: total * exports.SAMPLES_PER_FRAME,
        width: profile.width, height: profile.height, fps: exports.TIMELINE_FPS };
}
