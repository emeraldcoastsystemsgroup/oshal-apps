/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove genuine SQL/RLS calibration CAS, original-person provenance, upgrade refusal, lease rollback and actual deterministic geometry retirement. No SQL or geometry double is evidence.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove narrow source-editor authority (scan.edit, printer.manage and print.send denied) admits photo upload, view assignment, calibration, job patch and cleanup while refusing reconstruction.
 */
import test from'node:test';import assert from'node:assert/strict';import{deflateSync}from'node:zlib';import{startCalibrationFixture,seedCalibrationFixture}from'./calibration.fixture.mjs';
const request=f=>async(path,body,method=body?'PATCH':'GET',status=200,who='alice')=>{const r=await fetch(f.origin+'/api/scan-to-print'+path,{method,headers:{'Content-Type':'application/json','x-test-user':who},body:body===undefined?undefined:JSON.stringify(body)}),out=await r.json();assert.equal(r.status,status,JSON.stringify(out));return out;};
test('actual geometry retires on calibration CAS, keeps invalid/stale source and never reconstructs or prints implicitly',async t=>{
 const f=await startCalibrationFixture();t.after(()=>f.close());const call=request(f),{jobId:id,calibration:source}=await seedCalibrationFixture(f),base='/jobs/'+id;assert.equal(source.state,'reconstructed');const noop=await call(base+'/calibration',{expectedSourceSha:source.sourceSha,knownDimensions:source.knownDimensions,settings:source.settings});assert.equal(noop.changed,false);assert.equal((await fetch(f.origin+'/api/scan-to-print'+base+'/artifacts/stl')).status,200);const input={expectedSourceSha:source.sourceSha,knownDimensions:[{axis:'x',mm:50}],settings:{resolution:32,smoothIterations:1}};
 for(const who of['other-issuer','other-principal','other-tenant']){await call(base+'/calibration',undefined,'GET',403,who);await call(base+'/calibration',input,'PATCH',403,who);await call(base,{title:'Foreign legacy bypass'},'PATCH',403,who);}await call(base+'/calibration',undefined,'GET',404,'bob');
 f.ctx.pool.storageModel='kernel-scoped-documents';try{await call(base+'/calibration',input,'PATCH',503);}finally{delete f.ctx.pool.storageModel;}assert.equal((await call(base+'/calibration')).sourceSha,source.sourceSha,'missing trusted native atomic scope refuses before mutation');assert.equal((await fetch(f.origin+'/api/scan-to-print'+base+'/artifacts/stl')).status,200);
 const changed=await call(base+'/calibration',input);assert.equal(changed.job.state,'capturing');assert.equal(changed.job.report,null);assert.notEqual(changed.calibration.sourceSha,source.sourceSha);assert.equal((await fetch(f.origin+'/api/scan-to-print'+base+'/artifacts/stl')).status,409);assert.equal((await f.as('alice',()=>f.pool.query('SELECT submission_id FROM scan_print_submission'))).rowCount,0);
 f.denied.set('principal-alice',new Set(['scan.source.change']));await call(base+'/print',{confirm:true},'POST',409);f.denied.clear();await call(base+'/calibration',input,'PATCH',409);for(const edit of[{knownDimensions:[{axis:'x',mm:-1}]},{settings:{resolution:32}},{settings:{resolution:null,smoothIterations:1}},{settings:{resolution:32,smoothIterations:1,unsupported:true}},{knownDimensions:[{axis:'x',mm:5},{axis:'x',mm:6}]}])await call(base+'/calibration',{...input,expectedSourceSha:changed.calibration.sourceSha,...edit},'PATCH',400);assert.equal((await call(base+'/calibration')).sourceSha,changed.calibration.sourceSha);
 await call(base+'/reconstruct',changed.calibration.settings,'POST');assert.equal((await fetch(f.origin+'/api/scan-to-print'+base+'/artifacts/stl')).status,200);
 f.ctx.onSQL=sql=>{if(sql.startsWith('UPDATE scan_print_job SET known_dimensions'))f.denied.set('principal-alice',new Set(['scan.source.change']));};await call(base+'/calibration',{...input,expectedSourceSha:changed.calibration.sourceSha,settings:{resolution:40,smoothIterations:2}},'PATCH',403);f.ctx.onSQL=null;f.denied.clear();assert.equal((await call(base+'/calibration')).sourceSha,changed.calibration.sourceSha);assert.equal((await fetch(f.origin+'/api/scan-to-print'+base+'/artifacts/stl')).status,200,'revocation rollback preserves genuinely current output');
 await call(base+'/calibration',{jobId:id,expectedSourceSha:changed.calibration.sourceSha,knownDimensionsJson:JSON.stringify(input.knownDimensions),settingsJson:JSON.stringify({resolution:24,smoothIterations:0})});assert.equal((await call(base+'/calibration')).settings.resolution,24);const transported=await call(base+'/calibration');for(const invalid of[{knownDimensionsJson:'{'},{settingsJson:'null'},{knownDimensions:[]},{knownDimensionsJson:'[]',settingsJson:'{}'}])await call(base+'/calibration',{jobId:id,expectedSourceSha:transported.sourceSha,knownDimensionsJson:JSON.stringify(input.knownDimensions),settingsJson:JSON.stringify(transported.settings),...invalid},'PATCH',400);assert.equal((await call(base+'/calibration')).sourceSha,transported.sourceSha);const rebuilt=await call(base+'/reconstruct',{resolution:24,smoothIterations:0},'POST');assert.ok(Math.abs(rebuilt.report.sizeMm.x-50)<3,'the actual geometry consumes the saved ruler');assert.equal((await fetch(f.origin+'/api/scan-to-print'+base+'/artifacts/stl')).status,200);
});
test('append-only migration leaves ambiguous legacy evidence read-only and new creation provenance rolls back on actor changes',async t=>{
 const f=await startCalibrationFixture({legacyBeforeUpgrade:true});t.after(()=>f.close());const call=request(f),id=f.legacyJobId;await call('/jobs/'+id);for(const who of['alice','other-issuer','other-principal','other-tenant']){await call('/jobs/'+id+'/calibration',undefined,'GET',403,who);await call('/jobs/'+id,{title:'Cannot claim'},'PATCH',403,who);}assert.equal((await f.as('alice',()=>f.pool.query('SELECT job_id FROM scan_print_job_editor WHERE job_id=$1',[id]))).rowCount,0);
 f.ctx.onSQL=sql=>{if(sql.startsWith('INSERT INTO scan_print_job ('))f.actors.alice.principalId='shifted-principal';};await call('/jobs',{title:'Must roll back'},'POST',401);f.ctx.onSQL=null;f.actors.alice.principalId='principal-alice';assert.equal((await f.as('alice',()=>f.pool.query("SELECT job_id FROM scan_print_job WHERE title='Must roll back'"))).rowCount,0);assert.equal((await call('/jobs/'+id)).job.title,'Legacy unbound evidence');
 const born=await call('/jobs',{title:'New bound calibration'},'POST',201);assert.equal((await call('/jobs/'+born.job.job_id+'/calibration')).canEdit,true);f.denied.set('principal-alice',new Set(['scan.source.change']));assert.equal((await call('/jobs/'+born.job.job_id+'/calibration')).canEdit,false);f.denied.clear();await call('/jobs/'+born.job.job_id,{},'DELETE');
});

test('point-cloud source refuses silhouette-only scale/resolution properties and exposes only actual smoothing',async t=>{
 const f=await startCalibrationFixture();t.after(()=>f.close());const call=request(f),{job}=await call('/jobs',{title:'Actual point cloud'},'POST',201),base='/jobs/'+job.job_id,points=[];for(let x=0;x<=10;x++)for(let y=0;y<=10;y++)for(let z=0;z<=10;z++)if([x,y,z].some(v=>v===0||v===10))points.push([x,y,z].join(' '));const ply='ply\nformat ascii 1.0\nelement vertex '+points.length+'\nproperty float x\nproperty float y\nproperty float z\nend_header\n'+points.join('\n')+'\n',form=new FormData();form.append('model',new Blob([ply],{type:'application/octet-stream'}),'actual-box.ply');form.append('voxelMm','1');form.append('unitScale','1');form.append('smoothIterations','0');const imported=await fetch(f.origin+'/api/scan-to-print'+base+'/pointcloud',{method:'POST',body:form});assert.equal(imported.status,200,await imported.clone().text());const source=await call(base+'/calibration');assert.equal(source.sourceKind,'pointcloud');assert.deepEqual(source.editableFields,['smoothIterations']);await call(base+'/calibration',{expectedSourceSha:source.sourceSha,knownDimensions:[{axis:'x',mm:100}],settings:source.settings},'PATCH',400);assert.equal((await call(base+'/calibration')).sourceSha,source.sourceSha);const changed=await call(base+'/calibration',{expectedSourceSha:source.sourceSha,knownDimensions:source.knownDimensions,settings:{...source.settings,smoothIterations:1}});assert.equal(changed.job.state,'capturing');assert.match(changed.calibration.rebuild,/Reimport/);
});

function tinySilhouettePng(){
 const w=16,h=16,raw=Buffer.alloc(h*(1+w*4));
 for(let y=0;y<h;y++){const row=y*(1+w*4);raw[row]=0;for(let x=0;x<w;x++){const dark=x>=4&&x<12&&y>=4&&y<12,v=dark?20:245,p=row+1+x*4;raw[p]=v;raw[p+1]=v;raw[p+2]=v;raw[p+3]=255;}}
 const crc32=buf=>{let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

test('source-editor role manages photos, views, dimensions, calibration and cleanup while reconstruction stays refused',async t=>{
 const f=await startCalibrationFixture();t.after(()=>f.close());const call=request(f);
 f.denied.set('principal-alice',new Set(['scan.edit','printer.manage','print.send']));
 const{job}=await call('/jobs',{title:'Source-only scan'},'POST',201),base='/jobs/'+job.job_id;
 const form=new FormData();form.append('images',new Blob([tinySilhouettePng()],{type:'image/png'}),'front.png');
 const uploaded=await fetch(f.origin+'/api/scan-to-print'+base+'/images',{method:'POST',body:form}),uploadOut=await uploaded.json();
 assert.equal(uploaded.status,201,JSON.stringify(uploadOut));
 const imageId=uploadOut.images[0].image_id;
 const assigned=await call(base+'/images/'+imageId,{view:'front'},'PATCH',200);
 assert.equal(assigned.image.view,'front');
 const patched=await call(base,{title:'Source-only calibrated',knownDimensions:[{axis:'x',mm:42}]},'PATCH',200);
 assert.equal(patched.job.title,'Source-only calibrated');
 const cal=await call(base+'/calibration');
 assert.equal(cal.canEdit,true);
 const calUpdated=await call(base+'/calibration',{expectedSourceSha:cal.sourceSha,knownDimensions:[{axis:'x',mm:48}],settings:{resolution:24,smoothIterations:0}},'PATCH',200);
 assert.equal(calUpdated.calibration.knownDimensions[0].mm,48);
 await call(base+'/reconstruct',{resolution:24,smoothIterations:0},'POST',403);
 const imgDeleted=await call(base+'/images/'+imageId,{},'DELETE',200);
 assert.equal(imgDeleted.deleted,true);
 const jobDeleted=await call(base,{},'DELETE',200);
 assert.equal(jobDeleted.deleted,true);
});
