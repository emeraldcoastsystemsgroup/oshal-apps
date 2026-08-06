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
 */

/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR        | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-26          | Claude Opus   | Vids Studio routes (activation step from
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

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { remoteClientRegistry } from '@/app/routes/remote-client-routes';
import { getCaller, getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { requireTrustedServiceUserIdentity } from '@/shared/middleware/trusted-service-user-identity';
import { runWithRequestIdentity } from '@/shared/services/database/request-identity';

const logger = createChildLogger({ module: 'vids-routes' });

// The Veo-specialist bot seeded by migration 059 — the `fromAgentId` on dispatched tasks.
const VIDS_BOT_AGENT_ID = 'b00e0000-0000-0000-0000-000000000001';
const VIDS_ORIENTATIONS = new Set(['Landscape', 'Portrait', 'Square']);
const VIDS_INSERT_MODES = new Set(['Insert', 'Extend', 'none']);
const VIDS_STATUSES = new Set(['queued', 'running', 'done', 'failed']);

interface VidsWorkerView {
  clientId: string;
  agentId?: string;
  name?: string;
  status?: string;
  healthy?: boolean;
  lastSeenAt?: string | null;
  queueDepth?: number;
}

/** True if a remote client advertises the Vids tools (by capability or tag). */
function isVidsWorker(c: { capabilities?: unknown; tags?: unknown }): boolean {
  const caps = Array.isArray(c.capabilities) ? (c.capabilities as string[]) : [];
  const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
  return caps.includes('vids.generate') || caps.includes('content.next') || caps.includes('content.produce') || tags.includes('vids') || tags.includes('creative');
}

/** Pick a registered Vids worker, preferring an online/healthy one. */
function findVidsWorker(): VidsWorkerView | null {
  const candidates = remoteClientRegistry.listClients().filter(isVidsWorker);
  if (candidates.length === 0) return null;
  const online = candidates.find((c) => (c as { status?: string }).status === 'online' || (c as { healthy?: boolean }).healthy);
  return (online ?? candidates[0]) as unknown as VidsWorkerView;
}

function callerSub(req: Request): string | null {
  // An independently authenticated browser/PAT principal stays authoritative when both
  // credential classes are present. The service header is accepted only behind the exact fleet
  // secret and is narrowed to non-operator DB identity by requireTrustedServiceUserIdentity.
  return getCaller(req).sub ?? getTrustedServiceUserSub(req);
}

/**
 * Poll the in-process registry for the worker's completion and persist it to the
 * vids_jobs row. The worker posts /complete back to the same registry; this is the
 * direct-enqueuer pull path (getCompletedResult), no loopback HTTP.
 */
export function watchTask(
  ctx: AppContext,
  clientId: string,
  taskId: string,
  jobId: string,
  userSub: string,
): void {
  let ticks = 0;
  let polling = false;
  let settled = false;
  const timer = setInterval(() => {
    if (polling || settled) return;
    polling = true;
    void (async () => {
      ticks += 1;
      try {
        const result = await remoteClientRegistry.getCompletedResult(clientId, taskId);
        if (result) {
          settled = true;
          clearInterval(timer);
          const ok = result.status === 'completed';
          const output = result.output && typeof result.output === 'object'
            ? result.output as Record<string, unknown>
            : {};
          const finalPrompt = typeof output.finalPrompt === 'string'
            ? output.finalPrompt.slice(0, 10_000)
            : null;
          const terminalStatus = ok ? 'completed' : 'failed';
          await runWithRequestIdentity({ sub: userSub, isOperator: false }, () => ctx.pool.query(
            `UPDATE vids_jobs
               SET status = $2,
                   final_prompt = COALESCE($3, final_prompt),
                   client_id = $4,
                   outcome = outcome || $5::jsonb,
                   updated_at = now()
             WHERE job_id = $1 AND user_sub = $6`,
            [
              jobId,
              ok ? 'done' : 'failed',
              finalPrompt,
              clientId,
              JSON.stringify({ result: { status: terminalStatus } }),
              userSub,
            ],
          ));
          logger.info({ jobId, taskId, status: terminalStatus }, 'Vids job settled');
          return;
        }
        if (ticks === 1) {
          await runWithRequestIdentity({ sub: userSub, isOperator: false }, () => ctx.pool.query(
            `UPDATE vids_jobs
                SET status = 'running', updated_at = now()
              WHERE job_id = $1 AND user_sub = $2 AND status = 'queued'`,
            [jobId, userSub],
          ));
        }
      } catch (err) {
        const errorType = err instanceof Error ? err.name : 'UnknownError';
        logger.warn({ errorType, jobId }, 'Vids job watch error');
      } finally {
        polling = false;
      }
      if (ticks > 360) clearInterval(timer); // ~30 min ceiling at 5s
    })();
  }, 5000);
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * @description Durably enqueue one Vids tool call and fail the already-created job row if the
 * remote journal rejects it. Provider/registry errors remain in structured logs, never responses.
 */
async function enqueueVidsTask(
  ctx: AppContext,
  worker: VidsWorkerView,
  jobId: string,
  userSub: string,
  input: { name: string; arguments: Record<string, unknown> },
  kind: 'clip' | 'story',
): Promise<string | null> {
  try {
    const task = await remoteClientRegistry.enqueueTask(worker.clientId, {
      taskId: randomUUID(),
      correlationId: randomUUID(),
      fromAgentId: VIDS_BOT_AGENT_ID,
      toAgentId: worker.agentId ?? worker.clientId,
      userSub,
      intent: 'mcp.call-tool',
      input,
      createdAt: new Date().toISOString(),
    });
    return task.taskId;
  } catch (err) {
    const errorType = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ errorType, jobId, clientId: worker.clientId, kind }, 'Vids task enqueue rejected');
    await ctx.pool.query(
      `UPDATE vids_jobs
          SET status = 'failed', outcome = outcome || $2::jsonb, updated_at = now()
        WHERE job_id = $1 AND user_sub = $3`,
      [jobId, JSON.stringify({ error: 'remote task enqueue rejected', kind }), userSub],
    );
    return null;
  }
}

/**
 * @description Vids Studio routes: dispatch generate-jobs to the remote screen-driving
 * worker and serve the embedded job-queue surface.
 */
export function createVidsRoutes(ctx: AppContext): Router {
  const router = Router();
  // Machine authentication proves the caller is an OSHAL process, not which user's rows it may
  // access. Require the separate exact subject and narrow the ambient DB identity before all route
  // work. An independently authenticated browser principal remains authoritative.
  router.use(requireTrustedServiceUserIdentity);

  // POST /api/vids/jobs — enqueue a clip generate-job to the registered Vids worker.
  router.post('/jobs', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
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

    const inserted = (
      await ctx.pool.query(
        `INSERT INTO vids_jobs (user_sub, client_id, status, idea, orientation, insert_mode, ingredient)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING job_id`,
        [userSub, worker?.clientId ?? null, worker ? 'queued' : 'failed', idea, orientation, insertMode, ingredient],
      )
    ).rows[0] as { job_id: string };
    const jobId = inserted.job_id;

    if (!worker) {
      await ctx.pool.query(
        `UPDATE vids_jobs SET outcome = $2::jsonb, updated_at = now() WHERE job_id = $1 AND user_sub = $3`,
        [jobId, JSON.stringify({ error: 'no Vids worker registered' }), userSub],
      );
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

    await ctx.pool.query(
      `UPDATE vids_jobs SET outcome = jsonb_build_object('taskId', $2::text), updated_at = now()
        WHERE job_id = $1 AND user_sub = $3`,
      [jobId, taskId, userSub],
    );
    watchTask(ctx, worker.clientId, taskId, jobId, userSub);
    logger.info({ jobId, taskId, clientId: worker.clientId }, 'Vids job dispatched to worker');
    res.json({ job_id: jobId, taskId, clientId: worker.clientId, status: 'queued' });
  });

  // POST /api/vids/story — dispatch a multi-scene STORY (Extend chain) to the worker.
  // With storyId / {title,script} it produces that specific story (content.produce);
  // otherwise it produces the NEXT unproduced library story (content.next, the cycler).
  router.post('/story', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
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
    const args: Record<string, unknown> = {};
    if (storyId) args.storyId = storyId;
    if (title) args.title = title;
    if (script) args.script = script;
    if (orientation) args.orientation = orientation;
    if (beats !== undefined && !Number.isNaN(beats)) args.beats = beats;
    const label = storyId ?? title ?? 'next library story';

    const worker = findVidsWorker();
    const userSub = callerSub(req);
    if (!userSub) {
      res.status(401).json({ error: 'user_identity_required' });
      return;
    }
    const inserted = (
      await ctx.pool.query(
        `INSERT INTO vids_jobs (user_sub, client_id, status, idea, orientation, insert_mode, ingredient)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING job_id`,
        [userSub, worker?.clientId ?? null, worker ? 'queued' : 'failed', `story: ${label}`, orientation, 'story', null],
      )
    ).rows[0] as { job_id: string };
    const jobId = inserted.job_id;

    if (!worker) {
      await ctx.pool.query(
        `UPDATE vids_jobs SET outcome = $2::jsonb, updated_at = now() WHERE job_id = $1 AND user_sub = $3`,
        [jobId, JSON.stringify({ error: 'no Vids worker registered', kind: 'story' }), userSub],
      );
      res.status(503).json({ error: 'No Vids worker is registered. Start one on a machine with a screen: `oshal-vids worker`.', job_id: jobId });
      return;
    }

    const taskId = await enqueueVidsTask(
      ctx,
      worker,
      jobId,
      userSub,
      { name: toolName, arguments: args },
      'story',
    );
    if (!taskId) {
      res.status(503).json({ error: 'The Vids worker could not accept the story task.', job_id: jobId });
      return;
    }
    await ctx.pool.query(
      `UPDATE vids_jobs
          SET outcome = jsonb_build_object('taskId', $2::text, 'kind', 'story', 'tool', $3::text)
        WHERE job_id = $1 AND user_sub = $4`,
      [jobId, taskId, toolName, userSub],
    );
    watchTask(ctx, worker.clientId, taskId, jobId, userSub);
    logger.info({ jobId, taskId, clientId: worker.clientId, toolName }, 'Vids story dispatched to worker');
    res.json({ job_id: jobId, taskId, clientId: worker.clientId, tool: toolName, status: 'queued' });
  });

  // GET /api/vids/jobs — list jobs + registered worker status.
  router.get('/jobs', async (req: Request, res: Response) => {
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
    const rows = (
      await ctx.pool.query(
        `SELECT job_id, status, idea, final_prompt, orientation, insert_mode, client_id,
                outcome->>'taskId' AS task_id, created_at, updated_at
           FROM vids_jobs
          WHERE user_sub = $1
            AND ($3::text IS NULL OR status = $3)
          ORDER BY created_at DESC
          LIMIT $2`,
        [userSub, limit, status],
      )
    ).rows;
    const workers: VidsWorkerView[] = remoteClientRegistry
      .listClients()
      .filter(isVidsWorker)
      .map((c) => {
        const r = c as unknown as VidsWorkerView & { taskQueueDepth?: number };
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
  router.get('/app', (_req: Request, res: Response) => {
    res.type('html').send(SURFACE_HTML);
  });

  return router;
}

// Self-contained surface: lists jobs, submits a prompt, shows worker presence.
// Follows the swarm theme by reading the parent document's data-theme when embedded.
const SURFACE_HTML = `<!doctype html>
<html lang="en" data-theme="midnight">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Vids Studio</title>
<link rel="stylesheet" href="/shared/ui/css/surface-themes.css" />
<script src="/shared/ui/js/surface-theme.js"></script>
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
    <table><thead><tr><th>Status</th><th>Idea</th><th>Orientation</th><th>Worker</th><th>When</th></tr></thead>
    <tbody id="rows"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody></table>
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
      if (!d.jobs || !d.jobs.length){ tb.innerHTML='<tr><td colspan="5" class="empty">No jobs yet.</td></tr>'; return; }
      tb.innerHTML = d.jobs.map(function(j){
        var status=statusKey(j.status);
        return '<tr><td><span class="st '+status+'">'+esc(j.status)+'</span></td>'+
          '<td class="idea">'+esc(j.idea)+'</td>'+
          '<td>'+esc(j.orientation)+'</td>'+
          '<td>'+esc(j.client_id)+'</td>'+
          '<td>'+esc(fmt(j.created_at))+'</td></tr>';
      }).join('');
    }catch(e){}
  }
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
  refresh(); setInterval(refresh, 4000);
</script>
</body>
</html>`;
