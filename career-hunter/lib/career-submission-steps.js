/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Omit pictures whose reports were never acknowledged; reserve the kernel answer ceiling before hashing.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fingerprint visible form structure, classify each permitted press and fix evidence bytes before reporting. */
'use strict';
const queue=require('./career-submission-queue'),{fit}=require('./career-submission-png');
async function fingerprint(page,scope){
  const snapshot=await page.evaluate(scope=>{
    const visible=e=>!!(e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
    const inScope=e=>scope==null||(e.form?[...document.forms].indexOf(e.form):-1)===scope;
    const words=e=>(e.getAttribute('aria-label')||e.innerText||e.value||'').trim();
    const buttons=[...document.querySelectorAll('button,input[type=submit],input[type=button],[role=button]')].filter(e=>visible(e)&&inScope(e)).map(words);
    if(scope==null)return {buttons,path:location.pathname};
    const controls=[...document.querySelectorAll('input,textarea,select')].filter(e=>visible(e)&&inScope(e)&&!['submit','button','reset','hidden'].includes(e.type)).map(e=>({
      tag:e.tagName.toLowerCase(),type:String(e.type||'').toLowerCase(),name:e.name||'',
      label:([...e.labels||[]].map(l=>l.innerText||l.textContent||'').join(' ').trim()||e.getAttribute('aria-label')||e.closest('fieldset')?.querySelector('legend')?.innerText||'')
    }));
    return {controls,buttons};
  },scope);
  return queue.jsonDigest(snapshot);
}
async function observation(page,scope,before,origin,blocked,confirmation){
  if(blocked()||new URL(page.url()).origin!==origin)return {result:'left_site'};
  const text=await page.locator('body').innerText(),match=text.match(confirmation);
  if(match)return {result:'confirmed',confirmationText:match[0]};
  if(await fingerprint(page,scope)!==before&&!/(?:saving|processing|please wait|error|failed|try again)(?:\b|…)/i.test(text))return {result:'advanced'};
  return {result:'unknown'};
}
async function waitAfter(page,scope,before,origin,blocked,confirmation,timeoutMs){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    try{
      const seen=await observation(page,scope,before,origin,blocked,confirmation);
      if(seen.result!=='unknown'){
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(Math.min(100,timeoutMs));
        return await observation(page,scope,before,origin,blocked,confirmation);
      }
    }catch{ /* A navigation can replace the execution context; classify its settled page. */ }
    await page.waitForTimeout(50);
  }
  return {result:'unknown'};
}
async function picture(page,state,hooks){
  if(hooks.pictureBudget!=null&&hooks.pictureBudget<=0)throw Error('The picture budget is too small for a permitted press.');
  const raw=await page.screenshot({type:'png'});state.metrics.screenshots++;
  const bytes=fit(raw,hooks.pictureBudget||400000);if(bytes.length!==raw.length)state.pictureResized=true;
  return bytes;
}
async function press(page,chosen,state,hooks,checkpoint,origin,blocked,confirmation,timeoutMs){
  const step=state.presses.length+1,stepSha256=await fingerprint(page,chosen.scope);
  if(state.fingerprints.has(stepSha256))throw Error('This form step was already pressed. Career stopped.');
  await checkpoint();state.review=await picture(page,state,hooks);state.milestones.push('review_captured');
  let approved;
  try{approved=await hooks.ask({step,kind:chosen.kind,label:chosen.label,origin:new URL(page.url()).origin,stepSha256});}
  catch(error){if(!error.reason)state.uncertain=true;throw error;}
  if(!approved?.permit)throw Error('The press was not authorized for this exact packet.');
  state.uncertain=true;state.permit=approved.permit;state.fingerprints.add(stepSha256);state.allowedForm ||= chosen.kind!=='open';
  await checkpoint();
  if(confirmation.test(await page.locator('body').innerText()))throw Error('A receipt appeared before the press. Review the existing application.');
  state.uncertain=true;await chosen.button.click().catch(()=>{});state.metrics.actions++;
  const seen=await waitAfter(page,chosen.scope,stepSha256,origin,blocked,confirmation,timeoutMs);
  const after=await picture(page,state,hooks),record={step,kind:chosen.kind,label:chosen.label,result:seen.result,afterSha256:queue.digest(after)};
  state.presses.push(record);
  const reply=await hooks.report({step,permit:approved.permit,result:seen.result,origin:new URL(page.url()).origin,afterSha256:record.afterSha256});
  state.pictures.push({step,bytes:after});state.uncertain=false;
  if(reply.result!==seen.result)record.result=reply.result;
  if(record.result==='confirmed'&&chosen.kind!=='open')return {confirmation:after,confirmationSha256:record.afterSha256,confirmationText:seen.confirmationText};
  if(!reply.next||record.result!=='advanced')throw Error(record.result==='left_site'?'The page tried to go to another site, which Career blocked.':record.result==='unknown'?'The page did not move on in 10 seconds. Career stopped and pressed nothing else.':'The permitted sequence ended. Check the employer outcome.');
  return null;
}
module.exports={fingerprint,press};
