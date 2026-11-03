/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Run the package's native proof in an explicitly supplied kernel and disposable database. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
test('native kernel runs the prep migrations, shared bank and private learning workflow',()=>{
 const kernel=process.env.OSHAL_NATIVE_KERNEL_ROOT;
 assert.ok(kernel,'OSHAL_NATIVE_KERNEL_ROOT must name the native kernel checkout');
 assert.ok(process.env.OSHAL_TEST_POSTGRES,'OSHAL_TEST_POSTGRES must explicitly name a disposable loopback database');
 const name='lm_prep_package_'+process.pid, target=path.join(kernel,'crates/oshald/tests',name+'.rs');
 fs.writeFileSync(target,fs.readFileSync(path.join(__dirname,'native-prep.rs')),{flag:'wx'});
 try {
  const result=cp.spawnSync('cargo',['test','--locked','-p','oshald','--test',name,'--','--nocapture'],{
   cwd:kernel,env:{...process.env,OSHAL_LM_PACKAGE_SOURCE:path.resolve(__dirname,'../..')},encoding:'utf8',timeout:290000,maxBuffer:8*1024*1024});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,(result.stdout||'')+'\n'+(result.stderr||''));
  assert.match(result.stdout,/1 passed; 0 failed/);
 } finally {fs.unlinkSync(target);}
});
