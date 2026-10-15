/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove agent batch atomicity, lock enforcement, source restrictions and real vector booleans with the editor model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankProject, applyAgentOperations, editingContract } from '../../tools/editor/agent-tools.mjs';
const text = { type: 'add', layer: { id: 'heading', type: 'text', text: 'Hello', x: 10, y: 10, w: 100, h: 50 } };
test('agent batch edits an independent document; one invalid operation discards the entire batch', () => {
 const original=blankProject({title:'Agent proof',width:320,height:240}), before=JSON.stringify(original);
 const result=applyAgentOperations(original,[text,{type:'update',id:'heading',patch:{text:'Changed'}}]);
 assert.equal(result.layers[0].text,'Changed');assert.equal(JSON.stringify(original),before);
 assert.throws(()=>applyAgentOperations(original,[text,{type:'update',id:'absent',patch:{text:'Bad'}}]));
 assert.equal(JSON.stringify(original),before);
});
test('locked layers, foreign operation fields, inline assets and large/empty batches refuse', () => {
 const original=applyAgentOperations(blankProject({title:'Locks'}),[{...text,layer:{...text.layer,locked:true}}]);
 for(const ops of [[{type:'update',id:'heading',patch:{x:20}}],[{type:'project',patch:{name:'x'},owner:'bob'}],[],Array(17).fill(text),[{type:'exec',code:'anything'}]])assert.throws(()=>applyAgentOperations(original,ops));
 assert.throws(()=>applyAgentOperations(original,[{type:'add',layer:{type:'image',id:'photo',assetId:'asset',x:0,y:0,w:1,h:1},images:{asset:{src:'data:image/png;base64,AAAA',width:1,height:1}}}]));
});
test('agent computes real boolean geometry and retains both source paths', () => {
 const path=(id,x)=>({type:'add',layer:{id,type:'path',x,y:0,w:100,h:100,fill:'#ff0000',contours:[{closed:true,nodes:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}]}});
 const original=applyAgentOperations(blankProject({title:'Vector'}),[path('a',0),path('b',50)]);
 const result=applyAgentOperations(original,[{type:'boolean',ids:['a','b'],mode:'union'}]);
 assert.equal(result.layers.length,3);assert.deepEqual(result.layers.slice(0,2).map(x=>x.visible),[false,false]);
 assert.equal(result.layers[2].w,150);assert.deepEqual(result.layers[2].sourceIds,['a','b']);
 assert.deepEqual(original.layers.map(x=>x.visible),[true,true]);
 assert.throws(()=>applyAgentOperations(original,[{type:'boolean',ids:['a','b'],mode:'union'},{type:'boolean',ids:['a','b'],mode:'union'}]));
});
test('agent contract examples match the implemented basic document and operation schema', () => {
 const contract=editingContract(),version=/^version: ([0-9]+\.[0-9]+\.[0-9]+)$/m.exec(readFileSync(new URL('../../oshal-app.yaml',import.meta.url),'utf8'))?.[1];
 assert.ok(version);assert.equal(contract.sourceVersion,version);assert.equal(contract.operationSchema.properties.type.enum.includes('mask'),true);
 const value=applyAgentOperations(blankProject({title:'Examples'}),contract.examples.slice(0,3));assert.equal(value.layers[1].type,'adjustment');
 assert.ok(contract.unsupported.includes('PDF workbench'));
});

test('agent duplicates a nested group through the same operation and an invalid followup publishes no partial document', () => {
 let original=blankProject({title:'Nested copies',width:200,height:200});
 original=applyAgentOperations(original,[
  ...['a','b','c'].map((id,index)=>({type:'add',layer:{id,type:'rect',x:index*20,y:0,w:20,h:20,fill:'#ff0000'}})),
  {type:'group',ids:['a','b'],id:'inner'},{type:'group',ids:['inner','c'],id:'outer'}]);
 const before=JSON.stringify(original), operation={type:'duplicate',id:'outer',newId:'copy',offset:50};
 const copied=applyAgentOperations(original,[operation]);
 assert.equal(copied.layers.length,10);
 assert.equal(copied.layers.find(layer=>layer.id==='copy').x,50);
 assert.ok(copied.layers.filter(layer=>layer.id.startsWith('copy:')).every(layer=>!original.layers.some(source=>source.id===layer.id)));
 assert.equal(JSON.stringify(original),before);
 assert.throws(()=>applyAgentOperations(original,[operation,{type:'update',id:'missing',patch:{x:1}}]),/does not exist/);
 assert.equal(JSON.stringify(original),before);
 assert.match(editingContract().conventions.duplicate,/nested groups/);
});
