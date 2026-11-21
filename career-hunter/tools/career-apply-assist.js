/** CHANGE LOG
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-I: the approval screen says How Career fills it in, one sentence each for Typing, Window and Submit as the person set them in Saved answers (packet flagLines), and its last line is Career presses Submit once when he chose Submit after I approve. The job page says Submitted by Career after your approval when Career pressed Submit, what the run said when it was ready (why Career did not press Submit), and for Not seen yet after Career's own press, its words.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0: the packet's Word file is the parse résumé, so the approval screen calls it Résumé for upload forms (Word) and says Career uploads the résumé for upload forms (Word).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.71.0 (lane APPLY-G): under Site the approval screen says how the form is filled: where a company page's embedded engine form really opens, and for an employer site Career has no rules for, that Career types his record only into fields whose words say exactly what they are, asks him the rest, moves pages only with Next or Continue and stops before any button that sends the application.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: the approval screen says each Attestations switch in words under What Career does in your name (ticks the terms box for you / you tick it yourself; signs the self-identification form with your name and today's date / you sign it yourself).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: a run approved but not started on the computer (its start was refused) reads Not started yet with Go on, instead of Opening the form forever.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome, design APPLY-ORBIT 5.1): what Step 3 · Send shows of an assisted application. Fill it in on my Chrome is offered when the person's Job Apply device (the one they chose, else their only connected Open Swarm Orbit computer that can) reports the feature browser-apply. Its approval screen lists the exact files with their versions and which one is uploaded, the facts Career may type, the jobs on this résumé with their dates (a year alone says Career asks for the months), education, the saved answers Career may use, the site, the computer and the stop at Review, then Approve and start. A run reads as one line each: Opening the form, Waiting for you to sign in, Uploading your résumé, My Information: 3 fixed, Needs your answer (the kernel's question card inline, read from GET /api/apply/cards in the person's own session: the card's exact words, its options or a text box, Keep this answer for next time, Answer and I'll answer it on the page; what he kept is handed to Career's POST /apply-runs/:id/kept), Ready for you to submit, Submitted by you, Not seen yet, Paused (Go on), Stopped (why); Stop ends it through the kernel's own ticket cancel.
 */
(()=>{'use strict';
 const API='/api/career-hunter',MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 /** The states that are still moving, so the page reads them again. */
 const POLLING=new Set(['queued','running','waiting','ready']);
 /** The states that keep a job's Send step on the run instead of the ways to send. */
 const SHOWN=new Set(['approved','queued','running','waiting','ready','paused','failed','not_seen']);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const btn=(text,action,primary=false)=>`<button type="button" class="btn${primary?' primary':''}" data-action="${action}">${text}</button>`;
 /**
  * @description Whether Fill it in on my Chrome can run, and on which computer: the person's chosen Job Apply device when they
  * chose one, else their only connected Orbit computer, and only when it reports browser-apply.
  * @param {object|null} availability CareerSubmit.workers(). @returns {{ready:boolean,name:string}}
  */
 function device(availability){
  const orbits=(availability?.workers||[]).filter(w=>w.kind==='orbit'),can=w=>!!w&&w.available===true&&Array.isArray(w.features)&&w.features.includes('browser-apply');
  if(availability?.selectionConfigured){const chosen=orbits.find(w=>String(w.id||w.clientId)===String(availability.selectedDeviceId));return can(chosen)?{ready:true,name:chosen.hostname||'Your computer'}:{ready:false,name:''};}
  const offered=orbits.filter(can);return offered.length===1?{ready:true,name:offered[0].hostname||'Your computer'}:{ready:false,name:''};
 }
 /** @description The first way to send, when it can run. @param {object|null} availability @returns {string} Markup, or ''. */
 function offer(availability){
  const chosen=device(availability);if(!chosen.ready)return '';
  return `<section class="send-assist" id="sendAssist" aria-labelledby="sendAssistTitle"><h3 id="sendAssistTitle">Fill it in on my Chrome</h3><p>Career opens the employer’s form in your Chrome, uploads this job’s résumé, fixes what the site read wrong, and stops at Review. You press Submit.</p><p class="hint">On <b>${esc(chosen.name)}</b></p><div class="actions">${btn('Fill it in on my Chrome','assist',true)}</div></section>`;
 }
 /** @description A recorded date as words: 2019-04 is Apr 2019, a year stays a year. @param {string|null} value @returns {string} */
 function date(value){const found=/^(\d{4})(?:-(\d{2}))?$/.exec(String(value||''));return found?(found[2]?MONTHS[Number(found[2])-1]+' '+found[1]:found[1]):'';}
 function span(item){
  const start=date(item.start),end=item.end===null&&item.start?'Present':date(item.end),yearOnly=/^\d{4}$/.test(item.start||'')||/^\d{4}$/.test(item.end||'');
  return [start&&end?start+' to '+end:start||end||'No dates recorded',yearOnly?'Career asks you for the months':''].filter(Boolean).join(' · ');
 }
 const DOCUMENT={'resume-docx':'Résumé for upload forms (Word)','resume-pdf':'Résumé (PDF)','cover-pdf':'Cover letter (PDF)'};
 function lists(packet){
  const roles=packet.roles.map(item=>`<li><b>${esc(item.title)}</b> · ${esc(item.employer)} · ${esc(span(item))}</li>`).join('');
  const schools=packet.education.map(item=>`<li>${esc([item.degree,item.field].filter(Boolean).join(', '))}${item.school?' · '+esc(item.school):''}${item.end?' · '+esc(item.start?item.start+' to '+item.end:item.end):''}</li>`).join('');
  const answers=packet.answers.length?`<ul class="assist-answers">${packet.answers.map(item=>`<li>${esc(item.text)} <b>${esc(item.value)}</b></li>`).join('')}</ul>`
   :'<p class="hint">None yet. A question nothing you recorded answers comes to you as a card.</p>';
  return `<h3>Your jobs on this résumé</h3><ul class="assist-roles">${roles||'<li>None</li>'}</ul><h3>Education</h3><ul class="assist-schools">${schools||'<li>None recorded</li>'}</ul><h3>Saved answers Career may use</h3>${answers}<p><a href="${API}/saved-answers-ui" data-career-tool="career-settings">Saved answers</a></p>`;
 }
 /**
  * @description The approval screen of one exact packet. @param {object} packet GET /apply-review/:postingId. @param {object|null} availability
  * @returns {string} Markup.
  */
 function review(packet,availability){
  const chosen=device(availability),word=packet.uploads==='docx'?'the résumé for upload forms (Word)':'the PDF résumé';
  const files=packet.documents.map(doc=>`${esc(DOCUMENT[doc.id]||doc.name)} · version ${esc(doc.sha256.slice(0,10))}`).join('<br>');
  const facts=packet.facts.map(fact=>`<dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd>`).join('');
  return `<h2>Approve Career filling in this form</h2><p class="muted">Career opens ${esc(packet.host)} in a Chrome window of its own${chosen.ready?' on <b>'+esc(chosen.name)+'</b>':''}, uploads ${word}, and fixes and fills the form only with what you approve here.</p><dl class="facts"><dt>Employer</dt><dd>${esc(packet.company)}</dd><dt>Position</dt><dd>${esc(packet.title)}</dd><dt>Site</dt><dd>${esc(packet.site.name)} · <a href="${esc(packet.url)}" target="_blank" rel="noopener">${esc(packet.host)}</a>${(packet.mode||[]).map(line=>`<br><span class="hint" data-assist-mode>${esc(line)}</span>`).join('')}</dd><dt>Files</dt><dd>${files}<br><span class="hint">Career uploads ${word}.</span></dd><dt>Your computer</dt><dd>${chosen.ready?esc(chosen.name)+' (ready)':'Not connected'}</dd></dl><h3>What Career may type</h3><dl class="facts" id="assistFacts">${facts}</dl>${lists(packet)}<h3>What Career does in your name</h3><ul id="assistAttest">${(packet.attestLines||[]).map(line=>`<li>${esc(line)}</li>`).join('')}</ul><p class="hint">Change these under Saved answers, Attestations.</p><h3>How Career fills it in</h3><ul id="assistFlags">${(packet.flagLines||[]).map(line=>`<li>${esc(line)}</li>`).join('')}</ul><p class="hint">Change these under Saved answers, How Career fills in a form.</p><div class="notice" id="assistStop"><b>${esc(packet.stop)}</b><p>Career types no password and no code. When the site asks you to sign in, Career waits for you in that window. A question nothing you recorded answers comes to you as a card.</p></div><footer class="footer">${btn('← Other ways to send','send')}${chosen.ready?btn('Approve and start','assist-approve',true):btn('Check again','assist')}</footer>`;
 }
 /**
  * @description One waiting question card (lane D's view), answered here: its exact words, the page's options or a text
  * box, Keep this answer for next time, Answer, and I'll answer it on the page. @param {object} view @returns {string} Markup.
  */
 function cardView(view){
  const ask=view.ask||{},options=Array.isArray(ask.options)?ask.options:[],id=esc(view.id);
  const input=options.length?`<fieldset class="assist-options"><legend>${esc(ask.question)}</legend>${options.map((option,index)=>`<label class="choice"><input type="radio" name="assist-option-${id}" value="${index}"><span>${esc(option)}</span></label>`).join('')}</fieldset>`
   :`<label>${esc(ask.question)}<textarea data-card-answer rows="2" maxlength="4000"></textarea></label>`;
  return `<div class="notice assist-card" data-card="${id}" role="group" aria-label="Needs your answer"><p><b>Needs your answer</b></p><p class="assist-question">${esc(view.cardText||ask.question)}</p>${input}<label class="choice"><input type="checkbox" data-card-keep><span>${esc(ask.keep||'Keep this answer for next time')}</span></label><div class="actions"><button type="button" class="btn primary" data-action="assist-answer" data-card="${id}">Answer</button><button type="button" class="btn" data-action="assist-on-page" data-card="${id}">${esc(ask.onPage||'I’ll answer it on the page')}</button></div></div>`;
 }
 const HEADING={approved:'Not started yet',queued:'Opening the form',running:'Career is filling in the form',ready:'Ready for you to submit',
  submitted:'Submitted by you',not_seen:'Not seen yet',paused:'Paused',failed:'Your computer stopped',stopped:'Stopped'};
 /**
  * @description One run's state on the job page, one line each, with the next thing the person can do.
  * @param {object} run GET /apply-runs (publicRun). @param {object[]} [cards] Its waiting question cards. @returns {string} Markup.
  */
 function state(run,cards=[]){
  const live=run.live||{},byCareer=run.status==='submitted'&&run.submittedBy==='career';
  const heading=run.status==='waiting'?live.line||'Waiting for you':byCareer?'Submitted by Career after your approval':HEADING[run.status]||run.status;
  const line=run.status==='ready'?live.ready||'Ready: check it and press Submit in the Chrome window.':run.status==='running'||run.status==='queued'?live.line
   :run.status==='approved'?'Career has not started on your computer yet. Press Go on to start it.':run.status==='waiting'?live.reason?.text:run.status==='submitted'?'The employer’s confirmation was seen.'
   :run.status==='not_seen'?(run.pressedByCareer?run.reason:'Mark it applied when you have.'):run.reason;
  const pages=live.pages?.length?`<ul class="assist-pages">${live.pages.map(page=>`<li>${esc(page)}</li>`).join('')}</ul>`:'';
  const moving=['approved','queued','running','waiting','ready'].includes(run.status);
  const actions=[moving?btn('Stop','assist-stop'):'',['approved','paused','failed'].includes(run.status)&&!run.expired?btn('Go on','assist-go-on',true):'',run.status==='not_seen'?btn('I applied','applied',true):'',
   ['stopped','failed','not_seen'].includes(run.status)||run.expired?btn('← Other ways to send','assist-other'):''].join('');
  const picture=run.status==='submitted'&&run.confirmationFile?`<figure><img style="max-width:100%" src="${API}/apply-runs/${encodeURIComponent(run.id)}/confirmation" alt="The employer’s confirmation"><figcaption>The employer’s confirmation, kept by Career.</figcaption></figure>`:'';
  return `<section class="assist-run" id="assistRun" aria-live="polite"><h2 id="assistState">${esc(heading)}</h2>${line?`<p id="assistLine">${esc(line)}</p>`:''}${pages}${cards.map(cardView).join('')}${picture}<div class="actions">${actions}</div><div id="applyReceiptHost"></div></section>`;
 }
 async function request(path,body){return window.CareerSubmit.request(path,body);}
 /** @description The job's latest run, or null. @param {number} postingId @returns {Promise<object|null>} */
 async function latest(postingId){return ((await request('/apply-runs?postingId='+encodeURIComponent(postingId))).runs||[])[0]||null;}
 /** @description Approve this exact packet, bind its ticket and start it; each write is safe to repeat. @returns {Promise<object>} The run. */
 async function approve(postingId,packetDigest){
  const approved=await request('/apply-runs',{postingId,packetDigest,approved:true});
  await request('/apply-runs/'+approved.run.id+'/bind',{});return (await request('/apply-runs/'+approved.run.id+'/start',{})).run;
 }
 const sync=id=>request('/apply-runs/'+encodeURIComponent(id)+'/sync',{}).then(answer=>answer.run);
 const goOn=id=>request('/apply-runs/'+encodeURIComponent(id)+'/go-on',{}).then(answer=>answer.run);
 /** @description This run's waiting cards and kept answers from the kernel's card route, in the person's own session. @param {string} runId @returns {Promise<{cards:object[],kept:object[]}>} */
 async function cards(runId){
  const response=await fetch('/api/apply/cards?run='+encodeURIComponent(runId),{cache:'no-store'});if(!response.ok)throw Error('Question cards unavailable (HTTP '+response.status+').');
  const data=await response.json();return {cards:(Array.isArray(data.cards)?data.cards:[]).filter(card=>card.run===runId),kept:(Array.isArray(data.kept)?data.kept:[]).filter(item=>item.run===runId).slice(0,100)};
 }
 /** @description Hand Career what the person kept, so it writes Saved answers and months. @returns {Promise<object>} The run. */
 const keep=(runId,kept)=>request('/apply-runs/'+encodeURIComponent(runId)+'/kept',{kept}).then(answer=>answer.run);
 async function press(id,path,body){
  const response=await fetch('/api/apply/cards/'+encodeURIComponent(id)+path,{method:'POST',headers:{'Content-Type':'application/json','X-OSHAL-Apply-Card':'1'},body:JSON.stringify(body),cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(response.status===404?'This question was already answered or has closed.':data.error||'Your answer was not taken (HTTP '+response.status+').');
  return data;
 }
 /**
  * @description Send the answer given on one card: the chosen option's place, or the typed words, and Keep.
  * @param {Element} box The card's element. @returns {Promise<string>} What the kernel said.
  */
 async function answer(box){
  const id=box.dataset.card,chosen=box.querySelector('input[type=radio]:checked'),typed=box.querySelector('[data-card-answer]'),keep=!!box.querySelector('[data-card-keep]')?.checked;
  if(box.querySelector('input[type=radio]')&&!chosen)throw Error('Choose an answer first.');
  if(typed&&!typed.value.trim()){typed.focus();throw Error('Type your answer first.');}
  const said=await press(id,'/answer',chosen?{option:Number(chosen.value),keep}:{answer:typed.value.trim(),keep});return said?.result?.said||'Answered.';
 }
 /** @description I'll answer it on the page. @param {string} id The card. @returns {Promise<string>} What the kernel said. */
 const onPage=id=>press(id,'/on-page',{}).then(said=>said?.result?.said||'Answer it on the page in the Chrome window Career opened.');
 /** @description Stop: the kernel's own cancel of the run's ticket, confirmed, then read back. @param {object} run @returns {Promise<object>} */
 async function stop(run){
  if(!run.nativeTicketId)throw Error('This application has not started on your computer.');
  const confirmation=await fetch('/confirmations',{method:'POST'}),token=await confirmation.json().catch(()=>({}));
  if(!confirmation.ok||!token.confirmation)throw Error('Career could not confirm stopping. Close the Chrome window Career opened; nothing is submitted without your press.');
  const cancelled=await fetch('/tickets/'+encodeURIComponent(run.nativeTicketId)+'/cancel',{method:'POST',headers:{'x-oshal-confirm':token.confirmation}});
  if(!cancelled.ok)throw Error('Career could not stop this run. Close the Chrome window Career opened; nothing is submitted without your press.');
  return sync(run.id);
 }
 window.CareerApplyAssist={POLLING,SHOWN,device,offer,review,state,latest,approve,sync,goOn,stop,cards,keep,answer,onPage};
})();
