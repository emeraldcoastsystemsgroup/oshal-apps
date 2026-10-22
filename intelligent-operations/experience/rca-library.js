/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Browse historical canonical RCA decisions and accepted artifact citations under the current portal session without duplicating reports or inferring recovery. */
(function(root){
'use strict';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
/** @description Project bounded authorized ticket metadata without inferring a cause from report text.
 * @param {object} body Native ticket response. @returns {object[]} Incident metadata. */
function catalogue(body){
 if(!Array.isArray(body?.tickets)||body.tickets.length>10000)throw Error('Historical ticket catalogue is unavailable or exceeds its read budget.');
 const seen=new Set();return body.tickets.filter(t=>['intelligent-operations','intelligent-processing'].includes(t.kind||t.ticketType)).map(t=>{
  const id=t.id||t.ticketId;if(!uuid(id)||seen.has(id))throw Error('Historical ticket identity is invalid or repeated.');seen.add(id);
  const original=[t.title,t.description,t.command].find(v=>typeof v==='string'&&v.trim()&&!/^untitled$/i.test(v.trim()));
  const chars=Array.from((original||'Operations incident · '+id.slice(0,8)).replace(/\s+/g,' ').trim());
  return {id,title:chars.length>100?chars.slice(0,99).join('')+'…':chars.join(''),status:t.status||'unknown',updatedAt:t.updated_at||t.updatedAt||t.created_at||null};
 }).sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime()||a.id.localeCompare(b.id));
}
/** @description Accept only canonical artifact downloads bound to this exact source ticket.
 * @param {string} url Server-supplied artifact URL. @param {string} id Selected ticket. @returns {boolean} Exact local artifact selector. */
function artifactUrl(url,id){
 if(typeof url!=='string'||!uuid(id))return false;
 const match=url.match(/^\/api\/v1\/workspace\/([a-f0-9-]+)\/files\?work=([a-f0-9-]+)&artifact=(0|[1-9][0-9]{0,5})$/i);return Boolean(match&&match[1]===id&&uuid(match[2]));
}
/** @description Bind the library to canonical reads and clear every private view after refused or stale responses.
 * @param {object} options Native-refusal callback. @returns {object} Load and disposal functions. */
function mount({onRefused=()=>{}}={}){
 const $=id=>document.getElementById(id),list=$('rca-list'),detail=$('rca-detail'),status=$('rca-status');let rows=[],generation=0,selection=0,current=null;
 function clear(){generation++;selection++;rows=[];current=null;list.replaceChildren();detail.replaceChildren();status.textContent='Load your historical incident records.';}
 async function read(path){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok){if([401,403].includes(r.status)){clear();onRefused();}throw Error('Historical source is unavailable (HTTP '+r.status+').');}return r.json();}
 function render(){list.replaceChildren();const query=$('rca-search').value.trim().toLowerCase(),filter=$('rca-state').value,matched=rows.filter(t=>(!filter||t.status===filter)&&(!query||[t.title,t.id,t.status].join(' ').toLowerCase().includes(query)));
  const table=text('div','','rca-catalogue');for(const row of matched.slice(0,100)){const button=text('button','','rca-catalogue-row');button.type='button';button.setAttribute('aria-pressed',String(row.id===current));button.append(text('strong',row.title),text('small',row.id.slice(0,8)+' · '+row.status+(row.status==='done'?' · report accepted; recovery not established':'')));button.addEventListener('click',()=>select(row));table.append(button);}list.append(table);if(!matched.length)list.append(text('p','No incident records match these filters.'));
  status.textContent=matched.length+' matching records · '+Math.min(matched.length,100)+' shown. Search covers loaded ticket metadata; open a record for its report and source citations.';
 }
 async function load(){clear();const run=generation;status.textContent='Reading authorized historical tickets…';try{const body=await read('/api/tickets');if(run!==generation)return;rows=catalogue(body);render();}catch(error){if(run===generation){rows=[];list.replaceChildren();detail.replaceChildren();status.textContent=error.message;}}}
 async function select(ticket){
  const run=generation,version=++selection;current=ticket.id;render();detail.replaceChildren(text('p','Reading original workflow decisions and artifact inventory…'));
  const results=await Promise.allSettled([read('/tickets/'+ticket.id+'/work'),read('/api/v1/workspace/'+ticket.id+'/files')]);if(run!==generation||version!==selection)return;
  detail.replaceChildren(text('h2',ticket.title));const open=text('a','Open original ticket');open.href='/cockpit/?app=intelligent-operations&ticket='+ticket.id;open.target='_top';detail.append(open,text('p','Ticket state: '+ticket.status+'. Report acceptance does not establish verified service recovery.','observation-note'));
  if(results[0].status==='fulfilled')renderWork(ticket,results[0].value);else detail.append(text('p',results[0].reason.message,'warning'));
  if(results[1].status==='fulfilled')renderFiles(ticket,results[1].value);else detail.append(text('p','Artifact inventory unavailable. '+results[1].reason.message,'warning'));
 }
 function renderWork(ticket,body){
  if(!Array.isArray(body?.work)||body.work.length>100){detail.append(text('p','Workflow source is malformed or exceeds its read budget.','warning'));return;}
  const completed=body.work.filter(w=>w.state==='completed'&&typeof w.receipt==='string'&&w.receipt&&typeof w.answer==='string'&&!w.resultUnavailable);
  detail.append(text('h3','Recorded RCA decisions'));
  if(!completed.length)detail.append(text('p','No completed analysis with an available result receipt. Failed or pending work is not a reference finding.'));
  for(const work of completed){const card=text('details','','rca-decision');card.append(text('summary',(work.phase?.name||'Analysis')+' · '+(work.bot||'Bot not recorded')));
   card.append(text('p','Source ticket '+ticket.id+' · work '+work.id,'source-citation'),text('p','Result receipt: '+work.receipt,'source-citation'));
   if(work.answer.length>131072){card.append(text('p','Report exceeds the preview budget. Open the canonical artifact.'));}
   else card.append(text('pre',work.answer));
   const input=work.input;card.append(text('h4','Evidence supplied to this analysis'));
   if(!input||input.complete!==true)card.append(text('p','Complete input lineage is unavailable. Do not treat this as a fully traced reference.','warning'));
   if(input?.inputDigest)card.append(text('p','Input digest: '+input.inputDigest,'source-citation'));
   for(const file of (Array.isArray(input?.files)?input.files:[]).slice(0,40))card.append(text('p',String(file.path)+' · SHA-256 '+String(file.sha256)+' · '+String(file.byteLength)+' bytes','source-citation'));
   detail.append(card);
  }
 }
 function renderFiles(ticket,body){
  detail.append(text('h3','Accepted report artifacts'));
  if(body?.success!==true||!Array.isArray(body.files)||body.files.length>300){detail.append(text('p','The canonical artifact inventory is unavailable.','warning'));return;}
  if(body.unavailableRuns?.length)detail.append(text('p',body.unavailableRuns.length+' runs cannot currently release their artifacts.','warning'));
  if(!body.files.length)detail.append(text('p','No accepted workflow artifacts are available.'));
  for(const file of body.files){const card=text('article','','rca-artifact'),label=(file.phase?.name?file.phase.name+' · ':'')+String(file.name||'Artifact');
   if(artifactUrl(file.downloadUrl,ticket.id)){const a=text('a',label);a.href=file.downloadUrl;a.setAttribute('download','');card.append(a);}else card.append(text('strong',label),text('p','Download selector is unavailable.'));
   const digest=Array.isArray(file.digest)&&file.digest.length===32&&file.digest.every(v=>Number.isInteger(v)&&v>=0&&v<=255)?file.digest.map(v=>v.toString(16).padStart(2,'0')).join(''):null;
   card.append(text('p',String(file.size)+' bytes'+(digest?' · SHA-256 '+digest:''),'source-citation'));detail.append(card);
  }
 }
 $('rca-refresh').addEventListener('click',load);$('rca-search').addEventListener('input',render);$('rca-state').addEventListener('change',render);
 return {load,clear};
}
const api={catalogue,artifactUrl,mount};if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsRcaLibrary=api;
})(typeof window==='object'?window:globalThis);
