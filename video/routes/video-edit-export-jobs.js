"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportRunner = exports.EXPORT_LIMITS = exports.PROCESS_EPOCH = void 0;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bounded export jobs for the manual video editor (CREATE-EDIT-05c): one active encode per Video process, one job per owner, at most four queued with a 30-second queue deadline. Each job re-checks current authority when it starts, every few seconds while encoding and again before it publishes; runs in its own private work directory that is always removed; is cancelled, timed out or revoked by aborting only its own tracked child (TERM, then KILL); and publishes its verified output only through a compare-and-set on the job row, so a cancelled, stale or deleted job can never leave a success behind.
 */
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const logger_1 = require("@/shared/logger");
const video_edit_compiler_1 = require("./video-edit-compiler");
const video_edit_ffmpeg_adapter_1 = require("./video-edit-ffmpeg-adapter");
const video_editor_types_1 = require("./video-editor-types");
const logger = (0, logger_1.createChildLogger)({ module: 'video-edit-export-jobs' });
/** @description This process's identity; a job row from any other epoch that never finished is reported interrupted, never replayed. */
exports.PROCESS_EPOCH = (0, node_crypto_1.randomUUID)();
/** @description The first-slice job bounds from video/EDITOR-PLAN.md. */
exports.EXPORT_LIMITS = Object.freeze({ maxQueued: 4, queueMs: 30000, wallMs: 120000, graceMs: 2000, recheckMs: 5000,
    outputBytes: 268435456, threads: 2 });
function hashFile(file) {
    return new Promise((done, fail) => {
        const hash = (0, node_crypto_1.createHash)('sha256');
        (0, node_fs_1.createReadStream)(file).on('data', chunk => hash.update(chunk)).on('error', fail).on('end', () => done(hash.digest('hex')));
    });
}
function code(error, fallback) {
    return error instanceof video_editor_types_1.EditorError && /^[a-z0-9_]{1,80}$/.test(error.code) ? error.code : fallback;
}
/** One process-wide bounded queue of export jobs with exactly one active encode. */
class ExportRunner {
    options;
    limits;
    queue = [];
    active = null;
    epoch;
    constructor(options) {
        this.options = options;
        this.limits = { ...exports.EXPORT_LIMITS, ...options.limits };
        this.epoch = options.epoch ?? exports.PROCESS_EPOCH;
    }
    /** @description Live progress of a job this process is running, in frames. @param id - Export. @returns Frames, or null. */
    progress(id) { return this.active?.id === id ? this.active.progress : null; }
    /** @description Whether this process holds a job for the owner, queued or running. @param owner - Owner. @returns True if so. */
    holds(owner) {
        const same = (other) => other.issuer === owner.issuer && other.sub === owner.sub;
        return this.queue.some(entry => same(entry.job.owner)) || (!!this.active && same(this.active.owner));
    }
    /** @description Stop everything this runner holds (process exit or package teardown): abort the tracked child and drop the queue. @returns void */
    shutdown() {
        this.queue.length = 0;
        if (this.active) {
            this.active.reason ??= 'video_edit_export_interrupted';
            this.active.controller.abort();
        }
    }
    /**
     * @description Admit a job: one per owner, at most four waiting. The job keeps the admitting request's async context,
     * which is how its later authority re-checks see the same verified actor, and only while it is alive.
     * @param job - The job. @returns void; a full queue or a second job for the owner is refused.
     */
    admit(job) {
        if (this.holds(job.owner))
            throw new video_editor_types_1.EditorError(409, 'video_edit_export_in_progress');
        if (this.queue.length >= this.limits.maxQueued)
            throw new video_editor_types_1.EditorError(503, 'video_edit_export_queue_full');
        const context = new node_async_hooks_1.AsyncResource('video-edit-export');
        this.queue.push({ job, deadline: Date.now() + this.limits.queueMs, run: work => context.runInAsyncScope(work) });
        this.pump();
    }
    /** @description Abort a queued or running job this process holds. @param id - Export. @returns True when something was aborted. */
    cancel(id) {
        const index = this.queue.findIndex(entry => entry.job.id === id);
        if (index >= 0) {
            this.queue.splice(index, 1);
            return true;
        }
        if (this.active?.id !== id)
            return false;
        this.active.reason ??= 'cancelled';
        this.active.controller.abort();
        return true;
    }
    pump() {
        if (this.active)
            return;
        const next = this.queue.shift();
        if (!next)
            return;
        const active = { id: next.job.id, owner: next.job.owner, controller: new AbortController(), progress: 0 };
        this.active = active;
        void next.run(() => this.execute(next, active)).catch(error => logger.error({ err: error, exportId: next.job.id }, 'export job crashed'))
            .finally(() => { this.active = null; this.pump(); });
    }
    async record(job, outcome) {
        try {
            return await this.options.store.finishExport(job.owner, job.id, this.epoch, outcome);
        }
        catch (error) {
            logger.error({ err: error, exportId: job.id }, 'recording the export outcome failed');
            return false;
        }
    }
    async execute(entry, active) {
        const { job } = entry;
        if (Date.now() > entry.deadline) {
            await this.record(job, { status: 'failed', error: 'video_edit_export_queue_timeout' });
            return;
        }
        try {
            await job.authorize();
        }
        catch (error) {
            logger.error({ err: error, exportId: job.id }, 'export refused at start');
            await this.record(job, { status: 'failed', error: 'video_edit_permission_revoked' });
            return;
        }
        if (!(await this.options.store.markExportRunning(job.owner, job.id, this.epoch)))
            return;
        await (0, promises_1.mkdir)(this.options.workRoot, { recursive: true, mode: 0o700 });
        const work = await (0, promises_1.mkdtemp)((0, node_path_1.join)(this.options.workRoot, 'export-'));
        try {
            await this.encode(job, active, work);
        }
        catch (error) {
            logger.error({ err: error, exportId: job.id }, 'export job failed');
            await this.record(job, { status: 'failed', error: code(error, 'video_edit_export_failed') });
        }
        finally {
            await (0, promises_1.rm)(work, { recursive: true, force: true });
        }
    }
    async encode(job, active, work) {
        const prepared = await job.prepare();
        const compiled = (0, video_edit_compiler_1.compileTimeline)({ document: prepared.document, media: prepared.media, variant: prepared.variant,
            fontFile: this.options.fontFile ?? (process.env.VIDEO_CAPTION_FONT || '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'), threads: this.limits.threads });
        for (const file of compiled.files)
            await (0, promises_1.writeFile)((0, node_path_1.join)(work, file.name), file.text, { flag: 'wx', mode: 0o600 });
        const timer = setTimeout(() => { active.reason ??= 'video_edit_export_timeout'; active.controller.abort(); }, this.limits.wallMs);
        const recheck = setInterval(() => {
            job.authorize().catch(() => { active.reason ??= 'video_edit_permission_revoked'; active.controller.abort(); });
        }, this.limits.recheckMs);
        const args = [...compiled.args.slice(0, -1), '-fs', String(this.limits.outputBytes), compiled.args[compiled.args.length - 1]];
        let result;
        try {
            result = await (this.options.encoder ?? video_edit_ffmpeg_adapter_1.spawnEncoder)({ args, cwd: work, signal: active.controller.signal, graceMs: this.limits.graceMs,
                onProgress: frame => { active.progress = Math.min(frame, compiled.frames); } });
        }
        finally {
            clearTimeout(timer);
            clearInterval(recheck);
        }
        if (active.reason) {
            await this.stopped(job, active.reason);
            return;
        }
        if (result.code !== 0) {
            logger.error({ exportId: job.id, code: result.code, signal: result.signal, error: result.error, stderr: result.stderrTail }, 'encoder failed');
            throw new video_editor_types_1.EditorError(500, result.error ? 'video_edit_encoder_unavailable' : 'video_edit_encoder_failed');
        }
        await this.publish(job, active, prepared, compiled, (0, node_path_1.join)(work, video_edit_compiler_1.OUTPUT_NAME));
    }
    async stopped(job, reason) {
        await this.record(job, reason === 'cancelled' ? { status: 'cancelled' } : { status: 'failed', error: reason });
    }
    /** Verify the real output, re-check authority, move it into place, then commit the success only if the row is still ours to finish. */
    async publish(job, active, prepared, compiled, file) {
        const stat = await (0, promises_1.lstat)(file);
        if (!stat.isFile() || stat.size < 1 || stat.size > this.limits.outputBytes)
            throw new video_editor_types_1.EditorError(500, 'video_edit_export_output_invalid');
        const measured = (0, video_edit_ffmpeg_adapter_1.assessOutput)(await (this.options.prober ?? video_edit_ffmpeg_adapter_1.probeOutput)(file), compiled);
        const sha256 = await hashFile(file);
        await job.authorize();
        if (active.reason) {
            await this.stopped(job, active.reason);
            return;
        }
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(prepared.outputFile), { recursive: true, mode: 0o700 });
        await (0, promises_1.rename)(file, prepared.outputFile);
        const committed = await this.record(job, { status: 'succeeded', output: { bytes: stat.size, sha256, frames: measured.frames, durationMs: measured.durationMs } });
        if (!committed) {
            await (0, promises_1.unlink)(prepared.outputFile).catch(error => logger.error({ err: error, exportId: job.id }, 'removing an unpublished output failed'));
        }
    }
}
exports.ExportRunner = ExportRunner;
