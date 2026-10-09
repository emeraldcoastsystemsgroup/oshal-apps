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

import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { FileError, fileData, isText, listing } from './project-files';
import { getProject, listProjects, listRevisions, type ProjectKind, type ProjectRow, type RevisionRow } from './project-store';
import {
  NotFoundError, RequestError, blenderDocs, callProjectTool, createProject, deleteFile, exportProject, importModel, loadFiles,
  renderPreview, restoreRevision, runProject, writeTextFile, type MutationOutcome, type ServiceDeps,
} from './project-service';
import { projectTitle } from './project-view';
import { BLENDER_DOC_TOOLS, EXPORT_FORMATS, TEMPLATES, toolArguments } from './tool-contract';
import { SCENE_TOOL_SPECS, readToolInput, type SceneToolSpec } from './tool-input';
import {
  TOOL_DEADLINE_MS, TOOL_TEXT_READ_BYTES, ToolFailure, boundResult, clipUtf8, compactDelta, toolFailure, toolProject, withToolDeadline,
} from './tool-result';

const logger = createChildLogger({ module: 'scene-studio-tools' });

/** @description The verified caller a tool runs for (the kernel's application authorization actor). */
export interface SceneActor { sub: string; issuer: string; isActive: boolean }

/** @description What the tools need: the route services' dependencies plus the shared capabilities reader. */
export interface SceneToolDeps extends ServiceDeps {
  capabilities: () => Promise<Record<string, unknown>>;
  /** Overrides TOOL_DEADLINE_MS (specs only). */
  deadlineMs?: number;
}

/** @description One registered handler, as the kernel's package-tool port takes it. */
export type SceneToolHandler = (input: unknown) => Promise<unknown>;

type Args = Record<string, unknown>;
type ToolOp = (sub: string, args: Args) => Promise<Record<string, unknown>>;

function mutationReply(out: MutationOutcome): Record<string, unknown> {
  const { delta, ...extra } = out.extra;
  return { project: toolProject(out.project), changed: out.changed, ...extra, ...(delta === undefined ? {} : compactDelta(delta)) };
}

async function ownProject(deps: ServiceDeps, sub: string, projectId: string): Promise<ProjectRow> {
  const project = await getProject(deps.pool, sub, projectId);
  if (!project) throw new NotFoundError('project_not_found');
  return project;
}

function revisionView(r: RevisionRow): Record<string, unknown> {
  const detail: Record<string, unknown> = r.detail && typeof r.detail === 'object' ? { ...r.detail } : {};
  if (detail.delta !== undefined) Object.assign(detail, compactDelta(detail.delta));
  return { revision: r.revision, action: r.action, detail, fileCount: r.file_count, at: r.created_at };
}

async function readProject(deps: SceneToolDeps, sub: string, projectId: string): Promise<Record<string, unknown>> {
  const project = await ownProject(deps, sub, projectId);
  const files = await loadFiles(deps, sub, project);
  const revisions = (await listRevisions(deps.pool, sub, project.project_id, 20)).map(revisionView);
  return { project: toolProject(project), ...listing(files), revisions, engine: deps.engine.status() };
}

async function readFile(deps: SceneToolDeps, sub: string, projectId: string, filePath: string): Promise<Record<string, unknown>> {
  const project = await ownProject(deps, sub, projectId);
  const bytes = fileData(await loadFiles(deps, sub, project), filePath);
  if (!bytes) throw new FileError(`${filePath} is not in this project`, 'path', 404);
  const base = { path: filePath, bytes: bytes.length, revision: project.revision };
  if (!isText(bytes)) return { ...base, binary: true, text: null, truncated: false, shownBytes: 0 };
  const clipped = clipUtf8(bytes.toString('utf8'), TOOL_TEXT_READ_BYTES);
  return { ...base, binary: false, text: clipped.text, truncated: clipped.truncated, shownBytes: clipped.shownBytes };
}

function newProject(a: Args): { title: string; kind: ProjectKind; template: string } {
  const kind = a.kind;
  if (kind !== 'godot' && kind !== 'blender') throw new RequestError("kind must be 'godot' (a game or 3-D scene) or 'blender' (a model)", 'kind');
  const template = typeof a.template === 'string' ? a.template : TEMPLATES[kind][0];
  if (!TEMPLATES[kind].includes(template)) throw new RequestError(`template must be one of ${TEMPLATES[kind].join(', ')}`, 'template');
  return { title: projectTitle(a.title, kind === 'godot' ? 'Untitled game' : 'Untitled model'), kind, template };
}

function projectOps(deps: SceneToolDeps): Record<string, ToolOp> {
  return {
    'scene-capabilities': () => deps.capabilities(),
    'scene-list-projects': async (sub) => ({ projects: (await listProjects(deps.pool, sub)).map(toolProject) }),
    'scene-get-project': (sub, a) => readProject(deps, sub, String(a.projectId)),
    'scene-create-project': async (sub, a) => ({ project: toolProject(await createProject(deps, sub, newProject(a))) }),
    'scene-read-file': (sub, a) => readFile(deps, sub, String(a.projectId), String(a.path)),
    'scene-write-file': async (sub, a) => mutationReply(await writeTextFile(deps, sub, String(a.projectId), String(a.path), String(a.text))),
    'scene-delete-file': async (sub, a) => mutationReply(await deleteFile(deps, sub, String(a.projectId), String(a.path))),
    'blender-docs': async (_sub, a) => {
      const tool = String(a.tool);
      if (!BLENDER_DOC_TOOLS.includes(tool)) throw new RequestError(`docs tool must be one of ${BLENDER_DOC_TOOLS.join(', ')}`, 'tool');
      return blenderDocs(deps, tool, toolArguments(a, ['tool']));
    },
  };
}

function outputOps(deps: SceneToolDeps): Record<string, ToolOp> {
  return {
    'godot-run-project': async (sub, a) => {
      const out = await runProject(deps, sub, String(a.projectId), { seconds: (a.seconds as number | undefined) ?? 5, scene: a.scene as string | undefined });
      return { project: toolProject(out.project), run: out.run };
    },
    'scene-render-preview': async (sub, a) => {
      const out = await renderPreview(deps, sub, String(a.projectId), {
        scene: a.scene as string | undefined, width: a.width as number | undefined, height: a.height as number | undefined, samples: a.samples as number | undefined,
      });
      return { project: toolProject(out.project), preview: out.preview };
    },
    'scene-export': async (sub, a) => {
      const project = await ownProject(deps, sub, String(a.projectId));
      const format = typeof a.format === 'string' ? a.format : project.kind === 'godot' ? 'zip' : 'glb';
      if (!EXPORT_FORMATS[project.kind].includes(format)) throw new RequestError(`a ${project.kind} project exports as ${EXPORT_FORMATS[project.kind].join(', ')}`, 'format');
      return { export: await exportProject(deps, sub, project.project_id, format) };
    },
    'scene-import-model': async (sub, a) => mutationReply(await importModel(deps, sub, String(a.projectId), {
      fromProjectId: String(a.fromProjectId), name: String(a.name), instance: a.instance as Record<string, unknown> | undefined,
    })),
    'scene-restore-revision': async (sub, a) => mutationReply(await restoreRevision(deps, sub, String(a.projectId), a.revision as number)),
  };
}

/** The godot-mcp and Blender Lab MCP tools: one engine call each, driven by the spec's target. */
function engineOp(deps: SceneToolDeps, spec: SceneToolSpec): ToolOp | undefined {
  const target = spec.target;
  if (!target) return undefined;
  if (target.server === 'godot') {
    return async (sub, a) => mutationReply(await callProjectTool(deps, sub, String(a.projectId), { server: 'godot', tool: target.tool, args: toolArguments(a) }));
  }
  const code = target.tool === 'execute_blender_code_for_cli';
  return async (sub, a) => mutationReply(await callProjectTool(deps, sub, String(a.projectId), {
    server: 'blender', tool: target.tool, args: code ? { code: a.code } : {}, file: a.file as string | undefined, save: code ? a.save !== false : false,
  }));
}

async function runTool(spec: SceneToolSpec, op: ToolOp, deps: SceneToolDeps, currentActor: () => SceneActor | undefined, input: unknown): Promise<unknown> {
  const actor = currentActor();
  if (!actor || actor.isActive !== true || !actor.sub || !actor.issuer) {
    logger.warn({ tool: spec.name }, 'Scene Studio tool refused: no verified signed-in owner');
    throw new ToolFailure('signed_in_owner_required', 401, `signed_in_owner_required: ${spec.name} runs only for a verified, active, signed-in person`);
  }
  const started = Date.now();
  let projectId: unknown = null;
  try {
    const args = readToolInput(spec, input);
    projectId = args.projectId ?? null;
    logger.info({ tool: spec.name, projectId }, 'Scene Studio tool started');
    const value = await withToolDeadline(spec.name, deps.deadlineMs ?? TOOL_DEADLINE_MS, () => op(actor.sub, args));
    const reply = boundResult(spec.name, value);
    logger.info({ tool: spec.name, projectId, durationMs: Date.now() - started, changed: reply.changed ?? null }, 'Scene Studio tool finished');
    return reply;
  } catch (error) {
    const failure = toolFailure(error, spec.name);
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
export function createSceneToolHandlers(deps: SceneToolDeps, currentActor: () => SceneActor | undefined): Map<string, SceneToolHandler> {
  const ops: Record<string, ToolOp> = { ...projectOps(deps), ...outputOps(deps) };
  const handlers = new Map<string, SceneToolHandler>();
  for (const spec of SCENE_TOOL_SPECS) {
    const op = engineOp(deps, spec) ?? (Object.prototype.hasOwnProperty.call(ops, spec.name) ? ops[spec.name] : undefined);
    if (!op) throw new Error(`Scene Studio tool ${spec.name} has no operation`);
    handlers.set(spec.name, (input: unknown) => runTool(spec, op, deps, currentActor, input));
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
export function registerSceneStudioTools(ctx: AppContext, deps: SceneToolDeps): void {
  const port = ctx.tools;
  if (!port) return;
  const handlers = createSceneToolHandlers(deps, () => ctx.authorization?.currentActor());
  for (const [name, handler] of handlers) port.register(name, handler);
  logger.info({ tools: handlers.size }, 'Registered the Scene Studio package tools');
}
