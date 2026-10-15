/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real Express/Postgres/framed engine fixture with explicitly named ALS grant and continuation seams.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Load actual mounted application after explicit clean-test toolchain bootstrap.
 */
import {AsyncLocalStorage} from 'node:async_hooks';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {connect} from 'node:net';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {requireRuntime} from './runtime.mjs';
const {createPdfRoutes}=await import('../../routes/application.mjs');
const packageRoot=resolve(import.meta.dirname,'../..');
const require=requireRuntime;
const {Pool}=require('pg'),express=require('express');
function exchange(port,request){return new Promise((done,reject)=>{const socket=connect(port,'127.0.0.1');let buffer='',hello,ended=false;const timer=setTimeout(()=>finish(new Error('fixture engine timeout')),55000);function finish(error,result){if(ended)return;ended=true;clearTimeout(timer);socket.destroy();error?reject(error):done(result);}socket.on('error',finish);socket.on('close',()=>{if(!ended)finish(new Error('fixture engine incomplete'));});socket.on('data',data=>{buffer+=data;if(buffer.length>16*1024*1024)return finish(new Error('fixture frame exceeded'));for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value;try{value=JSON.parse(line);}catch{return finish(new Error('fixture bad frame'));}if(!hello){hello=value;if(value.error)return finish(null,{hello,reply:null});socket.write(JSON.stringify({id:1,...request})+'\n');}else return finish(null,{hello,reply:value});}});});}
export async function fixture(){
 const python=process.env.OSHAL_PDF_TEST_PYTHON;if(!python)throw new Error('OSHAL_PDF_TEST_PYTHON required; install engine/requirements.txt in isolated runtime');
 const raw=process.env.OSHAL_TEST_POSTGRES;if(!raw)throw new Error('OSHAL_TEST_POSTGRES required; use shared disposable127.0.0.1:35689');const url=new URL(raw);if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='35689')throw new Error('Only shared disposable PG127.0.0.1:35689');
 const suffix=randomUUID().replaceAll('-',''),database='pdf_http_'+suffix,role='pdf_http_role_'+suffix,password=randomUUID();
 const admin=new Pool({connectionString:url.href}),directory=await mkdtemp(join(tmpdir(),'pdf-http-fixture-')),als=new AsyncLocalStorage(),states=new Map([['alice',new Set()],['bob',new Set()]]);let db,pool,child,server;
 const close=async()=>{if(server)await new Promise(r=>server.close(r));if(child){child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}await pool?.end();await db?.end();await admin.query(`DROP DATABASE IF EXISTS ${database}`).catch(()=>{});await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});await admin.end();await rm(directory,{recursive:true,force:true});};
 try{
  await admin.query('CREATE DATABASE '+database);await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);const dbUrl=new URL(url);dbUrl.pathname='/'+database;db=new Pool({connectionString:dbUrl.href});await db.query(await readFile(join(packageRoot,'migrations/001-pdf-workbench.sql'),'utf8'));await db.query(`GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);dbUrl.username=role;dbUrl.password=password;pool=new Pool({connectionString:dbUrl.href});
  child=spawn(python,[join(packageRoot,'engine/server.py')],{env:{...process.env,PDF_ENGINE_HOST:'127.0.0.1',PDF_ENGINE_PORT:'0'},stdio:['ignore','pipe','pipe']});const lines=createInterface({input:child.stdout});const ready=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('fixture engine startup timeout')),10000);lines.once('line',line=>{clearTimeout(timer);done(JSON.parse(line));});child.once('error',reject);child.once('exit',()=>reject(new Error('fixture engine exited')));});lines.close();
  const build=spawn(python,[join(packageRoot,'tests/fixtures/build-fixtures.py'),directory],{stdio:['ignore','ignore','pipe']});await new Promise((done,reject)=>{build.once('error',reject);build.once('exit',code=>code===0?done():reject(new Error('fixture PDF build failed')));});
  const ctx={appPackageDir:packageRoot,pool,authorization:{registerResource:()=>{},currentActor:()=>({issuer:'pdf-http-fixture',sub:als.getStore()??'none',isActive:states.has(als.getStore())}),authorize:async({permission})=>({allowed:states.has(als.getStore())&&!states.get(als.getStore()).has(permission)})},intent:async(name,input)=>{if(name!=='engine.exchange')throw new Error('Fixture does not fake native artifact handles');return exchange(ready.port,input.request);}};
  const captured=new Set(),runs={keepRunAlive:async id=>captured.add(id),run:async(id,work)=>{if(!captured.has(id))throw new Error('fixture run not captured');return work();},runFinished:async id=>captured.delete(id)};
  const app=express();app.use((req,_res,next)=>als.run(req.headers['x-test-owner']??'alice',next));app.use('/api/pdf-workbench',createPdfRoutes(ctx,runs));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  return{url:'http://127.0.0.1:'+server.address().port,directory,states,close,db,ctx};
 }catch(error){await close();throw error;}
}
