/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Compose worker network guards and preserve an unknown outcome when the final-action acknowledgement is lost.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fill approved application facts with semantic browser controls, verify packet bytes and retain conservative final-submit evidence without per-field vision turns.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {FIELD_DEFINITIONS} = require('./autofill-bookmarklet');
const queue = require('./career-submission-queue');
const normalized = value => String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
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
  const bound=queue.binding(task,fixtureOrigin);
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
    const text=normalized([control.label,control.aria,control.name,control.id].join(' '));
    const kind=/cover|letter/.test(text)?'cover':/resume|curriculum|\bcv\b/.test(text)?'resume':null;
    if(!kind||!packet[kind]||uploaded.has(control.index))continue;
    await page.locator('input,textarea,select').nth(control.index).setInputFiles(packet[kind]);metrics.actions++;
    const committed=await page.locator('input,textarea,select').nth(control.index).evaluate(e=>[...e.files||[]].map(f=>({name:f.name,size:f.size})));
    if(committed.length!==1||committed[0].name!==path.basename(packet[kind])||committed[0].size!==fs.statSync(packet[kind]).size)
      throw new NeedsYou('The employer form did not retain the approved PDF upload.');
    uploaded.add(control.index);
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
  let scopes=[...new Set(snapshot.filter(c=>c.type==='file'&&/resume|curriculum|\bcv\b/.test(normalized([c.label,c.name,c.id].join(' ')))).map(c=>c.formIndex))];
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

/**
 * One fresh, worker-owned page per application. Hooks come from native held-work admission:
 * check revalidates original authority; beforeSubmit durably consumes the one final-click intent.
 * This function never reconnects, retries Submit, accesses a mailbox, or invents a required fact.
 */
async function runSubmission(page,task,dir,hooks,{fixtureOrigin,timeoutMs=10000}={}) {
  const started=Date.now(),metrics={actions:0,screenshots:0},milestones=[];
  let sent=false,consumed=false,blocked=false,guard=null;
  const result=(status,reason,extra={})=>({version:1,submissionId:task?.submissionId,postingId:task?.postingId,status,reason,
    elapsedMs:Date.now()-started,actions:metrics.actions,screenshots:metrics.screenshots,milestones,...extra});
  const checkpoint=async()=>{
    if(blocked)throw new NeedsYou('The form attempted to leave the approved employer.');
    if(!hooks||typeof hooks.check!=='function'||await hooks.check()!==true)throw new NeedsYou('Submission authorization is no longer current.');
  };
  try {
    const packet=validateTask(task,dir,fixtureOrigin),origin=new URL(packet.url).origin;
    page.setDefaultTimeout(timeoutMs);page.setDefaultNavigationTimeout(timeoutMs);
    guard=async route=>{
      const request=route.request(),url=new URL(request.url());
      const changesData=!['GET','HEAD','OPTIONS'].includes(request.method());
      if((request.isNavigationRequest()||changesData)&&url.origin!==origin) {blocked=true;await route.abort('blockedbyclient');}
      else await route.fallback();
    };
    await page.route('**/*',guard);
    await checkpoint();await page.goto(packet.url,{waitUntil:'domcontentloaded'});metrics.actions++;
    if(new URL(page.url()).origin!==origin)throw new NeedsYou('Review the employer redirect before sending application data.');
    milestones.push('posting_opened');
    const initial=await page.locator('body').innerText();
    if(CONFIRMATION.test(initial))throw new NeedsYou('This page already shows an application receipt. Review it before submitting again.');
    let uploadedResume=false;
    for(let step=0;step<6;step++) {
      await checkpoint();
      let fields=await controls(page);
      if(!fields.some(c=>c.visible&&c.type!=='hidden'&&c.type!=='submit')) {
        const apply=await oneButton(page,/^(?:apply|apply now|apply for this job)$/i);
        if(!apply)throw new NeedsYou('Open the application form or complete its sign-in first.');
        await apply.click();metrics.actions++;
        await page.locator('input:not([type=hidden]),textarea,select').first().waitFor({state:'attached'});
      }
      const scope=applicationScope(await controls(page),origin);
      await checkpoint();await fillKnown(page,task.profile,metrics,scope);
      await checkpoint();
      const uploaded=new Set();await upload(page,packet,uploaded,metrics,scope);
      uploadedResume=uploadedResume||(await controls(page)).some(c=>c.formIndex===scope&&c.type==='file'&&c.value&&/resume|curriculum|\bcv\b/.test(normalized([c.label,c.name,c.id].join(' '))));
      fields=await missingRequired(page,scope);
      if(fields.length)throw new NeedsYou('Approved answers are needed for: '+fields.slice(0,8).map(q=>q.text).join('; '),fields.slice(0,20));
      const submit=await oneButton(page,/^(?:submit|submit application|send application)$/i,scope);
      if(submit) {
        if(!uploadedResume)throw new NeedsYou('Verify that the employer received the approved resume before submission.');
        await checkpoint();
        const review=await page.screenshot({type:'png'});metrics.screenshots++;
        milestones.push('approved_fields_filled','resume_uploaded','review_captured');
        let authorized=false;
        if(typeof hooks.beforeSubmit==='function'){
          try{authorized=await hooks.beforeSubmit()===true;}
          catch{consumed=true;throw new NeedsYou('The final-action acknowledgement was lost. Check the employer outcome before retrying.');}
        }
        if(!authorized)throw new NeedsYou('Final submission was not authorized for this exact packet.');
        consumed=true;await checkpoint();
        const before=await page.locator('body').innerText();
        if(CONFIRMATION.test(before))throw new NeedsYou('A receipt appeared before Submit. Review the existing application.');
        sent=true;await submit.click();metrics.actions++;
        await page.waitForFunction(({source,flags})=>new RegExp(source,flags).test(document.body?.innerText||''),
          {source:CONFIRMATION.source,flags:CONFIRMATION.flags},{timeout:timeoutMs});
        await checkpoint();
        const text=await page.locator('body').innerText(),match=text.match(CONFIRMATION);
        if(!match)throw new NeedsYou('The employer response needs review.');
        const confirmation=await page.screenshot({type:'png'});metrics.screenshots++;
        milestones.push('final_submit_clicked','employer_confirmation_visible');
        return result('submitted','Employer confirmation is visible.',{confirmationText:match[0],
          confirmationSha256:queue.digest(confirmation),confirmation,review});
      }
      const next=await oneButton(page,/^(?:next|continue|review application)$/i,scope);
      if(!next)throw new NeedsYou('Review the form’s remaining controls before submission.');
      const previousText=await page.locator('body').innerText(),previousUrl=page.url();
      await next.click();metrics.actions++;
      await page.waitForFunction(({text,url})=>location.href!==url||(document.body?.innerText||'')!==text,
        {text:previousText,url:previousUrl},{timeout:timeoutMs});
    }
    throw new NeedsYou('The application has more steps than this worker supports.');
  } catch(error) {
    // A timed-out final click may have reached the employer. Never turn it into an automatic retry.
    return result(sent||consumed?'unknown':'needs_you',error instanceof NeedsYou?error.message:
      sent?'The final outcome is uncertain. Check the employer before retrying.':'The form could not be completed; review its current state.',
      {questions:error instanceof NeedsYou?error.questions:[]});
  } finally {
    if(guard)await page.unroute('**/*',guard).catch(()=>{});
  }
}
module.exports={runSubmission,fieldKey,validateTask};
