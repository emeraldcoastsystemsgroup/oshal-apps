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

import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { createChildLogger } from '@/shared/logger';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';
import { ARTIFACT_TYPES, artifactsDir, isArtifactName, requireRevision, requireUuid } from './data-dir';
import { FILE_LIMITS, FileError, fileData, isText, listing } from './project-files';
import { deleteProject, getProject, listProjects, listRevisions, renameProject, type ProjectKind, type ProjectRow } from './project-store';
import {
  RequestError, blenderDocs, callProjectTool, createProject, deleteFile, exportProject, importModel,
  loadFiles, removeProjectFiles, renderPreview, restoreRevision, runProject, uploadFile, writeTextFile,
  type MutationOutcome, type ServiceDeps,
} from './project-service';
import { classifyFailure, intOption, optionalString, projectTitle, publicProject } from './project-view';
import { BLENDER_DOC_TOOLS, BLENDER_PROJECT_TOOLS, EXPORT_FORMATS, GODOT_TOOLS, TEMPLATES, toolArguments } from './tool-contract';

const logger = createChildLogger({ module: 'scene-studio-project-routes' });

export interface ProjectRouteDeps extends ServiceDeps {
  callerSub: (req: Request) => string | null;
}

type SceneRequest = Request & { sceneSub?: string; sceneProject?: ProjectRow };

export { publicProject };

/** @description Map a thrown error to its HTTP answer; false when it is unexpected. */
export function refuse(res: Response, error: unknown): boolean {
  const failure = classifyFailure(error);
  if (!failure) return false;
  res.status(failure.status).json(failure.body);
  return true;
}

function fail(res: Response, error: unknown, what: string, context: Record<string, unknown> = {}): void {
  if (refuse(res, error)) return;
  logger.error({ err: error, ...context }, `${what} failed`);
  res.status(500).json({ error: `${what.toLowerCase().replace(/\s+/g, '_')}_failed` });
}

function body(req: Request): Record<string, unknown> {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

function outcome(res: Response, out: MutationOutcome, status = 200): void {
  res.status(status).json({ project: publicProject(out.project), changed: out.changed, ...out.extra });
}

/**
 * @description Build the project router (mounted under the package's oidc mount).
 * @param deps - Pool, engine, data root, caller resolver.
 * @returns The router.
 */
export function createProjectRoutes(deps: ProjectRouteDeps): Router {
  const router = Router();
  router.use((req: SceneRequest, res, next) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    req.sceneSub = sub;
    next();
  });
  router.param('projectId', async (req: SceneRequest, res, next, value) => {
    try {
      const project = await getProject(deps.pool, req.sceneSub as string, requireUuid(value));
      if (!project) { res.status(404).json({ error: 'project_not_found' }); return; }
      req.sceneProject = project;
      next();
    } catch (error) { fail(res, error, 'Load project'); }
  });
  registerProjectCrud(router, deps);
  registerFileRoutes(router, deps);
  registerToolRoutes(router, deps);
  registerOutputRoutes(router, deps);
  return router;
}

function registerProjectCrud(router: Router, deps: ProjectRouteDeps): void {
  router.get('/projects', async (req: SceneRequest, res) => {
    try { res.json({ projects: (await listProjects(deps.pool, req.sceneSub as string)).map(publicProject) }); }
    catch (error) { fail(res, error, 'List projects'); }
  });
  router.post('/projects', async (req: SceneRequest, res) => {
    const b = body(req);
    try {
      const kind = b.kind;
      if (kind !== 'godot' && kind !== 'blender') throw new RequestError("kind must be 'godot' (a game or 3-D scene) or 'blender' (a model)", 'kind');
      const template = optionalString(b.template, 'template') ?? TEMPLATES[kind][0];
      if (!TEMPLATES[kind].includes(template)) throw new RequestError(`template must be one of ${TEMPLATES[kind].join(', ')}`, 'template');
      const project = await createProject(deps, req.sceneSub as string, { title: projectTitle(b.title, kind === 'godot' ? 'Untitled game' : 'Untitled model'), kind, template });
      res.status(201).json({ project: publicProject(project) });
    } catch (error) { fail(res, error, 'Create project'); }
  });
  router.get('/projects/:projectId', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    try {
      const files = await loadFiles(deps, req.sceneSub as string, project);
      const revisions = (await listRevisions(deps.pool, req.sceneSub as string, project.project_id, 20))
        .map((r) => ({ revision: r.revision, action: r.action, detail: r.detail, fileCount: r.file_count, at: r.created_at }));
      res.json({ project: publicProject(project), ...listing(files), revisions, engine: deps.engine.status() });
    } catch (error) { fail(res, error, 'Read project', { projectId: project.project_id }); }
  });
  router.patch('/projects/:projectId', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    try {
      const updated = await renameProject(deps.pool, req.sceneSub as string, project.project_id, projectTitle(body(req).title, project.title));
      res.json({ project: publicProject(updated ?? project) });
    } catch (error) { fail(res, error, 'Rename project', { projectId: project.project_id }); }
  });
  router.delete('/projects/:projectId', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    if (!hasExplicitWriteConfirmation(body(req))) { res.status(428).json(confirmationRequiredPayload('scene-studio-delete-project', `delete "${project.title}" and every revision of it`)); return; }
    try {
      await deleteProject(deps.pool, req.sceneSub as string, project.project_id);
      removeProjectFiles(deps, req.sceneSub as string, project.project_id);
      logger.info({ projectId: project.project_id }, 'Deleted a project');
      res.json({ deleted: project.project_id });
    } catch (error) { fail(res, error, 'Delete project', { projectId: project.project_id }); }
  });
}

function registerFileRoutes(router: Router, deps: ProjectRouteDeps): void {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: FILE_LIMITS.maxUploadBytes, files: 1 } });
  router.post('/projects/:projectId/files/read', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    try {
      const filePath = String(body(req).path ?? '');
      const bytes = fileData(await loadFiles(deps, req.sceneSub as string, project), filePath);
      if (!bytes) throw new FileError(`${filePath} is not in this project`, 'path', 404);
      const text = isText(bytes) ? bytes.subarray(0, FILE_LIMITS.maxTextReadBytes).toString('utf8') : null;
      res.json({ path: filePath, bytes: bytes.length, binary: text === null, text, truncated: text !== null && bytes.length > FILE_LIMITS.maxTextReadBytes, revision: project.revision });
    } catch (error) { fail(res, error, 'Read file', { projectId: project.project_id }); }
  });
  router.get('/projects/:projectId/files/download', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    try {
      const filePath = String(req.query.path ?? '');
      const bytes = fileData(await loadFiles(deps, req.sceneSub as string, project), filePath);
      if (!bytes) throw new FileError(`${filePath} is not in this project`, 'path', 404);
      res.setHeader('Content-Disposition', `attachment; filename="${path.posix.basename(filePath).replace(/[^A-Za-z0-9._-]/g, '_')}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type('application/octet-stream').send(bytes);
    } catch (error) { fail(res, error, 'Download file', { projectId: project.project_id }); }
  });
  router.put('/projects/:projectId/files', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    const b = body(req);
    try {
      if (typeof b.text !== 'string') throw new RequestError('text must be a string (the whole file)', 'text');
      outcome(res, await writeTextFile(deps, req.sceneSub as string, project.project_id, String(b.path ?? ''), b.text));
    } catch (error) { fail(res, error, 'Write file', { projectId: project.project_id }); }
  });
  router.post('/projects/:projectId/files/upload', upload.single('file'), async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    try {
      const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
      if (!file) throw new RequestError('no file in the upload (multipart field "file")', 'file');
      const target = String(body(req).path || `assets/${file.originalname}`);
      outcome(res, await uploadFile(deps, req.sceneSub as string, project.project_id, target, file.buffer), 201);
    } catch (error) { fail(res, error, 'Upload file', { projectId: project.project_id }); }
  });
  router.delete('/projects/:projectId/files', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    try { outcome(res, await deleteFile(deps, req.sceneSub as string, project.project_id, String(body(req).path ?? req.query.path ?? ''))); }
    catch (error) { fail(res, error, 'Delete file', { projectId: project.project_id }); }
  });
}

function registerToolRoutes(router: Router, deps: ProjectRouteDeps): void {
  router.post('/projects/:projectId/godot/:tool', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    try {
      const tool = String(req.params.tool);
      if (!GODOT_TOOLS.includes(tool)) throw new RequestError(`godot tool must be one of ${GODOT_TOOLS.join(', ')}`, 'tool');
      outcome(res, await callProjectTool(deps, req.sceneSub as string, project.project_id, { server: 'godot', tool, args: toolArguments(body(req)) }));
    } catch (error) { fail(res, error, 'Godot tool', { projectId: project.project_id }); }
  });
  router.post('/projects/:projectId/blender/:tool', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    const b = body(req);
    try {
      const tool = String(req.params.tool);
      if (!BLENDER_PROJECT_TOOLS.includes(tool)) throw new RequestError(`blender tool must be one of ${BLENDER_PROJECT_TOOLS.join(', ')}`, 'tool');
      const args = tool === 'execute_blender_code_for_cli' ? { code: b.code } : {};
      const save = b.save === undefined ? true : b.save === true;
      outcome(res, await callProjectTool(deps, req.sceneSub as string, project.project_id, { server: 'blender', tool, args, file: optionalString(b.file, 'file'), save }));
    } catch (error) { fail(res, error, 'Blender tool', { projectId: project.project_id }); }
  });
  router.post('/blender-docs', async (req: SceneRequest, res) => {
    const b = body(req);
    try {
      const tool = String(b.tool ?? 'search_api_docs');
      if (!BLENDER_DOC_TOOLS.includes(tool)) throw new RequestError(`docs tool must be one of ${BLENDER_DOC_TOOLS.join(', ')}`, 'tool');
      res.json(await blenderDocs(deps, tool, toolArguments(b, ['tool'])));
    } catch (error) { fail(res, error, 'Blender docs'); }
  });
  router.post('/projects/:projectId/import-model', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    const b = body(req);
    try {
      const instance = b.instance && typeof b.instance === 'object' && !Array.isArray(b.instance) ? (b.instance as Record<string, unknown>) : undefined;
      const out = await importModel(deps, req.sceneSub as string, project.project_id, { fromProjectId: requireUuid(b.fromProjectId), name: String(b.name ?? ''), instance });
      outcome(res, out);
    } catch (error) { fail(res, error, 'Import model', { projectId: project.project_id }); }
  });
  router.post('/projects/:projectId/restore', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    try { outcome(res, await restoreRevision(deps, req.sceneSub as string, project.project_id, requireRevision(body(req).revision))); }
    catch (error) { fail(res, error, 'Restore revision', { projectId: project.project_id }); }
  });
}

function registerOutputRoutes(router: Router, deps: ProjectRouteDeps): void {
  router.post('/projects/:projectId/run', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    const b = body(req);
    try {
      const out = await runProject(deps, req.sceneSub as string, project.project_id, { seconds: intOption(b.seconds, 'seconds', 1, 30) ?? 5, scene: optionalString(b.scene, 'scene') });
      res.json({ project: publicProject(out.project), run: out.run });
    } catch (error) { fail(res, error, 'Run project', { projectId: project.project_id }); }
  });
  router.post('/projects/:projectId/preview', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    const b = body(req);
    try {
      const out = await renderPreview(deps, req.sceneSub as string, project.project_id, {
        scene: optionalString(b.scene, 'scene'), file: optionalString(b.file, 'file'),
        width: intOption(b.width, 'width', 64, 1920), height: intOption(b.height, 'height', 64, 1080), samples: intOption(b.samples, 'samples', 1, 256),
      });
      res.json({ project: publicProject(out.project), preview: out.preview });
    } catch (error) { fail(res, error, 'Render preview', { projectId: project.project_id }); }
  });
  router.post('/projects/:projectId/export', async (req: SceneRequest, res) => {
    const project = req.sceneProject as ProjectRow;
    const b = body(req);
    try {
      const format = String(b.format ?? (project.kind === 'godot' ? 'zip' : 'glb'));
      if (!EXPORT_FORMATS[project.kind].includes(format)) throw new RequestError(`a ${project.kind} project exports as ${EXPORT_FORMATS[project.kind].join(', ')}`, 'format');
      res.json({ export: await exportProject(deps, req.sceneSub as string, project.project_id, format, optionalString(b.file, 'file')) });
    } catch (error) { fail(res, error, 'Export project', { projectId: project.project_id }); }
  });
  router.get('/projects/:projectId/artifacts/:name', (req: SceneRequest, res) => serveArtifact(req, res, deps));
}

function serveArtifact(req: SceneRequest, res: Response, deps: ProjectRouteDeps): void {
  const project = req.sceneProject as ProjectRow;
  try {
    const name = String(req.params.name);
    if (!isArtifactName(name)) throw new RequestError('unknown artifact', 'name');
    const revision = req.query.revision === undefined ? project.revision : requireRevision(req.query.revision);
    const file = path.join(artifactsDir(deps.dataRoot, req.sceneSub as string, project.project_id, revision), name);
    if (!fs.existsSync(file)) { res.status(404).json({ error: 'artifact_not_found', message: `no ${name} for revision ${revision} — render or export it first` }); return; }
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!name.endsWith('.png')) res.setHeader('Content-Disposition', `attachment; filename="${project.title.replace(/[^A-Za-z0-9._-]/g, '_')}-r${revision}-${name}"`);
    res.type(ARTIFACT_TYPES[name]).send(fs.readFileSync(file));
  } catch (error) { fail(res, error, 'Serve artifact', { projectId: project.project_id }); }
}

export type { ProjectKind };
