/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve uniquely recorded month/year dates through the real generation date policy, Career Word model and actual DOCX, PDF and RTF exports on synthetic records.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retain the exact synthetic model and format bytes in an explicitly requested proof directory without changing export assertions.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),roles=require('../lib/career-resume-roles.js'),office=require('../tools/career-resume-office.js');
const ROOT=path.resolve(import.meta.dirname,'..');
const SNAPSHOT={roles:[
 {id:'parent',title:'Principal',org:'Example Consulting',start:'2020-03',end:null},
 {id:'child',title:'Architect',org:'Client Example',start:'2024-02',end:'2024-11',parent_role_id:'parent'},
 {id:'earlier',title:'Analyst',org:'Earlier Example',start:'2017',end:'2019'}]};
const PACKET={headline:'Synthetic candidate',summary:'Synthetic facts only.',experience:[
 {id:'parent',title:'Principal',org:'Example Consulting',span:'2020 to Present',bullets:['Employer evidence.']},
 {id:'child',title:'Architect',org:'Client Example',span:'2024',parent_role_id:'parent',bullets:['Independent child evidence.']},
 {id:'earlier',title:'Analyst',org:'Earlier Example',span:'2017 to 2019',bullets:['Earlier evidence.']}]};
const EXPECTED=['Mar 2020 to Present','Feb 2024 to Nov 2024','2017 to 2019'];

function generatedPolicy(){
 const program=['import sys,json,datetime',`sys.path.insert(0,${JSON.stringify(path.join(ROOT,'engine'))})`,
  'from jobhunter import role_plan','profile,resume=json.load(sys.stdin)',
  'role_plan.carry(resume,role_plan.plan(profile,datetime.date(2026,11,17)),profile)',
  'print(json.dumps(resume))'].join('\n');
 const run=spawnSync(process.env.CAREER_PYTHON||'python3',['-c',program],{
  input:JSON.stringify([SNAPSHOT,PACKET]),encoding:'utf8',timeout:10000});
 assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);
}

test('date policy preserves the same recorded months in actual generated and saved-packet DOCX PDF RTF models',async()=>{
 const generated=generatedPolicy();assert.deepEqual(generated.experience.map(role=>role.span),EXPECTED);
 const before=structuredClone(PACKET),preserved=roles.preserveDates(PACKET,SNAPSHOT);
 assert.deepEqual(preserved.resume.experience.map(role=>role.span),EXPECTED);assert.deepEqual(PACKET,before);
 const source=office.resumeToModel(preserved.resume,{name:'Synthetic date fixture'},'a'.repeat(64));
 const strings=source.pages.flatMap(page=>page.blocks).filter(block=>block.type==='paragraph').map(block=>block.runs.map(run=>run.text).join(''));
 for(const expected of EXPECTED)assert.ok(strings.includes(expected),expected);
 const child=source.pages[0].blocks.find(block=>block.id==='child');assert.equal(child.indentLeft,18);
 const toolchain=createRequire(path.join(process.env.STORE_CI_TOOLCHAIN||path.resolve(ROOT,'../scripts/toolchain'),'package.json'));
 const runtime={Pptx:toolchain('pptxgenjs'),word:toolchain('docx'),Excel:toolchain('exceljs'),Zip:toolchain('jszip')};
 const formats=await import(pathToFileURL(path.resolve(ROOT,'../presentations/routes/office-editor/formats.mjs')));
 const docx=await formats.renderOffice(source,'docx',runtime),zip=await runtime.Zip.loadAsync(docx,{checkCRC32:true});
 const xml=await zip.file('word/document.xml').async('string');for(const expected of EXPECTED)assert.ok(xml.includes(expected),expected);
 const pdf=await formats.renderOffice(source,'pdf',runtime);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 const text=[...pdf.toString('latin1').matchAll(/\(([^)]*)\) Tj/g)].map(match=>match[1]).join(' ').replace(/\s+/g,' ');
 for(const expected of EXPECTED)assert.ok(text.includes(expected),expected);
 const rtf=await formats.renderOffice(source,'rtf',runtime);assert.match(rtf.toString('ascii'),/^\{\\rtf1/);
 for(const expected of EXPECTED)assert.ok(rtf.toString('ascii').includes(expected),expected);
 assert.equal(source.pages[0].blocks.filter(block=>block.runs?.some(run=>run.text.includes('Independent child evidence'))).length,1);
 if(process.env.CAREER_DATE_PROOF_DIR){
  const folder=path.resolve(process.env.CAREER_DATE_PROOF_DIR);await fs.mkdir(folder,{recursive:true});
  const outputs={'generated.json':Buffer.from(JSON.stringify(generated,null,2)+'\n'),'saved-packet.json':Buffer.from(JSON.stringify(preserved,null,2)+'\n'),
   'word-model.json':Buffer.from(JSON.stringify(source,null,2)+'\n'),'recorded-dates.docx':docx,'recorded-dates.pdf':pdf,'recorded-dates.rtf':rtf};
  for(const[name,bytes]of Object.entries(outputs))await fs.writeFile(path.join(folder,name),bytes);
  const artifacts=Object.entries(outputs).map(([name,bytes])=>({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
  await fs.writeFile(path.join(folder,'artifacts.json'),JSON.stringify({periods:EXPECTED,dates:preserved.dates,artifacts},null,2)+'\n');
 }
});
