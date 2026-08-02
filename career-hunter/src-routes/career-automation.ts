/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 02:35:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Explicit opt-in automation settings (operator directive 2026-07-24: the nightly auto-draft chain generated + queued applications the operator never asked for). Per-user career_automation_settings row (migration 091), DEFAULT OFF — absent row = automation disabled. auto_generate gates the cron's per-user score/title/enqueue; auto_submit is the flag the bulk submit rail must consult. Decision logic lives in lib/automation-gate.js (pure, node:test-guarded); this module adds the DB read (system-identity variant for the cron, which runs outside any request — FORCE-RLS would otherwise starve the read to "absent", which is safe but would also make opt-in impossible from the cron) and the settings routes for the Career Settings card.
 *
 * @module career-automation
 */
import { type Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { runWithSystemIdentity } from '@/shared/services/database/request-identity';
import { callerSub } from '@/app/routes/caller-sub';

// Pure default-deny gate, shared with the node:test guard (compiled file lives in
// routes/, so lib/ is a sibling directory — same resolution the apply-prompt bridge uses).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gate = require('../lib/automation-gate') as {
  autoGenerateAllowed: (row: unknown) => boolean;
  autoSubmitAllowed: (row: unknown) => boolean;
};

const logger = createChildLogger({ module: 'career-automation' });

/** A user's automation opt-in state. Both default FALSE — absent row = everything off. */
export interface AutomationSettings {
  autoGenerate: boolean;
  autoSubmit: boolean;
}

/**
 * @description Read the user's automation opt-in row under the CALLER's identity (route
 * context — the GUC'd pool sees the caller's own row). Absent row → both flags false.
 * @param ctx app context (GUC-wrapped pool)
 * @param userSub the user to read
 * @returns the user's automation settings, default-deny
 */
export async function readAutomationSettings(ctx: AppContext, userSub: string): Promise<AutomationSettings> {
  const r = await ctx.pool.query(
    `SELECT auto_generate, auto_submit FROM career_automation_settings WHERE user_sub=$1`, [userSub]);
  const row: unknown = r.rows[0];
  return { autoGenerate: gate.autoGenerateAllowed(row), autoSubmit: gate.autoSubmitAllowed(row) };
}

/**
 * @description Cron-path read: the cron runs OUTSIDE any request, so an un-scoped query on
 * the FORCE-RLS settings table returns no row — safe (automation stays off) but it would
 * also make a real opt-in unenforceable from the cron. runWithSystemIdentity is the
 * positive trusted marker for platform-originated reads (same pattern as remote-task cost
 * capture). Still default-deny: absent row → false.
 * @param ctx app context
 * @param userSub the user to read
 * @returns the user's automation settings, default-deny
 */
export async function readAutomationSettingsSystem(ctx: AppContext, userSub: string): Promise<AutomationSettings> {
  return runWithSystemIdentity(() => readAutomationSettings(ctx, userSub));
}

/**
 * @description Settings routes for the Career Settings card (parent mount already
 * auth-gates): GET /automation/state reads the caller's own flags; POST /settings/automation
 * saves them. Opt-in requires the EXPLICIT boolean true — anything else saves false.
 * @param router the career-hunter router
 * @param ctx app context
 * @returns nothing
 */
export function registerCareerAutomationRoutes(router: Router, ctx: AppContext): void {
  router.get('/automation/state', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    res.json(await readAutomationSettings(ctx, userSub));
  });

  router.post('/settings/automation', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    // Explicit true or nothing — a missing/garbage field always lands false.
    const autoGenerate = req.body?.autoGenerate === true;
    const autoSubmit = req.body?.autoSubmit === true;
    await ctx.pool.query(
      `INSERT INTO career_automation_settings (user_sub, auto_generate, auto_submit)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_sub) DO UPDATE SET auto_generate=$2, auto_submit=$3, updated_at=NOW()`,
      [userSub, autoGenerate, autoSubmit]);
    logger.info({ userSub, autoGenerate, autoSubmit }, 'career automation settings saved');
    res.json({ ok: true, autoGenerate, autoSubmit });
  });
}
