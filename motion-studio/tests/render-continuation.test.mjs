/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real private job files and early continuation failures with explicitly named authorization/source seams, without claiming native engine acceptance.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {MotionRenderJobs,renderContinuationDiagnostic} from '../routes/render-jobs.mjs';
import {MotionError} from '../routes/project-store.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'motion-early-continuation-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const id=randomUUID(),alice=randomUUID(),bob=randomUUID(),tenant=randomUUID();
 const control={subject:'alice',allowed:true,referenceCalls:0,onReference:async()=>{}},logs=[];
 const principal=()=>({id:control.subject==='alice'?alice:bob,tenant,issuer:'urn:motion-early-source-seam',subject:control.subject,state:'active'});
 const ctx={logger:{info(fields,message){logs.push({fields,message});}},authorization:{currentActor:()=>({issuer:principal().issuer,sub:principal().subject,isActive:true}),authorize:async()=>({allowed:control.allowed})},intent:async name=>{assert.equal(name,'auth.caller');return{principal:principal()};}};
 // A named minimum composition schedule exercises real framePlan and immutable job metadata;
 // no renderer, database, kernel authority or native engine is simulated as a passing workflow.
 const document={items:{1:{id:1,kind:{type:'Comp',duration:25401600000n,frame_rate:{num:30,den:1}}}}};
 const store={assertOriginalContext:async()=>{if(control.subject!=='alice')throw new MotionError(401,'motion_identity_changed');},export:async()=>({id,title:'Named early source',document}),reference:async()=>{control.referenceCalls++;await control.onReference(control.referenceCalls);}};
 const jobs=new MotionRenderJobs(ctx,root,store),start=await jobs.begin({project:id,revision:1,requestKey:randomUUID(),format:'mp4',compId:'1',maxSide:160});
 async function metadata(){for(const dir of await readdir(join(root,'.motion-render-jobs'))){try{return JSON.parse(await readFile(join(root,'.motion-render-jobs',dir,start.render.id+'.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}throw new Error('Missing owned job');}
 return{root,jobs,start,control,logs,metadata};
}
test('an early source refusal settles only the original owned queued metadata before any output opens',async t=>{
 const f=await fixture(t),refusal=new MotionError(503,'named_motion_source_unavailable');
 f.control.onReference=async n=>{if(n===2)throw refusal;};
 await assert.rejects(f.jobs.produce(f.start.render.id),error=>error===refusal);
 const meta=await f.metadata();assert.equal(meta.state,'failed');assert.equal(meta.error,refusal.code);assert.equal(meta.completedFrames,0);assert.equal(meta.producedBytes,0);assert.equal(meta.output,undefined);
 assert.deepEqual(f.logs.map(row=>row.fields.stage),['authority','namespace','source','failed']);
 assert.equal((await f.jobs.status(f.start.render.id)).state,'failed');
});
test('a changed caller cannot use early-failure settlement to edit the original owner metadata',async t=>{
 const f=await fixture(t);
 f.control.onReference=async n=>{if(n===2){f.control.subject='bob';throw new MotionError(503,'named_motion_source_unavailable');}};
 await assert.rejects(f.jobs.produce(f.start.render.id),error=>error.code==='named_motion_source_unavailable');
 assert.equal((await f.metadata()).state,'queued');
 f.control.subject='alice';assert.equal((await f.jobs.status(f.start.render.id)).state,'queued');
});
test('withdrawn original export authority refuses settlement rather than widening the caller',async t=>{
 const f=await fixture(t);
 f.control.onReference=async n=>{if(n===2){f.control.allowed=false;throw new MotionError(403,'motion_permission_denied');}};
 await assert.rejects(f.jobs.produce(f.start.render.id),error=>error.code==='motion_permission_denied');
 assert.equal((await f.metadata()).state,'queued');
});
test('continuation diagnostics contain only bounded stage and code, excluding arguments and error messages',()=>{
 const logs=[],ctx={logger:{info(fields,message){logs.push({fields,message});}}};
 const code=renderContinuationDiagnostic(ctx,'attacker supplied private content',{code:'bad credential payload',message:'private document and credential',request:{token:'private'}});
 assert.equal(code,'motion_render_continuation_failed');assert.deepEqual(logs,[{fields:{module:'motion-render-continuation',stage:'unknown',code},message:'Motion render continuation'}]);
 assert.doesNotMatch(JSON.stringify(logs),/credential|document|payload|token/);
});
