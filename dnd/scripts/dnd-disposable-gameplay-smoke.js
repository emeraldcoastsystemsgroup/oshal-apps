/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 01:15:54 | roger.murphy@emeraldcoastsystemsgroup.com  | Add an opt-in deployed gameplay smoke that creates only a fresh campaign, blocks paid media routes, and records human, observer, AI, monster, life-state, and reconnect evidence.
 * 2026-07-22 01:25:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Read initiative dice evidence from the preinstalled DOM recorder so a completed opening animation is not mistaken for a missing one.
 * 2026-07-22 01:27:28 | roger.murphy@emeraldcoastsystemsgroup.com  | Follow the deployed movement contract: moving to a legal square chooses the position immediately, while Stay Here is only the no-move alternative.
 * 2026-07-22 01:29:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Scope human roll visibility to mutation-recorder rows captured after targeting so fast completed dice animations remain verifiable.
 * 2026-07-22 01:34:22 | roger.murphy@emeraldcoastsystemsgroup.com  | Default to local, move saved-campaign deny lists to environment input, fail closed around fresh-campaign writes, use a read-only TV observer, and emit redacted evidence only outside the repository.
 * 2026-07-22 01:39:05 | roger.murphy@emeraldcoastsystemsgroup.com  | Wait for the shared movement revision and local save drain before selecting an action, matching the human-visible persisted Move-to-Choose boundary.
 * 2026-07-22 01:52:18 | roger.murphy@emeraldcoastsystemsgroup.com  | Reject credential-bearing origins, use a portable dedicated-profile default, and retain sanitized state rejection, request-failure, DOM, and final-state diagnostics.
 * 2026-07-22 01:59:22 | roger.murphy@emeraldcoastsystemsgroup.com  | Block canonical and legacy Dungeon Master model routes alongside paid narration and image providers during deployed smoke runs.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE = String(process.env.DND_SMOKE_BASE_URL || 'http://127.0.0.1:35457').replace(/\/$/, '');
const PROFILE = process.env.DND_SMOKE_PROFILE || path.join(os.homedir(), '.oshal-e2e-chrome');
const TABLE_URL = `${BASE}/api/dnd/table`;
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FORBIDDEN_IDS = String(process.env.DND_SMOKE_FORBIDDEN_CAMPAIGN_ID || '').split(',').map((value) => value.trim()).filter(Boolean);
const FORBIDDEN_CODES = String(process.env.DND_SMOKE_FORBIDDEN_CAMPAIGN_CODE || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
const EVIDENCE_FILE = path.resolve(process.env.DND_SMOKE_EVIDENCE_FILE
  || path.join(os.tmpdir(), `dnd-disposable-smoke-${Date.now()}-${process.pid}.json`));

const SNAPSHOT_SOURCE = `(() => {
  const actor = board && board.mode === 'combat' ? activeToken() : null;
  const result = actor && actor.turnResult && Number(actor.turnResult.serial) === Number(board.turnSerial)
    ? actor.turnResult : null;
  return {
    campaignId: campaign && campaign.campaign_id, joinCode: campaign && campaign.join_code,
    rev: Number(rev) || 0, mode: board && board.mode, round: board && board.round,
    turnIndex: board && board.turnIndex, turnSerial: board && board.turnSerial,
    active: actor && { id: actor.id, slug: actor.slug || '', name: actor.name, kind: actor.kind,
      x: actor.x, y: actor.y, hp: actor.hp, maxHp: actor.maxHp, downed: !!actor.downed,
      stable: !!actor.stable, dead: !!actor.dead, acted: !!actor.acted,
      moved: !!actor.moved, positionSet: !!actor.positionSet, moveRemaining: actor.moveRemaining },
    controller: actor && actor.kind === 'pc' ? controllerLabel(actor) : 'Dungeon Master',
    aiCompanion: !!(actor && isAICompanion(actor)),
    movement: actor && actor.movementResult ? JSON.parse(JSON.stringify(actor.movementResult)) : null,
    telegraph: board && board.telegraph ? JSON.parse(JSON.stringify(board.telegraph)) : null,
    result: result ? JSON.parse(JSON.stringify(result)) : null,
    selectedAction: selectedAction && selectedAction.name,
    turnFlag: document.querySelector('#turnflag')?.innerText || '',
    banner: document.querySelector('#banner')?.innerText || '',
    caption: document.querySelector('#caption')?.innerText || '',
    watch: document.querySelector('#actions .watch-note')?.innerText || '',
    actions: Array.from(document.querySelectorAll('#actions .act')).map((el) => ({
      text: el.innerText, disabled: el.disabled,
    })),
    dice: Array.from(document.querySelectorAll('.combat-dice-box')).map((el) => el.innerText),
    initiative: document.querySelector('#initiative')?.innerText || '',
    storyOpen: document.querySelector('#story')?.classList.contains('open') || false,
    pendingStory: document.querySelectorAll('#log .spin').length,
    life: (board && board.tokens || []).filter((token) => token.kind === 'pc').map((token) => ({
      id: token.id, name: token.name, hp: token.hp, maxHp: token.maxHp,
      downed: !!token.downed, stable: !!token.stable, dead: !!token.dead,
    })),
  };
})()`;

function freshEvidence() {
  return {
    startedAt: new Date().toISOString(), baseUrl: BASE, ok: false,
    freshCampaign: null, steps: [], providerIntercepts: [], safetyViolations: [],
    stateWrites: [], requestFailures: [], consoleErrors: [], primaryDom: [], observerDom: [],
    finalSnapshots: [], automation: [], gaps: [],
  };
}

function note(evidence, step, details) {
  evidence.steps.push({ at: new Date().toISOString(), step, ...details });
}

function pathIsInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safetyCheck() {
  const target = new URL(BASE);
  assert.equal(process.env.DND_DISPOSABLE_SMOKE, '1', 'Set DND_DISPOSABLE_SMOKE=1 to create a fresh campaign.');
  assert.equal(path.basename(PROFILE).toLowerCase(), '.oshal-e2e-chrome', 'Only the dedicated E2E Chrome profile is allowed.');
  assert.match(BASE, /^https?:\/\//, 'DND_SMOKE_BASE_URL must be an HTTP(S) origin.');
  assert.equal(BASE, target.origin, 'DND_SMOKE_BASE_URL must be a bare origin without a path, query, or credentials.');
  assert.equal(target.username || target.password, '', 'DND_SMOKE_BASE_URL must not contain credentials.');
  assert.equal(path.extname(EVIDENCE_FILE).toLowerCase(), '.json', 'DND_SMOKE_EVIDENCE_FILE must name a JSON file.');
  assert.equal(pathIsInside(REPO_ROOT, EVIDENCE_FILE), false, 'Evidence files must remain outside the repository.');
}

function requestCampaignId(request) {
  try {
    const body = request.postDataJSON();
    return body && String(body.campaignId || body.campaign_id || '');
  } catch (_error) { return ''; }
}

async function installSafetyRoutes(context, evidence) {
  await context.route('**/api/dnd/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const method = request.method().toUpperCase(), campaignId = requestCampaignId(request);
    if (url.pathname === '/api/dnd/tts') {
      evidence.providerIntercepts.push({ kind: 'tts', method, path: url.pathname });
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"code":"SMOKE_TTS_BLOCKED"}' });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/dnd/cutaway') {
      evidence.providerIntercepts.push({ kind: 'image', method, path: url.pathname });
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"code":"SMOKE_IMAGE_BLOCKED"}' });
      return;
    }
    if (method === 'POST' && ['/api/dnd/chat', '/api/dnd/dm'].includes(url.pathname)) {
      evidence.providerIntercepts.push({ kind: 'model', method, path: url.pathname });
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"code":"SMOKE_MODEL_BLOCKED"}' });
      return;
    }
    const creating = method === 'POST' && url.pathname === '/api/dnd/campaign';
    const mutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    const beforeFreshBlocked = mutation && !evidence.freshCampaign && !creating;
    const outsideFreshBlocked = mutation && evidence.freshCampaign && campaignId !== evidence.freshCampaign.id;
    const denyListed = mutation && campaignId && FORBIDDEN_IDS.includes(campaignId);
    if (beforeFreshBlocked || outsideFreshBlocked || denyListed) {
      evidence.safetyViolations.push({ method, path: url.pathname, campaignId });
      await route.fulfill({ status: 409, contentType: 'application/json', body: '{"ok":false,"code":"SMOKE_SCOPE_BLOCKED"}' });
      return;
    }
    await route.continue();
  });
}

function bindPageEvidence(page, evidence) {
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text().slice(0, 400));
  });
  page.on('pageerror', (error) => evidence.consoleErrors.push(String(error.message || error).slice(0, 400)));
  page.on('requestfailed', (request) => evidence.requestFailures.push({
    method: request.method(), path: new URL(request.url()).pathname,
    error: request.failure() && request.failure().errorText,
  }));
  page.on('response', async (response) => {
    const request = response.request(), url = new URL(response.url());
    if (request.method() !== 'POST' || url.pathname !== '/api/dnd/state') return;
    try {
      const body = await response.json();
      evidence.stateWrites.push({ status: response.status(), rev: body.rev, ok: body.ok !== false,
        code: body.code || null, error: body.error || null, conflict: !!body.conflict });
    } catch (_error) { evidence.stateWrites.push({ status: response.status(), rev: null, ok: false }); }
  });
}

async function installDomRecorder(page, name) {
  await page.evaluate((key) => {
    const rows = [], capture = () => {
      const row = {
        at: Date.now(), turn: document.querySelector('#turnflag')?.innerText || '',
        banner: document.querySelector('#banner')?.innerText || '',
        dice: Array.from(document.querySelectorAll('.combat-dice-box')).map((el) => el.innerText),
        who: document.querySelector('#who')?.innerText || '',
        watch: document.querySelector('#actions .watch-note')?.innerText || '',
      };
      const prior = rows[rows.length - 1];
      if (!prior || JSON.stringify({ ...prior, at: 0 }) !== JSON.stringify({ ...row, at: 0 })) rows.push(row);
      if (rows.length > 240) rows.shift();
    };
    capture(); new MutationObserver(capture).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    window[key] = rows;
  }, name);
}

async function snapshot(page) {
  return page.evaluate(SNAPSHOT_SOURCE);
}

async function waitForSnapshot(page, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let current = null;
  while (Date.now() < deadline) {
    try { current = await snapshot(page); if (predicate(current)) return current; }
    catch (_error) { /* a reload briefly destroys the execution context */ }
    await page.waitForTimeout(100);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(current)}`);
}

async function launchSmokeContext(evidence) {
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome', headless: true, serviceWorkers: 'block',
    args: ['--disable-extensions', '--disable-component-extensions-with-background-pages', '--no-first-run'],
  });
  await installSafetyRoutes(context, evidence);
  return context;
}

async function openTable(page, evidence, domKey) {
  bindPageEvidence(page, evidence);
  const response = await page.goto(TABLE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response && response.status(), 200, 'The deployed table must load.');
  await page.locator('#menuNew').waitFor({ state: 'visible', timeout: 30000 });
  await installDomRecorder(page, domKey);
  return page;
}

async function createFreshCampaign(page, evidence) {
  const menu = await page.locator('#overlayCard').innerText();
  assert.match(menu, /My Games/); assert.match(menu, /Signing in never drops you into a campaign automatically/);
  await page.locator('#menuNew').click();
  assert.equal((await page.locator('#draftCount').innerText()).trim(), '4/4 selected');
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/dnd/campaign', { timeout: 30000 });
  await page.locator('#ovCreateLobby').click();
  const response = await responsePromise, body = await response.json();
  assert.equal(response.status(), 200); assert.ok(body.campaign && body.campaign.campaign_id);
  const fresh = { id: body.campaign.campaign_id, code: body.campaign.join_code, rev: body.rev };
  assert.equal(FORBIDDEN_IDS.includes(String(fresh.id)), false, 'The new campaign ID matched an explicit deny-list entry.');
  assert.equal(FORBIDDEN_CODES.includes(String(fresh.code).toUpperCase()), false, 'The new join code matched an explicit deny-list entry.');
  evidence.freshCampaign = fresh;
  await page.locator('#ovLaunch').waitFor({ state: 'visible', timeout: 20000 });
  note(evidence, 'fresh campaign created', fresh);
}

async function claimHuman(page, evidence) {
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/dnd/claim', { timeout: 30000 });
  await page.locator('[data-lobby-claim="bram"]').click();
  const response = await responsePromise, body = await response.json();
  assert.equal(response.status(), 200); assert.equal(body.ok, true);
  await page.locator('#ovLaunch:not([disabled])').waitFor({ state: 'visible', timeout: 20000 });
  const companions = await page.locator('.seat-tag.companion').count();
  assert.equal(companions, 3, 'Exactly three unclaimed heroes must remain AI Companions.');
  note(evidence, 'Bram claimed; remaining seats are AI', { companions, rev: body.rev });
}

async function startQuest(page, evidence) {
  await page.evaluate(() => {
    setVoiceMuted(true);
    window.__dndSmokeRng = [0.99, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
    ENG.setRng(() => window.__dndSmokeRng.length ? window.__dndSmokeRng.shift() : 0.55);
  });
  await page.locator('#ovLaunch').click();
  await page.locator('.intro-skip').waitFor({ state: 'visible', timeout: 10000 });
  const combatWrite = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/dnd/state', { timeout: 30000 });
  await page.locator('.intro-skip').click();
  assert.equal((await combatWrite).status(), 200);
  const ready = await waitForSnapshot(page, (state) => state.mode === 'combat'
    && state.active && state.active.slug === 'bram', 30000, 'Bram first initiative');
  await page.locator('#moveBtn:not([disabled])').waitFor({ state: 'visible', timeout: 10000 });
  note(evidence, 'quest started with claimed human first', {
    active: ready.active.name, turnSerial: ready.turnSerial, party: ready.life.length,
    initiative: ready.initiative,
  });
}

async function waitForOpeningDice(page, evidence) {
  await page.waitForFunction(() => !combatDieActive && combatDiceQueue.length === 0, null, { timeout: 40000 });
  const rows = await page.evaluate(() => window.__dndSmokePrimary || []);
  const dice = rows.flatMap((row) => row.dice || []).filter(Boolean);
  assert.ok(dice.length, 'Opening initiative dice must render visibly.');
  note(evidence, 'opening initiative dice completed visibly', { visibleSamples: [...new Set(dice)].slice(0, 8) });
}

async function openObserver(context, evidence) {
  const page = await context.newPage();
  bindPageEvidence(page, evidence);
  await page.route('**/api/dnd/state*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'GET' && !url.searchParams.has('campaignId')) {
      url.searchParams.set('campaignId', evidence.freshCampaign.id);
      await route.continue({ url: url.toString() }); return;
    }
    await route.continue();
  });
  const response = await page.goto(`${TABLE_URL}?mode=tv`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response && response.status(), 200, 'The deployed read-only TV table must load.');
  const state = await waitForSnapshot(page, (current) => current.campaignId === evidence.freshCampaign.id
    && current.mode === 'combat', 30000, 'fresh campaign TV observer');
  assert.equal(await page.evaluate(() => TV), true, 'The observer must be read-only TV mode.');
  await page.evaluate(() => setVoiceMuted(true)); await installDomRecorder(page, '__dndSmokeObserver');
  note(evidence, 'read-only TV page resumed exact fresh campaign', { rev: state.rev, active: state.active.name });
  return page;
}

async function chooseHumanMove(page) {
  return page.evaluate(`(() => {
    const actor = activeToken(); selected = actor; computeReachable(actor);
    const choices = [...movementCosts.entries()].map(([key, cost]) => {
      const [x, y] = key.split(',').map(Number); return { x, y, cost };
    }).filter((choice) => choice.cost > 0 && reachable.has(choice.x + ',' + choice.y)
      && !board.tokens.some((token) => !token.fled && !token.dead && token.x === choice.x && token.y === choice.y));
    choices.sort((left, right) => left.x - right.x || left.cost - right.cost || left.y - right.y);
    return { from: { x: actor.x, y: actor.y }, destination: choices[0], cell };
  })()`);
}

async function clickGrid(page, target, cellSize) {
  const box = await page.locator('#board').boundingBox();
  assert.ok(box, 'The battle canvas must be visible.');
  await page.mouse.click(box.x + (target.x + 0.5) * cellSize, box.y + (target.y + 0.5) * cellSize);
}

async function moveAndChoose(page, observer, evidence) {
  const plan = await chooseHumanMove(page);
  assert.ok(plan.destination, 'Bram needs at least one legal blue movement square.');
  await clickGrid(page, plan.destination, plan.cell);
  const moved = await waitForSnapshot(page, (state) => state.active.x === plan.destination.x
    && state.active.y === plan.destination.y && state.active.moved, 10000, 'human movement');
  const observed = await waitForSnapshot(observer, (state) => state.active.x === plan.destination.x
    && state.active.y === plan.destination.y, 10000, 'observer movement sync');
  const settled = await waitForSnapshot(page, (state) => state.rev >= observed.rev
    && state.active.x === plan.destination.x && state.active.y === plan.destination.y,
  10000, 'primary movement revision');
  await page.waitForFunction(() => !saveInFlight && !saveAgain && !saveTimer, null, { timeout: 10000 });
  await page.locator('#stayBtn:disabled').filter({ hasText: 'Position Set' }).waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#actions .act:not([disabled])').first().waitFor({ state: 'visible', timeout: 10000 });
  const chosen = await snapshot(page);
  assert.match(chosen.turnFlag, /Move|Choose|Target|Roll|Result/i);
  note(evidence, 'Move → Choose persisted on both screens', {
    from: plan.from, to: plan.destination, initialRev: moved.rev, settledRev: settled.rev,
    observerRev: observed.rev, observerMatched: true, turnFlag: chosen.turnFlag,
  });
}

async function chooseAttackTarget(page) {
  const crossbow = page.locator('#actions .act:not([disabled])').filter({ hasText: 'Light Crossbow' });
  await crossbow.waitFor({ state: 'visible', timeout: 10000 }); await crossbow.click();
  const target = await page.evaluate(`(() => {
    const targets = validTargets(selected, selectedAction).filter((token) => token.kind === 'monster' && !token.dead);
    targets.sort((left, right) => cheb(selected, left) - cheb(selected, right));
    const picked = targets[0]; return picked ? { id: picked.id, name: picked.name, x: picked.x, y: picked.y, cell } : null;
  })()`);
  assert.ok(target, 'Light Crossbow must expose a legal living target.');
  return target;
}

async function resolveHumanAction(page, observer, evidence) {
  const target = await chooseAttackTarget(page);
  const targeted = await snapshot(page);
  assert.match(targeted.banner, /Aim .*highlighted target/i);
  const diceMarker = await page.evaluate(() => (window.__dndSmokePrimary || []).length);
  await clickGrid(page, target, target.cell);
  const pending = await waitForSnapshot(page, (state) => state.result && !state.result.complete,
    10000, 'pending human result');
  const complete = await waitForSnapshot(page, (state) => state.result && state.result.complete,
    30000, 'completed human result');
  const diceRows = await page.evaluate((marker) => (window.__dndSmokePrimary || []).slice(marker), diceMarker);
  const visibleDice = diceRows.flatMap((row) => row.dice || []).filter(Boolean);
  assert.ok(visibleDice.length, 'The human attack roll must render visibly after targeting.');
  const observed = await waitForSnapshot(observer, (state) => state.result && state.result.complete
    && state.result.rollEvent && state.result.rollEvent.eventId === complete.result.rollEvent.eventId,
  15000, 'observer exact result');
  note(evidence, 'Target → Roll → Result synchronized', {
    target: target.name, pendingText: pending.result.text, eventId: complete.result.rollEvent.eventId,
    rolls: complete.result.rollEvent.rolls, visibleDice: [...new Set(visibleDice)].slice(0, 4),
    observerEventId: observed.result.rollEvent.eventId,
  });
  return complete;
}

async function proveHumanFence(page, evidence, resultState) {
  await page.locator('#endTurn:not([disabled])').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1800);
  const fenced = await snapshot(page);
  assert.equal(fenced.turnSerial, resultState.turnSerial);
  assert.equal(fenced.active.id, resultState.active.id);
  assert.equal(fenced.result.complete, true);
  note(evidence, 'automation stopped at human End Turn fence', {
    actor: fenced.active.name, turnSerial: fenced.turnSerial, heldMs: 1800,
  });
}

function mergeAutomatedSample(records, state) {
  const key = `${state.turnSerial}:${state.active.id}`;
  const row = records[key] || { key, name: state.active.name, kind: state.active.kind,
    controller: state.controller, stages: [], movement: null, telegraph: null, result: null, dice: [] };
  if (state.turnFlag && !row.stages.includes(state.turnFlag)) row.stages.push(state.turnFlag);
  if (state.movement) row.movement = state.movement;
  if (state.telegraph && state.telegraph.actorId === state.active.id) row.telegraph = state.telegraph;
  if (state.result) row.result = state.result;
  state.dice.forEach((die) => { if (!row.dice.includes(die)) row.dice.push(die); });
  row.viewOnly = /VIEW ONLY/i.test(state.watch) && state.actions.every((action) => action.disabled);
  records[key] = row;
}

async function setAutomatedRng(page, state) {
  const value = state.active.kind === 'monster' ? 0.99 : 0.01;
  await page.evaluate((next) => {
    window.__dndSmokeRollValue = next; ENG.setRng(() => window.__dndSmokeRollValue);
  }, value);
}

async function observeAutomatedRound(page, evidence, humanSerial) {
  const records = {}, deadline = Date.now() + 120000;
  let actorKey = '', returned = null;
  while (Date.now() < deadline) {
    const state = await snapshot(page), currentKey = state.active && `${state.turnSerial}:${state.active.id}`;
    if (state.active && state.active.slug === 'bram' && state.turnSerial > humanSerial) { returned = state; break; }
    if (state.active && currentKey !== actorKey) { actorKey = currentKey; await setAutomatedRng(page, state); }
    if (state.active) mergeAutomatedSample(records, state);
    await page.waitForTimeout(100);
  }
  assert.ok(returned, 'Initiative must return to Bram within the automated-round budget.');
  evidence.automation = Object.values(records);
  const companion = evidence.automation.find((row) => /AI Companion/i.test(row.controller) && row.movement && row.result);
  const monster = evidence.automation.find((row) => row.kind === 'monster' && row.movement && row.result);
  assert.ok(companion, 'At least one AI Companion must show movement and result.');
  assert.ok(monster, 'At least one monster must show movement and result.');
  assert.ok(evidence.automation.some((row) => row.viewOnly), 'Automated action cards must remain view-only.');
  note(evidence, 'AI Companion and monster phases completed visibly', {
    companion: { name: companion.name, movement: companion.movement.text, result: companion.result.text,
      eventId: companion.result.rollEvent && companion.result.rollEvent.eventId },
    monster: { name: monster.name, movement: monster.movement.text, result: monster.result.text,
      eventId: monster.result.rollEvent && monster.result.rollEvent.eventId },
  });
  return returned;
}

function assertLifeStatus(state, evidence) {
  const alive = state.life.filter((hero) => hero.hp > 0 && !hero.dead);
  const down = state.life.filter((hero) => hero.downed && !hero.dead);
  assert.ok(alive.length, 'At least one hero must remain ALIVE.');
  assert.ok(down.length, 'Forced monster criticals must leave a hero DOWN for the life-state smoke.');
  assert.match(state.initiative, /ALIVE/); assert.match(state.initiative, /DOWN/);
  note(evidence, 'ALIVE and DOWN heroes remain visible', { alive, down, initiative: state.initiative });
}

async function quitAndResume(page, evidence, expectedSerial) {
  await page.locator('#gamesBtn').click();
  await page.locator('#sessionQuit').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#sessionQuit').click();
  await page.locator(`[data-resume="${evidence.freshCampaign.id}"]`).waitFor({ state: 'visible', timeout: 20000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#menuNew').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator(`[data-resume="${evidence.freshCampaign.id}"]`).waitFor({ state: 'visible', timeout: 20000 });
  await installDomRecorder(page, '__dndSmokePrimary');
  const started = Date.now();
  await page.locator(`[data-resume="${evidence.freshCampaign.id}"]`).click();
  const resumed = await waitForSnapshot(page, (state) => state.campaignId === evidence.freshCampaign.id
    && state.active && state.active.slug === 'bram' && state.turnSerial === expectedSerial, 30000, 'quit/resume state');
  await page.waitForFunction(() => {
    const actor = activeToken();
    return actor && actor.slug === 'bram' && (isDowned(actor)
      ? !!document.querySelector('#deathSaveBtn') : !document.querySelector('#moveBtn').disabled);
  }, null, { timeout: 10000 });
  const ready = await snapshot(page), elapsedMs = Date.now() - started;
  assert.equal(ready.storyOpen, false); assert.equal(ready.dice.length, 0);
  note(evidence, 'reload and quit/resume restored the exact human fence without blocking recap', {
    elapsedMs, turnSerial: ready.turnSerial, rev: ready.rev, pendingStory: ready.pendingStory,
    storyOpen: ready.storyOpen, active: ready.active.name,
  });
  return resumed;
}

async function collectDomEvidence(primary, observer, evidence) {
  evidence.primaryDom = (await primary.evaluate(() => window.__dndSmokePrimary || [])).slice(-120);
  if (observer && !observer.isClosed()) evidence.observerDom = (await observer.evaluate(() => window.__dndSmokeObserver || [])).slice(-120);
}

async function collectPageDiagnostics(context, evidence) {
  const pages = context ? context.pages().filter((page) => !page.isClosed()) : [];
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index], domKey = index === 0 ? '__dndSmokePrimary' : '__dndSmokeObserver';
    try {
      const rows = await page.evaluate((key) => window[key] || [], domKey);
      if (index === 0 && rows.length) evidence.primaryDom = rows.slice(-120);
      if (index === 1 && rows.length) evidence.observerDom = rows.slice(-120);
    } catch (_error) { /* retain the network evidence when the document is gone */ }
    try {
      evidence.finalSnapshots.push({ page: index === 0 ? 'primary' : 'observer', state: await snapshot(page) });
    } catch (_error) { /* a failed navigation may not have tabletop globals */ }
  }
}

function redactEvidence(value, key = '') {
  if (/authorization|cookie|password|secret|(?:^|_)token|api[_-]?key|session[_-]?id/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactEvidence(item));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, redactEvidence(item, name)]));
  if (typeof value !== 'string') return value;
  return value.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:access_token|auth|key|session|token)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
}

function emitEvidence(evidence, writeFile) {
  const safe = redactEvidence(evidence), serialized = `${JSON.stringify(safe, null, 2)}\n`;
  if (writeFile) {
    fs.mkdirSync(path.dirname(EVIDENCE_FILE), { recursive: true });
    fs.writeFileSync(EVIDENCE_FILE, serialized, { encoding: 'utf8', mode: 0o600 });
    console.log(`DND_DISPOSABLE_SMOKE_EVIDENCE_FILE=${EVIDENCE_FILE}`);
  }
  console.log(`DND_DISPOSABLE_SMOKE_EVIDENCE=${serialized.trimEnd()}`);
}

async function runSmoke(context, evidence) {
  const primary = context.pages()[0] || await context.newPage();
  await openTable(primary, evidence, '__dndSmokePrimary');
  await createFreshCampaign(primary, evidence); await claimHuman(primary, evidence); await startQuest(primary, evidence);
  await waitForOpeningDice(primary, evidence);
  const observer = await openObserver(context, evidence);
  await moveAndChoose(primary, observer, evidence);
  const humanResult = await resolveHumanAction(primary, observer, evidence);
  await proveHumanFence(primary, evidence, humanResult);
  await collectDomEvidence(primary, observer, evidence); await observer.close();
  await primary.locator('#endTurn').click();
  const returned = await observeAutomatedRound(primary, evidence, humanResult.turnSerial);
  assertLifeStatus(returned, evidence);
  await primary.waitForTimeout(1600);
  const stillHuman = await snapshot(primary);
  assert.equal(stillHuman.active.slug, 'bram'); assert.equal(stillHuman.turnSerial, returned.turnSerial);
  note(evidence, 'next human turn did not auto-run', { heldMs: 1600, turnSerial: stillHuman.turnSerial });
  await quitAndResume(primary, evidence, returned.turnSerial);
  await collectDomEvidence(primary, null, evidence);
}

async function main() {
  const evidence = freshEvidence(); let context, evidencePathApproved = false;
  try {
    safetyCheck(); evidencePathApproved = true;
    context = await launchSmokeContext(evidence);
    await runSmoke(context, evidence);
    await collectPageDiagnostics(context, evidence);
    assert.deepEqual(evidence.safetyViolations, []);
    evidence.gaps.push('A second read-only TV page used the same authenticated account; distinct guest ownership was not exercised.');
    evidence.ok = true; evidence.finishedAt = new Date().toISOString();
  } catch (error) {
    await collectPageDiagnostics(context, evidence);
    evidence.error = String(error && error.stack || error).slice(0, 3000);
    evidence.finishedAt = new Date().toISOString();
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
    try { emitEvidence(evidence, evidencePathApproved); }
    catch (error) { console.error(`DND_DISPOSABLE_SMOKE_EVIDENCE_WRITE_ERROR=${String(error.message || error)}`); process.exitCode = 1; }
  }
}

void main();
