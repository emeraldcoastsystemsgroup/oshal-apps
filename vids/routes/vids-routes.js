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
 * 2026-07-24 20:45:00 | @codex-surface-audit | Make the Vids surface inherit the swarm control-plane theme and keep its job table usable on phone-sized screens.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVidsRoutes = createVidsRoutes;
const express_1 = require("express");
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const remote_client_routes_1 = require("@/app/routes/remote-client-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'vids-routes' });
// The Veo-specialist bot seeded by migration 059 — the `fromAgentId` on dispatched tasks.
const VIDS_BOT_AGENT_ID = 'b00e0000-0000-0000-0000-000000000001';
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
    const oidc = req.oidc;
    return oidc?.user?.sub ?? oidc?.sub ?? null;
}
/**
 * Poll the in-process registry for the worker's completion and persist it to the
 * vids_jobs row. The worker posts /complete back to the same registry; this is the
 * direct-enqueuer pull path (getCompletedResult), no loopback HTTP.
 */
function watchTask(ctx, clientId, taskId, jobId) {
    let ticks = 0;
    const timer = setInterval(() => {
        void (async () => {
            ticks += 1;
            try {
                const result = remote_client_routes_1.remoteClientRegistry.getCompletedResult(clientId, taskId);
                if (result) {
                    clearInterval(timer);
                    const ok = result.status === 'completed';
                    const output = (result.output ?? {});
                    await ctx.pool.query(`UPDATE vids_jobs
               SET status = $2,
                   final_prompt = COALESCE($3, final_prompt),
                   client_id = $4,
                   outcome = outcome || $5::jsonb,
                   updated_at = now()
             WHERE job_id = $1`, [
                        jobId,
                        ok ? 'done' : 'failed',
                        output.finalPrompt ?? null,
                        clientId,
                        JSON.stringify({ result: { status: result.status, error: result.error ?? null, output } }),
                    ]);
                    logger.info({ jobId, taskId, status: result.status }, 'Vids job settled');
                    return;
                }
                if (ticks === 1) {
                    await ctx.pool.query(`UPDATE vids_jobs SET status = 'running', updated_at = now() WHERE job_id = $1 AND status = 'queued'`, [jobId]);
                }
            }
            catch (err) {
                logger.warn({ err: String(err), jobId }, 'Vids job watch error');
            }
            if (ticks > 360)
                clearInterval(timer); // ~30 min ceiling at 5s
        })();
    }, 5000);
    if (typeof timer.unref === 'function')
        timer.unref();
}
/**
 * @description Vids Studio routes: dispatch generate-jobs to the remote screen-driving
 * worker and serve the embedded job-queue surface.
 */
function createVidsRoutes(ctx) {
    const router = (0, express_1.Router)();
    // POST /api/vids/jobs — enqueue a clip generate-job to the registered Vids worker.
    router.post('/jobs', async (req, res) => {
        const body = (req.body ?? {});
        const idea = String(body.prompt ?? body.idea ?? '').trim();
        if (!idea) {
            res.status(400).json({ error: 'prompt is required' });
            return;
        }
        const orientation = body.orientation ? String(body.orientation) : null;
        const insertMode = body.insertMode ? String(body.insertMode) : null;
        const ingredient = body.ingredient ? String(body.ingredient) : null;
        const worker = findVidsWorker();
        const userSub = callerSub(req);
        const inserted = (await ctx.pool.query(`INSERT INTO vids_jobs (user_sub, client_id, status, idea, orientation, insert_mode, ingredient)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING job_id`, [userSub, worker?.clientId ?? null, worker ? 'queued' : 'failed', idea, orientation, insertMode, ingredient])).rows[0];
        const jobId = inserted.job_id;
        if (!worker) {
            await ctx.pool.query(`UPDATE vids_jobs SET outcome = $2::jsonb, updated_at = now() WHERE job_id = $1`, [jobId, JSON.stringify({ error: 'no Vids worker registered' })]);
            res.status(503).json({
                error: 'No Vids worker is registered. Start one on a machine with a screen: `oshal-vids worker`.',
                job_id: jobId,
            });
            return;
        }
        const task = remote_client_routes_1.remoteClientRegistry.enqueueTask(worker.clientId, {
            taskId: (0, crypto_1.randomUUID)(),
            correlationId: (0, crypto_1.randomUUID)(),
            fromAgentId: VIDS_BOT_AGENT_ID,
            toAgentId: worker.agentId ?? worker.clientId,
            intent: 'mcp.call-tool',
            input: {
                name: 'vids.generate',
                arguments: {
                    prompt: idea,
                    orientation: orientation ?? undefined,
                    insertMode: insertMode ?? undefined,
                    ingredientPath: ingredient ?? undefined,
                },
            },
            createdAt: new Date().toISOString(),
        });
        await ctx.pool.query(`UPDATE vids_jobs SET outcome = jsonb_build_object('taskId', $2::text), updated_at = now() WHERE job_id = $1`, [jobId, task.taskId]);
        watchTask(ctx, worker.clientId, task.taskId, jobId);
        logger.info({ jobId, taskId: task.taskId, clientId: worker.clientId }, 'Vids job dispatched to worker');
        res.json({ job_id: jobId, taskId: task.taskId, clientId: worker.clientId, status: 'queued' });
    });
    // POST /api/vids/story — dispatch a multi-scene STORY (Extend chain) to the worker.
    // With storyId / {title,script} it produces that specific story (content.produce);
    // otherwise it produces the NEXT unproduced library story (content.next, the cycler).
    router.post('/story', async (req, res) => {
        const body = (req.body ?? {});
        const storyId = body.storyId ? String(body.storyId) : null;
        const title = body.title ? String(body.title) : null;
        const script = body.script ? String(body.script) : null;
        const orientation = body.orientation ? String(body.orientation) : null;
        const beats = body.beats != null ? Number(body.beats) : undefined;
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
        const inserted = (await ctx.pool.query(`INSERT INTO vids_jobs (user_sub, client_id, status, idea, orientation, insert_mode, ingredient)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING job_id`, [userSub, worker?.clientId ?? null, worker ? 'queued' : 'failed', `story: ${label}`, orientation, 'story', null])).rows[0];
        const jobId = inserted.job_id;
        if (!worker) {
            await ctx.pool.query(`UPDATE vids_jobs SET outcome = $2::jsonb, updated_at = now() WHERE job_id = $1`, [jobId, JSON.stringify({ error: 'no Vids worker registered', kind: 'story' })]);
            res.status(503).json({ error: 'No Vids worker is registered. Start one on a machine with a screen: `oshal-vids worker`.', job_id: jobId });
            return;
        }
        const task = remote_client_routes_1.remoteClientRegistry.enqueueTask(worker.clientId, {
            taskId: (0, crypto_1.randomUUID)(),
            correlationId: (0, crypto_1.randomUUID)(),
            fromAgentId: VIDS_BOT_AGENT_ID,
            toAgentId: worker.agentId ?? worker.clientId,
            intent: 'mcp.call-tool',
            input: { name: toolName, arguments: args },
            createdAt: new Date().toISOString(),
        });
        await ctx.pool.query(`UPDATE vids_jobs SET outcome = jsonb_build_object('taskId', $2::text, 'kind', 'story', 'tool', $3::text) WHERE job_id = $1`, [jobId, task.taskId, toolName]);
        watchTask(ctx, worker.clientId, task.taskId, jobId);
        logger.info({ jobId, taskId: task.taskId, clientId: worker.clientId, toolName }, 'Vids story dispatched to worker');
        res.json({ job_id: jobId, taskId: task.taskId, clientId: worker.clientId, tool: toolName, status: 'queued' });
    });
    // GET /api/vids/jobs — list jobs + registered worker status.
    router.get('/jobs', async (req, res) => {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const status = req.query.status ? String(req.query.status) : null;
        const rows = (await ctx.pool.query(`SELECT job_id, status, idea, final_prompt, orientation, insert_mode, client_id, outcome, created_at, updated_at
           FROM vids_jobs
          ${status ? 'WHERE status = $2' : ''}
          ORDER BY created_at DESC
          LIMIT $1`, status ? [limit, status] : [limit])).rows;
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
        return '<tr><td><span class="st '+j.status+'">'+j.status+'</span></td>'+
          '<td class="idea">'+(j.idea||'').replace(/[<>&]/g,'')+'</td>'+
          '<td>'+(j.orientation||'')+'</td>'+
          '<td>'+(j.client_id||'')+'</td>'+
          '<td>'+fmt(j.created_at)+'</td></tr>';
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
//# sourceMappingURL=vids-routes.js.map
