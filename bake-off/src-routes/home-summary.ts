/** Saved bake-off evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*)::text AS jobs FROM bake_off_jobs WHERE owner_sub = $1 AND created_at<=$2 AND updated_at<=$2",
  "SELECT count(*) FILTER(WHERE r.status='running')::text AS active,count(*) FILTER(WHERE r.status='failed')::text AS failed,count(*) FILTER(WHERE r.status='complete' AND r.finished_at<=$2 AND r.finished_at>$2::timestamptz-interval '120 hours')::text AS five FROM bake_off_runs r JOIN bake_off_jobs j ON j.id=r.job_id AND j.owner_sub = $1 WHERE r.owner_sub = $1 AND r.started_at<=$2",
  "SELECT j.name,r.status,r.started_at,r.lanes_requested,r.lanes_completed,x.observed_model,x.judge_score::text,x.judge_mode,x.cost_usd::text FROM bake_off_runs r JOIN bake_off_jobs j ON j.id=r.job_id AND j.owner_sub = $1 LEFT JOIN LATERAL (SELECT observed_model,judge_score,judge_mode,cost_usd FROM bake_off_results x WHERE x.run_id=r.id AND x.owner_sub = $1 AND x.created_at<=$2 AND x.ok=true ORDER BY x.judge_score DESC NULLS LAST,x.created_at DESC LIMIT 1) x ON true WHERE r.owner_sub = $1 AND r.started_at<=$2 ORDER BY r.started_at DESC,r.id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"jobs","saved-benchmarks","Saved benchmarks"],[1,"active","runs-active","Benchmarks running"],[1,"failed","runs-failed","Failed benchmark runs"],[1,"five","completed-5d","Runs completed / 5d"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"bake-off-home",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(2).forEach(r=>item(r.name,clip(r.status)+' / started '+date(r.started_at),'Recorded lanes '+clip(r.lanes_completed)+' of '+clip(r.lanes_requested)+'. Best recorded successful lane by score: '+clip(r.observed_model||'model not captured')+'; score '+clip(r.judge_score??'unavailable')+'; judge mode '+clip(r.judge_mode||'unknown')+'; observed USD cost '+(Number(r.cost_usd)>0?clip(r.cost_usd):'unknown')+'. Compare rubric and unscored lanes in Bake-Off before selecting a model.', ['prepare-document'],r.status==='failed'?'warn':'neutral'));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"bake-off-home"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"bake-off-home"});
  items.push({text:"Benchmark jobs and runs are owner-scoped through their parent job, and each result must match the same owner. A missing or zero observed lane cost stays unknown, never free. The selected lane is only the best scored successful observation in that run, not a universal model recommendation. Prepare a comparison document without running a benchmark or changing providers.",tone:'neutral',fix:"bake-off-home"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
