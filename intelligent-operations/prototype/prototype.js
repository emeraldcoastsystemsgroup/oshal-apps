/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Local-only synthetic journey; revisions invalidate demo approvals and bundle downloads carry explicit provenance. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const pages=['incidents','estate','data','sources','connections','sync','approvals','delivery'];
  let revision=1,timeout=60,approval=null,digestGeneration=0;
  function route(){
    if(location.hash==='#main')return;
    $('global-status').textContent='';
    const page=pages.includes(location.hash.slice(1))?location.hash.slice(1):'incidents';
    for(const id of pages)$(id).hidden=id!==page;
    for(const link of document.querySelectorAll('nav a')){if(link.hash==='#'+page)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  }
  function manifest(){return {prototype:true,synthetic:true,intent:'observe-readiness-only',revision,target:{context:'kind-operations-lab',namespace:'operations-demo',resource:'deployment/api'},principal:'example:operations-lab-observer',command:`kubectl --context kind-operations-lab -n operations-demo rollout status deployment/api --timeout=${timeout}s`,executionRequested:false};}
  async function bundle(){
    const generation=++digestGeneration;
    $('revision').textContent=String(revision);$('script').textContent=manifest().command;
    $('digest').textContent='Calculating…';
    try{const bytes=new TextEncoder().encode(JSON.stringify(manifest(),null,2));const hash=await crypto.subtle.digest('SHA-256',bytes);if(generation===digestGeneration)$('digest').textContent=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');}
    catch{if(generation===digestGeneration)$('digest').textContent='Digest unavailable in this browser context.';}
  }
  function authority(){
    const viewer=$('role').value==='viewer';
    if(approval&&approval.expires<=Date.now()){approval=null;$('approval-message').textContent='Demo approval expired. Review this revision again.';}
    $('approve').disabled=viewer||!$('ack').checked||Boolean(approval);
    $('approval-state').textContent=approval?'Approved locally · demo only':'Awaiting review · demo';
    if(viewer)$('approval-message').textContent='Viewer sessions cannot approve work. Server authorization is still required in the real application.';
  }
  $('approve').addEventListener('click',()=>{
    if($('role').value!=='reviewer'||!$('ack').checked||approval)return;
    approval={revision,expires:Date.now()+600000};authority();$('approval-message').textContent=`Revision ${revision} recorded in local demo state for 10 minutes. Nothing was sent to OSHAL.`;
  });
  $('ack').addEventListener('change',authority);$('role').addEventListener('change',()=>{authority();if($('role').value==='reviewer')$('approval-message').textContent=approval?'This revision has a local demo approval.':'Review the bundle and acknowledge its scope.';});
  $('revise').addEventListener('click',()=>{
    revision++;timeout=timeout===60?90:60;approval=null;$('ack').checked=false;
    $('revise').textContent=`Change timeout to ${timeout===60?90:60} seconds`;bundle();authority();
    $('approval-message').textContent='Bundle changed. Previous demo approval is invalid; review the new revision.';
  });
  $('inbound-adapter').addEventListener('change',()=>{$('source-profile').selectedIndex=$('inbound-adapter').value==='otel'?1:0;$('mapping-result').textContent='Inbound adapter selection changed. No source or connection was saved.';});
  $('source-form').addEventListener('submit',event=>{
    event.preventDefault();
    if($('source-profile').selectedIndex===1){$('mapping-result').textContent='OTLP is planned; no mapping or ingestion is available in this prototype.';return;}
    const messages={one:'Example: one scoped asset match. No source, mapping or credential was saved.',none:'Example: no asset match. Quarantine for identity review; do not create a guessed relationship.',many:'Example: ambiguous identity. Quarantine until the administrator resolves the mapping.'};
    $('mapping-result').textContent=messages[$('mapping-outcome').value];
  });
  $('retry').addEventListener('click',()=>{
    $('packet-state').textContent='Complete for requested collectors · demo';$('packet-state').className='state';
    $('external-state').textContent='Synthetic Splunk excerpt added; source and collection time retained.';$('retry').disabled=true;
    $('global-status').textContent='Enrichment success simulated locally. No external query was sent.';
  });
  const Fixtures=window.OperationsUXFixtures;
  let selectedResource='api',session=null;
  function textNode(tag,text){const element=document.createElement(tag);element.textContent=text;return element;}
  function estate(){
    const scope=$('estate-scope').value,data=Fixtures.estates[scope],later=$('estate-time').value==='current';
    const health=item=>scope==='lab'&&item.id==='api'&&later?'ready':item.health;
    const visible=data.nodes.filter(item=>($('estate-layer').value==='all'||item.layer===$('estate-layer').value)&&($('estate-health').value==='all'||health(item)===$('estate-health').value));
    $('estate-label').textContent=data.label;$('estate-graph').replaceChildren();$('estate-edges').replaceChildren();
    if(!visible.some(item=>item.id===selectedResource))selectedResource=visible[0]?.id;
    for(const item of visible){
      const button=textNode('button',item.name);button.type='button';button.dataset.resource=item.id;button.setAttribute('aria-pressed',String(item.id===selectedResource));
      button.append(textNode('span',item.layer));const state=textNode('small',health(item)==='unknown'?'Telemetry unavailable · unknown health':health(item)==='problem'?'Problem observed · historical fixture':'Ready in selected fixture snapshot');
      if(scope==='lab'&&item.id==='api'){state.id='api-health';state.textContent=later?'Ready · later fixture snapshot':'Errors firing · event time';}
      button.append(state);button.addEventListener('click',()=>{selectedResource=item.id;estate();});$('estate-graph').append(button);
    }
    const names=new Map(visible.map(item=>[item.id,item.name]));
    for(const [from,to,type] of data.edges)if(names.has(from)&&names.has(to))$('estate-edges').append(textNode('li',`${names.get(from)} → ${names.get(to)} · ${type} · ${data.source}`));
    if(!$('estate-edges').children.length)$('estate-edges').append(textNode('li','No relationships with both endpoints visible.'));
    requestAnimationFrame(()=>drawRelationships(data.edges));
    $('estate-empty').hidden=visible.length>0;
    const item=visible.find(item=>item.id===selectedResource);
    $('resource-title').textContent=item?.name||'No resource selected';$('resource-detail').textContent=item?.detail||'Change the filters to inspect a resource.';
    $('resource-identity').textContent=item?`${Fixtures.providers[scope].scope} / fixture-id:${item.id}`:'Unavailable';
    $('resource-source').textContent=item?data.source:'Unavailable';$('freshness').textContent=later?'Historical observation · 17:31 UTC':'Historical observation · 17:29 UTC';
    $('resource-lifecycle').textContent=scope==='lab'?'Instance UIDs tracked separately from workload continuity; replacement history is required.':'Provider-native IDs and relationship validity retained; no live discovery has run.';
  }
  function drawRelationships(edges){
    const graph=$('estate-graph');graph.querySelector('svg')?.remove();
    if($('estate').hidden||!graph.children.length)return;
    const rect=graph.getBoundingClientRect(),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);svg.setAttribute('aria-hidden','true');svg.classList.add('topology-links');
    for(const [from,to] of edges){
      const a=Array.from(graph.children).find(e=>e.dataset.resource===from),b=Array.from(graph.children).find(e=>e.dataset.resource===to);if(!a||!b)continue;
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(),vertical=Math.abs(ar.top-br.top)>2;
      const line=document.createElementNS(ns,'line');
      const coords=vertical?[ar.left+ar.width/2-rect.left,ar.bottom-rect.top,br.left+br.width/2-rect.left,br.top-rect.top]:[ar.right-rect.left,ar.top+ar.height/2-rect.top,br.left-rect.left,br.top+br.height/2-rect.top];
      ['x1','y1','x2','y2'].forEach((key,index)=>line.setAttribute(key,String(coords[index])));svg.append(line);
    }
    graph.prepend(svg);
  }
  new ResizeObserver(()=>{if(!$('estate').hidden)drawRelationships(Fixtures.estates[$('estate-scope').value].edges);}).observe($('estate-graph'));
  window.addEventListener('hashchange',()=>{if(location.hash==='#estate')requestAnimationFrame(()=>drawRelationships(Fixtures.estates[$('estate-scope').value].edges));});
  for(const id of ['estate-scope','estate-layer','estate-health','estate-time'])$(id).addEventListener('change',estate);
  $('preview-scan').addEventListener('click',()=>{
    const interval=Number($('scan-interval').value);
    $('scan-result').textContent=!Number.isInteger(interval)||interval<1||interval>1440?'Choose a whole interval from 1 to 1440 minutes.':`Draft schedule: reconcile every ${interval} minutes. Requires a verified scoped discovery connection; no schedule saved or scan started.`;
  });
  function connectionAccess(){
    if(session&&session.expires<=Date.now()){session=null;$('auth-probe').textContent='Expired';$('observed-identity').textContent='Not verified';$('session-expiry').textContent='Expired';$('inventory-probe').textContent='Not tested';$('evidence-probe').textContent='Not tested';$('connection-result').textContent='Session expired. New probes require a fresh login and identity check.';}
    const admin=$('connection-role').value==='admin',available=$('tool-state').value==='available',verified=Boolean(session?.verified);
    $('demo-login').disabled=!admin||!available;$('probe-identity').disabled=!admin||!available||!session;$('revoke-session').disabled=!admin||!session;
    $('probe-inventory').disabled=!admin||!available||!verified;$('probe-evidence').disabled=!admin||!available||!verified;
    $('connection-state').textContent=verified?'Identity verified · demo':session?'Signed in · scope unverified':'Not authenticated';
  }
  function resetConnection(){
    session=null;const provider=Fixtures.providers[$('connection-provider').value];
    $('connection-title').textContent=provider.name;$('connection-tool').textContent=provider.tool;$('connection-scope').textContent=provider.scope;
    $('login-method').textContent=$('connection-mode').value==='human'?provider.human:provider.workload;$('login-caveat').textContent=provider.detail;
    for(const id of ['auth-probe','inventory-probe','evidence-probe'])$(id).textContent='Not tested';
    $('observed-identity').textContent='Not verified';$('session-expiry').textContent='No active session';
    $('connection-result').textContent=$('tool-state').value==='missing'?'Required tool or adapter is missing on the selected runner. No login or probe can start.':'No identity has been verified. Changing connection settings invalidates previous results.';connectionAccess();
  }
  for(const id of ['connection-provider','connection-mode','tool-state','identity-outcome'])$(id).addEventListener('change',resetConnection);
  $('connection-role').addEventListener('change',()=>{connectionAccess();$('connection-result').textContent=$('connection-role').value==='viewer'?'Viewer sessions cannot initiate connection login, probes or revocation.':'Connection administrator selected. Explicit scoped authorization remains required on the server.';});
  $('demo-login').addEventListener('click',()=>{
    if($('demo-login').disabled)return;
    resetConnection();session={verified:false,expires:Date.now()+1200000};$('session-expiry').textContent=new Date(session.expires).toISOString()+' · local demo';
    $('auth-probe').textContent='Sign-in simulated; identity not tested';$('connection-result').textContent='Secure sign-in simulated locally. Verify the actual principal and target before using tools.';connectionAccess();
  });
  $('probe-identity').addEventListener('click',()=>{
    if($('probe-identity').disabled)return;
    const outcome=$('identity-outcome').value;
    if(outcome!=='valid'){session=null;$('auth-probe').textContent=outcome==='wrong'?'Refused · target scope mismatch':'Refused · expired session';$('session-expiry').textContent='No usable session';$('observed-identity').textContent='Not accepted';$('connection-result').textContent='Identity refused. Inventory and evidence probes remain blocked.';}
    else{session.verified=true;$('auth-probe').textContent='Expected identity and scope · demo at '+new Date().toISOString();$('observed-identity').textContent=Fixtures.providers[$('connection-provider').value].identity;$('connection-result').textContent='Identity matches this connection in the demo. Inventory and evidence permissions are still untested.';}
    connectionAccess();
  });
  $('probe-inventory').addEventListener('click',()=>{if($('probe-inventory').disabled)return;$('inventory-probe').textContent='Allowed · bounded inventory read · demo at '+new Date().toISOString();$('connection-result').textContent='Inventory read simulated. Evidence and infrastructure changes are not granted by this result.';});
  $('probe-evidence').addEventListener('click',()=>{if($('probe-evidence').disabled)return;$('evidence-probe').textContent='Denied · evidence grant absent · demo at '+new Date().toISOString();$('connection-result').textContent='Evidence read denied in this fixture. Authentication and inventory results remain separate.';});
  $('revoke-session').addEventListener('click',()=>{if($('revoke-session').disabled)return;resetConnection();$('connection-result').textContent='Demo session revoked; subsequent probes are blocked. No provider session was changed.';});
  estate();resetConnection();setInterval(connectionAccess,10000);
  let dataRows=[],dataSelected=0,syncPreview=null;
  const heldSync=new Map();
  function inspectData(index){
    dataSelected=index;const row=dataRows[index];
    $('decision-title').textContent=row.receipt+' · '+row.outcome;$('decision-reason').textContent=row.reason;
    $('decision-key').textContent=row.key||'No eligible identity';$('decision-snapshot').textContent=row.snapshot?'Critical fixture signal requests an event-time packet; no collector runs here.':'No snapshot requested by this demo decision.';
    $('decision-input').textContent=row.raw?JSON.stringify({raw:row.raw,normalized:row.normalized||null},null,2):'Payload withheld: outside the authorized demo scope.';
  }
  function dataView(){
    const telemetry=$('data-kind').value==='telemetry';$('alert-data').hidden=telemetry;$('telemetry-data').hidden=!telemetry;
    $('data-severity').disabled=telemetry;$('data-reduce').disabled=telemetry;
    if(telemetry){$('data-summary').textContent='Separate telemetry-store example. No incident or deduplication decision has been run on this signal.';return;}
    const result=window.OperationsDataDemo.inspect($('data-severity').value,$('data-reduce').checked);dataRows=result.rows;
    $('data-summary').textContent=`Synthetic replay: ${result.received} deliveries · ${result.eligible} eligible incidents · ${result.updates} symptom updates · ${result.retries} delivery retries. No investigation or ticket was started.`;
    $('data-rows').replaceChildren();
    for(const [index,row] of dataRows.entries()){
      const tr=document.createElement('tr');
      for(const value of [row.receipt,row.source+(row.raw?' / '+row.raw.id:''),row.outcome,row.incident||'None'])tr.append(textNode('td',value));
      const cell=document.createElement('td'),button=textNode('button','Inspect');button.type='button';button.setAttribute('aria-label','Inspect '+row.receipt);button.addEventListener('click',()=>{inspectData(index);$('decision-title').scrollIntoView({block:'center'});});cell.append(button);tr.append(cell);$('data-rows').append(tr);
    }
    inspectData(Math.min(dataSelected,dataRows.length-1));
  }
  for(const id of ['data-kind','data-severity','data-reduce'])$(id).addEventListener('change',dataView);
  const coverage={servicenow:'Read-only incident/change/CMDB resources. Write and two-way sync operations require shared connector extensions.',github:'Issue search, confirmed issue creation, comments and issue webhook declarations. Complete status sync still needs shared operations.',gitlab:'Issue read and create resources. Shared write confirmation and complete update/webhook sync need verification or extension.',jira:'Issue read, create and comment resources. Complete transition/webhook sync needs shared operations and acceptance.'};
  function syncGate(){
    $('send-sync').disabled=!syncPreview||!$('sync-ack').checked||$('sync-role').value!=='editor'||heldSync.has(syncPreview.operationKey);
    $('reconcile-sync').hidden=!syncPreview||heldSync.get(syncPreview.operationKey)!=='uncertain';
    $('reconcile-sync').disabled=$('sync-role').value!=='editor';
  }
  function resetSync(){
    syncPreview=null;$('sync-ack').checked=false;$('sync-preview').textContent='No change previewed.';
    $('sync-connection').textContent=`OSHAL current-caller / ${$('sync-provider').value} / example-account`;
    $('sync-capabilities').textContent=coverage[$('sync-provider').value];$('sync-result').textContent='No external operation requested. A changed policy or connection requires a fresh preview and confirmation.';syncGate();
  }
  for(const id of ['sync-provider','sync-direction','sync-outcome'])$(id).addEventListener('change',resetSync);
  for(const id of ['sync-role','sync-ack'])$(id).addEventListener('change',syncGate);
  $('preview-sync').addEventListener('click',()=>{
    const provider=$('sync-provider').value;
    syncPreview={synthetic:true,canonicalTicket:'OPS-0042',actor:'OSHAL current-caller (demo)',connection:`${provider}/example-account`,direction:$('sync-direction').value,operation:'create-or-link',revision:1,origin:'oshal-operations-demo',fields:{summary:'API errors',evidence:'Authorized evidence links only'},operationKey:JSON.stringify(['demo-user',provider,'example-account','OPS-0042','create-or-link',1])};
    $('sync-preview').textContent=JSON.stringify(syncPreview,null,2);$('sync-ack').checked=false;
    $('sync-result').textContent=heldSync.has(syncPreview.operationKey)?'This operation needs reconciliation or conflict review before another send.':'Preview created locally. Real writes must pass the standard OSHAL confirmation and connector capability checks.';syncGate();
  });
  $('send-sync').addEventListener('click',()=>{
    syncGate();if($('send-sync').disabled)return;
    const outcome=$('sync-outcome').value;
    const messages={success:'Demo synchronized: linked external record example-314. No external record was created.',expired:'Paused: the user’s OSHAL connection expired. Reconnect through the standard framework before resuming.',denied:'Refused: provider write grant is missing. Signing in does not supply this permission.',conflict:'Conflict: external revision changed. Review field ownership; no remote status was overwritten.',uncertain:'Create outcome unknown. Reconcile by operation identity/external record before any retry; do not create another ticket blindly.'};
    $('sync-result').textContent=messages[outcome];
    if(['uncertain','conflict','success'].includes(outcome))heldSync.set(syncPreview.operationKey,outcome);
    $('sync-ack').checked=false;syncGate();
  });
  $('reconcile-sync').addEventListener('click',()=>{
    if(!syncPreview||$('sync-role').value!=='editor'||heldSync.get(syncPreview.operationKey)!=='uncertain')return;
    heldSync.set(syncPreview.operationKey,'success');$('sync-result').textContent='Demo reconciliation found external record example-314 for the same operation. Link retained; a second create is blocked.';syncGate();
  });
  dataView();resetSync();
  $('download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(manifest(),null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`operations-demo-revision-${revision}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('global-status').textContent='Demo manifest downloaded. No execution was requested.';});
  $('reset').addEventListener('click',()=>location.reload());
  window.addEventListener('hashchange',route);route();bundle();authority();setInterval(authority,10000);
})();
