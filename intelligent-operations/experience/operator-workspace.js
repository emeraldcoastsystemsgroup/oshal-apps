/* CHANGE LOG: installations fourth review | maintainer@emeraldcoastsystemsgroup.com | What a fourth review proved (2026-11-04). An alert the server says is reported cleared and being confirmed is listed in those words and turns nothing red, because a healthy server read Critical alert firing for as long as the hold lasted. A critical stays on the tile and the edge as a server goes Late, and shows on a server that only sends alerts, so the tile no longer goes red, amber, red. The empty sentence says what the read shows, no installation has reported yet, and names a mapped source waiting for its first report, instead of telling a person who wired something that nothing is wired. Hash changes and tab returns leave a read inside its deadline to finish, so they cannot pile up and starve the browser's connections. A refused stop reads at once, and a stop that went through takes the card away even if the read after it fails. A failed Refresh records no longer ends the reading: the rows stay, marked as failed, the poll keeps reading, and a read that succeeds retries the records. An announcement under failed reads says reads are failing. */
/* CHANGE LOG: installations third review | maintainer@emeraldcoastsystemsgroup.com | What a third review proved (2026-11-04). A healthy server was still called Silent after a computer woke, with a read in flight, on a screen making no reads and on a kernel slower than the poll: the standing now moves only by how long reads have been failing while reads are being made, a read counts as failed at 20 seconds, its late answer still counts, and an answer is taken when it is newer than the last one taken. Failing reads keep the 30-second poll. Stop watching follows the server's own state, so failed reads cannot offer it on a healthy server, and a late row no longer offers it; a refusal because the server heard from it again says so. A critical alert firing stops the tile, the card's edge and the mark saying healthy, and Overview names it. Nothing says Firing now or Healthy under a failed read, and Overview counts what fired at its last report on a late row. During the watch's grace a Late card names the time of the alarm. Overview tells an account with nothing wired whose records these are. A press on the second button at the first press's spot says why it did nothing. A refusal that empties the page brings its reason into view, a choice that expires does not jump the page back, and the chart's tip is opaque and out of the glass finish. */
/* CHANGE LOG: installations second review | maintainer@emeraldcoastsystemsgroup.com | What a second review proved (2026-11-04). The page called a healthy server Late and Silent with no failed read, on any screen that makes no reads, in a tool frame and after a computer woke: the standing now moves with its age only while reads are failing, the page reads on every screen that shows monitoring, and a read older than two polls is made at once. Nothing is said in the present tense about a late row or under a failed read. A silence longer than the chart's range says there is no report in it. A refusal to stop watching stays in view, and a poll that takes the buttons away no longer moves the page. A second press at the first press's spot is ignored, because the second button can land under a pointer in a short frame. Overview's count leaves out the silence alarm, the health mark shows only on a reporting row, and the grace line says what the grace does. */
/* CHANGE LOG: installations review | maintainer@emeraldcoastsystemsgroup.com | What an independent review proved on these screens (2026-11-03). The screen is built once and filled in place, keyed by source, check, alert and metric, so a poll keeps focus, a selection, the tooltip and the scroll position. Stop watching: the second press is its own button below the note, ignores a double click and a held key, lasts ten seconds and disarms when the row reports again; the note says the history is deleted; a refused stop says so on the card, a failed one keeps its own line through polls. Standing follows the age with the server's thresholds, so failed reads turn a row Late or Silent, Overview carries the failed-read warning, a read unanswered after ten seconds counts as failed, a read happens at once on returning to the tab or to Overview, Systems or Sources, and Sources' Monitoring line stays current. A silent row titles its alerts Firing when last heard and never says nothing is firing. The tile is green only when every row reports and is healthy, swaps in and back in place, updates its screen-reader text and leaves with the rest on a refusal, which also sets the status line. The promise of an alarm follows the silence watch: when it last ran, or a plain warning when overdue. Overview names every failing check and keeps the facts' staleness, and marks each row with its health; a reporting card that is not healthy is no longer edged green. Charts run over the chosen range ending at the server's now, so a silence is empty space; a lone report is a dot; tick text is HTML that keeps its size and fits; times are real ranges and values are called averages; a finger scrolls the page and the tip stays inside the figure; arrow keys and a change of standing are spoken through live regions. An empty Systems says the records belong to the account that wired them instead of sending a person to reinstall. Recent events name their source. */
/* CHANGE LOG: installations | maintainer@emeraldcoastsystemsgroup.com | Monitored installations (Roger, 2026-11-03: "i dont see any proof that the dev droplet is being monitored"): each installation that reports here, when it was last heard, every check with its reading, what is firing and its charts, on Systems and in short on Overview, refreshed every 30 seconds while either page is open. An installations tile replaces the amber "Live inventory: Off" when installations report and no cluster discovery is on; a source says when it was last heard. This code sits in this bound asset because a new asset path would change the catalog and suspend every assignment. */
/* CHANGE LOG: overview tickets | maintainer@emeraldcoastsystemsgroup.com | The incident card reads every ticket the person owns and keeps the Operations ones (the catalogue's own 10,000 budget); its 1,000 cap on the whole list made the card say "Incident work response is unavailable" for an operator with 2,241 tickets of other applications (the Spark, 2026-11-03). Rows carry their alert label. */
/* CHANGE LOG: overview KPIs | maintainer@emeraldcoastsystemsgroup.com | Overview opens with an operational KPI strip (what needs you, unverified recovery, firing anomalies, degraded systems, live inventory age, recorded events), each a large tabular number that opens its page; the record counts stay below as secondary detail. */
/* CHANGE LOG: overview schedule | maintainer@emeraldcoastsystemsgroup.com | Overview says when the processing schedule is suspended (an authority-changing release needs the owner) and re-activates it on the person's click; it counts delegations from other swarms not yet filed. */
/* CHANGE LOG: overview actions | maintainer@emeraldcoastsystemsgroup.com | Needs attention lists what waits on the operator (report approvals, response plans to approve, unverified executions, overdue break-glass reconciliations, firing anomaly baselines); incident work gets status chips that default to what needs the operator. */
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
const factList=values=>{const dl=el('dl','','operator-facts');for(const [name,value,monitoring]of values){const dt=el('dt',name),dd=el('dd',value===undefined||value===null?'Not recorded':String(value));if(monitoring){dd.dataset.monitoring=monitoring;dt.hidden=dd.hidden=!value;}dl.append(dt,dd);}return dl;};
const stamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Not recorded';
const tools={overview:'operations-workspace',systems:'operations-estate',data:'operations-data',sources:'operations-sources',estate:'operations-topology',streams:'operations-streams',replay:'operations-replay',connections:'operations-connections',credentials:'operations-credentials',library:'operations-library'};
/** @description Keep cross-screen navigation on the manifest-owned shell rail; standalone views use the same local URL. */
function navigate(page,params={}){
 const query=new URLSearchParams(params).toString();
 if(root.self!==root.top&&tools[page])root.parent.postMessage({type:'app-navigate',tool:tools[page],query},location.origin);
 else {const url=new URL(location.href);url.hash=page;url.search=query;location.assign(url.href);}
}
/** @description Mount presentation-only controls. All mutations remain in the existing explicitly invoked controllers. */
function mount({onInspect,onEvents,onRefused,onReadsBack}){
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
 const attention=el('article','','card'),activity=el('article','','card'),attentionList=el('div'),activityList=el('div');attentionList.id='overview-attention';const actionList=el('div');actionList.id='overview-actions';activityList.id='overview-activity';attention.append(el('h2','Needs attention'),el('p','What waits on you now, then issues in the latest returned records.','operator-note'),actionList,attentionList);activity.append(el('h2','Source activity'),el('p','Most recent receipt per source in the loaded event page.','operator-note'),activityList);overviewGrid.append(attention,activity);
 const tickets=el('article','','card'),ticketList=el('div');ticketList.id='overview-tickets';tickets.append(el('h2','Incident work'),el('p','Your canonical Operations tickets. Report acceptance and service recovery are separate states.','operator-note'),button('Refresh incident work',loadTickets),ticketList);
 const kpiStrip=el('div','','ops-kpis');kpiStrip.id='overview-kpis';kpiStrip.setAttribute('aria-label','Operations at a glance');metrics.classList.add('ops-secondary-metrics');
 const installationsBrief=el('article','','card installations-brief');installationsBrief.id='overview-installations';installationsBrief.hidden=true;
 let installationsTile=null,inventoryTile=null,discoveryOn=false;
 const installations=root.OperationsInstallations?.mount({overview:installationsBrief,systems:$('installations'),navigate,onRefused:code=>{onRefused();const said=$('status');said.textContent=code===401?'Sign in through OSHAL to continue.':'Your current OSHAL role does not permit this operation.';/* The page just emptied: in a short frame the reason would sit above the view. */said.scrollIntoView({block:'nearest'});},onUpdate:paintInstallations,onRead:onReadsBack,sources:()=>records.sources});
 overview.replaceChildren(kpiStrip,installationsBrief,overviewGrid,tickets,metrics);
 const ago=at=>{const m=Math.round((Date.now()-Date.parse(at))/60000);return Number.isNaN(m)?'unknown':m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago';};
 /** One KPI tile: a large tabular number, its label, one line of detail; the tile opens its page. */
 function kpi(label,value,detail,tone,page){const t=button('',()=>page==='tickets'?(ticketFilter='needs',renderTickets(),ticketList.scrollIntoView({block:'start'})):navigate(page));t.className='ops-kpi'+(tone?' '+tone:'');t.append(el('span',label,'ops-kpi-label'),el('strong',value==null?'—':String(value),'ops-kpi-value'),el('small',detail,'ops-kpi-detail'));t.setAttribute('aria-label',label+': '+(value==null?'unavailable':value)+'. '+detail);return t;}
 async function loadKpis(epoch,rows){const read=async path=>{const r=await fetch('/api/intelligent-operations'+path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw Error('HTTP '+r.status);return r.json();};
  const n=label=>rows.find(r=>r[0]===label)?.[1]??null,sum=(...labels)=>labels.map(n).reduce((a,b)=>b==null?a:(a??0)+b,null);
  let graph=null,discovery=null;try{[graph,discovery]=await Promise.all([read('/topology').catch(()=>null),read('/topology/discovery').catch(()=>null),installations?.loaded()]);}catch{}
  if(epoch!==ticketEpoch)return;
  const assets=graph?.assets||[],degraded=assets.filter(a=>a.health==='degraded').length,unknown=assets.filter(a=>a.health==='unknown').length,needs=sum('Response plans awaiting approval','Reports awaiting your approval','Delegations from other swarms not yet filed'),unverified=n('Executions without verified recovery'),firing=n('Anomaly baselines firing');
  const last=discovery?.lastResult,inventory=!discovery?.enabled?['Off','Turn on scheduled discovery in Systems','warn']:last?.state==='saved'?[ago(last.observedAt||last.attemptAt),'Every '+discovery.intervalMinutes+' min · '+last.assets+' assets saved','good']:last?[last.state,last.error||'See Systems','bad']:['Waiting','First scheduled read is due','warn'];
  const quarantined=records.events.filter(e=>e.decision==='quarantined').length,s=installations?.summary();discoveryOn=Boolean(discovery?.enabled);inventoryTile=kpi('Live inventory',inventory[0],inventory[1],inventory[2],'systems');installationsTile=s?.total&&!discoveryOn?kpi('Installations reporting',s.reporting+' of '+s.total,s.detail,s.tone,'systems'):null;
  kpiStrip.replaceChildren(
   kpi('Needs you',needs,'Plans, reports and hand-offs to decide',needs?'warn':'good','tickets'),
   kpi('Unverified recovery',unverified,'Executions without a healthy check',unverified?'bad':'good','incidents'),
   kpi('Anomalies firing',firing,'Live baselines over threshold',firing?'bad':'good','streams'),
   kpi('Degraded systems',graph?degraded:null,graph?assets.length+' assets · '+unknown+' unknown':'Inventory unavailable',degraded?'bad':'good','systems'),
   installationsTile||inventoryTile,
   kpi('Events recorded',records.events.length,quarantined+' quarantined in the loaded page',quarantined?'warn':'','data'));
 }
 /** The tile says what a person monitoring servers wants to know first; cluster discovery keeps its own when it is on. The slot follows the installations in place: the first one swaps the tile in, the last one swaps Live inventory back, and the number, tone and screen-reader text change together. */
 function paintInstallations(s){
  if(!inventoryTile)return;const wanted=s.total>0&&!discoveryOn,value=s.reporting+' of '+s.total;
  if(wanted&&!installationsTile){installationsTile=kpi('Installations reporting',value,s.detail,s.tone,'systems');inventoryTile.replaceWith(installationsTile);return;}
  if(!wanted){if(installationsTile){installationsTile.replaceWith(inventoryTile);installationsTile=null;}return;}
  installationsTile.querySelector('.ops-kpi-value').textContent=value;installationsTile.querySelector('.ops-kpi-detail').textContent=s.detail;for(const tone of ['good','warn','bad'])installationsTile.classList.toggle(tone,s.tone===tone);installationsTile.setAttribute('aria-label','Installations reporting: '+value+'. '+s.detail);
 }
 function selectionChanged(count){selection.textContent=count+' events selected. Selection is retained when you change filters.';}
 /** @param keepInstallations A refresh on its way, or one that failed without a refusal: the installations keep their rows and their reading. Access withdrawn clears them with the rest. */
 function clear(keepInstallations){installationsTile=inventoryTile=null;kpiStrip.replaceChildren();if(keepInstallations!==true)installations?.clear();++ticketEpoch;deepLinked=false;$('event-detail').dataset.eventId='';ticketList.replaceChildren(el('p','Refresh to read your authorized incident work.'));records={sources:[],events:[],inventory:[]};selectedSource='';renderSources();renderOverview();attentionList.replaceChildren(el('p','Refresh to read your authorized records.'));activityList.replaceChildren();selectionChanged(0);}
 function update(next){records=next;const old=sourceSelect.value;sourceSelect.replaceChildren(new Option('All source revisions',''));for(const source of records.sources)sourceSelect.append(new Option(source.name+' · '+source.environment,source.id));sourceSelect.value=records.sources.some(s=>s.id===old)?old:'';
  if(!deepLinked){deepLinked=true;const source=params.get('source');if(records.sources.some(s=>s.id===source)){selectedSource=source;sourceSelect.value=source;$('policy-source').value=source;}
   const event=records.events.find(e=>e.id===params.get('event'));if(event)onInspect(event);
  }
  renderSources();renderOverview();onEvents();void installations?.load().then(()=>{renderSources();renderOverview();});
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
  sourceDetail.append(el('p',source.environment,'eyebrow'),el('h2',source.name),factList([['Source URI',source.source],['Revision',source.id],['Monitoring',installations?.heardFor(source.id)||'',source.id],['Last loaded receipt',stamp(latest)],['Loaded events',events.length],['Quarantined',events.filter(e=>e.decision==='quarantined').length]]));
  const actions=el('div','','operator-toolbar');actions.append(button('Inspect source events',()=>openEvents(source.id)),button('Configure rules',()=>navigate('data',{pane:'rules',source:source.id})),button('Record test event',()=>{sourceSetup.open=true;$('event-source').value=source.id;$('event-json').focus();}));sourceDetail.append(actions,el('h3','Inbound identity mapping'),el('p','Envelope source and event ID are required. The adapter reads these JSON Pointer paths.','operator-note'));
  sourceDetail.append(factList(Object.entries(source.mapping||{})));if(!source.mapping)sourceDetail.append(el('p','Mapping was not returned. Refresh before making changes.'));
  sourceDetail.append(el('h3','Collection and access'),el('p','This definition normalizes alerts. Configure telemetry retention separately and use your authorized monitoring connection to collect data.'),button('Open live context',()=>navigate('streams')),button('Open connections',()=>navigate('connections')));
 }
 function renderOverview(){
  attentionList.replaceChildren();activityList.replaceChildren();const quarantined=records.events.filter(e=>e.decision==='quarantined'),failed=(records.processing||[]).filter(p=>['attention','evidence-attention','retry','evidence-retry'].includes(p.state));
  for(const [label,items,pane]of [['Quarantined events',quarantined,'events'],['Processing needs review',failed,'automation']]){const row=el('div','','operator-summary-row');row.append(el('strong',String(items.length)),el('span',label),button('Review',()=>navigate('data',{pane,...(pane==='events'?{decision:'quarantined'}:{})})));attentionList.append(row);}
  const recent=records.events.slice().sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt)).slice(0,5);attentionList.append(el('h3','Recent events'));
  for(const event of recent){const source=records.sources.find(s=>s.id===event.sourceId),row=button('',()=>navigate('data',{pane:'events',event:event.id}));row.className='operator-catalogue-row';row.append(el('strong',event.normalized?.data?.alertType||'Unrecognized event'),el('small',(source?.name||'Source '+String(event.sourceId).slice(0,12))+' · '+event.decision+' · '+stamp(event.receivedAt)));attentionList.append(row);}if(!recent.length)attentionList.append(el('p','No event records have been returned.'));
  const rows=records.sources.map(s=>({source:s,events:records.events.filter(e=>e.sourceId===s.id)})).sort((a,b)=>b.events.length-a.events.length).slice(0,8);
  for(const {source,events}of rows){const latest=events.slice().sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt))[0],row=button('',()=>navigate('sources',{source:source.id}));row.className='operator-catalogue-row';row.append(el('strong',source.name),el('small',source.environment+' · '+events.length+' loaded events'),el('small',latest?'Last alert '+stamp(latest.receivedAt):'No alert in the loaded page'));const monitoring=installations?.heardFor(source.id),line=el('small',monitoring||'');line.dataset.monitoring=source.id;line.hidden=!monitoring;row.append(line);activityList.append(row);}
  if(!rows.length)activityList.append(el('p','No named sources have been returned.'));activityList.append(button('Manage sources',()=>navigate('sources')));
 }
 const TICKET_FILTERS=[['needs','Needs you',t=>t.status==='awaiting_approval'],['active','In progress',t=>['queued','running','blocked','draft'].includes(t.status)],['done','Done',t=>t.status==='done'],['failed','Failed or cancelled',t=>['failed','cancelled'].includes(t.status)],['all','All',()=>true]];
 let ticketRows=[],ticketFilter=null;
 /** @description Status chips with counts; the default is what needs the operator, so stale or finished tickets do not bury the actionable ones. */
 function renderTickets(){ticketList.replaceChildren();const chips=el('div','','ticket-filters');chips.setAttribute('role','group');chips.setAttribute('aria-label','Filter incident work');
  if(!ticketFilter)ticketFilter=ticketRows.some(TICKET_FILTERS[0][2])?'needs':ticketRows.some(TICKET_FILTERS[1][2])?'active':'all';
  for(const [key,label,match]of TICKET_FILTERS){const count=ticketRows.filter(match).length,b=button(label+' · '+count,()=>{ticketFilter=key;renderTickets();});b.className='ticket-filter';b.setAttribute('aria-pressed',String(ticketFilter===key));chips.append(b);}ticketList.append(chips);
  const match=TICKET_FILTERS.find(f=>f[0]===ticketFilter)[2],rows=ticketRows.filter(match);
  for(const ticket of rows.slice(0,12)){const id=ticket.id||ticket.ticketId;if(typeof id!=='string'||!id)continue;const link=el('a','','operator-catalogue-row');link.href='/cockpit/?app=intelligent-operations&ticket='+encodeURIComponent(id);link.target='_top';const status=String(ticket.status||'unknown');link.append(el('strong',ticket.title||'Incident '+id.slice(0,8)),el('small','Workflow · '+status.replace(/_/g,' ')+(status==='awaiting_approval'?' · review the report, then respond in Incident work':'')));ticketList.append(link);}
  if(!rows.length)ticketList.append(el('p','No tickets in this view.','operator-note'));
  ticketList.append(el('p',ticketRows.length+' Operations tickets in the returned page'+(rows.length>12?' · showing the first 12 of '+rows.length+' in this view':'')+'.','operator-note'));}
 async function loadTickets(){const epoch=++ticketEpoch;ticketList.replaceChildren(el('p','Reading incident work…'));try{const response=await fetch('/api/tickets',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(epoch!==ticketEpoch)return;if(!response.ok){if([401,403].includes(response.status))onRefused();throw Error('Incident work unavailable (HTTP '+response.status+').');}const body=await response.json();if(epoch!==ticketEpoch)return;if(!Array.isArray(body.tickets))throw Error('Incident work response is unavailable.');ticketRows=root.OperationsRcaLibrary.catalogue(body);const labels=await root.OperationsRcaLibrary.loadInvestigationLabels();if(epoch!==ticketEpoch)return;for(const row of ticketRows){const label=labels.get(row.id);if(label)row.title=label;}if(ticketRows.some(t=>typeof (t.id||t.ticketId)!=='string'))throw Error('Incident ticket identity is unavailable.');renderTickets();void loadActions(epoch);}catch(error){if(epoch===ticketEpoch)ticketList.replaceChildren(el('p',error.message));}}
 /** @description Response plans and detectors that wait on the operator: approvals to grant, executions to verify, overdue break-glass reconciliations and firing anomaly baselines. Unreadable sources stay explicit. */
 async function loadActions(epoch){const host=$('overview-actions');if(!host)return;host.replaceChildren();const read=async path=>{const r=await fetch('/api/intelligent-operations'+path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok){if([401,403].includes(r.status))onRefused();throw Error('HTTP '+r.status);}return r.json();};
  const rows=[];try{const plans=(await read('/executions')).items||[];if(epoch!==ticketEpoch)return;const unapproved=plans.filter(p=>!p.invalidated&&(!p.approval||p.approval.expired)&&!(p.executions||[]).length).length,unverified=plans.filter(p=>(p.executions||[]).some(e=>e.state!=='reserved-outcome-unknown'&&e.recovery?.outcome!=='healthy')).length,overdue=plans.reduce((n,p)=>n+(p.promotions||[]).filter(r=>r.overdue).length,0);rows.push(['Response plans awaiting approval',unapproved,'incidents'],['Executions without verified recovery',unverified,'incidents'],['Break-glass reconciliations overdue',overdue,'incidents']);}catch{rows.push(['Response plans unavailable',null,'incidents']);}
  try{const anomaly=await read('/anomaly');if(epoch!==ticketEpoch)return;rows.push(['Anomaly baselines firing',(anomaly.baselines||[]).filter(b=>b.firing).length,'streams']);}catch{rows.push(['Anomaly detector unavailable',null,'streams']);}
  rows.push(['Reports awaiting your approval',ticketRows.filter(t=>t.status==='awaiting_approval').length,'tickets']);
  try{const [box,mine]=await Promise.all([fetch('/api/v1/peer-inbox',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}}).then(r=>r.ok?r.json():Promise.reject(Error('HTTP '+r.status))),read('/delegations')]);if(epoch!==ticketEpoch)return;const filedIds=new Set((mine.items||[]).filter(r=>r.direction==='inbound').map(r=>r.inboxId));rows.push(['Delegations from other swarms not yet filed',(box.delegations||[]).filter(d=>!filedIds.has(d.id)).length,'swarms']);}catch{rows.push(['Swarm inbox unavailable',null,'swarms']);}
  let schedule=null;try{const r=await fetch('/api/v1/agent/schedules',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(r.ok)schedule=((await r.json()).schedules||[]).find(x=>x.app==='intelligent-operations')||null;}catch{}
  if(epoch!==ticketEpoch)return;
  if(schedule&&schedule.status!=='active'){const row=el('div','','operator-summary-row');row.append(el('strong','!'),el('span','Processing schedule is '+schedule.status+(schedule.reason?' ('+schedule.reason+')':'')+'. Re-approving your Operations role suspends it; re-activate it under the new approval.'));const b=button('Re-activate',async()=>{b.disabled=true;try{const r=await fetch('/api/v1/agent/schedules/'+encodeURIComponent(schedule.id)+'/activate',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({class:'person'})});if([401,403].includes(r.status)){onRefused();return;}if(!r.ok)throw Error('HTTP '+r.status);void loadActions(ticketEpoch);}catch(e){b.disabled=false;row.append(el('small',' Re-activation refused: '+e.message));}});row.append(b);host.append(row);}
  else if(schedule)rows.push(['Processing schedule suspended',0,'data']);
  void loadKpis(epoch,rows);
  for(const [label,count,page]of rows){const row=el('div','','operator-summary-row');row.append(el('strong',count===null?'—':String(count)),el('span',label),button(page==='tickets'?'Show':'Open',()=>{if(page==='tickets'){ticketFilter='needs';renderTickets();ticketList.scrollIntoView({block:'start'});}else navigate(page);}));if(count===0)row.classList.add('quiet');host.append(row);}}
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

/* Monitored installations: the proof that a server is being watched. Every value below arrives from the server as text or a number and reaches the page through textContent. The screen is built once and filled in place on every read, keyed by source, check, alert and metric, so focus, a text selection, a held tooltip and an open table survive a poll and the page never moves. */
(function(root){
'use strict';
const API='/api/intelligent-operations',SVG='http://www.w3.org/2000/svg';
const el=(tag,value='',cls='')=>{const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;};
const shape=(tag,attrs={})=>{const node=document.createElementNS(SVG,tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node;};
const STANDING={reporting:'Reporting',late:'Late',silent:'Silent',never:'Not reporting yet'};
const CHECK={ok:['✓','OK'],warn:['!','Warning'],bad:['✕','Problem'],unknown:['?','Not reported']};
/** The overall mark on Overview, in the check marks' own vocabulary; a blind core check is never called healthy. */
const HEALTH={healthy:['ok','Healthy'],degraded:['bad','Degraded'],unknown:['unknown','Not all checks report']},ALERTING=['bad','Critical alert firing'];
/** A critical alert firing means not well, whatever the checks say; the silence alarm is what the Silent badge already says, and one the server says was reported cleared and is being confirmed is not firing. */
const criticalOf=row=>(row.firing||[]).filter(a=>a.severity==='critical'&&a.alertType!=='InstallationSilent'&&!a.clearing);
const CLEARING='reported cleared, confirming';
const alertNames=row=>{const list=criticalOf(row);return list.slice(0,3).map(a=>a.alertType+(a.service?' ('+a.service+')':'')).join(', ')+(list.length>3?' and '+(list.length-3)+' more':'');};
const RANGES=[[1,'Last 24 hours'],[7,'Last 7 days'],[14,'Last 14 days']];
/** A rate keeps two significant digits below 1, so a quiet kernel's 0.033 a second never reads 0.0 and an axis top never equals its bottom. */
const rate=v=>v===0?'0':v>=10?v.toFixed(0):v>=1?v.toFixed(1):String(+v.toPrecision(2));
/** Metric, title, value format, fixed domain, and a shorter format for the axis where the value's own would not fit. */
const CHARTS=[['site_seconds','Site response time',v=>v.toFixed(2)+' s',null,v=>+v.toPrecision(3)+' s'],['site_up','Site availability',v=>Math.round(v*100)+'%',[0,1]],['cpu_used','Processor busy',v=>Math.round(v)+'%',[0,100]],['memory_used','Memory used',v=>Math.round(v)+'%',[0,100]],['disk_used','Disk used',v=>Math.round(v)+'%',[0,100]],['http_rate','Kernel requests a second',rate,null]];
/** The plot's own drawing box; its tick text is HTML beside it, so the text keeps its size however narrow the chart gets. */
const W=320,H=84,L=4,R=6,T=6,B=4;
/** The screens that show monitoring; the page reads while one of them is on screen, however the address got there. */
const VIEWS=['overview','systems','sources'];
/** The second press stays this long, and ignores anything sooner than the lock: a key bounce or a slow double press is not a decision. */
const ARM_MS=10000,ARM_LOCK_MS=400,POLL_MS=30000,TICK_MS=5000,ARM_AWAY_PX=24;
/** A read unanswered at the first counts as failed, though its answer still counts if it comes, because reads queue behind a long tick. The kernel ends a package call at 60 seconds, so by the second nothing can answer and the read is aborted. */
const READ_DEADLINE_MS=20000,READ_ABORT_MS=65000;
const STOP_NOTE='For a server you retired. This deletes its chart history, its readings and its host in Systems, and closes its silence alarm; its source, alerts and investigations stay. A server that is still running comes back with its next report.';
const when=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'not recorded';
const clock=ms=>new Date(ms).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const stamp=ms=>new Date(ms).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
/** @description An age in the words a person reads, from seconds. */
function ago(seconds){if(!Number.isFinite(seconds))return 'never';if(seconds<90)return Math.max(0,Math.round(seconds))+' s ago';if(seconds<5400)return Math.round(seconds/60)+' min ago';if(seconds<172800)return Math.round(seconds/3600)+' h ago';return Math.round(seconds/86400)+' d ago';}
/** @description The next clean axis top above a value: 1, 2 or 5 times a power of ten. */
function clean(value){if(!(value>0))return 1;const power=10**Math.floor(Math.log10(value));for(const step of [1,2,5,10])if(value<=step*power)return step*power;return 10*power;}
/** @description A bucket's real extent. Its key is when the bucket opened, not when a report came, so it is clamped to the range, the first report and the newest one. */
function spanOf(start,view){const end=Math.min(start+view.bucket,view.last||view.now,view.now),from=Math.max(start,view.since,view.first);return [Math.min(from,end),end];}
const rangeText=([from,to])=>stamp(from)===stamp(to)?stamp(from):stamp(from)+' to '+(new Date(from).toDateString()===new Date(to).toDateString()?clock(to):stamp(to));
/** @description Write text only where it changed, and never under a person's selection: that one value waits for the next read while they hold it. */
function put(node,value){if(node.textContent===value)return;const held=root.getSelection?.();if(held&&!held.isCollapsed&&(node.contains(held.anchorNode)||node.contains(held.focusNode)))return;node.textContent=value;}
/** @description A slot that exists only while it has something to say: empty, it has no class, no text and no box. A warning and a standing are written whatever is selected, because a selection must not keep a false one on screen. */
function say(node,cls,value){const next=value?cls:'',text=value||'';if(node.className!==next)node.className=next;node.hidden=!value;if(node.textContent!==text)node.textContent=text;}
function paintBadge(badge,state){const cls='installation-state '+state,text=STANDING[state]||state;if(badge.className!==cls)badge.className=cls;if(badge.textContent!==text)badge.textContent=text;}
const fills=new WeakMap();
const filled=(node,fill)=>{fills.set(node,fill);return node;};
/** @description Keep a parent's children matching a list by key: a kept child stays the same element, so focus and a selection inside it survive. @param parent The element. @param items The list. @param attr The dataset key that identifies a child. @param keyOf An item's key. @param make Builds a child with filled(). @returns Nothing. */
function sync(parent,items,attr,keyOf,make){
 const kept=new Map([...parent.children].map(n=>[n.dataset[attr],n]));let at=parent.firstElementChild;
 for(const item of items){const key=String(keyOf(item));let node=kept.get(key);if(node)kept.delete(key);else{node=make(item);node.dataset[attr]=key;}fills.get(node)(item);if(node===at)at=at.nextElementSibling;else parent.insertBefore(node,at);}
 for(const node of kept.values())node.remove();
}
/** @description One metric as a thin line over the chosen range, which ends at the server's now: one series, so its caption names it and no legend is drawn. A gap in the reports stays a gap in the line and a silence stays empty space, because that is the finding; a lone report between two gaps is a dot. The crosshair snaps to the nearest point on pointer or arrow keys, and the keys speak through the card's live region. @param def One CHARTS row. @param speak Writes to the card's live region. @returns The figure, and draw(points,view) that fills it in place. */
function chart(def,speak){
 const [key,title,format,domain]=def,tick=def[4]||format,figure=el('figure','','installation-chart'),caption=el('figcaption'),value=el('strong','—','installation-chart-value'),note=el('small','','installation-chart-note'),empty=el('p','','operator-note'),box=el('div','','installation-plotbox'),top=el('span','','installation-tick top'),low=el('span','','installation-tick low'),times=el('div','','installation-times'),from=el('span'),to=el('span'),graph=shape('svg',{viewBox:'0 0 '+W+' '+H,class:'installation-plot','aria-hidden':'true'}),tip=el('div','','installation-tip');
 let points=[],view=null,at=0,heldAt=null,x=()=>L,hair=null;
 figure.dataset.metric=key;tip.hidden=true;/* The glass finish made the tip see-through over the axis text it covers. */tip.dataset.noGlass='';caption.append(el('span',title,'installation-chart-title'),value,note);box.append(top,low,graph);times.append(from,to);figure.append(caption,empty,box,times,tip);
 const nearest=t=>{let best=0;points.forEach((p,i)=>{if(Math.abs(p[0]-t)<Math.abs(points[best][0]-t))best=i;});return best;};
 /** The tip sits beside the point and is held inside the figure by its measured width. */
 const place=px=>{const plot=graph.getBoundingClientRect(),frame=figure.getBoundingClientRect(),cx=plot.left-frame.left-figure.clientLeft+px/W*plot.width,room=figure.clientWidth,width=tip.offsetWidth;let left=cx+10;if(left+width>room-2)left=cx-width-10;tip.style.left=Math.max(2,Math.min(room-width-2,left))+'px';tip.style.top=box.offsetTop+'px';};
 const show=(i,aloud)=>{at=Math.max(0,Math.min(points.length-1,i));const p=points[at],px=x(p[0]),range=rangeText(spanOf(p[0],view)),spread='Low '+format(p[2])+', high '+format(p[3]);heldAt=p[0];hair.setAttribute('x1',px);hair.setAttribute('x2',px);hair.setAttribute('visibility','visible');tip.replaceChildren(el('strong',format(p[1])+' average'),el('span',range),el('small',spread));tip.hidden=false;place(px);if(aloud)speak(title+': '+format(p[1])+' average, '+range+'. '+spread+'.');};
 const hide=()=>{hair?.setAttribute('visibility','hidden');tip.hidden=true;at=Math.max(0,points.length-1);};
 figure.addEventListener('pointermove',e=>{if(!points.length)return;const plot=graph.getBoundingClientRect();show(nearest(view.since+((e.clientX-plot.left)/plot.width*W-L)/(W-L-R)*(view.now-view.since)));});
 figure.addEventListener('pointerleave',hide);figure.addEventListener('pointercancel',hide);figure.addEventListener('focus',()=>{if(points.length)show(at);});figure.addEventListener('blur',hide);
 figure.addEventListener('keydown',e=>{if(!points.length)return;if(e.key==='ArrowLeft'){e.preventDefault();show(at-1,true);}else if(e.key==='ArrowRight'){e.preventDefault();show(at+1,true);}else if(e.key==='Escape')hide();});
 function draw(next,v){
  const held=!tip.hidden,latest=next.at(-1),range=latest?rangeText(spanOf(latest[0],v)):'';points=next;view=v;
  put(empty,v.reported?'No report in this range.':'Not reported yet.');put(value,latest?format(latest[1]):'—');put(note,latest?(v.lastKnown?'Last reported average, ':'Average, ')+range:'');empty.hidden=Boolean(latest);box.hidden=times.hidden=!latest;
  if(!latest){hide();for(const name of ['tabindex','role','aria-label'])figure.removeAttribute(name);return;}
  figure.tabIndex=0;figure.setAttribute('role','img');figure.setAttribute('aria-label',title+', '+v.label+', '+(v.lastKnown?'last reported':'latest')+' average '+format(latest[1])+', '+range+'. Arrow keys read each point.');
  const span=Math.max(1,v.now-v.since),floor=domain?domain[0]:0,high=domain?domain[1]:clean(Math.max(...points.flatMap(p=>[p[2],p[3]]),0)),y=n=>T+(1-(Math.min(high,Math.max(floor,n))-floor)/(high-floor))*(H-T-B),base=y(floor).toFixed(1),spot=p=>x(p[0]).toFixed(1)+' '+y(p[1]).toFixed(1),runs=[];
  x=t=>L+(Math.min(v.now,Math.max(v.since,t))-v.since)/span*(W-L-R);
  for(const p of points){const run=runs.at(-1);if(run&&p[0]-run.at(-1)[0]<=v.bucket*1.5)run.push(p);else runs.push([p]);}
  const lines=runs.filter(r=>r.length>1),dots=runs.filter(r=>r.length===1&&r[0]!==latest).map(([p])=>shape('circle',{cx:x(p[0]),cy:y(p[1]),r:3,class:'installation-dot'}));
  hair=shape('line',{y1:T,y2:y(floor),class:'installation-hair',visibility:'hidden'});
  graph.replaceChildren(shape('line',{x1:L,x2:W-R,y1:y(floor),y2:y(floor),class:'installation-axis'}),shape('line',{x1:L,x2:W-R,y1:y(high),y2:y(high),class:'installation-grid'}),shape('path',{d:lines.map(r=>'M'+x(r[0][0]).toFixed(1)+' '+base+'L'+r.map(spot).join('L')+'L'+x(r.at(-1)[0]).toFixed(1)+' '+base+'Z').join(''),class:'installation-wash'}),shape('path',{d:lines.map(r=>'M'+r.map(spot).join('L')).join(''),class:'installation-line'}),...dots,shape('circle',{cx:x(latest[0]),cy:y(latest[1]),r:4,class:'installation-end'}),hair);
  put(top,tick(high));put(low,tick(floor));put(from,stamp(v.since));put(to,stamp(v.now));
  if(held)show(nearest(heldAt));else at=points.length-1;
 }
 return {figure,draw};
}
/** @description Every charted value by time, so nothing on a chart depends on hovering. */
function chartTable(series,view){
 const times=[...new Set(CHARTS.flatMap(([key])=>(series[key]||[]).map(p=>p[0])))].sort((a,b)=>b-a),table=el('table','','installation-table'),head=el('tr');head.append(el('th','Time'));
 for(const [,title]of CHARTS)head.append(el('th',title));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');
 for(const t of times){const row=el('tr');row.append(el('td',rangeText(spanOf(t,view))));for(const [key,,format]of CHARTS){const p=(series[key]||[]).find(v=>v[0]===t);row.append(el('td',p?format(p[1]):'—'));}body.append(row);}table.append(body);return table;
}
function checkRow(){
 const tr=el('tr'),label=el('td'),reading=el('td'),mark=el('td'),icon=el('span','','check-icon'),word=document.createTextNode('');mark.append(icon,word);tr.append(label,reading,mark);
 return filled(tr,check=>{const [i,w]=CHECK[check.state]||CHECK.unknown,cls='check-state '+check.state;put(label,check.label);put(reading,check.reading);if(mark.className!==cls)mark.className=cls;put(icon,i);if(word.data!==' '+w)word.data=' '+w;});
}
function mount({overview,systems,navigate,onRefused,onUpdate,onRead,sources}){
 let rows=[],watch=null,readAt=0,begun=0,accepted=0,waiting=0,failedFor=0,countedAt=0,days=1,poll=null,ticker=null,stale=false,noWrite=false,account=null,unreported=[],unreportedFor='',frame=null,brief=null,lastLoad=Promise.resolve();
 const armed=new Map(),stopErrors=new Map(),stopKept=new Map(),said=new Map(),live=new Map(),announcer=document.getElementById('installations-standing');
 const age=row=>Number.isFinite(row.ageSeconds)?row.ageSeconds+(Date.now()-readAt)/1000:null;
 const watchAge=()=>Number.isFinite(watch?.ageSeconds)?watch.ageSeconds+(Date.now()-readAt)/1000:null;
 /** A read is made only while the tab is visible and a screen that shows monitoring is on it. */
 const showing=()=>document.visibilityState==='visible'&&VIEWS.some(id=>{const view=document.getElementById(id);return view&&!view.hidden;});
 /** The standing shown now: the server's at the last good read, moved on by the server's own thresholds only by the time reads have spent failing. One failed read after an hour asleep, a read still on its way and a screen making no reads say nothing about a server. */
 const shown=row=>{if(row.state==='silent'||row.state==='never'||!stale||!Number.isFinite(row.ageSeconds))return row.state;const a=row.ageSeconds+failedFor/1000;return a>=(row.silentAfterSeconds??600)?'silent':a>=(row.lateAfterSeconds??180)?'late':row.state;};
 const heard=row=>row.state==='never'?'No report yet':'Heard '+ago(age(row));
 const minutes=(seconds,fallback)=>Math.round((seconds??fallback)/60);
 const heardFor=sourceId=>{const row=rows.find(r=>r.sourceId===sourceId);return !row?null:row.state==='never'?STANDING.never:STANDING[shown(row)]+' · '+heard(row)+' · '+row.reports.toLocaleString()+' reports';};
 /** A check's staleness stays on Overview's lines; only the container names are dropped. */
 const named=reading=>reading.replace(/: [^;]*/,'');
 /** @description What Overview says about one row's readings. */
 function briefLine(row,now){
  const check=id=>row.checks.find(c=>c.id===id),parts=[];
  if(now==='silent')parts.push('Silent since '+when(row.silentSince||row.lastHeardAt));
  else if(now==='never')parts.push('No heartbeat yet: this server only sends alerts');
  else{const site=check('site'),containers=check('containers'),disk=check('disk');if(site)parts.push('Site: '+site.reading);if(containers)parts.push(named(containers.reading));if(disk)parts.push('Disk '+disk.reading);}
  const open=row.firing.filter(a=>a.alertType!=='InstallationSilent'&&!a.clearing).length,clearing=row.firing.filter(a=>a.clearing).length,names=alertNames(row);if(open)parts.push(open+(now==='silent'?' firing when last heard':stale?' firing at the last read':now==='late'?' firing at its last report':' firing')+(names?', critical: '+names:''));if(clearing)parts.push(clearing+' '+CLEARING);
  return parts.join(' · ');
 }
 /** Every check in a bad or warning state, by name, so a failing backup does not wait for its alert to reach this line. A silent row's readings are history, and a row that never reported has none. */
 const careLine=(row,now)=>['silent','never'].includes(now)?'':row.checks.filter(c=>['bad','warn'].includes(c.state)).map(c=>CHECK[c.state][1]+': '+c.label+', '+(c.id==='containers'?named(c.reading):c.reading)).join(' · ');
 function briefRow(first){
  const line=el('button'),top=el('span','','installation-row-top'),name=el('strong'),badge=el('span'),mark=el('span'),icon=el('span','','check-icon'),word=el('span'),seen=el('small'),detail=el('small'),care=el('small');
  line.type='button';line.addEventListener('click',()=>navigate?.('systems'));seen.dataset.heard=first.sourceId;mark.append(icon,word);top.append(name,badge,mark);line.append(top,seen,detail,care);
  return filled(line,row=>{const now=shown(row),current=now==='reporting'&&!stale,[state,text]=criticalOf(row).length?ALERTING:HEALTH[row.health]||HEALTH.unknown;line.className='operator-catalogue-row installation-row '+now;put(name,row.name);paintBadge(badge,now);mark.hidden=!current;mark.className='installation-health check-state '+state;put(icon,CHECK[state][0]);put(word,text);put(seen,heard(row));put(detail,briefLine(row,now));say(care,'installation-row-care',careLine(row,now));});
 }
 function alarmText(row,now){
  if(now==='silent')return row.state==='silent'?'Operations has not heard from this installation since '+when(row.silentSince||row.lastHeardAt)+'. The server, its monitoring or the path to this Operations is down. The readings below are the last ones it sent.'+(row.heartbeatEndedAt?' Its Alertmanager reported at '+when(row.heartbeatEndedAt)+' that Prometheus stopped.':''):'The last report this page has is from '+when(row.lastHeardAt)+', past the '+minutes(row.silentAfterSeconds,600)+' minutes after which Operations calls an installation silent. The readings below are the last ones it sent.';
  /* During the watch's grace nothing is raised, whatever the age: a grace ending after the row reaches its limit is when the alarm comes. */
  if(now==='late'){const grace=Date.parse(watch?.graceUntil),limit=row.silentAfterSeconds??600,held=grace>Date.now()+Math.max(0,limit-(age(row)??0))*1000;return 'The last report is over '+minutes(row.lateAfterSeconds,180)+' minutes old.'+(watch&&!watch.overdue?(held?' Operations raises InstallationSilent after '+clock(grace)+", when the watch's grace ends.":' Operations raises InstallationSilent at '+minutes(limit,600)+' minutes.'):'');}
  return '';
 }
 /** Nothing listed: said for what this page can know. Only a reporting row read just now speaks about now. */
 const quietText=now=>now==='silent'?'No alert was open when it was last heard. What has happened since is not known.':stale?(now==='never'?'No alert from this server was open at the last read.':'Nothing was firing at the last read.'):now==='late'?'Nothing was firing at its last report.':now==='never'?'No alert from this server is open.':'Nothing is firing on this installation.';
 function firingRow(){
  const item=el('li'),open=el('button'),level=el('span'),what=el('span','','operator-note');open.type='button';open.addEventListener('click',()=>{if(open.dataset.event)navigate?.('data',{pane:'events',event:open.dataset.event});});item.append(open,level,what);
  return filled(item,alert=>{const cls='operator-badge '+(alert.severity==='critical'&&!alert.clearing?'attention':'');put(open,alert.alertType+(alert.service?' · '+alert.service:''));open.dataset.event=alert.deliveryId||'';open.disabled=!alert.deliveryId;if(level.className!==cls)level.className=cls;put(level,alert.clearing?CLEARING:alert.severity);put(what,(alert.summary||'')+(alert.startsAt?' · since '+when(alert.startsAt):''));});
 }
 function disarm(id){const held=armed.get(id);if(held)root.clearTimeout(held.timer);armed.delete(id);}
 /** @description Stopping deletes a server's history, so it takes two presses on two buttons. The second appears below the note, away from the first, ignores a double click and a held key, and goes away after ten seconds; the first turns into the way out. @param id The source. @param name The card's heading, which takes the focus when the buttons go. @returns The area, filled in place. */
 function stopArea(id,name){
  const node=el('div','','installation-stop'),first=el('button'),note=el('p','','operator-note'),sure=el('div','','installation-stop-sure'),warning=el('p','','operator-note'),go=el('button'),failed=el('p');let current=null;
  first.type=go.type='button';first.hidden=note.hidden=sure.hidden=failed.hidden=true;failed.setAttribute('role','alert');failed.tabIndex=-1;sure.append(warning,go);node.append(first,note,sure,failed);
  /* The focus goes back to the first button, but a person who scrolled away stays where they are. */
  const expired=()=>{const held=sure.contains(document.activeElement);armed.delete(id);render();if(held)first.focus({preventScroll:true});};
  first.addEventListener('click',e=>{if(e.detail>1)return;if(armed.has(id)){disarm(id);render();return;}armed.set(id,{at:Date.now(),x:e.clientX,y:e.clientY,timer:root.setTimeout(expired,ARM_MS)});render();go.focus({preventScroll:true});go.scrollIntoView({block:'nearest'});});
  go.addEventListener('click',e=>{const press=armed.get(id);if(e.detail>1||!press||Date.now()-press.at<ARM_LOCK_MS)return;/* In a short frame this button can land under the pointer: a press where the first one was is not a decision. It says so, and brings the words up with the button below them, away from that spot. A key press has no spot. */if(e.detail===1&&press.x&&Math.hypot(e.clientX-press.x,e.clientY-press.y)<ARM_AWAY_PX){press.near=true;fills.get(node)(current);warning.scrollIntoView({block:'start'});return;}disarm(id);render();first.focus();void stopWatching(current);});
  go.addEventListener('keydown',e=>{if(e.repeat&&['Enter',' '].includes(e.key))e.preventDefault();});
  return filled(node,row=>{
   /* The server's own state at the last good read, never the page's derived standing: failed reads say nothing about a server, and the server refuses a stop on one it still hears from. */
   current=row;const offered=['silent','never'].includes(row.state),open=offered&&!noWrite,held=node.contains(document.activeElement);if(!open)disarm(id);if(!offered&&Date.now()>=(stopKept.get(id)||0)){stopErrors.delete(id);stopKept.delete(id);}const isArmed=armed.has(id);
   put(first,open?(isArmed?'Keep watching':'Stop watching this installation'):'');first.hidden=!open;put(note,open?STOP_NOTE:'');note.hidden=!open;
   say(warning,'operator-note',!isArmed?'':'Its history cannot be brought back. '+(armed.get(id).near?'That press landed where your first one did, so it did nothing. Press again away from that spot if you mean it.':'This choice goes away in '+Math.round(ARM_MS/1000)+' seconds.'));put(go,isArmed?'Delete its history and stop watching '+row.name:'');sure.hidden=!isArmed;
   const refusal=stopErrors.get(id)||'';say(failed,'installation-warning',refusal);/* Focus leaves with the buttons. A refusal is read where it is; a poll that took them away must not move the page. */if(held&&!open){if(refusal)failed.focus();else name.focus({preventScroll:true});}
  });
 }
 /** @description One installation's card, built once and filled in place on every read. @param first Its first row. @returns The article. */
 function card(first){
  const id=first.sourceId,article=el('article'),head=el('header','','installation-head'),who=el('div'),state=el('div','','installation-standing'),name=el('h3'),where=el('p','','operator-note installation-where'),badge=el('span'),heardLine=el('strong','','installation-heard'),since=el('small'),alarm=el('p'),live=el('div','','installation-live');
  const table=el('table','','installation-table installation-checks'),thead=el('thead'),hr=el('tr'),body=el('tbody'),firingTitle=el('h4'),list=el('ul','','installation-firing'),quiet=el('p'),rangeTitle=el('h4'),grid=el('div','','installation-charts'),more=el('details','','operator-advanced'),feed=el('p'),charts=CHARTS.map(def=>chart(def,text=>{live.textContent=text;})),stop=stopArea(id,name);
  let series={},view=null;
  const fillTable=()=>{const held=root.getSelection?.();if(held&&!held.isCollapsed&&(more.contains(held.anchorNode)||more.contains(held.focusNode)))return;const next=chartTable(series,view),old=more.querySelector('table');if(old)old.replaceWith(next);else more.append(next);};
  live.setAttribute('aria-live','polite');heardLine.dataset.heard=id;name.tabIndex=-1;who.append(el('p','Monitored installation','eyebrow'),name,where);state.append(badge,heardLine,since);head.append(who,state);
  for(const h of ['Check','Reading','State'])hr.append(el('th',h));thead.append(hr);table.append(thead,body);grid.append(...charts.map(c=>c.figure));more.append(el('summary','Show these charts as a table'));more.addEventListener('toggle',()=>{if(more.open)fillTable();});
  article.append(head,alarm,table,firingTitle,list,quiet,rangeTitle,grid,more,feed,stop,live);
  return filled(article,row=>{
   const now=shown(row),h=row.history||{},end=h.now??readAt,label=RANGES.find(r=>r[0]===h.days)?.[1]||RANGES[0][1],place=[row.host,row.url].filter(Boolean).join(' · ');series=h.series||{};view={bucket:(h.bucketMinutes||15)*60000,since:h.since??end-(h.days||1)*86400000,now:end,first:Date.parse(row.firstHeardAt)||0,last:Date.parse(row.lastHeardAt)||0,lastKnown:now==='silent',reported:row.reports>0,label};
   article.className='card installation '+now+(!stale&&now!=='silent'&&criticalOf(row).length?' alerting':'')+' health-'+(stale?'unknown':criticalOf(row).length?'degraded':HEALTH[row.health]?row.health:'unknown');put(name,row.name);put(where,place);where.hidden=!place;paintBadge(badge,now);put(heardLine,heard(row));put(since,row.reports?row.reports.toLocaleString()+' reports since '+when(row.firstHeardAt):'No heartbeat yet: this server only sends alerts.');
   say(alarm,now==='silent'?'installation-alarm':'installation-warning',alarmText(row,now));sync(body,row.checks,'check',c=>c.id,checkRow);
   put(firingTitle,now==='silent'?'Open alerts':row.firing.length&&row.firing.every(a=>a.clearing)?(stale?'Reported cleared at the last read':'Reported cleared, being confirmed'):stale?'Firing at the last read':now==='late'?'Firing at its last report':'Firing now');sync(list,row.firing,'fingerprint',a=>a.fingerprint,firingRow);list.hidden=!row.firing.length;say(quiet,'operator-note',row.firing.length?'':quietText(now));
   put(rangeTitle,label);charts.forEach((c,i)=>c.draw(series[CHARTS[i][0]]||[],view));if(more.open)fillTable();
   say(feed,'installation-warning',row.feedError?'The readings could not all be saved beside the evidence: '+row.feedError:'');fills.get(stop)(row);
  });
 }
 async function stopWatching(row){
  const id=row.sourceId,fail=text=>{stopErrors.set(id,text);render();};stopErrors.delete(id);
  try{const r=await fetch(API+'/ingest/mapping',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({stopWatching:true,sourceId:id})});
   if(r.status===401){clear();onRefused?.(401);return;}
   if(r.status===403){noWrite=true;fail('Your role cannot stop watching an installation. It stays watched.');return;}
   /* The server just said it hears from this one: the page reads at once, and the reason stays beside the new standing for a moment instead of going with the button. */
   if(r.status===409){stopKept.set(id,Date.now()+ARM_MS);fail('Not stopped: Operations has heard from this installation again, so it stays watched.');await load();return;}
   if(!r.ok){fail('Could not stop watching (HTTP '+r.status+').');return;}
   /* It is gone on the server, so the card goes now, whatever the read after it says. */
   rows=rows.filter(other=>other.sourceId!==id);render();await load();
  }catch{fail('Could not stop watching: this page could not reach Operations.');}
 }
 function summary(){
  const of=state=>rows.filter(r=>shown(r)===state),names=list=>list.map(r=>r.name).join(', '),silent=of('silent'),late=of('late'),never=of('never'),reporting=of('reporting'),alerting=rows.filter(r=>shown(r)!=='silent'&&criticalOf(r).length),unwell=reporting.filter(r=>r.health!=='healthy'&&!criticalOf(r).length),newest=reporting.slice().sort((a,b)=>a.ageSeconds-b.ageSeconds)[0],blind=Boolean(rows.length&&(!watch||watch.overdue));
  const parts=[silent.length&&names(silent)+' silent',late.length&&names(late)+' late',never.length&&names(never)+' not reporting yet',...alerting.map(r=>r.name+': '+alertNames(r)+(stale?' firing at the last read':shown(r)==='late'?' firing at its last report':' firing')),...unwell.map(r=>r.name+(r.health==='degraded'?' degraded':': not all checks report')),stale&&'Could not refresh',blind&&(watch?'Silence watch not running':'Silence watch not known')].filter(Boolean);
  return {total:rows.length,reporting:reporting.length,tone:silent.length||alerting.length?'bad':reporting.length<rows.length||unwell.length||stale||blind?'warn':'good',detail:parts.join(' · ')||(newest?newest.name+' heard '+ago(age(newest)):'None reporting')};
 }
 const leadText=()=>'Each installation reports here every minute through its own monitoring, with its readings.'+(!rows.length||!watch||watch.overdue?'':' If the reports stop for '+minutes(rows[0].silentAfterSeconds,600)+' minutes, Operations raises InstallationSilent and asks your notification routes to tell you. Silence watch last ran '+ago(watchAge())+'.'+(Date.parse(watch.graceUntil)>Date.now()?' It came back after a gap, so no new alarm is raised before '+clock(Date.parse(watch.graceUntil))+'.':''));
 const watchText=()=>!rows.length||watch?.overdue===false?'':(!watch?'This read did not say when the silence watch last ran.':watch.lastTickAt?'The silence watch last ran '+ago(watchAge())+'.':'The silence watch has never run under this account.')+' Nothing will be raised if an installation stops reporting while it is not running. It runs with the processing schedule, which Overview shows and can re-activate.';
 const staleText=()=>!stale?'':rows.length?'Could not refresh just now; these readings are from '+new Date(readAt).toLocaleTimeString()+'. Their standing moves on only as long as reads keep failing.':'Could not read the monitored installations just now. Nothing is known about them until a read succeeds.';
 /** What a read with no rows can say: nothing has reported here, which is not the same as nothing being wired. */
 const emptyText=()=>'No installation has reported under this account'+(account?' ('+account+')':'')+' yet. '+(!unreported.length?'':unreported.slice(0,3).join(', ')+(unreported.length>3?' and '+(unreported.length-3)+' more':'')+(unreported.length===1?' is wired and waiting for its first report. ':' are wired and waiting for their first reports. '))+'An installation shows only under the account that wired it, so one wired under another account appears there.';
 /** A saved source with a mapping is wired: its producer simply has not reported. The mapping's own route answers that, for the first dozen sources; a read that fails only leaves the sentence shorter. */
 async function readUnreported(){
  const list=(sources?.()||[]).slice(0,12),key=list.map(s=>s.id).join();if(key===unreportedFor)return;unreportedFor=key;const mine=frame,found=[];
  for(const source of list){try{const r=await fetch(API+'/ingest/mapping/'+encodeURIComponent(source.id),{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)continue;const body=await r.json();if(body?.sourceId===source.id)found.push(source.name);}catch{}}
  if(mine!==frame||key!==unreportedFor)return;unreported=found;if(found.length)render();
 }
 /** The account name comes from the kernel's own identity read, the one the cockpit's ribbon uses; a subject is not a name. Without it the sentence stands alone. */
 async function readAccount(){const mine=frame;account='';try{const r=await fetch('/api/auth/user',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)return;const body=await r.json();if(mine!==frame||!body?.authenticated)return;account=(body.displayName!==body.subject&&body.displayName)||body.email||'';if(account)render();}catch{}}
 function buildFrame(){
  const title=el('div','','installations-title'),intro=el('div'),lead=el('p','','operator-note'),label=el('label','Charts show'),pick=el('select'),watchLine=el('p'),staleLine=el('p'),cards=el('div'),empty=el('p');
  intro.append(el('h2','Monitored installations'),lead);pick.id='installations-range';for(const [value,text]of RANGES){const o=el('option',text);o.value=String(value);pick.append(o);}pick.addEventListener('change',()=>{days=Number(pick.value);void load();});label.append(pick);title.append(intro,label);
  systems.replaceChildren(title,watchLine,staleLine,cards,empty);return {lead,label,pick,watchLine,staleLine,cards,empty};
 }
 function renderSystems(){
  if(!frame)frame=buildFrame();const quiet=!rows.length&&!stale;
  put(frame.lead,leadText());frame.label.hidden=!rows.length;if(frame.pick.value!==String(days))frame.pick.value=String(days);say(frame.watchLine,'installation-warning installation-watch',watchText());say(frame.staleLine,'installation-warning',staleText());
  for(const id of [...armed.keys(),...stopErrors.keys()])if(!rows.some(r=>r.sourceId===id)){disarm(id);stopErrors.delete(id);}
  sync(frame.cards,rows,'source',r=>r.sourceId,card);say(frame.empty,'operator-note installations-empty',quiet?emptyText():'');if(quiet&&account===null)void readAccount();if(quiet)void readUnreported();
 }
 function renderBrief(){
  overview.hidden=false;
  if(!brief){brief={watchLine:el('p'),staleLine:el('p'),list:el('div'),empty:el('p')};overview.replaceChildren(el('h2','Monitored installations'),brief.watchLine,brief.staleLine,brief.list,brief.empty);}
  say(brief.watchLine,'installation-warning installation-watch',watchText());say(brief.staleLine,'installation-warning',staleText());sync(brief.list,rows,'source',r=>r.sourceId,briefRow);say(brief.empty,'operator-note installations-brief-empty',rows.length||stale?'':emptyText());
 }
 /** A change of standing is said once, in the one status region that outlives every read. */
 function announce(){const changes=[];for(const row of rows){const now=shown(row),was=said.get(row.sourceId),word=STANDING[now]||now;if(was&&was!==now)changes.push(stale?row.name+' reads as '+word+' as far as this page can tell; reads are failing.':row.name+' is now '+word+'.');said.set(row.sourceId,now);}for(const id of said.keys())if(!rows.some(r=>r.sourceId===id))said.delete(id);if(changes.length&&announcer)announcer.textContent=changes.join(' ');}
 /** Other screens' monitoring lines follow the same rows, and a line with nothing to say takes its label with it. */
 function monitoringLines(){for(const node of document.querySelectorAll('[data-monitoring]')){const value=heardFor(node.dataset.monitoring)||'';put(node,value);node.hidden=!value;if(node.previousElementSibling?.tagName==='DT')node.previousElementSibling.hidden=!value;}}
 function render(){if(systems)renderSystems();if(overview)renderBrief();announce();monitoringLines();onUpdate?.(summary());}
 /** Failing time is counted by the ticker, in steps no longer than its own, so a computer that slept adds nothing, and only while reads are being made, so a hidden tab or a screen without monitoring adds nothing and announces nothing. */
 function countFailing(){const now=Date.now(),step=Math.min(Math.max(0,now-countedAt),2*TICK_MS);countedAt=now;if(stale&&showing())failedFor+=step;}
 function tick(){
  countFailing();if(document.visibilityState!=='visible')return;
  /* A computer that woke, or a timer the browser held back: read now rather than show old standing. While reads are failing the poll is enough: a kernel in trouble gets no more reads than a well one. */
  if(readAt&&!stale&&Date.now()-readAt>2*POLL_MS)pollRead();
  if(rows.some(r=>shown(r)!==said.get(r.sourceId))){render();return;}
  for(const node of document.querySelectorAll('[data-heard]')){const row=rows.find(r=>r.sourceId===node.dataset.heard);if(row)put(node,heard(row));}monitoringLines();if(frame){put(frame.lead,leadText());say(frame.watchLine,'installation-warning installation-watch',watchText());}
 }
 /** A failing streak starts when its first failed read did; a read that slept through its own deadline counts for no more than that deadline. */
 function readFailed(at){if(!stale){const now=Date.now();stale=true;failedFor=Math.min(Math.max(0,now-at),READ_DEADLINE_MS);countedAt=now;}render();}
 const dropReads=upTo=>{for(const [id,control]of live)if(id<=upTo){live.delete(id);control.abort();}};
 /** One read. Past its deadline it counts as failed, but its answer still counts: an answer is taken when it is newer than the last one taken, by when its read began, so a kernel slower than the poll keeps its 200s. */
 function read(){
  const mine=++begun,at=Date.now(),control=new AbortController();waiting=mine;live.set(mine,control);
  const due=root.setTimeout(()=>{if(waiting===mine)waiting=0;if(live.has(mine)&&mine>accepted)readFailed(at);},READ_DEADLINE_MS),cap=root.setTimeout(()=>control.abort(),READ_ABORT_MS);
  lastLoad=(async()=>{try{const r=await fetch(API+'/telemetry?days='+days,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:control.signal});if(mine<=accepted)return;if([401,403].includes(r.status)){const code=r.status;clear();onRefused?.(code);return;}if(!r.ok)throw Error('HTTP '+r.status);const body=await r.json();if(mine<=accepted)return;if(!Array.isArray(body.installations))throw Error('Installations are unavailable.');rows=body.installations;watch=body.watch||null;readAt=Date.now();accepted=mine;dropReads(mine-1);stale=false;failedFor=0;render();onRead?.();}catch{if(live.has(mine)&&mine>accepted)readFailed(at);}finally{root.clearTimeout(due);root.clearTimeout(cap);live.delete(mine);if(waiting===mine)waiting=0;}})();
  if(!poll){poll=root.setInterval(pollRead,POLL_MS);ticker=root.setInterval(tick,TICK_MS);}return lastLoad;
 }
 /** An explicit read (the range changed, a stop went through, the records were refreshed): what is still out there answers an older question, so it stops without counting as failed. */
 function load(){dropReads(begun);return read();}
 function readIfOpen(){if(poll&&showing())void read();}
 /** The poll and the wake check leave a read inside its deadline to finish. */
 function pollRead(){if(!waiting)readIfOpen();}
 function clear(){accepted=++begun;dropReads(begun);waiting=failedFor=0;rows=[];watch=null;readAt=0;stale=noWrite=false;account=frame=brief=null;unreported=[];unreportedFor='';for(const id of [...armed.keys()])disarm(id);stopErrors.clear();stopKept.clear();said.clear();if(announcer)announcer.textContent='';if(poll)root.clearInterval(poll);if(ticker)root.clearInterval(ticker);poll=ticker=null;systems?.replaceChildren();if(overview){overview.replaceChildren();overview.hidden=true;}monitoringLines();onUpdate?.(summary());}
 /* Going back and forth must not pile reads up: the browser holds six connections to this origin, and a read out for its full 65 seconds holds one. */
 document.addEventListener('visibilitychange',pollRead);root.addEventListener('hashchange',pollRead);
 return {load,clear,loaded:()=>lastLoad,summary,heardFor};
}
root.OperationsInstallations={mount,ago};
})(window);
