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
  if(streams.length){const wrap=text('div','');wrap.className='ops-table-wrap';const table=text('table','');table.className='ops-table telemetry-table';const head=text('tr','');for(const h of ['Stream','Window · capacity per bank','Bank 1','Bank 2','Bank 3','Last receipt'])head.append(text('th',h));table.append(head);
   for(const stream of streams){const source=sources().find(s=>s.id===stream.id),row=text('tr',''),name=text('td','');name.append(text('strong',source?.name||stream.source));if(source?.environment)name.append(text('br',''),text('small',source.environment));
    row.append(name,text('td','≥15 min · '+stream.config.maxBankRecords+' records / '+Math.round(stream.config.maxBankBytes/1024)+' KiB'+(stream.config.autoGrow?' · grows':'')));
    stream.banks.forEach((bank,i)=>{const cell=text('td',''),box=text('div','');box.className='bank-cell'+(i===stream.active?' writing':'');const cap=bank.capacityBytes??stream.config.maxBankBytes;box.append(text('b',bank.count+' / '+(bank.capacityRecords??stream.config.maxBankRecords)));const bar=text('span','');bar.className='bank-bar';const fill=document.createElement('i');fill.style.width=Math.min(100,Math.round(100*bank.bytes/Math.max(1,cap)))+'%';bar.append(fill);bar.setAttribute('role','meter');bar.setAttribute('aria-label','Bank '+(i+1)+(i===stream.active?' (writing)':' (retained)')+': '+Math.round(bank.bytes/1024)+' of '+Math.round(cap/1024)+' KiB');box.append(bar,text('small',Math.round(bank.bytes/1024)+' / '+Math.round(cap/1024)+' KiB · gen '+bank.generation));cell.append(box);row.append(cell);});
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
 async function replay(){if(running)return;running=true;++replayGeneration;$('run-replay').disabled=true;const current=generation;const check=()=>{if(current!==generation)throw Error('Replay stopped because your authorized view changed.');};
  $('replay-results').replaceChildren();try{
   const scenario=root.OperationsReplayScenarios.datacenter('demo-'+Date.now().toString(36)),saved={};const progress=message=>{check();$('replay-progress').textContent=message;};
   progress('Creating an isolated synthetic replay environment…');
   for(const source of scenario.sources){saved[source.key]=await request('/sources',source);check();await request('/telemetry/configure',{sourceId:saved[source.key].id,config:scenario.configs[source.key],expectedRevision:0});check();await request('/pipeline/policies',{sourceId:saved[source.key].id,policy:scenario.policy,expectedRevision:0});check();}
   await request('/topology/scans',{sourceId:saved.hosts.id,scan:scenario.scan});check();
   for(const row of scenario.telemetry){await request('/streams/'+saved[row.key].id+'/'+row.format,row.payload);check();}
   const decisions=[];for(let i=0;i<scenario.events.length;i+=20){
    progress('Admitting and evaluating '+Math.min(i+20,scenario.events.length)+' / '+scenario.events.length+' synthetic occurrences…');
    const admitted=await request('/events/batch',{events:scenario.events.slice(i,i+20).map(row=>({sourceId:saved[row.key].id,event:row.event}))});check();
    if(admitted.results.some(r=>r.status>=400||r.decision!=='validated'))throw Error('A replay delivery was refused or has an uncertain result; inspect the partial run.');
    const batch=await request('/pipeline/evaluate',{deliveryIds:admitted.results.map(r=>r.id)});check();if(batch.results.some(r=>r.error))throw Error(batch.results.find(r=>r.error).error);decisions.push(...batch.results);
   }
   const survivors=decisions.filter(d=>d.reduction?.workId);progress('Explaining dependency paths and pinning incident context…');
   const correlation=await request('/topology/correlate',{deliveryIds:survivors.map(d=>d.deliveryId),asOf:scenario.scan.observedAt,collectionId:scenario.scan.collectionId,policy:{id:'replay-dependencies-v1',types:['DEPENDS_ON'],maxDepth:4,maxVisited:100,maxAgeSeconds:900}});check();
   const packets=[];for(const decision of survivors){packets.push(await request('/telemetry/pin',{workId:decision.reduction.workId}));check();}
   const record=await request('/replays',{decisionIds:decisions.map(d=>d.id),correlationId:correlation.id});check();showReplay(record);onChanged();
  }catch(e){if(current===generation)$('replay-progress').textContent=e.message+' Partial records remain inspectable; no infrastructure action was run.';}finally{running=false;$('run-replay').disabled=false;}
 }
 $('telemetry-source').addEventListener('change',select);$('telemetry-form').addEventListener('submit',configure);$('telemetry-refresh').addEventListener('click',load);$('run-replay').addEventListener('click',replay);
 return {load,clear,evaluation,history};
}};
})(window);
