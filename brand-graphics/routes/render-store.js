"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDataRoot = resolveDataRoot;
exports.ownerHash = ownerHash;
exports.ownerRenderDir = ownerRenderDir;
exports.assertJobId = assertJobId;
exports.mp4FilePath = mp4FilePath;
exports.listRenderJobs = listRenderJobs;
exports.getRenderJob = getRenderJob;
exports.saveRenderJob = saveRenderJob;
exports.deleteRenderJob = deleteRenderJob;
exports.readSavedBrandKit = readSavedBrandKit;
exports.saveBrandKit = saveBrandKit;
exports.resolveOwnerBrandKit = resolveOwnerBrandKit;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: per-owner lasting storage for render job history, rendered MP4 clips, and personal brand kits under OSHAL_PACKAGE_DATA_DIR.
 */
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const render_types_1 = require("./render-types");
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JOBS_PER_OWNER = 100;
function resolveDataRoot(overrideDir) {
    const configured = overrideDir || process.env.OSHAL_PACKAGE_DATA_DIR;
    if (configured && configured.trim())
        return path.resolve(configured.trim());
    return path.join(os.tmpdir(), 'brand-graphics-data');
}
function ownerHash(owner) {
    return crypto.createHash('sha256').update(JSON.stringify([owner.issuer, owner.sub])).digest('hex');
}
function ownerRenderDir(owner, overrideDir) {
    const root = resolveDataRoot(overrideDir);
    const dir = path.join(root, 'renders', ownerHash(owner));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}
function assertJobId(raw) {
    if (typeof raw !== 'string' || !JOB_ID.test(raw)) {
        throw new render_types_1.RenderError(400, 'invalid_job_id', 'Render job id must be a UUID v4.');
    }
    return raw.toLowerCase();
}
function mp4FilePath(owner, jobId, overrideDir) {
    const id = assertJobId(jobId);
    const dir = ownerRenderDir(owner, overrideDir);
    const target = path.resolve(dir, `${id}.mp4`);
    if (path.dirname(target) !== path.resolve(dir)) {
        throw new render_types_1.RenderError(400, 'invalid_job_id', 'Invalid render path.');
    }
    return target;
}
function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath))
            return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    catch {
        return fallback;
    }
}
function writeJsonAtomic(filePath, value) {
    const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
}
function listRenderJobs(owner, overrideDir) {
    const file = path.join(ownerRenderDir(owner, overrideDir), 'jobs.json');
    const parsed = readJsonFile(file, []);
    if (!Array.isArray(parsed))
        return [];
    return parsed.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
function getRenderJob(owner, jobId, overrideDir) {
    const id = assertJobId(jobId);
    return listRenderJobs(owner, overrideDir).find((job) => job.id === id) || null;
}
function saveRenderJob(owner, job, overrideDir) {
    const dir = ownerRenderDir(owner, overrideDir);
    const file = path.join(dir, 'jobs.json');
    const existing = listRenderJobs(owner, overrideDir).filter((item) => item.id !== job.id);
    const next = [job, ...existing].slice(0, MAX_JOBS_PER_OWNER);
    writeJsonAtomic(file, next);
}
function deleteRenderJob(owner, jobId, overrideDir) {
    const id = assertJobId(jobId);
    const dir = ownerRenderDir(owner, overrideDir);
    const file = path.join(dir, 'jobs.json');
    const current = listRenderJobs(owner, overrideDir);
    const next = current.filter((item) => item.id !== id);
    if (next.length === current.length)
        return false;
    writeJsonAtomic(file, next);
    const clip = mp4FilePath(owner, id, overrideDir);
    if (fs.existsSync(clip))
        fs.unlinkSync(clip);
    return true;
}
function readSavedBrandKit(owner, overrideDir) {
    const file = path.join(ownerRenderDir(owner, overrideDir), 'brand-kit.json');
    const parsed = readJsonFile(file, null);
    if (!parsed || typeof parsed !== 'object')
        return null;
    try {
        return (0, render_types_1.parseBrandKitPatch)(parsed);
    }
    catch {
        return null;
    }
}
function saveBrandKit(owner, patch, overrideDir) {
    const file = path.join(ownerRenderDir(owner, overrideDir), 'brand-kit.json');
    const resolved = finalizeKit('my-brand', patch, 'saved-brand-kit');
    writeJsonAtomic(file, {
        brandName: resolved.brandName,
        primaryColor: resolved.primaryColor,
        accentColor: resolved.accentColor,
        backgroundColor: resolved.backgroundColor,
        logoRef: resolved.logoRef,
    });
    return resolved;
}
async function readCreateBrandKit(ctx, owner) {
    if (!ctx?.pool || typeof ctx.pool.connect !== 'function')
        return null;
    let client;
    try {
        client = await ctx.pool.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout='1500ms'");
        await client.query("SELECT set_config('create.owner_issuer',$1,true)", [owner.issuer]);
        await client.query("SELECT set_config('create.owner_sub',$1,true)", [owner.sub]);
        await client.query("SELECT set_config('oshal.current_issuer',$1,true)", [owner.issuer]);
        await client.query("SELECT set_config('oshal.current_subject',$1,true)", [owner.sub]);
        const res = await client.query('SELECT kit FROM create_brand_kits WHERE owner_issuer = $1 AND owner_sub = $2 LIMIT 1', [owner.issuer, owner.sub]);
        await client.query('COMMIT');
        const kit = res?.rows?.[0]?.kit;
        if (!kit || typeof kit !== 'object')
            return null;
        return (0, render_types_1.parseBrandKitPatch)({
            name: kit.name,
            colors: kit.colors,
            logo: kit.logo,
        });
    }
    catch {
        if (client)
            await client.query('ROLLBACK').catch(() => { });
        return null;
    }
    finally {
        if (client)
            client.release();
    }
}
function finalizeKit(brandStyle, patch, source) {
    return {
        brandStyle,
        brandName: (patch?.brandName && patch.brandName.trim()) || render_types_1.OPEN_SWARM_KIT.brandName,
        primaryColor: patch?.primaryColor || render_types_1.OPEN_SWARM_KIT.primaryColor,
        accentColor: patch?.accentColor || render_types_1.OPEN_SWARM_KIT.accentColor,
        backgroundColor: patch?.backgroundColor || render_types_1.OPEN_SWARM_KIT.backgroundColor,
        logoRef: patch?.logoRef ?? null,
        source,
    };
}
async function resolveOwnerBrandKit(ctx, owner, brandStyle, requestPatch, overrideDir) {
    if (brandStyle === 'oshal')
        return { ...render_types_1.OPEN_SWARM_KIT };
    if (requestPatch && (requestPatch.brandName || requestPatch.primaryColor || requestPatch.accentColor || requestPatch.backgroundColor)) {
        return finalizeKit('my-brand', requestPatch, 'request');
    }
    const fromCreate = await readCreateBrandKit(ctx, owner);
    if (fromCreate)
        return finalizeKit('my-brand', fromCreate, 'create-brand-kit');
    const fromSaved = readSavedBrandKit(owner, overrideDir);
    if (fromSaved)
        return finalizeKit('my-brand', fromSaved, 'saved-brand-kit');
    return finalizeKit('my-brand', null, 'fallback');
}
