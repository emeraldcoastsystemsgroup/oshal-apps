/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify native admitted metadata and unchanged legacy connection ownership queries.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=require.resolve('../routes/routes.js'),localRequire=createRequire(filename);

/** Load the actual route factory with only framework registration ports replaced. */
function fixture(native,inventory) {
  const paths=new Map(),queries=[],intents=[],tenants=[];
  const router={get:(path,fn)=>paths.set(path,fn),use(){},put(){},post(){}};
  const aliases={
    '@/app/routes/connector-account-operations':{getValidAccessToken:()=>assert.fail('no credential read')},
    '@/app/routes/connector-tenancy':{getUserTenantIds:async(_pool,sub)=>{tenants.push(sub);return ['shared-fixture'];}},
    '@/features/voice/services/voice-service':{VoiceService:class{transcribeAudio(){assert.fail('no speech');}}},
    '@/features/voice-providers':{getSTTProviderRegistry:()=>({get:()=>({getStatus:async()=>({configured:false})})})},
    '@/shared/services/database/request-identity':{},'./callback':{callbackVerifier:()=>assert.fail('no callback')},
  };
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>{
    if(name==='express')return{Router:()=>router,json:()=>()=>{},raw:()=>()=>{}};
    return aliases[name]||localRequire(name);
  }},{filename});
  const ctx={pool:{storageModel:native?'kernel-scoped-documents':undefined,query:async(sql,args)=>{
    queries.push({sql,args});
    return{rows:sql.includes('FROM oshal_connections')?[{id:'legacy',label:'Legacy account',scope:'shared'}]:[]};
  }},authorization:{currentActor:()=>({sub:'fixture-owner',issuer:'fixture-issuer',isActive:true}),registerResource(){}},tools:{register(){}},
  intent:async(name,input)=>{intents.push({name,input});if(inventory instanceof Error)throw inventory;return inventory;}};
  module.exports.createCallingRoutes(ctx);
  return{queries,intents,tenants,async tasks(path='/tasks'){
    const response={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;}};
    await paths.get(path)({},response,error=>{throw error;});return response;
  }};
}

test('native inventory uses the admitted intent, omits revoked and foreign providers, and exposes no credentials',async()=>{
  const fx=fixture(true,{connections:[
    {id:'personal',label:'Personal',provider:'twilio',shared:false,revoked:false},
    {id:'shared',label:'Shared',provider:'twilio',shared:true,revoked:false},
    {id:'revoked',provider:'twilio',revoked:true},{id:'other',provider:'google',revoked:false},
  ]});
  const result=await fx.tasks('/config');
  assert.equal(result.statusCode,200);
  assert.deepEqual(fx.intents.map(x=>x.name),['connectors.metadata']);
  assert.equal(Object.keys(fx.intents[0].input).length,0);
  assert.equal(fx.tenants.length,0);
  assert.equal(fx.queries.some(x=>x.sql.includes('oshal_connections')),false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.body.connections)),[
    {id:'personal',label:'Personal',scope:'personal'},{id:'shared',label:'Shared',scope:'shared'}]);
  assert.equal(JSON.stringify(result.body).includes('revoked'),false);
});
test('native inventory failure is explicit and never falls back to an empty legacy table',async()=>{
  const fx=fixture(true,new Error('unavailable'));const result=await fx.tasks();
  assert.equal(result.statusCode,503);assert.equal(result.body.error,'calling_service_unavailable');
  assert.equal(fx.queries.some(x=>x.sql.includes('oshal_connections')),false);
});
test('malformed native metadata refuses instead of presenting zero connections',async()=>{
  const result=await fixture(true,{}).tasks();assert.equal(result.statusCode,503);
  assert.equal(result.body.error,'connection_inventory_unavailable');
});
test('legacy inventory retains owner and tenant predicates without calling native intents',async()=>{
  const fx=fixture(false,{});assert.equal((await fx.tasks()).statusCode,200);
  assert.equal(fx.intents.length,0);assert.deepEqual(fx.tenants,['fixture-owner']);
  const query=fx.queries.find(x=>x.sql.includes('FROM oshal_connections'));
  assert.match(query.sql,/user_sub=\$1 AND tenant_id IS NULL/);
  assert.match(query.sql,/tenant_id=ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(Array.from(query.args),['fixture-owner',['shared-fixture']]);
});
