/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped anonymous browser against disposable public-listing forms, delayed pagination and JSON feeds, with no applicant, model or external network.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The reader names itself to the site, presses a cookie notice's accept button and no other, and reports a human check, a refusal and a browser that cannot start each under its own cause.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prove a delayed anonymous browser check reaches jobs, and Avature's mixed-case next link reads subsequent pages without importing its talent-community form.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import http from 'node:http';
const require=createRequire(import.meta.url),engine=require('../../engine/jobhunter/browser_fetch.cjs');
const policy=require('../../engine/jobhunter/browser_read_policy.cjs');
const deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN||'scripts/toolchain','package.json'));
const {chromium}=deps('playwright');
let server,origin;const posts=[],agents=[],pressed=[];
before(async()=>{
 server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='POST'){
   posts.push(url.pathname);res.setHeader('content-type','application/json');
   res.end(JSON.stringify({data:{jobs:[{jobId:'graphql',title:'GraphQL Engineer',jobUrl:'/jobs/graphql'}]}}));return;
  }
  if(url.pathname==='/api/jobs'){
   res.setHeader('content-type','application/json');res.end(JSON.stringify({jobs:[
    {jobId:'json-1',title:'Cloud Engineer',jobUrl:'/jobs/json-1',location:'Remote'},
    {jobId:'json-2',title:'Adjunct Lecturer',jobUrl:'/jobs/json-2',location:'Local'}]}));return;
  }
  res.setHeader('content-type','text/html');
  if(url.pathname==='/check-delayed'){
   res.statusCode=202;res.setHeader('x-amzn-waf-action','challenge');
   res.end('<script>setTimeout(()=>location.href="/after-check",12000)</script>');return;
  }
  if(url.pathname==='/after-check'){res.end('<a href="/jobs/delayed">Engineer after the check</a>');return;}
  if(url.pathname==='/en_US/careers/SearchJobs/'){
   const offset=Number(url.searchParams.get('jobOffset')||0);
   res.end(`<article><a href="/careers/JobDetail/${offset+1}">Avature Engineer ${offset+1}</a><span class="location">Austin, Texas</span></article>
    <a href="/careers/ApplicationMethods?jobId=129">Join Our Community</a>
    <a href="/en_US/careers/SearchJobs/#main">Skip to content</a><a href="/de_DE/careers/SearchJobs/?jobRecordsPerPage=100">Deutsch</a>
    ${offset===0?'<a class="paginationNextLink" href="?jobOffset=100">Next &gt;&gt;</a>':''}`);return;
  }
  if(url.pathname==='/agent'){agents.push(req.headers['user-agent']);res.end('<a href="/jobs/one">Platform Engineer</a>');return;}
  if(url.pathname==='/pressed'){pressed.push(url.searchParams.get('what'));res.end('ok');return;}
  if(url.pathname==='/notice'||url.pathname==='/notice-known'){
   const button=url.pathname==='/notice'?'<button id="yes">Accept all</button>':'<button id="onetrust-accept-btn-handler">Allow</button>';
   res.end(`<h1>Careers</h1><div id="jobs"></div><div class="cookie-banner" style="position:fixed;inset:0;background:#fff">We use cookies. ${button}<button id="no">Manage</button></div>
    <script>document.querySelector('.cookie-banner button').addEventListener('click',()=>{document.querySelector('.cookie-banner').remove();
     document.getElementById('jobs').innerHTML='<a href="/jobs/behind">Engineer behind the notice</a>';});</script>`);return;
  }
  if(url.pathname==='/not-a-notice'){
   res.end(`<h1>Careers</h1><a href="/jobs/one">Platform Engineer</a><div class="offer">Join our talent community. <button id="a">Accept</button></div>
    <form action="/apply" method="POST"><p>Cookie preferences</p><button type="button" id="b">I agree</button></form>
    <script>for(const id of ['a','b'])document.getElementById(id).addEventListener('click',()=>fetch('/pressed?what='+id));</script>`);return;
  }
  if(url.pathname==='/check-cf'){res.statusCode=403;res.setHeader('cf-mitigated','challenge');res.end('<title>Just a moment...</title>');return;}
  if(url.pathname==='/check-waf'){res.statusCode=202;res.setHeader('x-amzn-waf-action','challenge');res.end('<title></title>');return;}
  if(url.pathname==='/check-frame'){res.end('<h1>One more step</h1><iframe src="/blank?challenges.cloudflare.com" style="width:300px;height:65px"></iframe>');return;}
  if(url.pathname==='/check-passed'){res.statusCode=202;res.setHeader('x-amzn-waf-action','challenge');res.end('<a href="/jobs/one">Platform Engineer</a>');return;}
  if(url.pathname==='/refused'){res.statusCode=403;res.end('<h1>403 Forbidden</h1>');return;}
  if(url.pathname==='/gone'){res.statusCode=404;res.end('<h1>Not found</h1>');return;}
  if(url.pathname==='/login'){res.end('<h1>Sign in</h1><label>Password<input type=password></label>');return;}
  if(url.pathname==='/embedded'){
   res.end('<h1>Faculty opening</h1><script type="application/ld+json">'+JSON.stringify({
    '@type':['Thing','JobPosting'],title:'English Professor',url:'/faculty/42',description:'<p>Master degree required.</p>'})+'</script>');return;
  }
  if(url.pathname==='/form'){
   res.end(`<a href="/jobs/one">Platform Engineer</a><form action="/apply" method="POST"><button>Next</button></form>
    <script>fetch('/apply',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).catch(()=>{});</script>`);return;
  }
  if(url.pathname==='/json'){
   res.end(`<h1>Careers</h1><script>setTimeout(()=>fetch('/api/jobs').then(r=>r.json()),70);</script>`);return;
  }
  if(url.pathname==='/graphql'){
   res.end(`<h1>Careers</h1><script>fetch('/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'query SearchJobs { jobs { title jobId applicationUrl } }'})}).then(r=>r.json());</script>`);return;
  }
  if(url.pathname==='/cookie'){
   res.end(`<a href="/jobs/one">Platform Engineer</a><script>if(document.cookie.includes('anonymous_seen'))document.body.insertAdjacentHTML('beforeend','<a href=/jobs/leak>Profile leaked</a>');document.cookie='anonymous_seen=yes';</script>`);return;
  }
  const page=Number(url.searchParams.get('page')||1);
  res.end(`<h1>Careers</h1><a href="/jobs/${page}">Engineer ${page}</a>
    ${page<3?`<a rel="next" href="/list?page=${page+1}">Next</a>`:''}`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
const run=(path,extra={})=>engine.scrape({url:origin+path,maxPages:8,deadlineMs:20000,...extra},{chromium,fixtureOrigin:origin});
test('anonymous read follows pagination beyond page two and retains each actual job',async()=>{
 const value=await run('/list');assert.deepEqual(value.dom.map(row=>row.title),['Engineer 1','Engineer 2','Engineer 3']);
 assert.ok(value.pages>=3);assert.equal(value.reason,'completion_unverified');
});
test('JSON-only employer jobs are captured after asynchronous loading',async()=>{
 const value=await run('/json');assert.equal(value.payloads.length,1);
 assert.match(value.payloads[0].body,/Adjunct Lecturer/);assert.equal(value.dom.length,0);
});
test('an embedded single faculty JobPosting retains complete supplied JSON-LD evidence',async()=>{
 const value=await run('/embedded');assert.equal(value.payloads.length,1);
 const posting=JSON.parse(value.payloads[0].body);assert.equal(posting.title,'English Professor');
 assert.equal(posting.description,'<p>Master degree required.</p>');assert.equal(value.dom.length,0);
});
test('explicit GraphQL search can use POST while application mutations remain blocked',async()=>{
 const start=posts.length,value=await run('/graphql');assert.equal(value.payloads.length,1);
 assert.deepEqual(posts.slice(start),['/graphql']);
 const form=await run('/form');assert.deepEqual(form.dom.map(row=>row.title),['Platform Engineer']);
 assert.deepEqual(posts.slice(start),['/graphql'],'neither script nor Next may submit the employer form');
});
test('each source receives a new anonymous context and no saved applicant cookies',async()=>{
 for(let n=0;n<2;n++){const value=await run('/cookie');assert.deepEqual(value.dom.map(row=>row.title),['Platform Engineer']);}
});
test('page bounds remain explicit rather than claiming complete enumeration',async()=>{
 const value=await run('/list',{maxPages:1});assert.equal(value.pages,1);assert.equal(value.reason,'page_limit_reached');
 assert.deepEqual(value.dom.map(row=>row.title),['Engineer 1']);
});
test('login prompts return a handoff observation without entering credentials',async()=>{
 const value=await run('/login',{deadlineMs:12000});assert.equal(value.reason,'login_required');assert.equal(value.dom.length,0);
});
test('production CLI accepts only bounded public HTTPS input without fixture selectors',()=>{
 for(const value of [{url:'http://127.0.0.1/'},{url:'https://name:password@example.com/'},{url:'https://example.com/',fixtureOrigin:origin},{url:'https://example.com/',maxPages:81},{url:'https://example.com/',deadlineMs:0}])assert.throws(()=>engine.validateInput(value));
 assert.equal(engine.validateInput({url:'https://example.com/careers'}).maxPages,80);
});
test('public request policy refuses private DNS, navigation POST and GraphQL mutations',async()=>{
 const cases=[
  ['https://127.0.0.1/', 'GET','document',null,false],
  ['https://example.com/','GET','document',null,false],
  ['https://8.8.8.8/graphql','POST','xhr',JSON.stringify({query:'mutation Apply { submit }'}),false],
  ['https://8.8.8.8/jobs','POST','document',JSON.stringify({query:'query {jobs {title}}'}),false],
  ['https://8.8.8.8/graphql','POST','xhr',JSON.stringify({query:'query { jobs {title applicationUrl} }'}),true],
 ];
 for(const [url,method,type,body,allowed]of cases){let observed;
  const request={url:()=>url,method:()=>method,resourceType:()=>type,isNavigationRequest:()=>type==='document',headers:()=>({'content-type':'application/json'}),postData:()=>body};
  await policy.createReadPolicy({lookup:async()=>[{address:'127.0.0.1'}]})({request:()=>request,abort:async()=>{observed=false;},continue:async()=>{observed=true;}});
  assert.equal(observed,allowed,url);
 }
});
test('the site is told a current Chrome and this reader by name',async()=>{
 const start=agents.length,value=await run('/agent');assert.equal(value.dom.length,1);
 const agent=agents[start];
 assert.match(agent,/^Mozilla\/5\.0 .*Chrome\/\d+[\d.]* .*jobhunter\/1\.0 \(personal job search\)$/);
 assert.doesNotMatch(agent,/Headless/i);assert.doesNotMatch(agent,/@/);
});
test('a cookie notice that covers the jobs is accepted and the jobs behind it are read',async()=>{
 for(const path of ['/notice','/notice-known']){
  const value=await run(path);assert.deepEqual(value.dom.map(row=>row.title),['Engineer behind the notice'],path);
 }
});
test('an accept button that belongs to no cookie notice, or sits in a form, is left alone',async()=>{
 const start=pressed.length,value=await run('/not-a-notice');
 assert.deepEqual(value.dom.map(row=>row.title),['Platform Engineer']);assert.deepEqual(pressed.slice(start),[]);
});
test('a human check is reported as one and a page that answers past it keeps its jobs',async()=>{
 for(const path of ['/check-cf','/check-waf','/check-frame']){
  const value=await run(path,{deadlineMs:15000});assert.equal(value.reason,'challenge_detected',path);assert.equal(value.dom.length,0,path);
 }
 const value=await run('/check-passed');assert.deepEqual(value.dom.map(row=>row.title),['Platform Engineer']);
 assert.notEqual(value.reason,'challenge_detected');
});
test('a delayed automatic browser check can finish within the source deadline',async()=>{
 const value=await run('/check-delayed',{deadlineMs:30000});
 assert.deepEqual(value.dom.map(row=>row.title),['Engineer after the check']);
 assert.notEqual(value.reason,'challenge_detected');
});
test('Avature next-page links and job locations are read without importing the community form',async()=>{
 const value=await run('/en_US/careers/SearchJobs/?9577=17276&jobRecordsPerPage=6');
 assert.deepEqual(value.dom.map(row=>[row.title,row.location]),[['Avature Engineer 1','Austin, Texas'],['Avature Engineer 101','Austin, Texas']]);
});
test('a refusal, a missing page and a browser that cannot start each fail under their own cause',async()=>{
 await assert.rejects(run('/refused'),{message:'browser_refused'});
 await assert.rejects(run('/gone'),{message:'browser_navigation_failed'});
 await assert.rejects(engine.scrape({url:origin+'/list',maxPages:1,deadlineMs:20000},{chromium,fixtureOrigin:origin,executablePath:'/nonexistent/browser/chrome'}),{message:'browser_runtime_unavailable'});
});
