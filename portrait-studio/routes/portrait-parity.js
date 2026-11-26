"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.17.10 tool parity helpers and routes: portrait-read (GET /portraits/:id), portrait-provider-status (GET /provider-status with daily cap usage), owned photo-reference resolution for JSON POST /portraits (CREATE-TOOL-PORTRAIT-02), owner-scoped POST /portraits/:id/rerun for finished and failed rows (CREATE-TOOL-PORTRAIT-03), and gallery export-link + cross-app handoff routes (CREATE-TOOL-PORTRAIT-09).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HANDOFF_TARGETS = exports.NAMED_EXPORT_PRESETS = void 0;
exports.resolveNamedExportPreset = resolveNamedExportPreset;
exports.resolveHandoffTarget = resolveHandoffTarget;
exports.hasSpoofedScope = hasSpoofedScope;
exports.parseCreateOptions = parseCreateOptions;
exports.formatPortraitSummary = formatPortraitSummary;
exports.formatPortraitDetail = formatPortraitDetail;
exports.resolveOwnedPhotoReference = resolveOwnedPhotoReference;
exports.registerPortraitParityRoutes = registerPortraitParityRoutes;
const fs = __importStar(require("node:fs"));
const crypto = __importStar(require("node:crypto"));
const express_1 = require("express");
const sharp_1 = __importDefault(require("sharp"));
const portrait_catalog_1 = require("./portrait-catalog");
const portrait_authorization_1 = require("./portrait-authorization");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPOOF_KEYS = new Set(['tenant', 'tenantId', 'owner', 'ownerSub', 'userSub', 'issuer', 'ownerIssuer', 'workspace']);
const LAYER_KEYS = ['background', 'attire', 'headwear', 'prop', 'finish', 'framing'];
exports.NAMED_EXPORT_PRESETS = {
    original: { preset: 'original', size: 'original', width: null, height: null, label: 'Original PNG' },
    linkedin: { preset: 'linkedin', size: '600', width: 600, height: 600, label: 'LinkedIn square (600×600)' },
    square: { preset: 'square', size: '600', width: 600, height: 600, label: 'Square 600×600' },
    passport: { preset: 'passport', size: '600', width: 600, height: 600, label: 'Passport 600×600' },
    '600': { preset: '600', size: '600', width: 600, height: 600, label: 'Passport 600×600' },
    '300': { preset: '300', size: '300', width: 300, height: 300, label: 'Passport 300×300' },
    print: { preset: 'print', size: 'portrait', width: 1200, height: 1800, label: 'Portrait 4×6 print (1200×1800)' },
    '4x6': { preset: '4x6', size: 'portrait', width: 1200, height: 1800, label: 'Portrait 4×6 print (1200×1800)' },
    portrait: { preset: 'portrait', size: 'portrait', width: 1200, height: 1800, label: 'Portrait 4×6 print (1200×1800)' },
    '6x4': { preset: '6x4', size: 'landscape', width: 1800, height: 1200, label: 'Landscape 6×4 print (1800×1200)' },
    landscape: { preset: 'landscape', size: 'landscape', width: 1800, height: 1200, label: 'Landscape 6×4 print (1800×1200)' },
};
exports.HANDOFF_TARGETS = {
    create: { id: 'create', label: 'Create (Image Editor)' },
    'publishing-studio': { id: 'publishing-studio', label: 'Publishing Studio' },
    video: { id: 'video', label: 'Video Editor' },
    presentations: { id: 'presentations', label: 'Presentations' },
    'design-studio': { id: 'design-studio', label: 'Design Studio' },
    'brand-graphics': { id: 'brand-graphics', label: 'Brand Graphics' },
};
/** @description Resolve a named export preset (fail-closed). */
function resolveNamedExportPreset(raw) {
    if (raw === undefined || raw === null || raw === '')
        return exports.NAMED_EXPORT_PRESETS.original;
    if (typeof raw !== 'string' && typeof raw !== 'number')
        return null;
    const key = String(raw).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(exports.NAMED_EXPORT_PRESETS, key) ? exports.NAMED_EXPORT_PRESETS[key] : null;
}
/** @description Resolve a handoff target app (fail-closed). */
function resolveHandoffTarget(raw) {
    if (typeof raw !== 'string')
        return null;
    const key = raw.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(exports.HANDOFF_TARGETS, key) ? exports.HANDOFF_TARGETS[key] : null;
}
/** @description Detect caller-supplied scope spoofing keys on JSON bodies or queries. */
function hasSpoofedScope(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record))
        return false;
    return Object.keys(record).some((key) => SPOOF_KEYS.has(key));
}
/** @description Parse options JSON or flat swap fields from a create request body. */
function parseCreateOptions(body, defaults = {}) {
    const out = { ...defaults };
    const rawOptions = body?.options;
    if (typeof rawOptions === 'string') {
        try {
            Object.assign(out, JSON.parse(rawOptions));
        }
        catch { /* defaults stay */ }
    }
    else if (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) {
        Object.assign(out, rawOptions);
    }
    for (const key of LAYER_KEYS) {
        if (typeof body?.[key] === 'string')
            out[key] = body[key];
    }
    if (typeof body?.notes === 'string')
        out.notes = body.notes;
    return out;
}
function safeJsonObject(value) {
    if (!value)
        return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : {};
        }
        catch {
            return {};
        }
    }
    return typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}
function buildExportLinks(id) {
    const enc = encodeURIComponent(id);
    const out = {};
    for (const key of ['original', '300', '600', 'portrait', 'landscape', 'linkedin', 'square', 'print']) {
        const preset = exports.NAMED_EXPORT_PRESETS[key];
        const url = preset.size === 'original'
            ? `/api/portrait-studio/portraits/${enc}/image?download=1`
            : `/api/portrait-studio/portraits/${enc}/export?size=${encodeURIComponent(preset.size)}`;
        out[key] = { preset: preset.preset, size: preset.size, width: preset.width, height: preset.height, label: preset.label, downloadUrl: url };
    }
    return out;
}
/** @description Enrich a gallery list row with stable URLs and rerun flag without exposing disk paths. */
function formatPortraitSummary(row) {
    const id = String(row.portrait_id || '');
    const enc = encodeURIComponent(id);
    const done = row.status === 'done';
    const resultUrl = done ? `/api/portrait-studio/portraits/${enc}/image` : null;
    const downloadUrl = done ? `/api/portrait-studio/portraits/${enc}/image?download=1` : null;
    const canRerun = Boolean(row.has_source ?? row.source_path);
    const { source_path: _s, output_path: _o, original_path: _orig, has_source: _hs, ...rest } = row;
    return { ...rest, id, resultUrl, downloadUrl, sourceUrl: `/api/portrait-studio/portraits/${enc}/source`, canRerun };
}
/** @description Format a single owned portrait record with settings and export links (no disk paths). */
function formatPortraitDetail(row) {
    const summary = formatPortraitSummary(row);
    const id = String(row.portrait_id || '');
    const options = safeJsonObject(row.options);
    const done = row.status === 'done';
    const subjects = typeof options.subjects === 'number' ? options.subjects : (row.subjects ?? null);
    return { ...summary, options, subjects, exports: done ? buildExportLinks(id) : {} };
}
function sourceOwnerKey(ctx) {
    const actor = (0, portrait_authorization_1.portraitActor)(ctx);
    if (!actor.issuer || !actor.sub || actor.principalId === undefined || actor.principalId === '' || !Array.isArray(actor.tenantIds) || actor.tenantIds.length !== 1)
        return null;
    return crypto.createHash('sha256').update(JSON.stringify([actor.issuer, actor.sub, String(actor.principalId), actor.tenantIds[0]])).digest('hex');
}
async function querySourceDb(ctx, ownerKey, fn) {
    const pool = ctx.pool;
    if (typeof pool.connect !== 'function')
        return fn(ctx.pool.query.bind(ctx.pool));
    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        await client.query(`SELECT set_config('portrait_source.owner_key', $1, true)`, [ownerKey]);
        const result = await fn(client.query.bind(client));
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
async function readSourceAssetBytes(query, ownerKey, assetId) {
    const meta = await query(`SELECT id, bytes, sha256 FROM portrait_source_assets WHERE owner_key = $1 AND id = $2`, [ownerKey, assetId]);
    if (!meta.rows.length)
        return null;
    const chunks = await query(`SELECT data_base64 FROM portrait_source_chunks WHERE owner_key = $1 AND asset_id = $2 ORDER BY byte_offset`, [ownerKey, assetId]);
    if (!chunks.rows.length)
        return null;
    return Buffer.concat(chunks.rows.map((row) => Buffer.from(String(row.data_base64 || ''), 'base64')));
}
async function cropPhotoBytes(bytes, crop) {
    if (!crop)
        return bytes;
    const left = Math.max(0, Math.round(Number(crop.x) || 0));
    const top = Math.max(0, Math.round(Number(crop.y) || 0));
    const width = Math.max(1, Math.round(Number(crop.w) || 0));
    const height = Math.max(1, Math.round(Number(crop.h) || 0));
    try {
        const meta = await (0, sharp_1.default)(bytes).metadata();
        if (!meta.width || !meta.height)
            return bytes;
        const cl = Math.min(left, Math.max(0, meta.width - 1));
        const ct = Math.min(top, Math.max(0, meta.height - 1));
        const cw = Math.max(1, Math.min(width, meta.width - cl));
        const ch = Math.max(1, Math.min(height, meta.height - ct));
        const targetW = Math.min(1280, cw);
        return await (0, sharp_1.default)(bytes).extract({ left: cl, top: ct, width: cw, height: ch }).resize(targetW, Math.max(1, Math.round(ch * (targetW / cw)))).png().toBuffer();
    }
    catch {
        return bytes;
    }
}
/** @description Resolve an owned photo reference (sourceProjectId, sourceAssetId, or portraitId) for JSON portrait creation. */
async function resolveOwnedPhotoReference(ctx, sub, body, ownedRow) {
    const projectId = typeof body.sourceProjectId === 'string' ? body.sourceProjectId.trim() : '';
    const assetId = typeof body.sourceAssetId === 'string' ? body.sourceAssetId.trim() : '';
    const portraitId = typeof body.portraitId === 'string' ? body.portraitId.trim() : '';
    if (!projectId && !assetId && !portraitId) {
        return { status: 400, error: 'photo is required (multipart field "photo" or owned sourceProjectId, sourceAssetId, or portraitId)' };
    }
    if (portraitId) {
        if (!UUID_RE.test(portraitId))
            return { status: 400, error: 'invalid portraitId' };
        const row = await ownedRow(ctx, portraitId, sub);
        if (!row)
            return { status: 404, error: 'photo_reference_not_found' };
        const sourcePath = String(row.source_path || '');
        if (!sourcePath || !fs.existsSync(sourcePath))
            return { status: 409, error: 'portrait_source_unavailable' };
        return { buffer: fs.readFileSync(sourcePath), defaults: { mode: String(row.mode || 'professional'), style: String(row.style || ''), options: safeJsonObject(row.options), title: String(row.title || '') } };
    }
    const ownerKey = sourceOwnerKey(ctx);
    if (!ownerKey)
        return { status: 403, error: 'source_original_actor_required' };
    if (assetId) {
        if (!UUID_RE.test(assetId))
            return { status: 400, error: 'invalid sourceAssetId' };
        const bytes = await querySourceDb(ctx, ownerKey, (q) => readSourceAssetBytes(q, ownerKey, assetId));
        if (!bytes)
            return { status: 404, error: 'photo_reference_not_found' };
        return { buffer: bytes, defaults: {} };
    }
    if (!UUID_RE.test(projectId))
        return { status: 400, error: 'invalid sourceProjectId' };
    return resolveSourceProjectPhoto(ctx, ownerKey, projectId);
}
async function resolveSourceProjectPhoto(ctx, ownerKey, projectId) {
    const loaded = await querySourceDb(ctx, ownerKey, async (q) => {
        const proj = await q(`SELECT id, current_revision, title FROM portrait_source_projects WHERE owner_key = $1 AND id = $2`, [ownerKey, projectId]);
        if (!proj.rows.length)
            return null;
        const rev = await q(`SELECT model FROM portrait_source_revisions WHERE owner_key = $1 AND project_id = $2 AND revision = $3`, [ownerKey, projectId, Number(proj.rows[0].current_revision)]);
        if (!rev.rows.length)
            return null;
        const model = safeJsonObject(rev.rows[0].model);
        const photos = Array.isArray(model.photos) ? model.photos : [];
        const first = photos[0];
        if (!first || typeof first.assetId !== 'string')
            return { empty: true };
        const bytes = await readSourceAssetBytes(q, ownerKey, first.assetId);
        if (!bytes)
            return null;
        return { empty: false, model, first, bytes };
    });
    if (!loaded)
        return { status: 404, error: 'photo_reference_not_found' };
    if (loaded.empty)
        return { status: 400, error: 'source_project_has_no_photo' };
    const crops = Array.isArray(loaded.first.crops) ? loaded.first.crops : [];
    const cropped = await cropPhotoBytes(loaded.bytes, crops[0]);
    const settings = safeJsonObject(loaded.model.settings);
    if (typeof loaded.model.notes === 'string' && loaded.model.notes)
        settings.notes = loaded.model.notes;
    return {
        buffer: cropped,
        defaults: {
            mode: typeof loaded.model.mode === 'string' ? loaded.model.mode : 'professional',
            style: typeof loaded.model.style === 'string' ? loaded.model.style : '',
            options: settings,
            title: typeof loaded.model.title === 'string' ? loaded.model.title : '',
        },
    };
}
function errorStatus(err, fallback) {
    return err && typeof err === 'object' && 'status' in err && typeof err.status === 'number' ? err.status : fallback;
}
async function readProviderSummary(deps, sub) {
    const chosen = await deps.portraitProviderFor(sub);
    if (!chosen.ok || !chosen.provider) {
        return { configured: false, available: false, provider: chosen.provider?.id ?? null, costClass: null, unavailable: chosen.refusal ?? 'portrait_provider_unavailable', detail: chosen.detail ?? '', hint: chosen.detail ?? '' };
    }
    const provider = chosen.provider;
    if (provider.healthCheck) {
        const health = await provider.healthCheck();
        return { configured: health.ok, available: health.ok, provider: provider.id, costClass: provider.costClass, unavailable: health.ok ? null : 'portrait_provider_unavailable', detail: health.detail, ...(health.ok ? {} : { hint: health.detail }) };
    }
    return { configured: true, available: true, provider: provider.id, costClass: provider.costClass, unavailable: null, detail: 'credential present (this provider has no live probe)' };
}
async function handleProviderStatus(deps, res) {
    const actor = (0, portrait_authorization_1.portraitActor)(deps.ctx);
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'read');
    const capRow = await deps.ctx.pool.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status IN ('queued','generating'))::int AS active
       FROM ps_portraits WHERE user_sub = $1 AND owner_issuer = $2 AND created_at > NOW() - INTERVAL '24 hours'`, [actor.sub, actor.issuer]);
    const used = Number(capRow.rows[0]?.n ?? 0);
    const active = Number(capRow.rows[0]?.active ?? 0);
    const provider = await readProviderSummary(deps, actor.sub);
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'read');
    res.set('Cache-Control', 'private, no-store').json({
        ...provider,
        dailyCap: { used, limit: deps.dailyCap, remaining: Math.max(0, deps.dailyCap - used), active, maxActive: deps.maxActivePerUser },
    });
}
async function handleReadPortrait(deps, id, res) {
    const actor = (0, portrait_authorization_1.portraitActor)(deps.ctx);
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'read');
    const row = await deps.ownedRow(deps.ctx, id, actor.sub);
    if (!row) {
        res.status(404).json({ error: 'portrait not found' });
        return;
    }
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'read', id);
    res.set('Cache-Control', 'private, no-store').json({ portrait: formatPortraitDetail(row) });
}
async function handleRerunPortrait(deps, id, body, res) {
    const actor = (0, portrait_authorization_1.portraitActor)(deps.ctx);
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'create');
    if (hasSpoofedScope(body)) {
        res.status(400).json({ error: 'scope fields are not allowed' });
        return;
    }
    if (body?.id !== undefined && String(body.id) !== id) {
        res.status(400).json({ error: 'portrait id mismatch' });
        return;
    }
    const row = await deps.ownedRow(deps.ctx, id, actor.sub);
    if (!row) {
        res.status(404).json({ error: 'portrait not found' });
        return;
    }
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'create', id);
    const sourcePath = String(row.source_path || '');
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        res.status(409).json({ error: 'portrait_source_unavailable', detail: 'The saved cropped photo for this portrait is no longer available.' });
        return;
    }
    const mode = String(row.mode || 'professional');
    const style = String(row.style || '');
    const options = safeJsonObject(row.options);
    if (!(0, portrait_catalog_1.isPortraitMode)(mode) || !(0, portrait_catalog_1.findStyle)(mode, style)) {
        res.status(400).json({ error: 'saved portrait settings are no longer valid' });
        return;
    }
    const invalid = (0, portrait_catalog_1.validateOverrides)(options) || (0, portrait_catalog_1.validateSubjects)(mode, options.subjects);
    if (invalid) {
        res.status(400).json({ error: invalid });
        return;
    }
    const title = typeof row.title === 'string' ? row.title : '';
    await deps.startGeneration(res, { sub: actor.sub, mode, style, options, source: fs.readFileSync(sourcePath), title, rerunOf: id });
}
async function handleExportLink(deps, id, rawSize, res) {
    const actor = (0, portrait_authorization_1.portraitActor)(deps.ctx);
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'export');
    const preset = resolveNamedExportPreset(rawSize);
    if (!preset) {
        res.status(400).json({ error: `size must be one of: ${Object.keys(exports.NAMED_EXPORT_PRESETS).join(', ')}` });
        return;
    }
    const row = await deps.ownedRow(deps.ctx, id, actor.sub);
    if (!row || row.status !== 'done') {
        res.status(404).json({ error: 'portrait not found' });
        return;
    }
    const filePath = String(row.output_path || '');
    if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ error: 'image file not found' });
        return;
    }
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'export', id);
    const enc = encodeURIComponent(id);
    let width = preset.width;
    let height = preset.height;
    if (preset.size === 'original') {
        try {
            const m = await (0, sharp_1.default)(filePath).metadata();
            width = m.width ?? null;
            height = m.height ?? null;
        }
        catch { /* leave null */ }
    }
    const downloadUrl = preset.size === 'original'
        ? `/api/portrait-studio/portraits/${enc}/image?download=1`
        : `/api/portrait-studio/portraits/${enc}/export?size=${encodeURIComponent(preset.size)}`;
    const filename = preset.size === 'original' ? `portrait-${id.slice(0, 8)}.png` : `portrait-${id.slice(0, 8)}-${preset.width}x${preset.height}.png`;
    res.set('Cache-Control', 'private, no-store').json({
        portraitId: id, preset: preset.preset, size: preset.size, width, height, label: preset.label,
        mimeType: 'image/png', filename, downloadUrl, previewUrl: `/api/portrait-studio/portraits/${enc}/image`,
        availablePresets: Object.keys(exports.NAMED_EXPORT_PRESETS),
    });
}
async function handleHandoff(deps, id, body, res) {
    const actor = (0, portrait_authorization_1.portraitActor)(deps.ctx);
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'export');
    if (hasSpoofedScope(body)) {
        res.status(400).json({ error: 'scope fields are not allowed' });
        return;
    }
    if (body?.id !== undefined && String(body.id) !== id) {
        res.status(400).json({ error: 'portrait id mismatch' });
        return;
    }
    const target = resolveHandoffTarget(body?.targetApp);
    if (!target) {
        res.status(400).json({ error: `targetApp must be one of: ${Object.keys(exports.HANDOFF_TARGETS).join(', ')}` });
        return;
    }
    const preset = resolveNamedExportPreset(body?.size);
    if (!preset) {
        res.status(400).json({ error: `size must be one of: ${Object.keys(exports.NAMED_EXPORT_PRESETS).join(', ')}` });
        return;
    }
    const row = await deps.ownedRow(deps.ctx, id, actor.sub);
    if (!row || row.status !== 'done') {
        res.status(404).json({ error: 'portrait not found' });
        return;
    }
    const filePath = String(row.output_path || '');
    if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ error: 'image file not found' });
        return;
    }
    await (0, portrait_authorization_1.requirePortraitPermission)(deps.ctx, 'export', id);
    const enc = encodeURIComponent(id);
    const source = preset.size === 'original'
        ? `/api/portrait-studio/portraits/${enc}/image`
        : `/api/portrait-studio/portraits/${enc}/export?size=${encodeURIComponent(preset.size)}`;
    const name = preset.size === 'original' ? `portrait-${id.slice(0, 8)}.png` : `portrait-${id.slice(0, 8)}-${preset.width}x${preset.height}.png`;
    const openUrl = `/cockpit/?app=${encodeURIComponent(target.id)}&sourceApp=portrait-studio&portraitId=${enc}&image=${encodeURIComponent(source)}`;
    res.set('Cache-Control', 'private, no-store').json({
        ok: true, portraitId: id, targetApp: target.id, targetLabel: target.label, preset: preset.preset,
        artifact: { type: 'image/png', name, source },
        downloadUrl: preset.size === 'original' ? `${source}?download=1` : source,
        openUrl,
    });
}
/** @description Mount Portrait Studio tool-parity HTTP routes onto the package router. */
function registerPortraitParityRoutes(router, deps) {
    const parseJson = (0, express_1.json)({ limit: '16kb' });
    router.get('/provider-status', async (_req, res) => {
        try {
            await handleProviderStatus(deps, res);
        }
        catch (err) {
            res.status(errorStatus(err, 500)).json({ error: err instanceof Error ? err.message : 'provider status failed' });
        }
    });
    router.get('/portraits/:id', async (req, res) => {
        try {
            await handleReadPortrait(deps, req.params.id, res);
        }
        catch (err) {
            res.status(errorStatus(err, 500)).json({ error: err instanceof Error ? err.message : 'portrait read failed' });
        }
    });
    router.post('/portraits/:id/rerun', parseJson, async (req, res) => {
        try {
            await handleRerunPortrait(deps, req.params.id, req.body, res);
        }
        catch (err) {
            res.status(errorStatus(err, 500)).json({ error: err instanceof Error ? err.message : 'portrait rerun failed' });
        }
    });
    router.get('/portraits/:id/export-link', async (req, res) => {
        try {
            await handleExportLink(deps, req.params.id, req.query.size, res);
        }
        catch (err) {
            res.status(errorStatus(err, 500)).json({ error: err instanceof Error ? err.message : 'portrait export link failed' });
        }
    });
    router.post('/portraits/:id/handoff', parseJson, async (req, res) => {
        try {
            await handleHandoff(deps, req.params.id, req.body, res);
        }
        catch (err) {
            res.status(errorStatus(err, 500)).json({ error: err instanceof Error ? err.message : 'portrait handoff failed' });
        }
    });
}
