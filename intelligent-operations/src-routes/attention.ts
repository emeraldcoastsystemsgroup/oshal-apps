/** CHANGE LOG: 6 | maintainer@emeraldcoastsystemsgroup.com | Alerts an engine outage keeps waiting are on the attention list, because an outage no longer sends them to review (fifth review, 2026-11-04). */
/** CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | What a fourth review proved (2026-11-04). A rail that keeps refusing is on the attention list, because a green tick and a card that names the alert said nothing about the phone having stopped. An alert reported cleared and being confirmed no longer counts as a critical alert firing. */
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | A third review proved that with the processing schedule stopped Jarvis said nothing was waiting and the droplet was reporting, which it was, while no alarm could be raised (2026-11-04). Both summaries now say when the silence watch has stopped. A start refused for good stops counting as waiting after three days: the card keeps saying why, and nothing can be done about old evidence. */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | An independent review proved Jarvis said 'Nothing in Operations is waiting on you' while a droplet was silent or a critical alert was firing, and answered a question about the droplet with discovery advice (2026-11-03). Both summaries now read the monitored installations: who stopped reporting and what critical is firing count as attention, and ops-systems leads with each installation's standing. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Jarvis-sized read-only summaries: systems health with scheduled discovery state, response plans with approval, execution and recovery state, and anomaly baselines; each bounded, from the person's own records, and says what to open next. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | One bounded, read-only summary of what waits on the person in Operations (response plans to approve, executions without verified recovery, overdue break-glass reconciliations, firing anomaly baselines, investigations started, refused or uncertain, processing that needs review, swarm hand-offs), so Jarvis and the Overview can answer "what needs my attention" from saved records only. */
// @ts-nocheck
import {readGraph} from './topology-store';
import {discoveryConfig} from './discovery';
import {responseRecords} from './execution';
import {anomalyRecords} from './anomaly-engine';
import {installationStanding,watchStatus,phoneMark} from './installations';
const requireOwner=owner=>{if(typeof owner!=='string'||!owner.trim())throw Object.assign(Error('A verified caller is required.'),{status:401});};
const rows=async(pool,sql,owner)=>(await pool.query(sql,[owner])).rows.map(r=>r.record);
const ago=s=>s===null?'never':s<90?s+' seconds ago':s<5400?Math.round(s/60)+' minutes ago':Math.round(s/3600)+' hours ago';
/** Heartbeats do not depend on the schedule, so an installation can look fine while nothing could raise its alarm. */
async function stoppedWatch(pool,owner,now,installations){
 if(!installations.length)return null;
 const watch=await watchStatus(pool,owner,()=>now);
 return watch.overdue?(watch.ageSeconds===null?'the silence watch has not run yet':'the silence watch last ran '+ago(watch.ageSeconds))+', so no alarm can be raised until the processing schedule runs':null;
}
const REFUSED_WAITS_MS=3*86400000;
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
 const count=(label,n,page,detail,names)=>({label,count:n,page,detail:detail||null,...(names?{names}:{})});
 const installations=await installationStanding(pool,owner,()=>now),silent=installations.filter(i=>i.state==='silent').map(i=>i.name);
 const critical=installations.flatMap(i=>i.firing.filter(a=>a.severity==='critical'&&a.alertType!=='InstallationSilent'&&!a.clearing).map(a=>a.alertType+(a.service?' ('+a.service+')':'')+' on '+i.name));
 const stopped=await stoppedWatch(pool,owner,now,installations),rail=(await phoneMark(pool,owner))?.railError;
 const items=[
  count('Silence watches stopped',stopped?1:0,'systems',null,stopped),
  count('Phone rails refusing messages',rail?1:0,'systems',null,rail?'since '+rail.since+': '+rail.error:null),
  count('Monitored installations that stopped reporting',silent.length,'systems',null,silent.join(', ')),
  count('Critical alerts on monitored installations',critical.length,'systems',null,critical.slice(0,8).join(', ')),
  count('Response plans awaiting your approval',plans.filter(p=>!approved.has(p.id)&&!executed.has(p.id)).length,'incidents'),
  count('Executions without verified recovery',executions.filter(e=>e.state!=='reserved-outcome-unknown'&&e.recovery?.outcome!=='healthy').length,'incidents'),
  count('Break-glass reconciliations overdue',promotions.filter(r=>r.kind==='break-glass-reconciliation'&&!r.merged&&Date.parse(r.deadline)<now).length,'incidents'),
  count('Anomaly baselines firing',anomaly.filter(b=>b.state?.firing===true).length,'streams'),
  count('Investigations started automatically',investigations.filter(i=>i.state==='started'&&i.trigger==='scheduled-tick').length,'data'),
  count('Automatic starts refused or uncertain',investigations.filter(i=>i.state==='start-uncertain'||(i.state==='start-refused'&&!(now-Date.parse(i.createdAt)>=REFUSED_WAITS_MS))).length,'data','Open each in Data pipeline; a refused start says why, an uncertain one needs a check before starting again.'),
  count('Processing that needs review',processing.filter(p=>['attention','evidence-attention'].includes(p.state)).length,'data'),
  count('Alerts waiting to be evaluated',processing.filter(p=>p.state==='retry').length,'data'),
  count('Hand-offs sent to other swarms',delegations.filter(d=>d.direction==='outbound'&&d.state==='delivered').length,'swarms'),
  count('Hand-offs that failed to send',delegations.filter(d=>d.direction==='outbound'&&d.state==='delivery-failed').length,'swarms'),
  count('Delegations from other swarms filed as investigations',delegations.filter(d=>d.direction==='inbound'&&d.ticketId).length,'swarms')];
 const needs=items.filter(i=>i.count>0&&!/^(Hand-offs sent|Delegations from other swarms filed|Investigations started automatically)/.test(i.label));
 return {asOf:new Date(now).toISOString(),items,summary:needs.length?needs.map(i=>i.count+' '+i.label.toLowerCase()+(i.names?' ('+i.names+')':'')).join('; ')+'.':'Nothing in Operations is waiting on you.',source:'your own saved Operations records; nothing was run',executionAuthorized:false};
}

const local=v=>v||null;
/** @description Inventory health for Jarvis: counts by health, the degraded and unknown assets (at most 25), and scheduled discovery's state. */
export async function systemsSummary(pool,owner,now=Date.now()){
 requireOwner(owner);
 const graph=await readGraph(pool,owner),discovery=await discoveryConfig(pool,owner),assets=graph.assets||[],installations=await installationStanding(pool,owner,()=>now);
 const by=h=>assets.filter(a=>a.health===h);
 const pick=a=>({name:a.name,kind:a.kind,provider:a.provider,scope:a.scope,health:a.health,namespace:a.properties?.namespace||null,pressure:a.properties?.pressure||null,observedAt:local(a.observedAt)});
 const issues=[...by('degraded'),...by('unknown')].slice(0,25).map(pick);
 const d=discovery.enabled?{enabled:true,namespace:discovery.namespace,intervalMinutes:discovery.intervalMinutes,last:discovery.lastResult||null}:{enabled:false};
 const stopped=await stoppedWatch(pool,owner,now,installations);
 const said=installations.map(i=>{const firing=i.firing.filter(a=>a.alertType!=='InstallationSilent').map(a=>a.alertType+(a.service?' ('+a.service+')':''));return i.name+(i.state==='silent'?' has stopped reporting, last heard '+ago(i.ageSeconds):i.state==='never'?' has sent alerts but no report yet':(i.state==='late'?' is late, last heard ':' is reporting, heard ')+ago(i.ageSeconds))+(firing.length?', firing '+firing.join(', '):'');}).join('; ');
 const summary=(stopped?'Watch out: '+stopped+'. ':'')+(said?'Monitored installations: '+said+'. ':'')+assets.length+' assets: '+by('healthy').length+' healthy, '+by('degraded').length+' degraded, '+by('unknown').length+' unknown. '+(installations.length&&!d.enabled?'':d.enabled?(d.last?.state==='saved'?'Scheduled discovery last saved '+d.last.assets+' assets at '+d.last.observedAt+'.':'Scheduled discovery is on'+(d.last?' but its last read was '+d.last.state+': '+d.last.error:' and waiting for its first read')+'.'):'Scheduled discovery is off; turn it on in Systems to keep the inventory current.');
 return {summary,installations,counts:{assets:assets.length,healthy:by('healthy').length,degraded:by('degraded').length,unknown:by('unknown').length},issues,truncated:by('degraded').length+by('unknown').length>25,discovery:d,open:'Systems',source:'your own saved inventory and discovery setting; nothing was read from a cluster now',executionAuthorized:false};
}
/** @description Response plans for Jarvis: target, approval, executions and verified recovery for the 20 newest plans. */
export async function responsesSummary(ctx,owner){
 const r=await responseRecords(ctx,owner),now=Date.now();
 const plans=r.items.map(p=>{const ex=p.executions||[],last=ex[0]||null;return {planId:p.id,ticket:p.ticket?.title||p.ticketId||null,target:p.target?((p.target.namespace||'')+'/'+(p.target.pod||'')+(p.target.container?' · '+p.target.container:'')):null,artifacts:(p.artifacts||[]).map(a=>a.name),approval:p.invalidated?'invalidated by a ticket change':!p.approval?'not approved':p.approval.expired||Date.parse(p.approval.expiresAt)<=now?'approval expired':'approved until '+p.approval.expiresAt,executions:ex.length,lastExecution:last?{state:last.state,exitCode:last.result?.exitCode??null,recovery:last.recovery?.outcome||'not measured'}:null};});
 const waiting=plans.filter(p=>p.approval==='not approved'&&!p.executions).length,unverified=plans.filter(p=>p.lastExecution&&p.lastExecution.recovery!=='healthy').length;
 return {summary:plans.length+' response plans: '+waiting+' waiting for your approval, '+unverified+' executed without verified recovery.',plans,truncated:r.truncated,open:'Incident work',approveAndRunIn:'Incident work, with a fresh confirmation; Jarvis cannot approve or run a plan',executionAuthorized:false};
}
/** @description Anomaly baselines for Jarvis: firing first, then readiness, at most 25. */
export async function anomaliesSummary(pool,owner){
 const r=await anomalyRecords(pool,owner),base=r.baselines||[];
 const rows=base.slice().sort((a,b)=>Number(b.firing)-Number(a.firing)||Math.abs(b.lastScore||0)-Math.abs(a.lastScore||0)).slice(0,25).map(b=>({metric:b.name,resource:b.resource?.id||b.resource||null,readiness:b.readiness,firing:b.firing,lastScore:b.lastScore??null,samples:b.samples,lastObservedAt:b.lastObservedAt||null}));
 const firing=base.filter(b=>b.firing).length,ready=base.filter(b=>b.readiness==='ready').length;
 return {summary:(r.config?.enabled?'Detection is on. ':'Detection is off. ')+base.length+' baselines: '+firing+' firing, '+ready+' ready.',baselines:rows,truncated:base.length>25,open:'Live context',executionAuthorized:false};
}
