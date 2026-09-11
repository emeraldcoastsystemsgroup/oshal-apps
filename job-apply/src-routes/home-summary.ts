/** Saved job-apply evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*) FILTER(WHERE state IN ('claimed','queued_to_worker','acknowledged','running'))::text AS active,count(*) FILTER(WHERE state IN ('failed','unknown_outcome'))::text AS review,count(*) FILTER(WHERE state='manual_mark')::text AS manual FROM apply_runs WHERE owner_sub = $1 AND created_at<=$2 AND updated_at<=$2",
  "SELECT count(DISTINCT posting_id) FILTER(WHERE finished_at>$2::timestamptz-interval '24 hours')::text AS day,count(DISTINCT posting_id)::text AS five FROM apply_runs WHERE owner_sub = $1 AND state='submitted_verified' AND confirmation_path IS NOT NULL AND confirmation_sha256 IS NOT NULL AND finished_at<=$2 AND finished_at>$2::timestamptz-interval '120 hours'",
  "SELECT r.posting_id,r.state,r.updated_at,p.title,c.name AS company FROM apply_runs r LEFT JOIN career_postings p ON p.id=r.posting_id LEFT JOIN career_companies c ON c.id=p.company_id WHERE r.owner_sub = $1 AND r.created_at<=$2 AND r.updated_at<=$2 ORDER BY (r.state IN ('failed','unknown_outcome')) DESC,r.updated_at DESC,r.run_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"active","runs-active","Submission runs active"],[0,"review","runs-review","Failed / unknown runs"],[0,"manual","manual-marks","Manually marked runs"],[1,"day","verified-24h","Verified submissions/24h"],[1,"five","verified-5d","Verified submissions/5d"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"job-apply-review",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(2).forEach(r=>item(r.title||'Application '+r.posting_id,clip(r.company||'Company unavailable')+' / '+clip(r.state)+' / '+date(r.updated_at),'Posting '+clip(r.posting_id)+'. State comes from the authoritative Apply run ledger. Only submitted_verified has retained confirmation evidence. A manual mark or completed workflow is not verified submission. Review in Career before retrying or contacting anyone.', ['review-career','prepare-document'],['failed','unknown_outcome'].includes(r.state)?'warn':'neutral'));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"job-apply-review"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"job-apply-review"});
  items.push({text:"Uses the authoritative Apply V2 ledger, not workflow completion. Verified counts are distinct posting IDs in each rolling completion window with retained confirmation path/hash; no private path is exposed. Active, failed/unknown and manually marked runs remain separate. Review in Career or prepare a follow-up document; Home never retries a submission.",tone:'neutral',fix:"job-apply-review"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
