/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped anonymous browser against disposable public-listing forms, delayed pagination and JSON feeds, with no applicant, model or external network.
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
let server,origin;const posts=[];
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
