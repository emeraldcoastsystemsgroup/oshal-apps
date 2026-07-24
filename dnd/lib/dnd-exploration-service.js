/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Add transactionally shared authored discoveries and evidence-gated scene completion before tactical combat.
 */

'use strict';

const { parsedJson, withTransaction } = require('./dnd-route-helpers');

/** @description Normalize the shared discovery record without trusting client fields. */
function explorationRecord(state) {
  const value = state && state.exploration && typeof state.exploration === 'object'
    ? state.exploration : {};
  return {
    discovered: Array.from(new Set(
      (Array.isArray(value.discovered) ? value.discovered : []).map(String),
    )),
  };
}

/** @description Return the authored exploration contract for one scene. */
function sceneExploration(scene) {
  const value = scene && scene.exploration;
  return value && Array.isArray(value.leads) ? value : null;
}

/** @description Count required discoveries and preserve a useful default. */
function requiredDiscoveries(exploration) {
  const total = exploration.leads.filter((lead) => lead.optional !== true).length;
  return Math.max(1, Math.min(total, Number(exploration.required) || total));
}

/** @description Confirm prerequisite clue ids before revealing a dependent lead. */
function prerequisitesMet(lead, discovered) {
  return (lead.requires || []).every((id) => discovered.includes(String(id)));
}

/** @description Ignore any stale or forged clue ids outside the authored chapter. */
function knownDiscoveries(exploration, progress) {
  const ids = new Set(exploration.leads.map((lead) => String(lead.id)));
  return progress.discovered.filter((id) => ids.has(id));
}

/** @description Persist one exact board revision and archive its authored reveal. */
async function saveDiscovery(deps, db, campaign, encounter, state, scene, lead) {
  const exploration = sceneExploration(scene);
  const progress = { discovered: knownDiscoveries(exploration, explorationRecord(state)) };
  if (progress.discovered.includes(lead.id)) {
    return { ok: true, deduped: true, state, rev: Number(encounter.rev), narration: lead.reveal };
  }
  if (!prerequisitesMet(lead, progress.discovered)) {
    return { ok: false, code: 'LEAD_LOCKED', error: 'Another clue must be found before this lead makes sense.' };
  }
  const next = { ...state, exploration: { discovered: progress.discovered.concat(lead.id) } };
  const saved = await db.query(
    'UPDATE dnd_encounters SET state=$1, rev=rev+1, updated_at=now() WHERE campaign_id=$2 AND rev=$3 RETURNING rev',
    [JSON.stringify(next), campaign.campaign_id, encounter.rev],
  );
  if (!saved.rowCount) return { ok: false, code: 'REV_CONFLICT', error: 'Another player found something first. Refreshing the table.' };
  await db.query('UPDATE dnd_campaigns SET updated_at=now() WHERE campaign_id=$1', [campaign.campaign_id]);
  const entry = await deps.campaign.appendArchive(
    db, campaign.user_sub, campaign.campaign_id, 'discovery',
    `${lead.name}: ${lead.reveal}`, true,
  );
  return {
    ok: true, state: next, rev: Number(saved.rows[0].rev),
    narration: lead.reveal, lead: { id: lead.id, name: lead.name }, archiveEntry: entry,
  };
}

/** @description Complete exploration only after enough authored evidence is shared. */
async function completeExploration(deps, db, campaign, encounter, state, scene, sub) {
  if (!(campaign.is_owner || campaign.user_sub === sub)) {
    return { ok: false, code: 'OWNER_REQUIRED', error: 'Only the host can follow the evidence into the next chapter.' };
  }
  const exploration = sceneExploration(scene), progress = explorationRecord(state);
  const discovered = knownDiscoveries(exploration, progress);
  if (discovered.length < requiredDiscoveries(exploration)) {
    return { ok: false, code: 'MORE_CLUES_REQUIRED', error: 'The party needs more evidence before choosing its next step.' };
  }
  const next = { ...state, mode: 'resolved', exploration: { discovered } };
  const saved = await db.query(
    'UPDATE dnd_encounters SET state=$1, rev=rev+1, updated_at=now() WHERE campaign_id=$2 AND rev=$3 RETURNING rev',
    [JSON.stringify(next), campaign.campaign_id, encounter.rev],
  );
  if (!saved.rowCount) return { ok: false, code: 'REV_CONFLICT', error: 'The table changed. Try following the evidence again.' };
  await db.query('UPDATE dnd_campaigns SET updated_at=now() WHERE campaign_id=$1', [campaign.campaign_id]);
  await deps.campaign.appendArchive(
    db, campaign.user_sub, campaign.campaign_id, 'milestone',
    scene.afterword || `The party has uncovered the truth in ${scene.title}.`, true,
  );
  return { ok: true, complete: true, state: next, rev: Number(saved.rows[0].rev) };
}

/** @description Resolve one locked exploration request against authoritative content. */
async function resolveRequest(deps, sub, body, db) {
  const campaign = await deps.campaign.access(sub, body.campaignId);
  if (!campaign) return { ok: false, code: 'NO_ACCESS', error: 'No seat at this table.' };
  const result = await db.query(
    'SELECT state, rev FROM dnd_encounters WHERE campaign_id=$1 FOR UPDATE',
    [body.campaignId],
  );
  if (!result.rowCount) return { ok: false, error: 'No board.' };
  const encounter = result.rows[0], state = parsedJson(encounter.state, {});
  const scene = deps.sceneById(state.sceneId), exploration = sceneExploration(scene);
  if (state.mode !== 'exploration' || !exploration) {
    return { ok: false, code: 'NOT_EXPLORING', error: 'This chapter is not in exploration.' };
  }
  if (body.action === 'complete') {
    return completeExploration(deps, db, campaign, encounter, state, scene, sub);
  }
  const lead = exploration.leads.find((entry) => entry.id === body.leadId);
  if (!lead) return { ok: false, code: 'UNKNOWN_LEAD', error: 'That lead is not available here.' };
  return saveDiscovery(deps, db, campaign, encounter, state, scene, lead);
}

/**
 * @description Create the authenticated exploration domain boundary.
 * @param {object} deps - Campaign, content, and database dependencies.
 * @returns {{act:Function}} Exploration command service.
 */
function createExplorationService(deps) {
  return {
    act: (sub, body) => withTransaction(
      deps.pool, (db) => resolveRequest(deps, sub, body || {}, db),
    ),
  };
}

module.exports = {
  createExplorationService,
  explorationRecord,
  requiredDiscoveries,
};
