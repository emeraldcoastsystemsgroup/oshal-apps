/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Read the canonical reduction symptom key in the event decision trail. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Present an operator overview, focused pipeline tabs and searchable source mappings over existing caller-owned records. */
(function(root){
'use strict';
if(root.self!==root.top)document.documentElement.classList.add('operations-embedded');
root.addEventListener('hashchange',()=>root.requestAnimationFrame(()=>root.scrollTo(0,0)));
root.addEventListener('load',()=>{if(!new URLSearchParams(location.search).has('event'))root.requestAnimationFrame(()=>root.scrollTo(0,0));});
const $=id=>document.getElementById(id);
const el=(tag,value='',cls='')=>{const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;};
const button=(label,action)=>{const node=el('button',label);node.type='button';node.addEventListener('click',action);return node;};
const factList=values=>{const dl=el('dl','','operator-facts');for(const [name,value]of values)dl.append(el('dt',name),el('dd',value===undefined||value===null?'Not recorded':String(value)));return dl;};
const stamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Not recorded';
const tools={overview:'operations-workspace',systems:'operations-estate',data:'operations-data',sources:'operations-sources',estate:'operations-topology',streams:'operations-streams',replay:'operations-replay',connections:'operations-connections',credentials:'operations-credentials',library:'operations-library'};
/** @description Keep cross-screen navigation on the manifest-owned shell rail; standalone views use the same local URL. */
function navigate(page,params={}){
 const query=new URLSearchParams(params).toString();
 if(root.self!==root.top&&tools[page])root.parent.postMessage({type:'app-navigate',tool:tools[page],query},location.origin);
 else {const url=new URL(location.href);url.hash=page;url.search=query;location.assign(url.href);}
}
/** @description Mount presentation-only controls. All mutations remain in the existing explicitly invoked controllers. */
function mount({onInspect,onEvents,onRefused}){
 let records={sources:[],events:[],inventory:[]},selectedSource='',ticketEpoch=0,deepLinked=false;
 const params=new URLSearchParams(location.search),panels=new Map(),tabs=new Map();
 const pipelineStatus=$('pipeline-status'),decisionInput=$('decision');
 const data=$('data'),first=$('pipeline-flow').closest('article'),rule=$('policy-workbench'),automatic=$('processing-form').closest('article'),correlation=$('correlate-events').closest('article'),filter=$('decision').closest('.filterbar');
 const bar=el('div','','operator-tabs');bar.setAttribute('role','tablist');bar.setAttribute('aria-label','Pipeline views');
 function tab(key,label){const panel=el('div','','operator-tab-panel');panel.id='pipeline-panel-'+key;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','pipeline-tab-'+key);panel.tabIndex=0;const b=button(label,()=>show(key));b.id='pipeline-tab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls',panel.id);b.addEventListener('keydown',event=>{const keys=[...tabs.keys()],i=keys.indexOf(key);let n;if(event.key==='ArrowRight')n=(i+1)%keys.length;else if(event.key==='ArrowLeft')n=(i+keys.length-1)%keys.length;else if(event.key==='Home')n=0;else if(event.key==='End')n=keys.length-1;else return;event.preventDefault();show(keys[n]);tabs.get(keys[n]).focus();});tabs.set(key,b);panels.set(key,panel);bar.append(b);return panel;}
 function show(key){if(!panels.has(key))key='flow';for(const [name,panel]of panels){panel.hidden=name!==key;const b=tabs.get(name);b.setAttribute('aria-selected',String(name===key));b.tabIndex=name===key?0:-1;}if(key==='rules')rule.open=true;}
 const flow=tab('flow','Flow'),events=tab('events','Events'),rules=tab('rules','Rules'),automation=tab('automation','Automation'),groups=tab('correlation','Correlation');
 rules.append(rule);automation.append(automatic);groups.append(correlation);
 const raw=$('pipeline-records').closest('details');raw.classList.add('operator-advanced');
 const eventTools=el('div','','operator-toolbar');eventTools.append($('evaluate-events'),$('run-pipeline'),button('Review correlation',()=>show('correlation')));
 const selection=el('p','Select recorded events to test rules or run filtering.','operator-note');selection.id='event-selection';events.append(eventTools,selection,filter);flow.append(first,raw);
 const decisionLabel=filter.querySelector('label'),decisionField=el('div','','operator-filter-field');decisionField.append(decisionLabel,decisionInput);filter.prepend(decisionField);
 const sourceLabel=el('label','Source revision'),sourceSelect=el('select');sourceSelect.id='event-source-filter';sourceSelect.addEventListener('change',onEvents);sourceLabel.htmlFor=sourceSelect.id;const sourceField=el('div','','operator-filter-field');sourceField.append(sourceLabel,sourceSelect);
 const searchLabel=el('label','Find an event'),search=el('input');search.type='search';search.id='event-search';search.placeholder='Alert, resource or event ID';search.addEventListener('input',onEvents);searchLabel.append(search);filter.append(sourceField,searchLabel);
 const split=el('div','','operator-workbench event-workbench');split.append($('event-list'),$('event-detail'));events.append(split);
 data.replaceChildren(bar,pipelineStatus,...panels.values());show(params.get('pane')||'flow');
 rules.prepend(button('Choose events for a trial',()=>show('events')));
 const sourcePage=$('sources'),sourceSearchLabel=el('label','Find a source'),sourceSearch=el('input');sourceSearch.type='search';sourceSearch.id='source-search';sourceSearch.placeholder='Name, environment or URI';sourceSearch.addEventListener('input',renderSources);sourceSearchLabel.append(sourceSearch);
 const sourceTools=el('div','','operator-toolbar'),sourceSetup=el('details','','operator-setup');sourceSetup.id='source-setup';sourceSetup.append(el('summary','Register a source or record a test event'),$('source-form').parentElement);
 sourceTools.append(sourceSearchLabel,button('Add source',()=>{sourceSetup.open=true;$('source-name').focus();}));
 const sourceSummary=el('p','','operator-note');sourceSummary.id='source-summary';
 const sourceSplit=el('div','','operator-workbench source-workbench'),sourceDetail=el('section','','operator-detail');sourceDetail.id='source-detail';sourceDetail.setAttribute('aria-label','Selected source');sourceSplit.append($('source-list'),sourceDetail);sourcePage.replaceChildren(sourceTools,sourceSummary,sourceSplit,sourceSetup);
 const overview=$('overview'),metrics=overview.querySelector('.metrics'),overviewGrid=el('div','','operator-overview-grid');
 const attention=el('article','','card'),activity=el('article','','card'),attentionList=el('div'),activityList=el('div');attentionList.id='overview-attention';activityList.id='overview-activity';attention.append(el('h2','Needs attention'),el('p','Issues in the latest returned records.','operator-note'),attentionList);activity.append(el('h2','Source activity'),el('p','Most recent receipt per source in the loaded event page.','operator-note'),activityList);overviewGrid.append(attention,activity);
 const tickets=el('article','','card'),ticketList=el('div');ticketList.id='overview-tickets';tickets.append(el('h2','Incident work'),el('p','Your canonical Operations tickets. Report acceptance and service recovery are separate states.','operator-note'),button('Refresh incident work',loadTickets),ticketList);
 overview.replaceChildren(metrics,overviewGrid,tickets);
 function selectionChanged(count){selection.textContent=count+' events selected. Selection is retained when you change filters.';}
 function clear(){++ticketEpoch;deepLinked=false;$('event-detail').dataset.eventId='';ticketList.replaceChildren(el('p','Refresh to read your authorized incident work.'));records={sources:[],events:[],inventory:[]};selectedSource='';renderSources();renderOverview();attentionList.replaceChildren(el('p','Refresh to read your authorized records.'));activityList.replaceChildren();selectionChanged(0);}
 function update(next){records=next;const old=sourceSelect.value;sourceSelect.replaceChildren(new Option('All source revisions',''));for(const source of records.sources)sourceSelect.append(new Option(source.name+' · '+source.environment,source.id));sourceSelect.value=records.sources.some(s=>s.id===old)?old:'';
  if(!deepLinked){deepLinked=true;const source=params.get('source');if(records.sources.some(s=>s.id===source)){selectedSource=source;sourceSelect.value=source;$('policy-source').value=source;}
   const event=records.events.find(e=>e.id===params.get('event'));if(event)onInspect(event);
  }
  renderSources();renderOverview();onEvents();
 }
 function openEvents(source,decision='all'){$('decision').value=decision;navigate('data',{pane:'events',...(source?{source}:{}),...(decision!=='all'?{decision}:{})});}
 function renderSources(){
  const q=sourceSearch.value.toLowerCase().trim(),sources=records.sources.filter(s=>[s.name,s.environment,s.source,s.id].join(' ').toLowerCase().includes(q));
  sourceSummary.textContent=sources.length+' of '+records.sources.length+' source revisions · '+new Set(records.sources.map(s=>s.environment)).size+' environments. A saved format does not establish a connected producer.';
  if(!sources.some(s=>s.id===selectedSource))selectedSource=sources[0]?.id||'';
  $('source-list').replaceChildren();for(const source of sources){const events=records.events.filter(e=>e.sourceId===source.id),bad=events.filter(e=>e.decision==='quarantined').length,row=button('',()=>{selectedSource=source.id;renderSources();});row.className='operator-catalogue-row';row.setAttribute('aria-pressed',String(source.id===selectedSource));row.append(el('strong',source.name),el('small',source.environment+' · '+source.id.slice(0,12)),el('span',events.length+' loaded events'+(bad?' · '+bad+' quarantined':''),bad?'operator-badge attention':'operator-badge'));$('source-list').append(row);}
  if(!sources.length)$('source-list').append(el('p',records.sources.length?'No sources match your search.':'No source definitions. Add a source to declare its identity and field mapping.'));
  sourceDetail.replaceChildren();const source=sources.find(s=>s.id===selectedSource);if(!source){sourceDetail.append(el('h2','Select a source'),el('p','Its identity, mapping and received events appear here.'));return;}
  const events=records.events.filter(e=>e.sourceId===source.id),latest=events.map(e=>e.receivedAt).filter(v=>Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
  sourceDetail.append(el('p',source.environment,'eyebrow'),el('h2',source.name),factList([['Source URI',source.source],['Revision',source.id],['Last loaded receipt',stamp(latest)],['Loaded events',events.length],['Quarantined',events.filter(e=>e.decision==='quarantined').length]]));
  const actions=el('div','','operator-toolbar');actions.append(button('Inspect source events',()=>openEvents(source.id)),button('Configure rules',()=>navigate('data',{pane:'rules',source:source.id})),button('Record test event',()=>{sourceSetup.open=true;$('event-source').value=source.id;$('event-json').focus();}));sourceDetail.append(actions,el('h3','Inbound identity mapping'),el('p','Envelope source and event ID are required. The adapter reads these JSON Pointer paths.','operator-note'));
  sourceDetail.append(factList(Object.entries(source.mapping||{})));if(!source.mapping)sourceDetail.append(el('p','Mapping was not returned. Refresh before making changes.'));
  sourceDetail.append(el('h3','Collection and access'),el('p','This definition normalizes alerts. Configure telemetry retention separately and use your authorized monitoring connection to collect data.'),button('Open live context',()=>navigate('streams')),button('Open connections',()=>navigate('connections')));
 }
 function renderOverview(){
  attentionList.replaceChildren();activityList.replaceChildren();const quarantined=records.events.filter(e=>e.decision==='quarantined'),failed=(records.processing||[]).filter(p=>['attention','evidence-attention','retry','evidence-retry'].includes(p.state));
  for(const [label,items,pane]of [['Quarantined events',quarantined,'events'],['Processing needs review',failed,'automation']]){const row=el('div','','operator-summary-row');row.append(el('strong',String(items.length)),el('span',label),button('Review',()=>navigate('data',{pane,...(pane==='events'?{decision:'quarantined'}:{})})));attentionList.append(row);}
  const recent=records.events.slice().sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt)).slice(0,5);attentionList.append(el('h3','Recent events'));
  for(const event of recent){const row=button('',()=>navigate('data',{pane:'events',event:event.id}));row.className='operator-catalogue-row';row.append(el('strong',event.normalized?.data?.alertType||'Unrecognized event'),el('small',event.decision+' · '+stamp(event.receivedAt)));attentionList.append(row);}if(!recent.length)attentionList.append(el('p','No event records have been returned.'));
  const rows=records.sources.map(s=>({source:s,events:records.events.filter(e=>e.sourceId===s.id)})).sort((a,b)=>b.events.length-a.events.length).slice(0,8);
  for(const {source,events}of rows){const latest=events.slice().sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt))[0],row=button('',()=>navigate('sources',{source:source.id}));row.className='operator-catalogue-row';row.append(el('strong',source.name),el('small',source.environment+' · '+events.length+' loaded events'),el('small',latest?'Last receipt '+stamp(latest.receivedAt):'No receipt in the loaded page'));activityList.append(row);}
  if(!rows.length)activityList.append(el('p','No named sources have been returned.'));activityList.append(button('Manage sources',()=>navigate('sources')));
 }
 async function loadTickets(){const epoch=++ticketEpoch;ticketList.replaceChildren(el('p','Reading incident work…'));try{const response=await fetch('/api/tickets',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(epoch!==ticketEpoch)return;if(!response.ok){if([401,403].includes(response.status))onRefused();throw Error('Incident work unavailable (HTTP '+response.status+').');}const body=await response.json();if(epoch!==ticketEpoch)return;if(!Array.isArray(body.tickets)||body.tickets.length>1000)throw Error('Incident work response is unavailable.');const rows=root.OperationsRcaLibrary.catalogue(body);ticketList.replaceChildren();for(const ticket of rows.slice(0,12)){const id=ticket.id||ticket.ticketId;if(typeof id!=='string'||!id)throw Error('Incident ticket identity is unavailable.');const link=el('a','','operator-catalogue-row');link.href='/cockpit/?app=intelligent-operations&ticket='+encodeURIComponent(id);link.target='_top';link.append(el('strong',ticket.title||'Incident '+id.slice(0,8)),el('small','Workflow · '+String(ticket.status||'unknown').replace(/_/g,' ')));ticketList.append(link);}ticketList.append(el('p',rows.length+' Operations tickets in the returned page'+(rows.length>12?' · showing the first 12':'')+'.','operator-note'));}catch(error){if(epoch===ticketEpoch)ticketList.replaceChildren(el('p',error.message));}}
 function inspect(event,pipeline,focus=true){if(focus)show('events');const view=$('event-detail'),alert=event.normalized?.data||{},resource=alert.resource||{},source=records.sources.find(s=>s.id===event.sourceId);view.dataset.eventId=event.id;view.replaceChildren(el('p',event.decision,'operator-badge '+(event.decision==='quarantined'?'attention':'')),el('h2',alert.alertType||'Unrecognized event'),factList([['Received',stamp(event.receivedAt)],['Source',source?.name||event.sourceId],['Environment',alert.environment],['Severity',alert.severity],['Alert status',alert.status],['Resource',resource.id],['Scope',resource.scope]]));
  const decisions=(pipeline.decisions||[]).filter(d=>d.deliveryId===event.id),steps=el('ol','','operator-timeline');
  const step=(title,body)=>{const item=el('li');item.append(el('strong',title),el('p',body));steps.append(item);};
  step('1 · Identity validation',event.decision==='validated'?'Accepted with a normalized source and resource identity.':JSON.stringify(event.reasons||'Validation details unavailable.'));
  if(!decisions.length)step('2 · Filtering','No evaluation in the returned decision page. Open Flow and refresh processing to read saved decisions.');
  for(const decision of decisions){step('2 · Stored-query filtering',decision.outcome+' · '+stamp(decision.at));if(decision.reduction)step('3 · Noise reduction',decision.reduction.outcome+' · symptom '+(decision.reduction.symptomKey||'not returned'));}
  const work=(records.processing||[]).filter(w=>w.delivery_id===event.id);for(const item of work)step('4 · Processing',String(item.state)+(item.last_error?' · '+item.last_error:''));view.append(el('h3','Decision trail'),steps);
  const attempts=(records.attempts||[]).filter(a=>a.deliveryId===event.id);view.append(el('h3','Delivery attempts'),el('p',event.ingestion==='historical-manual-import'?'Historical manual import: no transactional delivery ledger was recorded.':attempts.length+' attempts in the latest returned page. Retries reuse the delivery; conflicting input does not replace its original.','operator-note'));for(const attempt of attempts){const item=el('details','','operator-advanced');item.append(el('summary',attempt.outcome+' · '+stamp(attempt.receivedAt)),el('pre',JSON.stringify(attempt,null,2)));view.append(item);}
  const raw=el('details','','operator-advanced');raw.append(el('summary','Original payload and complete decision records'),el('pre',JSON.stringify({event,processing:work,decisions,attempts},null,2)));view.append(raw);if(focus){view.focus();view.scrollIntoView({block:'nearest'});}
 }
 const decision=params.get('decision');if(['validated','quarantined'].includes(decision))$('decision').value=decision;
 document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const page=link.getAttribute('href').slice(1);if(root.self!==root.top&&tools[page]){event.preventDefault();navigate(page);}});
 return {update,clear,show,inspect,updatePipeline:pipeline=>{const event=records.events.find(e=>e.id===$('event-detail').dataset.eventId);if(event)inspect(event,pipeline,false);},selectionChanged,loadTickets,navigate,source:()=>params.get('source')||''};
}
root.OperationsWorkspace={mount,navigate};
})(window);
