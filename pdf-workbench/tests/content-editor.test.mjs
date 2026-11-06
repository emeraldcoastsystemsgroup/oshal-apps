/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Independently decode original PDF text/graphics edits, isolate repeated page instances and reject forged objects.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {initial,apply,CONTRACT} from '../routes/model.mjs';
import {contentObjects} from '../tools/content-model.mjs';
const python=process.env.OSHAL_PDF_TEST_PYTHON,root=resolve(import.meta.dirname,'..');
assert.ok(python,'Use a genuine runtime installed from the hash-pinned engine/requirements.txt');
function command(executable,args,input){const result=spawnSync(executable,args,{input,encoding:'utf8',maxBuffer:16*1024*1024,timeout:50000});assert.equal(result.status,0,result.stderr);return result.stdout;}
const engine=input=>JSON.parse(command(python,[join(root,'engine/worker.py')],JSON.stringify(input)));
function setup(t,plain=false){const directory=mkdtempSync(join(tmpdir(),'pdf-content-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));command(python,[join(root,'tests/fixtures/build-fixtures.py'),directory]);if(plain)command(python,['-c',"from pypdf import PdfReader,PdfWriter;from pypdf.generic import NameObject;import sys;r=PdfReader(sys.argv[1]);w=PdfWriter();[(w.add_page(p),w.pages[-1].pop(NameObject('/Annots'),None)) for p in r.pages];w.write(sys.argv[2])",join(directory,'second.pdf'),join(directory,'plain.pdf')]);const bytes=readFileSync(join(directory,plain?'plain.pdf':'second.pdf')),result=engine({op:'inspect',data:bytes.toString('base64')});assert.equal(result.ok,true,JSON.stringify(result));const source={id:randomUUID(),...result.result,data:bytes.toString('base64')};return{directory,source,model:initial(source,[0]),sources:[{id:source.id,data:source.data,sha256:createHash('sha256').update(bytes).digest('hex')}]};}
test('actual model-visible PDF text example changes the real native source object without changing its other properties',t=>{
 const yaml=createRequire(import.meta.url)('js-yaml'),manifest=yaml.load(readFileSync(join(root,'oshal-app.yaml'),'utf8'));
 const description=manifest.tools.find(tool=>tool.name==='pdf-apply-operations').description;
 const example=JSON.parse(description.match(/(?:^|\n)TEXT_OBJECT_OPERATION_JSON\n([^\n]+)\nEND_TEXT_OBJECT_OPERATION_JSON/)[1]);
 assert.deepEqual(example,CONTRACT.textReplacementExample);
 const f=setup(t,true),page=f.model.pages[0].id,text=f.source.pages[0].objects.find(object=>object.kind==='text'&&object.textEditable);
 assert.ok(text);const before=structuredClone(f.model),operation={...example,page,object:text.id};
 const model=apply(f.model,[operation],[f.source]);assert.deepEqual(f.model,before);
 assert.deepEqual(model.contentEdits,[{page,object:text.id,properties:{text:example.properties.text}}]);
 const result=engine({op:'derive',sources:f.sources,model});assert.equal(result.ok,true,JSON.stringify(result));
 const output=join(f.directory,'declared-example.pdf');writeFileSync(output,Buffer.from(result.result.data,'base64'));
 assert.match(command('pdftotext',[output,'-']),/New native text/);assert.doesNotMatch(command('pdftotext',[output,'-']),/SECOND PAGE/);
 const item=contentObjects(f.source.pages[0],model,page,result.result.pages[0]).find(object=>object.id===text.id);
 for(const key of ['font','fontSize','fill','stroke','strokeWidth'])assert.deepEqual(item[key],text[key]);
 assert.throws(()=>apply(f.model,[{...operation,op:'replace_text'}],[f.source]),/pdf_operation_unsupported/);
});
test('original text, font, fill, shape geometry and inserted native objects export as real PDF content',t=>{
 const f=setup(t),page=f.model.pages[0].id,text=f.source.pages[0].objects.find(o=>o.kind==='text'),shape=f.source.pages[0].objects.find(o=>o.kind==='path');
 assert.ok(text.text.includes('SECOND'));assert.ok(shape);
 const changed=apply(f.model,[{op:'update-object',page,object:text.id,properties:{text:'EDITED NATIVE TEXT',font:'Courier-Bold',fontSize:14,fill:'ff0000',rect:[15,145,225,175]}},
  {op:'update-object',page,object:shape.id,properties:{fill:'0000ff',rect:[20,20,80,80]}},
  {op:'add-object',page,item:{id:randomUUID(),kind:'ellipse',rect:[110,20,180,80],fill:'00ff00',stroke:'000000',strokeWidth:2}},
  {op:'add-object',page,item:{id:randomUUID(),kind:'text',rect:[10,100,220,120],text:'NEW PAGE CONTENT',font:'Helvetica',fontSize:12,fill:'111111'}}],[f.source]);
 const result=engine({op:'derive',sources:f.sources,model:changed});assert.equal(result.ok,true,JSON.stringify(result));
 const output=join(f.directory,'edited.pdf');writeFileSync(output,Buffer.from(result.result.data,'base64'));
 const extracted=command('pdftotext',['-layout',output,'-']);assert.match(extracted,/EDITED NATIVE TEXT/);assert.match(extracted,/NEW\s+PAGE\s+CONTENT/);assert.doesNotMatch(extracted,/SECOND PAGE/);
 const decoded=JSON.parse(command(python,['-c',"from pypdf import PdfReader;import sys,json;r=PdfReader(sys.argv[1]);print(json.dumps({'forms':len(r.get_fields() or {}),'ops':[str(op) for _,op in r.pages[0].get_contents().operations],'fonts':[str(v.get_object().get('/BaseFont')) for v in r.pages[0]['/Resources']['/Font'].values()]}))",output]));
 assert.ok(decoded.ops.includes("b'c'"),'ellipse is a real cubic path');assert.ok(decoded.fonts.some(name=>name.includes('Courier-Bold')));
 assert.deepEqual(contentObjects(f.source.pages[0],changed,page,result.result.pages[0]).find(o=>o.id===text.id).text,'EDITED NATIVE TEXT');
});
test('repeated original pages edit independently and deleting native text removes it from extraction',t=>{
 const f=setup(t,true),model=initial(f.source,[0,0]),text=f.source.pages[0].objects.find(o=>o.kind==='text'),page=model.pages[0].id;
 const changed=apply(model,[{op:'delete-object',page,object:text.id}],[f.source]);const result=engine({op:'derive',sources:f.sources,model:changed});assert.equal(result.ok,true,JSON.stringify(result));const out=join(f.directory,'instance.pdf');writeFileSync(out,Buffer.from(result.result.data,'base64'));
 assert.doesNotMatch(command('pdftotext',['-f','1','-l','1',out,'-']),/SECOND PAGE/);assert.match(command('pdftotext',['-f','2','-l','2',out,'-']),/SECOND PAGE/);
});
test('source-bound validation rejects missing objects, unsupported text and out-of-page geometry without mutating the draft',t=>{
 const f=setup(t),page=f.model.pages[0].id,text=f.source.pages[0].objects.find(o=>o.kind==='text'),before=structuredClone(f.model);
 for(const operation of [{op:'update-object',page,object:'o9999',properties:{fill:'ff0000'}},{op:'update-object',page,object:text.id,properties:{text:'\u0000'}},{op:'update-object',page,object:text.id,properties:{rect:[-1,0,30,30]}},{op:'add-object',page,item:{id:randomUUID(),kind:'image',rect:[0,0,20,20],image:'not-an-image'}}])assert.throws(()=>apply(f.model,[operation],[f.source]));
 assert.deepEqual(f.model,before);
});
test('inserted transparent PNG and image opacity are real PDF image objects with independently rendered alpha',t=>{
 const f=setup(t),page=f.model.pages[0].id,encoded=command(python,['-c',"from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGBA',(4,4),(255,0,0,128)).save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())"]).trim();
 const info=engine({op:'inspect-image',data:encoded});assert.equal(info.ok,true,JSON.stringify(info));const asset={id:randomUUID(),data:encoded,sha256:info.result.sha256,type:info.result.type};
 const model=apply(f.model,[{op:'add-object',page,item:{id:randomUUID(),kind:'rectangle',rect:[20,20,90,90],fill:'0000ff',strokeWidth:0}},{op:'add-object',page,item:{id:randomUUID(),kind:'image',asset:asset.id,rect:[30,30,70,70],opacity:.5}}],[f.source],[asset]);
 const result=engine({op:'derive',sources:f.sources,assets:[asset],model});assert.equal(result.ok,true,JSON.stringify(result));const out=join(f.directory,'alpha.pdf');writeFileSync(out,Buffer.from(result.result.data,'base64'));command('pdftoppm',['-singlefile','-r','72','-png',out,join(f.directory,'alpha')]);
 const pixel=JSON.parse(command(python,['-c',"from PIL import Image;import sys,json;print(json.dumps(Image.open(sys.argv[1]).convert('RGB').getpixel((50,150))))",join(f.directory,'alpha.png')]));
 assert.ok(Math.abs(pixel[0]-64)<=3&&pixel[1]<=3&&Math.abs(pixel[2]-191)<=3,JSON.stringify(pixel));assert.equal(result.result.pages[0].objects.filter(o=>o.kind==='image').length,1);assert.ok(JSON.stringify(model).length<1000,'the revision contains an owned asset reference, not repeated image bytes');
 // Reimport the real output: an original image move must retain its soft mask and graphics-state opacity.
 const imported={id:randomUUID(),...engine({op:'inspect',data:result.result.data}).result},originalImage=imported.pages[0].objects.find(o=>o.kind==='image');assert.ok(Math.abs(originalImage.opacity-.5)<.01);
 const base=initial(imported,[0]),moved=apply(base,[{op:'update-object',page:base.pages[0].id,object:originalImage.id,properties:{rect:[110,20,150,60]}}],[imported]);
 const movedResult=engine({op:'derive',sources:[{id:imported.id,data:result.result.data,sha256:result.result.sha256}],model:moved});assert.equal(movedResult.ok,true,JSON.stringify(movedResult));const movedOut=join(f.directory,'moved-alpha.pdf');writeFileSync(movedOut,Buffer.from(movedResult.result.data,'base64'));command('pdftoppm',['-singlefile','-r','72','-png',movedOut,join(f.directory,'moved-alpha')]);
 const pixels=JSON.parse(command(python,['-c',"from PIL import Image;import sys,json;i=Image.open(sys.argv[1]).convert('RGB');print(json.dumps([i.getpixel((130,160)),i.getpixel((50,150))]))",join(f.directory,'moved-alpha.png')]));assert.ok(Math.abs(pixels[0][0]-255)<=3&&Math.abs(pixels[0][1]-191)<=3&&Math.abs(pixels[0][2]-191)<=3,JSON.stringify(pixels));assert.deepEqual(pixels[1],[0,0,255]);
});

test('text outlines render actual stroke pixels and hidden text remains read only',t=>{
 const f=setup(t);command(python,['-c',"from pypdf import PdfReader,PdfWriter;from pypdf.generic import DictionaryObject,NameObject,FloatObject,DecodedStreamObject;import sys;r=PdfReader(sys.argv[1]);w=PdfWriter(clone_from=r);p=w.pages[0];p['/Resources'][NameObject('/ExtGState')]=DictionaryObject({NameObject('/Alpha'):DictionaryObject({NameObject('/ca'):FloatObject(.2),NameObject('/CA'):FloatObject(1)})});s=DecodedStreamObject();s.set_data(p.get_contents().get_data().replace(b'BT ',b'/Alpha gs BT '));p.replace_contents(s);w.write(sys.argv[2])",join(f.directory,'second.pdf'),join(f.directory,'text-alpha.pdf')]);const bytesWithAlpha=readFileSync(join(f.directory,'text-alpha.pdf'));f.source={id:randomUUID(),...engine({op:'inspect',data:bytesWithAlpha.toString('base64')}).result};f.model=initial(f.source,[0]);f.sources=[{id:f.source.id,data:bytesWithAlpha.toString('base64'),sha256:f.source.sha256}];const page=f.model.pages[0].id,text=f.source.pages[0].objects.find(o=>o.kind==='text');assert.equal(text.strokeWidth,0);
 const model=apply(f.model,[{op:'update-object',page,object:text.id,properties:{stroke:'ff0000',strokeWidth:2,fontSize:22}}],[f.source]),result=engine({op:'derive',sources:f.sources,model});assert.equal(result.ok,true,JSON.stringify(result));const out=join(f.directory,'outline.pdf');writeFileSync(out,Buffer.from(result.result.data,'base64'));command('pdftoppm',['-singlefile','-r','72','-png',out,join(f.directory,'outline')]);
 const red=Number(command(python,['-c',"from PIL import Image;import sys;i=Image.open(sys.argv[1]).convert('RGB');print(sum(r>160 and g<100 and b<100 for r,g,b in i.crop((0,0,240,70)).getdata()))",join(f.directory,'outline.png')]));assert.ok(red>30,'actual glyph outline must be visible in independent rendering');assert.equal(result.result.pages[0].objects.find(o=>o.kind==='text').renderMode,2);
 command(python,['-c',"from pypdf import PdfReader,PdfWriter;from pypdf.generic import DecodedStreamObject;import sys;r=PdfReader(sys.argv[1]);w=PdfWriter(clone_from=r);p=w.pages[0];s=DecodedStreamObject();s.set_data(p.get_contents().get_data().replace(b'BT ',b'BT 3 Tr '));p.replace_contents(s);w.write(sys.argv[2])",join(f.directory,'second.pdf'),join(f.directory,'hidden.pdf')]);const bytes=readFileSync(join(f.directory,'hidden.pdf')),hidden={id:randomUUID(),...engine({op:'inspect',data:bytes.toString('base64')}).result},item=hidden.pages[0].objects.find(o=>o.kind==='text');assert.equal(item.renderMode,3);assert.equal(item.editable,false);const base=initial(hidden,[0]);assert.throws(()=>apply(base,[{op:'update-object',page:base.pages[0].id,object:item.id,properties:{fontSize:24}}],[hidden]),/pdf_content_object_unsupported/);
});


test('restricted font runs keep native geometry/paint and require explicit standard font for text; Unicode size edits refuse before queueing',t=>{
 const f=setup(t);command(python,[join(root,'tests/fixtures/build-font-fixtures.py'),f.directory]);
 for(const [file,original]of[['embedded-font.pdf','café'],['unicode-font.pdf','ΩЖ']]){
  const bytes=readFileSync(join(f.directory,file)),inspection=engine({op:'inspect',data:bytes.toString('base64')});assert.equal(inspection.ok,true,JSON.stringify(inspection));
  const source={id:randomUUID(),...inspection.result},model=initial(source,[0]),page=model.pages[0].id,item=source.pages[0].objects.find(o=>o.kind==='text');assert.ok(item);assert.equal(item.editable,true);assert.equal(item.text,original);assert.equal(item.textEditable,false);assert.equal(item.fontSizeEditable,false);
  const sources=[{id:source.id,data:bytes.toString('base64'),sha256:source.sha256}];
  for(const properties of [{text:'Different glyphs'},{fontSize:30}]){
   assert.throws(()=>apply(model,[{op:'update-object',page,object:item.id,properties}],[source]),/pdf_content_font_reencoding_unsupported/);
   const forced=structuredClone(model);forced.contentEdits=[{page,object:item.id,properties}];const refused=engine({op:'derive',sources,model:forced});assert.equal(refused.ok,false);assert.equal(refused.error,'pdf_content_font_reencoding_unsupported');
  }
  const rect=item.rect.map((value,index)=>value+(index%2?5:10)),moved=apply(model,[{op:'update-object',page,object:item.id,properties:{rect,fill:'aa0000',opacity:.8}}],[source]),result=engine({op:'derive',sources,model:moved});assert.equal(result.ok,true,JSON.stringify(result));const out=join(f.directory,file+'-moved.pdf');writeFileSync(out,Buffer.from(result.result.data,'base64'));const extracted=command('pdftotext',[out,'-']);assert.ok(extracted.includes(original),file+' '+JSON.stringify(extracted));
  if(original==='café'){
   const replaced=apply(model,[{op:'update-object',page,object:item.id,properties:{font:'Helvetica',text:'C café',fontSize:22}}],[source]),replacement=engine({op:'derive',sources,model:replaced});assert.equal(replacement.ok,true,JSON.stringify(replacement));const exported=join(f.directory,'explicit-font.pdf');writeFileSync(exported,Buffer.from(replacement.result.data,'base64'));assert.match(command('pdftotext',[exported,'-']),/C café/);const current=contentObjects(source.pages[0],replaced,page,replacement.result.pages[0]).find(o=>o.id===item.id);assert.equal(current.fontExplicit,true);
   assert.doesNotThrow(()=>apply(replaced,[{op:'update-object',page,object:item.id,properties:{text:'Another glyph Z'}}],[source]));
  }else assert.throws(()=>apply(model,[{op:'update-object',page,object:item.id,properties:{font:'Helvetica'}}],[source]),/pdf_content_text_unsupported/);
 }
});


test('Type3 page glyph programs remain read only instead of being lost during unrelated content serialization',t=>{
 const f=setup(t);command(python,[join(root,'tests/fixtures/build-font-fixtures.py'),f.directory]);const bytes=readFileSync(join(f.directory,'type3-font.pdf')),source={id:randomUUID(),...engine({op:'inspect',data:bytes.toString('base64')}).result};assert.equal(source.pages[0].contentEditable,false);
 const model=initial(source,[0]),page=model.pages[0].id,item=source.pages[0].objects.find(o=>o.kind==='text');assert.ok(item);assert.equal(item.editable,false);assert.throws(()=>apply(model,[{op:'update-object',page,object:item.id,properties:{fill:'ff0000'}}],[source]),/pdf_content_page_unsupported/);
 const forced=structuredClone(model);forced.contentEdits=[{page,object:item.id,properties:{fill:'ff0000'}}];const result=engine({op:'derive',sources:[{id:source.id,data:bytes.toString('base64'),sha256:source.sha256}],model:forced});assert.equal(result.ok,false);assert.equal(result.error,'pdf_content_page_unsupported');
});

test('path fill color preserves the original even-odd hole in independent rendered pixels',t=>{
 const f=setup(t,true);command(python,['-c',"from pypdf import PdfReader,PdfWriter;from pypdf.generic import DecodedStreamObject;import sys;r=PdfReader(sys.argv[1]);w=PdfWriter(clone_from=r);p=w.pages[0];s=DecodedStreamObject();s.set_data(p.get_contents().get_data().replace(b'10 10 70 70 re f',b'10 10 70 70 re 25 25 30 30 re f*'));p.replace_contents(s);w.write(sys.argv[2])",join(f.directory,'plain.pdf'),join(f.directory,'even-odd.pdf')]);
 const bytes=readFileSync(join(f.directory,'even-odd.pdf')),source={id:randomUUID(),...engine({op:'inspect',data:bytes.toString('base64')}).result},model=initial(source,[0]),page=model.pages[0].id,path=source.pages[0].objects.find(o=>o.kind==='path');const changed=apply(model,[{op:'update-object',page,object:path.id,properties:{fill:'00ff00'}}],[source]),result=engine({op:'derive',sources:[{id:source.id,data:bytes.toString('base64'),sha256:source.sha256}],model:changed});assert.equal(result.ok,true,JSON.stringify(result));const out=join(f.directory,'colored-hole.pdf');writeFileSync(out,Buffer.from(result.result.data,'base64'));command('pdftoppm',['-singlefile','-r','72','-png',out,join(f.directory,'colored-hole')]);const pixels=JSON.parse(command(python,['-c',"from PIL import Image;import sys,json;i=Image.open(sys.argv[1]).convert('RGB');print(json.dumps([i.getpixel((40,160)),i.getpixel((15,185))]))",join(f.directory,'colored-hole.png')]));assert.deepEqual(pixels,[[255,255,255],[0,255,0]]);
});
