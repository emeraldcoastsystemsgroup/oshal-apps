/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Differentially reconstruct arbitrary Unicode replacements and prove fixed small transport for large native strings.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';import {randomInt} from 'node:crypto';
import {valueChange} from '../tools/value-patch.mjs';
test('minimal native text changes preserve UTF16 Unicode boundaries, arbitrary edits and non-string values',()=>{
 const cases=[['',''],['','😀'],['😀',''],['😀x','😁x'],['a😀b','a😀c'],['ab😀','ab😁'],['a😀a','a😁a'],['a','abc'],['abc','a']];
 const alphabet=['a','b','\n','😀','😁','中','é','𝄞'];for(let n=0;n<1000;n++){const text=()=>Array.from({length:randomInt(0,60)},()=>alphabet[randomInt(alphabet.length)]).join('');cases.push([text(),text()]);}
 for(const [a,b]of cases){const p=valueChange('18446744073709550001',a,b).textPatch;assert.equal(a.slice(0,p.start)+p.text+a.slice(p.end),b);for(const end of [p.start,p.end])assert.ok(!(end>0&&/[\uD800-\uDBFF]/.test(a[end-1])&&/[\uDC00-\uDFFF]/.test(a[end]??'')));}
 assert.deepEqual(valueChange('9',1,2),{prop:'9',value:2});assert.deepEqual(valueChange('9',[1,2],[3,4]),{prop:'9',value:[3,4]});
});
test('a small edit to a nearly full native document sends only the changed text',()=>{
 const a='😀'.repeat(200000)+'\nLUT_1D_SIZE 2\n0 0 0\n0 0 0\n',b=a+'# saved\n',p=valueChange('1',a,b);assert.equal(p.textPatch.text,'# saved\n');assert.ok(Buffer.byteLength(JSON.stringify(p))<128);assert.equal(p.textPatch.start,a.length);
});
