/**
 * Discovery work remains attributed to the caller's existing Studio workflow.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The summary admits this application's own administrator as well as the kernel operator. This catalog-less app's administrator role is the kernel's @app-admin; a person holding it was refused 403 "Operator access required" because only the kernel-operator flag was read. The role is read from the kernel's auth.application intent where the host offers one; without it the operator check alone stands.
 */
import { Router } from 'express';
import { isOperator } from '@/shared/middleware/authz';
import type { AppContext } from '@/app/composition/app-context';

/** The role the kernel grants an application without an authorization catalog as its administrator. */
export const APP_ADMIN_ROLE = '@app-admin';

/**
 * @description Whether the caller administers this application: the kernel operator, or a holder of the
 * application's own administrator role as the kernel reports it for this call (auth.application roles).
 * @param ctx - The package context; its intent port exists only on hosts that report application roles.
 * @param req - The admitted request.
 * @returns True for the operator or an application administrator.
 */
export async function isApplicationAdmin(ctx: AppContext, req: unknown): Promise<boolean> {
  if (isOperator(req as never)) return true;
  const intent = (ctx as unknown as { intent?: (name: string, input: object) => Promise<{ roles?: unknown }> }).intent;
  if (typeof intent !== 'function') return false;
  const authority = await intent.call(ctx, 'auth.application', {});
  return Array.isArray(authority?.roles) && authority.roles.includes(APP_ADMIN_ROLE);
}

export function createHomeSummaryRoutes(ctx:AppContext):Router {
 const r=Router();r.get('/',async(req,res)=>{res.setHeader('Cache-Control','no-store');const o=(req as any).oidc,sub=o?.user?.sub;if(!sub||o?.isAuthenticated?.()!==true){res.status(401).json({error:'not_authenticated'});return;}if(!(await isApplicationAdmin(ctx,req))){res.status(403).json({error:'Operator access required'});return;}
 const now=new Date();const queries=[
 "SELECT count(*) FILTER(WHERE status='running')::text AS running,count(*) FILTER(WHERE status IN ('suspended','escalated','error'))::text AS review,count(*) FILTER(WHERE status='completed' AND finished_at>$2::timestamptz-interval '120 hours' AND finished_at<=$2)::text AS completed FROM workflow_runs WHERE owner_sub = $1 AND ticket_type='capability-ideation' AND started_at<=$2",
 "SELECT r.workflow_name,r.status,r.started_at,s.node_title,left(s.output_summary::text,1200) AS excerpt FROM workflow_runs r LEFT JOIN LATERAL (SELECT node_title,output_summary FROM workflow_run_steps s WHERE s.run_id=r.run_id AND s.owner_sub = $1 AND s.created_at<=$2 ORDER BY s.seq DESC LIMIT 1) s ON true WHERE r.owner_sub = $1 AND r.ticket_type='capability-ideation' AND r.started_at<=$2 ORDER BY r.started_at DESC,r.run_id LIMIT 3"
 ];const result=await Promise.allSettled(queries.map(text=>ctx.pool.query({text,values:[sub,now],query_timeout:1800} as any)));const rows=(i:number):any[]=>result[i].status==='fulfilled'?(result[i] as PromiseFulfilledResult<any>).value.rows:[];
 const metrics=[['running','Discovery runs active'],['review','Runs needing review'],['completed','Runs completed / 5d']].map(([id,label])=>({id,label,value:result[0].status==='fulfilled'?String(rows(0)[0]?.[id]??'0'):'Unavailable'}));
 const items:any[]=rows(1).map(v=>({text:String(v.workflow_name||'Capability discovery').slice(0,120),detail:v.status+' / '+new Date(v.started_at).toISOString(),fix:'capability-ideator-review',actions:['prepare-document','explore-venture'].map(integration=>({integration,context:{title:'Review capability discovery',notes:('Recorded workflow state: '+v.status+'. Latest step: '+v.node_title+'. Saved, redacted step output: '+(v.excerpt||'No saved output')+'. This is workflow evidence, not proof that a proposed tool exists, is connected, or has been implemented. Review sources and requirements before planning.').slice(0,2000)}}))}));
 const failed=result.filter(r=>r.status==='rejected').length;items.push({text:failed?'Some discovery evidence cannot be checked.':'Open discovery to inspect loaded app actions and connection requirements, then develop a sourced process proposal.',fix:'capability-ideator-review',tone:failed?'warn':'neutral'});
 res.status(failed===result.length?503:200).json({metrics,tiles:metrics,items,partial:failed>0,asOf:now.toISOString()});
 });return r;
}
