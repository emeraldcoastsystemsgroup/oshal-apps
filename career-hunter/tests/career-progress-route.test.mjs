/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the shipped owner-bound progress and optional goal handlers over disposable SQLite, mixed timestamp forms and bounded no-follow preference files.
 */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createRouter,loadCompiledModules} from './helpers/career-route-harness.mjs';
const NOW=Date.parse('2026-11-12T20:00:00.000Z'),DAY=86400000,RealDate=globalThis.Date;
globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}};
class Adapter{
 constructor(file,options={}){this.db=new DatabaseSync(file,{readOnly:Boolean(options.readonly)});}
 exec(sql){this.db.exec(sql);return this;}
 prepare(sql){const s=this.db.prepare(sql);s.setAllowBareNamedParameters(true);return {get:(...a)=>s.get(...a),all:(...a)=>s.all(...a),run:(...a)=>s.run(...a)};}
 pragma(sql,options={}){const rows=this.prepare('PRAGMA '+sql).all();return options.simple?Object.values(rows[0]||{})[0]:rows;}
 close(){this.db.close();}
}
const root=process.env.CAREER_PROGRESS_FIFO_PROBE==='1'?process.env.CAREER_PROGRESS_FIXTURE_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'career-progress-route-')),previous=process.env.JOBHUNTER_STORE_ROOT;
if(process.env.CAREER_PROGRESS_FIFO_PROBE==='1')assert.ok(root?.startsWith(path.join(os.tmpdir(),'career-progress-fifo-')),'isolated FIFO probe directory');
process.env.JOBHUNTER_STORE_ROOT=root;
const native=process.env.CAREER_NATIVE_SQLITE_BRIDGE?createRequire(import.meta.url)(process.env.CAREER_NATIVE_SQLITE_BRIDGE).BetterSqlite3:Adapter;
const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{'better-sqlite3':native});
const router=createRouter();modules.board.registerCareerBoardRoutes(router,{pool:{query(){throw Error('No provider, ledger or shared pool call is allowed.');}}});
after(()=>{globalThis.Date=RealDate;if(previous===undefined)delete process.env.JOBHUNTER_STORE_ROOT;else process.env.JOBHUNTER_STORE_ROOT=previous;fs.rmSync(root,{recursive:true,force:true});});
function seed(sub,rows){const layout=modules.store.userPaths(sub),db=new DatabaseSync(layout.userDb);db.exec('CREATE TABLE user_signals(posting_id INTEGER PRIMARY KEY,status TEXT,applied_at TEXT)');const put=db.prepare('INSERT INTO user_signals VALUES(?,?,?)');rows.forEach((r,i)=>put.run(i+1,r.status||'applied',r.at));db.close();return layout;}
const rows=Array.from({length:60},(_,i)=>({status:['applied','interview','offer','rejected'][i%4],at:new Date(NOW-DAY).toISOString()}));
rows.push({at:new Date(NOW-7*DAY).toISOString()},{at:'2026-11-12 20:00:00'},{at:'2026-11-10T22:00:00+02:00'},{at:'2026-11-10 20:00:00'},
 {at:new Date(NOW-7*DAY-1000).toISOString()},{at:new Date(NOW+1000).toISOString()},{at:'not a date'},{at:null});
const owner=seed('progress-owner',rows),other=seed('progress-other',[{at:new Date(NOW-DAY).toISOString()}]),goalFile=path.join(owner.userDir,'application-goal.json');
async function call(method,pathname,sub='progress-owner',body={},query={}){
 const found=router.find(method,pathname);assert.ok(found,method+' '+pathname+' must be an actual shipped handler');
 return new Promise((resolve,reject)=>{const answer={code:200,body:null},res={status(code){answer.code=code;return res;},setHeader(){},json(value){answer.body=value;resolve(answer);return res;}};
  Promise.resolve(found.handler({oidc:{user:sub?{sub}:null},params:found.params,query,body,headers:{}},res)).catch(reject);});
}
if(process.env.CAREER_PROGRESS_FIFO_PROBE==='1'){
 assert.equal(spawnSync('mkfifo',[goalFile]).status,0);const reply=await call('GET','/jobs/progress');
 console.log('FIFO_RECEIPT='+JSON.stringify({code:reply.code}));process.exit(0);
}
test('progress counts every original-owner application across stages without a corpus or 50-row limit',async()=>{
 const a=await call('GET','/jobs/progress');assert.equal(a.code,200);assert.equal(a.body.period,'past7days');assert.equal(a.body.applied,64);assert.equal(a.body.goal,null);
 assert.equal(a.body.asOf,new Date(NOW).toISOString());assert.equal(a.body.since,new Date(NOW-7*DAY).toISOString());
 assert.equal((await call('GET','/jobs/progress','progress-other')).body.applied,1);
 assert.equal((await call('GET','/jobs/progress','progress-owner',{}, {sub:'progress-other',userDir:other.userDir})).body.applied,64);
});
test('unsigned progress and goal access never creates a caller directory',async()=>{
 const before=fs.readdirSync(root,{recursive:true}).sort();assert.equal((await call('GET','/jobs/progress',null)).code,401);assert.equal((await call('POST','/jobs/goal',null,{goal:3})).code,401);
 assert.deepEqual(fs.readdirSync(root,{recursive:true}).sort(),before);
});
test('an absent store reads as no recorded applications and no goal without creating files',async()=>{
 const before=fs.readdirSync(root,{recursive:true}).sort(),a=await call('GET','/jobs/progress','progress-absent');assert.equal(a.code,200);assert.equal(a.body.applied,0);assert.equal(a.body.goal,null);
 assert.deepEqual(fs.readdirSync(root,{recursive:true}).sort(),before);
});
test('owner-only reads reject writes and have no corpus attachment',()=>{
 const db=modules.store.openUserDb('progress-owner',true,{corpus:false});assert.ok(db);
 try{assert.deepEqual(db.pragma('database_list').map(row=>row.name).filter(name=>name!=='temp'),['main'],'the old-schema compatibility view may use temp, but no corpus is attached');assert.throws(()=>db.prepare("INSERT INTO user_signals VALUES(100,'applied',NULL)").run());}finally{db.close();}
});
test('unsafe owner-only writable opens fail before resolving or creating a directory',()=>{
 const before=fs.readdirSync(root,{recursive:true}).sort();assert.throws(()=>modules.store.openUserDb('progress-never-created',false,{corpus:false}),/read.only/i);assert.deepEqual(fs.readdirSync(root,{recursive:true}).sort(),before);
});
test('default existing callers still require and attach the shared corpus',()=>{
 assert.equal(modules.store.openUserDb('progress-owner'),null,'default still requires the shared corpus');
 const corpus=new DatabaseSync(owner.corpusDb);corpus.exec('CREATE TABLE fixture(id INTEGER)');corpus.close();
 const attached=modules.store.openUserDb('progress-owner');try{assert.ok(attached.pragma('database_list').some(row=>row.name==='corpus'));}finally{attached.close();fs.unlinkSync(owner.corpusDb);}
});
test('goal is explicit, editable and disableable in the original owner file only',async()=>{
 for(const value of [4,2,null]){const a=await call('POST','/jobs/goal','progress-owner',{goal:value});assert.equal(a.code,200);assert.equal(a.body.goal,value);assert.equal((await call('GET','/jobs/progress')).body.goal,value);}
 assert.equal((await call('GET','/jobs/progress','progress-other')).body.goal,null);
 assert.deepEqual(JSON.parse(fs.readFileSync(goalFile,'utf8')),{version:1,goal:null});assert.equal(fs.statSync(goalFile).mode&0o777,0o600);
 assert.equal(fs.readdirSync(owner.userDir).filter(name=>name.endsWith('.tmp')).length,0);
});
test('invalid, unbounded and owner-overriding goal bodies cannot change the saved goal',async()=>{
 await call('POST','/jobs/goal','progress-owner',{goal:4});const before=fs.readFileSync(goalFile,'utf8');
 for(const body of [{},{goal:0},{goal:101},{goal:1.5},{goal:'3'},{goal:true},{goal:NaN},[],{goal:3,userSub:'progress-other'},{goal:3,userDir:other.userDir}])assert.equal((await call('POST','/jobs/goal','progress-owner',body)).code,400,JSON.stringify(body));
 assert.equal(fs.readFileSync(goalFile,'utf8'),before);
});
test('unreadable, oversized and symlink goals stay unavailable; writes never follow their target',async()=>{
 const target=path.join(root,'external-goal.json');fs.writeFileSync(target,'private fixture');
 for(const value of ['{}','x'.repeat(2048)]){fs.writeFileSync(goalFile,value);assert.equal((await call('GET','/jobs/progress')).code,503);}
 fs.unlinkSync(goalFile);fs.symlinkSync(target,goalFile);
 try{assert.equal((await call('GET','/jobs/progress')).code,503);assert.equal((await call('POST','/jobs/goal','progress-owner',{goal:3})).code,503);assert.equal(fs.readFileSync(target,'utf8'),'private fixture');}
 finally{fs.unlinkSync(goalFile);fs.unlinkSync(target);}
});
test('a non-regular FIFO goal is refused without blocking the real handler',{skip:process.platform==='win32'?'FIFOs are a POSIX filesystem feature':false},()=>{
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'career-progress-fifo-'));
 try{
  const probe=spawnSync(process.execPath,[new URL(import.meta.url).pathname],{encoding:'utf8',timeout:3000,env:{...process.env,CAREER_PROGRESS_FIFO_PROBE:'1',CAREER_PROGRESS_FIXTURE_DIR:fixture}});
  assert.equal(probe.status,0,probe.error?.message||probe.stderr);const line=probe.stdout.split('\n').find(value=>value.startsWith('FIFO_RECEIPT='));assert.ok(line,probe.stdout);assert.equal(JSON.parse(line.slice('FIFO_RECEIPT='.length)).code,503);
 }finally{fs.rmSync(fixture,{recursive:true,force:true});}
});
