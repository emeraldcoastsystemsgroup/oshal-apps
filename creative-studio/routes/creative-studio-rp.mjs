/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Owner-scoped Creative Studio 1.5.0 routes: starter brief templates (RP-CRS-01), rendered storyboard builds kept in package storage and downloaded from the page (RP-CRS-02/03/04), approval-gated publication schedules (RP-CRS-05) and brief/scene comments with one reply level and resolve (RP-CRS-06). Every read and write runs inside the source store's exact-owner transaction with explicit ISO timestamps and flat parameterized SQL for PostgreSQL and native SQLite parity.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exact, uuid, text, fail } from './vendor/source-project-store.mjs';
import { STORY_TEMPLATES } from './source-model.mjs';
import { buildPlan, renderStoryboard } from './storyboard-render.mjs';

export const CHANNELS = Object.freeze(['youtube', 'instagram', 'tiktok', 'linkedin', 'x']);
const KEEP_BUILDS = 4, MAX_COMMENTS = 128, MAX_SCHEDULES = 64, YEAR_MS = 366 * 86400000;
const iso = value => new Date(value).toISOString();
const optionalId = value => value == null || value === '' ? null : uuid(value);

function commentView(row) {
  return { id: row.id, projectId: row.project_id, sceneId: row.scene_id ?? null, parentId: row.parent_id ?? null, body: row.body, resolved: Boolean(row.resolved), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function scheduleView(row) {
  return { id: row.id, projectId: row.project_id, buildId: row.build_id, channel: row.channel, caption: row.caption, postNow: Boolean(row.post_now), scheduledFor: iso(row.scheduled_for), status: row.status, approvedAt: iso(row.approved_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function buildView(row) {
  return {
    id: row.id, projectId: row.project_id, revision: Number(row.revision), aspectRatio: row.aspect_ratio, width: Number(row.width), height: Number(row.height),
    durationSeconds: Number(row.duration_seconds), sceneCount: Number(row.scene_count), branded: Boolean(row.branded), bytes: Number(row.byte_length), sha256: row.sha256,
    title: row.title, createdAt: iso(row.created_at), downloadUrl: `/api/creative-studio/source-projects/${row.project_id}/builds/${row.id}/video.mp4`,
  };
}

/** @description Starter briefs a person opens as a new, editable, unsaved brief. */
export async function listTemplates(store) {
  await store.guard('read');
  return { templates: STORY_TEMPLATES };
}

export async function listComments(store, projectId) {
  const pid = uuid(projectId);
  return store.tx('read', false, async (c, [owner]) => {
    await store.row(c, [owner], pid);
    const rows = (await c.query('SELECT * FROM story_source_comments WHERE owner_key=$1 AND project_id=$2 ORDER BY created_at, id LIMIT 128', [owner, pid])).rows;
    return { comments: rows.map(commentView) };
  });
}

async function checkParent(c, owner, pid, parentId) {
  const parent = (await c.query('SELECT parent_id FROM story_source_comments WHERE owner_key=$1 AND project_id=$2 AND id=$3', [owner, pid, parentId])).rows[0];
  if (!parent) fail(404, 'comment_parent_missing');
  if (parent.parent_id) fail(400, 'comment_reply_depth');
}

export async function createComment(store, projectId, input) {
  const pid = uuid(projectId);
  exact(input, ['body'], ['sceneId', 'parentId']);
  const body = text(input.body, 1000).trim(), sceneId = optionalId(input.sceneId), parentId = optionalId(input.parentId);
  return store.tx('change', true, async (c, [owner]) => {
    const project = await store.row(c, [owner], pid);
    if (sceneId && !project.model.scenes.some(scene => scene.id === sceneId)) fail(404, 'source_scene_missing');
    if (parentId) await checkParent(c, owner, pid, parentId);
    const count = Number((await c.query('SELECT count(*)::int AS n FROM story_source_comments WHERE owner_key=$1 AND project_id=$2', [owner, pid])).rows[0].n);
    if (count >= MAX_COMMENTS) fail(413, 'comment_limit');
    const nowIso = new Date().toISOString();
    const row = (await c.query(
      `INSERT INTO story_source_comments(id,project_id,owner_key,owner_issuer,owner_sub,scene_id,parent_id,author_label,body,resolved,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'owner',$8,false,$9,$9) RETURNING *`,
      [randomUUID(), pid, owner, store.original.issuer, store.original.sub, sceneId, parentId, body, nowIso])).rows[0];
    return { comment: commentView(row) };
  });
}

export async function resolveComment(store, projectId, commentId, input) {
  const pid = uuid(projectId), cid = uuid(commentId);
  exact(input, ['resolved']);
  if (typeof input.resolved !== 'boolean') fail(400, 'source_invalid_input');
  return store.tx('change', true, async (c, [owner]) => {
    await store.row(c, [owner], pid);
    const row = (await c.query('UPDATE story_source_comments SET resolved=$4,updated_at=$5 WHERE owner_key=$1 AND project_id=$2 AND id=$3 RETURNING *', [owner, pid, cid, input.resolved, new Date().toISOString()])).rows[0];
    if (!row) fail(404, 'comment_missing');
    return { comment: commentView(row) };
  });
}

/** @description Where this owner's rendered builds live: package storage, never the read-only package tree. */
export function buildDirectory(store) {
  return join(process.env.OSHAL_PACKAGE_DATA_DIR || join(tmpdir(), 'creative-studio-dev'), 'storyboard-builds', store.owner.slice(0, 40));
}

export async function listBuilds(store, projectId) {
  const pid = uuid(projectId);
  return store.tx('read', false, async (c, [owner]) => {
    await store.row(c, [owner], pid);
    const rows = (await c.query('SELECT * FROM story_source_builds WHERE owner_key=$1 AND project_id=$2 ORDER BY created_at DESC, id LIMIT 8', [owner, pid])).rows;
    return { builds: rows.map(buildView) };
  });
}

async function pruneOldBuilds(c, owner, projectId) {
  const all = (await c.query('SELECT id FROM story_source_builds WHERE owner_key=$1 AND project_id=$2 ORDER BY created_at DESC, id', [owner, projectId])).rows;
  if (all.length <= KEEP_BUILDS) return [];
  const pinned = new Set((await c.query("SELECT build_id FROM story_source_schedules WHERE owner_key=$1 AND project_id=$2 AND status='scheduled'", [owner, projectId])).rows.map(r => r.build_id));
  const stale = [];
  for (const item of all.slice(KEEP_BUILDS)) {
    if (pinned.has(item.id)) continue;
    await c.query('DELETE FROM story_source_builds WHERE owner_key=$1 AND project_id=$2 AND id=$3', [owner, projectId, item.id]);
    stale.push(item.id);
  }
  return stale;
}

async function recordBuild(store, project, plan, id, bytes, sha256) {
  return store.tx('change', true, async (c, [owner]) => {
    const current = await store.row(c, [owner], project.id);
    if (current.revision !== project.revision) fail(409, 'source_revision_conflict');
    const nowIso = new Date().toISOString();
    const row = (await c.query(
      `INSERT INTO story_source_builds(id,project_id,owner_key,owner_issuer,owner_sub,revision,aspect_ratio,width,height,duration_seconds,scene_count,branded,byte_length,sha256,title,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [id, project.id, owner, store.original.issuer, store.original.sub, project.revision, plan.aspectRatio, plan.width, plan.height, plan.seconds, plan.scenes.length, plan.branded, bytes.length, sha256, project.title, nowIso])).rows[0];
    const stale = await pruneOldBuilds(c, owner, project.id);
    return { build: buildView(row), stale };
  });
}

/** @description Render the project's current saved revision, keep the file in package storage, and record it. */
export async function createBuild(store, projectId) {
  const pid = uuid(projectId);
  const project = await store.tx('read', false, (c, o) => store.row(c, o, pid));
  const plan = buildPlan(project.model), bytes = await renderStoryboard(plan);
  const id = randomUUID(), sha256 = createHash('sha256').update(bytes).digest('hex'), dir = buildDirectory(store);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, `${id}.mp4`), bytes, { mode: 0o600 });
  let result;
  try { result = await recordBuild(store, project, plan, id, bytes, sha256); }
  catch (error) { await rm(join(dir, `${id}.mp4`), { force: true }); throw error; }
  for (const old of result.stale) await rm(join(dir, `${old}.mp4`), { force: true }).catch(() => {});
  return { build: result.build };
}

function fileName(title, aspectRatio) {
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'storyboard';
  return `${slug}-${aspectRatio.replace(':', 'x')}.mp4`;
}

/** @description Stream one recorded build after checking its length and SHA-256 against the ledger. */
export async function sendBuild(store, res, projectId, buildId) {
  const pid = uuid(projectId), bid = uuid(buildId);
  const row = await store.tx('read', false, async (c, [owner]) => {
    await store.row(c, [owner], pid);
    const found = (await c.query('SELECT * FROM story_source_builds WHERE owner_key=$1 AND project_id=$2 AND id=$3', [owner, pid, bid])).rows[0];
    if (!found) fail(404, 'build_missing');
    return found;
  });
  const bytes = await readFile(join(buildDirectory(store), `${bid}.mp4`)).catch(() => fail(410, 'build_file_missing'));
  if (bytes.length !== Number(row.byte_length) || createHash('sha256').update(bytes).digest('hex') !== row.sha256) fail(410, 'build_file_changed');
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="${fileName(row.title, row.aspect_ratio)}"` });
  res.status(200).end(bytes);
}

export async function listSchedules(store) {
  return store.tx('read', false, async (c, [owner]) => {
    const rows = (await c.query('SELECT * FROM story_source_schedules WHERE owner_key=$1 ORDER BY scheduled_for, id LIMIT 64', [owner])).rows;
    return { schedules: rows.map(scheduleView) };
  });
}

function scheduleTime(input) {
  if (input.postNow === true) return new Date();
  const at = Date.parse(String(input.scheduledFor ?? ''));
  if (!Number.isFinite(at)) fail(400, 'schedule_invalid_time');
  if (at < Date.now() - 60000 || at > Date.now() + YEAR_MS) fail(400, 'schedule_time_out_of_range');
  return new Date(at);
}

/** @description Record an approved plan to post a finished build; nothing is recorded without the explicit approval. */
export async function createSchedule(store, input) {
  exact(input, ['projectId', 'buildId', 'channel', 'approved'], ['caption', 'scheduledFor', 'postNow']);
  if (input.approved !== true) fail(400, 'schedule_approval_required');
  if (!CHANNELS.includes(input.channel)) fail(400, 'schedule_invalid_channel');
  if (input.postNow !== undefined && typeof input.postNow !== 'boolean') fail(400, 'source_invalid_input');
  const pid = uuid(input.projectId), bid = uuid(input.buildId), when = scheduleTime(input);
  const caption = input.caption === undefined ? '' : text(input.caption, 1000, { empty: true });
  return store.tx('change', true, async (c, [owner]) => {
    await store.row(c, [owner], pid);
    if (!(await c.query('SELECT id FROM story_source_builds WHERE owner_key=$1 AND project_id=$2 AND id=$3', [owner, pid, bid])).rows.length) fail(404, 'build_missing');
    const active = Number((await c.query("SELECT count(*)::int AS n FROM story_source_schedules WHERE owner_key=$1 AND status='scheduled'", [owner])).rows[0].n);
    if (active >= MAX_SCHEDULES) fail(413, 'schedule_limit');
    const nowIso = new Date().toISOString();
    const row = (await c.query(
      `INSERT INTO story_source_schedules(id,project_id,build_id,owner_key,owner_issuer,owner_sub,channel,caption,post_now,scheduled_for,status,approved_by,approved_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'scheduled','owner',$11,$11,$11) RETURNING *`,
      [randomUUID(), pid, bid, owner, store.original.issuer, store.original.sub, input.channel, caption, input.postNow === true, when.toISOString(), nowIso])).rows[0];
    return { schedule: scheduleView(row) };
  });
}

export async function cancelSchedule(store, scheduleId) {
  const sid = uuid(scheduleId);
  return store.tx('change', true, async (c, [owner]) => {
    const row = (await c.query("UPDATE story_source_schedules SET status='cancelled',updated_at=$3 WHERE owner_key=$1 AND id=$2 AND status='scheduled' RETURNING *", [owner, sid, new Date().toISOString()])).rows[0];
    if (!row) fail(404, 'schedule_missing');
    return { schedule: scheduleView(row) };
  });
}

/** @description Remove child rows and stored MP4 files before deleting a project on both PostgreSQL and native SQLite. */
export async function purgeProjectStudioRows(store, projectId) {
  const pid = uuid(projectId);
  const buildIds = await store.tx('delete', true, async (c, [owner]) => {
    await store.row(c, [owner], pid);
    const builds = (await c.query('SELECT id FROM story_source_builds WHERE owner_key=$1 AND project_id=$2', [owner, pid])).rows.map(r => r.id);
    await c.query('DELETE FROM story_source_schedules WHERE owner_key=$1 AND project_id=$2', [owner, pid]);
    await c.query('DELETE FROM story_source_comments WHERE owner_key=$1 AND project_id=$2', [owner, pid]);
    await c.query('DELETE FROM story_source_builds WHERE owner_key=$1 AND project_id=$2', [owner, pid]);
    return builds;
  });
  const dir = buildDirectory(store);
  for (const bid of buildIds) await rm(join(dir, `${bid}.mp4`), { force: true }).catch(() => {});
}

/** @description Mount the 1.5.0 routes on the source router; call before the /source-projects/:id routes so templates is not read as an ID. */
export function mountStudioRoutes(r, parse, run, sendModule) {
  r.get('/creative-studio-rp.mjs', sendModule('tools/creative-studio-rp.mjs'));
  r.get('/source-projects/templates', run(async (_q, res, store) => res.json(await listTemplates(store))));
  r.get('/source-projects/:id/comments', run(async (req, res, store) => res.json(await listComments(store, req.params.id))));
  r.post('/source-projects/:id/comments', parse, run(async (req, res, store) => res.status(201).json(await createComment(store, req.params.id, req.body))));
  r.post('/source-projects/:id/comments/:commentId/resolve', parse, run(async (req, res, store) => res.json(await resolveComment(store, req.params.id, req.params.commentId, req.body))));
  r.get('/source-projects/:id/builds', run(async (req, res, store) => res.json(await listBuilds(store, req.params.id))));
  r.post('/source-projects/:id/builds', parse, run(async (req, res, store) => { exact(req.body ?? {}, []); res.status(201).json(await createBuild(store, req.params.id)); }));
  r.get('/source-projects/:id/builds/:buildId/video.mp4', run(async (req, res, store) => sendBuild(store, res, req.params.id, req.params.buildId)));
  r.get('/schedules', run(async (_q, res, store) => res.json(await listSchedules(store))));
  r.post('/schedules', parse, run(async (req, res, store) => res.status(201).json(await createSchedule(store, req.body))));
  r.post('/schedules/:scheduleId/cancel', parse, run(async (req, res, store) => res.json(await cancelSchedule(store, req.params.scheduleId))));
}
