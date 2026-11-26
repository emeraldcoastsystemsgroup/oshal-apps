/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-CONCURRENT (Roger, 2026-11-25: "when im batch running resumes and trying to look for jobs i cant post them .. hit save... ect.."): a made-up person's Career over loopback HTTP, the COMPILED board routes (POST /jobs/:id/status, POST /jobs/:id/generate, GET /jobs/:id) and the real Python engine, whose model calls go to a scripted writer the test holds, so a résumé is being written for as long as the test says. holds(sub) is the native kernel's rule for that time (crates/host-process/src/host/career.rs career_busy): while a background run of the person's holds their Career files, every other change of theirs is answered 409 career_run_in_progress before Career runs it. The run is the person's from the 202 of its POST /jobs/:id/generate until the engine wrote its receipt (completedAt) for that request; the receipt is the engine's last write before it exits.
 */
import http from 'node:http';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createRouter,isolateRunnerEnv,loadCompiledModules,sqliteRows,startServer} from './career-route-harness.mjs';
import {requestIdentity} from './request-identity-stub.mjs';

const require=createRequire(import.meta.url);
const DESCRIPTION='Run the regional office, keep the books and schedule for a team of twenty, and order supplies. '.repeat(20);
const PROFILE={profile:{name:'Sample Candidate',experience_summary:'Runs offices at Bluewater Corp.'},
 roles:[{id:'r1',title:'Office Manager',org:'Bluewater Corp',start:'2018-03',end:null,deliverables:['Ran the office of 40']}],skills:{Office:{items:['Scheduling']}}};
const WRITTEN={resume:{headline:'Office leader',summary:'Runs offices.',competencies:['Scheduling'],skills:['Scheduling'],certifications:[],education:[],clearance:'',
 experience:[{title:'Office Manager',org:'Bluewater Corp',span:'2018 to Present',bullets:['Ran the office']}]},
 cover:{greeting:'Dear Hiring Manager,',paragraphs:['Draft.'],closing:'Sincerely,'}};
/** The made-up jobs: the one being written (401), then the one the person saves (402), notes (403) and removes (404) meanwhile. */
export const JOBS=[[401,'Example Freight Co','Office Manager'],[402,'Sample Logistics','Office Manager'],[403,'Invented Clinic','Office Administrator'],[404,'Example Dental','Office Manager']];

function scripted(document){
 if(String(document.system||'').startsWith('You are a recruiter'))return {fit_score:84,rationale:'Strong office fit.',matched:['Scheduling'],gaps:[]};
 if(String(document.prompt||'').includes('DRAFT COVER'))return {greeting:'Dear Hiring Manager,',paragraphs:['Polished.'],closing:'Sincerely,'};
 return WRITTEN;
}
/** The scripted writer: while held, each model call waits until the test lets it go, as a long model reply does. */
function startRail(){
 const rail={calls:0,held:false,waiting:[]};
 rail.hold=()=>{rail.held=true;};
 rail.release=()=>{rail.held=false;for(const go of rail.waiting.splice(0))go();};
 return new Promise(resolve=>{rail.server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',async()=>{
  const ok=req.method==='POST'&&req.url==='/api/career-hunter/engine/complete';let answer={ok:false,error:'not-found'};
  if(ok){rail.calls+=1;if(rail.held)await new Promise(go=>rail.waiting.push(go));
   try{answer={ok:true,text:JSON.stringify(scripted(JSON.parse(body))),model:'scripted',provider:'scripted'};}catch{answer={ok:false,error:'invalid-json'};}}
  res.writeHead(ok?200:404,{'content-type':'application/json'});res.end(JSON.stringify(answer));});});
  rail.server.listen(0,'127.0.0.1',()=>resolve(rail));});
}
/**
 * @description Start the routes over loopback with a fresh disposable store. @returns {Promise<object>} origin, person, rail,
 * generate (start a résumé as a page would, through the routes), holds (the kernel's rule), board (the person's saved job
 * state), rows (their per-job rows) and stop.
 */
export async function concurrentHarness(){
 const root=mkdtempSync(join(tmpdir(),'career-concurrent-')),saved={PORT:process.env.PORT,CHROMIUM_PATH:process.env.CHROMIUM_PATH,PLAYWRIGHT_CHROMIUM_PATH:process.env.PLAYWRIGHT_CHROMIUM_PATH};
 const restoreEnv=isolateRunnerEnv(join(root,'store'));
 const Database=require(join(process.env.STORE_CI_TOOLCHAIN||new URL('../../../scripts/toolchain',import.meta.url).pathname,'node_modules','better-sqlite3'));
 const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{'better-sqlite3':Database});
 const router=createRouter();modules.board.registerCareerBoardRoutes(router,{pool:{async query(){return {rows:[]};}}});
 const rail=await startRail();process.env.PORT=String(rail.server.address().port);
 const chromium=join(root,'chromium');
 writeFileSync(chromium,'#!/bin/sh\nfor arg in "$@"; do case "$arg" in --print-to-pdf=*) printf \'%%PDF-1.4\\n%%%%EOF\\n\' > "${arg#--print-to-pdf=}";; esac; done\n');chmodSync(chromium,0o755);
 process.env.CHROMIUM_PATH=process.env.PLAYWRIGHT_CHROMIUM_PATH=chromium;
 const identified={find:(method,pathname)=>{const found=router.find(method,pathname);return found&&{...found,handler:(req,res)=>requestIdentity.runWithRequestIdentity(
  {sub:req.oidc?.user?.sub,principalIssuer:'https://issuer.example.test',isOperator:false,isSystem:false},()=>found.handler(req,res))};}};
 const {server,baseUrl}=await startServer(identified,headers=>headers['x-test-person']);
 let corpus=false;const runs=new Map();
 const dirOf=sub=>modules.store.userPaths(sub).userDir;
 /** A made-up person: a résumé, the four jobs in the shared corpus, and 401 on their list ready to be written. */
 function person(sub){
  const paths=modules.store.userPaths(sub);mkdirSync(paths.userDir,{recursive:true});writeFileSync(join(paths.userDir,'career_db.json'),JSON.stringify(PROFILE));
  const statements=corpus?[]:[['INSERT INTO corpus.companies(id,name) VALUES(?,?)',[1,'Target Co']]];
  for(const [id,,title] of JOBS)if(!corpus)statements.push(['INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,description,active,target_role) VALUES(?,?,?,?,?,?,1,1)',[id,1,String(id),title,'https://example.invalid/jobs/'+id,DESCRIPTION]]);
  for(const [id,status] of [[401,'promoted'],[403,'promoted'],[404,'new']])statements.push(['INSERT INTO user_signals(posting_id,status) VALUES(?,?)',[id,status]]);
  sqliteRows(paths,sub,statements);corpus=true;
  return {dir:paths.userDir};
 }
 /** One request to the routes as the person. */
 async function call(sub,method,path,body){
  const response=await fetch(baseUrl+path,{method,headers:{'content-type':'application/json','x-test-person':sub},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,type:response.headers.get('content-type')||'application/json',bytes:Buffer.from(await response.arrayBuffer())};
 }
 /** The person's saved job state, as the engine and the status route keep it. */
 function board(sub){try{return JSON.parse(readFileSync(join(dirOf(sub),'job-board-state.json'),'utf8')).jobs||{};}catch{return {};}}
 /** Whether a run of the person's holds their Career files now: started, and its receipt not yet written. */
 function holds(sub){
  for(const [id,run] of runs){if(run.sub!==sub)continue;const kept=board(sub)[String(run.postingId)]||{};
   if(kept.requestId===run.requestId&&kept.completedAt){runs.delete(id);continue;}return run;}
  return null;
 }
 /** Start a résumé and cover letter for one job through the routes, as a page's Generate does; the run is the person's until it ends. */
 async function generate(sub,postingId){
  const requestId='concurrent-'+postingId+'-'+Date.now().toString(36);
  const answer=await call(sub,'POST','/api/career-hunter/jobs/'+postingId+'/generate',{documents:true,requestId,guidance:'',experienceIds:[],draftRevision:0,experienceChosen:true});
  if(answer.status===202)runs.set(requestId,{sub,postingId,requestId});
  return {...answer,requestId,json:JSON.parse(answer.bytes.toString('utf8')||'{}')};
 }
 const rows=sub=>sqliteRows(modules.store.userPaths(sub),sub);
 async function stop(){
  await new Promise(resolve=>server.close(resolve));rail.release();await new Promise(resolve=>rail.server.close(resolve));restoreEnv();
  for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  rmSync(root,{recursive:true,force:true});
 }
 return {origin:baseUrl,person,rail,call,generate,holds,board,rows,dirOf,stop};
}
