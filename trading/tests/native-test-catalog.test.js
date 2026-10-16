/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Require every maintained Trading suite to remain discoverable in the embedded Test Lab catalog.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const roots=[__dirname,path.resolve(__dirname,'../../scripts/toolchain'),...(process.env.OSHAL_FRAMEWORK?[path.resolve(process.env.OSHAL_FRAMEWORK)]:[])];
const yaml=require(require.resolve('js-yaml',{paths:roots}));
test('every maintained Trading suite is registered with literal existing files and unique case identities',()=>{
 const catalog=yaml.load(fs.readFileSync(path.join(__dirname,'test-lab.yaml'),'utf8'));
 const ids=new Set(),registered=new Set();
 for(const c of catalog.cases){
  assert.ok(!ids.has(c.id),'duplicate case '+c.id);ids.add(c.id);
  for(const file of c.runner.files||[]){
   assert.match(file,/^tests\/[^/]+\.(?:test\.[cm]?js|spec\.ts)$/);
   assert.ok(fs.statSync(path.resolve(__dirname,'..',file)).isFile(),file+' exists');registered.add(file);
  }
 }
 const maintained=fs.readdirSync(__dirname).filter(n=>/\.(?:test\.[cm]?js|spec\.ts)$/.test(n));
 assert.ok(maintained.length>0);
 assert.deepEqual(maintained.filter(n=>!registered.has('tests/'+n)),[],'maintained suites missing from Test Lab');
});
