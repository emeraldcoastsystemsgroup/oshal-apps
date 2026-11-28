/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.79.0, Answers to review (the owner, 2026-11-27: "i would like to review them for now.. so when we have those there will need to have an approval page or on the review page or something .. make it nice"). The page (tools/career-answers-review.html): it reads GET /answers-to-review and draws it at once, then reads the person's waiting question cards from the kernel in their own session (GET /api/apply/cards, Career's only) and hands them to POST /answers-to-review/refresh, which learns them and asks Career's specialist for the drafts still missing; while a draft is being written it reads again every few seconds, never redrawing a card the person is typing in. A written question shows Career's draft read-only with the roles it drew on: Approve sends it as it is, Edit then Approve opens it for editing, Write my own empties the box (Use Career's draft brings it back), Skip sets it aside. A plain question and a check take the person's own answer (the employer's choices when it listed them). Approve (POST /answers-to-review/approve) is a change the page's door keeps while Career is busy; its answer says which jobs went back in Fill in several, which could not and why, and names the cards still waiting on the person's computer, which the page answers in their own session (POST /api/apply/cards/:id/answer, the card's own option for these words or the words, never Keep: Career kept it), then moves the fill-in queue on. Answered automatically has Change answer; Skipped has Review again. Shared with My jobs and the job page: read(), count() (the stage row's badge and Didn't go through's entry) and note(host, postingId), the job page's line when that job waits on a question.
 */
(()=>{'use strict';
 const API='/api/career-hunter',PAGE=API+'/answers-to-review-ui',FRESH_MS=3000,POLL_MS=4000,SLOW_MS=20000,FAST_FOR_MS=3*60*1000,ASK_EVERY_MS=60000,MAX=2000;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const plural=(n,one,many)=>n+' '+(n===1?one:many);
 let reading=null,last=null;
 /**
  * @description The person's questions to review (GET /answers-to-review): one read at a time, shared for a few seconds.
  * @param {{fresh?:boolean}} [options] @returns {Promise<object>}
  */
 function read({fresh=false}={}){
  if(!fresh&&last&&Date.now()-last.at<FRESH_MS)return Promise.resolve(last.data);
  if(reading)return reading;
  reading=fetch(API+'/answers-to-review',{cache:'no-store'}).then(async response=>{
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Career could not read the questions waiting for you (HTTP '+response.status+').');
   last={at:Date.now(),data};return data;
  }).finally(()=>{reading=null;});
  return reading;
 }
 /** @description How many questions wait for the person, for a badge; null when it could not be read. @returns {Promise<number|null>} */
 async function count(){try{const data=await read();return Number.isSafeInteger(data?.count)?data.count:null;}catch{return null;}}
 /** @description Every open question with the jobs it holds up. @param {object} data @returns {object[]} */
 const open=data=>[...(data?.written||[]),...(data?.plain||[])];
 /**
  * @description The job page's line when this job waits on a question only the person can answer, with Answers to review.
  * @param {Element} host @param {number} postingId @returns {Promise<void>}
  */
 async function note(host,postingId){
  let data;try{data=await read();}catch{return;}
  const mine=open(data).filter(question=>(question.jobs||[]).some(job=>Number(job.postingId)===Number(postingId)));
  if(!host||!mine.length){if(host)host.hidden=true;return;}
  host.innerHTML=`<div class="notice ar-job-note" role="note"><p><b>This job is waiting for your answer</b> to ${mine.length===1?'a question':mine.length+' questions'} only you can answer: “${esc(mine[0].text)}”.</p>`
   +`<p class="hint">Answer it once on Answers to review: Career keeps your answer and puts this job back in Fill in several.</p><a class="btn primary" href="${PAGE}">Answers to review</a></div>`;
  host.hidden=false;
 }
 /** @description The person's waiting question cards from the kernel, in their own session; only Career's. @returns {Promise<object[]>} */
 async function kernelCards(){
  try{const response=await fetch('/api/apply/cards',{cache:'no-store'});if(!response.ok)return [];
   const data=await response.json();return (Array.isArray(data.cards)?data.cards:[]).filter(card=>card&&card.app==='career-hunter').slice(0,50);}
  catch{return [];}
 }
 /**
  * @description Give one waiting card the person's approved answer in their own session: the card's own option with these
  * words, else the words in its box. Keep is never ticked: Career already kept it. @returns {Promise<boolean>} Whether it took it.
  */
 async function answerCard(card,value){
  const options=Array.isArray(card?.ask?.options)?card.ask.options:[],norm=text=>String(text).trim().toLowerCase();
  const at=options.findIndex(option=>option===value),near=at>=0?at:options.findIndex(option=>norm(option)===norm(value));
  if(options.length&&near<0)return false;
  const body=options.length?{option:near,keep:false}:{answer:value,keep:false};
  const response=await fetch('/api/apply/cards/'+encodeURIComponent(card.id)+'/answer',{method:'POST',headers:{'Content-Type':'application/json','X-OSHAL-Apply-Card':'1'},body:JSON.stringify(body),cache:'no-store'});
  return response.ok;
 }
 window.CareerAnswersReview={PAGE,read,count,note,kernelCards,answerCard};

 const root=document.getElementById('answersReview');
 if(!root){
  const host=document.getElementById('answersReviewNote'),id=Number(new URLSearchParams(location.search).get('application'));
  if(host&&Number.isSafeInteger(id)&&id>0)void note(host,id);
  return;
 }
 // ── The page ──────────────────────────────────────────────────────────────────────────────────────────────────────
 const $=id=>document.getElementById(id),modes=new Map(),typed=new Map(),done=new Map();
 let data=null,cards=[],pressing=false,timer=null,startedAt=Date.now(),askedAt=0;
 const say=(text,bad=false)=>{$('status').textContent=text;$('status').toggleAttribute('data-bad',bad);};
 const BUTTONS={approve:['Approve','ck-primary'],edit:['Edit then Approve','ck-btn'],own:['Write my own','ck-btn'],skip:['Skip','ck-tertiary'],
  'approve-edit':['Approve','ck-primary'],'approve-own':['Approve my answer','ck-primary'],'use-draft':['Use Career’s draft','ck-btn'],cancel:['Cancel','ck-tertiary'],
  'approve-plain':['Approve','ck-primary'],change:['Change answer','ck-btn'],'approve-change':['Approve','ck-primary'],reopen:['Review again','ck-btn']};
 const actions=names=>`<div class="ar-actions">${names.filter(Boolean).map(name=>`<button type="button" class="${BUTTONS[name][1]}" data-ar-act="${name}">${BUTTONS[name][0]}</button>`).join('')}</div>`;
 const fieldId=question=>'ar-'+question.key.slice(2,14);
 function jobsMarkup(question){
  return `<ul class="ar-jobs" aria-label="Jobs waiting on this question">${(question.jobs||[]).map(job=>`<li><a href="${esc(job.href)}" data-career-tool="career-submissions"><b>${esc(job.company||'Employer')}</b> <span>· ${esc(job.title||'Job')}</span>${job.live?' <span class="ar-live">On your computer now</span>':''}</a></li>`).join('')}</ul>`;
 }
 function tags(question){
  const kind=question.kind==='written'?'Written question':question.kind==='check'?'A check that you are a person':'Only you can answer',n=(question.jobs||[]).length;
  return `<p class="ar-tags"><span class="ar-kind" data-kind="${esc(question.kind)}">${kind}</span>${n?`<span>${plural(n,'job waits','jobs wait')} on it</span>`:''}</p>`;
 }
 const drawnFrom=roles=>roles?.length?`<p class="ar-from" data-ar-from>Drawn from: ${roles.map(role=>`<b>${esc([role.title,role.org].filter(Boolean).join(' at '))}</b>`).join('; ')}</p>`:'';
 function box(question,label,text,readonly,rows=5){
  const id=fieldId(question);
  return `<div class="ar-box"><label for="${id}">${label}</label><textarea id="${id}" data-ar-text rows="${rows}" maxlength="${MAX}"${readonly?' readonly':''}>${esc(text)}</textarea><p class="ar-count" data-ar-count aria-live="polite">${text.length.toLocaleString()} / 2,000</p></div>`;
 }
 function writtenBody(question){
  const mode=modes.get(question.key)||'view',draft=question.draft||{state:'pending'};
  if(mode==='view'&&draft.state==='pending')return `<div class="ar-wait" role="status" data-ar-pending>Career is drafting an answer from your record and the cover letter it wrote for this job…</div>`+actions(['own','skip']);
  if(mode==='view'&&draft.state==='failed')return `<p class="ar-why" data-ar-why>${esc(draft.why)}</p>`+actions(['own','skip']);
  if(mode==='own')return box(question,'Your answer',typed.has(question.key)?typed.get(question.key):'',false)+actions(['approve-own',draft.state==='ready'?'use-draft':'','cancel']);
  const text=mode==='edit'&&typed.has(question.key)?typed.get(question.key):draft.text||'';
  return box(question,mode==='edit'?'Edit Career’s draft':'Career’s draft',text,mode==='view')+drawnFrom(draft.roles)
   +'<p class="ar-note">Career wrote this from your record. Approve it only if every word of it is true.</p>'+(mode==='edit'?actions(['approve-edit','cancel']):actions(['approve','edit','own','skip']));
 }
 function plainBody(question){
  const id=fieldId(question),options=question.options||[],chosen=typed.get(question.key)||'';
  const input=options.length?`<fieldset class="ar-choices"><legend>Your answer</legend>${options.map(option=>`<label class="ar-choice"><input type="radio" name="${id}" value="${esc(option)}"${chosen===option?' checked':''}><span>${esc(option)}</span></label>`).join('')}</fieldset>`
   :box(question,'Your answer',chosen,false,2);
  const words=question.kind==='check'?'This checks that you are a person, so Career never answers it and keeps no answer: Approve gives yours to a form waiting on it now, and the other jobs ask you again.'
   :'Career keeps your answer in Saved answers and gives it to every form that asks this.';
  return input+`<p class="ar-note">${words}</p>`+actions(['approve-plain','skip']);
 }
 function autoBody(question){
  if(modes.get(question.key)==='change')return box(question,'Change the answer',typed.has(question.key)?typed.get(question.key):question.answer.value,false)+actions(['approve-change','cancel']);
  return `<p class="ar-answer" data-ar-used>${esc(question.answer.value)}</p>`+drawnFrom(question.answer.roles)+actions(['change']);
 }
 /** @description What the card of an approved answer says: what was kept, which jobs went back, which could not and why. */
 function doneBody(question,result){
  const name=id=>{const job=(question.jobs||[]).find(one=>Number(one.postingId)===Number(id));return job?`${job.company} · ${job.title}`:'Job '+id;};
  const lines=[result.kept===false?'Answered. Career keeps no answer to a check.':'Saved to your Saved answers.'];
  if(result.back.length)lines.push(`${plural(result.back.length,'job went','jobs went')} back in Fill in several: ${result.back.map(name).join('; ')}.`);
  if(result.cards)lines.push(`Career gave your answer to the ${result.cards===1?'form':result.cards+' forms'} waiting on your computer.`);
  for(const item of result.refused)lines.push(`Not put back: ${name(item.postingId)} (${String(item.why||'').replace(/\.$/,'')}).`);
  return `<div class="ar-done" role="status">${lines.map((line,index)=>`<p>${index?'':'<b>'}${esc(line)}${index?'':'</b>'}</p>`).join('')}</div>`;
 }
 function card(question,section){
  const body=done.has(question.key)?doneBody(question,done.get(question.key)):section==='automatic'?autoBody(question):question.kind==='written'?writtenBody(question):plainBody(question);
  return `<article class="ar-card" data-ar="${esc(question.key)}" data-ar-kind="${esc(question.kind)}" data-ar-section="${section}" aria-labelledby="${fieldId(question)}-q">`
   +tags(question)+`<h3 class="ar-q" id="${fieldId(question)}-q">${esc(question.text)}</h3>`+jobsMarkup(question)+body+'<p class="ar-said" role="status"></p></article>';
 }
 const find=key=>[...(data?.written||[]),...(data?.plain||[]),...(data?.automatic||[]),...(data?.skipped||[])].find(question=>question.key===key)||done.get(key)?.question;
 /** @description Whether a card holds something the person is doing (typing, editing) that a redraw would lose. */
 const busyCard=element=>!!element&&!done.has(element.dataset.ar)&&(element.contains(document.activeElement)||(modes.get(element.dataset.ar)||'view')!=='view');
 function section(listId,sectionId,items,kind){
  const host=$(listId),keep=new Map([...host.querySelectorAll('[data-ar]')].map(element=>[element.dataset.ar,element]));
  const shown=[...items,...[...done.values()].filter(item=>item.section===kind&&!items.some(one=>one.key===item.question.key)).map(item=>item.question)];
  host.replaceChildren(...shown.map(question=>{
   const kept=keep.get(question.key);if(busyCard(kept))return kept;
   const holder=document.createElement('div');holder.innerHTML=card(question,kind);return holder.firstElementChild;
  }));
  $(sectionId).hidden=!shown.length;
 }
 function modeLine(){
  const auto=data?.auto===true;
  $('arMode').innerHTML=auto?'<b>Career answers written questions without your review.</b> Each one is still listed below, for you to change. <a href="'+API+'/saved-answers-ui" data-career-tool="career-settings">Change this in Saved answers</a>'
   :'<b>Written questions wait for your review.</b> Career uses a draft only after you approve it. <a href="'+API+'/saved-answers-ui" data-career-tool="career-settings">Change this in Saved answers</a>';
  $('arMode').hidden=false;
 }
 function draw(){
  modeLine();
  const n=data?.count||0;$('arCount').textContent=String(n);$('arCount').hidden=!n;$('arCount').setAttribute('aria-label',plural(n,'question waits','questions wait')+' for you');
  section('written','writtenSection',data?.written||[],'written');section('plain','plainSection',data?.plain||[],'plain');section('automatic','autoSection',data?.automatic||[],'automatic');
  const skipped=data?.skipped||[];$('skippedSection').hidden=!skipped.length;$('skippedCount').textContent=skipped.length?'('+skipped.length+')':'';
  $('skipped').innerHTML=skipped.map(question=>`<div class="ar-skip-row" data-ar="${esc(question.key)}" data-ar-section="skipped"><p>${esc(question.text)}</p>${actions(['reopen'])}</div>`).join('');
  $('empty').hidden=!!(n||(data?.automatic||[]).length||done.size);
  const unread=(data?.unread||[]).length?'Career could not read some of your records just now, so a question may be missing. Try again in a moment.':'';
  say(unread||(n?`${plural(n,'question waits','questions wait')} for you, holding up ${plural(data.jobs||0,'job','jobs')}.`:''));
 }
 const pending=()=>(data?.written||[]).some(question=>question.draft?.state==='pending');
 /** Read again while a draft is being written: often at first, then slowly; ask for drafts again now and then while Career was busy. */
 function later(){
  clearTimeout(timer);if(!pending())return;
  timer=setTimeout(async()=>{
   try{if(Date.now()-askedAt>ASK_EVERY_MS)await refresh();else{data=await read({fresh:true});draw();}}catch(error){console.warn('career: answers to review unread',error.message);}
   later();
  },Date.now()-startedAt<FAST_FOR_MS?POLL_MS:SLOW_MS);
 }
 /** Hand Career the waiting cards and learn what waits; a refusal while Career is busy leaves the list as read. */
 async function refresh(){
  askedAt=Date.now();cards=await kernelCards();
  const response=await fetch(API+'/answers-to-review/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cards}),cache:'no-store',careerBatch:true});
  if(!response.ok)return;
  data=await response.json();last={at:Date.now(),data};draw();
  if(data.answerCards?.length)await giveCards(data.answerCards);
 }
 /** Answer the cards still waiting with the approved words, in the person's own session. @returns {Promise<number>} How many took it. */
 async function giveCards(list){
  let given=0;if(!list?.length)return 0;
  if(list.some(item=>!cards.some(one=>one.id===item.card)))cards=await kernelCards();
  for(const item of list){const found=cards.find(one=>one.id===item.card);try{if(found&&await answerCard(found,item.value))given+=1;}catch(error){console.warn('career: card not answered',error.message);}}
  return given;
 }
 /** Approve one answer; the door keeps the change while Career is busy and sends it by itself. */
 async function approve(element,key,value,how){
  const question=find(key);if(!question)return;
  element.setAttribute('data-busy','');element.querySelectorAll('button,textarea,input').forEach(control=>{control.disabled=true;});
  const response=await fetch(API+'/answers-to-review/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,value,how}),cache:'no-store'});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Your answer was not saved (HTTP '+response.status+').');
  const given=await giveCards(result.answerCards);
  if(result.back?.length)void fetch(API+'/apply-batch/advance',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store',careerBatch:true}).catch(()=>{});
  modes.delete(key);typed.delete(key);
  done.set(key,{question,section:element.dataset.arSection==='automatic'?'automatic':question.kind==='written'?'written':'plain',kept:result.kept,back:result.back||[],refused:result.refused||[],cards:given});
  data=result;last={at:Date.now(),data};draw();
 }
 /** @description The words in a card's box or its chosen option. */
 function given(element){
  const chosen=element.querySelector('input[type=radio]:checked');if(chosen)return chosen.value;
  const box=element.querySelector('[data-ar-text]');return box?box.value.trim():'';
 }
 async function act(element,name){
  const key=element.dataset.ar,question=find(key);if(!question)return;
  const redraw=focus=>{const holder=document.createElement('div');holder.innerHTML=card(question,element.dataset.arSection);const fresh=holder.firstElementChild;element.replaceWith(fresh);
   if(focus){const box=fresh.querySelector('[data-ar-text]');if(box){box.focus();box.setSelectionRange(box.value.length,box.value.length);}}};
  if(['edit','own','change','use-draft','cancel'].includes(name)){
   if(name==='cancel'){modes.delete(key);typed.delete(key);}else if(name==='use-draft'){modes.set(key,'edit');typed.delete(key);}else{modes.set(key,name);typed.delete(key);}
   redraw(name!=='cancel');return;
  }
  if(name==='skip'||name==='reopen'){
   const response=await fetch(API+'/answers-to-review/'+(name==='skip'?'skip':'reopen'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),cache:'no-store'});
   const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'That did not save (HTTP '+response.status+').');
   data=result;last={at:Date.now(),data};draw();say(name==='skip'?'Skipped. It waits under Skipped until you review it again.':'Back on your list.');return;
  }
  const value=name==='approve'?question.draft?.text||'':given(element);
  if(!value){element.querySelector('.ar-said').textContent=question.options?.length?'Choose an answer first.':'Write your answer first.';element.querySelector('[data-ar-text]')?.focus();return;}
  if(value.length>MAX){element.querySelector('.ar-said').textContent='An answer is at most 2,000 characters.';return;}
  const how=name==='approve-own'?'own':name==='approve-plain'?'own':name==='approve'?'approved':value===question.draft?.text?'approved':'edited';
  await approve(element,key,value,how);
 }
 root.addEventListener('input',event=>{
  const element=event.target.closest('[data-ar]');if(!element)return;
  const key=element.dataset.ar;typed.set(key,event.target.type==='radio'?event.target.value:event.target.value);
  const counter=element.querySelector('[data-ar-count]');if(counter&&event.target.matches('[data-ar-text]'))counter.textContent=event.target.value.length.toLocaleString()+' / 2,000';
 });
 root.addEventListener('click',event=>{
  const button=event.target.closest('button[data-ar-act]');if(!button||pressing)return;
  const element=button.closest('[data-ar]');if(!element)return;
  pressing=true;
  act(element,button.dataset.arAct).catch(error=>{
   element.removeAttribute('data-busy');element.querySelectorAll('button,textarea,input').forEach(control=>{control.disabled=false;});
   const said=element.querySelector('.ar-said');if(said){said.textContent=error.message;said.setAttribute('data-bad','');}else say(error.message,true);
  }).finally(()=>{pressing=false;});
 });
 async function boot(){
  try{data=await read({fresh:true});draw();}catch(error){say(error.message,true);}
  try{await refresh();}catch(error){console.warn('career: answers to review not refreshed',error.message);}
  later();
 }
 void boot();
})();
