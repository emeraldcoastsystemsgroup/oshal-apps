/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Check portable archive precision, real tar interoperability, closed-member attacks and full declared streaming capacity.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Refuse unsafe frame names and oversized render members before yielding bytes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeBundle, decodeBundle, BUNDLE_LIMITS, validateManifest, tarMember } from '../routes/portable-bundle.mjs';
import { stringifyNative } from '../tools/native-json.mjs';
const exec = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const image = Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const meta = (id, data) => ({ id, type: 'image/png', width: 1, height: 1, bytes: data.length, sha256: sha(data) });
async function bytesOf(stream) { const result = []; for await (const bytes of stream) result.push(bytes); return Buffer.concat(result); }
async function* chunks(bytes) { for (let n = 0; n < bytes.length; n += 8192) yield bytes.subarray(n, n + 8192); }
async function small() { const id = randomUUID(); const document = { items: { '18446744073709551615': { id: 18446744073709551615n, ticks: 9007199254740993n } } }; return { id, document, bytes: await bytesOf(encodeBundle({ title: 'Precise project', document, assets: [meta(id,image)] }, async () => image)) }; }
function checksum(block) { block.fill(32,148,156); const sum = block.reduce((a,b)=>a+b,0); block.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii'); }
test('native integer bits, raw member hashes and real GNU tar interoperability survive round trip', async () => {
  const source = await small(), parsed = await decodeBundle(chunks(source.bytes));
  assert.deepEqual(parsed.document, source.document); assert.deepEqual(parsed.assets[0].data, image); assert.equal(parsed.sha256, sha(source.bytes));
  const dir = await mkdtemp(join(tmpdir(), 'motion-tar-proof-'));
  try {
    const path = join(dir, 'project.motionbundle.tar'); await writeFile(path, source.bytes);
    const listing = (await exec('tar', ['-tf', path])).stdout.trim().split('\n');
    assert.deepEqual(listing, ['manifest.json','document.ecproj','assets/'+source.id+'.png']);
    assert.equal((await exec('tar', ['-xOf',path,'document.ecproj'])).stdout, stringifyNative(source.document));
    // Read a separate standard ustar producer without extracting archive names ourselves.
    await writeFile(join(dir,'manifest.json'),JSON.stringify(parsed.manifest)); await writeFile(join(dir,'document.ecproj'),stringifyNative(source.document));
    await import('node:fs/promises').then(async fs => { await fs.mkdir(join(dir,'assets')); await fs.writeFile(join(dir,'assets',source.id+'.png'), image); });
    const ordinary = join(dir,'ordinary.tar'); await exec('tar',['--format=ustar','-cf',ordinary,'-C',dir,'manifest.json','document.ecproj','assets/'+source.id+'.png']);
    assert.deepEqual((await decodeBundle(chunks(await readFile(ordinary)))).document, source.document);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('closed manifests refuse caller ownership, duplicate ids, paths and quota inflation', async () => {
  const source = await small(), { manifest } = await decodeBundle(chunks(source.bytes));
  for (const mutate of [m=>{m.owner='alice'},m=>{m.assets.push(m.assets[0])},m=>{m.assets[0].path='../photo.png'},m=>{m.assets[0].bytes=4194305},m=>{m.document.bytes=2097153}]) {
    const value=structuredClone(manifest);mutate(value);assert.throws(()=>validateManifest(value));
  }
});
test('links, unsafe names, corrupt headers/data, extra members and truncation refuse before path extraction', async () => {
  const source = await small();
  for (const mutate of [b=>{b[0]=46;b[1]=46;b[2]=47;checksum(b.subarray(0,512))},b=>{b[156]=50;checksum(b.subarray(0,512))},b=>{b[300]^=1},b=>{b[512]^=1}]) {
    const bytes=Buffer.from(source.bytes);mutate(bytes);await assert.rejects(decodeBundle(chunks(bytes)));
  }
  await assert.rejects(decodeBundle(chunks(source.bytes.subarray(0,source.bytes.length-512))));
  await assert.rejects(decodeBundle(chunks(Buffer.concat([source.bytes,Buffer.alloc(512,1)]))));
});
test('stream grant checks interrupt input and output and close the input iterator', async () => {
  const source=await small();let calls=0,closed=false;
  const input={async *[Symbol.asyncIterator](){try{yield* chunks(source.bytes);}finally{closed=true;}}};
  await assert.rejects(decodeBundle(input,async()=>{if(++calls===3)throw new Error('grant_withdrawn')}),/grant_withdrawn/);assert.equal(closed,true);
  calls=0;await assert.rejects(bytesOf(encodeBundle({title:'Held',document:source.document,assets:[meta(source.id,image)]},async()=>image,async()=>{if(++calls===4)throw new Error('source_withdrawn')})),/source_withdrawn/);
});
test('full 64-by-4MiB source capacity and a 2MiB precise document stream without a whole-archive buffer', async () => {
  // Codec capacity uses opaque PNG-signature fixture bytes; real raster/model validation is tested by the store suite.
  const payload=Buffer.alloc(4194304,19);image.subarray(0,8).copy(payload);
  const overhead=Buffer.byteLength(JSON.stringify({caption:''}));const document={caption:'x'.repeat(2097152-overhead)};
  const assets=Array.from({length:64},()=>meta(randomUUID(),payload));let total=0,maximum=0;
  async function* stream(){for await(const bytes of encodeBundle({title:'Complete capacity',document,assets},async()=>payload)){total+=bytes.length;maximum=Math.max(maximum,bytes.length);yield bytes;}}
  const parsed=await decodeBundle(stream());
  assert.equal(parsed.assets.length,64);assert.equal(Buffer.byteLength(stringifyNative(parsed.document)),2097152);
  assert.ok(total>258*1024*1024 && total<BUNDLE_LIMITS.archiveBytes);assert.ok(maximum<=65536);
  assert.equal(parsed.assets.reduce((sum,asset)=>sum+asset.data.length,0),256*1024*1024);
});
test('escaped duplicate JSON keys and non-ASCII disguised headers have no competing interpretation',async()=>{
  const source=await small(),length=parseInt(source.bytes.subarray(124,136).toString('ascii'),8),manifest=source.bytes.subarray(512,512+length).toString('utf8');
  const text=manifest.replace('{','{"\\u0076ersion":0,'),body=Buffer.from(text),first=Buffer.from(source.bytes.subarray(0,512));
  first.write(body.length.toString(8).padStart(11,'0')+'\0',124,12,'ascii');checksum(first);
  const changed=Buffer.concat([first,body,Buffer.alloc((512-body.length%512)%512),source.bytes.subarray(512+Math.ceil(length/512)*512)]);
  await assert.rejects(decodeBundle(chunks(changed)),error=>error.code==='motion_bundle_duplicate_key');
  const disguised=Buffer.from(source.bytes);disguised[0]|=128;checksum(disguised.subarray(0,512));
  await assert.rejects(decodeBundle(chunks(disguised)),error=>error.code==='motion_bundle_invalid_header');
});

test('render member writer refuses traversal, oversized data and non-byte values before any output',async()=>{
  for(const [name,data] of [['../frame.png',image],['frames/frame-1.png',image],['frames/frame-000000000000.png',Buffer.alloc(8*1024*1024+1)],['render.json','text']]) {
    let emitted=0;await assert.rejects((async()=>{for await(const chunk of tarMember(name,data))emitted+=chunk.length;})());assert.equal(emitted,0);
  }
  const valid=await bytesOf(tarMember('frames/frame-000000000000.png',image));assert.equal(valid.subarray(0,32).toString('ascii').replace(/\0+$/,''),'frames/frame-000000000000.png');
});
