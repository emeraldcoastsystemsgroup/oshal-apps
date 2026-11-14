/** CHANGE LOG
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Execute four individually permitted, distinct form steps with fixed per-press pictures and conservative outcomes.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Recognize accented résumé document labels without changing applicant-fact matching; name the actual permitted step in uncertain outcomes.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Consume the one-use permit before any employer button; hold Continue/Apply outcomes without a second press.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prefer the approved résumé for combined upload fields and count only the verified document actually attached.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Compose worker network guards and preserve an unknown outcome when the final-action acknowledgement is lost.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fill approved application facts with semantic browser controls, verify packet bytes and retain conservative final-submit evidence without per-field vision turns.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {FIELD_DEFINITIONS} = require('./autofill-bookmarklet');
const queue = require('./career-submission-queue');
const normalized = value => String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const documentWords = value => normalized(String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,''));
const compact = value => normalized(value).replace(/ /g,'');
const CONFIRMATION = /(?:thank you for (?:applying|your application)|your application (?:has been|was) (?:successfully )?(?:submitted|received)|we (?:have |have successfully )?received your application|application submitted successfully)/i;
const NEVER_ANSWER = /(?:reference|referee|emergency contact|supervisor|manager(?:'s)? email|password|one time|verification code|social security|national insurance|bank account)/i;
class NeedsYou extends Error { constructor(reason,questions=[]) {super(reason);this.name='NeedsYou';this.questions=questions;} }

/** The DOM is data. No site text is ever evaluated as instructions or executable code. */
async function controls(page) {
  return page.locator('input,textarea,select').evaluateAll(elements=>elements.map((e,index)=>({
    index,tag:e.tagName.toLowerCase(),type:String(e.type||'').toLowerCase(),id:e.id,name:e.name,
    label:[...e.labels||[]].map(l=>l.innerText||l.textContent||'').join(' ').trim(),
    aria:e.getAttribute('aria-label')||'',legend:e.closest('fieldset')?.querySelector('legend')?.innerText||'',
    formIndex:e.form?[...document.forms].indexOf(e.form):-1,formAction:e.form?.action||location.href,
    autocomplete:e.autocomplete||'',required:e.required||e.getAttribute('aria-required')==='true',
    visible:!!(e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'),disabled:e.disabled,
    value:e.value||'',checked:!!e.checked,valid:e.validity?e.validity.valid:true,
    accept:e.accept||'',options:e.tagName==='SELECT'?[...e.options].map(o=>({label:o.label,value:o.value,disabled:o.disabled})):[],
  })));
}
function fieldKey(control) {
  const label=normalized(control.legend||control.label||control.aria);
  if(NEVER_ANSWER.test([label,control.name,control.id].join(' ')))return null;
  const attrs=[control.name,control.id].map(v=>compact(String(v).replace(/^_systemfield_/,'')));
  const candidates=FIELD_DEFINITIONS.filter(def=>def.aliases.some(a=>label===normalized(a))
    ||def.attrs.some(a=>attrs.includes(a))||def.autocomplete.includes(normalized(control.autocomplete))
    ||(['workAuthorization','sponsorship'].includes(def.key)&&def.aliases.some(a=>label.includes(a))));
  return candidates.length===1?candidates[0].key:null;
}
function question(control) {
  const text=(control.legend||control.label||control.aria||control.name||'Required field').trim().slice(0,500);
  const identity={text:text.normalize('NFKC').toLowerCase().replace(/\s+/g,' '),type:control.type};
  return {id:'question:'+queue.jsonDigest(identity),text,type:control.type,
    options:control.options.filter(o=>o.value&&!o.disabled).map(o=>o.label)};
}
function packetFile(dir,filename,expected) {
  const file=path.join(dir,filename),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>8*1024*1024||stat.size<16)throw new NeedsYou('The approved PDF packet is unavailable.');
  const bytes=fs.readFileSync(file);
  if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||queue.digest(bytes)!==expected)throw new NeedsYou('The PDF differs from the approved packet.');
  return file;
}
function validateTask(task,dir,fixtureOrigin) {
  if(task?.version!==1||task.mode!=='submit'||task.approved!==true||!task.profile||Array.isArray(task.profile)
      ||Object.entries(task.profile).some(([k,v])=>k.length>80||typeof v!=='string'||v.length>2000))
    throw new NeedsYou('The worker did not receive one approved application.');
  if(!Number.isInteger(task.maxPresses??1)||(task.maxPresses??1)<1||(task.maxPresses??1)>6)throw new NeedsYou('The approved press bound is invalid.');
  const bound=queue.binding(task,fixtureOrigin);
  if(task.maxPresses==null)delete bound.maxPresses;else bound.maxPresses=task.maxPresses;
  if(queue.jsonDigest(bound)!==task.packetDigest||queue.jsonDigest(task.profile)!==task.profileSha256)
    throw new NeedsYou('The approved application facts or packet changed.');
  return {resume:packetFile(dir,'Resume_ATS.pdf',task.resumeSha256),
    cover:task.coverSha256?packetFile(dir,'CoverLetter.pdf',task.coverSha256):null,url:bound.url};
}

/** Strict matching avoids turning an applicant email into a reference's email. */
async function fillKnown(page,profile,metrics,scope) {
  const snapshot=(await controls(page)).filter(c=>c.formIndex===scope);
  for(const control of snapshot) {
    if(control.disabled||!control.visible||['hidden','file','submit','button','reset','password'].includes(control.type))continue;
    const known=fieldKey(control),custom=question(control);
    const secret=/password|verification code|social security|bank account/i.test([custom.text,control.name].join(' '));
    const key=known||(!secret?custom.id:null),answer=key&&profile[key];
    if(!answer)continue;
    const target=page.locator('input,textarea,select').nth(control.index);
    // A reactive form may replace/reorder controls after a fill. Never apply an old index blindly.
    const identity=await target.evaluate(e=>({id:e.id,name:e.name,type:String(e.type||'').toLowerCase()}));
    if(identity.id!==control.id||identity.name!==control.name||identity.type!==control.type)
      throw new NeedsYou('The form changed while filling. Review the current fields.');
    if(control.tag==='select') {
      const matches=control.options.filter(o=>!o.disabled&&o.value&&(normalized(o.label)===normalized(answer)||o.value===answer));
      if(matches.length!==1)continue;
      await target.selectOption(matches[0].value);metrics.actions++;
      if(await target.inputValue()!==matches[0].value)throw new NeedsYou('A dropdown did not retain the approved answer.');
    } else if(control.type==='checkbox') {
      if(!/^(?:yes|no|true|false)$/i.test(answer))continue;
      await target.setChecked(/^(?:yes|true)$/i.test(answer));metrics.actions++;
    } else if(control.type==='radio') {
      if(normalized(control.label)!==normalized(answer)&&normalized(control.value)!==normalized(answer))continue;
      await target.check();metrics.actions++;
    } else {
      await target.fill(answer);metrics.actions++;
      if(await target.inputValue()!==answer)throw new NeedsYou('A form field did not retain the approved answer.');
    }
  }
}
async function upload(page,packet,uploaded,metrics,scope) {
  for(const control of (await controls(page)).filter(c=>c.formIndex===scope)) {
    if(control.type!=='file'||control.disabled)continue;
    const text=documentWords([control.label,control.aria,control.name,control.id].join(' '));
    const kind=/resume|curriculum|\bcv\b/.test(text)?'resume':/cover|letter/.test(text)?'cover':null;
    if(!kind||!packet[kind]||uploaded.has(control.index))continue;
    await page.locator('input,textarea,select').nth(control.index).setInputFiles(packet[kind]);metrics.actions++;
    const committed=await page.locator('input,textarea,select').nth(control.index).evaluate(e=>[...e.files||[]].map(f=>({name:f.name,size:f.size})));
    if(committed.length!==1||committed[0].name!==path.basename(packet[kind])||committed[0].size!==fs.statSync(packet[kind]).size)
      throw new NeedsYou('The employer form did not retain the approved PDF upload.');
    uploaded.set(control.index,kind);
  }
}
async function missingRequired(page,scope) {
  return (await controls(page)).filter(c=>c.formIndex===scope&&!c.disabled&&c.required&&c.type!=='hidden'
    &&(!c.valid||(c.type==='file'&&!c.value)||!['file','radio','checkbox'].includes(c.type)&&!c.value))
    .map(question);
}
async function oneButton(page,expression,scope) {
  const buttons=page.getByRole('button',{name:expression});
  const visible=[];
  for(const button of await buttons.all())if(await button.isVisible()&&await button.isEnabled()) {
    const formIndex=await button.evaluate(e=>e.form?[...document.forms].indexOf(e.form):-1);
    if(scope===undefined||formIndex===scope)visible.push(button);
  }
  return visible.length===1?visible[0]:null;
}

function applicationScope(snapshot,origin) {
  let scopes=[...new Set(snapshot.filter(c=>c.type==='file'&&/resume|curriculum|\bcv\b/.test(documentWords([c.label,c.name,c.id].join(' ')))).map(c=>c.formIndex))];
  if(!scopes.length)scopes=[...new Set(snapshot.map(c=>c.formIndex))].filter(index=>{
    const keys=snapshot.filter(c=>c.formIndex===index&&c.visible).map(fieldKey);
    return keys.includes('email')&&(keys.includes('fullName')||keys.includes('firstName'));
  });
  if(scopes.length!==1)throw new NeedsYou('Select the application form; the page has no unambiguous applicant form.');
  const scope=scopes[0];
  if(snapshot.some(c=>c.formIndex===scope&&new URL(c.formAction).origin!==origin))
    throw new NeedsYou('The form sends applicant data to another site. Review its destination first.');
  return scope;
}

/** Choose exactly one visible employer control; fill only the recognized application form. */
async function chooseStep(page,task,state,checkpoint,origin) {
  await checkpoint();const fields=await controls(page);
  if(!fields.some(c=>c.visible&&!['hidden','submit','button','reset'].includes(c.type))) {
    if(state.allowedForm)throw new NeedsYou('No next application form was recognized.');
    const button=await oneButton(page,/^(?:apply|apply now|apply for this job)$/i);
    if(!button)throw new NeedsYou('Open the application form or complete its sign-in first.');
    return {button,kind:'open',label:await buttonLabel(button),scope:null};
  }
  const scope=applicationScope(fields,origin);
  await fillKnown(page,task.profile,state.metrics,scope);await checkpoint();
  const uploaded=new Map();await upload(page,state.packet,uploaded,state.metrics,scope);
  state.uploadedResume ||= [...uploaded.values()].includes('resume');
  state.uploadedCover ||= [...uploaded.values()].includes('cover');
  state.documentWarnings=state.packet.cover&&!state.uploadedCover?['The cover letter had no place to go; only the résumé was attached.']:[];
  const missing=await missingRequired(page,scope);
  if(missing.length)throw new NeedsYou('Approved answers are needed for: '+missing.slice(0,8).map(q=>q.text).join('; '),missing.slice(0,20));
  let button=await oneButton(page,/^(?:submit|submit application|send application)$/i,scope),kind='submit';
  if(button&&!state.uploadedResume)throw new NeedsYou('Verify that the employer received the approved resume before submission.');
  if(!button){button=await oneButton(page,/^(?:next|continue|review application)$/i,scope);kind='continue';}
  if(!button)throw new NeedsYou('Review the form’s remaining controls before submission.');
  return {button,kind,label:await buttonLabel(button),scope};
}
async function buttonLabel(button){
  const label=await button.evaluate(e=>(e.getAttribute('aria-label')||e.innerText||e.value||'').trim());
  if(!label||label.length>80||/[\x00-\x1f\x7f]/.test(label))throw new NeedsYou('Review this application button’s words.');
  return label;
}
async function sequence(page,task,state,hooks,checkpoint,origin,blocked,timeoutMs){
  for(let step=1;step<=(task.maxPresses??1);step++){
    const chosen=await chooseStep(page,task,state,checkpoint,origin);
    const confirmed=await require('./career-submission-steps').press(page,chosen,state,hooks,checkpoint,origin,blocked,CONFIRMATION,timeoutMs);
    if(confirmed){state.milestones.push('employer_confirmation_visible');return confirmed;}
  }
  throw new NeedsYou('Career reached the approved number of presses and stopped.');
}
/** Fresh page and exact packet; every distinct press requires a native permit and report. */
async function runSubmission(page,task,dir,hooks,{fixtureOrigin,timeoutMs=10000}={}) {
  const started=Date.now(),state={metrics:{actions:0,screenshots:0},milestones:[],presses:[],pictures:[],fingerprints:new Set(),uncertain:false,allowedForm:false};
  let blocked=false,guard=null;
  const result=(status,reason,extra={})=>({version:1,submissionId:task?.submissionId,postingId:task?.postingId,status,
    elapsedMs:Date.now()-started,...state.metrics,milestones:state.milestones,review:state.review,presses:state.presses,pressPictures:state.pictures,pictureResized:!!state.pictureResized,...extra,
    documentWarnings:state.documentWarnings||[],reason:[reason,...(state.documentWarnings||[])].join(' ')});
  const checkpoint=async()=>{
    if(blocked)throw new NeedsYou('The form attempted to leave the approved employer.');
    if(!hooks||typeof hooks.check!=='function'||await hooks.check()!==true)throw new NeedsYou('Submission authorization is no longer current.');
  };
  try {
    state.packet=validateTask(task,dir,fixtureOrigin);const origin=new URL(state.packet.url).origin;
    page.setDefaultTimeout(timeoutMs);page.setDefaultNavigationTimeout(timeoutMs);
    guard=async route=>{
      const request=route.request(),url=new URL(request.url());
      const changesData=!['GET','HEAD','OPTIONS'].includes(request.method());
      if((request.isNavigationRequest()||changesData)&&url.origin!==origin) {blocked=true;await route.abort('blockedbyclient');}
      else await route.fallback();
    };
    await page.route('**/*',guard);await checkpoint();
    await page.goto(state.packet.url,{waitUntil:'domcontentloaded'});state.metrics.actions++;
    if(new URL(page.url()).origin!==origin)throw new NeedsYou('Review the employer redirect before sending application data.');
    state.milestones.push('posting_opened');
    if(CONFIRMATION.test(await page.locator('body').innerText()))throw new NeedsYou('This page already shows an application receipt. Review it before submitting again.');
    const evidence=await sequence(page,task,state,hooks,checkpoint,origin,()=>blocked,timeoutMs);
    return result('submitted',evidence.reason,evidence);
  } catch(error) {
    return result(state.allowedForm||state.uncertain?'unknown':'needs_you',error.message||'The form could not be completed; review its current state.',
      {questions:error instanceof NeedsYou?error.questions:[]});
  } finally {if(guard)await page.unroute('**/*',guard).catch(()=>{});}
}
module.exports={runSubmission,fieldKey,validateTask};
