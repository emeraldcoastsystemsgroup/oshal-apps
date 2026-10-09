/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bounded export jobs for the manual video editor (CREATE-EDIT-05c): one active encode per Video process, one job per owner, at most four queued with a 30-second queue deadline. Each job re-checks current authority when it starts, every few seconds while encoding and again before it publishes; runs in its own private work directory that is always removed; is cancelled, timed out or revoked by aborting only its own tracked child (TERM, then KILL); and publishes its verified output only through a compare-and-set on the job row, so a cancelled, stale or deleted job can never leave a success behind.
 */
import { AsyncResource } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createChildLogger } from '@/shared/logger';
import { compileTimeline, OUTPUT_NAME, type CompiledTimeline, type TimelineDocument } from './video-edit-compiler';
import { assessOutput, probeOutput, spawnEncoder, type Encoder, type OutputProber } from './video-edit-ffmpeg-adapter';
import { EditorError, type EditorOwner } from './video-editor-types';

const logger = createChildLogger({ module: 'video-edit-export-jobs' });

/** @description This process's identity; a job row from any other epoch that never finished is reported interrupted, never replayed. */
export const PROCESS_EPOCH = randomUUID();

/** @description The first-slice job bounds from video/EDITOR-PLAN.md. */
export const EXPORT_LIMITS = Object.freeze({ maxQueued: 4, queueMs: 30000, wallMs: 120000, graceMs: 2000, recheckMs: 5000,
  outputBytes: 268435456, threads: 2 });

/** @description A job's end state as recorded on its row. */
export interface ExportOutcome { status: 'succeeded' | 'failed' | 'cancelled'; error?: string;
  output?: { bytes: number; sha256: string; frames: number; durationMs: number } }

/** @description The row operations a job needs; production is the owner-scoped PostgreSQL store. */
export interface ExportJobStore {
  markExportRunning(owner: EditorOwner, id: string, epoch: string): Promise<boolean>;
  finishExport(owner: EditorOwner, id: string, epoch: string, outcome: ExportOutcome): Promise<boolean>;
}

/** @description Everything one encode needs once the job has been admitted and re-authorized. */
export interface PreparedExport { document: TimelineDocument; media: Record<string, string>; variant: 'export' | 'preview'; outputFile: string }

/** @description One queued job. `prepare` resolves and verifies the owner's media only after the start-time authority check. */
export interface ExportJob { id: string; owner: EditorOwner; prepare: () => Promise<PreparedExport>; authorize: () => Promise<void> }

/** @description Test seams; production uses the runtime FFmpeg/ffprobe, the core font and EXPORT_LIMITS. */
export interface ExportRunnerOptions { store: ExportJobStore; workRoot: string; encoder?: Encoder; prober?: OutputProber; fontFile?: string;
  limits?: Partial<typeof EXPORT_LIMITS>; epoch?: string }

interface Queued { job: ExportJob; deadline: number; run: (work: () => Promise<void>) => Promise<void> }
interface Active { id: string; owner: EditorOwner; controller: AbortController; reason?: string; progress: number }

function hashFile(file: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', fail).on('end', () => done(hash.digest('hex')));
  });
}
function code(error: unknown, fallback: string): string {
  return error instanceof EditorError && /^[a-z0-9_]{1,80}$/.test(error.code) ? error.code : fallback;
}

/** One process-wide bounded queue of export jobs with exactly one active encode. */
export class ExportRunner {
  private readonly limits: typeof EXPORT_LIMITS;
  private readonly queue: Queued[] = [];
  private active: Active | null = null;
  readonly epoch: string;

  constructor(private readonly options: ExportRunnerOptions) {
    this.limits = { ...EXPORT_LIMITS, ...options.limits };
    this.epoch = options.epoch ?? PROCESS_EPOCH;
  }

  /** @description Live progress of a job this process is running, in frames. @param id - Export. @returns Frames, or null. */
  progress(id: string): number | null { return this.active?.id === id ? this.active.progress : null; }

  /** @description Whether this process holds a job for the owner, queued or running. @param owner - Owner. @returns True if so. */
  holds(owner: EditorOwner): boolean {
    const same = (other: EditorOwner) => other.issuer === owner.issuer && other.sub === owner.sub;
    return this.queue.some(entry => same(entry.job.owner)) || (!!this.active && same(this.active.owner));
  }

  /** @description Stop everything this runner holds (process exit or package teardown): abort the tracked child and drop the queue. @returns void */
  shutdown(): void {
    this.queue.length = 0;
    if (this.active) { this.active.reason ??= 'video_edit_export_interrupted'; this.active.controller.abort(); }
  }

  /**
   * @description Admit a job: one per owner, at most four waiting. The job keeps the admitting request's async context,
   * which is how its later authority re-checks see the same verified actor, and only while it is alive.
   * @param job - The job. @returns void; a full queue or a second job for the owner is refused.
   */
  admit(job: ExportJob): void {
    if (this.holds(job.owner)) throw new EditorError(409, 'video_edit_export_in_progress');
    if (this.queue.length >= this.limits.maxQueued) throw new EditorError(503, 'video_edit_export_queue_full');
    const context = new AsyncResource('video-edit-export');
    this.queue.push({ job, deadline: Date.now() + this.limits.queueMs, run: work => context.runInAsyncScope(work) });
    this.pump();
  }

  /** @description Abort a queued or running job this process holds. @param id - Export. @returns True when something was aborted. */
  cancel(id: string): boolean {
    const index = this.queue.findIndex(entry => entry.job.id === id);
    if (index >= 0) { this.queue.splice(index, 1); return true; }
    if (this.active?.id !== id) return false;
    this.active.reason ??= 'cancelled';
    this.active.controller.abort();
    return true;
  }

  private pump(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    const active: Active = { id: next.job.id, owner: next.job.owner, controller: new AbortController(), progress: 0 };
    this.active = active;
    void next.run(() => this.execute(next, active)).catch(error => logger.error({ err: error, exportId: next.job.id }, 'export job crashed'))
      .finally(() => { this.active = null; this.pump(); });
  }

  private async record(job: ExportJob, outcome: ExportOutcome): Promise<boolean> {
    try { return await this.options.store.finishExport(job.owner, job.id, this.epoch, outcome); }
    catch (error) { logger.error({ err: error, exportId: job.id }, 'recording the export outcome failed'); return false; }
  }

  private async execute(entry: Queued, active: Active): Promise<void> {
    const { job } = entry;
    if (Date.now() > entry.deadline) { await this.record(job, { status: 'failed', error: 'video_edit_export_queue_timeout' }); return; }
    try { await job.authorize(); }
    catch (error) { logger.error({ err: error, exportId: job.id }, 'export refused at start'); await this.record(job, { status: 'failed', error: 'video_edit_permission_revoked' }); return; }
    if (!(await this.options.store.markExportRunning(job.owner, job.id, this.epoch))) return;
    await mkdir(this.options.workRoot, { recursive: true, mode: 0o700 });
    const work = await mkdtemp(join(this.options.workRoot, 'export-'));
    try { await this.encode(job, active, work); }
    catch (error) {
      logger.error({ err: error, exportId: job.id }, 'export job failed');
      await this.record(job, { status: 'failed', error: code(error, 'video_edit_export_failed') });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  private async encode(job: ExportJob, active: Active, work: string): Promise<void> {
    const prepared = await job.prepare();
    const compiled = compileTimeline({ document: prepared.document, media: prepared.media, variant: prepared.variant,
      fontFile: this.options.fontFile ?? (process.env.VIDEO_CAPTION_FONT || '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'), threads: this.limits.threads });
    for (const file of compiled.files) await writeFile(join(work, file.name), file.text, { flag: 'wx', mode: 0o600 });
    const timer = setTimeout(() => { active.reason ??= 'video_edit_export_timeout'; active.controller.abort(); }, this.limits.wallMs);
    const recheck = setInterval(() => {
      job.authorize().catch(() => { active.reason ??= 'video_edit_permission_revoked'; active.controller.abort(); });
    }, this.limits.recheckMs);
    const args = [...compiled.args.slice(0, -1), '-fs', String(this.limits.outputBytes), compiled.args[compiled.args.length - 1]];
    let result;
    try {
      result = await (this.options.encoder ?? spawnEncoder)({ args, cwd: work, signal: active.controller.signal, graceMs: this.limits.graceMs,
        onProgress: frame => { active.progress = Math.min(frame, compiled.frames); } });
    } finally { clearTimeout(timer); clearInterval(recheck); }
    if (active.reason) { await this.stopped(job, active.reason); return; }
    if (result.code !== 0) {
      logger.error({ exportId: job.id, code: result.code, signal: result.signal, error: result.error, stderr: result.stderrTail }, 'encoder failed');
      throw new EditorError(500, result.error ? 'video_edit_encoder_unavailable' : 'video_edit_encoder_failed');
    }
    await this.publish(job, active, prepared, compiled, join(work, OUTPUT_NAME));
  }

  private async stopped(job: ExportJob, reason: string): Promise<void> {
    await this.record(job, reason === 'cancelled' ? { status: 'cancelled' } : { status: 'failed', error: reason });
  }

  /** Verify the real output, re-check authority, move it into place, then commit the success only if the row is still ours to finish. */
  private async publish(job: ExportJob, active: Active, prepared: PreparedExport, compiled: CompiledTimeline, file: string): Promise<void> {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > this.limits.outputBytes) throw new EditorError(500, 'video_edit_export_output_invalid');
    const measured = assessOutput(await (this.options.prober ?? probeOutput)(file), compiled);
    const sha256 = await hashFile(file);
    await job.authorize();
    if (active.reason) { await this.stopped(job, active.reason); return; }
    await mkdir(dirname(prepared.outputFile), { recursive: true, mode: 0o700 });
    await rename(file, prepared.outputFile);
    const committed = await this.record(job, { status: 'succeeded', output: { bytes: stat.size, sha256, frames: measured.frames, durationMs: measured.durationMs } });
    if (!committed) { await unlink(prepared.outputFile).catch(error => logger.error({ err: error, exportId: job.id }, 'removing an unpublished output failed')); }
  }
}
