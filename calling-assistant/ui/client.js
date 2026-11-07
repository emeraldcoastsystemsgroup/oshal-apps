/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The Calling Assistant page client: configuration, sender numbers, the audio interpretation test, task start, reports and cancel, all against the package's own routes.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Gate every start path on the shared kit's decision (ADR-164 D6). When the page renders an audience view the client stops before its first read, so the /config probe (it reaches the speech provider registry), the /tasks refresh and every form and button listener stay off; without a view, or without the kit, the full page boots exactly as before. The body moved into a function so the gate can hold it back; no line of it changed.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Plain sentences instead of codes and JSON (the page's Plain helper, index.html): a refusal reads as what to do ("select_connection" was shown as "select connection"), an empty connection list says to connect Twilio on Connections and switches Load numbers off, the audio test reads as what was heard and what the assistant would do (it printed the raw result JSON), and malformed approved replies say how to fix them instead of a JSON parser error.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Demo sweep 1: a failed audio test no longer leaves 'Interpreting audio…' in the result box; the refusal is the page's message alone.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 split: the Calls and Calling settings views (the address keeps the view); with no Twilio connection the Calls view is one empty state with Check again (it replaces the banner that repeated the setup sentence); Start call is disabled with its reason while calling is off or no connection is chosen; answers are rows that write the same JSON; the public origin fills from this page's https address; reports are newest first with badges, a search and a status filter. Every request is unchanged.
 * -----------------------------------------------------------------------------
 */
(function () {
'use strict';
// Audience view (ADR-164 D6): the kit paints the view from its own read; the full client starts only when no view is active.
if (!window.AppView || !AppView.active()) start();
function start() {
const $=id=>document.getElementById(id), root='/api/calling-assistant';
let loaded, requestKey;
function message(t) {$('message').textContent=t;}
async function api(path,method='GET',body) {
  const response=await fetch(root+path,{method,headers:{'X-Oshal-Calling':'1',...(body instanceof File?{'Content-Type':'audio/wav'}:body?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof File?body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({})); if(!response.ok) throw Object.assign(new Error(data.message||data.detail||data.error||'Request failed'),{code:data.error||data.refused}); return data;
}
async function busy(button,fn) {button.disabled=true;try{await fn();}catch(e){message(Plain.refusal(e));}finally{button.disabled=false;}}
function option(value,text) { const o=document.createElement('option');o.value=value;o.textContent=text;return o; }
function renderConfig(data) {
  loaded=data.config;
  $('connectionId').replaceChildren(option('',data.connections.length?'Select a connection':'No Twilio connection yet'),...data.connections.map(c=>option(c.id,`${c.label} (${c.scope})`)));
  $('loadNumbers').disabled=!data.connections.length;
  // No Twilio connection: the Calls view is one empty state (Connect Twilio to place calls), not a repeated banner.
  $('noTwilio').hidden=!!data.connections.length; $('newCall').hidden=!data.connections.length;
  $('sttProvider').replaceChildren(...data.providers.map(p=>option(p.id,`${p.id}${p.configured?'':' — not configured'}`)));
  $('from').replaceChildren(option('','Select a sender'),...(loaded.from?[option(loaded.from,loaded.from)]:[]));
  for(const [k,v] of Object.entries(loaded)) {const el=$(k);if(!el)continue;if(el.type==='checkbox')el.checked=v;else el.value=Array.isArray(v)?v.join('\n'):v??'';}
  $('readiness').textContent=data.effectiveEnabled?'Enabled for approved calls':'Calling is disabled or needs configuration';
  if(!loaded.publicOrigin&&location.protocol==='https:') $('publicOrigin').value=location.origin;
  startState(data);
  buildAnswers();
}
/** Start call is solid-disabled with its reason on the line while calling is off or no connection is chosen. */
function startReason(data) {
  if(!data.connections.length) return 'Connect Twilio first.';
  if(!data.config.connectionId) return 'Choose a Twilio connection in Calling settings first.';
  if(!data.effectiveEnabled) return 'Calling is off: finish Calling settings and enable calling first.';
  return '';
}
function startState(data) { const why=startReason(data); $('startCall').disabled=!!why; $('startWhy').textContent=why; }
/** Answers as rows (When it says, Say or Press, value, ⋯ Remove); they write the JSON the call takes (Advanced keeps it). */
function answerRow(a,i) {
  const row=document.createElement('div');row.className='answer-row';
  const when=document.createElement('input');when.className='when';when.placeholder='When it says…';when.value=a.prompt||'';when.setAttribute('aria-label','When it says');
  const kind=document.createElement('select');kind.setAttribute('aria-label','Say or press');kind.append(option('say','Say'),option('digits','Press'));kind.value=a.digits!==undefined&&a.say===undefined?'digits':'say';
  const value=document.createElement('input');value.placeholder=kind.value==='say'?'Words to say':'Keys to press';value.value=a.say!==undefined?a.say:(a.digits||'');value.setAttribute('aria-label','Answer');
  const more=document.createElement('button');more.type='button';more.className='row-menu';more.textContent='\u22ef';more.setAttribute('aria-label','Actions for this answer');more.setAttribute('aria-haspopup','menu');more.setAttribute('popovertarget','answer-menu-'+i);
  const menu=document.createElement('div');menu.id='answer-menu-'+i;menu.className='answer-menu';menu.setAttribute('popover','');menu.setAttribute('role','menu');
  const remove=document.createElement('button');remove.type='button';remove.setAttribute('role','menuitem');remove.textContent='Remove';remove.onclick=()=>{if(menu.hidePopover)menu.hidePopover();row.remove();writeAnswers();};menu.append(remove);
  for(const el of [when,kind,value]) el.addEventListener('input',()=>{value.placeholder=kind.value==='say'?'Words to say':'Keys to press';writeAnswers();});
  row.append(when,kind,value,more,menu);return row;
}
function readAnswers() { try{return Plain.responses($('responses').value);}catch(_){return [];} }
function buildAnswers() { $('answerRows').replaceChildren(...readAnswers().map(answerRow)); }
function writeAnswers() {
  const rows=[...$('answerRows').querySelectorAll('.answer-row')].map(r=>{const [w,k,v]=r.querySelectorAll('input,select');return k.value==='say'?{prompt:w.value,say:v.value}:{prompt:w.value,digits:v.value};});
  $('responses').value=JSON.stringify(rows);$('taskForm').dispatchEvent(new Event('input'));
}
/** The two views; the address keeps the view (#view=settings) so Reload opens the same one. */
function setView(v) {
  const view=v==='settings'?'settings':'calls';
  for(const id of ['calls','settings']){$('view-'+id).hidden=id!==view;$('tab-'+id).setAttribute('aria-selected',String(id===view));}
  history.replaceState(null,'',location.pathname+location.search+(view==='settings'?'#view=settings':''));
}
const BADGE={failed:'bad',dialing:'warn',active:'warn',transferring:'warn',uncertain:'warn',completed:'ok'};
let allTasks=[];
async function load() {renderConfig(await api('/config'));await refresh();}
async function refresh() {
  const {tasks}=await api('/tasks');allTasks=tasks.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const status=$('taskStatus'),chosen=status.value;status.replaceChildren(option('','Every status'),...[...new Set(allTasks.map(t=>t.status))].sort().map(s=>option(s,s)));status.value=chosen;
  renderTasks();
}
/** Call reports: newest first, a status badge each, filtered by the search and the status choice. */
function renderTasks() {
  const q=$('taskSearch').value.trim().toLowerCase(),want=$('taskStatus').value;
  const tasks=allTasks.filter(t=>(!want||t.status===want)&&(!q||[t.status,t.outcome,new Date(t.created_at).toLocaleString()].join(' ').toLowerCase().includes(q)));
  $('tasks').replaceChildren();
  if(!tasks.length)$('tasks').textContent=allTasks.length?'No call matches this search or status.':'No phone tasks yet.';
  for(const task of tasks){const row=document.createElement('div');row.className='task row';const badge=document.createElement('span');badge.className='badge '+(BADGE[task.status]||'');badge.textContent=String(task.status).replace(/_/g,' ');const label=document.createElement('span');label.textContent=`${new Date(task.created_at).toLocaleString()} · ${String(task.outcome||'').replace(/_/g,' ')}`;row.append(badge);const show=document.createElement('button');show.textContent='View report';show.onclick=()=>busy(show,async()=>{$('report').textContent=JSON.stringify(await api('/tasks/'+task.id),null,2);});row.append(label,show);
    if(['dialing','active','transferring'].includes(task.status)){const cancel=document.createElement('button');cancel.textContent='Cancel call';cancel.className='danger';cancel.onclick=()=>busy(cancel,async()=>{await api('/tasks/'+task.id+'/cancel','POST');await refresh();});row.append(cancel);} $('tasks').append(row);}
}
$('loadNumbers').onclick=()=>busy($('loadNumbers'),async()=>{const {numbers}=await api('/numbers?connectionId='+encodeURIComponent($('connectionId').value));$('from').replaceChildren(option('','Select a sender'),...numbers.map(n=>option(n.number,n.label+' · '+n.number)));if(numbers.some(n=>n.number===loaded.from))$('from').value=loaded.from;message('Choose the number this application should use.');});
$('connectionId').onchange=()=>{$('from').replaceChildren(option('','Load numbers from selected account'));};
$('settings').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{const c={...loaded};for(const k of Object.keys(c)){const el=$(k);if(!el)continue;c[k]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;}c.connectionId=c.connectionId||null;c.allowedNumbers=$('allowedNumbers').value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean);await api('/config','PUT',c);message('Configuration saved.');await load();});};
$('audioForm').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{const file=$('audioFile').files[0];if(!file)throw new Error('Choose a WAV file');$('audioResult').textContent='Interpreting audio…';try{$('audioResult').textContent=Plain.interpretation(await api('/audio-test','POST',file));}catch(err){$('audioResult').textContent='';throw err;}});};
$('taskForm').oninput=()=>{requestKey=undefined;};
$('taskForm').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{requestKey=requestKey||crypto.randomUUID();const data=await api('/tasks','POST',{to:$('to').value.trim(),objective:$('objective').value.trim(),keywords:$('keywords').value.split(',').map(s=>s.trim()).filter(Boolean),responses:Plain.responses($('responses').value),idempotencyKey:requestKey});$('report').textContent=JSON.stringify(data,null,2);message('Task '+data.status+'. Review its report for the actual outcome.');await refresh();});};
$('refresh').onclick=()=>busy($('refresh'),refresh);
$('taskSearch').oninput=renderTasks;$('taskStatus').onchange=renderTasks;
$('responses').addEventListener('change',buildAnswers);
$('addAnswer').onclick=()=>{$('answerRows').append(answerRow({prompt:'',say:''},$('answerRows').children.length+Date.now()));writeAnswers();};
for(const id of ['calls','settings'])$('tab-'+id).onclick=()=>setView(id);
setView(/(^|[#&])view=settings\b/.test(location.hash)?'settings':'calls');
$('checkTwilio').onclick=()=>busy($('checkTwilio'),async()=>{$('checkResult').textContent='Checking…';await load();$('checkResult').textContent=$('noTwilio').hidden?'':'Still no Twilio connection.';});
load().catch(e=>message(e.message.replaceAll('_',' ')));
}
})();
