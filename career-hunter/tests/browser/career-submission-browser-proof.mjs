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
let browser,server,origin;const posts=[];
const oldNodeEnv=process.env.NODE_ENV;
before(async()=>{
  process.env.NODE_ENV='test';
  server=http.createServer(async(req,res)=>{
    if(req.method==='POST') {
      let body='';for await(const chunk of req)body+=chunk.toString('binary');posts.push({url:req.url,body});
      res.setHeader('content-type','text/html');
      res.end(req.url.includes('uncertain')?'<h1>Processing your request</h1>':'<h1>Thank you for applying</h1><p>Your application has been received.</p>');return;
    }
    const kind=new URL(req.url,'http://localhost').searchParams.get('kind');
    res.setHeader('content-type','text/html');
    if(kind==='existing'){res.end('<h1>Thank you for applying</h1>');return;}
    res.end(`<!doctype html><title>Disposable employer form</title><h1>Platform Engineer</h1>
      <form method="POST" action="${kind==='external'?'http://unapproved.invalid/leak':kind==='uncertain'?'/uncertain':'/accepted'}" enctype="multipart/form-data">
      <label>First name<input name="first_name" required></label>
      <label>Last name<input name="last_name" required></label>
      <label>Email address<input name="email" type="email" required></label>
      <label>State<select name="state" required><option value="">Choose</option><option value="FL">Florida</option></select></label>
      <label>Resume<input name="resume" type="file" accept="application/pdf" required></label>
      <label>Cover letter<input name="cover_letter" type="file" accept="application/pdf"></label>
      ${kind==='missing'?'<label>Required employer attestation<input name="employer_attestation" required></label>':''}
      <label>Work authorization<select name="workAuthorization" required><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      ${kind==='steps'?`<button type="button" onclick="this.disabled=true;setTimeout(()=>{this.outerHTML=\'<h2>Review your application</h2><button type=submit>Submit application</button>\'},80)">Continue</button>`:'<button type="submit">Submit application</button>'}</form>
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
  t.after(async()=>{await context.close();rmSync(dir,{recursive:true,force:true});});
  const page=await context.newPage(),task=fixtureTask(dir,kind);
  const before=posts.length;
  const run=()=>runSubmission(page,task,dir,{check:async()=>true,beforeSubmit:async()=>true,...hooks},{fixtureOrigin:origin,timeoutMs:1500});
  return {page,task,dir,run,before};
}
test('an actual browser fills approved fields, uploads both exact PDFs and submits once with two evidence captures',async t=>{
  const f=await setup(t),result=await f.run();
  assert.equal(result.status,'submitted',result.reason);assert.equal(posts.length-f.before,1);
  const posted=posts.at(-1).body;
  for(const value of ['Fixture','Applicant','applicant@example.test','Resume_ATS.pdf','CoverLetter.pdf','Approved resume packet','Approved cover letter'])
    assert.ok(posted.includes(value),value);
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


test('a delayed next step is awaited by page state and the approved PDF remains attached',async t=>{
  const f=await setup(t,'steps'),result=await f.run();
  assert.equal(result.status,'submitted',result.reason);assert.equal(posts.length-f.before,1);
  assert.ok(posts.at(-1).body.includes('Approved resume packet'));
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

test('a lost final-permit acknowledgement is unknown even when no final click was observed',async t=>{
  const f=await setup(t,'normal',{beforeSubmit:async()=>{throw Error('lost acknowledgement');}}),result=await f.run();
  assert.equal(result.status,'unknown');assert.equal(posts.length,f.before);assert.match(result.reason,/acknowledgement was lost/);
});

test('the device worker retains actual evidence and recovers a lost result acknowledgement without reopening the employer',async t=>{
  const {execute,recover}=require('../../lib/career-browser-worker');
  const f=await setup(t),generation=Array(32).fill(7),envelope={id:f.task.id,owner:'owner',tenant:'tenant',bot:'browser-bot'};
  const task={...f.task,documents:{'Resume_ATS.pdf':require('node:fs').readFileSync(join(f.dir,'Resume_ATS.pdf')).toString('base64'),
    'CoverLetter.pdf':require('node:fs').readFileSync(join(f.dir,'CoverLetter.pdf')).toString('base64')}};
  const bound={version:1,intentId:f.task.id,origin,expiresAt:Date.now()+300000,task};
  const input={...bound,requestDigest:queue.jsonDigest(bound)},bytes=Buffer.from(JSON.stringify(input));
  const permit='c1000000-0000-0000-0000-000000000001';let permits=0,results=0,retained,first=true;
  const call=async(suffix,body)=>{
    if(suffix.endsWith('/input'))return {version:1,executor:'browser-form-v1',envelope,files:[{path:'browser-task.json',bytes:[...bytes],digest:[...Buffer.from(queue.digest(bytes),'hex')]}],limits:{wall_ms:30000,artifact_bytes:2097152}};
    if(suffix.endsWith('/browser-progress')){if(body.phase==='submitting'){permits++;return {current:true,permit};}return {current:true};}
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
