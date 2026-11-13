/* CHANGE LOG:
 * 20 | maintainer@emeraldcoastsystemsgroup.com | Remove saved rows immediately through durable dismissal, retaining exact refusal recovery.
 * 18 | maintainer@emeraldcoastsystemsgroup.com | Show ready, review and stopped-preparation reasons in Getting ready without claiming submission.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render stable per-stage lists, remembered account-scoped filters and scroll, and direct application handoffs without nested document panels.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: this page is the live Job Board (board-native), so the pipeline lives here: the stage control (career-stages.js) over New matches (?view=matches), Saved, To approve (?view=approve opens the approvals view), Preparing (?view=queue), Applied (?view=status) and Interviewing (?view=interviewing, status=interview); an empty stage is one empty state whose primary is Find jobs (no "0 shown" or "No results · End of this view"); Clear filters; pay and fit filters only while finding jobs. Guard: tests/career-job-lists-stages.test.mjs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | UX Design Standard sweep: phone Filters sheet (#boardFilterSheet) with history Back dismissal, posting modal sheet Back dismissal, and merged New matches phone swipe deck (Pass, Save, Undo, More + Cards/List switch).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Guard save and unstar handlers against duplicate action with a savingJobs Set; set aria-busy during saves and clear it on completion or failure.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The phone swipe deck works from anywhere on the card (Roger, 2026-11-10: "super wonky on my phone"). Measured with real touch input: the card trailed the finger (220px of finger, 129px of card) because its settle transition stayed on during the drag; a swipe that began on the job title did nothing, because drags starting on a button were ignored; a swipe that began on the reason text did nothing, because that text was a scroll box and the browser took the gesture. The card now follows the finger exactly, decides sideways or scroll in the first 8px, flies off on a drag past 80px or a quick flick and shows Save or Pass while it is held, and a tap still opens the job.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 3 and 5, and the inbox replies a job already carries. (a) The page reads GET /resume/state. With no résumé, New matches says "Add your résumé to get matches" with that one button and lists nothing (it listed the person's saved jobs as if they were matches), and a job with no fit shows the link "Add your résumé to see your fit" where it said "AI assessment pending", which nothing could ever complete. While a first résumé is being read the stage says so. With a résumé, or when the read gives no answer, the page behaves as before. (b) A job's newest reply from the inbox (emailUpdates, from GET /jobs) is one line on its row, for example "Interview reply · Nov 8", and pressing it opens that job's application. (c) One word for each thing: Save, Saved and Unsave replace the star and "Save to Job Board"; the saved list is "your saved jobs", not a shortlist; the stage reads Getting ready. Guards: tests/career-job-lists-truth.test.mjs.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 12, 13 and 14: one name for each page. The saved list's heading is My jobs (was Job Board). Words only. Guard: tests/career-page-names.test.mjs.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 6 and 9. (a) One route to an application: To approve is no longer a stage. The jobs Career picked (CareerStages.picks) lead the first page of Saved, each marked "Career picked this for you" with the same Prepare application button a saved job has and Remove (the route Deny called); ?view=approve opens Saved instead of the retired approvals page, and says so when Career has nothing waiting. (b) Applications is its own bar section, so the page answers ?view=offer, ?view=closed and ?view=dismissed (each used to open Saved) and draws the row of its own section. (c) Each job a person has applied to carries one line, Sent, with its day and how Career knows (career-status-line.js); what Career is sending from the person's computer leads Applied as Waiting, Sending, Needs your answer or Did not go through, and one quiet link opens the activity page only while there is such a record or the records could not be read. (d) A move is said in one line (Saved, Unsaved, Removed, Getting ready) and the stage row and the bar re-count. Guards: tests/career-apply-one-route.test.mjs, tests/career-applications-section.test.mjs.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | One filled button for the next thing to do: View application on a job already applied to is outlined, because nothing is left to do there; Prepare application and Continue application stay filled.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 1: Career's picks lead the first page of Saved whatever the filters are. They were dropped whenever a filter was set, and the page puts a signed-in person's last filters back on a plain visit, so a search left from an earlier day hid the picks Home had just counted. A pick is not a filtered result; later pages still show none. When the filters match no saved job the page says so under the picks ("No saved jobs match these filters.", with Clear filters), and Clear filters in the list is handled where the list's other buttons are. Guard: tests/career-apply-one-route.test.mjs.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Recommended for you (New matches), reported from a phone 2026-11-11. (a) A match the person has not saved said "Saved" under its facts beside a filled Save button, because "Saved" was the row's fallback line; in New matches the fallback is no line, and a saved match's button reads Saved, is pressed no more and is not filled. (b) New matches is ordered by date posted, newest first (it was Best AI fit). A sort the person chose is still remembered for the visit; a remembered sort they never chose is not put back, so the old default does not outlive the change. Guard: tests/career-matches-save-and-order.test.mjs.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | Interviewing shows the saved manual interview date and local time alongside its application.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | Show truthful unscored fit states and explicitly check one saved job through its scoring-only receipt, with honest progress, failure and retry in rows and posting sheets.
 * 14 | maintainer@emeraldcoastsystemsgroup.com | Put phone match controls in Filters and dock actions with unobscured status; retain failed fit evidence and reconcile delayed posting reads with newer completed checks.
 * 15 | maintainer@emeraldcoastsystemsgroup.com | Request the explicit actionable match feed so saved and application records stay in their own views.
 * 16 | maintainer@emeraldcoastsystemsgroup.com | Bound the first résumé-status wait at two seconds, preserve unknown status, and reconcile late no-résumé/indexing truth before a stale feed can paint.
 * 17 | maintainer@emeraldcoastsystemsgroup.com | Restore only the optimistically removed phone card and its history entry after an exact native busy refusal, preserving explicit retry and acknowledged saves.
 * 19 | maintainer@emeraldcoastsystemsgroup.com | Name Open application, explain preparation immediately and retain per-job busy, acknowledged and unknown states across redraws; reconcile unknown writes read-only before any separate manual retry.
 * 18 | maintainer@emeraldcoastsystemsgroup.com | Remove a Career pick through its existing owner board dismissal, clearing Saved while retaining application and native ticket history. */
(()=>{'use strict';const $=id=>document.getElementById(id),query=new URLSearchParams(location.search),view=query.get('view'),recommended=view==='matches',stage={matches:'matches',queue:'queue',status:'status',interviewing:'interview',offer:'offer',closed:'closed',dismissed:'dismissed'}[view]||'saved';
 /* ?view=approve is the address the To approve stage had. It opens Saved, where the jobs Career picked lead the list. */
 const fromApprove=view==='approve';
 const DONE=new Set(['applied','interview','offer','rejected']),labels={saved:'My jobs',queue:'Getting ready',status:'Applied',matches:'New matches',interview:'Interviewing'};
 /* The stages the row gained when Applications became its own bar section (judge's report 2026-11-11, change 9): the title, what the page says it holds and what an empty one says. APPLICATIONS are the stages of jobs a person has applied to; FEED and VIEW are the status the feed is asked for and the ?view= each stage answers. */
 const ADDED={offer:['Offer','Applications that reached an offer.','No offers yet','An application that reaches an offer appears here.'],closed:['Closed','Applications that ended without an offer.','Nothing closed','An application that is turned down appears here.'],dismissed:['Removed','Jobs you removed. Prepare one to bring it back.','Nothing removed','A job you remove from your lists is kept here.']};
 for(const key of Object.keys(ADDED))labels[key]=ADDED[key][0];
 const APPLICATIONS=new Set(['status','interview','offer','closed']),FEED={status:'tracked',closed:'rejected'},VIEW={matches:'matches',queue:'queue',status:'status',interview:'interviewing',offer:'offer',closed:'closed',dismissed:'dismissed'},ROW={saved:'saved',queue:'preparing',status:'applied',matches:'matches',interview:'interviewing',offer:'offer',closed:'closed',dismissed:'dismissed'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fields=['q','sort','per','min_score','pay_period','min_pay','max_pay','days','remote'];let page=1,firstPage=1,rows=[],exhausted=false,epoch=0,controller=null,memoryKey=null,earlier=query.get('earlier')==='1',busy=false,returnY=0,firstLoad=true,savingJobs=new Set();
 const phoneMedia=typeof window.matchMedia==='function'?window.matchMedia('(max-width: 640px)'):{matches:false,addEventListener:()=>{}};
 let matchLayout='deck',deckHistory=[];const removing=new Set();const preparationStates=new Map();const fitChecks=new Map(),fitResults=new Map();let fitRevision=0;
 /* What GET /resume/state says: unknown until it answers, and unknown again if it does not, in which case the page behaves as it did. */
 let resume={known:false,has:false,reading:false};
 const noResume=()=>resume.known&&!resume.has&&!resume.reading,readingResume=()=>resume.known&&!resume.has&&resume.reading;
 const resumeAnswer=fetch('/api/career-hunter/resume/state',{cache:'no-store',signal:AbortSignal.timeout(8000)}).then(r=>r.ok?r.json():null).then(state=>{if(state&&typeof state.hasResume==='boolean')resume={known:true,has:state.hasResume,reading:state.indexing===true};}).catch(()=>{});
 const resumeReady=new Promise(resolve=>{const timer=setTimeout(resolve,2000);void resumeAnswer.then(()=>{clearTimeout(timer);resolve();});});
 const REPLY={acknowledged:'Application received',interview:'Interview reply',offer:'Offer',rejected:'Not selected'};
 $('pageTitle').textContent=labels[stage];document.title=labels[stage];$('pageDescription').textContent=stage==='saved'?'Your saved jobs. Open a job to compare its fit, or prepare an application.':stage==='queue'?'Open an application to tailor it, generate documents and review how to send it.':stage==='status'?'Every job you have applied to, and anything being sent now.':stage==='interview'?'Applications with a recorded interview.':'Jobs that match your résumé. Save the ones you want to go after.';
 if(ADDED[stage])$('pageDescription').textContent=ADDED[stage][1];
 $('searchModes').hidden=!recommended;if($('matchesLayoutSwitch'))$('matchesLayoutSwitch').hidden=!recommended;
 document.querySelector(`[data-career-tool="${recommended?'career-search':stage==='saved'?'career-board':stage==='queue'?'career-submissions':'career-application-status'}"]`)?.setAttribute('aria-current','page');
 $('sort').value=stage==='queue'?'generated':APPLICATIONS.has(stage)?'applied':stage==='dismissed'?'recent':recommended?'posted':'ai';
 /* Whether the person picked the sort themselves this visit; only such a sort is remembered and put back. */
 let sortChosen=false;$('sort').addEventListener('change',()=>{sortChosen=true;});
 /** @description Draw the stage row with fresh counts; called again after a job moves. @returns {void} */
 function drawStages(){if(window.CareerStages)void CareerStages.counts().then(counts=>CareerStages.render($('careerStages'),ROW[stage],counts));}
 drawStages();
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
  const modes=$('searchModes'),search=$('keywordSearch'),phoneHome=$('boardPhoneControls');
  const homes=[modes,search,openBtn].map(node=>({node,parent:node.parentNode,next:node.nextSibling}));
  const placeControls=()=>{
   const compact=recommended&&phoneMedia.matches;phoneHome.hidden=!compact||noResume()||readingResume();
   if(compact){phoneHome.append(openBtn);body.prepend(modes,search);}
   else for(const slot of homes)slot.parent.insertBefore(slot.node,slot.next?.parentNode===slot.parent?slot.next:null);
  };
  placeControls();phoneMedia.addEventListener?.('change',placeControls);
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
 function remember(){if(!memoryKey)return;try{sessionStorage.setItem(memoryKey,JSON.stringify({filters:filters(),page:firstPage,scrollY:window.scrollY,earlier,sortChosen}));}catch{}}
 function address(){const params=new URLSearchParams(filters());if(VIEW[stage])params.set('view',VIEW[stage]);if(earlier)params.set('earlier','1');params.set('page',String(firstPage));history.replaceState(null,'',location.pathname+'?'+params);}
 function pay(job){const a=job.salary_min,b=job.salary_max;if(!a&&!b)return 'Pay estimate unavailable';const symbol=job.salary_currency==='USD'?'$':(job.salary_currency||'')+' ',amount=n=>symbol+Number(n).toLocaleString('en-US',{maximumFractionDigits:2}),unit={year:' / year',hour:' / hour',month:' / month',course:' / course'}[job.salary_period]||' · period unknown';return (a&&b&&a!==b?amount(a)+'–'+amount(b):amount(b||a))+unit+(['heuristic','ai_estimated','bls_estimated'].includes(job.salary_source)?' · estimate':'');}
 function state(job){return job.preparation?job.preparation.reason:DONE.has(job.status)?'Application recorded':job.board?.applicationDraft?'Application draft saved':job.board?.phase==='generating'?'Generating documents':job.has_resume?'Documents available':job.status==='promoted'?'Ready for preparation':recommended?'':'Saved';}
 /* Career's picks (CareerStages.picks) lead Saved, and what Career is sending from the person's computer (the open records of GET /submission-queue) leads Applied. Neither read holds the list back: each is drawn when it answers. */
 let picked=[],picksRead=stage!=='saved',sending=[],sendingKnown=true,landed=false,countWords=['',''];
 const OPEN_SUBMISSION=new Set(['queued','claimed','reviewing','submitting','needs_you','unknown','failed']);
 const find=id=>rows.find(job=>job.id===id)||picked.find(job=>job.id===id);
 const filtered=()=>Object.keys(filters()).some(key=>!['sort','per','pay_period'].includes(key));
 /** @description Say something in the page's status line. @param {string} text @returns {void} */
 function say(text){$('actionState').textContent=text;}
 /** @description After a job changes stage: say so in one line, and bring the stage row's and the bar's counts up to date. @param {string} text @returns {void} */
 function moved(text){say(text);void CareerNavigation.refreshCounts();drawStages();window.CareerFrame?.refresh?.();}
 /** @description One status line: the word, its day when it has one, and how Career knows. @param {{kind:string,word:string,detail:string,day?:string}} line @returns {string} Markup. */
 function lineMarkup(line){return `<p class="app-line" data-line="${esc(line.kind)}"><b>${esc(line.word)}</b>${line.day?' · '+esc(line.day):''} · ${esc(line.detail)}</p>`;}
 /** @description Say how many jobs the list shows, with Career's picks and what is being sent counted in. @returns {void} */
 function showCount(){const n=$('list').querySelector('.match-deck')?rows.length:$('list').querySelectorAll('.job-row').length;$('requestState').textContent=n?countWords[0]+n+' shown'+countWords[1]:'';}
 /** @description What the list shows: on the first page of Saved, Career's picks lead whatever the filters are (a pick is not a filtered result) and are not repeated below; later pages are the saved jobs only. @returns {Array<object>} Jobs. */
 function listed(){if(stage!=='saved'||firstPage>1||!picked.length)return rows;const ids=new Set(picked.map(job=>job.id));return [...picked,...rows.filter(job=>!ids.has(job.id))];}
 /** @description Under Career's picks, when the filters match none of the person's saved jobs: say so, with the way out. Without it the picks would look like the search's results. @returns {Array<[string,string]>} The one keyed note, or none. */
 function filterNote(){return stage==='saved'&&firstPage<=1&&picked.length&&!rows.length&&filtered()?[['filter-note','<p class="hint filter-note" data-job-id="filter-note">No saved jobs match these filters. <button type="button" class="ck-tertiary" data-clear-filters>Clear filters</button></p>']]:[];}
 /**
  * @description A job Career is sending, or tried to send, from the person's computer: its status line and the way to its application.
  * @param {object} entry - A record from GET /submission-queue, with its job when that could be read.
  * @returns {string} Markup.
  */
 function sendingRow(entry){
  const job=entry.job||{},id=Number(entry.postingId),line=CareerStatusLine.forSubmission(entry);
  return `<article class="job-row" data-job-id="sending-${id}" data-sending><div class="summary"><button class="job-title" data-posting="${id}">${esc(job.title||entry.title||'Application')}</button><p class="job-company muted">${esc(job.company||entry.company||'')}</p>${line?lineMarkup(line):''}</div><div class="row-actions"><button class="btn primary" data-application="${id}">Open application</button></div></article>`;
 }
 /** @description Offer the activity page only while something is being sent or did not go through, or when that could not be read. @returns {void} */
 function showActivityLink(){const link=$('activityLink');if(link)link.hidden=sendingKnown&&!sending.length;}
 /**
  * @description Read what Career is sending from the person's computer, each record with its job. A job already
  * applied to is in the list below with its own line, so its record is left out.
  * @returns {Promise<void>}
  */
 async function readSending(){
  let items=null;
  try{items=window.CareerSubmit?await CareerSubmit.synchronize():null;}catch{/* an unread queue is reported as unread below */}
  if(!Array.isArray(items)){sendingKnown=false;showActivityLink();return;}
  const open=items.filter(item=>OPEN_SUBMISSION.has(item.status)&&Number(item.postingId)>0).slice(0,10);
  const read=await Promise.all(open.map(async item=>{
   try{const response=await fetch('/api/career-hunter/jobs/'+encodeURIComponent(item.postingId),{cache:'no-store'});if(!response.ok)return item;const {job}=await response.json();return job&&DONE.has(job.status)?null:{...item,job};}
   catch{return item;}
  }));
  sending=read.filter(Boolean);showActivityLink();if(!firstLoad&&!busy){render();showCount();}
 }
 /** @description A person who followed a To approve link is told when Career has nothing waiting for them. @returns {void} */
 function landOnPicks(){if(!fromApprove||landed||firstLoad||!picksRead)return;landed=true;if(!picked.length)say('Career has no picks waiting for you. Your saved jobs are here.');}
 /**
  * @description The newest reply from the inbox that Career matched to this job, as one line a person understands.
  * @param {object} job - A job from GET /jobs; `emailUpdates` holds its replies, each {subject,date,kind,threadId}.
  * @returns {string} For example "Interview reply · Nov 8", or '' when the job has no reply of a known kind.
  */
 function replyLine(job){
  const interviewAt=job.interview_at||job.board?.manualTracking?.interviewAt;
  if(job.status==='interview'&&interviewAt&&Number.isFinite(Date.parse(interviewAt)))return 'Interview · '+new Date(interviewAt).toLocaleString();
  const newest=(Array.isArray(job.emailUpdates)?job.emailUpdates:[]).filter(update=>update&&Object.hasOwn(REPLY,update.kind)).reduce((last,update)=>!last||String(update.date||'')>=String(last.date||'')?update:last,null);
  if(!newest)return '';
  // The server writes the message's time as an ISO instant; anything else is not shown as a date (the browser would guess one).
  const at=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(String(newest.date))?new Date(newest.date):null,day=at&&!Number.isNaN(at.getTime())?at.toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
  return REPLY[newest.kind]+(day?' · '+day:'');
 }
 /** @description The actual fit, or an explicit next step without claiming that an ended check is pending. @param {object} job @returns {string} Markup. */
 function fitMarkup(job){
  const check=fitChecks.get(job.id),label=job.ai_fit_score!=null?`<span>AI fit ${esc(job.ai_fit_score)}${job.fit_assessment?.assessedAt?' · '+esc(new Date(job.fit_assessment.assessedAt).toLocaleDateString()):''}</span>`:'<span>Not scored yet</span>';
  if(job.ai_fit_score!=null&&!check?.error&&!check?.busy)return label;
  if(noResume())return label+'<a class="fit-link" href="/api/career-hunter/resume-studio" data-career-tool="career-resume-studio">Add your résumé to see your fit</a>';
  if(readingResume())return label+'<span>Reading your résumé…</span>';
  if(!job.favorite)return label+'<span>Save this job to check your fit.</span>';
  return label+`<button class="btn" type="button" data-check-fit="${job.id}"${check?.busy?' disabled aria-busy="true"':''}>${check?.busy?'Checking my fit…':'Check my fit'}</button>${check?.error?'<span role="status">'+esc(check.error)+'</span>':''}`;
 }
 /** @description Fit controls and evidence inside the selected posting. @param {object} job @returns {string} Markup. */
 function postingFitMarkup(job){
  return `<div class="meta" data-fit-state>${fitMarkup(job)}</div><p>${esc(job.ai_fit_rationale||'Check this job against your résumé to see its fit and requirements to work on.')}</p><ul>${(job.matched||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${job.gaps?.length?'<h3>Requirements to check</h3><ul>'+job.gaps.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>':''}`;
 }
 /** @description Refresh only existing rows and matching open posting sheets after a selected-job check changes. @param {number} id @param {object|null} job @returns {void} */
 function renderFitChange(id,job){
  if(job){rows=rows.map(current=>current.id===id?{...current,...job}:current);picked=picked.map(current=>current.id===id?{...current,...job}:current);}
  render();
  for(const area of document.querySelectorAll('[data-posting-fit="'+id+'"]')){
   if(job)area.innerHTML=postingFitMarkup(job);
   else area.querySelector('[data-fit-state]').innerHTML=fitMarkup({id,favorite:true});
  }
 }
 /** @description Complete a fit check without inventing a score, retaining a retry and a visible error when it did not finish. @param {number} id @param {object|null} job @param {string} [reason] @returns {void} */
 function finishFit(id,job,reason){
  const error=reason||(job?.board?.phase==='failed'||job?.board?.error||job?.ai_fit_score==null?'Its fit could not be checked. '+(job?.board?.error?CareerJobActions.message(job.board.error):'Please try again.'):'');
  if(job)fitResults.set(id,{revision:++fitRevision,job});
  if(error)fitChecks.set(id,{busy:false,error});else fitChecks.delete(id);
  renderFitChange(id,job);say(error||'Fit checked: '+(job?.title||'this job')+'.');
 }
 /** @description Explicitly score one saved job, without generating documents, then wait for its matching receipt. @param {number} id @returns {Promise<void>} */
 async function checkFit(id){
  if(!Number.isSafeInteger(id)||id<=0||fitChecks.get(id)?.busy)return;
  const pending={busy:true};fitChecks.set(id,pending);renderFitChange(id,null);say('Checking this job against your résumé…');
  try{
   const result=await CareerJobActions.prepare(id,false);
   if(fitChecks.get(id)!==pending)return;
   if(!result.requestId)throw Error('The fit check did not return a receipt. Please try again.');
   pending.stop=CareerJobActions.poll(id,result.requestId,job=>{if(fitChecks.get(id)===pending)finishFit(id,job);});
  }catch(error){if(fitChecks.get(id)===pending)finishFit(id,null,error.message);}
 }
 function row(job){const pending=preparationStates.get(job.id);if(pending?.job&&!DONE.has(job.status))job={...job,...pending.job};const done=DONE.has(job.status),prepared=isPrepared(job),action=pending?.unknown?'Check preparation':done?'View application':prepared?'Open application':'Prepare application',reply=replyLine(job);
  /* An applied job says in one line that it was sent and how Career knows; a pick is marked as Career's and is not called saved; a removed job is not called saved either. */
  const said=stage==='dismissed'?'Removed':state(job),status=job.picked?'':done&&window.CareerStatusLine?lineMarkup(CareerStatusLine.forJob(job)):said?`<p class="status">${esc(said)}</p>`:'';
  const second=job.picked||(stage==='saved'&&!done)?`<button class="btn quiet" data-remove-pick="${job.id}">Remove</button>`:stage==='saved'?`<button class="btn quiet" data-unstar="${job.id}">Unsave</button>`:'';
  return `<article class="job-row" data-job-id="${job.id}"${job.picked?' data-picked':''}><div class="summary">${job.picked?'<p class="pick-mark">Career picked this for you</p>':''}<button class="job-title" data-posting="${job.id}">${esc(job.title)}</button><p class="job-company muted">${esc(job.company)}</p><div class="meta"><span>${esc(pay(job))}</span><span>${esc(job.location||'Location unavailable')}</span>${job.remote?'<span>Fully remote</span>':''}${fitMarkup(job)}${job.posted_date?`<span>Posted ${esc(job.posted_date.slice(0,10))}</span>`:''}${job.active===0?'<span>Posting no longer active</span>':''}</div>${reply?`<button type="button" class="reply-line" data-reply="${job.id}">${esc(reply)}</button>`:''}${status}</div><div class="row-actions">${recommended?`<button class="btn${job.favorite?'':' primary'}" data-save="${job.id}" ${job.favorite?'disabled':''}>${job.favorite?'Saved':'Save'}</button><button class="btn" data-job-feedback="${job.id}">Not interested</button>`:`<button class="btn${done?'':' primary'}" data-open="${job.id}" data-done="${done}"${pending?.busy?' disabled aria-busy="true"':''}>${action}</button>${second}`}</div></article>`;
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
  const pending={job:lead,action:kind},actionEpoch=epoch;
  rows=rows.slice(1);deckHistory.push(pending);render();
  try{
   if(kind==='save'){const res=await CareerJobActions.save(lead.id);moved(CareerStatusLine.move('saved',lead)+(res.error?' Its fit could not be checked: '+res.error:''));}
   else{const response=await fetch('/api/career-hunter/jobs/'+lead.id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'dismissed'})}),result=await response.json().catch(()=>({}));if(!response.ok||result.ok===false)throw Error(result.error||'Could not remove this job.');say(CareerStatusLine.move('removed',lead));}
  }catch(err){
   if(kind!=='save'||err.careerRunInProgress===true){
    const index=deckHistory.indexOf(pending);if(index!==-1)deckHistory.splice(index,1);
    if(epoch===actionEpoch&&!rows.some(job=>job.id===lead.id)){rows=[lead,...rows];render();}
   }
   $('actionState').textContent=err.message;
  }
  if(rows.length<2&&!exhausted&&!busy){page+=1;void load(true,false);}
 }

 /**
  * @description The phone deck's swipe. The card follows the finger from anywhere on it (the title and the reason text
  * included) once the movement is sideways; a drag past the threshold, or a quick flick, sends it off the screen and
  * saves (right) or passes (left); anything shorter settles back. A touch the phone takes for scrolling never acts, and a
  * tap still opens the job.
  * @param {HTMLElement|null} card - The top card of the deck.
  * @returns {void}
  */
 function bindDeckSwipe(card){
  if(!card)return;
  const THRESHOLD=80,FLICK_DISTANCE=36,FLICK_SPEED=0.45,still=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let pointer=null,sx=0,sy=0,dx=0,started=0,mode='';
  const settle=()=>{card.classList.remove('dragging');card.style.transform='';delete card.dataset.swipe;};
  card.onpointerdown=e=>{if(e.button||pointer!==null)return;pointer=e.pointerId;sx=e.clientX;sy=e.clientY;dx=0;started=e.timeStamp;mode='';};
  card.onpointermove=e=>{
   if(e.pointerId!==pointer)return;
   dx=e.clientX-sx;const dy=e.clientY-sy;
   if(!mode){
    if(Math.abs(dx)<8&&Math.abs(dy)<8)return;
    mode=Math.abs(dx)>Math.abs(dy)?'swipe':'scroll';
    if(mode==='swipe'){card.setPointerCapture?.(pointer);card.classList.add('dragging');}
   }
   if(mode!=='swipe')return;
   card.style.transform=`translateX(${dx}px) rotate(${dx/22}deg)`;
   card.dataset.swipe=dx>24?'save':dx<-24?'pass':'';
  };
  const end=(e,cancelled)=>{
   if(e.pointerId!==pointer)return;
   pointer=null;
   if(mode!=='swipe'){mode='';return;}
   mode='swiped'; // the click that follows a drag is not a tap on the job
   const speed=Math.abs(dx)/Math.max(1,e.timeStamp-started);
   if(cancelled||!(Math.abs(dx)>THRESHOLD||(Math.abs(dx)>FLICK_DISTANCE&&speed>FLICK_SPEED))){settle();return;}
   const kind=dx>0?'save':'pass';
   if(still){void actDeck(kind);return;}
   card.classList.remove('dragging');card.classList.add('flung');
   card.style.transform=`translateX(${dx>0?130:-130}%) rotate(${dx>0?18:-18}deg)`;
   setTimeout(()=>void actDeck(kind),170);
  };
  card.onpointerup=e=>end(e,false);
  card.onpointercancel=e=>end(e,true);
  card.addEventListener('click',e=>{if(mode==='swiped'){mode='';e.preventDefault();e.stopPropagation();}},true);
 }

 /** @description New matches with no résumé (or while a first one is read): what will appear, and the one step. @returns {void} */
 function renderWithoutResume(){
  const reading=readingResume();
  setDeckActions(false);$('boardPhoneControls').hidden=true;
  for(const id of ['keywordSearch','filters','searchModes'])if($(id))$(id).hidden=true;
  $('careerExclusions')?.remove();$('pager').innerHTML='';$('requestState').textContent='';
  $('list').innerHTML=reading
   ?'<div class="ck-empty"><div class="ck-empty-icon" aria-hidden="true">📄</div><h2>Reading your résumé</h2><p>Your matches appear here when Career has finished reading it.</p></div>'
   :'<div class="ck-empty"><div class="ck-empty-icon" aria-hidden="true">📄</div><h2>Add your résumé to get matches</h2><p>Career compares each job with your résumé. Add it and the jobs that fit you appear here.</p><a class="ck-primary" href="/api/career-hunter/resume-studio" data-career-tool="career-resume-studio">Add your résumé</a></div>';
 }
 /** @description Keep the phone deck's status and action row in one dock above the frame bar. @param {boolean} enabled @returns {void} */
 function setDeckActions(enabled){
  $('matchActionDock').toggleAttribute('data-deck-active',enabled);
  $('deckActionButtons').innerHTML=enabled?'<button type="button" class="ck-btn" data-deck-act="undo">Undo</button><button type="button" class="ck-btn" data-deck-act="pass">Pass</button><button type="button" class="ck-primary" data-deck-act="save">Save</button><button type="button" class="ck-btn" data-deck-act="more">More</button>':'';
 }
 function render(){
  rows=rows.filter(job=>!removing.has(job.id));picked=picked.filter(job=>!removing.has(job.id));
  const useDeck=recommended&&phoneMedia.matches&&matchLayout==='deck'&&rows.length>0;setDeckActions(useDeck);
  if(useDeck){
   const lead=rows[0],peek=rows[1];
   $('list').innerHTML=`<div class="match-deck"><p class="hint">Swipe right to save or left to pass, or use the buttons.</p><div class="match-deck-stage">${peek?deckCardMarkup(peek,false):''}${deckCardMarkup(lead,true)}</div></div>`;
   bindDeckSwipe($('list').querySelector('.match-card.lead'));
   $('pager').innerHTML='';return;
  }
  const old=new Map([...$('list').querySelectorAll('[data-job-id]')].map(el=>[el.dataset.jobId,el]));
  const lead=stage==='status'&&firstPage<=1&&!filtered()?sending.map(entry=>['sending-'+Number(entry.postingId),sendingRow(entry)]):[];
  const nodes=[...lead,...listed().map(job=>[String(job.id),row(job)]),...filterNote()].map(([key,markup])=>{const prior=old.get(key);if(prior?.dataset.markup===markup)return prior;const template=document.createElement('template');template.innerHTML=markup;const next=template.content.firstElementChild;next.dataset.markup=markup;return next;});
  if(!nodes.length){const EMPTY=ADDED[stage]?.slice(2)||{saved:['No saved jobs yet','Save jobs from Search to compare and prepare them.'],matches:['No matches yet','Matches against your résumé appear here.'],queue:['Nothing to prepare yet','Move a saved job here when ready to apply.'],status:['No applications yet','Submitted applications are tracked here.'],interview:['No interviews yet','Recorded interviews appear here.']}[stage]||['Nothing here yet',''];
  $('list').innerHTML=filtered()?'<div class="ck-empty"><h2>No jobs match these filters</h2><p>Clear filters to see this stage.</p><button type="button" class="ck-btn" data-clear-filters>Clear filters</button></div>':`<div class="ck-empty"><div class="ck-empty-icon" aria-hidden="true">🗂️</div><h2>${EMPTY[0]}</h2><p>${EMPTY[1]}</p><a class="ck-primary" href="/api/career-hunter/search-ui" data-career-tool="career-search">Find jobs</a></div>`;}else{const keep=new Set(nodes);for(const child of [...$('list').children])if(!keep.has(child))child.remove();let cursor=$('list').firstElementChild;for(const node of nodes){if(node===cursor)cursor=cursor.nextElementSibling;else $('list').insertBefore(node,cursor);}}
  if(!rows.length&&firstPage<=1){$('pager').innerHTML='';return;}
  $('pager').innerHTML=`<span class="hint">${rows.length?`Showing ${((firstPage-1)*Number($('per').value))+1}–${((firstPage-1)*Number($('per').value))+rows.length}`:'No results'}${exhausted?' · End of this view':''}</span><div class="actions">${firstPage>1?'<button class="btn" data-page="previous">← Previous</button>':''}${!exhausted?'<button class="btn" data-page="more">Load more</button><button class="btn" data-page="next">Next →</button>':''}</div>`;
 }
 async function load(append=false,top=false){
  if(recommended){await resumeReady;if(noResume()||readingResume()){rows=[];renderWithoutResume();return;}}
  controller?.abort();controller=new AbortController();const current=++epoch;busy=true;$('list').setAttribute('aria-busy','true');$('requestState').textContent=rows.length?'Updating results…':'Loading jobs…';
  const params=new URLSearchParams(filters());if(stage==='matches')params.set('matches','1');else params.set('status',FEED[stage]||stage);if(stage==='queue'&&!earlier)params.set('current','1');params.set('page',String(page));
  try{const response=await fetch('/api/career-hunter/jobs?'+params,{signal:controller.signal,cache:'no-store'}),data=await response.json();if(current!==epoch)return;if(!response.ok)throw Error(data.error||'HTTP '+response.status);
   firstPage=append?firstPage:page;const incoming=data.jobs||[];rows=CareerFeedback.unique([...new Map((append?[...rows,...incoming]:incoming).map(job=>[job.id,job])).values()]);exhausted=data.exhausted===true||incoming.length<Number($('per').value);
   if(recommended){rows=CareerFeedback.visible(rows,data.exclusions||[]);CareerFeedback.configure(rows,data.exclusions,(rules)=>{rows=CareerFeedback.visible(rows,rules);render();void load();});}
   countWords=[earlier?'Earlier preparation · ':'',data.pooled&&data.poolSize?' · ranked within '+data.poolSize.toLocaleString()+' matches':''];render();showCount();address();if(top)window.scrollTo({top:0,behavior:'instant'});else if(firstLoad&&returnY)window.scrollTo({top:returnY,behavior:'instant'});firstLoad=false;remember();landOnPicks();
  }catch(error){if(current!==epoch||error.name==='AbortError')return;$('requestState').replaceChildren(document.createTextNode('Could not update jobs: '+error.message+'. '));const retry=document.createElement('button');retry.className='btn';retry.textContent='Retry';retry.onclick=()=>load(append,top);$('requestState').append(retry);}
  finally{if(current===epoch){busy=false;$('list').setAttribute('aria-busy','false');}}
 }
 /** @description Whether the saved job already has a tailoring workspace. */
 function isPrepared(job){return ['promoted','generated','deferred'].includes(job?.status)||Boolean(job?.board?.applicationDraft);}
 /** @description Keep an acknowledged preparation on this row even if the parent refuses to open it. */
 function preparedJob(id,job){
  const latest={...job,id};const pending=preparationStates.get(id);if(pending)pending.job=latest;rows=rows.map(current=>current.id===id?{...current,...latest}:current);
  picked=picked.map(current=>current.id===id?{...current,...latest}:current);return latest;
 }
 /** @description Check one uncertain preparation without retrying the write. */
 async function reconcilePreparation(id,pending){
  try{
   const job=await CareerJobActions.preparation(id);preparedJob(id,job);pending.unknown=false;
   if(isPrepared(job)||DONE.has(job.status))return job;
   say('Preparation was not recorded. Press Prepare application to try again.');return null;
  }catch{say('Could not check preparation. Press Check preparation to read its saved state again.');return null;}
 }
 /** @description One explicit Prepare or Open; never automatically repeat a mutation or bypass the shell. */
 async function openJob(id){
  if(preparationStates.get(id)?.busy)return;
  const pending=preparationStates.get(id)||{};pending.busy=true;preparationStates.set(id,pending);remember();render();
  const current=find(id);let job=DONE.has(current?.status)?current:pending.job||current;
  try{
   if(pending.unknown){say('Checking saved preparation…');job=await reconcilePreparation(id,pending);if(!job)return;}
   if(!DONE.has(job?.status)&&!isPrepared(job)){
    say('Opening preparation… Choose tailoring and generate your résumé and cover letter in the application workspace.');
    try{await CareerJobActions.promote(id);}
    catch(error){
     pending.unknown=!error.status||error.status>=500;
     say(pending.unknown?'Could not confirm preparation. Press Check preparation before trying again.':error.message);return;
    }
    job=preparedJob(id,{...job,status:'promoted',favorite:true});CareerJobActions.announce(CareerStatusLine.move('preparing',job));
   }
   say('Opening application…');
   try{await CareerJobActions.openApplication(id,DONE.has(job?.status),undefined,{wait:true});}
   catch(error){say(error.message);}
  }finally{pending.busy=false;render();}
 }
 async function posting(id){const startedFit=fitRevision,dialog=document.createElement('dialog');dialog.className='ck-sheet edit-dialog';dialog.setAttribute('data-ds-sheet','');dialog.setAttribute('data-no-glass','');dialog.innerHTML='<header><b>Job posting and fit</b><button class="btn" type="button" data-close>Close posting</button></header><section class="ck-sheet-body" style="padding:20px" role="status">Loading posting…</section>';document.body.append(dialog);const openPosting=wireSheetBack(dialog,'boardPosting');dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.addEventListener('close',()=>dialog.remove());openPosting();
  try{const response=await fetch('/api/career-hunter/jobs/'+id,{cache:'no-store'});if(!response.ok)throw Error('Could not load this posting.');const {job:readJob}=await response.json(),finished=fitResults.get(id),job=finished&&finished.revision>startedFit?{...readJob,...finished.job}:readJob;dialog.querySelector('section').innerHTML=`<h1>${esc(job.title)}</h1><p class="muted">${esc(job.company)} · ${esc(job.location)}</p><p>${esc(pay(job))}</p><h2>Fit assessment</h2><div data-posting-fit="${id}">${postingFitMarkup(job)}</div><h2>Employer description</h2><div class="posting-text">${esc(job.description||'No description was provided.')}</div>${job.url?`<p><a class="btn" href="${esc(job.url)}" target="_blank" rel="noopener">Employer posting ↗</a></p>`:''}`;}catch(error){dialog.querySelector('section').textContent=error.message;}
 }
 document.addEventListener('click',async event=>{const el=event.target.closest('button');if(!el)return;
  if(el.hasAttribute('data-clear-filters')){$('clearFilters')?.click();return;}
  if(el.dataset.deckAct){void actDeck(el.dataset.deckAct);return;}
  if(el.dataset.reply){remember();CareerJobActions.openApplication(Number(el.dataset.reply),DONE.has(rows.find(j=>j.id===Number(el.dataset.reply))?.status));return;}
  if(el.dataset.application){remember();CareerJobActions.openApplication(Number(el.dataset.application),false);return;}
  if(el.dataset.removePick){void removePick(el,Number(el.dataset.removePick));return;}
  if(el.dataset.checkFit){void checkFit(Number(el.dataset.checkFit));return;}
  const id=Number(el.dataset.open||el.dataset.save||el.dataset.unstar||el.dataset.posting);
  if(el.dataset.posting){void posting(id);return;}
  if(el.dataset.page){if(busy)return;remember();if(el.dataset.page==='previous')page=Math.max(1,firstPage-1);else page+=1;void load(el.dataset.page==='more',el.dataset.page!=='more');return;}
  if(el.dataset.open){void openJob(id);return;}
  if(!el.dataset.save&&!el.dataset.unstar)return;if(el.dataset.save&&savingJobs.has(id))return;if(el.dataset.save)savingJobs.add(id);el.disabled=true;el.setAttribute('aria-busy','true');$('actionState').textContent='';
  try{remember();
   if(el.dataset.save){const result=await CareerJobActions.save(id);savingJobs.delete(id);el.removeAttribute('aria-busy');const job=find(id);rows=rows.map(j=>j.id===id?{...j,favorite:true}:j);render();moved(CareerStatusLine.move('saved',job)+(result.error?' Its fit could not be checked: '+result.error:''));}
   else{const job=find(id);await CareerJobActions.favorite(id,false);savingJobs.delete(id);el.removeAttribute('aria-busy');rows=rows.filter(j=>j.id!==id);render();moved(CareerStatusLine.move('unsaved',job)+' Its drafts and application records are kept.');}
  }catch(error){savingJobs.delete(id);$('actionState').textContent=error.message;el.disabled=false;el.removeAttribute('aria-busy');}
 });
 /**
  * @description Move one of Career's picks to Removed through the owner board writer; its application and native ticket history remain intact.
  * @param {HTMLButtonElement} button - The pressed button.
  * @param {number} id - The job.
  * @returns {Promise<void>}
  */
 async function removePick(button,id){
  if(removing.has(id))return;
  const job=find(id),rowIndex=rows.findIndex(j=>j.id===id),pickIndex=picked.findIndex(j=>j.id===id),actionEpoch=epoch;
  removing.add(id);rows=rows.filter(j=>j.id!==id);picked=picked.filter(j=>j.id!==id);render();say('Removing '+job.title+'…');
  try{
   const response=await fetch('/api/career-hunter/jobs/'+id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'dismissed',favorite:false})}),result=await response.json().catch(()=>({}));
   if(!response.ok||result.ok===false)throw Error(result.error||'HTTP '+response.status);
   moved(CareerStatusLine.move('removed',job));
  }catch(error){
   removing.delete(id);
   if(epoch===actionEpoch){if(rowIndex>=0&&!rows.some(j=>j.id===id))rows.splice(Math.min(rowIndex,rows.length),0,job);if(pickIndex>=0&&!picked.some(j=>j.id===id))picked.splice(Math.min(pickIndex,picked.length),0,job);render();}
   else void load();
   say('Could not remove this job: '+error.message+'. Try again.');
  }
 }
 void resumeAnswer.then(()=>{
  if(recommended&&(noResume()||readingResume())){
   controller?.abort();epoch+=1;busy=false;rows=[];renderWithoutResume();$('list').setAttribute('aria-busy','false');
  }else if(rows.length&&!busy)render();
 });
 if(stage==='saved'&&window.CareerStages?.picks)void CareerStages.picks().then(jobs=>{picked=jobs;picksRead=true;if(!firstLoad&&!busy){render();showCount();}landOnPicks();});
 if(APPLICATIONS.has(stage))void readSending();
 function refilter(){page=1;void load();}let typing;$('q').oninput=()=>{clearTimeout(typing);typing=setTimeout(refilter,250);};$('keywordSearch').onsubmit=event=>{event.preventDefault();clearTimeout(typing);refilter();};fields.filter(key=>key!=='q').forEach(key=>$(key).onchange=refilter);
 $('showEarlier').onclick=()=>{earlier=true;page=1;refilter();};window.addEventListener('pagehide',()=>{remember();for(const check of fitChecks.values())check.stop?.();fitChecks.clear();render();});
 void CareerNavigation.refreshCounts().then(data=>{if(stage==='queue'&&data?.earlierPreparation){$('earlier').hidden=false;$('earlierCount').textContent='('+data.earlierPreparation+')';}});
 (async()=>{try{const response=await fetch('/api/auth/user',{signal:AbortSignal.timeout(2000)}),identity=await response.json();if(response.ok&&identity.authenticated&&identity.tenant&&identity.principal_id){memoryKey='career-journey:'+identity.tenant+':'+identity.principal_id+':'+stage;const stored=JSON.parse(sessionStorage.getItem(memoryKey)||'null');const explicit=fromApprove||fields.some(key=>query.has(key))||query.has('page');if(stored&&!explicit){for(const key of fields)if(stored.filters?.[key]!=null&&(key!=='sort'||stored.sortChosen===true))$(key).value=stored.filters[key];sortChosen=stored.sortChosen===true;page=stored.page||1;returnY=stored.scrollY||0;earlier=stored.earlier===true;}}}catch{/* URL and current session still work without persistent preferences. */}
  for(const key of fields)if(query.has(key))$(key).value=query.get(key);if(query.has('page'))page=Math.max(1,Number(query.get('page'))||1);if(![25,50,100,200].includes(Number($('per').value)))$('per').value='50';firstPage=page;void load();})();
})();
