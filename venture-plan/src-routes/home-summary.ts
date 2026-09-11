/** Saved venture-plan evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*)::text AS ventures FROM venture_ventures WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2",
  "SELECT count(*)::text AS assumptions FROM venture_assumptions a JOIN venture_ventures v ON v.id=a.venture_id AND v.owner_sub = $1 WHERE a.owner_sub = $1 AND a.created_at <= $2 AND a.superseded_by IS NULL AND a.source_kind = 'model-estimate'",
  "SELECT v.name, v.idea_text, v.stage, v.updated_at, m.posture, m.can_publish, m.computed_at FROM venture_ventures v LEFT JOIN LATERAL (SELECT posture, can_publish, computed_at FROM venture_models m WHERE m.venture_id=v.id AND m.owner_sub = $1 AND m.scenario_id IS NULL AND m.computed_at <= $2 ORDER BY computed_at DESC, id LIMIT 1) m ON true WHERE v.owner_sub = $1 AND v.created_at <= $2 AND v.updated_at <= $2 ORDER BY v.updated_at DESC, v.id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"ventures","saved-ventures","Saved ventures"],[1,"assumptions","estimated-assumptions","Model estimates"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"venture-home",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(2).forEach(r => item(r.name, clip(r.stage) + ' Â· saved ' + date(r.updated_at) + (r.computed_at ? ' Â· base model ' + clip(r.posture) + ' at ' + date(r.computed_at) + (r.can_publish === true ? ' (publishable at computation)' : ' (estimate / review required)') : ' Â· no saved base model'), clip(r.idea_text,1300), ['prepare-document','prepare-campaign']));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"venture-home"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"venture-home"});
  items.push({text:"Venture counts are saved plans. Evidence count includes current model-estimate records. Model posture is saved at computation, not a freshness certification or a return forecast. Open the plan to validate its current assumptions.",tone:'neutral',fix:"venture-home"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
