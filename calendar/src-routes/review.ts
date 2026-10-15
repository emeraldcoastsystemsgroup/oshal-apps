import { Router } from 'express';
import * as path from 'path';
import type { AppContext } from '@/app/composition/app-context';
export function createReviewRoutes(ctx: AppContext): Router {
 const router=Router();
 router.get('/',(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.sendFile(path.join(ctx.appPackageDir!, 'tools/review.html'));
 });
 for (const name of ['calendar-workspace.mjs', 'calendar-workspace.css']) router.get('/'+name,(req,res)=>{
  if (Object.keys(req.query).some(k=>k!=='v') || (req.query.v != null && (typeof req.query.v !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(req.query.v)))) { res.status(400).json({error:'invalid_asset_query'}); return; }
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.type(name.endsWith('.mjs')?'application/javascript':'text/css').sendFile(path.join(ctx.appPackageDir!, 'tools',name));
 });
 return router;
}
