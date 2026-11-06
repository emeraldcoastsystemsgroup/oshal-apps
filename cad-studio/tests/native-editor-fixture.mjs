/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Disposable PostgreSQL owner role plus isolated local OCCT/Scene engine image and actual package HTTP/assets; fixture identity is explicit.
 */
import {createRequire} from 'node:module';
import Module from 'node:module';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {connect} from 'node:net';
const execute=promisify(execFile),repository=resolve(import.meta.dirname,'../..');
const deps=createRequire(join(process.env.STORE_CI_TOOLCHAIN||resolve(repository,'scripts/toolchain'),'package.json'));
const express=deps('express'),{Pool}=deps('pg');export const{chromium}=deps('playwright');
const noop=()=>{};
function packageRoutes(id){const old=Module._load;Module._load=function(request,parent,...rest){if(request==='@/shared/security/explicit-write-confirmation')return{hasExplicitWriteConfirmation:b=>b?.confirm===true,confirmationRequiredPayload:(action,description)=>({error:'confirmation_required',action,description})};if(request==='@/shared/logger')return{createChildLogger:()=>({debug:noop,info:noop,warn:noop,error:noop})};if(!request.startsWith('.')&&!request.startsWith('node:')&&!request.startsWith('/')&&!Module.builtinModules.includes(request)&&parent?.filename?.startsWith(join(repository,id)))return old.call(this,deps.resolve(request),parent,...rest);return old.call(this,request,parent,...rest);};try{return createRequire(import.meta.url)(join(repository,id,'routes',id+'-routes.js'));}finally{Module._load=old;}}
async function ready(port){for(let n=0;n<40;n++){try{return await new Promise((ok,no)=>{const s=connect(port,'127.0.0.1');let data='',done=false;const timer=setTimeout(()=>finish(new Error('engine hello timeout')),2000);function finish(error,value){if(done)return;done=true;clearTimeout(timer);s.destroy();error?no(error):ok(value);}s.on('data',chunk=>{data+=chunk;if(data.includes('\n')){try{const value=JSON.parse(data.split('\n')[0]).bridge.buildHash;if(!/^[a-f0-9]{64}$/.test(value))throw new Error('Invalid native build identity');finish(null,value);}catch(error){finish(error);}}});s.on('error',finish);s.on('close',()=>{if(!done)finish(new Error('Engine hello closed'));});});}catch{await new Promise(ok=>setTimeout(ok,100));}}throw new Error('The isolated native engine did not become ready.');}
export async function startNativeEditorFixture({appId='cad-studio'}={}){
 if(!['cad-studio','scene-studio'].includes(appId))throw new Error('Unknown native fixture app');const dsn=new URL(process.env.OSHAL_TEST_POSTGRES||'');if(dsn.hostname!=='127.0.0.1'||dsn.port!=='35689')throw new Error('Only explicit shared disposable PG35689 is permitted');
 const suffix=randomUUID().replaceAll('-',''),schema='editor_'+suffix,role='editor_role_'+suffix,password=randomUUID(),admin=new Pool({connectionString:dsn.href,max:2}),container='editor-'+appId+'-'+suffix;
 let pool,server,root,createdRole=false,createdSchema=false,started=false;
 const close=async()=>{server?.closeAllConnections();if(server)await new Promise(ok=>server.close(ok));if(pool)await pool.end();if(started)await execute('docker',['rm','-f',container]).catch(()=>{});if(root)await rm(root,{recursive:true,force:true});try{if(createdSchema)await admin.query(`DROP SCHEMA ${schema} CASCADE`);if(createdRole)await admin.query(`DROP ROLE ${role}`);}finally{await admin.end();}};
 try{
  const image=appId==='cad-studio'?process.env.CAD_EDITOR_ENGINE_IMAGE||'oshal-cad-studio-engine:local':process.env.SCENE_EDITOR_ENGINE_IMAGE||'d9669abf38d3',enginePort=appId==='cad-studio'?7412:7414;
  await execute('docker',['run','--pull=never','--detach','--rm','--name',container,'--label','oshal.editor-review-fixture=true','--publish',`127.0.0.1::${enginePort}`,'--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=1g','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','3g','--cpus','2',image],{maxBuffer:4096});started=true;
  const {stdout:binding}=await execute('docker',['port',container,String(enginePort)]);const port=Number(binding.trim().split(':').at(-1));const engineHash=await ready(port);if(process.env.EDITOR_FIXTURE_DEBUG)process.stderr.write('native engine ready\n');
  await admin.query(`CREATE SCHEMA ${schema}`);createdSchema=true;await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);createdRole=true;
  if(process.env.EDITOR_FIXTURE_DEBUG)process.stderr.write('native SQL schema/role ready\n');const client=await admin.connect();try{await client.query(`SET search_path TO ${schema}`);await client.query(await readFile(join(repository,appId,'migrations',appId==='cad-studio'?'001-cad-studio.sql':'001-scene-studio.sql'),'utf8'));}finally{client.release();}
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  if(process.env.EDITOR_FIXTURE_DEBUG)process.stderr.write('native migration/grants ready\n');const owned=new URL(dsn);owned.username=role;owned.password=password;pool=new Pool({connectionString:owned.href,options:`-c search_path=${schema} -c oshal.current_sub=alice`,max:8});root=await mkdtemp(join(tmpdir(),appId+'-editor-'));
  const routes=packageRoutes(appId),make=routes[appId==='cad-studio'?'createCadStudioRoutes':'createSceneStudioRoutes'],app=express(),requests=[];
  app.use((req,res,next)=>{req.oshalCallerSub=req.header('x-fixture-user')||'alice';requests.push({method:req.method,path:req.path});next();});
  app.use(express.json({limit:'12mb'}));app.use('/api/'+appId,make({pool,appPackageDir:join(repository,appId)},{dataRoot:root,env:{[appId==='cad-studio'?'CAD_STUDIO_ENGINE_ADDR':'SCENE_STUDIO_ENGINE_ADDR']:'127.0.0.1:'+port},engineBuild:engineHash,rebuildTimeoutMs:90000}));
  const platform=process.env.OSHAL_PLATFORM_ROOT;if(!platform)throw new Error('Explicit kernel OSHAL_PLATFORM_ROOT required');app.use('/shared/ui',express.static(join(platform,'src/shared/ui')));app.use('/cockpit/css/themes',express.static(join(platform,'src/pages/cockpit/css/themes')));
  if(process.env.EDITOR_FIXTURE_DEBUG)process.stderr.write('native routes ready\n');server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));return{origin:'http://127.0.0.1:'+server.address().port,app,pool,requests,container,close};
 }catch(error){await close();throw error;}
}
