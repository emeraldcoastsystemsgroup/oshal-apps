/** Exercise the actual model-visible text example through owned SQL and the genuine compositor. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startApplicationFixture} from './application-fixture.mjs';
import {readProject,stringifyNative} from '../tools/native-json.mjs';
const deps=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'));
const manifest=deps('js-yaml').load(await readFile(new URL('../oshal-app.yaml',import.meta.url),'utf8'));
const tool=manifest.tools.find(item=>item.name==='motion-apply-exact-edits');
const description=tool.description;
const example=JSON.parse(description.split('Example: ')[1].split(' The example IDs')[0]);
let fixture;
before(async()=>{fixture=await startApplicationFixture();});
after(async()=>{await fixture?.close();});
async function call(path,body,status=200){const response=await fetch(fixture.origin+'/api/motion-studio'+path,{method:body===undefined?'GET':'POST',headers:{'x-fixture-user':'alice',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
const composition=project=>Object.values(project.document.items).find(item=>item.kind.type==='Comp');
const textValue=project=>composition(project).kind.layers[0].props.children.find(item=>item.match==='text').children.find(item=>item.match==='sourceText').value.v;

test('the actual native description and bounded contract expose the same approval-held executable shape',async()=>{
 assert.equal(tool.defaultAuthMode,'ask');assert.equal(tool.requiresApproval,true);
 assert.match(description,/Invoke this tool to prepare the real native approval card/);
 const contract=await call('/agent-contract');assert.deepEqual(contract.textReplacement.example,example);
 assert.ok(Buffer.byteLength(JSON.stringify(contract))<60*1024);
 assert.equal(JSON.parse(example.commandsJson)[0].params.range,undefined,'Whole replacement needs no guessed character range');
});

for(const text of ['Seed native title','A😀B','Styled Ω'])test('model-visible whole-text example preserves typography and strict ranges for '+JSON.stringify(text),async()=>{
 let project=readProject((await call('/projects',{title:'Contract text example',width:320,height:180,frameRate:30,duration:5,requestKey:randomUUID()})).project);
 try{
  project=readProject((await call('/projects/'+project.id+'/operations',{baseRevision:project.revision,requestKey:randomUUID(),compId:String(composition(project).id),commandsJson:JSON.stringify([{command:'layer.newText',params:{text,font:'Inter',size:24,fill:'#cc3366',position:[140,80]}}])})).project);
  const compId=String(composition(project).id),layer=String(composition(project).kind.layers[0].id),before=structuredClone(project.document);
  const actual=await call('/projects/'+project.id+'/revisions/'+project.revision+'/text/'+compId+'/'+layer+'/0/bounded');
  assert.equal(actual.text.value.text,text);assert.equal(actual.text.characterCount,Array.from(text).length);
  const input=structuredClone(example);Object.assign(input,{id:project.id,baseRevision:project.revision,requestKey:randomUUID(),compId});
  const commands=JSON.parse(input.commandsJson);commands[0].params.layer=layer;commands[0].params.compTimeTicks=actual.text.compTimeTicks;input.commandsJson=JSON.stringify(commands);
  const receipt=(await call('/projects/'+project.id+'/operations',input)).project;assert.equal(receipt.revision,project.revision+1);
  project=readProject((await call('/projects/'+project.id)).project);assert.equal(textValue(project).text,'Updated native title');
  const after=structuredClone(project.document);const clear=document=>{const item={document};delete textValue(item).text;};clear(before);clear(after);assert.deepEqual(after,before,'Every other native field, key and typographic value remains unchanged');
  const invalid=structuredClone(input);invalid.baseRevision=project.revision;invalid.requestKey=randomUUID();const bad=JSON.parse(invalid.commandsJson);bad[0].params.range=[0,Array.from(textValue(project).text).length+1];invalid.commandsJson=JSON.stringify(bad);
  await call('/projects/'+project.id+'/operations',invalid,400);const unchanged=readProject((await call('/projects/'+project.id)).project);assert.equal(unchanged.revision,project.revision);assert.equal(stringifyNative(unchanged.document),stringifyNative(project.document));
 }finally{const response=await fetch(fixture.origin+'/api/motion-studio/projects/'+project.id,{method:'DELETE',headers:{'x-fixture-user':'alice'}});assert.equal(response.status,200);}
});
