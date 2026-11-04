/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove agent batch atomicity, lock enforcement, source restrictions and real vector booleans with the editor model.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.15.3: Jarvis asked for a white background and every new project was refused. Colour names become hex under colour fields only; unknown names are still refused.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.16.0: a slip in an approved new layer no longer refuses the batch: fields its type lacks are dropped and a colour that is not one falls to the default; a bad type and an update stay refused.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.15.4: the three batches the local model drew were refused only after approval. The schema the kernel checks before holding a card states each rule the validator refuses, and the worked drawing in the contract is itself valid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankProject, applyAgentOperations, editingContract, operationSchema } from '../../tools/editor/agent-tools.mjs';
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

test('a colour named in words becomes the hex the editor stores, only under a colour field', () => {
 assert.equal(blankProject({title:'Cartoon Rocket Ship',width:800,height:600,background:'white'}).background,'#ffffff');
 assert.equal(blankProject({title:'Sky',background:'Sky Blue'}).background,'#87ceeb');
 assert.equal(blankProject({title:'Clear'}).background,'transparent');
 assert.throws(()=>blankProject({title:'Odd',background:'chartreuse-ish'}),/Use a hex color or transparent/);
 const hull={type:'add',layer:{id:'hull',type:'rect',name:'red',x:300,y:120,w:200,h:360,fill:'red',stroke:'Black'}};
 const label={type:'add',layer:{id:'label',type:'text',text:'white',x:10,y:10,w:100,h:40,fill:'navy'}};
 const result=applyAgentOperations(blankProject({title:'Rocket'}),[hull,label]);
 assert.equal(result.layers[0].fill,'#ff0000');assert.equal(result.layers[0].stroke,'#000000');assert.equal(result.layers[0].name,'red');
 assert.equal(result.layers[1].text,'white','words that are not a colour field stay as written');assert.equal(result.layers[1].fill,'#000080');
});

test('the schema checked before a card is held states what the validator refuses, and the worked drawing is valid', () => {
 const base=blankProject({title:'Rocket',width:800,height:1000,background:'#ffffff'});
 const layer=operationSchema.properties.layer.properties, node=layer.contours.items.properties.nodes;
 assert.deepEqual(new Set(layer.type.enum),new Set(['image','text','rect','ellipse','freehand','adjustment','group','path']));
 assert.equal(node.minItems,2);assert.equal(node.items.properties.y.maximum,1);assert.equal(node.items.properties.x.minimum,0);
 const path=nodes=>({type:'add',layer:{id:'p',type:'path',x:0,y:0,w:10,h:10,contours:[{closed:true,nodes}]}});
 assert.throws(()=>applyAgentOperations(base,[{type:'add',layer:{id:'hull',type:'shape',x:0,y:0,w:1,h:1}}]),/Unsupported layer type/);
 assert.throws(()=>applyAgentOperations(base,[path([{x:.5,y:.3}])]),/2 to 2000 nodes/);
 assert.throws(()=>applyAgentOperations(base,[path([{x:0,y:0},{x:.5,y:1.1}])]),/Node y is out of range/);
 const contract=editingContract(), drawing=contract.examples.filter(example=>['hull','window','flame'].includes(example.layer?.id));
 assert.equal(drawing.length,3);assert.deepEqual(applyAgentOperations(base,drawing).layers.map(item=>item.name),['Hull','Window','Flame']);
 assert.match(contract.conventions.drawing,/no asset is needed/);
});

test('a slip in an approved new layer is forgiven, and what is saved is still the editor\'s own', () => {
 const base=blankProject({title:'Rocket'});
 const add={type:'add',layer:{id:'hull',type:'rect',name:'Hull',text:'hull',color:'red',x:1,y:2,w:3,h:4,fill:'rocket red',stroke:'dark gray'}};
 const [hull]=applyAgentOperations(base,[add]).layers;
 assert.equal(hull.fill,'#3b82f6','an unreadable colour falls to the default');assert.equal(hull.stroke,'#a9a9a9');assert.equal('text' in hull,false);assert.equal('color' in hull,false);
 assert.throws(()=>applyAgentOperations(base,[{type:'add',layer:{id:'x',type:'shape',x:0,y:0,w:1,h:1}}]),/Unsupported layer type/);
 const saved=applyAgentOperations(base,[{type:'add',layer:{id:'r',type:'rect',x:0,y:0,w:1,h:1}}]);
 assert.throws(()=>applyAgentOperations(saved,[{type:'update',id:'r',patch:{fill:'rocket red'}}]),/Use a hex color or transparent/,'an edit to an existing layer stays exact');
});
