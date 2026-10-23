/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | One bounded, read-only summary of what waits on the person in Operations (response plans to approve, executions without verified recovery, overdue break-glass reconciliations, firing anomaly baselines, investigations started, refused or uncertain, processing that needs review, swarm hand-offs), so Jarvis and the Overview can answer "what needs my attention" from saved records only. */
// @ts-nocheck
const requireOwner=owner=>{if(typeof owner!=='string'||!owner.trim())throw Object.assign(Error('A verified caller is required.'),{status:401});};
const rows=async(pool,sql,owner)=>(await pool.query(sql,[owner])).rows.map(r=>r.record);
/** @description Counts and short lines from the person's own saved records; nothing is run and no external system is read. */
export async function attentionSummary(pool,owner,now=Date.now()){
 requireOwner(owner);
 const plans=await rows(pool,'SELECT record FROM operations_action_plans WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 64',owner);
 const approvals=await rows(pool,'SELECT record FROM operations_action_approvals WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 200',owner);
 const executions=await rows(pool,'SELECT record FROM operations_action_executions WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 200',owner);
 const promotions=await rows(pool,'SELECT record FROM operations_git_promotions WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 100',owner);
 const investigations=await rows(pool,'SELECT record FROM operations_investigations WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 100',owner);
 const delegations=await rows(pool,'SELECT record FROM operations_delegations WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 100',owner);
 const anomaly=(await pool.query('SELECT id, record FROM operations_anomaly_state WHERE user_sub=$1 LIMIT 400',[owner])).rows.filter(r=>r.id.startsWith('baseline:')).map(r=>r.record);
 const processing=(await pool.query('SELECT state FROM operations_processing WHERE user_sub=$1 LIMIT 500',[owner])).rows;
 const approved=new Set(approvals.filter(a=>Date.parse(a.expiresAt)>now).map(a=>a.planId)),executed=new Set(executions.map(e=>e.planId));
 const count=(label,n,page,detail)=>({label,count:n,page,detail:detail||null});
 const items=[
  count('Response plans awaiting your approval',plans.filter(p=>!approved.has(p.id)&&!executed.has(p.id)).length,'incidents'),
  count('Executions without verified recovery',executions.filter(e=>e.state!=='reserved-outcome-unknown'&&e.recovery?.outcome!=='healthy').length,'incidents'),
  count('Break-glass reconciliations overdue',promotions.filter(r=>r.kind==='break-glass-reconciliation'&&!r.merged&&Date.parse(r.deadline)<now).length,'incidents'),
  count('Anomaly baselines firing',anomaly.filter(b=>b.state?.firing===true).length,'streams'),
  count('Investigations started automatically',investigations.filter(i=>i.state==='started'&&i.trigger==='scheduled-tick').length,'data'),
  count('Automatic starts refused or uncertain',investigations.filter(i=>['start-refused','start-uncertain'].includes(i.state)).length,'data','Open each in Data pipeline; a refused start says why, an uncertain one needs a check before starting again.'),
  count('Processing that needs review',processing.filter(p=>['attention','evidence-attention'].includes(p.state)).length,'data'),
  count('Hand-offs sent to other swarms',delegations.filter(d=>d.direction==='outbound'&&d.state==='delivered').length,'swarms'),
  count('Hand-offs that failed to send',delegations.filter(d=>d.direction==='outbound'&&d.state==='delivery-failed').length,'swarms'),
  count('Delegations from other swarms filed as investigations',delegations.filter(d=>d.direction==='inbound'&&d.ticketId).length,'swarms')];
 const needs=items.filter(i=>i.count>0&&!/^(Hand-offs sent|Delegations from other swarms filed|Investigations started automatically)/.test(i.label));
 return {asOf:new Date(now).toISOString(),items,summary:needs.length?needs.map(i=>i.count+' '+i.label.toLowerCase()).join('; ')+'.':'Nothing in Operations is waiting on you.',source:'your own saved Operations records; nothing was run',executionAuthorized:false};
}
