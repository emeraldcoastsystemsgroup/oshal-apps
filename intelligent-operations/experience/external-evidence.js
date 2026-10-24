/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Configure optional per-source Splunk enrichment through the standard personal connection, with its last recorded outcomes and no credential fields. */
(function(root){
'use strict';
const $=id=>document.getElementById(id);
const node=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
function mount({request,sources,onRefused}){
 const status=$('external-status'),list=$('external-sources'),outcomes=$('external-outcomes');
 let revision=0,generation=0;
 function clear(){generation++;list.replaceChildren();outcomes.replaceChildren();status.textContent='Refresh to inspect your enrichment configuration.';}
 async function load(){
  const run=++generation;status.textContent='Reading your Splunk enrichment setting and recorded results…';
  try{
   const [config,history]=await Promise.all([request('/external-evidence/config'),request('/external-evidence')]);
   if(run!==generation)return;
   revision=config.revision||0;
   $('external-enabled').checked=config.enabled===true;
   $('external-account').value=config.account||'primary';
   $('external-index').value=config.index||'main';
   list.replaceChildren();
   for(const source of sources()){
    const label=node('label',''),box=document.createElement('input');box.type='checkbox';box.value=source.id;box.checked=(config.sourceIds||[]).includes(source.id);
    label.append(box,document.createTextNode(' '+source.name+' · '+source.environment));list.append(label);
   }
   outcomes.replaceChildren();
   for(const item of history.items||[]){
    const row=node('article','');row.className='processing-job';
    row.append(node('strong',(item.status||'unknown')+' · '+(item.resourceId||'resource unavailable')),node('p',(item.provider||'splunk')+' · '+(item.index||'index unavailable')+' · '+(item.earliest||'time unavailable')+' to '+(item.latest||'time unavailable')),node('small',(item.reason||'')+' · '+(item.items?.length||0)+' attached events'+(item.truncated?' · clipped':'')));
    outcomes.append(row);
   }
   if(!history.items?.length)outcomes.append(node('p','No captured enrichment outcomes yet. A saved setting applies to the next captured incident, not historical tickets.'));
   status.textContent=config.enabled?'Enabled for '+config.sourceIds.length+' source revision(s). Reads occur before the investigation input is sealed.':'Off. Captured incidents still record that no external query was configured.';
  }catch(error){if(run!==generation)return;if([401,403].includes(error.status)){clear();onRefused();return;}status.textContent=error.message;}
 }
 $('external-refresh').addEventListener('click',load);
 $('external-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;status.textContent='Saving your source-to-Splunk mapping…';
  try{
   await request('/external-evidence/config',{enabled:$('external-enabled').checked,account:$('external-account').value.trim(),index:$('external-index').value.trim(),sourceIds:[...list.querySelectorAll('input:checked')].map(input=>input.value),expectedRevision:revision});
   await load();
  }catch(error){if([401,403].includes(error.status)){clear();onRefused();}else{status.textContent=error.message;if(error.status===409)await load();}}
  finally{button.disabled=false;}
 });
 return {load,clear};
}
const api={mount};if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsExternalEvidence=api;
})(typeof window==='object'?window:globalThis);
