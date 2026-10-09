/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Selected-region regeneration behind the separately named project.generate permission: validate the request against the exact source revision with the same selection module the browser runs, generate through the media-generation kernel skill with the region crop as the one anchor, composite only inside the region, and keep the result as a candidate the person accepts (optimistic on the revision they hold), rejects or cancels. Spend is captured in the canonical ledger; manual editing never reaches this path.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Advertise cost-consent v1 and validate optional per-request cost-class caps before storage work. Enforce the cap on the actual post-queue provider immediately before generation; omitted caps preserve legacy behavior.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Accept the operator-only antigravity-cli rail (operator decision 2026-10-02, core ADR-130 amendment: the render bot's own harness picks the storyboard image rail). The provider must report itself available for this person before generation (the kernel's CLI rails are available only to the deployment operator in demo mode), and a person the resolver has no provider for gets region_edit_provider_unavailable on the edit and configured:false on the provider report, never another provider and never a 500. codex-cli stays refused by name; project.generate is still checked first.
 */
import { json, type Router, type Request, type Response, type RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { resolveStoryboardImageProvider, recordStoryboardImageCost } from '@/features/video-generation';
import { ProjectError, PROJECT_ASSET_PREFIX, type ProjectContext, type ProjectDocument, type ProjectInput, type ProjectOwner } from './create-project-types';
import { baseRevision, exactFields, projectId, validateDocument, type ProjectValidator } from './create-project-validation';
import { requireProjectAccess, type ProjectAction } from './create-project-authorization';
import { readProjectImage, saveProjectImage } from './create-project-assets';
import type { CreateProjectStore } from './create-project-store';
import { CreateRegionEditStore, type RegionEditRecord, type RegionEditRequest } from './create-region-edit-store';
import { compositeRegion, regionAnchor, regionCropBox, regionPrompt, type RegionSelection } from './create-region-edit-composite';

const logger = createChildLogger({ module: 'create-region-edit-routes' });
/** Image spend is attributed to the concierge Create declares (chatBot: general-bot, core registry a0...0099) and to the person. */
export const REGION_EDIT_COST_AGENT_ID = 'a0000000-0000-0000-0000-000000000099';
const bodyParser = json({ limit: 262144, strict: true });

/** The slice of the media-generation provider contract this route uses; the kernel provider satisfies it. */
export interface RegionImageProvider {
  readonly id: string; readonly costClass: 'free' | 'paid'; available(): Promise<boolean>;
  generate(prompt: string, anchor: Buffer | null): Promise<Buffer>;
  generateWithMeta?(prompt: string, anchor: Buffer | null): Promise<{ image: Buffer; costUsd: number | null; model: string }>;
}
export interface RegionCostEvent { taskId: string; agentId: string; ownerSub: string; providerId: string; model: string; costUsd: number; durationMs?: number }
/** Replaceable only by tests, which name their fixture provider explicitly; production uses the kernel skill. */
export interface RegionEditDependencies {
  resolveProvider(options: { userSub: string }): Promise<RegionImageProvider>;
  recordCost(pool: ProjectContext['pool'], event: RegionCostEvent): Promise<void>;
}
interface RegionModule { validateSelection(value: unknown): RegionSelection; resolveSelection(project: unknown, selection: RegionSelection): { layer: { assetId: string } } }
export interface RegionEditSettings { dailyCap: number; concurrency: number; timeoutMs: number }
export interface RegionRouteGuards { personalOnly(req: Request): void; sendError(res: Response, error: unknown): void }
interface RegionEnvironment {
  ctx: ProjectContext; projects: CreateProjectStore; edits: CreateRegionEditStore; dataRoot: string; guards: RegionRouteGuards;
  validator: Promise<ProjectValidator>; region: Promise<RegionModule>; deps: RegionEditDependencies; settings: RegionEditSettings; slots: Slots;
}
type RegionWork = (req: Request, res: Response, owner: ProjectOwner) => Promise<void>;
type RegionCostCap = 'free' | 'paid';

const DEFAULT_DEPENDENCIES: RegionEditDependencies = {
  resolveProvider: options => resolveStoryboardImageProvider(options),
  recordCost: (pool, event) => recordStoryboardImageCost(pool as Pool, event),
};

function bounded(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

/**
 * @description Operator-tunable ceilings, read once when the router is built.
 * @param env - Process environment.
 * @returns Daily requests per person, concurrent provider calls per process and the provider deadline.
 */
export function regionEditSettings(env: NodeJS.ProcessEnv = process.env): RegionEditSettings {
  return { dailyCap: bounded(env.CREATE_REGION_EDIT_DAILY_CAP, 25, 1, 1000), concurrency: bounded(env.CREATE_REGION_EDIT_MAX_CONCURRENT, 2, 1, 16),
    timeoutMs: bounded(env.CREATE_REGION_EDIT_TIMEOUT_MS, 120000, 10000, 600000) };
}

/** A process-wide bound on concurrent provider calls, shared by every person. */
class Slots {
  private active = 0; private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.limit) { this.active++; return; }
    await new Promise<void>(done => this.waiting.push(done));
  }
  release(): void { const next = this.waiting.shift(); if (next) next(); else this.active--; }
}

/**
 * @description Capture the installed region-selection module once, keyed by its bytes like the project validator.
 * @param packageDir - Installed package root.
 * @returns The browser's own validateSelection and resolveSelection.
 */
export function loadRegionModule(packageDir: string): Promise<RegionModule> {
  const file = resolve(packageDir, 'tools/editor/region-select.mjs');
  const url = pathToFileURL(file); url.searchParams.set('revision', createHash('sha256').update(readFileSync(file)).digest('hex'));
  return import(url.href) as Promise<RegionModule>;
}

/**
 * @description One instruction: 1 to 1000 characters after trimming, no control characters other than line breaks and tabs.
 * @param value - Candidate instruction.
 * @returns The trimmed instruction.
 */
export function regionInstruction(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new ProjectError(400, 'invalid_region_instruction');
  return text;
}

/**
 * @description The child document an accepted candidate becomes: the current revision with only the target layer's image replaced.
 * @param current - Current revision title and document. @param edit - Ready region edit. @param validate - Shared model validator.
 * @returns Title and validated reference-mode document; a replaced or deleted target is 409 stale, a locked one 409 locked.
 */
export function acceptedInput(current: { title: string; document: ProjectDocument }, edit: RegionEditRecord, validate: ProjectValidator): ProjectInput {
  const document = current.document as unknown as { name: string; layers: Array<Record<string, unknown>>; images: Record<string, { src: string; width: number; height: number }> };
  const layer = document.layers.find(item => item.id === edit.layerId), image = layer && document.images[String(layer.assetId)];
  if (!layer || layer.type !== 'image' || image?.src !== PROJECT_ASSET_PREFIX + edit.sourceAssetId || !edit.resultAsset) throw new ProjectError(409, 'region_edit_stale');
  if (layer.locked) throw new ProjectError(409, 'region_edit_layer_locked');
  let key = `region-${edit.id.slice(0, 8)}`;
  for (let suffix = 2; Object.hasOwn(document.images, key); suffix++) key = `region-${edit.id.slice(0, 8)}-${suffix}`;
  const images = { ...document.images, [key]: { src: edit.resultAsset.src, width: edit.resultAsset.width, height: edit.resultAsset.height } };
  const layers = document.layers.map(item => item.id === layer.id ? { ...item, assetId: key } : item);
  if (!layers.some(item => item.type === 'image' && item.assetId === layer.assetId)) delete images[String(layer.assetId)];
  return { title: current.title, document: validateDocument({ ...document, layers, images }, validate) };
}

function admit(env: RegionEnvironment, action: ProjectAction): RequestHandler {
  return (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    Promise.resolve().then(() => {
      if (typeof env.ctx.pool?.connect !== 'function') throw new ProjectError(503, 'project_store_unavailable');
      env.guards.personalOnly(req);
    }).then(() => requireProjectAccess(env.ctx, action)).then(() => next()).catch(error => env.guards.sendError(res, error));
  };
}
function handler(env: RegionEnvironment, action: ProjectAction, work: RegionWork): RequestHandler {
  return (req, res) => { requireProjectAccess(env.ctx, action).then(owner => work(req, res, owner)).catch(error => env.guards.sendError(res, error)); };
}
function confirm(env: RegionEnvironment, action: ProjectAction, owner: ProjectOwner): () => Promise<void> {
  return async () => { await requireProjectAccess(env.ctx, action, owner); };
}

/** An omitted cap retains legacy semantics; a supplied cap must be one exact known class. */
function regionCostCap(body: Record<string, unknown>): RegionCostCap | undefined {
  if (!Object.hasOwn(body, 'maxCostClass')) return undefined;
  if (body.maxCostClass !== 'free' && body.maxCostClass !== 'paid') throw new ProjectError(400, 'invalid_region_cost_cap');
  return body.maxCostClass;
}

/** Validate the body with no database work, then resolve the selection against the exact stored source revision. */
async function regionRequest(env: RegionEnvironment, id: string, body: unknown, owner: ProjectOwner): Promise<{ request: RegionEditRequest; maxCostClass: RegionCostCap | undefined }> {
  exactFields(body, ['sourceRevision', 'selection', 'instruction', 'maxCostClass']);
  const maxCostClass = regionCostCap(body);
  const sourceRevision = baseRevision(body.sourceRevision), instruction = regionInstruction(body.instruction), module = await env.region;
  let selection: RegionSelection;
  try { selection = module.validateSelection(body.selection); } catch { throw new ProjectError(400, 'invalid_region_selection'); }
  const source = await env.projects.get(owner, id, sourceRevision);
  let assetKey: string;
  try { assetKey = module.resolveSelection(source.document, selection).layer.assetId; } catch { throw new ProjectError(409, 'region_selection_stale'); }
  const image = (source.document.images as Record<string, { src: string }>)[assetKey];
  return { maxCostClass, request: { projectId: id, sourceRevision, layerId: selection.layerId,
    sourceAssetId: projectId(image.src.slice(PROJECT_ASSET_PREFIX.length)), selection, instruction } };
}

function withTimeout<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ProjectError(504, 'region_edit_provider_timeout')), milliseconds); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

async function generate(provider: RegionImageProvider, prompt: string, anchor: Buffer): Promise<{ image: Buffer; costUsd: number | null; model: string }> {
  if (provider.generateWithMeta) return provider.generateWithMeta(prompt, anchor);
  return { image: await provider.generate(prompt, anchor), costUsd: null, model: `${provider.id}-default` };
}

/** Capped work cannot reach an unknown cost class or escalate from free to paid. No provider fallback is permitted. */
function enforceCostCap(provider: RegionImageProvider, maxCostClass: RegionCostCap | undefined): void {
  if (maxCostClass === undefined) return;
  if ((provider.costClass !== 'free' && provider.costClass !== 'paid') || (maxCostClass === 'free' && provider.costClass !== 'free')) {
    throw new ProjectError(409, 'region_edit_cost_cap_exceeded');
  }
}

/** This person's provider, or null when the resolver has none for them (for example a CLI rail that serves only the operator). Never a fallback. */
async function resolveFor(env: RegionEnvironment, owner: ProjectOwner): Promise<RegionImageProvider | null> {
  try { return await env.deps.resolveProvider({ userSub: owner.sub }); }
  catch (error) { logger.error({ err: error }, 'no image provider is configured for this person; region editing is unavailable to them'); return null; }
}

/** The command-line codex transport is refused by name; any other provider serves only when it reports itself available for this person. */
async function servesRegionEdits(provider: RegionImageProvider): Promise<boolean> {
  return provider.id !== 'codex-cli' && await provider.available();
}

/** Provider answer to candidate: re-check permission and cost cap before the call, capture spend, composite, then attach only if still wanted. */
async function produceCandidate(env: RegionEnvironment, owner: ProjectOwner, edit: RegionEditRecord, allowed: () => Promise<void>, maxCostClass: RegionCostCap | undefined): Promise<void> {
  const started = Date.now(), source = await readProjectImage(env.dataRoot, env.projects, owner, edit.sourceAssetId);
  const anchor = await regionAnchor(source, regionCropBox(edit.selection)), provider = await resolveFor(env, owner);
  if (!provider || !(await servesRegionEdits(provider))) throw new ProjectError(503, 'region_edit_provider_unavailable');
  await allowed();
  enforceCostCap(provider, maxCostClass);
  const answer = await withTimeout(generate(provider, regionPrompt(edit.instruction), anchor), env.settings.timeoutMs);
  if (typeof answer.costUsd === 'number' && answer.costUsd > 0) {
    await env.deps.recordCost(env.ctx.pool, { taskId: `create-region-edit-${edit.id}`, agentId: REGION_EDIT_COST_AGENT_ID, ownerSub: owner.sub,
      providerId: `image-provider:${provider.id}`, model: answer.model, costUsd: answer.costUsd, durationMs: Date.now() - started });
  }
  await allowed();
  const composite = await compositeRegion(source, edit.selection, answer.image);
  const asset = await saveProjectImage(env.dataRoot, env.projects, owner, composite.png, allowed);
  const attached = await env.edits.complete(owner, edit.projectId, edit.id, { asset, provider: provider.id, model: answer.model, costUsd: answer.costUsd }, allowed);
  logger.info({ editId: edit.id, provider: provider.id, model: answer.model, costUsd: answer.costUsd, attached, changedPixels: composite.changedPixels,
    durationMs: Date.now() - started }, attached ? 'region edit candidate ready' : 'region edit finished after it was cancelled; candidate discarded');
}

/** Background half of a request: bounded by the process-wide slots; every failure is recorded and nothing touches the project. */
async function runRegionEdit(env: RegionEnvironment, owner: ProjectOwner, edit: RegionEditRecord, maxCostClass: RegionCostCap | undefined): Promise<void> {
  await env.slots.acquire();
  try { await produceCandidate(env, owner, edit, confirm(env, 'generate', owner), maxCostClass); }
  catch (error) {
    const code = error instanceof ProjectError ? error.code : 'region_edit_provider_failed';
    logger.error({ err: error, editId: edit.id, code }, 'region edit failed; the project keeps its last accepted revision');
    await env.edits.fail(owner, edit.projectId, edit.id, code).catch(failure => logger.error({ err: failure, editId: edit.id }, 'region edit failure could not be recorded'));
  } finally { env.slots.release(); }
}

function requestRoutes(router: Router, env: RegionEnvironment): void {
  router.post('/projects/:id/region-edits', admit(env, 'generate'), bodyParser, handler(env, 'generate', async (req, res, owner) => {
    const { request, maxCostClass } = await regionRequest(env, projectId(req.params.id), req.body, owner);
    const edit = await env.edits.create(owner, request, env.settings.dailyCap, confirm(env, 'generate', owner));
    logger.info({ editId: edit.id, projectId: edit.projectId, sourceRevision: edit.sourceRevision, kind: edit.selection.kind }, 'region edit requested');
    void runRegionEdit(env, owner, edit, maxCostClass);
    res.status(202).json({ edit });
  }));
  router.get('/projects/:id/region-edits/:edit', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const edit = await env.edits.get(owner, projectId(req.params.id), projectId(req.params.edit)); await confirm(env, 'read', owner)(); res.json({ edit });
  }));
  router.get('/region-edit-provider', admit(env, 'generate'), handler(env, 'generate', async (_req, res, owner) => {
    const provider = await resolveFor(env, owner), usable = provider ? await servesRegionEdits(provider) : false;
    await confirm(env, 'generate', owner)();
    res.json({ configured: usable, provider: provider?.id ?? null, costClass: provider?.costClass ?? null, dailyCap: env.settings.dailyCap, costConsentVersion: 1,
      ...(usable ? {} : { reason: 'region_edit_provider_unavailable' }) });
  }));
}

function decisionRoutes(router: Router, env: RegionEnvironment): void {
  router.post('/projects/:id/region-edits/:edit/accept', admit(env, 'change'), bodyParser, handler(env, 'change', async (req, res, owner) => {
    exactFields(req.body, ['baseRevision']);
    const expected = baseRevision(req.body.baseRevision), validate = await env.validator;
    const project = await env.edits.accept(owner, projectId(req.params.id), projectId(req.params.edit), expected,
      (current, edit) => acceptedInput(current, edit, validate), confirm(env, 'change', owner));
    logger.info({ editId: req.params.edit, revision: project.revision }, 'region edit accepted as a new revision');
    res.status(201).json({ project });
  }));
  for (const action of ['cancel', 'reject'] as const) {
    router.post(`/projects/:id/region-edits/:edit/${action}`, admit(env, 'generate'), bodyParser, handler(env, 'generate', async (req, res, owner) => {
      exactFields(req.body ?? {}, []);
      const edit = await env.edits.close(owner, projectId(req.params.id), projectId(req.params.edit), action, confirm(env, 'generate', owner));
      res.json({ edit });
    }));
  }
}

/**
 * @description Mount region editing on the Create project router, before its shared error handler.
 * @param router - The Create project router.
 * @param options - Framework context, project store, asset root, the router's guards and validator; tests may name a fixture provider.
 * @returns void
 */
export function registerRegionEditRoutes(router: Router, options: { ctx: ProjectContext; projects: CreateProjectStore; dataRoot: string;
  guards: RegionRouteGuards; validator: Promise<ProjectValidator>; dependencies?: RegionEditDependencies; settings?: RegionEditSettings }): void {
  const settings = options.settings ?? regionEditSettings();
  const env: RegionEnvironment = { ...options, edits: new CreateRegionEditStore(options.projects), settings, slots: new Slots(settings.concurrency),
    deps: options.dependencies ?? DEFAULT_DEPENDENCIES, region: loadRegionModule(options.ctx.appPackageDir ?? resolve(__dirname, '..')) };
  requestRoutes(router, env); decisionRoutes(router, env);
}
