/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Run the scan normalizer's node-fact contract (bounded scalars, pressure, placement, no fabricated facts). */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('the scan normalizer records bounded node facts and never fabricates absent ones',()=>{const r=spawnSync('python3',['-m','unittest','test_topology_nodes.py','-v'],{cwd:path.resolve(__dirname,'../lab'),encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/OK/);});
