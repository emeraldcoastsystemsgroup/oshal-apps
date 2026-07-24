/**
 * Career Profile Studio — LinkedIn profile customization (ADR-036, the browser-control rail).
 *
 * Turns the operator's LinkedIn profile into a polished professional page. LinkedIn has NO
 * profile-edit API, so the flow is: build a per-user PLAN here (headline / about / skills /
 * custom URL / background image / featured resume — AI-drafted by the career-hunter agent from the real
 * career store, human-edited), APPROVE it, then dispatch it to the desktop worker where
 * linkedin-profile-operator drives the real logged-in Chrome (browser_control MCP, same rail as
 * apply-operator). Nothing touches LinkedIn without the explicit approve + send steps.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-17 17:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial Profile Studio:
 *   plan CRUD + AI draft (career-hunter agent, agenticMode — CLI harnesses have no plain-LLM path),
 *   raw-body image/PDF uploads confined to the user's own store dir, approve/dispatch/reset
 *   state moves via the store's CAS. Registered onto the career-hunter router (oidc-gated)
 *   the same way as registerCareerResumeStudio.
 * 2026-07-17 18:38:00 | roger.murphy@emeraldcoastsystemsgroup.com | Profile PHOTO slot (PUT/GET
 *   /profile-studio/photo). The Portrait Studio integration is client-side: the surface lists
 *   the user's own gallery via /api/portrait-studio and PUTs the chosen PNG here — no
 *   server-side import across the ADR-085 package boundary.
 *
 * @module career-profile-studio-routes
 */
import express, { type Router, type Request, type Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { createChildLogger } from '@/shared/logger';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { ProfilePlanStore, type LinkedInProfilePlan } from '@/features/profile-studio';
import type { AppContext } from '@/app/composition/app-context';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { callerSub, userPaths } from './career-hunter-routes';
import { dispatchProfileUpdate } from '@/app/profile-studio-dispatch';

const logger = createChildLogger({ module: 'career-profile-studio-routes' });
/** The career-hunter agent (the app's ONE bot) drafts the profile copy — cost lands under its agentId. */
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';
const TOOL_DIR = path.resolve(__dirname, '..', 'tools'); // ADR-085: surfaces ship in this package's tools/ (compiled file lives in <pkg>/routes/)
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** LinkedIn's own field caps — enforced at save so the operator bot never hits a length error. */
const LIMITS = { headline: 220, about: 2600, skills: 15, skillLen: 80, customUrl: 100 } as const;
/** Accepted background-image uploads (content-type → stored extension). */
const IMAGE_TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

/** The user's private Profile Studio asset dir (inside their own career store dir). */
function assetDir(userSub: string): string {
  const dir = path.join(userPaths(userSub).userDir, 'profile-studio');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Sanitize draft fields to LinkedIn's caps; only provided fields pass through. */
function cleanDraft(body: Record<string, unknown>): { headline?: string; about?: string; skills?: string[]; customUrl?: string } {
  const out: { headline?: string; about?: string; skills?: string[]; customUrl?: string } = {};
  if (typeof body.headline === 'string') out.headline = body.headline.trim().slice(0, LIMITS.headline);
  if (typeof body.about === 'string') out.about = body.about.trim().slice(0, LIMITS.about);
  if (Array.isArray(body.skills)) {
    out.skills = body.skills.slice(0, LIMITS.skills).map((s) => String(s).trim().slice(0, LIMITS.skillLen)).filter(Boolean);
  }
  if (typeof body.customUrl === 'string') out.customUrl = body.customUrl.trim().replace(/[^a-zA-Z0-9-]/g, '').slice(0, LIMITS.customUrl);
  return out;
}

/** Build the drafting prompt: real career data by tool call + a strict JSON contract. */
function draftPrompt(plan: LinkedInProfilePlan | null, message: string): string {
  return [
    'You are drafting the operator\'s LinkedIn PROFILE copy (headline + about + skills) to read like',
    'a polished professional site. Call your career_database tool first and ground EVERY claim in that',
    'real data — never invent or inflate an employer, title, metric, skill, or clearance. Real titles',
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

/**
 * @description Mount the Profile Studio routes on the career-hunter router (oidc-gated by its
 * mount). Surface + plan CRUD + AI draft + asset uploads + the approve/dispatch/reset moves.
 * @param router - The career-hunter app router.
 * @param ctx - App context (Postgres pool for the plan store; bot client for cost capture).
 * @returns Nothing.
 */
export function registerCareerProfileStudio(router: Router, ctx: AppContext): void {
  const store = new ProfilePlanStore(ctx.pool);

  // The surface itself (always revalidate, like the other career surfaces).
  router.get('/profile-studio', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(TOOL_DIR, 'career-profile-studio.html'), (err: unknown) => {
      if (err) { logger.error({ err }, 'profile studio serve failed'); res.status(404).send('Not found'); }
    });
  });

  // Load the user's plan (null until their first save/upload).
  router.get('/profile-studio/plan', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try { res.json({ plan: await store.getPlan(userSub) }); }
    catch (err) { logger.error({ err }, 'plan load failed'); res.status(500).json({ error: 'load failed' }); }
  });

  // Save draft edits (only while the plan is in draft — a frozen plan returns its current shape).
  router.post('/profile-studio/plan', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      const plan = await store.saveDraft(userSub, cleanDraft(req.body || {}));
      res.json({ plan, frozen: plan.state !== 'draft' });
    } catch (err) { logger.error({ err }, 'plan save failed'); res.status(500).json({ error: 'save failed' }); }
  });

  // One AI drafting turn — the career agent proposes copy; the surface fills the form, the human
  // reviews and saves. Nothing is persisted here (approval doctrine: the human owns the plan).
  router.post('/profile-studio/draft', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      const plan = await store.getPlan(userSub);
      const message = String(req.body?.message || '').trim();
      // agenticMode:true (NOT direct/plain-LLM): the career agent runs a CLI harness with no plain-LLM path —
      // same constraint the Resume Studio guide hit; the persona keeps the turn light.
      const result = await executeBotOrInline(ctx, botClient, CAREER_AGENT_ID, {
        text: draftPrompt(plan, message),
        taskId: `liprofile-${userSub}`, workspaceFolderId: `liprofile-${userSub}`,
        agentId: CAREER_AGENT_ID, agenticMode: true, direct: false, userSub,
      } as never);
      let reply = 'Drafted.'; let fields: Record<string, unknown> = {};
      const m = String(result.response || '').match(/\{[\s\S]*\}/);
      if (m) {
        try { const parsed = JSON.parse(m[0]) as Record<string, unknown>; reply = String(parsed.reply || reply).slice(0, 1200); fields = cleanDraft(parsed); }
        catch (err) { logger.warn({ err: (err as Error).message }, 'profile draft: bot JSON unparseable'); }
      }
      logger.info({ userSub, fields: Object.keys(fields) }, 'profile draft turn');
      res.json({ reply, ...fields });
    } catch (err) { logger.error({ err }, 'profile draft failed'); res.status(500).json({ error: 'draft failed' }); }
  });

  // Background image upload (raw body — the global 100kb JSON parser ignores image/* bodies).
  router.put('/profile-studio/background', express.raw({ type: Object.keys(IMAGE_TYPES), limit: '8mb' }), async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const ext = IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) { res.status(400).json({ error: 'send the image as the request body (png/jpeg/webp)' }); return; }
    try {
      const filePath = path.join(assetDir(userSub), `background${ext}`);
      fs.writeFileSync(filePath, req.body);
      if (!(await store.setAsset(userSub, 'background_image_path', filePath))) { res.status(409).json({ error: 'plan is not editable — reset to draft first' }); return; }
      res.json({ ok: true, plan: await store.getPlan(userSub) });
    } catch (err) { logger.error({ err }, 'background upload failed'); res.status(500).json({ error: 'upload failed' }); }
  });

  // Profile photo upload (raw body). The surface's Portrait Studio picker lands here too:
  // it fetches the chosen portrait PNG client-side and PUTs the blob, so the two apps stay
  // decoupled across the package boundary (picker degrades cleanly if the app is absent).
  router.put('/profile-studio/photo', express.raw({ type: Object.keys(IMAGE_TYPES), limit: '8mb' }), async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const ext = IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) { res.status(400).json({ error: 'send the image as the request body (png/jpeg/webp)' }); return; }
    try {
      const filePath = path.join(assetDir(userSub), `photo${ext}`);
      fs.writeFileSync(filePath, req.body);
      if (!(await store.setAsset(userSub, 'photo_path', filePath))) { res.status(409).json({ error: 'plan is not editable — reset to draft first' }); return; }
      res.json({ ok: true, plan: await store.getPlan(userSub) });
    } catch (err) { logger.error({ err }, 'photo upload failed'); res.status(500).json({ error: 'upload failed' }); }
  });

  // Serve the user's own profile-photo choice for the surface preview.
  router.get('/profile-studio/photo', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).end(); return; }
    const plan = await store.getPlan(userSub).catch(() => null);
    if (!plan?.photoPath || !fs.existsSync(plan.photoPath)) { res.status(404).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(plan.photoPath, (err: unknown) => { if (err) res.status(404).end(); });
  });

  // Featured-resume upload (PDF, raw body).
  router.put('/profile-studio/resume', express.raw({ type: 'application/pdf', limit: '12mb' }), async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) { res.status(400).json({ error: 'send the PDF as the request body' }); return; }
    try {
      const filePath = path.join(assetDir(userSub), 'Featured_Resume.pdf');
      fs.writeFileSync(filePath, req.body);
      if (!(await store.setAsset(userSub, 'resume_path', filePath))) { res.status(409).json({ error: 'plan is not editable — reset to draft first' }); return; }
      res.json({ ok: true, plan: await store.getPlan(userSub) });
    } catch (err) { logger.error({ err }, 'resume upload failed'); res.status(500).json({ error: 'upload failed' }); }
  });

  // Serve the user's own uploaded background for the surface preview.
  router.get('/profile-studio/background', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).end(); return; }
    const plan = await store.getPlan(userSub).catch(() => null);
    if (!plan?.backgroundImagePath || !fs.existsSync(plan.backgroundImagePath)) { res.status(404).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(plan.backgroundImagePath, (err: unknown) => { if (err) res.status(404).end(); });
  });

  // Approve: freeze the draft for dispatch. Requires at least one actionable change.
  router.post('/profile-studio/approve', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      const plan = await store.getPlan(userSub);
      const actionable = !!plan && !!(plan.headline || plan.about || plan.skills.length || plan.customUrl || plan.backgroundImagePath || plan.photoPath || plan.resumePath);
      if (!actionable) { res.status(400).json({ error: 'nothing to apply — add at least one change first' }); return; }
      if (!(await store.casState(userSub, 'draft', 'approved'))) { res.status(409).json({ error: 'plan is not in draft' }); return; }
      res.json({ plan: await store.getPlan(userSub) });
    } catch (err) { logger.error({ err }, 'approve failed'); res.status(500).json({ error: 'approve failed' }); }
  });

  // Dispatch: CAS approved→dispatched FIRST (double-click safe), then enqueue to the desktop
  // worker; an enqueue failure resolves the plan to failed with the reason (reset re-opens it).
  router.post('/profile-studio/dispatch', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      if (!(await store.casState(userSub, 'approved', 'dispatched'))) { res.status(409).json({ error: 'plan is not approved' }); return; }
      const plan = await store.getPlan(userSub);
      const r = plan ? dispatchProfileUpdate(plan) : { ok: false as const, error: 'plan vanished' };
      if (!r.ok) {
        await store.casState(userSub, 'dispatched', 'failed', { resultNote: r.error || 'dispatch failed' });
        res.status(503).json({ error: r.error || 'dispatch failed', plan: await store.getPlan(userSub) });
        return;
      }
      await ctx.pool.query(
        'UPDATE linkedin_profile_plans SET dispatch_task_id=$2, dispatch_client_id=$3, updated_at=now() WHERE user_sub=$1',
        [userSub, r.taskId ?? null, r.clientId ?? null],
      );
      logger.info({ userSub, taskId: r.taskId, clientId: r.clientId }, 'profile plan dispatched');
      res.json({ ok: true, plan: await store.getPlan(userSub) });
    } catch (err) { logger.error({ err }, 'dispatch failed'); res.status(500).json({ error: 'dispatch failed' }); }
  });

  // Reset a non-dispatched plan back to editable draft; abandon force-fails a stuck dispatch.
  router.post('/profile-studio/reset', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      const plan = await store.getPlan(userSub);
      if (!plan) { res.status(404).json({ error: 'no plan yet' }); return; }
      if (!(await store.casState(userSub, plan.state, 'draft'))) { res.status(409).json({ error: 'a dispatched plan must resolve (or be abandoned) first' }); return; }
      res.json({ plan: await store.getPlan(userSub) });
    } catch (err) { logger.error({ err }, 'reset failed'); res.status(500).json({ error: 'reset failed' }); }
  });
  router.post('/profile-studio/abandon', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      if (!(await store.casState(userSub, 'dispatched', 'failed', { resultNote: 'abandoned by operator' }))) { res.status(409).json({ error: 'plan is not dispatched' }); return; }
      res.json({ plan: await store.getPlan(userSub) });
    } catch (err) { logger.error({ err }, 'abandon failed'); res.status(500).json({ error: 'abandon failed' }); }
  });
}
