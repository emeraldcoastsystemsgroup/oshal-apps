"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the print-set routes under a product.
 *                     |                             | GET /print-set lists the set (the finished manifest with its
 *                     |                             | sha256, or the set in progress), POST /print-set begins one from
 *                     |                             | the design's rows, PUT /print-set/parts/{partId} keeps one
 *                     |                             | exported STL (multipart `stl` + `meta`: the CAD Studio source
 *                     |                             | and the kernel's report) or records why the part is unprintable
 *                     |                             | (JSON {reason}), POST /print-set/finish writes the sheet, the
 *                     |                             | BOM and the manifest, POST /print-set/sent keeps a printer
 *                     |                             | hand-off as the print service answered it, and
 *                     |                             | GET /print-set/{file} serves one file of the finished set - the
 *                     |                             | name is looked up in the manifest this package wrote, so a
 *                     |                             | request never names a path on disk. Every route is owner
 *                     |                             | scoped through the project load. This package reaches no engine:
 *                     |                             | the page exports each part through CAD Studio with the person's
 *                     |                             | own session (the native kernel gives a package route no sibling
 *                     |                             | package and no engine of another package) and posts the bytes.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPrintSet = registerPrintSet;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const multer_1 = __importDefault(require("multer"));
const logger_1 = require("@/shared/logger");
const phase_model_1 = require("./phase-model");
const print_set_model_1 = require("./print-set-model");
const print_set_store_1 = require("./print-set-store");
const logger = (0, logger_1.createChildLogger)({ module: 'design-studio-print-set' });
const TYPES = Object.freeze({ '.stl': 'model/stl', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8' });
/** Answer a ModelError with its status; anything else is this package's 500. */
function refuse(res, error, what) {
    if (error instanceof phase_model_1.ModelError) {
        res.status(error.status).json({ error: error.code, field: error.field, message: error.message });
        return;
    }
    logger.error({ err: error }, `${what} failed`);
    res.status(500).json({ error: `${what.replace(/\s+/g, '_')}_failed` });
}
/** The listing of a product's set, 404 when nothing was begun. */
function registerListing(router, deps) {
    router.get('/projects/:id/print-set', async (req, res) => {
        const c = await deps.withProject(deps.pool, req, res);
        if (!c)
            return;
        try {
            const out = (0, print_set_store_1.listing)((0, print_set_store_1.setDir)(deps.dataRoot, c.sub, c.project.id));
            res.setHeader('Cache-Control', 'no-store');
            if (!out) {
                res.status(404).json({ error: 'no_print_set', message: 'no print set has been made for this product yet' });
                return;
            }
            res.json(out);
        }
        catch (error) {
            refuse(res, error, 'list print set');
        }
    });
}
/** Begin a set from the design's rows: the directory is wiped. */
function registerBegin(router, deps) {
    router.post('/projects/:id/print-set', async (req, res) => {
        const c = await deps.withProject(deps.pool, req, res);
        if (!c)
            return;
        try {
            const input = (0, print_set_model_1.validateSetInput)(req.body);
            const dir = (0, print_set_store_1.setDir)(deps.dataRoot, c.sub, c.project.id);
            (0, print_set_store_1.beginSet)(dir, { id: c.project.id, name: c.project.name }, input);
            logger.info({ sub: c.sub, projectId: c.project.id, parts: input.parts.length, engine: input.engine }, 'Print set begun');
            res.status(201).json((0, print_set_store_1.listing)(dir));
        }
        catch (error) {
            refuse(res, error, 'begin print set');
        }
    });
}
/** The multipart or JSON form of one part's arrival. */
function partBody(req) {
    const body = (req.body ?? {});
    if (req.file) {
        let meta = body.meta;
        if (typeof meta === 'string') {
            try {
                meta = JSON.parse(meta);
            }
            catch {
                throw new phase_model_1.ModelError('meta must be JSON', 'bad_print_set', 'meta');
            }
        }
        return { stl: req.file.buffer, meta, reason: null };
    }
    return { stl: null, meta: null, reason: body.reason };
}
/** One part: an exported STL with its source and report, or the reason it is unprintable. */
function registerPart(router, deps) {
    const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: print_set_model_1.CAPS.stlBytes, files: 1, fields: 4 } });
    const uploadErrors = [upload.single('stl'), ((error, _req, res, next) => {
            if (error instanceof multer_1.default.MulterError) {
                res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'stl_too_large' : 'upload_rejected', message: error.code === 'LIMIT_FILE_SIZE' ? `one STL is at most ${print_set_model_1.CAPS.stlBytes} bytes in a set` : error.message, maxBytes: print_set_model_1.CAPS.stlBytes });
                return;
            }
            next(error);
        })];
    router.put('/projects/:id/print-set/parts/:partId', ...uploadErrors, async (req, res) => {
        const c = await deps.withProject(deps.pool, req, res);
        if (!c)
            return;
        try {
            const id = (0, print_set_model_1.partId)(req.params.partId, 'partId');
            const dir = (0, print_set_store_1.setDir)(deps.dataRoot, c.sub, c.project.id);
            const { stl, meta, reason } = partBody(req);
            const part = stl ? (() => { const m = (0, print_set_model_1.validatePartMeta)(meta); return (0, print_set_store_1.addPart)(dir, id, stl, m.source, m.report); })() : (0, print_set_store_1.markUnprintable)(dir, id, (0, print_set_model_1.validateReason)(reason));
            logger.info({ sub: c.sub, projectId: c.project.id, partId: id, status: part.status }, 'Print set part recorded');
            res.json({ partId: id, part });
        }
        catch (error) {
            refuse(res, error, 'record print set part');
        }
    });
}
/** Finish the set, and keep a printer hand-off beside it. */
function registerFinishAndSent(router, deps) {
    router.post('/projects/:id/print-set/finish', async (req, res) => {
        const c = await deps.withProject(deps.pool, req, res);
        if (!c)
            return;
        try {
            const dir = (0, print_set_store_1.setDir)(deps.dataRoot, c.sub, c.project.id);
            const { manifestSha256 } = (0, print_set_store_1.finishSet)(dir);
            logger.info({ sub: c.sub, projectId: c.project.id, manifestSha256 }, 'Print set finished');
            res.json((0, print_set_store_1.listing)(dir));
        }
        catch (error) {
            refuse(res, error, 'finish print set');
        }
    });
    router.post('/projects/:id/print-set/sent', async (req, res) => {
        const c = await deps.withProject(deps.pool, req, res);
        if (!c)
            return;
        try {
            const dir = (0, print_set_store_1.setDir)(deps.dataRoot, c.sub, c.project.id);
            const done = (0, print_set_store_1.readManifest)(dir);
            if (!done)
                throw new phase_model_1.ModelError('no finished print set to send from', 'no_print_set', 'print-set', 409);
            const sent = (0, print_set_store_1.recordSent)(dir, (0, print_set_model_1.validateSent)(req.body, (0, print_set_store_1.servedFiles)(done.manifest)));
            res.status(201).json({ sent });
        }
        catch (error) {
            refuse(res, error, 'record print set hand-off');
        }
    });
}
/** One file of the finished set, by a name the manifest lists; the page downloads an STL as <product>-<part>.stl. */
function registerFile(router, deps) {
    router.get('/projects/:id/print-set/:file', async (req, res) => {
        const c = await deps.withProject(deps.pool, req, res);
        if (!c)
            return;
        try {
            const dir = (0, print_set_store_1.setDir)(deps.dataRoot, c.sub, c.project.id);
            const done = (0, print_set_store_1.readManifest)(dir);
            const name = String(req.params.file);
            if (!done || !(0, print_set_store_1.servedFiles)(done.manifest).has(name)) {
                res.status(404).json({ error: 'file_not_in_print_set', file: name });
                return;
            }
            const file = node_path_1.default.join(dir, name);
            if (!node_fs_1.default.existsSync(file)) {
                res.status(404).json({ error: 'file_not_in_print_set', file: name });
                return;
            }
            res.setHeader('Cache-Control', 'private, no-store');
            res.type(TYPES[node_path_1.default.extname(name)] || 'application/octet-stream');
            const slug = c.project.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'product';
            if (name.endsWith('.stl') || req.query.download !== undefined)
                res.setHeader('Content-Disposition', `attachment; filename="${name.endsWith('.stl') ? `${slug}-${name}` : name}"`);
            const lasting = res.lastingFile;
            const relative = node_path_1.default.relative(process.env.OSHAL_PACKAGE_DATA_DIR || '', file);
            if (typeof lasting === 'function' && process.env.OSHAL_PACKAGE_DATA_DIR && !relative.startsWith('..') && !node_path_1.default.isAbsolute(relative)) {
                lasting.call(res, relative.split(node_path_1.default.sep).join('/'));
                return;
            }
            res.sendFile(file);
        }
        catch (error) {
            refuse(res, error, 'read print set file');
        }
    });
}
/**
 * @description Mount the print-set routes on the package router.
 * @param router - The /api/design-studio router.
 * @param deps - The pool, the data root and the owner-scoped project load.
 */
function registerPrintSet(router, deps) {
    logger.info({ dataRoot: deps.dataRoot, files: print_set_model_1.SET_FILES }, 'Print-set routes mounted');
    registerListing(router, deps);
    registerBegin(router, deps);
    registerPart(router, deps);
    registerFinishAndSent(router, deps);
    registerFile(router, deps);
}
//# sourceMappingURL=print-set-routes.js.map