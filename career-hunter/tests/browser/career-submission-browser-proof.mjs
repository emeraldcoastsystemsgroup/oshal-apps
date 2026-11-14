/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Verify the two-step TLS HTTP boundary and settlement after both report replies are lost.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify fourteen counted press sequences through shipped worker permits and immutable evidence.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove document destinations and submission safety through the real sender on loopback employer forms. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
const require=createRequire(import.meta.url),queue=require('../../lib/career-submission-queue');
const {runSubmission}=require('../../lib/career-submission-browser');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN||join(root,'scripts/toolchain'),'package.json'));
const {chromium}=deps('playwright');
const noisyConfirmation=`<h1>Thank you for applying</h1><canvas width=1600 height=1000></canvas><script>const c=document.querySelector('canvas'),x=c.getContext('2d'),p=x.createImageData(c.width,c.height);let seed=17;for(let i=0;i<p.data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;p.data[i]=i%4===3?255:seed>>>24;}x.putImageData(p,0,0);</script>`;
let browser,server,origin;const posts=[];
const oldNodeEnv=process.env.NODE_ENV;
before(async()=>{
  process.env.NODE_ENV='test';
  server=http.createServer(async(req,res)=>{
    if(req.method==='POST') {
      let body='';for await(const chunk of req)body+=chunk.toString('binary');posts.push({url:req.url,body,contentType:req.headers['content-type']});
      res.setHeader('content-type','text/html; charset=utf-8');
      res.end(req.url.includes('large')?noisyConfirmation:req.url.includes('uncertain')?'<h1>Processing your request</h1>':'<h1>Thank you for applying</h1><p>Your application has been received.</p>');return;
    }
    const kind=new URL(req.url,'http://localhost').searchParams.get('kind');
    res.setHeader('content-type','text/html; charset=utf-8');
    if(kind==='applybutton'){res.end('<button onclick="location.href=\'/apply?kind=normal\'">Apply now</button>');return;}
    if(kind==='noise'){res.end(noisyConfirmation);return;}
    if(kind==='existing'){res.end('<h1>Thank you for applying</h1>');return;}
    res.end(`<!doctype html><title>Disposable employer form</title><h1>Platform Engineer</h1>
      <form method="POST" action="${kind==='external'?'http://unapproved.invalid/leak':kind==='uncertain'?'/uncertain':kind==='large'?'/large':'/accepted'}" enctype="multipart/form-data">
      <label>First name<input name="first_name" required></label>
      <label>Last name<input name="last_name" required></label>
      <label>Email address<input name="email" type="email" required></label>
      <label>State<select name="state" required><option value="">Choose</option><option value="FL">Florida</option></select></label>
      <label>${kind==='single'?'Resume / cover letter':kind==='single-unicode'?'Résumé / cover letter':'Resume'}<input name="${kind.startsWith('single')?'documents':'resume'}" type="file" accept="application/pdf" required></label>
      ${kind.startsWith('single')?'':'<label>Cover letter<input name="cover_letter" type="file" accept="application/pdf"></label>'}
      ${kind==='missing'?'<label>Required employer attestation<input name="employer_attestation" required></label>':''}
      <label>Work authorization<select name="workAuthorization" required><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      ${['continue','next','review-step','single-continue'].includes(kind)?`<button type=submit>${kind==='next'?'Next':kind==='review-step'?'Review application':'Continue'}</button>`:kind==='steps'?`<button type="button" onclick="this.disabled=true;setTimeout(()=>{this.outerHTML=\'<h2>Review your application</h2><button type=submit>Submit application</button>\'},80)">Continue</button>`:'<button type="submit">Submit application</button>'}</form>
      <form action="/newsletter"><label>Email address<input name="newsletterEmail" type="email"></label><button>Subscribe</button></form>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));
  if(oldNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldNodeEnv;});
function fixtureTask(dir,kind='normal') {
  const resume=Buffer.from('%PDF-1.7\nApproved resume packet\n%%EOF\n'),cover=Buffer.from('%PDF-1.7\nApproved cover letter\n%%EOF\n');
  writeFileSync(join(dir,'Resume_ATS.pdf'),resume);writeFileSync(join(dir,'CoverLetter.pdf'),cover);
  const profile={firstName:'Fixture',lastName:'Applicant',email:'applicant@example.test',state:'FL',workAuthorization:'Yes'};
  const input={postingId:101,url:origin+'/apply?kind='+kind,resumeSha256:queue.digest(resume),coverSha256:queue.digest(cover),
    profileSha256:queue.jsonDigest(profile),approved:true};
  const item=queue.enqueue(dir,input,{fixtureOrigin:origin}).item;
  return {version:1,...item,submissionId:item.id,profile,approved:true};
}
async function setup(t,kind='normal',hooks={}) {
  const dir=mkdtempSync(join(tmpdir(),'career-submit-browser-')),context=await browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.fallback():route.abort('blockedbyclient'));
  t.after(async()=>{await context.close();rmSync(dir,{recursive:true,force:true});});
  const page=await context.newPage(),task=fixtureTask(dir,kind);
  const before=posts.length;
  const run=()=>runSubmission(page,task,dir,{check:async()=>true,...hooks,ask:async body=>{const ok=hooks.beforeSubmit?await hooks.beforeSubmit(body):true;return ok?{permit:'c1000000-0000-0000-0000-'+String(body.step).padStart(12,'0')}:null;},report:async body=>({result:body.result,next:body.result==='advanced'&&body.step<4})},{fixtureOrigin:origin,timeoutMs:1500});
  return {page,task,dir,run,before};
}
function receivedFiles(post){
  const boundary=post.contentType.match(/boundary=(.+)$/)[1];
  return Object.fromEntries(post.body.split('--'+boundary).filter(part=>/filename="[^\"]+"/.test(part)).map(part=>{
    const at=part.indexOf('\r\n\r\n'),headers=part.slice(0,at),body=part.slice(at+4,-2);
    return [headers.match(/ name="([^\"]+)"/)[1],Buffer.from(body,'binary')];
  }));
}
test('an actual browser fills approved fields, uploads both exact PDFs and submits once with two evidence captures',async t=>{
  const f=await setup(t),result=await f.run();
  assert.equal(result.status,'submitted',result.reason);assert.equal(posts.length-f.before,1);
  const posted=posts.at(-1).body;
  for(const value of ['Fixture','Applicant','applicant@example.test','Resume_ATS.pdf','CoverLetter.pdf','Approved resume packet','Approved cover letter'])
    assert.ok(posted.includes(value),value);
  const files=receivedFiles(posts.at(-1));assert.equal(queue.digest(files.resume),f.task.resumeSha256);assert.equal(queue.digest(files.cover_letter),f.task.coverSha256);
  assert.ok(!posted.includes('newsletterEmail'),'a separate newsletter form receives no applicant values');
  assert.equal(result.screenshots,2);assert.ok(result.review.length>1000);assert.ok(result.confirmation.length>1000);
  assert.equal(result.confirmationSha256,queue.digest(result.confirmation));
  assert.ok(result.milestones.includes('employer_confirmation_visible'));
  t.diagnostic(`local fill/upload/submit/receipt ${result.elapsedMs}ms, ${result.actions} actions, ${result.screenshots} screenshots`);
});
test('unknown required employer questions stop before any final submission',async t=>{
  const f=await setup(t,'missing'),result=await f.run();
  assert.equal(result.status,'needs_you');assert.match(result.reason,/Required employer attestation/);
  assert.equal(posts.length,f.before);
});
test('a different PDF or changed applicant facts are refused before opening the employer',async t=>{
  const f=await setup(t);writeFileSync(join(f.dir,'Resume_ATS.pdf'),'%PDF-1.7\nDifferent packet, not approved\n%%EOF');
  const result=await f.run();assert.equal(result.status,'needs_you');assert.equal(result.actions,0);assert.equal(posts.length,f.before);
  f.task.profile.email='different@example.test';assert.match((await f.run()).reason,/facts or packet changed/);
});
test('the native final-click acknowledgement is required even after filling and reviewing',async t=>{
  const f=await setup(t,'normal',{beforeSubmit:async()=>false}),result=await f.run();
  assert.equal(result.status,'needs_you');assert.match(result.reason,/not authorized/);assert.equal(posts.length,f.before);
});
test('revocation after intent consumption prevents the final click and demands reconciliation',async t=>{
  let current=true;const f=await setup(t,'normal',{check:async()=>current,beforeSubmit:async()=>{current=false;return true;}});
  const result=await f.run();assert.equal(result.status,'unknown');assert.equal(posts.length,f.before);
});
test('an uncertain response after a final click is never retried or called submitted',async t=>{
  const f=await setup(t,'uncertain'),result=await f.run();
  assert.equal(result.status,'unknown');assert.equal(posts.length-f.before,1);assert.equal(result.confirmation,undefined);
});
test('a preexisting receipt does not count as a new application',async t=>{
  const f=await setup(t,'existing'),result=await f.run();assert.equal(result.status,'needs_you');
  assert.match(result.reason,/already shows/);assert.equal(posts.length,f.before);
});
test('a form targeting an unapproved recipient is refused before applicant values are filled',async t=>{
  const f=await setup(t,'external'),result=await f.run();assert.equal(result.status,'needs_you');
  assert.match(result.reason,/another site/);assert.equal(posts.length,f.before);
  assert.equal(await f.page.locator('[name=email]').inputValue(),'');
});


test('a delayed next step retains the approved PDF and completes the permitted form',async t=>{
  const f=await setup(t,'steps'),result=await f.run();
  assert.equal(result.status,'submitted',result.reason);assert.equal(posts.length-f.before,1);
  assert.ok(posts.at(-1).body.includes('Resume_ATS.pdf'));
});


test('a missing employer question can be answered explicitly in a newly approved packet',async t=>{
  const f=await setup(t,'missing');
  const node='da000000-0000-0000-0000-000000000001';
  const held=queue.claim(f.dir,f.task.submissionId,node,f.task.packetDigest);
  const first=await f.run();assert.equal(first.status,'needs_you');
  queue.transition(f.dir,held.id,node,held.claimToken,'needs_you',{reason:first.reason});
  assert.equal(first.questions.length,1);assert.equal(first.questions[0].text,'Required employer attestation');
  f.task.profile[first.questions[0].id]='The applicant supplied this exact answer.';
  f.task.profileSha256=queue.jsonDigest(f.task.profile);
  const next=queue.enqueue(f.dir,{...f.task,approved:true},{fixtureOrigin:origin}).item;
  Object.assign(f.task,next,{submissionId:next.id});
  const second=await f.run();assert.equal(second.status,'submitted',second.reason);
  assert.equal(posts.length-f.before,1);assert.ok(posts.at(-1).body.includes('The applicant supplied this exact answer.'));
});

test('a lost press-permit acknowledgement is unknown even when no final click was observed',async t=>{
  const f=await setup(t,'normal',{beforeSubmit:async()=>{throw Error('lost acknowledgement');}}),result=await f.run();
  assert.equal(result.status,'unknown');assert.equal(posts.length,f.before);assert.match(result.reason,/lost acknowledgement/);
});

test('the device worker retains actual evidence and recovers a lost result acknowledgement without reopening the employer',async t=>{
  const {execute,recover}=require('../../lib/career-browser-worker');
  const f=await setup(t),generation=Array(32).fill(7),envelope={id:f.task.id,owner:'owner',tenant:'tenant',bot:'browser-bot'};
  const task={...f.task,documents:{'Resume_ATS.pdf':require('node:fs').readFileSync(join(f.dir,'Resume_ATS.pdf')).toString('base64'),
    'CoverLetter.pdf':require('node:fs').readFileSync(join(f.dir,'CoverLetter.pdf')).toString('base64')}};
  const bound={version:1,intentId:f.task.id,origin,expiresAt:Date.now()+300000,maxPresses:task.maxPresses,task};
  const input={...bound,requestDigest:queue.jsonDigest(bound)},bytes=Buffer.from(JSON.stringify(input));
  const permit='c1000000-0000-0000-0000-000000000001';let permits=0,results=0,retained,first=true;
  const call=async(suffix,body)=>{
    if(suffix.endsWith('/input'))return {version:1,executor:'browser-form-v1',envelope,files:[{path:'browser-task.json',bytes:[...bytes],digest:[...Buffer.from(queue.digest(bytes),'hex')]}],limits:{wall_ms:30000,artifact_bytes:2097152}};
    if(suffix.endsWith('/browser-progress')){if(body.phase==='press'){permits++;return {current:true,phase:'press',step:body.step,permit};}if(body.phase==='pressed')return {current:true,phase:'pressed',step:body.step,result:body.result,next:body.result==='advanced'};return {current:true};}
    if(suffix.endsWith('/check'))return {current:true};
    if(suffix.endsWith('/result')){results++;if(retained)assert.deepEqual(body,retained);else retained=body;
      if(first){first=false;throw Error('employer already accepted; result acknowledgement lost');}return {accepted:true};}
    assert.fail('Unexpected native call '+suffix);
  };
  await assert.rejects(execute(call,envelope,f.page.context(),{generation,root:f.dir,fixtureOrigin:origin,timeoutMs:1500}),/worker_result_pending/);
  assert.equal(permits,1);assert.equal(posts.length-f.before,1);assert.equal(results,1);
  const answer=JSON.parse(retained.answer);assert.equal(answer.outcome,'completed');assert.equal(answer.permit,permit);
  const evidence=retained.artifacts.find(a=>a.path==='confirmation.png');assert.ok(evidence.bytes.length>1000);assert.equal(Buffer.from(evidence.digest).toString('hex'),answer.confirmationSha256);
  await recover(call,f.dir);assert.equal(results,2);assert.equal(posts.length-f.before,1);assert.equal(permits,1);
});

test('one combined upload receives only the exact resume and reports the omitted cover letter',async t=>{
  const f=await setup(t,'single'),result=await f.run();
  assert.equal(result.status,'submitted',result.reason);assert.equal(posts.length-f.before,1);
  assert.ok(posts.at(-1).body.includes('Approved resume packet'));
  assert.ok(!posts.at(-1).body.includes('Approved cover letter'));
  assert.equal(queue.digest(receivedFiles(posts.at(-1)).documents),f.task.resumeSha256);
  assert.deepEqual(result.documentWarnings,['The cover letter had no place to go; only the résumé was attached.']);
});

test('Continue that accepts an application completes with one permitted press',async t=>{
  let permits=0;const f=await setup(t,'continue',{beforeSubmit:async()=>{permits++;return permits===1;}});
  const result=await f.run();assert.equal(result.status,'submitted',result.reason);
  assert.equal(permits,1);assert.equal(posts.length-f.before,1);
  assert.equal(result.presses[0].result,'confirmed');
});
test('a refused permit prevents Continue from posting any application',async t=>{
  const f=await setup(t,'continue',{beforeSubmit:async()=>false}),result=await f.run();
  assert.equal(posts.length,f.before);assert.equal(result.status,'needs_you');
});
test('a two-step Continue and Submit each consume their own permit',async t=>{
  let permits=0;const f=await setup(t,'steps',{beforeSubmit:async()=>{permits++;return true;}});
  const result=await f.run();assert.equal(permits,2);assert.equal(result.status,'submitted');
  assert.equal(posts.length-f.before,1);assert.deepEqual(result.presses.map(p=>p.result),['advanced','confirmed']);
});

async function executeFixture(f,limit=2097152) {
  const {execute}=require('../../lib/career-browser-worker'),fs=require('node:fs');
  const task={...f.task,documents:Object.fromEntries(['Resume_ATS.pdf','CoverLetter.pdf'].map(name=>[name,fs.readFileSync(join(f.dir,name)).toString('base64')]))};
  const bound={version:1,intentId:task.id,origin,expiresAt:Date.now()+300000,maxPresses:task.maxPresses,task};
  const bytes=Buffer.from(JSON.stringify({...bound,requestDigest:queue.jsonDigest(bound)}));
  const envelope={id:task.id,owner:'fixture-owner',tenant:'fixture-tenant',bot:'fixture-browser'};
  let retained,failed=0,permits=0;
  const call=async(suffix,body)=>{
    if(suffix.endsWith('/input'))return {version:1,executor:'browser-form-v1',envelope,files:[{path:'browser-task.json',bytes:[...bytes],digest:[...Buffer.from(queue.digest(bytes),'hex')]}],limits:{wall_ms:30000,artifact_bytes:limit}};
    if(suffix.endsWith('/browser-progress')){if(body.phase==='press'){permits++;return {current:true,phase:'press',step:body.step,permit:'c1000000-0000-0000-0000-'+String(body.step).padStart(12,'0')};}if(body.phase==='pressed')return {current:true,phase:'pressed',step:body.step,result:body.result,next:body.result==='advanced'&&body.step<4};return {current:true};}
    if(suffix.endsWith('/check'))return {current:true};
    if(suffix.endsWith('/result')){
      const answer=JSON.parse(body.answer);
      assert.deepEqual(Object.keys(answer).sort(),['version','intentId','requestDigest','outcome','permit','confirmationArtifact','confirmationSha256','data'].sort(),'kernel BrowserAnswer is a closed contract');
      assert.ok(body.artifacts.every(a=>['answer.md','review.png','confirmation.png',...Array.from({length:6},(_,i)=>'press-'+(i+1)+'.png')].includes(a.path)),'kernel artifact names stay declared');
      retained=body;return {accepted:true};
    }
    if(suffix.endsWith('/failed')){failed++;return {};}
    assert.fail(suffix);
  };
  const result=await execute(call,envelope,f.page.context(),{generation:Array(32).fill(7),root:f.dir,fixtureOrigin:origin,timeoutMs:1500});
  return {retained,result,failed,permits};
}
test('an unknown native result keeps a hash-checked picture for the owners outcome review',async t=>{
  const f=await setup(t,'uncertain'),{retained,result}=await executeFixture(f);
  assert.equal(result.status,'unknown');const answer=JSON.parse(retained.answer);
  assert.equal(answer.data.presses[0].result,'unknown');
  const picture=retained.artifacts.find(a=>a.path==='press-1.png');assert.ok(picture.bytes.length>1000);
  assert.equal(queue.digest(Buffer.from(picture.bytes)),answer.data.presses[0].afterSha256);
  assert.equal(posts.length-f.before,1);
});

test('a confirmation larger than two MiB stays completed with its actual bounded PNG and digest',async t=>{
  const f=await setup(t,'large');await f.page.goto(origin+'/apply?kind=noise');
  const raw=await f.page.screenshot({type:'png'});assert.ok(raw.length>2097152,'fixture must exceed the native artifact limit');
  const {retained,result,failed,permits}=await executeFixture(f);
  assert.equal(result.status,'submitted');assert.equal(failed,0);assert.equal(permits,1);assert.equal(posts.length-f.before,1);
  const answer=JSON.parse(retained.answer),picture=retained.artifacts.find(a=>a.path==='confirmation.png');
  assert.equal(answer.outcome,'completed');assert.ok(picture.bytes.length>1000);assert.ok(picture.bytes.length<raw.length);
  assert.equal(queue.digest(Buffer.from(picture.bytes)),answer.confirmationSha256);
  assert.equal(answer.data.confirmationSha256,answer.confirmationSha256);
  assert.ok(retained.artifacts.reduce((n,a)=>n+a.bytes.length,0)<=2097152);
  assert.ok(picture.bytes.length<Math.floor(2097152/5),'picture fixed within its share before reporting');
  await f.page.setContent('<img alt="retained">');
  await f.page.locator('img').evaluate((img,base64)=>{img.src='data:image/png;base64,'+base64;},Buffer.from(picture.bytes).toString('base64'));
  assert.ok(await f.page.locator('img').evaluate(img=>img.decode().then(()=>img.naturalWidth>0)),'bounded bytes decode as a real PNG');
});

for(const kind of ['next','review-step','applybutton'])test(`${kind} also needs a permit for each press`,async t=>{
  let permits=0;const f=await setup(t,kind,{beforeSubmit:async()=>{permits++;return true;}}),result=await f.run();
  assert.equal(result.status,'submitted');assert.equal(permits,kind==='applybutton'?2:1);assert.equal(posts.length-f.before,1);
  const refused=await setup(t,kind,{beforeSubmit:async()=>false}),no=await refused.run();
  assert.equal(no.status,'needs_you');assert.equal(posts.length,refused.before);
});

test('an accented combined document label also receives the resume without a name hint',async t=>{
  const f=await setup(t,'single-unicode'),result=await f.run();assert.equal(result.status,'submitted',result.reason);
  assert.equal(queue.digest(receivedFiles(posts.at(-1)).documents),f.task.resumeSha256);
  assert.equal(result.documentWarnings.length,1);
});

test('a combined upload reports the missing cover destination when Continue confirms receipt',async t=>{
  const f=await setup(t,'single-continue'),result=await f.run();assert.equal(result.status,'submitted');
  assert.match(result.reason,/cover letter had no place to go/);assert.equal(result.documentWarnings.length,1);
  assert.equal(queue.digest(receivedFiles(posts.at(-1)).documents),f.task.resumeSha256);
});

const pressFixture=require('./career-press-fixtures.cjs');
const cases=[
  ['two steps Continue then Submit','two',{},['continue','submit'],['advanced','confirmed'],1,'completed'],
  ['Apply then Submit','two',{opening:true},['open','submit'],['advanced','confirmed'],1,'completed'],
  ['Continue itself submits','continue-receipt',{},['continue'],['confirmed'],1,'completed'],
  ['Saving leaves same step','saving',{},['continue'],['unknown'],0,'unknown'],
  ['five steps bound at four','five',{},Array(4).fill('continue'),Array(4).fill('advanced'),0,'unknown'],
  ['redirect blocked between steps','redirect',{},['continue'],['left_site'],0,'unknown'],
  ['Apply then unanswered question','question',{opening:true},['open'],['advanced'],0,'needs_review'],
  ['Continue then unanswered question','question',{},['continue'],['advanced'],0,'unknown'],
  ['second ask refused','two',{refuseSecond:true},['continue','submit'],['advanced'],0,'unknown'],
  ['second ask reply lost','two',{loseAsk:true},['continue','submit'],['advanced'],0,'unknown'],
  ['first report reply lost','two',{loseReport:true},['continue','submit'],['advanced','confirmed'],1,'completed'],
  ['cookies cleared for approved host only','single',{cookies:true},['submit'],['confirmed'],1,'completed'],
  ['large confirming picture fixed before digest','large',{},['continue','submit'],['advanced','confirmed'],1,'completed'],
  ['every ask refused','single',{refuseAll:true},['submit'],[],0,'needs_review'],
];
for(const [index,[name,kind,options,kinds,results,applications,outcome]]of cases.entries())test(`press case ${index+1}: ${name}`,async t=>{
  const f=await pressFixture.run(t,browser,kind,options);
  assert.deepEqual(f.native.asks.map(a=>a.kind),kinds);assert.deepEqual(f.native.reports.map(r=>r.result),results);
  assert.equal(f.fixture.applications,applications);assert.equal(f.answer.outcome,outcome);assert.equal(f.fixture.otherRequests,0);
  if(options.refuseSecond||options.loseAsk)assert.equal(f.fixture.presses.length,1);
  if(options.loseReport)assert.equal(f.native.rawReports[0],f.native.rawReports[1]);
  if(kind==='question')assert.match(f.answer.data.questions[0].text,/Required employer attestation/);
  if(kind==='large')assert.ok(f.answer.data.pictureResized);
});

test('new helper keeps an older one-press packet digest and input unchanged',async t=>{
  const f=await setup(t);delete f.task.maxPresses;
  const {maxPresses,...bound}=queue.binding(f.task,origin);f.task.packetDigest=queue.jsonDigest(bound);
  const before=JSON.stringify(f.task),result=await f.run();
  assert.equal(result.status,'submitted',result.reason);assert.equal(JSON.stringify(f.task),before);assert.equal(result.presses.length,1);
});

test('two-step TLS employer variant crosses the shipped HTTP client with isolated native permits',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'career-two-step-http-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const profile={firstName:'Fixture',lastName:'Applicant',email:'fixture@example.test'},documents={
    'Resume_ATS.pdf':Buffer.from('%PDF-1.7\nApproved native resume\n%%EOF').toString('base64'),
    'CoverLetter.pdf':Buffer.from('%PDF-1.7\nApproved native cover\n%%EOF').toString('base64')};
  const binding=queue.binding({postingId:102,url:'https://jobs.example.com/apply',resumeSha256:queue.digest(Buffer.from(documents['Resume_ATS.pdf'],'base64')),
    coverSha256:queue.digest(Buffer.from(documents['CoverLetter.pdf'],'base64')),profileSha256:queue.jsonDigest(profile)});
  const id='b2000000-0000-0000-0000-000000000001',task={version:1,mode:'submit',approved:true,...binding,submissionId:id,packetDigest:queue.jsonDigest(binding),profile,documents};
  const bound={version:1,intentId:id,origin:'https://jobs.example.com',maxPresses:4,expiresAt:Date.now()+300000,task};
  const input={...bound,requestDigest:queue.jsonDigest(bound)},bytes=Buffer.from(JSON.stringify(input)),envelope={id,owner:'fixture',tenant:'fixture',bot:'fixture'};
  const asks=[],reports=[];let output;
  const kernel=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());res.setHeader('content-type','application/json');
    if(req.url.endsWith('/input'))return res.end(JSON.stringify({version:1,executor:'browser-form-v1',envelope,files:[{path:'browser-task.json',bytes:[...bytes],digest:[...Buffer.from(queue.digest(bytes),'hex')]}],limits:{wall_ms:30000,artifact_bytes:2097152}}));
    if(req.url.endsWith('/browser-progress')&&body.phase==='press'){asks.push(body);return res.end(JSON.stringify({current:true,phase:'press',step:body.step,permit:'c2000000-0000-0000-0000-'+String(body.step).padStart(12,'0')}));}
    if(req.url.endsWith('/browser-progress')&&body.phase==='pressed'){reports.push(body);return res.end(JSON.stringify({current:true,phase:'pressed',step:body.step,result:body.result,next:body.result==='advanced'}));}
    if(req.url.endsWith('/result'))output=body;
    res.end(JSON.stringify({current:true}));
  });
  await new Promise(r=>kernel.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>kernel.close(r)));
  const prior=process.env.STORE_CI_TOOLCHAIN;process.env.STORE_CI_TOOLCHAIN=join(root,'scripts/toolchain');
  let result;try{result=await require('./career-native-worker-fixture.cjs').run({kernelUrl:'http://127.0.0.1:'+kernel.address().port,nodeId:'d2000000-0000-0000-0000-000000000001',deviceToken:'fixture-token-never-a-real-credential',envelope,generation:Array(32).fill(7),workDir:dir,twoStep:true,approvedDocuments:documents});}
  finally{if(prior===undefined)delete process.env.STORE_CI_TOOLCHAIN;else process.env.STORE_CI_TOOLCHAIN=prior;}
  assert.equal(result.posts,1);assert.equal(result.presses,2);assert.deepEqual(asks.map(a=>a.kind),['continue','submit']);assert.deepEqual(reports.map(r=>r.result),['advanced','confirmed']);
  assert.equal(JSON.parse(output.answer).outcome,'completed');
  for(const report of reports){assert.equal(report.permit,'c2000000-0000-0000-0000-'+String(report.step).padStart(12,'0'));const name=report.step===2?'confirmation.png':'press-1.png';assert.equal(queue.digest(Buffer.from(output.artifacts.find(a=>a.path===name).bytes)),report.afterSha256);}
});

test('two lost report replies omit unacknowledged pictures so unknown can still settle',async t=>{
  const f=await pressFixture.run(t,browser,'two',{loseBothReports:true});
  assert.equal(f.answer.outcome,'unknown');assert.equal(f.fixture.presses.length,1);assert.equal(f.native.asks.length,1);
  assert.equal(f.native.rawReports.length,2);assert.equal(f.native.rawReports[0],f.native.rawReports[1]);
  assert.equal(f.output.artifacts.some(a=>a.path==='press-1.png'),false);
});
