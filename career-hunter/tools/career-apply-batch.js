/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The smart build (design apply-smart-design-2026-11-26, 2.0): the approval sheet says What Career does by itself on these sites, one sentence for each of the person's five switches (packet assistLinesAny, which names no one site's senders), beside How Career fills them in.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-CONCURRENT (Roger, 2026-11-25): the panel's advance is batch work (careerBatch through CareerSubmit.request's {batch:true}) and keeps its own waiting while Career is busy; the person's own presses wait to save like any change (tools/career-pending-writes.js). Guard: tests/career-concurrent-writes.test.mjs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-BATCH, store gate: a job in the queue reads In line before it starts and Waiting for you while the run waits for him (Needs you is a retired stage name, tests/career-words.test.mjs); the counts say N waiting for you and N in line. A queue read that fails while the panel moves the queue on is tried again on the next tick and no longer written into the page's status line, where it replaced what the page had just said (New matches' Saved: after a swipe); only a press says its error.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-BATCH (Roger, 2026-11-21: "i really need to be able to post 200 resumes by monday ... these local jobs will fill up fast"): Fill in several on my Chrome, on My jobs and on a job's page. The approval sheet lists each selected job with its company, title, files (the résumé for upload forms is the one uploaded), site and engine, says How Career fills it in and what it does in his name once for the whole batch, says in words that one batch holds at most 50 jobs, and says how many selected jobs still need documents with Prepare them; Approve and start approves each job's own packet (POST /apply-batch, a few at a time) and starts the first. The queue panel shows each job's state and one line (In line, Filling in, Waiting for you, Ready for you, Submitted, Skipped, Failed), the counts, and Next job, Skip this job, Pause the queue, Go on, Stop the queue, Approve again and Clear; it moves the queue on (POST /apply-batch/advance) every few seconds while it runs, hands what he kept on a question card to Career, and stops the job on his computer through the kernel's own confirmed ticket cancel before Skip, Next job or Stop, which leaves its Chrome tab open.
 */
(()=>{'use strict';
 const API='/api/career-hunter',MOST=50,CHUNK=5,EVERY=4000,DONE=new Set(['applied','interview','offer','rejected']);
 const WORD={waiting:'In line',filling:'Filling in','needs-you':'Waiting for you',ready:'Ready for you',submitted:'Submitted',skipped:'Skipped',failed:'Failed'};
 const DOCUMENT={'resume-docx':'Résumé for upload forms (Word), uploaded','resume-pdf':'Résumé (PDF)','cover-pdf':'Cover letter (PDF)'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const request=(path,body,options)=>window.CareerSubmit.request(path,body,options);
 const plural=(n,one,many)=>n+' '+(n===1?one:many);
 /** @description Whether his Job Apply computer can fill in forms (it reports browser-apply). @param {object|null} availability CareerSubmit.workers(). @returns {{ready:boolean,name:string}} */
 const device=availability=>window.CareerApplyAssist?CareerApplyAssist.device(availability):{ready:false,name:''};
 /** @description His queue, or null. @returns {Promise<object|null>} */
 const read=()=>request('/apply-batch').then(answer=>answer.queue);
 /**
  * @description Split the selected jobs: the ones with documents, the ones still needing them, and the ones already applied.
  * @param {object[]} jobs Rows from My jobs. @returns {{ready:object[],needDocs:object[],applied:object[]}}
  */
 function split(jobs){
  const out={ready:[],needDocs:[],applied:[]};
  for(const job of jobs)(DONE.has(job.status)?out.applied:job.has_resume&&job.has_cover?out.ready:out.needDocs).push(job);
  return out;
 }
 /** Read each job's exact packet (GET /apply-review/:id), four at a time; a job Career cannot fill in says why. */
 async function reviews(jobs){
  const out=new Array(jobs.length);let next=0;
  const worker=async()=>{for(let at=next++;at<jobs.length;at=next++){const job=jobs[at];
   try{out[at]={job,packet:await request('/apply-review/'+encodeURIComponent(job.id))};}catch(error){out[at]={job,why:String(error.message||'not ready').replace(/\.$/,'')};}}};
  await Promise.all([worker(),worker(),worker(),worker()]);
  return out;
 }
 function make(tag,text,parent,className){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;if(parent)parent.append(el);return el;}
 function jobLine(list,{job,packet}){
  const item=make('li',null,list,'ab-job');make('b',packet.company||job.company,item);item.append(' · '+(packet.title||job.title));
  const files=packet.documents.map(doc=>DOCUMENT[doc.id]||doc.name).join(' · ');
  make('span',files,item,'ab-files');make('span',`${packet.site?.name||'Employer site'} · ${packet.host}`,item,'ab-site');
 }
 /** The sheet's words about the whole batch: the computer, how it fills in, what it does in his name, and where it stops. */
 function batchWords(body,plan){
  const first=plan.ok[0].packet;
  make('p',`Career fills them in one after another on ${plan.device||'your Job Apply computer'}, each in a Chrome window of its own, and starts the next only when the one before has ended. Each job is its own approval of its own documents.`,body);
  make('h3','How Career fills them in',body);const flags=make('ul',null,body,'ab-flags');for(const line of first.flagLines||[])make('li',line,flags);
  const stop=first.flags?.submit==='submit-after-approval'?'Career checks each Review page and presses Submit once. You can stop it before then.':'Career stops at each employer’s Review page, or before any button that sends the application. You press Submit; Next job leaves it open and goes on.';
  make('p',stop,body,'ab-stop');
  make('h3','What Career does in your name',body);const attest=make('ul',null,body,'ab-attest');for(const line of first.attestLines||[])make('li',line,attest);
  const alone=first.assistLinesAny||first.assistLines||[];
  if(alone.length){make('h3','What Career does by itself on these sites',body);const help=make('ul',null,body,'ab-help');for(const line of alone)make('li',line,help);}
  make('p','Change these under Saved answers. An approval lasts 24 hours.',body,'hint');
 }
 function leftWords(body,plan,prepare,finish){
  if(plan.over)make('p',`Career fills in at most ${MOST} jobs in one batch${plan.room<MOST?`, and ${MOST-plan.room} are waiting in your queue now`:''}. The first ${plan.ok.length+plan.refused.length} are listed here; approve the other ${plan.over} after.`,body,'ab-bound');
  if(plan.needDocs.length){const line=make('p',`${plural(plan.needDocs.length,'job you selected still needs','jobs you selected still need')} documents, so Career leaves ${plan.needDocs.length===1?'it':'them'} out. `,body,'ab-needs');
   if(prepare){const button=make('button','Prepare them',line,'ck-btn');button.type='button';button.dataset.abPrepare='';button.onclick=()=>{finish(false);prepare(plan.needDocs);};}}
  const out=[...plan.applied.map(job=>`${job.company} (already applied)`),...plan.refused.map(({job,why})=>`${job.company} (${why})`)];
  if(out.length)make('p',`Left out: ${out.join('; ')}.`,body,'hint ab-left');
 }
 /**
  * @description The approval sheet. Resolves true only when he pressed Approve and start; Cancel, Escape and Back approve nothing.
  * @param {object} plan @param {Function|null} prepare @returns {Promise<boolean>}
  */
 function sheet(plan,prepare){
  return new Promise(resolve=>{
   const dialog=make('dialog',null,document.body,'ck-sheet ab-sheet'),n=plan.ok.length;
   dialog.setAttribute('data-ds-sheet','');dialog.setAttribute('data-no-glass','');dialog.setAttribute('aria-labelledby','abSheetTitle');
   const head=make('header',null,dialog),body=make('div',null,dialog,'ck-sheet-body'),foot=make('footer',null,dialog);
   make('h2',n?`Fill in ${plural(n,'job','jobs')} on my Chrome?`:'None of these can be filled in now',head).id='abSheetTitle';
   let done=false;const finish=value=>{if(done)return;done=true;if(dialog.open)dialog.close();dialog.remove();resolve(value);};
   if(n){batchWords(body,plan);make('h3',plural(n,'job','jobs'),body);const list=make('ol',null,body,'ab-jobs');for(const one of plan.ok)jobLine(list,one);}
   leftWords(body,plan,prepare,finish);
   const cancel=make('button',n?'Cancel':'Close',foot,'ck-tertiary');cancel.type='button';cancel.onclick=()=>finish(false);
   if(n){const go=make('button',`Approve and start ${n}`,foot,'ck-primary');go.type='button';go.dataset.abApprove='';go.onclick=()=>finish(true);}
   dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
   dialog.showModal();
  });
 }
 /** Approve the reviewed packets a few at a time, then start the first; what the server refused comes back with its words. */
 async function approveAll(ok){
  const refused=[];let queue=null;
  for(let at=0;at<ok.length;at+=CHUNK){
   const answer=await request('/apply-batch',{jobs:ok.slice(at,at+CHUNK).map(({packet})=>({postingId:packet.postingId,packetDigest:packet.packetDigest})),approved:true});
   refused.push(...answer.refused);queue=answer.queue;
  }
  if(queue)queue=(await request('/apply-batch/advance',{},{batch:true})).queue||queue;
  return {queue,refused};
 }
 /**
  * @description Fill in several on my Chrome for the selected jobs: read each exact packet, ask once, approve each and start.
  * @param {object[]} jobs The selected rows. @param {{say:Function,prepare?:Function,availability?:object}} options
  * @returns {Promise<object|null>} The queue after approval, or null when nothing was approved.
  */
 async function confirm(jobs,options){
  const say=options.say||(()=>{}),availability=options.availability||await window.CareerSubmit.workers().catch(()=>null),chosen=device(availability);
  const parts=split(jobs),current=await read().catch(()=>null);
  const room=current&&!['done','stopped'].includes(current.state)?current.room:MOST,take=parts.ready.slice(0,room);
  say(`Reading the exact documents for ${plural(take.length,'job','jobs')}…`);
  const read2=await reviews(take);say('');
  const plan={device:chosen.name,room,over:parts.ready.length-take.length,needDocs:parts.needDocs,applied:parts.applied,ok:read2.filter(one=>one.packet),refused:read2.filter(one=>!one.packet)};
  if(!chosen.ready){say('Fill in several on my Chrome needs your Job Apply computer connected with the Orbit Browser add-on. Nothing was approved.');return null;}
  if(!await sheet(plan,options.prepare||null)){say('Nothing was approved.');return null;}
  say(`Approving ${plural(plan.ok.length,'job','jobs')}…`);
  const {queue,refused}=await approveAll(plan.ok),names=new Map(plan.ok.map(({job})=>[job.id,job.company]));
  const not=refused.map(item=>`${names.get(item.postingId)||'Job '+item.postingId} (${String(item.why).replace(/\.$/,'')})`);
  say(`${plural(plan.ok.length-refused.length,'job is','jobs are')} in your fill-in queue.${not.length?' Not added: '+not.join('; ')+'.':''}`);
  window.dispatchEvent(new CustomEvent('career-apply-batch',{detail:{queue}}));
  return queue;
 }
 const btn=(text,name,primary=false)=>`<button type="button" class="${primary?'ck-primary':'ck-btn'}" data-ab="${name}">${esc(text)}</button>`;
 /** @description "3 submitted · 1 ready for you · 1 waiting for you · 0 failed · 4 in line". @param {object} queue @returns {string} */
 function countLine(queue){
  const c=queue.counts;
  return [`${c.submitted} submitted`,`${c.ready} ready for you`,`${c.needsYou} waiting for you`,`${c.failed} failed`,c.waiting?`${c.waiting} in line`:'',c.skipped?`${c.skipped} skipped`:''].filter(Boolean).join(' · ');
 }
 function heading(queue){
  const at=queue.entries.findIndex(entry=>entry.active)+1;
  if(queue.state==='paused')return 'Your fill-in queue is paused';
  if(queue.state==='stopped')return 'Your fill-in queue stopped';
  if(queue.state==='done')return 'Your fill-in queue is finished';
  return at?`Filling in job ${at} of ${queue.entries.length} on your Chrome`:'Filling in on your Chrome';
 }
 function rowMarkup(entry){
  return `<li class="ab-row" data-ab-job="${entry.postingId}" data-ab-state="${entry.state}"${entry.active?' data-ab-current':''}><span class="ab-state">${esc(WORD[entry.state]||entry.state)}</span>`
   +`<span class="ab-what"><b>${esc(entry.company)}</b> · ${esc(entry.title)}${entry.reason?`<span class="ab-reason">${esc(entry.reason)}</span>`:''}</span>`
   +`<a class="ab-open" href="${API}/board-native?view=queue&amp;application=${entry.postingId}" data-career-tool="career-submissions" aria-label="Open ${esc(entry.title)} at ${esc(entry.company)}">Open</a></li>`;
 }
 /**
  * @description The queue panel: heading, counts, the one line of what is happening, each job, and the buttons it offers now.
  * @param {object} queue publicQueue. @param {{compact?:boolean}} [options] @returns {string} Markup.
  */
 function panel(queue,{compact=false}={}){
  const current=queue.current,going=!['done','stopped'].includes(queue.state),again=queue.entries.filter(entry=>entry.expired&&entry.state==='needs-you');
  const line=queue.reason||(current?`${current.company}: ${current.reason}`:'');
  const buttons=[current?.state==='ready'?btn('Next job','next',true):'',current?btn('Skip this job','skip'):'',queue.state==='running'?btn('Pause the queue','pause'):'',
   queue.state==='paused'?btn('Go on','go-on',true):'',going?btn('Stop the queue','stop'):'',again.length?btn(`Approve again (${again.length})`,'again'):'',!going?btn('Clear','clear'):''].join('');
  const list=`<ol class="ab-list">${queue.entries.map(rowMarkup).join('')}</ol>`;
  return `<h2 id="applyBatchTitle">${esc(heading(queue))}</h2><p class="ab-counts" id="applyBatchCounts">${esc(countLine(queue))}</p>${line?`<p class="ab-line" id="applyBatchLine">${esc(line)}</p>`:''}`
   +`<div class="ab-actions">${buttons}</div>${compact?`<details class="ab-details"><summary>${plural(queue.entries.length,'job','jobs')} in the queue</summary>${list}</details>`:list}`
   +`<p class="hint">At most ${MOST} jobs wait at once. Career starts the next only when the job on your computer has ended.</p>`;
 }
 /** Stop the job on his computer through the kernel's own confirmed ticket cancel; its Chrome tab stays open. */
 async function stopCurrent(queue){
  const current=queue?.current;
  if(!current?.ticketId||!['filling','needs-you','ready'].includes(current.state))return;
  await CareerApplyAssist.stop({id:current.runId,nativeTicketId:current.ticketId});
 }
 /**
  * @description Show his queue in `host` and keep it moving while it runs: every few seconds the queue is moved on, and
  * what he kept on a question card of the job on his computer is handed to Career. Survives a reload: it reads the queue
  * from his store. @param {Element} host @param {{say:Function,compact?:boolean,prepare?:Function,onChange?:Function}} options
  * @returns {{refresh:Function}}
  */
 function mount(host,options){
  const say=options.say||(()=>{}),handled=new Set();let queue=null,timer=null,busy=false,pressing=false;
  const moving=()=>!!queue&&(queue.state==='running'||!!queue.current);
  const draw=()=>{host.hidden=!queue;host.innerHTML=queue?panel(queue,options):'';if(options.onChange)options.onChange(queue);};
  async function handCards(){
   const current=queue?.current;if(!current||!window.CareerApplyAssist)return;
   try{const read=await CareerApplyAssist.cards(current.runId),fresh=read.kept.filter(item=>!handled.has(item.id));
    if(fresh.length){await CareerApplyAssist.keep(current.runId,fresh);for(const item of fresh)handled.add(item.id);}}
   catch(error){console.warn('career: question cards unread',error.message);}
  }
  async function tick(){
   clearTimeout(timer);if(busy)return;busy=true;
   // A read that fails is tried again on the next tick and never written over the page's own status line.
   try{if(!moving())queue=await read();if(moving())queue=(await request('/apply-batch/advance',{},{batch:true})).queue;if(moving()&&queue.current)await handCards();}
   catch(error){console.warn('career: fill-in queue unread',error.message);}
   finally{busy=false;}
   draw();if(moving())timer=setTimeout(tick,EVERY);
  }
  async function press(name){
   clearTimeout(timer);
   if(name==='again'){const jobs=queue.entries.filter(entry=>entry.expired&&entry.state==='needs-you').map(entry=>({id:entry.postingId,company:entry.company,title:entry.title,status:'generated',has_resume:true,has_cover:true}));
    await confirm(jobs,{say,prepare:options.prepare});return tick();}
   if(['skip','next','stop'].includes(name))await stopCurrent(queue);
   const body=['skip','next'].includes(name)?{postingId:queue.current.postingId}:{};
   queue=(await request('/apply-batch/'+name,body)).queue;
   say({pause:'Paused. Career finishes the job on your computer and starts no other.','go-on':'Going on.',stop:'Stopped. Nothing more is filled in.',skip:'Skipped. Nothing was submitted for it.',
    next:'Left open in its Chrome window. Career goes on with the next job.',clear:'Cleared.'}[name]);
   draw();if(moving())timer=setTimeout(tick,EVERY);
  }
  host.addEventListener('click',event=>{const button=event.target.closest&&event.target.closest('[data-ab]');if(!button||pressing)return;
   pressing=true;host.querySelectorAll('[data-ab]').forEach(each=>{each.disabled=true;});
   press(button.dataset.ab).catch(error=>{say(error.message);draw();if(moving())timer=setTimeout(tick,EVERY);}).finally(()=>{pressing=false;});});
  window.addEventListener('career-apply-batch',event=>{queue=event.detail?.queue||queue;draw();void tick();});
  void tick();
  return {refresh:tick,queue:()=>queue};
 }
 window.CareerApplyBatch={MOST,split,device,read,confirm,mount,panel,request,WORD};
})();
