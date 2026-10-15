/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bind original-owner render continuations and protected verified human/agent output transport.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep content-free continuation diagnostics inside its fresh original-owner service binding.
 */
import {createRequire} from 'node:module';
import {MotionRenderJobs,jobId,renderContinuationDiagnostic} from './render-jobs.mjs';
import {bindRequest} from './authorization.mjs';
import {MotionError} from './project-store.mjs';
const require=createRequire(import.meta.url);
const offset=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,8})$/.test(v)?Number(v):(()=>{throw new MotionError(400,'motion_invalid_render_offset');})();
export function mountRenderRoutes(router,run,packageCtx,contextStore){
 const service=(ctx,store)=>new MotionRenderJobs(ctx,process.env.OSHAL_PACKAGE_DATA_DIR,store);
 router.post('/render-jobs',run('export',async(req,store,ctx)=>{
  const jobs=service(ctx,store),result=await jobs.begin(req.body);
  if(result.created){
   let runs;try{runs=require('@/shared/package-runs');await runs.keepRunAlive(result.render.id,300,'engine');}catch(error){await jobs.abandonQueued('motion_render_continuation_unavailable').catch(()=>{});throw new MotionError(503,'motion_render_continuation_unavailable');}
   // Enter only after the route can answer. Each action binds current original authority anew.
   setImmediate(()=>{void runs.run(result.render.id,async()=>{try{renderContinuationDiagnostic(packageCtx,'entered');const fresh=bindRequest(packageCtx),freshStore=contextStore(fresh);renderContinuationDiagnostic(fresh,'bound');await service(fresh,freshStore).produce(result.render.id);renderContinuationDiagnostic(fresh,'completed');}catch(error){renderContinuationDiagnostic(packageCtx,'failed',error);throw error;}}).then(()=>runs.runFinished(result.render.id,0),async()=>{await runs.runFinished(result.render.id,1);}).catch(()=>{});});
  }
  return {render:result.render,openUrl:'/api/motion-studio/app?renderJob='+result.render.id};
 },true));
 router.get('/render-jobs',run('export',async(_req,store,ctx)=>({jobs:await service(ctx,store).list()})));
 router.get('/render-jobs/:job',run('export',async(req,store,ctx)=>({render:await service(ctx,store).status(jobId(req.params.job))})));
 router.post('/render-jobs/:job/cancel',run('export',async(req,store,ctx)=>{const body=req.body;if(!body||Object.keys(body).some(k=>k!=='id')||body.id!==undefined&&body.id!==req.params.job)throw new MotionError(400,'motion_invalid_render_input');return{render:await service(ctx,store).cancel(jobId(req.params.job))};},true));
 for(const[route,size]of[['chunks',8192],['artifact-chunks',65536]])router.get('/render-jobs/:job/'+route+'/:offset',run('export',async(req,store,ctx)=>({chunk:await service(ctx,store).chunk(jobId(req.params.job),offset(req.params.offset),size)})));
}
