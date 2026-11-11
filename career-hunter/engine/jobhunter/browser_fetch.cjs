/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read public careers pages with the pinned modern browser, page-state waits, bounded anonymous pagination and captured listing JSON; never fill applicant forms.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Read as a browser that says what it is, press a cookie notice's accept button when one covers the jobs, and name what stopped a read: a site's human check, a refusal, or a browser that could not start. A check is reported, never worked around.
 */
'use strict';
const {createHash}=require('node:crypto');
const {createReadPolicy}=require('./browser_read_policy.cjs');
const VERSION='1.59.1',MAX_BYTES=8*1024*1024,MAX_ROWS=5000;
const JOB=/\/jobs?[/-]|\/careers?\/[^/]+\/[^/]|\/positions?\/|\/openings?\/|\/vacanc|\/requisition|\/jobdetail|\/jobposting|jobid=|reqid=|\/p\/|\/roles?\/|\/listing\//i;
const BAD=/^(apply|search|view all|see all|browse|explore|back|next|previous|sign in|login|home|menu|learn more|read more|filter|sort|share|email|cookie|privacy|terms)\b/i;
const NEXT=["a[rel=next]","[aria-label='Next page' i]","[aria-label='Next' i]","[class*=pagination] [class*=next]","[class*=paging] a[class*=next]","[data-ph-at-id='pagination-next-link']"];
const MORE=["button:has-text('Load more')","button:has-text('Show more')","button:has-text('More jobs')","button:has-text('View more')"];
const NOTICE=['#onetrust-accept-btn-handler','#truste-consent-button','#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll','#CybotCookiebotDialogBodyButtonAccept','#didomi-notice-agree-button','[data-testid=uc-accept-all-button]'].join(',');
const ACCEPT='^(accept( all)?( cookies)?|accept (&|and) continue|allow all( cookies)?|i accept|i agree|agree|got it|ok(ay)?)$';
const CHECK='iframe[src*=captcha i]:visible,iframe[src*="challenges.cloudflare.com"]:visible';
const STOPS=['browser_navigation_failed','browser_refused','browser_runtime_unavailable'];
const READER=' jobhunter/1.0 (personal job search)';
const digest=value=>createHash('sha256').update(value).digest('hex');
function validateInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['url','maxPages','deadlineMs'].includes(key))
    ||typeof value.url!=='string'||value.url.length>4096)throw Error('browser_input_invalid');
  let url;try{url=new URL(value.url);}catch{throw Error('browser_input_invalid');}
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw Error('browser_input_invalid');
  const maxPages=value.maxPages??80,deadlineMs=value.deadlineMs??120000;
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>80||!Number.isInteger(deadlineMs)||deadlineMs<1000||deadlineMs>120000)throw Error('browser_input_invalid');
  return {url:url.href,maxPages,deadlineMs};
}
async function links(page){
  const candidates=await page.locator('a[href]').evaluateAll(nodes=>nodes.slice(0,20000).map(a=>({
    url:a.href,title:(a.innerText||'').replace(/\s+/g,' ').trim(),
    location:a.closest('li,div,article,tr')?.querySelector('[class*=location i],[class*=city i],[class*=region i],[class*=where i]')?.textContent?.trim().slice(0,120)||null,
  })));
  return candidates.filter(row=>[...row.title].length>=4&&[...row.title].length<=160&&!BAD.test(row.title)
    &&row.url.length<=4096&&JOB.test(row.url)&&/^https?:/.test(row.url));
}
function jsonHasJobs(value,depth=0){
  if(depth>14||!value||typeof value!=='object')return false;
  if(!Array.isArray(value)){
    const low=Object.fromEntries(Object.entries(value).map(([key,value])=>[key.toLowerCase(),value]));
    const title=low.title||low.jobtitle||low.job_title||low.postingname||low.positionname||low.displayjobtitle||low.roletitle||low.name;
    const url=low.joburl||low.applyurl||low.applicationurl||low.absoluteurl||low.absolute_url||low.url||low.detailurl||low.externalpath;
    if(typeof title==='string'&&title.length>=3&&title.length<=160
      &&(low['@type']==='JobPosting'||Array.isArray(low['@type'])&&low['@type'].includes('JobPosting')
        ||low.jobid||low.reqid||low.requisitionid||low.jobpostingid||low.positionid||typeof url==='string'&&JOB.test(url)))return true;
  }
  return Object.values(value).some(child=>jsonHasJobs(child,depth+1));
}
/** Press the accept button of a cookie notice. A button counts only when it sits inside something that names cookies, consent or privacy, and never inside a form. */
async function dismissNotice(page){
  try{
    let button=page.locator(NOTICE).first();
    if(!await button.isVisible()){
      button=(await page.evaluateHandle(pattern=>{
        const accept=new RegExp(pattern,'i'),about=/cookie|consent|privacy|gdpr/i;
        for(const el of document.querySelectorAll('button,[role=button],input[type=button]')){
          const text=(el.innerText||el.value||'').replace(/\s+/g,' ').trim();
          if(!accept.test(text)||el.closest('form')||!el.getClientRects().length)continue;
          for(let up=el.parentElement,depth=0;up&&up!==document.body&&depth<8;up=up.parentElement,depth++){
            const label=[up.id,typeof up.className==='string'?up.className:'',up.getAttribute('aria-label')||''].join(' ');
            const said=up.innerText||'';
            if(about.test(label)||said.length<=1500&&about.test(said))return el;
          }
        }
        return null;
      },ACCEPT)).asElement();
      if(!button)return false;
    }
    await button.click({timeout:2000});return true;
  }catch{return false;}
}
async function advance(page){
  for(const selector of [...NEXT,...MORE]){
    const candidates=await page.locator(selector).all();
    for(const candidate of candidates.slice(0,10)){
      if(!await candidate.isVisible()||!await candidate.isEnabled())continue;
      const safe=await candidate.evaluate(el=>!el.closest('form')&&el.getAttribute('aria-disabled')!=='true'
        &&!el.classList.contains('disabled')&&!el.hasAttribute('disabled'));
      if(!safe)continue;
      const href=await candidate.getAttribute('href');
      if(href&&!href.startsWith('#')&&!/^javascript:/i.test(href))await page.goto(new URL(href,page.url()).href,{waitUntil:'domcontentloaded',timeout:15000});
      else await candidate.click({timeout:3000});
      return true;
    }
  }
  const height=await page.evaluate(()=>document.body.scrollHeight);
  await page.mouse.wheel(0,20000);
  return {height};
}
async function scrape(input,{chromium,executablePath,fixtureOrigin}={}){
  const settings=fixtureOrigin?{...input,maxPages:input.maxPages??80,deadlineMs:input.deadlineMs??120000}:validateInput(input);
  const end=Date.now()+settings.deadlineMs,result={version:1,dom:[],payloads:[],pages:0,reason:'completion_unverified'};
  let browser,context,page,expired=false,bytes=0,serial=0,cap=false,latest=Date.now(),pending=new Set(),checked=false,noticed=false,tried=0;
  const seenLinks=new Set(),seenPayloads=new Set();
  const network=new Set();
  const timer=setTimeout(()=>{expired=true;context?.close().catch(()=>{});browser?.close().catch(()=>{});},settings.deadlineMs);timer.unref();
  function capturePayload(body,url,baseUrl){
    if(Buffer.byteLength(body)>6*1024*1024){cap=true;return;}
    const key=digest(body);if(seenPayloads.has(key))return;seenPayloads.add(key);
    let value;try{value=JSON.parse(body);}catch{return;}
    if(!jsonHasJobs(value))return;
    const payload={url,baseUrl,body},size=Buffer.byteLength(JSON.stringify(payload));
    if(bytes+size>MAX_BYTES||result.payloads.length>=1000){cap=true;return;}
    bytes+=size;result.payloads.push(payload);serial++;latest=Date.now();
  }
  function captureResponse(response){
    const work=(async()=>{
      try{
        const headers=await response.allHeaders(),type=headers['content-type']||'';
        if(!/json/i.test(type))return;
        if(Number(headers['content-length'])>6*1024*1024){cap=true;return;}
        const baseUrl=page.url(),body=await response.text();capturePayload(body,response.url(),baseUrl);
      }catch{/* A failed optional resource is not evidence of a completed source. */}
    })();pending.add(work);work.finally(()=>pending.delete(work));
  }
  async function harvest(){
    const embedded=await page.locator('script[type="application/ld+json"],script[type="application/json"]').evaluateAll(nodes=>{
      const bodies=[];let chars=0,limited=nodes.length>100;
      for(const node of nodes.slice(0,100)){
        const body=node.textContent||'';chars+=body.length;
        if(chars>6*1024*1024){limited=true;break;}bodies.push(body);
      }
      return {bodies,limited};
    });
    for(const body of embedded.bodies)capturePayload(body,page.url(),page.url());
    if(embedded.limited)cap=true;
    for(const row of await links(page)){
      if(seenLinks.has(row.url))continue;
      if(result.dom.length>=MAX_ROWS||bytes+Buffer.byteLength(JSON.stringify(row))>MAX_BYTES){cap=true;break;}
      seenLinks.add(row.url);result.dom.push(row);bytes+=Buffer.byteLength(JSON.stringify(row));latest=Date.now();serial++;
    }
  }
  async function notice(){
    if(noticed||Date.now()-tried<500)return;
    tried=Date.now();if(await dismissNotice(page)){noticed=true;latest=Date.now();}
  }
  async function settle(before){
    const started=Date.now();let changed=before===null;
    while(Date.now()<Math.min(end,started+8000)&&!expired&&!cap){
      await notice();await harvest();if(before!==null&&serial!==before)changed=true;
      if(serial===0&&await page.locator('input[type=password]:visible,'+CHECK).count())return;
      if(changed&&serial>0&&Date.now()-started>=500&&Date.now()-latest>=350&&pending.size===0)return;
      if(before!==null&&!changed&&Date.now()-started>=1500&&network.size===0&&pending.size===0)return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  try{
    try{browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});}catch{throw Error('browser_runtime_unavailable');}
    if(expired)throw Error('browser_deadline_exceeded');
    // The browser's own name with the headless marker dropped and this reader named after it: a site sees a
    // current Chrome and can also see, and refuse, exactly who is reading.
    const blank=await browser.newPage(),own=await blank.evaluate(()=>navigator.userAgent);await blank.close();
    context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,userAgent:own.replace('HeadlessChrome','Chrome')+READER});
    await context.route('**/*',createReadPolicy({fixtureOrigin}));
    page=await context.newPage();page.on('response',captureResponse);
    page.on('request',request=>{if(['fetch','xhr'].includes(request.resourceType()))network.add(request);});
    page.on('requestfinished',request=>network.delete(request));page.on('requestfailed',request=>network.delete(request));
    const response=await page.goto(settings.url,{waitUntil:'domcontentloaded',timeout:Math.min(30000,settings.deadlineMs)});
    const status=response?response.status():0,sent=response?response.headers():{};
    checked=sent['cf-mitigated']==='challenge'||/^(challenge|captcha)$/.test(sent['x-amzn-waf-action']||'');
    if(!checked&&[401,403,429,451].includes(status))throw Error('browser_refused');
    if(!checked&&status>=400)throw Error('browser_navigation_failed');
    for(let index=0;index<settings.maxPages&&!expired&&!cap;index++){
      result.pages++;
      if(index===0)await settle(null);await harvest();
      if(await page.locator('input[type=password]:visible,'+CHECK).count()){
        result.reason=await page.locator('input[type=password]:visible').count()?'login_required':'challenge_detected';break;
      }
      if(cap){result.reason='response_limit_reached';break;}
      if(index+1===settings.maxPages){result.reason='page_limit_reached';break;}
      tried=0;await notice();
      const initial=serial,moved=await advance(page);await settle(initial);await harvest();
      if(serial===initial){
        if(moved&&typeof moved==='object'&&await page.evaluate(()=>document.body.scrollHeight)<=moved.height)break;
        if(moved===false||result.pages>1)break;
      }
    }
    if(checked&&serial===0)result.reason='challenge_detected';
    if(expired)result.reason='browser_deadline_exceeded';
    await Promise.allSettled([...pending]);
    if(cap)result.reason='response_limit_reached';
    return result;
  }catch(error){
    if(expired){result.reason='browser_deadline_exceeded';return result;}
    throw Error(STOPS.includes(error.message)?error.message:'browser_read_failed');
  }finally{
    clearTimeout(timer);await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
  }
}
module.exports={VERSION,validateInput,links,jsonHasJobs,scrape};
if(require.main===module){
  (async()=>{
    if(process.versions.node.split('.')[0]!=='24'||require('playwright/package.json').version!==VERSION)throw Error('browser_runtime_unavailable');
    let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>8192)throw Error('browser_input_invalid');}
    const settings=validateInput(JSON.parse(input));
    const value=await scrape(settings,{chromium:require('playwright').chromium,executablePath:process.env.JOBHUNTER_BROWSER_EXECUTABLE});
    const out=JSON.stringify(value);if(Buffer.byteLength(out)>MAX_BYTES+1024*1024)throw Error('browser_response_too_large');
    process.stdout.write(out+'\n');
  })().catch(error=>{process.stderr.write(['browser_runtime_unavailable','browser_input_invalid','browser_navigation_failed','browser_refused','browser_response_too_large'].includes(error.message)?error.message+'\n':'browser_read_failed\n');process.exitCode=2;});
}
