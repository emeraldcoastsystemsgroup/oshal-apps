/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Forced-RLS async MP4 video rendering and verified video/mp4 export (RP-PUB-08).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.5.1: snapshot-load referenced publishing_revisions and publishing_blobs rows before native SQL updates on publishing_video_jobs.
 */
import {randomUUID} from 'node:crypto';
import {engine, output, upload} from './engine-client.mjs';
import engineIdentity from './engine-identity.json' with {type: 'json'};
import {digest, exact, fail, id, integer, LIMITS} from './model.mjs';

const iso = v => new Date(v).toISOString();
const active = row => ['queued', 'rendering'].includes(row.state);
const expired = row => Date.parse(active(row) ? row.run_until : row.expires_at) <= Date.now();
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const encoded = v => JSON.stringify(canonical(v));

function videoReceipt(row) {
  return {
    id: row.id,
    document: row.document_id,
    revision: row.revision,
    sourceSha256: row.source_sha256,
    state: expired(row) ? 'failed' : row.state,
    createdAt: iso(row.created_at),
    expiresAt: iso(active(row) ? row.run_until : row.expires_at),
    ...(expired(row)
      ? { error: 'publishing_job_expired' }
      : row.error
        ? { error: row.error, ...(row.details ? { details: row.details } : {}) }
        : row.result ? { result: row.result } : {}),
  };
}

async function videoJobRow(c, o, jobId) {
  const row = (await c.query('SELECT * FROM publishing_video_jobs WHERE owner_key=$1 AND id=$2', [...o, id(jobId)])).rows[0];
  if (!row) fail(404, 'publishing_job_missing');
  return row;
}

async function loadVideoRefs(c, o, job) {
  await c.query('SELECT * FROM publishing_revisions WHERE owner_key=$1 AND document_id=$2 AND revision=$3', [...o, job.document_id, job.revision]);
  if (job.blob_id) await c.query('SELECT * FROM publishing_blobs WHERE owner_key=$1 AND id=$2', [...o, job.blob_id]);
}

async function pruneVideoJobs(store, c, o) {
  const rows = (await c.query('SELECT * FROM publishing_video_jobs WHERE owner_key=$1 ORDER BY created_at', o)).rows;
  for (const row of rows) {
    if (expired(row)) {
      await store.tombstone(c, o, row.id);
      await c.query('DELETE FROM publishing_video_jobs WHERE owner_key=$1 AND id=$2', [...o, row.id]);
    }
  }
  await store.collect(c, o);
}

export async function beginVideo(store, documentId, input) {
  id(documentId);
  exact(input, ['revision', 'requestKey']);
  integer(input.revision, 1, LIMITS.revisions);
  return store.tx('render', true, async (c, o) => {
    const answer = await store.request(c, o, input.requestKey, ['render-video', documentId, input.revision], async () => {
      await pruneVideoJobs(store, c, o);
      const rows = (await c.query('SELECT * FROM publishing_video_jobs WHERE owner_key=$1 ORDER BY created_at', o)).rows;
      if (rows.some(active)) fail(409, 'publishing_job_active');
      if (rows.length >= LIMITS.jobs) fail(413, 'publishing_job_receipt_limit');
      const source = await store.getRow(c, o, documentId, input.revision);
      if (source.row.current_revision !== input.revision) fail(409, 'publishing_revision_conflict');
      await store.assets(c, o, source.model.assets);
      const jobId = randomUUID();
      await c.query(
        "INSERT INTO publishing_video_jobs(id,owner_key,document_id,revision,source_sha256,state,run_until,expires_at) VALUES($2,$1,$3,$4,$5,'queued',$6,$7)",
        [...o, jobId, documentId, input.revision, source.saved.sha256, new Date(Date.now() + 300000).toISOString(), new Date(Date.now() + 3600000).toISOString()],
      );
      return { resource: jobId, result: { job: { id: jobId } } };
    });
    return { job: videoReceipt(await videoJobRow(c, o, answer.job.id)), created: !answer.replayed, ...(answer.replayed ? { replayed: true } : {}) };
  });
}

export async function videoJob(store, jobId) {
  return store.tx('job.read', false, async (c, o) => videoReceipt(await videoJobRow(c, o, jobId)));
}

export async function cancelVideoJob(store, jobId) {
  return store.tx('job.manage', true, async (c, o) => {
    const job = await videoJobRow(c, o, jobId);
    await loadVideoRefs(c, o, job);
    await c.query("UPDATE publishing_video_jobs SET state='cancelled',result=NULL,error=NULL,details=NULL WHERE owner_key=$1 AND id=$2 AND state IN('queued','rendering')", [...o, jobId]);
    return videoReceipt(await videoJobRow(c, o, jobId));
  });
}

export async function abandonVideoJob(store, jobId) {
  return store.tx('render', true, async (c, o) => {
    const job = await videoJobRow(c, o, jobId);
    await loadVideoRefs(c, o, job);
    await c.query("UPDATE publishing_video_jobs SET state='failed',error='publishing_continuation_unavailable' WHERE owner_key=$1 AND id=$2 AND state='queued'", [...o, jobId]);
    return videoReceipt(await videoJobRow(c, o, jobId));
  });
}

async function currentVideo(store, jobId) {
  return store.tx('render', false, async (c, o) => {
    const job = await videoJobRow(c, o, jobId);
    if (job.state !== 'rendering' || expired(job)) fail(409, 'publishing_job_not_active');
    const source = await store.getRow(c, o, job.document_id, job.revision);
    if (source.row.current_revision !== job.revision || source.saved.sha256 !== job.source_sha256) fail(409, 'publishing_revision_conflict');
    await store.assets(c, o, source.model.assets);
    return { job, source };
  });
}

export async function produceVideo(store, jobId) {
  let token, claimed = false;
  try {
    const snapshot = await store.tx('render', true, async (c, o) => {
      const job = await videoJobRow(c, o, jobId);
      if (job.state !== 'queued' || expired(job)) fail(409, 'publishing_job_not_active');
      const source = await store.getRow(c, o, job.document_id, job.revision);
      if (source.row.current_revision !== job.revision || source.saved.sha256 !== job.source_sha256) fail(409, 'publishing_revision_conflict');
      const changed = await c.query("UPDATE publishing_video_jobs SET state='rendering' WHERE owner_key=$1 AND id=$2 AND state='queued' RETURNING id", [...o, jobId]);
      if (!changed.rows.length) fail(409, 'publishing_job_not_active');
      return { job, source };
    });
    claimed = true;
    const current = () => currentVideo(store, jobId);
    const data = await store.tx('render', false, (c, o) => store.assets(c, o, snapshot.source.model.assets, true));
    token = await upload(store.ctx, 'render', snapshot.source.model.assets, data, current);
    const started = await engine(store.ctx, 'render', { op: 'render_video', token, model: snapshot.source.model });
    if (started.state !== 'rendering') fail(503, 'publishing_engine_invalid_response');
    let result;
    for (;;) {
      await current();
      const status = await engine(store.ctx, 'render', { op: 'status', token });
      if (status.state === 'ready') { result = status.receipt; break; }
      if (status.state === 'failed') fail(400, /^publishing_[a-z0-9_]+$/.test(status.error ?? '') ? status.error : 'publishing_render_failed', status.details);
      if (status.state !== 'rendering') fail(503, 'publishing_engine_invalid_response');
      await new Promise(done => setTimeout(done, 100));
    }
    const descriptor = result?.outputs?.[0];
    if (!descriptor || descriptor.name !== 'publication.mp4' || descriptor.mime !== 'video/mp4') fail(503, 'publishing_output_invalid');
    const mp4Bytes = await output(store.ctx, 'render', token, descriptor, current);
    return await store.tx('render', true, async (c, o) => {
      const job = await videoJobRow(c, o, jobId);
      if (job.state !== 'rendering' || expired(job)) fail(409, 'publishing_job_not_active');
      const source = await store.getRow(c, o, job.document_id, job.revision);
      if (source.row.current_revision !== job.revision || source.saved.sha256 !== job.source_sha256) fail(409, 'publishing_revision_conflict');
      await loadVideoRefs(c, o, job);
      const blobId = await store.putBlob(c, o, mp4Bytes, 'render');
      const final = { ...result, revision: job.revision, sourceSha256: job.source_sha256, engineHash: engineIdentity.buildHash };
      const done = (await c.query("UPDATE publishing_video_jobs SET state='ready',blob_id=$3,result=$4::jsonb,error=NULL,details=NULL WHERE owner_key=$1 AND id=$2 AND state='rendering' RETURNING *", [...o, jobId, blobId, encoded(final)])).rows[0];
      if (!done) fail(409, 'publishing_job_not_active');
      return videoReceipt(done);
    });
  } catch (error) {
    if (claimed) {
      for (const perm of ['render', 'job.manage']) {
        try {
          await store.tx(perm, true, async (c, o) => {
            const job = await videoJobRow(c, o, jobId);
            await loadVideoRefs(c, o, job);
            const details = error.details && Buffer.byteLength(JSON.stringify(error.details)) <= 65536 ? JSON.stringify(error.details) : null;
            await c.query("UPDATE publishing_video_jobs SET state='failed',error=$3,details=$4::jsonb,result=NULL WHERE owner_key=$1 AND id=$2 AND state IN('queued','rendering')", [...o, jobId, /^publishing_[a-z0-9_]+$/.test(error.code ?? '') ? error.code : 'publishing_render_failed', details]);
          });
          break;
        } catch {}
      }
    }
    throw error;
  } finally {
    if (token) {
      for (const perm of ['render', 'job.manage']) {
        try { await engine(store.ctx, perm, { op: 'close', token }); break; } catch {}
      }
    }
  }
}

export async function videoContent(store, documentId, revision, permission = 'export') {
  if (permission !== 'export') fail(403, 'publishing_permission_denied');
  return store.tx('export', false, async (c, o) => {
    const source = await store.getRow(c, o, documentId, revision);
    await store.assets(c, o, source.model.assets);
    const job = (await c.query("SELECT * FROM publishing_video_jobs WHERE owner_key=$1 AND document_id=$2 AND revision=$3 AND state='ready' ORDER BY created_at DESC LIMIT 1", [...o, documentId, source.saved.revision])).rows[0];
    if (!job || expired(job) || job.source_sha256 !== source.saved.sha256 || !job.blob_id) fail(409, 'publishing_video_render_required');
    const data = await store.blob(c, o, job.blob_id, 'export');
    const descriptor = job.result?.outputs?.[0];
    if (!descriptor || descriptor.sha256 !== digest(data) || descriptor.bytes !== data.length) fail(503, 'publishing_output_corrupt');
    return { data, mime: 'video/mp4', title: source.row.title, sha256: descriptor.sha256, bytes: data.length };
  });
}
