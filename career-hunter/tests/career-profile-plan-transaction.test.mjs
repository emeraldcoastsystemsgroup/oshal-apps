/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove frozen profile assets retain exact bytes and uploads cannot race draft approval across the shared storage lane.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep the profile fixture aligned with monotonic dispatch generations introduced by one-use callback capabilities.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prove operator abandonment resolves the plan and removes its generation-scoped staged workspace.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-profile-plan-'));
let plan;
let setAssetCalls = 0;
let setAssetBehavior = async () => true;
let leaseActive = false;
const cleanupCalls = [];

/** Build the complete plan shape consumed by the mounted route handlers. */
function fixturePlan(state = 'draft') {
  return {
    userSub: 'profile-user', headline: 'Systems leader', about: '', skills: [], customUrl: '',
    backgroundImagePath: null, photoPath: null, resumePath: null, state,
    dispatchTaskId: null, dispatchClientId: null, dispatchGeneration: 0, resultNote: null,
  };
}

class FixtureProfilePlanStore {
  async getPlan() { return plan; }
  async setAsset(_userSub, field, filePath) {
    setAssetCalls += 1;
    const accepted = await setAssetBehavior();
    if (accepted) {
      const property = field === 'resume_path' ? 'resumePath'
        : field === 'photo_path' ? 'photoPath' : 'backgroundImagePath';
      plan[property] = filePath;
    }
    return accepted;
  }
  async casState(_userSub, from, to) {
    if (plan?.state !== from) return false;
    plan.state = to;
    return true;
  }
}

Module._load = function loadWithProfileStubs(request, ...rest) {
  if (request === 'express') return { raw: () => (_req, _res, next) => next() };
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/features/agent-management') {
    return { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => undefined };
  }
  if (request === '@/features/profile-studio') return { ProfilePlanStore: FixtureProfilePlanStore };
  if (request === '@/app/routes/inline-bot-execution') return { executeBotOrInline: async () => ({ response: '{}' }) };
  if (request === '@/app/profile-studio-dispatch') {
    return {
      dispatchProfileUpdate: async () => ({ ok: false }),
      cleanupProfileDispatchWorkspace: async (taskId) => { cleanupCalls.push(taskId); },
    };
  }
  if (request === './career-user-store') {
    return { callerSub: (req) => req.userSub, userPaths: (sub) => ({ userDir: join(fixtureRoot, sub) }) };
  }
  if (request === './career-engine-runner') {
    return {
      tryAcquireStorageRun: () => {
        if (leaseActive) return { status: 'inflight' };
        leaseActive = true;
        return { status: 'ok', token: Symbol('profile-plan') };
      },
      releaseRun: () => { leaseActive = false; },
    };
  }
  if (request === './career-engine-response') {
    return { rejectEngineClaim: (res, lease) => {
      if (lease.status === 'ok') return false;
      res.status(409).json({ error: 'profile plan update already running' });
      return true;
    } };
  }
  return originalLoad.call(this, request, ...rest);
};

const profileRoutes = require('../routes/career-profile-studio-routes.js');

after(() => {
  Module._load = originalLoad;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Capture registered route handlers after framework body parsing. */
function mountedHandlers() {
  const handlers = new Map();
  const router = {
    get(path, callback) { handlers.set(`GET ${path}`, callback); },
    post(path, ...callbacks) { handlers.set(`POST ${path}`, callbacks.at(-1)); },
    put(path, ...callbacks) { handlers.set(`PUT ${path}`, callbacks.at(-1)); },
  };
  profileRoutes.registerCareerProfileStudio(router, { pool: { query: async () => ({ rows: [] }) } });
  return handlers;
}

/** Minimal Express response recorder for route contract assertions. */
function responseRecorder() {
  return {
    statusCode: 200, body: undefined, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}

test('an approved plan rejects replacement before changing exact asset bytes', async () => {
  leaseActive = false;
  setAssetCalls = 0;
  plan = fixturePlan('approved');
  const dir = join(fixtureRoot, plan.userSub, 'profile-studio');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'background.png');
  writeFileSync(filePath, 'approved-bytes');
  plan.backgroundImagePath = filePath;
  const response = responseRecorder();
  await mountedHandlers().get('PUT /profile-studio/background')({
    userSub: plan.userSub, headers: { 'content-type': 'image/png' }, body: Buffer.from('hostile-new-bytes'),
  }, response);
  assert.equal(response.statusCode, 409);
  assert.equal(readFileSync(filePath, 'utf8'), 'approved-bytes');
  assert.equal(setAssetCalls, 0);
  assert.equal(leaseActive, false);
});

test('an in-progress asset commit blocks approval until its storage lease releases', async () => {
  leaseActive = false;
  setAssetCalls = 0;
  plan = fixturePlan('draft');
  let finishAsset;
  let assetStarted;
  const started = new Promise((resolve) => { assetStarted = resolve; });
  setAssetBehavior = () => new Promise((resolve) => { assetStarted(); finishAsset = () => resolve(true); });
  const handlers = mountedHandlers();
  const uploadResponse = responseRecorder();
  const upload = handlers.get('PUT /profile-studio/background')({
    userSub: plan.userSub, headers: { 'content-type': 'image/png' }, body: Buffer.from('new-bytes'),
  }, uploadResponse);
  await started;
  const blockedApproval = responseRecorder();
  await handlers.get('POST /profile-studio/approve')({ userSub: plan.userSub }, blockedApproval);
  assert.equal(blockedApproval.statusCode, 409);
  assert.equal(plan.state, 'draft');
  finishAsset();
  await upload;
  assert.equal(uploadResponse.statusCode, 200);
  assert.equal(leaseActive, false);
  const acceptedApproval = responseRecorder();
  await handlers.get('POST /profile-studio/approve')({ userSub: plan.userSub }, acceptedApproval);
  assert.equal(acceptedApproval.statusCode, 200);
  assert.equal(plan.state, 'approved');
});

test('a database rejection after replacement restores the prior asset bytes', async () => {
  leaseActive = false;
  plan = fixturePlan('draft');
  setAssetBehavior = async () => false;
  const dir = join(fixtureRoot, plan.userSub, 'profile-studio');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'background.png');
  writeFileSync(filePath, 'prior-bytes');
  const response = responseRecorder();
  await mountedHandlers().get('PUT /profile-studio/background')({
    userSub: plan.userSub, headers: { 'content-type': 'image/png' }, body: Buffer.from('rejected-bytes'),
  }, response);
  assert.equal(response.statusCode, 409);
  assert.equal(readFileSync(filePath, 'utf8'), 'prior-bytes');
  assert.equal(leaseActive, false);
});

test('abandoning a dispatched plan removes its exact staged workspace', async () => {
  cleanupCalls.length = 0;
  plan = fixturePlan('dispatched');
  plan.dispatchTaskId = 'liprofile-7-generation-a';
  const response = responseRecorder();
  await mountedHandlers().get('POST /profile-studio/abandon')({ userSub: plan.userSub }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(plan.state, 'failed');
  assert.deepEqual(cleanupCalls, ['liprofile-7-generation-a']);
});
