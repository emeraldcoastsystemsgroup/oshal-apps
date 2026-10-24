/* CHANGE LOG: local times | maintainer@emeraldcoastsystemsgroup.com | Graph and observation times in the viewer's local time. */
/* CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Allow the bounded resource tree to inspect the complete returned graph while keeping the legacy card limit. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Explain bounded real pipeline cohorts and explore recorded graph nodes without inventing totals or correlation. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Project current-caller graph observations into Systems, retaining native identity, event-time bounds and unknown health. */
(function(root){
const localTime=v=>{const d=new Date(v);return v&&!Number.isNaN(d.getTime())?d.toLocaleString():String(v);};
'use strict';
function cohort(records){
 const latest=new Map();
 for(const d of [...(records.decisions||[])].sort((a,b)=>String(b.at).localeCompare(String(a.at))||String(b.id).localeCompare(String(a.id))))if(!latest.has(d.deliveryId))latest.set(d.deliveryId,d);
 const decisions=[...latest.values()],matched=decisions.filter(d=>d.outcome==='matched');
 const survivors=matched.filter(d=>['admitted','escalated'].includes(d.reduction?.outcome));
 const ids=new Set(survivors.map(d=>d.deliveryId));
 const correlation=(records.correlations||[]).find(c=>c.deliveryIds?.length&&c.deliveryIds.every(id=>ids.has(id)))||null;
 return {decisions,matched,survivors,correlation,suppressed:matched.filter(d=>d.reduction?.outcome==='suppressed'),filtered:decisions.filter(d=>d.outcome==='unmatched')};
}
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
function flow(container,records,onInspect){
 const c=cohort(records),n=c.decisions.length;container.replaceChildren();
 container.append(text('p','Latest returned decision cohort: '+n+' unique evaluated events. Up to 200 decision records; this is not an installation-wide or live rate. Repeated policy evaluations count once.'));
 const stages=[['Incoming cohort',c.decisions,'Events that reached the percolator'],['Percolator wall',c.matched,'Matched at least one stored rule'],['After deduplication',c.survivors,'New or escalated symptoms eligible for evidence']];
 const rail=text('div','','pipeline-flow');
 for(const [label,rows,description]of stages){const card=text('article','','pipeline-stage');card.append(text('h3',label),text('strong',String(rows.length)),text('p',n?`${rows.length}/${n} · ${(100*rows.length/n).toFixed(1)}% of evaluated`:'No evaluated cohort'),text('small',description));
 const meter=document.createElement('meter');meter.min=0;meter.max=Math.max(n,1);meter.value=rows.length;meter.setAttribute('aria-label',label+' fraction');card.append(meter);
 const detail=text('details','');detail.append(text('summary','Inspect '+rows.length+' events'));for(const d of rows){const b=text('button',d.deliveryId.slice(0,12)+' · '+(d.reduction?.outcome||d.outcome));b.addEventListener('click',()=>onInspect(d));detail.append(b);}card.append(detail);rail.append(card);}
 const last=text('article','','pipeline-stage');last.append(text('h3','Correlation results'));
 if(c.correlation)last.append(text('strong',c.correlation.groups.length+' groups'),text('p',c.correlation.deliveryIds.length+'/'+c.survivors.length+' surviving events in the latest matching analysis'),text('small',c.correlation.method+' · '+c.correlation.status));
 else last.append(text('strong','Not analyzed'),text('p','No saved analysis covering only this surviving cohort.'));
 rail.append(last);container.append(rail,text('p',c.filtered.length+' did not match a rule · '+c.suppressed.length+' duplicate occurrences suppressed · '+(c.matched.length-c.survivors.length-c.suppressed.length)+' other matched states (resolution, replay or late state). Failed attempts remain separate from successful evaluations.'));
 return c;
}
function correlations(container,records,onExplore){
 container.replaceChildren();if(!records.length){container.append(text('p','No saved correlation analyses. Run selected events through filtering and reduction, then correlate the surviving events.'));return;}
 for(const r of records.slice(0,20)){const card=text('article','','correlation-card');card.append(text('h3',r.groups.length+' groups from '+r.deliveryIds.length+' events'),text('p',r.method+' · '+r.status+' · graph as of '+localTime(r.asOf)));
 if(r.status!=='complete')card.append(text('p','Graph evidence is incomplete. These are exact-asset fallback groups, not proven dependency correlations.','warning'));
 for(const [i,ids]of r.groups.entries()){const group=text('div','','correlation-group');group.append(text('h4','Group '+(i+1)+' · '+ids.length+' events'));
 for(const id of ids){const event=r.events?.find(e=>e.id===id),button=text('button',id.slice(0,12)+' · '+(event?.assetId?.slice(0,12)||'unresolved'));button.addEventListener('click',()=>onExplore(event?.assetId,r.asOf));group.append(button);}card.append(group);}
 card.append(text('p',r.paths.length+' observed dependency paths · '+r.problems.length+' evidence limitations'));
 const details=text('details','');details.append(text('summary','Policy, path edges and source evidence'),text('pre',JSON.stringify(r,null,2)));card.append(details);container.append(card);}
}
function graph(container,data,filter,onFocus){
 container.replaceChildren();const q=(filter.search||'').toLowerCase();
 const all=data.assets.filter(a=>(!filter.kind||a.kind===filter.kind)&&(!q||[a.name,a.nativeId,a.scope,a.kind].join(' ').toLowerCase().includes(q))),shown=all.slice(0,100);
 container.append(text('p',shown.length+' of '+all.length+' matching nodes · '+data.assets.length+' total observed assets. Select a node to explore its directed neighbors.'));
 if(!shown.length){container.append(text('p','No graph nodes match these filters.'));return;}
 const svg=(tag,attrs,value)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,v]of Object.entries(attrs||{}))el.setAttribute(key,v);if(value!==undefined)el.textContent=value;return el;};
 const columns=[...new Set(shown.map(a=>a.kind))].sort(),positions=new Map();let maxRows=0;
 for(const [col,kind]of columns.entries()){const nodes=shown.filter(a=>a.kind===kind);maxRows=Math.max(maxRows,nodes.length);nodes.forEach((a,row)=>positions.set(a.id,{x:col*210+110,y:row*90+60}));}
 const drawing=svg('svg',{viewBox:`0 0 ${columns.length*210+20} ${maxRows*90+40}`,role:'group','aria-label':'Inventory graph explorer',class:'inventory-graph'});
 for(const edge of data.relationships){const from=positions.get(edge.from),to=positions.get(edge.to);if(!from||!to)continue;const line=svg('path',{d:`M ${from.x} ${from.y} L ${to.x} ${to.y}`,class:'inventory-edge'});line.append(svg('title',{},edge.type+' · '+edge.evidence));drawing.append(line);}
 for(const a of shown){const pos=positions.get(a.id),node=svg('g',{role:'button',tabindex:'0','aria-label':'Explore node '+a.name,class:'inventory-node '+a.health});node.append(svg('rect',{x:pos.x-95,y:pos.y-29,width:190,height:58,rx:9}),svg('text',{x:pos.x,y:pos.y-5,'text-anchor':'middle'},a.name.slice(0,23)),svg('text',{x:pos.x,y:pos.y+15,'text-anchor':'middle'},a.kind+' · '+a.health),svg('title',{},a.nativeId+' · observed '+localTime(a.observedAt)));node.addEventListener('click',()=>onFocus(a.id));node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onFocus(a.id);}});drawing.append(node);}
 const canvas=text('div','','graph-canvas');drawing.style.minWidth=Math.max(600,columns.length*210)+'px';canvas.append(drawing);container.append(canvas);
}
/**
 * @description Project already authorized observations without merging ambiguous native identities.
 * @param {object} data Caller-scoped temporal graph returned by the existing topology API.
 * @param {Array} records Latest caller-scoped event page, not a complete event history.
 * @param {object} filter Display filters; these never confer authority.
 * @returns {object} Bounded rows, observed relationships, exact event links and complete filtered counts.
 */
function systemInventory(data,records=[],filter={}){
 if(!data||!Array.isArray(data.assets)||!Array.isArray(data.relationships)||!Array.isArray(data.collections)||!Array.isArray(records)||!Number.isFinite(Date.parse(data.asOf)))throw Error('Systems observations are unavailable.');
 if(data.assets.length>2000||data.relationships.length>5000||records.length>200)throw Error('Systems observations exceed the returned-page budget.');
 const key=a=>JSON.stringify([a.provider,a.scope]),groups=new Map(),index=new Map(),byId=new Map(),events=new Map();
 for(const a of data.assets){
  if(!a||!['id','provider','scope','kind','nativeId','name','observedAt'].every(k=>typeof a[k]==='string'&&a[k])||byId.has(a.id))throw Error('A system identity is unavailable or repeated.');
  if(!Number.isFinite(Date.parse(a.observedAt))||Date.parse(a.observedAt)>Date.parse(data.asOf))throw Error('A system observation time is unavailable or beyond the selected graph time.');
  byId.set(a.id,a);const k=key(a);if(!groups.has(k))groups.set(k,{id:k,provider:a.provider,scope:a.scope,name:a.scope,count:0});
  const group=groups.get(k);group.count++;if(a.kind==='cluster')group.name=a.name;
  const native=JSON.stringify([a.provider,a.scope,a.nativeId]);if(!index.has(native))index.set(native,[]);index.get(native).push(a);
 }
 const providers={'kubernetes-pod':'kubernetes',container:'kubernetes',workload:'kubernetes','aws-resource':'aws','azure-resource':'azure','gcp-resource':'gcp',host:'import'};
 const kinds={'kubernetes-pod':'pod',container:'container',workload:'workload',host:'host'},seenEvents=new Set();
 for(const record of records){
  const event=record?.normalized,resource=event?.data?.resource,time=Date.parse(event?.time);
  if(record?.decision!=='validated'||typeof record.id!=='string'||seenEvents.has(record.id)||!Number.isFinite(time)||time>Date.parse(data.asOf)||!resource)continue;
  seenEvents.add(record.id);const provider=providers[resource.kind];if(!provider)continue;
  const candidates=(index.get(JSON.stringify([provider,resource.scope,resource.id]))||[]).filter(a=>!kinds[resource.kind]||a.kind===kinds[resource.kind]);
  if(candidates.length!==1)continue;
  const id=candidates[0].id;if(!events.has(id))events.set(id,[]);events.get(id).push(record);
 }
 const scope=data.assets.filter(a=>!filter.system||key(a)===filter.system);
 const namespace=a=>typeof a.properties?.namespace==='string'?a.properties.namespace:a.kind==='namespace'?a.name:'';
 const namespaces=[...new Set(scope.map(namespace).filter(Boolean))].sort(),types=[...new Set(scope.map(a=>a.kind))].sort();
 const search=String(filter.search||'').toLowerCase().trim();
 const health=a=>['healthy','degraded'].includes(a.health)?a.health:'unknown';
 const matches=scope.filter(a=>(!filter.namespace||namespace(a)===filter.namespace)&&(!filter.kind||a.kind===filter.kind)&&(!filter.health||health(a)===filter.health)&&(!search||[a.name,a.nativeId,a.scope,a.kind,namespace(a)].join(' ').toLowerCase().includes(search)));
 const counts={total:matches.length,healthy:0,degraded:0,unknown:0,pods:0,containers:0,nodes:0};
 for(const a of matches){counts[health(a)]++;if(a.kind==='pod')counts.pods++;if(a.kind==='container')counts.containers++;if(a.kind==='node')counts.nodes++;}
 const rows=matches.slice().sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).slice(0,Number.isInteger(filter.limit)&&filter.limit>0&&filter.limit<=2000?filter.limit:100).map(a=>({...a,events:(events.get(a.id)||[]).sort((x,y)=>Date.parse(y.normalized.time)-Date.parse(x.normalized.time)),neighbors:data.relationships.filter(e=>e.from===a.id||e.to===a.id).map(e=>({...e,outbound:e.from===a.id,neighbor:byId.get(e.from===a.id?e.to:e.from)||null}))}));
 return {asOf:data.asOf,systems:[...groups.values()].sort((a,b)=>a.provider.localeCompare(b.provider)||a.name.localeCompare(b.name)),namespaces,types,counts,rows,total:data.assets.length,scopeTotal:scope.length,truncated:matches.length>rows.length,partialCollections:data.collections.filter(c=>!c.complete).length};
}
/**
 * @description Render captured facts and explicit uncertainty using text-safe, bounded cards.
 * @param {Element} container Destination for the current projection.
 * @param {object} model Result of systemInventory.
 * @param {Function} onFocus Open the original graph asset identity.
 * @param {Function} onEvent Inspect the original related event record.
 * @returns {void} Updates the destination without running infrastructure commands.
 */
function systems(container,model,onFocus,onEvent){
 container.replaceChildren();
 const summary=text('div','','metrics systems-metrics');
 for(const [label,value]of [['Observed assets',model.counts.total],['Nodes',model.counts.nodes],['Pods',model.counts.pods],['Containers',model.counts.containers]]){const card=text('article','','card');card.append(text('p',label),text('strong',String(value)),text('small','Matching the selected filters'));summary.append(card);}container.append(summary);
 container.append(text('p',model.counts.healthy+' healthy · '+model.counts.degraded+' degraded · '+model.counts.unknown+' unknown at their observation times. '+model.rows.length+' of '+model.counts.total+' matching assets shown; '+model.total+' assets in the authorized graph.'));
 if(model.partialCollections)container.append(text('p',model.partialCollections+' collections in this graph are partial. Missing resources do not establish deletion.','warning'));
 if(!model.rows.length){container.append(text('p','No observed systems match these filters. Open Topology for recorded scans or captures.'));return;}
 const grid=text('div','','systems-grid');
 for(const asset of model.rows){
  const health=['healthy','degraded'].includes(asset.health)?asset.health:'unknown',card=text('article','','system-card '+health),head=text('div','','system-card-heading');
  head.append(text('span',asset.kind,'system-kind'),text('span',health+' when observed','system-health'));card.append(head,text('h2',asset.name),text('p',asset.provider+' · '+asset.scope,'system-scope'));
  const properties=asset.properties||{},facts=text('dl','','system-facts');
  const values=[['Observed',asset.observedAt],['Native ID',asset.nativeId]];
  if(properties.namespace)values.push(['Namespace',properties.namespace]);
  if(properties.image)values.push(['Image',properties.image]);
  if(Number.isSafeInteger(properties.restarts)&&properties.restarts>=0)values.push(['Observed restarts',String(properties.restarts)]);
  if(properties.terminating===true)values.push(['Lifecycle','Terminating when observed']);
  for(const edge of asset.neighbors.filter(e=>e.outbound&&['RUNS_ON','OWNED_BY'].includes(e.type)).slice(0,4))values.push([edge.type==='RUNS_ON'?'Runs on':'Owned by',edge.neighbor?.name||'Unresolved native identity']);
  for(const [label,value]of values)facts.append(text('dt',label),text('dd',String(value)));card.append(facts);
  card.append(text('p',asset.neighbors.length+' recorded relationships · '+asset.events.length+' related events in the loaded page at or before graph time.'));
  const focus=text('button','Inspect '+asset.name+' in topology');focus.addEventListener('click',()=>onFocus(asset.id));card.append(focus);
  if(asset.neighbors.length){const detail=text('details','');detail.append(text('summary','Observed relationships'));for(const edge of asset.neighbors.slice(0,10)){const row=text('p',(edge.outbound?'→ ':'← ')+edge.type+' · '+(edge.neighbor?.name||'Unresolved target')+' · '+edge.evidence);detail.append(row);}if(asset.neighbors.length>10)detail.append(text('p','First 10 relationships shown; open topology for more.'));card.append(detail);}
  if(asset.events.length){const detail=text('details','');detail.append(text('summary','Related alert observations'));for(const event of asset.events.slice(0,10)){const b=text('button',(event.normalized.data.alertType||'Alert')+' · '+event.normalized.data.status+' · '+event.normalized.time);b.addEventListener('click',()=>onEvent(event));detail.append(b);}if(asset.events.length>10)detail.append(text('p','First 10 related events shown; inspect Data & decisions for the returned page.'));card.append(detail);}
  grid.append(card);
 }
 container.append(grid);if(model.truncated)container.append(text('p','Display limited to 100 matching assets. Narrow the system, namespace, type or search filter.'));
}
const api={cohort,flow,correlations,graph,systemInventory,systems};if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsExplorer=api;
})(typeof window==='object'?window:globalThis);
