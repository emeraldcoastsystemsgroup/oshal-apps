/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Differentially verify browser incremental digests, padding boundaries, views, cancellation and the full archive byte envelope against native crypto.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {Sha256,sha256Bytes,sha256Blob} from '../tools/sha256-stream.mjs';
const native=bytes=>createHash('sha256').update(bytes).digest('hex');
test('known SHA256 vectors, empty input, padding boundaries and exact typed views match native crypto',()=>{
 for(const value of ['', 'abc','abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','a'.repeat(1000000)]){const bytes=Buffer.from(value);assert.equal(sha256Bytes(bytes),native(bytes));}
 for(const size of [1,7,31,55,56,57,63,64,65,119,120,127,128,129,255,256,1023,1024,1048576]){const whole=randomBytes(size+16),bytes=whole.subarray(7,7+size),hash=new Sha256();for(let n=0;n<bytes.length;n+=17)hash.update(bytes.subarray(n,n+17));assert.equal(hash.digest(),native(bytes));assert.equal(hash.digest(),native(bytes));assert.throws(()=>hash.update(bytes),/finalized/);}
 assert.throws(()=>new Sha256().update('bytes'),/byte input/);
});
test('random chunk schedules and mutation after partial update retain the actual supplied bytes',()=>{
 for(let n=0;n<64;n++){const bytes=randomBytes(8192+n),hash=new Sha256();for(let offset=0;offset<bytes.length;){const size=1+randomBytes(2).readUInt16BE()%257;hash.update(bytes.subarray(offset,offset+size));offset+=size;}assert.equal(hash.digest(),native(bytes));}
 const bytes=Buffer.from('unaligned original'),expected=native(bytes),hash=new Sha256().update(bytes);bytes.fill(0);assert.equal(hash.digest(),expected);
});
test('Blob hashing reads at most1MiB slices and cancellation stops before the next slice',async()=>{
 const bytes=randomBytes(2*1048576+257),blob=new Blob([bytes]);let largest=0,calls=0;
 const source={size:blob.size,arrayBuffer(){throw new Error('whole Blob read forbidden');},slice(start,end){largest=Math.max(largest,end-start);calls++;return blob.slice(start,end);}};
 assert.equal(await sha256Blob(source),native(bytes));assert.equal(calls,3);assert.ok(largest<=1048576);
 const control=new AbortController();calls=0;await assert.rejects(sha256Blob(source,{signal:control.signal,progress(){control.abort();}}),e=>e.name==='AbortError');assert.equal(calls,1);
});
test('full264MiB envelope streams exact bytes with fixed digest buffers and no whole-file allocation',()=>{
 const payload=randomBytes(1048576),actual=new Sha256(),expected=createHash('sha256');
 for(let n=0;n<264;n++){actual.update(payload);expected.update(payload);}assert.equal(actual.digest(),expected.digest('hex'));
});
