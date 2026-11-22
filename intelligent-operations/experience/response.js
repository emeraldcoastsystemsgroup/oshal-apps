/* CHANGE LOG: 6 | maintainer@emeraldcoastsystemsgroup.com | 1.9.7 (R21): add collapsible Manifest & diff review section on each response plan card with file manifest table (filename, SHA-256 prefix + full copyable digest, byte size, byte range, server-verified provenance badge, authenticated download link), explicit non-authorization notice, and plan-to-plan unified diff comparison using authenticated artifact GETs, generation guards, 401/403 refusal clearing, and strict textContent rendering. */
/* CHANGE LOG: refused dispatch | maintainer@emeraldcoastsystemsgroup.com | A Kubernetes call the kernel refuses (an expired or withdrawn connection) is a connection problem, not a lost sign-in: the panel stays, the dispatch is reported refused (nothing ran), the withdrawn approval says why, and Approve is offered again. Only a refused identity clears the panel. */
/* CHANGE LOG: readable plan state | maintainer@emeraldcoastsystemsgroup.com | Approval times in the viewer's local time; each verification is its own list item instead of run-together text. */
/* CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Pass the plan's cluster to Git promotion so its linked repository is preselected. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Offer Git promotion on every plan: standard path (branch, request, pipeline) and break-glass reconciliation after an execution. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Response stage UI: preview the generated response files of an accepted answer, bind a plan to one observed pod, approve the exact artifacts, reserve before each confirmed native exec through the person's own Kubernetes connection, report action/verification receipts, and update the canonical ticket only after a measured recovery outcome; every refusal clears private plan state. */
(function(root){'use strict';
const when=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString();};
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const Artifacts=root.OperationsResponseArtifacts||(typeof require==='function'?require('../ui/response-artifacts.js'):null);
const Manifest=root.OperationsResponseManifest||Artifacts||(typeof require==='function'?require('../ui/response-manifest.js'):null);
/** @description Pick the latest completed phase with a released answer, preferring the final revise phase the workflow accepted. */
function acceptedWork(work){const rows=(Array.isArray(work)?work:[]).filter(w=>w.state==='completed'&&typeof w.answer==='string'&&w.answer.trim()&&!w.resultUnavailable);return rows.sort((a,b)=>(b.phase?.index??-1)-(a.phase?.index??-1))[0]||null;}
/** @description Only pods the caller's own recorded inventory observed can be targets; the UID is the identity, the name is a label. */
function podTargets(graph){return ((graph&&graph.assets)||[]).filter(a=>a.provider==='kubernetes'&&a.kind==='pod'&&a.nativeId&&a.name).map(a=>({uid:a.nativeId,pod:a.name,namespace:a.properties?.namespace||'',health:a.health,label:a.name+' · '+(a.properties?.namespace||'namespace unknown')+' · '+a.nativeId.slice(0,12)}));}
const SESSION_REFUSALS=['no_identity','person_not_active','issuer_not_trusted','tenant_mismatch'];

/** @description Render plan-level manifest metadata and provenance badge using textContent only. */
function renderManifestMeta(manifest){
 const meta=text('dl','','response-manifest-meta');
 const pair=(label,value,title)=>{
  const dt=text('dt',label),dd=text('dd',value);
  if(title)dd.title=title;
  meta.append(dt,dd);
 };
 pair('Bundle SHA-256',manifest.bundleDigest.slice(0,16)+'…',manifest.bundleDigest);
 pair('Ticket',String(manifest.ticketId||'—')+' · rev '+String(manifest.ticketRevision??'—'));
 pair('Work / Phase',String(manifest.workId||'—').slice(0,12)+' · '+String(manifest.phase||'—'));
 pair('Target pod',String(manifest.target.pod||'—')+' / '+String(manifest.target.container||'—')+' ('+String(manifest.target.namespace||'—')+')',String(manifest.target.uid||''));
 const badgeDt=text('dt','Provenance'),badgeDd=text('dd');
 badgeDd.append(text('span',manifest.answerVerifiedByServer?'Server-verified accepted work':'Unverified legacy plan','response-provenance-badge '+(manifest.answerVerifiedByServer?'verified':'legacy')));
 meta.append(badgeDt,badgeDd);
 return meta;
}

/** @description Render the file manifest table with copyable full SHA-256 digest and authenticated download links. */
function renderManifestTable(manifest){
 const wrap=text('div','','ops-table-wrap'),table=text('table','','ops-table response-manifest-table');
 const thead=text('thead'),headRow=text('tr');
 for(const h of ['File','SHA-256','Bytes','Range','Provenance','Download'])headRow.append(text('th',h));
 thead.append(headRow);
 const tbody=text('tbody');
 for(const f of manifest.files){
  const tr=text('tr');tr.dataset.manifestFile=f.name;
  tr.append(text('td',f.name,'response-manifest-name'));
  const shaTd=text('td','','response-manifest-sha');
  const code=text('code',f.sha256?f.sha256.slice(0,12):'—','response-digest');
  if(f.sha256){code.title=f.sha256;code.dataset.sha256=f.sha256;}
  shaTd.append(code);
  if(f.sha256){
   const copy=text('button','Copy','response-copy-sha');copy.type='button';copy.setAttribute('aria-label','Copy full SHA-256 for '+f.name);
   copy.addEventListener('click',()=>{navigator.clipboard?.writeText(f.sha256).catch(()=>{});copy.textContent='Copied';setTimeout(()=>{copy.textContent='Copy';},1200);});
   shaTd.append(copy);
  }
  tr.append(shaTd);
  tr.append(text('td',f.bytes===null?'—':String(f.bytes)+' B','num'));
  tr.append(text('td',f.range?String(f.range.start)+'..'+String(f.range.end):'—','num'));
  const prov=(manifest.answerVerifiedByServer?'Verified':'Legacy')+' · '+String(f.provenance.phase||'—')+' · '+String(f.provenance.workId||'—').slice(0,8);
  tr.append(text('td',prov));
  const dlTd=text('td');
  if(f.downloadUrl){const a=text('a','Download');a.href=f.downloadUrl;a.setAttribute('download',f.name);dlTd.append(a);}
  else dlTd.textContent='—';
  tr.append(dlTd);tbody.append(tr);
 }
 table.append(thead,tbody);wrap.append(table);return wrap;
}

/** @description Render one file's status pill and unified diff hunks strictly through textContent. */
function renderDiffFile(entry){
 const box=text('div','','response-diff-file');box.dataset.diffFile=entry.name;box.dataset.diffStatus=entry.status;
 const head=text('div','','response-diff-head');
 head.append(text('strong',entry.name),text('span',entry.status,'response-diff-pill status-'+entry.status));
 if(entry.diff&&entry.diff.changed)head.append(text('span','+'+entry.diff.added+' / -'+entry.diff.removed,'response-diff-counts num'));
 box.append(head);
 if(entry.status==='unchanged'){
  box.append(text('p','Identical SHA-256 digest ('+String(entry.target?.sha256||'—').slice(0,12)+') — no changes.','observation-note'));
  return box;
 }
 if(!entry.diff){box.append(text('p','File bytes were not loaded for diff rendering.','observation-note'));return box;}
 if(entry.diff.truncationNotice)box.append(text('p',entry.diff.truncationNotice,'observation-note'));
 const view=text('div','','response-diff-view');view.setAttribute('role','region');view.setAttribute('aria-label','Unified diff for '+entry.name);
 const pre=text('pre','','response-diff-code');
 pre.append(text('span','--- '+entry.diff.oldLabel,'diff-line diff-meta'),text('span','+++ '+entry.diff.newLabel,'diff-line diff-meta'));
 for(const hunk of entry.diff.hunks){
  pre.append(text('span',hunk.header,'diff-line diff-hunk'));
  for(const line of hunk.lines)pre.append(text('span',line.prefix+line.text,'diff-line diff-'+line.type));
 }
 view.append(pre);box.append(view);return box;
}

/** @description Render the complete comparison summary and per-file unified diffs. */
function renderComparison(comparison){
 const wrap=text('div','','response-diff-results');
 const s=comparison.summary;
 wrap.append(text('p','Comparing base plan '+String(comparison.basePlanId||'').slice(0,12)+' → plan '+String(comparison.targetPlanId||'').slice(0,12)+': '+s.modified+' modified, '+s.unchanged+' unchanged, '+s.added+' added, '+s.removed+' removed.','response-diff-summary'));
 for(const entry of comparison.files)wrap.append(renderDiffFile(entry));
 return wrap;
}

/** @description Pick sibling plans for the same ticket, defaulting to the immediately preceding plan. */
function peerPlansFor(plan,allPlans){
 const same=(Array.isArray(allPlans)?allPlans:[]).filter(item=>item.ticketId===plan.ticketId);
 const pos=same.findIndex(item=>item.id===plan.id);
 const peers=same.filter(item=>item.id!==plan.id);
 const defaultPeer=pos>=0&&same[pos+1]?same[pos+1]:(peers[0]||null);
 return {peers,defaultPeer};
}

/** @description Attach the collapsible Manifest & diff review panel to a response plan card without triggering approvals or execution. */
function attachManifestView(card,plan,allPlans,{fetchArtifactText,getGeneration}){
 if(!Manifest||typeof Manifest.buildManifest!=='function')return;
 const manifest=Manifest.buildManifest(plan);
 const details=text('details','','response-manifest');details.dataset.manifestPlanId=plan.id;
 details.append(text('summary','Manifest & diff'));
 const notice=text('p',manifest.authorizationNotice,'response-auth-notice');notice.setAttribute('role','note');
 details.append(notice,renderManifestMeta(manifest),renderManifestTable(manifest));
 const {peers,defaultPeer}=peerPlansFor(plan,allPlans);
 if(!peers.length){
  details.append(text('p','Prepare another response plan for this ticket to compare manifests and unified diffs.','observation-note'));
  card.append(details);return;
 }
 const controls=text('div','','response-diff-controls');
 const label=text('label','Compare with plan');
 const select=text('select','','response-compare-select');
 for(const peer of peers){
  const opt=text('option','Plan '+peer.id.slice(0,12)+' · '+peer.phase+' · rev '+String(peer.ticketRevision)+' · '+when(peer.createdAt));
  opt.value=peer.id;select.append(opt);
 }
 if(defaultPeer)select.value=defaultPeer.id;
 label.append(select);
 const show=text('button','Show diff','response-show-diff');show.type='button';
 const status=text('p','Select a plan and choose Show diff to load authenticated file bytes and compute a unified diff.','observation-note response-diff-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const output=text('div','','response-diff-output');
 controls.append(label,show);details.append(controls,status,output);card.append(details);
 let diffGeneration=0;
 select.addEventListener('change',()=>{diffGeneration++;show.disabled=false;output.replaceChildren();status.textContent='Selection changed. Choose Show diff to compare against the selected plan.';});
 show.addEventListener('click',async()=>{
  const basePlan=peers.find(item=>item.id===select.value);if(!basePlan)return;
  const panelRun=getGeneration(),localRun=++diffGeneration;
  show.disabled=true;status.textContent='Loading authenticated response files for diff…';output.replaceChildren();
  try{
   const baseManifest=Manifest.buildManifest(basePlan);
   const tasks=[];
   for(const f of baseManifest.files)if(f.downloadPath)tasks.push(fetchArtifactText(f.downloadPath).then(body=>({planId:basePlan.id,name:f.name,body})));
   for(const f of manifest.files)if(f.downloadPath)tasks.push(fetchArtifactText(f.downloadPath).then(body=>({planId:plan.id,name:f.name,body})));
   const loaded=await Promise.all(tasks);
   if(panelRun!==getGeneration()||localRun!==diffGeneration)return;
   const contentByPlan={[basePlan.id]:{},[plan.id]:{}};
   for(const item of loaded)contentByPlan[item.planId][item.name]=item.body;
   const compared=Manifest.comparePlans(basePlan,plan,contentByPlan);
   output.replaceChildren(renderComparison(compared));
   status.textContent='Loaded diff for plan '+plan.id.slice(0,12)+' against '+basePlan.id.slice(0,12)+'. Viewing diffs does not authorize execution.';
  }catch(error){
   if(panelRun===getGeneration()&&localRun===diffGeneration){output.replaceChildren();status.textContent=error.message;}
  }finally{if(panelRun===getGeneration()&&localRun===diffGeneration)show.disabled=false;}
 });
}

function mount({request,onRefused}){
 const $=id=>document.getElementById(id),panel=$('response-panel');if(!panel)return {load(){},clear(){}};
 let generation=0,model=null,work=[],targets=[],connections=[],services=[];
 function clear(){generation++;model=null;work=[];targets=[];connections=[];for(const id of ['response-ticket','response-work','response-target','response-account'])$(id).replaceChildren();$('response-plans').replaceChildren();$('response-review').replaceChildren();$('response-preview').textContent='';$('response-status').textContent='Refresh to read your response plans and accepted workflow output.';$('response-prepare').disabled=true;panel.setAttribute('aria-busy','false');}
 async function native(path,body,confirm){const headers={Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(confirm?{'x-oshal-confirm':confirm}:{})};const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok){if([401,403].includes(r.status)){clear();onRefused();}const detail=await r.json().catch(()=>({}));throw Error(detail.detail||detail.error||'Shared service unavailable (HTTP '+r.status+').');}return r.json();}
 async function fetchArtifactText(downloadPath){if(typeof downloadPath!=='string'||!downloadPath.startsWith('/executions/plans/'))throw Error('Invalid artifact path.');const r=await fetch('/api/intelligent-operations'+downloadPath,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'text/plain, text/markdown, text/x-shellscript, */*'}});if(!r.ok){if([401,403].includes(r.status)){clear();onRefused();}throw Error('Response artifact unavailable (HTTP '+r.status+').');}return r.text();}
 async function confirmed(path,body){const proof=await native('/confirmations',{});return native(path,body,proof.confirmation);}
 async function action(operation,input,account){if(typeof account!=='string'||!account)throw Error('Select your Kubernetes connection account.');const proof=await native('/confirmations',{});const r=await fetch('/connectors/kubernetes/actions/'+encodeURIComponent(operation)+'?account='+encodeURIComponent(account),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','x-oshal-confirm':proof.confirmation},body:JSON.stringify(input)});const value=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401||SESSION_REFUSALS.includes(value.refused)){clear();onRefused();}throw Object.assign(Error(value.detail||'Kubernetes operation refused (HTTP '+r.status+').'),{status:r.status,refused:r.status>=400&&r.status<500&&typeof value.refused==='string'?value.refused:null});}if(value.transport!=='native_kubernetes')throw Error('The native Kubernetes acknowledgement is unavailable.');return value;}
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
   const card=text('article','','card'),approval=p.approval,execution=p.executions.find(e=>e.state!=='refused')||null,refusedLast=p.executions[0]?.state==='refused'?p.executions[0]:null,live=approval&&approval.state!=='withdrawn'&&!approval.expired;card.dataset.planId=p.id;
   card.append(text('h4','Plan '+p.id.slice(0,12)+' · ticket '+p.ticketId.slice(0,8)+' · '+p.phase),text('p',p.sourceLabel+'. Target '+p.target.pod+' / '+p.target.container+' in '+p.target.namespace+' (UID '+p.target.uid+').'),text('p',p.ticketUnavailable?'Canonical ticket unavailable.':'Canonical ticket '+p.ticket.status+' · revision '+p.ticket.revision+(p.invalidated?' · CHANGED since this plan; approval and dispatch are refused.':'')));
   card.append(text('p',p.answerVerifiedByServer===true?'Accepted work verified by the kernel · answer sha256 '+p.answerSha256.slice(0,12)+' · receipt '+p.answerReceipt:'Legacy plan has no server-verified answer. Prepare a new plan before approval, execution or Git promotion.'));
   const files=text('ul','','response-files');for(const d of p.downloads){const li=text('li'),a=text('a',d.name+' · '+d.bytes+' B · sha256 '+d.sha256.slice(0,12));a.href='/api/intelligent-operations'+d.path;a.setAttribute('download',d.name);li.append(a);files.append(li);}card.append(files);
   attachManifestView(card,p,model.items,{fetchArtifactText,getGeneration:()=>generation});
   card.append(text('p',approval?(approval.state==='withdrawn'?'Approval withdrawn: '+(approval.withdrawnReason||'the dispatch was refused')+' Nothing ran. Reconnect, then approve again.':approval.expired?'Approval expired '+when(approval.expiresAt):'Approved by you until '+when(approval.expiresAt)+' for exactly these digests and target.'):'Not approved. Review the files and the target before approving.'));
   const approve=text('button','Approve this exact action');approve.type='button';approve.disabled=Boolean(live)||Boolean(p.invalidated)||p.ticketUnavailable||p.answerVerifiedByServer!==true;approve.addEventListener('click',()=>act(approve,async()=>{await request('/executions/approve',{planId:p.id});}));
   const execute=text('button','Execute approved action');execute.type='button';execute.disabled=!live||Boolean(execution)||Boolean(p.invalidated)||p.answerVerifiedByServer!==true;execute.addEventListener('click',()=>act(execute,()=>dispatch(p,approval)));
   const verify=text('button','Verify recovery');verify.type='button';verify.disabled=!execution||execution.state==='reserved-outcome-unknown'||execution.verifications.some(v=>v.state==='reserved-outcome-unknown');verify.addEventListener('click',()=>act(verify,()=>verifyRecovery(p,execution)));
   const close=text('button','Accept report and update ticket');close.type='button';close.disabled=!execution||execution.recovery.outcome!=='healthy'||p.ticket?.status!=='awaiting_approval';close.addEventListener('click',()=>act(close,()=>updateTicket(p,execution)));
   const controls=text('div','','processing-actions');controls.append(approve,execute,verify,close);card.append(controls);
   if(p.answerVerifiedByServer===true)root.OperationsGitPromotion?.attach(card,p,{request,onRefused:()=>{clear();onRefused();},connections,services,promotions:p.promotions||[],executed:Boolean(execution&&execution.state!=='reserved-outcome-unknown'),reload:load,scope:p.alert?.resource?.scope||null});
   if(refusedLast&&!execution)card.append(text('p','Last dispatch '+refusedLast.id.slice(0,12)+' · refused by the kernel before it ran ('+(refusedLast.action?.refused||'refused')+'); nothing was executed.','response-execution'));
   if(execution){const e=execution,state=text('div','','response-execution');state.append(text('p','Dispatch '+e.id.slice(0,12)+' · '+e.state+(e.action?' · exit '+String(e.action.exitCode)+' · '+e.action.outcome+' (your report)':' · reserved, outcome unknown')),text('p','Recovery: '+e.recovery.outcome+(e.recovery.reason?' — '+e.recovery.reason:'')),text('p',e.ticketUpdate?'Ticket after update: '+e.ticketUpdate.status+' · revision '+e.ticketUpdate.revision+' (server-read)':'Canonical ticket not yet updated from this execution.'));const receipt=text('a','Download execution receipt');receipt.href='/api/intelligent-operations/executions/'+e.id+'/receipt.json';receipt.setAttribute('download','execution-'+e.id.slice(0,12)+'.json');state.append(receipt);const checks=text('ul','','response-verifications');for(const v of e.verifications.slice(-3))checks.append(text('li','Verification '+(v.index+1)+': '+v.state+(v.outcome?' · '+v.outcome+' · signal '+(v.signal?.resolved?'resolved':'not resolved'):'')));if(checks.childElementCount)state.append(checks);card.append(state);}
   list.append(card);
  }
  if(model.truncated)list.append(text('p','Only the latest 20 plans are shown.'));
 }
 async function act(button,fn){const run=generation;button.disabled=true;let message=null;try{message=await fn();}catch(error){if(run===generation)$('response-status').textContent=error.message+' No automatic retry was made.';}if(run!==generation)return;const refreshed=await load();if(refreshed===run+1&&message)$('response-review').replaceChildren(text('p',message));}
 async function dispatch(p,approval){
  const account=$('response-account').value;if(!usableAccount(account))throw Error('Your Kubernetes connection account is not usable. Reconnect it in Connections.');
  const execution=await request('/executions/reserve',{approvalId:approval.id,account});
  let result;try{const current=await action('kubernetes-inspect-pod',execution.readback.input,account);if(current.pod?.uid!==p.target.uid)result={outcome:'failed',exitCode:null,stderr:'Pre-dispatch identity check returned a different pod; nothing was executed.',target:{observedUid:current.pod?.uid||null}};else result=await action('kubernetes-exec',execution.dispatch.input,account);}
  catch(error){result=error.refused?{outcome:'refused',refused:error.refused,exitCode:null,stderr:error.message}:{outcome:'unknown',exitCode:null,stderr:'Native dispatch outcome unavailable: '+error.message};}
  const reported=await request('/executions/report',{executionId:execution.id,result});
  if(reported.state==='refused')return 'Nothing ran. The kernel refused the action: '+result.stderr+' This approval is withdrawn. Reconnect your Kubernetes connection in Connections, then approve the plan again.';
  return 'Dispatch reported as '+reported.state+'. Verify recovery before any ticket update; command exit alone is not recovery.';
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
 $('response-form').addEventListener('submit',async e=>{e.preventDefault();const run=generation,w=work.find(w=>w.id===$('response-work').value),t=targets.find(t=>t.uid===$('response-target').value);if(!w||!t)return;$('response-prepare').disabled=true;try{await request('/executions/plans',{ticketId:$('response-ticket').value,workId:w.id,target:{namespace:t.namespace,pod:t.pod,uid:t.uid,container:$('response-container').value.trim()}});if(run===generation)await load();}catch(error){if(run===generation){$('response-status').textContent=error.message;$('response-prepare').disabled=false;}}});
 clear();return {load,clear};
}
const api={mount,acceptedWork,podTargets,peerPlansFor};if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsResponse=api;
})(typeof window==='object'?window:globalThis);
