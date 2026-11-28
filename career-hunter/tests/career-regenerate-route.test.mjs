/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN (Roger, 2026-11-21: 200 applications by Monday; his open jobs were generated before this week's fixes and each needs Generate résumé & cover letter again): Generate again over the COMPILED board routes (lib/career-regenerate-routes.js mounted by routes/career-board-routes.js), the engine dispatch, runner and launcher and the Python engine (prepare_job, generate_for, the parse résumé), on made-up people. Doubled: the model (a scripted answer on the package's rail path), Chromium (a stand-in that writes a one-line PDF), the kernel leaves in tests/helpers/career-route-harness.mjs. Proved: GET /regenerate/older picks exactly the open jobs whose packet predates this Career or lacks Resume_Parse.docx; three jobs are regenerated in his order, one at a time, each with its own tailoring notes, each new packet recording this Career's version and carrying the parse résumé; a failed job is tried once more, then left with its reason; Pause, Go on and Stop; the queue is read back by a fresh router (a reload or a kernel restart) and a run lost mid-way is tried again; an applied job is refused, and one applied while waiting is skipped; his own Generate meanwhile wins; another person sees and changes nothing. Red on store main 1ac6e2fd: GET /regenerate/older is not mounted.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0: each regenerated packet records the documents revision it was written under (application.json documents_revision, the engine's DOCUMENTS_REVISION), beside the Career version.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0: the restart case says what makes a take a lost run (nothing else of his finished after it); the production case of 2026-11-27 (a take that sat through other runs holding his store is taken again with no try counted, and both jobs are written on their first try, where before the take was ended "The generation stopped before it finished, so nothing was saved"; red on 1.77.6); and documents taking turns with Fill in several (nothing starts while three approved jobs wait).
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createRouter,isolateRunnerEnv,loadCompiledModules,sqliteRows} from './helpers/career-route-harness.mjs';
import {requestIdentity} from './helpers/request-identity-stub.mjs';

const require=createRequire(import.meta.url);
const Database=require(join(process.env.STORE_CI_TOOLCHAIN||new URL('../../scripts/toolchain',import.meta.url).pathname,'node_modules','better-sqlite3'));
const root=mkdtempSync(join(tmpdir(),'career-regenerate-route-')),SUB='regen-avery',OTHER='regen-blair',ISSUER='https://issuer.example.test';
const VERSION=/^version:\s*(\d+\.\d+\.\d+)/m.exec(readFileSync(new URL('../oshal-app.yaml',import.meta.url),'utf8'))[1];
const REVISION=Number(/^DOCUMENTS_REVISION\s*=\s*(\d+)/m.exec(readFileSync(new URL('../engine/jobhunter/documents_revision.py',import.meta.url),'utf8'))[1]);
const DESCRIPTION='Lead the platform group, own delivery and reliability, and grow the engineering team. '.repeat(20);
const ENV_KEYS=['PORT','CHROMIUM_PATH','PLAYWRIGHT_CHROMIUM_PATH'];
const saved=Object.fromEntries(ENV_KEYS.map(key=>[key,process.env[key]]));
const prompts=[],fails=new Map();
let restoreEnv,router,modules,rail;

const PROFILE={profile:{name:'Sample Candidate',experience_summary:'Leads platform work at Bluewater Corp.'},
 roles:[{id:'r1',title:'Platform Director',org:'Bluewater Corp',start:'2018-03',end:null,deliverables:['Led the platform org of 40']},
  {id:'r2',title:'Operations Manager',org:'Bluewater Corp',start:'2015-01',end:'2018-02',deliverables:['Ran operations']}],skills:{Cloud:{items:['AWS']}}};
const WRITTEN={resume:{headline:'Platform leader',summary:'Leads platforms.',competencies:['Delivery'],skills:['AWS'],certifications:[],education:[],clearance:'',
 experience:[{title:'Platform Director',org:'Bluewater Corp',span:'2018 to Present',bullets:['Led the platform org']},
  {title:'Operations Manager',org:'Bluewater Corp',span:'2015 to 2018',bullets:['Ran operations']}]},
 cover:{greeting:'Dear Hiring Manager,',paragraphs:['Draft.'],closing:'Sincerely,'}};
/** Each made-up job: id, its title (the scripted model knows the job by it), its fit, and what its packet is. */
const JOBS=[[101,'Platform Director Alpha',95,'old'],[102,'Platform Director Bravo',90,'old'],[103,'Platform Director Charlie',85,'old'],
 [104,'Platform Director Delta',80,'current'],[105,'Platform Director Echo',75,'applied'],[106,'Platform Director Foxtrot',70,'none'],
 [107,'Platform Director Golf',65,'earlier-version'],[108,'Platform Director Hotel',60,'old'],[109,'Platform Director India',55,'old']];

/** The scripted model: a fit for scoring, the résumé, the cover editor's pass; a job named in `fails` is refused that many times. */
function scripted(document){
 prompts.push(document.prompt);
 const text=String(document.prompt||'');
 for(const [title,left] of fails)if(left>0&&text.includes(title)&&!String(document.system||'').startsWith('You are a recruiter')){fails.set(title,left-1);return null;}
 if(String(document.system||'').startsWith('You are a recruiter'))return {fit_score:82,rationale:'Strong platform fit.',matched:['Platform delivery'],gaps:[]};
 if(text.includes('DRAFT COVER'))return {greeting:'Dear Hiring Manager,',paragraphs:['Polished.'],closing:'Sincerely,'};
 return WRITTEN;
}
function startRail(){
 return new Promise(resolve=>{const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{
  const ok=req.method==='POST'&&req.url==='/api/career-hunter/engine/complete';let answer={ok:false,error:'not-found'};
  if(ok){try{const made=scripted(JSON.parse(body));answer=made?{ok:true,text:JSON.stringify(made),model:'scripted',provider:'scripted'}:{ok:false,error:'unavailable'};}catch{answer={ok:false,error:'invalid-json'};}}
  res.writeHead(ok?200:404,{'content-type':'application/json'});res.end(JSON.stringify(answer));});});
  server.listen(0,'127.0.0.1',()=>resolve(server));});
}
function standInChromium(){
 const file=join(root,'chromium');
 writeFileSync(file,'#!/bin/sh\nfor arg in "$@"; do case "$arg" in --print-to-pdf=*) printf \'%%PDF-1.4\\n%%%%EOF\\n\' > "${arg#--print-to-pdf=}";; esac; done\n');
 chmodSync(file,0o755);return file;
}
function mount(){router=createRouter();modules.board.registerCareerBoardRoutes(router,{pool:{async query(){return {rows:[]};}}});}
function call(method,path,body,sub=SUB){
 const parsed=new URL(path,'http://fixture.test'),found=router.find(method,parsed.pathname);assert.ok(found,`${method} ${path} is mounted`);
 return new Promise((resolve,reject)=>{const out={status:200};const res={status(n){out.status=n;return res;},setHeader(){},json(json){resolve({...out,json});return res;}};
  requestIdentity.runWithRequestIdentity({sub,principalIssuer:ISSUER,isOperator:false,isSystem:false},()=>Promise.resolve(found.handler({method,path:parsed.pathname,oidc:{user:{sub}},params:found.params,body,query:Object.fromEntries(parsed.searchParams),headers:{}},res)).catch(reject));});
}
const dirOf=sub=>modules.store.userPaths(sub).userDir;
const boardOf=(sub=SUB)=>JSON.parse(readFileSync(join(dirOf(sub),'job-board-state.json'),'utf8')).jobs;
/** The job's newest packet folder (a new generation may write beside an older one). */
function folderOf(id,sub=SUB){const apps=join(dirOf(sub),'applications'),at=name=>statSync(join(apps,name,'application.json')).mtimeMs;
 const names=readdirSync(apps).filter(n=>n.endsWith('__'+id)&&existsSync(join(apps,n,'application.json'))).sort((a,b)=>at(b)-at(a));return names.length?join(apps,names[0]):null;}
const packet=id=>JSON.parse(readFileSync(join(folderOf(id),'application.json'),'utf8'));
/** A packet Career made before: its application.json (with the version it records, if any) and its files. */
function seedPacket(paths,id,title,kind){
 const folder=join(paths.userDir,'applications',`Target-Co__${id}`);mkdirSync(folder,{recursive:true});
 const record={posting_id:id,...(kind==='current'?{career_version:VERSION}:kind==='earlier-version'?{career_version:'1.71.0'}:{}),company:'Target Co',title,generated:WRITTEN};
 writeFileSync(join(folder,'application.json'),JSON.stringify(record,null,2));
 for(const name of ['Resume_ATS.pdf','CoverLetter.pdf'])writeFileSync(join(folder,name),'%PDF-1.4 prepared earlier');
 if(kind==='current'||kind==='earlier-version')writeFileSync(join(folder,'Resume_Parse.docx'),'PK parse résumé');
 return folder;
}
function seedPerson(sub,corpus){
 const paths=modules.store.userPaths(sub);mkdirSync(paths.userDir,{recursive:true});
 writeFileSync(join(paths.userDir,'career_db.json'),JSON.stringify(PROFILE));
 const statements=corpus?[['INSERT INTO corpus.companies(id,name) VALUES(?,?)',[1,'Target Co']]]:[];
 for(const [id,title,fit,kind] of JOBS){
  if(corpus)statements.push(['INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,description,active,target_role) VALUES(?,?,?,?,?,?,1,1)',[id,1,String(id),title,'https://example.invalid/jobs/'+id,DESCRIPTION]]);
  if(kind==='none'){statements.push(['INSERT INTO user_signals(posting_id,status,ai_fit_score) VALUES(?,?,?)',[id,'promoted',fit]]);continue;}
  const folder=seedPacket(paths,id,title,kind);
  statements.push(['INSERT INTO user_signals(posting_id,status,resume_path,cover_path,ai_fit_score) VALUES(?,?,?,?,?)',[id,kind==='applied'?'applied':'generated',join(folder,'Resume_ATS.pdf'),join(folder,'CoverLetter.pdf'),fit]]);
 }
 sqliteRows(paths,sub,statements);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Move the queue on the way the page and the schedule do, until it has ended or `until` says so. */
async function drive(until=queue=>['done','stopped'].includes(queue.state)&&!queue.current,limit=240000){
 let queue;
 for(const end=Date.now()+limit;Date.now()<end;){
  const moved=await call('POST','/regenerate/advance',{});assert.equal(moved.status,200,JSON.stringify(moved.json));queue=moved.json.queue;
  if(!queue||until(queue))return queue;await sleep(150);
 }
 assert.fail('the queue did not end: '+JSON.stringify(queue));
}
const states=queue=>queue.entries.map(entry=>[entry.postingId,entry.state]);
/** His board state as the engine keeps it (job-board-state.json), every receipt made `ms` older; and one receipt set as a run left it. */
function ageReceipts(ms){const file=join(dirOf(SUB),'job-board-state.json'),board=JSON.parse(readFileSync(file,'utf8'));
 for(const job of Object.values(board.jobs||{}))if(job?.completedAt)job.completedAt=new Date(Date.parse(job.completedAt)-ms).toISOString();writeFileSync(file,JSON.stringify(board));}
function setReceipt(id,receipt){const file=join(dirOf(SUB),'job-board-state.json'),board=JSON.parse(readFileSync(file,'utf8'));board.jobs[id]={...(board.jobs[id]||{}),...receipt};writeFileSync(file,JSON.stringify(board));}
const press=name=>call('POST','/regenerate/'+name,{});
/** Start each case from no queue and a model that answers. */
async function fresh(){fails.clear();await clear();}
async function clear(){const read=(await call('GET','/regenerate')).json.queue;if(!read)return;if(!['done','stopped'].includes(read.state)){await press('stop');await drive();}assert.equal((await press('clear')).status,200);}

before(async()=>{
 restoreEnv=isolateRunnerEnv(join(root,'store'));
 ({modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{'better-sqlite3':Database}));
 mount();
 rail=await startRail();process.env.PORT=String(rail.address().port);
 process.env.CHROMIUM_PATH=process.env.PLAYWRIGHT_CHROMIUM_PATH=standInChromium();
 seedPerson(SUB,true);seedPerson(OTHER,false);
});
after(async()=>{
 await new Promise(resolve=>rail?rail.close(resolve):resolve());restoreEnv?.();
 for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 rmSync(root,{recursive:true,force:true});
});

test('Select all with older documents picks exactly the open jobs whose packet predates this Career or lacks the parse résumé',async()=>{
 const {status,json}=await call('GET','/regenerate/older');
 assert.equal(status,200,JSON.stringify(json));
 assert.equal(json.version,VERSION,'today\'s Career is the manifest\'s version');
 assert.deepEqual(json.jobs.map(job=>[job.id,job.why]),[[101,'parse'],[102,'parse'],[103,'parse'],[107,'version'],[108,'parse'],[109,'parse']],
  'best match first; the current packet (104), the applied job (105) and the job with no documents (106) are left out');
 assert.equal(json.count,6);
 assert.deepEqual(json.jobs[0],{id:101,company:'Target Co',title:'Platform Director Alpha',why:'parse',match:95});
});

test('an applied job is refused, and the others go in',async()=>{
 await fresh();
 const {status,json}=await call('POST','/regenerate',{jobs:[105,101],confirmed:true});
 assert.equal(status,200,JSON.stringify(json));
 assert.deepEqual(json.refused,[{postingId:105,code:'applied',why:'Already applied. Career keeps a sent application’s documents as they were.'}]);
 assert.deepEqual(states(json.queue),[[101,'queued']]);
 assert.equal((await call('POST','/regenerate',{jobs:[101]})).status,400,'nothing is queued without the confirmation');
 assert.equal((await call('POST','/regenerate',{jobs:Array.from({length:301},(_,i)=>i+1),confirmed:true})).status,400,'at most 300 in one run');
 await clear();
});

test('three jobs are regenerated in his order, one at a time, each with its own notes, through today\'s engine',{timeout:300000},async()=>{
 await fresh();
 const bank=(await call('GET','/experience-bank?summary=1')).json;
 const noted=await call('POST','/jobs/102/status',{draft:{revision:0,guidance:'Lead with the Kubernetes migration for the Bravo team.',experienceIds:[],experienceRevision:bank.revision}});
 assert.equal(noted.status,200,JSON.stringify(noted.json));
 const queued=await call('POST','/regenerate',{jobs:[103,101,102],confirmed:true});
 assert.deepEqual(states(queued.json.queue),[[103,'queued'],[101,'queued'],[102,'queued']]);
 const order=[];
 const done=await drive(queue=>{const now=queue.current;if(now?.state==='running'&&order.at(-1)!==now.postingId)order.push(now.postingId);
  assert.ok(queue.entries.filter(entry=>['claimed','running'].includes(entry.state)).length<=1,'never two at once');return queue.state==='done';});
 assert.deepEqual(order,[103,101,102],'in the order he chose');
 assert.deepEqual(states(done),[[103,'done'],[101,'done'],[102,'done']]);
 assert.deepEqual(done.counts,{done:3,failed:0,skipped:0,left:0,total:3});
 const jobs=boardOf();
 assert.ok(jobs[103].completedAt<=jobs[101].requestedAt&&jobs[101].completedAt<=jobs[102].requestedAt,'each started after the one before ended');
 for(const id of [101,102,103]){
  assert.equal(packet(id).career_version,VERSION,`job ${id}'s new packet records this Career`);
  assert.equal(packet(id).documents_revision,REVISION,`job ${id}'s new packet records the documents revision it was written under`);
  assert.ok(existsSync(join(folderOf(id),'Resume_Parse.docx')),`job ${id} now has the résumé for upload forms`);
  assert.equal(jobs[id].applicationDraft?.guidance??'',id===102?'Lead with the Kubernetes migration for the Bravo team.':'','his notes for the job are kept');
 }
 assert.ok(prompts.some(prompt=>prompt.includes('Platform Director Bravo')&&prompt.includes('Lead with the Kubernetes migration for the Bravo team.')),'the Bravo job was written with its own notes');
 const older=(await call('GET','/regenerate/older')).json.jobs.map(job=>job.id);
 assert.deepEqual(older.filter(id=>[101,102,103].includes(id)),[],'they no longer count as older');
 await clear();
});

test('a failed job is tried once more, then left with its reason',{timeout:300000},async()=>{
 await fresh();
 fails.set('Platform Director Golf',1);fails.set('Platform Director Hotel',5);
 await call('POST','/regenerate',{jobs:[107,108],confirmed:true});
 const seen=[];
 const done=await drive(queue=>{for(const entry of queue.entries)if(entry.retry.startsWith('Trying once more: Career could not make the documents.'))seen.push(entry.postingId);return queue.state==='done';});
 assert.deepEqual([...new Set(seen)],[107,108],'each failure was tried once more');
 const [golf,hotel]=done.entries;
 assert.deepEqual([golf.state,golf.attempts],['done',2],'the second try made the documents');
 assert.deepEqual([hotel.state,hotel.attempts,hotel.reason],['failed',2,'Career could not make the documents.'],'two failures: left with its reason');
 assert.equal(packet(107).career_version,VERSION);
 fails.clear();
 await clear();
});

test('Pause, Go on and Stop',{timeout:300000},async()=>{
 await fresh();
 await call('POST','/regenerate',{jobs:[108,109,101],confirmed:true});
 let queue=(await call('POST','/regenerate/advance',{})).json.queue;
 assert.deepEqual(states(queue),[[108,'claimed'],[109,'queued'],[101,'queued']],'one step takes the first job');
 queue=await drive(read=>read.current?.state==='running');
 assert.equal(queue.current.postingId,108,'the next step starts it');
 queue=(await press('pause')).json.queue;
 assert.equal(queue.state,'paused');assert.match(queue.reason,/finishes the job it is writing now/);
 queue=await drive(read=>read.current===null);
 assert.deepEqual(states(queue),[[108,'done'],[109,'queued'],[101,'queued']],'the job being written finished; nothing else started');
 for(let i=0;i<3;i+=1)queue=(await call('POST','/regenerate/advance',{})).json.queue;
 assert.deepEqual(states(queue),[[108,'done'],[109,'queued'],[101,'queued']],'paused: advancing starts nothing');
 queue=(await press('go-on')).json.queue;
 assert.equal(queue.state,'running');assert.deepEqual(states(queue)[1],[109,'claimed'],'Go on takes the next job');
 queue=await drive(read=>read.current?.state==='running');
 assert.equal(queue.current.postingId,109,'the next step starts it once the run before has let go of his store');
 queue=(await press('stop')).json.queue;
 assert.equal(queue.state,'stopped');
 assert.deepEqual(queue.entries[2],{...queue.entries[2],state:'skipped',reason:'Stopped before Career reached it.'});
 queue=await drive();
 assert.deepEqual(states(queue),[[108,'done'],[109,'done'],[101,'skipped']],'Stop lets the job being written finish and starts no other');
 assert.equal((await press('go-on')).status,409,'a stopped queue does not go on');
 await clear();
});

test('a reload or a kernel restart keeps the queue, and a run lost mid-way is tried again',{timeout:300000},async()=>{
 await fresh();
 await call('POST','/regenerate',{jobs:[101,103],confirmed:true});
 await call('POST','/regenerate/advance',{});
 const before=(await call('GET','/regenerate')).json.queue;
 mount();
 assert.deepEqual((await call('GET','/regenerate')).json.queue,before,'a fresh router reads the same queue from his store');
 // The kernel restarted while job 101 was being written: its run's writes were discarded, so his store shows it taken
 // longer ago than any start could take, with no receipt.
 // Nothing else of his finished after it was taken (every receipt is older than the take).
 const file=join(dirOf(SUB),'regenerate-queue.json'),stored=JSON.parse(readFileSync(file,'utf8'));
 stored.entries[0].claimedAt=new Date(Date.now()-10*60*1000).toISOString();writeFileSync(file,JSON.stringify(stored));
 ageReceipts(20*60*1000);
 const queue=await drive();
 assert.deepEqual(queue.entries.map(entry=>[entry.postingId,entry.state,entry.attempts]),[[101,'done',2],[103,'done',1]],'the lost run counts as one try and the job is made again');
 await clear();
});

test('production 2026-11-27: a take that sat through other runs holding his store is taken again, never "stopped before it finished"',{timeout:300000},async()=>{
 await fresh();
 await call('POST','/regenerate',{jobs:[101,103],confirmed:true});
 assert.deepEqual(states((await call('POST','/regenerate/advance',{})).json.queue)[0],[101,'claimed']);
 // Every advance was refused before Career ran (career_run_in_progress) while his job page's Generate wrote other jobs back
 // to back: job 101 was taken ten minutes ago, nothing started it, and another job's documents finished five minutes ago.
 const file=join(dirOf(SUB),'regenerate-queue.json'),stored=JSON.parse(readFileSync(file,'utf8'));
 stored.entries[0].claimedAt=new Date(Date.now()-10*60*1000).toISOString();writeFileSync(file,JSON.stringify(stored));
 ageReceipts(20*60*1000);setReceipt(104,{requestId:'his-page-104',phase:'ready',completedAt:new Date(Date.now()-5*60*1000).toISOString()});
 const taken=(await call('POST','/regenerate/advance',{})).json.queue;
 assert.deepEqual(taken.entries.map(entry=>[entry.postingId,entry.state,entry.attempts,entry.reason]),[[101,'claimed',1,''],[103,'queued',0,'']],'taken again as it is: no try counted, nothing ended');
 assert.equal(taken.entries[0].note,'Waiting for Career to finish what it is doing on your account.');
 const queue=await drive();
 assert.deepEqual(queue.entries.map(entry=>[entry.postingId,entry.state,entry.attempts]),[[101,'done',1],[103,'done',1]],'both written, each on its first try');
 assert.ok(!queue.entries.some(entry=>/stopped before it finished/.test(entry.reason+entry.retry)),'no job says it stopped before it finished');
 await clear();
});

test('documents take turns with Fill in several: none starts while three approved jobs wait, and they go on when fewer wait',{timeout:300000},async()=>{
 await fresh();
 const batchFile=join(dirOf(SUB),'apply-batch.json'),entry=(n,state)=>({postingId:900+n,runId:`00000000-0000-4000-8000-00000000000${n}`,state,active:false,title:'Job',company:'Co',reason:''});
 writeFileSync(batchFile,JSON.stringify({version:1,id:'00000000-0000-4000-8000-0000000000aa',state:'running',reason:'',createdAt:new Date().toISOString(),entries:[entry(1,'waiting'),entry(2,'waiting'),entry(3,'waiting')]}));
 await call('POST','/regenerate',{jobs:[103],confirmed:true});
 let queue;for(let n=0;n<4;n+=1)queue=(await call('POST','/regenerate/advance',{})).json.queue;
 assert.deepEqual(states(queue),[[103,'queued']],'nothing is taken or started while three approved jobs wait');
 assert.equal(queue.reason,'Waiting while Fill in several has 3 approved jobs to fill in; documents are written again when fewer than 3 wait.');
 const stored=JSON.parse(readFileSync(batchFile,'utf8'));stored.entries[2].state='submitted';writeFileSync(batchFile,JSON.stringify(stored));
 queue=await drive();
 assert.deepEqual(queue.entries.map(item=>[item.postingId,item.state,item.attempts]),[[103,'done',1]],'with two waiting, the job is written');
 rmSync(batchFile,{force:true});
 await clear();
});

test('his own Generate meanwhile wins; a job applied while waiting is skipped',{timeout:300000},async()=>{
 await fresh();
 await call('POST','/regenerate',{jobs:[101,102,103],confirmed:true});
 let queue=(await call('POST','/regenerate/advance',{})).json.queue;
 assert.deepEqual(states(queue)[0],[101,'claimed']);
 // His press waits only for a run that still holds his store (the case before's last job letting go), never for the queue.
 let his;for(const end=Date.now()+60000;Date.now()<end;await sleep(200)){his=await call('POST','/jobs/101/generate',{documents:true,requestId:'his-own-press-101'});if(his.status!==409||!/already running/.test(his.json.error))break;}
 assert.equal(his.status,202,'the queue holding job 101 never refuses his press: '+JSON.stringify(his.json));
 sqliteRows(modules.store.userPaths(SUB),SUB,[["UPDATE user_signals SET status='applied' WHERE posting_id=?",[102]]]);
 queue=await drive();
 assert.equal(boardOf()[101].requestId,'his-own-press-101','job 101 keeps the documents his own press made');
 assert.deepEqual(queue.entries.map(entry=>[entry.postingId,entry.state,entry.reason]),[
  [101,'skipped','You generated this job’s documents yourself after Generate again took it, so Career left them as you made them.'],
  [102,'skipped','Already applied. Career keeps a sent application’s documents as they were.'],[103,'done','']]);
 await clear();
});

test('another person sees and changes nothing of his',async()=>{
 await fresh();
 await call('POST','/regenerate',{jobs:[103],confirmed:true});
 assert.equal((await call('GET','/regenerate',undefined,OTHER)).json.queue,null);
 assert.equal((await call('POST','/regenerate/stop',{},OTHER)).status,404);
 assert.equal((await call('GET','/regenerate')).json.queue.state,'running','his queue is untouched');
 const unsigned=router.find('GET','/regenerate');let status;
 await unsigned.handler({oidc:undefined,body:{},params:{},query:{},headers:{}},{status(n){status=n;return this;},json(){return this;},setHeader(){}});
 assert.equal(status,401);
 await clear();
});
