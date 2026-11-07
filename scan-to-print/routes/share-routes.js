"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Caller-scoped shareable read-only 3D viewer links backed by forced two-arm RLS (`scan_print_share_link`), instant revocation (`410 Gone`), and read-only STL/GLB/USDZ/AR inspection without editor chrome (RP-SCN-05, RP-SCN-06).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createShareRoutes = createShareRoutes;
const express_1 = require("express");
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = require("node:crypto");
const logger_1 = require("@/shared/logger");
const data_dir_1 = require("./data-dir");
const job_outputs_1 = require("./job-outputs");
const parse_stl_1 = require("./engine/geometry/parse-stl");
const export_glb_1 = require("./engine/geometry/export-glb");
const export_usdz_1 = require("./engine/geometry/export-usdz");
const logger = (0, logger_1.createChildLogger)({ module: 'scan-to-print-share-routes' });
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;
const SHARE_COLUMNS = 'share_id, job_id, owner_sub, share_token, label, revoked_at, created_at';
const JOB_COLUMNS = 'job_id, owner_sub, title, source_kind, state, known_dimensions, settings, report, failure_reason, created_at, updated_at';
function publicShare(row) {
    return {
        shareId: row.share_id,
        jobId: row.job_id,
        token: row.share_token,
        sharePath: `/api/scan-to-print/shared/${row.share_token}`,
        label: row.label,
        createdAt: row.created_at,
        revokedAt: row.revoked_at,
        active: row.revoked_at === null,
    };
}
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function lookupSharedJob(pool, token) {
    if (!SHARE_TOKEN_PATTERN.test(token)) {
        return { status: 404, error: 'share_not_found', message: 'This shared model link does not exist.' };
    }
    const client = typeof pool.connect === 'function'
        ? await pool.connect()
        : null;
    const runner = client ?? pool;
    try {
        if (client)
            await runner.query('BEGIN').catch(() => null);
        await runner.query("SELECT set_config('scan_share.token', $1, true)", [token]).catch(() => null);
        const { rows } = await runner.query(`SELECT ${SHARE_COLUMNS} FROM scan_print_share_link WHERE share_token = $1`, [token]);
        const share = rows[0];
        if (!share) {
            return { status: 404, error: 'share_not_found', message: 'This shared model link does not exist.' };
        }
        if (share.revoked_at !== null) {
            return { status: 410, error: 'share_revoked', message: 'This shared model link was revoked by its owner.' };
        }
        const jobRes = await runner.query(`SELECT ${JOB_COLUMNS} FROM scan_print_job WHERE owner_sub = $1 AND job_id = $2`, [share.owner_sub, share.job_id]);
        const job = jobRes.rows[0];
        if (!job || !(0, job_outputs_1.hasCurrentOutput)(job)) {
            return { status: 409, error: 'output_stale', message: 'The owner updated this object and has not rebuilt its 3D model yet.' };
        }
        return { status: 200, share, job };
    }
    finally {
        if (client) {
            await runner.query('COMMIT').catch(() => null);
            client.release?.();
        }
    }
}
const SHARED_VIEWER_STYLES = `
  :root { color-scheme: dark; --bg: #0c0d10; --panel: rgba(20, 23, 30, 0.88); --line: rgba(255,255,255,0.14); --fg: #f3f5f8; --muted: #a6afbd; --accent: #3b82f6; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, -apple-system, sans-serif; overflow: hidden; }
  .stage { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); z-index: 2; flex-wrap: wrap; }
  .meta { display: flex; flex-direction: column; gap: 2px; }
  .meta strong { font-size: 15px; }
  .meta span { font-size: 12px; color: var(--muted); }
  .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  button, a.btn { appearance: none; border: 1px solid var(--line); background: #181c24; color: var(--fg); border-radius: 8px; padding: 7px 12px; font: inherit; font-size: 13px; text-decoration: none; cursor: pointer; }
  button[aria-pressed="true"], a.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .canvas-host { flex: 1; min-height: 0; position: relative; }
  .readout { position: absolute; left: 16px; bottom: 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; font-size: 12px; color: var(--fg); max-width: calc(100% - 32px); }`;
function sharedViewerScript(base) {
    return `(function () {
    var host = document.getElementById('viewer'), readout = document.getElementById('readout'), btnMeasure = document.getElementById('btn-measure'), viewer = null;
    fetch('${base}/stl', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('Could not load shared STL'); return r.arrayBuffer(); })
      .then(function (buf) {
        viewer = window.ScanToPrintGl.mountStlViewer(host, buf, {
          onMeasure: function (m) {
            if (!m || !m.a) { readout.textContent = 'Measure active: click the first point on the model surface.'; return; }
            if (!m.b) { readout.textContent = 'Point A (' + m.a.x.toFixed(1) + ', ' + m.a.y.toFixed(1) + ', ' + m.a.z.toFixed(1) + ' mm) — click a second point.'; return; }
            readout.textContent = 'Distance: ' + m.distanceMm.toFixed(2) + ' mm (ΔX ' + m.absDeltaMm.x.toFixed(2) + ' · ΔY ' + m.absDeltaMm.y.toFixed(2) + ' · ΔZ ' + m.absDeltaMm.z.toFixed(2) + ' mm)';
          }
        });
      })
      .catch(function (err) { readout.textContent = err.message; });
    document.getElementById('btn-fit').addEventListener('click', function () { if (viewer && viewer.fitToView) viewer.fitToView(); });
    btnMeasure.addEventListener('click', function () {
      var next = btnMeasure.getAttribute('aria-pressed') !== 'true';
      btnMeasure.setAttribute('aria-pressed', next ? 'true' : 'false');
      if (viewer && viewer.setTool) viewer.setTool(next ? 'measure' : 'orbit');
      readout.textContent = next ? 'Measure active: click two points on the model surface.' : 'Drag to orbit · Scroll or pinch to zoom.';
    });
  })();`;
}
function renderReadOnlyViewerHtml(share, job) {
    const title = escapeHtml(job.title || 'Shared 3D model');
    const label = share.label ? ` · ${escapeHtml(share.label)}` : '';
    const rep = (job.report ?? {});
    const dims = `${Number(rep.sizeMm?.x ?? 0).toFixed(1)} × ${Number(rep.sizeMm?.y ?? 0).toFixed(1)} × ${Number(rep.sizeMm?.z ?? 0).toFixed(1)} mm`;
    const tris = Number(rep.triangleCount ?? 0);
    const base = `/api/scan-to-print/shared/${encodeURIComponent(share.share_token)}/artifacts`;
    const arImg = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="" width="1" height="1" style="position:absolute;opacity:0;pointer-events:none" />';
    return [
        '<!doctype html>',
        '<html lang="en" data-theme="dark" data-ds-archetype="studio" data-ds-D1="glass" data-ds-D2="c">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title} — Shared 3D Model</title><style>${SHARED_VIEWER_STYLES}</style></head>`,
        '<body><main class="stage" data-shared-viewer="read-only">',
        `<header class="topbar"><div class="meta"><strong>${title}</strong><span>Read-only shared model${label} · ${dims} · ${tris} facets</span></div>`,
        `<div class="actions"><button type="button" id="btn-fit">Fit</button><button type="button" id="btn-measure" aria-pressed="false">Measure</button>`,
        `<a class="btn" id="ar-usdz" rel="ar" href="${base}/usdz">View in AR (USDZ)${arImg}</a>`,
        `<a class="btn" href="${base}/glb?download">GLB</a><a class="btn primary" href="${base}/stl?download">Download STL</a></div></header>`,
        '<div id="viewer" class="canvas-host" role="img" aria-label="Shared 3D model preview"></div>',
        '<div id="readout" class="readout">Drag to orbit · Scroll or pinch to zoom · Click Measure to pick two surface points.</div>',
        `</main><script src="/api/scan-to-print/assets/scan-to-print-gl.js"></script><script>${sharedViewerScript(base)}</script></body></html>`,
    ].join('\n');
}
async function handleSharedViewerRead(deps, req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        const found = await lookupSharedJob(deps.pool, String(req.params.token ?? ''));
        if (found.status !== 200) {
            res.status(found.status).json({ error: found.error, message: found.message });
            return;
        }
        const stlFile = (0, data_dir_1.artifactPath)((0, data_dir_1.jobDir)(deps.dataRoot, found.share.owner_sub, found.job.job_id), 'stl');
        if (!node_fs_1.default.existsSync(stlFile)) {
            res.status(404).json({ error: 'artifact_not_found' });
            return;
        }
        const base = `/api/scan-to-print/shared/${found.share.share_token}/artifacts`;
        if (req.query.format === 'json' || String(req.headers.accept ?? '').includes('application/json')) {
            res.json({
                share: { label: found.share.label, createdAt: found.share.created_at, readOnly: true },
                model: { title: found.job.title, report: found.job.report },
                artifacts: { stl: `${base}/stl`, glb: `${base}/glb`, usdz: `${base}/usdz` },
            });
            return;
        }
        res.type('html').send(renderReadOnlyViewerHtml(found.share, found.job));
    }
    catch (error) {
        logger.error({ err: error }, 'Shared viewer lookup failed');
        res.status(500).json({ error: 'share_lookup_failed' });
    }
}
async function handleSharedArtifactRead(deps, req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    const kind = String(req.params.kind ?? '');
    if (kind !== 'stl' && kind !== 'glb' && kind !== 'usdz') {
        res.status(400).json({ error: 'unknown_shared_artifact', keys: ['stl', 'glb', 'usdz'] });
        return;
    }
    try {
        const found = await lookupSharedJob(deps.pool, String(req.params.token ?? ''));
        if (found.status !== 200) {
            res.status(found.status).json({ error: found.error, message: found.message });
            return;
        }
        const stlFile = (0, data_dir_1.artifactPath)((0, data_dir_1.jobDir)(deps.dataRoot, found.share.owner_sub, found.job.job_id), 'stl');
        if (!node_fs_1.default.existsSync(stlFile)) {
            res.status(404).json({ error: 'artifact_not_found' });
            return;
        }
        const stlBytes = node_fs_1.default.readFileSync(stlFile);
        const baseName = found.job.title.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60) || 'part';
        if (kind === 'stl') {
            if (req.query.download !== undefined)
                res.setHeader('Content-Disposition', `attachment; filename="${baseName}.stl"`);
            res.type('model/stl').send(stlBytes);
            return;
        }
        const mesh = (0, parse_stl_1.fromStl)(new Uint8Array(stlBytes));
        const payload = kind === 'glb' ? Buffer.from((0, export_glb_1.toGlb)(mesh, { name: baseName })) : Buffer.from((0, export_usdz_1.toUsdz)(mesh, baseName));
        if (req.query.download !== undefined || kind === 'usdz') {
            res.setHeader('Content-Disposition', `${req.query.download !== undefined ? 'attachment' : 'inline'}; filename="${baseName}.${kind}"`);
        }
        res.type(kind === 'glb' ? 'model/gltf-binary' : 'model/vnd.usdz+zip').send(payload);
    }
    catch (error) {
        logger.error({ err: error }, 'Shared artifact read failed');
        res.status(500).json({ error: 'share_artifact_failed' });
    }
}
async function handleCreateShare(deps, req, res) {
    const job = req.scanJob;
    const sub = req.scanSub;
    if (!(0, job_outputs_1.requireCurrentOutput)(job, res, false))
        return;
    const label = String((req.body ?? {}).label ?? '').trim().slice(0, 80);
    const token = (0, node_crypto_1.randomBytes)(24).toString('base64url');
    try {
        const { rows } = await deps.pool.query(`INSERT INTO scan_print_share_link (job_id, owner_sub, share_token, label) VALUES ($1, $2, $3, $4) RETURNING ${SHARE_COLUMNS}`, [job.job_id, sub, token, label]);
        res.status(201).json({ share: publicShare(rows[0]) });
    }
    catch (error) {
        logger.error({ err: error, jobId: job.job_id }, 'Share link creation failed');
        res.status(500).json({ error: 'share_create_failed', message: 'Could not create a share link for this model.' });
    }
}
async function handleRevokeShare(deps, req, res) {
    const job = req.scanJob;
    const sub = req.scanSub;
    let shareId;
    try {
        shareId = (0, data_dir_1.requireUuid)(req.params.shareId);
    }
    catch {
        res.status(400).json({ error: 'invalid_share_id' });
        return;
    }
    const { rows } = await deps.pool.query(`UPDATE scan_print_share_link SET revoked_at = $4 WHERE owner_sub = $1 AND job_id = $2 AND share_id = $3 RETURNING ${SHARE_COLUMNS}`, [sub, job.job_id, shareId, new Date().toISOString()]);
    const updated = rows[0];
    if (!updated) {
        res.status(404).json({ error: 'share_not_found' });
        return;
    }
    res.json({ share: publicShare(updated) });
}
/**
 * @description Create the share-link management and read-only shared viewer routes (`RP-SCN-05`).
 */
function createShareRoutes(deps) {
    const router = (0, express_1.Router)();
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        req.scanSub = sub;
        next();
    });
    router.get('/jobs/:jobId/shares', (0, job_outputs_1.withCurrentJob)(deps, async (req, res) => {
        const job = req.scanJob;
        const { rows } = await deps.pool.query(`SELECT ${SHARE_COLUMNS} FROM scan_print_share_link WHERE owner_sub = $1 AND job_id = $2 ORDER BY created_at DESC`, [req.scanSub, job.job_id]);
        res.json({ shares: rows.map(publicShare) });
    }, 'read'));
    router.post('/jobs/:jobId/shares', (0, job_outputs_1.withCurrentJob)(deps, (req, res) => handleCreateShare(deps, req, res), 'write'));
    router.delete('/jobs/:jobId/shares/:shareId', (0, job_outputs_1.withCurrentJob)(deps, (req, res) => handleRevokeShare(deps, req, res), 'write'));
    router.get('/shared/:token', (req, res) => handleSharedViewerRead(deps, req, res));
    router.get('/shared/:token/artifacts/:kind', (req, res) => handleSharedArtifactRead(deps, req, res));
    return router;
}
//# sourceMappingURL=share-routes.js.map