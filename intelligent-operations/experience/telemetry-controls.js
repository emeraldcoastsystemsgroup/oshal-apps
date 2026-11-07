/** CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | Retained context by stream is one table of stream, resource, samples in the 15-minute bank (with each bank's meter) and last sample (UX audit 2026-11-06). */
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | Replay a sample (UX audit 2026-11-06: its one button failed with HTTP 503 and left its test setup behind). The run is all or nothing: the detection service takes the scenario rules before anything is saved, each step shows in place (Checking the detection service, Creating test source, Configuring telemetry, Publishing rules, Replaying 100 events), and a failure names its step and the fix in an alert after removing the sources and telemetry the run created. Sources an earlier run left behind are offered for removal. It opens as a sheet from Data pipeline. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Explain the rolling context banks and run a labeled datacenter replay through the real authorized pipeline. */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Show every stream as one row of a compact table (window and capacity, each bank's fill with the writing bank marked, last receipt) instead of three large cards per stream. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Batch replay requests and explain actual dependency groups without reusing cloud identities across runs. */
(function(root){'use strict';
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
root.OperationsTelemetry={mount({request,sources,onChanged}){
 const $=id=>document.getElementById(id);let generation=0,replayGeneration=0,streams=[],running=false;
 function clear(){generation++;streams=[];$('telemetry-banks').replaceChildren();$('telemetry-source').replaceChildren();$('telemetry-result').textContent='';$('replay-results').replaceChildren();$('recorded-benchmark').replaceChildren();$('replay-progress').textContent='Your authorized replay results will appear here.';}
 function selected(){return streams.find(s=>s.id===$('telemetry-source').value);}
 function select(){const stream=selected();$('telemetry-config').value=JSON.stringify(stream?.config||{resourceKind:'host',idAttribute:'host.id',scopeAttribute:'site.id',maxBankBytes:2097152,maxBankRecords:2000,retentionSeconds:900},null,2);}
 function render(){const choice=$('telemetry-source').value;$('telemetry-source').replaceChildren(text('option','Select a named source'));$('telemetry-source').firstChild.value='';for(const s of sources()){const o=text('option',s.name+' · '+s.environment);o.value=s.id;$('telemetry-source').append(o);}$('telemetry-source').value=choice;$('telemetry-banks').replaceChildren();
  if(streams.length){const wrap=text('div','');wrap.className='ops-table-wrap';const table=text('table','');table.className='ops-table telemetry-table';const head=text('tr','');for(const h of ['Stream','Resource','Samples in the 15-minute bank','Last sample'])head.append(text('th',h));table.append(head);
   for(const stream of streams){const source=sources().find(s=>s.id===stream.id),row=text('tr',''),name=text('td','');name.append(text('strong',source?.name||stream.source));if(source?.environment)name.append(text('br',''),text('small',source.environment));
    const samples=stream.banks.reduce((n,b)=>n+(b.count||0),0),cell=text('td',''),banks=text('div','');banks.className='bank-cells';cell.append(text('strong',samples+(samples===1?' sample':' samples')),banks);
    row.append(name,text('td',(stream.config.resourceKind||'resource')+' · '+(stream.config.idAttribute||'id')),cell);
    stream.banks.forEach((bank,i)=>{const box=text('div','');box.className='bank-cell'+(i===stream.active?' writing':'');const cap=bank.capacityBytes??stream.config.maxBankBytes;box.append(text('b',bank.count+' / '+(bank.capacityRecords??stream.config.maxBankRecords)));const bar=text('span','');bar.className='bank-bar';const fill=document.createElement('i');fill.style.width=Math.min(100,Math.round(100*bank.bytes/Math.max(1,cap)))+'%';bar.append(fill);bar.setAttribute('role','meter');bar.setAttribute('aria-label','Bank '+(i+1)+(i===stream.active?' (writing)':' (retained)')+': '+Math.round(bank.bytes/1024)+' of '+Math.round(cap/1024)+' KiB');box.append(bar);banks.append(box);});
    const newest=stream.banks.map(b=>b.newest).filter(Boolean).sort().pop();row.append(text('td',newest?new Date(newest).toLocaleString():'—'));table.append(row);}
   wrap.append(table);$('telemetry-banks').append(wrap);}
  if(!streams.length)$('telemetry-banks').append(text('p','No telemetry sources configured. Register a named source, then map its native resource attributes.'));
 }
 async function load(){const current=++generation;try{const result=await request('/telemetry');if(current!==generation)return;streams=result.streams;render();}catch(e){if(current===generation){clear();$('telemetry-result').textContent=e.message;}}}
 async function configure(event){event.preventDefault();const current=generation;try{if(!$('telemetry-source').value)throw Error('Choose a named source first.');await request('/telemetry/configure',{sourceId:$('telemetry-source').value,config:JSON.parse($('telemetry-config').value),expectedRevision:selected()?.revision||0});if(current!==generation)return;await load();$('telemetry-result').textContent='Mapping and bank capacity saved. Send telemetry using this source revision.';}catch(e){if(current===generation)$('telemetry-result').textContent=e.message;}}
 async function evaluation(){const current=generation;try{const r=await request('/evaluation');if(current!==generation)return;const area=$('recorded-benchmark');area.replaceChildren();area.append(text('h3','Recorded host logs · severity baseline'),text('p',r.counts.observations+' sampled BGL lines through actual OpenSearch and symptom reduction. No trained anomaly detector.'),text('strong',(r.precision*100).toFixed(1)+'% precision · '+(r.recall*100).toFixed(1)+'% recall'),text('p',r.counts.falsePositive+' non-alert lines matched; '+r.counts.falseNegative+' labeled alerts missed. '+r.counts.suppressed+' repeated occurrences suppressed. The source labels were withheld from the rules.'));
   const details=text('details','');details.append(text('summary','Dataset provenance, method and limitations'),text('pre',JSON.stringify(r,null,2)));area.append(details);
  }catch(e){if(current===generation)$('recorded-benchmark').textContent=e.message;}}
 function showReplay(record,saved=false){
  const {actual,expected,correlation,packets,graph,environment}=record;
  $('replay-results').replaceChildren();
  const passed=record.passed;
   const flow=text('div','');flow.className='metrics';for(const [label,value]of [['Received',actual.deliveries],['Percolation matches',actual.matched],['Surviving symptoms',actual.survivors],['Correlated groups',actual.groups]]){const card=text('article','');card.className='card';card.append(text('p',label),text('strong',value));flow.append(card);}$('replay-results').append(flow,text('p',actual.filtered+' routine observations filtered; '+actual.suppressed+' repeated symptoms suppressed. These are synthetic scenario results, not a benchmark score.'));
   for(const packet of packets){const details=text('details','');details.append(text('summary',packet.resource.id+' · '+packet.observations.length+' pinned context observations'),text('pre',JSON.stringify(packet,null,2)));$('replay-results').append(details);}
   const details=text('details','');details.append(text('summary','Correlation paths and exact replay receipt'),text('pre',JSON.stringify({environment:environment,expected:expected,actual,correlation},null,2)));$('replay-results').append(details);
   const groups=text('div','');groups.className='replay-groups';
   for(let i=0;i<correlation.groups.length;i++){
    const group=correlation.groups[i],assetIds=[...new Set(correlation.events.filter(e=>group.includes(e.id)).map(e=>e.assetId))],assets=assetIds.map(id=>graph.assets.find(a=>a.id===id)).filter(Boolean);
    const card=text('article','');card.className='card';card.append(text('h3','Incident group '+(i+1)+' · '+group.length+' surviving symptom'+(group.length===1?'':'s')));
    const ordered=[],remaining=new Set(assets.map(a=>a.id));while(remaining.size){const roots=[...remaining].filter(id=>!graph.relationships.some(e=>e.to===id&&remaining.has(e.from)&&e.type==='DEPENDS_ON'));const chosen=roots.length?roots:[...remaining];for(const id of chosen){ordered.push(assets.find(a=>a.id===id));remaining.delete(id);}}
    const strip=text('div','');strip.className='dependency-strip';for(const [index,asset]of ordered.entries()){if(index&&graph.relationships.some(edge=>edge.from===ordered[index-1].id&&edge.to===asset.id&&edge.type==='DEPENDS_ON')){const arrow=text('span','→');arrow.className='dependency-arrow';arrow.setAttribute('aria-hidden','true');strip.append(arrow);}const node=text('div','');node.className='dependency-node';node.append(text('small',asset.provider+' · '+asset.kind),text('strong',asset.name),text('p',asset.scope));strip.append(node);}
    card.append(strip,text('p',group.length>1?'Grouped through recorded dependency paths. The independent disk-pressure host remains separate.':'Separate incident: no recorded affected dependency path joins this host to the application outage.'));groups.append(card);
   }$('replay-results').append(groups);

  $('replay-progress').textContent=(saved?'Saved replay · '+new Date(record.completedAt).toLocaleString()+'. ':'')+(passed?'Replay verified. ':'Replay completed with a mismatch. ')+actual.deliveries+' occurrences → '+actual.matched+' rule matches → '+actual.survivors+' symptoms → '+actual.groups+' incident groups.';
 }
 async function history(){const current=generation,revision=++replayGeneration;try{const result=await request('/replays');if(current!==generation||revision!==replayGeneration||running)return;if(result.runs.length)showReplay(result.runs[0],true);}catch(e){if(current===generation&&revision===replayGeneration&&!running)$('replay-progress').textContent=e.message;}}
 /** The run's steps, in order; a failure names its step and the fix (UX audit 2026-11-06). */
 const STEPS={check:'Checking the detection service',source:'Creating test source',telemetry:'Configuring telemetry',rules:'Publishing rules',replay:'Replaying 100 events'};
 const FIX={check:'The detection service could not take the scenario rules, so nothing was saved. Press Check detection service on Data pipeline, then run again.',source:'Run again in a moment.',telemetry:'Run again in a moment.',rules:'Press Check detection service on Data pipeline, then run again.',replay:'Run again; if it stops again, press Check detection service on Data pipeline.'};
 const synthetic=s=>typeof s?.environment==='string'&&s.environment.startsWith('replay-')&&typeof s.source==='string'&&s.source.startsWith('urn:triagenorth:replay:');
 let leftover=[];
 function mark(key,state){const li=$('replay-steps').querySelector('[data-step="'+key+'"]');if(!li)return;li.dataset.state=state;li.querySelector('.step-mark').textContent=state==='done'?'✓':state==='failed'?'✕':state==='active'?'…':'';}
 function resetSteps(){for(const key of Object.keys(STEPS)){mark(key,'pending');const li=$('replay-steps').querySelector('[data-step="'+key+'"] .step-label');if(li)li.textContent=STEPS[key];}}
 function alertText(value){const box=$('replay-alert');box.textContent=value;box.hidden=!value;}
 /** Sources an earlier run saved and never completed; offered for removal so a failed run never stays behind. */
 async function findLeftovers(){const current=generation;try{const runs=(await request('/replays')).runs||[];if(current!==generation)return;const done=new Set(runs.map(r=>r.environment));leftover=sources().filter(s=>synthetic(s)&&!done.has(s.environment)).map(s=>s.id);}catch{leftover=[];}
  $('replay-discard').hidden=!leftover.length||running;$('replay-discard').textContent=leftover.length?'Remove test data ('+leftover.length+(leftover.length===1?' source':' sources')+')':'Remove test data';}
 async function discard(ids){await request('/replays',{discard:{sourceIds:ids}});leftover=leftover.filter(id=>!ids.includes(id));onChanged();}
 async function removeLeftovers(){if(!leftover.length)return;const button=$('replay-discard');button.disabled=true;try{const n=leftover.length;await discard(leftover.slice());alertText('');$('replay-progress').textContent='Removed '+n+' test '+(n===1?'source':'sources')+' and their telemetry.';}catch(e){alertText('Removing the test data failed: '+e.message+' Press Remove test data to try again.');}finally{button.disabled=false;$('replay-discard').hidden=!leftover.length;}}
 function openReplay(){const sheet=$('replay-sheet');if(!sheet.open){if(typeof sheet.showModal==='function')sheet.showModal();else sheet.setAttribute('open','');}void history();void findLeftovers();}
 function closeReplay(){const sheet=$('replay-sheet');if(sheet.open){if(typeof sheet.close==='function')sheet.close();else sheet.removeAttribute('open');}if(location.hash==='#replay')root.history.replaceState(null,'','#data');}
 async function replay(){if(running)return;running=true;++replayGeneration;$('run-replay').disabled=true;$('replay-discard').hidden=true;const current=generation;const check=()=>{if(current!==generation)throw Error('Replay stopped because your authorized view changed.');};
  $('replay-results').replaceChildren();alertText('');resetSteps();const created=[];let step='check',admitted=0;
  const begin=key=>{check();if(step!==key)mark(step,'done');step=key;mark(key,'active');};
  try{
   const scenario=root.OperationsReplayScenarios.datacenter('demo-'+Date.now().toString(36)),saved={};
   begin('check');$('replay-progress').textContent='Checking the detection service…';
   // The engine publishes the scenario's rules before anything is saved: a service that cannot (the 2026-11-05 503) refuses here with nothing written.
   await request('/replays',{preflight:{policy:scenario.policy}});
   begin('source');for(const source of scenario.sources){saved[source.key]=await request('/sources',source);created.push(saved[source.key].id);check();}
   begin('telemetry');for(const source of scenario.sources){await request('/telemetry/configure',{sourceId:saved[source.key].id,config:scenario.configs[source.key],expectedRevision:0});check();}
   begin('rules');for(const source of scenario.sources){await request('/pipeline/policies',{sourceId:saved[source.key].id,policy:scenario.policy,expectedRevision:0});check();}
   begin('replay');const label=$('replay-steps').querySelector('[data-step="replay"] .step-label');
   await request('/topology/scans',{sourceId:saved.hosts.id,scan:scenario.scan});check();
   for(const row of scenario.telemetry){await request('/streams/'+saved[row.key].id+'/'+row.format,row.payload);check();}
   const decisions=[];for(let i=0;i<scenario.events.length;i+=20){
    const upto=Math.min(i+20,scenario.events.length);label.textContent='Replaying '+upto+' of '+scenario.events.length+' events';$('replay-progress').textContent=label.textContent+'…';
    const batch=await request('/events/batch',{events:scenario.events.slice(i,i+20).map(row=>({sourceId:saved[row.key].id,event:row.event}))});check();admitted+=batch.results.filter(r=>r.status<400).length;
    if(batch.results.some(r=>r.status>=400||r.decision!=='validated'))throw Error('A replay delivery was refused or has an uncertain result.');
    const evaluated=await request('/pipeline/evaluate',{deliveryIds:batch.results.map(r=>r.id)});check();if(evaluated.results.some(r=>r.error))throw Error(evaluated.results.find(r=>r.error).error);decisions.push(...evaluated.results);
   }
   const survivors=decisions.filter(d=>d.reduction?.workId);$('replay-progress').textContent='Explaining dependency paths and pinning incident context…';
   const correlation=await request('/topology/correlate',{deliveryIds:survivors.map(d=>d.deliveryId),asOf:scenario.scan.observedAt,collectionId:scenario.scan.collectionId,policy:{id:'replay-dependencies-v1',types:['DEPENDS_ON'],maxDepth:4,maxVisited:100,maxAgeSeconds:900}});check();
   for(const decision of survivors){await request('/telemetry/pin',{workId:decision.reduction.workId});check();}
   const record=await request('/replays',{decisionIds:decisions.map(d=>d.id),correlationId:correlation.id});check();mark('replay','done');label.textContent=STEPS.replay;showReplay(record);onChanged();
  }catch(e){
   if(current!==generation)return;
   mark(step,'failed');$('replay-progress').textContent='Run stopped.';
   let cleanup=created.length?'':' Nothing was saved.';
   if(created.length){try{await discard(created);cleanup=' The test sources and telemetry this run created were removed.'+(admitted?' The '+admitted+' synthetic occurrences it admitted stay in your records, marked SYNTHETIC.':'');}catch(err){leftover=[...new Set([...leftover,...created])];$('replay-discard').hidden=false;$('replay-discard').textContent='Remove test data';cleanup=' Removing the test data failed too ('+err.message+'). Press Remove test data.';}}
   alertText('Stopped at '+STEPS[step].toLowerCase()+': '+e.message+' '+FIX[step]+cleanup);
  }finally{running=false;$('run-replay').disabled=false;}
 }
 $('telemetry-source').addEventListener('change',select);$('telemetry-form').addEventListener('submit',configure);$('telemetry-refresh').addEventListener('click',load);$('run-replay').addEventListener('click',replay);
 $('replay-discard').addEventListener('click',()=>{void removeLeftovers();});$('open-replay').addEventListener('click',openReplay);$('replay-sheet-done').addEventListener('click',closeReplay);$('replay-sheet').addEventListener('close',()=>{if(location.hash==='#replay')root.history.replaceState(null,'','#data');});
 return {load,clear,evaluation,history,openReplay,findLeftovers};
}};
})(window);
