"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — what Scene Studio does to a project. A
 *                     |                             | mutation runs under the project's lock, starts from the latest
 *                     |                             | revision, and lands as ONE new revision only when something
 *                     |                             | changed (the engine reports the delta); revisions past the
 *                     |                             | keep-window are pruned with their artifacts. Preview, export and
 *                     |                             | run are read-only and are recorded against the revision they
 *                     |                             | rendered. The engine is reached only through EngineClient.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestError = exports.ConflictError = exports.NotFoundError = exports.BASE = void 0;
exports.withProjectLock = withProjectLock;
exports.loadFiles = loadFiles;
exports.createProject = createProject;
exports.callProjectTool = callProjectTool;
exports.blenderDocs = blenderDocs;
exports.writeTextFile = writeTextFile;
exports.uploadFile = uploadFile;
exports.deleteFile = deleteFile;
exports.restoreRevision = restoreRevision;
exports.importModel = importModel;
exports.renderPreview = renderPreview;
exports.exportProject = exportProject;
exports.runProject = runProject;
exports.removeProjectFiles = removeProjectFiles;
exports.artifactUrl = artifactUrl;
exports.previewView = previewView;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("@/shared/logger");
const data_dir_1 = require("./data-dir");
const project_files_1 = require("./project-files");
const project_store_1 = require("./project-store");
const logger = (0, logger_1.createChildLogger)({ module: 'scene-studio-project-service' });
exports.BASE = '/api/scene-studio';
/** Engine-side budget for one MCP tool call; the api allows a margin on top. Kept under the
 * tool executor's 120 s default so a concierge's call never outlives its own HTTP request. */
const TOOL_SECONDS = 90;
/** @description The project does not exist (or is not the caller's). */
class NotFoundError extends Error {
    constructor(message = 'project_not_found') { super(message); this.name = 'NotFoundError'; }
}
exports.NotFoundError = NotFoundError;
/** @description Another write changed the project while this one ran. */
class ConflictError extends Error {
    constructor(message) { super(message); this.name = 'ConflictError'; }
}
exports.ConflictError = ConflictError;
/** @description The request does not fit the project (wrong kind, bad option). */
class RequestError extends Error {
    field;
    constructor(message, field = 'body') {
        super(message);
        this.field = field;
        this.name = 'RequestError';
    }
}
exports.RequestError = RequestError;
const locks = new Map();
/** @description Serialise work on one project inside this api process. */
function withProjectLock(projectId, fn) {
    const previous = locks.get(projectId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    locks.set(projectId, tail);
    void tail.then(() => { if (locks.get(projectId) === tail)
        locks.delete(projectId); });
    return run;
}
/** @description The current revision's files ([] before the first revision). */
async function loadFiles(deps, sub, project) {
    if (project.revision === 0)
        return [];
    const rev = await (0, project_store_1.getRevision)(deps.pool, sub, project.project_id, project.revision);
    if (!rev)
        throw new project_files_1.FileError('the current revision is missing', 'revision', 500);
    return (0, project_files_1.readRevisionBlob)((0, data_dir_1.revisionsDir)(deps.dataRoot, sub, project.project_id), rev.blob);
}
async function requireProject(deps, sub, projectId) {
    const project = await (0, project_store_1.getProject)(deps.pool, sub, projectId);
    if (!project)
        throw new NotFoundError();
    return project;
}
function requireKind(project, kind, what) {
    if (project.kind !== kind)
        throw new RequestError(`${what} works on a ${kind} project; "${project.title}" is a ${project.kind} project`, 'kind');
}
/** @description Store `files` as the next revision of `project`. @throws ConflictError */
async function commit(deps, sub, project, m) {
    (0, project_files_1.assertWithinLimits)(m.files);
    const { fileCount, totalBytes } = (0, project_files_1.summarize)(m.files);
    const dir = (0, data_dir_1.revisionsDir)(deps.dataRoot, sub, project.project_id);
    const blob = (0, project_files_1.writeRevisionBlob)(dir, project.revision + 1, m.files);
    const updated = await (0, project_store_1.commitRevision)(deps.pool, sub, project.project_id, project.revision, {
        action: m.action, detail: m.detail, fileCount, totalBytes, blob, engineBuild: m.engineBuild,
    });
    if (!updated) {
        (0, project_files_1.removeRevisionBlobs)(dir, [blob]);
        throw new ConflictError('the project changed while this ran — read it again and retry');
    }
    await prune(deps, sub, updated);
    logger.info({ projectId: project.project_id, revision: updated.revision, action: m.action, fileCount }, 'Committed a project revision');
    return updated;
}
async function prune(deps, sub, project) {
    const keepFrom = project.revision - project_files_1.FILE_LIMITS.keepRevisions + 1;
    if (keepFrom <= 1)
        return;
    const dropped = await (0, project_store_1.pruneRevisions)(deps.pool, sub, project.project_id, keepFrom);
    (0, project_files_1.removeRevisionBlobs)((0, data_dir_1.revisionsDir)(deps.dataRoot, sub, project.project_id), dropped.map((d) => d.blob));
    for (const d of dropped)
        node_fs_1.default.rmSync((0, data_dir_1.artifactsDir)(deps.dataRoot, sub, project.project_id, d.revision), { recursive: true, force: true });
}
/** @description Run one change under the project's lock, from its latest revision. */
async function mutate(deps, sub, projectId, fn) {
    return withProjectLock(projectId, async () => {
        const project = await requireProject(deps, sub, projectId);
        const files = await loadFiles(deps, sub, project);
        const m = await fn(project, files);
        if (!m.files)
            return { project, changed: false, extra: m.extra ?? {} };
        const updated = await commit(deps, sub, project, { ...m, files: m.files });
        return { project: updated, changed: true, extra: m.extra ?? {} };
    });
}
/** @description A new project: the engine writes its starting files, which become revision 1. */
async function createProject(deps, sub, input) {
    const started = (await deps.engine.request('new_project', { kind: input.kind, template: input.template, title: input.title }, 120_000));
    (0, project_files_1.assertWithinLimits)(started.files);
    const project = await (0, project_store_1.insertProject)(deps.pool, sub, input);
    return withProjectLock(project.project_id, () => commit(deps, sub, project, {
        files: started.files, action: 'create', detail: { template: input.template }, engineBuild: deps.engineBuild,
    }));
}
/**
 * @description Call one allowlisted tool of godot-mcp (Godot project) or the Blender Lab MCP
 * (Blender project) on the project; a change lands as a new revision.
 */
async function callProjectTool(deps, sub, projectId, call) {
    return mutate(deps, sub, projectId, async (project, files) => {
        requireKind(project, call.server, `the ${call.server} ${call.tool} tool`);
        const reply = (await deps.engine.request('mcp_call', {
            server: call.server, tool: call.tool, arguments: call.args, files, file: call.file, save: call.save, timeoutSec: TOOL_SECONDS,
        }, (TOOL_SECONDS + 25) * 1000));
        return {
            files: reply.changed ? reply.files : undefined,
            action: `${call.server}:${call.tool}`,
            detail: { tool: call.tool, delta: reply.delta },
            engineBuild: deps.engineBuild,
            extra: { result: { text: clip(reply.text, 6000), isError: reply.isError }, delta: reply.delta },
        };
    });
}
/** @description A Blender Lab MCP documentation tool (no project). */
async function blenderDocs(deps, tool, args) {
    const reply = (await deps.engine.request('mcp_call', { server: 'blender', tool, arguments: args, files: [], timeoutSec: 60 }, 90_000));
    return { text: clip(reply.text, 9000), isError: reply.isError };
}
/** @description Write (create or replace) one UTF-8 text file. */
async function writeTextFile(deps, sub, projectId, filePath, text) {
    const p = refuseDerived((0, project_files_1.validatePath)(filePath));
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > project_files_1.FILE_LIMITS.maxTextWriteBytes)
        throw new project_files_1.FileError(`a text write is at most ${project_files_1.FILE_LIMITS.maxTextWriteBytes} bytes; upload larger files`, 'text', 413);
    return mutate(deps, sub, projectId, async (_project, files) => ({
        files: (0, project_files_1.withFile)(files, p, bytes), action: 'write-file', detail: { path: p, bytes: bytes.length }, engineBuild: null,
    }));
}
/** @description Store one uploaded file (any bytes). */
async function uploadFile(deps, sub, projectId, filePath, bytes) {
    const p = refuseDerived((0, project_files_1.validatePath)(filePath));
    return mutate(deps, sub, projectId, async (_project, files) => ({
        files: (0, project_files_1.withFile)(files, p, bytes), action: 'upload', detail: { path: p, bytes: bytes.length }, engineBuild: null,
    }));
}
/** @description Delete one file. */
async function deleteFile(deps, sub, projectId, filePath) {
    const p = (0, project_files_1.validatePath)(filePath);
    return mutate(deps, sub, projectId, async (_project, files) => ({
        files: (0, project_files_1.withoutFile)(files, p), action: 'delete-file', detail: { path: p }, engineBuild: null,
    }));
}
/** @description Put an earlier revision's files back as a NEW revision (undo; nothing is lost). */
async function restoreRevision(deps, sub, projectId, revision) {
    return mutate(deps, sub, projectId, async (project) => {
        const rev = await (0, project_store_1.getRevision)(deps.pool, sub, project.project_id, revision);
        if (!rev)
            throw new NotFoundError('revision_not_found');
        const files = (0, project_files_1.readRevisionBlob)((0, data_dir_1.revisionsDir)(deps.dataRoot, sub, project.project_id), rev.blob);
        return { files, action: 'restore', detail: { restoredFrom: revision }, engineBuild: null };
    });
}
/** @description Export a Blender project's scene into this Godot project's models/ and import it. */
async function importModel(deps, sub, projectId, input) {
    const source = await requireProject(deps, sub, input.fromProjectId);
    requireKind(source, 'blender', 'the model source');
    const fromFiles = await loadFiles(deps, sub, source);
    return mutate(deps, sub, projectId, async (project, files) => {
        requireKind(project, 'godot', 'Importing a model');
        const reply = (await deps.engine.request('import_model', { name: input.name, fromFiles, files, instance: input.instance }, 300_000));
        return {
            files: reply.changed ? reply.files : undefined, action: 'import-model',
            detail: { from: source.project_id, fromRevision: source.revision, name: input.name, resPath: reply.resPath, delta: reply.delta },
            engineBuild: deps.engineBuild, extra: { resPath: reply.resPath, delta: reply.delta },
        };
    });
}
/** @description Render a preview still (and glTF) of the current revision; recorded on the project. */
async function renderPreview(deps, sub, projectId, opts) {
    const project = await requireProject(deps, sub, projectId);
    const files = await loadFiles(deps, sub, project);
    const reply = (await deps.engine.request('preview', { kind: project.kind, files, ...opts }, 300_000));
    const dir = (0, data_dir_1.ensureDir)((0, data_dir_1.artifactsDir)(deps.dataRoot, sub, project.project_id, project.revision));
    node_fs_1.default.writeFileSync(node_path_1.default.join(dir, 'preview.png'), Buffer.from(reply.png, 'base64'), { mode: 0o600 });
    const glb = writeOptional(dir, 'preview.glb', reply.glb);
    const stl = writeOptional(dir, 'preview.stl', reply.stl);
    const record = { revision: project.revision, info: reply.info, glb, stl, at: new Date().toISOString() };
    const updated = (await (0, project_store_1.setProjectRecord)(deps.pool, sub, project.project_id, 'preview', record)) ?? project;
    return { project: updated, preview: previewView(updated.project_id, record) };
}
/** Write an optional base64 artifact; false when the engine did not produce it. */
function writeOptional(dir, name, data) {
    const bytes = Buffer.from(data || '', 'base64');
    if (!bytes.length)
        return false;
    node_fs_1.default.writeFileSync(node_path_1.default.join(dir, name), bytes, { mode: 0o600 });
    return true;
}
/** @description One downloadable export of the current revision. */
async function exportProject(deps, sub, projectId, format, file) {
    const project = await requireProject(deps, sub, projectId);
    const files = await loadFiles(deps, sub, project);
    const reply = (await deps.engine.request('export', { kind: project.kind, format, files, file }, 240_000));
    const name = `export.${format}`;
    const bytes = Buffer.from(reply.data, 'base64');
    node_fs_1.default.writeFileSync(node_path_1.default.join((0, data_dir_1.ensureDir)((0, data_dir_1.artifactsDir)(deps.dataRoot, sub, project.project_id, project.revision)), name), bytes, { mode: 0o600 });
    return { format, bytes: bytes.length, revision: project.revision, url: artifactUrl(project.project_id, name, project.revision) };
}
/** @description Run a Godot project headless for a few seconds; the output is recorded on the project. */
async function runProject(deps, sub, projectId, opts) {
    const project = await requireProject(deps, sub, projectId);
    requireKind(project, 'godot', 'Running');
    const files = await loadFiles(deps, sub, project);
    const reply = (await deps.engine.request('godot_run', { files, seconds: opts.seconds, scene: opts.scene }, (opts.seconds + 90) * 1000));
    const run = { revision: project.revision, seconds: reply.seconds, scene: opts.scene ?? null, output: reply.output.slice(0, 200), errors: reply.errors.slice(0, 200), at: new Date().toISOString() };
    const updated = (await (0, project_store_1.setProjectRecord)(deps.pool, sub, project.project_id, 'last_run', run)) ?? project;
    return { project: updated, run };
}
/** @description Remove a project's files and artifacts from disk (the row is deleted by the caller). */
function removeProjectFiles(deps, sub, projectId) {
    node_fs_1.default.rmSync((0, data_dir_1.projectDir)(deps.dataRoot, sub, projectId), { recursive: true, force: true });
}
/** @description The URL an artifact is served from. */
function artifactUrl(projectId, name, revision) {
    return `${exports.BASE}/projects/${projectId}/artifacts/${name}?revision=${revision}`;
}
/** @description The preview record with its URLs. */
function previewView(projectId, record) {
    const revision = Number(record.revision);
    return {
        ...record,
        png: artifactUrl(projectId, 'preview.png', revision),
        glbUrl: record.glb ? artifactUrl(projectId, 'preview.glb', revision) : null,
        stlUrl: record.stl ? artifactUrl(projectId, 'preview.stl', revision) : null,
    };
}
function refuseDerived(p) {
    if (p.startsWith('.godot/'))
        throw new project_files_1.FileError('.godot/ is Godot\'s derived import state; Scene Studio rebuilds it — edit the source files instead');
    return p;
}
function clip(text, max) {
    return text.length <= max ? text : `${text.slice(0, max)}\n… [${text.length - max} more characters]`;
}
//# sourceMappingURL=project-service.js.map