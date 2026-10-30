/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove late-field discovery, literal queries, exact values, byte-bounded pagination and explicit oversized-item refusal.
 * This deterministic reader proof does not qualify native permissions or a configured provider.
 */
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID}from'node:crypto';
import {findFormFields,LOOKUP_BYTES}from'../routes/form-lookup.mjs';
const document=fields=>({id:randomUUID(),revision:7,inspection:{fields}});
const field=(name,value='saved')=>({name,type:'Tx',value,supported:true});
test('a requested late name field is found directly and retains exact saved value and native index',()=>{
 const doc=document([...Array.from({length:40},(_,i)=>field('source.other'+i)),field('namespace.name','Current manual value')]);
 const before=structuredClone(doc),result=findFormFields(doc,{query:'NAME'});assert.deepEqual(result.fields,[{index:40,name:'namespace.name',type:'Tx',value:'Current manual value',supported:true}]);assert.equal(result.total,1);assert.equal(result.nextOffset,null);assert.equal(result.revision,7);assert.deepEqual(doc,before);
});
test('literal query and byte pagination retain complete values without duplicate or omitted fields',()=>{
 const doc=document(Array.from({length:20},(_,i)=>field('namespace.[name]'+i,'x'.repeat(3000))));let offset=0;const seen=[];
 do{const result=findFormFields(doc,{query:'[NAME]',offset:String(offset)});assert.ok(Buffer.byteLength(JSON.stringify(result))<=LOOKUP_BYTES);assert.ok(result.fields.length>0&&result.fields.length<=8);for(const item of result.fields){assert.equal(item.value,'x'.repeat(3000));seen.push(item.index);}offset=result.nextOffset;}while(offset!==null);
 assert.deepEqual(seen,Array.from({length:20},(_,i)=>i));assert.equal(findFormFields(doc,{query:'.*'}).total,0);
});
test('invalid selectors and an oversized single field are refused instead of clipped or retried forever',()=>{
 const doc=document([field('namespace.name','😀'.repeat(4096))]);
 for(const query of ['', ' ',null,[], 'x'.repeat(129),'name\0'])assert.throws(()=>findFormFields(doc,{query}),/pdf_invalid_field_query/);
 for(const offset of ['-1','0.5','257','no'])assert.throws(()=>findFormFields(doc,{query:'name',offset}),/pdf_invalid_number/);
 assert.throws(()=>findFormFields(doc,{query:'name'}),/pdf_field_lookup_item_limit/);assert.throws(()=>findFormFields(doc,{query:'missing',offset:'1'}),/pdf_invalid_field_offset/);
});
