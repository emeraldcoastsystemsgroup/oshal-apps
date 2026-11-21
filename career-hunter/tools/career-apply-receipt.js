/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome, design APPLY-ORBIT 5.2): the receipt of an assisted application as a person reads it, on the job page and in Submission activity: the files Career uploaded (name, where, version), every change on each page (the field, its group, what the site had, what Career entered and where that came from: your record, a saved answer, your answer on the card, chosen by the model, the decline wording, today's date), the questions and how each was answered, when Career handed the form to you, the pictures it kept, and how it ended. Read from GET /apply-runs/:id/receipt; pictures from /picture/:attempt/:n, each checked against its digest by the route.
 */
(()=>{'use strict';
 const API='/api/career-hunter';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ENDED={submitted_by_you:'Submitted by you; the employer’s confirmation was seen',not_seen:'Ready at Review; Career did not see the employer’s confirmation',paused:'Paused',stopped:'Stopped'};
 const FIELDS={title:'job title',employer:'employer',start:'start',end:'end',current:'currently works here',description:'description',school:'school',degree:'degree',field:'field of study'};
 const DOCUMENTS={'resume-docx':'this job’s Word résumé','resume-pdf':'this job’s PDF résumé','cover-pdf':'this job’s cover letter'};
 const REASONS={'sign-in':'Sign in','code':'Enter the code','check':'Solve the check','question':'Answer a question','field':'Set a field','errors':'Fix what the site marked','off-site':'On another site'};
 /**
  * @description Where a value Career entered came from, in words: "your record: role 2 start", "saved answer", "your answer on the card", "chosen by the model".
  * @param {string} from The kernel's source mark. @returns {string} The words.
  */
 function source(from){
  const text=String(from||''),[kind,rest='']=text.split(/:(.*)/s);
  if(kind==='fact')return 'your record: '+rest.replace(/\./g,' ');
  if(kind==='role'||kind==='education'){const [n,field]=rest.split('.');return 'your record: '+(kind==='role'?'role ':'school ')+n+(field?' '+(FIELDS[field]||field):'');}
  if(kind==='answer')return 'saved answer';if(kind==='card')return 'your answer on the card';if(kind==='model')return 'chosen by the model'+(rest?': '+rest:'');
  if(kind==='decline')return 'the site’s decline wording';if(kind==='today')return 'today’s date';if(kind==='document')return DOCUMENTS[rest]||'a document you approved';
  return text||'not recorded';
 }
 const when=value=>{const at=Date.parse(value);return Number.isFinite(at)?new Date(at).toLocaleString():'';};
 function uploads(attempt){
  if(!attempt.uploads?.length)return '<p class="hint">No file was uploaded in this attempt.</p>';
  return `<ul class="receipt-uploads">${attempt.uploads.map(item=>`<li><b>${esc(item.name)}</b> · ${esc(DOCUMENTS[item.document]||item.document)} · ${esc(item.page||item.field)}${item.sha256?` · version ${esc(item.sha256.slice(0,10))}`:''}</li>`).join('')}</ul>`;
 }
 function changes(attempt){
  if(!attempt.changes?.length)return '<p class="hint">Career changed no field in this attempt.</p>';
  const pages=[...new Set(attempt.changes.map(item=>item.page||'The form'))];
  return pages.map(page=>`<h4>${esc(page)}</h4><ul class="receipt-changes">${attempt.changes.filter(item=>(item.page||'The form')===page).map(item=>`<li><b>${esc(item.label)}</b>${item.group?` <span class="hint">(${esc(item.group)})</span>`:''}: ${item.before?`“${esc(item.before)}” → `:''}“${esc(item.after)}” <span class="hint">· ${esc(source(item.from))}</span></li>`).join('')}</ul>`).join('');
 }
 function questions(attempt){
  if(!attempt.questions?.length)return '';
  return `<h4>Questions</h4><ul class="receipt-questions">${attempt.questions.map(item=>`<li>${esc(item.text)} <b>${esc(item.answer)}</b> <span class="hint">· ${esc(item.from)}</span></li>`).join('')}</ul>`;
 }
 function handBacks(attempt){
  if(!attempt.handBacks?.length)return '';
  return `<h4>Handed to you</h4><ul class="receipt-handbacks">${attempt.handBacks.map(item=>`<li>${esc(REASONS[item.reason]||item.reason)}: ${esc(item.text)} <span class="hint">${esc(when(item.at))}${item.endedAt?' to '+esc(when(item.endedAt)):''}</span></li>`).join('')}</ul>`;
 }
 function pictures(runId,attempt){
  if(!attempt.pictures?.length)return '';
  return `<h4>Pictures</h4><div class="receipt-pictures">${attempt.pictures.map((item,index)=>`<figure><img loading="lazy" style="max-width:100%" src="${API}/apply-runs/${encodeURIComponent(runId)}/picture/${attempt.n}/${index+1}" alt="${esc(item.page||'Employer form')} as Career left it"><figcaption>${esc(item.page||'Employer form')} · version ${esc(String(item.sha256||'').slice(0,10))}</figcaption></figure>`).join('')}</div>`;
 }
 /**
  * @description The receipt, every attempt in order. @param {object} receipt GET /apply-runs/:id/receipt. @returns {string} Markup.
  */
 function render(receipt){
  const attempts=Array.isArray(receipt?.attempts)?receipt.attempts:[];
  if(!attempts.length)return '<p class="hint">Nothing is recorded for this application yet.</p>';
  return `<section class="apply-receipt" id="applyReceipt" aria-labelledby="applyReceiptTitle"><h3 id="applyReceiptTitle">What Career did on the employer’s form</h3>${attempts.map(attempt=>`<details class="receipt-attempt"${attempt===attempts.at(-1)?' open':''}><summary>${attempts.length>1?'Attempt '+esc(attempt.n)+' · ':''}${esc(ENDED[attempt.outcome]||attempt.outcome)}${attempt.endedAt?' · '+esc(when(attempt.endedAt)):''}</summary>${attempt.reason?`<p>${esc(attempt.reason)}</p>`:''}<h4>Files uploaded</h4>${uploads(attempt)}${changes(attempt)}${questions(attempt)}${handBacks(attempt)}${pictures(receipt.runId,attempt)}</details>`).join('')}</section>`;
 }
 /**
  * @description Read one run's receipt and draw it into `host`; a run with nothing recorded yet draws nothing.
  * @param {string} runId The run. @param {Element} host Where it goes. @returns {Promise<void>}
  */
 async function mount(runId,host){
  if(!host)return;
  try{const response=await fetch(API+'/apply-runs/'+encodeURIComponent(runId)+'/receipt',{cache:'no-store'});if(response.status===404){host.innerHTML='';return;}
   if(!response.ok)throw Error('HTTP '+response.status);host.innerHTML=render(await response.json());}
  catch(error){console.error('career: the application receipt could not be read',error);host.innerHTML='<p class="hint" role="status">The record of what Career did could not be read just now.</p>';}
 }
 window.CareerApplyReceipt={render,mount,source};
})();
