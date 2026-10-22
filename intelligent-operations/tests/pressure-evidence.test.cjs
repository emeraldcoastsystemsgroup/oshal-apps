/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Run actual Python evidence boundary tests through the package gate. */
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('pressure and preprocessed evidence obey actual resource, identity and script boundaries',()=>{
 const run=spawnSync('python3',[path.join(__dirname,'pressure_evidence_test.py')],{encoding:'utf8',timeout:30000});
 assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stderr,/Ran 5 tests/);
});
