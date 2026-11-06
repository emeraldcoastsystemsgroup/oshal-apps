/** Actual typed source and compiled Vids routes over forced-RLS PostgreSQL; synthetic original person, no registered worker. */
import{AsyncLocalStorage}from'node:async_hooks';import Module,{createRequire}from'node:module';import{readFile}from'node:fs/promises';import{resolve}from'node:path';import{fileURLToPath}from'node:url';
import{fixture,dependencies}from'./fixtures/editor-source-postgres.fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function startVidsSourceFixture(){
 const deps=dependencies(),express=deps('express'),cleanups=[],scope=new AsyncLocalStorage();let server,closed=false;
 const control={allowed:true,actor:{issuer:'https://vids-source.invalid',sub:'brief-person',principalId:'brief-principal',tenantIds:['brief-tenant'],isActive:true}},actor=()=>scope.getStore()??control.actor;
 const close=async()=>{if(closed)return;closed=true;server?.closeAllConnections();if(server)await new Promise(done=>server.close(done));for(const fn of cleanups.reverse())await fn();};
 try{const{pool,admin}=await fixture({after:fn=>cleanups.push(fn)},'vids_source');for(const file of ['native/001-vids.sql','100-vids-owner-rls.sql','101-vids-artifact-publication.sql'])await pool.query(await readFile(resolve(root,'migrations',file),'utf8'));
  const connect=async()=>{const client=await pool.connect();await client.query("SELECT set_config('oshal.current_sub',$1,false)",[actor().sub]);await client.query("SELECT set_config('oshal.is_operator','off',false)");return client;},requestPool={connect,query:async(...args)=>{const client=await connect();try{const result=await client.query(...args);await control.onQuery?.(String(args[0]));return result;}finally{client.release();}}};
  const ctx={pool:requestPool,appPackageDir:root,authorization:{currentActor:actor,registerResource(){},authorize:async({permission})=>({allowed:control.allowed&&['app.open','source.read','source.create','source.change','source.delete'].includes(permission)})},intent:async name=>{if(name!=='auth.application')throw Error('Unavailable fixture intent.');const current=actor();return{app:'vids',roles:control.allowed?['source-editor']:[],principal:{id:current.principalId,issuer:current.issuer,subject:current.sub,tenant:current.tenantIds[0],state:current.isActive?'active':'inactive'}};}};
  const old=Module._load,noop=()=>{},ports={express,multer:deps('multer'),
   '@/shared/logger':{createChildLogger:()=>({info:noop,warn:noop,error:noop,debug:noop})},
   '@/app/routes/remote-client-routes':{remoteClientRegistry:{listClients:()=>[],enqueueTask:()=>{throw Error('No Vids worker is registered in this fixture.');}}},
   '@/shared/middleware/authz':{getCaller:req=>({sub:req.oidc?.user?.sub,isOperator:false}),getTrustedServiceUserSub:()=>null},
   '@/shared/middleware/trusted-service-user-identity':{requireTrustedServiceUserIdentity:(_q,_r,next)=>next()},
   '@/shared/middleware/multipart-identity':{preserveRequestIdentity:fn=>fn},
   '@/shared/services/database/request-identity':{runWithRequestIdentity:(identity,fn)=>scope.run({...actor(),sub:identity.sub},fn)}
  };let legacy;Module._load=function(request,parent,...rest){if(ports[request])return ports[request];return old.call(this,request,parent,...rest);};try{legacy=createRequire(import.meta.url)('../routes/vids-routes.js');}finally{Module._load=old;}
  const{createSourceProjectRoutes}=await import('../routes/source-projects.mjs');const app=express();app.use((req,_res,next)=>scope.run(control.actor,()=>{req.oidc={user:{sub:actor().sub}};next();}));app.use('/api/vids',createSourceProjectRoutes(ctx));app.use(express.json({limit:'320kb'}));app.use('/api/vids',legacy.createVidsRoutes(ctx));
  const platform=process.env.OSHAL_PLATFORM_ROOT;if(!platform)throw Error('Explicit kernel shared UI root required.');app.use('/shared/ui',express.static(resolve(platform,'src/shared/ui')));app.use('/cockpit',express.static(resolve(platform,'src/pages/cockpit')));
  server=app.listen(0,'127.0.0.1');await new Promise((done,reject)=>{server.once('listening',done);server.once('error',reject);});return{origin:'http://127.0.0.1:'+server.address().port,app,ctx,pool:requestPool,admin,control,close};
 }catch(error){await close();throw error;}
}
