/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Await durable task enqueue and terminal-result reads so persisted jobs use authoritative task state instead of Promise objects.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Fail persisted jobs when durable enqueue rejects and serialize asynchronous result polling to prevent duplicate settlement.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Bind every browser/service request and deferred settlement to the exact job owner, scope listings by user_sub, and persist/return only sanitized terminal state.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Preserve the generated surface's shared theme integration and phone-width job-table layout in the authoritative TypeScript source.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Bound dispatch fields and HTML-escape every database-derived job cell to close stored-script injection through legacy or crafted queue rows.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Mount private finished-export and explicit publication controls behind the existing exact-owner authentication rail.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Add console controls for attaching, previewing, publishing, revoking and removing finished MP4 exports with explicit confirmation.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | The family audience view for the Home shell (ADR-164 D6): with ?audience=family the surface loads the shared kit right after the theme bootstrap and paints the signed-in account's own saved videos (waiting or being made, finished in the last five days, not finished, whether the video maker is connected, the newest eight with where each one stands; a finished video whose export is attached opens its private preview in a new tab) from GET /jobs, /home-summary and a finished job's artifact record only. The inline start (control bindings, the job-list read, the four-second poll) and the module script (handoff listener, connected-actions section and offer) run only when no audience view renders, so the view never dispatches a job and never attaches, publishes, revokes or removes an export. The block holds no backtick, dollar-brace or backslash, so the template literal serves it byte for byte.
 */
/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-26          | maintainer@emeraldcoastsystemsgroup.com | Vids Studio routes (activation step from
 *   packages/oshal-vids-operator/DEPLOY.md §3). POST/GET /api/vids/jobs dispatch a
 *   generate-job to a REGISTERED remote Vids worker (the screen-driving operator)
 *   via the shared remoteClientRegistry — the same mesh the worker polls — and
 *   persist a row in vids_jobs (migration 059). GET /api/vids/app serves the
 *   embedded job-queue surface for the cockpit tile. Mounted WITHOUT requiresAuth
 *   (loopback/internal, mirrors /api/world) so the in-container vids_generate CLI
 *   tool (scripts/oshal-vids.js) can reach it.
 * 2026-07-05 13:29:28 | roger.murphy@emeraldcoastsystemsgroup.com   | SECURITY: router is now mounted behind serviceSecretOr(requiresAuth) in server.ts — the earlier unguarded loopback mount left /api/vids anonymous-callable through the public tunnel
 * 2026-07-19 22:20:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the vids app package (ADR-085 Wave 3, "skill with a surface"). Standard (ctx) factory unchanged; the remote-client registry (the mesh the SHARED vids-operator desktop worker polls — framework-resident per ADR-093) now imports via the @/ alias. The manifest mounts the same /api/vids with auth: service-or-oidc (what core server.ts mounted), so the in-container vids_generate / creative_* CLI tools keep reaching it with X-Service-Secret. The vids_jobs schema ships as a migrations/ COPY of kernel 059 for fresh installs.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.watchTask = watchTask;
exports.createVidsRoutes = createVidsRoutes;
const express_1 = require("express");
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const remote_client_routes_1 = require("@/app/routes/remote-client-routes");
const authz_1 = require("@/shared/middleware/authz");
const trusted_service_user_identity_1 = require("@/shared/middleware/trusted-service-user-identity");
const request_identity_1 = require("@/shared/services/database/request-identity");
const vids_publish_routes_1 = require("./vids-publish-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'vids-routes' });
// The Veo-specialist bot seeded by migration 059 — the `fromAgentId` on dispatched tasks.
const VIDS_BOT_AGENT_ID = 'b00e0000-0000-0000-0000-000000000001';
const VIDS_ORIENTATIONS = new Set(['Landscape', 'Portrait', 'Square']);
const VIDS_INSERT_MODES = new Set(['Insert', 'Extend', 'none']);
const VIDS_STATUSES = new Set(['queued', 'running', 'done', 'failed']);
/** True if a remote client advertises the Vids tools (by capability or tag). */
function isVidsWorker(c) {
    const caps = Array.isArray(c.capabilities) ? c.capabilities : [];
    const tags = Array.isArray(c.tags) ? c.tags : [];
    return caps.includes('vids.generate') || caps.includes('content.next') || caps.includes('content.produce') || tags.includes('vids') || tags.includes('creative');
}
/** Pick a registered Vids worker, preferring an online/healthy one. */
function findVidsWorker() {
    const candidates = remote_client_routes_1.remoteClientRegistry.listClients().filter(isVidsWorker);
    if (candidates.length === 0)
        return null;
    const online = candidates.find((c) => c.status === 'online' || c.healthy);
    return (online ?? candidates[0]);
}
function callerSub(req) {
    // An independently authenticated browser/PAT principal stays authoritative when both
    // credential classes are present. The service header is accepted only behind the exact fleet
    // secret and is narrowed to non-operator DB identity by requireTrustedServiceUserIdentity.
    return (0, authz_1.getCaller)(req).sub ?? (0, authz_1.getTrustedServiceUserSub)(req);
}
/**
 * Poll the in-process registry for the worker's completion and persist it to the
 * vids_jobs row. The worker posts /complete back to the same registry; this is the
 * direct-enqueuer pull path (getCompletedResult), no loopback HTTP.
 */
function watchTask(ctx, clientId, taskId, jobId, userSub) {
    let ticks = 0;
    let polling = false;
    let settled = false;
    const timer = setInterval(() => {
        if (polling || settled)
            return;
        polling = true;
        void (async () => {
            ticks += 1;
            try {
                const result = await remote_client_routes_1.remoteClientRegistry.getCompletedResult(clientId, taskId);
                if (result) {
                    settled = true;
                    clearInterval(timer);
                    const ok = result.status === 'completed';
                    const output = result.output && typeof result.output === 'object'
                        ? result.output
                        : {};
                    const finalPrompt = typeof output.finalPrompt === 'string'
                        ? output.finalPrompt.slice(0, 10_000)
                        : null;
                    const terminalStatus = ok ? 'completed' : 'failed';
                    await (0, request_identity_1.runWithRequestIdentity)({ sub: userSub, isOperator: false }, () => ctx.pool.query(`UPDATE vids_jobs
               SET status = $2,
                   final_prompt = COALESCE($3, final_prompt),
                   client_id = $4,
                   outcome = outcome || $5::jsonb,
                   updated_at = now()
             WHERE job_id = $1 AND user_sub = $6`, [
                        jobId,
                        ok ? 'done' : 'failed',
                        finalPrompt,
                        clientId,
                        JSON.stringify({ result: { status: terminalStatus } }),
                        userSub,
                    ]));
                    logger.info({ jobId, taskId, status: terminalStatus }, 'Vids job settled');
                    return;
                }
                if (ticks === 1) {
                    await (0, request_identity_1.runWithRequestIdentity)({ sub: userSub, isOperator: false }, () => ctx.pool.query(`UPDATE vids_jobs
                SET status = 'running', updated_at = now()
              WHERE job_id = $1 AND user_sub = $2 AND status = 'queued'`, [jobId, userSub]));
                }
            }
            catch (err) {
                const errorType = err instanceof Error ? err.name : 'UnknownError';
                logger.warn({ errorType, jobId }, 'Vids job watch error');
            }
            finally {
                polling = false;
            }
            if (ticks > 360)
                clearInterval(timer); // ~30 min ceiling at 5s
        })();
    }, 5000);
    if (typeof timer.unref === 'function')
        timer.unref();
}
/**
 * @description Durably enqueue one Vids tool call and fail the already-created job row if the
 * remote journal rejects it. Provider/registry errors remain in structured logs, never responses.
 */
async function enqueueVidsTask(ctx, worker, jobId, userSub, input, kind) {
    try {
        const task = await remote_client_routes_1.remoteClientRegistry.enqueueTask(worker.clientId, {
            taskId: (0, crypto_1.randomUUID)(),
            correlationId: (0, crypto_1.randomUUID)(),
            fromAgentId: VIDS_BOT_AGENT_ID,
            toAgentId: worker.agentId ?? worker.clientId,
            userSub,
            intent: 'mcp.call-tool',
            input,
            createdAt: new Date().toISOString(),
        });
        return task.taskId;
    }
    catch (err) {
        const errorType = err instanceof Error ? err.name : 'UnknownError';
        logger.warn({ errorType, jobId, clientId: worker.clientId, kind }, 'Vids task enqueue rejected');
        await ctx.pool.query(`UPDATE vids_jobs
          SET status = 'failed', outcome = outcome || $2::jsonb, updated_at = now()
        WHERE job_id = $1 AND user_sub = $3`, [jobId, JSON.stringify({ error: 'remote task enqueue rejected', kind }), userSub]);
        return null;
    }
}
/**
 * @description Vids Studio routes: dispatch generate-jobs to the remote screen-driving
 * worker and serve the embedded job-queue surface.
 */
function createVidsRoutes(ctx) {
    const router = (0, express_1.Router)();
    // Machine authentication proves the caller is an OSHAL process, not which user's rows it may
    // access. Require the separate exact subject and narrow the ambient DB identity before all route
    // work. An independently authenticated browser principal remains authoritative.
    router.use(trusted_service_user_identity_1.requireTrustedServiceUserIdentity);
    router.use('/jobs/:jobId/artifact', (0, vids_publish_routes_1.createVidsPublishRoutes)(ctx));
    // Brand Graphics uses the same durable worker and owner ledger as clips/stories.
    // Keep a distinct dispatch door so a brand request can never become a generic clip.
    router.post('/brand', async (req, res) => {
        const body = (req.body ?? {});
        if (body.confirm !== true) {
            res.status(428).json({ error: 'confirmation_required' });
            return;
        }
        const userSub = callerSub(req);
        if (!userSub) {
            res.status(401).json({ error: 'user_identity_required' });
            return;
        }
        const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
        const mode = body.brandMode ?? 'intro';
        if (!brief || brief.length > 2_000 || !['intro', 'graphic'].includes(String(mode))
            || ['voiceover', 'music'].some(key => body[key] !== undefined && typeof body[key] !== 'boolean')
            || ['voice', 'musicMood'].some(key => body[key] !== undefined && (typeof body[key] !== 'string' || String(body[key]).length > 100))) {
            res.status(400).json({ error: 'invalid_brand_brief' });
            return;
        }
        const worker = findVidsWorker();
        const jobId = (await ctx.pool.query(`INSERT INTO vids_jobs (user_sub, client_id, status, idea, insert_mode, outcome)
       VALUES ($1, $2, $3, $4, 'brand', $5::jsonb) RETURNING job_id`, [userSub, worker?.clientId ?? null, worker ? 'queued' : 'failed', brief, JSON.stringify({ kind: 'brand', brandMode: mode })])).rows[0].job_id;
        if (!worker) {
            res.status(503).json({ error: 'No Vids worker is registered.', job_id: jobId });
            return;
        }
        const tool = mode === 'graphic' ? 'brand.graphic' : 'brand.intro';
        const args = { brief, subject: brief };
        for (const key of ['voiceover', 'music', 'voice', 'musicMood'])
            if (body[key] !== undefined)
                args[key] = body[key];
        const taskId = await enqueueVidsTask(ctx, worker, jobId, userSub, { name: tool, arguments: args }, 'brand');
        if (!taskId) {
            res.status(503).json({ error: 'The worker could not accept the brand task.', job_id: jobId });
            return;
        }
        await ctx.pool.query(`UPDATE vids_jobs SET outcome = outcome || jsonb_build_object('taskId',$2::text,'tool',$3::text), updated_at=now()
       WHERE job_id=$1 AND user_sub=$4`, [jobId, taskId, tool, userSub]);
        watchTask(ctx, worker.clientId, taskId, jobId, userSub);
        res.json({ job_id: jobId, taskId, tool, status: 'queued' });
    });
    // POST /api/vids/jobs — enqueue a clip generate-job to the registered Vids worker.
    router.post('/jobs', async (req, res) => {
        const body = (req.body ?? {});
        const rawIdea = body.prompt ?? body.idea;
        const idea = typeof rawIdea === 'string' ? rawIdea.trim() : '';
        if (!idea) {
            res.status(400).json({ error: 'prompt is required' });
            return;
        }
        if (idea.length > 10_000) {
            res.status(400).json({ error: 'prompt is too long' });
            return;
        }
        const orientation = typeof body.orientation === 'string' && body.orientation
            ? body.orientation
            : null;
        const insertMode = typeof body.insertMode === 'string' && body.insertMode
            ? body.insertMode
            : null;
        const ingredient = typeof body.ingredient === 'string' && body.ingredient
            ? body.ingredient.trim()
            : null;
        if ((orientation && !VIDS_ORIENTATIONS.has(orientation))
            || (insertMode && !VIDS_INSERT_MODES.has(insertMode))
            || (ingredient && ingredient.length > 2_048)) {
            res.status(400).json({ error: 'invalid Vids job options' });
            return;
        }
        const worker = findVidsWorker();
        const userSub = callerSub(req);
        if (!userSub) {
            res.status(401).json({ error: 'user_identity_required' });
            return;
        }
        const inserted = (await ctx.pool.query(`INSERT INTO vids_jobs (user_sub, client_id, status, idea, orientation, insert_mode, ingredient)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING job_id`, [userSub, worker?.clientId ?? null, worker ? 'queued' : 'failed', idea, orientation, insertMode, ingredient])).rows[0];
        const jobId = inserted.job_id;
        if (!worker) {
            await ctx.pool.query(`UPDATE vids_jobs SET outcome = $2::jsonb, updated_at = now() WHERE job_id = $1 AND user_sub = $3`, [jobId, JSON.stringify({ error: 'no Vids worker registered' }), userSub]);
            res.status(503).json({
                error: 'No Vids worker is registered. Start one on a machine with a screen: `oshal-vids worker`.',
                job_id: jobId,
            });
            return;
        }
        const taskId = await enqueueVidsTask(ctx, worker, jobId, userSub, {
            name: 'vids.generate',
            arguments: {
                prompt: idea,
                orientation: orientation ?? undefined,
                insertMode: insertMode ?? undefined,
                ingredientPath: ingredient ?? undefined,
            },
        }, 'clip');
        if (!taskId) {
            res.status(503).json({ error: 'The Vids worker could not accept the task.', job_id: jobId });
            return;
        }
        await ctx.pool.query(`UPDATE vids_jobs SET outcome = jsonb_build_object('taskId', $2::text), updated_at = now()
        WHERE job_id = $1 AND user_sub = $3`, [jobId, taskId, userSub]);
        watchTask(ctx, worker.clientId, taskId, jobId, userSub);
        logger.info({ jobId, taskId, clientId: worker.clientId }, 'Vids job dispatched to worker');
        res.json({ job_id: jobId, taskId, clientId: worker.clientId, status: 'queued' });
    });
    // POST /api/vids/story — dispatch a multi-scene STORY (Extend chain) to the worker.
    // With storyId / {title,script} it produces that specific story (content.produce);
    // otherwise it produces the NEXT unproduced library story (content.next, the cycler).
    router.post('/story', async (req, res) => {
        const body = (req.body ?? {});
        const storyId = typeof body.storyId === 'string' && body.storyId ? body.storyId.trim() : null;
        const title = typeof body.title === 'string' && body.title ? body.title.trim() : null;
        const script = typeof body.script === 'string' && body.script ? body.script.trim() : null;
        const orientation = typeof body.orientation === 'string' && body.orientation ? body.orientation : null;
        const beats = body.beats != null ? Number(body.beats) : undefined;
        if ((storyId && storyId.length > 256)
            || (title && title.length > 1_000)
            || (script && script.length > 50_000)
            || (orientation && !VIDS_ORIENTATIONS.has(orientation))
            || (beats !== undefined && (!Number.isInteger(beats) || beats < 1 || beats > 100))) {
            res.status(400).json({ error: 'invalid Vids story options' });
            return;
        }
        const specific = storyId || (title && script);
        const toolName = specific ? 'content.produce' : 'content.next';
        const args = {};
        if (storyId)
            args.storyId = storyId;
        if (title)
            args.title = title;
        if (script)
            args.script = script;
        if (orientation)
            args.orientation = orientation;
        if (beats !== undefined && !Number.isNaN(beats))
            args.beats = beats;
        const label = storyId ?? title ?? 'next library story';
        const worker = findVidsWorker();
        const userSub = callerSub(req);
        if (!userSub) {
            res.status(401).json({ error: 'user_identity_required' });
            return;
        }
        const inserted = (await ctx.pool.query(`INSERT INTO vids_jobs (user_sub, client_id, status, idea, orientation, insert_mode, ingredient)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING job_id`, [userSub, worker?.clientId ?? null, worker ? 'queued' : 'failed', `story: ${label}`, orientation, 'story', null])).rows[0];
        const jobId = inserted.job_id;
        if (!worker) {
            await ctx.pool.query(`UPDATE vids_jobs SET outcome = $2::jsonb, updated_at = now() WHERE job_id = $1 AND user_sub = $3`, [jobId, JSON.stringify({ error: 'no Vids worker registered', kind: 'story' }), userSub]);
            res.status(503).json({ error: 'No Vids worker is registered. Start one on a machine with a screen: `oshal-vids worker`.', job_id: jobId });
            return;
        }
        const taskId = await enqueueVidsTask(ctx, worker, jobId, userSub, { name: toolName, arguments: args }, 'story');
        if (!taskId) {
            res.status(503).json({ error: 'The Vids worker could not accept the story task.', job_id: jobId });
            return;
        }
        await ctx.pool.query(`UPDATE vids_jobs
          SET outcome = jsonb_build_object('taskId', $2::text, 'kind', 'story', 'tool', $3::text)
        WHERE job_id = $1 AND user_sub = $4`, [jobId, taskId, toolName, userSub]);
        watchTask(ctx, worker.clientId, taskId, jobId, userSub);
        logger.info({ jobId, taskId, clientId: worker.clientId, toolName }, 'Vids story dispatched to worker');
        res.json({ job_id: jobId, taskId, clientId: worker.clientId, tool: toolName, status: 'queued' });
    });
    // GET /api/vids/jobs — list jobs + registered worker status.
    router.get('/jobs', async (req, res) => {
        const requestedLimit = Number(req.query.limit);
        const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, 200)
            : 50;
        const status = typeof req.query.status === 'string' && req.query.status
            ? req.query.status
            : null;
        if (status && !VIDS_STATUSES.has(status)) {
            res.status(400).json({ error: 'invalid Vids job status' });
            return;
        }
        const userSub = callerSub(req);
        if (!userSub) {
            res.status(401).json({ error: 'user_identity_required' });
            return;
        }
        const rows = (await ctx.pool.query(`SELECT job_id, status, idea, final_prompt, orientation, insert_mode, client_id,
                outcome->>'taskId' AS task_id, created_at, updated_at
           FROM vids_jobs
          WHERE user_sub = $1
            AND ($3::text IS NULL OR status = $3)
          ORDER BY created_at DESC
          LIMIT $2`, [userSub, limit, status])).rows;
        const workers = remote_client_routes_1.remoteClientRegistry
            .listClients()
            .filter(isVidsWorker)
            .map((c) => {
            const r = c;
            return {
                clientId: r.clientId,
                name: r.name,
                status: r.status,
                healthy: r.healthy,
                lastSeenAt: r.lastSeenAt ?? null,
                queueDepth: r.taskQueueDepth ?? 0,
            };
        });
        res.json({ jobs: rows, workers });
    });
    // GET /api/vids/app — embedded job-queue surface for the cockpit tile.
    router.get('/app', (_req, res) => {
        res.type('html').send(SURFACE_HTML);
    });
    return router;
}
// Self-contained surface: lists jobs, submits a prompt, shows worker presence.
// Follows the swarm theme by reading the parent document's data-theme when embedded.
// With ?audience=family the shared audience-view kit paints the Home shell's read-only family view instead.
const SURFACE_HTML = `<!doctype html>
<html lang="en" data-theme="midnight">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Vids Studio</title>
<link rel="stylesheet" href="/shared/ui/css/surface-themes.css" />
<script src="/shared/ui/js/surface-theme.js"></script>
<!-- Audience view (ADR-164 D6). The Home shell opens this page with ?audience=family: the signed-in account's OWN saved
     videos (clips, story videos and brand graphics in the vids_jobs ledger: how many are waiting or being made, finished
     in the last five days and not finished, whether the video maker is connected, and the newest eight with where each
     one stands) from the SAME /api/vids routes the full page reads, painted by the shared kit in the family grammar. On
     open it reads only GET /jobs (the newest nine), /home-summary and, for each finished video shown, its
     /jobs/:id/artifact record. It never dispatches a clip, story or brand job, never attaches, publishes, revokes or
     removes an export, binds no control or handoff listener, fetches no connected-actions offer and does not poll. A
     finished video whose export is attached opens its private preview in a new tab. Any other request runs the full
     Vids Studio page below unchanged. -->
<link rel="stylesheet" href="/shared/ui/css/app-view.css" />
<script src="/shared/ui/js/app-view.js"></script>
<script>
(function () {
  var A = window.AppView; if (!A) return;
  var API = '/api/vids', FULL = '/cockpit/?app=vids', KICKER = 'Our videos', SHOWN = 8, PREVIEW = '/api/vids/jobs/';
  var WORDS = { queued: 'Waiting its turn', running: 'Being made now', done: 'Finished', failed: 'Did not finish' };
  var KINDS = { story: ['📖', 'Story video'], brand: ['✨', 'Brand graphic'] };
  function call(path) {
    return fetch(API + path, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j = j || {}; if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; } return j; });
    });
  }
  function refused(e) { return !!e && (e.status === 401 || e.status === 403); }
  // The home summary is its own mount and may fail on its own (or refuse a session that is not a browser sign-in): the
  // saved videos still show and its counts read as not checked.
  function summary() { return call('/home-summary').catch(function () { return null; }); }
  // A finished job's artifact record says whether its export is attached; a failed read stays apart from "none attached".
  function artifact(job) {
    if (!job || job.status !== 'done' || !job.job_id) return Promise.resolve(null);
    return call('/jobs/' + encodeURIComponent(job.job_id) + '/artifact').then(function (j) { return { ok: true, artifact: j.artifact || null }; }, function () { return { ok: false }; });
  }
  // The route sends each count as digits in a string ('0', '12'), or the word 'Unavailable' when that source failed.
  function count(value) { var s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''; return /^[0-9]+$/.test(s) ? Number(s) : null; }
  function metric(sum, id) { var m = ((sum && (sum.metrics || sum.tiles)) || []).filter(function (x) { return x && x.id === id; })[0]; return m ? count(m.value) : null; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function word(status) { return WORDS[status] || (status ? 'Status: ' + status : 'Status not recorded'); }
  function kind(job) { return KINDS[job.insert_mode] || ['🎬', 'Clip']; }
  // The Vids story route saves a story's idea as 'story: <label>'; the family view shows the label.
  function name(job) {
    var s = String(job.idea || '').trim();
    if (s.toLowerCase().indexOf('story:') === 0) s = s.slice(6).trim();
    return !s ? 'Untitled video' : s.length > 90 ? s.slice(0, 89) + '…' : s;
  }
  function updated(job) { return 'updated ' + A.when(job.updated_at || job.created_at); }
  // Only the private preview path the artifact route builds is followed, so a tile never leaves this origin.
  function preview(rec) { var url = rec && rec.ok && rec.artifact && rec.artifact.previewUrl; return typeof url === 'string' && url.indexOf(PREVIEW) === 0 ? url : null; }
  function tile(job, rec) {
    var k = kind(job), failed = job.status === 'failed', watch = preview(rec), shared = !!(rec && rec.ok && rec.artifact && rec.artifact.publicUrl);
    var shape = typeof job.orientation === 'string' && job.orientation ? k[1] + ', ' + job.orientation.toLowerCase() : k[1];
    return { icon: failed ? '⚠️' : k[0], title: name(job), text: word(job.status) + ' · ' + shape + (shared ? ' · public link on' : ''), meta: updated(job),
      badge: watch ? 'Ready to watch' : null, tone: failed ? 'warn' : null, href: watch, target: watch ? '_blank' : null };
  }
  // The route lists every registered Vids worker; one that is online or healthy can take new work.
  function maker(workers) {
    var all = Array.isArray(workers) ? workers : [];
    if (all.some(function (w) { return !!w && (w.status === 'online' || !!w.healthy); })) return { value: 'Ready', hint: null, tone: null, ready: true };
    return all.length ? { value: 'Not answering', hint: 'Registered, but not online right now', tone: 'warn', ready: false } : { value: 'Not connected', hint: 'Needed to make new videos', tone: 'warn', ready: false };
  }
  function stat(id, label, n, tone, hint) { return { id: id, label: label, value: n === null ? '—' : n, tone: n === null ? null : tone, hint: n === null ? 'Could not check' : hint || null }; }
  function stats(n, m) {
    return [
      stat('active', 'Waiting or being made', n.active, null),
      stat('finished', 'Finished, last 5 days', n.done, null),
      stat('unfinished', 'Did not finish', n.failed, n.failed > 0 ? 'warn' : null, 'All time'),
      { id: 'maker', label: 'Video maker', value: m.value, hint: m.hint, tone: m.tone }
    ];
  }
  // jobs-active counts queued and running together: a queued video waits for the maker and is not being made yet.
  function headline(n, jobs) {
    if (n.active > 0) return plural(n.active, 'video', 'videos') + ' waiting or being made';
    if (n.done > 0) return plural(n.done, 'video', 'videos') + ' finished in the last 5 days';
    if (n.active === null || n.done === null) return jobs.length ? 'The newest videos' : 'Some saved work could not be checked';
    return jobs.length ? 'Nothing waiting or being made right now' : 'No videos yet';
  }
  function lede(jobs) {
    var first = jobs[0];
    if (first) return 'Newest: ' + name(first) + ' (' + word(first.status).toLowerCase() + ', ' + updated(first) + ').';
    return 'Vids Studio turns an idea into a short generated video. The videos made for this account show up here.';
  }
  function note(jobs, recs, m) {
    var unchecked = recs.filter(function (r) { return !!r && r.ok === false; }).length, parts = [];
    if (recs.some(preview)) parts.push('Tap a video marked Ready to watch to play it in a new tab.');
    if (jobs.length) parts.push('Finished means the video maker reported it done, not that it was posted anywhere; a finished video can be watched here once its file is added in Vids Studio.');
    if (jobs.length > SHOWN) parts.push('Only the newest ' + SHOWN + ' show here.');
    if (unchecked) parts.push('For ' + plural(unchecked, 'finished video', 'finished videos') + ' the file could not be checked just now.');
    if (!m.ready) parts.push('The video maker is not online right now, so nothing new can be made until it is back.');
    return parts.join(' ') || null;
  }
  function model(list, sum, shown, recs) {
    var n = { active: metric(sum, 'jobs-active'), done: metric(sum, 'jobs-done-5d'), failed: metric(sum, 'jobs-failed') }, m = maker(list.workers);
    return { kicker: KICKER, title: headline(n, list.jobs), lede: lede(shown),
      actions: [{ label: 'Open Vids Studio', primary: true, onClick: function () { A.open(FULL); } }],
      stats: stats(n, m),
      sections: [{ kind: 'tiles', id: 'videos', title: 'Newest videos', empty: 'No videos yet.', note: note(list.jobs, recs, m),
        items: shown.map(function (job, i) { return tile(job, recs[i]); }) }] };
  }
  function refusal(status) {
    return { kicker: KICKER, title: status === 401 ? 'Sign in to see the saved videos' : 'This account cannot open Vids Studio',
      lede: status === 401 ? 'Vids Studio shows the videos of whoever is signed in, and this session is not signed in.' : 'The Vids Studio routes refused this account (HTTP 403).' };
  }
  function listFailure(e) {
    if (refused(e)) return refusal(e.status);
    throw new Error(e && e.status ? 'Vids Studio could not read the saved videos (HTTP ' + e.status + ').' : 'Vids Studio could not be reached just now.');
  }
  function family() {
    return Promise.all([call('/jobs?limit=' + (SHOWN + 1)), summary()]).then(function (r) {
      if (!Array.isArray(r[0].jobs)) throw new Error('Vids Studio answered without its list of saved videos.');
      var shown = r[0].jobs.slice(0, SHOWN);
      return Promise.all(shown.map(artifact)).then(function (recs) { return model(r[0], r[1], shown, recs); });
    }, listFailure);
  }
  // ADR-164 D6: the other shells' audience (company) paints this same account-scoped card in its own grammar; the reads and the model do not change.
  A.boot({ app: 'vids', escapeLabel: 'Open Vids Studio in the cockpit', audiences: { family: family, company: family } });
})();
</script>
<style>
  :root{--bg:var(--bg-primary,#0b1220);--panel:var(--bg-card,#121a2b);--line:var(--border-color,#23304b);--text:var(--text-primary,#e7eefc);--muted:var(--text-secondary,#9fb0d0);--accent:var(--accent-primary,#10b981);--bad:var(--status-error,#f87171);--warn:var(--status-warning,#fbbf24)}
  *{box-sizing:border-box} body{margin:0;font:14px/1.5 Inter,system-ui,Segoe UI,sans-serif;background:var(--bg);color:var(--text)}
  .wrap{max-width:900px;margin:0 auto;padding:18px}
  h1{font:600 18px Archivo,Inter,sans-serif;margin:0 0 2px} .sub{color:var(--muted);margin:0 0 16px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}
  textarea{width:100%;min-height:66px;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit;resize:vertical}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
  select,button{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font:inherit}
  button.primary{background:var(--accent);color:#04130d;border-color:var(--accent);font-weight:600;cursor:pointer}
  button.primary:disabled{opacity:.5;cursor:not-allowed}
  .worker{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--bad)} .dot.on{background:var(--accent)}
  table{width:100%;border-collapse:collapse;font-size:13px} th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--muted);font-weight:500} .st{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
  .st.done{color:var(--accent);border-color:var(--accent)} .st.failed{color:var(--bad);border-color:var(--bad)}
  .st.running,.st.queued{color:var(--warn);border-color:var(--warn)} .idea{max-width:380px}
  .artifact{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.artifact button,.artifact a{font-size:12px;padding:4px 7px}.artifact input{max-width:150px;font-size:11px}
  .empty{color:var(--muted);text-align:center;padding:18px}
  @media(max-width:640px){
    .wrap{padding:14px}
    .card{padding:12px}
    .row select{flex:1 1 140px;min-width:0}
    th:nth-child(3),td:nth-child(3),th:nth-child(4),td:nth-child(4){display:none}
    th,td{padding:8px 4px}
    .idea{max-width:none;overflow-wrap:anywhere}
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>Vids Studio</h1>
  <p class="sub">Describe a clip — the Veo specialist drives Google Vids on the registered operator machine and places it on the timeline.</p>
  <div class="card">
    <textarea id="prompt" placeholder="e.g. A news anchor recapping today's market in a modern studio…"></textarea>
    <div class="row">
      <select id="orientation"><option>Landscape</option><option>Portrait</option><option>Square</option></select>
      <select id="insertMode"><option value="Insert">Insert (new scene)</option><option value="Extend">Extend</option><option value="none">Don't place</option></select>
      <button class="primary" id="go">Generate clip</button>
      <span class="worker"><span class="dot" id="wdot"></span><span id="wtxt">checking worker…</span></span>
    </div>
  </div>
  <div class="card">
    <table><thead><tr><th>Status</th><th>Idea</th><th>Orientation</th><th>Worker</th><th>When</th><th>Finished export</th></tr></thead>
    <tbody id="rows"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody></table>
  </div>
</div>
<script>
  // Follow the parent swarm theme when embedded in the cockpit.
  try { var pt = window.parent && window.parent.document && window.parent.document.documentElement.getAttribute('data-theme'); if (pt) document.documentElement.setAttribute('data-theme', pt); } catch(e){}
  var go = document.getElementById('go');
  function fmt(ts){ try { return new Date(ts).toLocaleTimeString(); } catch(e){ return ts; } }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function statusKey(v){ return ['done','failed','running','queued'].indexOf(v)>=0?v:'unknown'; }
  async function refresh(){
    try{
      var r = await fetch('/api/vids/jobs'); var d = await r.json();
      var w = (d.workers||[]).find(function(x){return x.status==='online'||x.healthy;}) || (d.workers||[])[0];
      var dot = document.getElementById('wdot'), txt = document.getElementById('wtxt');
      if (w){ dot.className='dot on'; txt.textContent = (w.name||w.clientId)+' · online'; go.disabled=false; }
      else { dot.className='dot'; txt.textContent='no worker registered'; go.disabled=true; }
      var tb = document.getElementById('rows');
      if (!d.jobs || !d.jobs.length){ tb.innerHTML='<tr><td colspan="6" class="empty">No jobs yet.</td></tr>'; return; }
      var artifacts = await Promise.all(d.jobs.map(async function(j){
        if (j.status !== 'done') return null;
        try { var ar=await fetch('/api/vids/jobs/'+encodeURIComponent(j.job_id)+'/artifact'); return ar.ok?(await ar.json()).artifact:null; } catch(e){ return null; }
      }));
      tb.innerHTML = d.jobs.map(function(j,index){
        var status=statusKey(j.status);
        var a=artifacts[index], artifact='—';
        if (status==='done') artifact=a
          ? '<a href="'+esc(a.previewUrl)+'" target="_blank" rel="noreferrer">Preview</a>'+
            (a.publicUrl ? '<a href="'+esc(a.publicUrl)+'" target="_blank" rel="noreferrer">Public link</a><button data-artifact="unpublish" data-job="'+esc(j.job_id)+'">Revoke</button>' : '<button data-artifact="publish" data-job="'+esc(j.job_id)+'">Publish</button>')+
            '<button data-artifact="remove" data-job="'+esc(j.job_id)+'">Remove</button>'
          : '<input type="file" accept="video/mp4" data-artifact="attach" data-job="'+esc(j.job_id)+'" aria-label="Attach finished MP4">';
        return '<tr><td><span class="st '+status+'">'+esc(j.status)+'</span></td>'+
          '<td class="idea">'+esc(j.idea)+'</td>'+
          '<td>'+esc(j.orientation)+'</td>'+
          '<td>'+esc(j.client_id)+'</td>'+
          '<td>'+esc(fmt(j.created_at))+'</td><td class="artifact">'+artifact+'</td></tr>';
      }).join('');
    }catch(e){}
  }
  // The full page only: under an audience view (ADR-164 D6) the shared kit paints instead (see the head script), so no
  // control is bound, the job list is not read and nothing polls; without the kit or an audience the page starts as before.
  if (!window.AppView || !AppView.active()) {
    go.onclick = async function(){
      var prompt = document.getElementById('prompt').value.trim(); if(!prompt) return;
      go.disabled=true; var old=go.textContent; go.textContent='Dispatching…';
      try{
        await fetch('/api/vids/jobs',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({prompt:prompt,orientation:document.getElementById('orientation').value,insertMode:document.getElementById('insertMode').value})});
        document.getElementById('prompt').value='';
      }catch(e){}
      go.textContent=old; refresh();
    };
    document.getElementById('rows').onclick = async function(event){
      var target=event.target.closest('[data-artifact]'); if(!target || target.tagName==='INPUT') return;
      var action=target.getAttribute('data-artifact'), job=target.getAttribute('data-job');
      if(!job || !window.confirm(action==='publish'?'Publish this finished export publicly?':action==='unpublish'?'Revoke its public link?':'Remove this private export?')) return;
      try{
        var body={confirm:true};
        if(action==='publish'){ var current=await fetch('/api/vids/jobs/'+encodeURIComponent(job)+'/artifact'); var artifact=(await current.json()).artifact; body.sha256=artifact.sha256; }
        var method=action==='remove'?'DELETE':'POST';
        var suffix=action==='publish'?'publish':action==='unpublish'?'unpublish':'';
        var r=await fetch('/api/vids/jobs/'+encodeURIComponent(job)+'/artifact/'+suffix,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!r.ok) throw new Error((await r.json()).error||'artifact action failed');
        refresh();
      }catch(e){ window.alert(e.message||'artifact action failed'); }
    };
    document.getElementById('rows').onchange = async function(event){
      var input=event.target; if(input.getAttribute('data-artifact')!=='attach' || !input.files[0]) return;
      try{ var form=new FormData(); form.append('file',input.files[0]); var r=await fetch('/api/vids/jobs/'+encodeURIComponent(input.getAttribute('data-job'))+'/artifact',{method:'POST',body:form}); if(!r.ok) throw new Error((await r.json()).error||'export attach failed'); refresh(); }
      catch(e){ window.alert(e.message||'export attach failed'); }
    };
    refresh(); setInterval(refresh, 4000);
  }
</script>

<script type="module">
import {receiveHandoff} from '/cockpit/js/app-handoff.js';
import {mountConnectedActions} from '/cockpit/js/app-workflows.js';
// The full page only: under an audience view no handoff listener is added, no connected-actions section is appended and no offer is fetched.
if (!window.AppView || !AppView.active()) {
const input=document.getElementById('prompt');
receiveHandoff({"app":"vids","action":"prepare-brief","contextType":"research-brief","version":1,"fields":["title","notes","sourceUrl"]},context=>{input.value=[context.title,context.notes,context.sourceUrl?'Source: '+context.sourceUrl:''].filter(Boolean).join('\\n\\n');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});
const element=document.createElement('section');element.className='connected-app-actions';element.setAttribute('aria-label','Connected application actions');element.style.cssText='margin:16px auto;padding:16px;max-width:1200px;border:1px solid currentColor;border-radius:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap';document.body.append(element);
void mountConnectedActions({app:'vids',element,contextForOffer:()=>{const notes=input.value.trim().slice(0,2000);return notes?{title:'Review my video brief',notes}:null;}});
}
</script>
</body>
</html>`;
//# sourceMappingURL=vids-routes.js.map