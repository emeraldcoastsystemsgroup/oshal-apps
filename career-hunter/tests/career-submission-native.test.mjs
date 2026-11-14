/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Verify missing optional press pictures settle without requesting absent kernel artifacts.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prove approved press bounds, live kernel words and exact retained per-press evidence on real files.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify exact unknown evidence retention and that subsequent native sync cannot reopen an owner resolution.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove published approval precedes native dispatch, identical-ticket recovery survives lost acknowledgements, and only exact retained confirmation can change application status.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const require=createRequire(import.meta.url),native=require('../lib/career-submission-native'),queue=require('../lib/career-submission-queue');
const ticketId='a1000000-0000-0000-0000-000000000001',workId='b1000000-0000-0000-0000-000000000001';
const material={posting:{id:101,title:'Platform engineer',company:'Fixture employer',url:'https://jobs.example.com/apply'},
  profile:{firstName:'Fixture',lastName:'Applicant',email:'applicant@example.test'},
  resume:Buffer.from('%PDF-1.7\nApproved resume\n%%EOF'),cover:Buffer.from('%PDF-1.7\nApproved cover\n%%EOF')};
function setup(t){const dir=mkdtempSync(join(tmpdir(),'career-native-intent-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('one exact review publishes input before any native side effect and only then binds the queued ticket',async t=>{
  const dir=setup(t),review=native.review(material);let created=0,started=0;
  assert.throws(()=>native.approve(dir,material,{approved:true,packetDigest:'0'.repeat(64)}),/Review this job/);
  assert.equal(Object.keys(queue.read(dir).items).length,0);
  const approved=native.approve(dir,material,{approved:true,packetDigest:review.packetDigest});
  assert.equal(created,0);assert.equal(started,0);
  const frozen=native.snapshot(dir,approved.item.id);assert.equal(frozen.task.documents['Resume_ATS.pdf'],material.resume.toString('base64'));
  const tickets={createTicket:async input=>{created++;assert.equal(input.ticketType,'career-submission');assert.equal(input.ownerSub,'owner');return {ticketId};},
    startTicket:async()=>{started++;throw Error('must not start during bind');}};
  await native.bind(dir,approved.item.id,tickets,'owner');await native.bind(dir,approved.item.id,tickets,'owner');
  assert.equal(created,1);assert.equal(started,0);
  assert.equal(native.approve(dir,material,{approved:true,packetDigest:review.packetDigest}).item.id,approved.item.id);
});
test('a lost dispatch acknowledgement recovers the same ticket and byte-identical input without a new intent',async t=>{
  const dir=setup(t),review=native.review(material),{item}=native.approve(dir,material,{approved:true,packetDigest:review.packetDigest});
  let first=true,dispatches=0,input;
  const tickets={createTicket:async()=>({ticketId}),startTicket:async(id,body)=>{
    assert.equal(id,ticketId);dispatches++;if(input)assert.deepEqual(body,input);else input=body;
    if(first){first=false;throw Error('lost acknowledgement');}return {envelope:{id:workId}};
  },getTicketWork:async()=>[{id:workId,executor:'browser-form-v1',state:'claimed'}]};
  await native.bind(dir,item.id,tickets,'owner');await assert.rejects(native.start(dir,item.id,tickets),/lost acknowledgement/);
  await native.start(dir,item.id,tickets);assert.equal(dispatches,2);assert.equal(queue.read(dir).items[item.id].nativeWorkId,workId);
  await native.sync(dir,item.id,tickets,()=>{throw Error('not submitted');});
  assert.equal(queue.read(dir).items[item.id].status,'claimed');
  await native.start(dir,item.id,tickets);assert.equal(dispatches,2,'claimed work cannot be started again');
});
test('an accepted result needs exact intent and actual matching confirmation bytes before application projection',async t=>{
  const dir=setup(t),review=native.review(material),{item}=native.approve(dir,material,{approved:true,packetDigest:review.packetDigest});
  const input=native.snapshot(dir,item.id),png=Buffer.from('89504e470d0a1a0a000000000000000000','hex'),hash=queue.digest(png);let records=0,wrong=true;
  const data={submissionId:item.id,postingId:101,status:'submitted',reason:'Employer confirmation is visible.',confirmationText:'Thank you for applying',confirmationSha256:hash};
  const answer={version:1,intentId:item.id,requestDigest:input.requestDigest,outcome:'completed',data,confirmationArtifact:'confirmation.png',confirmationSha256:hash};
  const tickets={createTicket:async()=>({ticketId}),getTicketWork:async()=>[{id:workId,executor:'browser-form-v1',state:'completed'}],
    getAcceptedWork:async()=>({answer:JSON.stringify(answer)}),getAcceptedArtifact:async()=>({name:'confirmation.png',byteLength:png.length,sha256:hash,base64:(wrong?Buffer.from('wrong'):png).toString('base64')})};
  await native.bind(dir,item.id,tickets,'owner');
  await assert.rejects(native.sync(dir,item.id,tickets,()=>records++),/confirmation could not be verified/);assert.equal(records,0);
  wrong=false;const saved=await native.sync(dir,item.id,tickets,(result,file)=>{assert.equal(result.nativeWorkId,workId);assert.deepEqual(readFileSync(file),png);records++;});
  assert.equal(saved.status,'submitted');assert.equal(records,1);assert.equal(saved.confirmationSha256,hash);
  await native.sync(dir,item.id,tickets,()=>records++);assert.equal(records,1,'repeat sync does not submit or record twice');
});
test('an unrelated accepted result and a redelivered unknown outcome cannot reauthorize submission',async t=>{
  const dir=setup(t),review=native.review(material),{item}=native.approve(dir,material,{approved:true,packetDigest:review.packetDigest});
  const tickets={createTicket:async()=>({ticketId}),getTicketWork:async()=>[{id:workId,executor:'browser-form-v1',state:'unknown'}],startTicket:async()=>{throw Error('must not restart unknown');}};
  await native.bind(dir,item.id,tickets,'owner');await native.sync(dir,item.id,tickets,()=>assert.fail('no accepted result'));
  assert.equal((await native.start(dir,item.id,tickets)).item.status,'unknown');
  assert.throws(()=>queue.nativeUpdate(dir,item.id,{status:'queued'}),/settled outcome/);
  assert.throws(()=>native.approve(dir,{...material,profile:{...material.profile,email:'changed@example.test'}},{approved:true,packetDigest:review.packetDigest}),/Review this job/);
});

test('only displayed owner questions can add per-job facts, and new facts require a fresh packet approval',async t=>{
  const dir=setup(t),review=native.review(material),{item}=native.approve(dir,material,{approved:true,packetDigest:review.packetDigest});
  const key='question:'+'c'.repeat(64);
  queue.nativeUpdate(dir,item.id,{status:'needs_you',questions:[{id:key,text:'Earliest start date',type:'text',options:[]}]});
  assert.throws(()=>native.answer(dir,item.id,{email:'not an employer question'}),/only the employer questions/);
  native.answer(dir,item.id,{[key]:'November 16, 2026'});
  const profile=native.followupProfile(dir,material.posting.id,material.profile);
  assert.equal(profile[key],'November 16, 2026');assert.equal(native.followupProfile(dir,102,material.profile)[key],undefined);
  assert.equal(native.snapshot(dir,item.id).task.profile[key],undefined,'the original approved input remains immutable');
  const changed={...material,profile};assert.notEqual(native.review(changed).packetDigest,review.packetDigest);
  assert.throws(()=>native.approve(dir,changed,{approved:true,packetDigest:review.packetDigest}),/Review this job/);
});

test('an accepted unknown result retains only exact hash-checked outcome picture bytes',async t=>{
  const dir=setup(t),review=native.review(material),{item}=native.approve(dir,material,{approved:true,packetDigest:review.packetDigest});
  const input=native.snapshot(dir,item.id),png=Buffer.from('89504e470d0a1a0a000000000000000000','hex'),hash=queue.digest(png);let wrong=true;
  const answer={version:1,intentId:item.id,requestDigest:input.requestDigest,outcome:'unknown',
    data:{submissionId:item.id,postingId:101,status:'unknown',reason:'Check with employer',outcomeArtifact:'review.png',outcomeSha256:hash}};
  const tickets={createTicket:async()=>({ticketId}),getTicketWork:async()=>[{id:workId,executor:'browser-form-v1',state:'completed'}],
    getAcceptedWork:async()=>({answer:JSON.stringify(answer)}),getAcceptedArtifact:async()=>({name:'review.png',byteLength:png.length,sha256:hash,base64:(wrong?Buffer.from('wrong'):png).toString('base64')})};
  await native.bind(dir,item.id,tickets,'owner');
  await assert.rejects(native.sync(dir,item.id,tickets,()=>assert.fail('unknown is never confirmed')),/picture could not be verified/);
  wrong=false;const saved=await native.sync(dir,item.id,tickets,()=>assert.fail('unknown is never confirmed'));
  assert.equal(saved.status,'unknown');assert.equal(saved.outcomeSha256,hash);assert.deepEqual(readFileSync(join(dir,saved.outcomeFile)),png);
  queue.resolveUnknown(dir,item.id,'not_sent');
  assert.equal((await native.sync(dir,item.id,tickets,()=>assert.fail())).status,'resolved_not_sent','sync cannot reopen a closed result');
});

test('four approved presses are covered by both packet and immutable native input digests',t=>{
  const dir=setup(t),review=native.review(material);assert.equal(review.maxPresses,4);
  const {item}=native.approve(dir,material,{approved:true,packetDigest:review.packetDigest});
  const input=native.snapshot(dir,item.id);assert.equal(input.maxPresses,4);assert.equal(input.task.maxPresses,4);
  const {requestDigest,...bound}=input;assert.equal(queue.jsonDigest(bound),requestDigest);
  assert.notEqual(queue.jsonDigest({...bound,maxPresses:1}),requestDigest);
});

test('native sync keeps press words before result and validates every accepted press picture',async t=>{
  const dir=setup(t),review=native.review(material),{item}=native.approve(dir,material,{approved:true,packetDigest:review.packetDigest});
  const input=native.snapshot(dir,item.id),png=Buffer.from('89504e470d0a1a0a000000000000000000','hex'),hash=queue.digest(png);
  const presses=[{step:1,kind:'open',label:'Apply',origin:input.origin,allowedAt:1794549600000,result:'advanced',reportedAt:1794549600100,afterSha256:hash}];
  let state='browser_reviewing',wrong=true;
  const answer={version:1,intentId:item.id,requestDigest:input.requestDigest,outcome:'needs_review',data:{submissionId:item.id,postingId:101,status:'needs_you',presses,pressPictures:[{step:1,artifact:'press-1.png',sha256:hash}]}};
  const tickets={createTicket:async()=>({ticketId}),getTicketWork:async()=>[{id:workId,executor:'browser-form-v1',state,presses,pressesAllowed:4,pressesEnded:null}],
    getAcceptedWork:async()=>({answer:JSON.stringify(answer)}),getAcceptedArtifact:async()=>({name:'press-1.png',byteLength:png.length,sha256:hash,base64:(wrong?Buffer.from('wrong'):png).toString('base64')})};
  await native.bind(dir,item.id,tickets,'owner');
  const live=await native.sync(dir,item.id,tickets,()=>assert.fail());assert.deepEqual(live.presses,presses);assert.equal(live.pressesAllowed,4);
  state='completed';await assert.rejects(native.sync(dir,item.id,tickets,()=>assert.fail()),/picture could not be verified/);
  wrong=false;const saved=await native.sync(dir,item.id,tickets,()=>assert.fail());
  assert.equal(saved.status,'needs_you');assert.equal(saved.pressPictures[0].sha256,hash);assert.deepEqual(readFileSync(join(dir,saved.pressPictures[0].file)),png);
});

test('missing optional press pictures do not request an absent native artifact',async t=>{
  const dir=setup(t),review=native.review(material),{item}=native.approve(dir,material,{approved:true,packetDigest:review.packetDigest});
  const input=native.snapshot(dir,item.id),presses=[{step:1,kind:'open',label:'Apply',result:'advanced',afterSha256:'f'.repeat(64)}];
  const answer={version:1,intentId:item.id,requestDigest:input.requestDigest,outcome:'needs_review',data:{submissionId:item.id,postingId:101,status:'needs_you',pressPictures:[]}};
  const tickets={createTicket:async()=>({ticketId}),getTicketWork:async()=>[{id:workId,executor:'browser-form-v1',state:'completed',presses,pressesAllowed:4}],
    getAcceptedWork:async()=>({answer:JSON.stringify(answer)}),getAcceptedArtifact:async()=>{throw Error('accepted artifact is unavailable');}};
  await native.bind(dir,item.id,tickets,'owner');const saved=await native.sync(dir,item.id,tickets,()=>assert.fail());
  assert.equal(saved.status,'needs_you');assert.deepEqual(saved.pressPictures,[]);assert.equal(saved.presses.length,1);
});
