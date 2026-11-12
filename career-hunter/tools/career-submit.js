/** CHANGE LOG
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 8: canConnect() says whether this visit may connect a computer (a guest visit may not), read the way the activity page read it, so the application page and the activity page offer Connect a computer on one rule and neither offers a button that would be refused.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: résumé carries its accents in the lines a person reads.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | UX Design Standard sweep: opaque sheet attributes (data-ds-sheet, data-no-glass), history Back dismissal on modal sheets, and opaque disabled state on review approve button.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: the Connect a computer dialog had unstyled 21px browser buttons, no close and no scrim. It is the kit's sheet (opaque, a scrim behind, a full sheet on a phone) with an X close, a primary "Create and connect worker" and a tertiary Cancel, both 44px.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Recover interrupted approval/bind/start requests with the same frozen packet and ticket, synchronizing first and refusing expired approvals or uncertain outcomes.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Review exact job documents and applicant facts in place, then publish approval, bind and start one recoverable native submission intent.
 */
(()=>{
  'use strict';const BASE='/api/career-hunter',BOT='cb000000-0000-0000-0000-000000000004';
  async function request(path,body){
    let response;
    try{response=await fetch(BASE+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});}
    catch{throw Error('Submission connection interrupted. Check application status before trying again.');}
    let result;try{result=await response.json();}catch{throw Error('Could not read the submission response (HTTP '+response.status+'). Check application status before trying again.');}
    if(!response.ok){const error=Error(result.error||'Submission request failed.');error.code=result.code;throw error;}return result;
  }
  function text(tag,value,parent){const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;}
  function wireModalBack(dialog,key,onBack){
    let pushed=false;
    const pop=()=>{if(dialog.open){pushed=false;onBack();}};
    window.addEventListener('popstate',pop);
    dialog.addEventListener('close',()=>{
      window.removeEventListener('popstate',pop);
      if(pushed){pushed=false;if(history.state&&history.state.dsSheet===key){try{history.back();}catch{}}}
    });
    return ()=>{dialog.showModal();try{history.pushState({dsSheet:key},'');pushed=true;}catch{}};
  }
  function reviewDialog(packet,ready){
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='ck-sheet';dialog.setAttribute('data-ds-sheet','');dialog.setAttribute('data-no-glass','');
      dialog.style.cssText='width:min(700px,calc(100vw - 32px));max-height:85dvh;box-sizing:border-box;overflow:auto;padding:24px;border:1px solid var(--ds-edge,#ccd1df);border-radius:14px;color:var(--ds-ink,var(--text,#202538));background:var(--ds-surface,var(--surface,#fff))';
      text('h2','Review and submit',dialog);text('p',packet.title+' · '+packet.company,dialog);
      text('p','This authorizes one application using these exact PDFs and the facts below. Missing employer questions will come back to you.',dialog);
      const links=text('p','',dialog);
      for(const documentInfo of packet.documents){
        const a=document.createElement('a');a.href=BASE+'/resume?id='+packet.postingId+(documentInfo.kind==='cover'?'&kind=cover':'');
        a.target='_blank';a.rel='noopener';a.style.marginRight='18px';a.textContent=documentInfo.kind==='cover'?'Open cover letter ↗':'Open résumé ↗';links.append(a);
      }
      const facts=text('dl','',dialog);facts.style.cssText='display:grid;grid-template-columns:minmax(100px,1fr) 2fr;gap:8px 16px;overflow-wrap:anywhere';
      for(const [key,value]of Object.entries(packet.profile)){text('dt',key.replace(/([a-z])([A-Z])/g,'$1 $2'),facts);text('dd',value,facts).style.margin='0';}
      const footer=text('div','',dialog);footer.style.cssText='display:flex;justify-content:flex-end;gap:12px;margin-top:24px;position:sticky;bottom:0;background:inherit;padding-top:12px';
      const cancel=text('button','Cancel',footer),approve=text('button','Approve and submit',footer);
      cancel.type='button';approve.type='button';cancel.className='ck-tertiary';approve.className='ck-primary';approve.disabled=!ready;
      if(!ready){text('p','Connect a browser worker before authorizing submission. You can still review both documents.',dialog);}
      let settled=false;const done=value=>{if(settled)return;settled=true;if(dialog.open)dialog.close();dialog.remove();resolve(value);};cancel.onclick=()=>done(false);approve.onclick=()=>done(true);
      const openDialog=wireModalBack(dialog,'submitReview',()=>done(false));
      dialog.addEventListener('cancel',event=>{event.preventDefault();done(false);});document.body.append(dialog);openDialog();
    });
  }
  async function connectWorker(){
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='ck-sheet';dialog.setAttribute('data-ds-sheet','');dialog.setAttribute('data-no-glass','');dialog.setAttribute('aria-labelledby','connectWorkerTitle');
      const head=text('header','',dialog),body=text('div','',dialog),foot=text('footer','',dialog);body.className='ck-sheet-body';
      const title=text('h2','Connect your Career browser worker',head);title.id='connectWorkerTitle';
      const close=text('button','✕',head);close.type='button';close.className='ck-icon';close.setAttribute('aria-label','Close');
      text('p','Create a dedicated worker credential for your Career account. It can process jobs you specifically approve, read their résumé, cover letter and application facts, and click final Submit once.',body);
      text('p','The worker uses its own private browser profile on the bare-metal computer. Your ordinary Chrome tabs stay separate. You can revoke this worker from Nodes. This step does not send an application to an employer.',body);
      text('p','A private configuration file will download for the local worker installer. Keep it private.',body);
      const status=text('p','',body),cancel=text('button','Cancel',foot),connect=text('button','Create and connect worker',foot);
      status.setAttribute('role','status');cancel.type='button';connect.type='button';cancel.className='ck-tertiary';connect.className='ck-primary';
      let settled=false;const done=value=>{if(settled)return;settled=true;if(dialog.open)dialog.close();dialog.remove();resolve(value);};cancel.onclick=()=>done(false);close.onclick=()=>done(false);
      dialog.addEventListener('click',event=>{if(event.target===dialog)done(false);});
      connect.onclick=async()=>{
        connect.disabled=true;cancel.disabled=true;status.textContent='Connecting your dedicated worker…';
        try{
          const nativePost=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const result=await r.json();if(!r.ok)throw Error('Worker connection was refused. Your account or node permission needs attention.');return result;};
          const invite=await nativePost('/nodes/join-codes',{capabilities:[],lifetime_ms:300000});
          const enrolled=await nativePost('/nodes/join',{code:invite.code,kind:'remote',harness:{custom:'browser-form-v1'},capabilities:{browse:true}});
          await nativePost('/nodes/'+enrolled.node.id+'/bots/'+BOT,{});
          const config={version:1,kernelUrl:location.origin,nodeId:enrolled.node.id,deviceToken:enrolled.token,botId:BOT,
            owner:enrolled.node.owner,tenant:enrolled.node.tenant};
          const blob=new Blob([JSON.stringify(config,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
          a.href=url;a.download='career-browser-worker.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
          status.textContent='Worker connected to your account. Install the downloaded private configuration on this computer to bring it online.';
          connect.remove();cancel.disabled=false;cancel.textContent='Done';
        }catch(error){status.textContent=error.message;connect.disabled=false;cancel.disabled=false;}
      };
      const openDialog=wireModalBack(dialog,'connectWorker',()=>done(false));
      dialog.addEventListener('cancel',event=>{event.preventDefault();done(false);});document.body.append(dialog);openDialog();
    });
  }
  async function reviewAndSubmit(postingId){
    const packet=await request('/submission-review/'+encodeURIComponent(postingId));
    const availability=await workers().catch(()=>({available:false}));
    if(!await reviewDialog(packet,availability.available))return null;
    const approved=await request('/submission-queue',{postingId,packetDigest:packet.packetDigest,approved:true});
    await request('/submission-queue/'+approved.item.id+'/bind',{});
    const started=await request('/submission-queue/'+approved.item.id+'/start',{});
    if(window.CareerJobActions)await window.CareerJobActions.monitor(true).catch(()=>{});
    return started.item;
  }
  const recovering=new Map();
  function resumeApproved(id){
    if(typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))return Promise.reject(Error('Select one approved application.'));
    if(recovering.has(id))return recovering.get(id);
    const operation=(async()=>{
      const {items=[]}=await request('/submission-queue');let item=items.find(i=>i.id===id);
      if(!item)throw Error('This approved application is unavailable.');
      if(item.status!=='queued')return item;
      // A lost start acknowledgement may hide claimed or completed work. Read it
      // before attempting the same start; unknown outcomes never become new work.
      if(item.nativeTicketId)item=(await request('/submission-queue/'+id+'/sync',{})).item;
      if(item.status!=='queued')return item;
      if(!Number.isFinite(Date.parse(item.authorizationExpiresAt))||Date.parse(item.authorizationExpiresAt)<=Date.now())
        throw Error('This approval expired. This approved application cannot be resumed.');
      if(!(await workers()).available)throw Error('Connect your browser worker before resuming this application.');
      // Keep these separate published requests. A lost acknowledgement must not
      // lose the ticket binding that a later recovery will reuse.
      if(!item.nativeTicketId)item=(await request('/submission-queue/'+id+'/bind',{})).item;
      item=(await request('/submission-queue/'+id+'/start',{})).item;
      if(window.CareerJobActions)await window.CareerJobActions.monitor(true).catch(()=>{});
      return item;
    })();
    const pending=operation.finally(()=>recovering.delete(id));recovering.set(id,pending);return pending;
  }
  async function answerAndReview(id,postingId){
    const {items}=await request('/submission-queue'),item=items.find(i=>i.id===id&&i.postingId===postingId);
    if(item?.status!=='needs_you'||!item.questions?.length)throw Error('No unanswered employer questions are available.');
    const answers=await new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.style.cssText='width:min(640px,calc(100vw - 32px));max-height:85vh;overflow:auto;padding:24px;border:1px solid #ccd1df;border-radius:16px';
      text('h2','Employer questions',dialog);text('p','Your answers apply to this job. Review the updated application before authorizing another attempt.',dialog);
      const fields=[];
      for(const question of item.questions){
        const label=text('label',question.text,dialog);label.style.cssText='display:block;margin:18px 0';
        const input=document.createElement(question.options?.length?'select':'textarea');input.style.cssText='display:block;width:100%;box-sizing:border-box;padding:10px;margin-top:8px';
        if(question.options?.length){const blank=document.createElement('option');blank.value='';blank.textContent='Choose an answer';input.append(blank);
          for(const value of question.options){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}}
        input.maxLength=2000;label.append(input);fields.push([question.id,input]);
      }
      const cancel=text('button','Cancel',dialog),save=text('button','Save answers and review',dialog);save.style.marginLeft='12px';
      const done=value=>{dialog.close();dialog.remove();resolve(value);};cancel.onclick=()=>done(null);
      save.onclick=()=>{if(fields.some(([,el])=>!el.value.trim())){fields.find(([,el])=>!el.value.trim())[1].focus();return;}
        done(Object.fromEntries(fields.map(([key,el])=>[key,el.value])));};
      dialog.addEventListener('cancel',e=>{e.preventDefault();done(null);});document.body.append(dialog);dialog.showModal();
    });
    if(!answers)return null;await request('/submission-queue/'+id+'/answers',{answers});return reviewAndSubmit(postingId);
  }
  async function synchronize(){
    const {items=[]}=await request('/submission-queue');const active=items.filter(i=>i.nativeTicketId&&!['submitted','cancelled','needs_you','failed','unknown'].includes(i.status));
    // Keep private owner writes short and serial; every sync uses accepted native evidence.
    for(const item of active.slice(0,20))try{await request('/submission-queue/'+item.id+'/sync',{});}catch{/* An unavailable result remains visible in its last recorded state. */}
    return (await request('/submission-queue')).items||[];
  }
  async function workers(){
    const response=await fetch('/api/apply-operator/workers',{cache:'no-store'});if(!response.ok)throw Error('Browser workers unavailable');
    const raw=await response.json(),workers=(raw.workers||[]).filter(w=>w.boundBots?.includes(BOT));
    const ready=workers.find(w=>w.available);return {...raw,workers,available:!!ready,defaultClientId:ready?.clientId||null};
  }
  /** Whether this visit may connect a computer. A guest visit has no account for a computer to belong to, so it may not. */
  async function canConnect(){
    const read=path=>fetch(path,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
    const [guest,user]=await Promise.all([read('/api/guest/session'),read('/api/auth/user')]);
    return !((guest&&(guest.guest===true||guest.active===true))||(user&&(user.guest===true||/^urn:oshal:guest:|^guest[-:]/i.test(String(user.sub||user.principal_id||'')))));
  }
  window.CareerSubmit={reviewAndSubmit,resumeApproved,answerAndReview,connectWorker,synchronize,workers,canConnect,request};
})();
