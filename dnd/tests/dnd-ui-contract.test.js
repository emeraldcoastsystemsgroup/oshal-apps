/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Follow shared-roll, dock-identity, and automated-turn contracts into their extracted helpers without weakening the guarded behavior.
 * 2026-07-21 20:36:30 | roger.murphy@emeraldcoastsystemsgroup.com  | Execute declaration instantiation for every classic script in one shared global to prevent browser-fatal cross-file binding collisions.
 * 2026-07-21 20:00:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extend the single tabletop script-order manifest across the extracted automation and outcome modules.
 * 2026-07-21 19:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Load the extracted tabletop classic scripts in browser order and guard the HTML against duplicate, reordered, or inline application code.
 * 2026-07-21 19:25:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace stale implementation regexes with contracts for My Games, shared rolls, Story-rail recaps, party conditions, and durable death saves.
 * 2026-07-21 18:59:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Pin automation run epochs, durable phase leases, commit-before-story ordering, contiguous archive cursors, bounded recaps, and centralized outcomes.
 * 2026-07-21 18:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Pin visible downed/death-save turns, narrated automation phases, archive echo suppression, and single-flight synchronization.
 * 2026-07-21 18:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Require one selected neural narrator with no browser fallback, and automatic, recoverable ability-roll resolution.
 * 2026-07-21 17:15:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Pin explicit AI position phases and synchronize captions, overview cards, recaps, and enemy telegraphs to a bounded speech lifecycle.
 * 2026-07-21 15:15:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Pin non-overlapping story choices, claimed-only human control, guarded AI companions, legacy owner bootstrap, defeated-token removal, distinct enemy labels, DM archive sequence adoption, and renderer-field save sanitization.
 * 2026-07-21 13:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard stale monster callbacks, authoritative conflict reconciliation, setup-only claims/movement, TV initial turn status, parent-constrained sheets, and save-before-snapshot ordering.
 * 2026-07-21 12:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard the multiplayer lobby, reserved turn HUD, exact legal-movement cues, inventory sheet, and optimistic-sync client contract.
 * 2026-07-21 20:55:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove openings, rewinds, and human controls wait for their visible Dungeon Master announcement phases.
 * 2026-07-21 21:01:12 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove multiattacks and area effects queue every authoritative combat roll in order.
 * 2026-07-21 21:08:49 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove rewind establishes its control lock before rendering the restored board.
 * 2026-07-21 21:16:19 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove rewind clears stale movement squares before its locked render.
 * 2026-07-21 21:28:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove initiative awaits the full visible combat-die queue and use source-order checks resilient to added guards.
 * 2026-07-21 21:40:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove snapshots drain board and archive queues and seat changes resume newly automated active turns.
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Include the shared presentation module in the browser bundle and authoritative synchronization contracts.
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Load and exercise the focused structured-dice presenter before the shared presentation gate.
 * 2026-07-21 22:29:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Load fixed natural narration before dice consumers and prove truthful status, bounded silence, and overview-to-audio synchronization.
 * 2026-07-21 22:36:06 | roger.murphy@emeraldcoastsystemsgroup.com  | Adopt the authoritative claim revision before an owner can immediately start the encounter.
 * 2026-07-21 22:48:44 | roger.murphy@emeraldcoastsystemsgroup.com  | Require authoritative rewind-branch reloads before restored presentation, input, or synchronized archive tails.
 * 2026-07-21 23:08:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Require fleeing monsters to remain rendered until their exact retreat narration finishes.
 * 2026-07-21 23:10:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep newly defeated targets rendered through their saved dice and narration instead of flashing away before confirmation.
 * 2026-07-21 23:12:03 | roger.murphy@emeraldcoastsystemsgroup.com  | Require request deadlines on state saves and background synchronization so their single-flight locks always recover.
 * 2026-07-21 23:10:48 | roger.murphy@emeraldcoastsystemsgroup.com  | Load the focused host seat-recovery controls between shared synchronization and Party/Lobby screens.
 * 2026-07-21 23:31:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Require non-blocking combat catch-up, reload-stable automation identity, bounded takeover, and honest suspended-audio handling.
 * 2026-07-22 00:18:41 | roger.murphy@emeraldcoastsystemsgroup.com  | Require immediate captions and a presentation deadline that is independent from natural-voice completion.
 * 2026-07-22 00:21:20 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard actor-first turn directives, five explicit action stages, view-only automation controls, and non-blocking opening recovery.
 * 2026-07-22 23:04:49 | roger.murphy@emeraldcoastsystemsgroup.com  | Require varied automated turn narration and a table-only full-screen control.
 * 2026-07-22 23:23:32 | roger.murphy@emeraldcoastsystemsgroup.com  | Prohibit nested scrollbars in the My Games campaign library.
 * 2026-07-22 23:30:56 | roger.murphy@emeraldcoastsystemsgroup.com  | Require spent-resource locks and the full-surface current-versus-potential character view.
 * 2026-07-22 00:41:15 | roger.murphy@emeraldcoastsystemsgroup.com  | Require model-free tactical outcomes, persisted AI action telegraphs, awaited visible dice, bounded result holds, and detached natural narration.
 * 2026-07-22 01:14:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Load focused playback in the shared classic bundle and distinguish read-only terminal playback from Resume, quit, and permanent leave.
 * 2026-07-22 00:50:36 | roger.murphy@emeraldcoastsystemsgroup.com  | Require the tabletop to use canonical authenticated /chat storytelling while excluding the retired tactical resolve mode.
 * 2026-07-22 01:29:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Require natural narration on joined tables and preserve only a player-selected local mute across campaign switches.
 * 2026-07-22 01:45:06 | roger.murphy@emeraldcoastsystemsgroup.com  | Require human movement to persist the same public position marker used by the server action gate.
 * 2026-07-22 01:59:22 | roger.murphy@emeraldcoastsystemsgroup.com  | Require monster movement to persist the Dijkstra terrain cost and remaining movement accepted by the server guard.
 * 2026-07-22 10:10:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Require readable text-aware AI pacing to serialize movement, target, dice, and natural result narration without an unbounded provider wait.
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Require cinematic combat prose, silent exact ledgers, dynamic guarded DM results, and direct turn handoffs without repetitive questions.
 * 2026-07-23 00:01:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Require the immersive gameplay rail and its prominent full-screen entry point.
 * 2026-07-23 00:12:33 | roger.murphy@emeraldcoastsystemsgroup.com  | Require one-click contextual Dungeon Master questions for known facts, searchable leads, and loop-breaking help.
 * 2026-07-23 00:22:11 | roger.murphy@emeraldcoastsystemsgroup.com  | Prohibit ordinary rules/help conversation from requesting paid cutaway images.
 * 2026-07-23 00:41:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Require authored NPC identity in the table UI and identify Cedar as the natural folk narrator.
 * 2026-07-23 02:35:01 | roger.murphy@emeraldcoastsystemsgroup.com  | Require the configured gravelly Algenib narrator in the tabletop contract and forbid Kore.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Require split-turn recovery plus functional spoken-action, dice-detail, and NPC-pace switches.
 * 2026-07-23 11:21:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Require uninterrupted narration across ordinary synchronization, visible speaking feedback, and post-action movement during speech.
 * 2026-07-23 13:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the multi-campaign shelf wider than the legacy single-form modal at desktop sizes.
 * 2026-07-23 11:36:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Require death-save presenters to survive equivalent DM replies, retry after interruption, and explain accumulated failures.
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Load campaign selection and shared exploration in the ordered tabletop bundle.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'table.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui', 'dnd.css'), 'utf8');
const tableScriptFiles = ['table-runtime.js', 'table-voice.js', 'table-dice.js', 'table-presentation.js', 'table-turns.js', 'table-combat-narration.js', 'table-automation.js', 'table-outcomes.js', 'table-story.js', 'table-exploration.js', 'table-character-sheet.js', 'table-campaigns.js', 'table-seats.js', 'table-playback.js', 'table-immersive.js', 'table-screens.js'];
const classicScriptFiles = ['engine.js'].concat(tableScriptFiles);
const tableScriptSources = tableScriptFiles.map((file) => fs.readFileSync(path.join(root, 'ui', file), 'utf8'));
const voiceSource = fs.readFileSync(path.join(root, 'ui', 'table-voice.js'), 'utf8');
const diceSource = fs.readFileSync(path.join(root, 'ui', 'table-dice.js'), 'utf8');
const automationSource = fs.readFileSync(path.join(root, 'ui', 'table-automation.js'), 'utf8');
const appScript = tableScriptSources.join('\n;\n');
const htmlScriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .map((match) => ({ attributes: match[1], body: match[2] }));

function sourceBetween(start, end) {
  const startAt = appScript.indexOf(start);
  const endAt = appScript.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0, `missing source boundary: ${start}`);
  assert.ok(endAt > startAt, `missing source boundary after ${start}: ${end}`);
  return appScript.slice(startAt, endAt);
}

function assertInOrder(source, expectations, message) {
  let cursor = 0;
  expectations.forEach((expected) => {
    const tail = source.slice(cursor);
    const offset = typeof expected === 'string' ? tail.indexOf(expected) : tail.search(expected);
    assert.ok(offset >= 0, message || `expected ${String(expected)} after offset ${cursor}`);
    cursor += offset + 1;
  });
}

test('tabletop loads one ordered classic-script bundle with no application inline script', () => {
  const expectedSources = tableScriptFiles.map((file) => `/api/dnd/${file}`);
  const loadedTableScripts = htmlScriptTags.flatMap(({ attributes }) => {
    const source = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    return source && /^\/api\/dnd\/table-[^/?#]+\.js$/.test(source[1]) ? [{ source: source[1], attributes }] : [];
  });
  assert.deepEqual(loadedTableScripts.map(({ source }) => source), expectedSources,
    'all configured tabletop scripts must load exactly once in their shared-global dependency order');
  loadedTableScripts.forEach(({ attributes }) => assert.doesNotMatch(attributes, /\btype\s*=\s*["']module["']/i,
    'the split files share classic-script globals and must not be loaded as isolated ES modules'));
  assert.deepEqual(htmlScriptTags.filter(({ attributes, body }) => !/\bsrc\s*=/i.test(attributes) && body.trim()), [],
    'application logic belongs in the extracted files, not an inline script in table.html');
  assert.doesNotThrow(() => new Function(appScript)); // compile only; browser code is not executed
});

test('all classic scripts can declare bindings in one shared browser global', () => {
  const context = vm.createContext({});
  classicScriptFiles.forEach((file) => {
    const marker = `DND_DECLARATION_SENTINEL:${file}`;
    const source = fs.readFileSync(path.join(root, 'ui', file), 'utf8');
    try {
      new vm.Script(`'use strict';\nthrow new Error(${JSON.stringify(marker)});\n${source}`, { filename: file })
        .runInContext(context);
      assert.fail(`${file} did not reach its declaration sentinel`);
    } catch (error) {
      assert.equal(error && error.message, marker,
        `${file} conflicts with a binding declared by an earlier classic script`);
    }
  });
});

test('turn status owns a reserved layout row instead of overlapping the board banner', () => {
  const turnAt = html.indexOf('id="turnflag"');
  const stageAt = html.indexOf('id="stage"');
  assert.ok(turnAt > 0 && turnAt < stageAt, 'turn HUD must sit before the board stage');
  assert.match(css, /#app\s*\{[^}]*grid-template-rows:\s*auto auto 1fr auto/s);
  const turnRule = css.match(/#turnflag\s*\{([^}]*)\}/s);
  assert.ok(turnRule);
  assert.doesNotMatch(turnRule[1], /position:\s*absolute/);
  assert.match(appScript, /Move and act in either order; you may split your movement/);
  assert.match(appScript, /Watching \$\{esc\(player\)\}/);
});

test('movement UI consumes the engine cost map and tracks remaining feet', () => {
  assert.match(appScript, /ENG\.computeMovementCosts/);
  assert.match(appScript, /selected\.moveRemaining\s*=\s*Math\.max/);
  assert.match(appScript, /movementCosts\.get\(destination\)/);
  assert.match(appScript, /That square is not a legal destination/);
  assert.match(appScript, /strokeRect\(px \+ 3, py \+ 3/);
});

test('inventory and character-sheet affordances are first class', () => {
  assert.match(appScript, /function inventoryOf\(/);
  assert.match(appScript, /function showCharacterSheet\(/);
  assert.match(html, /id="partyBtn"/);
  assert.match(appScript, /id="sheetBtn"/);
  assert.match(css, /\.inventory-grid\s*\{/);
  assert.match(css, /\.sheet-btn\s*\{/);
  assert.match(css, /\.card\.character-full\s*\{/);
  assert.match(appScript, /Available right now[\s\S]*Full potential[\s\S]*Actual inventory/);
  assert.match(appScript, /readyActions = allActions\.filter\(\(action\) => actionResourceStatus\(t, action\)\.available\)/);
  assert.match(appScript, /SPENT SPELLS[\s\S]*open 🎒 for full potential/);
});

test('new games wait in a multiplayer lobby and saves use optimistic revisions', () => {
  assert.match(appScript, /function showPartyBuilder\(/);
  assert.match(appScript, /function showLobby\(/);
  assert.match(appScript, /Create Multiplayer Lobby/);
  assert.match(appScript, /Start the Quest/);
  assert.match(appScript, /expectedRev/);
  assert.match(appScript, /r\.conflict && r\.state/);
  assert.match(appScript, /sheetsRev=/);
});

test('automation is scoped to an epoch-bound campaign, scene, actor, and turn', () => {
  assert.match(appScript, /let monsterTimer = null/);
  assert.match(appScript, /function scheduleMonsterCallback\(monster, delay, callback\)/);
  assert.match(appScript, /let automationEpoch = 0, turnAdvanceInFlight = null/);
  assert.match(appScript, /function automationRun\(actor, kind\)[\s\S]{0,300}epoch: automationEpoch[\s\S]{0,220}campaignId:[\s\S]{0,220}sceneId:[\s\S]{0,220}serial:/);
  assert.match(appScript, /function automationActor\(run\)[\s\S]{0,500}run\.epoch === automationEpoch[\s\S]{0,220}campaign\.campaign_id === run\.campaignId[\s\S]{0,220}board\.sceneId === run\.sceneId[\s\S]{0,220}Number\(board\.turnSerial\) === Number\(run\.serial\)/);
  assert.match(appScript, /function nextTurn\(\)[\s\S]{0,500}cancelAutomatedWork\(\)/);
  assert.match(appScript, /if \(_introEl\) \{ scheduleAutomatedCallback\(current, expectedKind, 500, callback\); return; \}/);
  assert.match(appScript, /const current = automationActor\(run\)[\s\S]{0,100}if \(!current\) return/);
});

test('authoritative state has one reconciliation path for sync and conflicts', () => {
  const applySource = sourceBetween('function applyAuthoritativeState(', 'async function restoreAuthoritativeBoard(');
  const syncSource = sourceBetween('async function reconcileSyncResponse(', 'function scheduleStateFlush(');
  assertInOrder(applySource, [
    'const branchWas = previous && previous.presentationGate && previous.presentationGate.id',
    'const branchNow = nextState.presentationGate && nextState.presentationGate.id',
    'cancelAutomatedWork(); cancelCombatDice()',
    'if (branchWas && branchNow && branchWas !== branchNow) { stopSpeech(); dismissCaption(); }',
    'turnResolutionPending = null; turnAdvanceInFlight = null',
    'board = nextState',
    'selected = null; selectedAction = null; inspect = null; clearReachable()',
    'updateInitiativeBar()',
  ], 'reconciliation must preserve current narration unless the authoritative branch changes');
  assert.doesNotMatch(applySource, /cancelCombatDice\(\);\s*stopSpeech\(\)/,
    'an ordinary multiplayer revision must not cut off the line already playing');
  assert.match(applySource, /if \(!sceneWas \|\| board\.sceneId !== sceneWas\) \{ indexTerrain\(\); layout\(\); \}/);
  assert.match(applySource, /const presentationLocked = handleAuthoritativePresentationGate\(previous\) \|\| !!rewindArchiveTransitionGate/);
  assert.match(applySource, /if \(!presentationLocked && board\.sharedRoll\) setTimeout\(\(\) => presentSharedRoll\(board\.sharedRoll\), 0\)/);
  assert.match(applySource, /if \(!presentationLocked && !sharedRollPending\(board\) && board\.mode === 'combat'\) setTimeout\(\(\) => beginTurn\(\), 0\)/,
    'a pending shared roll must remain the active phase instead of restarting initiative');
  assert.match(appScript, /applyAuthoritativeState\(response\.state, response\.rev\)/);
  assert.match(appScript, /applyAuthoritativeState\(r\.state, r\.rev, r\.sheets, r\.sheetsRev\)/);
  assert.match(appScript, /async function restoreAuthoritativeBoard\(\)[\s\S]{0,900}rev=-1[\s\S]{0,900}applyAuthoritativeState/);
  assert.match(appScript, /if \(!saved && !authoritativeApplied\)[\s\S]{0,180}await restoreAuthoritativeBoard\(\)/);
  assert.match(appScript, /rememberConfirmedBoard\(JSON\.parse\(payload\), rev, saveCampaignId\)/);
  assert.match(appScript, /let syncTimer = null, syncInFlight = false, syncEpoch = 0/);
  assert.match(appScript, /document\.hidden \|\| syncInFlight/);
  assert.match(appScript, /api\(`\/sync\?campaignId=[\s\S]{0,240}\{ timeoutMs: 8000 \}\)/);
  assert.match(appScript, /api\('\/state', \{ method: 'POST', timeoutMs: 15000/);
  assert.match(syncSource, /epoch !== syncEpoch[^\n]*campaign\.campaign_id !== campaignId/);
  assert.match(syncSource, /if \(boardsEquivalent\(board, response\.state\)\) \{\s*rev = Number\(response\.rev\); rememberConfirmedBoard\(response\.state, rev, campaignId\);\s*\} else \{ applyAuthoritativeState\(response\.state, response\.rev\); stateReconciled = true; \}/,
    'an echoed local save should only adopt its revision; a genuinely different board must reconcile');
});

test('seat ownership changes resume a newly automated active combat turn', () => {
  const resumeSource = sourceBetween('function resumeCombatAfterSeatChange(', 'function startSync()');
  const context = vm.createContext({});
  vm.runInContext(`
    let board = { mode: 'setup' }, calls = 0;
    function beginTurn() { calls++; }
    ${resumeSource}
    resumeCombatAfterSeatChange(true, false);
    board.mode = 'combat';
    resumeCombatAfterSeatChange(false, false);
    resumeCombatAfterSeatChange(true, true);
    resumeCombatAfterSeatChange(true, false);
    globalThis.calls = calls;
  `, context);
  assert.equal(context.calls, 1);
  assert.match(appScript, /resumeCombatAfterSeatChange\(seatsChanged, stateReconciled\)/,
    'sync must reconsider the active turn after applying the latest player seats');
});

test('setup is inspect-only and character claims lock when combat begins', () => {
  const pointerSource = sourceBetween('function onBoardPointerDown(event)', "cvs.addEventListener('pointerdown'");
  const setupSource = sourceBetween('function inspectSetupToken(token)', 'function handleFreeRoamPointer(');
  assertInOrder(pointerSource, [
    "if (board.mode === 'setup') { inspectSetupToken(token); return; }",
    "if (board.mode !== 'combat') { handleFreeRoamPointer(token, point); return; }",
  ], 'setup inspection must return before any free-roam or combat interaction');
  assert.match(setupSource, /token && token\.kind === 'pc'\) showCharacterSheet\(token\)/);
  assert.doesNotMatch(setupSource, /persist\(|positionSet|\.x\s*=|\.y\s*=/,
    'setup inspection must not mutate or save token placement');
  assert.match(appScript, /const canClaim = !!\(claiming && board && board\.mode === 'setup'\)/);
  assert.match(appScript, /const acceptingClaims = board\.mode === 'setup'/);
  assert.match(appScript, /if \(!board \|\| board\.mode !== 'setup'\) \{ banner\('Character claims lock/);
  assert.match(appScript, /acceptingClaims \? '<button class="big ghost" id="ovLobbyImport"/);
  const responseSource = sourceBetween('function acceptClaimResponse(result)', 'async function claimCharacter(');
  assertInOrder(responseSource, ['rev = Number(result.rev)', 'rememberConfirmedBoard(board, rev)'],
    'a successful claim must adopt its bumped revision before Start can save combat');
  assert.match(appScript, /async function claimCharacter[\s\S]{0,500}acceptClaimResponse\(r\)/);
  assert.match(appScript, /async function bootstrapLegacyOwnerClaim[\s\S]{0,600}acceptClaimResponse\(r\)/);
});

test('TV initializes the turn flag and sheets stay inside the stage', () => {
  assert.match(appScript, /else if \(board\.mode === 'combat'\) \{[\s\S]{0,180}setStoryOpen\(false\)[\s\S]{0,100}beginTurn\(\)/);
  const selectionSource = sourceBetween('function clearTurnSelection()', 'function resumeCompletedDeathSave(');
  const turnSource = sourceBetween('function beginTurn()', 'async function nextTurn()');
  assert.match(selectionSource, /renderDock\(\); setTurnFlag\(\)/);
  assert.match(turnSource, /if \(TV\) \{ clearTurnSelection\(\); banner\([^;]+\); return; \}/,
    'TV turn initialization must clear selection and render the shared turn flag');
  assert.match(css, /\.card\.character-full\s*\{[^}]*height:\s*calc\(100% - 24px\)/s);
});

test('automatic snapshots wait for the board save queue to drain', () => {
  const startSource = sourceBetween('async function startEncounter()', 'let monsterTimer = null');
  const prepareSource = sourceBetween('async function prepareSnapshot()', 'async function createSnapshot(');
  const createSource = sourceBetween('async function createSnapshot(', 'async function autoSnapshot(');
  const snapshotSource = sourceBetween('async function autoSnapshot(label)', 'async function showSaves()');
  assert.match(appScript, /async function flushPendingState\(\)/);
  assertInOrder(startSource, ['board.initiativeRollEvent = makeInitiativeRollEvent(initiative.rolls)', 'persist()',
    'const saved = await flushPendingState()', 'await resumePendingPresentationGate()', 'beginTurn(); void autoSnapshot('],
  'encounter state and exact initiative must commit before presentation or snapshots');
  assert.match(startSource, /if \(!saved \|\| !board \|\| board\.mode !== 'combat'\)[\s\S]*Nothing was narrated/);
  assertInOrder(prepareSource, ['const requestEpoch = campaignEpoch', 'await flushPendingState()', 'await archivePostQueue', 'requestEpoch !== campaignEpoch'],
    'snapshots must drain both durable queues and recheck campaign identity before POSTing');
  assertInOrder(createSource, ['await prepareSnapshot()', "api('/snapshot'", 'requestEpoch !== campaignEpoch']);
  assert.match(createSource, /JSON\.stringify\(\{ campaignId, label, auto \}\)/);
  assert.match(snapshotSource, /await createSnapshot\(label, true\)/);
  assert.match(appScript, /const s = await createSnapshot\(label, false\)/,
    'manual saves must use the same state-and-archive barrier as automatic snapshots');
  assert.match(appScript, /async function ensureResolvedEffects\(\)[\s\S]{0,500}await flushPendingState\(\)[\s\S]{0,220}void autoSnapshot\(`/);
});

test('story and narrative choices have reserved non-combat layout space', () => {
  const startSource = sourceBetween('async function startEncounter()', 'let monsterTimer = null');
  const storyAt = html.indexOf('id="story"');
  const choicesAt = html.indexOf('id="choices"');
  const talkAt = html.indexOf('id="talk"');
  assert.ok(storyAt > 0 && choicesAt > storyAt && choicesAt < talkAt, 'choices must live inside the story pane');
  assert.match(css, /#playfield\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 0/s);
  assert.match(css, /#playfield\.story-open\s*\{[^}]*grid-template-columns:/s);
  assert.doesNotMatch(css.match(/#choices\s*\{([^}]*)\}/s)[1], /position:\s*absolute/);
  assert.match(appScript, /\(board && board\.mode === 'combat'\)[\s\S]{0,100}el\.classList\.add\('hidden'\)/);
  assertInOrder(startSource, ['setStoryOpen(false)', 'renderChoices([])']);
});

test('only exact claims are human-controlled and unclaimed heroes are guarded AI companions', () => {
  const controlsBody = appScript.match(/function controls\(token\) \{([\s\S]*?)\n\}/);
  assert.ok(controlsBody);
  assert.match(controlsBody[1], /return myClaims\(\)\.includes\(token\.slug\)/);
  assert.doesNotMatch(controlsBody[1], /isOwner/);
  assert.match(appScript, /async function companionTurn\(run\)/);
  assert.match(appScript, /function scheduleCompanionCallback\(companion, delay, callback\)/);
  assert.match(appScript, /let hero = automationActor\(run\)[\s\S]{0,120}!isOwner\(\) \|\| !hero \|\| !isAICompanion\(hero\)/);
  assert.match(appScript, /actions\.sort\(\(a, b\) => Number\(b\.type === 'spell'\)/);
  assert.match(appScript, /ENG\.computeMovementCosts\(W\(\), \{ \.\.\.actor, speed: movementLeft\(actor\) \}\)/);
  assert.match(appScript, /const spent = best\.cost \* unitFeet\(\)/);
});

test('AI Companion and You ownership is unmistakably labeled', () => {
  assert.match(appScript, /return !seat \? 'AI Companion' : seat\.me \? 'You'/);
  assert.match(appScript, /AI Companion · available to claim/);
  assert.match(appScript, /AI Companion · moves and casts automatically/);
  assert.match(appScript, /<span class="turn-kicker">AI Companion · watching<\/span><strong>\$\{esc\(name\)\}'s turn<\/strong>/);
  assert.match(appScript, /Movement[\s\S]{0,180}Action[\s\S]{0,180}Spell slots[\s\S]{0,180}Health/);
  assert.doesNotMatch(appScript, /1 Move[\s\S]{0,160}2 Choose/);
  assert.match(appScript, /controller-badge/);
  assert.match(appScript, /Each person controls only their claimed hero/);
});

test('every AI Companion sets and announces position before its action', () => {
  const turnSource = sourceBetween('function beginTurn()', 'async function nextTurn()');
  const companionEntrySource = sourceBetween('function beginCompanionTurn(', 'function beginRemoteHeroTurn(');
  assert.match(appScript, /`\$\{name\} moves \$\{spent\} ft \$\{gridDirection[\s\S]{0,140}toward \$\{shortTokenLabel\(objective\)\} · position \(\$\{hero\.x\}, \$\{hero\.y\}\) set/);
  assert.match(appScript, /: `\$\{name\} stays at position \(\$\{hero\.x\}, \$\{hero\.y\}\) · position set/);
  assert.match(appScript, /hero\.positionSet = true[\s\S]{0,420}hero\.movementResult = makeMovementResult\(run, movement, before, hero, spent\)[\s\S]{0,180}persist\(\); renderDock\(\)[\s\S]{0,180}await flushPendingState\(\)[\s\S]{0,180}await finishAutomatedMovement\(run\)/);
  assert.match(appScript, /if \(movementStoryPending\(hero\)\) return void await finishAutomatedMovement\(run\)[\s\S]{0,100}if \(positionChosen\(hero\)\) return void await companionAct\(run\)/);
  assert.match(appScript, /The AI controls this turn; every available skill stays visible but cannot be selected/);
  assert.match(appScript, /chooses no action and takes no action; no legal target is in range/);
  assertInOrder(turnSource, ['const turnSpeech = announceTurn(token)', 'beginCompanionTurn(token, turnSpeech)'],
    'the named AI turn announcement must precede companion automation');
  assert.match(companionEntrySource, /Promise\.resolve\(turnSpeech\)[\s\S]*scheduleCompanionCallback\(current, dmNpcPaceMs\(650\),[\s\S]*companionTurn\(run\)/);
});

test('legacy owner bootstrap claims the first living hero only outside setup', () => {
  assert.match(appScript, /async function bootstrapLegacyOwnerClaim\(\)/);
  assert.match(appScript, /board\.mode !== 'combat' \|\| players\.some\(\(p\) => p\.slug\)/);
  assert.match(appScript, /board\.tokens\.find\(\(t\) => t\.kind === 'pc' && isConscious\(t\)\)/);
  assert.match(appScript, /api\('\/claim',[\s\S]{0,180}slug: hero\.slug/);
  assert.match(appScript, /const claimReady = await bootstrapLegacyOwnerClaim\(\)[\s\S]{0,1200}board\.mode === 'combat' && !claimReady\) showClaimRecovery\(\)/);
  assert.match(appScript, /whole party cannot run as AI Companions without you/);
});

test('defeated monsters leave while downed and fallen heroes remain visible but cannot take normal turns', () => {
  assert.match(appScript, /function defeatPresentationPending\(token\)[\s\S]{0,320}event\.rolls\.some\(\(roll\) => roll && roll\.targetId === token\.id\)/);
  assert.match(appScript, /board\.tokens\.filter\(\(t\) => \(!t\.fled \|\| turnStoryPending\(t\)\)[\s\S]{0,120}defeatPresentationPending\(t\)\)\)\.sort[\s\S]{0,80}\.forEach\(drawToken\)/);
  assert.match(appScript, /while \(guard\+\+ < board\.order\.length\)[\s\S]{0,100}canTakeTurn\(t\)/);
  assert.match(appScript, /board\.mode === 'combat' && canTakeTurn\(t\) && activeToken\(\)/);
  assert.match(appScript, /ctx\.fillText\(t\.stable \? 'STABLE' : 'DOWN'/);
  assert.match(appScript, /function sceneTokenDefinition\(token\)/);
  assert.match(appScript, /return tokenDisplayName\(token\)\.split/);
  assert.match(appScript, /shortTokenLabel\(t\)/);
});

test('server-authored DM beats advance the local archive sequence', () => {
  assert.match(appScript, /addBeat\('narration', r\.narration, message, r\.archiveEntry && r\.archiveEntry\.seq\)/);
  assert.match(appScript, /addBeat\('narration', r\.narration, null, r\.archiveEntry && r\.archiveEntry\.seq\)/);
  assert.match(appScript, /addBeat\('milestone', r\.narration, null, r\.archiveEntry && r\.archiveEntry\.seq\)/);
});

test('save payloads omit renderer-only token fields', () => {
  assert.match(appScript, /function serializeBoardForSave\(\)/);
  assert.match(appScript, /key\.startsWith\('_'\)[\s\S]{0,90}this\.id && this\.kind \? undefined/);
  assert.match(appScript, /const expectedRev = rev, payload = serializeBoardForSave\(\)/);
});

test('each turn gets one natural-language owner announcement keyed by turn serial', () => {
  assert.match(appScript, /let lastTurnAnnouncement = ''/);
  assert.match(appScript, /const key = `\$\{campaign[\s\S]{0,180}\$\{Number\(board\.turnSerial\) \|\| 0\}:\$\{token\.id\}`/);
  assert.match(appScript, /if \(key === lastTurnAnnouncement\) return/);
  assert.match(appScript, /`\$\{name\}, the field is yours\. Move and act in either order; you may split your movement\.`/);
  assert.match(appScript, /combatAutomatedTurnNarration\(token\)/);
  assert.doesNotMatch(appScript, /steps into the fight for the party|seizes the initiative/i);
  assert.match(appScript, /has control of \$\{name\}/);
  assert.doesNotMatch(appScript, /What will (?:you|\$\{name\}|he|she|they) do\?/i);
  assert.match(appScript, /lastTurnSpeech = Promise\.resolve\(presentPhase\(text, 1300, true\)\)/);
});

test('the gameplay surface can enter and exit table-only full screen', () => {
  assert.match(html, /id="fullscreenBtn"[^>]*>⛶ PLAY FULL SCREEN<\/button>/);
  assert.match(appScript, /document\.documentElement\.requestFullscreen\(\{ navigationUI: 'hide' \}\)/);
  assert.match(appScript, /document\.addEventListener\('fullscreenchange'/);
  assert.match(appScript, /document\.body\.classList\.toggle\('table-fullscreen', immersiveRequested\)/);
  assert.match(html, /id="railCharacter"[\s\S]*id="questThread"[\s\S]*id="log"[\s\S]*id="talk"/);
  assert.match(html, /data-dm-prompt="What do we know so far, and what remains unresolved\?"/);
  assert.match(html, /data-dm-prompt="What people, objects, or places can we search right now\?"/);
  assert.match(html, /data-dm-prompt="We are going in circles\. Give us three different ways forward\."/);
  assert.match(appScript, /document\.querySelectorAll\('\[data-dm-prompt\]'\)/);
  assert.match(css, /#railScroll\s*\{[^}]*overflow-y:\s*auto/);
});

test('My Games has one bounded campaign-list scrollbar', () => {
  assert.match(css, /\.card\.game-library\s*\{[^}]*overflow:\s*hidden[^}]*display:\s*flex/s);
  assert.match(css, /\.card\.game-library \.campaign-list\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
});

test('the campaign shelf overrides the legacy modal width without page overflow', () => {
  assert.match(css, /\.card\[data-screen="adventure-library"\]\s*\{[^}]*max-width:\s*min\(1180px,\s*94vw\)/);
  assert.match(css, /\.adventure-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.adventure-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test('fresh encounters and rewinds release authoritatively without waiting on narration media', () => {
  const startSource = sourceBetween('async function startEncounter()', 'let monsterTimer = null');
  const narrationSource = sourceBetween('async function narratePresentationGate(', '/** @description Resume the restored board');
  const completionSource = sourceBetween('async function completePresentationGate(', '/** @description Run one narration job');
  const rewindSource = sourceBetween('async function loadSnapshot(id)', '/**\n * CHANGE LOG');
  assertInOrder(startSource, [
    'installOpeningPresentationGate(',
    'const saved = await flushPendingState()',
    'await resumePendingPresentationGate()',
    "if (requestEpoch !== campaignEpoch || !campaign || campaign.campaign_id !== campaignId || !board || board.mode !== 'combat') return false",
    'if (board.presentationGate) return board.presentationGate.complete === true',
  ]);
  assert.match(narrationSource, /recordArchivedBeat\('narration', gate\.message, null, false\)/);
  assert.match(narrationSource, /return presentPhase\(gate\.message, gate\.kind === 'opening' \? 2400 : 1600, true,[\s\S]{0,120}notePresentationAudioResult/);
  assertInOrder(completionSource, ['live.complete = true', 'const saved = await flushPendingState()', 'resumeBoardAfterPresentation(live)']);
  assertInOrder(rewindSource, [
    'presenterId: presentationClientId',
    'pauseSyncForRewind()',
    'await prepareRewindArchive(r.state)',
    'applyAuthoritativeState(r.state, r.rev, r.sheets, r.sheetsRev)',
    'renderDock()',
    'if (!archiveReady) return false',
    'return resumePendingPresentationGate()',
  ]);
});

test('a controlled hero stays inert until its turn announcement resolves', async () => {
  const keySource = sourceBetween('function turnKey(token, serial)', 'function cancelAutomatedWork()');
  const gateSource = sourceBetween('function finishControlledTurnAnnouncement(', 'function beginCompanionTurn(');
  const context = vm.createContext({});
  vm.runInContext(`
    const campaign = { campaign_id: 'campaign-1' };
    const hero = { id: 'hero-1', name: 'Bram', kind: 'pc', acted: false };
    const board = { sceneId: 'scene-1', turnSerial: 7 };
    let turnAnnouncementPending = null, completedTurnAnnouncement = '';
    let selected = hero, reachable = new Set(['stale']), movementCosts = new Map();
    let releaseSpeech, renderCount = 0;
    const speech = new Promise((resolve) => { releaseSpeech = resolve; });
    function activeToken() { return hero; }
    function clearReachable() { reachable = new Set(); movementCosts = new Map(); }
    function computeReachable() { reachable = new Set(['legal-square']); }
    function renderDock() { renderCount++; }
    function turnStoryPending() { return false; }
    function movementLeft() { return 30; }
    function shortTokenLabel(token) { return token.name; }
    function banner() {}
    function finishPlayerResult() {}
    function automationRun() { return {}; }
    ${keySource}
    ${gateSource}
    globalThis.startGate = () => beginControlledHeroTurn(hero, speech);
    globalThis.releaseGate = () => releaseSpeech('spoken');
    globalThis.gateState = () => ({
      pending: turnAnnouncementPending,
      selected: selected && selected.id,
      reachable: Array.from(reachable),
      renderCount,
    });
  `, context);
  context.startGate();
  assert.deepEqual(JSON.parse(JSON.stringify(context.gateState())), {
    pending: 'campaign-1:scene-1:7:hero-1', selected: null, reachable: [], renderCount: 1,
  });
  context.releaseGate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(context.gateState())), {
    pending: null, selected: 'hero-1', reachable: ['legal-square'], renderCount: 2,
  });
});

test('movement, action, and End Turn all honor the announcement lock', () => {
  const buttonsSource = sourceBetween('function configureTurnButtons(active)', 'function renderDockIdentity(');
  const actionSource = sourceBetween('function selectAction(a)', 'function updateInitiativeBar(');
  const controlsSource = sourceBetween("$('endTurn').onclick", "$('gamesBtn').onclick");
  assert.match(buttonsSource, /const announcing = turnAnnouncementActive\(active\)/);
  assert.match(buttonsSource, /!announcing && playerCanEnd/);
  assert.match(buttonsSource, /!announcing && movementLeft\(active\) > 0/);
  assert.match(actionSource, /if \(turnAnnouncementActive\(t\)\)/);
  assert.match(controlsSource, /turnAnnouncementActive\(t\)/);
  assert.match(appScript, /The Dungeon Master announces \$\{name\}'s turn\. Movement and one action unlock together/);
  assert.match(buttonsSource, /Watching \$\{shortTokenLabel\(active\)\}/);
});

test('structured combat events expose every exact die in group and face order', () => {
  const context = vm.createContext({});
  vm.runInContext(`${diceSource}\n;globalThis.__diceContract = {
    structuredCombatFacts, combatFactsFor, combatFactTitle, combatRollFacts
  };`, context);
  const roll = (changes) => Object.assign({
    kind: 'attack', actorId: 'bram', actorName: 'Bram', targetId: 'goblin',
    targetName: 'Goblin', actionName: 'Longsword', dice: '1d20', faces: [14],
    bonus: 5, total: 19, targetKind: 'ac', target: 15, outcome: 'hit',
    ordinal: 1, count: 1,
  }, changes || {});
  const payload = {
    v: 1, eventId: 'turn:camp-1:9:bram:action',
    rolls: [
      roll({ faces: [8], total: 13, outcome: 'miss', ordinal: 1, count: 2 }),
      roll({ kind: 'damage', dice: '2d6', faces: [3, 5], bonus: 2, total: 10,
        targetKind: null, target: null, outcome: 'damage', ordinal: 1, count: 2 }),
      roll({ kind: 'healing', dice: '0d0', faces: [], bonus: 5, total: 5,
        targetKind: null, target: null, outcome: 'healed', actionName: 'Second Wind',
        targetId: 'bram', targetName: 'Bram', ordinal: 2, count: 2 }),
    ],
  };
  const facts = JSON.parse(JSON.stringify(context.__diceContract.structuredCombatFacts(payload)));
  assert.deepEqual(facts.map((fact) => [fact.roll.kind, fact.face, fact.groupIndex, fact.faceIndex]), [
    ['attack', 8, 0, 0], ['damage', 3, 1, 0], ['damage', 5, 1, 1], ['healing', null, 2, 0],
  ]);
  const save = roll({ kind: 'save', actorId: 'goblin', actorName: 'Goblin',
    targetId: 'della', targetName: 'Della', actionName: 'Sacred Flame',
    targetKind: 'dc', target: 13, outcome: 'fail' });
  const saveFact = JSON.parse(JSON.stringify(context.__diceContract.structuredCombatFacts({
    v: 1, eventId: 'turn:save-1', rolls: [save],
  })))[0];
  assert.equal(context.__diceContract.combatFactTitle(saveFact),
    "Goblin saves against Della's Sacred Flame - Saving throw");
  assert.equal(context.__diceContract.combatFactsFor(
    'Bram: 12+5=17 vs AC 15 - hit.').length, 1);
  assert.equal(context.__diceContract.combatFactsFor(
    'Bram: 12+5=17 vs AC 15 - hit.', { v: 1, eventId: 'invalid', rolls: [{}] }).length, 0,
    'legacy prose parsing must never replace a present structured payload');
  assert.match(diceSource, /facts\.map\(\(fact, index\) => queueCombatFact/);
  assert.match(diceSource, /return Promise\.all\(waits\)/);
});

test('combat result promises settle only after every queued exact die is shown', async () => {
  const automatedSource = sourceBetween('async function performAutomatedResultPresentation(', 'async function finishAutomatedResult(');
  const playerSource = sourceBetween('async function performPlayerResultPresentation(', 'async function finishPlayerResult(');
  const outcomeSource = sourceBetween('async function presentTacticalOutcome(', 'async function performAutomatedMovementPresentation(');
  const applySource = sourceBetween('function applyAuthoritativeState(', 'async function restoreAuthoritativeBoard(');
  const context = vm.createContext({});
  vm.runInContext(`${diceSource}\n;globalThis.__diceQueue = {
    queueCombatFact, settleCombatDie, queue: () => combatDiceQueue
  };`, context);
  const first = context.__diceQueue.queueCombatFact({ face: 8 }, 'event:one');
  const duplicate = context.__diceQueue.queueCombatFact({ face: 8 }, 'event:one');
  const second = context.__diceQueue.queueCombatFact({ face: 17 }, 'event:two');
  assert.equal(duplicate, first, 'an active archive echo must await the original die job');
  const drained = Promise.all([first, second]);
  let settled = false; drained.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  const queue = context.__diceQueue.queue();
  context.__diceQueue.settleCombatDie(queue[0], 'shown'); await Promise.resolve();
  assert.equal(settled, false);
  context.__diceQueue.settleCombatDie(queue[1], 'shown'); await drained;
  assert.equal(settled, true);
  assertInOrder(outcomeSource, ['showOutcomeRollStage(current, outcome)', 'presentCombatDie(outcome.text, null, outcome.rollEvent)', 'showOutcomeResultStage(current, outcome)', 'requestDungeonMasterCombatNarration(current, outcome)']);
  assertInOrder(playerSource, ['await presentTacticalOutcome(run, outcome, resultKey)', 'current.turnResult.complete = true']);
  assertInOrder(automatedSource, ['await presentTacticalOutcome(run, outcome, resultKey, outcome.lead)', 'current.turnResult.complete = true', 'await nextTurn()']);
  assert.doesNotMatch(outcomeSource, /dmResolve\(|await recordArchivedBeat/);
  assert.match(appScript, /function resetTurnPresentationMemory\(\) \{\s*cancelCombatDice\(\)/);
  assert.match(applySource, /if \(board && boardsEquivalent\(board, nextState\)\)[\s\S]{0,320}return;/,
    'an equivalent DM reply must leave the active exact die and presenter intact');
  assert.match(applySource, /cancelAutomatedWork\(\); cancelCombatDice\(\)/,
    'a genuinely changed authoritative board must cancel stale exact dice');
  const cleanupSource = sourceBetween('function clearCombatDieTimers(', 'function settleCombatDie(');
  assertInOrder(cleanupSource, ['clearInterval(item.flicker)', 'clearTimeout(item.landTimer)', 'clearTimeout(item.finishTimer)', 'item.element.remove()']);
  assert.match(diceSource, /if \(combatDiceCurrent !== item\) return;[\s\S]{0,120}combatDiceCurrent = null/);
});

test('movement and action unlock together while the action write records its current square', () => {
  assert.match(html, /class="big ghost hidden" id="stayBtn">Hold Position<\/button>/);
  assert.match(appScript, /const positionChosen = \(t\) => !!\(t && t\.positionSet\)/);
  assert.doesNotMatch(appScript, /_positionSet/);
  assert.match(appScript, /selected\.moved = selected\.moveRemaining < selected\.speed; selected\.positionSet = true;[\s\S]{0,180}persist\(\); renderDock\(\)/);
  assert.match(appScript, /const live = !presentationGatePending\(\) && isActiveMine && !t\.acted/);
  assert.match(appScript, /actor\.positionSet = true;\s*actor\.acted = true/);
  assert.match(appScript, /token\.moved = false; token\.positionSet = false; token\.acted = false/);
  assert.match(appScript, /Attack from this square or move first[\s\S]{0,120}unused movement remains after the attack/);
  assert.match(appScript, /stayBtn'\)\.textContent = 'Attack From Here'/);
  assert.match(appScript, /Move after attack/);
  assert.match(appScript, /resultComplete && turnResolutionPending === turnKey\(active\)[\s\S]{0,80}turnResolutionPending = null/);
  assert.match(appScript, /Action saved — movement remains available while the Dungeon Master finishes speaking/);
  assert.match(appScript, /\(!turnStoryPending\(active\) \|\| active\.acted\)/);
  assert.match(appScript, /\(!storyPending \|\| active\.acted\)/);
  assert.match(appScript, /🔒 \$\{seat \? seat\.name[\s\S]{0,120}Skills are view-only/);
  assert.match(appScript, /validTargets\(t, a\)/);
});

test('captions track the bounded neural-only speech lifecycle and can be dismissed', () => {
  const captionSource = sourceBetween('function captionExcerpt(text)', "cvs.addEventListener('pointerdown'");
  const introSource = sourceBetween('function runIntroCards(cards, onDone, ms)', '/** "Previously on');
  assert.match(appScript, /function dismissCaption\(\)/);
  assert.match(appScript, /captionReadMs = \(text\) => Math\.min\(60000, Math\.max\(5200, 2200 \+ String\(text \|\| ''\)\.length \* 90\)\)/);
  assert.match(captionSource, /if \(clean\.length <= 260\) return clean/);
  assert.match(captionSource, /el\.textContent = captionExcerpt\(text\)/);
  assert.match(captionSource, /Full narration is in Story/);
  assert.match(appScript, /function speakCaption\(text, priority\)[\s\S]{0,120}caption\(text, \{ hold: true \}\)[\s\S]{0,220}onDone:[\s\S]{0,100}releaseSpokenCaption/);
  assert.match(appScript, /async function presentPhase\(text, minimumMs, priority, onSpeechSettled, maximumMs\)[\s\S]{0,700}Promise\.race\(\[settledPhase, waitMs\(maximum - minimum\)\]\)[\s\S]{0,120}if \(!settled\) await settledPhase;[\s\S]{0,50}return status/);
  assert.match(voiceSource, /speechDeadlineMs = \(text\) => Math\.min\(90000, Math\.max\(16000/);
  assert.match(voiceSource, /async function fetchVoiceJson\(url, options, timeoutMs\)[\s\S]{0,300}AbortController[\s\S]{0,300}controller\.abort\(\)/);
  assert.match(voiceSource, /async function fetchSelectedNeuralVoice\(text, deadlineAt\)[\s\S]{0,220}remainingSpeechMs\(deadlineAt\)/);
  assert.match(voiceSource, /fetchVoiceJson\(API \+ '\/tts'[\s\S]{0,260}JSON\.stringify\(\{ text \}\)/);
  assert.match(voiceSource, /provider: 'google-cloud-tts', voiceId: 'en-US-Chirp3-HD-Algenib'/);
  assert.match(voiceSource, /provider: 'gemini-tts', voiceId: 'Algenib'/);
  assert.doesNotMatch(voiceSource, /voiceId: 'Kore'|Chirp3-HD-Kore/);
  assert.match(voiceSource, /function narratorLabel\(narrator\)/);
  assert.match(voiceSource, /state === 'idle'[\s\S]{0,260}Natural narrator ready/);
  assert.match(voiceSource, /DM Speaking · Settings/);
  assert.match(html, /id="voiceBtn"[^>]*>⚙ DM Settings<\/button>/);
  assert.match(appScript, /Dungeon Master Settings/);
  assert.match(voiceSource, /activeNarrator \? 'ready' : 'idle'/);
  assert.match(voiceSource, /return `\$\{label\} \(natural backup\)`/);
  assert.doesNotMatch(appScript, /\/api\/voice\/synthesize|speechSynthesis|SpeechSynthesisUtterance|browserSpeak/);
  assert.doesNotMatch(voiceSource, /4500|DM_VOICES|DM_VOICE\b/);
  assert.match(voiceSource, /localStorage\.removeItem\('dnd-device-voice'\)/);
  assert.match(appScript, /no robotic substitute will play/i);
  assert.match(voiceSource, /function playbackWatchdogMs\(text, durationMs\)/);
  assert.match(voiceSource, /if \(_actx && _actx\.state === 'running'\)/);
  assert.doesNotMatch(voiceSource, /unlockAudio\(\); setNeuralVoiceStatus\('checking'\)/);
  assert.match(voiceSource, /const VOICE_RETRY_COOLDOWN_MS = 10000;/);
  assert.match(voiceSource, /source\.onended = \(\) => done\('done'\)/);
  assert.match(voiceSource, /audio\.onended = \(\) => done\('done'\)/);
  assert.match(introSource, /await Promise\.all\(\[waitMs\(minimum\), spoken\]\)/);
  assert.doesNotMatch(introSource, /Promise\.race|maximum/);
  assert.match(appScript, /if \(i >= cards\.length\) \{ finish\(false\); return; \}/);
  assert.match(html, /id="voiceStatus"[^>]*>Algenib · Gravelly Storyteller<\/span>/);
  assert.doesNotMatch(html, /id="voiceSel"/);
  assert.match(appScript, /el\.onclick = dismissCaption/);
  assert.match(appScript, /e\.key === 'Escape' \|\| e\.key === 'Enter'/);
  assert.match(css, /#caption\.show\s*\{[^}]*pointer-events:\s*auto[^}]*cursor:\s*pointer/s);
});

test('Dungeon Master settings control spoken actions, dice math, and NPC pace', () => {
  assert.match(voiceSource, /const DM_PLAY_DEFAULTS = Object\.freeze\(\{ speakActions: true, speakDice: false, npcPace: 'standard' \}\)/);
  assert.match(voiceSource, /function setDmPlaySetting\(name, value\)/);
  assert.match(voiceSource, /function dmNpcPaceMs\(milliseconds\)/);
  assert.match(appScript, /id="vcActions"[\s\S]{0,180}Announce actions/);
  assert.match(appScript, /id="vcDice"[\s\S]{0,180}Read dice and targets/);
  assert.match(appScript, /id="vcPace"[\s\S]{0,180}Quick[\s\S]{0,180}Cinematic/);
  assert.match(automationSource, /dmPlaySetting\('speakActions'\)[\s\S]{0,600}combatOutcomeActionNarration/);
  assert.match(automationSource, /dmPlaySetting\('speakDice'\)[\s\S]{0,240}combatDiceNarration/);
  assert.match(appScript, /scheduleMonsterCallback\(current, dmNpcPaceMs\(650\)/);
  assert.match(diceSource, /function combatDiceNarration\(payload\)/);
});

test('authored NPC names remain primary while tactical roles and personality stay secondary', () => {
  assert.match(appScript, /function sceneTokenDefinition\(token\)/);
  assert.match(appScript, /function tokenDisplayName\(token\)/);
  assert.match(appScript, /function tokenRoleLabel\(token\)/);
  assert.match(appScript, /function tokenPersonality\(token\)/);
  assert.match(appScript, /return tokenDisplayName\(token\)\.split/);
  assert.match(appScript, /<b>\$\{esc\(tokenDisplayName\(token\)\)\}<\/b>/);
  assert.match(appScript, /class="rail-character-note"/);
  assert.match(appScript, /chip\.title = `\$\{tokenDisplayName\(t\)\} · \$\{controller\}`/);
});

test('every seated client narrates a newly synchronized live Story beat', () => {
  const syncBeat = sourceBetween('async function syncArchiveBeat(', 'async function syncArchiveTail(');
  assert.match(syncBeat, /if \(shouldPresent[\s\S]*speakCaption\(clean\)/);
  assert.doesNotMatch(syncBeat, /if \(TV\)[^\n]*speakCaption/);
});

test('catch-up recaps stay in the Story rail until neural narration finishes', () => {
  const catchupSource = sourceBetween('function playCatchup(onDone, narration, speakNow = true)', 'function overlay(html, screen)');
  assertInOrder(catchupSource, [
    'openStory()',
    "banner('Previously on",
    'const spoken = narration && speakNow ? speakCaption(narration)',
    'Promise.resolve(spoken)',
    'setStoryOpen(false); onDone()',
  ], 'the Story rail must remain open while the recap voice is speaking');
  assert.match(catchupSource, /the full recap is in Story/);
  assert.doesNotMatch(catchupSource, /overlay\(|slides|stage\.appendChild/,
    'recap prose must not cover the map');
  assert.match(catchupSource, /async function playCatchupRecap\(onDone, speakNow = true\)[\s\S]*await dmRecap\(false, false\)[\s\S]*playCatchup\(onDone, recap\.narration, speakNow\)/);
  const enterSource = sourceBetween('async function enterCampaign(campaignId)', 'async function bootTv()');
  assert.match(enterSource, /else if \(board\.mode === 'combat'\) \{[\s\S]{0,220}beginTurn\(\);[\s\S]{0,180}if \(needsCatchup\)[^\n]*playCatchupRecap\(\(\) => \{\}, false\)/);
  assert.doesNotMatch(enterSource, /playCatchupRecap\(\(\) => beginTurn\(\)\)/,
    'a recap voice must never own initiative recovery');
});

test('shared checks persist one roll and present that same result to rollers and spectators', () => {
  const turnSource = sourceBetween('function beginTurn()', 'async function nextTurn()');
  const dicePromptSource = sourceBetween('function dicePrompt(ctx)', 'function createDiceContext(req)');
  const diceContextSource = sourceBetween('function createDiceContext(req)', 'function captureDiceElements(ctx)');
  const diceRollSource = sourceBetween('async function performDiceRoll(ctx)', 'function wireDiceContext(ctx)');
  const diceWireSource = sourceBetween('function wireDiceContext(ctx)', 'function showDice(req)');
  const diceShowSource = sourceBetween('function showDice(req)', 'function presentSharedRoll(roll)');
  const sharedSource = sourceBetween('function presentSharedRoll(roll)', '/** Prose fallback');
  const dmSource = sourceBetween('async function dmNarrate(message, options)', '// Three tappable next-move suggestions');
  const sharedFlagSource = sourceBetween('function renderSharedRollFlag(', 'function renderDownedTurnFlag(');
  const flagSource = sourceBetween('function setTurnFlag()', 'function introCard(html, bgUrl)');

  assert.match(turnSource, /if \(sharedRollPending\(board\)\) \{[\s\S]*cancelAutomatedWork\(\); clearTurnSelection\(\); presentSharedRoll\(board\.sharedRoll\); return/,
    'initiative must pause while a shared roll is requested or awaiting narration');
  assert.match(diceContextSource, /const spectator = shared && !rollable\.length/);
  assert.match(dicePromptSource, /if \(ctx\.spectator\) return `Waiting for \$\{name\}[^`]*everyone will see the same result/);
  assert.match(diceWireSource, /ctx\.rollButton\.disabled = ctx\.spectator; ctx\.rollButton\.onclick = \(\) => void performDiceRoll\(ctx\)/);
  assert.match(diceWireSource, /ctx\.die\.onclick = ctx\.spectator \? null : \(\) => void performDiceRoll\(ctx\)/,
    'spectators may see the die but cannot roll it');
  assert.match(diceRollSource, /api\('\/roll', \{ method: 'POST', body: JSON\.stringify\(\{ campaignId: campaign\.campaign_id, rollId: ctx\.req\.id \}\) \}\)/,
    'the controlling player must resolve the server-persisted roll id');
  assertInOrder(diceRollSource, [
    'if (ctx.shared && response.state)',
    'applyAuthoritativeState(response.state, response.rev)',
    'await revealDiceResult(ctx, response.result || response.roll, true)',
  ], 'the persisted roll response must become authoritative before it is narrated');
  assert.match(diceWireSource, /ctx\.req && \['rolled', 'resolved'\]\.includes\(ctx\.req\.status\) && ctx\.req\.natural != null[\s\S]*presentPersistedDice\(ctx\)/,
    'spectators and reconnecting players must reveal the persisted natural, modifier, and total');
  assertInOrder(diceShowSource, ['createDiceContext(req)', 'captureDiceElements(ctx)', 'paintDiceChoices(ctx)', 'wireDiceContext(ctx)'],
    'the visible die must be built and wired through the same guarded shared-roll context');
  assert.match(sharedSource, /\['requested', 'rolled', 'resolved'\]\.includes\(roll\.status\)/);
  assert.match(sharedSource, /const key = sharedRollPresentationKey\(roll\)/);
  assert.match(sharedSource, /context\.req = roll[\s\S]*finishResolvedDiceContext\(context\)[\s\S]*presentPersistedDice\(context\)[\s\S]*showDice\(roll\)/);
  assert.match(dmSource, /applyAuthoritativeState\(r\.state, r\.rev, r\.sheets, r\.sheetsRev\)/);
  assert.match(dmSource, /rollId: opts\.rollId \|\| null/);
  assert.doesNotMatch(dmSource, /requestCutaway\(/,
    'ordinary DM questions must not spend an image request');
  assert.match(dmSource, /const proseAsk = opts\.rollResult \? null : detectRollAsk\(r\.narration\)/,
    'a submitted result cannot recursively ask for another roll');
  assert.match(dmSource, /Your roll is safe:[\s\S]*Retry Same Result[^`]*you will not reroll/);
  assert.match(sharedFlagSource, /Result: \$\{Number\(roll\.natural\)\}[\s\S]*Number\(roll\.modifier\)[\s\S]*Number\(roll\.total\)[\s\S]*Everyone sees this same result/);
  assert.match(flagSource, /renderSharedRollFlag\(flag, board && board\.sharedRoll\)/,
    'the reserved turn row must delegate pending shared rolls to the exact-result renderer');
});

test('downed heroes remain visible and receive one blocking unmodified death save on their turn', () => {
  const turnSource = sourceBetween('function beginTurn()', 'async function nextTurn()');
  const resumeSource = sourceBetween('function resumeCompletedDeathSave(', 'function initializeDrivenTurn(');
  const downedTurnSource = sourceBetween('function beginDownedTurn(', 'function scheduleVisibleCompanionDeathSave(');
  const deathSaveSource = sourceBetween('function showDeathSave(', 'async function doAction(');
  const reviveSource = sourceBetween('async function resumeAfterDeathSave(', 'async function performDeathSavePresentation(');
  assert.match(appScript, /function acknowledgeDowned\(hero\)/);
  assert.match(appScript, /is DOWN — not gone[\s\S]{0,420}natural 1 counts twice[\s\S]{0,180}natural 20 restores 1 HP/);
  assert.match(deathSaveSource, /deathSaveResolvedThisTurn\(hero\)/);
  assert.match(deathSaveSource, /ENG\.resolveDeathSave\(rollingHero, run\.serial, natural\)/);
  assert.match(deathSaveSource, /Death save \$\{score\.successes\} successes[^`]*\$\{score\.failures\} failures[^`]*no modifier/);
  assert.match(deathSaveSource, /already recorded before this roll/);
  assert.match(turnSource, /if \(isDowned\(token\)\) beginDownedTurn\(token, turnSpeech\)/);
  assert.match(downedTurnSource, /if \(controls\(token\)\)[\s\S]*Promise\.resolve\(turnSpeech\)[\s\S]*showDeathSave\(token, false\)/);
  assert.match(resumeSource, /if \(!hasDeathSaveResult\(token\) \|\| \(!turnStoryPending\(token\) && isConscious\(token\)\)\) return false/,
    'a natural-20 revival must not enter the dead/stable auto-advance branch once narration is complete');
  assert.match(reviveSource, /if \(!isConscious\(current\)\) \{ await nextTurn\(\); return true; \}/);
  assert.match(reviveSource, /isAICompanion\(current\)[\s\S]*await companionTurn\(run\)[\s\S]*controls\(current\)[\s\S]*computeReachable\(current\)[\s\S]*normal Move[^`]*Action turn[\s\S]*return true/,
    'a revived hero keeps the same initiative turn and receives a normal move/action phase');
  assert.match(css, /\.init-chip\.downed\s*\{/);
  assert.match(css, /#turnflag\.deathsave\s*\{/);
});

test('party and sheet UI explicitly distinguish ALIVE, DOWN, STABLE, and FALLEN heroes', () => {
  const initiativeSource = sourceBetween('function updateInitiativeBar()', 'function banner(msg)');
  const sheetSource = sourceBetween('function showCharacterSheet(token)', "if (typeof module !== 'undefined'");
  const dockIdentitySource = sourceBetween('function renderDockIdentity(', 'function renderDownedDock(');
  const dockSource = sourceBetween('function renderDock()', 'function slotStr(t)');
  assertInOrder(initiativeSource, [
    'const standing = pcs.filter(isConscious).length',
    'const down = pcs.filter((t) => isDowned(t) && !t.stable).length',
    'const stable = pcs.filter((t) => isDowned(t) && t.stable).length',
    'const fallen = pcs.filter((t) => t.dead).length',
  ], 'party totals must derive each condition from explicit token state');
  for (const label of ['ALIVE', 'DOWN', 'STABLE', 'FALLEN']) assert.match(initiativeSource, new RegExp(label));
  assert.match(initiativeSource, /const hpText = downed \? \(t\.stable \? 'Stable' : `Down S\$\{score\.successes\}\/F\$\{score\.failures\}`\) : defeated \?[^\n]*t\.kind === 'pc' \? 'Fallen'/);
  assert.match(sheetSource, /token\.stable \? 'STABLE' : `DOWN[^`]*S\$\{saves\.successes\}\/F\$\{saves\.failures\}`[\s\S]*token\.dead \? '[^']*FALLEN/);
  assert.match(dockIdentitySource, /t\.stable \? '[^']*STABLE' : '[^']*DOWN[^']*death save due'[\s\S]*t\.dead \? '[^']*FALLEN'/);
  assert.match(dockSource, /renderDockIdentity\(active, isActiveMine\)/,
    'the active-character dock must render the condition-aware identity helper');
});

test('death-save overlays are bound to one automation run and cancelled during reconciliation', () => {
  const cancelSource = appScript.slice(appScript.indexOf('function cancelAutomatedWork()'), appScript.indexOf('function automationRun'));
  const deathSaveSource = sourceBetween('function showDeathSave(', 'async function doAction(');
  const presentationSource = sourceBetween('async function performDeathSavePresentation(', 'async function finishDeathSaveResult(');
  const finishSource = sourceBetween('async function finishDeathSaveResult(', 'async function performPlayerResultPresentation(');
  assert.match(cancelSource, /automationEpoch\+\+[\s\S]*\.death-save-box[\s\S]*el\._cancelRoll\(\)/);
  assert.match(deathSaveSource, /const run = suppliedRun \|\| automationRun\(activeAtOpen, 'pc'\)/);
  assert.match(deathSaveSource, /const key = `\$\{run\.campaignId\}:\$\{run\.sceneId\}:\$\{run\.actorId\}:\$\{run\.serial\}:\$\{run\.epoch\}`/);
  assert.match(deathSaveSource, /el\._cancelRoll = \(\) => \{[\s\S]*finishResult\(null\)/);
  assert.match(deathSaveSource, /let rollingHero = automationActor\(run\)[\s\S]*ENG\.resolveDeathSave\(rollingHero, run\.serial, natural\)/);
  assertInOrder(deathSaveSource, [
    'ENG.resolveDeathSave(rollingHero, run.serial, natural)',
    'rollingHero.turnResult = makeTurnResult(run, result.text, null, result.rolls)',
    'persist(); updateInitiativeBar(); renderDock()',
    'const saved = await flushPendingState()',
    'await finishDeathSaveResult(run, automated)',
  ], 'the death-save outcome must be persisted before any result presentation begins');
  assert.doesNotMatch(deathSaveSource, /recordCombat\(result\.text\)|dmResolve\(result\.text/,
    'the rolling overlay must leave narration to the durable result presenter');
  assert.match(deathSaveSource, /rollButton\.onclick = automated \? null : doRoll/);
  assert.match(finishSource, /foreignLease && remaining > 0[\s\S]*scheduleAutomatedCallback[\s\S]*finishDeathSaveResult\(retryRun\)/);
  assert.match(finishSource, /result\.lease = automationClientId; result\.leaseAt = Date\.now\(\); persist\(\)[\s\S]*await flushPendingState\(\)/);
  assert.match(finishSource, /if \(playerResultJobs\.has\(resultKey\)\) return playerResultJobs\.get\(resultKey\)/);
  assert.match(finishSource, /maintainResultLease\(run, 'turnResult'\)/);
  assert.match(finishSource, /performDeathSavePresentation\(run, resultKey\)/,
    'the lease owner alone must launch the death-save presentation');
  assert.match(finishSource, /playerResultJobs\.delete\(resultKey\)[\s\S]*hasDeathSaveResult\(active\)[\s\S]*turnStoryPending\(active\)[\s\S]*finishDeathSaveResult\(retryRun\)/,
    'an interrupted presenter must retry only after its stale single-flight job retires');
  assertInOrder(presentationSource, [
    'await presentTacticalOutcome(run, outcome, resultKey)',
    'current.turnResult.complete = true',
    'const completed = await flushPendingState()',
    'if (await checkEnd())',
  ], 'one leased presenter must finish the exact story and commit completion before initiative can move');
  assert.match(appScript, /function rebuildAuthoritativeArchive[\s\S]{0,300}resetTurnPresentationMemory\(\)/);
});

test('player and automated results commit before story and complete before initiative advances', () => {
  const actionSource = sourceBetween('async function doAction(target)', '// Unclaimed heroes are explicitly AI companions');
  const playerPresentation = sourceBetween('async function performPlayerResultPresentation(', 'async function finishPlayerResult(');
  const playerFinish = sourceBetween('async function finishPlayerResult(', 'async function performAutomatedResultPresentation(');
  const automatedPresentation = sourceBetween('async function performAutomatedResultPresentation(', 'async function finishAutomatedResult(');
  const tacticalOutcome = sourceBetween('async function presentTacticalOutcome(', 'async function performAutomatedMovementPresentation(');
  const companionAction = sourceBetween('async function companionAct(', 'function monsterDefenseCue(');
  const monsterResolution = sourceBetween('async function resolveMonsterAction(', 'async function flee(');
  assertInOrder(actionSource, ['actor.turnResult = makeTurnResult(run, res.text, null, res.rolls)', 'persist(); renderDock()', 'const saved = await flushPendingState()', 'await finishPlayerResult(run, pendingKey)']);
  assert.match(playerFinish, /performPlayerResultPresentation\(run, resultKey, pendingKey\)/);
  assertInOrder(playerPresentation, ['await presentTacticalOutcome(run, outcome, resultKey)', 'current.turnResult.complete = true; persist()', 'const completed = await flushPendingState()']);
  assert.match(appScript, /const turnStoryPending = \(t\) => !!\(t && t\.turnResult[\s\S]{0,180}!t\.turnResult\.complete\)/);
  assert.match(appScript, /if \(turnStoryPending\(t\)\) \{ banner\('Wait for the exact result and Dungeon Master narration/);
  assert.match(companionAction, /hero\.turnResult = makeTurnResult\(run, text[\s\S]*persist\(\); renderDock\(\)[\s\S]*await flushPendingState\(\)[\s\S]*await finishAutomatedResult\(run\)/);
  assert.match(monsterResolution, /m\.turnResult = makeTurnResult\(run, res\.text[\s\S]*await flushPendingState\(\)[\s\S]*await finishAutomatedResult\(run\)/);
  assertInOrder(automatedPresentation, ['await presentTacticalOutcome(run, outcome, resultKey, outcome.lead)', 'current.turnResult.complete = true; persist()', 'const completed = await flushPendingState()', 'await nextTurn()']);
  assert.match(tacticalOutcome, /presentCombatDie\(outcome\.text, null, outcome\.rollEvent\)[\s\S]*showOutcomeResultStage[\s\S]*requestDungeonMasterCombatNarration\(current, outcome\)/);
  assert.match(automationSource, /const TACTICAL_MIN_MS = 2600;[\s\S]{0,100}const TACTICAL_MAX_MS = 24000;/);
  assert.match(automationSource, /function tacticalReadMs\(text\)[\s\S]{0,240}words \* 320/);
  assert.doesNotMatch(automationSource, /TACTICAL_CUE_MS|TACTICAL_RESULT_MS/);
  assert.doesNotMatch(automationSource, /dmResolve\(/);
});

test('automated result and defense-cue phases use durable single-presenter leases', () => {
  const resultSource = appScript.slice(appScript.indexOf('function makeTurnResult('), appScript.indexOf('async function companionTurn('));
  const playerResultSource = sourceBetween('async function finishPlayerResult(', 'async function performAutomatedResultPresentation(');
  const outcomePresentation = sourceBetween('async function presentTacticalOutcome(', 'async function performAutomatedMovementPresentation(');
  const automatedResultSource = sourceBetween('async function finishAutomatedResult(', 'async function companionTurn(');
  const automatedPresentation = sourceBetween('async function performAutomatedResultPresentation(', 'async function finishAutomatedResult(');
  const claimCueSource = sourceBetween('async function claimAutomatedCue(', 'async function moveMonsterForTurn(');
  const saveCueSource = sourceBetween('async function saveAutomatedActionCue(', 'async function claimAutomatedCue(');
  const presentCueSource = sourceBetween('async function presentActionCue(', 'async function saveAutomatedActionCue(');
  const identitySource = sourceBetween('function automationClientIdentity()', 'const automationClientId = automationClientIdentity()');
  assert.match(resultSource, /lease: automationClientId, leaseAt: Date\.now\(\), complete: false/);
  assert.match(playerResultSource, /foreignLease && remaining > 0[\s\S]*scheduleAutomatedCallback[\s\S]*finishPlayerResult\(retryRun/);
  assert.match(playerResultSource, /playerResultJobs\.has\(resultKey\)[\s\S]*performPlayerResultPresentation\(run, resultKey, pendingKey\)/);
  assert.match(outcomePresentation, /!locallyNarratedResults\.has\(resultKey\)[\s\S]*locallyNarratedResults\.add\(resultKey\)[\s\S]*presentCombatDie/);
  assert.match(automatedResultSource, /const foreignLease = result\.lease && result\.lease !== automationClientId/);
  assert.match(automatedResultSource, /if \(foreignLease && leaseRemaining > 0\)[\s\S]*scheduleAutomatedCallback[\s\S]*finishAutomatedResult\(retryRun\)/);
  assert.match(automatedResultSource, /result\.lease = automationClientId; result\.leaseAt = Date\.now\(\)[\s\S]*const claimed = await flushPendingState\(\)/);
  assert.match(automatedResultSource, /automatedResultJobs\.has\(resultKey\)[\s\S]*performAutomatedResultPresentation\(run, resultKey\)/);
  assert.match(automatedPresentation, /presentTacticalOutcome\(run, outcome, resultKey, outcome\.lead\)/);
  assert.match(claimCueSource, /const remaining = AUTOMATION_LEASE_MS[^\n]*cue\.leaseAt[\s\S]*remaining > 0/);
  assert.match(claimCueSource, /cue\.lease = automationClientId; cue\.leaseAt = Date\.now\(\); persist\(\)[\s\S]*await flushPendingState\(\)/);
  assert.match(saveCueSource, /board\.telegraph = \{[\s\S]*turnSerial: run\.serial[\s\S]*lease: automationClientId, leaseAt: Date\.now\(\)/);
  assert.match(presentCueSource, /locallyPresentedCues\.has\(key\)[\s\S]*locallyPresentedCues\.add\(key\)[\s\S]*combatActionCueNarration\(actor, target, action\)/);
  assert.match(appScript, /const AUTOMATION_SESSION_KEY = 'dnd-automation-client'/);
  assert.match(identitySource, /sessionStorage\.getItem\(AUTOMATION_SESSION_KEY\)[\s\S]*sessionStorage\.setItem\(AUTOMATION_SESSION_KEY, id\)/);
  assert.match(appScript, /const AUTOMATION_LEASE_MS = 20000;/);
  assert.match(appScript, /const AUTOMATION_HEARTBEAT_MS = 5000;/);
  assert.match(appScript, /function maintainResultLease[\s\S]{0,1000}AUTOMATION_HEARTBEAT_MS/);
});

test('automated movement is a durable narrated phase recovered before companion or monster actions', () => {
  const movementSource = appScript.slice(appScript.indexOf('function makeMovementResult('), appScript.indexOf('const playerResultJobs'));
  const movementPresentation = sourceBetween('async function performAutomatedMovementPresentation(', '/** Finish the exact persisted movement sentence');
  const movementFinish = sourceBetween('async function finishAutomatedMovement(', 'const playerResultJobs');
  const companionSource = appScript.slice(appScript.indexOf('async function companionTurn('), appScript.indexOf('async function companionAct('));
  const monsterMoveSource = sourceBetween('async function moveMonsterForTurn(', 'function monsterCueForTurn(');
  const monsterSource = sourceBetween('async function monsterTurn(', 'async function resolveMonsterAction(');
  const automatedStateSource = sourceBetween('function automatedTurnState(', 'function renderCompanionTurnFlag(');
  const companionFlagSource = sourceBetween('function renderCompanionTurnFlag(', 'function renderRemoteTurnFlag(');
  const buttonSource = sourceBetween('function configureTurnButtons(', 'function renderDockIdentity(');
  const endTurnSource = sourceBetween("$('endTurn').onclick = () =>", "$('stayBtn').onclick = () =>");
  assert.match(appScript, /const movementStoryPending = \(t\) => !!\(t && t\.movementResult[\s\S]{0,180}!t\.movementResult\.complete\)/);
  assert.match(movementSource, /fromX: Number\(before\.x\)[\s\S]{0,180}toX: Number\(actor\.x\)[\s\S]{0,180}feet: Number\(feet\) \|\| 0[\s\S]{0,180}complete: false/);
  assert.match(movementSource, /foreignLease && leaseRemaining > 0[\s\S]{0,500}scheduleAutomatedCallback[\s\S]{0,220}finishAutomatedMovement\(retryRun\)/);
  assert.match(movementSource, /movement\.lease = automationClientId; movement\.leaseAt = Date\.now\(\)[\s\S]{0,180}await flushPendingState\(\)[\s\S]{0,180}movement\.lease !== automationClientId/);
  assert.match(movementFinish, /maintainResultLease\(run, 'movementResult'\)[\s\S]*performAutomatedMovementPresentation\(run, movementKey\)/);
  assertInOrder(movementPresentation, ['combatMovementNarration(current, exactMovement)', 'current.movementResult.complete = true', 'const completed = await flushPendingState()', 'ready.movementResult && ready.movementResult.complete) beginTurn()']);
  assert.match(companionSource, /movementStoryPending\(hero\)[\s\S]{0,100}finishAutomatedMovement\(run\)[\s\S]{0,800}hero\.movementResult = makeMovementResult\(run, movement, before, hero, spent\)/);
  assert.match(monsterSource, /movementStoryPending\(monster\)[^\n]*finishAutomatedMovement\(run\)[\s\S]*!positionChosen\(monster\)[^\n]*moveMonsterForTurn\(run, monster, target\)/);
  assert.match(monsterMoveSource, /const spent = melee[^\n]*moveAutomatedToward\(monster, target\)[\s\S]*monster\.movementResult = makeMovementResult\(run, position, before, monster, spent\)[\s\S]*await flushPendingState\(\)[\s\S]*await finishAutomatedMovement\(run\)/);
  assert.match(appScript, /delete token\.turnResult; delete token\.movementResult/);
  assert.match(automatedStateSource, /const persisted = token\.movementResult && Number\(token\.movementResult\.serial\) === Number\(board\.turnSerial\) \? token\.movementResult\.text : ''/);
  assert.match(automatedStateSource, /const phase = automationPhase && automationPhase\.id === token\.id \? automationPhase\.cue : persisted \|\| fallback/);
  assert.match(companionFlagSource, /const state = turnStageState\(token\)[\s\S]*renderTurnResourceSteps\(token, state\.stage\)/,
    'the AI Companion row must use the shared resource-budget model');
  assert.match(buttonSource, /movementPending = movementStoryPending\(active\)[\s\S]*!movementPending[\s\S]*Watching \$\{shortTokenLabel\(active\)\}/);
  assert.match(endTurnSource, /if \(movementStoryPending\(t\)\)[\s\S]*saved movement is being recovered/);
});

test('archive echoes use sequence dedupe and a contiguous polling cursor', () => {
  assert.match(appScript, /let localArchiveEchoes = \[\]/);
  assert.match(appScript, /let archiveSeenSeq = new Set\(\)/);
  assert.match(appScript, /function registerArchiveSeq\(seq, element\)[\s\S]{0,420}archiveSeenSeq\.add\(value\)[\s\S]{0,520}while \(archiveSeenSeq\.has\(lastSeq \+ 1\)\) lastSeq\+\+/);
  assert.match(appScript, /function addBeat\(kind, text, say, seq, live\)[\s\S]{0,180}archiveSeenSeq\.has\(sequence\)\) return null/);
  assert.match(appScript, /function recordArchivedBeat\(kind, content, payload, required\)[\s\S]{0,260}localArchiveEchoes\.push\(marker\)/);
  assert.match(appScript, /function localArchiveEchoIndex\(beat\)[\s\S]{0,460}localArchiveEchoes\.findIndex/);
  assert.match(appScript, /let localArchiveEchoes = \[\], archivePostQueue = Promise\.resolve\(\)/);
  assert.match(appScript, /const queued = archivePostQueue\.then\(send, send\)[\s\S]{0,120}archivePostQueue = queued\.then/);
  assert.match(appScript, /void Promise\.resolve\(presentOpeningInitiative\(gate, false\)\)\.catch\(\(\) => null\)/);
  assert.match(appScript, /void Promise\.resolve\(recordArchivedBeat\('narration', gate\.message, null, false\)\)\.catch\(\(\) => null\)/);
  assert.match(appScript, /async function recordCombat\(content, rollEvent\)[\s\S]{0,180}recordArchivedBeat\('combat', content, rollEvent, true\)/);
});

test('a failed neural provider stays caption-only and retries after a short cooldown', () => {
  assert.match(appScript, /_voiceUnavailableUntil = 0/);
  assert.match(appScript, /Date\.now\(\) < _voiceUnavailableUntil[\s\S]{0,120}onSkip\('unavailable'\)/);
  assert.match(appScript, /_voiceUnavailableUntil = Date\.now\(\) \+ VOICE_RETRY_COOLDOWN_MS/);
  assert.match(voiceSource, /function retryNaturalVoice\(\)[\s\S]{0,180}_voiceUnavailableUntil = 0;[\s\S]{0,100}setNeuralVoiceStatus\('checking'\)/);
});

test('joined and owned campaign switches honor only the player local mute', () => {
  const newGame = sourceBetween('async function newCampaign(partySlugs)', 'async function bootstrapLegacyOwnerClaim()');
  const enter = sourceBetween('async function enterCampaign(campaignId)', 'async function bootTv()');
  assert.match(newGame, /applyLocalVoicePreference\(\)/);
  assert.match(enter, /applyLocalVoicePreference\(\)/);
  assert.doesNotMatch(enter, /campaign\.is_owner[^\n;]*voiceOn|voiceOn\s*=\s*(?:false|true)/);
  assert.match(voiceSource, /function setVoiceMuted\(muted\)[\s\S]{0,120}_voiceMutedByPlayer = !!muted/);
});

test('Dungeon Master recap requests are bounded and always remove pending UI', () => {
  const recapSource = appScript.slice(appScript.indexOf('async function dmRecap('), appScript.indexOf('// ── THE BIG DICE'));
  assert.match(recapSource, /new AbortController\(\)/);
  assert.match(recapSource, /setTimeout\(\(\) => controller\.abort\(\), 20000\)/);
  assert.match(recapSource, /api\('\/chat', \{ method: 'POST', signal: controller && controller\.signal/);
  assert.match(recapSource, /catch \(_e\)[\s\S]*The recap took too long/);
  assert.match(recapSource, /finally \{[\s\S]*clearTimeout\(timer\)[\s\S]*el\.remove\(\)/);
});

test('finished legacy battles explain removed heroes and never silently resume automation', () => {
  assert.match(appScript, /function showResolvedState\(\)/);
  assert.match(appScript, /previous rules treated 0 HP as immediate removal[\s\S]{0,220}heroes stay visible as <b>DOWN<\/b>/);
  assert.match(appScript, /board\.mode === 'resolved'[\s\S]{0,260}showResolvedState\(\)/);
  assert.match(appScript, /let advanceInFlight = false[\s\S]{0,160}if \(advanceInFlight\) return/);
  assert.match(appScript, /async function advanceScene\(\)[\s\S]{0,520}await flushPendingState\(\)/);
});

test('terminal outcome effects are claimed once and routed through centralized presenters', () => {
  const victorySource = appScript.slice(appScript.indexOf('function victory()'), appScript.indexOf('async function ensureResolvedEffects()'));
  const outcomeSource = appScript.slice(appScript.indexOf('async function ensureResolvedEffects()'), appScript.indexOf('// ── Cutaway art'));
  assert.doesNotMatch(victorySource, /recordArchivedBeat|autoSnapshot|requestCutaway|dmResolve/);
  assert.match(victorySource, /board\.mode = 'resolved'[\s\S]{0,180}await flushPendingState\(\)[\s\S]{0,300}showResolvedState\(\)/);
  assert.match(outcomeSource, /board\.outcomeEffects = \{ sceneId: scene\.id, kind: 'victory', claimedAt: Date\.now\(\) \}[\s\S]*await flushPendingState\(\)[\s\S]*recordArchivedBeat\('milestone'/);
  assert.match(outcomeSource, /if \(!complete && !legacyFallen\.length\)[\s\S]{0,80}if \(!explored\) void ensureResolvedEffects\(\)/);
  assert.match(outcomeSource, /if \(r\.done\)[\s\S]*board = r\.state[\s\S]*showResolvedState\(\)/);
  assert.match(outcomeSource, /board\.outcomeEffects = \{ sceneId: board\.sceneId, kind: 'defeat', claimedAt: Date\.now\(\) \}[\s\S]*flushPendingState\(\)\.then\(\(saved\) => \{ if \(saved\) recordArchivedBeat\('milestone'/);
  assert.match(appScript, /if \(modeWas !== board\.mode && !TV\)[\s\S]{0,220}board\.mode === 'resolved' \|\| board\.mode === 'complete'[\s\S]{0,120}board\.mode === 'defeat'/);
  assert.match(appScript, /else if \(board\.mode === 'resolved'\)[\s\S]{0,300}else if \(board\.mode === 'complete'\)[\s\S]{0,300}else if \(board\.mode === 'defeat'\)/);
});

test('boot never auto-enters a campaign and explicit invite links route to the join screen', () => {
  const bootSource = sourceBetween('async function boot()', "$('endTurn').onclick");
  assert.match(appScript, /Copy Invite Link/);
  assert.match(appScript, /How friends join/);
  assert.match(appScript, /u\.searchParams\.set\('join', campaign\.join_code \|\| ''\)/);
  assert.match(appScript, /function showJoin\(prefill\)[\s\S]{0,220}params\.get\('join'\)/);
  assertInOrder(bootSource, [
    "const inviteCode = String(params.get('join')",
    'if (inviteCode) { showJoin(inviteCode); return; }',
    'clearSessionSurface(); await showGameMenu()',
  ], 'an explicit invite must win; ordinary sign-in must land on My Games');
  assert.doesNotMatch(bootSource, /enterCampaign\(/,
    'phone/table boot must not silently resume the last campaign');
  assert.match(appScript, /Quest in progress · claims locked/);
});

test('My Games separates resume, playback, quit, and permanent leave without discarding state', () => {
  const clearSource = sourceBetween('function clearSessionSurface()', 'async function quitToGameMenu()');
  const quitSource = sourceBetween('async function quitToGameMenu()', 'function campaignPlace(row)');
  const menuSource = sourceBetween('async function showGameMenu()', 'function showTitle()');
  const sessionSource = sourceBetween('function showSessionMenu()', 'function confirmLeaveCurrentCampaign()');

  assert.match(html, /id="gamesBtn"[^>]*title="Leave this table, resume, join, or start another campaign"/);
  assert.match(clearSource, /campaign = null; board = null/);
  assert.match(clearSource, /My Games<small>No campaign is running on this screen/);
  assert.match(clearSource, /\['endTurn','stayBtn','moveBtn'\][^\n]*disabled = true/);
  assertInOrder(quitSource, [
    'flushPendingState()',
    'resetCampaignPipelines(); clearSessionSurface(); recapDone = false',
    'await showGameMenu()',
  ], 'Quit must drain pending state, stop the session, and return to My Games');
  assert.match(quitSource, /Promise\.race\(\[flushPendingState\(\)[\s\S]*waitMs\(4000\)\]\)/,
    'leaving the active screen must be bounded if connectivity is poor');
  assert.doesNotMatch(quitSource, /campaign\/leave|DELETE|Leave Campaign/,
    'Quit to My Games must never release membership or delete campaign data');
  assert.match(menuSource, /Promise\.all\(\[api\('\/campaigns'\)[\s\S]*fetchSavedCharacters\(\)/);
  assert.match(menuSource, /Signing in never drops you into a campaign automatically/);
  assert.match(menuSource, /data-resume="\$\{esc\(row\.campaign_id\)\}">Resume/);
  assert.match(menuSource, /data-playback="\$\{esc\(row\.campaign_id\)\}">Playback/);
  assert.match(menuSource, /campaignPlaybackOnly\(row\)/);
  assert.match(menuSource, /await enterCampaign\(button\.dataset\.resume\)/,
    'only a selected Resume button may open a saved campaign');
  assert.match(menuSource, /showCampaignPlayback\(button\.dataset\.playback/,
    'terminal campaign cards must open playback without entering a live table');
  assert.match(sessionSource, /Quit to My Games[\s\S]*keeps the campaign saved[\s\S]*never erases the story or gives up your seat/);
  assert.match(sessionSource, /Leave Campaign[\s\S]*separate permanent membership action/);
  assert.match(sessionSource, /sessionQuit[\s\S]*quitToGameMenu\(\)/);
  assert.match(appScript, /id="playbackLeaveTable">Quit to My Games/);
  assert.match(appScript, /\$\('gamesBtn'\)\.onclick = showSessionMenu/);
});

test('enemy actions telegraph attacker, target, defense, and result before advancing', () => {
  const saveCueSource = sourceBetween('async function saveAutomatedActionCue(', 'async function claimAutomatedCue(');
  const choiceSource = sourceBetween('async function presentMonsterChoice(', 'async function monsterTurn(');
  const resolutionSource = sourceBetween('async function resolveMonsterAction(', 'async function flee(');
  const resultPresentation = sourceBetween('async function performAutomatedResultPresentation(', 'async function finishAutomatedResult(');
  assert.match(appScript, /function drawCombatTelegraph\(\)/);
  assert.match(saveCueSource, /telegraph = \{ actorId: actor\.id, targetId: target\.id \}/);
  assert.match(saveCueSource, /board\.telegraph = \{[\s\S]*\.\.\.telegraph, turnSerial: run\.serial, actionId:[\s\S]*lease: automationClientId, leaseAt: Date\.now\(\)[\s\S]*await flushPendingState\(\)/);
  assert.match(choiceSource, /chooses \$\{action\.name\}\. \$\{name\} targets \$\{shortTokenLabel\(target\)\}[^`]*defense: \$\{monsterDefenseCue\(action, target\)\}/);
  assertInOrder(choiceSource, ['await saveMonsterDefenseCue(run, monster, target, action, cue)', 'await presentActionCue(monster, run, target, action, cue)', 'await resolveMonsterAction(run, target.id'],
    'the saved target and defense cue must be presented before the attack resolves');
  assertInOrder(resolutionSource, ['m.turnResult = makeTurnResult(run, res.text', 'const saved = await flushPendingState()', 'await finishAutomatedResult(run)']);
  assertInOrder(resultPresentation, ['await presentTacticalOutcome(run, outcome, resultKey, outcome.lead)', 'current.turnResult.complete = true; persist()', 'const completed = await flushPendingState()', 'await nextTurn()']);
  assert.doesNotMatch(resolutionSource, /delete board\.telegraph/,
    'the persisted defense cue must survive resolution until the separate advance');
  assert.match(appScript, /attack vs AC \$\{target\.ac\}/);
  assert.match(appScript, /Armor Class \(AC\)[\s\S]{0,180}saving throw/);
});
