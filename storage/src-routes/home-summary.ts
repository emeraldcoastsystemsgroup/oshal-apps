/** Saved storage evidence. GET is owner-scoped, bounded, and side-effect free. */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
const clip = (v: unknown, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0,cap);
const date = (v: unknown) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
export function createHomeSummaryRoutes(ctx: AppContext): Router {
 const router = Router();
 router.get('/', async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  const oidc = (req as any).oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
  if (!sub || oidc?.isAuthenticated?.() !== true) { res.status(401).json({error:'not_authenticated'}); return; }
  const now = new Date();
  const result = await Promise.allSettled([
  "SELECT code_provider, files_provider, updated_at FROM oshal_storage_prefs WHERE user_sub = $1 AND updated_at <= $2"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"code_provider","code-target","Saved code target"],[0,"files_provider","files-target","Saved file target"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] || 'Automatic') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"storage-settings",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(0).forEach(r => item('Storage preferences', 'Saved ' + date(r.updated_at), 'Code: ' + clip(r.code_provider || 'automatic') + '. Files: ' + clip(r.files_provider || 'automatic') + '. Provider availability is checked when used.', []));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"storage-settings"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"storage-settings"});
  items.push({text:"Shows explicitly saved target preferences. Automatic means the Files service chooses its configured fallback at use time. A saved target is not evidence of a live connection, a successful export or provider free space. Browse and export through the existing Files surface.",tone:'neutral',fix:"storage-settings"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
