/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The calibration projection says whether this seat may build the model (canReconstruct, scan.edit), over the genuine SQL/RLS calibration fixture: the full editor may, a source editor (the trial visitor's role: scan.edit denied) may not and still may edit the source (Roger, trial.oswarm.ai, 2026-11-06).
 */
import test from 'node:test';import assert from 'node:assert/strict';import{startCalibrationFixture}from'./calibration.fixture.mjs';
test('the calibration projection offers model building only to a seat holding scan.edit',async t=>{
 const f=await startCalibrationFixture();t.after(()=>f.close());
 const call=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(f.origin+'/api/scan-to-print'+path,{method,headers:{'Content-Type':'application/json','x-test-user':'alice'},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
 const {job}=await call('/jobs',{title:'Phone object'}),path='/jobs/'+job.job_id+'/calibration';
 const full=await call(path);assert.equal(full.canEdit,true);assert.equal(full.canReconstruct,true);
 f.denied.set('principal-alice',new Set(['scan.edit']));
 const visitor=await call(path);assert.equal(visitor.canEdit,true,'a source editor still edits the source');assert.equal(visitor.canReconstruct,false,'but is not offered model building');
});
