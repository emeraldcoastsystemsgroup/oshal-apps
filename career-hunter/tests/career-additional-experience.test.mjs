/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Optional work remains separate from the core across actual packet generation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.21: raise spawnSync timeout from 20 s to 120 s so multi-packet LibreOffice OOXML rendering inside career-additional-experience-contract.py does not time out under parallel store CI load.
 */
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync}from 'node:child_process';import {fileURLToPath}from 'node:url';
test('selected additional experience is truthful, optional, rendered and revision checked',()=>{const run=spawnSync(process.env.CAREER_PYTHON||'python3',[fileURLToPath(new URL('./career-additional-experience-contract.py',import.meta.url))],{encoding:'utf8',timeout:120000});assert.equal(run.status,0,run.stderr+run.stdout);assert.deepEqual(JSON.parse(run.stdout),{checks:8,failed:[]});});
