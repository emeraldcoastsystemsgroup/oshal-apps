/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add explicit, default-deny per-user automation settings and trusted cron reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Use the dependency-leaf caller identity helper so route modules do not import the main registrar.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Document the exported automation-settings contract used by routes and scheduled work.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Record the opting-in owner's verified issuer (migration 107) so the nightly chain can mint that owner's callback grants: the kernel's signed-package-callbacks rail refreshes and authorizes an exact (subject, issuer) principal before an engine completion runs, and the cron has no request to read one from. The issuer comes from the kernel's request identity for the saving request, never from the body; an opt-in saved before 1.25.1 has none and the cron reports it as not ready until the owner saves the settings again.
 *
 * @module career-automation
 */
import { type Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { getRequestIdentity, runWithSystemIdentity } from '@/shared/services/database/request-identity';
import { callerSub } from './career-user-store';

// Pure default-deny gate, shared with the node:test guard (compiled file lives in
// routes/, so lib/ is a sibling directory — same resolution the apply-prompt bridge uses).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gate = require('../lib/automation-gate') as {
  autoGenerateAllowed: (row: unknown) => boolean;
  autoSubmitAllowed: (row: unknown) => boolean;
};

const logger = createChildLogger({ module: 'career-automation' });

/**
 * @description A user's automation opt-in state; absent rows default both capabilities off.
 * `ownerIssuer` is the verified issuer of the owner who saved the opt-in (null before 1.25.1).
 */
export interface AutomationSettings {
  autoGenerate: boolean;
  autoSubmit: boolean;
  ownerIssuer: string | null;
}

/** Longest issuer the kernel's callback principal contract accepts. */
const MAX_ISSUER_LENGTH = 2048;

/** The saving request's verified issuer, as the kernel established it; never a request field. */
function callerIssuer(): string | null {
  const issuer = getRequestIdentity()?.principalIssuer;
  return typeof issuer === 'string' && issuer.length > 0 && issuer.length <= MAX_ISSUER_LENGTH ? issuer : null;
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
    `SELECT auto_generate, auto_submit, owner_issuer FROM career_automation_settings WHERE user_sub=$1`, [userSub]);
  const row: unknown = r.rows[0];
  const issuer = (row as { owner_issuer?: unknown } | undefined)?.owner_issuer;
  return {
    autoGenerate: gate.autoGenerateAllowed(row),
    autoSubmit: gate.autoSubmitAllowed(row),
    ownerIssuer: typeof issuer === 'string' && issuer.length > 0 ? issuer : null,
  };
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
    // The issuer the nightly chain will mint this owner's callback grants for: the kernel's
    // verified identity for THIS request. A save with no verified issuer records none.
    const ownerIssuer = callerIssuer();
    await ctx.pool.query(
      `INSERT INTO career_automation_settings (user_sub, auto_generate, auto_submit, owner_issuer)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_sub) DO UPDATE SET auto_generate=$2, auto_submit=$3, owner_issuer=$4, updated_at=NOW()`,
      [userSub, autoGenerate, autoSubmit, ownerIssuer]);
    logger.info({ userSub, autoGenerate, autoSubmit, issuerRecorded: ownerIssuer !== null }, 'career automation settings saved');
    res.json({ ok: true, autoGenerate, autoSubmit, issuerRecorded: ownerIssuer !== null });
  });
}
