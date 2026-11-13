/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Connect Career's Gmail authorization through native custody, separately from dated mailbox-read evidence and optional Social navigation.
 */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const states={connected:'Saved Gmail authorization',expiring:'Saved authorization expires soon',renewable:'Renews when used',expired:'Sign in again',revoked:'Revoked'};
  let catalog=null,sequence=0,waiting=null;
  function el(tag,text,cls){const node=document.createElement(tag);if(cls)node.className=cls;node.textContent=text;return node;}
  function date(value){const at=typeof value==='string'||typeof value==='number'?new Date(value):null;return at&&Number.isFinite(at.getTime())?at.toLocaleString():'';}
  function gmailRows(){return catalog?catalog.connections.filter(row=>row&&row.connector==='gmail'):[];}
  function signature(){return JSON.stringify(gmailRows().map(row=>[row.account,row.status,row.liveness,row.expiresAt]).sort());}
  async function request(path){
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(5500)});
    if(!response.ok)throw Error('Status unavailable (HTTP '+response.status+').');
    return response.json();
  }
  function renderAccounts(){
    const rows=gmailRows();
    const state=byId('careerAccountsState');
    state.textContent=!catalog?'Saved authorization is unavailable. Refresh to try again.':rows.length?'Saved Gmail authorization metadata; this does not verify mailbox access.':'No saved Gmail authorization was reported for your account.';
    byId('careerSavedAccounts').replaceChildren(...rows.map(row=>{
      const line=el('p','', 'hint');
      const status=states[row.status||row.liveness]||'Saved authorization status unknown';
      line.append(el('strong',status),document.createTextNode(' · '+String(row.account||'Unlabelled account')+(row.shared?' · Shared authorization':'')));
      const expiry=date(row.expiresAt);if(expiry)line.append(document.createTextNode(' · Expires '+expiry));
      return line;
    }));
    const connect=byId('careerGmailConnect');
    const declaration=catalog&&catalog.connectors.find(row=>row&&row.id==='gmail');
    connect.disabled=!declaration||!['o_auth','oauth'].includes(declaration.auth?.kind);
    connect.textContent=rows.length?'Reconnect Gmail':'Connect Gmail';
    state.dataset.loaded='true';
  }
  function renderMailbox(mail){
    const host=byId('careerMailboxEvidence');
    const successful=date(mail?.lastSuccessAt),checked=date(mail?.lastCheckedAt);
    const lines=[];
    if(successful)lines.push('Last successful mailbox check: '+successful+'.');
    else lines.push(mail?'Mailbox access has not been checked successfully.':'Mailbox check status is unavailable.');
    if(checked)lines.push('Last check attempt: '+checked+'.');
    if(mail?.mailbox)lines.push('Mailbox last checked: '+String(mail.mailbox)+'.');
    if(mail?.expectedMailbox)lines.push('Submission email expected: '+String(mail.expectedMailbox)+'.');
    if(mail?.error)lines.push('Last check: '+String(mail.error));
    host.replaceChildren(...lines.map(line=>el('p',line,'hint')));
  }
  async function read(){
    const own=++sequence;byId('careerAccountsRefresh').disabled=true;
    const [saved,mail]=await Promise.allSettled([request('/connectors'),request('/api/career-hunter/jobs/updates')]);
    if(own!==sequence)return;
    const before=signature();
    catalog=saved.status==='fulfilled'&&Array.isArray(saved.value?.connectors)&&Array.isArray(saved.value?.connections)?saved.value:null;
    renderAccounts();renderMailbox(mail.status==='fulfilled'&&mail.value&&typeof mail.value==='object'?mail.value:null);
    byId('careerAccountsRefresh').disabled=false;
    if(waiting&&gmailRows().length&&signature()!==before){stopWaiting();notice('Saved authorization state was read again. Check mailbox access separately.');}
  }
  function notice(text){byId('careerAccountsNotice').textContent=text;}
  function stopWaiting(){
    if(waiting){clearInterval(waiting.timer);waiting.channel?.close();waiting=null;}
    byId('careerGmailAgain').hidden=true;byId('careerGmailStop').hidden=true;
  }
  function heard(message){
    if(!waiting||message?.type!=='connect-outcome'||message.connector!=='gmail')return;
    stopWaiting();
    if(message.ok!==true){notice('Gmail sign-in did not finish. '+String(message.text||'You can try again.'));return;}
    notice('Reading your saved authorization. Mailbox access is checked separately.');void read();
  }
  function begin(){
    if(byId('careerGmailConnect').disabled)return;
    stopWaiting();
    const back='/utilities?connected=gmail&window=connect';
    const url='/api/connect/gmail/start?return='+encodeURIComponent(back);
    window.open(url,'_blank','noopener');
    notice('Waiting for Gmail sign-in. Finish in the window that opened; no mailbox check is started here.');
    byId('careerGmailAgain').href=url;byId('careerGmailAgain').hidden=false;byId('careerGmailStop').hidden=false;
    waiting={started:Date.now(),channel:null,timer:null};
    try{waiting.channel=new BroadcastChannel('oshal-connections');waiting.channel.onmessage=event=>heard(event.data);}catch{/* Persisted readback below also works without a channel. */}
    waiting.timer=setInterval(()=>{
      if(!waiting)return;
      if(Date.now()-waiting.started>=600000){stopWaiting();notice('Stopped waiting for sign-in. Refresh account status or try again.');return;}
      void read();
    },2500);
  }
  async function social(){
    const host=byId('careerSocialAccount');
    host.dataset.loaded='loading';
    try{
      const entries=await window.CareerFrame?.entries();
      const entry=Array.isArray(entries)&&entries.find(row=>row.view==='social-workspace'&&row.href==='/api/social/workspace');
      if(entry){
        const link=el('a','Open optional Social workspace','btn');link.href=entry.href;
        link.addEventListener('click',event=>{event.preventDefault();window.CareerFrame.open(entry.view);});
        host.append(link);
      }
    }catch{/* Missing admission never creates an optional link. */}
    host.dataset.loaded='true';
  }
  function enter(){if(location.hash==='#accounts'){void read();if(!byId('careerSocialAccount').dataset.loaded)void social();}}
  function wire(){
    if(!byId('careerAccounts'))return;
    byId('careerAccountsRefresh').addEventListener('click',()=>void read());
    byId('careerGmailConnect').addEventListener('click',begin);
    byId('careerGmailStop').addEventListener('click',()=>{stopWaiting();notice('Stopped waiting. Your saved authorization has not been changed.');});
    window.addEventListener('hashchange',enter);
    window.addEventListener('pagehide',()=>{++sequence;stopWaiting();});
    enter();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();
