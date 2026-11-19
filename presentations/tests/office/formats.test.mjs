/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Check real DOCX, PDF, TXT and Chromium renderer paragraph indentation and bounded keep-with-next with unchanged legacy list defaults.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require genuine bounded Word RTF with escaped Unicode, native lists, hierarchy, tables and inline pictures while refusing unsupported kinds.
 */
import{test}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{createServer}from'node:http';import{readFile}from'node:fs/promises';
import{initial,paragraph}from'../../tools/office/model.mjs';import{applyOperations,newObject}from'../../tools/office/operations.mjs';import{renderOffice,dependencies,embeddedModel}from'../../routes/office-editor/formats.mjs';import{inspectOffice}from'../../routes/office-editor/importers.mjs';
const{Zip,Excel}=dependencies();
function rtfDocument(){
 const model=initial('docx','Résumé {safe}');model.header='Header';model.footer='Footer';
 model.pages[0].blocks=[
  {...paragraph('Employer',{bold:true}),keepWithNext:true},
  {...paragraph('Sub-engagement'),indentLeft:18,keepWithNext:true},
  {...paragraph('2024–2026\tDates'),indentLeft:18,keepWithNext:true},
  {...paragraph('Résumé 中文 🌍 \\ {literal}\nNext line',{fontFamily:'Arial;{\\evil}',italic:true,underline:true,color:'#2563eb',highlight:'#fef08a'}),indentLeft:30.6,list:'bullet'},
  {...paragraph('First numbered'),list:'number'},
  {...paragraph('Second numbered'),list:'number'},
  {id:crypto.randomUUID(),type:'table',rows:[[[{text:'Cell one',style:paragraph().runs[0].style}],[{text:'Cell two',style:paragraph().runs[0].style}]]]},
  {id:crypto.randomUUID(),type:'image',width:24,height:24,src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII='}
 ];model.pages.push({...structuredClone(model.pages[0]),id:crypto.randomUUID(),name:'Page 2',blocks:[paragraph('Final page')]});return model;
}
test('RTF is a real seven-bit Unicode Word document preserving ordered hierarchy and native rich content',async()=>{
 const model=rtfDocument(),before=structuredClone(model),bytes=await renderOffice(model,'rtf'),source=bytes.toString('ascii');
 assert.ok(source.startsWith('{\\rtf1\\ansi\\ansicpg1252'));assert.ok(bytes.every(byte=>byte<128));
 for(const value of['\\uc1','\\fonttbl','\\colortbl','\\listtable','\\listoverridetable','\\listtext','\\ls1','\\ls2','\\keepn','\\li360','\\li612','\\trowd','\\cellx','\\cell','\\row','\\pngblip','\\picwgoal480','\\page'])assert.ok(source.includes(value),value);
 for(const value of['\\u233?','\\u20013?','\\u25991?','\\u-10180?','\\u-8435?','\\\\ \\{literal\\}','\\line ','\\tab '])assert.ok(source.includes(value),value);
 assert.ok(source.indexOf('Employer')<source.indexOf('Sub-engagement'));assert.ok(source.indexOf('Sub-engagement')<source.indexOf('2024'));
 assert.ok(source.indexOf('2024')<source.indexOf('First numbered'));assert.ok(source.indexOf('Cell one')<source.indexOf('Cell two'));
 assert.match(source,/Arial\\u59\?\\\{\\\\evil\\\}/);assert.match(source,/\\header[\s\S]*Header/);assert.match(source,/\\footer[\s\S]*Footer/);
 assert.doesNotMatch(source,/<html|\\field\b|\\object\b|\\filetbl\b|INCLUDEPICTURE|HYPERLINK/i);assert.deepEqual(model,before);
});
test('RTF refuses non-Word kinds and bounds escaped output without weakening the model byte limit',async()=>{
 for(const kind of['pptx','xlsx'])await assert.rejects(renderOffice(initial(kind),'rtf'),error=>error.code==='office_format_mismatch');
 const expanded=initial('docx');expanded.pages[0].blocks=Array.from({length:9},()=>paragraph('é'.repeat(200000)));
 await assert.rejects(renderOffice(expanded,'rtf'),error=>error.code==='office_export_limit');
 const invalid=initial('docx');invalid.pages[0].blocks[0].runs[0].text='bad\u0000text';
 await assert.rejects(renderOffice(invalid,'rtf'),error=>error.code==='office_invalid_text');
});
function nestedDocument(){
 const model=initial('docx');model.pages[0].blocks=[
  paragraph('Parent'),{...paragraph('Child'),indentLeft:18,keepWithNext:true},
  {...paragraph('Bullet'),list:'bullet',indentLeft:30.6},
  {...paragraph('Number'),list:'number',indentLeft:30.6},
  {...paragraph('Legacy'),list:'bullet'},paragraph('After')
 ];return model;
}
function xmlParagraph(document,text){
 const result=document.match(/<w:p[ >][\s\S]*?<\/w:p>/g)?.find(value=>value.includes('>'+text+'</w:t>'));
 assert.ok(result,'actual DOCX paragraph '+text);return result;
}
test('explicit paragraph TEXT offsets persist in real DOCX without overriding omitted list defaults',async()=>{
 const model=nestedDocument(),zip=await Zip.loadAsync(await renderOffice(model)),xml=await zip.file('word/document.xml').async('string');
 assert.match(xmlParagraph(xml,'Child'),/<w:ind w:left="360"\s*\/>/);
 for(const text of['Bullet','Number'])assert.match(xmlParagraph(xml,text),/<w:ind w:left="612" w:hanging="252"\s*\/>/);
 for(const text of['Parent','Legacy','After'])assert.doesNotMatch(xmlParagraph(xml,text),/<w:ind\b/);
 assert.match(xmlParagraph(xml,'Child'),/<w:keepNext\s*\/>/);
 for(const text of['Parent','Bullet','Number','Legacy','After'])assert.doesNotMatch(xmlParagraph(xml,text),/<w:keepNext\b/);
 assert.deepEqual(await embeddedModel(zip),model);
});
function pdfTextX(source,text){
 const line=source.split('\n').find(value=>value.includes('('+text+') Tj'));
 assert.ok(line,'actual PDF text operator '+text);
 return Number(/ ([\d.-]+) [\d.-]+ Td /.exec(line)[1]);
}
test('real PDF text origins and readable TXT nesting use explicit offsets while omitted lists remain unchanged',async()=>{
 const model=nestedDocument(),pdf=(await renderOffice(model,'pdf')).toString('latin1');
 assert.ok(pdf.startsWith('%PDF-1.7'));assert.match(pdf,/\/Count 1\b/);
 for(const[text,offset]of[['Parent',0],['Child',18],['Bullet',30.6],['Number',30.6],['Legacy',26.4],['After',0]])
  assert.equal(pdfTextX(pdf,text),model.margins.left+offset,text);
 assert.ok(pdfTextX(pdf,'Number')-pdfTextX(pdf,'1.')>=18,'the numbered marker cannot overlap its text at the default18pt font');
 const txt=(await renderOffice(model,'txt')).toString('utf8');
 assert.equal(txt,'Parent\n   Child\n   - Bullet\n  1. Number\n- Legacy\nAfter\n');
});
async function rendererFixture(){
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  try{
   if(path==='/api/presentations/editor/app'){
    res.setHeader('content-type','text/html');return res.end(await readFile(new URL('../../tools/office/editor.html',import.meta.url)));
   }
   const asset=/^\/api\/presentations\/editor\/assets\/([a-z-]+\.(?:mjs|css))$/.exec(path);
   if(asset){
    res.setHeader('content-type',path.endsWith('.css')?'text/css':'text/javascript');
    // The actual renderer is loaded explicitly; no controller, API, user or provider is simulated.
    return res.end(asset[1]==='controller.mjs'?'':await readFile(new URL('../../tools/office/'+asset[1],import.meta.url)));
   }
   res.writeHead(404);res.end();
  }catch(error){res.writeHead(500);res.end(error.message);}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 return{origin:'http://127.0.0.1:'+server.address().port,close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};
}
test('actual Word renderer positions nested text at total offsets on desktop and phone, retaining legacy list padding',async()=>{
 const {chromium}=createRequire(import.meta.url)('playwright'),f=await rendererFixture(),browser=await chromium.launch({headless:true});
 try{
  for(const width of[1280,390]){
   const page=await browser.newPage({viewport:{width,height:900}});await page.goto(f.origin+'/api/presentations/editor/app?kind=docx');
   await page.evaluate(async model=>{
    const{state}=await import('/api/presentations/editor/assets/state.mjs'),renderer=await import('/api/presentations/editor/assets/render.mjs');
    state.model=model;state.page=model.pages[0].id;state.busy=false;state.permissions={create:true};
    document.getElementById('zoom').value='1';renderer.render();
   },nestedDocument());
   const positions=await page.locator('.office-word-page .office-block').evaluateAll(blocks=>blocks.map(block=>{
    const node=block.querySelector('.office-rich-text'),list=block.querySelector('ul,ol');
    return{x:node.getBoundingClientRect().x,listPadding:list?getComputedStyle(list).paddingLeft:null,breakAfter:getComputedStyle(block).breakAfter};
   }));
   for(const[index,offset]of[[1,18],[2,30.6],[3,30.6]])assert.ok(Math.abs(positions[index].x-positions[0].x-offset*96/72)<.03,JSON.stringify({width,index,positions}));
   assert.equal(positions[4].listPadding,'24px');assert.equal(positions[2].listPadding,'0px');
   assert.equal(positions[1].breakAfter,'avoid');assert.equal(positions[0].breakAfter,'auto');
   await page.close();
  }
 }finally{await browser.close();await f.close();}
});
function pageTexts(bytes){
 return [...bytes.toString('latin1').matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match=>[...match[1].matchAll(/\(([^)]*)\) Tj/g)].map(part=>part[1]).join(' '));
}
function shortPage(){
 const model=initial('docx');Object.assign(model,{pageWidth:300,pageHeight:200,margins:{top:20,right:20,bottom:20,left:20}});
 model.pages[0].blocks=[{...paragraph('Filler'),spacingAfter:50},
  {...paragraph('Heading'),indentLeft:18,keepWithNext:true},
  {...paragraph('Dates'),keepWithNext:true},
  {...paragraph('FirstBullet'),list:'bullet',indentLeft:30.6}];return model;
}
test('real PDF keeps a bounded heading/date chain with its first bullet and never moves an entire history',async()=>{
 const model=shortPage(),pages=pageTexts(await renderOffice(model,'pdf'));
 assert.equal(pages.length,2);assert.match(pages[0],/Filler/);assert.doesNotMatch(pages[0],/Heading|Dates|FirstBullet/);
 assert.match(pages[1],/Heading.*Dates.*FirstBullet/);
 const legacy=structuredClone(model);for(const block of legacy.pages[0].blocks)delete block.keepWithNext;
 const legacyPages=pageTexts(await renderOffice(legacy,'pdf'));
 assert.match(legacyPages[0],/Filler.*Heading.*Dates/);assert.doesNotMatch(legacyPages[0],/FirstBullet/);
});
test('PDF keep-with-next measures the real omitted-indent bullet prefix before placing a near-boundary chain',async()=>{
 const model=shortPage();model.pageWidth=200;
 model.pages[0].blocks=[{...paragraph('Filler'),spacingAfter:70},{...paragraph('Heading'),keepWithNext:true},{...paragraph('WWWWW WWWWW'),list:'bullet'}];
 const pages=pageTexts(await renderOffice(model,'pdf'));
 assert.equal(pages.length,2);assert.match(pages[0],/Filler/);assert.doesNotMatch(pages[0],/Heading|WWWWW/);
 assert.match(pages[1],/Heading.*WWWWW.*WWWWW/);
});
test('PDF keep-with-next uses the actual running multi-digit number in its wrap calculation',async()=>{
 const model=shortPage();Object.assign(model,{pageWidth:200,pageHeight:360});
 model.pages[0].blocks=[...Array.from({length:8},(_,i)=>({...paragraph('Item'+i),list:'number'})),{...paragraph('Nine'),list:'number',keepWithNext:true},{...paragraph('WWWWW WWWWW'),list:'number'}];
 const pages=pageTexts(await renderOffice(model,'pdf'));
 assert.equal(pages.length,2);assert.doesNotMatch(pages[0],/Nine|WWWWW/);assert.match(pages[1],/9\..*Nine.*10\..*WWWWW.*WWWWW/);
});
test('a chain taller than one PDF page falls back to normal progress without blank or repeated pages',{timeout:2000},async()=>{
 const model=shortPage();model.pages[0].blocks=[model.pages[0].blocks[0],...Array.from({length:8},(_,i)=>({...paragraph('Part'+i),keepWithNext:true})),paragraph('Last')];
 const pages=pageTexts(await renderOffice(model,'pdf'));
 assert.equal(pages.length,3);assert.ok(pages.every(value=>value.trim()));
 const text=pages.join(' ');for(const label of['Filler','Last',...Array.from({length:8},(_,i)=>'Part'+i)])assert.equal(text.split(label).length-1,1,label);
});
test('PowerPoint objects are actual OOXML geometry, fill, outline, text and shadow rather than a preview image',async()=>{let model=initial('pptx');const page=model.pages[0].id,shape={...newObject('rect'),fill:'#e11d48',x:144,strokeWidth:3,shadow:{color:'#000000',opacity:.4,blur:8,x:5,y:6}};model=applyOperations(model,[{op:'add-object',page,object:shape}]);const bytes=await renderOffice(model),zip=await Zip.loadAsync(bytes),slide=await zip.file('ppt/slides/slide1.xml').async('string');assert.match(slide,/val="e11d48"/i);assert.match(slide,/x="1828800"/);assert.match(slide,/w="38100"/);assert.match(slide,/outerShdw/);assert.match(slide,/Your presentation/);assert.equal((await inspectOffice(bytes)).requiresConversion,true);assert.deepEqual(await embeddedModel(await Zip.loadAsync(bytes)),model);});
test('Word contains editable Unicode rich runs, tables and explicit page settings in real document XML',async()=>{let model=initial('docx');const page=model.pages[0].id,block=model.pages[0].blocks[0];model=applyOperations(model,[{op:'update-block',page,id:block.id,patch:{runs:[{text:'Résumé 🌍',style:{...block.runs[0].style,fontSize:20,bold:true,color:'#2563eb'}}]}},{op:'add-block',page,block:{id:crypto.randomUUID(),type:'table',rows:newObject('table').rows}}]);const bytes=await renderOffice(model),zip=await Zip.loadAsync(bytes),document=await zip.file('word/document.xml').async('string');assert.match(document,/Résumé 🌍/);assert.match(document,/w:sz w:val="40"/);assert.match(document,/w:color w:val="2563eb"/i);assert.match(document,/<w:tbl>/);assert.match(document,/w:pgMar/);assert.deepEqual(await embeddedModel(await Zip.loadAsync(bytes)),model);});
test('Excel has native editable formulas, cached calculation, fonts, fills and number formats',async()=>{let model=initial('xlsx'),sheet=model.sheets[0].id;model=applyOperations(model,[{op:'paste-range',sheet,from:'A1',rows:[[2,'=SUM(A1:A2)*2'],[3,'Total']]},{op:'format-range',sheet,from:'A1',to:'B2',patch:{bold:true,fill:'#eff6ff',numberFormat:'currency'}}]);const bytes=await renderOffice(model),workbook=new Excel.Workbook();await workbook.xlsx.load(bytes);const actual=workbook.getWorksheet('Sheet1');assert.equal(actual.getCell('B1').formula,'SUM(A1:A2)*2');assert.equal(actual.getCell('B1').result,10);assert.equal(actual.getCell('A1').font.bold,true);assert.equal(actual.getCell('A1').fill.fgColor.argb,'FFeff6ff');assert.equal(actual.getCell('A1').numFmt,'"$"#,##0.00');assert.deepEqual(await embeddedModel(await Zip.loadAsync(bytes)),model);});
test('external files are parsed with conversion findings and changed visible content invalidates stale embedded source',async()=>{const bytes=await renderOffice(initial('pptx')),zip=await Zip.loadAsync(bytes),source=await zip.file('ppt/slides/slide1.xml').async('string');zip.file('ppt/slides/slide1.xml',source.replace('Your presentation','Changed in PowerPoint'));const changed=await zip.generateAsync({type:'nodebuffer'}),inspection=await inspectOffice(changed);assert.equal(inspection.requiresConversion,true);assert.ok(inspection.findings.some(value=>/no matching original-owned/.test(value.message)));assert.equal(inspection.model.pages[0].objects[0].runs.map(run=>run.text).join(''),'Changed in PowerPoint');});
test('macro and malicious XML packages are refused before parsing or publishing an editable copy',async()=>{const bytes=await renderOffice(initial('docx')),zip=await Zip.loadAsync(bytes);zip.file('word/vbaProject.bin',Buffer.from('not executed'));await assert.rejects(inspectOffice(await zip.generateAsync({type:'nodebuffer'})),/Macros/);zip.remove('word/vbaProject.bin');zip.remove('oshal/office.json');zip.file('word/document.xml','<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document/>');await assert.rejects(inspectOffice(await zip.generateAsync({type:'nodebuffer'})),/XML/);});
test('external Word break-before and inline page breaks preserve text order on the correct explicit page',async()=>{for(const[replacement,expected]of[['<w:p><w:pPr><w:pageBreakBefore/></w:pPr>',['Start writing']],['<w:p><w:r><w:t>Before</w:t><w:br w:type="page"/><w:t>After</w:t></w:r></w:p><w:p>',['Before','AfterStart writing']]]){const zip=await Zip.loadAsync(await renderOffice(initial('docx')));zip.remove('oshal/office.json');const source=await zip.file('word/document.xml').async('string');zip.file('word/document.xml',source.replace('<w:p>',replacement));const result=await inspectOffice(await zip.generateAsync({type:'nodebuffer'}));assert.deepEqual(result.model.pages.map(page=>page.blocks.flatMap(block=>block.runs?.map(run=>run.text)??[]).join('')),expected);}});
test('external text-bearing nonrectangular shapes and per-paint transparency require explicit loss findings',async()=>{const zip=await Zip.loadAsync(await renderOffice(initial('pptx')));zip.remove('oshal/office.json');let source=await zip.file('ppt/slides/slide1.xml').async('string');source=source.replace('prst="rect"','prst="ellipse"').replace(/<a:srgbClr val="([0-9A-Fa-f]+)"\/>/,'<a:srgbClr val="$1"><a:alpha val="50000"/></a:srgbClr>');zip.file('ppt/slides/slide1.xml',source);const result=await inspectOffice(await zip.generateAsync({type:'nodebuffer'}));assert.ok(result.findings.some(value=>/Text-bearing ellipse/.test(value.message)&&value.severity==='loss'));assert.ok(result.findings.some(value=>/transparency/.test(value.message)&&value.severity==='loss'));});
