/** CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise explicit employer links through the real owner profile engine, exact revision/Undo, generated role carry and identity-safe Word round trips over disposable records.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise real exports with explicit pinned store-toolchain libraries, without inherited NODE_PATH or sibling runtime dependencies.
 */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import Module,{createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const pkg=process.env.CAREER_HIERARCHY_PACKAGE||path.resolve(import.meta.dirname,'..');
const toolchain=createRequire(path.join(process.env.STORE_CI_TOOLCHAIN||path.join(path.dirname(pkg),'scripts/toolchain'),'package.json'));
function officeRuntime(){return{Pptx:toolchain('pptxgenjs'),word:toolchain('docx'),Excel:toolchain('exceljs'),Zip:toolchain('jszip')};}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'career-hierarchy-contract-'));after(()=>fs.rmSync(root,{recursive:true,force:true}));
const file=path.join(pkg,'bin/oshal-jobhunter.js'),cli=new Module(file);cli.filename=file;cli.paths=Module._nodeModulePaths(path.dirname(file));
cli._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.mapping=engineRuns;',file);
const office=createRequire(import.meta.url)(path.join(pkg,'tools/career-resume-office.js'));
const fixture={profile:{name:'Olive Testperson',headline:'Synthetic engineer',experience_summary:'Synthetic summary'},roles:[
 {id:'parent',title:'Principal',org:'Example Consulting',start:'2024',end:null,deliverables:['Managed consulting delivery.'],stories:[{title:'Example',story:'Synthetic evidence',bullet:'Managed consulting delivery.'}]},
 {id:'other',title:'Engineer',org:'Other Employer',start:'2024',end:null,deliverables:['Independent employer bullet.']},
 {id:'client',title:'Client Architect',org:'Example Client',start:'2024',end:null,deliverables:['Built a synthetic service.']}],skills:{}};
function store(value=fixture){const dir=fs.mkdtempSync(path.join(root,'owner-')),file=path.join(dir,'career_db.json');fs.writeFileSync(file,JSON.stringify(value,null,2));return{dir,file};}
const raw=s=>JSON.parse(fs.readFileSync(s.file));
const revision=s=>createHash('sha256').update(fs.readFileSync(s.file)).digest('hex');
function invoke(s,verb,document={}){
 const result=spawnSync(process.env.CAREER_TEST_PYTHON||'python3',cli.exports.mapping('resume',[verb])[0],{cwd:pkg,timeout:20000,encoding:'utf8',env:{...process.env,JOBHUNTER_DATA:s.dir,JOBHUNTER_CAREER_DB:s.file,PYTHONPATH:path.join(pkg,'engine'),CH_RESUME_DOC:JSON.stringify(document)}});
 assert.equal(result.error,undefined);assert.ok(result.stdout.trim(),result.stderr);return JSON.parse(result.stdout.trim());
}
const edit=(index,key,value,before='')=>({op:'set',field:'role',roleIndex:index,roleTitle:fixture.roles[index].title,key,before,value});
const patch=(s,edits,read=revision(s))=>invoke(s,'base-patch',{revision:read,edits});
const linked=()=>{const value=structuredClone(fixture);value.roles[2].parent_role_id='parent';value.roles[0].engagements_heading='Selected Client Engagements';return value;};
function python(script,input){
 const r=spawnSync(process.env.CAREER_TEST_PYTHON||'python3',['-c',script],{cwd:pkg,encoding:'utf8',timeout:20000,input:JSON.stringify(input),env:{...process.env,PYTHONPATH:path.join(pkg,'engine')}});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}

test('one explicit link and optional heading preserve every independent record and Undo exact bytes',()=>{
 const s=store(),before=fs.readFileSync(s.file),read=revision(s);
 const answer=patch(s,[edit(2,'parent_role_id','parent'),edit(0,'engagements_heading','Selected Client Engagements')]);
 assert.equal(answer.ok,true,JSON.stringify(answer));assert.deepEqual(raw(s),linked());
 const doc=invoke(s,'base');assert.equal(doc.resume.experience[2].id,'client');assert.equal(doc.resume.experience[2].parent_role_id,'parent');
 const overview=invoke(s,'base-section',{field:'overview'});assert.equal(overview.items[2].value.parent_role_id,'parent');assert.equal(overview.items[1].value.id,'other');
 const undo=invoke(s,'base-undo',{revision:answer.revision,restore:read});assert.equal(undo.ok,true);assert.deepEqual(fs.readFileSync(s.file),before);
});

test('invalid self, cycle, missing or child parent and parent removal never publish partial changes',()=>{
 for(const edits of [[edit(2,'parent_role_id','client')],[edit(2,'parent_role_id','missing')],
  [edit(0,'parent_role_id','client')],[edit(1,'parent_role_id','client')],
  [{op:'remove',field:'role',roleIndex:0,roleTitle:'Principal',before:'Principal'}]]){
  const s=store(linked()),before=fs.readFileSync(s.file),answer=patch(s,edits);
  assert.equal(answer.ok,false,JSON.stringify(edits));assert.deepEqual(fs.readFileSync(s.file),before);
 }
 const duplicate=linked();duplicate.roles[1].id='parent';const s=store(duplicate),before=fs.readFileSync(s.file);
 assert.equal(patch(s,[edit(2,'parent_role_id','other','parent')]).ok,false);assert.deepEqual(fs.readFileSync(s.file),before);
});

test('unlinking is explicit and a stale relationship write cannot rebase onto newer work history',()=>{
 const s=store(linked()),old=revision(s);
 assert.equal(patch(s,[edit(2,'parent_role_id','','parent')]).ok,true);assert.equal(raw(s).roles[2].parent_role_id,undefined);
 const before=fs.readFileSync(s.file),stale=patch(s,[edit(2,'parent_role_id','parent')],old);
 assert.equal(stale.ok,false);assert.equal(stale.error,'master_changed');assert.deepEqual(fs.readFileSync(s.file),before);
});

test('a legacy no-ID parent gains identity only in its explicit relationship write',()=>{
 const value=structuredClone(fixture);delete value.roles[0].id;delete value.roles[2].id;
 const s=store(value),before=fs.readFileSync(s.file);invoke(s,'base');assert.deepEqual(fs.readFileSync(s.file),before,'GET does not migrate');
 const answer=patch(s,[edit(2,'parent_role_id','@index:0')]);assert.equal(answer.ok,true,JSON.stringify(answer));
 const saved=raw(s);assert.ok(saved.roles[0].id);assert.equal(saved.roles[2].parent_role_id,saved.roles[0].id);assert.ok(saved.roles[2].id);
 assert.deepEqual(saved.roles.map(({id,parent_role_id,...role})=>role),value.roles.map(({id,...role})=>role));assert.equal(saved.roles[1].id,'other');
});

test('grouped Word order maps an edited child back to its exact original record despite shared dates',()=>{
 const s=store(linked()),base=invoke(s,'base'),model=office.resumeToModel(base.resume,base.meta,base.revision);
 const heads=model.pages[0].blocks.filter(b=>b.style==='heading2').slice(1);
 assert.deepEqual(heads.map(b=>b.id),['parent','client','other']);
 assert.equal(heads[1].indentLeft,18);assert.equal(heads[0].indentLeft,undefined);
 const child=model.pages[0].blocks.find(b=>b.runs?.[0]?.text==='Built a synthetic service.');assert.equal(child.indentLeft,30.6);child.runs[0].text='Changed only this child bullet.';
 const mapped=office.modelToResume(model,base.resume);assert.equal(mapped.error,undefined);assert.equal(mapped.resume.experience[2].bullets[0],'Changed only this child bullet.');
 assert.deepEqual(mapped.resume.experience.slice(0,2),base.resume.experience.slice(0,2));
 const saved=invoke(s,'base-save',{resume:mapped.resume});assert.equal(saved.ok,true,JSON.stringify(saved));
 const expected=linked();expected.roles[2].deliverables=['Changed only this child bullet.'];assert.deepEqual(raw(s),expected);
 const again=office.resumeToModel(invoke(s,'base').resume,base.meta);assert.equal(again.pages[0].blocks.find(b=>b.id==='client').indentLeft,18,'no accumulated indentation');
});

test('a replaced or duplicate stable ID never falls back to same dates, title or identical bullets',()=>{
 const s=store(linked()),base=invoke(s,'base'),model=office.resumeToModel(base.resume,base.meta,base.revision);
 const replacement=structuredClone(base.resume);replacement.experience[2].id='replacement';
 assert.match(office.modelToResume(model,replacement).error,/identity/);
 const duplicate=structuredClone(base.resume);duplicate.experience[1].id='client';assert.match(office.modelToResume(model,duplicate).error,/identity/);
});

test('stable identity merges a child edit across a move and rename without changing the unrelated role',()=>{
 const s=store(linked()),base=invoke(s,'base').resume,model=office.resumeToModel(base,{},'a'.repeat(64));
 model.pages[0].blocks.find(b=>b.runs?.[0]?.text==='Built a synthetic service.').runs[0].text='Typed child achievement.';
 const current=structuredClone(base);current.experience=[current.experience[2],current.experience[0],current.experience[1]];current.experience[0].title='Renamed Client Architect';
 const result=office.reconcile(model,current,base);assert.equal(result.state,'typed');assert.equal(result.resume.experience[0].id,'client');
 assert.equal(result.resume.experience[0].bullets[0],'Typed child achievement.');assert.deepEqual(result.resume.experience[2],current.experience[2]);
});

test('new required client roles carry their recorded employer and group without rewriting source facts',()=>{
 const value=linked();value.roles[0].start='1999';value.roles[0].end='2000';
 const result=python('import json,sys\nfrom jobhunter import role_plan\np=json.load(sys.stdin)\ne=role_plan.plan(p)\nr={"experience":[]}\nrole_plan.carry(r,e,p)\nprint(json.dumps(r))',value);
 assert.deepEqual(result.experience.map(r=>r.id),['other','parent','client']);assert.equal(result.experience[2].parent_role_id,'parent');
 assert.equal(result.experience[1].span,'1999 to 2000');assert.equal(result.experience[2].group_heading,'Selected Client Engagements');assert.deepEqual(value.roles[2].deliverables,fixture.roles[2].deliverables);
});


test('a model role key cannot assign recorded identity to unrelated or ambiguous prose',()=>{
 const program='import json,sys\nfrom jobhunter import role_plan\np=json.load(sys.stdin)\nr=p.pop("model")\ne=role_plan.plan(p)\nrole_plan.carry(r,e,p)\nprint(json.dumps(r))';
 for(const item of [{role:'R3',title:'Unrelated',org:'Elsewhere',id:'client',parent_role_id:'parent',bullets:['Unrelated prose.']},
  {role:'R2',title:'Client Architect',org:'Example Client',bullets:['Wrong named key.']}]){
  const value=linked();value.model={experience:[item]};const result=python(program,value);
  assert.equal(result.experience.filter(role=>role.id==='client').length,1);
  assert.equal(result.experience.filter(role=>role.id==='parent').length,1);
  const unrelated=result.experience.find(role=>role.bullets?.includes(item.bullets[0]));
  assert.equal(unrelated.id,undefined);assert.equal(unrelated.parent_role_id,undefined);
  assert.equal(result.experience.find(role=>role.id==='client').title,'Client Architect');
  assert.deepEqual(result.experience.find(role=>role.id==='client').bullets,['Built a synthetic service.']);
 }
 const ambiguous=linked();ambiguous.roles[1].title='Client Architect';ambiguous.roles[1].org='Example Client';
 ambiguous.model={experience:[{title:'Client Architect',org:'Example Client',bullets:['Ambiguous generated prose.']}]};
 const result=python(program,ambiguous);assert.equal(result.experience.filter(role=>role.id==='client').length,1);
 assert.equal(result.experience.filter(role=>role.id==='other').length,1);assert.equal(result.experience.find(role=>role.bullets?.includes('Ambiguous generated prose.')).id,undefined);
});


test('the actual grouped Career model exports as readable DOCX, PDF and text with independent dates and bullets',async()=>{
 const s=store(linked()),base=invoke(s,'base'),model=office.resumeToModel(base.resume,base.meta,base.revision);
 const formats=await import(pathToFileURL(path.join(path.dirname(pkg),'presentations/routes/office-editor/formats.mjs')));
 const runtime=officeRuntime(),docx=await formats.renderOffice(model,'docx',runtime);
 const zip=await runtime.Zip.loadAsync(docx),xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/w:left="360"/);assert.match(xml,/w:left="612"/);assert.match(xml,/w:keepNext/);assert.match(xml,/w:jc w:val="right"/);
 const embedded=await formats.embeddedModel(zip);assert.deepEqual(office.modelToResume(embedded,base.resume).resume,base.resume);
 const text=(await formats.renderOffice(model,'txt',runtime)).toString();
 assert.ok(text.indexOf('Principal')<text.indexOf('Client Architect'));assert.ok(text.indexOf('Client Architect')<text.indexOf('Engineer'));
 assert.match(text,/\n   Client Architect/);assert.match(text,/\n   - Built a synthetic service\./);
 assert.equal(text.split(base.resume.experience[0].span).length-1,3,'each independent recorded date remains');
 const pdf=await formats.renderOffice(model,'pdf',runtime);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 if(process.env.CAREER_HIERARCHY_PROOF_DIR){fs.writeFileSync(path.join(process.env.CAREER_HIERARCHY_PROOF_DIR,'grouped.docx'),docx);fs.writeFileSync(path.join(process.env.CAREER_HIERARCHY_PROOF_DIR,'grouped.txt'),text);fs.writeFileSync(path.join(process.env.CAREER_HIERARCHY_PROOF_DIR,'grouped-office.pdf'),pdf);}
});


test('legacy parent references stay bound to the original card across moves, insertions and removals',()=>{
 const move={op:'move',field:'role',roleIndex:0,roleTitle:'Principal',before:'Principal',to:1};
 const add=[{op:'add',field:'role',index:0,before:'',value:'New Job'},
  {op:'set',field:'role',roleIndex:0,roleTitle:'New Job',key:'org',before:'',value:'New Employer'},
  {op:'set',field:'role',roleIndex:0,roleTitle:'New Job',key:'start',before:'',value:'2025'}];
 for(const earlier of [[move],add]){
  const value=structuredClone(fixture);value.roles.forEach(role=>delete role.id);const s=store(value);
  const answer=patch(s,[...earlier,edit(2,'parent_role_id','@index:0')]);assert.equal(answer.ok,true,JSON.stringify(answer));
  const roles=raw(s).roles,parent=roles.find(role=>role.title==='Principal'),child=roles.find(role=>role.title==='Client Architect');
  assert.ok(parent.id);assert.equal(child.parent_role_id,parent.id);assert.equal(parent.org,'Example Consulting');
  assert.deepEqual(child.deliverables,fixture.roles[2].deliverables);
 }
 const value=structuredClone(fixture);value.roles.forEach(role=>delete role.id);const s=store(value),before=fs.readFileSync(s.file);
 const removed=patch(s,[{op:'remove',field:'role',roleIndex:0,roleTitle:'Principal',before:'Principal'},edit(2,'parent_role_id','@index:0')]);
 assert.equal(removed.ok,false);assert.deepEqual(fs.readFileSync(s.file),before,'removing the original parent refuses atomically');
});


test('an empty employer ends its keep chain before the next independent job in the actual DOCX',async()=>{
 const value=linked();value.roles[0].deliverables=[];const s=store(value),base=invoke(s,'base');
 const model=office.resumeToModel(base.resume,base.meta,base.revision),blocks=model.pages[0].blocks;
 const parent=blocks.findIndex(block=>block.id==='parent');assert.equal(blocks[parent].keepWithNext,true);assert.equal(blocks[parent+1].keepWithNext,false);
 const formats=await import(pathToFileURL(path.join(path.dirname(pkg),'presentations/routes/office-editor/formats.mjs'))),runtime=officeRuntime();
 const zip=await runtime.Zip.loadAsync(await formats.renderOffice(model,'docx',runtime)),xml=await zip.file('word/document.xml').async('string');
 const date=xml.split('</w:p>').find(part=>part.includes(base.resume.experience[0].span));assert.match(date,/<w:keepNext w:val="false"\/>/);
});
