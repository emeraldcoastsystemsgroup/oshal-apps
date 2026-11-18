/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Share the exact native closure and digest reader so read-only, research and account-value guards check every declared version while retaining the approved version-one bytes.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const LEGACY_ROOTS=['routes/trading-native-management.js','routes/live/management.js'];
const LEGACY_DIGEST='49adb4981cf33da65776bb214d6445e3b895a2fb3c5d134c3462cea83d98a117';
const LOADERS=new Set(['fs','fs/promises','vm','module','child_process','worker_threads','wasi','inspector','repl']);
const UNFOLLOWABLE=/\bimport[ \t\r\n]*\(|^[ \t]*import[ \t{*]|\b(eval|Function)[ \t\r\n]*\(|require\.resolve|module\.require|createRequire|process\.(binding|dlopen)/m;

/** @description Read actual manifest roots, preserving the native flat declaration's version-one compatibility.
 * @param {string} root Package directory. @returns {object} Explicit version-to-source mappings. */
function versions(root){
 const dependency=process.env.STORE_CI_TOOLCHAIN||path.resolve(root,'../scripts/toolchain');
 const yaml=require(require.resolve('js-yaml',{paths:[dependency,root]}));
 const declared=yaml.load(fs.readFileSync(path.join(root,'oshal-app.yaml'),'utf8')).orderAuthority;
 assert.ok(declared&&typeof declared==='object');
 const held=declared.versions||{'1':declared};
 assert.ok(Object.keys(held).length,'at least one authority version must be declared');
 for(const [version,value] of Object.entries(held)){
  assert.match(version,/^[1-9][0-9]*$/);assert.ok(Array.isArray(value.sources)&&value.sources.length);
 }
 return Object.fromEntries(Object.entries(held).map(([version,value])=>[version,value.sources]));
}

/** @description Follow literal relative loads from actual package bytes using the native closure's admission rules.
 * @param {string} root Package directory. @param {string[]} roots Declared modules.
 * @param {Map<string,Buffer>} overrides Synthetic mutation bytes. @returns {Map<string,Buffer>} Exact closure. */
function closure(root,roots,overrides=new Map()){
 const files=new Map(),pending=[...roots];
 while(pending.length){
  const relative=pending.pop();if(files.has(relative))continue;
  assert.ok(!relative.startsWith('../')&&!path.isAbsolute(relative));
  const bytes=overrides.get(relative)||fs.readFileSync(path.join(root,relative));files.set(relative,bytes);
  if(relative.endsWith('.json'))continue;
  const text=bytes.toString('utf8');assert.doesNotMatch(text,UNFOLLOWABLE,relative);
  const loads=[...text.matchAll(/\brequire[ \t\r\n]*\([ \t\r\n]*(['"])([^'"\n]+)['"][ \t\r\n]*\)/g)].map(m=>m[2]);
  assert.equal((text.match(/\brequire[ \t\r\n]*\(/g)||[]).length,loads.length,relative+' has a computed load');
  for(const spec of loads){
   if(spec.startsWith('node:')){assert.ok(!LOADERS.has(spec.slice(5)),relative);continue;}
   if(spec.startsWith('@/'))continue;
   assert.ok(spec.startsWith('./')||spec.startsWith('../'),relative+' has a bare load');
   const base=path.posix.normalize(path.posix.join(path.posix.dirname(relative),spec));
   assert.ok(!base.startsWith('../'),relative+' leaves the package');
   const hit=[base,base+'.js',base+'.cjs',base+'.json',base+'/index.js'].find(p=>fs.existsSync(path.join(root,p))&&fs.statSync(path.join(root,p)).isFile());
   assert.ok(hit,relative+' has an unresolved load '+spec);pending.push(hit);
  }
 }
 return files;
}

function u64(value){const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(value));return bytes;}

/** @description Hash the native export's exact sorted roots, framed names and file hashes.
 * @param {string} root Package directory. @param {string[]} roots Declared modules.
 * @param {Map<string,Buffer>} overrides Synthetic mutation bytes. @returns {string} SHA256 authority. */
function digest(root,roots,overrides){
 const declared=[...new Set(roots)].sort(),files=closure(root,declared,overrides);
 const hash=crypto.createHash('sha256').update('oshal-order-authority-v1\0');
 for(const source of declared)hash.update(u64(Buffer.byteLength(source))).update(source);
 hash.update('\0closure\0');
 for(const [relative,bytes] of [...files].sort(([a],[b])=>a<b?-1:a>b?1:0))
  hash.update(u64(Buffer.byteLength(relative))).update(relative).update(u64(bytes.length)).update(crypto.createHash('sha256').update(bytes).digest());
 return hash.digest('hex');
}

/** @description Require the approved legacy roots, all twenty-nine files and the exact original native digest.
 * @param {string} root Package directory. @returns {object} Every supported version's roots for exclusion guards. */
function preservedLegacy(root){
 const all=versions(root);assert.deepEqual(all['1'],LEGACY_ROOTS);
 assert.equal(closure(root,all['1']).size,29,'the approved version-one closure stays at twenty-nine files');
 assert.equal(digest(root,all['1']),LEGACY_DIGEST,'the approved version-one bytes stay unchanged');
 return all;
}
module.exports={versions,closure,digest,preservedLegacy,LEGACY_ROOTS,LEGACY_DIGEST};
