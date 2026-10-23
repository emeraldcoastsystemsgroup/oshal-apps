/* CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Pass the plan's cluster to Git promotion so its linked repository is preselected. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Offer Git promotion on every plan: standard path (branch, request, pipeline) and break-glass reconciliation after an execution. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Response stage UI: preview the generated response files of an accepted answer, bind a plan to one observed pod, approve the exact artifacts, reserve before each confirmed native exec through the person's own Kubernetes connection, report action/verification receipts, and update the canonical ticket only after a measured recovery outcome; every refusal clears private plan state. */
(function(root){'use strict';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const Artifacts=root.OperationsResponseArtifacts||(typeof require==='function'?require('../ui/response-artifacts.js'):null);
/** @description Pick the latest completed phase with a released answer, preferring the final revise phase the workflow accepted. */
function acceptedWork(work){const rows=(Array.isArray(work)?work:[]).filter(w=>w.state==='completed'&&typeof w.answer==='string'&&w.answer.trim()&&!w.resultUnavailable);return rows.sort((a,b)=>(b.phase?.index??-1)-(a.phase?.index??-1))[0]||null;}
/** @description Only pods the caller's own recorded inventory observed can be targets; the UID is the identity, the name is a label. */
function podTargets(graph){return ((graph&&graph.assets)||[]).filter(a=>a.provider==='kubernetes'&&a.kind==='pod'&&a.nativeId&&a.name).map(a=>({uid:a.nativeId,pod:a.name,namespace:a.properties?.namespace||'',health:a.health,label:a.name+' · '+(a.properties?.namespace||'namespace unknown')+' · '+a.nativeId.slice(0,12)}));}
function mount({request,onRefused}){
 const $=id=>document.getElementById(id),panel=$('response-panel');if(!panel)return {load(){},clear(){}};
 let generation=0,model=null,work=[],targets=[],connections=[],services=[];
 function clear(){generation++;model=null;work=[];targets=[];connections=[];for(const id of ['response-ticket','response-work','response-target','response-account'])$(id).replaceChildren();$('response-plans').replaceChildren();$('response-review').replaceChildren();$('response-preview').textContent='';$('response-status').textContent='Refresh to read your response plans and accepted workflow output.';$('response-prepare').disabled=true;panel.setAttribute('aria-busy','false');}
 async function native(path,body,confirm){const headers={Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(confirm?{'x-oshal-confirm':confirm}:{})};const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok){if([401,403].includes(r.status)){clear();onRefused();}const detail=await r.json().catch(()=>({}));throw Error(detail.detail||detail.error||'Shared service unavailable (HTTP '+r.status+').');}return r.json();}
 async function confirmed(path,body){const proof=await native('/confirmations',{});return native(path,body,proof.confirmation);}
 async function action(operation,input,account){if(typeof account!=='string'||!account)throw Error('Select your Kubernetes connection account.');const proof=await native('/confirmations',{});const r=await fetch('/connectors/kubernetes/actions/'+encodeURIComponent(operation)+'?account='+encodeURIComponent(account),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','x-oshal-confirm':proof.confirmation},body:JSON.stringify(input)});const value=await r.json().catch(()=>({}));if(!r.ok){if([401,403].includes(r.status)){clear();onRefused();}throw Error(value.detail||'Kubernetes operation refused (HTTP '+r.status+').');}if(value.transport!=='native_kubernetes')throw Error('The native Kubernetes acknowledgement is unavailable.');return value;}
 function usableAccount(account){return connections.some(c=>c.connector==='kubernetes'&&c.account===account&&!c.shared&&['connected','expiring'].includes(c.status));}
 async function load(){
  const run=++generation;panel.setAttribute('aria-busy','true');$('response-plans').replaceChildren();$('response-review').replaceChildren();$('response-prepare').disabled=true;
  try{const [records,tickets,standing,graph]=await Promise.all([request('/executions'),native('/api/tickets'),native('/connectors'),request('/topology')]);if(run!==generation)return;services=standing.httpServices||[];
   if(!Array.isArray(records.items)||records.items.length>20||!Array.isArray(tickets.tickets))throw Error('Owned response records are unavailable.');
   model=records;connections=standing.connections||[];targets=podTargets(graph);
   const picker=$('response-ticket'),old=picker.value;picker.replaceChildren();for(const t of tickets.tickets.filter(t=>(t.kind||t.ticketType)==='intelligent-operations'&&['awaiting_approval','done'].includes(t.status))){const o=text('option',(t.id||t.ticketId)+' · '+t.status+' · revision '+String(t.revision));o.value=t.id||t.ticketId;picker.append(o);}if([...picker.options].some(o=>o.value===old))picker.value=old;
   const targetPicker=$('response-target'),oldTarget=targetPicker.value;targetPicker.replaceChildren();for(const t of targets){const o=text('option',t.label);o.value=t.uid;targetPicker.append(o);}if(targets.some(t=>t.uid===oldTarget))targetPicker.value=oldTarget;
   const accounts=$('response-account');accounts.replaceChildren();for(const c of connections.filter(c=>c.connector==='kubernetes'&&!c.shared&&['connected','expiring'].includes(c.status))){const o=text('option',String(c.account)+' · '+c.status);o.value=c.account;accounts.append(o);}
   render();await loadWork();if(run!==generation)return;
   $('response-status').textContent='Plans bind exact generated files to one observed pod. Each exec needs your fresh confirmation through your own Kubernetes connection; command results are your report, the resolved signal and ticket state are read by the server.';return run;
  }catch(error){if(run===generation)$('response-status').textContent=error.message;}finally{if(run===generation)panel.setAttribute('aria-busy','false');}
 }
 async function loadWork(){
  const run=generation,ticket=$('response-ticket').value,picker=$('response-work');picker.replaceChildren();work=[];$('response-preview').textContent='';$('response-prepare').disabled=true;if(!ticket)return;
  try{const result=await native('/tickets/'+encodeURIComponent(ticket)+'/work');if(run!==generation)return;work=Array.isArray(result.work)?result.work:[];const accepted=acceptedWork(work);
   for(const w of work.filter(w=>w.state==='completed'&&typeof w.answer==='string'&&w.answer.trim())){const o=text('option',(w.phase?.name||'phase')+' · '+String(w.id).slice(0,12));o.value=w.id;picker.append(o);}if(accepted)picker.value=accepted.id;preview();
  }catch(error){if(run===generation)$('response-preview').textContent=error.message;}
 }
 function preview(){const w=work.find(w=>w.id===$('response-work').value);if(!w||!Artifacts){$('response-preview').textContent='Select a completed phase with a released answer.';$('response-prepare').disabled=true;return;}const extracted=Artifacts.extract(w.answer,null);$('response-preview').textContent=extracted.executable?'Generated response files: '+extracted.artifacts.map(a=>a.name+' ('+a.bytes+' B)').join(', ')+'. Review their exact bytes after preparing the plan.':'No complete generated response file set in this answer: '+[...extracted.missing.map(m=>'missing '+m),...extracted.problems].join('; ')+'. Nothing can be executed from it.';$('response-prepare').disabled=!extracted.executable||!$('response-target').value||!$('response-container').value.trim();}
 function render(){
  const list=$('response-plans');list.replaceChildren();
  for(const p of model.items){
   const card=text('article','','card'),approval=p.approval,execution=p.executions[0]||null;card.dataset.planId=p.id;
   card.append(text('h4','Plan '+p.id.slice(0,12)+' · ticket '+p.ticketId.slice(0,8)+' · '+p.phase),text('p',p.sourceLabel+'. Target '+p.target.pod+' / '+p.target.container+' in '+p.target.namespace+' (UID '+p.target.uid+').'),text('p',p.ticketUnavailable?'Canonical ticket unavailable.':'Canonical ticket '+p.ticket.status+' · revision '+p.ticket.revision+(p.invalidated?' · CHANGED since this plan; approval and dispatch are refused.':'')));
   const files=text('ul','','response-files');for(const d of p.downloads){const li=text('li'),a=text('a',d.name+' · '+d.bytes+' B · sha256 '+d.sha256.slice(0,12));a.href='/api/intelligent-operations'+d.path;a.setAttribute('download',d.name);li.append(a);files.append(li);}card.append(files);
   card.append(text('p',approval?(approval.expired?'Approval expired '+approval.expiresAt:'Approved by you until '+approval.expiresAt+' for exactly these digests and target.'):'Not approved. Review the files and the target before approving.'));
   const approve=text('button','Approve this exact action');approve.type='button';approve.disabled=Boolean(approval&&!approval.expired)||Boolean(p.invalidated)||p.ticketUnavailable;approve.addEventListener('click',()=>act(approve,async()=>{await request('/executions/approve',{planId:p.id});}));
   const execute=text('button','Execute approved action');execute.type='button';execute.disabled=!approval||approval.expired||Boolean(execution)||Boolean(p.invalidated);execute.addEventListener('click',()=>act(execute,()=>dispatch(p,approval)));
   const verify=text('button','Verify recovery');verify.type='button';verify.disabled=!execution||execution.state==='reserved-outcome-unknown'||execution.verifications.some(v=>v.state==='reserved-outcome-unknown');verify.addEventListener('click',()=>act(verify,()=>verifyRecovery(p,execution)));
   const close=text('button','Accept report and update ticket');close.type='button';close.disabled=!execution||execution.recovery.outcome!=='healthy'||p.ticket?.status!=='awaiting_approval';close.addEventListener('click',()=>act(close,()=>updateTicket(p,execution)));
   const controls=text('div','','processing-actions');controls.append(approve,execute,verify,close);card.append(controls);
   root.OperationsGitPromotion?.attach(card,p,{request,onRefused:()=>{clear();onRefused();},connections,services,promotions:p.promotions||[],executed:Boolean(execution&&execution.state!=='reserved-outcome-unknown'),reload:load,scope:p.alert?.resource?.scope||null});
   if(execution){const e=execution,state=text('div','','response-execution');state.append(text('p','Dispatch '+e.id.slice(0,12)+' · '+e.state+(e.action?' · exit '+String(e.action.exitCode)+' · '+e.action.outcome+' (your report)':' · reserved, outcome unknown')),text('p','Recovery: '+e.recovery.outcome+(e.recovery.reason?' — '+e.recovery.reason:'')),text('p',e.ticketUpdate?'Ticket after update: '+e.ticketUpdate.status+' · revision '+e.ticketUpdate.revision+' (server-read)':'Canonical ticket not yet updated from this execution.'));const receipt=text('a','Download execution receipt');receipt.href='/api/intelligent-operations/executions/'+e.id+'/receipt.json';receipt.setAttribute('download','execution-'+e.id.slice(0,12)+'.json');state.append(receipt);for(const v of e.verifications.slice(-3))state.append(text('small','Verification '+(v.index+1)+': '+v.state+(v.outcome?' · '+v.outcome+' · signal '+(v.signal?.resolved?'resolved':'not resolved'):'')));card.append(state);}
   list.append(card);
  }
  if(model.truncated)list.append(text('p','Only the latest 20 plans are shown.'));
 }
 async function act(button,fn){const run=generation;button.disabled=true;let message=null;try{message=await fn();}catch(error){if(run===generation)$('response-status').textContent=error.message+' No automatic retry was made.';}if(run!==generation)return;const refreshed=await load();if(refreshed===run+1&&message)$('response-review').replaceChildren(text('p',message));}
 async function dispatch(p,approval){
  const account=$('response-account').value;if(!usableAccount(account))throw Error('Your Kubernetes connection account is not usable. Reconnect it in Connections.');
  const execution=await request('/executions/reserve',{approvalId:approval.id,account});
  let result;try{const current=await action('kubernetes-inspect-pod',execution.readback.input,account);if(current.pod?.uid!==p.target.uid)result={outcome:'failed',exitCode:null,stderr:'Pre-dispatch identity check returned a different pod; nothing was executed.',target:{observedUid:current.pod?.uid||null}};else result=await action('kubernetes-exec',execution.dispatch.input,account);}
  catch(error){result={outcome:'unknown',exitCode:null,stderr:'Native dispatch outcome unavailable: '+error.message};}
  const reported=await request('/executions/report',{executionId:execution.id,result});return 'Dispatch reported as '+reported.state+'. Verify recovery before any ticket update; command exit alone is not recovery.';
 }
 async function verifyRecovery(p,execution){
  const account=execution.dispatch.account;if(!usableAccount(account))throw Error('Your Kubernetes connection account is not usable. Reconnect it in Connections.');
  const verification=await request('/executions/verify',{executionId:execution.id});let result,readback=null;
  try{result=await action('kubernetes-exec',verification.dispatch.input,account);readback=await action('kubernetes-inspect-pod',verification.readback.input,account);}catch(error){result=result||{outcome:'unknown',exitCode:null,stderr:'Verification outcome unavailable: '+error.message};}
  const reported=await request('/executions/verify/report',{executionId:execution.id,verificationId:verification.id,result,readback});return 'Recovery outcome: '+reported.recovery.outcome+' — '+reported.recovery.reason;
 }
 async function updateTicket(p,execution){
  const approved=await confirmed('/tickets/'+encodeURIComponent(p.ticketId)+'/approve',{});const updated=await request('/executions/ticket-update',{executionId:execution.id});return 'Canonical ticket '+(approved.ticket?.status||updated.ticketUpdate.status)+' at revision '+updated.ticketUpdate.revision+'; the server re-read it through the ticket port.';
 }
 $('response-refresh').addEventListener('click',load);$('response-ticket').addEventListener('change',loadWork);$('response-work').addEventListener('change',preview);$('response-target').addEventListener('change',preview);$('response-container').addEventListener('input',preview);
 $('response-form').addEventListener('submit',async e=>{e.preventDefault();const run=generation,w=work.find(w=>w.id===$('response-work').value),t=targets.find(t=>t.uid===$('response-target').value);if(!w||!t)return;$('response-prepare').disabled=true;try{await request('/executions/plans',{ticketId:$('response-ticket').value,workId:w.id,phase:w.phase?.name||'unknown',answer:w.answer,target:{namespace:t.namespace,pod:t.pod,uid:t.uid,container:$('response-container').value.trim()}});if(run===generation)await load();}catch(error){if(run===generation){$('response-status').textContent=error.message;$('response-prepare').disabled=false;}}});
 clear();return {load,clear};
}
const api={mount,acceptedWork,podTargets};if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsResponse=api;
})(typeof window==='object'?window:globalThis);
