/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Decode genuine page/form/annotation derivatives independently and preserve original bytes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const python=process.env.OSHAL_PDF_TEST_PYTHON;
assert.ok(python,'OSHAL_PDF_TEST_PYTHON must name the isolated runtime installed from engine/requirements.txt; no fake or skipped renderer proof');
const root=resolve(import.meta.dirname,'..');
function command(name,args,input){const r=spawnSync(name,args,{input,encoding:'utf8',maxBuffer:14*1024*1024,timeout:50000});assert.equal(r.status,0,r.stderr);return r.stdout;}
const engine=input=>JSON.parse(command(python,[join(root,'engine/worker.py')],JSON.stringify(input)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('actual merge/reorder/rotate/extract, standard forms and annotations reopen independently',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pdf-workbench-real-'));
 try{
  command(python,[join(root,'tests/fixtures/build-fixtures.py'),dir]);
  const first=readFileSync(join(dir,'first.pdf')),second=readFileSync(join(dir,'second.pdf'));
  const a=randomUUID(),b=randomUUID(),page=randomUUID();
  const sources=[{id:a,data:first.toString('base64'),sha256:sha(first)},{id:b,data:second.toString('base64'),sha256:sha(second)}];
  const input={op:'derive',sources,model:{pages:[{id:page,source:b,index:0,rotation:90},{id:randomUUID(),source:a,index:0,rotation:0}],
   annotations:[{id:randomUUID(),page,kind:'text',rect:[90,20,225,70],text:'VISIBLE NOTE',color:'ff0000'},
    {id:randomUUID(),page,kind:'highlight',rect:[10,155,180,185],color:'ffff00'},
    {id:randomUUID(),page,kind:'ink',rect:[90,80,180,95],points:[[90,80],[140,95],[180,80]],color:'008800'}],
   fields:{[a+'.name']:'ALICE',[a+'.consent']:'/Yes',[a+'.color']:'Blue',[a+'.decision']:'/YesChoice',[b+'.name']:'BOB'}}};
  const result=engine(input);assert.equal(result.ok,true,JSON.stringify(result));
  const bytes=Buffer.from(result.result.data,'base64');assert.equal(sha(bytes),result.result.sha256);
  const out=join(dir,'merged.pdf');writeFileSync(out,bytes);
  const info=command('pdfinfo',[out]);assert.match(info,/Pages:\s+2/);assert.match(info,/Page rot:\s+90/);
  const text=command('pdftotext',['-layout',out,'-']);assert.ok(text.indexOf('SECOND PAGE')<text.indexOf('FIRST PAGE'));assert.match(text,/ALICE/);assert.match(text,/BOB/);assert.match(text,/VISIBLE NOTE/);
  const inspection=JSON.parse(command(python,['-c',`import json,sys;from pypdf import PdfReader;r=PdfReader(sys.argv[1]);print(json.dumps({'fields':{k:str(v.get('/V')) for k,v in r.get_fields().items()},'annots':[str(a.get_object().get('/Subtype')) for a in r.pages[0].get('/Annots',[])]}))`,out]));
  assert.equal(inspection.fields[a+'.consent'],'/Yes');assert.equal(inspection.fields[a+'.name'],'ALICE');assert.equal(inspection.fields[b+'.name'],'BOB');
  assert.equal(inspection.fields[a+'.color'],'Blue');assert.equal(inspection.fields[a+'.decision'],'/YesChoice');assert.match(text,/Blue/);
  for(const kind of ['/FreeText','/Highlight','/Ink'])assert.ok(inspection.annots.includes(kind));
  const preview=engine({op:'preview',data:bytes.toString('base64'),page:0,side:600});assert.equal(preview.ok,true);assert.equal(Buffer.from(preview.result.data,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  // No original was overwritten, including its form values.
  assert.equal(sha(readFileSync(join(dir,'first.pdf'))),sha(first));assert.equal(sha(readFileSync(join(dir,'second.pdf'))),sha(second));
  const extract=engine({...input,model:{pages:[input.model.pages[1]],annotations:[],fields:{}}});assert.equal(extract.ok,true);assert.equal(extract.result.pages.length,1);
  const repeated=engine({...input,model:{pages:[input.model.pages[1],{...input.model.pages[1],id:randomUUID()}],annotations:[],fields:{}}});assert.equal(repeated.error,'pdf_repeated_form_page_unsupported');
  const invalid=engine({...input,model:{...input.model,fields:{[a+'.name']:'Unicode é'}}});assert.equal(invalid.error,'pdf_field_text_unsupported');
  const sourceChanged=engine({...input,sources:[{...sources[0],sha256:'0'.repeat(64)}]});assert.equal(sourceChanged.error,'pdf_source_changed');
  assert.equal(engine({op:'inspect',data:Buffer.from('not PDF').toString('base64')}).error,'pdf_invalid_pdf');
  assert.equal(engine({op:'ocr',data:bytes.toString('base64'),page:0,language:'not-installed'}).error,'pdf_ocr_language_unsupported');
  const scanned=readFileSync(join(dir,'scanned.pdf'));
  const textless=engine({op:'text',data:scanned.toString('base64')});assert.equal(textless.ok,true);assert.equal(textless.result.pages[0].text,'');
  const ocr=engine({op:'ocr',data:scanned.toString('base64'),page:0,language:'eng'});assert.equal(ocr.ok,true,JSON.stringify(ocr));assert.match(ocr.result.text,/FIRST PAGE 1/i);assert.equal(ocr.result.language,'eng');assert.equal(ocr.result.uncertain,true);assert.equal(ocr.result.sourceUnchanged,true);assert.ok(ocr.result.words.some(w=>w.confidence>=0&&w.confidence<=100));
  assert.equal(sha(readFileSync(join(dir,'scanned.pdf'))),sha(scanned));
  assert.equal(engine({op:'inspect',data:readFileSync(join(dir,'encrypted.pdf')).toString('base64')}).error,'pdf_encrypted_unsupported');
  assert.equal(engine({op:'inspect',data:readFileSync(join(dir,'active.pdf')).toString('base64')}).error,'pdf_active_content_unsupported');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
