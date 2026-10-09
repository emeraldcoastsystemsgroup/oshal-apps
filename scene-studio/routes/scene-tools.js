"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (0.2.0) — the director's 22 tools as in-process
 *                     |                             | package tools (executor builtin/package). Until now they were
 *                     |                             | loopback HTTP calls to this package's own routes, which the
 *                     |                             | package's oidc mount refused, so the director could only talk.
 *                     |                             | Each handler runs in the api under the caller's verified actor
 *                     |                             | (never an input), reads a closed input, calls the same services
 *                     |                             | the routes call with actor.sub as the owner key, and answers
 *                     |                             | inside a deadline and a size budget. Entry and exit are logged
 *                     |                             | with the tool, project, duration and outcome only — never file
 *                     |                             | text, code or input values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSceneToolHandlers = createSceneToolHandlers;
exports.registerSceneStudioTools = registerSceneStudioTools;
const logger_1 = require("@/shared/logger");
const project_files_1 = require("./project-files");
const project_store_1 = require("./project-store");
const project_service_1 = require("./project-service");
const project_view_1 = require("./project-view");
const tool_contract_1 = require("./tool-contract");
const tool_input_1 = require("./tool-input");
const tool_result_1 = require("./tool-result");
const logger = (0, logger_1.createChildLogger)({ module: 'scene-studio-tools' });
function mutationReply(out) {
    const { delta, ...extra } = out.extra;
    return { project: (0, tool_result_1.toolProject)(out.project), changed: out.changed, ...extra, ...(delta === undefined ? {} : (0, tool_result_1.compactDelta)(delta)) };
}
async function ownProject(deps, sub, projectId) {
    const project = await (0, project_store_1.getProject)(deps.pool, sub, projectId);
    if (!project)
        throw new project_service_1.NotFoundError('project_not_found');
    return project;
}
function revisionView(r) {
    const detail = r.detail && typeof r.detail === 'object' ? { ...r.detail } : {};
    if (detail.delta !== undefined)
        Object.assign(detail, (0, tool_result_1.compactDelta)(detail.delta));
    return { revision: r.revision, action: r.action, detail, fileCount: r.file_count, at: r.created_at };
}
async function readProject(deps, sub, projectId) {
    const project = await ownProject(deps, sub, projectId);
    const files = await (0, project_service_1.loadFiles)(deps, sub, project);
    const revisions = (await (0, project_store_1.listRevisions)(deps.pool, sub, project.project_id, 20)).map(revisionView);
    return { project: (0, tool_result_1.toolProject)(project), ...(0, project_files_1.listing)(files), revisions, engine: deps.engine.status() };
}
async function readFile(deps, sub, projectId, filePath) {
    const project = await ownProject(deps, sub, projectId);
    const bytes = (0, project_files_1.fileData)(await (0, project_service_1.loadFiles)(deps, sub, project), filePath);
    if (!bytes)
        throw new project_files_1.FileError(`${filePath} is not in this project`, 'path', 404);
    const base = { path: filePath, bytes: bytes.length, revision: project.revision };
    if (!(0, project_files_1.isText)(bytes))
        return { ...base, binary: true, text: null, truncated: false, shownBytes: 0 };
    const clipped = (0, tool_result_1.clipUtf8)(bytes.toString('utf8'), tool_result_1.TOOL_TEXT_READ_BYTES);
    return { ...base, binary: false, text: clipped.text, truncated: clipped.truncated, shownBytes: clipped.shownBytes };
}
function newProject(a) {
    const kind = a.kind;
    if (kind !== 'godot' && kind !== 'blender')
        throw new project_service_1.RequestError("kind must be 'godot' (a game or 3-D scene) or 'blender' (a model)", 'kind');
    const template = typeof a.template === 'string' ? a.template : tool_contract_1.TEMPLATES[kind][0];
    if (!tool_contract_1.TEMPLATES[kind].includes(template))
        throw new project_service_1.RequestError(`template must be one of ${tool_contract_1.TEMPLATES[kind].join(', ')}`, 'template');
    return { title: (0, project_view_1.projectTitle)(a.title, kind === 'godot' ? 'Untitled game' : 'Untitled model'), kind, template };
}
function projectOps(deps) {
    return {
        'scene-capabilities': () => deps.capabilities(),
        'scene-list-projects': async (sub) => ({ projects: (await (0, project_store_1.listProjects)(deps.pool, sub)).map(tool_result_1.toolProject) }),
        'scene-get-project': (sub, a) => readProject(deps, sub, String(a.projectId)),
        'scene-create-project': async (sub, a) => ({ project: (0, tool_result_1.toolProject)(await (0, project_service_1.createProject)(deps, sub, newProject(a))) }),
        'scene-read-file': (sub, a) => readFile(deps, sub, String(a.projectId), String(a.path)),
        'scene-write-file': async (sub, a) => mutationReply(await (0, project_service_1.writeTextFile)(deps, sub, String(a.projectId), String(a.path), String(a.text))),
        'scene-delete-file': async (sub, a) => mutationReply(await (0, project_service_1.deleteFile)(deps, sub, String(a.projectId), String(a.path))),
        'blender-docs': async (_sub, a) => {
            const tool = String(a.tool);
            if (!tool_contract_1.BLENDER_DOC_TOOLS.includes(tool))
                throw new project_service_1.RequestError(`docs tool must be one of ${tool_contract_1.BLENDER_DOC_TOOLS.join(', ')}`, 'tool');
            return (0, project_service_1.blenderDocs)(deps, tool, (0, tool_contract_1.toolArguments)(a, ['tool']));
        },
    };
}
function outputOps(deps) {
    return {
        'godot-run-project': async (sub, a) => {
            const out = await (0, project_service_1.runProject)(deps, sub, String(a.projectId), { seconds: a.seconds ?? 5, scene: a.scene });
            return { project: (0, tool_result_1.toolProject)(out.project), run: out.run };
        },
        'scene-render-preview': async (sub, a) => {
            const out = await (0, project_service_1.renderPreview)(deps, sub, String(a.projectId), {
                scene: a.scene, width: a.width, height: a.height, samples: a.samples,
            });
            return { project: (0, tool_result_1.toolProject)(out.project), preview: out.preview };
        },
        'scene-export': async (sub, a) => {
            const project = await ownProject(deps, sub, String(a.projectId));
            const format = typeof a.format === 'string' ? a.format : project.kind === 'godot' ? 'zip' : 'glb';
            if (!tool_contract_1.EXPORT_FORMATS[project.kind].includes(format))
                throw new project_service_1.RequestError(`a ${project.kind} project exports as ${tool_contract_1.EXPORT_FORMATS[project.kind].join(', ')}`, 'format');
            return { export: await (0, project_service_1.exportProject)(deps, sub, project.project_id, format) };
        },
        'scene-import-model': async (sub, a) => mutationReply(await (0, project_service_1.importModel)(deps, sub, String(a.projectId), {
            fromProjectId: String(a.fromProjectId), name: String(a.name), instance: a.instance,
        })),
        'scene-restore-revision': async (sub, a) => mutationReply(await (0, project_service_1.restoreRevision)(deps, sub, String(a.projectId), a.revision)),
    };
}
/** The godot-mcp and Blender Lab MCP tools: one engine call each, driven by the spec's target. */
function engineOp(deps, spec) {
    const target = spec.target;
    if (!target)
        return undefined;
    if (target.server === 'godot') {
        return async (sub, a) => mutationReply(await (0, project_service_1.callProjectTool)(deps, sub, String(a.projectId), { server: 'godot', tool: target.tool, args: (0, tool_contract_1.toolArguments)(a) }));
    }
    const code = target.tool === 'execute_blender_code_for_cli';
    return async (sub, a) => mutationReply(await (0, project_service_1.callProjectTool)(deps, sub, String(a.projectId), {
        server: 'blender', tool: target.tool, args: code ? { code: a.code } : {}, file: a.file, save: code ? a.save !== false : false,
    }));
}
async function runTool(spec, op, deps, currentActor, input) {
    const actor = currentActor();
    if (!actor || actor.isActive !== true || !actor.sub || !actor.issuer) {
        logger.warn({ tool: spec.name }, 'Scene Studio tool refused: no verified signed-in owner');
        throw new tool_result_1.ToolFailure('signed_in_owner_required', 401, `signed_in_owner_required: ${spec.name} runs only for a verified, active, signed-in person`);
    }
    const started = Date.now();
    let projectId = null;
    try {
        const args = (0, tool_input_1.readToolInput)(spec, input);
        projectId = args.projectId ?? null;
        logger.info({ tool: spec.name, projectId }, 'Scene Studio tool started');
        const value = await (0, tool_result_1.withToolDeadline)(spec.name, deps.deadlineMs ?? tool_result_1.TOOL_DEADLINE_MS, () => op(actor.sub, args));
        const reply = (0, tool_result_1.boundResult)(spec.name, value);
        logger.info({ tool: spec.name, projectId, durationMs: Date.now() - started, changed: reply.changed ?? null }, 'Scene Studio tool finished');
        return reply;
    }
    catch (error) {
        const failure = (0, tool_result_1.toolFailure)(error, spec.name);
        logger.warn({ tool: spec.name, projectId, durationMs: Date.now() - started, error: failure.code, status: failure.status }, 'Scene Studio tool refused');
        throw failure;
    }
}
/**
 * @description Build the 22 tool handlers. The actor is read from `currentActor` on every call and is
 * never taken from the input; a call without an active verified actor is refused before any query or
 * engine request. The owner key is `actor.sub`, the same value the studio's routes use, so a tool and
 * the studio see the same projects and the same data directory.
 * @param deps - Pool, engine, data root, engine build and the shared capabilities reader.
 * @param currentActor - The kernel's current application actor.
 * @returns Tool name → handler, in manifest order.
 */
function createSceneToolHandlers(deps, currentActor) {
    const ops = { ...projectOps(deps), ...outputOps(deps) };
    const handlers = new Map();
    for (const spec of tool_input_1.SCENE_TOOL_SPECS) {
        const op = engineOp(deps, spec) ?? (Object.prototype.hasOwnProperty.call(ops, spec.name) ? ops[spec.name] : undefined);
        if (!op)
            throw new Error(`Scene Studio tool ${spec.name} has no operation`);
        handlers.set(spec.name, (input) => runTool(spec, op, deps, currentActor, input));
    }
    return handlers;
}
/**
 * @description Register every tool on the kernel's activation-scoped package-tool port. Only the
 * route entry factory calls this (the kernel refuses a duplicate name), and a context without the
 * port — an isolated route test — registers nothing. In production a missing handler fails the
 * activation, so the manifest and this registration cannot drift apart silently.
 * @param ctx - Package context from the route mounter (`tools`, `authorization`).
 * @param deps - What the handlers need.
 * @returns Nothing.
 */
function registerSceneStudioTools(ctx, deps) {
    const port = ctx.tools;
    if (!port)
        return;
    const handlers = createSceneToolHandlers(deps, () => ctx.authorization?.currentActor());
    for (const [name, handler] of handlers)
        port.register(name, handler);
    logger.info({ tools: handlers.size }, 'Registered the Scene Studio package tools');
}
//# sourceMappingURL=scene-tools.js.map