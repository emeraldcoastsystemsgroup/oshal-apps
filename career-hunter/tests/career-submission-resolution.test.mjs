/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove original-owner press-picture reads reject absent and changed evidence.: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise unknown-outcome closure against the owner route, real queue files and disposable application records. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),Module=require('node:module');
const deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN||fileURLToPath(new URL('../../scripts/toolchain',import.meta.url)),'package.json'));
const express=deps('express'),queue=require('../lib/career-submission-queue');
const {DatabaseSync}=require('node:sqlite');
let server,origin,dirs,records,dbs;
const packet={approved:true,postingId:81,url:'https://employer.example.com/jobs/81',resumeSha256:'a'.repeat(64),coverSha256:'b'.repeat(64),profileSha256:'c'.repeat(64)};
before(async()=>{
  dbs=Object.fromEntries(['a','b'].map(sub=>{const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE user_signals(posting_id INTEGER PRIMARY KEY,status TEXT,applied_at TEXT,application_source TEXT);INSERT INTO user_signals(posting_id,status)VALUES(81,'generated');");return [sub,db];}));
  dirs={a:mkdtempSync(join(tmpdir(),'career-resolution-a-')),b:mkdtempSync(join(tmpdir(),'career-resolution-b-'))};records=[];
  const load=Module._load;
  Module._load=function(name,...args){
    if(name==='express')return express;
    if(name==='../routes/career-user-store')return {callerSub:req=>req.headers['x-owner']||null,userPaths:sub=>({userDir:dirs[sub]}),openUserDb:sub=>({
      prepare:sql=>({get:(...values)=>dbs[sub].prepare(sql).get(...values),run:(...values)=>{records.push({sub,sql,values});return dbs[sub].prepare(sql).run(...values);}}),close(){}})};
    if(name==='../routes/career-autofill-routes')return {};
    if(name==='../routes/career-resume-preview')return {resolveContainedRegularFile:(name,dir)=>name.startsWith(dir+'/')?name:null};
    if(name==='../routes/career-authorization')return {registerCareerAuthorization(){}};
    return load.call(this,name,...args);
  };
  let routes;try{routes=require('../lib/career-submission-routes');}finally{Module._load=load;}
  const app=express();app.use(express.json());app.use(routes.createCareerSubmissionRoutes({}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin='http://127.0.0.1:'+server.address().port;
});
after(async()=>{Object.values(dbs).forEach(db=>db.close());await new Promise(r=>server.close(r));Object.values(dirs).forEach(dir=>rmSync(dir,{recursive:true,force:true}));});
async function post(id,body,sub='a') {const res=await fetch(origin+'/submission-queue/'+id+'/resolve',{method:'POST',headers:{'content-type':'application/json',...(sub?{'x-owner':sub}:{})},body:JSON.stringify(body)});return {status:res.status,body:await res.text()};}
function unknown(){const item=queue.enqueue(dirs.a,packet).item;queue.nativeUpdate(dirs.a,item.id,{status:'unknown',reason:'Check with the employer.'});return item;}
test('unknown can close as not sent only by its owner; another attempt needs a fresh approval',async()=>{
  const item=unknown();assert.equal((await post(item.id,{outcome:'not_sent'},'b')).status,404);
  assert.equal((await post(item.id,{outcome:'not_sent'},null)).status,401);
  assert.equal((await post(item.id,{outcome:'not_sent',approved:true})).status,400);
  assert.equal(queue.enqueue(dirs.a,packet).item.id,item.id,'unknown stays deduplicated');
  const result=await post(item.id,{outcome:'not_sent'});assert.equal(result.status,200,result.body);
  const saved=queue.read(dirs.a).items[item.id];assert.equal(saved.status,'resolved_not_sent');
  assert.equal(saved.events.at(-1).statement,'it was not sent');assert.equal(records.length,0);
  assert.throws(()=>queue.enqueue(dirs.a,{...packet,approved:false}),{code:'submission_approval_required'});
  const next=queue.enqueue(dirs.a,packet).item;assert.notEqual(next.id,item.id);
  assert.equal(next.status,'queued');queue.cancel(dirs.a,next.id);
});
test('unknown closed as sent records the owners word once and blocks every new approval',async()=>{
  const item=unknown(),result=await post(item.id,{outcome:'sent'});assert.equal(result.status,200,result.body);
  const saved=queue.read(dirs.a).items[item.id];assert.equal(saved.status,'resolved_sent');
  assert.equal(saved.events.at(-1).statement,'it was sent');assert.equal(records.length,1);assert.equal(records[0].sub,'a');
  assert.match(records[0].sql,/manual-mark/);assert.equal(dbs.a.prepare('SELECT application_source FROM user_signals WHERE posting_id=81').get().application_source,'manual-mark');
  assert.equal((await post(item.id,{outcome:'sent'})).status,200);assert.equal(records.length,1);
  assert.equal((await post(item.id,{outcome:'not_sent'})).status,409);
  assert.equal(queue.enqueue(dirs.a,packet).item.id,item.id);
  assert.throws(()=>queue.nativeUpdate(dirs.a,item.id,{status:'queued'}),/settled outcome/);
  assert.ok(readFileSync(join(dirs.a,'submission-queue.json'),'utf8').includes('it was sent'));
});

test('only unknown can close, and a failed application projection leaves its outcome held',async()=>{
  const item=queue.enqueue(dirs.a,{...packet,postingId:82}).item;
  assert.equal((await post(item.id,{outcome:'not_sent'})).status,409);assert.equal(queue.read(dirs.a).items[item.id].status,'queued');
  queue.nativeUpdate(dirs.a,item.id,{status:'unknown'});
  assert.equal((await post(item.id,{outcome:'sent'})).status,503,'missing original job cannot be recorded');
  assert.equal(queue.read(dirs.a).items[item.id].status,'unknown');
  assert.equal((await post(item.id,{outcome:'maybe'})).status,400);
});
test('retained outcome pictures are owner scoped and digest checked on every read',async()=>{
  const item=queue.enqueue(dirs.a,{...packet,postingId:83}).item,png=Buffer.from('89504e470d0a1a0a000000000000000000','hex');
  const name='submission-'+item.id+'-outcome.png';writeFileSync(join(dirs.a,name),png);
  queue.nativeUpdate(dirs.a,item.id,{status:'unknown',outcomeFile:name,outcomeSha256:queue.digest(png)});
  const get=sub=>fetch(origin+'/submission-queue/'+item.id+'/outcome-picture',{headers:{'x-owner':sub}});
  assert.equal((await get('b')).status,404);
  const response=await get('a');assert.equal(response.status,200);assert.equal(queue.digest(Buffer.from(await response.arrayBuffer())),queue.digest(png));
  writeFileSync(join(dirs.a,name),'changed fixture picture');assert.equal((await get('a')).status,409);
});

test('press pictures require the original owner and exact digest on every HTTP read',async()=>{
  const item=queue.enqueue(dirs.a,{...packet,postingId:84}).item,png=Buffer.from('89504e470d0a1a0a000000000000000000','hex');
  const state=queue.read(dirs.a),name='submission-'+item.id+'-press-1.png';writeFileSync(join(dirs.a,name),png);
  state.items[item.id].presses=[{step:1,afterSha256:queue.digest(png)}];state.items[item.id].pressPictures=[{step:1,file:name,sha256:queue.digest(png)}];
  writeFileSync(join(dirs.a,'submission-queue.json'),JSON.stringify(state));
  const get=(sub,step=1)=>fetch(origin+'/submission-queue/'+item.id+'/press-picture/'+step,{headers:sub?{'x-owner':sub}:{}});
  assert.equal((await get('b')).status,404);assert.equal((await get(null)).status,401);assert.equal((await get('a',2)).status,404);
  const response=await get('a');assert.equal(response.status,200);assert.equal(queue.digest(Buffer.from(await response.arrayBuffer())),queue.digest(png));
  writeFileSync(join(dirs.a,name),'tampered');assert.equal((await get('a')).status,409);
});
