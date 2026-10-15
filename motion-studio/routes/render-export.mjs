/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Produce exact-tick transparent PNG sequences and real opaque MP4 with original export admission, cancellation and bounded trusted sinks.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { MotionError } from './project-store.mjs';
import { access } from './authorization.mjs';
import { motionEngine } from './engine-client.mjs';
import { ownedAssets } from './assets.mjs';
import { tarMember } from './portable-bundle.mjs';
import { stringifyNative, decimalId } from '../tools/native-json.mjs';
export const RENDER_LIMITS = Object.freeze({ outputBytes: 264 * 1024 * 1024, pngBytes: 8 * 1024 * 1024, maxSide: 4096, deadlineMs: 300000, ticksPerSecond: 254016000000n });
const fail = (status, code) => { throw new MotionError(status, code); };
function tick(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) fail(400,'motion_invalid_render_tick');
  return BigInt(value);
}
export function framePlan(document, options) {
  if (!options || Object.keys(options).some(key => !['format','compId','startTick','endTick','maxSide'].includes(key)) || !['png-sequence','mp4'].includes(options.format)) fail(400,'motion_invalid_export_profile');
  let compId; try { compId = options.compId === undefined ? undefined : decimalId(options.compId); } catch { fail(400,'motion_invalid_native_id'); }
  const comps = Object.values(document.items ?? {}).filter(item => item?.kind?.type === 'Comp');
  const comp = compId === undefined ? comps.length === 1 ? comps[0] : null : comps.find(item => String(item.id) === String(compId));
  if (!comp) fail(400,'motion_export_composition_required');
  const rate = comp.kind.frame_rate;
  if (!rate || ![rate.num,rate.den].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4294967295) || rate.num/rate.den>1000) fail(400,'motion_invalid_export_rate');
  const duration = BigInt(comp.kind.duration), start = tick(options.startTick ?? '0'), end = tick(options.endTick ?? String(duration));
  if (end <= start || end > duration) fail(400,'motion_invalid_export_range');
  const maxSide = options.maxSide ?? RENDER_LIMITS.maxSide;
  if (!Number.isSafeInteger(maxSide)||maxSide<1||maxSide>RENDER_LIMITS.maxSide) fail(400,'motion_invalid_export_size');
  const stepNum = RENDER_LIMITS.ticksPerSecond * BigInt(rate.den), stepDen = BigInt(rate.num), frames = Number(((end-start)*stepDen+stepNum-1n)/stepNum);
  if (!Number.isSafeInteger(frames)||frames<1) fail(413,'motion_export_frame_limit');
  return { compId:String(comp.id),rate:{num:rate.num,den:rate.den},startTick:start,endTick:end,maxSide,frames,
    at:index=>start+BigInt(index)*stepNum/stepDen };
}
/** Source-owned sink/runtime parameters are not caller authority, paths or encoder commands.
 * This producer runs only while the original admitted context is alive. It does not invent a durable job host.
 */
export async function renderExportTo(ctx, store, id, revision, options, sink, { signal, onFrame, deadlineMs = RENDER_LIMITS.deadlineMs } = {}) {
  if (typeof sink !== 'function' || !Number.isSafeInteger(deadlineMs) || deadlineMs<1 || deadlineMs>RENDER_LIMITS.deadlineMs) fail(400,'motion_invalid_export_runtime');
  await access(ctx,'export'); const original=ctx.authorization.currentActor(), issuer=original.issuer, sub=original.sub;
  const started=Date.now(), controller=new AbortController(); let child, failed, deadline;
  const check=async()=>{
    if (failed) throw failed;
    if (signal?.aborted || controller.signal.aborted) fail(409,'motion_export_cancelled');
    if (Date.now()-started>=deadlineMs) fail(503,'motion_export_timeout');
    const actor=ctx.authorization.currentActor(); if(actor.issuer!==issuer||actor.sub!==sub)fail(401,'motion_identity_changed');
    await access(ctx,'export'); await store.assertOriginalContext(ctx);
    if (ctx.authorization.currentActor().issuer!==issuer||ctx.authorization.currentActor().sub!==sub)fail(401,'motion_identity_changed');
  };
  const stop=error=>{failed??=error;controller.abort();if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');};
  const cancel=()=>stop(new MotionError(409,'motion_export_cancelled'));
  signal?.addEventListener('abort',cancel,{once:true});deadline=setTimeout(()=>stop(new MotionError(503,'motion_export_timeout')),deadlineMs);
  try {
    await check();const project=await store.export(id,revision),plan=framePlan(project.document,options),assets=await ownedAssets(project.document,store);await check();
    let bytes=0,width,height;const digest=createHash('sha256');
    const emit=async chunk=>{
      for(let offset=0;offset<chunk.length;offset+=65536){await check();const part=chunk.subarray(offset,offset+65536);bytes+=part.length;if(bytes>RENDER_LIMITS.outputBytes)fail(413,'motion_export_output_limit');digest.update(part);await sink(part);await check();}
    };
    const frame=async index=>{
      await check();const timeTicks=plan.at(index);
      const result=await motionEngine(ctx,{op:'preview',document:project.document,assets,comp:BigInt(plan.compId),time_ticks:timeTicks,max_side:plan.maxSide,transparent:options.format==='png-sequence'});await check();
      if (String(result.timeTicks)!==String(timeTicks)||String(result.comp)!==plan.compId||typeof result.png!=='string')fail(503,'motion_export_frame_invalid');
      const png=Buffer.from(result.png,'base64');if(!png.length||png.length>RENDER_LIMITS.pngBytes||png.toString('base64')!==result.png)fail(503,'motion_export_frame_invalid');
      if(width===undefined){width=result.width;height=result.height;}else if(width!==result.width||height!==result.height)fail(503,'motion_export_frame_changed');
      if(onFrame)await onFrame(index+1);
      return png;
    };
    const provenance={package:'motion-studio',project:project.id,revision:project.revision,documentSha256:createHash('sha256').update(stringifyNative(project.document)).digest('hex'),compId:plan.compId};
    if(options.format==='png-sequence'){
      const manifest=Buffer.from(JSON.stringify({format:'oshal-motion-render',version:1,...provenance,frameRate:plan.rate,frames:plan.frames,startTick:String(plan.startTick),endTick:String(plan.endTick),ticksPerSecond:String(RENDER_LIMITS.ticksPerSecond),transparent:true}));
      for await(const chunk of tarMember('render.json',manifest,check))await emit(chunk);
      for(let index=0;index<plan.frames;index++)for await(const chunk of tarMember('frames/frame-'+String(index).padStart(12,'0')+'.png',await frame(index),check))await emit(chunk);
      await emit(Buffer.alloc(1024));
    }else{
      await check();child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-threads','1','-protocol_whitelist','pipe','-f','image2pipe','-vcodec','png','-framerate',plan.rate.num+'/'+plan.rate.den,'-i','pipe:0','-an','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p','-c:v','libx264','-preset','veryfast','-crf','18','-threads','1','-g',String(Math.max(1,Math.round(plan.rate.num/plan.rate.den))),'-movflags','frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'],{env:{PATH:'/usr/bin:/bin',LANG:'C'},stdio:['pipe','pipe','pipe']});
      let stderr='';child.stderr.on('data',part=>{if(stderr.length<4096)stderr+=part;});
      const exit=new Promise((resolve,reject)=>{child.once('error',()=>reject(new MotionError(503,'motion_encoder_unavailable')));child.once('close',code=>code===0?resolve():reject(failed??new MotionError(503,'motion_encoder_failed')));});
      child.stdin.on('error',error=>stop(failed??new MotionError(503,'motion_encoder_failed')));
      const feed=(async()=>{for(let index=0;index<plan.frames;index++){await check();if(!child.stdin.write(await frame(index)))await once(child.stdin,'drain');}child.stdin.end();})();
      const drain=(async()=>{for await(const chunk of child.stdout)await emit(chunk);})();
      try{await Promise.all([feed,drain,exit]);}catch(error){stop(error);await Promise.allSettled([feed,drain,exit]);throw error;}
    }
    await check();return{...provenance,format:options.format,transparent:options.format==='png-sequence',frameRate:plan.rate,frames:plan.frames,width:options.format==='mp4'?Math.ceil(width/2)*2:width,height:options.format==='mp4'?Math.ceil(height/2)*2:height,renderWidth:width,renderHeight:height,startTick:String(plan.startTick),endTick:String(plan.endTick),bytes,sha256:digest.digest('hex')};
  }catch(error){stop(error);throw error;}
  finally{clearTimeout(deadline);signal?.removeEventListener('abort',cancel);if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGKILL');await closed;}}
}
