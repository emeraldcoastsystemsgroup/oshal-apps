/** Saved print-ingest evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*) FILTER (WHERE state='awaiting_approval')::text AS review, count(*) FILTER (WHERE state IN ('failed','partially_ingested'))::text AS failed, count(*) FILTER (WHERE created_at > $2::timestamptz - interval '120 hours')::text AS five FROM print_intake WHERE owner_sub = $1 AND created_at <= $2 AND (decided_at IS NULL OR decided_at <= $2)",
  "SELECT title, state, text_chars, left(text_body,1400) AS excerpt, created_at FROM print_intake WHERE owner_sub = $1 AND created_at <= $2 AND (decided_at IS NULL OR decided_at <= $2) ORDER BY (state IN ('awaiting_approval','failed','partially_ingested')) DESC, created_at DESC, intake_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"review","intake-review","Awaiting filing approval"],[0,"failed","intake-needs-attention","Failed / partial filing"],[0,"five","intake-5d","Received / 5 days"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"print-ingest",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(1).forEach(r => item(r.title, clip(r.state) + ' · ' + clip(r.text_chars) + ' extracted characters · received ' + date(r.created_at), clip(r.excerpt,1400) || 'No extracted text saved.', ['prepare-document'], ['failed','partially_ingested','awaiting_approval'].includes(r.state) ? 'warn' : 'neutral'));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"print-ingest"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"print-ingest"});
  items.push({text:"Counts saved, deduplicated owner intake records. Fully ingested and partially ingested stay distinct; receipt is not filing. Explicit document preparation transfers a bounded text excerpt into Office without approving any knowledge-base destinations.",tone:'neutral',fix:"print-ingest"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
