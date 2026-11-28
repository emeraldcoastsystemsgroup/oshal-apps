/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.77.6 (the owner, 2026-11-27: "for any aplication that doesnt submit correctly have a new tab that listas the failed aplications and what went wrong"): Didn't go through, the tab of My jobs after Getting ready. It reads GET /didnt-go-through (the person's own list, newest first, one row per job) and draws each job: its title (a link to the job's own page), company, the employer's site, when it ended, What went wrong in Career's own words and What to do next with the button the pages already have for it. Go on is the job page's Go on (POST /apply-runs/:id/go-on), refused while Career's records say another job is being filled in on the person's computer (the list's onComputer, the fill-in queue's job among them), and then opens the job's page to follow it; Approve again is the fill-in queue's own approval sheet for that one job (CareerApplyBatch.confirm); Open the job opens its page. The stage row's count is this list's count.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Career 1.79.0, Answers to review: when questions only the person can answer hold up their jobs (tools/career-answers-review.js read), the list opens with Answers to review and its count, saying how many questions hold up how many jobs; a job that waits on one leads with Answer the question (a 44px link to that page) and says what to do in those words, its other buttons beside it. With none, the tab is as it was.
 */
(()=>{'use strict';
 const API='/api/career-hunter',BOARD=API+'/board-native',FRESH_MS=3000,REVIEW=API+'/answers-to-review-ui';
 const BUTTON={'go-on':'Go on','approve-again':'Approve again'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let reading=null,last=null;
 /**
  * @description Read the person's list: one read at a time, and a read from the last few seconds is shared.
  * @param {{fresh?:boolean}} [options] fresh: read again now. @returns {Promise<{count:number,items:object[],unread:string[]}>}
  */
 function read({fresh=false}={}){
  if(!fresh&&last&&Date.now()-last.at<FRESH_MS)return Promise.resolve(last.data);
  if(reading)return reading;
  reading=fetch(API+'/didnt-go-through',{cache:'no-store'}).then(async response=>{
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Career could not read this list (HTTP '+response.status+').');
   last={at:Date.now(),data};return data;
  }).finally(()=>{reading=null;});
  return reading;
 }
 /** @description How many jobs did not go through, for the stage row; null when it could not be read. @returns {Promise<number|null>} */
 async function count(){try{const data=await read();return Number.isSafeInteger(data?.count)?data.count:null;}catch{return null;}}
 /** @description The job's own page in Career. @param {number} id @returns {string} */
 const jobHref=id=>BOARD+'?view=queue&application='+encodeURIComponent(id);
 /** @description When an attempt ended, as a person reads it: "Nov 27, 3:42 PM". @param {string} iso @returns {string} */
 function when(iso){const at=new Date(iso);return Number.isNaN(at.getTime())?'':at.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
 /**
  * @description One job's row: title (to its page), company, site, when it ended, what went wrong, what to do next and its buttons.
  * The one filled button is the next thing to do: Go on, Approve again, or Open the job when that is the way.
  * A job that waits on a question only the person can answer leads with Answer the question instead.
  * @param {object} item An item of GET /didnt-go-through. @param {string[]} [asked] The questions this job waits on. @returns {string} Markup.
  */
 function row(item,asked=[]){
  const id=Number(item.postingId),place=[item.site,item.host].filter(Boolean).join(' · '),at=when(item.endedAt),name=`${item.title||'this job'} at ${item.company||'this employer'}`,ask=asked.length>0;
  const answer=ask?`<a class="btn primary" href="${REVIEW}" data-dg-review="${id}">Answer the question</a>`:'';
  const main=BUTTON[item.action]?`<button type="button" class="btn${ask?'':' primary'}" data-dg-act="${esc(item.action)}" data-dg-job="${id}">${BUTTON[item.action]}</button>`:'';
  const open=`<a class="btn${item.action==='open'&&!ask?' primary':''}" href="${jobHref(id)}" data-career-tool="career-submissions" aria-label="Open the job: ${esc(name)}">Open the job</a>`;
  const next=ask?`Answer “${asked[0]}”${asked.length>1?` and ${asked.length-1} more`:''} on Answers to review: Career keeps your answer and puts this job back in Fill in several by itself.`:item.next;
  return `<article class="job-row dg-row" data-job-id="dg-${id}" data-dg-row="${id}" data-dg-from="${esc(item.from)}"><div class="summary">`
   +`<a class="job-title dg-title" href="${jobHref(id)}" data-career-tool="career-submissions">${esc(item.title||'Application')}</a><p class="job-company muted">${esc(item.company)}</p>`
   +`<div class="meta">${place?`<span class="dg-site">${esc(place)}</span>`:''}${at?`<span>Ended <time datetime="${esc(item.endedAt)}">${esc(at)}</time></span>`:''}</div>`
   +`<p class="dg-what"><b>What went wrong</b>${esc(item.what)}</p>${next?`<p class="dg-next"><b>What to do next</b>${esc(next)}</p>`:''}`
   +`</div><div class="row-actions">${answer}${main}${open}</div></article>`;
 }
 /**
  * @description The entry to Answers to review, with its count, when questions only the person can answer hold up jobs.
  * @param {object|null} review GET /answers-to-review, or null. @returns {string} Markup, or ''.
  */
 function reviewEntry(review){
  const n=Number(review?.count)||0,jobs=Number(review?.jobs)||0;if(n<1)return '';
  return `<div class="dg-review" role="note"><a class="dg-review-link" href="${REVIEW}">Answers to review <span class="dg-review-n" aria-label="${n} waiting">${n}</span></a>`
   +`<p>${n===1?'One question':n+' questions'} only you can answer ${n===1?'holds':'hold'} up ${jobs===1?'one job':jobs+' jobs'}. Approve each answer once and the jobs go back in Fill in several by themselves.</p></div>`;
 }
 /** @description The questions only the person can answer, by the job waiting on each; none when that page is not loaded. @returns {Promise<object|null>} */
 async function questions(fresh){try{return window.CareerAnswersReview?await CareerAnswersReview.read({fresh}):null;}catch{return null;}}
 /** @description The questions one job waits on. @param {object|null} review @param {number} id @returns {string[]} */
 const askedOf=(review,id)=>[...(review?.written||[]),...(review?.plain||[])].filter(question=>(question.jobs||[]).some(job=>Number(job.postingId)===id)).map(question=>question.text);
 const EMPTY='<div class="ck-empty dg-empty"><h2>Nothing to fix</h2><p>When Career tries to apply to a job and it is not submitted, the job is listed here with what went wrong and what to do next.</p>'
  +`<a class="ck-primary" href="${BOARD}?view=queue" data-career-tool="career-submissions">Open Getting ready</a></div>`;
 const SOURCES={runs:'your applications filled in on your Chrome',queue:'your fill-in queue',documents:'Generate again'};
 /**
  * @description Draw the person's list into `host` and answer its buttons. @param {Element} host The list.
  * @param {{status:Element,say:Function,onCount?:Function}} options The page's request line, its status line, and who
  * hears the count after each read. @returns {{refresh:Function}}
  */
 function mount(host,options){
  const status=options.status,say=options.say||(()=>{});let items=[],pressing=false,review=null;
  const line=text=>{if(status)status.textContent=text;};
  function failed(error){
   if(!status)return;status.replaceChildren(document.createTextNode(error.message+' '));
   const again=document.createElement('button');again.type='button';again.className='btn';again.textContent='Try again';again.onclick=()=>void refresh(true);status.append(again);
  }
  function draw(data){
   const unread=(data.unread||[]).map(name=>SOURCES[name]).filter(Boolean);
   const note=unread.length?`<p class="dg-unread" role="note">Career could not read ${esc(unread.join(' or '))} just now, so a job may be missing from this list. Try again in a moment.</p>`:'';
   host.innerHTML=note+reviewEntry(review)+(items.length?items.map(item=>row(item,askedOf(review,Number(item.postingId)))).join(''):EMPTY);
   line(items.length?`${items.length} shown · newest first`:'');
  }
  /** @description Read the list again and draw it. @param {boolean} [fresh] @returns {Promise<void>} */
  async function refresh(fresh=false){
   if(!items.length)line('Reading what did not go through…');host.setAttribute('aria-busy','true');
   try{const [data,asked]=await Promise.all([read({fresh}),questions(fresh)]);review=asked;items=Array.isArray(data.items)?data.items:[];draw(data);options.onCount?.(items.length);}
   catch(error){failed(error);}
   finally{host.setAttribute('aria-busy','false');}
  }
  /** One application on the computer at a time: Go on waits while another job is being filled in there, as the fill-in queue waits for a run started here. */
  async function goOn(item){
   const data=await read({fresh:true}),other=(data.onComputer||[]).find(one=>Number(one.postingId)!==Number(item.postingId));
   if(other){say(`Career is filling in ${other.company||'another job'} on your computer now. Press Go on again when it has ended.`);return;}
   say(`Going on with ${item.company||'this job'}…`);
   await CareerApplyAssist.goOn(item.runId);
   CareerJobActions.announce(`Going on: ${item.title||'this job'} at ${item.company||'this employer'}.`);CareerJobActions.openApplication(item.postingId,false);
  }
  /** Approve again: the fill-in queue's own approval sheet for this one job; it reads the job's packet as it is now. */
  async function approveAgain(item){
   const job={id:item.postingId,company:item.company,title:item.title,...item.job};
   const queue=await CareerApplyBatch.confirm([job],{say});
   if(queue)await refresh(true);
  }
  host.addEventListener('click',event=>{
   const button=event.target.closest?.('button[data-dg-act]');if(!button||pressing)return;
   const item=items.find(one=>Number(one.postingId)===Number(button.dataset.dgJob));if(!item)return;
   pressing=true;button.disabled=true;button.setAttribute('aria-busy','true');
   (button.dataset.dgAct==='go-on'?goOn(item):approveAgain(item)).catch(error=>say(error.message))
    .finally(()=>{pressing=false;if(button.isConnected){button.disabled=false;button.removeAttribute('aria-busy');}});
  });
  void refresh();
  return {refresh:()=>refresh(true),items:()=>items};
 }
 window.CareerDidntGoThrough={read,count,row,mount,jobHref,reviewEntry};
})();
