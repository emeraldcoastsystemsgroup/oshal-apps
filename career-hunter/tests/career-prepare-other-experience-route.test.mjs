/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "when i get to the application screen it fully generated my resume without asking me about adding in my optional addendum"; "i still need the option of 'Other experience · optional — Agentic Federal | oshal (open-source)' to be selectable"). The COMPILED board routes and the shipped libs (draft writer, experience library, remembered choice, saved-job preparation) on made-up people whose résumé holds an open-source portfolio (the saved-portfolio entry) and one volunteer entry; only the engine start is doubled and records what each preparation would be handed. (1) GET /experience-bank answers `last`: none before the person chooses, then the entries they prepared their last application with (Generate with experienceChosen); a generation without it (the assistant's career_draft) is not remembered. (2) The ticked entry reaches the engine (CH_EXPERIENCE_IDS) and the unticked one does not, and the job's tailoring keeps the choice. (3) With "Prepare saved jobs for me" on, Prepare application (and Save) for a person who has other experience and never chose starts nothing: the job waits and the answer says so; Settings' save counts the jobs that wait. (4) Once they have chosen, a job without its own choice is prepared with their last choice; a job whose tailoring holds a choice is prepared with it; an explicit empty choice (nothing ticked) is remembered and not asked again. (5) The draft writer keeps experienceChosen and refuses a non-boolean one. (6) The engine half of done-when 3 (tests/career-prepare-other-experience-contract.py): ticking the open-source entry is the one switch that lets a restored role keep its bullet naming that work. Red on store main da410a45, green with 1.68.1.
 */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRouter,loadCompiledModules} from './helpers/career-route-harness.mjs';

const require=createRequire(import.meta.url);
const Database=require(join(process.env.STORE_CI_TOOLCHAIN||new URL('../../scripts/toolchain',import.meta.url).pathname,'node_modules','better-sqlite3'));
const root=mkdtempSync(join(tmpdir(),'career-prepare-other-')),previous=process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT=root;
/** Every engine start the routes asked for: [pool, subject, command, environment]. */
const starts=[];
const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{
 'better-sqlite3':Database,
 './career-engine-dispatch':{runCareerCliAsync:async(...args)=>{starts.push(args);return {started:true};}},
 './career-engine-runner':{nativeRunInProgress:async()=>false},
});
const router=createRouter();
modules.board.registerCareerBoardRoutes(router,{pool:{query(){throw Error('No external database, kernel, employer or submission service allowed');}}});
const board=require('../lib/career-board-state');
after(()=>{if(previous===undefined)delete process.env.JOBHUNTER_STORE_ROOT;else process.env.JOBHUNTER_STORE_ROOT=previous;rmSync(root,{recursive:true,force:true});});

const PORTFOLIO='saved-portfolio',VOLUNTEER='volunteer-teaching-01';
/** A made-up résumé whose open-source work is saved with it (Other experience lists it as the saved-portfolio entry). */
const PROFILE={profile:{name:'Sample Candidate',experience_summary:'Runs office operations.'},
 roles:[{title:'Office Manager',org:'Harbor Light Systems',start:'2022-01',end:null,deliverables:['Ran the front office']}],
 oss_portfolio:{name:'Lantern',entry:{org:'Lantern (open-source)',span:'2024 to Present'},skills:['Python']}};
const BANK={version:1,entries:[{id:VOLUNTEER,title:'Weekend teaching',kind:'volunteer',organization:'Community school',period:'2024',facts:'Taught Python workshops.',skills:['Teaching'],archived:false}]};
let serial=0;

/**
 * @description One made-up person with two saved jobs, their résumé and (unless `plain`) other experience.
 * @param {{plain?:boolean}} [options] plain: no other experience at all.
 * @returns {object} The person's paths and calls.
 */
function person(options={}){
 const sub='prepare-other-fiction-'+(++serial),paths=modules.store.userPaths(sub);
 assert.ok(paths.userDir.startsWith(root+'/'),'every made-up person stays inside this test’s disposable root');
 mkdirSync(dirname(paths.corpusDb),{recursive:true});mkdirSync(paths.userDir,{recursive:true});
 const engine=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8'),corpus=new Database(paths.corpusDb);
 corpus.exec(engine.match(/CORPUS_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1].replaceAll('corpus.',''));
 corpus.exec("INSERT OR IGNORE INTO companies(id,name)VALUES(1,'Invented employer')");
 for(const id of [1,2])corpus.prepare("INSERT OR IGNORE INTO postings_corpus(id,company_id,ats_job_id,title,url,description,active)VALUES(?,1,?,'Office manager',?,?,1)").run(id,'fiction-'+id,'https://employer.example.test/opening/'+id,'Run the office. '.repeat(30));
 corpus.close();
 const db=new Database(paths.userDb);db.exec(engine.match(/USER_SCHEMA\s*=\s*"""([\s\S]*?)"""/)[1]);db.exec("INSERT INTO user_signals(posting_id,status)VALUES(1,'new'),(2,'new')");db.close();
 if(!options.plain){writeFileSync(join(paths.userDir,'career_db.json'),JSON.stringify(PROFILE));writeFileSync(join(paths.userDir,'experience-bank.json'),JSON.stringify(BANK));}
 for(const id of [1,2])board.updateBoardState(paths.userDir,id,{favorite:true,savedAt:'2026-11-16T12:00:00Z'});
 const call=(method,path,body)=>request(method,path,body,sub);
 return {sub,paths,call,job:async id=>(await call('GET','/jobs/'+id)).json.job,bank:async()=>(await call('GET','/experience-bank?summary=1')).json,
  mine:()=>starts.filter(start=>start[1]===sub)};
}
function request(method,path,body,sub){
 const parsed=new URL(path,'http://fixture.test'),found=router.find(method,parsed.pathname);
 if(!found)return Promise.resolve({status:404,json:{error:'route missing'}});
 return new Promise((resolve,reject)=>{const out={status:200};const res={status(n){out.status=n;return res;},setHeader(){},json(json){resolve({...out,json});return res;}};
  Promise.resolve(found.handler({method,oidc:{user:sub?{sub}:null},params:found.params,body,query:Object.fromEntries(parsed.searchParams),headers:{}},res)).catch(reject);});
}
/** Generate as Prepare application sends it: the ticked entries, the library's revision and, from the page or bulk Prepare, experienceChosen. */
async function generate(p,id,ids,chosen=true){
 const bank=await p.bank(),job=await p.job(id);
 return p.call('POST','/jobs/'+id+'/generate',{documents:true,requestId:'request-'+id+'-'+Date.now(),guidance:'',experienceIds:ids,experienceRevision:bank.revision,draftRevision:job.application.draft.revision||0,...(chosen?{experienceChosen:true}:{})});
}
const settings=(p,enabled=true)=>p.call('POST','/application-workflow',{enabled,mode:'review'});
const promote=(p,id)=>p.call('POST','/jobs/'+id+'/status',{status:'promoted',favorite:true});

test('GET /experience-bank names no last choice until the person prepares an application, then the entries they ticked',async()=>{
 const p=person();
 const before=await p.bank();
 assert.deepEqual(before.entries.map(entry=>entry.id),[PORTFOLIO,VOLUNTEER],'the open-source portfolio is offered as the saved-portfolio entry, beside the volunteer one');
 assert.equal(before.last,null,'nothing remembered before the person chooses');
 const answer=await generate(p,1,[PORTFOLIO]);
 assert.equal(answer.status,202,JSON.stringify(answer.json));
 const after=await p.bank();
 assert.deepEqual(after.last.experienceIds,[PORTFOLIO],'the entry they prepared with is their last choice');
 assert.equal(after.revision,before.revision,'remembering it does not change the library\'s revision (queued choices stay valid)');
 assert.ok(!existsSync(join(p.paths.userDir,'experience-choice.json.tmp')));
});

test('the ticked entry reaches the preparation and the unticked one does not; the job keeps the choice',async()=>{
 const p=person();
 assert.equal((await generate(p,1,[PORTFOLIO])).status,202);
 const env=p.mine().at(-1)[3];
 assert.deepEqual(p.mine().at(-1)[2],['prepare-job']);
 assert.deepEqual(JSON.parse(env.CH_EXPERIENCE_IDS),[PORTFOLIO],'only the ticked entry is handed to the engine');
 assert.equal(env.CH_OSHAL,'','no second switch: the open-source work is included by its ticked entry alone');
 const draft=(await p.job(1)).application.draft;
 assert.deepEqual([draft.experienceIds,draft.experienceChosen],[[PORTFOLIO],true],'the job\'s tailoring holds what was ticked, marked as chosen');
 const saved=board.readBoardState(p.paths.userDir).jobs[1].generationDraft.inputs.experienceIds;
 assert.deepEqual(saved,[PORTFOLIO]);
});

test('a generation the person did not choose for (the assistant\'s career_draft) is not remembered',async()=>{
 const p=person();
 assert.equal((await generate(p,1,[VOLUNTEER],false)).status,202);
 assert.equal((await p.bank()).last,null);
 assert.equal((await p.job(1)).application.draft.experienceChosen,undefined);
});

test('with "Prepare saved jobs for me" on, Prepare application for a person who never chose starts nothing: the job waits',async()=>{
 const p=person();
 const turnedOn=await settings(p);
 assert.equal(turnedOn.status,200);
 assert.deepEqual([turnedOn.json.queued,turnedOn.json.waiting],[0,2],'Settings says both saved jobs wait for the choice');
 const moved=await promote(p,1);
 assert.equal(moved.status,200);
 assert.deepEqual(moved.json.preparation,{queued:0,waiting:1},'the move answers that the job waits');
 assert.deepEqual(p.mine(),[],'no preparation started, so no résumé is made before the person chooses');
 const job=await p.job(1);
 assert.equal(job.status,'promoted','the job is in Getting ready');
 assert.equal(job.board.workflow,undefined,'and not marked as being prepared');
 assert.equal(job.application.needsGeneration,true,'Prepare application opens on step 1 · Tailor with the boxes');
});

test('after the person has chosen once, saved-job preparation uses that choice for a job without its own',async()=>{
 const p=person();
 assert.equal((await settings(p)).json.waiting,2,'both wait while the person has never chosen');
 assert.equal((await generate(p,2,[PORTFOLIO])).status,202,'the person prepares one application, ticking the open-source entry');
 const moved=await promote(p,1);
 assert.equal(moved.json.preparation.queued,1);
 assert.equal(moved.json.preparation.waiting,undefined);
 assert.deepEqual(p.mine().at(-1)[2],['prepare-saved']);
 const saved=board.readBoardState(p.paths.userDir).jobs[1];
 assert.deepEqual(saved.generationDraft.inputs.experienceIds,[PORTFOLIO],'prepared with the person\'s last choice');
 assert.equal(saved.applicationDraft.experienceChosen,true);
});

test('a job whose tailoring holds a choice is prepared with it, and an explicit empty choice is not asked again',async()=>{
 const p=person();
 await settings(p,false);
 const job=await p.job(1),bank=await p.bank();
 const saved=await p.call('POST','/jobs/1/status',{draft:{revision:job.application.draft.revision,guidance:'',experienceIds:[VOLUNTEER],experienceRevision:bank.revision,experienceChosen:true}});
 assert.equal(saved.status,200,JSON.stringify(saved.json));
 assert.equal(saved.json.application.draft.experienceChosen,true,'the draft writer keeps experienceChosen');
 const none=await p.call('POST','/jobs/2/status',{draft:{revision:0,guidance:'',experienceIds:[],experienceRevision:bank.revision,experienceChosen:true}});
 assert.equal(none.status,200,JSON.stringify(none.json));
 const turnedOn=await settings(p);
 assert.deepEqual([turnedOn.json.queued,turnedOn.json.waiting],[2,undefined],'both are prepared: one with its entry, one with nothing ticked, as chosen');
 const state=board.readBoardState(p.paths.userDir).jobs;
 assert.deepEqual(state[1].generationDraft.inputs.experienceIds,[VOLUNTEER]);
 assert.deepEqual(state[2].generationDraft.inputs.experienceIds,[]);
});

test('a person with no other experience is prepared as before, and the draft writer refuses a non-boolean experienceChosen',async()=>{
 const p=person({plain:true});
 const turnedOn=await settings(p);
 assert.deepEqual([turnedOn.json.queued,turnedOn.json.waiting],[2,undefined],'nothing to ask: both saved jobs are prepared, as before 1.68.1');
 const job=await p.job(2),bank=await p.bank();
 const refused=await p.call('POST','/jobs/2/status',{draft:{revision:job.application.draft.revision,guidance:'',experienceIds:[],experienceRevision:bank.revision,experienceChosen:'yes'}});
 assert.equal(refused.status,400);
});

test('the engine: ticking the open-source entry is the one switch that lets a restored role keep its bullet naming that work',()=>{
 const run=spawnSync(process.env.CAREER_PYTHON||'python3',[fileURLToPath(new URL('./career-prepare-other-experience-contract.py',import.meta.url))],{encoding:'utf8',timeout:120000});
 assert.equal(run.status,0,run.stderr+run.stdout);
 const result=JSON.parse(run.stdout.trim().split('\n').at(-1));
 assert.deepEqual(result.failed,[]);
 assert.ok(result.checks>=6,'every check ran');
});
