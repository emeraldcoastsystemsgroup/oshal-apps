/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Office entry actions: generation stays in the open document, previous generated files are bounded, and the screen offers all three formats.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.19.0: the three formats come from the New menu (design.mjs), not a Format select; Generate is "Generate a draft" in Insert and the Concierge.
 */
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

test('the Office screen offers all three formats from New, and Generate has no legacy navigation target',async()=>{
 const html=await readFile(new URL('../tools/office/editor.html',import.meta.url),'utf8'),design=await readFile(new URL('../tools/office/design.mjs',import.meta.url),'utf8');
 assert.match(html,/<button id="generate-document" type="button">Generate a draft<\/button>/);assert.doesNotMatch(html+design,/legacy=1|office-generation-link/);
 assert.doesNotMatch(html,/id="new-kind"/,'2.19.0: no Format select; New is a menu (design standard §5.1)');
 for(const[kind,label]of [['docx','Blank document'],['pptx','Presentation'],['xlsx','Spreadsheet']]){assert.ok(formatName(kind));assert.ok(design.includes("{label:'"+label+"',id:'new-"+kind+"',run:()=>startNew('"+kind+"')}"),label+' is in the New menu');}
 assert.match(html,/id="document-title" aria-label="Document name"/);assert.match(html,/id="office-previous-files"/);
});
