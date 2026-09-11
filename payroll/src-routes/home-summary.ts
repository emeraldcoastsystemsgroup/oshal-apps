/** Payroll review evidence from the caller's saved ledger. No payroll preparation, approval or payment. */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
const clip=(v:unknown,n=400)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
const day=(v:unknown)=>v instanceof Date?v.toISOString().slice(0,10):String(v??'').slice(0,10);
export function createHomeSummaryRoutes(ctx:AppContext):Router {
 const router=Router();router.get('/',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');const oidc=(req as any).oidc,sub=oidc?.user?.sub||oidc?.user?.oid;
  if(!sub||oidc?.isAuthenticated?.()!==true){res.status(401).json({error:'not_authenticated'});return;}
  const now=new Date(),read=(text:string)=>ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any);
  const [runs,payments,recent]=await Promise.allSettled([
   read("SELECT count(*) FILTER (WHERE status='draft')::text AS draft, count(*) FILTER (WHERE status='paid')::text AS posted FROM payroll_runs WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2"),
   read("SELECT count(*) FILTER (WHERE p.status='pending')::text AS pending, count(*) FILTER (WHERE p.status='returned')::text AS returned FROM payroll_payments p JOIN payroll_runs r ON r.run_id=p.run_id AND r.user_sub=p.user_sub WHERE p.user_sub = $1 AND r.user_sub = $1 AND p.created_at <= $2 AND p.updated_at <= $2"),
   read("SELECT run_id, period_start, period_end, pay_date, status, updated_at FROM payroll_runs WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY (status='draft') DESC, updated_at DESC, run_id LIMIT 3"),
  ]);
  const metrics=[[runs,'draft','draft-pay-runs','Pay runs to review'],[runs,'posted','posted-pay-runs','Runs marked paid'],[payments,'pending','pending-payments','Payments pending'],[payments,'returned','returned-payments','Payments returned']].map(([result,key,id,label]:any[])=>({id,label,value:result.status==='fulfilled'?String(result.value.rows[0]?.[key]??'0'):'Unavailable'}));
  const items:any[]=recent.status==='fulfilled'?recent.value.rows.map((r:any)=>{const notes=clip('Pay run '+r.run_id+', period '+day(r.period_start)+' to '+day(r.period_end)+', pay date '+day(r.pay_date)+', recorded run status '+r.status+'. Last updated '+new Date(r.updated_at).toISOString()+'. Run approval does not prove bank settlement; review payment-level evidence.',2000);return {text:'Pay run for '+day(r.pay_date),detail:clip(notes),tone:'neutral',highlight:r.status==='draft',fix:'payroll-home',actions:['review-finance','prepare-document'].map(integration=>({integration,context:{title:'Review a payroll run',notes}}))};}):[];
  const failed=[runs,payments,recent].filter(r=>r.status==='rejected').length;
  if(failed)items.push({text:'Some saved payroll data cannot be checked.',tone:'warn',fix:'payroll-home'});
  else if(!items.length)items.push({text:'No saved payroll runs yet.',tone:'neutral',fix:'payroll-home'});
  items.push({text:'Saved ledger states. A run marked paid or a generated bank file is not confirmation that wages reached an account.',tone:'neutral',fix:'payroll-home'});
  res.status(failed===3?503:200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });return router;
}
