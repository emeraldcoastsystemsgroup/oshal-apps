/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render real alpha sequences and decode real MP4 with source lineage, precise schedules and original export/cancel checks.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {MotionProjectStore} from '../routes/project-store.mjs';
import {MotionOwnedBlobs} from '../routes/owned-blobs.mjs';
import {motionEngine} from '../routes/engine-client.mjs';
import {ownedAssets} from '../routes/assets.mjs';
import {parseNative,stringifyNative} from '../tools/native-json.mjs';
import {renderExportTo,framePlan,RENDER_LIMITS} from '../routes/render-export.mjs';
import {startNativeSqlFixture} from './native-sql-fixture.mjs';
const exec=promisify(execFile);let fixture,ctx,store,project,asset;
before(async()=>{
 fixture=await startNativeSqlFixture();ctx=fixture.service('alice');
 store=new MotionProjectStore(ctx,{blobs:new MotionOwnedBlobs(ctx,fixture.dataDir),revisionBlobs:new MotionOwnedBlobs(ctx,fixture.dataDir,{purpose:'revision'}),decodeRaster:async bytes=>{const{data,info}=await fixture.sharp(bytes).toColourspace('srgb').png().toBuffer({resolveWithObject:true});return{bytes:data,type:'image/png',width:info.width,height:info.height};},validateDocument:async(document,incoming)=>(await motionEngine(ctx,{op:'inspect',document,assets:incoming??await ownedAssets(document,store)})).document});
 const image=await fixture.sharp({create:{width:16,height:8,channels:4,background:{r:255,g:0,b:0,alpha:.5}}}).png().toBuffer();asset=await store.uploadAsset({bytes:image});
 const blank=await motionEngine(ctx,{op:'create'}),edited=await motionEngine(ctx,{op:'edit',document:blank.document,assets:[{id:asset.id,sha256:asset.sha256,data:(await store.asset(asset.id)).bytes.toString('base64')}],commands:[
  {command:'comp.new',params:{name:'Acceptance',width:160,height:90,frameRate:30,duration:5}},
  {command:'layer.newSolid',params:{name:'Logo',color:'#ff0000',width:40,height:20}},
  {command:'prop.addKey',params:{layer:'Logo',path:'transform/opacity',time:0,value:0}},
  {command:'prop.addKey',params:{layer:'Logo',path:'transform/opacity',time:5,value:100}},
  {command:'asset.import',params:{assetId:asset.id,name:'Masked photo'}},
  {command:'prop.set',params:{layer:'Masked photo',path:'transform/position',value:[20,20],time:0}},
  {command:'layer.addMask',params:{layer:'Masked photo',shape:'rect',rect:[0,0,8,8]}},
  {command:'layer.newText',params:{name:'Caption',text:'Editable',size:12,position:[80,75]}},
 ]});project=await store.create({title:'Five second source',document:edited.document,assets:[asset.id],requestKey:randomUUID()});
});
after(async()=>{fixture.assign('alice','administrator');if(project)await store.delete(project.id);if(asset)await store.deleteAsset(asset.id);await ctx?.pool.drain();await fixture?.close();});
async function output(format,work,options={}){
 const dir=await mkdtemp(join(tmpdir(),'motion-render-proof-')),path=join(dir,format==='mp4'?'movie.mp4':'frames.tar'),out=createWriteStream(path,{mode:0o600});
 try{const receipt=await renderExportTo(ctx,store,project.id,1,{format,maxSide:160,...options},async bytes=>{if(!out.write(bytes))await once(out,'drain');});out.end();await once(out,'close');await work(path,receipt);}finally{out.destroy();await rm(dir,{recursive:true,force:true});}
}
function pixel(data,channels,x=80,y=45,width=160){return [...data.subarray((y*width+x)*channels,(y*width+x)*channels+channels)];}
test('exact rational frame plans retain wide ticks and reject caller paths, unsupported formats and inverted ranges',()=>{
 const base=9007199254740993n,document={items:{'1':{id:1,kind:{type:'Comp',duration:base+RENDER_LIMITS.ticksPerSecond,frame_rate:{num:30000,den:1001}}}}};
 const plan=framePlan(document,{format:'png-sequence',startTick:String(base),endTick:String(base+RENDER_LIMITS.ticksPerSecond)});
 assert.equal(plan.at(0),base);assert.equal(plan.frames,30);assert.equal(plan.at(1),base+RENDER_LIMITS.ticksPerSecond*1001n/30000n);
 for(const value of [{format:'mp4',path:'/tmp/other'},{format:'transparent-mp4'},{format:'mp4',startTick:'4',endTick:'3'}])assert.throws(()=>framePlan(document,value));
});
test('five-second transparent PNG sequence contains 150 real reproducible alpha/mask/caption frames and exact lineage',async()=>{
 await output('png-sequence',async(path,receipt)=>{
  assert.equal(receipt.frames,150);assert.equal(receipt.width,160);assert.equal(receipt.height,90);assert.equal(receipt.transparent,true);assert.equal(receipt.project,project.id);assert.equal(receipt.revision,1);
  const listing=(await exec('tar',['-tf',path])).stdout.trim().split('\n');assert.equal(listing.length,151);
  const meta=JSON.parse((await exec('tar',['-xOf',path,'render.json'])).stdout);assert.equal(meta.documentSha256,receipt.documentSha256);assert.equal(meta.frameRate.num,30);
  for(const[index,alpha]of[[0,0],[75,128],[149,253]]){
   const png=(await exec('tar',['-xOf',path,'frames/frame-'+String(index).padStart(12,'0')+'.png'],{encoding:'buffer',maxBuffer:12*1024*1024})).stdout;
   const{data,info}=await fixture.sharp(png).raw().toBuffer({resolveWithObject:true});assert.equal(pixel(data,info.channels)[3],alpha);
   let masked=0,caption=0;for(let y=12;y<28;y++)for(let x=8;x<32;x++)if(data[(y*160+x)*info.channels+3]===128)masked++;
   for(let y=65;y<90;y++)for(let x=40;x<120;x++)if(data[(y*160+x)*info.channels+3]>0)caption++;
   assert.equal(masked,64,'real mask keeps exactly half the owned image');assert.ok(caption>10,'editable caption glyphs render');
   const expected=await motionEngine(ctx,{op:'preview',document:project.document,assets:await ownedAssets(project.document,store),time_ticks:BigInt(index)*RENDER_LIMITS.ticksPerSecond/30n,max_side:160,transparent:true});
   assert.equal(createHash('sha256').update(png).digest('hex'),createHash('sha256').update(Buffer.from(expected.png,'base64')).digest('hex'));
  }
 });
});
test('actual FFmpeg opaque MP4 decodes to the same 150-frame rational timing and source animation',async()=>{
 await output('mp4',async(path,receipt)=>{
  assert.equal(receipt.frames,150);assert.equal(receipt.transparent,false);
  const probe=JSON.parse((await exec('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',path])).stdout),video=probe.streams.find(stream=>stream.codec_type==='video');
  assert.equal(video.codec_name,'h264');assert.equal(video.nb_read_frames,'150');assert.equal(video.width,160);assert.equal(video.height,90);assert.ok(Math.abs(Number(probe.format.duration)-5)<.05);
  const raw=(await exec('ffmpeg',['-v','error','-i',path,'-vf',"select='eq(n,0)+eq(n,75)+eq(n,149)'",'-vsync','0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:160*90*3*4})).stdout;
  const size=160*90*3;assert.equal(raw.length,size*3);
  const red=[0,1,2].map(index=>pixel(raw.subarray(index*size,(index+1)*size),3)[0]);assert.ok(red[0]<8);assert.ok(red[1]>115&&red[1]<140);assert.ok(red[2]>240);
 });
});
test('cancellation, deadline and revoked export stop source production without returning a success receipt',async()=>{
 const control=new AbortController();let chunks=0;
 await assert.rejects(renderExportTo(ctx,store,project.id,1,{format:'mp4',maxSide:160},async()=>{if(++chunks===1)control.abort();},{signal:control.signal}),error=>error.code==='motion_export_cancelled');
 assert.ok(chunks>=1);
 chunks=0;await assert.rejects(renderExportTo(ctx,store,project.id,1,{format:'png-sequence',maxSide:160},async()=>{if(++chunks===2)fixture.deny('alice','project.export');}),error=>error.status===403);fixture.allow('alice','project.export');
 await assert.rejects(renderExportTo(ctx,store,project.id,1,{format:'mp4',maxSide:160},async()=>{},{deadlineMs:1}),error=>error.code==='motion_export_timeout');
 const other=fixture.service('bob');await assert.rejects(renderExportTo(other,store,project.id,1,{format:'png-sequence',maxSide:160},async()=>{}),error=>error.code==='motion_original_context_mismatch');
});

test('actual MP4 retains fractional frame rate and explicitly pads odd render dimensions',async()=>{
 const document=parseNative(stringifyNative(project.document)),comp=Object.values(document.items).find(item=>item.kind.type==='Comp');comp.kind.frame_rate={num:30000,den:1001};comp.kind.width=159;comp.kind.height=89;
 const saved=await store.create({title:'Fractional output',document,assets:[asset.id],requestKey:randomUUID()}),dir=await mkdtemp(join(tmpdir(),'motion-ntsc-proof-')),path=join(dir,'fractional.mp4'),pieces=[];
 try{
  const receipt=await renderExportTo(ctx,store,saved.id,1,{format:'mp4',maxSide:160,endTick:String(RENDER_LIMITS.ticksPerSecond*1001n*3n/30000n)},async bytes=>pieces.push(Buffer.from(bytes)));
  await writeFile(path,Buffer.concat(pieces));const probe=JSON.parse((await exec('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',path])).stdout),video=probe.streams.find(stream=>stream.codec_type==='video');
  assert.equal(receipt.frames,3);assert.equal(video.nb_read_frames,'3');assert.equal(video.r_frame_rate,'30000/1001');assert.equal(receipt.renderWidth,159);assert.equal(receipt.renderHeight,89);assert.equal(video.width,160);assert.equal(video.height,90);
 }finally{await store.delete(saved.id);await rm(dir,{recursive:true,force:true});}
});
