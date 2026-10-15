/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Import genuine protected Motion renders as immutable Video media with exact editable native source lineage; never accept identity or source claims from the body.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Accept the canonical native chunk acknowledgement while preserving exact sealed upload and offset checks.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Discover original-owned ready Motion jobs and mint their native typed handles inside the approved import route.
 */
import type { Router } from 'express';
import { createHash } from 'node:crypto';
import * as exchange from '@/shared/artifact-exchange';
import type { MotionSource, TimelineSource } from './video-edit-compiler';
import { EditorError, EDITOR_LIMITS, type EditorMedia, type EditorOwner } from './video-editor-types';
import { admit, bodyParser, confirm, handler, type RouteEnvironment } from './video-editor-http';
import { editorId, exactFields, isRecord } from './video-editor-validation';
import { nativeEditor } from './video-editor-native';

const artifactExchange = exchange as unknown as {native?:boolean;metadata:(ref:string)=>Promise<unknown>;chunk:(ref:string,offset:number)=>Promise<unknown>};
interface ArtifactMetadata {ref:string;sourcePackage:string;source:string;type:string;size:number;sha256:string;receipt:Record<string,unknown>}
/** @description Original native intent only; no identity or path reaches the media executor. */
async function native(env:RouteEnvironment,input:Record<string,unknown>):Promise<Record<string,unknown>> {
  if (!nativeEditor(env) || typeof env.ctx.intent !== 'function') throw new EditorError(503,'video_edit_motion_exchange_unavailable');
  try {
    const result = await env.ctx.intent('video.editor',input);
    if (!isRecord(result)) throw new Error('Invalid response'); return result;
  } catch (error) {
    if (error instanceof EditorError) throw error;
    const match = /^(refused|invalid|unavailable): ((?:invalid_)?video_edit_[a-z_]+)$/.exec(error instanceof Error ? error.message : '');
    if (match) throw new EditorError(/too_large|limit/.test(match[2]) ? 413 : /conflict|offset/.test(match[2]) ? 409 : match[1] === 'invalid' ? 400 : match[1] === 'refused' ? 403 : 503,match[2]);
    throw new EditorError(503,'video_edit_motion_exchange_unavailable');
  }
}
async function metadata(ref:string):Promise<ArtifactMetadata> {
  try { const value = await artifactExchange.metadata(ref); if (isRecord(value)) return value as unknown as ArtifactMetadata; } catch { /* deny source/owner/grants without disclosing them */ }
  throw new EditorError(403,'video_edit_motion_source_unavailable');
}
function sourceOf(media:EditorMedia,name:string,motion:MotionSource):TimelineSource {
  return {kind:'video',asset:media.id,name,frames:media.frames,width:media.width!,height:media.height!,audio:media.hasAudio,motion};
}
/** @description Derive only from kernel-attested producer metadata then use the same strict shipped document validator. */
async function lineage(env:RouteEnvironment,ref:string,meta:ArtifactMetadata,name:string):Promise<MotionSource> {
  const receipt = meta.receipt;
  if (meta.ref !== ref || meta.sourcePackage !== 'motion-studio' || !isRecord(receipt) || receipt.state !== 'ready' || receipt.format !== 'mp4'
      || meta.type !== 'video/mp4' || meta.source !== `/api/motion-studio/render-jobs/${receipt.id}` || meta.size !== receipt.bytes || meta.sha256 !== receipt.sha256
      || !Number.isSafeInteger(meta.size) || meta.size < 1 || meta.size > EDITOR_LIMITS.clipBytes
      || !Number.isSafeInteger(receipt.renderWidth) || !Number.isSafeInteger(receipt.renderHeight) || Number(receipt.renderWidth) < 2 || Number(receipt.renderHeight) < 2
      || receipt.width !== 2*Math.ceil(Number(receipt.renderWidth)/2) || receipt.height !== 2*Math.ceil(Number(receipt.renderHeight)/2)) throw new EditorError(400,'video_edit_motion_render_required');
  const motion = {project:receipt.project,revision:receipt.revision,compId:receipt.compId,documentSha256:receipt.documentSha256,
    renderJob:receipt.id,renderSha256:receipt.sha256,startTick:receipt.startTick,endTick:receipt.endTick,frameRate:receipt.frameRate};
  try {
    const document = (await env.validator)({version:1,name:'Motion source',profile:'hd720p30',sources:{v1:{kind:'video',asset:editorId(receipt.id),name,frames:1,width:2,height:2,audio:false,motion}},segments:[],titles:[],audioBed:null});
    const normalized = document.sources.v1.motion!;
    if (!Number.isSafeInteger(receipt.frames) || Number(receipt.frames) < 1 || Number(receipt.frames) > normalized.frameRate.num * EDITOR_LIMITS.clipSeconds / normalized.frameRate.den) throw new Error('Duration');
    return normalized;
  } catch { throw new EditorError(400,'video_edit_motion_render_required'); }
}
function same(left:MotionSource,right:MotionSource):boolean {
  return ['project','revision','compId','documentSha256','renderJob','renderSha256','startTick','endTick'].every(key => left[key as keyof MotionSource] === right[key as keyof MotionSource])
    && left.frameRate.num === right.frameRate.num && left.frameRate.den === right.frameRate.den;
}
/** @description Only native original-Writer calls reach the fixed external Motion catalogue or typed mint. */
async function artifactIntent(env:RouteEnvironment,input:Record<string,unknown>):Promise<Record<string,unknown>> {
  if (!nativeEditor(env) || artifactExchange.native !== true || typeof env.ctx.intent !== 'function') throw new EditorError(503,'video_edit_motion_exchange_unavailable');
  try { const result = await env.ctx.intent('artifact.exchange',input); if (!isRecord(result)) throw new Error('Invalid result'); return result; }
  catch { throw new EditorError(403,'video_edit_motion_source_unavailable'); }
}
/** @description Return every ready owned MP4 receipt; overflow refuses instead of omitting a candidate. */
export async function motionRenders(env:RouteEnvironment,owner:EditorOwner,body:unknown):Promise<object> {
  exactFields(body,[]); await confirm(env,'read',owner)(); await confirm(env,'change',owner)();
  const result = await artifactIntent(env,{op:'motion-renders'});
  if (Object.keys(result).length !== 1 || !Array.isArray(result.jobs) || result.jobs.length > 2) throw new EditorError(503,'video_edit_motion_catalogue_invalid');
  const seen = new Set<string>(),jobs = result.jobs.map(value => {
    if (!isRecord(value) || value.state !== 'ready' || value.format !== 'mp4' || Buffer.byteLength(JSON.stringify(value),'utf8') > 4096) throw new EditorError(503,'video_edit_motion_catalogue_invalid');
    const id = editorId(value.id),project = editorId(value.project),rate = value.frameRate;
    if (seen.has(id) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160
        || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || Number(value.revision) > 1000
        || typeof value.documentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.documentSha256)
        || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
        || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > 276824064
        || !Number.isSafeInteger(value.frames) || Number(value.frames) < 1
        || !isRecord(rate) || Object.keys(rate).length !== 2 || !['num','den'].every(key => Number.isSafeInteger(rate[key]) && Number(rate[key]) > 0 && Number(rate[key]) <= 4294967295)
        || typeof value.compId !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.compId) || BigInt(value.compId) > 18446744073709551615n
        || ![value.startTick,value.endTick].every(tick => typeof tick === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(tick) && BigInt(tick) <= 9223372036854775807n)
        || BigInt(String(value.startTick)) >= BigInt(String(value.endTick))
        || !['width','height','renderWidth','renderHeight'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) > 0 && Number(value[key]) <= 4096)
        || value.width !== 2*Math.ceil(Number(value.renderWidth)/2) || value.height !== 2*Math.ceil(Number(value.renderHeight)/2)
        || ![value.createdAt,value.expiresAt].every(date => typeof date === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date)))) throw new EditorError(503,'video_edit_motion_catalogue_invalid');
    seen.add(id);
    return Object.fromEntries(['id','state','title','project','revision','compId','documentSha256','format','frames','frameRate','startTick','endTick','bytes','sha256','width','height','renderWidth','renderHeight','createdAt','expiresAt'].map(key => [key,key === 'id' ? id : key === 'project' ? project : value[key]]));
  });
  await confirm(env,'read',owner)(); await confirm(env,'change',owner)();return {jobs};
}
/** @description A job ID selects no caller authority: native mint checks the actual original source before unchanged import. */
export async function importMotionJob(env:RouteEnvironment,owner:EditorOwner,id:string,body:unknown):Promise<object> {
  exactFields(body,['id','name','requestKey']); const job = editorId(id);
  if (editorId(body.id) !== job || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) throw new EditorError(400,'invalid_video_edit_motion_import');
  const requestKey = editorId(body.requestKey); await confirm(env,'read',owner)(); await confirm(env,'change',owner)();
  const artifact = await artifactIntent(env,{op:'mint',mode:'motion-render',source:`/api/motion-studio/render-jobs/${job}`,type:'video/mp4',name:body.name});
  if (typeof artifact.ref !== 'string' || !/^art_[a-f0-9]{64}$/.test(artifact.ref)) throw new EditorError(503,'video_edit_motion_exchange_unavailable');
  const meta = await metadata(artifact.ref);
  if (!isRecord(meta.receipt) || meta.receipt.id !== job || meta.source !== `/api/motion-studio/render-jobs/${job}`) throw new EditorError(503,'video_edit_motion_source_changed');
  return importMotion(env,owner,{ref:artifact.ref,name:body.name,requestKey},job);
}
/** @description Current Video grants and original Motion export authority recheck each bounded disk/native exchange. */
export async function importMotion(env:RouteEnvironment,owner:EditorOwner,body:unknown,expectedJob?:string):Promise<object> {
  exactFields(body,['ref','name','requestKey']);
  if (typeof body.ref !== 'string' || !/^art_[a-f0-9]{64}$/.test(body.ref) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) throw new EditorError(400,'invalid_video_edit_motion_import');
  const ref = body.ref, name = body.name, requestKey = editorId(body.requestKey);
  const recheck = async () => {await confirm(env,'read',owner)(); await confirm(env,'change',owner)();};
  await recheck();
  if (!nativeEditor(env) || artifactExchange.native !== true) throw new EditorError(503,'video_edit_motion_exchange_unavailable');
  const meta = await metadata(ref), motion = await lineage(env,ref,meta,name);
  if (expectedJob !== undefined && motion.renderJob !== expectedJob) throw new EditorError(503,'video_edit_motion_source_changed');
  const retry = await env.store.motionImport(owner,requestKey);
  if (retry) {
    if (!same(retry.source,motion)) throw new EditorError(409,'video_edit_motion_import_conflict');
    const media = await env.store.getMedia(owner,retry.asset); await recheck();
    return {media,sourceMetadata:sourceOf(media,name,retry.source),sourceUrl:`/api/motion-studio/app?project=${motion.project}&revision=${motion.revision}&compId=${motion.compId}`,replayed:true};
  }
  const requestDigest=createHash('sha256').update(JSON.stringify(['motion-render-to-video/1',motion,meta.size,meta.sha256])).digest('hex');
  const upload = await native(env,{op:'upload_begin',kind:'video',bytes:meta.size,requestKey,contentSha256:meta.sha256,requestDigest});
  const chunkBytes = Number(upload.chunkBytes);
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 65536 || chunkBytes > 131072 || chunkBytes % 65536 !== 0) throw new EditorError(503,'video_edit_motion_exchange_unavailable');
  const id = editorId(upload.id), status = await native(env,{op:'upload_status',id});
  const acknowledged=Number(status.offset);
  if(status.id !== id || status.kind !== 'video' || status.bytes !== meta.size || status.chunkBytes !== chunkBytes || status.contentSha256 !== meta.sha256 || status.requestDigest !== requestDigest
      || !Number.isSafeInteger(acknowledged) || acknowledged < 0 || acknowledged > meta.size || acknowledged % chunkBytes !== 0 && acknowledged !== meta.size || status.media !== undefined && acknowledged !== meta.size) throw new EditorError(503,'video_edit_motion_upload_receipt_invalid');
  const digest = createHash('sha256'); let offset = 0, received = 0, pending = Buffer.alloc(0);
  while (received < meta.size) {
    await recheck(); let result:unknown;
    try { result = await artifactExchange.chunk(ref,received); } catch {throw new EditorError(403,'video_edit_motion_source_unavailable');}
    if (!isRecord(result) || result.ref !== ref || result.offset !== received || result.size !== meta.size || typeof result.dataBase64 !== 'string' || result.dataBase64.length > 87384) throw new EditorError(503,'video_edit_motion_chunk_invalid');
    const bytes = Buffer.from(result.dataBase64,'base64');
    if (!bytes.length || bytes.length > 65536 || bytes.toString('base64') !== result.dataBase64 || received + bytes.length > meta.size || result.done !== (received + bytes.length === meta.size)) throw new EditorError(503,'video_edit_motion_chunk_invalid');
    digest.update(bytes); received += bytes.length; pending = Buffer.concat([pending,bytes]);
    while (pending.length >= chunkBytes || (received === meta.size && pending.length)) {
      const part = pending.subarray(0,chunkBytes); await recheck();
      if(offset >= acknowledged) {
        const appended=await native(env,{op:'upload_chunk',id,offset,data:part.toString('base64'),sha256:createHash('sha256').update(part).digest('hex')});
        if(appended.offset !== offset + part.length) throw new EditorError(503,'video_edit_motion_upload_receipt_invalid');
      }
      offset += part.length; pending = pending.subarray(part.length);
    }
  }
  if (digest.digest('hex') !== meta.sha256) throw new EditorError(503,'video_edit_motion_digest_mismatch');
  const latest = await metadata(ref), latestMotion = await lineage(env,ref,latest,name);
  if (latest.size !== meta.size || latest.sha256 !== meta.sha256 || !same(motion,latestMotion)) throw new EditorError(409,'video_edit_motion_source_changed');
  await recheck(); const result = status.media ? status : await native(env,{op:'upload_finish',id}), media = result.media as EditorMedia;
  if (!isRecord(media) || media.id !== id || media.sha256 !== meta.sha256 || media.bytes !== meta.size || media.kind !== 'video' || media.container !== 'mp4' || media.videoCodec !== 'h264') throw new EditorError(503,'video_edit_motion_media_mismatch');
  const expectedFrames = Number(meta.receipt.frames) * 30 * motion.frameRate.den / motion.frameRate.num;
  if (Math.abs(media.frames - expectedFrames) > 1 || Math.abs(media.durationMs - Number(meta.receipt.frames) * 1000 * motion.frameRate.den / motion.frameRate.num) > 67
      || media.width !== meta.receipt.width || media.height !== meta.receipt.height) throw new EditorError(503,'video_edit_motion_media_mismatch');
  const source = sourceOf(media,name,motion);
  try {(await env.validator)({version:1,name:'Motion source',profile:'hd720p30',sources:{v1:source},segments:[],titles:[],audioBed:null});}
  catch {throw new EditorError(400,'video_edit_motion_media_mismatch');}
  const publication = async () => {
    await recheck(); const current = await metadata(ref), currentMotion = await lineage(env,ref,current,name);
    if (current.size !== meta.size || current.sha256 !== meta.sha256 || !same(motion,currentMotion)) throw new EditorError(409,'video_edit_motion_source_changed');
  };
  await env.store.addMedia(owner,media,publication,{source:motion,requestKey});
  return {media,sourceMetadata:source,sourceUrl:`/api/motion-studio/app?project=${motion.project}&revision=${motion.revision}&compId=${motion.compId}`,replayed:false};
}
export function motionRoutes(router:Router,env:RouteEnvironment):void {
  router.post('/editor/motion-renders',admit(env,'read'),admit(env,'change'),bodyParser,handler(env,'change',async (req,res,owner) => {res.json(await motionRenders(env,owner,req.body));}));
  router.post('/editor/motion-render-jobs/:id/import',admit(env,'read'),admit(env,'change'),bodyParser,handler(env,'change',async (req,res,owner) => {res.status(201).json(await importMotionJob(env,owner,req.params.id,req.body));}));
  router.post('/editor/motion-media',admit(env,'read'),admit(env,'change'),bodyParser,handler(env,'change',async (req,res,owner) => {res.status(201).json(await importMotion(env,owner,req.body));}));
}
