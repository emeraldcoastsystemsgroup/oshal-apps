/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.3 (Roger, 2026-11-16: "the system isnt using my most recent expierence to generate the resume ... i cant submit any resimes untill this is taken care of"): Prepare application end to end on a made-up candidate whose current role is first with no end date. Real: the COMPILED board routes (POST /jobs/:id/generate, GET /jobs/:id), the engine dispatch, runner and launcher, the Python engine (prepare_job: scoring commit, generate_for, the Jinja templates, application.json) and the application draft. Doubled: the model (a scripted answer on the package's rail path that leaves the three newest roles out, as production's model did), Chromium (a stand-in that writes a one-line PDF), the kernel leaves in tests/helpers/career-route-harness.mjs and the request identity (an issuer for the rail grant). (1) A résumé prepared before the check that leaves the current role out reads as needing generation and names the role. (2) Generate makes a résumé that carries it first. Red on store main d28c8c02, green with role_plan.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createRouter,isolateRunnerEnv,loadCompiledModules,sqliteRows} from './helpers/career-route-harness.mjs';
import {requestIdentity} from './helpers/request-identity-stub.mjs';

const require=createRequire(import.meta.url);
const Database=require(join(process.env.STORE_CI_TOOLCHAIN||new URL('../../scripts/toolchain',import.meta.url).pathname,'node_modules','better-sqlite3'));
const root=mkdtempSync(join(tmpdir(),'career-current-role-route-')),SUB='current-role-olive',ISSUER='https://issuer.example.test';
const CURRENT=['Co-Founder / Principal','Harbor Light Systems'];
const DESCRIPTION='Lead the platform group, own delivery and reliability, and grow the engineering team. '.repeat(20);
const ENV_KEYS=['PORT','CHROMIUM_PATH','PLAYWRIGHT_CHROMIUM_PATH'];
const saved=Object.fromEntries(ENV_KEYS.map(key=>[key,process.env[key]]));
const prompts=[];
let restoreEnv,router,modules,rail;

const PROFILE={profile:{name:'Sample Candidate',experience_summary:'Leads platform work at Bluewater Corp.'},
 framing_notes:['Currently leads platform delivery at Bluewater Corp.'],employers:[{name:'Bluewater Corp',note:'current employer'}],
 roles:[{id:'r13',title:CURRENT[0],org:CURRENT[1],start:'2024-02',end:null,deliverables:['Won two paying pilot customers in 2025']},
  {id:'r14',title:'Board Advisor',org:'North Pier Labs',start:'2023-06',end:null,deliverables:['Advised the founders on delivery']},
  {id:'r15',title:'Program Director',org:'Cedar Analytics',start:'2022-01',end:'2023-12',deliverables:['Ran a 40-person program']},
  {title:'Platform Director',org:'Bluewater Corp',start:'2018-03',end:'2021-12',deliverables:['Led the platform org of 40']},
  {title:'Operations Manager',org:'Bluewater Corp',start:'2015-01',end:'2018-02',deliverables:['Ran operations']}],skills:{Cloud:{items:['AWS']}}};
/** What production's model wrote: the résumé starts at the older employer. */
const LEFT_OUT={resume:{headline:'Platform leader',summary:'Leads platforms.',competencies:['Delivery'],skills:['AWS'],certifications:[],education:[],clearance:'',
 experience:[{title:'Platform Director',org:'Bluewater Corp',span:'2018 to 2021',bullets:['Led the platform org']},
  {title:'Operations Manager',org:'Bluewater Corp',span:'2015 to 2018',bullets:['Ran operations']}]},
 cover:{greeting:'Dear Hiring Manager,',paragraphs:['Draft.'],closing:'Sincerely,'}};

/** The scripted model on the package's rail path: a fit for the scoring question, the résumé, then the cover editor's pass. */
function scripted(document){
 prompts.push(document.prompt);
 if(String(document.system||'').startsWith('You are a recruiter'))return {fit_score:82,rationale:'Strong platform fit.',matched:['Platform delivery'],gaps:[]};
 if(String(document.prompt).includes('DRAFT COVER'))return {greeting:'Dear Hiring Manager,',paragraphs:['Polished.'],closing:'Sincerely,'};
 return LEFT_OUT;
}
function startRail(){
 return new Promise(resolve=>{const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{
  const ok=req.method==='POST'&&req.url==='/api/career-hunter/engine/complete';let answer={ok:false,error:'not-found'};
  if(ok){try{answer={ok:true,text:JSON.stringify(scripted(JSON.parse(body))),model:'scripted',provider:'scripted'};}catch{answer={ok:false,error:'invalid-json'};}}
  res.writeHead(ok?200:404,{'content-type':'application/json'});res.end(JSON.stringify(answer));});});
  server.listen(0,'127.0.0.1',()=>resolve(server));});
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
function packet(posting){
 const apps=join(modules.store.userPaths(SUB).userDir,'applications'),folder=readdirSync(apps).find(name=>name.endsWith('__'+posting));
 return folder?JSON.parse(readFileSync(join(apps,folder,'application.json'),'utf8')):null;
}
/** A résumé Career prepared before the check, in production's shape: it starts at the older employer. */
function seedOldPacket(paths){
 const folder=join(paths.userDir,'applications','Target-Co__81');mkdirSync(folder,{recursive:true});
 writeFileSync(join(folder,'application.json'),JSON.stringify({posting_id:81,company:'Target Co',title:'Platform Director',generated:LEFT_OUT}));
 for(const name of ['Resume_ATS.pdf','CoverLetter.pdf'])writeFileSync(join(folder,name),'%PDF-1.4 prepared earlier');
 return folder;
}

before(async()=>{
 restoreEnv=isolateRunnerEnv(join(root,'store'));
 ({modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{'better-sqlite3':Database}));
 router=createRouter();modules.board.registerCareerBoardRoutes(router,{pool:{async query(){return {rows:[]};}}});
 rail=await startRail();process.env.PORT=String(rail.address().port);
 process.env.CHROMIUM_PATH=process.env.PLAYWRIGHT_CHROMIUM_PATH=standInChromium();
 const paths=modules.store.userPaths(SUB);mkdirSync(paths.userDir,{recursive:true});
 writeFileSync(join(paths.userDir,'career_db.json'),JSON.stringify(PROFILE));
 const folder=seedOldPacket(paths);
 sqliteRows(paths,SUB,[['INSERT INTO corpus.companies(id,name) VALUES(?,?)',[1,'Target Co']],
  ...[81,82].map(id=>['INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,description,active,target_role) VALUES(?,?,?,?,?,?,1,1)',[id,1,String(id),'Platform Director','https://example.invalid/jobs/'+id,DESCRIPTION]]),
  ['INSERT INTO user_signals(posting_id,status,resume_path,cover_path) VALUES(?,?,?,?)',[81,'generated',join(folder,'Resume_ATS.pdf'),join(folder,'CoverLetter.pdf')]],
  ['INSERT INTO user_signals(posting_id,status,fit_score) VALUES(?,?,?)',[82,'promoted',70]]]);
});
after(async()=>{
 await new Promise(resolve=>rail?rail.close(resolve):resolve());restoreEnv?.();
 for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 rmSync(root,{recursive:true,force:true});
});

test('a résumé prepared before the check that leaves the current role out reads as needing generation, naming the role',async()=>{
 const {status,json}=await call('GET','/jobs/81');
 assert.equal(status,200);
 const application=json.job.application;
 assert.equal(application.needsGeneration,true,'Prepare application opens on Tailor with Generate résumé & cover letter');
 assert.deepEqual(application.missingRoles?.[0],{title:CURRENT[0],org:CURRENT[1],current:true});
 assert.match(application.rolesNotice||'',/Co-Founder \/ Principal at Harbor Light Systems/);
});

test('Generate makes a résumé that carries the current role first, though the model leaves it out',{timeout:120000},async()=>{
 const started=await call('POST','/jobs/82/generate',{documents:true,requestId:'current-role-82'});
 assert.equal(started.status,202,JSON.stringify(started.json));
 let job;for(const until=Date.now()+90000;Date.now()<until;){job=(await call('GET','/jobs/82')).json.job;if(['ready','failed'].includes(job.board?.phase))break;await new Promise(resolve=>setTimeout(resolve,250));}
 assert.equal(job.board?.phase,'ready',JSON.stringify(job.board));
 const generation=prompts.find(prompt=>prompt.includes('Produce a tailored resume and cover letter'))||'';
 assert.ok(generation.includes(CURRENT[1]),'the model was given the current role');
 const written=packet(82)?.generated?.resume?.experience||[];
 assert.deepEqual(written.slice(0,3).map(e=>[e.title,e.org]),[CURRENT,['Board Advisor','North Pier Labs'],['Program Director','Cedar Analytics']],'current roles first, then the newest ended role');
 assert.equal(written[0].span,'2024 to Present');
 assert.deepEqual(written.slice(3).map(e=>e.title),['Platform Director','Operations Manager'],'the model\'s own entries follow, as written');
 assert.deepEqual(job.application.missingRoles,[]);assert.equal(job.application.needsGeneration,false,'the new résumé is ready to review');
});
