/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN (Roger, 2026-11-21: 200 applications by Monday; his open jobs were generated before this week's fixes and each needs Generate résumé & cover letter again, 251 presses one at a time): Generate again on My jobs (Saved, Getting ready and New matches). A panel above the jobs says how many of his open jobs have documents from an earlier Career, with Select all with older documents, then Generate again (N); the bar under jobs he selected in the List or the Table offers Generate again (N) too. Both ask once, in words ("Career makes new documents for N jobs, one after another, in the background. Each takes about a minute. Your notes and choices for each job are kept."), put the jobs in his own queue (POST /regenerate, at most 300 in one run) and turn on his career-regenerate background job, so it goes on with no Career page open. While it runs the panel shows done, left and failed with each reason, the job Career is writing, and Pause, Go on and Stop; it moves the queue on every few seconds while the page is open (POST /regenerate/advance). A press Career cannot take while it writes a job waits for that job and is sent again.
 */
(()=>{'use strict';
 const API='/api/career-hunter',EVERY=5000,MOST=300,SCHEDULE='career-regenerate';
 const WORD={queued:'In line',claimed:'Starting',running:'Writing now',done:'New documents',failed:'Failed',skipped:'Skipped'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const plural=(n,one,many)=>n+' '+(n===1?one:many);
 /** @description The confirmation's words, exactly as he reads them. @param {number} n @returns {string} */
 const confirmWords=n=>`Career makes new documents for ${plural(n,'job','jobs')}, one after another, in the background. Each takes about a minute. Your notes and choices for each job are kept.`;
 /**
  * @description One call to Career; a refusal throws with its status, code and whether Career is writing a job now.
  * @param {string} path @param {object} [body] POST body; a GET without one. @returns {Promise<object>}
  */
 async function request(path,body){
  const response=await fetch(API+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(response.ok)return data;
  const error=Error(data.error==='career_run_in_progress'?'Career is writing a job’s documents now.':String(data.error||'HTTP '+response.status));
  error.status=response.status;error.code=data.code||data.error;error.careerRunInProgress=response.status===409&&data.error==='career_run_in_progress';
  throw error;
 }
 /**
  * @description Turn on his own career-regenerate job (the platform's schedules), so the queue moves on with no page open.
  * @returns {Promise<{on:boolean,why?:string}>}
  */
 async function background(){
  try{
   const response=await fetch('/api/v1/agent/schedules',{cache:'no-store'});
   if(!response.ok)throw Error('HTTP '+response.status);
   const job=((await response.json()).schedules||[]).find(item=>item.app==='career-hunter'&&item.name===SCHEDULE);
   if(!job?.id)throw Error('this installation has not registered it');
   if(job.status==='active')return {on:true};
   const turned=await fetch('/api/v1/agent/schedules/'+encodeURIComponent(job.id)+'/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({class:'person',configuration:{timeoutMs:60000}})});
   if(!turned.ok){const data=await turned.json().catch(()=>({}));throw Error(data.message||data.error||'HTTP '+turned.status);}
   return {on:true};
  }catch(error){console.warn('career: Generate again background job not on',error.message);return {on:false,why:String(error.message||error)};}
 }
 /** @description Whether his background job is on now (read only). @returns {Promise<{on:boolean}|null>} */
 async function backgroundState(){
  try{const response=await fetch('/api/v1/agent/schedules',{cache:'no-store'});if(!response.ok)return null;
   const job=((await response.json()).schedules||[]).find(item=>item.app==='career-hunter'&&item.name===SCHEDULE);return job?{on:job.status==='active'}:null;}
  catch(error){console.warn('career: schedules unread',error.message);return null;}
 }
 function make(tag,text,parent,className){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;if(parent)parent.append(el);return el;}
 /**
  * @description The one confirmation. Resolves true only when he pressed Generate again; Cancel, Escape and Back start nothing.
  * @param {number} n Jobs that go in now. @param {number} over Jobs past the 300 of one run. @param {string} left Jobs left out, in words.
  * @returns {Promise<boolean>}
  */
 function sheet(n,over,left){
  return new Promise(resolve=>{
   const dialog=make('dialog',null,document.body,'ck-sheet rg-sheet');
   dialog.setAttribute('data-ds-sheet','');dialog.setAttribute('data-no-glass','');dialog.setAttribute('aria-labelledby','rgSheetTitle');
   const head=make('header',null,dialog),body=make('div',null,dialog,'ck-sheet-body'),foot=make('footer',null,dialog);
   make('h2',`Generate again for ${plural(n,'job','jobs')}?`,head).id='rgSheetTitle';
   make('p',confirmWords(n),body,'rg-confirm');
   if(over)make('p',`Career makes documents for at most ${MOST} jobs in one run. The first ${MOST} go now; select the other ${over} after this run.`,body,'ab-bound');
   if(left)make('p',left.trim(),body,'hint rg-left');
   let done=false;const finish=value=>{if(done)return;done=true;if(dialog.open)dialog.close();dialog.remove();resolve(value);};
   const cancel=make('button','Cancel',foot,'ck-tertiary');cancel.type='button';cancel.onclick=()=>finish(false);
   const go=make('button',`Generate again (${n})`,foot,'ck-primary');go.type='button';go.dataset.rgConfirm='';go.onclick=()=>finish(true);
   dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
   dialog.showModal();
  });
 }
 /**
  * @description Generate again for these jobs: ask once, queue them in his store and turn his background job on.
  * @param {Array<{id:number,company?:string,title?:string}>} jobs Open jobs with documents, in his order.
  * @param {{say?:Function,left?:string}} [options] @returns {Promise<object|null>} The queue, or null when nothing was queued.
  */
 async function confirm(jobs,options={}){
  const say=options.say||(()=>{}),take=jobs.slice(0,MOST);
  if(!take.length){say('None of the selected jobs have documents to make again.'+(options.left||''));return null;}
  if(!await sheet(take.length,jobs.length-take.length,options.left||'')){say('Nothing was generated again.');return null;}
  say(`Putting ${plural(take.length,'job','jobs')} in line…`);
  const answer=await request('/regenerate',{jobs:take.map(job=>job.id),confirmed:true}),bg=await background();
  const names=new Map(jobs.map(job=>[job.id,job.company||'Job '+job.id]));
  const not=answer.refused.map(item=>`${names.get(item.postingId)||'Job '+item.postingId} (${String(item.why).replace(/\.$/,'')})`);
  say(`${plural(answer.added,'job is','jobs are')} in line to be generated again.${not.length?' Not added: '+not.join('; ')+'.':''}`);
  window.dispatchEvent(new CustomEvent('career-regenerate',{detail:{queue:answer.queue,background:bg}}));
  return answer.queue;
 }
 const btn=(text,name,primary=false)=>`<button type="button" class="${primary?'ck-primary':'ck-btn'}" data-rg="${name}">${esc(text)}</button>`;
 /** @description "3 done · 248 left · 1 failed". @param {object} queue @returns {string} */
 function countLine(queue){const c=queue.counts;return [`${c.done} done`,`${c.left} left`,`${c.failed} failed`,c.skipped?`${c.skipped} skipped`:''].filter(Boolean).join(' · ');}
 function heading(queue){
  const c=queue.counts;
  if(queue.state==='paused')return 'Generate again is paused';
  if(queue.state==='stopped')return 'Generate again stopped';
  if(queue.state==='done')return 'Generate again is finished';
  return `Generating again: job ${Math.min(c.total,c.done+c.failed+c.skipped+1)} of ${c.total}`;
 }
 /** @description The one line of what Career is doing now. @param {object} queue @param {boolean} writing @returns {string} */
 function nowLine(queue,writing){
  const current=queue.current;
  if(!current)return queue.reason||'';
  const doing=writing||current.state==='running'?'writing its résumé and cover letter':'starting';
  return [`Now: ${current.company} · ${current.title}, ${doing}.`,current.retry,current.note,queue.reason].filter(Boolean).join(' ');
 }
 function rowMarkup(entry,writing){
  const word=entry.state==='claimed'&&writing?WORD.running:WORD[entry.state]||entry.state,why=entry.reason||entry.retry||'';
  return `<li class="ab-row" data-rg-job="${entry.postingId}" data-rg-state="${entry.state}"${['claimed','running'].includes(entry.state)?' data-ab-current':''}><span class="ab-state">${esc(word)}</span>`
   +`<span class="ab-what"><b>${esc(entry.company)}</b> · ${esc(entry.title)}${why?`<span class="ab-reason">${esc(why)}</span>`:''}</span>`
   +`<a class="ab-open" href="${API}/board-native?view=queue&amp;application=${entry.postingId}" data-career-tool="career-submissions" aria-label="Open ${esc(entry.title)} at ${esc(entry.company)}">Open</a></li>`;
 }
 function hint(bg){
  const where=bg?.on===true?'Career goes on with My jobs closed, about one job every two minutes, and faster while this page is open.'
   :bg?.on===false?`Keep My jobs open: Career moves the queue on from this page${bg.why?` (its background job could not be turned on: ${bg.why})`:''}.`:'';
  return `${where} One job at a time; if you press Generate on a job yourself, yours goes first.`.trim();
 }
 /**
  * @description The queue panel: heading, counts, the job Career is writing, the failed jobs with their reasons, every job, and
  * the buttons it offers now. @param {object} queue publicQueue. @param {{writing?:boolean,background?:object}} [view] @returns {string}
  */
 function queuePanel(queue,{writing=false,background:bg=null}={}){
  const going=!['done','stopped'].includes(queue.state),line=nowLine(queue,writing),failed=queue.entries.filter(entry=>entry.state==='failed');
  const buttons=[queue.state==='running'?btn('Pause','pause'):'',queue.state==='paused'?btn('Go on','go-on',true):'',going?btn('Stop','stop'):'',!going?btn('Clear','clear'):''].join('');
  return `<h2 id="regenerateTitle">${esc(heading(queue))}</h2><p class="ab-counts" id="regenerateCounts">${esc(countLine(queue))}</p>${line?`<p class="ab-line" id="regenerateLine">${esc(line)}</p>`:''}`
   +`<div class="ab-actions">${buttons}</div>`
   +(failed.length?`<p class="rg-failed-title">Failed</p><ul class="ab-list rg-failed">${failed.map(entry=>rowMarkup(entry,false)).join('')}</ul>`:'')
   +`<details class="ab-details"><summary>${plural(queue.entries.length,'job','jobs')} in this run</summary><ol class="ab-list">${queue.entries.map(entry=>rowMarkup(entry,writing)).join('')}</ol></details>`
   +(going?`<p class="hint">${esc(hint(bg))}</p>`:'');
 }
 /** @description The line about his open jobs with older documents, with Select all and, once selected, Generate again. */
 function olderPart(older,picked,{first}){
  const n=older.count,head=first?`<h2 id="regenerateTitle">Documents from an earlier Career</h2>`:'';
  const what=`${plural(n,'of your open jobs has','of your open jobs have')} a résumé and cover letter made before this version of Career${older.version?` (${esc(older.version)})`:''}, or without the résumé for upload forms.`;
  const buttons=picked?btn(`Generate again (${Math.min(picked.length,MOST)})`,'generate',true)+btn('Clear selection','unselect'):btn('Select all with older documents','select',true);
  return `${head}<p class="ab-counts" id="regenerateOlder">${what}</p>${picked?`<p class="ab-line" id="regenerateSelected">${esc(plural(picked.length,'job with older documents is','jobs with older documents are'))} selected.</p>`:''}<div class="ab-actions">${buttons}</div>`;
 }
 /**
  * @description Show Generate again in `host` (My jobs) and keep it moving while it runs: every few seconds the queue is moved
  * on, as his background job also does. Survives a reload: it reads the queue from his store. @param {Element} host
  * @param {{say:Function,onChange?:Function}} options @returns {{refresh:Function,queue:Function}}
  */
 function mount(host,options){
  const say=options.say||(()=>{});let queue=null,older=null,picked=null,timer=null,busy=false,pressing=false,writing=false,bg=null;
  const going=()=>!!queue&&!['done','stopped'].includes(queue.state),moving=()=>!!queue&&(queue.state==='running'||!!queue.current);
  const draw=()=>{
   const parts=[queue?queuePanel(queue,{writing,background:bg}):'',!going()&&older?.count?olderPart(older,picked,{first:!queue}):''];
   host.hidden=!parts.join('');host.innerHTML=parts.join('');if(options.onChange)options.onChange(queue);
  };
  async function readAll(){
   queue=(await request('/regenerate')).queue;
   if(!going())older=await request('/regenerate/older');
   if(going()&&!bg)bg=await backgroundState();
  }
  async function tick(){
   clearTimeout(timer);if(busy)return;busy=true;
   // A read that fails is tried again on the next tick and never written over the page's own status line.
   try{
    if(moving()){try{queue=(await request('/regenerate/advance',{})).queue;writing=false;}
     catch(error){if(!error.careerRunInProgress)throw error;writing=true;queue=(await request('/regenerate')).queue;}
     if(!going())older=await request('/regenerate/older');}
    else await readAll();
   }catch(error){console.warn('career: Generate again unread',error.message);}
   finally{busy=false;}
   draw();if(moving())timer=setTimeout(tick,EVERY);
  }
  /** A press Career cannot take while it writes a job is sent again once that job is written. */
  async function press(name){
   const waiting={pause:'Pausing after the job Career is writing now…','go-on':'Going on after the job Career is writing now…',stop:'Stopping after the job Career is writing now…',clear:'Clearing…'}[name];
   for(let tries=0;;tries+=1){
    try{queue=(await request('/regenerate/'+name,{})).queue;break;}
    catch(error){if(!error.careerRunInProgress||tries>=180)throw error;say(waiting);await new Promise(resolve=>setTimeout(resolve,EVERY));}
   }
   say({pause:'Paused. Career starts no other job until you press Go on.','go-on':'Going on.',stop:'Stopped. Career starts no other job.',clear:'Cleared.'}[name]);
   if(!queue)older=await request('/regenerate/older');
  }
  async function act(name){
   if(name==='select'){picked=older.jobs;say('');return;}
   if(name==='unselect'){picked=null;return;}
   if(name==='generate'){const chosen=picked;await confirm(chosen,{say});return;}
   clearTimeout(timer);await press(name);
  }
  host.addEventListener('click',event=>{const button=event.target.closest&&event.target.closest('[data-rg]');if(!button||pressing)return;
   pressing=true;host.querySelectorAll('[data-rg]').forEach(each=>{each.disabled=true;});
   act(button.dataset.rg).catch(error=>say(error.message)).finally(()=>{pressing=false;draw();if(moving())timer=setTimeout(tick,EVERY);});});
  window.addEventListener('career-regenerate',event=>{queue=event.detail?.queue||queue;bg=event.detail?.background||bg;picked=null;draw();void tick();});
  void tick();
  return {refresh:tick,queue:()=>queue};
 }
 window.CareerRegenerate={MOST,WORD,confirm,mount,request,confirmWords,queuePanel};
})();
