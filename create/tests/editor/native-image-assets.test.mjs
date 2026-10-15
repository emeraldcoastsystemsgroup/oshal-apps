/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify real image normalization and same-client native transport using an explicitly simulated SQL/native backend; genuine kernel coverage is separate.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {loadCompiled, sharp} from '../project-api.fixture.mjs';
const {CreateProjectStore}=loadCompiled('create-project-store.js');
const {saveProjectImage,readProjectImage}=loadCompiled('create-project-assets.js');
const owner={issuer:'urn:create-native-image-fixture',sub:'synthetic-owned-person'};
const image=()=>sharp({create:{width:2,height:2,channels:4,background:'#ff0000'}}).png().toBuffer();
const digest=value=>createHash('sha256').update(value).digest('hex');
function fixture({failInsert=false,lostCommit=false,quota=false,corruptRead=false}={}){
 const events=[],active=new Map(),committed=new Map();
 const dispatch=async(functionName,input)=>{
  events.push({functionName,input});
  const connection=input.connection||input.input?.sqlConnection;
  if(functionName==='sql_query'){
   if(input.transaction==='begin'){active.set(connection,new Map(committed));return {rows:[],rowCount:0};}
   if(input.transaction==='rollback'){active.delete(connection);return {rows:[],rowCount:0};}
   if(input.transaction==='commit'){
    const transaction=active.get(connection);assert.ok(transaction);
    committed.clear();for(const [key,value]of transaction)committed.set(key,value);active.delete(connection);
    if(lostCommit)throw new Error('Named fixture: committed acknowledgement lost');return {rows:[],rowCount:0};
   }
   const text=input.text;
   if(text.includes('COUNT(*)'))return {rows:[{count:0,bytes:0}],rowCount:1};
   if(text.startsWith('INSERT INTO create_project_assets')){
    if(failInsert)throw new Error('Named fixture: metadata admission refused');
    const [issuer,sub,id,width,height,bytes,sha256]=input.values;
    assert.equal(issuer,owner.issuer);assert.equal(sub,owner.sub);
    const current=active.get(connection);assert.ok(current?.has(id));current.set(id,{...current.get(id),metadata:{id,width,height,bytes,sha256}});
    return {rows:[],rowCount:1};
   }
   if(text.includes('FROM create_project_assets')&&text.includes('asset_id=$3')){
    const selected=(active.get(connection)||committed).get(input.values[2]);
    return {rows:selected?.metadata?[{asset_id:selected.metadata.id,width:selected.metadata.width,height:selected.metadata.height,byte_length:selected.metadata.bytes,sha256:selected.metadata.sha256}]:[],rowCount:selected?.metadata?1:0};
   }
   return {rows:[],rowCount:0};
  }
  assert.equal(functionName,'intent');assert.ok(active.has(connection),'native call uses the actual held SQL transaction');
  const body=input.input;
  assert.ok(!['owner','tenant','issuer','subject','path'].some(key=>key in body),'no caller identity or host path claims');
  if(input.name==='create.image.save'){
   if(quota)return {error:'create_native_image_limit',status:413};
   const bytes=Buffer.from(body.contentBase64,'base64');assert.equal(digest(bytes),body.sha256);
   active.get(connection).set(body.id,{bytes});
   return {id:body.id,src:'/api/create/project-assets/'+body.id,width:body.width,height:body.height,bytes:bytes.length,sha256:body.sha256};
  }
  assert.equal(input.name,'create.image.read');const selected=active.get(connection).get(body.id);
  assert.ok(selected?.metadata,'native read only sees committed immutable metadata');
  const bytes=corruptRead?Buffer.from('wrong bytes'):selected.bytes;
  return {...selected.metadata,src:'/api/create/project-assets/'+body.id,contentBase64:bytes.toString('base64')};
 };
 // Explicitly simulated client binding. The genuine kernel fixture verifies the actual pg_pool bridge.
 const pool={storageModel:'kernel-scoped-documents',async connect(){
  const connection=randomUUID();
  return {release(){},query(text,values=[]){
   const transaction={'BEGIN':'begin','BEGIN READ ONLY':'begin','COMMIT':'commit','ROLLBACK':'rollback'}[text];
   return dispatch('sql_query',transaction?{connection,transaction}:{connection,text,values});
  },nativeExecutor(name,input){return dispatch('intent',{name,input:{...input,sqlConnection:connection}});}};
 }};
 return {events,committed,store:new CreateProjectStore(pool)};
}
test('real normalized PNG and metadata commit on the same checked-out native connection without filesystem writes',async()=>{
 const f=fixture(),root='/unwritable-create-native-fixture',value=await saveProjectImage(root,f.store,owner,await image(),async()=>{});
 assert.equal(existsSync(root),false);assert.equal(f.committed.size,1);
 const native=f.events.find(e=>e.functionName==='intent');const metadata=f.events.find(e=>e.input.text?.startsWith('INSERT INTO create_project_assets'));
 assert.equal(native.input.input.sqlConnection,metadata.input.connection);
 const bytes=await readProjectImage(root,f.store,owner,value.id);
 assert.equal(digest(bytes),value.sha256);assert.equal((await sharp(bytes).raw().toBuffer())[0],255);
 assert.equal(f.committed.get(value.id).metadata.id,value.id);
});
test('metadata refusal rolls native PNG bytes back with the same original transaction',async()=>{
 const f=fixture({failInsert:true});await assert.rejects(saveProjectImage('/unwritable-create-native-fixture',f.store,owner,await image(),async()=>{}));
 assert.equal(f.committed.size,0);assert.ok(f.events.some(e=>e.input.transaction==='rollback'));
});
test('lost committed acknowledgement retains bytes and immutable metadata together instead of deleting successful bytes',async()=>{
 const f=fixture({lostCommit:true});await assert.rejects(saveProjectImage('/unwritable-create-native-fixture',f.store,owner,await image(),async()=>{}));
 assert.equal(f.committed.size,1);const saved=[...f.committed.values()][0];assert.equal(digest(saved.bytes),saved.metadata.sha256);
});
test('explicit native quota refuses with 413 before publishing immutable metadata',async()=>{
 const f=fixture({quota:true});await assert.rejects(saveProjectImage('/unwritable-create-native-fixture',f.store,owner,await image(),async()=>{}),error=>error.status===413&&error.code==='create_native_image_limit');
 assert.equal(f.committed.size,0);assert.ok(!f.events.some(e=>e.input.text?.startsWith('INSERT INTO create_project_assets')));
});
test('corrupt native content never falls back to legacy filesystem bytes',async()=>{
 const f=fixture({corruptRead:true}),value=await saveProjectImage('/unwritable-create-native-fixture',f.store,owner,await image(),async()=>{});
 await assert.rejects(readProjectImage('/unwritable-create-native-fixture',f.store,owner,value.id),error=>error.code==='project_asset_storage_unavailable');
});
