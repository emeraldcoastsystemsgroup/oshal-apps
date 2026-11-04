/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove real preparation retains fetched details with an immutable corpus, then verify the actual Node reader uses the same bound context and refuses changed, foreign or unsafe data.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import {resolve} from 'node:path';
import {loadCompiledModules} from './helpers/career-route-harness.mjs';
const {modules}=loadCompiledModules({context:'lib/career-job-context.js'});
test('selected employer detail reaches scoring, generation and the original-owner Node reader without shared writes',async(t)=>{
 const out=execFileSync(process.env.JOBHUNTER_PYTHON||'python3',[fileURLToPath(new URL('./career-job-context-contract.py',import.meta.url))],{encoding:'utf8',timeout:30000});
 const proof=JSON.parse(out.trim().split('\n').at(-1));assert.equal(proof.checks,12);
 assert.equal(proof.cacheChecks,10);
 const dir=mkdtempSync(join(tmpdir(),'career-context-view-')),foreign=mkdtempSync(join(tmpdir(),'career-context-view-'));
 try{
  mkdirSync(join(dir,'job-context'));const file=join(dir,'job-context/1.json');writeFileSync(file,JSON.stringify(proof.context));
  const read=row=>modules.context.applyJobContext(dir,row);assert.equal(read(proof.original).description,proof.context.description);
  for(const patch of [{url:'https://different.example.test/job'},{title:'Different role'},{description:'Updated public listing'}]){const row={...proof.original,...patch};assert.equal(read(row),row);}
  assert.equal(modules.context.applyJobContext(foreign,proof.original),proof.original);
  writeFileSync(file,JSON.stringify({...proof.context,description:'Unverified changed text'}));assert.throws(()=>read(proof.original),/job_context_unavailable/);
  rmSync(file);symlinkSync(join(foreign,'private.json'),file);writeFileSync(join(foreign,'private.json'),JSON.stringify(proof.context));assert.throws(()=>read(proof.original),/job_context_unavailable/);
  rmSync(file);
  for(const fixture of proof.cacheCases)await t.test('Python/Node agree: '+fixture.name,()=>{
   writeFileSync(file,JSON.stringify(fixture.context));
   const result=read(fixture.row);
   if(fixture.applied){assert.equal(result.description,fixture.context.description);assert.equal(result.description_context.truncated,false);assert.equal(result.description_context.sourceChars,Array.from(fixture.context.description).length);assert.equal(result.description_context.sourceBytes,Buffer.byteLength(fixture.context.description));}
   else assert.equal(result,fixture.row);
  });
  for(const patch of [{sourceChars:1},{sourceBytes:1},{truncated:true},{basis:'unverified'},{snapshot:[]},
   {description:'\ud800',descriptionSha256:'invalid'}])await t.test('invalid source metadata refuses '+Object.keys(patch).join(','),()=>{
    writeFileSync(file,JSON.stringify({...proof.context,...patch}));assert.throws(()=>read(proof.original),/job_context_unavailable/);
  });
  await t.test('actual SQLite interview reader retains fresh full-bound employer evidence',async()=>{
   const deps=createRequire(process.env.STORE_CI_TOOLCHAIN?resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'):new URL('../../scripts/toolchain/package.json',import.meta.url));
   const Database=deps('better-sqlite3'),dbFile=join(dir,'interview-corpus.db'),db=new Database(dbFile);
   db.exec('CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT)');db.prepare('INSERT INTO companies VALUES(?,?)').run(1,'Fixture Employer');
   const keys=Object.keys(proof.original);db.exec('CREATE TABLE postings_corpus('+keys.map(key=>'"'+key+'" '+(typeof proof.original[key]==='number'?'REAL':'TEXT')).join(',')+')');
   db.prepare('INSERT INTO postings_corpus VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>proof.original[key]));db.close();
   writeFileSync(file,JSON.stringify(proof.context));const profile=JSON.stringify({profile:{name:'Fixture'}});writeFileSync(join(dir,'career_db.json'),profile);
   const hash=value=>createHash('sha256').update(value).digest('hex');
   const posting={company:'Fixture Employer',description:proof.context.description,title:proof.original.title,url:proof.original.url};
   mkdirSync(join(dir,'interviews'));writeFileSync(join(dir,'interviews/1.json'),JSON.stringify({version:1,postingId:1,source:{profile:hash(profile),posting:hash(JSON.stringify(posting))}}));
   const handlers=new Map(),router={get:(name,fn)=>handlers.set(name,fn),post:()=>{}};
   const {modules:interview}=loadCompiledModules({routes:'lib/career-interview-routes.js'},{
    express:{Router:()=>router},'../routes/career-user-store':{callerSub:()=> 'fixture-owner',userPaths:()=>({userDir:dir}),openUserDb:()=>{const handle=new Database(':memory:');handle.prepare('ATTACH DATABASE ? AS corpus').run(dbFile);return handle;}},
    '../routes/career-authorization':{registerCareerAuthorization:()=>{}},'../routes/career-surface-routes':{createCareerToolFileHandler:()=>()=>{}},
    '../routes/career-engine-dispatch':{runCareerCliAsync:()=>{throw Error('no engine request');}},'../routes/career-engine-response':{},'../routes/career-engine-runner':{nativeRunInProgress:async()=>false},
   });
   interview.routes.createCareerInterviewRoutes({});let body,status=200;
   const res={setHeader(){},status(value){status=value;return this;},json(value){body=value;return this;}};
   await handlers.get('/interview/:postingId')({params:{postingId:'1'}},res);
   assert.equal(status,200);assert.equal(body.stale,false);assert.deepEqual(body.job,{postingId:1,title:proof.original.title,company:'Fixture Employer'});
  });
 }finally{rmSync(dir,{recursive:true,force:true});rmSync(foreign,{recursive:true,force:true});}
});
