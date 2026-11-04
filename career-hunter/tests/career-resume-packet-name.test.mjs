/** Candidate identity must come from the same retained packet as the edited résumé. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../routes/career-resume-studio-routes.js',import.meta.url),'utf8');
const body=source.match(/async function readDoc\(dir\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(body,'compiled packet reader is present');
const read=vm.runInNewContext('('+body+')',{fs_1:{promises:fs.promises},path});
async function packet(t,data){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'career-packet-name-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'application.json'),JSON.stringify(data));return read(dir);
}
test('a saved packet carries its original candidate name with the full résumé and cover',async t=>{
  const generated={resume:{headline:'Fixture role',education:['MBA']},cover:{paragraphs:['Recorded cover']}};
  const doc=await packet(t,{posting_id:225,company:'Fixture employer',profile_snapshot:{profile:{name:'Packet Candidate'}},generated});
  assert.equal(doc.meta.name,'Packet Candidate');assert.equal(doc.meta.postingId,225);
  assert.deepEqual(JSON.parse(JSON.stringify({resume:doc.resume,cover:doc.cover})),generated);
});
test('missing or malformed saved identity remains unknown rather than guessing another profile',async t=>{
  for(const profile_snapshot of [undefined,{profile:{name:{unverified:'other'}}}]){
    const doc=await packet(t,{posting_id:225,generated:{resume:{headline:'Fixture role'},cover:{}},profile_snapshot});
    assert.equal(doc.meta.name,undefined);assert.ok(!JSON.stringify(doc.meta).includes('name'));
  }
});
