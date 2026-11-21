/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.3 (Roger, 2026-11-16: "it would leave out my active role 'Co-Founder / Principal ...' which is clearly labeled on my main resume"): the current-role guard on made-up candidates. (1) The engine contract (tests/career-resume-roles-contract.py): the prompt carries the whole profile past every suspected limit and lists the roles to carry, current first, and the real generate_for and prepare_job write that role first when a scripted model leaves it out, as production's did. (2) lib/career-resume-roles.js and the engine's role_plan.py give one answer on the same profiles (parity). (3) A résumé prepared before the check that leaves the current role out is not ready: the application draft names the role, asks for generation and refuses review and sending in words that name it; a résumé that carries it, and a submitted application, are left alone.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve recorded month/year precision in role plans and pure saved-packet date restoration without inventing dates or assigning ambiguous employers one period.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.69.1: the engine contract has 38 checks (a role or client engagement whose record has " - " is written once, through the reviewer's revision).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url),roles=require('../lib/career-resume-roles'),draft=require('../lib/career-application-draft'),bank=require('../lib/career-experience-bank');
const PYTHON=process.env.CAREER_PYTHON||'python3',ENGINE=fileURLToPath(new URL('../engine',import.meta.url));
const NOW=new Date('2026-11-16T12:00:00Z');
const CURRENT={title:'Co-Founder / Principal',org:'Harbor Light Systems'};
const PROFILE={profile:{name:'Sample Candidate'},roles:[
 {id:'r13',title:CURRENT.title,org:CURRENT.org,start:'2024-02',end:null,deliverables:['Won two paying pilot customers']},
 {title:'Board Advisor',org:'North Pier Labs',start:'Jun 2023',end:'Present',deliverables:['Advised the founders']},
 {title:'Program Director',org:'Cedar Analytics',start:'01/2022',end:'2023-12-01',deliverables:['Ran a program']},
 {title:'Platform Director',org:'Bluewater Corp',start:'2018',end:'2021',deliverables:['Led the platform org']},
 {title:'Operations Manager',org:'Bluewater Corp',start:'2015-01',end:'2018-02',deliverables:['Ran operations']},
 {title:'Engineer',org:'Old Mill Co',start:'1998',end:'2003',deliverables:['Built things']},
 {title:'Volunteer Coach',org:'',start:'2019',end:'current'},'not a role',{title:'',org:''}]};
const LEFT_OUT={experience:[{title:'Platform Director',org:'Bluewater Corp',span:'2018 to 2021',bullets:['Led']},{title:'Early career',org:'',span:'',bullets:[]}]};
const CARRIED={experience:[{title:CURRENT.title,org:'Harbor Light Systems, LLC',span:'2024 to Present',bullets:['Won']},
 {title:'Board Advisor',org:'north pier labs',span:'2023 to Present'},{title:'Volunteer Coach',org:'',span:'2019 to Present'},
 {title:'Director',org:'Cedar Analytics Inc.',span:'2022 to 2023'},{title:'Operations Manager',org:'Bluewater Corp',span:'2015 to 2021'}]};

test('the engine contract: the prompt lists the roles to carry and every generated résumé carries the current role first',()=>{
 const run=spawnSync(PYTHON,[fileURLToPath(new URL('./career-resume-roles-contract.py',import.meta.url))],{encoding:'utf8',timeout:120000});
 assert.equal(run.status,0,run.stderr+run.stdout);
 assert.deepEqual(JSON.parse(run.stdout.trim().split('\n').pop()),{checks:38,failed:[]});
});

test('which roles a résumé must carry: current first, ended within 20 years, most recent first',()=>{
 const plan=roles.plan(PROFILE,NOW);
 assert.deepEqual(plan.map(e=>[e.key,e.current,e.required,e.span]),[['R1',true,true,'Feb 2024 to Present'],['R2',true,true,'Jun 2023 to Present'],
  ['R7',true,true,'2019 to Present'],['R3',false,true,'Jan 2022 to Dec 2023'],['R4',false,true,'2018 to 2021'],['R5',false,true,'Jan 2015 to Feb 2018'],['R6',false,false,'1998 to 2003']]);
 assert.deepEqual(roles.missing(LEFT_OUT,plan).map(e=>e.key),['R1','R2','R7','R3'],'one entry at an employer carries every ended role there');
 assert.deepEqual(roles.missing(CARRIED,plan),[],'case, punctuation and company suffixes aside, the employer carries the role');
 const older={experience:[{title:'Advisor',org:'Harbor Light Systems',span:'2020 to 2021'}]};
 assert.ok(roles.missing(older,plan).some(e=>e.key==='R1'),'an older job at the current employer never stands in for the current role');
 assert.equal(roles.sentence([{...CURRENT,current:true}]),'This résumé leaves out your current role: Co-Founder / Principal at Harbor Light Systems.');
});

test('lib/career-resume-roles.js and the engine\'s role_plan.py give one answer',()=>{
 const reversed={...PROFILE,roles:[...PROFILE.roles].reverse()};
 const cases=[[PROFILE,LEFT_OUT],[PROFILE,CARRIED],[reversed,LEFT_OUT],[{roles:[{title:'Lead',org:'Acme',start:'Sept 2010',end:'05/2012'},{title:'Lead',org:'Acme',start:'2012',end:'now'}]},{experience:[{title:'Lead',org:'Acme',span:'2010 to 2012'}]}],[{},{}]];
 const program=['import json,sys,datetime',`sys.path.insert(0,${JSON.stringify(ENGINE)})`,'from jobhunter import role_plan','out=[]',
  'for prof,resume in json.load(sys.stdin):',
  ' plan=role_plan.plan(prof,datetime.date(2026,11,16))',
  ' out.append({"plan":[[e[k] for k in ("key","title","org","span","current","required")] for e in plan],"missing":[e["key"] for e in role_plan.missing(resume,plan)]})',
  'print(json.dumps(out))'].join('\n');
 const run=spawnSync(PYTHON,['-c',program],{encoding:'utf8',input:JSON.stringify(cases),timeout:60000});
 assert.equal(run.status,0,run.stderr);
 const js=cases.map(([prof,resume])=>{const plan=roles.plan(prof,NOW);return {plan:plan.map(e=>[e.key,e.title,e.org,e.span,e.current,e.required]),missing:roles.missing(resume,plan).map(e=>e.key)};});
 assert.deepEqual(js,JSON.parse(run.stdout));
});

test('recorded month precision survives numeric and named dates without assigning a month to a bare year',()=>{
 const records=[['2024-02',null,'Feb 2024 to Present'],['02/2024','2024-11','Feb 2024 to Nov 2024'],
  ['February 2024','Nov. 2025','Feb 2024 to Nov 2025'],['2024','2025','2024 to 2025'],['2024','2024','2024']];
 for(const[start,end,expected]of records){const entry=roles.plan({roles:[{title:'Engineer',org:'Example',start,end}]},NOW)[0];assert.equal(entry.span,expected);}
});

test('saved packet date restoration clones only uniquely anchored dates and keeps hierarchy and year-only precision',()=>{
 const profile={roles:[{id:'parent',title:'Principal',org:'Example',start:'2020-03',end:null},
  {id:'child',title:'Architect',org:'Client',start:'2024-02',end:'2024-11',parent_role_id:'parent'},
  {title:'Analyst',org:'Earlier',start:'2017',end:'2019'}]};
 const resume={summary:'Keep this prose',experience:[{id:'parent',title:'Principal',org:'Example',span:'2020 to Present',bullets:['Employer evidence']},
  {id:'child',title:'Architect',org:'Client',span:'2024',parent_role_id:'parent',bullets:['Client evidence']},
  {title:'Analyst',org:'Earlier',span:'2017 to 2019',bullets:[]}]},before=structuredClone(resume);
 const result=roles.preserveDates(resume,profile);
 assert.deepEqual(result.resume.experience.map(role=>role.span),['Mar 2020 to Present','Feb 2024 to Nov 2024','2017 to 2019']);
 assert.deepEqual(result.dates,{known:[0,1,2],updated:[0,1],ambiguous:[],unavailable:[]});assert.deepEqual(resume,before);
 const expected=structuredClone(before);expected.experience[0].span='Mar 2020 to Present';expected.experience[1].span='Feb 2024 to Nov 2024';assert.deepEqual(result.resume,expected);
});

test('saved packet date restoration refuses ambiguous merged roles, foreign IDs and absent snapshot dates',()=>{
 const profile={roles:[{id:'first',title:'Engineer',org:'Example',start:'2019-02',end:'2020-03'},
  {id:'second',title:'Engineer',org:'Example',start:'2021-04',end:'2022-05'},
  {id:'none',title:'Undated',org:'Other',start:'not recorded',end:'unknown'}]};
 const merged={experience:[{title:'Engineer',org:'Example',span:'2019 to 2022'}]};
 const ambiguous=roles.preserveDates(merged,profile);assert.deepEqual(ambiguous.resume,merged);assert.deepEqual(ambiguous.dates.ambiguous,[0]);
 const pinned=roles.preserveDates({experience:[{id:'second',title:'Engineer',org:'Example',span:'2021 to 2022'}]},profile);
 assert.equal(pinned.resume.experience[0].span,'Apr 2021 to May 2022');
 for(const row of[{id:'foreign',title:'Engineer',org:'Example',span:'2019 to 2022'},
  {id:'first',title:'Different title',org:'Example',span:'2019 to 2022'},
  {id:'none',title:'Undated',org:'Other',span:'Unknown dates'}]){
  const original={experience:[row]},result=roles.preserveDates(original,profile);assert.deepEqual(result.resume,original);assert.deepEqual(result.dates.unavailable,[0]);
 }
 const absent=roles.preserveDates(merged,null);assert.deepEqual(absent.resume,merged);assert.deepEqual(absent.dates.unavailable,[0]);
});


test('saved packet date restoration preserves both endpoints when snapshot dates are incomplete',()=>{
 const values=[{start:null,end:'2016-07'},{start:'2010-02',end:'unreadable'},
  {start:'not recorded',end:null},{start:'2010-02',end:null}];
 for(const [index,dates]of values.entries()){
  const packet={experience:[{title:'Engineer',org:'Example',span:'2010 to 2016'}]};
  const result=roles.preserveDates(packet,{roles:[{title:'Engineer',org:'Example',...dates}]});
  if(index===3){assert.equal(result.resume.experience[0].span,'Feb 2010 to Present');assert.deepEqual(result.dates.known,[0]);}
  else{assert.deepEqual(result.resume,packet);assert.deepEqual(result.dates.unavailable,[0]);assert.deepEqual(result.dates.known,[]);}
 }
});

function store(t,resume,{status='generated',foreignPath=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'career-roles-draft-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'career_db.json'),JSON.stringify(PROFILE));
 const folder=join(dir,'applications','Target-Co__81');mkdirSync(folder,{recursive:true});
 writeFileSync(join(folder,'application.json'),JSON.stringify({posting_id:81,generated:{resume,cover:{}}}));
 for(const name of ['Resume_ATS.pdf','CoverLetter.pdf'])writeFileSync(join(folder,name),'%PDF-sample');
 const resumePath=foreignPath?'/career/default/another-runtime/applications/Target-Co__81/Resume_ATS.pdf':join(folder,'Resume_ATS.pdf');
 return {dir,job:{status,has_resume:1,has_cover:1,resume_path:resumePath,cover_path:join(folder,'CoverLetter.pdf')}};
}

test('a résumé prepared before the check that leaves the current role out is not ready, and says which role',t=>{
 for(const foreignPath of [false,true]){
  const {dir,job}=store(t,LEFT_OUT,{foreignPath});
  const view=draft.view(dir,81,job);
  assert.equal(view.needsGeneration,true,'Prepare application opens on Tailor with Generate');
  assert.deepEqual(view.missingRoles.slice(0,1),[{...CURRENT,current:true}]);
  assert.match(view.rolesNotice,/^This résumé leaves out roles from your work history, your current role among them: Co-Founder \/ Principal at Harbor Light Systems/);
  assert.throws(()=>draft.assertReady(dir,81,job),error=>error.code==='documents_outdated'&&/Co-Founder \/ Principal at Harbor Light Systems/.test(error.message)&&/Generate résumé & cover letter again/.test(error.message));
  assert.throws(()=>draft.assertReady(dir,81,{status:job.status,has_resume:1,has_cover:1}),/Harbor Light Systems/,'the send step, which passes no résumé path, finds the job\'s own packet');
 }
});

test('a résumé that carries every required role, and a submitted application, are left alone',t=>{
 const carried=store(t,CARRIED);
 assert.deepEqual(draft.view(carried.dir,81,carried.job).missingRoles,[]);
 const applied=store(t,LEFT_OUT,{status:'applied'});
 assert.deepEqual(draft.view(applied.dir,81,applied.job).missingRoles,[],'a submitted application keeps its documents as the record');
 const none=store(t,LEFT_OUT);writeFileSync(join(none.dir,'career_db.json'),JSON.stringify({profile:{},roles:[]}));
 assert.deepEqual(draft.view(none.dir,81,none.job).missingRoles,[],'a main résumé with no roles asks nothing');
 assert.equal(bank.read(none.dir).entries.length,0);
});
