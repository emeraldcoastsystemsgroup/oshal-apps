import{test}from'node:test';import assert from'node:assert/strict';
import{initial,validate,style,paragraph,plain}from'../../tools/office/model.mjs';
import{applyOperations,newObject,patchRuns,history}from'../../tools/office/operations.mjs';
import{workbookCalculator}from'../../tools/office/formulas.mjs';
import{createRequire}from'node:module';import{readFileSync}from'node:fs';
test('atomic slide edits preserve unrelated objects and reject unsupported properties without changing source',()=>{let model=initial('pptx'),page=model.pages[0].id;const object=newObject('rect');model=applyOperations(model,[{op:'add-object',page,object}]);const before=structuredClone(model),next=applyOperations(model,[{op:'update-object',page,id:object.id,patch:{x:144,fill:'#ff0000',strokeWidth:3,shadow:{color:'#000000',opacity:.3,blur:8,x:4,y:4}}}]);assert.deepEqual(next.pages[0].objects[0],before.pages[0].objects[0]);assert.equal(next.pages[0].objects[1].fill,'#ff0000');assert.deepEqual(model,before);assert.throws(()=>applyOperations(model,[{op:'update-object',page,id:object.id,patch:{x:200}},{op:'update-object',page,id:object.id,patch:{invented:true}}]),/Unsupported/);assert.deepEqual(model,before);});
test('range formatting and replacement preserve outside text runs, Unicode and paragraph semantics',()=>{const values=[{text:'Hello ',style:style({bold:true})},{text:'world 🌍',style:style({italic:true})}],result=patchRuns(values,6,11,{color:'#0000ff'});assert.equal(plain(result),'Hello world 🌍');assert.equal(result[0].style.bold,true);assert.equal(result[1].style.italic,true);assert.equal(result[1].style.color,'#0000ff');const replaced=patchRuns(result,6,11,{},'reader');assert.equal(plain(replaced),'Hello reader 🌍');assert.equal(replaced.at(-1).style.italic,true);});
test('workbook calculations follow dependencies, ranges, cross-sheet refs and lazy IF; cycles and unsupported functions are explicit',()=>{let model=initial('xlsx');const sheet=model.sheets[0];sheet.cells={A1:{value:2},A2:{value:3},B1:{value:'=SUM(A1:A2)*2'},B2:{value:'=IF(A1>0,B1,1/0)'},C1:{value:'=C2'},C2:{value:'=C1'},D1:{value:'=UNSUPPORTED(A1)'}};model=validate(model);let calc=workbookCalculator(model);assert.equal(calc.value('Sheet1','B1'),10);assert.equal(calc.value('Sheet1','B2'),10);assert.equal(calc.value('Sheet1','C1'),'#CYCLE!');assert.equal(calc.value('Sheet1','D1'),'#NAME?');model=applyOperations(model,[{op:'cell',sheet:sheet.id,from:'A1',value:7},{op:'add-sheet',name:'Second sheet'}]);model.sheets[1].cells.A1={value:"='Sheet1'!B1+1"};model=validate(model);calc=workbookCalculator(model);assert.equal(calc.value('Second sheet','A1'),21);});
test('range formatting, paste, dimensions and history preserve hidden cells and immutable undo snapshots',()=>{let model=initial('xlsx');const sheet=model.sheets[0].id;model=applyOperations(model,[{op:'paste-range',sheet,from:'A1',rows:[[1,2],[3,'=SUM(A1:B1)']]},{op:'format-range',sheet,from:'A1',to:'B2',patch:{bold:true,fill:'#eff6ff',numberFormat:'currency'}}]);const undo=history(model);const next=undo.commit(applyOperations(model,[{op:'cell',sheet,from:'J20',value:'Far cell'}]));next.sheets[0].cells.A1.value=999;assert.equal(undo.undo().sheets[0].cells.A1.value,1);assert.equal(undo.redo().sheets[0].cells.J20.value,'Far cell');assert.equal(undo.current().sheets[0].cells.B2.style.bold,true);});
test('assistant selection reads retain real identities and stream exact bounded Unicode JSON',async()=>{const{selectedModel,modelPart}=await import('../../routes/office-editor/selection.mjs'),model=initial('pptx','Selection'),selected=model.pages[0].objects[0],selection={kind:'slide-object',page:model.pages[0].id,ids:[selected.id]},fragment=selectedModel(model,selection);assert.deepEqual(fragment.page.objects.map(item=>item.id),[selected.id]);assert.equal(fragment.page.objects[0].runs[0].text,selected.runs[0].text);assert.throws(()=>selectedModel(model,{...selection,ids:['missing-object']}),/unavailable/);const source=JSON.stringify({text:'Résumé 日本語 😀 \"\n'.repeat(500)}),document={id:'document',revision:3,currentRevision:3,sha256:'saved-model-digest'};let assembled='',offset=0;do{const part=modelPart(document,source,offset);assert.ok(Buffer.byteLength(JSON.stringify(part))<=1900);assert.equal(part.sha256,'saved-model-digest');assembled+=part.text;offset=part.nextOffset;}while(offset!==null);assert.equal(assembled,source);});
test('typed operations reject malformed and wrong-kind commands before any partial mutation',()=>{const slide=initial('pptx'),page=slide.pages[0].id,id=slide.pages[0].objects[0].id;for(const operation of[{op:'move-object',page,id,index:-1},{op:'move-object',page,id,index:'0'},{op:'update-object',page,id},{op:'add-object',page},{op:'remove-object',page,id,patch:{fill:'#ff0000'}},{op:'add-block',page,block:paragraph('Wrong domain')}])assert.throws(()=>applyOperations(slide,[operation]));const book=initial('xlsx');assert.throws(()=>applyOperations(book,[{op:'format-range',sheet:book.sheets[0].id,from:'A1'}]));assert.throws(()=>applyOperations(book,[{op:'paste-range',sheet:book.sheets[0].id,from:'A1',rows:[null]}]));assert.equal(book.sheets[0].cells.A1,undefined);assert.throws(()=>validate({...book,pageWidth:500}));});
test('calculation distinguishes actual errors from literal hash text and handles numeric aggregate constants and negative rounding',()=>{const model=initial('xlsx'),sheet=model.sheets[0];for(const[key,value]of Object.entries({A1:'=#BAD()',A2:'="#VALUE!"',A3:'=SUM(TRUE,"2",3)',A4:'=ROUND(-1.5,0)',A5:'=ROUND(1.005,2)',A6:'text',A7:'=SUM(A6)',A8:'=SUM("text")',A9:'=-2^2'}))sheet.cells[key]={value,style:{}};const calculator=workbookCalculator(validate(model));assert.equal(calculator.result(sheet.name,'A2').error,null);assert.equal(calculator.result(sheet.name,'A2').value,'#VALUE!');assert.equal(calculator.value(sheet.name,'A3'),6);assert.equal(calculator.value(sheet.name,'A4'),-2);assert.equal(calculator.value(sheet.name,'A5'),1.01);assert.equal(calculator.value(sheet.name,'A7'),0);assert.equal(calculator.value(sheet.name,'A8'),'#VALUE!');assert.equal(calculator.value(sheet.name,'A9'),4);});
test('actual model-visible Office examples edit text in both document kinds and cells while unsupported aliases remain refused',()=>{
 const yaml=createRequire(new URL('../../../scripts/toolchain/package.json',import.meta.url))('js-yaml'),manifest=yaml.load(readFileSync(new URL('../../oshal-app.yaml',import.meta.url),'utf8'));
 const description=manifest.tools.find(tool=>tool.name==='office-apply-edits').description;
 const example=name=>JSON.parse(description.match(new RegExp('(?:^|\\n)'+name+'_OPERATION_JSON\\n([^\\n]+)\\nEND_'+name+'_OPERATION_JSON'))[1]);
 const text=example('TEXT_REPLACEMENT');
 for(const kind of['pptx','docx']){
  const model=initial(kind),page=model.pages[0],item=(page.objects??page.blocks).find(item=>item.runs),before=structuredClone(model);
  const replacement={...text,page:page.id,id:item.id,end:plain(item.runs).length};
  const result=applyOperations(model,[replacement]),changed=(result.pages[0].objects??result.pages[0].blocks).find(value=>value.id===item.id);
  assert.equal(plain(changed.runs),text.text);assert.deepEqual(changed.runs[0].style,item.runs[0].style);
  assert.deepEqual(model,before);assert.throws(()=>applyOperations(model,[{op:'replace_text',id:item.id,text:'Rejected'}]),/unsupported/);
 }
 const book=initial('xlsx'),cell=example('WORKBOOK_CELL'),edited=applyOperations(book,[{...cell,sheet:book.sheets[0].id}]);
 assert.equal(edited.sheets[0].cells.A1.value,cell.value);assert.equal(book.sheets[0].cells.A1,undefined);
 const slide=initial('pptx'),shape=newObject('rect'),page=slide.pages[0].id;
 const inserted=applyOperations(slide,[{op:'add-object',page,object:shape}]);
 const geometry=example('PPTX_GEOMETRY'),painted=applyOperations(inserted,[{...geometry,page,id:shape.id}]);
 assert.equal(painted.pages[0].objects.find(item=>item.id===shape.id).fill,geometry.patch.fill);
 assert.deepEqual(painted.pages[0].objects[0],inserted.pages[0].objects[0]);
});
test('selection supplies exact executable whole-text ranges for ASCII, astral Unicode and styled runs without clamping invalid edits',async()=>{
 const{selectedModel}=await import('../../routes/office-editor/selection.mjs');
 for(const kind of['pptx','docx'])for(const values of[
  [{text:'Seed pptx',style:style({bold:true})}],
  [{text:'A😀é',style:style({italic:true})}],
  [{text:'A😀',style:style({bold:true})},{text:' styled',style:style({italic:true})}],
 ]){
  const model=initial(kind),page=model.pages[0],item=(page.objects??page.blocks).find(value=>value.runs);item.runs=values;
  const before=structuredClone(model),fragment=selectedModel(model,{kind:kind==='pptx'?'slide-object':'word-block',page:page.id,ids:[item.id]});
  const range=fragment.wholeTextRanges[0];assert.equal(range.start,0);assert.equal(range.end,plain(values).length);
  assert.equal(range.page,page.id);assert.equal(range.id,item.id);assert.equal(range.op,'text-range');
  const changed=applyOperations(model,[{...range,text:'Exact replacement'}]);
  const output=(changed.pages[0].objects??changed.pages[0].blocks).find(value=>value.id===item.id);
  assert.equal(plain(output.runs),'Exact replacement');assert.deepEqual(output.runs[0].style,values[0].style);
  assert.throws(()=>applyOperations(model,[{...range,end:range.end+1,text:'Refused'}]),/valid text range/);
  assert.deepEqual(model,before);
 }
});
// The captured live failure had the right edit and an invalid invented request identity.
test('editing contract supplies fresh UUIDv4 request keys without mutating the shared contract',async()=>{
 const{CONTRACT,editingContract}=await import('../../routes/office-editor/application.mjs');
 const first=editingContract(),second=editingContract(),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 assert.match(first.requestKey,uuid);assert.match(second.requestKey,uuid);assert.notEqual(first.requestKey,second.requestKey);
 assert.equal(Object.hasOwn(CONTRACT,'requestKey'),false);const{requestKey,...contract}=first;assert.deepEqual(contract,CONTRACT);
 assert.ok(Buffer.byteLength(JSON.stringify(first))<4096,'the full contract remains within a bounded tool observation');
});
test('captured invalid request identities never reach persistence or the edit callback',async()=>{
 const{OfficeStore}=await import('../../routes/office-editor/store.mjs');let queries=0,edits=0;
 const client={query:async()=>{queries++;throw Error('invalid request reached SQL');}},work=async()=>{edits++;throw Error('invalid request reached effect');};
 for(const key of['a1b2c3d4-e5f6-4g7h-8i9j-k0l1m2n3o4p5','00000000-0000-1000-8000-000000000000','not-a-uuid','',null])await assert.rejects(OfficeStore.prototype.request.call({},client,key,{},work),error=>error.code==='office_invalid_id');
 assert.equal(queries,0);assert.equal(edits,0);
});
test('Office create and edit declarations require the native supported UUID format before a proposal can be held',()=>{
 const yaml=createRequire(new URL('../../../scripts/toolchain/package.json',import.meta.url))('js-yaml'),manifest=yaml.load(readFileSync(new URL('../../oshal-app.yaml',import.meta.url),'utf8'));
 for(const name of['office-create-document','office-apply-edits']){const tool=manifest.tools.find(tool=>tool.name===name),key=tool.inputSchema.properties.requestKey;assert.equal(key.format,'uuid');assert.equal(key.minLength,36);assert.equal(key.maxLength,36);const pattern=new RegExp(key.pattern);assert.ok(pattern.test(crypto.randomUUID()));assert.ok(!pattern.test('a1b2c3d4-e5f6-4g7h-8i9j-k0l1m2n3o4p5'));assert.ok(!pattern.test('00000000-0000-1000-8000-000000000000'));assert.ok(tool.inputSchema.required.includes('requestKey'));assert.equal(tool.requiresApproval,true);assert.equal(tool.defaultAuthMode,'ask');}
});
