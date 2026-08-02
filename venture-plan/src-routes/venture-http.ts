/**
 * Venture Plan — the two HTTP helpers both route files need.
 *
 * Extracted into their own module for one reason: `venture-routes.ts` calls
 * `registerDocumentRoutes` and `venture-routes-docs.ts` needs these helpers, which
 * is a require cycle. CommonJS would probably survive it — the call sites resolve
 * lazily — but "probably survives a cycle" is exactly the class of thing that
 * works in a test harness and fails once at boot in a container. A third module
 * that neither of them imports back makes the question not arise.
 *
 * `requireSub` answers 401 BEFORE the handler can touch the pool. That ordering is
 * the whole point: an unauthenticated request must not produce a database query,
 * because a query is where an owner predicate could be forgotten.
 *
 * `guarded` exists because a swallowed exception in a route is invisible. Every
 * throw is logged at ERROR with its stack and answered as a 500 rather than
 * hanging the request.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the 401-before-any-query subject resolver and the error-logging handler wrapper, in their own module so the two route files do not form a require cycle.
 *
 * @module venture-http
 */

import type { Request, RequestHandler, Response } from 'express';
import { callerSub } from '@/app/routes/caller-sub';
import { createChildLogger } from '@/shared/logger';

const log = createChildLogger({ module: 'venture-http' });

/**
 * @description Resolve the authenticated caller, or answer 401.
 *
 * Call this FIRST in every handler, before any store call. A handler that queries
 * and then checks has already given an anonymous request a database round trip,
 * and one day one of those queries will be missing its owner predicate.
 *
 * @param req - The request.
 * @param res - The response; a 401 is written when there is no subject.
 * @returns The caller's OIDC subject, or null when it has already replied.
 */
export function requireSub(req: Request, res: Response): string | null {
  const sub = callerSub(req);
  if (!sub) {
    res.status(401).json({ error: 'authentication required' });
    return null;
  }
  return sub;
}

/**
 * @description Wrap a handler so no exception is ever swallowed.
 * @param name - The route name, for the log line.
 * @param fn - The handler.
 * @returns An Express handler that logs at ERROR and answers 500 on a throw.
 */
export function guarded(name: string, fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      log.error({ err, stack: err?.stack, route: name, url: req.originalUrl }, 'venture route failed');
      if (!res.headersSent) res.status(500).json({ error: err?.message || 'internal error' });
    }
  };
}
