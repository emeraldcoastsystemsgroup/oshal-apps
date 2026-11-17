/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "my cover letter pulls from my first development job ... and lies about my level of expertise on c# ... the cover letter is not acceptable"): Prepare application end to end on a made-up long-form candidate (short field-contracting engagements, a first development job that used C# once). Real: the COMPILED board routes (POST /jobs/:id/generate, GET /jobs/:id, POST /jobs/:id/status), the engine dispatch, runner and launcher, the Python engine (prepare_job: scoring commit, generate_for with letter_evidence, claims_check and claims_fix, the Jinja templates, application.json) and the application draft. Doubled: the model (a scripted answer on the package's rail path that claims expert C#, 15 years of it, C# at the program job, a title and an employer the records do not hold, and a sentence from the first job, as production's local model did), Chromium (a stand-in that writes a one-line PDF), the kernel leaves in tests/helpers/career-route-harness.mjs and the request identity. (1) When the one rewrite the check asks for comes back clean, the prepared letter and résumé claim nothing the records do not support and Prepare application lists what Career took out. (2) When the rewrite overclaims again, the letter is marked needs your review with the problems named, and only the person's confirmation of that letter clears it. Red on store main dd5cd9ed, green with claims_check.
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
const root=mkdtempSync(join(tmpdir(),'career-letter-truth-route-')),SUB='letter-truth-teal',ISSUER='https://issuer.example.test';
const DESCRIPTION='You will build SCADA integrations, extend our Ignition HMI, read PLC data, script in Python and commission systems in the field. C# and .NET services are a plus. '.repeat(6);
const ENV_KEYS=['PORT','CHROMIUM_PATH','PLAYWRIGHT_CHROMIUM_PATH'];
const saved=Object.fromEntries(ENV_KEYS.map(key=>[key,process.env[key]]));
const prompts=[];
let restoreEnv,router,modules,rail,rewriteAnswer;

const field=(title,org,start,end,deliverables,skills)=>({title,org,start,end,deliverables,skills});
const PROFILE={profile:{name:'Sample Candidate',headline:'Field Automation and SCADA Engineer',experience_summary:'Field automation engineer who commissions SCADA and PLC systems on short contracts.'},
 roles:[{id:'r1',title:'Principal',org:'Harbor Light Systems',start:'2026-01',end:null,deliverables:['Leads delivery for two pilot customers']},
  field('Field Automation Engineer (contract)','Gulf Coast Refining','2025-06','2025-10',['Commissioned PLC and SCADA upgrades across three refinery units','Wrote Python scripts that validated Modbus tag maps before cutover'],['PLC','SCADA','Python']),
  field('Field Systems Engineer (contract)','Bayou Water Authority','2025-01','2025-05',['Migrated 40 pump stations to a new SCADA historian'],['SCADA']),
  field('Controls Integration Contractor','Delta Grain Terminals','2024-08','2024-12',['Integrated conveyor PLCs with an Ignition HMI','Trained the night shift on the new screens'],['PLC','Ignition','HMI']),
  field('SCADA Contractor','Magnolia Pipeline','2023-07','2024-01',['Rationalized 3,000 pipeline alarms with operations'],['SCADA']),
  field('Program Manager / SRE Lead','Bluewater Corp','2014-01','2021-12',['Led a 40-person SRE organization','Ran Azure migrations for 120 services'],['Azure','Kubernetes']),
  field('Software Developer','Old Mill Software','2000-06','2002-05',['Wrote desktop inventory tools in Visual Basic for a regional bank','Maintained a small C# utility for the bank\'s tellers'],['C#','Visual Basic'])],
 skills:{Automation:{items:['PLC','SCADA','Ignition','Python']}}};
const OVERCLAIM={greeting:'Dear Hiring Manager,',paragraphs:[
 'As an expert C# developer with 15 years of C# experience, I was excited to see this role. My first development job at Old Mill Software taught me to love building C# tools.',
 'At Bluewater Corp I built C# services for a 40-person SRE organization. Most recently I commissioned PLC and SCADA upgrades across three refinery units at Gulf Coast Refining.',
 'As a Principal Controls Architect, I would bring that field discipline to your team.'],closing:'Sincerely,'};
const HONEST={greeting:'Dear Hiring Manager,',paragraphs:[
 'This role is the field work I do every week. Most recently I commissioned PLC and SCADA upgrades across three refinery units at Gulf Coast Refining and wrote Python scripts that validated Modbus tag maps before cutover.',
 'At Delta Grain Terminals I integrated conveyor PLCs with an Ignition HMI and trained the night shift on the new screens. At Bayou Water Authority I migrated 40 pump stations to a new SCADA historian.',
 'I would bring that field discipline to your SCADA integrations. Could we talk about what your team needs first?'],closing:'Sincerely,'};
const DRAFT={resume:{headline:'Senior C# Controls Engineer',summary:'Expert C# developer with 15+ years of C# experience. Commissions SCADA systems in the field.',
 competencies:['SCADA integration','Expert C# Development','Rust'],skills:['SCADA','PLC','Rust'],certifications:[],education:[],clearance:'',
 experience:[{title:'Principal',org:'Harbor Light Systems',span:'2026 to Present',bullets:['Leads delivery for two pilot customers']},
  {title:'Lead SCADA Architect',org:'Gulf Coast Refining',span:'2025',bullets:['Commissioned PLC and SCADA upgrades across three refinery units','Built C# services for PLC data']},
  {title:'Chief Engineer',org:'Acme Rockets',span:'2010 to 2012',bullets:['Built rockets']}]},cover:OVERCLAIM};
const UNTRUE=['expert C#','Expert C#','15 years','15+ years','Old Mill Software','Principal Controls Architect','Chief Engineer','Acme Rockets','Rust','Lead SCADA Architect'];

/** The scripted model on the package's rail path: a fit, the overclaiming packet, the overclaiming editor pass, then the rewrite. */
function scripted(document){
 const prompt=String(document.prompt||'');prompts.push(prompt);
 if(String(document.system||'').startsWith('You are a recruiter'))return {fit_score:84,rationale:'Strong field fit.',matched:['SCADA'],gaps:[]};
 if(prompt.includes('PROBLEMS CAREER FOUND'))return rewriteAnswer;
 if(prompt.includes('DRAFT COVER'))return OVERCLAIM;
 return DRAFT;
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
function packetFolder(posting){
 const apps=join(modules.store.userPaths(SUB).userDir,'applications'),folder=readdirSync(apps).find(name=>name.endsWith('__'+posting));
 return folder?join(apps,folder):null;
}
async function prepare(posting){
 let started;/* the previous test's engine run may still hold the person's run lock for a moment after it reads ready */
 for(const until=Date.now()+30000;;){started=await call('POST','/jobs/'+posting+'/generate',{documents:true,requestId:'letter-truth-'+posting});
  if(started.status!==409||Date.now()>until)break;await new Promise(resolve=>setTimeout(resolve,250));}
 assert.equal(started.status,202,JSON.stringify(started.json));
 let job;for(const until=Date.now()+90000;Date.now()<until;){job=(await call('GET','/jobs/'+posting)).json.job;if(['ready','failed'].includes(job.board?.phase))break;await new Promise(resolve=>setTimeout(resolve,250));}
 assert.equal(job.board?.phase,'ready',JSON.stringify(job.board));
 return job;
}

before(async()=>{
 restoreEnv=isolateRunnerEnv(join(root,'store'));
 ({modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{'better-sqlite3':Database}));
 router=createRouter();modules.board.registerCareerBoardRoutes(router,{pool:{async query(){return {rows:[]};}}});
 rail=await startRail();process.env.PORT=String(rail.address().port);
 process.env.CHROMIUM_PATH=process.env.PLAYWRIGHT_CHROMIUM_PATH=standInChromium();
 const paths=modules.store.userPaths(SUB);mkdirSync(paths.userDir,{recursive:true});
 writeFileSync(join(paths.userDir,'career_db.json'),JSON.stringify(PROFILE));
 sqliteRows(paths,SUB,[['INSERT INTO corpus.companies(id,name) VALUES(?,?)',[1,'Target Utilities']],
  ...[91,92].map(id=>['INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,description,active,target_role) VALUES(?,?,?,?,?,?,1,1)',[id,1,String(id),'Senior Controls Engineer','https://example.invalid/jobs/'+id,DESCRIPTION]]),
  ...[91,92].map(id=>['INSERT INTO user_signals(posting_id,status,fit_score) VALUES(?,?,?)',[id,'promoted',70]])]);
});
after(async()=>{
 await new Promise(resolve=>rail?rail.close(resolve):resolve());restoreEnv?.();
 for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 rmSync(root,{recursive:true,force:true});
});

test('a model that overclaims: the letter is written again once with the problems named, and the documents claim only what the records hold',{timeout:120000},async()=>{
 rewriteAnswer=HONEST;prompts.length=0;
 const job=await prepare(91);
 const generation=prompts.find(prompt=>prompt.includes('Produce a tailored resume and cover letter'))||'';
 assert.match(generation,/COVER LETTER EVIDENCE/,'the model was given the letter\'s evidence');
 assert.ok(!generation.split('COVER LETTER EVIDENCE')[1].split('The cover letter\'s proof points')[0].includes('Old Mill Software'),'the first job is not in the evidence');
 const rewrites=prompts.filter(prompt=>prompt.includes('PROBLEMS CAREER FOUND'));
 assert.equal(rewrites.length,1,'exactly one rewrite');
 assert.match(rewrites[0],/The draft said “expert C#”/);
 const folder=packetFolder(91),letter=readFileSync(join(folder,'CoverLetter.html'),'utf8'),resume=readFileSync(join(folder,'Resume_ATS.html'),'utf8');
 for(const word of UNTRUE){assert.ok(!letter.includes(word),'letter: '+word);assert.ok(!resume.includes(word),'résumé: '+word);}
 assert.ok(resume.includes('Field Automation Engineer (contract)'),'the recorded title is back');
 const receipt=JSON.parse(readFileSync(join(folder,'application.json'),'utf8')).claims_check;
 assert.equal(receipt.status,'fixed');assert.equal(receipt.regenerated,true);
 assert.equal(job.application.claims.needsReview,false);
 assert.match(job.application.claims.fixed,/^Career checked these documents against your records\./);
 assert.equal(job.application.needsGeneration,false,'the held documents are ready to review');
});

test('when the rewrite overclaims again, the letter needs the person\'s review, and only their confirmation of it clears that',{timeout:120000},async()=>{
 rewriteAnswer=OVERCLAIM;prompts.length=0;
 const job=await prepare(92);
 const letter=readFileSync(join(packetFolder(92),'CoverLetter.html'),'utf8');
 for(const word of UNTRUE)assert.ok(!letter.includes(word),'letter: '+word);
 assert.equal(job.application.claims.needsReview,true);
 assert.match(job.application.claims.notice,/^Your cover letter needs your review before you send it\./);
 assert.match(job.application.claims.notice,/claimed “expert C#”; your records do not state that level/);
 const stale=await call('POST','/jobs/92/status',{applicationReview:{claims:'0'.repeat(64)}}).catch(error=>({status:error.status,json:{error:error.message}}));
 assert.notEqual(stale.status,200,'a confirmation of another letter is refused');
 const confirmed=await call('POST','/jobs/92/status',{applicationReview:{claims:job.application.claims.digest}});
 assert.equal(confirmed.status,200,JSON.stringify(confirmed.json));
 assert.equal(confirmed.json.application.claims.needsReview,false);
 assert.equal((await call('GET','/jobs/92')).json.job.application.claims.needsReview,false);
});
