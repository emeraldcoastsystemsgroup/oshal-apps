/* CHANGE LOG:
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render stable per-stage lists, remembered account-scoped filters and scroll, and direct application handoffs without nested document panels.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: this page is the live Job Board (board-native), so the pipeline lives here: the stage control (career-stages.js) over New matches (?view=matches), Saved, To approve (?view=approve opens the approvals view), Preparing (?view=queue), Applied (?view=status) and Interviewing (?view=interviewing, status=interview); an empty stage is one empty state whose primary is Find jobs (no "0 shown" or "No results · End of this view"); Clear filters; pay and fit filters only while finding jobs. Guard: tests/career-job-lists-stages.test.mjs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | UX Design Standard sweep: phone Filters sheet (#boardFilterSheet) with history Back dismissal, posting modal sheet Back dismissal, and merged New matches phone swipe deck (Pass, Save, Undo, More + Cards/List switch). */
(()=>{'use strict';const $=id=>document.getElementById(id),query=new URLSearchParams(location.search),view=query.get('view'),recommended=view==='matches',stage=recommended?'matches':view==='queue'?'queue':view==='status'?'status':view==='interviewing'?'interview':'saved';
 if(view==='approve'){location.replace('/api/career-hunter/approvals');return;}
 const DONE=new Set(['applied','interview','offer','rejected']),labels={saved:'Job Board',queue:'Preparing',status:'Applied',matches:'New matches',interview:'Interviewing'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fields=['q','sort','per','min_score','pay_period','min_pay','max_pay','days','remote'];let page=1,firstPage=1,rows=[],exhausted=false,epoch=0,controller=null,memoryKey=null,earlier=query.get('earlier')==='1',busy=false,returnY=0,firstLoad=true;
 const phoneMedia=typeof window.matchMedia==='function'?window.matchMedia('(max-width: 640px)'):{matches:false,addEventListener:()=>{}};
 let matchLayout='deck',deckHistory=[];
 $('pageTitle').textContent=labels[stage];document.title=labels[stage];$('pageDescription').textContent=stage==='saved'?'Your saved shortlist. Open a job to compare its fit, or prepare an application.':stage==='queue'?'Continue an application. Tailoring, documents and submission stay with the selected job.':stage==='status'?'Submitted applications, employer updates and interview preparation.':stage==='interview'?'Applications with a recorded interview.':'Matches against your résumé. Save the jobs you want to pursue to your Job Board.';
 $('searchModes').hidden=!recommended;if($('matchesLayoutSwitch'))$('matchesLayoutSwitch').hidden=!recommended;
 document.querySelector(`[data-career-tool="${recommended?'career-search':stage==='saved'?'career-board':stage==='queue'?'career-submissions':'career-application-status'}"]`)?.setAttribute('aria-current','page');
 $('sort').value=stage==='queue'?'generated':(stage==='status'||stage==='interview')?'applied':'ai';
 if(window.CareerStages){const id={saved:'saved',queue:'preparing',status:'applied',matches:'matches',interview:'interviewing'}[stage];CareerStages.counts().then(counts=>CareerStages.render($('careerStages'),id,counts));}
 document.querySelectorAll('[data-stage-filter="match"]').forEach(el=>{el.hidden=!['saved','matches'].includes(stage);});

 function wireSheetBack(dialog,key){
  let pushed=false;
  const origShow=()=>dialog.showModal();
  dialog.addEventListener('close',()=>{if(pushed){pushed=false;if(history.state?.dsSheet===key){try{history.back();}catch{}}}});
  window.addEventListener('popstate',()=>{if(dialog.open){pushed=false;dialog.close();}});
  return ()=>{origShow();try{history.pushState({dsSheet:key},'');pushed=true;}catch{}};
 }

 (function wireFilterSheet(){
  const sheet=$('boardFilterSheet'),body=$('boardFilterSheetBody'),box=$('boardFilterFields'),openBtn=$('openBoardFilters');
  if(!sheet||!body||!box||!openBtn||typeof sheet.showModal!=='function')return;
  const home=box.parentNode,next=box.nextSibling,openSheet=wireSheetBack(sheet,'boardFilters');
  openBtn.addEventListener('click',()=>{body.append(box);openSheet();});
  sheet.addEventListener('close',()=>{home.insertBefore(box,next&&next.parentNode===home?next:null);});
  sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.close();});
  $('boardSheetDone')?.addEventListener('click',()=>sheet.close());
  $('boardSheetClear')?.addEventListener('click',()=>{$('clearFilters')?.click();});
 })();

 $('matchesLayoutSwitch')?.addEventListener('click',e=>{
  const tab=e.target.closest('button[data-layout]');if(!tab)return;
  matchLayout=tab.dataset.layout||'deck';
  $('matchesLayoutSwitch').querySelectorAll('button[role="tab"]').forEach(b=>b.setAttribute('aria-selected',String(b===tab)));
  render();
 });
 phoneMedia.addEventListener?.('change',()=>render());

 $('clearFilters')?.addEventListener('click',()=>{for(const key of fields){if(key==='sort'||key==='per')continue;$(key).value=key==='pay_period'?'year':'';}page=1;firstPage=1;remember();load();});
 function filters(){return Object.fromEntries(fields.map(key=>[key,$(key).value]).filter(([,v])=>v!==''));}
 function remember(){if(!memoryKey)return;try{sessionStorage.setItem(memoryKey,JSON.stringify({filters:filters(),page:firstPage,scrollY:window.scrollY,earlier}));}catch{}}
 function address(){const params=new URLSearchParams(filters());if(stage==='queue')params.set('view','queue');else if(stage==='status')params.set('view','status');else if(stage==='interview')params.set('view','interviewing');else if(recommended)params.set('view','matches');if(earlier)params.set('earlier','1');params.set('page',String(firstPage));history.replaceState(null,'',location.pathname+'?'+params);}
 function pay(job){const a=job.salary_min,b=job.salary_max;if(!a&&!b)return 'Pay estimate unavailable';const symbol=job.salary_currency==='USD'?'$':(job.salary_currency||'')+' ',amount=n=>symbol+Number(n).toLocaleString('en-US',{maximumFractionDigits:2}),unit={year:' / year',hour:' / hour',month:' / month',course:' / course'}[job.salary_period]||' · period unknown';return (a&&b&&a!==b?amount(a)+'–'+amount(b):amount(b||a))+unit+(['heuristic','ai_estimated','bls_estimated'].includes(job.salary_source)?' · estimate':'');}
 function state(job){return DONE.has(job.status)?'Application recorded':job.board?.applicationDraft?'Application draft saved':job.board?.phase==='generating'?'Generating documents':job.has_resume?'Documents available':job.status==='promoted'?'Ready for preparation':'Saved';}
 function row(job){const done=DONE.has(job.status),prepared=['promoted','generated','deferred'].includes(job.status)||job.board?.applicationDraft,action=done?'View application':prepared?'Continue application':'Prepare application';
  return `<article class="job-row" data-job-id="${job.id}"><div class="summary"><button class="job-title" data-posting="${job.id}">${job.favorite?'★ ':''}${esc(job.title)}</button><p class="job-company muted">${esc(job.company)}</p><div class="meta"><span>${esc(pay(job))}</span><span>${esc(job.location||'Location unavailable')}</span>${job.remote?'<span>Fully remote</span>':''}${job.ai_fit_score!=null?`<span>AI fit ${esc(job.ai_fit_score)}${job.fit_assessment?.assessedAt?' · '+esc(new Date(job.fit_assessment.assessedAt).toLocaleDateString()):''}</span>`:'<span>AI assessment pending</span>'}${job.posted_date?`<span>Posted ${esc(job.posted_date.slice(0,10))}</span>`:''}${job.active===0?'<span>Posting no longer active</span>':''}</div><p class="status">${esc(state(job))}</p></div><div class="row-actions">${recommended?`<button class="btn primary" data-save="${job.id}" ${job.favorite?'disabled':''}>${job.favorite?'★ Saved':'★ Save to Job Board'}</button><button class="btn" data-job-feedback="${job.id}">Not interested</button>`:`<button class="btn primary" data-open="${job.id}" data-done="${done}">${action}</button>${stage==='saved'?`<button class="btn quiet" data-unstar="${job.id}">Remove star</button>`:''}`}</div></article>`;
 }

 function deckCardMarkup(job,lead){
  return `<article class="match-card ${lead?'lead':'peek'}" data-deck-id="${job.id}"><p class="co">${esc(job.company)}</p><h2><button class="job-title" type="button" data-posting="${job.id}">${esc(job.title)}</button></h2><div class="meta"><span>${esc(pay(job))}</span><span>${esc(job.location||'Location unavailable')}</span>${job.remote?'<span>Fully remote</span>':''}${job.ai_fit_score!=null?`<span>AI fit ${esc(job.ai_fit_score)}</span>`:''}</div><p class="why">${esc(job.ai_fit_rationale||'Open this role to inspect full posting requirements and fit details.')}</p></article>`;
 }

 async function actDeck(kind){
  if(!rows.length&&kind!=='undo'&&kind!=='more')return;
  if(kind==='undo'){
   const last=deckHistory.pop();if(!last){$('actionState').textContent='Nothing to undo.';return;}
   if(last.action==='save'){try{await CareerJobActions.favorite(last.job.id,false);}catch{}}
   rows=[last.job,...rows.filter(j=>j.id!==last.job.id)];render();$('actionState').textContent='Restored '+last.job.title+'.';return;
  }
  if(kind==='more'){
   if(!exhausted){page+=1;await load(true,false);}else if(rows[0]){await posting(rows[0].id);}
   return;
  }
  const lead=rows[0];if(!lead)return;
  rows=rows.slice(1);deckHistory.push({job:lead,action:kind});render();
  try{
   if(kind==='save'){const res=await CareerJobActions.save(lead.id);$('actionState').textContent=res.error?'Saved ('+res.error+')':'Saved to Job Board.';void CareerNavigation.refreshCounts();}
   else{await fetch('/api/career-hunter/jobs/'+lead.id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'dismissed'})});$('actionState').textContent='Passed '+lead.title+'.';}
  }catch(err){$('actionState').textContent=err.message;}
  if(rows.length<2&&!exhausted&&!busy){page+=1;void load(true,false);}
 }

 function bindDeckSwipe(card){
  if(!card)return;let sx=0,dx=0,dragging=false;
  card.onpointerdown=e=>{if(e.target.closest('button'))return;dragging=true;sx=e.clientX;dx=0;card.setPointerCapture?.(e.pointerId);};
  card.onpointermove=e=>{if(!dragging)return;dx=e.clientX-sx;card.style.transform=`translateX(${dx}px) rotate(${dx/22}deg)`;};
  card.onpointerup=card.onpointercancel=()=>{if(!dragging)return;dragging=false;card.style.transform='';if(dx>85)void actDeck('save');else if(dx<-85)void actDeck('pass');};
 }

 function render(){
  const useDeck=recommended&&phoneMedia.matches&&matchLayout==='deck'&&rows.length>0;
  if(useDeck){
   const lead=rows[0],peek=rows[1];
   $('list').innerHTML=`<div class="match-deck"><div class="match-deck-stage">${peek?deckCardMarkup(peek,false):''}${deckCardMarkup(lead,true)}</div><div class="match-deck-actions"><button type="button" class="ck-btn" data-deck-act="undo">Undo</button><button type="button" class="ck-btn" data-deck-act="pass">Pass</button><button type="button" class="ck-primary" data-deck-act="save">Save</button><button type="button" class="ck-btn" data-deck-act="more">More</button></div></div>`;
   bindDeckSwipe($('list').querySelector('.match-card.lead'));
   $('pager').innerHTML='';return;
  }
  const old=new Map([...$('list').querySelectorAll('[data-job-id]')].map(el=>[el.dataset.jobId,el]));
  const nodes=rows.map(job=>{const markup=row(job),prior=old.get(String(job.id));if(prior?.dataset.markup===markup)return prior;const template=document.createElement('template');template.innerHTML=markup;const next=template.content.firstElementChild;next.dataset.markup=markup;return next;});
  if(!nodes.length){const filtered=Object.keys(filters()).some(k=>!['sort','per','pay_period'].includes(k));const EMPTY={saved:['No saved jobs yet','Save jobs from Search to compare and prepare them.'],matches:['No matches yet','Matches against your résumé appear here.'],queue:['Nothing to prepare yet','Move a saved job here when ready to apply.'],status:['No applications yet','Submitted applications are tracked here.'],interview:['No interviews yet','Recorded interviews appear here.']}[stage]||['Nothing here yet',''];
  $('list').innerHTML=filtered?'<div class="ck-empty"><h2>No jobs match these filters</h2><p>Clear filters to see this stage.</p><button type="button" class="ck-btn" data-clear-filters>Clear filters</button></div>':`<div class="ck-empty"><div class="ck-empty-icon" aria-hidden="true">🗂️</div><h2>${EMPTY[0]}</h2><p>${EMPTY[1]}</p><a class="ck-primary" href="/api/career-hunter/search-ui" data-career-tool="career-search">Find jobs</a></div>`;
  $('list').querySelector('[data-clear-filters]')?.addEventListener('click',()=>$('clearFilters')?.click());}else{const keep=new Set(nodes);for(const child of [...$('list').children])if(!keep.has(child))child.remove();let cursor=$('list').firstElementChild;for(const node of nodes){if(node===cursor)cursor=cursor.nextElementSibling;else $('list').insertBefore(node,cursor);}}
  if(!rows.length&&firstPage<=1){$('pager').innerHTML='';return;}
  $('pager').innerHTML=`<span class="hint">${rows.length?`Showing ${((firstPage-1)*Number($('per').value))+1}–${((firstPage-1)*Number($('per').value))+rows.length}`:'No results'}${exhausted?' · End of this view':''}</span><div class="actions">${firstPage>1?'<button class="btn" data-page="previous">← Previous</button>':''}${!exhausted?'<button class="btn" data-page="more">Load more</button><button class="btn" data-page="next">Next →</button>':''}</div>`;
 }
 async function load(append=false,top=false){controller?.abort();controller=new AbortController();const current=++epoch;busy=true;$('list').setAttribute('aria-busy','true');$('requestState').textContent=rows.length?'Updating results…':'Loading jobs…';
  const params=new URLSearchParams(filters());if(stage!=='matches')params.set('status',stage==='status'?'tracked':stage);if(stage==='queue'&&!earlier)params.set('current','1');params.set('page',String(page));
  try{const response=await fetch('/api/career-hunter/jobs?'+params,{signal:controller.signal,cache:'no-store'}),data=await response.json();if(current!==epoch)return;if(!response.ok)throw Error(data.error||'HTTP '+response.status);
   firstPage=append?firstPage:page;const incoming=data.jobs||[];rows=CareerFeedback.unique([...new Map((append?[...rows,...incoming]:incoming).map(job=>[job.id,job])).values()]);exhausted=data.exhausted===true||incoming.length<Number($('per').value);
   if(recommended){rows=CareerFeedback.visible(rows,data.exclusions||[]);CareerFeedback.configure(rows,data.exclusions,(rules)=>{rows=CareerFeedback.visible(rows,rules);render();void load();});}
   render();$('requestState').textContent=!rows.length?'':(earlier?'Earlier preparation · ':'')+rows.length+' shown'+(data.pooled&&data.poolSize?' · ranked within '+data.poolSize.toLocaleString()+' matches':'');address();if(top)window.scrollTo({top:0,behavior:'instant'});else if(firstLoad&&returnY)window.scrollTo({top:returnY,behavior:'instant'});firstLoad=false;remember();
  }catch(error){if(current!==epoch||error.name==='AbortError')return;$('requestState').replaceChildren(document.createTextNode('Could not update jobs: '+error.message+'. '));const retry=document.createElement('button');retry.className='btn';retry.textContent='Retry';retry.onclick=()=>load(append,top);$('requestState').append(retry);}
  finally{if(current===epoch){busy=false;$('list').setAttribute('aria-busy','false');}}
 }
 async function posting(id){const dialog=document.createElement('dialog');dialog.className='ck-sheet edit-dialog';dialog.setAttribute('data-ds-sheet','');dialog.setAttribute('data-no-glass','');dialog.innerHTML='<header><b>Job posting and fit</b><button class="btn" type="button" data-close>Close posting</button></header><section class="ck-sheet-body" style="padding:20px" role="status">Loading posting…</section>';document.body.append(dialog);const openPosting=wireSheetBack(dialog,'boardPosting');dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.addEventListener('close',()=>dialog.remove());openPosting();
  try{const response=await fetch('/api/career-hunter/jobs/'+id,{cache:'no-store'});if(!response.ok)throw Error('Could not load this posting.');const {job}=await response.json();dialog.querySelector('section').innerHTML=`<h1>${esc(job.title)}</h1><p class="muted">${esc(job.company)} · ${esc(job.location)}</p><p>${esc(pay(job))}</p><h2>Fit assessment</h2><p>${esc(job.ai_fit_rationale||'This job has not yet been AI assessed.')}</p><ul>${(job.matched||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${job.gaps?.length?'<h3>Requirements to check</h3><ul>'+job.gaps.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>':''}<h2>Employer description</h2><div class="posting-text">${esc(job.description||'No description was provided.')}</div>${job.url?`<p><a class="btn" href="${esc(job.url)}" target="_blank" rel="noopener">Employer posting ↗</a></p>`:''}`;}catch(error){dialog.querySelector('section').textContent=error.message;}
 }
 document.addEventListener('click',async event=>{const el=event.target.closest('button');if(!el)return;
  if(el.dataset.deckAct){void actDeck(el.dataset.deckAct);return;}
  const id=Number(el.dataset.open||el.dataset.save||el.dataset.unstar||el.dataset.posting);
  if(el.dataset.posting){void posting(id);return;}
  if(el.dataset.page){if(busy)return;remember();if(el.dataset.page==='previous')page=Math.max(1,firstPage-1);else page+=1;void load(el.dataset.page==='more',el.dataset.page!=='more');return;}
  if(!el.dataset.open&&!el.dataset.save&&!el.dataset.unstar)return;el.disabled=true;$('actionState').textContent='';
  try{remember();if(el.dataset.open){const job=rows.find(j=>j.id===id),done=DONE.has(job?.status);if(!done&&!['promoted','generated','deferred'].includes(job?.status))await CareerJobActions.promote(id);CareerJobActions.openApplication(id,done);return;}
   if(el.dataset.save){const result=await CareerJobActions.save(id);rows=rows.map(j=>j.id===id?{...j,favorite:true}:j);render();$('actionState').textContent=result.error?'Saved. Assessment needs attention: '+result.error:'Saved to your Job Board. Assessment started; no documents generated.';}
   else{await CareerJobActions.favorite(id,false);rows=rows.filter(j=>j.id!==id);render();$('actionState').textContent='Star removed. Existing drafts and application records are retained.';}
   void CareerNavigation.refreshCounts();
  }catch(error){$('actionState').textContent=error.message;el.disabled=false;}
 });
 function refilter(){page=1;void load();}let typing;$('q').oninput=()=>{clearTimeout(typing);typing=setTimeout(refilter,250);};$('keywordSearch').onsubmit=event=>{event.preventDefault();clearTimeout(typing);refilter();};fields.filter(key=>key!=='q').forEach(key=>$(key).onchange=refilter);
 $('showEarlier').onclick=()=>{earlier=true;page=1;refilter();};window.addEventListener('pagehide',remember);
 void CareerNavigation.refreshCounts().then(data=>{if(stage==='queue'&&data?.earlierPreparation){$('earlier').hidden=false;$('earlierCount').textContent='('+data.earlierPreparation+')';}});
 (async()=>{try{const response=await fetch('/api/auth/user',{signal:AbortSignal.timeout(2000)}),identity=await response.json();if(response.ok&&identity.authenticated&&identity.tenant&&identity.principal_id){memoryKey='career-journey:'+identity.tenant+':'+identity.principal_id+':'+stage;const stored=JSON.parse(sessionStorage.getItem(memoryKey)||'null');const explicit=fields.some(key=>query.has(key))||query.has('page');if(stored&&!explicit){for(const key of fields)if(stored.filters?.[key]!=null)$(key).value=stored.filters[key];page=stored.page||1;returnY=stored.scrollY||0;earlier=stored.earlier===true;}}}catch{/* URL and current session still work without persistent preferences. */}
  for(const key of fields)if(query.has(key))$(key).value=query.get(key);if(query.has('page'))page=Math.max(1,Number(query.get('page'))||1);if(![25,50,100,200].includes(Number($('per').value)))$('per').value='50';firstPage=page;void load();})();
})();
