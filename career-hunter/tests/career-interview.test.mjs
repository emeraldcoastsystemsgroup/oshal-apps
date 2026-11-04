/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the interview engine's real private-store and grounding contract in focused package CI.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const deps=createRequire(process.env.STORE_CI_TOOLCHAIN?resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'):new URL('../../scripts/toolchain/package.json',import.meta.url));
test('interview preparation keeps exact recorded evidence, private history and stale-plan/answer checks',()=>{
 const out=execFileSync(process.env.JOBHUNTER_PYTHON||'python3',[fileURLToPath(new URL('./career-interview-contract.py',import.meta.url))],{encoding:'utf8',timeout:30000});
 const result=JSON.parse(out.trim().split('\n').at(-1));assert.equal(result.checks,9);assert.deepEqual(result.failed,[]);
});
test('all interview UI, read and model actions have one matching permission and admitted API tool',()=>{
 const yaml=deps('js-yaml'),manifest=yaml.load(readFileSync(new URL('../oshal-app.yaml',import.meta.url),'utf8')),
  auth=yaml.load(readFileSync(new URL('../authorization.yaml',import.meta.url),'utf8'));
 for(const [name,endpoint,permission]of [['career_interview','GET /api/career-hunter/interview/{input.postingId}','career.read'],['career_interview_prepare','POST /api/career-hunter/interview/{input.postingId}/prepare','career.execute'],['career_interview_practice','POST /api/career-hunter/interview/{input.postingId}/practice','career.execute']]){
  const tool=manifest.tools.find(t=>t.name===name);assert.equal(tool.executor.apiEndpoint,endpoint);
  assert.deepEqual(auth.bindings.tools.filter(b=>b.id===name).map(b=>b.allOf),[[permission]]);
 }
 const routes=auth.bindings.http.filter(b=>b.id.startsWith('interview-'));
 assert.equal(routes.length,4);assert.deepEqual(routes.map(b=>b.allOf),[['app.open'],['career.read'],['career.execute'],['career.execute']]);
 assert.ok(manifest.routes.some(r=>r.module==='lib/career-interview-routes.js'&&r.auth==='oidc'));
 const persona=yaml.load(readFileSync(new URL('../personas/career-hunter.yaml',import.meta.url),'utf8'));
 for(const name of ['career_interview','career_interview_prepare','career_interview_practice','career_submission_review','career_submission_bind','career_submission_start','career_submissions','career_submission_sync'])assert.equal(persona.authorizations[name],'auto',name);
 for(const name of ['career_submission_approve','career_submission_answers'])assert.equal(persona.authorizations[name],'ask',name);
});
