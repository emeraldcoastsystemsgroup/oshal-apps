"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPsdRoutes = registerPsdRoutes;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Require explicit PSD conversion review, current original-owner grants and immutable-source export authority.
 */
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const create_psd_1 = require("./create-psd");
const create_project_authorization_1 = require("./create-project-authorization");
const create_project_validation_1 = require("./create-project-validation");
const create_project_types_1 = require("./create-project-types");
let activeRequests = 0;
const admissions = new WeakMap();
const working = new WeakSet();
function release(req) { admissions.get(req)?.(); }
function complete(req, res) {
    working.delete(req);
    if (!res.socket || res.destroyed || res.writableFinished)
        release(req);
}
function artifactPort() {
    try {
        return require('@/shared/artifact-exchange');
    }
    catch {
        throw new create_project_types_1.ProjectError(403, 'psd_artifact_unavailable');
    }
}
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const sha = (bytes) => (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex');
function check(env, owner, write, exporting = false) {
    return async () => { await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, 'read', owner); if (write)
        await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, 'create', owner); if (exporting)
        await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, 'export', owner); };
}
async function artifactMetadata(ref) {
    const port = artifactPort();
    if (port.native !== true || !/^art_[a-f0-9]{64}$/.test(ref))
        throw new create_project_types_1.ProjectError(403, 'psd_artifact_unavailable');
    let value;
    try {
        value = await port.metadata(ref);
    }
    catch {
        throw new create_project_types_1.ProjectError(403, 'psd_artifact_unavailable');
    }
    if (!record(value) || value.ref !== ref || !Number.isSafeInteger(value.size) || Number(value.size) < 1 || Number(value.size) > create_psd_1.PSD_PROFILE.fileBytes
        || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
        || typeof value.type !== 'string' || !['image/vnd.adobe.photoshop', 'image/x-photoshop', 'application/x-photoshop', 'application/octet-stream'].includes(value.type))
        throw new create_project_types_1.ProjectError(400, 'psd_artifact_required');
    return value;
}
async function artifactBytes(ref, confirm) {
    const port = artifactPort();
    const meta = await artifactMetadata(ref), parts = [];
    let offset = 0;
    while (offset < meta.size) {
        await confirm();
        let value;
        try {
            value = await port.chunk(ref, offset);
        }
        catch {
            throw new create_project_types_1.ProjectError(403, 'psd_artifact_unavailable');
        }
        if (!record(value) || value.ref !== ref || value.offset !== offset || value.size !== meta.size || typeof value.dataBase64 !== 'string' || value.dataBase64.length > 87384)
            throw new create_project_types_1.ProjectError(503, 'psd_artifact_invalid');
        const bytes = Buffer.from(value.dataBase64, 'base64');
        if (!bytes.length || bytes.length > 65536 || bytes.toString('base64') !== value.dataBase64 || offset + bytes.length > meta.size || value.done !== (offset + bytes.length === meta.size))
            throw new create_project_types_1.ProjectError(503, 'psd_artifact_invalid');
        offset += bytes.length;
        parts.push(bytes);
    }
    const bytes = Buffer.concat(parts, offset);
    if (sha(bytes) !== meta.sha256)
        throw new create_project_types_1.ProjectError(503, 'psd_artifact_invalid');
    const current = async () => { await confirm(); const latest = await artifactMetadata(ref); if (latest.size !== meta.size || latest.type !== meta.type || latest.sha256 !== meta.sha256)
        throw new create_project_types_1.ProjectError(409, 'psd_source_changed'); };
    await current();
    return { bytes, confirm: current };
}
/** All admission precedes decoding; caller-selected identity, scope and extra fields are refused. */
function registerPsdRoutes(router, env) {
    const admit = (write) => (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        if (activeRequests >= 2) {
            env.guards.sendError(res, new create_project_types_1.ProjectError(503, 'psd_import_busy'));
            return;
        }
        activeRequests++;
        let released = false;
        admissions.set(req, () => { if (!released) {
            released = true;
            activeRequests--;
            admissions.delete(req);
        } });
        // Native transport supplies a fully buffered request without stream events.
        if (typeof req.once === 'function')
            req.once('aborted', () => { if (!working.has(req))
                release(req); });
        res.once('finish', () => { if (!working.has(req))
            release(req); });
        res.once('close', () => { if (!working.has(req))
            release(req); });
        Promise.resolve().then(() => env.guards.personalOnly(req)).then(() => (0, create_project_authorization_1.requireProjectAccess)(env.ctx, 'read'))
            .then(owner => check(env, owner, write)()).then(() => next()).catch(error => { release(req); env.guards.sendError(res, error); });
    };
    const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: create_psd_1.PSD_PROFILE.fileBytes, files: 1, fields: 4, fieldSize: 1024, parts: 6 } }).single('psd');
    const decode = (req, res, next) => upload(req, res, node_async_hooks_1.AsyncResource.bind(next));
    const jsonBody = (0, express_1.json)({ limit: 4096, strict: true });
    for (const write of [false, true]) {
        router.post(write ? '/psd-imports' : '/psd-inspect', admit(write), decode, (req, res) => {
            working.add(req);
            void (async () => {
                (0, create_project_validation_1.exactFields)(req.body ?? {}, write ? ['title', 'mode', 'expectedSha256', 'requestKey'] : []);
                if (!req.file)
                    throw new create_project_types_1.ProjectError(400, 'psd_file_required');
                const owner = await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, 'read'), confirm = check(env, owner, write), bytes = req.file.buffer;
                await confirm();
                const parsed = await (0, create_psd_1.parsePsd)(bytes, env.ctx.appPackageDir);
                await confirm();
                if (!write) {
                    res.json((0, create_psd_1.psdInspection)(bytes, parsed));
                    return;
                }
                const selection = (0, create_psd_1.psdSelection)(req.body), result = await (0, create_psd_1.importPsd)(env.store, owner, bytes, parsed, selection, await env.validator, env.ctx.appPackageDir, env.dataRoot, confirm);
                await confirm();
                res.status(201).json(result);
            })().catch(error => env.guards.sendError(res, error)).finally(() => complete(req, res));
        });
        if (write)
            router.post('/psd-artifact-imports', admit(true), jsonBody, (req, res) => {
                working.add(req);
                void (async () => {
                    (0, create_project_validation_1.exactFields)(req.body, write ? ['ref', 'title', 'mode', 'expectedSha256', 'requestKey'] : ['ref']);
                    if (typeof req.body.ref !== 'string')
                        throw new create_project_types_1.ProjectError(400, 'psd_artifact_required');
                    const owner = await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, 'read'), source = await artifactBytes(req.body.ref, check(env, owner, write));
                    const parsed = await (0, create_psd_1.parsePsd)(source.bytes, env.ctx.appPackageDir);
                    await source.confirm();
                    if (!write) {
                        res.json((0, create_psd_1.psdInspection)(source.bytes, parsed));
                        return;
                    }
                    const result = await (0, create_psd_1.importPsd)(env.store, owner, source.bytes, parsed, (0, create_psd_1.psdSelection)(req.body), await env.validator, env.ctx.appPackageDir, env.dataRoot, source.confirm);
                    await source.confirm();
                    res.status(201).json(result);
                })().catch(error => env.guards.sendError(res, error)).finally(() => complete(req, res));
            });
    }
    router.get('/psd-artifacts/:ref/inspect', admit(false), (req, res) => {
        working.add(req);
        void (async () => {
            if (Object.keys(req.query).length)
                throw new create_project_types_1.ProjectError(400, 'invalid_psd_selection');
            const owner = await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, 'read'), source = await artifactBytes(String(req.params.ref), check(env, owner, false));
            const parsed = await (0, create_psd_1.parsePsd)(source.bytes, env.ctx.appPackageDir);
            await source.confirm();
            res.json((0, create_psd_1.psdInspection)(source.bytes, parsed));
        })().catch(error => env.guards.sendError(res, error)).finally(() => complete(req, res));
    });
    for (const content of [false, true])
        router.get(`/projects/:id/${content ? 'psd-original' : 'psd-source'}`, admit(false), (req, res) => {
            working.add(req);
            void (async () => {
                const owner = await (0, create_project_authorization_1.requireProjectAccess)(env.ctx, 'read'), confirm = check(env, owner, false, content);
                await confirm();
                const result = await (0, create_psd_1.readPsdSource)(env.store, owner, (0, create_project_validation_1.projectId)(req.params.id), content, confirm);
                await confirm();
                if (content)
                    res.set('X-Content-Type-Options', 'nosniff').set('Content-Disposition', 'attachment; filename="original.psd"').type('image/vnd.adobe.photoshop').send(result.bytes);
                else
                    res.json({ source: (0, create_psd_1.psdSourceMetadata)(result.source) });
            })().catch(error => env.guards.sendError(res, error)).finally(() => complete(req, res));
        });
    // Multer/body-parser failures bypass the work callback; release the reservation
    // here too. Native buffered responses do not emit the socket finish event.
    router.use((error, req, _res, next) => { release(req); next(error); });
}
