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

import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '@/shared/logger';
import type { EngineClient } from './engine-client';
import { artifactsDir, ensureDir, projectDir, revisionsDir } from './data-dir';
import {
  FILE_LIMITS, FileError, assertWithinLimits, readRevisionBlob, removeRevisionBlobs, summarize,
  validatePath, withFile, withoutFile, writeRevisionBlob, type WireFile,
} from './project-files';
import {
  commitRevision, getProject, getRevision, insertProject, pruneRevisions, setProjectRecord,
  type ProjectKind, type ProjectRow, type QueryablePool,
} from './project-store';

const logger = createChildLogger({ module: 'scene-studio-project-service' });
export const BASE = '/api/scene-studio';
/** Engine-side budget for one MCP tool call; the api allows a margin on top. Kept under the
 * tool executor's 120 s default so a concierge's call never outlives its own HTTP request. */
const TOOL_SECONDS = 90;

export interface ServiceDeps {
  pool: QueryablePool;
  engine: EngineClient;
  dataRoot: string;
  engineBuild: string | null;
}

/** @description The project does not exist (or is not the caller's). */
export class NotFoundError extends Error { constructor(message = 'project_not_found') { super(message); this.name = 'NotFoundError'; } }
/** @description Another write changed the project while this one ran. */
export class ConflictError extends Error { constructor(message: string) { super(message); this.name = 'ConflictError'; } }
/** @description The request does not fit the project (wrong kind, bad option). */
export class RequestError extends Error { constructor(message: string, readonly field = 'body') { super(message); this.name = 'RequestError'; } }

interface Mutation {
  files?: WireFile[];
  action: string;
  detail: Record<string, unknown>;
  engineBuild: string | null;
  extra?: Record<string, unknown>;
}

export interface MutationOutcome { project: ProjectRow; changed: boolean; extra: Record<string, unknown> }

const locks = new Map<string, Promise<unknown>>();

/** @description Serialise work on one project inside this api process. */
export function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(projectId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(projectId, tail);
  void tail.then(() => { if (locks.get(projectId) === tail) locks.delete(projectId); });
  return run;
}

/** @description The current revision's files ([] before the first revision). */
export async function loadFiles(deps: ServiceDeps, sub: string, project: ProjectRow): Promise<WireFile[]> {
  if (project.revision === 0) return [];
  const rev = await getRevision(deps.pool, sub, project.project_id, project.revision);
  if (!rev) throw new FileError('the current revision is missing', 'revision', 500);
  return readRevisionBlob(revisionsDir(deps.dataRoot, sub, project.project_id), rev.blob);
}

async function requireProject(deps: ServiceDeps, sub: string, projectId: string): Promise<ProjectRow> {
  const project = await getProject(deps.pool, sub, projectId);
  if (!project) throw new NotFoundError();
  return project;
}

function requireKind(project: ProjectRow, kind: ProjectKind, what: string): void {
  if (project.kind !== kind) throw new RequestError(`${what} works on a ${kind} project; "${project.title}" is a ${project.kind} project`, 'kind');
}

/** @description Store `files` as the next revision of `project`. @throws ConflictError */
async function commit(deps: ServiceDeps, sub: string, project: ProjectRow, m: Mutation & { files: WireFile[] }): Promise<ProjectRow> {
  assertWithinLimits(m.files);
  const { fileCount, totalBytes } = summarize(m.files);
  const dir = revisionsDir(deps.dataRoot, sub, project.project_id);
  const blob = writeRevisionBlob(dir, project.revision + 1, m.files);
  const updated = await commitRevision(deps.pool, sub, project.project_id, project.revision, {
    action: m.action, detail: m.detail, fileCount, totalBytes, blob, engineBuild: m.engineBuild,
  });
  if (!updated) {
    removeRevisionBlobs(dir, [blob]);
    throw new ConflictError('the project changed while this ran — read it again and retry');
  }
  await prune(deps, sub, updated);
  logger.info({ projectId: project.project_id, revision: updated.revision, action: m.action, fileCount }, 'Committed a project revision');
  return updated;
}

async function prune(deps: ServiceDeps, sub: string, project: ProjectRow): Promise<void> {
  const keepFrom = project.revision - FILE_LIMITS.keepRevisions + 1;
  if (keepFrom <= 1) return;
  const dropped = await pruneRevisions(deps.pool, sub, project.project_id, keepFrom);
  removeRevisionBlobs(revisionsDir(deps.dataRoot, sub, project.project_id), dropped.map((d) => d.blob));
  for (const d of dropped) fs.rmSync(artifactsDir(deps.dataRoot, sub, project.project_id, d.revision), { recursive: true, force: true });
}

/** @description Run one change under the project's lock, from its latest revision. */
async function mutate(deps: ServiceDeps, sub: string, projectId: string, fn: (project: ProjectRow, files: WireFile[]) => Promise<Mutation>): Promise<MutationOutcome> {
  return withProjectLock(projectId, async () => {
    const project = await requireProject(deps, sub, projectId);
    const files = await loadFiles(deps, sub, project);
    const m = await fn(project, files);
    if (!m.files) return { project, changed: false, extra: m.extra ?? {} };
    const updated = await commit(deps, sub, project, { ...m, files: m.files });
    return { project: updated, changed: true, extra: m.extra ?? {} };
  });
}

/** @description A new project: the engine writes its starting files, which become revision 1. */
export async function createProject(deps: ServiceDeps, sub: string, input: { title: string; kind: ProjectKind; template: string }): Promise<ProjectRow> {
  const started = (await deps.engine.request('new_project', { kind: input.kind, template: input.template, title: input.title }, 120_000)) as { files: WireFile[] };
  assertWithinLimits(started.files);
  const project = await insertProject(deps.pool, sub, input);
  return withProjectLock(project.project_id, () => commit(deps, sub, project, {
    files: started.files, action: 'create', detail: { template: input.template }, engineBuild: deps.engineBuild,
  }));
}

interface McpReply { text: string; isError: boolean; changed: boolean; delta: Record<string, string[]>; files?: WireFile[] }

/**
 * @description Call one allowlisted tool of godot-mcp (Godot project) or the Blender Lab MCP
 * (Blender project) on the project; a change lands as a new revision.
 */
export async function callProjectTool(deps: ServiceDeps, sub: string, projectId: string, call: { server: ProjectKind; tool: string; args: Record<string, unknown>; file?: string; save?: boolean }): Promise<MutationOutcome> {
  return mutate(deps, sub, projectId, async (project, files) => {
    requireKind(project, call.server, `the ${call.server} ${call.tool} tool`);
    const reply = (await deps.engine.request('mcp_call', {
      server: call.server, tool: call.tool, arguments: call.args, files, file: call.file, save: call.save, timeoutSec: TOOL_SECONDS,
    }, (TOOL_SECONDS + 25) * 1000)) as McpReply;
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
export async function blenderDocs(deps: ServiceDeps, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const reply = (await deps.engine.request('mcp_call', { server: 'blender', tool, arguments: args, files: [], timeoutSec: 60 }, 90_000)) as McpReply;
  return { text: clip(reply.text, 9000), isError: reply.isError };
}

/** @description Write (create or replace) one UTF-8 text file. */
export async function writeTextFile(deps: ServiceDeps, sub: string, projectId: string, filePath: string, text: string): Promise<MutationOutcome> {
  const p = refuseDerived(validatePath(filePath));
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > FILE_LIMITS.maxTextWriteBytes) throw new FileError(`a text write is at most ${FILE_LIMITS.maxTextWriteBytes} bytes; upload larger files`, 'text', 413);
  return mutate(deps, sub, projectId, async (_project, files) => ({
    files: withFile(files, p, bytes), action: 'write-file', detail: { path: p, bytes: bytes.length }, engineBuild: null,
  }));
}

/** @description Store one uploaded file (any bytes). */
export async function uploadFile(deps: ServiceDeps, sub: string, projectId: string, filePath: string, bytes: Buffer): Promise<MutationOutcome> {
  const p = refuseDerived(validatePath(filePath));
  return mutate(deps, sub, projectId, async (_project, files) => ({
    files: withFile(files, p, bytes), action: 'upload', detail: { path: p, bytes: bytes.length }, engineBuild: null,
  }));
}

/** @description Delete one file. */
export async function deleteFile(deps: ServiceDeps, sub: string, projectId: string, filePath: string): Promise<MutationOutcome> {
  const p = validatePath(filePath);
  return mutate(deps, sub, projectId, async (_project, files) => ({
    files: withoutFile(files, p), action: 'delete-file', detail: { path: p }, engineBuild: null,
  }));
}

/** @description Put an earlier revision's files back as a NEW revision (undo; nothing is lost). */
export async function restoreRevision(deps: ServiceDeps, sub: string, projectId: string, revision: number): Promise<MutationOutcome> {
  return mutate(deps, sub, projectId, async (project) => {
    const rev = await getRevision(deps.pool, sub, project.project_id, revision);
    if (!rev) throw new NotFoundError('revision_not_found');
    const files = readRevisionBlob(revisionsDir(deps.dataRoot, sub, project.project_id), rev.blob);
    return { files, action: 'restore', detail: { restoredFrom: revision }, engineBuild: null };
  });
}

/** @description Export a Blender project's scene into this Godot project's models/ and import it. */
export async function importModel(deps: ServiceDeps, sub: string, projectId: string, input: { fromProjectId: string; name: string; instance?: Record<string, unknown> }): Promise<MutationOutcome> {
  const source = await requireProject(deps, sub, input.fromProjectId);
  requireKind(source, 'blender', 'the model source');
  const fromFiles = await loadFiles(deps, sub, source);
  return mutate(deps, sub, projectId, async (project, files) => {
    requireKind(project, 'godot', 'Importing a model');
    const reply = (await deps.engine.request('import_model', { name: input.name, fromFiles, files, instance: input.instance }, 300_000)) as { files: WireFile[]; changed: boolean; delta: Record<string, string[]>; resPath: string };
    return {
      files: reply.changed ? reply.files : undefined, action: 'import-model',
      detail: { from: source.project_id, fromRevision: source.revision, name: input.name, resPath: reply.resPath, delta: reply.delta },
      engineBuild: deps.engineBuild, extra: { resPath: reply.resPath, delta: reply.delta },
    };
  });
}

/** @description Render a preview still (and glTF) of the current revision; recorded on the project. */
export async function renderPreview(deps: ServiceDeps, sub: string, projectId: string, opts: { scene?: string; file?: string; width?: number; height?: number; samples?: number }): Promise<{ project: ProjectRow; preview: Record<string, unknown> }> {
  const project = await requireProject(deps, sub, projectId);
  const files = await loadFiles(deps, sub, project);
  const reply = (await deps.engine.request('preview', { kind: project.kind, files, ...opts }, 300_000)) as { png: string; glb: string; stl: string; info: Record<string, unknown> };
  const dir = ensureDir(artifactsDir(deps.dataRoot, sub, project.project_id, project.revision));
  fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.from(reply.png, 'base64'), { mode: 0o600 });
  const glb = writeOptional(dir, 'preview.glb', reply.glb);
  const stl = writeOptional(dir, 'preview.stl', reply.stl);
  const record = { revision: project.revision, info: reply.info, glb, stl, at: new Date().toISOString() };
  const updated = (await setProjectRecord(deps.pool, sub, project.project_id, 'preview', record)) ?? project;
  return { project: updated, preview: previewView(updated.project_id, record) };
}

/** Write an optional base64 artifact; false when the engine did not produce it. */
function writeOptional(dir: string, name: string, data: string | undefined): boolean {
  const bytes = Buffer.from(data || '', 'base64');
  if (!bytes.length) return false;
  fs.writeFileSync(path.join(dir, name), bytes, { mode: 0o600 });
  return true;
}

/** @description One downloadable export of the current revision. */
export async function exportProject(deps: ServiceDeps, sub: string, projectId: string, format: string, file?: string): Promise<Record<string, unknown>> {
  const project = await requireProject(deps, sub, projectId);
  const files = await loadFiles(deps, sub, project);
  const reply = (await deps.engine.request('export', { kind: project.kind, format, files, file }, 240_000)) as { name: string; contentType: string; data: string };
  const name = `export.${format}`;
  const bytes = Buffer.from(reply.data, 'base64');
  fs.writeFileSync(path.join(ensureDir(artifactsDir(deps.dataRoot, sub, project.project_id, project.revision)), name), bytes, { mode: 0o600 });
  return { format, bytes: bytes.length, revision: project.revision, url: artifactUrl(project.project_id, name, project.revision) };
}

/** @description Run a Godot project headless for a few seconds; the output is recorded on the project. */
export async function runProject(deps: ServiceDeps, sub: string, projectId: string, opts: { seconds: number; scene?: string }): Promise<{ project: ProjectRow; run: Record<string, unknown> }> {
  const project = await requireProject(deps, sub, projectId);
  requireKind(project, 'godot', 'Running');
  const files = await loadFiles(deps, sub, project);
  const reply = (await deps.engine.request('godot_run', { files, seconds: opts.seconds, scene: opts.scene }, (opts.seconds + 90) * 1000)) as { output: string[]; errors: string[]; seconds: number };
  const run = { revision: project.revision, seconds: reply.seconds, scene: opts.scene ?? null, output: reply.output.slice(0, 200), errors: reply.errors.slice(0, 200), at: new Date().toISOString() };
  const updated = (await setProjectRecord(deps.pool, sub, project.project_id, 'last_run', run)) ?? project;
  return { project: updated, run };
}

/** @description Remove a project's files and artifacts from disk (the row is deleted by the caller). */
export function removeProjectFiles(deps: ServiceDeps, sub: string, projectId: string): void {
  fs.rmSync(projectDir(deps.dataRoot, sub, projectId), { recursive: true, force: true });
}

/** @description The URL an artifact is served from. */
export function artifactUrl(projectId: string, name: string, revision: number): string {
  return `${BASE}/projects/${projectId}/artifacts/${name}?revision=${revision}`;
}

/** @description The preview record with its URLs. */
export function previewView(projectId: string, record: Record<string, unknown>): Record<string, unknown> {
  const revision = Number(record.revision);
  return {
    ...record,
    png: artifactUrl(projectId, 'preview.png', revision),
    glbUrl: record.glb ? artifactUrl(projectId, 'preview.glb', revision) : null,
    stlUrl: record.stl ? artifactUrl(projectId, 'preview.stl', revision) : null,
  };
}

function refuseDerived(p: string): string {
  if (p.startsWith('.godot/')) throw new FileError('.godot/ is Godot\'s derived import state; Scene Studio rebuilds it — edit the source files instead');
  return p;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… [${text.length - max} more characters]`;
}
