/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.25 (store gate, 2026-11-19: tests/career-letter-truth-route.test.mjs failed once with "Cannot read properties of null (reading 'needsReview')" and passed on the rerun of the same tree): GET /jobs/:id read the job's row first and the preparation receipt last, so a read the engine finished during said the preparation was complete over a row from before the documents were saved (no cover letter, no claims check, "generate your documents"). Prepare application stops waiting on exactly that answer (tools/career-job-actions.js poll) and showed step 1 again after a preparation that had worked. Real: the COMPILED board routes (POST /jobs/:id/generate, GET /jobs/:id), the engine dispatch, runner and launcher, the Python engine (prepare_job, generate_for, its application.json, its row and its receipt) and the real better-sqlite3 driver. Held: that driver stops once, after the route has read the job's row, until the engine has written its last receipt: the moment a busy machine reaches by chance. Doubled: the model (a scripted answer on the package's rail path, in its own thread), Chromium (a stand-in that writes a one-line PDF), the kernel leaves in tests/helpers/career-route-harness.mjs and the request identity. Red on store main 8b4c5002, green with the receipt read once, before the row.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createRouter,isolateRunnerEnv,loadCompiledModules,sqliteRows} from './helpers/career-route-harness.mjs';
import {requestIdentity} from './helpers/request-identity-stub.mjs';
import {startRailThread} from './helpers/career-scripted-rail-thread.mjs';

const require=createRequire(import.meta.url);
const Database=require(join(process.env.STORE_CI_TOOLCHAIN||new URL('../../scripts/toolchain',import.meta.url).pathname,'node_modules','better-sqlite3'));
const root=mkdtempSync(join(tmpdir(),'career-ready-with-documents-')),SUB='ready-documents-teal',ISSUER='https://issuer.example.test';
const POSTING=71,REQUEST='ready-with-documents-71';
const DESCRIPTION='You will build SCADA integrations, extend our Ignition HMI, read PLC data, script in Python and commission systems in the field. '.repeat(6);
const ENV_KEYS=['PORT','CHROMIUM_PATH','PLAYWRIGHT_CHROMIUM_PATH'];
const savedEnv=Object.fromEntries(ENV_KEYS.map(key=>[key,process.env[key]]));
let restoreEnv,router,modules,rail,boardFile;

const PROFILE={profile:{name:'Sample Candidate',headline:'Field Automation and SCADA Engineer',experience_summary:'Field automation engineer who commissions SCADA and PLC systems on short contracts.'},
 roles:[{id:'r1',title:'Field Automation Engineer (contract)',org:'Gulf Coast Refining',start:'2025-06',end:null,deliverables:['Commissioned PLC and SCADA upgrades across three refinery units','Wrote Python scripts that validated Modbus tag maps before cutover'],skills:['PLC','SCADA','Python']},
  {id:'r2',title:'Controls Integration Contractor',org:'Delta Grain Terminals',start:'2024-08',end:'2025-05',deliverables:['Integrated conveyor PLCs with an Ignition HMI','Trained the night shift on the new screens'],skills:['PLC','Ignition','HMI']}],
 skills:{Automation:{items:['PLC','SCADA','Ignition','Python']}}};
const COVER={greeting:'Dear Hiring Manager,',paragraphs:[
 'This role is the field work I do every week. I commissioned PLC and SCADA upgrades across three refinery units at Gulf Coast Refining and wrote Python scripts that validated Modbus tag maps before cutover.',
 'At Delta Grain Terminals I integrated conveyor PLCs with an Ignition HMI and trained the night shift on the new screens.',
 'I would bring that field discipline to your SCADA integrations. Could we talk about what your team needs first?'],closing:'Sincerely,'};
const PACKET={resume:{headline:'Field Automation and SCADA Engineer',summary:'Field automation engineer who commissions SCADA and PLC systems on short contracts.',
 competencies:['SCADA integration','PLC commissioning'],skills:['SCADA','PLC','Ignition','Python'],certifications:[],education:[],clearance:'',
 experience:[{title:'Field Automation Engineer (contract)',org:'Gulf Coast Refining',span:'2025 to Present',bullets:['Commissioned PLC and SCADA upgrades across three refinery units','Wrote Python scripts that validated Modbus tag maps before cutover']},
  {title:'Controls Integration Contractor',org:'Delta Grain Terminals',span:'2024 to 2025',bullets:['Integrated conveyor PLCs with an Ignition HMI','Trained the night shift on the new screens']}]},cover:COVER};
const ANSWERS={fit:{fit_score:84,rationale:'Strong field fit.',matched:['SCADA'],gaps:[]},cover:COVER,packet:PACKET};

/** What the one held read saw: whether the row had the cover letter, and the engine's phase before and after the hold. */
const hold={armed:false,held:0,rowHadCover:null,phaseBefore:null,phaseAfter:null};
/** Sleep this thread without letting anything else on it run: the route between two of its reads cannot yield either. */
const nap=ms=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);};
/** The engine's own receipt for the posting, read from the file it replaces whole. */
function enginePhase(){
 try{return JSON.parse(readFileSync(boardFile,'utf8')).jobs?.[POSTING]?.phase||null;}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
/** Runs once, after the route has read the job's row and before it reads anything else: keeps it there until the engine has written its last receipt. */
function untilTheEngineFinished(row){
 if(!hold.armed)return;
 hold.armed=false;hold.held+=1;hold.rowHadCover=row?.has_cover;hold.phaseBefore=enginePhase();
 for(const until=Date.now()+90000;Date.now()<until&&!['ready','failed'].includes(enginePhase());)nap(5);
 hold.phaseAfter=enginePhase();
}
/** The real driver. The one statement GET /jobs/:id reads the job's row with tells `afterRow` what it read before the route goes on. */
function drivenWithAHold(afterRow){
 return function HeldDatabase(...args){
  const db=new Database(...args),prepare=db.prepare.bind(db);
  db.prepare=sql=>{
   const statement=prepare(sql);
   if(!(sql.includes('s.ai_fit_rationale')&&sql.includes('AS has_cover')))return statement;
   const get=statement.get.bind(statement);
   statement.get=(...values)=>{const row=get(...values);afterRow(row);return row;};
   return statement;
  };
  return db;
 };
}
/** A stand-in Chromium: writes a one-line PDF where --print-to-pdf= points, as the real one would. */
function standInChromium(){
 const file=join(root,'chromium');
 writeFileSync(file,'#!/bin/sh\nfor arg in "$@"; do case "$arg" in --print-to-pdf=*) printf \'%%PDF-1.4\\n%%%%EOF\\n\' > "${arg#--print-to-pdf=}";; esac; done\n');
 chmodSync(file,0o755);return file;
}
function call(method,path,body){
 const parsed=new URL(path,'http://fixture.test'),found=router.find(method,parsed.pathname);assert.ok(found,path);
 return new Promise((resolve,reject)=>{const out={status:200};const res={status(n){out.status=n;return res;},setHeader(){},json(json){resolve({...out,json});return res;}};
  requestIdentity.runWithRequestIdentity({sub:SUB,principalIssuer:ISSUER,isOperator:false,isSystem:false},()=>Promise.resolve(found.handler({method,oidc:{user:{sub:SUB}},params:found.params,body,query:Object.fromEntries(parsed.searchParams),headers:{}},res)).catch(reject));});
}
const readJob=async()=>(await call('GET','/jobs/'+POSTING)).json.job;
/** What Prepare application stops waiting on (tools/career-job-actions.js poll): this request's receipt, completed. */
const complete=job=>job.board?.requestId===REQUEST&&!!job.board?.completedAt;
/**
 * A read answers in one piece: when it says the preparation is complete, the documents and the claims check are in the
 * same answer; when it does not, it says Career is still working, so the page keeps waiting.
 */
function answersInOnePiece(job,label){
 if(!complete(job)){assert.equal(job.application.busy,true,label+': not complete, so still working');return false;}
 assert.equal(job.board.phase,'ready',label);
 assert.ok(job.application.claims,label+': complete, with no claims check (the row was read before the documents were saved)');
 assert.equal(job.application.needsGeneration,false,label+': complete, yet asks for the documents to be generated');
 assert.equal(job.has_cover,1,label+': complete, with no cover letter');
 return true;
}

before(async()=>{
 restoreEnv=isolateRunnerEnv(join(root,'store'));
 ({modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{'better-sqlite3':drivenWithAHold(untilTheEngineFinished)}));
 router=createRouter();modules.board.registerCareerBoardRoutes(router,{pool:{async query(){return {rows:[]};}}});
 rail=await startRailThread(ANSWERS);process.env.PORT=String(rail.port);
 process.env.CHROMIUM_PATH=process.env.PLAYWRIGHT_CHROMIUM_PATH=standInChromium();
 const paths=modules.store.userPaths(SUB);mkdirSync(paths.userDir,{recursive:true});boardFile=join(paths.userDir,'job-board-state.json');
 writeFileSync(join(paths.userDir,'career_db.json'),JSON.stringify(PROFILE));
 sqliteRows(paths,SUB,[['INSERT INTO corpus.companies(id,name) VALUES(?,?)',[1,'Target Utilities']],
  ['INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,description,active,target_role) VALUES(?,?,?,?,?,?,1,1)',[POSTING,1,String(POSTING),'Senior Controls Engineer','https://example.invalid/jobs/'+POSTING,DESCRIPTION]],
  ['INSERT INTO user_signals(posting_id,status,fit_score) VALUES(?,?,?)',[POSTING,'promoted',70]]]);
});
after(async()=>{
 await rail?.close();restoreEnv?.();
 for(const [key,value] of Object.entries(savedEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
});

test('a job read the engine finishes during never says the preparation is complete without its documents',{timeout:200000},async()=>{
 const started=await call('POST','/jobs/'+POSTING+'/generate',{documents:true,requestId:REQUEST});
 assert.equal(started.status,202,JSON.stringify(started.json));
 // The engine is on its own once it has written its first receipt; from here it needs only the model's thread.
 for(const until=Date.now()+60000;!['scoring','generating'].includes(enginePhase());){assert.ok(Date.now()<until,'the engine started');await new Promise(resolve=>setTimeout(resolve,20));}
 hold.armed=true;
 const straddled=await readJob();
 assert.equal(hold.held,1,'the read of the job\'s row was found and held (the route\'s row statement changed if not)');
 assert.equal(hold.rowHadCover,0,'the row was read before the engine saved the documents');
 assert.notEqual(hold.phaseBefore,'ready','the engine was still working when the row was read');
 assert.equal(hold.phaseAfter,'ready','the engine wrote its last receipt while the read was held');
 answersInOnePiece(straddled,'the read the engine finished during');
 const next=await readJob();
 assert.equal(answersInOnePiece(next,'the next read'),true,'the next read is complete');
 assert.equal(typeof next.application.claims.status,'string','the claims check is in the complete answer');
});
