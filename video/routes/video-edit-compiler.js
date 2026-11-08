"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compile a validated manual timeline into one fixed FFmpeg argument array and filter graph. The only document values that reach the graph are range-checked integers; title text is written to server-named files read with drawtext expansion off, media are server-resolved local files forced through the file protocol and an explicit demuxer, and nothing is ever run through a shell.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Extend the existing private timeline/store/export contract with bounded v2 tracks, linked clips, color/fades/keyframes and timed captions.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Support per-clip speed with pitch-preserving atempo, named color looks, stabilization, chroma key, background matting, captions, procedural RGBA stickers and 720p/1080p/4K 30/60fps export profiles.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUTPUT_NAME = exports.SAMPLES_PER_FRAME = exports.SAMPLE_RATE = exports.TIMELINE_FPS = exports.TimelineCompileError = void 0;
exports.resolveCompileSpec = resolveCompileSpec;
exports.clipDuration30 = clipDuration30;
exports.atempoStages = atempoStages;
exports.compileClipVisualFilters = compileClipVisualFilters;
exports.appendStickerGraph = appendStickerGraph;
exports.compileTimeline = compileTimeline;
const video_edit_multitrack_compiler_1 = require("./video-edit-multitrack-compiler");
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
const MAX_FRAMES_30 = 1800;
const TITLE_DIVISORS = Object.freeze({ small: 24, medium: 16, large: 10 });
const FONT_PATH = /^\/[A-Za-z0-9/_.-]{1,255}\.(?:ttf|otf)$/;
const LOOKS = Object.freeze({
    none: { sat: 1, con: 1, bri: 0, rs: 0, gs: 0, bs: 0 },
    warm: { sat: 1.16, con: 1.04, bri: 0.03, rs: 0.14, gs: 0.04, bs: -0.14 },
    cool: { sat: 1.08, con: 1.06, bri: 0, rs: -0.12, gs: 0.02, bs: 0.16 },
    vivid: { sat: 1.48, con: 1.14, bri: 0.02, rs: 0.04, gs: 0, bs: 0.04 },
    noir: { sat: 0, con: 1.28, bri: -0.02, rs: 0, gs: 0, bs: 0 },
    vintage: { sat: 0.78, con: 0.94, bri: 0.04, rs: 0.16, gs: 0.08, bs: -0.12 },
    cinema: { sat: 1.12, con: 1.18, bri: -0.02, rs: -0.06, gs: 0.03, bs: 0.10 },
});
const STABILIZE = Object.freeze({
    light: { zoom: 1.04, rx: 16, ry: 16 }, standard: { zoom: 1.08, rx: 32, ry: 32 }, strong: { zoom: 1.14, rx: 48, ry: 48 },
});
const RESOLUTIONS = Object.freeze({
    '720p': { width: 1280, height: 720, prefix: 'hd720p' },
    '1080p': { width: 1920, height: 1080, prefix: 'hd1080p' },
    '4k': { width: 3840, height: 2160, prefix: 'uhd4k' },
});
const STICKER_GEQ = Object.freeze({
    star: { r: [250, 202], g: [204, 138], b: [21, 4], mask: 'lte(hypot(X-W/2,Y-H/2),W*(0.28+0.14*cos(5*(atan2(Y-H/2,X-W/2)+1.5708))))' },
    heart: { r: [244, 190], g: [63, 18], b: [94, 60], mask: 'lte(hypot(X-W/2,Y-H/2),W*0.42)' },
    sparkle: { r: [56, 2], g: [189, 132], b: [248, 199], mask: 'lte(abs(X-W/2)+abs(Y-H/2),W*0.46)' },
    fire: { r: [251, 234], g: [146, 88], b: [60, 12], mask: 'lte(hypot(X-W/2,Y-H*0.54),W*0.40)' },
    check: { r: [34, 21], g: [197, 128], b: [94, 61], mask: 'lte(hypot(X-W/2,Y-H/2),W*0.44)' },
    arrow: { r: [168, 126], g: [85, 34], b: [247, 206], mask: 'lte(hypot(X-W/2,Y-H/2),W*0.44)' },
    speech: { r: [248, 51], g: [250, 65], b: [252, 85], mask: 'lte(abs(X-W/2),W*0.42)*lte(abs(Y-H*0.46),H*0.32)' },
    clap: { r: [244, 219], g: [114, 39], b: [182, 119], mask: 'lte(hypot(X-W/2,Y-H/2),W*0.44)' },
});
function failInvalid() { throw new TimelineCompileError('timeline_invalid'); }
function checkInt(v, min, max, fail = failInvalid) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
        fail();
    return v;
}
const PROFILE_DEFAULTS = Object.freeze({
    hd720p30: { resolution: '720p', fps: 30 }, hd720p60: { resolution: '720p', fps: 60 },
    hd1080p30: { resolution: '1080p', fps: 30 }, hd1080p60: { resolution: '1080p', fps: 60 },
    uhd4k30: { resolution: '4k', fps: 30 }, uhd4k60: { resolution: '4k', fps: 60 },
});
function resolveCompileSpec(variant, resolution, fps, fail = failInvalid, profileId) {
    if (variant === 'preview') {
        return { variant: 'preview', profileId: 'hd720p30', width: 640, height: 360, fps: 30, fpsScale: 1, preset: 'ultrafast', crf: 32, audioBitrate: '96k' };
    }
    if (variant !== 'export')
        fail();
    const base = profileId && typeof profileId === 'string' && Object.prototype.hasOwnProperty.call(PROFILE_DEFAULTS, profileId)
        ? PROFILE_DEFAULTS[profileId] : PROFILE_DEFAULTS.hd720p30;
    const resKey = (resolution ?? base.resolution);
    if (!Object.prototype.hasOwnProperty.call(RESOLUTIONS, resKey))
        fail();
    const fpsVal = (fps ?? base.fps);
    if (fpsVal !== 30 && fpsVal !== 60)
        fail();
    const res = RESOLUTIONS[resKey];
    return { variant: 'export', profileId: `${res.prefix}${fpsVal}`, width: res.width, height: res.height,
        fps: fpsVal, fpsScale: fpsVal === 60 ? 2 : 1, preset: 'veryfast', crf: 23, audioBitrate: '128k' };
}
function clipDuration30(inFrame, outFrame, rawSpeed, fail = failInvalid) {
    const speed = rawSpeed === undefined ? 100 : checkInt(rawSpeed, 25, 400, fail);
    const raw = outFrame - inFrame;
    if (raw <= 0)
        fail();
    return { speed, dur30: speed === 100 ? raw : Math.max(1, Math.round((raw * 100) / speed)) };
}
function atempoStages(speed) {
    if (speed === 100)
        return [];
    let rem = speed / 100;
    const out = [];
    while (rem < 0.5 - 1e-9) {
        out.push('atempo=0.500000');
        rem /= 0.5;
    }
    while (rem > 2.0 + 1e-9) {
        out.push('atempo=2.000000');
        rem /= 2.0;
    }
    if (Math.abs(rem - 1) > 1e-6)
        out.push(`atempo=${Math.min(2, Math.max(0.5, rem)).toFixed(6)}`);
    return out;
}
function compileClipVisualFilters(clip, width, height, fail = failInvalid) {
    const preFilters = [], alphaFilters = [];
    if (clip.stabilize !== undefined && clip.stabilize !== 'off') {
        if (typeof clip.stabilize !== 'string' || !Object.prototype.hasOwnProperty.call(STABILIZE, clip.stabilize))
            fail();
        const st = STABILIZE[clip.stabilize], sw = Math.round((width * st.zoom) / 2) * 2, sh = Math.round((height * st.zoom) / 2) * 2;
        preFilters.push(`deshake=rx=${st.rx}:ry=${st.ry}:edge=mirror`, `scale=${sw}:${sh}`, `crop=${width}:${height}`);
    }
    if (clip.look !== undefined) {
        if (!clip.look || typeof clip.look !== 'object' || !Object.prototype.hasOwnProperty.call(LOOKS, clip.look.id))
            fail();
        const strength = checkInt(clip.look.strength, 0, 100, fail), spec = LOOKS[clip.look.id];
        if (clip.look.id !== 'none' && strength > 0) {
            const t = strength / 100;
            preFilters.push(`eq=brightness=${(spec.bri * t).toFixed(3)}:contrast=${(1 + (spec.con - 1) * t).toFixed(3)}:saturation=${(1 + (spec.sat - 1) * t).toFixed(3)}`);
            const rs = (spec.rs * t).toFixed(3), gs = (spec.gs * t).toFixed(3), bs = (spec.bs * t).toFixed(3);
            if (Math.abs(spec.rs * t) > 0.005 || Math.abs(spec.gs * t) > 0.005 || Math.abs(spec.bs * t) > 0.005) {
                preFilters.push(`colorbalance=rs=${rs}:gs=${gs}:bs=${bs}:rm=${rs}:gm=${gs}:bm=${bs}`);
            }
        }
    }
    if (clip.removeBg !== undefined) {
        const rb = clip.removeBg;
        if (!rb || typeof rb !== 'object' || typeof rb.enabled !== 'boolean')
            fail();
        const strength = checkInt(rb.strength, 1, 100, fail);
        const sim = (0.04 + (strength / 100) * 0.28).toFixed(3), thresh = (0.04 + ((100 - strength) / 100) * 0.12).toFixed(3);
        if (rb.enabled)
            alphaFilters.push('format=yuva420p', `backgroundkey=threshold=${thresh}:similarity=${sim}:blend=0.08`, 'format=rgba');
    }
    if (clip.chromaKey !== undefined) {
        const ck = clip.chromaKey;
        if (!ck || typeof ck !== 'object' || typeof ck.enabled !== 'boolean' || typeof ck.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(ck.color))
            fail();
        const sim = checkInt(ck.similarity, 1, 100, fail), blend = checkInt(ck.blend, 0, 100, fail);
        if (ck.enabled)
            alphaFilters.push('format=rgba', `colorkey=0x${ck.color.slice(1).toUpperCase()}:${(sim / 100).toFixed(3)}:${(blend / 100).toFixed(3)}`);
    }
    return { preFilters, alphaFilters };
}
function stickerCoordExpr(st, axis, dim, sStart, fpsScale) {
    const base = checkInt(st[axis], 0, 100);
    if (!st.keys?.length)
        return `${Math.round((dim * base) / 100)}`;
    if (!Array.isArray(st.keys) || st.keys.length > 8)
        failInvalid();
    const last = st.keys[st.keys.length - 1];
    checkInt(last.frame, 0, st.end - st.start);
    let expr = `${Math.round((dim * checkInt(last[axis], 0, 100)) / 100)}`;
    for (let i = st.keys.length - 2; i >= 0; i -= 1) {
        const a = st.keys[i], b = st.keys[i + 1];
        const af = checkInt(a.frame, 0, st.end - st.start) * fpsScale, bf = checkInt(b.frame, a.frame + 1, st.end - st.start) * fpsScale;
        const av = Math.round((dim * checkInt(a[axis], 0, 100)) / 100), bv = Math.round((dim * checkInt(b[axis], 0, 100)) / 100);
        expr = `if(lt(n-${sStart},${bf}),${av}+(${bv - av})*(n-${sStart}-${af})/${bf - af},${expr})`;
    }
    return expr;
}
function appendStickerGraph(parts, stickers, prevLabel, total30, spec) {
    if (!stickers?.length)
        return prevLabel;
    if (!Array.isArray(stickers) || stickers.length > 16)
        failInvalid();
    const totalOut = total30 * spec.fpsScale;
    let current = prevLabel;
    for (const [idx, st] of stickers.entries()) {
        if (!st || typeof st !== 'object' || typeof st.stickerId !== 'string' || !Object.prototype.hasOwnProperty.call(STICKER_GEQ, st.stickerId))
            failInvalid();
        const start30 = checkInt(st.start, 0, total30 - 1), end30 = checkInt(st.end, start30 + 1, total30);
        const scale = checkInt(st.scale, 25, 300), side = Math.max(24, Math.round((spec.height * 0.18 * scale) / 100 / 2) * 2);
        const shape = STICKER_GEQ[st.stickerId], sStart = start30 * spec.fpsScale, sEnd = end30 * spec.fpsScale;
        const xExpr = stickerCoordExpr(st, 'x', spec.width, sStart, spec.fpsScale), yExpr = stickerCoordExpr(st, 'y', spec.height, sStart, spec.fpsScale);
        const next = `vst${idx}`;
        parts.push(`color=c=black@0:s=${side}x${side}:r=1,trim=end_frame=1,format=rgba,`
            + `geq=r='if(lt(hypot(X-W/2,Y-H/2),W*0.36),${shape.r[0]},${shape.r[1]})':g='if(lt(hypot(X-W/2,Y-H/2),W*0.36),${shape.g[0]},${shape.g[1]})':`
            + `b='if(lt(hypot(X-W/2,Y-H/2),W*0.36),${shape.b[0]},${shape.b[1]})':a='if(${shape.mask},255,0)',`
            + `loop=loop=-1:size=1:start=0,fps=${spec.fps},trim=end_frame=${totalOut},setpts=PTS-STARTPTS[stk${idx}]`);
        parts.push(`[${current}][stk${idx}]overlay=x='${xExpr}-overlay_w/2':y='${yExpr}-overlay_h/2':eval=frame:format=auto:eof_action=pass:enable='between(n,${sStart},${sEnd - 1})'[${next}]`);
        current = next;
    }
    return current;
}
function mediaInput(media, key, demuxer) {
    const file = Object.prototype.hasOwnProperty.call(media, key) ? media[key] : undefined;
    if (typeof file !== 'string' || !/^(?:\/|[A-Za-z]:[\\/])/.test(file) || /[\0\r\n]/.test(file))
        throw new TimelineCompileError('timeline_media_unavailable');
    return ['-protocol_whitelist', 'file', '-f', demuxer, '-i', `file:${file}`];
}
function sourceChain(graph, input, key, uses, size) {
    const source = input.document.sources[key];
    if (!source || source.kind !== 'video')
        failInvalid();
    const index = graph.count++;
    graph.inputs.push(...mediaInput(input.media, key, 'mov'));
    const frames = checkInt(source.frames, 1, 900), { width, height } = size;
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
function emitSegmentVideo(graph, srcLabel, seg, position, start, end, speed, segOut, spec) {
    const { preFilters, alphaFilters } = compileClipVisualFilters(seg, spec.width, spec.height);
    const stages = [`trim=start_frame=${start}:end_frame=${end}`, 'setpts=PTS-STARTPTS'];
    if (speed !== 100 || spec.fps !== exports.TIMELINE_FPS) {
        stages.push(`setpts=(PTS-STARTPTS)*100/${speed}`, `fps=${spec.fps}`, 'tpad=stop_mode=clone:stop_duration=1', `trim=end_frame=${segOut}`, 'setpts=PTS-STARTPTS');
    }
    stages.push(...preFilters, ...alphaFilters);
    if (alphaFilters.length) {
        graph.parts.push(`[${srcLabel}]${stages.join(',')}[fg${position}]`);
        graph.parts.push(`color=c=0x0f172a:s=${spec.width}x${spec.height}:r=${spec.fps},trim=end_frame=${segOut},setpts=PTS-STARTPTS[bg${position}]`);
        graph.parts.push(`[bg${position}][fg${position}]overlay=0:0:format=auto,format=yuv420p[s${position}]`);
        return;
    }
    if (preFilters.length)
        stages.push('format=yuv420p');
    graph.parts.push(`[${srcLabel}]${stages.join(',')}[s${position}]`);
}
function segmentChains(graph, input, spec) {
    const uses = new Map();
    for (const segment of input.document.segments)
        uses.set(segment.source, (uses.get(segment.source) ?? 0) + 1);
    const labels = new Map();
    for (const [key, count] of uses)
        labels.set(key, sourceChain(graph, input, key, count, spec));
    const taken = new Map();
    let total30 = 0;
    const pairs = input.document.segments.map((segment, position) => {
        const source = input.document.sources[segment.source];
        const start = checkInt(segment.in, 0, source.frames - 1), end = checkInt(segment.out, start + 1, source.frames);
        const { speed, dur30 } = clipDuration30(start, end, segment.speed);
        const volume = checkInt(segment.volume, 0, 200), use = taken.get(segment.source) ?? 0, own = labels.get(segment.source);
        const segOut = dur30 * spec.fpsScale, segSamples = dur30 * exports.SAMPLES_PER_FRAME;
        taken.set(segment.source, use + 1);
        total30 += dur30;
        emitSegmentVideo(graph, own.video[use], segment, position, start, end, speed, segOut, spec);
        if (own.audio) {
            const tempo = atempoStages(speed);
            const tail = tempo.length ? `,${tempo.join(',')},apad=whole_len=${segSamples},atrim=end_sample=${segSamples},asetpts=PTS-STARTPTS` : '';
            graph.parts.push(`[${own.audio[use]}]atrim=start_sample=${start * exports.SAMPLES_PER_FRAME}:end_sample=${end * exports.SAMPLES_PER_FRAME},asetpts=PTS-STARTPTS${tail},volume=${volume}/100[c${position}]`);
        }
        else {
            graph.parts.push(`anullsrc=channel_layout=stereo:sample_rate=${exports.SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,`
                + `atrim=end_sample=${segSamples},asetpts=PTS-STARTPTS[c${position}]`);
        }
        return `[s${position}][c${position}]`;
    });
    checkInt(total30, 1, MAX_FRAMES_30);
    graph.parts.push(`${pairs.join('')}concat=n=${pairs.length}:v=1:a=1[vcat][acat]`);
    return total30;
}
function titleChain(graph, input, total30, spec) {
    const entries = [...input.document.titles, ...(input.document.captions ?? [])];
    if (!entries.length) {
        graph.parts.push('[vcat]null[vtitled]');
        return [];
    }
    if (entries.length > 60 || !FONT_PATH.test(input.fontFile))
        throw new TimelineCompileError('timeline_font_unavailable');
    const margin = Math.round(spec.height / 12), files = [];
    const filters = entries.map((title, index) => {
        const start30 = checkInt(title.start, 0, total30 - 1), end30 = checkInt(title.end, start30 + 1, total30);
        if (typeof title.text !== 'string' || title.text.length > 240 || /[\u0000-\u001f]/.test(title.text))
            failInvalid();
        const size = Math.round(spec.height / TITLE_DIVISORS[title.size]);
        if (!size || !['top', 'center', 'bottom'].includes(title.position))
            failInvalid();
        const y = title.position === 'top' ? `${margin}` : title.position === 'center' ? '(h-text_h)/2' : `h-text_h-${margin}`;
        const name = `title-${index}.txt`;
        files.push({ name, text: title.text });
        return `drawtext=textfile=${name}:expansion=none:fontfile=${input.fontFile}:fontsize=${size}:fontcolor=white:borderw=3:bordercolor=black:`
            + `x=(w-text_w)/2:y=${y}:enable='between(n,${start30 * spec.fpsScale},${end30 * spec.fpsScale - 1})'`;
    });
    graph.parts.push(`[vcat]${filters.join(',')}[vtitled]`);
    return files;
}
function audioChain(graph, input, total30) {
    const bed = input.document.audioBed;
    if (!bed) {
        graph.parts.push('[acat]anull[aout]');
        return;
    }
    const source = input.document.sources[bed.source];
    if (!source || source.kind !== 'audio')
        failInvalid();
    const index = graph.count++;
    graph.inputs.push(...mediaInput(input.media, bed.source, 'wav'));
    const samples = total30 * exports.SAMPLES_PER_FRAME, volume = checkInt(bed.volume, 0, 100);
    graph.parts.push(`[${index}:a:0]aresample=${exports.SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_len=${samples},`
        + `atrim=end_sample=${samples},asetpts=PTS-STARTPTS,volume=${volume}/100[bed]`);
    graph.parts.push('[acat][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]');
}
function compileTimeline(input) {
    const document = input.document;
    if (!document || !Object.prototype.hasOwnProperty.call(PROFILE_DEFAULTS, document.profile ?? ''))
        failInvalid();
    if (document.version === 2)
        return (0, video_edit_multitrack_compiler_1.compileMultitrack)(input);
    if (document.version !== 1 || !Array.isArray(document.segments))
        failInvalid();
    if (!document.segments.length)
        throw new TimelineCompileError('timeline_empty');
    const spec = resolveCompileSpec(input.variant, input.resolution, input.fps, failInvalid, document.profile);
    const threads = checkInt(input.threads ?? 2, 1, 4);
    const graph = { parts: [], inputs: [], count: 0 };
    const total30 = segmentChains(graph, input, spec);
    const files = titleChain(graph, input, total30, spec);
    audioChain(graph, input, total30);
    const postSticker = appendStickerGraph(graph.parts, document.stickers, 'vtitled', total30, spec);
    graph.parts.push(`[${postSticker}]format=yuv420p[vout]`);
    const outFrames = total30 * spec.fpsScale, filterGraph = graph.parts.join(';');
    const args = ['-hide_banner', '-nostdin', '-n', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
        '-filter_complex_threads', '1', ...graph.inputs, '-filter_complex', filterGraph, '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', spec.preset, '-crf', String(spec.crf), '-pix_fmt', 'yuv420p', '-r', String(spec.fps),
        '-frames:v', String(outFrames), '-threads', String(threads), '-c:a', 'aac', '-b:a', spec.audioBitrate, '-ar', String(exports.SAMPLE_RATE),
        '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', `file:${exports.OUTPUT_NAME}`];
    return { args, filterGraph, files, output: exports.OUTPUT_NAME, frames: outFrames, samples: total30 * exports.SAMPLES_PER_FRAME,
        width: spec.width, height: spec.height, fps: spec.fps, profileId: spec.profileId };
}
