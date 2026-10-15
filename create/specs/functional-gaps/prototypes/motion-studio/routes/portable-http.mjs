/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bind full-capacity owner-checked editable transfers to fresh native HTTP requests and bounded agent arguments.
 */
import { createRequire } from 'node:module';
import { MotionBundleTransfers, TRANSFER_LIMITS } from './bundle-transfers.mjs';
import { MotionError, LIMITS } from './project-store.mjs';
const {raw} = createRequire(import.meta.url)('express');
export const binaryChunkParser = raw({type:'application/octet-stream',limit:TRANSFER_LIMITS.chunkBytes});
export const AGENT_CHUNK_BYTES = 8192;
const fail = code => { throw new MotionError(400,code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : fail('motion_invalid_transfer_id');
const offset = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,8})$/.test(value) && Number(value) <= TRANSFER_LIMITS.bytes ? Number(value) : fail('motion_invalid_transfer_offset');
function fields(value,allowed) { if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))) fail('motion_invalid_transfer_input'); }
function bodyId(req,body) { if(body.id!==undefined && uuid(body.id)!==uuid(req.params.transfer)) fail('motion_id_mismatch'); }
const service = ctx => new MotionBundleTransfers(ctx,process.env.OSHAL_PACKAGE_DATA_DIR);
export function mountPortableRoutes(router,run) {
  router.post('/bundle-imports',run('copy',async(req,_store,ctx)=>{
    fields(req.body,['bytes','sha256','title','requestKey']); return {transfer:await service(ctx).beginImport(req.body)};
  },true));
  router.get('/bundle-imports/:transfer',run('copy',async(req,_store,ctx)=>({transfer:await service(ctx).status(uuid(req.params.transfer),'import')})));
  router.post('/bundle-imports/:transfer/chunks/:offset',run('copy',async(req,_store,ctx)=>{
    if(!/^application\/octet-stream(?:\s*;|$)/i.test(req.headers?.['content-type']||'') || !(req.body instanceof Uint8Array)) fail('motion_binary_transfer_required');
    if(req.body.byteLength>TRANSFER_LIMITS.chunkBytes)throw new MotionError(413,'motion_transfer_chunk_limit');
    return {transfer:await service(ctx).append(uuid(req.params.transfer),offset(req.params.offset),req.body)};
  },'binary'));
  router.post('/bundle-imports/:transfer/chunks',run('copy',async(req,_store,ctx)=>{
    const body=req.body; fields(body,['id','offset','dataBase64']);bodyId(req,body);
    if(!Number.isSafeInteger(body.offset)||body.offset<0||typeof body.dataBase64!=='string'||body.dataBase64.length>Math.ceil(AGENT_CHUNK_BYTES/3)*4)fail('motion_invalid_transfer_chunk');
    const bytes=Buffer.from(body.dataBase64,'base64');if(!bytes.length||bytes.length>AGENT_CHUNK_BYTES||bytes.toString('base64')!==body.dataBase64)fail('motion_invalid_transfer_chunk');
    return {transfer:await service(ctx).append(uuid(req.params.transfer),body.offset,bytes)};
  },true));
  router.post('/bundle-imports/:transfer/finish',run('copy',async(req,store,ctx)=>{
    fields(req.body,['id']);bodyId(req,req.body);const transfer=await service(ctx).finishImport(store,uuid(req.params.transfer));return {transfer,project:transfer.project};
  },true));
  router.post('/bundle-imports/:transfer/cancel',run('copy',async(req,_store,ctx)=>{
    fields(req.body,['id']);bodyId(req,req.body);return service(ctx).cancel(uuid(req.params.transfer),'import');
  },true));
  router.post('/projects/:id/bundle-exports',run('export',async(req,store,ctx)=>{
    const body=req.body;fields(body,['id','revision','requestKey']);if(body.id!==undefined&&body.id!==req.params.id)fail('motion_id_mismatch');
    if(!Number.isSafeInteger(body.revision)||body.revision<1||body.revision>LIMITS.revisions)fail('motion_invalid_revision');
    const transfer=await service(ctx).prepareExport(store,uuid(req.params.id),body.revision,uuid(body.requestKey));
    return {transfer,openUrl:'/api/motion-studio/app?bundleTransfer='+transfer.id,requiresPermission:'project.export'};
  },true));
  router.get('/bundle-exports/:transfer',run('export',async(req,_store,ctx)=>({transfer:await service(ctx).status(uuid(req.params.transfer),'export')})));
  router.get('/bundle-exports/:transfer/chunks/:offset',run('export',async(req,store,ctx)=>{
    const chunk=await service(ctx).readChunk(store,uuid(req.params.transfer),offset(req.params.offset));
    const {bytes,...metadata}=chunk;return {chunk:{...metadata,bytes:chunk.received,dataBase64:bytes.toString('base64')}};
  }));
  router.get('/bundle-exports/:transfer/artifact-chunks/:offset',run('export',async(req,store,ctx)=>({chunk:await service(ctx).readFragment(store,uuid(req.params.transfer),offset(req.params.offset))})));
  router.post('/bundle-exports/:transfer/cancel',run('export',async(req,_store,ctx)=>{
    fields(req.body,['id']);bodyId(req,req.body);return service(ctx).cancel(uuid(req.params.transfer),'export');
  },true));
}
