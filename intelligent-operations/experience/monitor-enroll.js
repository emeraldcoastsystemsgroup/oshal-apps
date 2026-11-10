/* CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Monitoring Trust M2 (1.8.0): adds headless device self-registration (--register, Windows, macOS) and configuration-pack commands (--config-pack alertmanager|prometheus|otel), pending device approval with Ed25519 key fingerprint and allowed source IP/CIDR editing, and per-installation device trust + allowed address controls with graceful fallback on pre-M1 kernels. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | ADR-216 S2 (1.7.0): the install lines add a Linux server with an OpenTelemetry Collector (--agent otel). Each installation card gets its producer token's controls (access): the last delivery and its status as the kernel records it (firstDeliveryAt, lastDelivery), Rotate token (the person's own POST /api/v1/producer-tokens/{id}/rotate; the server picks the new token up within 5 minutes and the old one stops 10 minutes after the new one's first report), and Disconnect, two presses with what goes and what stays said first: it revokes every producer token naming the installation's route, then asks Operations to stop watching it with its history kept, so no InstallationSilent follows. A kernel that lists none of those fields shows no delivery line and no Rotate token. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-216 S1 (1.6.0): Monitor an installation on Systems. The one-line installs for this installation's own origin (/monitor/install.sh, a Linux server or a Kubernetes cluster), each with Copy; Download an enrolment file, which asks the kernel for a confirmation and then its offline enrolment (POST /api/v1/producer-enrollments/offline, the person's own act), saves oswarm-enrollment.json and shows the line that redeems it, the code itself never on the page; the servers approved but not yet reporting, from what prepare recorded and the person's producer tokens. Each installation card gets a line saying when and how it was enrolled and when its producer token expires. Removing a source revokes every producer token of this application whose route names it (DELETE /api/v1/producer-tokens/{id}, the person's own write); a revoke that fails is said here with Revoke again, and the source's reports are refused either way. Every value reaches the page through textContent. */
(function(root){
'use strict';
const APP='intelligent-operations',TOKENS='/api/v1/producer-tokens',OFFLINE='/api/v1/producer-enrollments/offline',FILE='oswarm-enrollment.json',OPERATIONS='/api/intelligent-operations';
/** What the second Disconnect press does, said before it is offered. */
const DISCONNECT_NOTE='Disconnect revokes this installation\'s producer token, so its server can no longer report here, and stops watching it, so Operations raises no InstallationSilent when its reports stop. Its card leaves Systems. Its source, chart history, readings, alerts and investigations stay: enrol the server again under the same name and they come back.';
const ROTATING='Rotation requested; the server picks it up within 5 minutes.';
const AGENT={prometheus:'the Prometheus stack',otel:'an OpenTelemetry Collector',existing:'its own Alertmanager',windows:'Windows Exporter and OTel Collector',macos:'macOS node_exporter and OTel Collector','config-pack':'a configuration pack'};
const NAME=/^[\x20-\x7e]{1,80}$/;
/** An approval waits this long for its server to collect a token: an offline file's day, longer than a code's ten minutes. */
const WAIT_MS=86400000;
const el=(tag,value='',cls='')=>{const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;};
const when=value=>{const t=typeof value==='number'?value:Date.parse(value);return Number.isFinite(t)?new Date(t).toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'an unknown time';};
const plural=(n,one)=>n===1?'Its '+one:'Its '+n+' '+one+'s';
const tokenIdOf=token=>token?.tokenId||token?.id||'';

/** @description The one-line installs, served by the kernel at /monitor/install.sh. Pure. @param origin This page's origin, the address the person reaches this installation at. @returns Each line with what it is for. */
function commands(origin){
 const install='curl -fsSL '+origin+'/monitor/install.sh';
 return [
  {id:'linux',label:'A Linux server',note:'Run it on the server, as root. It installs the monitoring (Prometheus and Alertmanager in Docker) and points it here.',line:install+' | sudo bash'},
  {id:'otel',label:'A Linux server with an OpenTelemetry Collector',note:'Run it on the server, as root. It installs one OpenTelemetry Collector instead, with no Docker; Operations reads its metrics and raises the alerts itself.',line:install+' | sudo bash -s -- --agent otel'},
  {id:'kubernetes',label:'A Kubernetes cluster',note:'Run it on a computer whose kubectl reaches the cluster. The monitoring goes into its own namespace.',line:install+' | bash -s -- --kubernetes'},
 ];
}
/** @description Headless self-registration, Windows/macOS, and existing monitoring stack configuration packs. Pure. @param origin This page's origin. @returns Each line with what it is for. */
function packCommands(origin){
 const install='curl -fsSL '+origin+'/monitor/install.sh';
 return [
  {id:'register',label:'Headless Linux self-registration (Ed25519 device key)',note:'Generates a local Ed25519 device keypair and registers a pending device for approval here.',line:install+' | sudo bash -s -- --register'},
  {id:'windows',label:'A Windows Server host',note:'Run in an elevated PowerShell prompt to register the host and start Windows Exporter + OTel Collector.',line:'irm '+origin+'/monitor/install-windows.ps1 | iex'},
  {id:'macos',label:'A macOS host',note:'Run in Terminal to register the host and start node_exporter + OTel Collector via launchd.',line:'curl -fsSL '+origin+'/monitor/install-macos.sh | sudo bash -s -- --register'},
  {id:'pack-alertmanager',label:'Existing Alertmanager configuration pack',note:'Prints the webhook_configs YAML snippet and registers the device key.',line:install+' | bash -s -- --config-pack alertmanager'},
  {id:'pack-prometheus',label:'Existing Prometheus remote_write configuration pack',note:'Prints the remote_write YAML snippet and registers the device key.',line:install+' | bash -s -- --config-pack prometheus'},
  {id:'pack-otel',label:'Existing OpenTelemetry Collector configuration pack',note:'Prints the otlphttp exporter YAML snippet and registers the device key.',line:install+' | bash -s -- --config-pack otel'},
 ];
}
/** @description The line that redeems an enrolment file on the server. Pure. @param origin This page's origin. @returns The command. */
const fileLine=origin=>'curl -fsSL '+origin+'/monitor/install.sh | sudo bash -s -- --file '+FILE;
/** @description Whether a producer token reaches this source: one of this application's, on an /ingest/ route ending in the source id. Pure. @param token A token as the kernel lists it. @param sourceId The source. @returns True when it does. */
function names(token,sourceId){
 const route=String(token?.route||'');
 return (!token?.app||token.app===APP)&&(route.startsWith('/ingest/')||route.startsWith(OPERATIONS+'/ingest/'))&&route.endsWith('/'+sourceId)&&token?.status!=='pending';
}
const newest=list=>list.slice().sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0))[0];
/** @description The line an installation card shows about its enrolment and its producer token. Pure. @param enrollment What prepare recorded, or null. @param tokens The person's producer tokens, or null when they were not read. @param sourceId The card's source. @returns The sentences, or '' when there is nothing to say. */
function cardLine(enrollment,tokens,sourceId){
 const parts=[];
 if(enrollment){
  parts.push('Enrolled '+when(enrollment.preparedAt)+(enrollment.agent?' with '+AGENT[enrollment.agent]:'')+(enrollment.host?' on '+enrollment.host:'')+'.');
  if(enrollment.fingerprint||enrollment.publicKey)parts.push('Key '+(enrollment.fingerprint||enrollment.publicKey)+'.');
  if(Array.isArray(enrollment.allowedIps)&&enrollment.allowedIps.length)parts.push('Allowed IPs: '+enrollment.allowedIps.join(', ')+'.');
 }
 if(Array.isArray(tokens)){
  const mine=tokens.filter(t=>names(t,sourceId)),last=mine.length?newest(mine):null;
  if(last)parts.push((mine.length>1?mine.length+' producer tokens reach it; the newest ':'Its producer token ')+(last.expiresAt?'expires '+when(last.expiresAt):'does not expire')+'.');
  else if(enrollment)parts.push('No producer token names its route now.');
 }
 return parts.join(' ');
}
/** @description What a server approved but not yet reporting is waiting for. Pure. @param enrollment What prepare recorded. @param tokens The person's producer tokens, or null when they were not read. @param now Milliseconds now. @returns The sentence. */
function waitingLine(enrollment,tokens,now){
 const approved='Approved '+when(enrollment.preparedAt);
 if(!Array.isArray(tokens))return approved+'; waiting for its first report.';
 const mine=tokens.filter(t=>names(t,enrollment.sourceId));
 if(mine.length)return 'Its token was collected '+when(newest(mine).createdAt)+'; waiting for its first report.';
 if(now-Date.parse(enrollment.preparedAt)>WAIT_MS)return approved+', but its server never collected a token and the code has expired. Run the install line on the server again.';
 return approved+'; waiting for the server to collect its token.';
}

/** @description The token a card's controls act on: of those naming the source, one not yet replaced, the newest. Pure. @param tokens The person's producer tokens. @param sourceId The source. @returns The token, or null. */
function currentToken(tokens,sourceId){
 const mine=(Array.isArray(tokens)?tokens:[]).filter(t=>names(t,sourceId));if(!mine.length)return null;
 const live=mine.filter(t=>!t.successorId);return newest(live.length?live:mine);
}
/** @description What a card says about its producer token's deliveries, rotation and replaced tokens, from the kernel's list. A kernel that records no deliveries says nothing. Pure. @param tokens The person's producer tokens. @param sourceId The source. @returns The sentences, or ''. */
function deliveryLine(tokens,sourceId){
 const token=currentToken(tokens,sourceId);if(!token)return '';
 const parts=[],last=token.lastDelivery;
 if(Object.prototype.hasOwnProperty.call(token,'lastDelivery')){
  if(last&&Number.isFinite(Number(last.status)))parts.push('Last delivery '+when(last.at)+': '+(last.status>=200&&last.status<300?'accepted':'refused')+' (HTTP '+last.status+').');
  else if(!token.firstDeliveryAt)parts.push('No delivery has used its producer token yet.');
  if(token.firstDeliveryAt)parts.push('First accepted '+when(token.firstDeliveryAt)+'.');
 }
 if(token.rotateRequested)parts.push(ROTATING);
 const replaced=(tokens||[]).filter(t=>t!==token&&names(t,sourceId)&&t.retiresAt);
 if(replaced.length)parts.push((replaced.length===1?'The token it replaced stops working ':replaced.length+' tokens it replaced stop working by ')+when(Math.max(...replaced.map(t=>Number(t.retiresAt)||0)))+'.');
 return parts.join(' ');
}

/** @description Put a line on the clipboard, or select it so the keyboard can. @param code The element holding the line. @param say Where to report. @returns Nothing. */
async function copy(code,say){
 try{await navigator.clipboard.writeText(code.textContent);say('Copied.');}
 catch{const range=document.createRange();range.selectNodeContents(code);const picked=root.getSelection();picked.removeAllRanges();picked.addRange(range);say('Selected. Copy it with your keyboard.');}
}
/** @description One command with its Copy button. @param label Its heading. @param note What it does. @param line The command. @param say Where Copy reports. @param cls Block class name. @returns The block. */
function lineBlock(label,note,line,say,cls='monitor-line'){
 const block=el('div','',cls),head=el('p'),code=el('code',line),button=el('button','Copy');
 head.append(el('strong',label),document.createTextNode(note?' '+note:''));button.type='button';button.setAttribute('aria-label','Copy the line for '+label.toLowerCase());
 button.addEventListener('click',()=>void copy(code,say));block.append(head,code,button);return block;
}
/** @description Save the enrolment file the kernel answered, as oswarm-enrollment.json. @param file {swarm, app, name, code, expiresAt}. @returns Nothing. */
function save(file){
 const url=URL.createObjectURL(new Blob([JSON.stringify(file,null,1)+'\n'],{type:'application/json'})),link=document.createElement('a');
 link.href=url;link.download=FILE;document.body.append(link);link.click();link.remove();root.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/** @description A kernel route, called with the person's session. @param path The route. @param init Fetch options. @returns {ok, status, body}. */
async function kernel(path,init={}){
 const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...init,headers:{Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers||{})}});
 return {ok:r.ok,status:r.status,body:await r.json().catch(()=>({}))};
}
/** @description A refusal in the kernel's own words. Pure. @param r A kernel answer. @returns The words. */
const why=r=>!r?'this page could not reach the installation':r.status===401?'sign in through OSHAL first':'HTTP '+r.status+(r.body?.detail||r.body?.error?': '+(r.body.detail||r.body.error):'');

/** @description Build the panel's parts once. @param panel Its element. @param origin This page's origin. @returns The parts later reads fill. */
function build(panel,origin){
 const status=el('p','','monitor-status'),say=text=>{status.textContent=text;};status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 panel.className='card monitor-enroll';
 panel.replaceChildren(el('h2','Monitor an installation'),el('p','Run one line on the server. It prints a link and a code: open the link here, signed in as yourself, check what it says about the server, and press Monitor this installation. The server then reports to your Operations. Nothing is copied by hand.','operator-note'));
 for(const c of commands(origin))panel.append(lineBlock(c.label,c.note,c.line,say));
 const packs=el('details','','monitor-packs');
 packs.append(el('summary','Headless self-registration, Windows/macOS & existing Alertmanager / Prometheus / OTel packs'),el('p','Register a server with an Ed25519 device keypair (--register) and approve it below, or print a ready-to-paste configuration pack (--config-pack) for an existing monitoring stack.','operator-note'));
 for(const c of packCommands(origin))packs.append(lineBlock(c.label,c.note,c.line,say,'monitor-pack-line'));
 const file=el('details','','monitor-file'),label=el('label','Name of the installation'),input=el('input'),go=el('button','Download an enrolment file'),result=el('div','','monitor-file-result');
 input.maxLength=80;input.autocomplete='off';input.spellcheck=false;label.append(input);go.type='button';result.hidden=true;
 file.append(el('summary','No browser or terminal on the server? Download an enrolment file'),el('p','For cloud-init, an image or a network that reaches only this installation\'s producer door. The file works once, within a day, and holds no password.','operator-note'),label,go,result);
 const pendingWrap=el('div','','monitor-pending'),pendingTitle=el('h3','Devices awaiting approval'),pendingList=el('ul','','monitor-pending-list');
 pendingWrap.hidden=true;pendingWrap.append(pendingTitle,pendingList);
 const waitingTitle=el('h3','Waiting for their first report'),waiting=el('ul','','monitor-waiting'),revoke=el('div','','monitor-revoke');
 waitingTitle.hidden=waiting.hidden=revoke.hidden=true;revoke.setAttribute('role','status');revoke.setAttribute('aria-live','polite');
 panel.append(packs,file,pendingWrap,waitingTitle,waiting,revoke,status);
 return {say,input,go,result,pendingWrap,pendingList,waitingTitle,waiting,revoke};
}

/**
 * @description Mount Monitor an installation into its panel on Systems.
 * @param options {panel, onChange}: the panel element, and what to call when the producer tokens were read again (the cards re-render their line).
 * @returns {update, line, revokeFor, clear, access}.
 */
function mount({panel,onChange}){
 if(!panel)return {update(){},line(){return '';},async revokeFor(){},clear(){},access(){return {node:el('div'),fill(){}};}};
 const origin=root.location.origin,parts=build(panel,origin);
 let tokens=null,pending=[],enrollments=[],reported=new Set(),reading=null;
 const waitingOnes=()=>enrollments.filter(e=>!reported.has(e.sourceId));
 function renderWaiting(){
  const list=waitingOnes(),now=Date.now(),items=list.map(e=>{const li=el('li');li.append(el('strong',e.name),document.createTextNode(' '+waitingLine(e,tokens,now)));return li;});
  const text=items.map(i=>i.textContent).join('\n');if(parts.waiting.dataset.text!==text){parts.waiting.dataset.text=text;parts.waiting.replaceChildren(...items);}
  parts.waiting.hidden=parts.waitingTitle.hidden=!list.length;
 }
 function renderPending(){
  if(!Array.isArray(pending)||!pending.length){parts.pendingWrap.hidden=true;parts.pendingList.replaceChildren();return;}
  parts.pendingWrap.hidden=false;
  const items=pending.map(dev=>{
   const id=tokenIdOf(dev),name=dev.name||dev.host||id||'pending-device',fp=dev.publicKeyFingerprint||dev.fingerprint||dev.publicKey||'unverified-key';
   const defaultIps=Array.isArray(dev.allowedIps)&&dev.allowedIps.length?dev.allowedIps.join(', '):(dev.observedIp||'');
   const li=el('li','','monitor-pending-item'),meta=el('span',' Key: '+fp+(dev.observedIp?' · Observed IP: '+dev.observedIp:'')+' '),ipInput=el('input','','monitor-pending-ips'),btn=el('button','Approve device');
   ipInput.type='text';ipInput.value=defaultIps;ipInput.placeholder='Allowed IPs / CIDRs (comma-separated)';ipInput.setAttribute('aria-label','Allowed IP addresses for '+name);
   btn.type='button';
   btn.addEventListener('click',async()=>{
    btn.disabled=true;
    const allowedIps=ipInput.value.split(',').map(s=>s.trim()).filter(Boolean);
    const r=await kernel(TOKENS+'/'+encodeURIComponent(id)+'/approve',{method:'POST',body:JSON.stringify({name,allowedIps,publicKeyFingerprint:fp})}).catch(()=>null);
    btn.disabled=false;
    if(r?.ok){parts.say('Approved '+name+'.');tokens=null;await readTokens();onChange?.('enrolled');}
    else parts.say('Could not approve '+name+': '+why(r)+'.');
   });
   li.append(el('strong',name),meta,ipInput,btn);return li;
  });
  parts.pendingList.replaceChildren(...items);
 }
 function readTokens(){
  if(reading)return reading;
  reading=(async()=>{
   try{
    const r=await kernel(TOKENS);
    const all=r.ok&&Array.isArray(r.body?.producerTokens)?r.body.producerTokens:null;
    tokens=all;
    const extra=r.ok&&Array.isArray(r.body?.pendingEnrollments)?r.body.pendingEnrollments:(r.ok&&Array.isArray(r.body?.pendingDevices)?r.body.pendingDevices:[]);
    pending=[...(Array.isArray(all)?all.filter(t=>t?.status==='pending'):[]),...extra];
   }catch{tokens=null;pending=[];}
   finally{reading=null;}
   renderPending();renderWaiting();onChange?.();
  })();
  return reading;
 }
 /** Each read of the installations: who reports, and what prepare recorded. The tokens are read once, then again while a server is still waiting. */
 function update(rows,list){reported=new Set((rows||[]).map(r=>r.sourceId));enrollments=Array.isArray(list)?list:[];renderWaiting();if(tokens===null||waitingOnes().length)void readTokens();}
 function fileResult(made){
  const lead=el('p','Saved '+FILE+' for '+made.name+'. Copy it to the server and run this there, beside the file. It works once, until '+when(made.expiresAt)+'.','operator-note');
  parts.result.replaceChildren(lead,lineBlock('On the server','',fileLine(origin),parts.say));parts.result.hidden=false;
 }
 async function download(){
  const name=parts.input.value.trim();parts.result.hidden=true;
  if(!NAME.test(name)){parts.say('Name the installation in 1 to 80 plain characters: letters, digits, spaces and punctuation.');parts.input.focus();return;}
  parts.go.disabled=true;parts.say('Making the enrolment file…');
  try{
   const proof=await kernel('/confirmations',{method:'POST',body:'{}'});
   if(!proof.ok||!proof.body?.confirmation){parts.say('No enrolment file was made: '+why(proof)+'.');return;}
   const made=await kernel(OFFLINE,{method:'POST',body:JSON.stringify({app:APP,name}),headers:{'x-oshal-confirm':proof.body.confirmation}});
   if(!made.ok||typeof made.body?.code!=='string'){parts.say('No enrolment file was made: '+why(made)+'.');return;}
   const {swarm,app,code,expiresAt}=made.body;save({swarm,app,name:made.body.name,code,expiresAt});fileResult(made.body);parts.say('');onChange?.('enrolled');
  }catch{parts.say('No enrolment file was made: '+why(null)+'.');}
  finally{parts.go.disabled=false;}
 }
 parts.go.addEventListener('click',e=>{if(e.detail<=1)void download();});
 function sayRevoke(text,retry){
  const again=retry?el('button','Revoke again'):null;if(again){again.type='button';again.addEventListener('click',()=>{again.disabled=true;void retry();});}
  parts.revoke.replaceChildren(el('p',text),...(again?[again]:[]));parts.revoke.hidden=false;
 }
 /** @description Revoke every producer token that names a removed source's route. @param sourceId The removed source. @param name Its name, for the sentence. @returns Nothing; the sentence says what happened. */
 async function revokeFor(sourceId,name){
  const retry=()=>revokeFor(sourceId,name),refused=' Its reports are refused all the same.';
  let listed=null;try{listed=await kernel(TOKENS);}catch{}
  if(!listed?.ok)return sayRevoke('Removed '+name+'. Its producer tokens could not be read to revoke them ('+why(listed)+').'+refused,retry);
  const mine=(listed.body?.producerTokens||[]).filter(t=>names(t,sourceId));
  if(!mine.length){sayRevoke('Removed '+name+'. No producer token named it.');return;}
  let failed=false,refusal=null;
  for(const t of mine){let r=null;try{r=await kernel(TOKENS+'/'+encodeURIComponent(tokenIdOf(t)),{method:'DELETE'});}catch{}if(!r||(!r.ok&&r.status!==404)){failed=true;refusal=r;}}
  tokens=null;void readTokens();
  if(failed)return sayRevoke('Removed '+name+'. '+plural(mine.length,'producer token')+' could not be revoked ('+why(refusal)+').'+refused,retry);
  sayRevoke('Removed '+name+'. '+plural(mine.length,'producer token')+(mine.length===1?' was':' were')+' revoked.');
 }
 function clear(){tokens=null;pending=[];enrollments=[];reported=new Set();renderPending();renderWaiting();parts.revoke.hidden=true;parts.result.hidden=true;parts.say('');}
 const tokenAccess=(id,heading,hooks)=>access(id,heading,{tokens:()=>tokens,enrollments:()=>enrollments,reread:()=>{tokens=null;return readTokens();},...hooks});
 return {update,line:row=>cardLine(enrollments.find(e=>e.sourceId===row.sourceId)||null,tokens,row.sourceId),revokeFor,clear,access:tokenAccess};
}

/** @description Ask the kernel to rotate one token: the person's own write; the server rotates at its next check. @param token The token. @returns The sentence to show. */
async function rotate(token){
 let r=null;try{r=await kernel(TOKENS+'/'+encodeURIComponent(tokenIdOf(token))+'/rotate',{method:'POST',body:'{}'});}catch{}
 if(r?.ok)return {ok:true,text:ROTATING};
 if(r?.status===404)return {ok:false,text:'That token is no longer yours to rotate: it was revoked or replaced.'};
 return {ok:false,text:'Rotation was not requested: '+why(r)+'.'};
}
/** @description Save allowed source IP addresses / CIDRs on a producer token. @param token The token. @param allowedIps Array of IP/CIDR strings. @returns {ok, text}. */
async function saveAddresses(token,allowedIps){
 let r=null;try{r=await kernel(TOKENS+'/'+encodeURIComponent(tokenIdOf(token))+'/addresses',{method:'POST',body:JSON.stringify({allowedIps})});}catch{}
 if(r?.ok)return {ok:true,text:'Allowed addresses updated.'};
 return {ok:false,text:'Allowed addresses were not updated: '+why(r)+'.'};
}
/** @description Disconnect: revoke every producer token naming the source, then stop watching it with its history kept. A token that cannot be revoked stops it before anything else changes. @param id The source. @param mine The tokens naming it. @returns {ok, gone, text}. */
async function disconnect(id,mine){
 for(const t of mine){
  let r=null;try{r=await kernel(TOKENS+'/'+encodeURIComponent(tokenIdOf(t)),{method:'DELETE'});}catch{}
  if(!r||(!r.ok&&r.status!==404))return {ok:false,text:'Not disconnected: its producer token could not be revoked ('+why(r)+'). Nothing else changed.'};
 }
 let r=null;try{r=await kernel(OPERATIONS+'/ingest/mapping',{method:'POST',body:JSON.stringify({stopWatching:true,sourceId:id,disconnect:true})});}catch{}
 if(r?.ok)return {ok:true};
 const revoked='Its producer token was revoked, so its server can no longer report here, but ';
 if(r?.status===403)return {ok:false,gone:true,text:revoked+'your role cannot stop watching it: Operations will call it silent in 10 minutes.'};
 return {ok:false,gone:true,text:revoked+'Operations could not stop watching it ('+(r?.body?.error||why(r))+'). Press Disconnect again.'};
}
/**
 * @description A card's producer-token controls, built once and filled on every read: the delivery line, device trust + allowed addresses, Rotate token, and Disconnect in two presses.
 * @param id The card's source.
 * @param heading The card's heading, which takes the focus when the offer goes.
 * @param hooks {tokens, enrollments, reread, disconnected}: the panel's token list and a fresh read of it, and what to do once the card is disconnected.
 * @returns {node, fill(row)}.
 */
function access(id,heading,{tokens,enrollments,reread,disconnected}){
 const node=el('div','','installation-access'),line=el('p','','operator-note installation-delivery'),trust=el('p','','operator-note installation-trust');
 const addrRow=el('div','','installation-addresses'),addrInput=el('input','','installation-ips-input'),addrSave=el('button','Save addresses');
 const buttons=el('div','','installation-access-buttons'),turn=el('button','Rotate token'),first=el('button'),sure=el('div','','installation-disconnect-sure'),note=el('p',DISCONNECT_NOTE,'operator-note'),go=el('button'),said=el('p','','installation-access-alert');
 addrInput.type='text';addrInput.placeholder='Allowed IPs / CIDRs (comma-separated)';addrInput.setAttribute('aria-label','Allowed IP addresses');addrSave.type='button';
 addrRow.append(addrInput,addrSave);trust.hidden=addrRow.hidden=true;
 turn.type=first.type=go.type='button';said.setAttribute('role','alert');said.tabIndex=-1;sure.append(note,go);buttons.append(turn,first);node.append(line,trust,addrRow,buttons,sure,said);
 let current=null,asked=false,busy=false,message='';
 const show=(text)=>{message=text||'';fill(current);if(message)said.focus({preventScroll:true});};
 turn.addEventListener('click',async e=>{const token=currentToken(tokens(),id);if(e.detail>1||busy||!token)return;busy=true;fill(current);const r=await rotate(token);busy=false;message=r.ok?'':r.text;await reread();fill(current);if(!r.ok)said.focus({preventScroll:true});});
 addrSave.addEventListener('click',async e=>{
  const token=currentToken(tokens(),id);if(e.detail>1||busy||!token)return;
  const allowedIps=addrInput.value.split(',').map(s=>s.trim()).filter(Boolean);
  busy=true;fill(current);const r=await saveAddresses(token,allowedIps);busy=false;message=r.text;await reread();fill(current);if(!r.ok)said.focus({preventScroll:true});
 });
 first.addEventListener('click',e=>{if(e.detail>1||busy)return;asked=!asked;fill(current);if(asked){go.focus({preventScroll:true});go.scrollIntoView({block:'nearest'});}});
 go.addEventListener('click',async e=>{
  if(e.detail>1||!asked||busy)return;const mine=(tokens()||[]).filter(t=>names(t,id));asked=false;busy=true;message='';fill(current);
  const r=await disconnect(id,mine);busy=false;
  if(r.ok){await reread();return disconnected?.(id);}
  if(r.gone)await reread();show(r.text);
 });
 go.addEventListener('keydown',e=>{if(e.repeat&&['Enter',' '].includes(e.key))e.preventDefault();});
 function fill(row){
  if(!row)return;current=row;
  const list=tokens(),token=currentToken(list,id),enr=(enrollments?.()||[]).find(e=>e.sourceId===id)||null;
  const held=node.contains(document.activeElement),open=Boolean(token)||Boolean(message);
  const text=deliveryLine(list,id);if(line.textContent!==text)line.textContent=text;line.hidden=!text;
  const hasTokenTrust=Boolean(token&&(Object.prototype.hasOwnProperty.call(token,'allowedIps')||token.publicKeyFingerprint||token.fingerprint||token.observedIp));
  const hasEnrTrust=Boolean(enr&&(enr.fingerprint||enr.publicKey||(Array.isArray(enr.allowedIps)&&enr.allowedIps.length)||enr.observedIp));
  if(hasTokenTrust||hasEnrTrust){
   const fp=token?.publicKeyFingerprint||token?.fingerprint||enr?.fingerprint||enr?.publicKey||'';
   const ips=Array.isArray(token?.allowedIps)?token.allowedIps:(Array.isArray(enr?.allowedIps)?enr.allowedIps:[]);
   const obs=token?.observedIp||enr?.observedIp||'';
   const tParts=[];if(fp)tParts.push('Key: '+fp);if(ips.length)tParts.push('Allowed addresses: '+ips.join(', '));else if(obs)tParts.push('Observed address: '+obs);
   const trustText=tParts.join(' · ');if(trust.textContent!==trustText)trust.textContent=trustText;trust.hidden=!trustText;
   addrRow.hidden=!hasTokenTrust;
   if(hasTokenTrust&&document.activeElement!==addrInput)addrInput.value=ips.join(', ');
   addrSave.disabled=busy;
  }else{trust.hidden=true;addrRow.hidden=true;}
  turn.hidden=!(token&&Object.prototype.hasOwnProperty.call(token,'rotateRequested')&&!token.rotateRequested&&!token.successorId);turn.disabled=busy;
  first.hidden=!token;first.disabled=busy;first.textContent=asked?'Keep it connected':'Disconnect';if(!token)asked=false;
  sure.hidden=!asked;go.textContent=asked?'Disconnect '+row.name:'';go.disabled=busy;
  said.textContent=message;said.hidden=!message;node.hidden=!open;
  if(held&&!node.contains(document.activeElement))heading.focus({preventScroll:true});
 }
 return {node,fill};
}

const api={mount,commands,packCommands,cardLine,waitingLine,names,currentToken,deliveryLine,DISCONNECT_NOTE};
if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationsMonitorEnroll=api;
})(typeof window==='object'?window:globalThis);
