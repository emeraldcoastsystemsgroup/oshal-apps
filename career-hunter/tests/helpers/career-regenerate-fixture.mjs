/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN: the made-up people, packets and engine stand-ins Generate again's page test serves over loopback HTTP: the COMPILED board routes (with lib/career-regenerate-routes.js) and the real Python engine, with only the model (a scripted answer on the package's rail path), Chromium (a one-line PDF) and the kernel leaves of tests/helpers/career-route-harness.mjs doubled. The caller is whoever the x-test-person header names.
 */
import http from 'node:http';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createRouter,isolateRunnerEnv,loadCompiledModules,sqliteRows,startServer} from './career-route-harness.mjs';
import {requestIdentity} from './request-identity-stub.mjs';

const require=createRequire(import.meta.url);
/** @description This Career's version, as the manifest states it. @type {string} */
export const VERSION=/^version:\s*(\d+\.\d+\.\d+)/m.exec(readFileSync(new URL('../../oshal-app.yaml',import.meta.url),'utf8'))[1];
const DESCRIPTION='Lead the platform group, own delivery and reliability, and grow the engineering team. '.repeat(20);
const PROFILE={profile:{name:'Sample Candidate',experience_summary:'Leads platform work at Bluewater Corp.'},
 roles:[{id:'r1',title:'Platform Director',org:'Bluewater Corp',start:'2018-03',end:null,deliverables:['Led the platform org of 40']},
  {id:'r2',title:'Operations Manager',org:'Bluewater Corp',start:'2015-01',end:'2018-02',deliverables:['Ran operations']}],skills:{Cloud:{items:['AWS']}}};
const WRITTEN={resume:{headline:'Platform leader',summary:'Leads platforms.',competencies:['Delivery'],skills:['AWS'],certifications:[],education:[],clearance:'',
 experience:[{title:'Platform Director',org:'Bluewater Corp',span:'2018 to Present',bullets:['Led the platform org']},
  {title:'Operations Manager',org:'Bluewater Corp',span:'2015 to 2018',bullets:['Ran operations']}]},
 cover:{greeting:'Dear Hiring Manager,',paragraphs:['Draft.'],closing:'Sincerely,'}};
/** @description The made-up jobs: id, company, title, fit and what its packet is (old: no version, no parse résumé). */
export const JOBS=[[201,'Example Freight Co','Platform Director',95,'old'],[202,'Sample Freight Two','Platform Director',90,'old'],[203,'Sample Freight Three','Platform Director',85,'old'],
 [204,'Sample Freight Four','Platform Director',80,'current'],[205,'Sample Freight Five','Platform Director',75,'applied']];

function scripted(document){
 if(String(document.system||'').startsWith('You are a recruiter'))return {fit_score:82,rationale:'Strong platform fit.',matched:['Platform delivery'],gaps:[]};
 if(String(document.prompt||'').includes('DRAFT COVER'))return {greeting:'Dear Hiring Manager,',paragraphs:['Polished.'],closing:'Sincerely,'};
 return WRITTEN;
}
function startRail(){
 return new Promise(resolve=>{const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{
  const ok=req.method==='POST'&&req.url==='/api/career-hunter/engine/complete';let answer={ok:false,error:'not-found'};
  if(ok){try{answer={ok:true,text:JSON.stringify(scripted(JSON.parse(body))),model:'scripted',provider:'scripted'};}catch{answer={ok:false,error:'invalid-json'};}}
  res.writeHead(ok?200:404,{'content-type':'application/json'});res.end(JSON.stringify(answer));});});
  server.listen(0,'127.0.0.1',()=>resolve(server));});
}
function seedPacket(dir,id,company,title,kind){
 const folder=join(dir,'applications',`${company.replace(/\W+/g,'-')}__${id}__${id}`);mkdirSync(folder,{recursive:true});
 writeFileSync(join(folder,'application.json'),JSON.stringify({posting_id:id,...(kind==='current'?{career_version:VERSION}:{}),company,title,generated:WRITTEN},null,2));
 for(const name of ['Resume_ATS.pdf','CoverLetter.pdf'])writeFileSync(join(folder,name),'%PDF-1.4 prepared earlier');
 if(kind==='current')writeFileSync(join(folder,'Resume_Parse.docx'),'PK parse résumé');
 return folder;
}
/**
 * @description Start the routes over loopback with a fresh disposable store. @returns {Promise<{origin:string,person:Function,
 * listJobs:Function,dirOf:Function,stop:Function}>}
 */
export async function regenerateHarness(){
 const root=mkdtempSync(join(tmpdir(),'career-regenerate-page-')),saved={PORT:process.env.PORT,CHROMIUM_PATH:process.env.CHROMIUM_PATH,PLAYWRIGHT_CHROMIUM_PATH:process.env.PLAYWRIGHT_CHROMIUM_PATH};
 const restoreEnv=isolateRunnerEnv(join(root,'store'));
 const Database=require(join(process.env.STORE_CI_TOOLCHAIN||new URL('../../../scripts/toolchain',import.meta.url).pathname,'node_modules','better-sqlite3'));
 const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{'better-sqlite3':Database});
 const router=createRouter();modules.board.registerCareerBoardRoutes(router,{pool:{async query(){return {rows:[]};}}});
 const rail=await startRail();process.env.PORT=String(rail.address().port);
 const chromium=join(root,'chromium');
 writeFileSync(chromium,'#!/bin/sh\nfor arg in "$@"; do case "$arg" in --print-to-pdf=*) printf \'%%PDF-1.4\\n%%%%EOF\\n\' > "${arg#--print-to-pdf=}";; esac; done\n');chmodSync(chromium,0o755);
 process.env.CHROMIUM_PATH=process.env.PLAYWRIGHT_CHROMIUM_PATH=chromium;
 // Each request runs under the kernel's request identity, as a signed-in request does: the engine run's callback grant needs its issuer.
 const identified={find:(method,pathname)=>{const found=router.find(method,pathname);return found&&{...found,handler:(req,res)=>requestIdentity.runWithRequestIdentity(
  {sub:req.oidc?.user?.sub,principalIssuer:'https://issuer.example.test',isOperator:false,isSystem:false},()=>found.handler(req,res))};}};
 const {server,baseUrl}=await startServer(identified,headers=>headers['x-test-person']);
 let corpus=false;
 const dirOf=sub=>modules.store.userPaths(sub).userDir;
 /** A made-up person whose store holds the five jobs and their packets. */
 function person(sub){
  const paths=modules.store.userPaths(sub);mkdirSync(paths.userDir,{recursive:true});writeFileSync(join(paths.userDir,'career_db.json'),JSON.stringify(PROFILE));
  const statements=corpus?[]:[['INSERT INTO corpus.companies(id,name) VALUES(?,?)',[1,'Target Co']]];
  for(const [id,company,title,fit,kind] of JOBS){
   if(!corpus)statements.push(['INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,description,active,target_role) VALUES(?,?,?,?,?,?,1,1)',[id,1,String(id),title,'https://example.invalid/jobs/'+id,DESCRIPTION]]);
   const folder=seedPacket(paths.userDir,id,company,title,kind);
   statements.push(['INSERT INTO user_signals(posting_id,status,resume_path,cover_path,ai_fit_score) VALUES(?,?,?,?,?)',[id,kind==='applied'?'applied':'generated',join(folder,'Resume_ATS.pdf'),join(folder,'CoverLetter.pdf'),fit]]);
  }
  sqliteRows(paths,sub,statements);corpus=true;
  return {dir:paths.userDir};
 }
 /** The rows My jobs' list reads for the open jobs, as GET /jobs answers them. */
 const listJobs=()=>JOBS.filter(job=>job[4]!=='applied').map(([id,company,title,fit])=>({id,company,title,status:'generated',favorite:true,active:1,has_resume:1,has_cover:1,ai_fit_score:fit,
  workplaceType:'onsite',location:'Springfield, IL',url:'https://example.invalid/jobs/'+id,description:'A real description.',board:{favorite:true,savedAt:'2026-11-20T15:00:00Z'}}));
 async function stop(){
  await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>rail.close(resolve));restoreEnv();
  for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  rmSync(root,{recursive:true,force:true});
 }
 return {origin:baseUrl,person,listJobs,dirOf,stop};
}
