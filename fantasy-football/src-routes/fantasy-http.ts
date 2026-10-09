/**
 * The request plumbing every Fantasy Football route shares: who is asking, which league they name,
 * and how a league that could not be resolved is answered.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — requireSub, leagueRequestOf (an ESPN leagueId or a hand-typed manualId) and sendContextFailure, shared by fantasy-routes.ts and fantasy-manage-routes.ts so neither imports the other.
 *
 * @module fantasy-http
 */

import type { Request, Response } from 'express';
import { callerSub } from '@/app/routes/trading-routes-helpers';
import { answerUnreachable, type ContextResult, type LeagueRequest } from './fantasy-context';
import { seasonOf } from './fantasy-feed';

/**
 * @description Resolve the caller or answer 401.
 * @param req - Request.
 * @param res - Response.
 * @returns The subject, or null when already answered.
 */
export function requireSub(req: Request, res: Response): string | null {
  const sub = callerSub(req);
  if (!sub) { res.status(401).json({ error: 'authentication required' }); return null; }
  return sub;
}

/**
 * @description Which league a request names: `leagueId` (ESPN) or `manualId` (hand-typed).
 * @param q - Query or body.
 * @returns The league request.
 */
export function leagueRequestOf(q: Record<string, unknown>): LeagueRequest {
  const manual = Number(q.manualId);
  return {
    season: seasonOf(q.season),
    leagueId: q.leagueId ? String(q.leagueId).trim() : undefined,
    manualId: Number.isInteger(manual) && manual > 0 ? manual : undefined,
    week: Number(q.week) || undefined,
  };
}

/**
 * @description Send the refusal a failed context resolution carries; an unreachable ESPN is named as
 * the transport, never as a credential problem.
 * @param res - Response.
 * @param result - The failed result.
 * @returns Nothing.
 */
export function sendContextFailure(res: Response, result: Extract<ContextResult, { ok: false }>): void {
  const failure = (result.body as { failure?: any }).failure;
  if (result.status === 503 && failure && answerUnreachable(res, failure)) return;
  res.status(result.status).json(result.body);
}
