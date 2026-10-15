/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compile bounded v2 video/audio tracks with overlays, color, fades, integer keyframes and sample-aligned mixing through fixed FFmpeg filters.
 */
import { TimelineCompileError, type CompileInput, type CompiledTimeline } from './video-edit-compiler';
export interface ClipKey { frame: number; property: 'x' | 'y' | 'scale' | 'opacity' | 'volume'; value: number; interpolation: 'linear' | 'hold' }
export interface TrackClip { id: string; source: string; in: number; out: number; start: number; volume: number; x: number; y: number;
  scale: number; opacity: number; keys: ClipKey[]; transition: 'dissolve' | 'black'; fadeIn: number; fadeOut: number;
  brightness: number; contrast: number; saturation: number; audioEnabled: boolean; link?: string }
export interface TimelineTrack { id: string; name: string; kind: 'video' | 'audio'; muted: boolean; locked: boolean; clips: TrackClip[] }
const FPS = 30, SAMPLES = 1600;
const ranges = { x: [-100, 100], y: [-100, 100], scale: [10, 200], opacity: [0, 100], volume: [0, 200] };
function int(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TimelineCompileError('timeline_invalid'); return value;
}
const decimal = (value: number): string => String(Number(value.toFixed(8)));

function expression(clip: TrackClip, property: keyof typeof ranges, variable: string): string {
  const bounds = ranges[property], base = int(clip[property], bounds[0], bounds[1]);
  if (!Array.isArray(clip.keys) || clip.keys.length > 64) throw new TimelineCompileError('timeline_invalid');
  const keys = clip.keys.filter(key => key.property === property).sort((a, b) => a.frame - b.frame);
  for (const key of clip.keys) {
    if (!Object.hasOwn(ranges, key.property) || !['linear', 'hold'].includes(key.interpolation)) throw new TimelineCompileError('timeline_invalid');
    int(key.frame, 0, clip.out - clip.in - 1); int(key.value, ranges[key.property][0], ranges[key.property][1]);
  }
  if (!keys.length) return String(base);
  if (keys.some((key, index) => index > 0 && key.frame === keys[index - 1].frame)) throw new TimelineCompileError('timeline_invalid');
  const frames = keys[0].frame === 0 ? keys : [{ frame: 0, value: base, interpolation: 'hold' as const }, ...keys];
  let result = String(frames.at(-1)!.value);
  for (let index = frames.length - 2; index >= 0; index--) {
    const a = frames[index], b = frames[index + 1];
    const value = a.interpolation === 'hold' ? String(a.value) : `${a.value}+(${b.value - a.value})*((${variable})-${a.frame})/${b.frame - a.frame}`;
    result = `if(lt((${variable}),${b.frame}),(${value}),(${result}))`;
  }
  return result;
}

interface Graph { parts: string[]; inputs: string[]; count: number; audio: string[]; sources: Map<string, { video: string[]; audio: string[] }> }
function sourceInputs(graph: Graph, input: CompileInput, active: Array<{ clip: TrackClip; kind: 'video' | 'audio' }>): void {
  const uses = new Map<string, { video: number; audio: number }>();
  for (const row of active) {
    const source = input.document.sources[row.clip.source]; if (!source) throw new TimelineCompileError('timeline_invalid');
    const count = uses.get(row.clip.source) ?? { video: 0, audio: 0 };
    if (row.kind === 'video') count.video++;
    if (row.kind === 'audio' || (source.audio === true && row.clip.audioEnabled)) count.audio++; uses.set(row.clip.source, count);
  }
  for (const [key, count] of uses) {
    const source = input.document.sources[key]; if (!['video', 'audio'].includes(source.kind)) throw new TimelineCompileError('timeline_invalid');
    const file = Object.hasOwn(input.media, key) ? input.media[key] : null;
    if (typeof file !== 'string' || !/^(?:\/|[A-Za-z]:[\\/])/.test(file) || /[\0\r\n]/.test(file)) throw new TimelineCompileError('timeline_media_unavailable');
    const index = graph.count++, frames = int(source.frames, 1, source.kind === 'video' ? 900 : 1800);
    graph.inputs.push('-protocol_whitelist', 'file', '-f', source.kind === 'video' ? 'mov' : 'wav', '-i', `file:${file}`);
    const labels = { video: Array.from({ length: count.video }, (_, use) => `mv${index}_${use}`), audio: Array.from({ length: count.audio }, (_, use) => `ma${index}_${use}`) };
    if (count.video) {
      if (source.kind !== 'video') throw new TimelineCompileError('timeline_invalid');
      graph.parts.push(`[${index}:v:0]fps=30,setsar=1,split=${count.video}${labels.video.map(label => `[${label}]`).join('')}`);
    }
    if (count.audio) {
      if (source.kind === 'video' && source.audio !== true) throw new TimelineCompileError('timeline_invalid');
      graph.parts.push(`[${index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_len=${frames * SAMPLES},asplit=${count.audio}${labels.audio.map(label => `[${label}]`).join('')}`);
    }
    graph.sources.set(key, labels);
  }
}

function audioClip(graph: Graph, clip: TrackClip, index: number): void {
  const labels = graph.sources.get(clip.source)!, label = labels.audio.shift(); if (!label) throw new TimelineCompileError('timeline_invalid');
  const duration = clip.out - clip.in, filters = [`atrim=start_sample=${clip.in * SAMPLES}:end_sample=${clip.out * SAMPLES}`, 'asetpts=PTS-STARTPTS',
    `volume='(${expression(clip, 'volume', 't*30')})/100':eval=frame`];
  if (clip.fadeIn) filters.push(`afade=t=in:ss=0:ns=${clip.fadeIn * SAMPLES}`);
  if (clip.fadeOut) filters.push(`afade=t=out:ss=${(duration - clip.fadeOut) * SAMPLES}:ns=${clip.fadeOut * SAMPLES}`);
  filters.push(`adelay=delays=${clip.start * SAMPLES}S:all=1`);
  graph.parts.push(`[${label}]${filters.join(',')}[mix${index}]`); graph.audio.push(`mix${index}`);
}

function videoClip(graph: Graph, clip: TrackClip, index: number, width: number, height: number, previous: string): string {
  const label = graph.sources.get(clip.source)!.video.shift(); if (!label) throw new TimelineCompileError('timeline_invalid');
  const duration = clip.out - clip.in, alpha = expression(clip, 'opacity', 'N'), scale = expression(clip, 'scale', 'n');
  const filters = [`trim=start_frame=${clip.in}:end_frame=${clip.out}`, 'setpts=PTS-STARTPTS',
    `eq=brightness=${int(clip.brightness, -100, 100)}/100:contrast=${int(clip.contrast, 0, 300)}/100:saturation=${int(clip.saturation, 0, 300)}/100`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`, 'format=rgba',
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
    `scale=w='trunc(${width}*(${scale})/200)*2':h='trunc(${height}*(${scale})/200)*2':eval=frame`];
  if (clip.keys.some(key => key.property === 'opacity')) filters.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${alpha})/100'`, 'format=rgba');
  else filters.push(`colorchannelmixer=aa=${decimal(int(clip.opacity, 0, 100) / 100)}`);
  if (!['dissolve', 'black'].includes(clip.transition)) throw new TimelineCompileError('timeline_invalid');
  if (clip.fadeIn) filters.push(`fade=t=in:start_frame=0:nb_frames=${clip.fadeIn}:alpha=${clip.transition === 'dissolve' ? 1 : 0}:color=black`);
  if (clip.fadeOut) filters.push(`fade=t=out:start_frame=${duration - clip.fadeOut}:nb_frames=${clip.fadeOut}:alpha=${clip.transition === 'dissolve' ? 1 : 0}:color=black`);
  filters.push(`setpts=PTS+${clip.start}/(30*TB)`); graph.parts.push(`[${label}]${filters.join(',')}[layer${index}]`);
  const local = `t*30-${clip.start}`, x = expression(clip, 'x', local), y = expression(clip, 'y', local), next = `composite${index}`;
  graph.parts.push(`[${previous}][layer${index}]overlay=x='${width}*(${x})/100':y='${height}*(${y})/100':eval=frame:format=auto:repeatlast=0:eof_action=pass:enable='gte(t,${clip.start}/30)*lt(t,${clip.start + duration}/30)'[${next}]`);
  return next;
}

function titles(graph: Graph, input: CompileInput, video: string, total: number, height: number): Array<{ name: string; text: string }> {
  const entries = [...input.document.titles, ...(input.document.captions ?? [])];
  if (!entries.length) { graph.parts.push(`[${video}]format=yuv420p[vout]`); return []; }
  if (entries.length > 70 || !/^\/[A-Za-z0-9/_.-]{1,255}\.(?:ttf|otf)$/.test(input.fontFile)) throw new TimelineCompileError('timeline_font_unavailable');
  const files: Array<{ name: string; text: string }> = [], filters: string[] = [];
  for (const [index, title] of entries.entries()) {
    const start = int(title.start, 0, total - 1), end = int(title.end, start + 1, total);
    if (typeof title.text !== 'string' || title.text.length > 240 || /[\u0000-\u001f]/.test(title.text)) throw new TimelineCompileError('timeline_invalid');
    const divisor = { small: 24, medium: 16, large: 10 }[title.size]; if (!divisor || !['top', 'center', 'bottom'].includes(title.position)) throw new TimelineCompileError('timeline_invalid');
    const margin = Math.round(height / 12), y = title.position === 'top' ? String(margin) : title.position === 'center' ? '(h-text_h)/2' : `h-text_h-${margin}`;
    const name = `title-${index}.txt`; files.push({ name, text: title.text });
    filters.push(`drawtext=textfile=${name}:expansion=none:fontfile=${input.fontFile}:fontsize=${Math.round(height / divisor)}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${y}:enable='between(n,${start},${end - 1})'`);
  }
  graph.parts.push(`[${video}]${filters.join(',')},format=yuv420p[vout]`); return files;
}

/** @description Compile normalized v2 data; every graph parameter is rechecked and paths stay server-resolved.
 * @param {CompileInput} input Validated project and owned media.
 * @returns {CompiledTimeline} Fixed encoder arguments and exact expected length. */
export function compileMultitrack(input: CompileInput): CompiledTimeline {
  const tracks = input.document.tracks;
  if (!Array.isArray(tracks) || tracks.length > 12 || tracks.some(track => !['video', 'audio'].includes(track.kind) || typeof track.muted !== 'boolean' || !Array.isArray(track.clips))) throw new TimelineCompileError('timeline_invalid');
  const all = tracks.flatMap(track => track.clips); if (!all.length) throw new TimelineCompileError('timeline_empty');
  if (all.length > 32 || tracks.filter(track => track.kind === 'video').length > 4 || tracks.filter(track => track.kind === 'audio').length > 8) throw new TimelineCompileError('timeline_invalid');
  const total = int(Math.max(...all.map(clip => int(clip.start, 0, 1799) + int(clip.out, clip.in + 1, input.document.sources[clip.source]?.frames ?? 0) - int(clip.in, 0, 1799))), 1, 1800);
  const profile = input.variant === 'export' ? { width: 1280, height: 720, preset: 'veryfast', crf: 23, bitrate: '128k' } : { width: 640, height: 360, preset: 'ultrafast', crf: 32, bitrate: '96k' };
  if (!['export', 'preview'].includes(input.variant)) throw new TimelineCompileError('timeline_invalid');
  const graph: Graph = { parts: [], inputs: [], count: 0, audio: ['silence'], sources: new Map() };
  const active = tracks.filter(track => !track.muted).flatMap(track => {
    if (!['video', 'audio'].includes(track.kind) || typeof track.muted !== 'boolean') throw new TimelineCompileError('timeline_invalid');
    return track.clips.map(clip => ({ clip, kind: track.kind }));
  });
  graph.parts.push(`color=c=black:s=${profile.width}x${profile.height}:r=30,trim=end_frame=${total},setpts=PTS-STARTPTS,format=rgba[background]`,
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end_sample=${total * SAMPLES},asetpts=PTS-STARTPTS[silence]`);
  sourceInputs(graph, input, active); let video = 'background';
  for (const [index, row] of active.entries()) {
    const clip = row.clip, duration = clip.out - clip.in;
    int(clip.fadeIn, 0, duration); int(clip.fadeOut, 0, duration); if (clip.fadeIn + clip.fadeOut > duration) throw new TimelineCompileError('timeline_invalid');
    if (row.kind === 'video') video = videoClip(graph, clip, index, profile.width, profile.height, video);
    if (row.kind === 'audio' || (input.document.sources[clip.source].audio === true && clip.audioEnabled)) audioClip(graph, clip, index);
  }
  const files = titles(graph, input, video, total, profile.height);
  graph.parts.push(`${graph.audio.map(label => `[${label}]`).join('')}amix=inputs=${graph.audio.length}:duration=first:normalize=0:dropout_transition=0,alimiter=limit=0.95:level=0:latency=1,atrim=end_sample=${total * SAMPLES}[aout]`);
  const filterGraph = graph.parts.join(';'), threads = int(input.threads ?? 2, 1, 4);
  const args = ['-hide_banner', '-nostdin', '-n', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-filter_complex_threads', '1',
    ...graph.inputs, '-filter_complex', filterGraph, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', profile.preset,
    '-crf', String(profile.crf), '-pix_fmt', 'yuv420p', '-r', String(FPS), '-frames:v', String(total), '-threads', String(threads),
    '-c:a', 'aac', '-b:a', profile.bitrate, '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', 'file:output.mp4'];
  return { args, filterGraph, files, output: 'output.mp4', frames: total, samples: total * SAMPLES, width: profile.width, height: profile.height, fps: FPS };
}
