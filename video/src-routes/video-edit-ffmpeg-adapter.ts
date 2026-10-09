/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Video-owned adapter around the runtime's FFmpeg and ffprobe for manual-editor exports (CREATE-EDIT-05c): spawn one tracked child from a fixed argument array (no shell, minimal environment, stdin closed), report -progress frames, and on abort send TERM, escalate to KILL after a bounded grace and resolve only once the child has exited. The produced file is then measured by ffprobe (decoded frame count, codecs, size, sample format) and held to the exact frames and canvas the compiler promised.
 */
import { execFile, spawn } from 'node:child_process';
import { EditorError } from './video-editor-types';

/** @description How an encode ended. `error` is set when the binary could not be started at all. */
export interface EncodeResult { code: number | null; signal: NodeJS.Signals | null; error?: string; stderrTail: string }
/** @description One encode: fixed arguments, the private work directory, a progress sink and an abort signal. */
export interface EncodeRequest { args: string[]; cwd: string; onProgress?: (frame: number) => void; signal: AbortSignal; graceMs?: number }
/** @description Runs one encode; production spawns FFmpeg, a test may name its own. */
export type Encoder = (request: EncodeRequest) => Promise<EncodeResult>;
/** @description What ffprobe measured of a produced file. */
export interface OutputMeasure { frames: number; durationMs: number; width: number; height: number; videoCodec: string; audioCodec: string; sampleRate: number; channels: number }
export type OutputProber = (file: string) => Promise<OutputMeasure>;

const STDERR_TAIL = 4000;

/**
 * @description Spawn the runtime's FFmpeg (FFMPEG_PATH overrides, as for the core renderer) and track exactly that child.
 * @param request - Arguments, work directory, progress sink, abort signal and TERM-to-KILL grace.
 * @returns How the child ended, after it has exited.
 */
export const spawnEncoder: Encoder = request => new Promise(done => {
  let stderr = '', buffered = '', settled = false, killTimer: ReturnType<typeof setTimeout> | undefined;
  const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', request.args, { cwd: request.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { PATH: process.env.PATH ?? '', LANG: 'C' } });
  const finish = (result: EncodeResult) => { if (settled) return; settled = true; if (killTimer) clearTimeout(killTimer); request.signal.removeEventListener('abort', abort); done(result); };
  const abort = () => {
    child.kill('SIGTERM');
    killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, request.graceMs ?? 2000);
  };
  child.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('latin1');
    const lines = buffered.split('\n'); buffered = lines.pop() ?? '';
    for (const line of lines) {
      const match = /^frame=(\d+)\s*$/.exec(line.trim());
      if (match) request.onProgress?.(Number(match[1]));
    }
  });
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL); });
  child.on('error', error => finish({ code: null, signal: null, error: error.message, stderrTail: stderr }));
  child.on('close', (code, signal) => finish({ code, signal, stderrTail: stderr }));
  if (request.signal.aborted) abort(); else request.signal.addEventListener('abort', abort, { once: true });
});

interface ProbeStream { codec_type?: string; codec_name?: string; width?: number; height?: number; nb_read_frames?: string; sample_rate?: string; channels?: number }

/**
 * @description Measure a produced MP4 by DECODING it (-count_frames), through the file protocol only.
 * @param file - The produced file. @returns The measured streams.
 */
export const probeOutput: OutputProber = file => new Promise((done, fail) => {
  const args = ['-v', 'error', '-protocol_whitelist', 'file', '-f', 'mov', '-count_frames', '-print_format', 'json', '-show_format', '-show_streams', `file:${file}`];
  execFile(process.env.FFPROBE_PATH || 'ffprobe', args, { timeout: 60000, maxBuffer: 1048576, windowsHide: true }, (error, stdout) => {
    if (error) { fail(new EditorError(500, 'video_edit_export_output_invalid')); return; }
    try {
      const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: ProbeStream[] };
      const streams = probe.streams ?? [], video = streams.filter(s => s.codec_type === 'video'), audio = streams.filter(s => s.codec_type === 'audio');
      if (video.length !== 1 || audio.length !== 1 || streams.length !== 2) throw new Error('streams');
      done({ frames: Number(video[0].nb_read_frames), durationMs: Math.round(Number(probe.format?.duration) * 1000), width: Number(video[0].width),
        height: Number(video[0].height), videoCodec: String(video[0].codec_name), audioCodec: String(audio[0].codec_name),
        sampleRate: Number(audio[0].sample_rate), channels: Number(audio[0].channels) });
    } catch { fail(new EditorError(500, 'video_edit_export_output_invalid')); }
  });
});

/**
 * @description Hold a measured output to exactly what the compiler promised: every frame, the canvas, H.264/AAC 48 kHz stereo,
 * and a container duration within two frames (AAC priming makes the audio a few milliseconds longer; that is recorded, not drift).
 * @param measure - ffprobe's measurement. @param expected - Frames and canvas from the compile.
 * @returns The verified frame count and duration.
 */
export function assessOutput(measure: OutputMeasure, expected: { frames: number; width: number; height: number; fps: number }): { frames: number; durationMs: number } {
  const expectedMs = (expected.frames * 1000) / expected.fps, slack = (2 * 1000) / expected.fps;
  if (measure.frames !== expected.frames || measure.width !== expected.width || measure.height !== expected.height
    || measure.videoCodec !== 'h264' || measure.audioCodec !== 'aac' || measure.sampleRate !== 48000 || measure.channels !== 2
    || !(Math.abs(measure.durationMs - expectedMs) <= slack)) {
    throw new EditorError(500, 'video_edit_export_output_invalid');
  }
  return { frames: measure.frames, durationMs: measure.durationMs };
}
