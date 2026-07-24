/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Add visible shared searches, conversations, prerequisite clues, and evidence-gated chapter completion before combat.
 */

'use strict';

let explorationActionPending = false;

/** @description Return the active authored investigation contract. */
function activeExploration() {
  const scene = SC();
  return scene && scene.kind === 'exploration' && scene.exploration || null;
}

/** @description Normalize discoveries from synchronized board state. */
function discoveredLeadIds() {
  const progress = board && board.exploration;
  return new Set(progress && Array.isArray(progress.discovered) ? progress.discovered : []);
}

/** @description Calculate the authored evidence threshold shown to every player. */
function explorationRequirement() {
  const exploration = activeExploration();
  if (!exploration) return 0;
  const mandatory = exploration.leads.filter((lead) => lead.optional !== true).length;
  return Math.max(1, Math.min(mandatory, Number(exploration.required) || mandatory));
}

/** @description Determine whether a lead's prerequisite discoveries are shared. */
function explorationLeadReady(lead, found) {
  return (lead.requires || []).every((id) => found.has(id));
}

/** @description Render a visible searchable person, place, or object. */
function explorationLeadButton(lead, found) {
  const discovered = found.has(lead.id), ready = explorationLeadReady(lead, found);
  const button = document.createElement('button');
  button.className = `exploration-lead${discovered ? ' discovered' : ''}`;
  button.disabled = discovered || !ready || explorationActionPending;
  button.innerHTML = `<span>${discovered ? '✓' : lead.type === 'person' ? '◉' : lead.type === 'object' ? '◆' : '⌖'}</span>
    <b>${esc(lead.name)}</b><small>${esc(discovered ? 'Discovered · recorded in Story' : ready ? lead.prompt : 'Locked · another clue connects here')}</small>`;
  if (!discovered && ready) button.onclick = () => void investigateLead(lead, button);
  return button;
}

/** @description Show exploration instead of combat actions in the persistent dock. */
function renderExplorationDock() {
  const scene = SC(), exploration = activeExploration(), found = discoveredLeadIds();
  const required = explorationRequirement(), complete = found.size >= required;
  setTurnFlag(); renderGameplayRail();
  $('who').innerHTML = `<div class="name">${esc(scene.title)}</div>
    <div class="sub">INVESTIGATION · ${found.size}/${required} essential leads found</div>
    <div class="role">${esc(exploration.guidance || 'Search, question people, and connect the evidence.')}</div>`;
  const actions = $('actions'); actions.innerHTML = '';
  exploration.leads.forEach((lead) => actions.appendChild(explorationLeadButton(lead, found)));
  $('stayBtn').classList.add('hidden'); $('moveBtn').disabled = true;
  $('moveBtn').textContent = 'Explore the leads';
  $('endTurn').disabled = !complete || !isOwner() || explorationActionPending;
  $('endTurn').textContent = complete
    ? isOwner() ? 'Follow the Evidence →' : 'Waiting for host'
    : `${required - found.size} clue${required - found.size === 1 ? '' : 's'} needed`;
}

/** @description Start a story chapter without manufacturing initiative or a fight. */
async function startExploration() {
  const scene = SC(), requestEpoch = campaignEpoch;
  board.mode = 'exploration';
  board.exploration = { discovered: [] };
  board.order = board.tokens.filter((token) => token.kind === 'pc').map((token) => token.id);
  board.turnIndex = 0; board.round = 0;
  persist();
  if (!(await flushPendingState()) || requestEpoch !== campaignEpoch) {
    banner('The investigation did not start on the shared table. Try Start the Quest again.');
    return false;
  }
  setStoryOpen(true);
  void recordArchivedBeat('narration', scene.opening, null, false);
  requestCutaway(`${scene.title}. ${scene.opening}`, false,
    `opening:${campaign.campaign_id}:exploration:${scene.id}`);
  await presentPhase(scene.opening, 2400, true);
  renderChoices(scene.openingChoices || []);
  updateInitiativeBar(); renderDock();
  void autoSnapshot(`▶ ${scene.title} — investigation begins`);
  return true;
}

/** @description Dispatch the correct authored chapter controller after its intro. */
function startScene() {
  return SC() && SC().kind === 'exploration' ? startExploration() : startEncounter();
}

/** @description Reveal one exact authored clue and share it with all table members. */
async function investigateLead(lead, button) {
  if (explorationActionPending) return;
  explorationActionPending = true; button.disabled = true; button.classList.add('working');
  banner(`${lead.type === 'person' ? 'Speaking with' : 'Searching'} ${lead.name}…`);
  const result = await api('/explore', {
    method: 'POST',
    body: JSON.stringify({ campaignId: campaign.campaign_id, action: 'discover', leadId: lead.id }),
  }).catch(() => null);
  explorationActionPending = false;
  if (!result || !result.ok) {
    banner(result && result.error || 'That lead could not be resolved yet.'); renderDock(); return;
  }
  applyAuthoritativeState(result.state, result.rev);
  addBeat('discovery', `${lead.name}: ${result.narration}`, null,
    result.archiveEntry && result.archiveEntry.seq);
  openStory(); renderDock();
  await presentPhase(result.narration, 1800, true);
}

/** @description Convert a completed investigation into the existing rewindable scene advance. */
async function completeExplorationScene() {
  if (explorationActionPending || !isOwner()) return;
  explorationActionPending = true; renderDock();
  const result = await api('/explore', {
    method: 'POST',
    body: JSON.stringify({ campaignId: campaign.campaign_id, action: 'complete' }),
  }).catch(() => null);
  explorationActionPending = false;
  if (!result || !result.ok) {
    banner(result && result.error || 'The evidence could not be followed yet.'); renderDock(); return;
  }
  applyAuthoritativeState(result.state, result.rev);
  renderChoices([]); showResolvedState();
}

/** @description Restore exploration controls after resume or multiplayer synchronization. */
function resumeExploration() {
  setStoryOpen(true); updateInitiativeBar(); renderDock();
}
