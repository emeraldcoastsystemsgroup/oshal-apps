/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owner-scoped persistence for export jobs (CREATE-EDIT-05c): a job row captures one saved revision and the hash of exactly the document text it will render; one active job per owner in this process epoch, older-epoch rows are reported and recorded as interrupted rather than replayed; every state change is a compare-and-set on status, epoch and cancellation, so a cancelled or stale job can never record a success; a project keeps at most three exports (a new job and its two newest finished predecessors).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { EditorError, type ConfirmEditorAccess, type EditorOwner, type TimelineDocument } from './video-editor-types';
import type { VideoEditorStore } from './video-editor-store';
import type { ExportJobStore, ExportOutcome } from './video-edit-export-jobs';

/** @description One export as the routes report it. */
export interface ExportRecord {
  id: string; projectId: string; revision: number; variant: 'export' | 'preview'; status: string; cancelRequested: boolean;
  totalFrames: number; error: string | null; outputBytes: number | null; outputSha256: string | null; outputFrames: number | null;
  outputDurationMs: number | null; createdAt: string; updatedAt: string; startedAt: string | null; finishedAt: string | null;
}
interface ExportRow { export_id: string; project_id: string; revision: number; variant: 'export' | 'preview'; status: string; cancel_requested: boolean;
  process_epoch: string; total_frames: number; error: string | null; output_bytes: string | number | null; output_sha256: string | null;
  output_frames: number | null; output_duration_ms: number | null; created_at: Date | string; updated_at: Date | string;
  started_at: Date | string | null; finished_at: Date | string | null }
const COLUMNS = `export_id,project_id,revision,variant,status,cancel_requested,process_epoch,total_frames,error,output_bytes,output_sha256,
  output_frames,output_duration_ms,created_at,updated_at,started_at,finished_at`;
const ACTIVE = "status IN ('queued','running')";
/** A project keeps at most three exports: a newly queued one and its two newest finished predecessors. */
const KEEP_PER_PROJECT = 3;

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

/** @description Render a row; an unfinished row from another process epoch reads as interrupted, never as still running. */
function record(row: ExportRow, epoch: string): ExportRecord {
  const stale = (row.status === 'queued' || row.status === 'running') && row.process_epoch !== epoch;
  return { id: row.export_id, projectId: row.project_id, revision: row.revision, variant: row.variant,
    status: stale ? 'interrupted' : row.status, cancelRequested: row.cancel_requested, totalFrames: row.total_frames,
    error: stale ? 'video_edit_export_interrupted' : row.error, outputBytes: row.output_bytes === null ? null : Number(row.output_bytes),
    outputSha256: row.output_sha256, outputFrames: row.output_frames, outputDurationMs: row.output_duration_ms,
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at) };
}

/** @description The exact document text a job renders and its hash; revisions are immutable, so the text never changes. */
export interface RevisionSnapshot { text: string; sha256: string; document: TimelineDocument }

/** Export rows, always inside the editor store's owner-stamped transactions. */
export class VideoExportStore implements ExportJobStore {
  constructor(private readonly store: VideoEditorStore) {}

  private async snapshot(client: PoolClient, owner: EditorOwner, projectId: string, revision: number): Promise<RevisionSnapshot> {
    const result = await client.query<{ text: string }>(`SELECT r.document::text AS text FROM video_edit_revisions r
      WHERE r.owner_issuer=$1 AND r.owner_sub=$2 AND r.project_id=$3 AND r.revision=$4`, [owner.issuer, owner.sub, projectId, revision]);
    if (!result.rows[0]) throw new EditorError(404, 'video_edit_revision_not_found');
    const text = result.rows[0].text;
    return { text, sha256: createHash('sha256').update(text).digest('hex'), document: JSON.parse(text) as TimelineDocument };
  }

  /**
   * @description Record a queued job for one saved revision. Older-epoch unfinished rows become interrupted; a second active job
   * for the owner is refused; a project keeps the new job and its two newest finished exports (the rest are returned for file removal).
   * @returns The new record, its snapshot, and the pruned exports whose files the caller removes after commit.
   */
  async create(owner: EditorOwner, projectId: string, revision: number, variant: 'export' | 'preview', epoch: string,
    confirm: ConfirmEditorAccess): Promise<{ record: ExportRecord; snapshot: RevisionSnapshot; pruned: Array<{ id: string }> }> {
    return this.store.transaction(owner, true, async client => {
      await this.store.ownerLock(client, owner);
      await client.query(`UPDATE video_edit_exports SET status='interrupted',error='video_edit_export_interrupted',updated_at=now(),finished_at=now()
        WHERE owner_issuer=$1 AND owner_sub=$2 AND ${ACTIVE} AND process_epoch<>$3`, [owner.issuer, owner.sub, epoch]);
      const busy = await client.query(`SELECT 1 FROM video_edit_exports WHERE owner_issuer=$1 AND owner_sub=$2 AND ${ACTIVE}`, [owner.issuer, owner.sub]);
      if (busy.rows.length) throw new EditorError(409, 'video_edit_export_in_progress');
      const snapshot = await this.snapshot(client, owner, projectId, revision);
      const frames = snapshot.document.segments.reduce((sum, segment) => sum + segment.out - segment.in, 0);
      if (frames < 1) throw new EditorError(400, 'video_edit_export_empty');
      const id = randomUUID();
      const inserted = await client.query<ExportRow>(`INSERT INTO video_edit_exports (export_id,project_id,owner_issuer,owner_sub,revision,variant,profile,
        snapshot_sha256,process_epoch,total_frames) VALUES ($3,$4,$1,$2,$5,$6,'hd720p30',$7,$8,$9) RETURNING ${COLUMNS}`,
        [owner.issuer, owner.sub, id, projectId, revision, variant, snapshot.sha256, epoch, frames]);
      const pruned = await client.query<{ export_id: string }>(`DELETE FROM video_edit_exports WHERE owner_issuer=$1 AND owner_sub=$2 AND export_id IN (
        SELECT export_id FROM video_edit_exports WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3 AND NOT ${ACTIVE}
        ORDER BY created_at DESC, export_id OFFSET ${KEEP_PER_PROJECT - 1}) RETURNING export_id`, [owner.issuer, owner.sub, projectId]);
      return { record: record(inserted.rows[0], epoch), snapshot, pruned: pruned.rows.map(row => ({ id: row.export_id })) };
    }, confirm);
  }

  /** @description Re-read a job's snapshot at start and require the hash it was queued with. @returns The snapshot. */
  async verifiedSnapshot(owner: EditorOwner, projectId: string, revision: number, sha256: string): Promise<RevisionSnapshot> {
    const snapshot = await this.store.transaction(owner, false, client => this.snapshot(client, owner, projectId, revision));
    if (snapshot.sha256 !== sha256) throw new EditorError(409, 'video_edit_export_snapshot_changed');
    return snapshot;
  }

  /** @description One of the owner's exports. @returns The record; another owner's is 404. */
  async get(owner: EditorOwner, id: string, epoch: string): Promise<ExportRecord> {
    return this.store.transaction(owner, false, async client => {
      const result = await client.query<ExportRow>(`SELECT ${COLUMNS} FROM video_edit_exports WHERE owner_issuer=$1 AND owner_sub=$2 AND export_id=$3`, [owner.issuer, owner.sub, id]);
      if (!result.rows[0]) throw new EditorError(404, 'video_edit_export_not_found');
      return record(result.rows[0], epoch);
    });
  }

  /** @description A project's newest ten exports. @returns Records, newest first. */
  async list(owner: EditorOwner, projectId: string, epoch: string): Promise<ExportRecord[]> {
    return this.store.transaction(owner, false, async client => {
      const project = await client.query('SELECT 1 FROM video_edit_projects WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3', [owner.issuer, owner.sub, projectId]);
      if (!project.rows.length) throw new EditorError(404, 'video_edit_project_not_found');
      const result = await client.query<ExportRow>(`SELECT ${COLUMNS} FROM video_edit_exports WHERE owner_issuer=$1 AND owner_sub=$2 AND project_id=$3
        ORDER BY created_at DESC, export_id LIMIT 10`, [owner.issuer, owner.sub, projectId]);
      return result.rows.map(row => record(row, epoch));
    });
  }

  /**
   * @description Ask for cancellation: a queued job ends as cancelled at once, a running one keeps running until its child exits.
   * @returns The record after the request (an already-finished job is returned unchanged).
   */
  async requestCancel(owner: EditorOwner, id: string, epoch: string, confirm: ConfirmEditorAccess): Promise<ExportRecord> {
    return this.store.transaction(owner, true, async client => {
      const result = await client.query<ExportRow>(`UPDATE video_edit_exports SET cancel_requested=true,updated_at=now(),
        status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END, finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END
        WHERE owner_issuer=$1 AND owner_sub=$2 AND export_id=$3 AND ${ACTIVE} RETURNING ${COLUMNS}`, [owner.issuer, owner.sub, id]);
      if (result.rows[0]) return record(result.rows[0], epoch);
      const current = await client.query<ExportRow>(`SELECT ${COLUMNS} FROM video_edit_exports WHERE owner_issuer=$1 AND owner_sub=$2 AND export_id=$3`, [owner.issuer, owner.sub, id]);
      if (!current.rows[0]) throw new EditorError(404, 'video_edit_export_not_found');
      return record(current.rows[0], epoch);
    }, confirm);
  }

  /** @description Compare-and-set queued to running for this epoch, unless cancellation was requested. @returns Whether it started. */
  async markExportRunning(owner: EditorOwner, id: string, epoch: string): Promise<boolean> {
    return this.store.transaction(owner, true, async client => (await client.query(`UPDATE video_edit_exports SET status='running',started_at=now(),updated_at=now()
      WHERE owner_issuer=$1 AND owner_sub=$2 AND export_id=$3 AND status='queued' AND process_epoch=$4 AND NOT cancel_requested`,
      [owner.issuer, owner.sub, id, epoch])).rowCount === 1);
  }

  /** @description Compare-and-set an active job of this epoch to its outcome; a success also requires that nobody asked to cancel. @returns Whether it was recorded. */
  async finishExport(owner: EditorOwner, id: string, epoch: string, outcome: ExportOutcome): Promise<boolean> {
    const output = outcome.output;
    return this.store.transaction(owner, true, async client => (await client.query(`UPDATE video_edit_exports SET status=$5,error=$6,output_bytes=$7,output_sha256=$8,
      output_frames=$9,output_duration_ms=$10,updated_at=now(),finished_at=now()
      WHERE owner_issuer=$1 AND owner_sub=$2 AND export_id=$3 AND ${ACTIVE} AND process_epoch=$4 AND ($5<>'succeeded' OR NOT cancel_requested)`,
      [owner.issuer, owner.sub, id, epoch, outcome.status, outcome.error ?? null, output?.bytes ?? null, output?.sha256 ?? null,
        output?.frames ?? null, output?.durationMs ?? null])).rowCount === 1);
  }
}
