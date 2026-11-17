/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.6 (Roger, 2026-11-16: "there are a bunch of jobs from torch technology that i want to apply for but in the my jobs initial screen the popup says that there is no information about the job"). The compiled POST /jobs/:id/details and GET /jobs/:id over a disposable invented person and a corpus built from the engine's own schema, with the kernel's egress answering from saved real public answers (tests/employer-detail-fixtures: a Torch Technologies Workday posting, Oracle Recruiting Cloud, SmartRecruiters): a Torch posting with no description is read once at the Workday address the engine reads and kept as the person's copy, which GET /jobs/:id then shows with no read; a closed, refused, unanswered or unreadable posting answers why and keeps nothing; listing text and a pasted description are never read over; a job the nightly pass marked "details needed" loses the mark once its description is kept; GET /jobs/:id?details=read reads for the view and keeps nothing. career-job-details-contract.py then holds the reader to the engine: the engine's own reader asks for the same first address, the backfill reads the same addresses and keeps the same text, and each kept copy is one the engine uses without a read.
 */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRouter,loadCompiledModules} from './helpers/career-route-harness.mjs';

const require=createRequire(import.meta.url),Database=require('../../scripts/toolchain/node_modules/better-sqlite3');
const SUB='job-details-torch-olive';
const root=mkdtempSync(join(tmpdir(),'career-job-details-')),previous=process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT=root;
after(()=>{if(previous===undefined)delete process.env.JOBHUNTER_STORE_ROOT;else process.env.JOBHUNTER_STORE_ROOT=previous;rmSync(root,{recursive:true,force:true});});

const FIXTURES=new URL('./employer-detail-fixtures/',import.meta.url),fixture=name=>readFileSync(new URL(name,FIXTURES),'utf8');
const TORCH_CXS='https://starfish.wd501.myworkdayjobs.com/wday/cxs/starfish/Careers/job/Eglin-AFB-FL/Test-Operations-Support-Lead_R2197';
const ORACLE='https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=ById;Id=%22346395%22,siteNumber=CX_45001';
const SR='https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000161629479';
const torchJob=(path)=>`https://starfish.wd501.myworkdayjobs.com/en-US/Careers/job/Eglin-AFB-FL/${path}`;
const cxs=(path)=>`https://starfish.wd501.myworkdayjobs.com/wday/cxs/starfish/Careers/job/Eglin-AFB-FL/${path}`;

/** The kernel's egress as the package sees it: answers by address from the saved answers, every call recorded. */
const reads=[];
const ANSWERS={[TORCH_CXS]:[200,fixture('workday-torch-R2197.json')],[ORACLE]:[200,fixture('oracle-eeho-us2-346395.json')],[SR]:[200,fixture('smartrecruiters-boschgroup-744000161629479.json')],
  [cxs('No-Such-Posting_R0000000')]:[404,'{"errorCode":"S21","httpStatus":404,"message":"not found"}'],[cxs('Refused-Posting_R2001')]:[403,'<html>Forbidden</html>'],
  [cxs('Busy-Posting_R2002')]:[503,'{}'],[cxs('View-Only-Posting_R2004')]:[200,fixture('workday-torch-R2197.json')]};
async function egress(url,init){
  reads.push({url,init});
  if(url===cxs('Dropped-Posting_R2003'))throw new Error('egress unavailable');
  const [status,body]=ANSWERS[url]||[404,'{}'];
  return new Response(body,{status,headers:{'content-type':'application/json'}});
}
const ctx={pool:{async query(){return {rows:[{remote_only:false}]};}},http:{fetch:egress}};
const {modules}=loadCompiledModules({board:'routes/career-board-routes.js',store:'routes/career-user-store.js'},{
  'better-sqlite3':Database,
  './career-engine-dispatch':{runCareerCliAsync:async()=>{throw new Error('tripwire: no engine run here');}},
  './career-engine-runner':{nativeRunInProgress:async()=>false},
});
const router=createRouter();
modules.board.registerCareerBoardRoutes(router,ctx);
const details=require('../lib/career-job-details.js');

const engine=readFileSync(new URL('../engine/jobhunter/db.py',import.meta.url),'utf8'),schema=name=>engine.match(new RegExp(name+'\\s*=\\s*"""([\\s\\S]*?)"""'))[1];
const paths=modules.store.userPaths(SUB);
mkdirSync(dirname(paths.corpusDb),{recursive:true});mkdirSync(paths.userDir,{recursive:true});
const MARK='{"needsDetails":1,"at":"2026-11-15T07:30:00+00:00"}';
{const corpus=new Database(paths.corpusDb);corpus.exec(schema('CORPUS_SCHEMA').replaceAll('corpus.',''));
 corpus.exec(`INSERT INTO companies(id,name,ats_type,ats_token)VALUES(635,'Torch Technologies','workday','starfish:wd501:Careers'),
  (2,'Invented Oracle Employer','oracle_orc','eeho.fa.us2.oraclecloud.com|CX_45001|careers.invented.example'),
  (3,'Invented SmartRecruiters Employer','smartrecruiters','BoschGroup'),(4,'Invented Eightfold Employer','eightfold','invented.eightfold.ai|x')`);
 const add=corpus.prepare(`INSERT INTO postings_corpus(id,company_id,ats_job_id,title,location,url,description,active,target_role,posted_date)VALUES(?,?,?,?,?,?,?,1,1,'2026-11-14')`);
 for(const [id,company,jobId,title,url,text] of [
  [10,635,'/job/Eglin-AFB-FL/Test-Operations-Support-Lead_R2197','Test Operations Support Lead',torchJob('Test-Operations-Support-Lead_R2197'),null],
  [11,635,'/job/Eglin-AFB-FL/No-Such-Posting_R0000000','Closed Posting',torchJob('No-Such-Posting_R0000000'),null],
  [12,635,'/job/Eglin-AFB-FL/Listed-Posting_R2000','Listed Posting',torchJob('Listed-Posting_R2000'),'Invented listing text for a Torch posting. '.repeat(30)],
  [13,4,'ef-13','Invented Eightfold Role','https://invented.eightfold.ai/careers/job/13',null],
  [14,635,'/job/Eglin-AFB-FL/Pasted-Posting_R2005','Pasted Posting',torchJob('Pasted-Posting_R2005'),null],
  [15,3,'744000161629479','Invented SmartRecruiters Role','https://jobs.invented.example/744000161629479',null],
  [16,2,'346395','Invented Oracle Role','https://jobs.invented.example/346395',null],
  [17,635,'/job/Eglin-AFB-FL/Refused-Posting_R2001','Refused Posting',torchJob('Refused-Posting_R2001'),null],
  [18,635,'/job/Eglin-AFB-FL/Dropped-Posting_R2003','Dropped Posting',torchJob('Dropped-Posting_R2003'),null],
  [19,635,'/job/Eglin-AFB-FL/View-Only-Posting_R2004','View Only Posting',torchJob('View-Only-Posting_R2004'),null],
  [20,635,'/job/Eglin-AFB-FL/Busy-Posting_R2002','Unanswered Posting',torchJob('Busy-Posting_R2002'),null],
 ])add.run(id,company,jobId,title,'a regional federal hub, FL',url,text);corpus.close();}
{const db=new Database(paths.userDb);db.exec(schema('USER_SCHEMA'));require('../lib/career-signal-migrations').migrate(db);
 for(const id of [10,11,12,13,14,16,17,18,19,20])db.prepare("INSERT INTO user_signals(posting_id,fit_score,status)VALUES(?,40,'new')").run(id);
 db.prepare("INSERT INTO user_signals(posting_id,fit_score,status,ai_model)VALUES(15,40,'new',?)").run(MARK);db.close();}

function call(method,path,body,sub=SUB){
  const parsed=new URL(path,'http://fixture.test'),found=router.find(method,parsed.pathname);assert.ok(found,path);
  return new Promise((resolve,reject)=>{const out={status:200};const res={headersSent:false,status(n){out.status=n;return res;},setHeader(){},json(json){res.headersSent=true;resolve({...out,json});return res;}};
    Promise.resolve(found.handler({method,oidc:{user:sub?{sub}:null},params:found.params,body,query:Object.fromEntries(parsed.searchParams),headers:{}},res)).catch(reject);});
}
const copyFile=id=>join(paths.userDir,'job-context',id+'.json');
const rowOf=id=>{const db=new Database(paths.corpusDb,{readonly:true});try{return db.prepare('SELECT * FROM postings_corpus WHERE id=?').get(id);}finally{db.close();}};
const kept=[];

test('a Torch Technologies posting with no description is read once at the Workday address the engine reads and kept as the person’s copy',async()=>{
  const before=(await call('GET','/jobs/10')).json.job;
  assert.equal(before.description,null,'the corpus holds no description for it, as on production');
  assert.equal(reads.length,0,'a plain job read never reads the posting');
  const answer=await call('POST','/jobs/10/details',{});
  assert.equal(answer.status,200,JSON.stringify(answer.json));
  assert.equal(answer.json.ok,true);
  assert.deepEqual(reads.map(r=>r.url),[TORCH_CXS],'one read, at the cxs address of that posting');
  assert.deepEqual({method:reads[0].init.method,redirect:reads[0].init.redirect,headers:reads[0].init.headers},{method:'GET',redirect:'manual',headers:{Accept:'application/json'}});
  const text=answer.json.description;
  assert.match(text,/^Torch Technologies\nThank you for your interest in employment with Torch Technologies\./,'the employer’s words, its paragraphs kept');
  assert.match(text,/\n\nTorch Technologies is seeking a hands-on Test Operations Support Lead/);
  assert.ok(!/<[a-z]|&amp;|&#64;/i.test(text),'no markup or references are left');
  assert.ok(text.includes('contact@example.com'),'a reference is read as Python reads it');
  assert.equal(answer.json.description_context.basis,'employer-detail');assert.equal(answer.json.description_context.kept,true);
  const copy=JSON.parse(readFileSync(copyFile(10),'utf8'));
  assert.deepEqual([copy.version,copy.basis,copy.truncated,copy.description],[2,'employer-detail',false,text]);
  kept.push({id:10,description:text});
  const after=(await call('GET','/jobs/10')).json.job;
  assert.equal(after.description,text,'the sheet, the Concierge and Jarvis read it from now on');
  assert.equal(after.description_context.basis,'employer-detail');
  const again=await call('POST','/jobs/10/details',{});
  assert.equal(again.json.description,text);assert.equal(reads.length,1,'a kept copy is never read again');
});

test('a closed, refused or unanswered posting, and one whose read fails in the kernel, answer why and keep nothing',async()=>{
  for(const [id,reason] of [[11,'closed'],[17,'refused'],[20,'unavailable'],[18,'unavailable']]){
    const answer=await call('POST',`/jobs/${id}/details`,{});
    assert.equal(answer.status,200);assert.deepEqual([answer.json.ok,answer.json.reason],[false,reason],String(id));
    assert.equal(answer.json.why,details.REASONS[reason]);
    assert.equal(answer.json.company,'Torch Technologies');assert.equal(answer.json.url,rowOf(id).url,'the posting the sheet links');
    assert.equal(existsSync(copyFile(id)),false,'nothing is kept for '+id);
  }
});

test('a job no reader through the kernel can read answers no-reader with no request; listing text and a pasted description are never read over',async()=>{
  const count=reads.length;
  const never=await call('POST','/jobs/13/details',{});
  assert.deepEqual([never.json.ok,never.json.reason],[false,'no-reader']);assert.equal(reads.length,count,'nothing leaves for a site Career cannot read');
  const listed=await call('POST','/jobs/12/details',{});
  assert.equal(listed.json.ok,true);assert.match(listed.json.description,/^Invented listing text/);assert.equal(reads.length,count);
  const {snapshot}=require('../lib/career-job-context.js'),crypto=require('node:crypto');
  const pasted='Invented description the person pasted from the posting. '.repeat(5).trim();
  mkdirSync(join(paths.userDir,'job-context'),{recursive:true,mode:0o700});
  const row={...rowOf(14),remote:0};
  writeFileSync(copyFile(14),JSON.stringify({version:2,snapshot:snapshot(row),description:pasted,descriptionSha256:crypto.createHash('sha256').update(pasted).digest('hex'),
    retrievedAt:'2026-11-16T10:00:00.000000Z',basis:'person-pasted',sourceChars:pasted.length,sourceBytes:Buffer.byteLength(pasted),truncated:false}),{mode:0o600});
  const own=await call('POST','/jobs/14/details',{});
  assert.equal(own.json.description,pasted);assert.equal(own.json.description_context.basis,'person-pasted');assert.equal(reads.length,count,'the person’s own text stands');
});

test('Oracle and SmartRecruiters postings read their one structured address; a job the nightly pass marked loses the mark once its description is kept',async()=>{
  const marked=(await call('GET','/jobs/15')).json.job;
  assert.equal(marked.fit_assessment.kind,'needs-details');
  for(const [id,url] of [[15,SR],[16,ORACLE]]){
    const count=reads.length,answer=await call('POST',`/jobs/${id}/details`,{});
    assert.equal(answer.json.ok,true,JSON.stringify(answer.json));assert.deepEqual(reads.slice(count).map(r=>r.url),[url]);
    assert.ok(answer.json.description.length>1000);kept.push({id,description:answer.json.description});
  }
  const job=(await call('GET','/jobs/15')).json.job;
  assert.notEqual(job.fit_assessment.kind,'needs-details','Career has its description now');assert.equal(job.details_needed,undefined);
});

test('GET /jobs/:id?details=read reads for the view and keeps nothing; without it nothing is read',async()=>{
  const count=reads.length;
  const plain=(await call('GET','/jobs/19')).json;assert.equal(plain.job.description,null);assert.equal(reads.length,count);
  const view=(await call('GET','/jobs/19?details=read')).json;
  assert.match(view.job.description,/^Torch Technologies\n/);assert.deepEqual(view.job.description_context,{...view.job.description_context,basis:'employer-detail',kept:false});
  assert.equal(reads.length,count+1);assert.equal(existsSync(copyFile(19)),false,'a read keeps nothing');
  const why=(await call('GET','/jobs/11?details=read')).json;
  assert.equal(why.job.description,null);assert.deepEqual(why.details_read,{reason:'closed',why:details.REASONS.closed});
  assert.equal((await call('GET','/jobs/10?details=read')).json.details_read,undefined,'a job with a description reads nothing');
});

test('the engine holds the reader, the backfill and the kept copies to its own reading',()=>{
  const {snapshot}=require('../lib/career-job-context.js');
  const cases=[
    {file:'workday-torch-R2197.json',posting:{ats_job_id:'/job/Eglin-AFB-FL/Test-Operations-Support-Lead_R2197',url:torchJob('Test-Operations-Support-Lead_R2197')},company:{ats_type:'workday',ats_token:'starfish:wd501:Careers'}},
    ...['oracle-jpmc-210801278.json','oracle-eeho-us2-346395.json','oracle-iawmqy-ocs-R283698.json'].map(file=>{
      const entry=JSON.parse(fixture('index.json')).fixtures.find(item=>item.file===file),site=/siteNumber=(.+)$/.exec(entry.url)[1];
      return {file,posting:{ats_job_id:entry.jobId,url:`https://jobs.invented.example/${entry.jobId}`},company:{ats_type:'oracle_orc',ats_token:`${new URL(entry.url).hostname}|${site}|careers.invented.example`}};}),
    ...['smartrecruiters-boschgroup-744000161629479.json','smartrecruiters-abbvie-3743990016859246.json','smartrecruiters-servicenow-744000161596339.json'].map(file=>{
      const entry=JSON.parse(fixture('index.json')).fixtures.find(item=>item.file===file),company=/companies\/([^/]+)\//.exec(entry.url)[1];
      return {file,posting:{ats_job_id:entry.jobId,url:`https://jobs.invented.example/${entry.jobId}`},company:{ats_type:'smartrecruiters',ats_token:company}};}),
  ].map(item=>{
    const addresses=details.detailAddresses(item.posting,item.company).map(({kind,url})=>[kind,url]);
    const described=details.describe(addresses[0][0],JSON.parse(fixture(item.file)),String(item.posting.ats_job_id));
    assert.ok(described.description,item.file);
    return {...item,addresses,description:described.description};
  });
  const addressCases=[
    ['apply link',{ats_job_id:'/job/Eglin-AFB-FL/X_R1',url:torchJob('X_R1')+'/apply'},{ats_type:'workday',ats_token:'starfish:wd501:Careers'}],
    ['another tenant’s posting under an aggregator',{ats_job_id:'a1',url:'https://acme.wd5.myworkdayjobs.com/External/job/Remote/Engineer_R9'},{ats_type:'phenom',ats_token:'x'}],
    ['a query is not a posting address',{ats_job_id:'/job/A/B_R1?x=1',url:'https://jobs.invented.example/1'},{ats_type:'workday',ats_token:'acme:wd5:External'}],
    ['a dot segment is refused',{ats_job_id:'/job/../B_R1',url:'https://jobs.invented.example/1'},{ats_type:'workday',ats_token:'acme:wd5:External'}],
    ['a token that is not three parts',{ats_job_id:'/job/A/B_R1',url:'https://jobs.invented.example/1'},{ats_type:'workday',ats_token:'acme:External'}],
    ['an Oracle host the kernel does not admit',{ats_job_id:'1',url:'https://jobs.invented.example/1'},{ats_type:'oracle_orc',ats_token:'eeho.fa.em2.oraclecloud.com|CX|x'}],
    ['a SmartRecruiters posting id that is not digits',{ats_job_id:'abc',url:'https://jobs.invented.example/1'},{ats_type:'smartrecruiters',ats_token:'acme'}],
    ['a site with no structured reader',{ats_job_id:'1',url:'https://invented.eightfold.ai/careers/job/1'},{ats_type:'eightfold',ats_token:'invented.eightfold.ai|x'}],
    ['http is not read',{ats_job_id:'/job/A/B_R1',url:'http://acme.wd5.myworkdayjobs.com/External/job/A/B_R1'},{ats_type:'icims',ats_token:'x'}],
  ].map(([name,posting,company])=>({name,posting,company,addresses:details.detailAddresses(posting,company).map(({kind,url})=>[kind,url])}));
  assert.deepEqual(addressCases[0].addresses,[['workday','https://starfish.wd501.myworkdayjobs.com/wday/cxs/starfish/Careers/job/Eglin-AFB-FL/X_R1']]);
  assert.deepEqual(addressCases[1].addresses,[['workday','https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/Remote/Engineer_R9']]);
  for(const item of addressCases.slice(2))assert.deepEqual(item.addresses,[],item.name);
  const copies=kept.map(({id,description})=>({dataDir:paths.userDir,row:{...rowOf(id),remote:0},description}));
  for(const item of copies)assert.deepEqual(snapshot(item.row),JSON.parse(readFileSync(copyFile(item.row.id),'utf8')).snapshot);
  const out=spawnSync(process.env.CAREER_PYTHON||process.env.JOBHUNTER_PYTHON||'python3',[fileURLToPath(new URL('./career-job-details-contract.py',import.meta.url))],
    {input:JSON.stringify({fixtures:cases,addressCases,copies}),encoding:'utf8',timeout:120000});
  assert.equal(out.status,0,out.stdout+out.stderr);
  assert.match(out.stderr,/Ran 3 tests[\s\S]*OK/);
});

test('the words the sheet says for each reason are the route’s',()=>{
  const page=readFileSync(new URL('../tools/career-job-lists.js',import.meta.url),'utf8');
  const sheet=JSON.parse('{'+/const READ_WHY=\{([^}]*)\}/.exec(page)[1].replace(/'([^']*)'/g,(_,text)=>JSON.stringify(text)).replace(/([{,])\s*([a-z]+):/g,'$1"$2":')+'}');
  assert.deepEqual(sheet,details.REASONS);
});
