import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {formatName,openGenerationAssistant,previousFileRows,previousFileUrl} from '../tools/office/entry-actions.mjs';

test('Generate opens the same document concierge with a relevant unsent prompt for each Office format',()=>{
 for(const [kind,name]of [['pptx','PowerPoint presentation'],['docx','Word document'],['xlsx','Excel workbook']]){
  const calls=[],model=Object.freeze({kind,title:'Quarterly plan'}),input={value:'',focus(){calls.push('focus')},setSelectionRange(start,end){assert.equal(start,this.value.length);assert.equal(end,start)}};
  openGenerationAssistant({foundation:{showPanel:panel=>calls.push(panel)},element:{querySelector:selector=>{assert.equal(selector,'textarea');return input}},model});
  assert.deepEqual(calls,['ai','focus']);assert.ok(input.value.includes(name));assert.match(input.value,/Quarterly plan.*open document/);assert.deepEqual(model,{kind,title:'Quarterly plan'});
  input.value='Keep the chart, add our new forecast.';openGenerationAssistant({foundation:{showPanel(){}},element:{querySelector:()=>input},model});assert.equal(input.value,'Keep the chart, add our new forecast.','a typed request is never replaced');
 }
 const input={value:'',focus(){},setSelectionRange(){}};openGenerationAssistant({foundation:{showPanel(){}},element:{querySelector:()=>input},model:{kind:'pptx',title:'Untitled presentation'}});assert.equal(input.value,'Create the content in this open PowerPoint presentation about ');
});

test('historical files remain selectable as original Office files with safe download targets',()=>{
 const deck={fileName:'original.pptx',downloadUrl:'/api/files/original.pptx'},word={file_name:'old.docx',url:'https://owned-storage.example/file'},bad={fileName:'not-office.exe',url:'javascript:alert(1)'};
 assert.deepEqual(previousFileRows({decks:[deck,word,bad,null]}),[deck,word]);assert.equal(previousFileUrl(deck,'https://example.test/office').href,'https://example.test/api/files/original.pptx');assert.equal(previousFileUrl(word,'https://example.test/').origin,'https://owned-storage.example');
 for(const url of ['javascript:alert(1)','data:text/html,hello','https://user:password@example.test/file',''])assert.throws(()=>previousFileUrl({url},'https://example.test/'),/usable download URL/);
});

test('the Office screen exposes all three formats and Generate has no legacy navigation target',async()=>{
 const html=await readFile(new URL('../tools/office/editor.html',import.meta.url),'utf8');
 assert.match(html,/<button id="generate-document" type="button">Generate<\/button>/);assert.doesNotMatch(html,/legacy=1|office-generation-link/);
 const menu=html.match(/<details id="office-file-menu"[\s\S]*?<\/details>/)[0];assert.doesNotMatch(menu,/id="new-kind"/,'format selection remains visible outside File on mobile');
 for(const kind of ['pptx','docx','xlsx']){assert.ok(formatName(kind));assert.ok(html.includes('value="'+kind+'"'));}
 assert.match(html,/id="document-title" aria-label="Document title"/);assert.match(html,/id="office-previous-files"/);
});
