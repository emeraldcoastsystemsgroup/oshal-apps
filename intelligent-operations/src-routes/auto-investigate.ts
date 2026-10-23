/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Record a kernel refusal (refused, invalid, not linked) as start-refused, a definite no-start held for the operator, apart from an uncertain start. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Automatic investigation dispatch: with the worker's opt-in, each tick starts at most two investigations for captured evidence that has none, through the kernel package-port ticket start (the HTTP start path). A starting marker is committed before the start; a ticket that is no longer queued is never started again, and an uncertain start is held for the operator instead of retried, because a second start of a running ticket would dispatch its phase twice. */
// @ts-nocheck
import {processingConfig} from './processing-worker';
import {prepareInvestigation} from './investigations';
import {processingTransaction} from './pipeline';
const PER_TICK=2;
// The kernel answers a refused or invalid start before dispatch; nothing started. Anything else (lost reply, unavailable) is uncertain.
const REFUSED=/^(refused|invalid): |is not linked for this package/;
async function mark(pool,owner,id,from,patch){
 return processingTransaction(pool,async c=>{
  const row=(await c.query('SELECT record FROM operations_investigations WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0]?.record;
  if(!row||(from&&!from.includes(row.state)))return null;
  const record={...row,...patch};await c.query('UPDATE operations_investigations SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,id,JSON.stringify(record)]);return record;
 });
}
/** @description Start investigations for captured evidence without one; bounded, idempotent and never a blind retry. */
export async function autoInvestigate(ctx,owner){
 const config=await processingConfig(ctx.pool,owner);
 if(!config.enabled||!config.autoInvestigate)return {enabled:false};
 if(typeof ctx.ticketService?.startTicket!=='function')return {enabled:true,available:false,reason:'The kernel ticket start port is unavailable; start investigations from Data pipeline.'};
 const pending=(await ctx.pool.query("SELECT w.id FROM operations_evidence_work w LEFT JOIN operations_investigations i ON i.user_sub=w.user_sub AND i.id=w.id WHERE w.user_sub=$1 AND w.record->>'state'='captured' AND (i.id IS NULL OR i.record->>'state'='queued') ORDER BY w.created_at, w.id LIMIT "+PER_TICK,[owner])).rows;
 const results=[];
 for(const {id} of pending){
  try{
   const prepared=await prepareInvestigation(ctx,owner,id);
   if(prepared.ticket?.status!=='queued'){await mark(ctx.pool,owner,id,['queued'],{state:'started',reconciledAt:new Date().toISOString(),ticketStatus:prepared.ticket?.status||null});results.push({id,ticketId:prepared.ticketId,state:'already-started'});continue;}
   const claimed=await mark(ctx.pool,owner,id,['queued'],{state:'starting',startRequestedAt:new Date().toISOString(),trigger:'scheduled-tick'});
   if(!claimed){results.push({id,state:'skipped',reason:'another tick claimed this start'});continue;}
   try{const started=await ctx.ticketService.startTicket(prepared.ticketId,prepared.startInput);await mark(ctx.pool,owner,id,['starting'],{state:'started',startedAt:new Date().toISOString(),ticketStatus:started?.ticket?.status||started?.status||null});results.push({id,ticketId:prepared.ticketId,state:'started'});}
   catch(error){const message=String(error?.message||error).slice(0,240),state=REFUSED.test(message)?'start-refused':'start-uncertain';await mark(ctx.pool,owner,id,['starting'],{state,error:message});results.push({id,ticketId:prepared.ticketId,state,error:message});}
  }catch(error){results.push({id,state:'not-prepared',error:error.status?String(error.message).slice(0,240):'Investigation storage or ticket service is unavailable.'});}
 }
 return {enabled:true,available:true,started:results.filter(r=>r.state==='started').length,uncertain:results.filter(r=>r.state==='start-uncertain').length,refused:results.filter(r=>r.state==='start-refused').length,results};
}
