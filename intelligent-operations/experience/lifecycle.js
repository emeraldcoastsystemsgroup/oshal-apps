/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Keep evidence actions in a labeled disclosure below the measured funnel and preserve its open state on refresh. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Show cohort-linked evidence and genuine canonical AI/workflow progress, dispatching only sealed preprocessed files under the original user's portal session. */
(function(root){
'use strict';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
/** @description Deduplicate the latest evaluated cohort and count only its linked canonical completed first-phase outputs with actual receipts. */
function metrics(records,links){
 const latest=new Map();for(const d of [...(records.decisions||[])].sort((a,b)=>String(b.at).localeCompare(String(a.at))||String(b.id).localeCompare(String(a.id))))if(!latest.has(d.deliveryId))latest.set(d.deliveryId,d);
 const survivors=[...latest.values()].filter(d=>d.outcome==='matched'&&['admitted','escalated'].includes(d.reduction?.outcome)),ids=new Set(survivors.map(d=>d.deliveryId));
 const rows=(links.items||[]).filter(item=>ids.has(item.deliveryId)),unique=[...new Map(rows.map(r=>[r.id,r])).values()];
 const completed=row=>Array.isArray(row.work)&&row.work.some(w=>w.state==='completed'&&w.phase?.index===0&&typeof w.answer==='string'&&w.answer.trim()&&typeof w.receipt==='string'&&!w.resultUnavailable);
 return {survivors:ids.size,packets:unique.length,queued:unique.filter(r=>r.ticket?.status==='queued').length,assessed:unique.filter(completed).length,reportAccepted:unique.filter(r=>r.ticket?.status==='done').length,unavailable:unique.filter(r=>r.ticketUnavailable||r.workUnavailable).length,pending:unique.filter(r=>!r.ticketId).length,truncated:links.truncated===true,rows:unique,deliveryIds:[...ids]};
}
/** @description Mount exact packet-to-ticket controls; refresh and refusal fence every async result and remove private workflow content. */
function mount({request,onRefused}){
 const container=document.getElementById('pipeline-lifecycle');let generation=0,current=null,evidenceExpanded=false;
 function clear(){generation++;current=null;evidenceExpanded=false;container?.replaceChildren();container?.setAttribute('aria-busy','false');}
 async function canonical(path,body){const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!response.ok){if([401,403].includes(response.status))onRefused();throw Error('Canonical workflow request unavailable (HTTP '+response.status+').');}return response.json();}
 async function load(records){
  const run=++generation;current=records;container?.setAttribute('aria-busy','true');container?.replaceChildren(text('p','Reading packet-linked workflow progress…'));
  try{const links=await request('/investigations');if(run!==generation)return;
   if(!Array.isArray(links.items)||links.items.length>20)throw Error('Investigation links are unavailable.');
   for(const row of links.items){if(!row.ticketId||row.ticketUnavailable)continue;try{const result=await canonical('/tickets/'+encodeURIComponent(row.ticketId)+'/work');if(run!==generation)return;if(!Array.isArray(result.work))throw Error('Work response unavailable');row.work=result.work;}catch{if(run!==generation)return;row.workUnavailable=true;}}
   if(run===generation){render(records,links);container?.setAttribute('aria-busy','false');}
  }catch(error){if(run===generation){container?.replaceChildren(text('h3','Investigation and resolution'),text('p',error.message));container?.setAttribute('aria-busy','false');}}
 }
 function render(records,links){
  if(!container)return;container.replaceChildren(text('h3','From evidence to an accepted report'));
  const model=metrics(records,links),rail=text('div','','pipeline-flow');
  for(const [label,value,description]of [['Linked evidence packets',model.packets,'Unique evidence reservations linked to this evaluated cohort.'],['AI assessments completed',model.unavailable?'Unavailable':model.assessed,'Completed first-phase canonical output with a released answer and inference receipt.'],['Reports accepted',model.unavailable?'Unavailable':model.reportAccepted,'Canonical ticket is done. Acceptance does not establish recovery.'],['Verified infrastructure recovery','Not connected','A fresh recovery check is required; neither a resolved source alert nor an accepted report substitutes for it.']]){const card=text('article','','pipeline-stage');card.append(text('h3',label),text('strong',String(value)),text('p',description));rail.append(card);}container.append(rail,text('p',model.queued+' queued · '+model.pending+' pending/uncertain creations · '+model.unavailable+' unreadable workflow records'+(model.truncated?' · only the latest 20 links were returned':'')+'. Counts use the evaluated delivery cohort above.'));
  const refresh=text('button','Refresh workflow progress');refresh.type='button';refresh.addEventListener('click',()=>load(current));container.append(refresh);
  const cohortIds=new Set(model.deliveryIds),reservations=(records.evidenceWork||[]).filter(w=>w.capture&&cohortIds.has(w.deliveryId)).slice(0,20),work=text('details','','operator-evidence-work');work.open=evidenceExpanded;work.append(text('summary','Evidence work · '+reservations.length+' reservations'));work.addEventListener('toggle',()=>{if(work.isConnected)evidenceExpanded=work.open;});container.append(work);
  for(const reservation of reservations){
   const linked=links.items.find(r=>r.id===reservation.id),card=text('article','','card'),button=text('button',linked?.ticketId?'Open or resume investigation':'Start AI investigation');button.type='button';card.dataset.workId=reservation.id;card.append(text('h4','Evidence '+reservation.id.slice(0,12)),text('p',linked?.ticket?('Workflow: '+linked.ticket.status):linked?.ticketId?'Workflow unavailable':linked?'Ticket creation pending or uncertain':'Ready to pin a preprocessed packet. No raw-stream or cluster authority.'));
   button.addEventListener('click',()=>start(reservation.id,button));card.append(button);
   if(linked?.ticketId){const a=text('a','Open canonical ticket');a.href='/cockpit/?app=intelligent-operations&ticket='+encodeURIComponent(linked.ticketId);a.target='_top';card.append(a);}
   work.append(card);
  }
 }
 async function start(id,button){
  const run=generation;button.disabled=true;
  try{const prepared=await request('/investigations',{workId:id});if(run!==generation)return;
   if(!prepared.ticketId||!prepared.ticket||!prepared.startInput)throw Error('The canonical ticket or its sealed input is unavailable.');
   if(prepared.ticket.status==='queued')await canonical('/tickets/'+encodeURIComponent(prepared.ticketId)+'/start',prepared.startInput);
   if(run===generation)await load(current);
  }catch(error){if(run===generation){const message=text('p',error.message+' Refresh the original ticket before retrying; no automatic duplicate start is attempted.');button.after(message);}}finally{if(button.isConnected)button.disabled=false;}
 }
 return {load,clear};
}
const api={metrics,mount};if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsLifecycle=api;
})(typeof window==='object'?window:globalThis);
