/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add saved campaign evidence and a native review surface for explicit connected planning.
 */
import { Router } from 'express';
import * as path from 'path';
import type { AppContext } from '@/app/composition/app-context';
export function createReviewRoutes(ctx: AppContext): Router {
 const router=Router();
 router.get('/',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.sendFile(path.join(ctx.appPackageDir!, 'tools/review.html'));});
 return router;
}
