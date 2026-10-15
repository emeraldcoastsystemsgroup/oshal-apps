/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise production HTTP/UI code over real shared-PG owned persistence and the real framed compositor; fixture actors are explicit, not installed authorization.
 */
import { createRequire } from 'node:module';
import Module from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { connect } from 'node:net';
import { startMotionBridge } from '../engine/bridge.mjs';
const repository=resolve(import.meta.dirname,'../..');
const deps=createRequire(join(process.env.STORE_CI_TOOLCHAIN||resolve(repository,'scripts/toolchain'),'package.json'));
const raster=createRequire(join(process.env.MOTION_RASTER_DEPS||'/tmp/oshal-create-proof-ZFGNIA','package.json'));
const express=deps('express'),multer=deps('multer'),sharp=raster('sharp'),{Pool}=deps('pg');
export const {chromium}=deps('playwright');
const original=Module._load;
Module._load=function(request,...rest){if(request==='express')return express;if(request==='multer')return multer;if(request==='sharp')return sharp;return original.call(this,request,...rest);};
const {createMotionRoutes}=await import('../routes/application.mjs');
Module._load=original;
// The decoder resolves sharp only on upload; its require must use the same explicit fixture seam.
const sharpLoad=Module._load;
Module._load=function(request,...rest){return request==='sharp'?sharp:sharpLoad.call(this,request,...rest);};

async function exchange(bridge,request,timeoutMs){return new Promise((done,reject)=>{
 const socket=connect(bridge.address.port,'127.0.0.1');let tail='',hello,settled=false;const timer=setTimeout(()=>{socket.destroy();reject(new Error('fixture relay timeout'));},timeoutMs);
 socket.on('error',reject);socket.on('data',data=>{tail+=data.toString('utf8');for(;;){const end=tail.indexOf('\n');if(end<0)break;const value=JSON.parse(tail.slice(0,end));tail=tail.slice(end+1);if(!hello){hello=value;if(value.error){settled=true;clearTimeout(timer);socket.destroy();done({hello,reply:null});}else socket.write(JSON.stringify({...request,id:1})+'\n');}else{settled=true;clearTimeout(timer);socket.destroy();done({hello,reply:value});}}});
 socket.on('close',()=>{clearTimeout(timer);if(!settled)reject(new Error('fixture relay closed'));});
});}
export async function startApplicationFixture({exchangeTimeoutMs=10000}={}){
 if(!Number.isSafeInteger(exchangeTimeoutMs)||exchangeTimeoutMs<1||exchangeTimeoutMs>45000)throw new Error('Fixture exchange must remain inside the actual45second bridge profile');
 let dsn;const raw=process.env.OSHAL_TEST_POSTGRES||(process.env.MOTION_TEST_DSN_FILE?(await readFile(process.env.MOTION_TEST_DSN_FILE,'utf8')).trim():'');
 try{dsn=new URL(raw);}catch{throw new Error('Explicit shared disposable PG URL required');}
 if(dsn.hostname!=='127.0.0.1'||dsn.port!=='35689')throw new Error('Only shared disposable PG35689 permitted');
 const suffix=randomUUID().replaceAll('-',''),schema='motion_http_'+suffix,role='motion_http_role_'+suffix,password=randomUUID();
 const admin=new Pool({connectionString:dsn.href,max:2});await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
 const client=await admin.connect();try{await client.query(`SET search_path TO ${schema}`);await client.query(await readFile(new URL('../migrations/001-motion-projects.sql',import.meta.url),'utf8'));await client.query(await readFile(new URL('../migrations/native/001-motion.sql',import.meta.url),'utf8'));}finally{client.release();}
 await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
 const userDsn=new URL(dsn);userDsn.username=role;userDsn.password=password;const pool=new Pool({connectionString:userDsn.href,options:`-c search_path=${schema}`,max:8});
 const bridge=await startMotionBridge({binary:process.env.MOTION_ENGINE_BINARY});const scope=new AsyncLocalStorage(),state={denied:new Map(),afterEngine:null,engineCalls:0,requests:[]};
 const ctx={appPackageDir:resolve(import.meta.dirname,'..'),pool,authorization:{registerResource(){},currentActor:()=>scope.getStore()?.actor,
  authorize:async({permission})=>({allowed:!state.denied.get(scope.getStore()?.actor.sub)?.has(permission)})},
  intent:async(name,input)=>{if(name!=='engine.exchange')throw new Error('unexpected fixture intent');state.engineCalls++;const result=await exchange(bridge,input.request,exchangeTimeoutMs);await state.afterEngine?.(scope.getStore());return result;}};
 const app=express();app.use((req,res,next)=>{state.requests.push({method:req.method,path:req.path});const sub=req.header('x-fixture-user')||'alice';scope.run({actor:{issuer:'motion-http-fixture',sub,isActive:true}},next);});
 app.use('/api/motion-studio',createMotionRoutes(ctx));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 return{origin:`http://127.0.0.1:${server.address().port}`,state,bridge,ctx,image:()=>sharp({create:{width:16,height:8,channels:4,background:{r:255,g:0,b:0,alpha:.5}}}).png().toBuffer(),
  close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));await bridge.close();await pool.end();try{await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.query(`DROP ROLE ${role}`);}finally{await admin.end();}}};
}
