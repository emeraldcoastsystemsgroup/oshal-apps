/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bind approved bounded agent uploads to sealed native effect targets and one original-owned atomic revision.
 */
import {MotionValueTransfers,VALUE_LIMITS,valueTarget} from './value-transfers.mjs';
import {MotionError} from './project-store.mjs';
import {motionEngine} from './engine-client.mjs';
import {ownedAssets} from './assets.mjs';
import {decimalId} from '../tools/native-json.mjs';
const fail=(status,code)=>{throw new MotionError(status,code);};
function fields(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail(400,'motion_invalid_value_input');}
const uid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)?value:fail(400,'motion_invalid_transfer_id');
function identity(req,body){if(body.id!==undefined&&uid(body.id)!==uid(req.params.transfer))fail(400,'motion_id_mismatch');}
const service=(ctx,store)=>new MotionValueTransfers(ctx,process.env.OSHAL_PACKAGE_DATA_DIR,store);
export function mountValueRoutes(router,run){
 router.post('/value-uploads',run('change',async(req,store,ctx)=>{
  const body=req.body;fields(body,['project','revision','compId','layer','effect','prop','compTimeTicks','bytes','sha256','requestKey']);
  const target=valueTarget({project:body.project,revision:body.revision,compId:body.compId,layer:body.layer,effect:body.effect,prop:body.prop,compTimeTicks:body.compTimeTicks});
  const project=await store.get(target.project,target.revision),sample=await motionEngine(ctx,{op:'edit',document:project.document,assets:await ownedAssets(project.document,store),comp:decimalId(target.compId),commands:[{command:'properties.inspectAt',params:{layer:target.layer,effect:target.effect,compTimeTicks:target.compTimeTicks}}]});
  const inspection=sample.results?.[0],prop=inspection?.properties?.find(p=>p.prop===target.prop);
  if(!prop||prop.valueType!=='string'||inspection.locked)fail(400,'motion_invalid_value_target');
  return{transfer:await service(ctx,store).begin({target,bytes:body.bytes,sha256:body.sha256,requestKey:body.requestKey})};
 },true));
 router.get('/value-uploads/:transfer',run('change',async(req,store,ctx)=>({transfer:await service(ctx,store).status(uid(req.params.transfer))})));
 router.post('/value-uploads/:transfer/chunks',run('change',async(req,store,ctx)=>{
  const body=req.body;fields(body,['id','offset','dataBase64']);identity(req,body);
  if(!Number.isSafeInteger(body.offset)||body.offset<0||typeof body.dataBase64!=='string'||body.dataBase64.length>Math.ceil(VALUE_LIMITS.chunkBytes/3)*4)fail(400,'motion_invalid_value_chunk');
  const bytes=Buffer.from(body.dataBase64,'base64');if(!bytes.length||bytes.length>VALUE_LIMITS.chunkBytes||bytes.toString('base64')!==body.dataBase64)fail(400,'motion_invalid_value_chunk');
  return{transfer:await service(ctx,store).append(uid(req.params.transfer),body.offset,bytes)};
 },true));
 router.post('/value-uploads/:transfer/finish',run('change',async(req,store,ctx)=>{
  fields(req.body,['id']);identity(req,req.body);
  const transfer=await service(ctx,store).finish(uid(req.params.transfer),async(target,value,requestKey)=>{
   const base=await store.get(target.project,target.revision),result=await motionEngine(ctx,{op:'edit',document:base.document,assets:await ownedAssets(base.document,store),comp:decimalId(target.compId),commands:[{command:'properties.patchAt',params:{layer:target.layer,effect:target.effect,compTimeTicks:target.compTimeTicks,changes:[{prop:target.prop,value}]}}]});
   return store.save(base.id,{title:base.title,document:result.document,baseRevision:target.revision,requestKey});
  });return{transfer,project:transfer.project};
 },true));
 router.post('/value-uploads/:transfer/cancel',run('change',async(req,store,ctx)=>{fields(req.body,['id']);identity(req,req.body);return service(ctx,store).cancel(uid(req.params.transfer));},true));
}
