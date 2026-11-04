/** Prepared packet -> native approval/worker/evidence -> status -> read-only mailbox. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const {run}=require('./career-native-worker-fixture.cjs');
const worker=require('../../lib/career-browser-worker');
async function main(){
  const s=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  assert.equal(s.testOnly,true);assert.ok(s.dataRoot.startsWith('/tmp/oshal-owned-career-'));
  const deps=createRequire(path.resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'));
  const {chromium}=deps('playwright'),dbSource=fs.readFileSync(path.join(__dirname,'../../engine/jobhunter/db.py'),'utf8');
  const ownerDir=path.join(s.dataRoot,s.tenant,'people',s.principal,'data'),packet=path.join(ownerDir,'applications/Fixture__101');
  fs.mkdirSync(packet,{recursive:true});
  const browser=await chromium.launch({headless:true});let resume,cover;
  try{
    const page=await browser.newPage();
    await page.setContent('<h1>Fixture Applicant</h1><h2>Approved native resume</h2><p>Built Python test automation at Fixture Employer.</p>');resume=await page.pdf({format:'Letter'});
    await page.setContent('<h1>Approved native cover</h1><p>I built Python test automation at Fixture Employer.</p>');cover=await page.pdf({format:'Letter'});
  }finally{await browser.close();}
  fs.writeFileSync(path.join(packet,'Resume_ATS.pdf'),resume);fs.writeFileSync(path.join(packet,'CoverLetter.pdf'),cover);
  fs.writeFileSync(path.join(ownerDir,'career_db.json'),JSON.stringify({profile:{name:'Fixture Applicant',email:'fixture@example.test'},roles:[{title:'Engineer',org:'Fixture Employer',start:'2020',end:'2024',deliverables:['Built Python test automation.']}]}));
  fs.writeFileSync(path.join(ownerDir,'apply_profile.json'),JSON.stringify({firstName:'Fixture',lastName:'Applicant',email:'fixture@example.test'}));
  const seed=`import sqlite3,json,sys,pathlib,datetime
r=pathlib.Path(sys.argv[1]);sub=sys.argv[2];schema=json.loads(sys.argv[3]);corpus=r.parents[2]/'corpus.db'
c=sqlite3.connect(corpus);c.executescript(schema[0].replace('corpus.',''));now=datetime.datetime.now(datetime.timezone.utc).isoformat()
c.execute("INSERT INTO companies(id,name) VALUES(1,'Fixture Employer')")
c.execute("INSERT INTO postings_corpus(id,company_id,ats_job_id,title,description,url,active,target_role,remote,first_seen_at,posted_date) VALUES(101,1,'owned-101','Platform Engineer','Build Python test automation.','https://jobs.example.com/apply',1,1,1,?,?)",(now,now));c.commit();c.close()
d=sqlite3.connect(r/('user-'+sub+'.db'));d.executescript(schema[1]);prefix='/career/default/'+sub+'/applications/Fixture__101/'
d.execute("INSERT INTO user_signals(posting_id,status,ai_fit_score,resume_path,cover_path,generated_at) VALUES(101,'generated',90,?,?,?)",(prefix+'Resume_ATS.pdf',prefix+'CoverLetter.pdf',now));d.commit();d.close()`;
  const schemas=['CORPUS_SCHEMA','USER_SCHEMA'].map(name=>{const m=dbSource.match(new RegExp(name+'\\s*=\\s*"""([\\s\\S]*?)"""'));assert.ok(m,name);return m[1];});
  execFileSync('python3',['-c',seed,ownerDir,s.owner,JSON.stringify(schemas)],{stdio:'pipe'});
  const calls=[];
  const transport=worker.client(s);
  await transport('heartbeat',{generation:s.generation});
  const api=async(route,body,token=s.owner)=>{
    calls.push({route,method:body===undefined?'GET':'POST'});
    const response=await fetch(s.kernelUrl+'/api/career-hunter'+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,200,route+': '+JSON.stringify(data));return data;
  };
  const library=await api('/experience-bank');assert.equal(library.entries.length,0);
  const bank=await api('/experience-bank',{operation:'save',expectedRevision:library.revision,entry:{title:'Owned teaching project',kind:'volunteer',organization:'Owned school',period:'2024',facts:'Taught Python workshops.',skills:['Python']}});
  assert.equal(bank.entries.length,1);assert.equal((await api('/experience-bank',undefined,s.other)).entries.length,0,'additional experience belongs to the original owner');
  const summary=await api('/experience-bank?summary=1');assert.equal(summary.entries[0].facts,undefined);assert.equal(summary.entries[0].title,'Owned teaching project');
  await api('/jobs/101/status',{status:'applied'});
  const otherCorrection=await fetch(s.kernelUrl+'/api/career-hunter/jobs/101/status',{method:'POST',headers:{authorization:'Bearer '+s.other,'content-type':'application/json'},body:JSON.stringify({correction:'undo-manual-submission',reason:'Owned fixture correction.'})});
  assert.equal(otherCorrection.status,404,'another owner cannot undo this manual mark');
  const corrected=await api('/jobs/101/status',{correction:'undo-manual-submission',reason:'Owned fixture: marked submitted by mistake.'});assert.equal(corrected.status,'generated');
  const correctedJob=(await api('/jobs/101')).job;assert.equal(correctedJob.status,'generated');assert.equal(correctedJob.board.statusCorrections.length,1);assert.equal(correctedJob.board.statusCorrections[0].from.source,'manual-mark');
  const packetAfterCorrection=await fetch(s.kernelUrl+'/api/career-hunter/resume?id=101&kind=resume',{headers:{authorization:'Bearer '+s.owner}});assert.equal(packetAfterCorrection.status,200);assert.ok(Buffer.from(await packetAfterCorrection.arrayBuffer()).equals(resume),'status correction keeps the exact packet');
  const promotion=await api('/jobs/101/status',{status:'promoted',favorite:true});assert.equal(promotion.status,'promoted');
  const queued=(await api('/jobs/101')).job;assert.equal(queued.board.phase,'queued');assert.equal(queued.has_resume,1,'moving an existing packet does not regenerate it');assert.equal(queued.board.requestId==null,true,'promotion starts no generation request');
  const available=await api('/jobs?lane=all');assert.ok(available.jobs.some(j=>j.id===101));assert.equal(available.starredCount,1);assert.equal(available.jobs[0].favorite,true);
  const hidden=await api('/jobs/101/status',{feedback:{kind:'company'}});assert.equal(hidden.exclusions.length,1);
  assert.equal((await api('/jobs?lane=all')).jobs.length,0,'owner company feedback applies before paging');
  assert.equal((await api('/browse')).jobs.length,0,'open search shares saved feedback');
  assert.equal((await api('/browse',undefined,s.other)).jobs.length,1,'another owner retains the same shared posting');
  await api('/jobs/101/status',{feedback:{remove:hidden.exclusions[0].id}});
  assert.equal((await api('/jobs?lane=all')).jobs.length,1,'removing feedback restores the opening');
  const durable=await api('/jobs/101/status',{draft:{revision:0,guidance:'',experienceIds:[],experienceRevision:bank.revision}});assert.equal(durable.application.draft.revision,1);
  const otherDraft=await fetch(s.kernelUrl+'/api/career-hunter/jobs/101',{headers:{authorization:'Bearer '+s.other}});assert.equal(otherDraft.status,404,'an owner without a saved job cannot read this draft');
  const changedDraft=await api('/jobs/101/status',{draft:{revision:1,guidance:'Owned draft change needs regeneration.',experienceIds:[],experienceRevision:bank.revision}});assert.equal(changedDraft.application.documentsOutdated,true);
  const outdated=await fetch(s.kernelUrl+'/api/career-hunter/submission-review/101',{headers:{authorization:'Bearer '+s.owner}});assert.equal(outdated.status,409,'the server refuses an outdated packet');
  const stale=await fetch(s.kernelUrl+'/api/career-hunter/jobs/101/status',{method:'POST',headers:{authorization:'Bearer '+s.owner,'content-type':'application/json'},body:JSON.stringify({draft:{revision:1,guidance:'Stale tab',experienceIds:[],experienceRevision:bank.revision}})});assert.equal(stale.status,409,'stale tab cannot overwrite the draft');
  await api('/jobs/101/status',{draft:{revision:2,guidance:'',experienceIds:[],experienceRevision:bank.revision}});
  const applicationPage=await fetch(s.kernelUrl+'/api/career-hunter/board-native?view=queue&application=101',{headers:{authorization:'Bearer '+s.owner}});assert.equal(applicationPage.status,200);assert.match(await applicationPage.text(),/career-application\.js/);
  const review=await api('/submission-review/101');
  assert.equal(review.title,'Platform Engineer');assert.equal(review.documents[0].byteLength,resume.length);
  const retiredApproval=await api('/submission-queue',{postingId:101,approved:true,packetDigest:review.packetDigest});const retiredTicket=(await api('/submission-queue/'+retiredApproval.item.id+'/bind',{})).item.nativeTicketId;
  const otherCancel=await fetch(s.kernelUrl+'/api/career-hunter/submission-queue/'+retiredApproval.item.id+'/cancel',{method:'POST',headers:{authorization:'Bearer '+s.other,'content-type':'application/json'},body:'{}'});assert.equal(otherCancel.status,404);
  const needCancel=await fetch(s.kernelUrl+'/api/career-hunter/submission-queue/'+retiredApproval.item.id+'/cancel',{method:'POST',headers:{authorization:'Bearer '+s.owner,'content-type':'application/json'},body:'{}'});assert.equal(needCancel.status,409);assert.equal((await needCancel.json()).code,'native_cancel_required');
  const confirmation=await(await fetch(s.kernelUrl+'/confirmations',{method:'POST',headers:{authorization:'Bearer '+s.owner}})).json();assert.ok(confirmation.confirmation);
  const cancelNative=await fetch(s.kernelUrl+'/tickets/'+retiredTicket+'/cancel',{method:'POST',headers:{authorization:'Bearer '+s.owner,'x-oshal-confirm':confirmation.confirmation}});assert.equal(cancelNative.status,200,await cancelNative.text());
  assert.equal((await api('/submission-queue/'+retiredApproval.item.id+'/cancel',{})).item.status,'cancelled');
  const approved=await api('/submission-queue',{postingId:101,approved:true,packetDigest:review.packetDigest});
  const id=approved.item.id;assert.ok(id);
  assert.equal((await api('/submission-queue',{postingId:101,approved:true,packetDigest:review.packetDigest})).item.id,id);
  // Start from the real activity UI after approval was published but its next
  // request never happened. Drop the successful start acknowledgement to prove
  // that the page recovers the existing work instead of creating another intent.
  const uiBrowser=await chromium.launch({headless:true});let started,lostStartAck=false;
  try{
    const context=await uiBrowser.newContext({extraHTTPHeaders:{authorization:'Bearer '+s.owner}});
    const page=await context.newPage();const mutations=[];
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==new URL(s.kernelUrl).origin)return route.abort();
      if(request.method()==='POST')mutations.push(url.pathname);
      if(url.pathname==='/api/career-hunter/submission-queue/'+id+'/start'){
        assert.equal(lostStartAck,false,'the UI must not repeat an unacknowledged start');
        const response=await route.fetch();assert.equal(response.status(),200,await response.text());
        lostStartAck=true;return route.abort();
      }
      return route.continue();
    });
    await page.goto(s.kernelUrl+'/api/career-hunter/submissions');
    await page.getByRole('button',{name:'Resume approved submission',exact:true}).click();
    await page.getByText('Approved and waiting for your browser worker.',{exact:true}).waitFor();
    assert.match(await page.locator('#submissionNotice').innerText(),/connection interrupted/);
    assert.equal(mutations.filter(x=>x.endsWith('/bind')).length,1);
    assert.equal(mutations.filter(x=>x.endsWith('/start')).length,1);
    assert.equal(mutations.filter(x=>x==='/api/career-hunter/submission-queue').length,0,'no replacement approval');
    const items=(await api('/submission-queue')).items.filter(item=>item.status!=='cancelled');assert.equal(items.length,1);
    started={item:items[0]};assert.equal(started.item.id,id);assert.ok(started.item.nativeTicketId);assert.ok(started.item.nativeWorkId);
  }finally{await uiBrowser.close();}
  const claimed=await transport('claim',{token:s.deviceToken,bot:s.bot});
  assert.equal(claimed.envelope.id,started.item.nativeWorkId);
  const result=await run({...s,envelope:claimed.envelope,approvedDocuments:{resume:resume.toString('base64'),cover:cover.toString('base64')}});
  assert.equal(result.posts,1);assert.equal(result.status,'submitted');
  const synced=await api('/submission-queue/'+id+'/sync',{});
  assert.equal(synced.item.status,'submitted');assert.ok(synced.item.confirmationSha256);
  const protectedCorrection=await fetch(s.kernelUrl+'/api/career-hunter/jobs/101/status',{method:'POST',headers:{authorization:'Bearer '+s.owner,'content-type':'application/json'},body:JSON.stringify({correction:'undo-manual-submission',reason:'Owned guard check.'})});assert.equal(protectedCorrection.status,409,'actual worker submission evidence cannot be reset');
  const applied=await api('/jobs?status=tracked&days=all');
  const text=JSON.stringify(applied);assert.ok(text.includes('worker-reported')&&text.includes('applied'),text);
  const checked=await api('/jobs/updates/check',{});
  assert.equal(checked.status,'connected',JSON.stringify(checked));assert.equal(checked.events[0].kind,'interview');
  const tracked=await api('/jobs?status=tracked&days=all');
  assert.ok(JSON.stringify(tracked).includes('interview'),JSON.stringify(tracked));
  assert.equal((await api('/submission-queue/'+id+'/sync',{})).item.status,'submitted');
  const denied=await fetch(s.kernelUrl+'/api/career-hunter/submission-queue/'+id+'/sync',{method:'POST',headers:{authorization:'Bearer '+s.other,'content-type':'application/json'},body:'{}'});
  assert.equal(denied.status,404,'a second owner cannot reconcile the first owner’s intent');
  const other=await api('/submission-queue',undefined,s.other);
  assert.equal(other.items.length,0,'another original owner has no submission intents');
  process.stdout.write(JSON.stringify({surfaceHeaders:Object.fromEntries([...applicationPage.headers].filter(([key])=>/^(content-type|content-security-policy|x-frame-options|cache-control)$/.test(key))),durableDraftOwnerIsolated:true,outdatedPacketRefused:true,staleDraftRefused:true,nativeApprovalRetired:true,cancelOwnerIsolated:true,focusedApplicationPage:true,manualCorrectionAudited:true,correctionOwnerIsolated:true,verifiedCorrectionRefused:true,experienceBankOwnerIsolated:true,promotionOnly:true,feedbackOwnerIsolated:true,feedbackReversible:true,preparedPacket:true,nativeApproved:true,resumedApproved:true,lostStartAckRecovered:lostStartAck,posts:result.posts,screenshots:result.screenshots,retainedConfirmation:true,applicationRecorded:true,emailStatus:'interview',originalOwnerIsolated:true,apiRequests:calls.length})+'\n');
}
main().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
