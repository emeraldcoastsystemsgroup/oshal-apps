/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Add visible shared searches, conversations, prerequisite clues, and evidence-gated chapter completion before combat.
 * 2026-07-26 23:15:00 | roger.murphy@emeraldcoastsystemsgroup.com  | A lead is a question put to ONE hero, not a checkbox for whoever taps first: every lead names the hero the fiction would send and why (skill + modifier), that player's device is coaxed with their own leads lit up, and anyone else has to deliberately STEP IN. The acting hero walks to the lead's spot on the map before it resolves, and the server's contested roll is shown — a miss keeps the lead open for someone else, so the chapter is a struggle instead of a checklist.
 * 2026-07-27 23:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Announce the figure a discovery puts on the board: the hero already walked to the lead's spot, but nothing was ever drawn there, so everyone the party met stayed invisible.
 * 2026-07-27 23:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Walk to where the lead's figure actually stands (authored prop or cast token) instead of a hashed scatter cell, and tell players plainly that free walking is open during an investigation.
 * 2026-07-31 23:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Roadmap #13 — the lead roll lands on the big shared d20: a lead tap now opens the shared die overlay every device watches (the server answers rollRequested with the persisted sharedRoll), the acting player rolls it through the same /roll route as every other check, and commitLeadRoll() applies the outcome (discovery or ledgered miss) through the existing requested/rolled/resolved protocol — never a second parallel dice path. Lead buttons wait while any shared roll is pending.
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

/** @description Heroes who have already worked a lead, so the dock can say so. */
function leadAttempts(leadId) {
  const progress = board && board.exploration;
  const attempts = progress && progress.attempts && progress.attempts[leadId];
  return Array.isArray(attempts) ? attempts : [];
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

/** @description The seated party as sheets the nomination math can rank. */
function explorationParty() {
  return (board && board.tokens || [])
    .filter((token) => token.kind === 'pc' && token.slug && boardSheets[token.slug])
    .map((token) => Object.assign({}, boardSheets[token.slug], {
      slug: token.slug,
      id: boardSheets[token.slug].id || token.slug,
      name: boardSheets[token.slug].name || token.name || token.slug,
    }));
}

/** @description The hero this table should send for a lead (identical on every device). */
function leadNominee(lead) {
  return window.DnDLeads ? window.DnDLeads.nominee(lead, explorationParty()) : null;
}

/** @description My best hero for a lead, for stepping in when the nominee is not mine. */
function myBestFor(lead) {
  const mine = explorationParty().filter((hero) => {
    const token = (board.tokens || []).find((entry) => entry.slug === hero.slug);
    return token && controls(token);
  });
  if (!mine.length) return null;
  return window.DnDLeads ? (window.DnDLeads.rankHeroesForLead(lead, mine)[0] || null) : null;
}

/** @description Whether the nominated hero is one this device actually plays. */
function nomineeIsMine(nomination) {
  if (!nomination) return false;
  const token = (board.tokens || []).find((entry) => entry.slug === nomination.hero.slug);
  return !!token && controls(token);
}

/** @description Walk a hero to the lead's spot so investigating is a move, not a click. */
function walkToLead(lead, heroSlug) {
  const exploration = activeExploration(), scene = SC();
  if (!exploration || !window.DnDLeads) return;
  const token = (board.tokens || []).find((entry) => entry.kind === 'pc' && entry.slug === heroSlug);
  if (!token || !(controls(token) || isOwner())) return;
  // A lead that names an authored prop IS that figure — walk to where they actually
  // stand, not to a hashed scatter cell across the map. Cast figures likewise.
  const authoredId = lead.prop && (scene.props || []).some((p) => p.id === lead.prop) ? lead.prop
    : (scene.props || []).some((p) => p.id === lead.id) ? lead.id : '';
  const anchor = (board.tokens || []).find((entry) => entry.id === (authoredId || `lead:${lead.id}`));
  const spot = anchor ? { x: anchor.x, y: anchor.y } : window.DnDLeads.leadSpot(lead, scene, exploration.leads);
  // Stand BESIDE the lead — never ON it (the server walk uses the same candidate
  // ring, so the locally animated cell and the committed cell agree). Blocking
  // terrain is respected; if every beside cell is taken, stay put and let the
  // authoritative response place the hero.
  const blocked = new Set((((scene.terrain) || {}).blocking || []).map((cell) => `${cell.x},${cell.y}`));
  const target = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
    .map((offset) => ({ x: spot.x + offset[0], y: spot.y + offset[1] }))
    .find((cell) => cell.x >= 0 && cell.y >= 0
      && cell.x < (scene.grid.w || 18) && cell.y < (scene.grid.h || 12)
      && !blocked.has(`${cell.x},${cell.y}`)
      && !(board.tokens || []).some((other) => other !== token && other.x === cell.x && other.y === cell.y));
  if (!target || (token.x === target.x && token.y === target.y)) return;
  token.x = target.x; token.y = target.y;
  persist();
}

/**
 * @description Land a newly discovered figure on the board out loud. A clue that only
 *   changes a token list reads as nothing happening; the party should SEE who they met.
 * @param {object} cast - The server's report of the figure that appeared, if any.
 * @returns {void}
 */
function announceCast(result) {
  const report = (result && result.cast) || (result && result.met) || null;
  if (!report || !report.id) return;
  const token = (board.tokens || []).find((entry) => entry.id === report.id);
  if (!token) return;
  selected = null; inspect = token;
  if (!result.cast) return; // Already standing there — the party reached them, nobody arrived.
  floater(token, token.leadType === 'person' ? 'joins the scene' : 'found', '#f0bf68');
  banner(`${report.name} is on the map now.`);
}

/** @description Render a visible searchable person, place, or object. */
function explorationLeadButton(lead, found) {
  const discovered = found.has(lead.id), ready = explorationLeadReady(lead, found);
  const nomination = leadNominee(lead), mine = nomineeIsMine(nomination);
  const tried = leadAttempts(lead.id);
  const button = document.createElement('button');
  const glyph = discovered ? '✓' : lead.type === 'person' ? '◉' : lead.type === 'object' ? '◆' : '⌖';
  button.className = `exploration-lead${discovered ? ' discovered' : ''}${!discovered && ready && mine ? ' mine' : ''}`;
  // While ANY shared roll is up (a lead's or the DM's), the die owns the table —
  // the server refuses a second request anyway (ROLL_PENDING); say it with the UI.
  button.disabled = discovered || !ready || explorationActionPending || sharedRollPending(board);
  let caption;
  if (discovered) caption = 'Discovered · recorded in Story';
  else if (!ready) caption = 'Locked · another clue connects here';
  else if (!nomination) caption = lead.prompt;
  else {
    const sign = nomination.mod >= 0 ? '+' : '';
    const who = mine ? 'You' : nomination.hero.name;
    caption = `${who} · ${nomination.skill} ${sign}${nomination.mod}`
      + (tried.length ? ` · ${tried.length} tried` : '');
  }
  button.innerHTML = `<span>${glyph}</span><b>${esc(lead.name)}</b><small>${esc(caption)}</small>`;
  if (!discovered && ready) button.onclick = () => void investigateLead(lead, button);
  return button;
}

/** @description Tell this device's player which leads are theirs to work. */
function explorationCoax(found) {
  const exploration = activeExploration();
  if (!exploration) return '';
  const open = exploration.leads.filter((lead) => !found.has(lead.id) && explorationLeadReady(lead, found));
  const forMe = open.filter((lead) => nomineeIsMine(leadNominee(lead)));
  if (!open.length) return 'Every lead here has been worked.';
  if (!forMe.length) {
    const next = leadNominee(open[0]);
    return next ? `${next.hero.name} is best placed for what is left — or step in yourself.`
      : 'Search, question people, and connect the evidence.';
  }
  return forMe.length === 1
    ? `${esc(forMe[0].name)} is yours to work — you are the best hand for it.`
    : `${forMe.length} of these leads are yours to work.`;
}

/** @description Show exploration instead of combat actions in the persistent dock. */
function renderExplorationDock() {
  const scene = SC(), exploration = activeExploration(), found = discoveredLeadIds();
  const required = explorationRequirement(), complete = found.size >= required;
  setTurnFlag(); renderGameplayRail();
  $('who').innerHTML = `<div class="name">${esc(scene.title)}</div>
    <div class="sub">INVESTIGATION · ${found.size}/${required} essential leads found · no fight — walk freely</div>
    <div class="role">${explorationCoax(found)}</div>`;
  const actions = $('actions'); actions.innerHTML = '';
  exploration.leads.forEach((lead) => actions.appendChild(explorationLeadButton(lead, found)));
  $('stayBtn').classList.add('hidden'); $('moveBtn').disabled = true;
  $('moveBtn').textContent = 'Walk: tap your hero, then the ground';
  $('endTurn').disabled = !complete || !isOwner() || explorationActionPending;
  $('endTurn').textContent = complete
    ? isOwner() ? 'Follow the Evidence →' : 'Waiting for host'
    : `${required - found.size} clue${required - found.size === 1 ? '' : 's'} needed`;
}

/** @description Start a story chapter without manufacturing initiative or a fight. */
async function startExploration() {
  const scene = SC(), requestEpoch = campaignEpoch;
  board.mode = 'exploration';
  board.exploration = { discovered: [], attempts: {}, finders: {} };
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

/** @description Narrate one contested attempt so the roll is felt, not just applied. */
function describeAttempt(attempt, heroName) {
  if (!attempt || attempt.muddled) return '';
  const sign = attempt.mod >= 0 ? '+' : '';
  const verdict = attempt.crit === 'nat20' ? ' — NATURAL 20!'
    : attempt.crit === 'nat1' ? ' — natural 1.' : attempt.success ? ' — found it.' : ' — not enough.';
  return `${heroName}: ${attempt.skill} ${attempt.roll}${sign}${attempt.mod} = ${attempt.total} vs DC ${attempt.dc}${verdict}`;
}

/**
 * @description Work one lead as a specific hero. The server nominates, authorizes,
 *   and rolls; a refusal names who the lead is really for so the table can coax
 *   that player instead of letting the fastest tap decide.
 */
async function investigateLead(lead, button, stepIn) {
  if (explorationActionPending) return;
  const nomination = leadNominee(lead);
  const acting = stepIn ? myBestFor(lead) : (nomineeIsMine(nomination) ? nomination : myBestFor(lead));
  const heroSlug = acting && acting.hero ? acting.hero.slug : (nomination && nomination.hero.slug);
  explorationActionPending = true; button.disabled = true; button.classList.add('working');
  banner(`${lead.type === 'person' ? 'Speaking with' : 'Searching'} ${lead.name}…`);
  // Walk first: the investigation should read as the hero crossing the room.
  walkToLead(lead, heroSlug);
  const result = await api('/explore', {
    method: 'POST',
    body: JSON.stringify({
      campaignId: campaign.campaign_id, action: 'discover', leadId: lead.id,
      heroSlug: heroSlug, stepIn: !!stepIn,
    }),
  }).catch(() => null);
  explorationActionPending = false;
  if (result && result.code === 'NOMINATED' && result.nominee) {
    // The coax, spelled out: this lead belongs to someone, and stepping in is a choice.
    banner(`${result.nominee.name} is the one for this (${result.nominee.skill} ${result.nominee.mod >= 0 ? '+' : ''}${result.nominee.mod}). Tap again to step in anyway.`);
    renderDock();
    const retry = document.querySelector('.exploration-lead:not(.discovered)');
    if (retry) retry.classList.add('nominated');
    button.onclick = () => void investigateLead(lead, button, true);
    return;
  }
  if (!result || !result.ok) {
    banner(result && result.error || 'That lead could not be resolved yet.'); renderDock(); return;
  }
  if (result.rollRequested) {
    // Roadmap #13: the contested check is now a SHARED d20 — the request is on
    // the board, every device presents the same die, and the outcome commits
    // through commitLeadRoll() when it lands. Nothing is resolved yet.
    applyAuthoritativeState(result.state, result.rev);
    banner(`${result.finder ? result.finder.name : 'The hero'} steps up to ${lead.name} — the table watches the d20.`);
    renderDock();
    presentSharedRoll(board.sharedRoll);
    return;
  }
  applyAuthoritativeState(result.state, result.rev);
  const heroName = presentLeadOutcome(result, lead.name);
  if (!result.missed) {
    // Every clue earned is a beat worth cutting to — the chapter should feel shot,
    // not filled in. Keyed per lead so a replay never regenerates the same art.
    requestCutaway(`${SC().title}. ${heroName} uncovers ${lead.name}: ${result.narration}`, false,
      `lead:${campaign.campaign_id}:${board.sceneId}:${lead.id}`);
  }
  await presentPhase(result.narration, 1800, true);
}

/** @description Announce, banner, and archive-echo one lead outcome (hit or miss) on this device; returns the acting hero's display name. */
function presentLeadOutcome(result, leadName) {
  announceCast(result);
  const heroName = result.finder ? result.finder.name : 'The party';
  const rollLine = describeAttempt(result.attempt, heroName);
  if (rollLine) banner(rollLine);
  addBeat('discovery', result.missed ? result.narration : `${leadName}: ${result.narration}`, null,
    result.archiveEntry && result.archiveEntry.seq);
  openStory(); renderDock();
  return heroName;
}

/**
 * @description Commit a landed lead d20 (roadmap #13): the server applies the
 *   discovery or the ledgered miss and resolves the shared roll in one write;
 *   the table then narrates the authored reveal exactly as a direct find would.
 *   Called by the dice overlay's submit step in place of DM narration.
 * @param {object} roll - The rolled sharedRoll carrying its lead contract.
 * @returns {Promise<object|null>} The server outcome, for the overlay's messaging.
 */
async function commitLeadRoll(roll) {
  const result = await api('/explore', {
    method: 'POST',
    body: JSON.stringify({ campaignId: campaign.campaign_id, action: 'commit-roll', rollId: roll.id }),
  }).catch(() => null);
  if (!result || !result.ok) return result;
  applyAuthoritativeState(result.state, result.rev);
  if (result.alreadyCommitted || result.deduped) { renderDock(); return result; }
  presentLeadOutcome(result, result.lead.name);
  void presentPhase(result.narration, 1800, true);
  return result;
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
  requestCutaway(`${SC().title}. The party follows the evidence out of the chapter.`, false,
    `chapter:${campaign.campaign_id}:${board.sceneId}:complete`);
  renderChoices([]); showResolvedState();
}

/** @description Restore exploration controls after resume or multiplayer synchronization. */
function resumeExploration() {
  setStoryOpen(true); updateInitiativeBar(); renderDock();
}
