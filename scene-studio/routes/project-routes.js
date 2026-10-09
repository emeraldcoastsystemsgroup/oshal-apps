"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the project HTTP surface under the package's
 *                     |                             | oidc mount: list/create/read/rename/delete projects, read, write,
 *                     |                             | upload and delete files, call the allowlisted godot-mcp and Blender
 *                     |                             | Lab MCP tools, run a Godot project headless, render a preview,
 *                     |                             | export, restore a revision and import a Blender model into a Godot
 *                     |                             | project. Every handler re-derives the caller; every id is a
 *                     |                             | validated UUID; replies stay compact (a concierge reads them).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0: a pure move. The public project view, the error
 *                     |                             | classification behind refuse(), the title reader (now
 *                     |                             | projectTitle) and the integer and string option readers live in
 *                     |                             | project-view.ts, express-free, so the in-process package tools
 *                     |                             | answer exactly like these routes. refuse() writes the classified
 *                     |                             | status and body; every route answers byte-for-byte as before.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicProject = void 0;
exports.refuse = refuse;
exports.createProjectRoutes = createProjectRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const logger_1 = require("@/shared/logger");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const data_dir_1 = require("./data-dir");
const project_files_1 = require("./project-files");
const project_store_1 = require("./project-store");
const project_service_1 = require("./project-service");
const project_view_1 = require("./project-view");
Object.defineProperty(exports, "publicProject", { enumerable: true, get: function () { return project_view_1.publicProject; } });
const tool_contract_1 = require("./tool-contract");
const logger = (0, logger_1.createChildLogger)({ module: 'scene-studio-project-routes' });
/** @description Map a thrown error to its HTTP answer; false when it is unexpected. */
function refuse(res, error) {
    const failure = (0, project_view_1.classifyFailure)(error);
    if (!failure)
        return false;
    res.status(failure.status).json(failure.body);
    return true;
}
function fail(res, error, what, context = {}) {
    if (refuse(res, error))
        return;
    logger.error({ err: error, ...context }, `${what} failed`);
    res.status(500).json({ error: `${what.toLowerCase().replace(/\s+/g, '_')}_failed` });
}
function body(req) {
    const b = req.body;
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}
function outcome(res, out, status = 200) {
    res.status(status).json({ project: (0, project_view_1.publicProject)(out.project), changed: out.changed, ...out.extra });
}
/**
 * @description Build the project router (mounted under the package's oidc mount).
 * @param deps - Pool, engine, data root, caller resolver.
 * @returns The router.
 */
function createProjectRoutes(deps) {
    const router = (0, express_1.Router)();
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        req.sceneSub = sub;
        next();
    });
    router.param('projectId', async (req, res, next, value) => {
        try {
            const project = await (0, project_store_1.getProject)(deps.pool, req.sceneSub, (0, data_dir_1.requireUuid)(value));
            if (!project) {
                res.status(404).json({ error: 'project_not_found' });
                return;
            }
            req.sceneProject = project;
            next();
        }
        catch (error) {
            fail(res, error, 'Load project');
        }
    });
    registerProjectCrud(router, deps);
    registerFileRoutes(router, deps);
    registerToolRoutes(router, deps);
    registerOutputRoutes(router, deps);
    return router;
}
function registerProjectCrud(router, deps) {
    router.get('/projects', async (req, res) => {
        try {
            res.json({ projects: (await (0, project_store_1.listProjects)(deps.pool, req.sceneSub)).map(project_view_1.publicProject) });
        }
        catch (error) {
            fail(res, error, 'List projects');
        }
    });
    router.post('/projects', async (req, res) => {
        const b = body(req);
        try {
            const kind = b.kind;
            if (kind !== 'godot' && kind !== 'blender')
                throw new project_service_1.RequestError("kind must be 'godot' (a game or 3-D scene) or 'blender' (a model)", 'kind');
            const template = (0, project_view_1.optionalString)(b.template, 'template') ?? tool_contract_1.TEMPLATES[kind][0];
            if (!tool_contract_1.TEMPLATES[kind].includes(template))
                throw new project_service_1.RequestError(`template must be one of ${tool_contract_1.TEMPLATES[kind].join(', ')}`, 'template');
            const project = await (0, project_service_1.createProject)(deps, req.sceneSub, { title: (0, project_view_1.projectTitle)(b.title, kind === 'godot' ? 'Untitled game' : 'Untitled model'), kind, template });
            res.status(201).json({ project: (0, project_view_1.publicProject)(project) });
        }
        catch (error) {
            fail(res, error, 'Create project');
        }
    });
    router.get('/projects/:projectId', async (req, res) => {
        const project = req.sceneProject;
        try {
            const files = await (0, project_service_1.loadFiles)(deps, req.sceneSub, project);
            const revisions = (await (0, project_store_1.listRevisions)(deps.pool, req.sceneSub, project.project_id, 20))
                .map((r) => ({ revision: r.revision, action: r.action, detail: r.detail, fileCount: r.file_count, at: r.created_at }));
            res.json({ project: (0, project_view_1.publicProject)(project), ...(0, project_files_1.listing)(files), revisions, engine: deps.engine.status() });
        }
        catch (error) {
            fail(res, error, 'Read project', { projectId: project.project_id });
        }
    });
    router.patch('/projects/:projectId', async (req, res) => {
        const project = req.sceneProject;
        try {
            const updated = await (0, project_store_1.renameProject)(deps.pool, req.sceneSub, project.project_id, (0, project_view_1.projectTitle)(body(req).title, project.title));
            res.json({ project: (0, project_view_1.publicProject)(updated ?? project) });
        }
        catch (error) {
            fail(res, error, 'Rename project', { projectId: project.project_id });
        }
    });
    router.delete('/projects/:projectId', async (req, res) => {
        const project = req.sceneProject;
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body(req))) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('scene-studio-delete-project', `delete "${project.title}" and every revision of it`));
            return;
        }
        try {
            await (0, project_store_1.deleteProject)(deps.pool, req.sceneSub, project.project_id);
            (0, project_service_1.removeProjectFiles)(deps, req.sceneSub, project.project_id);
            logger.info({ projectId: project.project_id }, 'Deleted a project');
            res.json({ deleted: project.project_id });
        }
        catch (error) {
            fail(res, error, 'Delete project', { projectId: project.project_id });
        }
    });
}
function registerFileRoutes(router, deps) {
    const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: project_files_1.FILE_LIMITS.maxUploadBytes, files: 1 } });
    router.post('/projects/:projectId/files/read', async (req, res) => {
        const project = req.sceneProject;
        try {
            const filePath = String(body(req).path ?? '');
            const bytes = (0, project_files_1.fileData)(await (0, project_service_1.loadFiles)(deps, req.sceneSub, project), filePath);
            if (!bytes)
                throw new project_files_1.FileError(`${filePath} is not in this project`, 'path', 404);
            const text = (0, project_files_1.isText)(bytes) ? bytes.subarray(0, project_files_1.FILE_LIMITS.maxTextReadBytes).toString('utf8') : null;
            res.json({ path: filePath, bytes: bytes.length, binary: text === null, text, truncated: text !== null && bytes.length > project_files_1.FILE_LIMITS.maxTextReadBytes, revision: project.revision });
        }
        catch (error) {
            fail(res, error, 'Read file', { projectId: project.project_id });
        }
    });
    router.get('/projects/:projectId/files/download', async (req, res) => {
        const project = req.sceneProject;
        try {
            const filePath = String(req.query.path ?? '');
            const bytes = (0, project_files_1.fileData)(await (0, project_service_1.loadFiles)(deps, req.sceneSub, project), filePath);
            if (!bytes)
                throw new project_files_1.FileError(`${filePath} is not in this project`, 'path', 404);
            res.setHeader('Content-Disposition', `attachment; filename="${node_path_1.default.posix.basename(filePath).replace(/[^A-Za-z0-9._-]/g, '_')}"`);
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.type('application/octet-stream').send(bytes);
        }
        catch (error) {
            fail(res, error, 'Download file', { projectId: project.project_id });
        }
    });
    router.put('/projects/:projectId/files', async (req, res) => {
        const project = req.sceneProject;
        const b = body(req);
        try {
            if (typeof b.text !== 'string')
                throw new project_service_1.RequestError('text must be a string (the whole file)', 'text');
            outcome(res, await (0, project_service_1.writeTextFile)(deps, req.sceneSub, project.project_id, String(b.path ?? ''), b.text));
        }
        catch (error) {
            fail(res, error, 'Write file', { projectId: project.project_id });
        }
    });
    router.post('/projects/:projectId/files/upload', upload.single('file'), async (req, res) => {
        const project = req.sceneProject;
        try {
            const file = req.file;
            if (!file)
                throw new project_service_1.RequestError('no file in the upload (multipart field "file")', 'file');
            const target = String(body(req).path || `assets/${file.originalname}`);
            outcome(res, await (0, project_service_1.uploadFile)(deps, req.sceneSub, project.project_id, target, file.buffer), 201);
        }
        catch (error) {
            fail(res, error, 'Upload file', { projectId: project.project_id });
        }
    });
    router.delete('/projects/:projectId/files', async (req, res) => {
        const project = req.sceneProject;
        try {
            outcome(res, await (0, project_service_1.deleteFile)(deps, req.sceneSub, project.project_id, String(body(req).path ?? req.query.path ?? '')));
        }
        catch (error) {
            fail(res, error, 'Delete file', { projectId: project.project_id });
        }
    });
}
function registerToolRoutes(router, deps) {
    router.post('/projects/:projectId/godot/:tool', async (req, res) => {
        const project = req.sceneProject;
        try {
            const tool = String(req.params.tool);
            if (!tool_contract_1.GODOT_TOOLS.includes(tool))
                throw new project_service_1.RequestError(`godot tool must be one of ${tool_contract_1.GODOT_TOOLS.join(', ')}`, 'tool');
            outcome(res, await (0, project_service_1.callProjectTool)(deps, req.sceneSub, project.project_id, { server: 'godot', tool, args: (0, tool_contract_1.toolArguments)(body(req)) }));
        }
        catch (error) {
            fail(res, error, 'Godot tool', { projectId: project.project_id });
        }
    });
    router.post('/projects/:projectId/blender/:tool', async (req, res) => {
        const project = req.sceneProject;
        const b = body(req);
        try {
            const tool = String(req.params.tool);
            if (!tool_contract_1.BLENDER_PROJECT_TOOLS.includes(tool))
                throw new project_service_1.RequestError(`blender tool must be one of ${tool_contract_1.BLENDER_PROJECT_TOOLS.join(', ')}`, 'tool');
            const args = tool === 'execute_blender_code_for_cli' ? { code: b.code } : {};
            const save = b.save === undefined ? true : b.save === true;
            outcome(res, await (0, project_service_1.callProjectTool)(deps, req.sceneSub, project.project_id, { server: 'blender', tool, args, file: (0, project_view_1.optionalString)(b.file, 'file'), save }));
        }
        catch (error) {
            fail(res, error, 'Blender tool', { projectId: project.project_id });
        }
    });
    router.post('/blender-docs', async (req, res) => {
        const b = body(req);
        try {
            const tool = String(b.tool ?? 'search_api_docs');
            if (!tool_contract_1.BLENDER_DOC_TOOLS.includes(tool))
                throw new project_service_1.RequestError(`docs tool must be one of ${tool_contract_1.BLENDER_DOC_TOOLS.join(', ')}`, 'tool');
            res.json(await (0, project_service_1.blenderDocs)(deps, tool, (0, tool_contract_1.toolArguments)(b, ['tool'])));
        }
        catch (error) {
            fail(res, error, 'Blender docs');
        }
    });
    router.post('/projects/:projectId/import-model', async (req, res) => {
        const project = req.sceneProject;
        const b = body(req);
        try {
            const instance = b.instance && typeof b.instance === 'object' && !Array.isArray(b.instance) ? b.instance : undefined;
            const out = await (0, project_service_1.importModel)(deps, req.sceneSub, project.project_id, { fromProjectId: (0, data_dir_1.requireUuid)(b.fromProjectId), name: String(b.name ?? ''), instance });
            outcome(res, out);
        }
        catch (error) {
            fail(res, error, 'Import model', { projectId: project.project_id });
        }
    });
    router.post('/projects/:projectId/restore', async (req, res) => {
        const project = req.sceneProject;
        try {
            outcome(res, await (0, project_service_1.restoreRevision)(deps, req.sceneSub, project.project_id, (0, data_dir_1.requireRevision)(body(req).revision)));
        }
        catch (error) {
            fail(res, error, 'Restore revision', { projectId: project.project_id });
        }
    });
}
function registerOutputRoutes(router, deps) {
    router.post('/projects/:projectId/run', async (req, res) => {
        const project = req.sceneProject;
        const b = body(req);
        try {
            const out = await (0, project_service_1.runProject)(deps, req.sceneSub, project.project_id, { seconds: (0, project_view_1.intOption)(b.seconds, 'seconds', 1, 30) ?? 5, scene: (0, project_view_1.optionalString)(b.scene, 'scene') });
            res.json({ project: (0, project_view_1.publicProject)(out.project), run: out.run });
        }
        catch (error) {
            fail(res, error, 'Run project', { projectId: project.project_id });
        }
    });
    router.post('/projects/:projectId/preview', async (req, res) => {
        const project = req.sceneProject;
        const b = body(req);
        try {
            const out = await (0, project_service_1.renderPreview)(deps, req.sceneSub, project.project_id, {
                scene: (0, project_view_1.optionalString)(b.scene, 'scene'), file: (0, project_view_1.optionalString)(b.file, 'file'),
                width: (0, project_view_1.intOption)(b.width, 'width', 64, 1920), height: (0, project_view_1.intOption)(b.height, 'height', 64, 1080), samples: (0, project_view_1.intOption)(b.samples, 'samples', 1, 256),
            });
            res.json({ project: (0, project_view_1.publicProject)(out.project), preview: out.preview });
        }
        catch (error) {
            fail(res, error, 'Render preview', { projectId: project.project_id });
        }
    });
    router.post('/projects/:projectId/export', async (req, res) => {
        const project = req.sceneProject;
        const b = body(req);
        try {
            const format = String(b.format ?? (project.kind === 'godot' ? 'zip' : 'glb'));
            if (!tool_contract_1.EXPORT_FORMATS[project.kind].includes(format))
                throw new project_service_1.RequestError(`a ${project.kind} project exports as ${tool_contract_1.EXPORT_FORMATS[project.kind].join(', ')}`, 'format');
            res.json({ export: await (0, project_service_1.exportProject)(deps, req.sceneSub, project.project_id, format, (0, project_view_1.optionalString)(b.file, 'file')) });
        }
        catch (error) {
            fail(res, error, 'Export project', { projectId: project.project_id });
        }
    });
    router.get('/projects/:projectId/artifacts/:name', (req, res) => serveArtifact(req, res, deps));
}
function serveArtifact(req, res, deps) {
    const project = req.sceneProject;
    try {
        const name = String(req.params.name);
        if (!(0, data_dir_1.isArtifactName)(name))
            throw new project_service_1.RequestError('unknown artifact', 'name');
        const revision = req.query.revision === undefined ? project.revision : (0, data_dir_1.requireRevision)(req.query.revision);
        const file = node_path_1.default.join((0, data_dir_1.artifactsDir)(deps.dataRoot, req.sceneSub, project.project_id, revision), name);
        if (!node_fs_1.default.existsSync(file)) {
            res.status(404).json({ error: 'artifact_not_found', message: `no ${name} for revision ${revision} — render or export it first` });
            return;
        }
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!name.endsWith('.png'))
            res.setHeader('Content-Disposition', `attachment; filename="${project.title.replace(/[^A-Za-z0-9._-]/g, '_')}-r${revision}-${name}"`);
        res.type(data_dir_1.ARTIFACT_TYPES[name]).send(node_fs_1.default.readFileSync(file));
    }
    catch (error) {
        fail(res, error, 'Serve artifact', { projectId: project.project_id });
    }
}
//# sourceMappingURL=project-routes.js.map