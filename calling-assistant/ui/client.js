/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The Calling Assistant page client: configuration, sender numbers, the audio interpretation test, task start, reports and cancel, all against the package's own routes.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Gate every start path on the shared kit's decision (ADR-164 D6). When the page renders an audience view the client stops before its first read, so the /config probe (it reaches the speech provider registry), the /tasks refresh and every form and button listener stay off; without a view, or without the kit, the full page boots exactly as before. The body moved into a function so the gate can hold it back; no line of it changed.
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
  const data=await response.json(); if(!response.ok) throw new Error(data.error||'Request failed'); return data;
}
async function busy(button,fn) {button.disabled=true;try{await fn();}catch(e){message(e.message.replaceAll('_',' '));}finally{button.disabled=false;}}
function option(value,text) { const o=document.createElement('option');o.value=value;o.textContent=text;return o; }
function renderConfig(data) {
  loaded=data.config;
  $('connectionId').replaceChildren(option('','Select a connection'),...data.connections.map(c=>option(c.id,`${c.label} (${c.scope})`)));
  $('sttProvider').replaceChildren(...data.providers.map(p=>option(p.id,`${p.id}${p.configured?'':' — not configured'}`)));
  $('from').replaceChildren(option('','Select a sender'),...(loaded.from?[option(loaded.from,loaded.from)]:[]));
  for(const [k,v] of Object.entries(loaded)) {const el=$(k);if(!el)continue;if(el.type==='checkbox')el.checked=v;else el.value=Array.isArray(v)?v.join('\n'):v??'';}
  $('readiness').textContent=data.effectiveEnabled?'Enabled for approved calls':'Calling is disabled or needs configuration';
}
async function load() {renderConfig(await api('/config'));await refresh();}
async function refresh() {
  const {tasks}=await api('/tasks');$('tasks').replaceChildren();
  if(!tasks.length)$('tasks').textContent='No phone tasks yet.';
  for(const task of tasks){const row=document.createElement('div');row.className='task row';const label=document.createElement('span');label.textContent=`${new Date(task.created_at).toLocaleString()} · ${task.status} ${task.outcome||''}`;const show=document.createElement('button');show.textContent='View report';show.onclick=()=>busy(show,async()=>{$('report').textContent=JSON.stringify(await api('/tasks/'+task.id),null,2);});row.append(label,show);
    if(['dialing','active','transferring'].includes(task.status)){const cancel=document.createElement('button');cancel.textContent='Cancel call';cancel.className='danger';cancel.onclick=()=>busy(cancel,async()=>{await api('/tasks/'+task.id+'/cancel','POST');await refresh();});row.append(cancel);} $('tasks').append(row);}
}
$('loadNumbers').onclick=()=>busy($('loadNumbers'),async()=>{const {numbers}=await api('/numbers?connectionId='+encodeURIComponent($('connectionId').value));$('from').replaceChildren(option('','Select a sender'),...numbers.map(n=>option(n.number,n.label+' · '+n.number)));if(numbers.some(n=>n.number===loaded.from))$('from').value=loaded.from;message('Choose the number this application should use.');});
$('connectionId').onchange=()=>{$('from').replaceChildren(option('','Load numbers from selected account'));};
$('settings').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{const c={...loaded};for(const k of Object.keys(c)){const el=$(k);if(!el)continue;c[k]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;}c.connectionId=c.connectionId||null;c.allowedNumbers=$('allowedNumbers').value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean);await api('/config','PUT',c);message('Configuration saved.');await load();});};
$('audioForm').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{const file=$('audioFile').files[0];if(!file)throw new Error('Choose a WAV file');$('audioResult').textContent='Interpreting audio…';$('audioResult').textContent=JSON.stringify(await api('/audio-test','POST',file),null,2);});};
$('taskForm').oninput=()=>{requestKey=undefined;};
$('taskForm').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{requestKey=requestKey||crypto.randomUUID();const data=await api('/tasks','POST',{to:$('to').value.trim(),objective:$('objective').value.trim(),keywords:$('keywords').value.split(',').map(s=>s.trim()).filter(Boolean),responses:JSON.parse($('responses').value),idempotencyKey:requestKey});$('report').textContent=JSON.stringify(data,null,2);message('Task '+data.status+'. Review its report for the actual outcome.');await refresh();});};
$('refresh').onclick=()=>busy($('refresh'),refresh);
load().catch(e=>message(e.message.replaceAll('_',' ')));
}
})();
