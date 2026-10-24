/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Your runbooks: keep one runbook per alert type; an investigation for that alert type attaches it as the owner's own guidance (evidence/runbook.md). Save is revision-checked; nothing runs from a runbook; a refused session clears the panel. */
(function(root){'use strict';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
function mount({request,onRefused}){
 const $=id=>document.getElementById(id),panel=$('runbooks-panel');if(!panel)return {load(){},clear(){}};
 let generation=0,items=[];
 function clear(){generation++;items=[];$('runbooks-list')?.replaceChildren();const status=$('runbooks-status');if(status)status.textContent='Load your runbooks.';}
 function render(){const list=$('runbooks-list');list.replaceChildren();if(!items.length){list.append(text('p','No runbooks yet. Add one for an alert type your investigations should follow.','operator-note'));return;}
  const table=text('table','','ops-table'),head=text('tr');for(const h of ['Alert type','First line','Revision','Updated',''])head.append(text('th',h));table.append(head);
  for(const r of items){const tr=text('tr'),edit=text('button','Edit'),cell=text('td');edit.type='button';edit.addEventListener('click',()=>{$('runbook-type').value=r.alertType;$('runbook-text').value=r.markdown;$('runbook-type').dataset.revision=String(r.revision);});cell.append(edit);
   const when=new Date(r.updatedAt);tr.append(text('td',r.alertType),text('td',String(r.markdown).split('\n').find(l=>l.trim())||''),text('td',String(r.revision)),text('td',Number.isNaN(when.getTime())?'—':when.toLocaleString()),cell);table.append(tr);}
  const wrap=text('div','','ops-table-wrap');wrap.append(table);list.append(wrap);}
 async function load(){const run=++generation;try{const r=await request('/runbooks');if(run!==generation)return;items=r.items||[];render();$('runbooks-status').textContent=items.length+' runbook'+(items.length===1?'':'s')+'. Investigations attach the one matching their alert type.';}catch(e){if(run===generation){if([401,403].includes(e.status)){clear();onRefused?.();}$('runbooks-status').textContent=e.message;}}}
 $('runbook-form').addEventListener('submit',async event=>{event.preventDefault();const type=$('runbook-type'),button=$('runbook-save');button.disabled=true;try{
   const held=items.find(r=>r.alertType===type.value.trim());const saved=await request('/runbooks',{alertType:type.value.trim(),markdown:$('runbook-text').value,expectedRevision:held?held.revision:0});
   $('runbooks-status').textContent='Saved the runbook for '+saved.alertType+' (revision '+saved.revision+').';await load();}catch(e){$('runbooks-status').textContent=e.message;}finally{button.disabled=false;}});
 clear();return {load,clear};
}
const api={mount};if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsRunbooks=api;
})(typeof window==='object'?window:globalThis);
