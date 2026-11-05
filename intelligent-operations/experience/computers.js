/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Your computers on the Connections page (kernel ADR-206): the signed-in person's own computers from the kernel's /api/computers, each with whether Jarvis can use it now, and Work on it, which opens the kernel's own page for that computer (Jarvis on it, its screen beside, a command line) in the top window. Operations holds no computer, no device token and no picture: the kernel does, for the owner alone. */
'use strict';
(function(){
 const state={connected:'Connected. Jarvis can use it.',off:'Connected. Control is off on that computer.',gone:'Not connected'};
 /** @description What a computer's row says. Pure. */
 function standing(computer){return !computer.connected?state.gone:computer.can_control?state.connected:state.off;}
 /** @description Where Work on it goes: the kernel's page for that computer, in the top window. Pure. */
 function workHref(id){return '/cockpit/tools/computer.html?id='+encodeURIComponent(String(id));}
 /** @description Mount the Your computers card on the Connections page: it loads with the page, refreshes on request, and clears on refusal. */
 function mount({onRefused}){
  const $=id=>document.getElementById(id),panel=$('computers-panel');if(!panel)return {load(){},clear(){}};
  let generation=0;
  const say=value=>{$('computers-standing').textContent=value;};
  function clear(){generation++;$('computers-list').replaceChildren();say('Refresh to read your computers.');}
  function render(computers){
   const list=$('computers-list');list.replaceChildren();
   for(const computer of computers){
    const row=document.createElement('tr');
    const name=document.createElement('td');name.textContent=computer.name||('Computer '+String(computer.id).slice(0,8));
    const status=document.createElement('td');status.textContent=standing(computer);
    const action=document.createElement('td');
    if(computer.can_control){const work=document.createElement('a');work.href=workHref(computer.id);work.target='_top';work.textContent='Work on it';action.append(work);}
    row.append(name,status,action);list.append(row);
   }
   say(computers.length?'Your own computers. Nobody else can see or reach them.':'You have no computers connected yet. Install OSHAL Node on a computer, sign in there and press Allow when it asks whether Jarvis may control it.');
  }
  async function load(){
   const mine=++generation;say('Reading your computers…');
   try{
    const r=await fetch('/api/computers',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
    const body=await r.json().catch(()=>({}));
    if(mine!==generation)return;
    if(r.status===401||r.status===403){clear();onRefused();say(r.status===401?'Sign in through OSHAL to continue, then press Refresh.':'Your current OSHAL role does not permit this operation.');return;}
    if(!r.ok)throw new Error(typeof body.detail==='string'?body.detail:'Refused (HTTP '+r.status+').');
    render(Array.isArray(body.computers)?body.computers:[]);
   }catch(error){if(mine===generation){$('computers-list').replaceChildren();say('Your computers could not be read: '+error.message);}}
  }
  $('computers-refresh').addEventListener('click',()=>{void load();});
  void load();
  return {load,clear};
 }
 window.OperationsComputers={mount,standing,workHref};
})();
