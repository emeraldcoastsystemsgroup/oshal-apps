/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Register the one-time operator communication guard's real filesystem/native-boundary tests; no external sends occur in the suite. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('authorized communication harness reserves before possible sends, holds unknowns, mutes test routes and refuses duplicates',()=>{
 const result=spawnSync('python3',['-m','unittest','test_communications.py','-v'],{cwd:path.resolve(__dirname,'../lab'),encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stderr,/Ran 5 tests/);assert.match(result.stderr,/OK/);
});
