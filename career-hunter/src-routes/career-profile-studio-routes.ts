/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Added caller-owned LinkedIn profile plan CRUD, drafting, assets, approval, and dispatch.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Added the profile-photo slot and package-decoupled Portrait Studio selection flow.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Awaited the asynchronous desktop profile dispatch before interpreting its result.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Split the route registrar into bounded plan, asset, and workflow handlers.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Serialize asset writes with approval, atomically roll back rejected files, and contain every served asset beneath the caller store.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Delegate the approved-to-dispatched CAS, exact generation/task/client capability binding, remote asset staging, and enqueue rollback to the kernel dispatch boundary.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Retry removal of generation-scoped staged assets whenever an operator abandons or resets a resolved plan.
 */

/**
 * Career Profile Studio â€” LinkedIn profile customization over the browser-control rail.
 *
 * LinkedIn exposes no profile-edit API. The caller builds and approves a private plan here,
 * then explicitly dispatches it to the desktop operator that controls the real signed-in browser.
 * @module career-profile-studio-routes
 */
import express, { type Request, type Response, type Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { ProfilePlanStore, type LinkedInProfilePlan } from '@/features/profile-studio';
import type { AppContext } from '@/app/composition/app-context';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { cleanupProfileDispatchWorkspace, dispatchProfileUpdate } from '@/app/profile-studio-dispatch';
import { callerSub, userPaths } from './career-user-store';
import { rejectEngineClaim } from './career-engine-response';
import { releaseRun, tryAcquireStorageRun, type RunLease } from './career-engine-runner';
import { restoreFilesAsync, snapshotFilesAsync, writeFileAtomicAsync } from './career-file-transaction';
import { resolveContainedRegularFile } from './career-resume-preview';

const logger = createChildLogger({ module: 'career-profile-studio-routes' });
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';
const TOOL_DIR = path.resolve(__dirname, '..', 'tools');
const botClient = new BotNodeClient(createRegistryEndpointResolver());
const LIMITS = { headline: 220, about: 2600, skills: 15, skillLen: 80, customUrl: 100 } as const;
const IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const IMAGE_BODY = express.raw({ type: Object.keys(IMAGE_TYPES), limit: '8mb' });
const PDF_BODY = express.raw({ type: 'application/pdf', limit: '12mb' });
type AssetField = 'background_image_path' | 'photo_path';
type AssetProperty = 'backgroundImagePath' | 'photoPath';

function assetPath(userSub: string, fileName: string): string {
  return path.join(userPaths(userSub).userDir, 'profile-studio', fileName);
}

/** Acquire the cross-process lane shared by profile asset writes and draft approval. */
function acquireProfilePlanLease(userSub: string, res: Response): RunLease | null {
  const lease = tryAcquireStorageRun(userSub, 'profile-plan');
  return rejectEngineClaim(res, lease, 'profile plan update') ? null : lease;
}

/** Persist one draft asset atomically, restoring exact prior bytes if the database rejects it. */
async function commitDraftAsset(
  store: ProfilePlanStore,
  userSub: string,
  field: AssetField | 'resume_path',
  filePath: string,
  bytes: Buffer,
): Promise<boolean> {
  const plan = await store.getPlan(userSub);
  if (plan && plan.state !== 'draft') return false;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const snapshots = await snapshotFilesAsync([filePath]);
  try {
    await writeFileAtomicAsync(filePath, bytes);
    if (await store.setAsset(userSub, field, filePath)) return true;
  } catch (error) {
    try { await restoreFilesAsync(snapshots); }
    catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'profile asset rollback failed');
    }
    throw error;
  }
  await restoreFilesAsync(snapshots);
  return false;
}

function cleanDraft(body: Record<string, unknown>): {
  headline?: string;
  about?: string;
  skills?: string[];
  customUrl?: string;
} {
  const output: { headline?: string; about?: string; skills?: string[]; customUrl?: string } = {};
  if (typeof body.headline === 'string') {
    output.headline = body.headline.trim().slice(0, LIMITS.headline);
  }
  if (typeof body.about === 'string') output.about = body.about.trim().slice(0, LIMITS.about);
  if (Array.isArray(body.skills)) {
    output.skills = body.skills
      .slice(0, LIMITS.skills)
      .map((skill) => String(skill).trim().slice(0, LIMITS.skillLen))
      .filter(Boolean);
  }
  if (typeof body.customUrl === 'string') {
    output.customUrl = body.customUrl
      .trim()
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, LIMITS.customUrl);
  }
  return output;
}

function draftPrompt(plan: LinkedInProfilePlan | null, message: string): string {
  return [
    'You are drafting the operator\'s LinkedIn PROFILE copy (headline + about + skills) to read like',
    'a polished professional site. Call your career_database tool first and ground EVERY claim in that',
    'real data â€” never invent or inflate an employer, title, metric, skill, or clearance. Real titles',
    'only. Player-coach voice, first person implied, no "I built X" as if solo. NEVER use em or en dashes.',
    '',
    plan ? `CURRENT PLAN (improve on it): ${JSON.stringify({ headline: plan.headline, about: plan.about, skills: plan.skills }).slice(0, 6000)}` : '',
    message ? `OPERATOR DIRECTION: ${message.slice(0, 1000)}` : '',
    '',
    'Reply with ONLY a JSON object (no prose, no code fences):',
    `{"reply":"<one short conversational sentence>","headline":"<= ${LIMITS.headline} chars, specific and outcome-led>",`,
    `"about":"<= ${LIMITS.about} chars, 3-5 short paragraphs: who you are, what you have led/built with real outcomes, what you want next>",`,
    `"skills":["<= ${LIMITS.skills} concise skills, strongest first"]}`,
  ].filter(Boolean).join('\n');
}

function serveSurface(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(TOOL_DIR, 'career-profile-studio.html'), (err: unknown) => {
    if (err) {
      logger.error({ err }, 'profile studio serve failed');
      res.status(404).send('Not found');
    }
  });
}

async function loadPlan(store: ProfilePlanStore, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try { res.json({ plan: await store.getPlan(userSub) }); }
  catch (err) {
    logger.error({ err, userSub }, 'profile plan load failed');
    res.status(500).json({ error: 'load failed' });
  }
}

async function savePlan(store: ProfilePlanStore, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const plan = await store.saveDraft(userSub, cleanDraft(req.body || {}));
    res.json({ plan, frozen: plan.state !== 'draft' });
  } catch (err) {
    logger.error({ err, userSub }, 'profile plan save failed');
    res.status(500).json({ error: 'save failed' });
  }
}

function parseDraftResponse(response: unknown): { reply: string; fields: Record<string, unknown> } {
  let reply = 'Drafted.';
  let fields: Record<string, unknown> = {};
  const match = String(response || '').match(/\{[\s\S]*\}/);
  if (!match) return { reply, fields };
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    reply = String(parsed.reply || reply).slice(0, 1200);
    fields = cleanDraft(parsed);
  } catch (err) {
    logger.warn({ err }, 'profile draft bot JSON is unparseable');
  }
  return { reply, fields };
}

async function draftProfile(
  ctx: AppContext,
  store: ProfilePlanStore,
  req: Request,
  res: Response,
): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const plan = await store.getPlan(userSub);
    const message = String(req.body?.message || '').trim();
    const result = await executeBotOrInline(ctx, botClient, CAREER_AGENT_ID, {
      text: draftPrompt(plan, message),
      taskId: `liprofile-${userSub}`,
      workspaceFolderId: `liprofile-${userSub}`,
      agentId: CAREER_AGENT_ID,
      agenticMode: true,
      direct: false,
      userSub,
    } as never);
    const parsed = parseDraftResponse(result.response);
    logger.info({ userSub, fields: Object.keys(parsed.fields) }, 'profile draft turn');
    res.json({ reply: parsed.reply, ...parsed.fields });
  } catch (err) {
    logger.error({ err, userSub }, 'profile draft failed');
    res.status(500).json({ error: 'draft failed' });
  }
}

function imageExtension(req: Request): string | null {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
  return IMAGE_TYPES[contentType] || null;
}

async function uploadImage(
  store: ProfilePlanStore,
  field: AssetField,
  baseName: string,
  req: Request,
  res: Response,
): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const extension = imageExtension(req);
  if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: 'send the image as the request body (png/jpeg/webp)' });
    return;
  }
  const lease = acquireProfilePlanLease(userSub, res);
  if (!lease) return;
  try {
    const filePath = assetPath(userSub, `${baseName}${extension}`);
    if (!(await commitDraftAsset(store, userSub, field, filePath, req.body))) {
      res.status(409).json({ error: 'plan is not editable â€” reset to draft first' });
      return;
    }
    res.json({ ok: true, plan: await store.getPlan(userSub) });
  } catch (err) {
    logger.error({ err, userSub, field }, 'profile image upload failed');
    res.status(500).json({ error: 'upload failed' });
  } finally { releaseRun(lease); }
}

async function serveImage(
  store: ProfilePlanStore,
  property: AssetProperty,
  req: Request,
  res: Response,
): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).end(); return; }
  const plan = await store.getPlan(userSub).catch((err) => {
    logger.error({ err, userSub, property }, 'profile image plan load failed');
    return null;
  });
  const filePath = plan?.[property];
  let containedPath: string | null = null;
  try {
    if (filePath) containedPath = resolveContainedRegularFile(filePath, userPaths(userSub).userDir);
  } catch (err) { logger.warn({ err, userSub, property }, 'profile image containment failed'); }
  if (!containedPath) { res.status(404).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(containedPath, (err: unknown) => { if (err) res.status(404).end(); });
}

async function uploadResume(store: ProfilePlanStore, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: 'send the PDF as the request body' });
    return;
  }
  const lease = acquireProfilePlanLease(userSub, res);
  if (!lease) return;
  try {
    const filePath = assetPath(userSub, 'Featured_Resume.pdf');
    if (!(await commitDraftAsset(store, userSub, 'resume_path', filePath, req.body))) {
      res.status(409).json({ error: 'plan is not editable â€” reset to draft first' });
      return;
    }
    res.json({ ok: true, plan: await store.getPlan(userSub) });
  } catch (err) {
    logger.error({ err, userSub }, 'profile resume upload failed');
    res.status(500).json({ error: 'upload failed' });
  } finally { releaseRun(lease); }
}

function hasActionablePlan(plan: LinkedInProfilePlan | null): boolean {
  return !!plan && !!(
    plan.headline || plan.about || plan.skills.length || plan.customUrl
    || plan.backgroundImagePath || plan.photoPath || plan.resumePath
  );
}

async function approvePlan(store: ProfilePlanStore, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const lease = acquireProfilePlanLease(userSub, res);
  if (!lease) return;
  try {
    const plan = await store.getPlan(userSub);
    if (!hasActionablePlan(plan)) {
      res.status(400).json({ error: 'nothing to apply â€” add at least one change first' });
      return;
    }
    if (!(await store.casState(userSub, 'draft', 'approved'))) {
      res.status(409).json({ error: 'plan is not in draft' });
      return;
    }
    res.json({ plan: await store.getPlan(userSub) });
  } catch (err) {
    logger.error({ err, userSub }, 'profile approve failed');
    res.status(500).json({ error: 'approve failed' });
  } finally { releaseRun(lease); }
}

async function dispatchPlan(
  store: ProfilePlanStore,
  req: Request,
  res: Response,
): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const plan = await store.getPlan(userSub);
    if (!plan || plan.state !== 'approved') {
      res.status(409).json({ error: 'plan is not approved' });
      return;
    }
    const r = await dispatchProfileUpdate({
      plan,
      store,
      assetRoot: userPaths(userSub).userDir,
    });
    if (!r.ok) {
      const status = r.error === 'plan is no longer approved' ? 409 : 503;
      res.status(status).json({
        error: r.error || 'dispatch failed',
        plan: await store.getPlan(userSub),
      });
      return;
    }
    logger.info({ userSub, taskId: r.taskId, clientId: r.clientId }, 'profile dispatched');
    res.json({ ok: true, plan: await store.getPlan(userSub) });
  } catch (err) {
    logger.error({ err, userSub }, 'profile dispatch failed');
    res.status(500).json({ error: 'dispatch failed' });
  }
}

async function resetPlan(store: ProfilePlanStore, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const plan = await store.getPlan(userSub);
    if (!plan) { res.status(404).json({ error: 'no plan yet' }); return; }
    if (!(await store.casState(userSub, plan.state, 'draft'))) {
      res.status(409).json({ error: 'a dispatched plan must resolve (or be abandoned) first' });
      return;
    }
    if (plan.dispatchTaskId) await cleanupProfileDispatchWorkspace(plan.dispatchTaskId);
    res.json({ plan: await store.getPlan(userSub) });
  } catch (err) {
    logger.error({ err, userSub }, 'profile reset failed');
    res.status(500).json({ error: 'reset failed' });
  }
}

async function abandonPlan(store: ProfilePlanStore, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const plan = await store.getPlan(userSub);
    if (!plan || plan.state !== 'dispatched') {
      res.status(409).json({ error: 'plan is not dispatched' });
      return;
    }
    const moved = await store.casState(userSub, 'dispatched', 'failed', {
      resultNote: 'abandoned by operator',
    });
    if (!moved) { res.status(409).json({ error: 'plan is not dispatched' }); return; }
    if (plan.dispatchTaskId) await cleanupProfileDispatchWorkspace(plan.dispatchTaskId);
    res.json({ plan: await store.getPlan(userSub) });
  } catch (err) {
    logger.error({ err, userSub }, 'profile abandon failed');
    res.status(500).json({ error: 'abandon failed' });
  }
}

function registerPlanRoutes(router: Router, ctx: AppContext, store: ProfilePlanStore): void {
  router.get('/profile-studio', serveSurface);
  router.get('/profile-studio/plan', (req, res) => loadPlan(store, req, res));
  router.post('/profile-studio/plan', (req, res) => savePlan(store, req, res));
  router.post('/profile-studio/draft', (req, res) => draftProfile(ctx, store, req, res));
}

function registerAssetRoutes(router: Router, store: ProfilePlanStore): void {
  router.put('/profile-studio/background', IMAGE_BODY, (req, res) => {
    return uploadImage(store, 'background_image_path', 'background', req, res);
  });
  router.put('/profile-studio/photo', IMAGE_BODY, (req, res) => {
    return uploadImage(store, 'photo_path', 'photo', req, res);
  });
  router.get('/profile-studio/photo', (req, res) => serveImage(store, 'photoPath', req, res));
  router.put('/profile-studio/resume', PDF_BODY, (req, res) => uploadResume(store, req, res));
  router.get('/profile-studio/background', (req, res) => {
    return serveImage(store, 'backgroundImagePath', req, res);
  });
}

function registerWorkflowRoutes(router: Router, ctx: AppContext, store: ProfilePlanStore): void {
  router.post('/profile-studio/approve', (req, res) => approvePlan(store, req, res));
  router.post('/profile-studio/dispatch', (req, res) => dispatchPlan(store, req, res));
  router.post('/profile-studio/reset', (req, res) => resetPlan(store, req, res));
  router.post('/profile-studio/abandon', (req, res) => abandonPlan(store, req, res));
}

/**
 * @description Mounts Profile Studio surface, plan, asset, approval, and dispatch routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used for plan persistence, bot drafting, and desktop dispatch.
 * @returns Nothing.
 */
export function registerCareerProfileStudio(router: Router, ctx: AppContext): void {
  const store = new ProfilePlanStore(ctx.pool);
  registerPlanRoutes(router, ctx, store);
  registerAssetRoutes(router, store);
  registerWorkflowRoutes(router, ctx, store);
}
