/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Creative Studio 1.5.2 owner-scoped story library, story job ledger, next-story dispatch, and custom/library story production routes backed by real package API endpoints.
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { exact, uuid, text, fail, identity, ownerKey } from './vendor/source-project-store.mjs';
import {
  buildStoryboardScenes,
  decorateLibrary,
  findLibraryStory,
  normalizeSceneCount,
  normalizeShape,
  shapeToOrientation,
} from './story-library.mjs';

const APP = 'creative-studio';
const PREFIX = 'story_source';
const VIDS_BOT_AGENT_ID = 'b00e0000-0000-0000-0000-000000000001';
const NO_WORKER_MSG = 'No Vids worker is online right now — connect a worker or save/edit your story script below.';
const FORBIDDEN_SCOPE_KEYS = ['tenant', 'tenantId', 'owner', 'ownerSub', 'ownerKey', 'userSub', 'principalId', 'issuer', 'workspace'];
const requireCjs = createRequire(import.meta.url);
const iso = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString(); };

function checkScopeSpoof(req) {
  for (const key of FORBIDDEN_SCOPE_KEYS) {
    if (req.query?.[key] !== undefined) fail(400, 'source_personal_scope_only');
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && req.body[key] !== undefined) {
      fail(400, 'source_personal_scope_only');
    }
  }
  if (req.headers?.['x-oshal-tenant-id'] !== undefined || req.headers?.['x-tenant-id'] !== undefined) {
    fail(400, 'source_personal_scope_only');
  }
}

export async function authorizeStoryAction(ctx, mode, expected) {
  if (!['read', 'execute'].includes(mode)) fail(403, 'story_permission_denied');
  if (JSON.stringify(identity(ctx)) !== JSON.stringify(expected)) fail(403, 'source_actor_changed');
  const authority = await ctx.intent('auth.application', {});
  const p = authority?.principal;
  if (authority?.app !== APP || !p || String(p.id) !== expected.principalId || p.issuer !== expected.issuer || p.subject !== expected.sub || p.tenant !== expected.tenant || p.state !== 'active') {
    fail(403, 'story_permission_denied');
  }
  const perms = ['app.open', mode === 'execute' ? 'legacy.execute' : 'legacy.read'];
  for (const permission of perms) {
    if ((await ctx.authorization?.authorize?.({ permission }))?.allowed !== true) fail(403, 'story_permission_denied');
  }
  if (JSON.stringify(identity(ctx)) !== JSON.stringify(expected)) fail(403, 'source_actor_changed');
}

async function storyTx(ctx, mode, write, fn) {
  const original = identity(ctx);
  const owner = ownerKey(original);
  await authorizeStoryAction(ctx, mode, original);
  const c = await ctx.pool.connect();
  let begun = false;
  try {
    await c.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
    begun = true;
    await c.query("SET LOCAL statement_timeout='5s'");
    await c.query("SET LOCAL lock_timeout='2s'");
    await c.query(`SELECT set_config('${PREFIX}.owner_key',$1,true)`, [owner]);
    if (write) await c.query('SELECT pg_advisory_xact_lock($1::bigint)', [BigInt('0x' + owner.slice(0, 15)).toString()]);
    const out = await fn(c, owner, original);
    await authorizeStoryAction(ctx, mode, original);
    await c.query('COMMIT');
    begun = false;
    return out;
  } catch (error) {
    if (begun) await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}

function getWorkerRegistry(ctx) {
  if (ctx?.vidsWorkerRegistry) return ctx.vidsWorkerRegistry;
  try {
    const mod = requireCjs('@/app/routes/remote-client-routes');
    return mod?.remoteClientRegistry || null;
  } catch {
    return null;
  }
}

function isVidsWorker(client) {
  const caps = Array.isArray(client?.capabilities) ? client.capabilities : [];
  const tags = Array.isArray(client?.tags) ? client.tags : [];
  return caps.includes('vids.generate') || caps.includes('content.next') || caps.includes('content.produce') || tags.includes('vids') || tags.includes('creative');
}

export function listVidsWorkers(ctx) {
  const registry = getWorkerRegistry(ctx);
  if (!registry || typeof registry.listClients !== 'function') return [];
  try {
    return registry.listClients().filter(isVidsWorker);
  } catch {
    return [];
  }
}

function pickOnlineWorker(ctx) {
  const workers = listVidsWorkers(ctx);
  if (!workers.length) return null;
  return workers.find(w => w.status === 'online' || w.healthy) || workers[0];
}

function jobView(row) {
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    storySlug: row.story_slug ?? null,
    title: row.title,
    script: row.script,
    sceneCount: Number(row.scene_count),
    shape: row.shape,
    orientation: shapeToOrientation(row.shape),
    status: row.status,
    workerId: row.worker_id ?? null,
    detail: row.detail || '',
    source: 'creative-studio',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function vidsJobView(row) {
  const shape = row.orientation === 'Portrait' ? '9:16' : row.orientation === 'Square' ? '1:1' : '16:9';
  return {
    id: String(row.job_id),
    projectId: null,
    storySlug: null,
    title: String(row.idea || 'Untitled story').replace(/^story:\s*/i, ''),
    script: '',
    sceneCount: 10,
    shape,
    orientation: row.orientation || 'Landscape',
    status: String(row.status || 'queued'),
    workerId: row.client_id ?? null,
    detail: 'Vids story ledger',
    source: 'vids',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function readOptionalVidsStoryJobs(ctx, userSub, limit) {
  if (!ctx?.pool?.query || !userSub) return [];
  try {
    const res = await ctx.pool.query(
      "SELECT job_id, status, idea, orientation, client_id, created_at, updated_at FROM vids_jobs WHERE user_sub = $1 AND insert_mode = 'story' ORDER BY updated_at DESC, job_id LIMIT $2",
      [userSub, limit],
    );
    return (res?.rows || []).map(vidsJobView);
  } catch {
    return [];
  }
}

export async function listStoryJobs(ctx, rawLimit) {
  const parsed = rawLimit === undefined || rawLimit === '' ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) fail(400, 'invalid_jobs_limit');
  const { local, original } = await storyTx(ctx, 'read', false, async (c, owner, actor) => {
    const rows = (await c.query('SELECT * FROM story_production_jobs WHERE owner_key=$1 ORDER BY created_at DESC, id LIMIT $2', [owner, parsed])).rows;
    return { local: rows.map(jobView), original: actor };
  });
  const vids = await readOptionalVidsStoryJobs(ctx, original.sub, parsed);
  const jobs = [...local, ...vids].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, parsed);
  const workers = listVidsWorkers(ctx);
  return { jobs, workerOnline: workers.length > 0, workerCount: workers.length };
}

export async function getStoryLibrary(ctx) {
  const { jobs, workerOnline, workerCount } = await listStoryJobs(ctx, 100);
  const { stories, nextStory } = decorateLibrary(jobs);
  return { stories, nextStory, workerOnline, workerCount };
}

async function createOptionalSourceProject(ctx, makeStore, spec) {
  try {
    if ((await ctx.authorization?.authorize?.({ permission: 'source.create' }))?.allowed !== true) return null;
    const store = makeStore(ctx);
    const created = await store.create({
      requestKey: randomUUID(),
      model: {
        version: 1,
        kind: 'story',
        title: spec.title.slice(0, 120),
        notes: spec.script.slice(0, 2000),
        sourceUrl: '',
        mode: 'episode',
        aspectRatio: spec.shape,
        scenes: buildStoryboardScenes(spec.title, spec.script, spec.sceneCount),
      },
    });
    return created?.project || null;
  } catch {
    return null;
  }
}

async function dispatchToWorker(ctx, worker, userSub, toolName, spec) {
  const registry = getWorkerRegistry(ctx);
  if (!worker || !registry || typeof registry.enqueueTask !== 'function') return null;
  const args = {
    ...(spec.storySlug ? { storyId: spec.storySlug } : { title: spec.title, script: spec.script }),
    beats: spec.sceneCount,
    orientation: shapeToOrientation(spec.shape),
  };
  const task = await registry.enqueueTask(worker.clientId, {
    taskId: randomUUID(),
    correlationId: randomUUID(),
    fromAgentId: VIDS_BOT_AGENT_ID,
    toAgentId: worker.agentId ?? worker.clientId,
    userSub,
    intent: 'mcp.call-tool',
    input: { name: toolName, arguments: args },
    createdAt: new Date().toISOString(),
  });
  return task?.taskId || randomUUID();
}

async function insertStoryJob(ctx, spec, { projectId, status, workerId, detail }) {
  return storyTx(ctx, 'execute', true, async (c, owner, original) => {
    const nowIso = new Date().toISOString();
    const row = (await c.query(
      `INSERT INTO story_production_jobs(id,owner_key,owner_issuer,owner_sub,project_id,story_slug,title,script,scene_count,shape,status,worker_id,detail,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
      [randomUUID(), owner, original.issuer, original.sub, projectId, spec.storySlug, spec.title, spec.script, spec.sceneCount, spec.shape, status, workerId, detail, nowIso],
    )).rows[0];
    return jobView(row);
  });
}

export async function produceNextStory(ctx, makeStore, rawBody) {
  const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
  exact(body, [], ['sceneCount', 'beats', 'shape', 'orientation', 'recordOnly']);
  if (body.recordOnly !== undefined && typeof body.recordOnly !== 'boolean') fail(400, 'source_invalid_input');
  const original = identity(ctx);
  await authorizeStoryAction(ctx, 'execute', original);
  const { nextStory } = await getStoryLibrary(ctx);
  if (!nextStory) fail(500, 'story_library_empty');
  const sceneCount = normalizeSceneCount(body.sceneCount ?? body.beats, nextStory.sceneCount);
  const shape = normalizeShape(body.shape ?? body.orientation, nextStory.defaultShape);
  const worker = pickOnlineWorker(ctx);
  if (!worker && body.recordOnly !== true) {
    return {
      status: 503,
      body: {
        error: 'worker_unavailable',
        message: NO_WORKER_MSG,
        workerOnline: false,
        nextStory: { id: nextStory.id, slug: nextStory.slug, title: nextStory.title, sceneCount, shape },
      },
    };
  }
  const spec = { storySlug: nextStory.slug, title: nextStory.title, script: nextStory.script, sceneCount, shape };
  const project = await createOptionalSourceProject(ctx, makeStore, spec);
  const taskId = worker ? await dispatchToWorker(ctx, worker, original.sub, 'content.next', spec) : null;
  const status = worker ? 'queued' : 'draft_recorded';
  const detail = worker ? `Queued on ${worker.clientId}${taskId ? ` (${taskId.slice(0, 8)})` : ''}` : 'Recorded storyboard draft';
  const job = await insertStoryJob(ctx, spec, { projectId: project?.id ?? null, status, workerId: worker?.clientId ?? null, detail });
  return {
    status: 201,
    body: {
      ok: true,
      status,
      workerOnline: Boolean(worker),
      job,
      project,
      message: worker ? `Queued "${spec.title}" (${sceneCount} scenes, ${shape}) on the Vids worker.` : `Recorded "${spec.title}" (${sceneCount} scenes, ${shape}) in Recorded work.`,
    },
  };
}

function resolveProduceSpec(body) {
  exact(body, [], ['story', 'storyId', 'storyName', 'title', 'script', 'sceneCount', 'beats', 'shape', 'orientation']);
  const libraryRef = body.story ?? body.storyId ?? body.storyName;
  if (libraryRef !== undefined && libraryRef !== null && libraryRef !== '') {
    if (typeof libraryRef !== 'string') fail(400, 'story_not_found');
    const found = findLibraryStory(libraryRef);
    if (!found) fail(400, 'story_not_found');
    return {
      storySlug: found.slug,
      title: found.title,
      script: found.script,
      sceneCount: normalizeSceneCount(body.sceneCount ?? body.beats, found.sceneCount),
      shape: normalizeShape(body.shape ?? body.orientation, found.defaultShape),
    };
  }
  const hasTitle = typeof body.title === 'string' && body.title.trim().length > 0;
  const hasScript = typeof body.script === 'string' && body.script.trim().length > 0;
  if (!hasTitle || !hasScript) fail(400, 'story_title_and_script_required');
  return {
    storySlug: null,
    title: text(body.title.trim(), 120),
    script: text(body.script.trim(), 4000),
    sceneCount: normalizeSceneCount(body.sceneCount ?? body.beats, 4),
    shape: normalizeShape(body.shape ?? body.orientation, '16:9'),
  };
}

export async function produceStory(ctx, makeStore, rawBody) {
  const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
  const original = identity(ctx);
  await authorizeStoryAction(ctx, 'execute', original);
  const spec = resolveProduceSpec(body);
  const worker = pickOnlineWorker(ctx);
  const project = await createOptionalSourceProject(ctx, makeStore, spec);
  const taskId = worker ? await dispatchToWorker(ctx, worker, original.sub, 'content.produce', spec) : null;
  const status = worker ? 'queued' : 'awaiting_worker';
  const detail = worker ? `Queued on ${worker.clientId}${taskId ? ` (${taskId.slice(0, 8)})` : ''}` : 'Saved storyboard; awaiting Vids worker';
  const job = await insertStoryJob(ctx, spec, { projectId: project?.id ?? null, status, workerId: worker?.clientId ?? null, detail });
  const message = worker
    ? `Queued "${spec.title}" (${spec.sceneCount} scenes, ${spec.shape}) on the Vids worker.`
    : `Saved "${spec.title}" (${spec.sceneCount} scenes, ${spec.shape}). ${NO_WORKER_MSG}`;
  return { status: 201, body: { ok: true, status, workerOnline: Boolean(worker), job, project, message } };
}

export async function deleteStoryJob(ctx, id) {
  const jid = uuid(id);
  return storyTx(ctx, 'execute', true, async (c, owner) => {
    const row = (await c.query('DELETE FROM story_production_jobs WHERE owner_key=$1 AND id=$2 RETURNING id', [owner, jid])).rows[0];
    if (!row) fail(404, 'story_job_missing');
    return { deleted: true, id: row.id };
  });
}

export function mountStoryProductionRoutes(r, parse, ctx, makeStore, sendModule) {
  r.use('/stories', (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const wrap = fn => async (req, res) => {
    try {
      checkScopeSpoof(req);
      await fn(req, res);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.status ? error.code || error.message : 'story_production_unavailable' });
    }
  };
  r.get('/creative-studio-stories.mjs', sendModule('tools/creative-studio-stories.mjs'));
  r.get('/stories/library', wrap(async (_req, res) => res.json(await getStoryLibrary(ctx))));
  r.get('/stories/jobs', wrap(async (req, res) => res.json(await listStoryJobs(ctx, req.query?.limit))));
  r.post('/stories/next', parse, wrap(async (req, res) => {
    const out = await produceNextStory(ctx, makeStore, req.body);
    res.status(out.status).json(out.body);
  }));
  r.post('/stories/produce', parse, wrap(async (req, res) => {
    const out = await produceStory(ctx, makeStore, req.body);
    res.status(out.status).json(out.body);
  }));
  r.delete('/stories/jobs/:id', wrap(async (req, res) => res.json(await deleteStoryJob(ctx, req.params.id))));
}
