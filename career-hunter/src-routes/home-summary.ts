/** Saved career-hunter evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*) FILTER(WHERE status='approval_required')::text AS review FROM career_hunter_applications WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2",
  "SELECT count(*) FILTER(WHERE scored_at>$2::timestamptz-interval '24 hours')::text AS day,count(*)::text AS five FROM career_user_job_scores WHERE user_sub = $1 AND scored_at<=$2 AND scored_at>$2::timestamptz-interval '120 hours'",
  "SELECT count(*)::text AS tracked,count(*) FILTER(WHERE interview_at IS NOT NULL AND interview_at<=$2 AND interview_at>$2::timestamptz-interval '120 hours')::text AS interviews FROM career_user_applications WHERE user_sub = $1 AND created_at<=$2 AND updated_at<=$2",
  "SELECT p.title,c.name AS company,s.fit_score,s.ai_fit_score,s.scored_at,s.ai_scored_at FROM career_user_job_scores s JOIN career_postings p ON p.id=s.posting_id JOIN career_companies c ON c.id=p.company_id WHERE s.user_sub = $1 AND s.scored_at<=$2 AND s.target_role=true ORDER BY s.scored_at DESC,s.posting_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"review","approval-review","Application approvals"],[1,"day","scored-24h","Scores updated / 24h"],[1,"five","scored-5d","Scores updated / 5d"],[2,"tracked","tracked-applications","Tracked applications"],[2,"interviews","interviews-5d","Recorded interviews / 5d"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"career-review",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(3).forEach(r=>item(r.title,clip(r.company)+' / scored '+date(r.scored_at),'Recorded rule fit: '+clip(r.fit_score??'not scored')+'. AI fit: '+(r.ai_scored_at&&new Date(r.ai_scored_at)<=now?clip(r.ai_fit_score??'not scored')+' / '+date(r.ai_scored_at):'not scored')+'. Scores prioritize review; they do not establish qualification, employer interest or an application. Prepare an interview/research brief, or edit a networking draft before sharing.', ['prepare-document','prepare-social']));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"career-review"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"career-review"});
  items.push({text:"Separates pending application approvals, recently updated personal scores, tracked application records and recorded interviews. Shared job-corpus size is not personal progress. Selected job title/company and score metadata can prepare an Office research brief or a reviewed Social networking draft. No application submission or public post is triggered.",tone:'neutral',fix:"career-review"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
