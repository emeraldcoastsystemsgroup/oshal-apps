/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify compiled native learner GETs read existing issuer-bound identity and reward state without registration writes.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
const log = {info(){},warn(){},error(){},debug(){}};
const handlers = new Map();
Module._load = function(name, ...args) {
  if (name === '@/shared/logger') return {createChildLogger:() => log};
  if (name === 'express') return {Router:() => ({get(path,fn){handlers.set(path,fn);},post(path,fn){handlers.set(path,fn);},put(){}})};
  return original.call(this,name,...args);
};
const {resolveAuthedStudent, EducationAccessError} = require('../routes/education-access');
const {createEducationRewardsRoutes} = require('../routes/education-rewards-routes');
Module._load = original;
const learner = {student_id:'student-actual',email:'',name:'Learner',role:'student',tenant_id:'school',external_issuer:'https://issuer.test',external_id:'real-sub'};
const request = {method:'GET',oidc:{isAuthenticated:() => true,user:{iss:learner.external_issuer,sub:learner.external_id},idTokenClaims:{iss:learner.external_issuer}}};
function poolFixture(row = learner) {
  const calls = [];
  return {calls,storageModel:'kernel-scoped-documents',connect(){assert.fail('GET must not provision');},async query(text, values) {
    calls.push({text,values});
    if (/FROM lm_students\s+WHERE external_issuer/.test(text)) return {rows:row ? [row] : []};
    if (/SELECT boxes, inventory, equipped/.test(text)) return {rows:[{boxes:4,inventory:['mon-green'],equipped:{monster:'mon-green'}}]};
    if (/SELECT xp, level/.test(text)) return {rows:[{xp:240,level:3}]};
    if (/CREATE TABLE/.test(text)) return {rows:[]}; // Unrelated legacy registration DDL, excluded from read assertion below.
    assert.fail(`Unexpected learner GET mutation/query: ${text}`);
  }};
}
test('native GET uses verified issuer and subject, retains existing role and refuses unmapped users',async () => {
  const pool = poolFixture(); const result = await resolveAuthedStudent(request,pool);
  assert.equal(result.studentId,learner.student_id); assert.equal(result.role,'student');
  assert.deepEqual(pool.calls[0].values,[learner.external_issuer,learner.external_id]);
  await assert.rejects(resolveAuthedStudent(request,poolFixture(null)),error => error.status === 403);
});
test('compiled rewards GET returns persisted XP, inventory and equipment without creating or changing rows',async () => {
  const pool = poolFixture(); createEducationRewardsRoutes({pool}); pool.calls.length = 0;
  let body; const response = {json(value){body=value;},status(code){assert.fail(`Unexpected status ${code}`);}};
  await handlers.get('/rewards')(request,response);
  assert.equal(body.boxes,4); assert.equal(body.xp,240); assert.equal(body.level,3);
  assert.deepEqual(body.inventory,['mon-pink','mon-green']); assert.equal(body.equipped.monster,'mon-green');
  assert.ok(pool.calls.every(c => /^\s*SELECT\b/.test(c.text)), 'GET must contain only real SELECTs');
});

test('compiled reward operations preserve account setup refusals before any reward writes', async () => {
  const pool = poolFixture(null); createEducationRewardsRoutes({pool}); pool.calls.length = 0;
  for (const [path, method] of [['/rewards','GET'],['/rewards/open','POST'],['/rewards/equip','POST']]) {
    let status = 200; let body;
    const response = {status(code){status=code;return this;},json(value){body=value;}};
    // A native mutation must use the real setup resolver; reject before its transaction begins.
    const req = {...request,method};
    if (method === 'POST') pool.connect = async () => { throw new EducationAccessError('Open Little Monsters to complete school setup',403); };
    await handlers.get(path)(req,response);
    assert.equal(status,403); assert.match(body.error,/school setup/);
  }
  assert.ok(pool.calls.every(c => /^\s*SELECT\b/.test(c.text)), 'setup refusal must not modify rewards');
});
