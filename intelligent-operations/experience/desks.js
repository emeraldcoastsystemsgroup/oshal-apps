/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | A desk reads through its own fetch and only the newest load of a desk may render, refuse or clear: the shared request helper cleared every view on any 403, so a stale refusal from a duplicate boot load (navigate and refresh both load the open desk) blanked the next desk's page under load (the store gate's one failure on the first push). Loads of one desk are deduplicated while in flight, and the catalog, the topic seeding, the token read and the desk read run together. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | The four desk tabs (App Ops, Sec Ops, Platform Ops, Dev Ops; spec lanes/monitoring-four-desks-spec-2026-11-08.md), one module, five panels each over the desk's own read: Firing now (symptoms newest first, each opening its investigation), Sources (last heard, standing, the heartbeat's checks and readings), Rules (on and capture per rule, Save needs the desk's write permission, Restore defaults), Runbooks (the owner's runbooks for the desk's alert types), Settings (topic and its channel from the kernel's own notification preferences with the way to the Notifications page, source, ingest route, producer tokens from the kernel, and the host threshold file shown as the path plus the last snapshot a heartbeat carried; the package reads no host file). On mount it seeds the four topics as channel none through POST /api/notify/prefs when they are missing, so a person finds them on Notifications and picks the channel there. Phone first, the person's theme only, every control a native button, link or checkbox. */
(function(root){'use strict';
const API='/api/intelligent-operations',NOTIFY_PREFS='/api/notify/prefs',TOKENS='/api/v1/producer-tokens';
/** The desks the tabs show, in order; the server's GET /desks is the authority and refreshes this on mount. */
const FALLBACK=[{id:'app-ops',label:'App Ops',role:'ops-app',topic:'app-attention'},{id:'sec-ops',label:'Sec Ops',role:'ops-security',topic:'security-attention'},{id:'platform-ops',label:'Platform Ops',role:'ops-platform',topic:'platform-attention'},{id:'dev-ops',label:'Dev Ops',role:'ops-release',topic:'release-attention'}];
const text=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined&&value!==null)e.textContent=String(value);if(cls)e.className=cls;return e;};
const when=iso=>{const d=new Date(iso||'');return Number.isNaN(d.getTime())?'—':d.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});};
const ago=s=>s===null||s===undefined?'never':s<90?s+' s ago':s<5400?Math.round(s/60)+' min ago':Math.round(s/3600)+' h ago';
const STATE={reporting:['Reporting','tone-good'],late:['Late','tone-warn'],silent:['Silent','tone-bad'],never:['No report yet','']};
/** @description The sentence an empty Sources or Firing panel shows: what will fill it and who posts it. Pure. */
function emptySentence(desk,panel){
 const probe=desk.probe||'its producer posts through the producer door';
 if(panel==='sources')return 'No source has reported yet; '+probe+' once it runs.';
 if(panel==='firing')return 'Nothing is firing on '+desk.label+'. Alerts appear here as '+probe.replace(/^the /,'the ')+'.';
 if(panel==='runbooks')return 'No runbook for '+desk.label+"'s alert types yet. Write one on Runbooks, named exactly as the alert type.";
 return '';
}
/** @description Twelve characters of an id with the whole id as the title. Pure. */
function shortId(id){return typeof id==='string'&&id.length>12?id.slice(0,12)+'…':id||'—';}
function mount({onRefused}){
 const sections=new Map();
 for(const d of FALLBACK){const section=document.getElementById(d.id);if(section)sections.set(d.id,section);}
 if(!sections.size)return {has(){return false;},load(){},clear(){}};
 let catalog=FALLBACK,current=0,prefs=null,tokens=null,topicsSeeded=null;
 const summaries=new Map(),dirty=new Map(),inflight=new Map();
 /** The desk routes, read with the person's session. A refusal is thrown to the one load that asked, never broadcast: only the newest load of a desk may clear the page. */
 async function api(path,body){const r=await fetch(API+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(r.status===401?'Sign in through OSHAL to continue.':r.status===403?'Your current OSHAL role does not permit this operation.':b.error||'Request unavailable (HTTP '+r.status+').'),{status:r.status});return b;}
 const desk=id=>catalog.find(d=>d.id===id)||FALLBACK.find(d=>d.id===id);
 const has=id=>sections.has(id);
 /** The kernel's own routes, read with the person's session; a refusal here never clears the desk, it only leaves that line unknown. */
 async function kernel(path,init){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(init?.body?{'Content-Type':'application/json'}:{})},...init});const body=await r.json().catch(()=>({}));return {ok:r.ok,status:r.status,body};}
 /** @description The four topics exist for this person after the first open: each missing one is saved with channel none, so the Notifications page lists it and the person picks the channel there. Nothing is sent. */
 async function ensureTopics(){
  const want=catalog.map(d=>d.topic).filter(Boolean);if(!want.length)return;
  const read=await kernel(NOTIFY_PREFS);if(!read.ok){topicsSeeded={error:read.status===401?'Sign in through OSHAL to register the desk topics.':'The notification preferences could not be read (HTTP '+read.status+').'};return;}
  prefs=read.body;const have=new Set((prefs.prefs||[]).map(p=>p.topic)),added=[],failed=[];
  for(const topic of want.filter(t=>!have.has(t))){const saved=await kernel(NOTIFY_PREFS,{method:'POST',body:JSON.stringify({topic,channel:'none',enabled:true})});if(saved.ok){added.push(topic);prefs=saved.body.prefs?{...prefs,prefs:saved.body.prefs}:prefs;}else failed.push(topic+' (HTTP '+saved.status+')');}
  topicsSeeded={added,failed};
 }
 async function readTokens(){const r=await kernel(TOKENS);tokens=r.ok?(r.body.producerTokens||[]):{error:r.status};}
/** Read once each: the catalog (the probe sentences), the topic seeding and the producer tokens; none of the last two may fail a desk read. */
 async function readCatalog(){if(catalog!==FALLBACK)return;const c=await api('/desks');if(Array.isArray(c.desks)&&c.desks.length)catalog=c.desks;}
 async function seedOnce(){if(topicsSeeded!==null)return;topicsSeeded={};try{await ensureTopics();}catch(e){topicsSeeded={error:String(e.message||e).slice(0,160)};}}
 async function tokensOnce(){if(tokens!==null)return;try{await readTokens();}catch(e){tokens={error:0};}}
 function status(id,value,tone){const el=document.getElementById(id+'-status');if(el){el.textContent=value;el.dataset.tone=tone||'';}}
 /** The five panels of one desk, built once; every later read fills them in place. */
 function skeleton(d){
  const section=sections.get(d.id);if(section.dataset.built)return;section.dataset.built='1';
  const head=text('div','','desk-head');head.append(text('p',d.owns?'Owns '+d.owns+'.':'','operator-note'),text('p','','meta-caption'));head.firstChild.id=d.id+'-owns';head.lastChild.id=d.id+'-status';head.lastChild.setAttribute('role','status');head.lastChild.setAttribute('aria-live','polite');
  const panel=(key,title,note)=>{const card=text('article','','card desk-panel');card.id=d.id+'-'+key;const h=text('h2',title);card.append(h);if(note)card.append(text('p',note,'operator-note'));const body=text('div','','desk-body');body.id=d.id+'-'+key+'-body';card.append(body);return card;};
  section.append(head,panel('firing','Firing now','Symptoms this desk\'s rules admitted, newest first; a critical one opens its investigation.'),panel('sources','Sources','The desk\'s source, when it was last heard and what its heartbeat reads.'),panel('rules','Rules','Which alert types become symptoms (On) and which take a snapshot (Capture). Saving needs the desk\'s write permission.'),panel('runbooks','Runbooks','Your runbooks for this desk\'s alert types; an investigation attaches the matching one.'),panel('settings','Settings','Where this desk rings, what it reads from and what the probe reports as its thresholds.'));
 }
 function pill(label,tone){return text('span',label,'pill '+(tone||''));}
 function renderFiring(d,s){
  const body=document.getElementById(d.id+'-firing-body');body.replaceChildren();
  const rows=s.symptoms||[];
  if(!rows.length){body.append(text('p',emptySentence(d,'firing'),'desk-empty'));return;}
  const list=text('ul','','desk-list');
  for(const x of rows){const li=text('li','','desk-row');const top=text('div','','desk-row-top');
   top.append(pill(x.status==='firing'?(x.severity==='critical'?'critical':x.severity||'warning'):'cleared',x.status!=='firing'?'tone-good':x.severity==='critical'?'tone-bad':'tone-warn'),text('strong',(x.alertType||'Alert')+(x.service?' ('+x.service+')':'')),text('span',x.resourceId?'on '+x.resourceId:'','muted'));
   const meta=text('div','','desk-row-meta');meta.append(text('span',(x.status==='firing'?'Firing since ':'Last seen ')+when(x.status==='firing'?(x.admittedAt||x.firstSeen):x.lastSeen)),text('span',x.count+(x.count===1?' occurrence':' occurrences')));
   const action=text('div','','desk-row-action');
   if(x.investigation?.href){const a=text('a','Open investigation');a.href=x.investigation.href;a.target='_top';action.append(a);}
   else if(x.evidence)action.append(text('span',x.evidence.state==='pending'?'Evidence pending':x.evidence.state==='captured'||x.evidence.state==='sealed'?'Evidence captured, no investigation yet':'Evidence '+x.evidence.state,'muted'));
   else action.append(text('span',x.severity==='critical'?'Not captured':'Recorded, not captured','muted'));
   li.append(top,meta,action);list.append(li);}
  body.append(list);
 }
 function renderSources(d,s){
  const body=document.getElementById(d.id+'-sources-body');body.replaceChildren();
  const rows=s.installations||[];
  if(!rows.length){body.append(text('p',emptySentence(d,'sources'),'desk-empty'));if(s.settings?.sourceName)body.append(text('p','Source '+s.settings.sourceName+(s.activated?' is saved and waits for its first report.':' is created by the processing schedule on its next run.'),'muted'));return;}
  for(const r of rows){const det=text('details','','desk-source');const sum=text('summary');const [label,tone]=STATE[r.state]||[r.state,''];
   sum.append(text('strong',r.name),pill(label,tone),text('span',r.lastHeardAt?'heard '+ago(r.ageSeconds):'never heard','muted'),text('span',r.reports+(r.reports===1?' report':' reports'),'muted'));det.append(sum);
   const facts=text('dl','','desk-facts');const fact=(k,v)=>{facts.append(text('dt',k),text('dd',v));};
   fact('Health when last heard',r.health);if(r.host)fact('Host',r.host);if(r.url)fact('Public address',r.url);fact('Last heard',r.lastHeardAt?when(r.lastHeardAt):'never');if(r.silentSince)fact('Silent since',when(r.silentSince));
   det.append(facts);
   const checks=text('ul','','checklist');for(const c of r.checks||[]){const li=text('li','','check-row');li.append(pill(c.state==='ok'?'OK':c.state==='warn'?'Warning':c.state==='bad'?'Problem':'Unknown',c.state==='ok'?'tone-good':c.state==='warn'?'tone-warn':c.state==='bad'?'tone-bad':''),text('span',c.label+': '+c.reading));checks.append(li);}
   det.append(checks);
   if(r.firing?.length){det.append(text('p','The producer reports firing: '+r.firing.map(a=>a.alertType+(a.service?' ('+a.service+')':'')+(a.clearing?' (clearing)':'')).join(', '),'muted'));}
   body.append(det);}
 }
 function renderRules(d,s){
  const body=document.getElementById(d.id+'-rules-body');body.replaceChildren();dirty.delete(d.id);
  const rules=s.rules;
  if(!rules){body.append(text('p',s.activated?'The default policy is not published yet; the processing schedule publishes it on its next run.':'The default policy below is published when the processing schedule activates this desk.','desk-empty'));
   const list=text('ul','','desk-list');for(const [names,cap]of [[s.defaults?.critical||[],true],[s.defaults?.warning||[],false]])for(const name of names){const li=text('li','','desk-rule');li.append(text('strong',name),pill(cap?'critical, captured':'warning, recorded',cap?'tone-bad':'tone-warn'));list.append(li);}body.append(list);return;}
  body.append(text('p',rules.name+' · window '+rules.window.mode+' '+rules.window.seconds+' s · revision '+rules.revision+(rules.publishedAt?' · published '+when(rules.publishedAt):''),'muted'));
  const form=text('form','','desk-rules');form.id=d.id+'-rules-form';
  const list=text('ul','','desk-list');
  for(const r of rules.rules){const li=text('li','','desk-rule');li.dataset.rule=r.name;li.append(text('strong',r.name));
   for(const [field,label]of [['enabled','On'],['capture','Capture']]){const lab=text('label','','desk-toggle');const box=document.createElement('input');box.type='checkbox';box.checked=r[field]===true;box.dataset.field=field;box.setAttribute('aria-label',label+' for '+r.name);box.addEventListener('change',()=>{dirty.set(d.id,true);save.disabled=false;});lab.append(box,text('span',label));li.append(lab);}
   list.append(li);}
  const add=text('div','','desk-add');const input=document.createElement('input');input.type='text';input.maxLength=80;input.placeholder='Alert type to add, e.g. DiskHigh';input.setAttribute('aria-label','Alert type to add');input.id=d.id+'-rule-add';const addButton=text('button','Add rule');addButton.type='button';
  addButton.addEventListener('click',()=>{const name=input.value.trim();if(!name)return;if([...list.querySelectorAll('li')].some(li=>li.dataset.rule===name)){status(d.id,'That alert type is already a rule.');return;}const li=text('li','','desk-rule');li.dataset.rule=name;li.append(text('strong',name));for(const [field,label,on]of [['enabled','On',true],['capture','Capture',false]]){const lab=text('label','','desk-toggle');const box=document.createElement('input');box.type='checkbox';box.checked=on;box.dataset.field=field;box.setAttribute('aria-label',label+' for '+name);lab.append(box,text('span',label));li.append(lab);}list.append(li);input.value='';dirty.set(d.id,true);save.disabled=false;});
  add.append(input,addButton);
  const actions=text('div','','desk-actions');const save=text('button','Save rules');save.type='submit';save.disabled=true;const restore=text('button','Restore defaults');restore.type='button';actions.append(save,restore);
  form.append(list,add,actions);
  form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;const payload=[...list.querySelectorAll('li')].map(li=>({name:li.dataset.rule,enabled:li.querySelector('input[data-field=enabled]').checked,capture:li.querySelector('input[data-field=capture]').checked}));
   try{const r=await api('/desks/'+d.id+'/policy',{rules:payload,expectedRevision:rules.revision});await load(d.id);status(d.id,'Rules saved (revision '+r.binding.revision+').');}catch(e){if([401,403].includes(e.status)){clear();onRefused?.();}status(d.id,e.message,'bad');save.disabled=false;}});
  restore.addEventListener('click',async()=>{restore.disabled=true;try{const r=await api('/desks/'+d.id+'/policy',{restoreDefaults:true,expectedRevision:rules.revision});await load(d.id);status(d.id,'Default rules restored (revision '+r.binding.revision+').');}catch(e){if([401,403].includes(e.status)){clear();onRefused?.();}status(d.id,e.message,'bad');restore.disabled=false;}});
  body.append(form);
 }
 function renderRunbooks(d,s){
  const body=document.getElementById(d.id+'-runbooks-body');body.replaceChildren();const items=s.runbooks||[];
  if(!items.length){body.append(text('p',emptySentence(d,'runbooks'),'desk-empty'));}
  else{const list=text('ul','','desk-list');for(const r of items){const li=text('li','','desk-row');li.append(text('strong',r.alertType),text('span',String(r.markdown||'').split('\n').find(l=>l.trim())||'','muted'),text('span','revision '+r.revision+' · '+when(r.updatedAt),'muted'));list.append(li);}body.append(list);}
  const a=text('a','Open Runbooks');a.href='#runbooks';body.append(a);
 }
 function renderSettings(d,s){
  const body=document.getElementById(d.id+'-settings-body');body.replaceChildren();const st=s.settings||{};
  const facts=text('dl','','desk-facts');const fact=(k,v,node)=>{facts.append(text('dt',k));const dd=text('dd');if(node)dd.append(node);else dd.textContent=v;facts.append(dd);};
  const row=(prefs?.prefs||[]).find(p=>p.topic===st.topic);const channel=row?(row.channel==='none'?'no channel yet':row.channel+(row.enabled?'':' (muted)')):topicsSeeded?.error?'not read: '+topicsSeeded.error:'not registered yet';
  const topicNode=text('span');topicNode.append(text('code',st.topic||d.topic||''),text('span',' → '+channel+' · '));const link=text('a','Choose the channel on Notifications');link.href=st.notificationsPage||'/cockpit/tools/notify.html';link.target='_top';topicNode.append(link);fact('Alert topic',null,topicNode);
  if(topicsSeeded?.added?.includes(st.topic))fact('Topic registered','Just now, with no channel; nothing is sent until you pick one.');
  fact('Source',(st.sourceName||'—')+(st.sourceId?' · id '+shortId(st.sourceId):' · not created yet'));if(st.sourceId){const dd=facts.lastChild;dd.title=st.sourceId;}
  fact('Source URI',st.sourceUri||'—');
  if(st.mapping)fact('Alertmanager mapping',st.mapping.resourceKind+' · label '+st.mapping.idLabel+' · scope '+st.mapping.scope);
  fact('Ingest route',st.ingestRoute?'POST '+st.ingestRoute:'available once the source exists');
  let tokenText='not read yet';
  if(Array.isArray(tokens)){const mine=tokens.filter(t=>st.ingestRoute&&String(t.route||'').endsWith(st.ingestRoute.replace(API,'')));tokenText=mine.length?mine.length+(mine.length===1?' producer token issued':' producer tokens issued')+' ('+mine.map(t=>(t.label||'unlabelled')+(t.expiresAt?', expires '+when(t.expiresAt):'')).join('; ')+')':'no producer token issued for this route yet (POST /api/v1/producer-tokens, as the owner)';}
  else if(tokens?.error)tokenText=tokens.error===401?'sign in to read your producer tokens':'the kernel did not list your producer tokens (HTTP '+tokens.error+')';
  fact('Producer token',tokenText);
  fact('Last delivery heard',st.lastHeardAt?when(st.lastHeardAt):'none yet');
  const fileNode=text('span');fileNode.append(text('code',st.thresholdFile||d.thresholdFile||''));fact('Threshold file on the host',null,fileNode);
  body.append(facts);
  if(st.thresholds?.body){body.append(text('p','Snapshot the probe reported '+when(st.thresholds.reportedAt)+(st.thresholds.file?' from '+st.thresholds.file:'')+' (read-only here; edit the file on the host):','muted'));const pre=text('pre',JSON.stringify(st.thresholds.body,null,1),'desk-snapshot');pre.tabIndex=0;body.append(pre);}
  else body.append(text('p','No probe has reported this file yet. Operations cannot read a host file; the probe sends the file\'s contents with its heartbeat (annotation thresholds), and the last snapshot shows here.','desk-empty'));
 }
 function render(d,s){skeleton(d);const owns=document.getElementById(d.id+'-owns');if(owns)owns.textContent=(s.owns||d.owns)?'Owns '+(s.owns||d.owns)+'.':'';renderFiring(d,s);renderSources(d,s);renderRules(d,s);renderRunbooks(d,s);renderSettings(d,s);}
 /** One load per desk at a time; a second ask while one is in flight shares it. */
 function load(id){if(inflight.has(id))return inflight.get(id);const run=read(id).finally(()=>{if(inflight.get(id)===run)inflight.delete(id);});inflight.set(id,run);return run;}
 async function read(id){
  const d=desk(id);if(!d||!has(id))return;skeleton(d);const mine=++current;status(id,'Reading '+d.label+'…');
  try{
   // The topics to seed come from the catalog, so the seeding follows it; the desk read and the token read run beside them.
   const [s]=await Promise.all([api('/desks/'+id),readCatalog().then(seedOnce),tokensOnce()]);
   if(mine!==current)return;
   summaries.set(id,s);render(desk(id),s);
   status(id,'Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'. '+(s.summary||''));
  }catch(e){
   if(mine!==current)return;
   const named=desk(id)||d;
   if([401,403].includes(e.status)){clear();onRefused?.();status(id,e.status===401?'Sign in through OSHAL to continue.':'Your role does not include '+named.label+'. Ask an administrator for the '+(named.role||'desk')+' role.','bad');return;}
   status(id,e.message,'bad');}
 }
 function clear(){summaries.clear();dirty.clear();for(const [id,section]of sections){for(const key of ['firing','sources','rules','runbooks','settings'])document.getElementById(id+'-'+key+'-body')?.replaceChildren();status(id,'Reconnect and load '+(desk(id)?.label||id)+'.');void section;}}
 for(const d of FALLBACK)if(has(d.id))skeleton(d);
 return {has,load,clear,summaries};
}
const api={mount,emptySentence,shortId};
if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsDesks=api;
})(typeof window==='object'?window:globalThis);
