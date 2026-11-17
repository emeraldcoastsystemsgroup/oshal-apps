/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "my cover letter pulls from my first development job ... and lies about my level of expertise on c# ... the cover letter is not acceptable"): the letter-truth guard on made-up candidates. (1) The engine contract (tests/career-letter-truth-contract.py): ranking, prompts, the claims check and the REAL generate_for and prepare_job against a scripted model that overclaims. (2) lib/career-letter-claims.js takes the engine's fingerprint of a letter (parity with claims_fix.digest). (3) A letter the check marked needs your review is not ready: the application view names the problems, assertReady refuses sending in those words, an automatic preparation holds it, and only an edit of the letter or the person's confirmation (bound to that letter) clears it; a fixed letter lists what Career took out; a submitted application is left alone.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const claims=require('../lib/career-letter-claims'),draft=require('../lib/career-application-draft'),workflow=require('../lib/career-application-workflow'),board=require('../lib/career-board-state');
const PYTHON=process.env.CAREER_PYTHON||'python3',ENGINE=fileURLToPath(new URL('../engine',import.meta.url));
const PROFILE={profile:{name:'Sample Candidate'},roles:[{title:'Field Automation Engineer (contract)',org:'Gulf Coast Refining',start:'2025-06',end:'2025-10',deliverables:['Commissioned PLC and SCADA upgrades']}]};
const RESUME={experience:[{title:'Field Automation Engineer (contract)',org:'Gulf Coast Refining',span:'2025',bullets:['Commissioned PLC and SCADA upgrades']}]};
const COVER={greeting:'Dear Hiring Manager,',paragraphs:['Most recently I commissioned PLC and SCADA upgrades at Gulf Coast Refining.','Could we talk? — it is “quoted” ünïcode.'],closing:'Sincerely,'};
const PROBLEMS=[{document:'cover',kind:'skill',claim:'C#',action:'removed',words:'The cover letter named C#; your records do not mention it. Career took it out.'},
 {document:'cover',kind:'level',claim:'expert C#',action:'removed',words:'The cover letter claimed “expert C#”; your records do not state that level. Career took it out.'}];

test('the engine contract: letters draw on the right work and claim only what the records support, whichever model writes them',()=>{
 const run=spawnSync(PYTHON,[fileURLToPath(new URL('./career-letter-truth-contract.py',import.meta.url))],{encoding:'utf8',timeout:240000});
 assert.equal(run.status,0,run.stderr+run.stdout);
 assert.deepEqual(JSON.parse(run.stdout.trim().split('\n').pop()),{checks:58,failed:[]});
});

test('lib/career-letter-claims.js and the engine take one fingerprint of a letter',()=>{
 const program=['import json,sys',`sys.path.insert(0,${JSON.stringify(ENGINE)})`,'from jobhunter import claims_fix','print(claims_fix.digest(json.load(sys.stdin)))'].join('\n');
 const run=spawnSync(PYTHON,['-c',program],{encoding:'utf8',input:JSON.stringify(COVER),timeout:60000});
 assert.equal(run.status,0,run.stderr);
 assert.equal(claims.digest(COVER),run.stdout.trim());
});

/** One owner store with a prepared packet whose letter the check judged `status`. */
function store(t,status,{applied=false,flow=null}={}){
 const dir=mkdtempSync(join(tmpdir(),'career-truth-draft-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'career_db.json'),JSON.stringify(PROFILE));
 const folder=join(dir,'applications','Target-Co__81');mkdirSync(folder,{recursive:true});
 const receipt={version:1,status,regenerated:status!=='clean',problems:status==='clean'?[]:PROBLEMS,
  review:status==='needs_review'?['The cover letter is too short to send after Career took out what your records do not support. Edit it, or add what is true to your main résumé and generate it again.']:[],
  letter_evidence:['R1'],letter_draws_on:['R1'],cover_digest:claims.digest(COVER)};
 writeFileSync(join(folder,'application.json'),JSON.stringify({posting_id:81,generated:{resume:RESUME,cover:COVER},claims_check:receipt}));
 for(const name of ['Resume_ATS.pdf','CoverLetter.pdf'])writeFileSync(join(folder,name),'%PDF-sample');
 if(flow)board.updateBoardState(dir,81,{workflow:flow,phase:'ready',requestId:'r1',completedAt:new Date().toISOString()});
 return {dir,folder,job:{status:applied?'applied':'generated',has_resume:1,has_cover:1,resume_path:join(folder,'Resume_ATS.pdf'),cover_path:join(folder,'CoverLetter.pdf'),url:'https://example.invalid/81',active:1}};
}

test('a letter the check marked needs your review is not ready, names its problems, and refuses sending',t=>{
 const {dir,job}=store(t,'needs_review');
 const view=draft.view(dir,81,job);
 assert.equal(view.claims.needsReview,true);
 assert.match(view.claims.notice,/^Your cover letter needs your review before you send it\. The cover letter is too short to send/);
 assert.match(view.claims.notice,/named C#; your records do not mention it/);
 assert.equal(view.needsGeneration,false,'the person can review, edit or confirm without generating again');
 assert.throws(()=>draft.assertReady(dir,81,job),error=>error.code==='documents_need_review'&&/needs your review/.test(error.message)&&/Edit the cover letter, or confirm you checked it/.test(error.message));
});

test('the person clears it by confirming that exact letter, or by editing it; a stale confirmation is refused',t=>{
 const {dir,folder,job}=store(t,'needs_review');
 assert.throws(()=>draft.confirmClaims(dir,81,job,'0'.repeat(64)),error=>error.code==='claims_changed');
 const confirmed=workflow.review(dir,81,job,{claims:claims.digest(COVER)});
 assert.equal(confirmed.application.claims.needsReview,false);
 assert.doesNotThrow(()=>draft.assertReady(dir,81,job));
 assert.throws(()=>draft.confirmClaims(dir,81,job,claims.digest(COVER)),error=>error.code==='claims_not_pending');
 const other=store(t,'needs_review'),record=JSON.parse(readFileSync(join(other.folder,'application.json'),'utf8'));
 record.generated.cover.paragraphs=['I rewrote this letter myself, and it says only what is true about my field work.'];
 writeFileSync(join(other.folder,'application.json'),JSON.stringify(record));
 assert.equal(draft.view(other.dir,81,other.job).claims.needsReview,false,'an edited letter is the person\'s own');
 assert.ok(folder);
});

test('automatic preparation never marks a letter that needs review ready',t=>{
 const {dir,job}=store(t,'needs_review',{flow:{enabled:true,mode:'automatic'}});
 const view=draft.view(dir,81,job);
 assert.equal(view.workflow.ready,false);
 assert.match(view.workflow.reason,/needs your review/);
});

test('a fixed letter lists what Career took out; a clean one and a submitted application say nothing',t=>{
 const fixed=store(t,'fixed'),view=draft.view(fixed.dir,81,fixed.job);
 assert.equal(view.claims.needsReview,false);
 assert.match(view.claims.fixed,/^Career checked these documents against your records\. The cover letter named C#/);
 assert.doesNotThrow(()=>draft.assertReady(fixed.dir,81,fixed.job));
 const clean=store(t,'clean');
 assert.equal(draft.view(clean.dir,81,clean.job).claims.fixed,'');
 const applied=store(t,'needs_review',{applied:true});
 assert.equal(draft.view(applied.dir,81,applied.job).claims,null,'a submitted application keeps its documents as the record');
 const many=claims.state({generated:{cover:COVER},claims_check:{status:'fixed',cover_digest:claims.digest(COVER),
  problems:Array.from({length:7},(_,n)=>({words:`Problem ${n+1}.`}))}},undefined);
 assert.equal(many.fixed,'Career checked these documents against your records. Problem 1. Problem 2. Problem 3. Problem 4. (3 more.)');
 assert.equal(claims.state({generated:{cover:COVER}},undefined),null,'a packet made before the check reads as before');
});
