/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Bind four presses into new approvals without rewriting historical packet digests. */
import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),q=require('../lib/career-submission-queue');
let dir,other;
const now=Date.parse('2026-10-27T12:00:00Z'),node='da000000-0000-0000-0000-000000000001';
const input={postingId:1,url:'https://jobs.example.com/one',resumeSha256:'a'.repeat(64),coverSha256:'b'.repeat(64),
  profileSha256:'c'.repeat(64),approved:true};
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'career-submit-'));other=mkdtempSync(join(tmpdir(),'career-submit-'));});
afterEach(()=>{rmSync(dir,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});});
const enqueue=()=>q.enqueue(dir,input,{now}).item;
const claim=item=>q.claim(dir,item.id,node,item.packetDigest,now);
test('a particular approved job binds its exact PDFs, profile and URL and deduplicates double clicks',()=>{
  const first=enqueue(),second=q.enqueue(dir,input,{now});
  assert.equal(second.deduped,true);assert.equal(second.item.id,first.id);
  assert.equal(first.packetDigest,q.jsonDigest(q.binding(input)));
  assert.throws(()=>q.enqueue(dir,{...input,resumeSha256:'d'.repeat(64)},{now}),{code:'submission_conflict'});
  assert.throws(()=>q.enqueue(other,{...input,approved:false},{now}),{code:'submission_approval_required'});
  assert.equal(Object.keys(q.read(other).items).length,0);
});
test('public HTTPS job URLs reject local addresses, embedded credentials and unrelated protocols',()=>{
  for(const url of ['http://example.com/','https://127.0.0.1/','https://[::1]/','https://employer.local/',
    'https://example.com:8443/','https://a:b@example.com/','file:///etc/passwd','javascript:alert(1)'])
    assert.throws(()=>q.binding({...input,url}),{code:'invalid_job_url'},url);
});
test('a node claim is exact, secret in public views, non-stealable and single-use',()=>{
  const item=enqueue(),held=claim(item);
  assert.equal(held.status,'claimed');assert.ok(!('claimToken'in q.publicItem(held)));
  assert.throws(()=>claim(item),{code:'submission_not_claimable'});
  for(const token of ['x'.repeat(64),'é'.repeat(64),'a'.repeat(64)])
    assert.throws(()=>q.transition(dir,item.id,node,token,'reviewing',{},now),{code:'submission_not_owned'});
  assert.throws(()=>q.transition(dir,item.id,'db000000-0000-0000-0000-000000000001',held.claimToken,'reviewing',{},now),{code:'submission_not_owned'});
});
test('the successful path requires a retained confirmation and cannot be replayed or requeued',()=>{
  const held=claim(enqueue()),args=[dir,held.id,node,held.claimToken];
  q.transition(...args,'reviewing',{},now);q.transition(...args,'submitting',{},now);
  assert.throws(()=>q.transition(...args,'submitted',{},now),{code:'confirmation_required'});
  const done=q.transition(...args,'submitted',{confirmationSha256:'d'.repeat(64),confirmationText:'Your application has been received.'},now);
  assert.equal(done.status,'submitted');assert.equal(done.submittedAt,new Date(now).toISOString());
  assert.equal(q.enqueue(dir,input,{now}).deduped,true);
  assert.throws(()=>q.transition(...args,'submitting',{},now),{code:'invalid_submission_transition'});
});
test('uncertain or expired work requires reconciliation and never silently retries',()=>{
  const held=claim(enqueue());q.transition(dir,held.id,node,held.claimToken,'reviewing',{},now);
  assert.equal(q.reconcile(dir,now+31*60000),1);
  const saved=q.read(dir).items[held.id];assert.equal(saved.status,'unknown');
  assert.equal(q.enqueue(dir,input,{now:now+32*60000}).item.status,'unknown');
  assert.throws(()=>q.cancel(dir,held.id,now+32*60000),{code:'submission_outcome_review_required'});
  assert.throws(()=>q.transition(dir,held.id,node,held.claimToken,'submitting',{},now+32*60000),{code:'submission_lease_expired'});
});
test('cancellation fences a held worker; delayed approvals expire before work begins',()=>{
  const held=claim(enqueue());q.cancel(dir,held.id,now);
  assert.throws(()=>q.transition(dir,held.id,node,held.claimToken,'reviewing',{},now),{code:'invalid_submission_transition'});
  const replacement=q.enqueue(dir,input,{now}).item;
  assert.notEqual(replacement.id,held.id);
  assert.throws(()=>q.claim(dir,replacement.id,node,replacement.packetDigest,now+25*60*60000),{code:'approval_expired'});
});
test('owner stores are separate and unsafe queue files are refused',()=>{
  const first=enqueue();assert.equal(q.read(other).items[first.id],undefined);
  assert.throws(()=>q.cancel(other,first.id),{code:'submission_not_found'});
  symlinkSync(join(dir,'submission-queue.json'),join(other,'submission-queue.json'));
  assert.throws(()=>q.read(other),{code:'queue_unavailable'});
  assert.ok(!readFileSync(join(dir,'submission-queue.json'),'utf8').includes('finalSubmitAuthorized'));
});

test('new packet binds maxPresses four and stored older approval keeps its original digest',()=>{
  const first=enqueue();assert.equal(q.MAX_PRESSES,4);assert.equal(first.maxPresses,4);
  assert.notEqual(first.packetDigest,q.jsonDigest({...q.binding(input),maxPresses:1}));
  const state=q.read(dir),old=state.items[first.id];delete old.maxPresses;
  const {maxPresses,...legacy}=q.binding(input);old.packetDigest=q.jsonDigest(legacy);
  q.nativeUpdate(dir,first.id,{reason:'historical approval'});
  const fs=require('node:fs');fs.writeFileSync(join(dir,'submission-queue.json'),JSON.stringify(state));
  assert.equal(q.read(dir).items[first.id].packetDigest,q.jsonDigest(legacy));
  assert.throws(()=>q.enqueue(dir,input,{now}),{code:'submission_conflict'});
});
