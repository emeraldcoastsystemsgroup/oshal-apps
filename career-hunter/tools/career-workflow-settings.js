/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read and explicitly save the person's default-off preparation choice, retaining unsaved controls on refusal and never authorizing submission.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1: the saved line says how many saved jobs wait for the person's other experience choice (lib/career-workflow-routes.js prepareSaved waiting) and what to do: prepare one application and choose it there, then save this choice again. Guard: tests/career-prepare-other-experience-route.test.mjs.
 */
(()=>{'use strict';
 const $=id=>document.getElementById(id),API='/api/career-hunter/application-workflow';
 async function request(options){const r=await fetch(API,options),v=await r.json();if(!r.ok||v.error)throw Error(v.error||'Preparation choice unavailable.');return v;}
 const controls=disabled=>{for(const id of ['workflowEnabled','workflowChoices','workflowSave'])$(id).disabled=disabled;};
 async function load(){
  try{const value=await request();if(typeof value.enabled!=='boolean'||!['review','automatic'].includes(value.mode))throw Error('Preparation choice unavailable.');
   $('workflowEnabled').checked=value.enabled;document.querySelector(`[name="workflowMode"][value="${value.mode}"]`).checked=true;controls(false);$('workflowState').textContent=value.enabled?'Preparation is on.':'Preparation is off.';
  }catch(e){controls(true);$('workflowState').textContent='Could not read your choice: '+e.message;}
 }
 $('workflowSave').onclick=async()=>{
  const input={enabled:$('workflowEnabled').checked,mode:document.querySelector('[name="workflowMode"]:checked').value};controls(true);$('workflowState').textContent='Saving…';
  try{const value=await request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
   if(value.ok!==true||value.enabled!==input.enabled||value.mode!==input.mode)throw Error('Saved choice could not be confirmed.');
   $('workflowState').textContent='Saved. '+(value.enabled?'Preparation is on. '+value.queued+' saved jobs queued.':'Preparation is off.')+(value.started===false?' Preparation could not start; open Getting ready to review and retry.':'')+(value.waiting?' '+value.waiting+(value.waiting===1?' waits':' wait')+' for your other experience choice: prepare one application yourself and choose it on step 1 · Tailor, then save this choice again.':'');
  }catch(e){$('workflowState').textContent='Not saved or confirmed: '+e.message+' Your choices are still here. Read Settings again before retrying an uncertain save.';}
  finally{controls(false);}
 };
 void load();
})();
