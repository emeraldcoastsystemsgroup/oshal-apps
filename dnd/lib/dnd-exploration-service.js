/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Add transactionally shared authored discoveries and evidence-gated scene completion before tactical combat.
 * 2026-07-26 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | A lead is no longer a checkbox anyone can tick. It nominates the hero the fiction would send (ui/leads.js), refuses a different hero unless that player deliberately STEPS IN, and is contested by a d20 the SERVER rolls — so a clue is earned, attributed to whoever found it, and cannot be silently green-lit by the fastest tap or an idle companion. Each hero gets one attempt per lead; once the whole party has tried, the next attempt lands muddled rather than deadlocking the chapter.
 * 2026-07-27 23:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | A discovery now changes the MAP, not only the story log: the person, place, or object the party found is cast as a figure on the square the acting hero walked to, and every already-discovered lead is reconciled on each action so a chapter played before figures existed fills itself in.
 * 2026-07-27 23:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Motion and art become server truths: every attempt (hit or miss) walks the acting hero to the lead in the same write, and discovery/chapter cutaways are requested server-side after commit — the 2026-07-27 session proved client-side triggers die to owner gates and mid-session version skew.
 * 2026-07-31 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Roadmap #13 — the lead roll happens on the big shared d20: an attempt no longer rolls privately server-side. It OPENS a sharedRoll request (actor, skill, DC, precomputed modifier, lead contract) that every device presents on the shared die; the player rolls through the same /roll route as every other check; and the new 'commit-roll' action applies the rolled result exactly once (discovery or ledgered miss) while resolving the die in the same write. The muddled escape hatch (whole party failed) still lands without dice — it was never a roll. Only one shared roll may pend at a time, commit is roller-authorized, and a lead discovered mid-roll resolves the die as a dedupe instead of stranding it.
 */

'use strict';

const crypto = require('crypto');
const { parsedJson, withTransaction } = require('./dnd-route-helpers');
const LEADS = require('../ui/leads.js');
const { reconcileDiscoveredCast, walkHeroBesideLead } = require('./dnd-lead-cast');

/** @description Normalize the shared discovery record without trusting client fields. */
function explorationRecord(state) {
  const value = state && state.exploration && typeof state.exploration === 'object'
    ? state.exploration : {};
  const attempts = value.attempts && typeof value.attempts === 'object' ? value.attempts : {};
  const finders = value.finders && typeof value.finders === 'object' ? value.finders : {};
  return {
    discovered: Array.from(new Set(
      (Array.isArray(value.discovered) ? value.discovered : []).map(String),
    )),
    // Who has already tried which lead, so one hero cannot brute-force a clue.
    attempts: Object.keys(attempts).reduce((carry, id) => {
      carry[String(id)] = Array.from(new Set((Array.isArray(attempts[id]) ? attempts[id] : []).map(String)));
      return carry;
    }, {}),
    // Who actually found each clue — the story log names them.
    finders: Object.keys(finders).reduce((carry, id) => {
      carry[String(id)] = String(finders[id]);
      return carry;
    }, {}),
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

/**
 * @description The party as sheets the nomination math can rank. Board tokens carry
 *   the slug; the authoritative sheet carries the abilities, so a hero is only
 *   eligible when BOTH exist — a token with no sheet cannot be volunteered.
 */
function partyHeroes(state) {
  const tokens = Array.isArray(state && state.tokens) ? state.tokens : [];
  const sheets = (state && state.rules && state.rules.sheets) || {};
  return tokens
    .filter((token) => token.kind === 'pc' && token.slug && sheets[token.slug])
    .map((token) => Object.assign({}, sheets[token.slug], {
      slug: token.slug,
      id: sheets[token.slug].id || token.slug,
      name: sheets[token.slug].name || token.name || token.slug,
    }));
}

/** @description The hero this request is acting as, or null when it names nobody real. */
function actingHero(heroes, slug) {
  return heroes.find((hero) => hero.slug === String(slug || '')) || null;
}

/**
 * @description Whether this caller may act as this hero: the seat that claimed it,
 *   or the host (who runs every unclaimed companion).
 */
async function mayActAs(deps, db, campaign, sub, slug) {
  if (campaign.is_owner || campaign.user_sub === sub) return true;
  const seats = await deps.campaign.seatsOf(campaign.campaign_id, db);
  return (seats || []).some((seat) => seat.user_sub === sub && seat.character_slug === slug);
}

/**
 * @description Put the discovery on the map. The person, place, or object the party just
 *   found becomes a real figure — without this a chapter's whole cast lives in prose and
 *   only the 1-3 authored props are ever visible. Reconciling the WHOLE discovered set,
 *   not just this lead, also repairs a chapter played before figures existed.
 * @param {object} state - The authoritative board.
 * @param {object} scene - The authored scene.
 * @param {object} exploration - The scene's lead contract.
 * @param {Array} discovered - Every lead id the party will have shared after this find.
 * @param {object} lead - The lead just discovered.
 * @returns {{tokens:Array, arrived:object|null, met:object|null}} Board and who to focus.
 */
function boardWithDiscovery(state, scene, exploration, discovered, lead, finder) {
  const cast = reconcileDiscoveredCast(state.tokens, exploration.leads, discovered, scene);
  const arrived = cast.cast.find((token) => token.leadId === String(lead.id)) || null;
  // An authored prop was already standing there — the party reached them, they did
  // not appear. The surface focuses them without claiming a new figure walked in.
  const met = arrived ? null : (cast.tokens.find((token) => token.leadId === String(lead.id)) || null);
  // The finder crosses the room in the SAME authoritative write, so every device —
  // whatever client version it runs — sees the hero walk via ordinary state sync.
  const walked = finder
    ? walkHeroBesideLead(cast.tokens, finder.slug, lead, scene, exploration.leads)
    : { tokens: cast.tokens };
  return { tokens: walked.tokens, arrived, met };
}

/** @description Ask the illustrator for story art without ever blocking or failing the action. */
function fireStoryCutaway(deps, result) {
  const request = result && result._cutaway;
  if (result) delete result._cutaway;
  if (!deps.media || !request || !result.ok) return;
  // The media service FAIL-SOFTS: a broken provider RESOLVES {ok:false, soft:true} and
  // never rejects. Inspect the settled value or real outages are invisible again — a
  // whole session of zero cutaways with no log line is exactly the bug class this
  // server-side path was built to end. The catch is a backstop for future refactors.
  (async () => {
    const outcome = await deps.media.generateCutaway(request.sub, request.body);
    if (!outcome || outcome.ok !== true) {
      if (deps.logger) deps.logger.error(
        { eventKey: request.body.eventKey, error: outcome && outcome.error },
        'dnd cutaway generation failed soft',
      );
    }
  })().catch((error) => {
    if (deps.logger) deps.logger.error({ err: error, eventKey: request.body.eventKey }, 'dnd cutaway request failed');
  });
}

/** @description Persist one exact board revision and archive its authored reveal. */
async function saveDiscovery(deps, db, campaign, encounter, state, scene, lead, context) {
  const exploration = sceneExploration(scene);
  const record = explorationRecord(state);
  const progress = { discovered: knownDiscoveries(exploration, record) };
  if (progress.discovered.includes(lead.id)) {
    return { ok: true, deduped: true, state, rev: Number(encounter.rev), narration: lead.reveal };
  }
  if (!prerequisitesMet(lead, progress.discovered)) {
    return { ok: false, code: 'LEAD_LOCKED', error: 'Another clue must be found before this lead makes sense.' };
  }
  const finder = context && context.hero;
  const nextDiscovered = progress.discovered.concat(lead.id);
  const { tokens, arrived, met } = boardWithDiscovery(state, scene, exploration, nextDiscovered, lead, finder);
  const next = {
    ...state,
    tokens,
    exploration: {
      ...record,
      discovered: nextDiscovered,
      finders: Object.assign({}, record.finders, finder ? { [lead.id]: finder.slug } : {}),
    },
  };
  const saved = await db.query(
    'UPDATE dnd_encounters SET state=$1, rev=rev+1, updated_at=now() WHERE campaign_id=$2 AND rev=$3 RETURNING rev',
    [JSON.stringify(next), campaign.campaign_id, encounter.rev],
  );
  if (!saved.rowCount) return { ok: false, code: 'REV_CONFLICT', error: 'Another player found something first. Refreshing the table.' };
  await db.query('UPDATE dnd_campaigns SET updated_at=now() WHERE campaign_id=$1', [campaign.campaign_id]);
  const credit = finder ? `${finder.name} uncovers ${lead.name}` : lead.name;
  const entry = await deps.campaign.appendArchive(
    db, campaign.user_sub, campaign.campaign_id, 'discovery',
    `${credit}: ${lead.reveal}`, true,
  );
  return discoveryResponse(campaign, scene, lead, {
    state: next, rev: Number(saved.rows[0].rev), arrived, met, finder,
    attempt: context && context.attempt || null, entry, credit,
  });
}

/** @description Shape one successful discovery reply plus its server-side art request. */
function discoveryResponse(campaign, scene, lead, outcome) {
  return {
    ok: true, state: outcome.state, rev: outcome.rev,
    narration: lead.reveal, lead: { id: lead.id, name: lead.name },
    cast: outcome.arrived ? { id: outcome.arrived.id, name: outcome.arrived.name, x: outcome.arrived.x, y: outcome.arrived.y } : null,
    met: outcome.met ? { id: outcome.met.id, name: outcome.met.name } : null,
    finder: outcome.finder ? { slug: outcome.finder.slug, name: outcome.finder.name } : null,
    attempt: outcome.attempt, archiveEntry: outcome.entry,
    // Server-authoritative art request: generated after commit regardless of which
    // client acted or what JS version it runs. Same eventKey as the surface uses,
    // so a duplicate client request collapses in the media dedup.
    _cutaway: {
      sub: campaign.user_sub,
      body: {
        campaignId: campaign.campaign_id,
        eventKey: `lead:${campaign.campaign_id}:${outcome.state.sceneId}:${lead.id}`,
        prompt: `${scene.title}. ${outcome.credit}: ${lead.reveal}`,
      },
    },
  };
}

/** @description Record a failed attempt so the same hero cannot simply try again. */
async function saveAttempt(deps, db, campaign, encounter, state, scene, lead, hero, attempt) {
  const record = explorationRecord(state);
  const tried = (record.attempts[lead.id] || []).concat(hero.slug);
  // A miss still walks the hero over — they went and came up short. The figure
  // itself stays off the map: an undiscovered lead has no board presence.
  const walked = walkHeroBesideLead(state.tokens, hero.slug, lead, scene, sceneExploration(scene).leads);
  const next = {
    ...state,
    tokens: walked.tokens,
    exploration: { ...record, attempts: Object.assign({}, record.attempts, { [lead.id]: tried }) },
  };
  const saved = await db.query(
    'UPDATE dnd_encounters SET state=$1, rev=rev+1, updated_at=now() WHERE campaign_id=$2 AND rev=$3 RETURNING rev',
    [JSON.stringify(next), campaign.campaign_id, encounter.rev],
  );
  if (!saved.rowCount) return { ok: false, code: 'REV_CONFLICT', error: 'The table changed. Try that lead again.' };
  const narration = attempt.crit === 'nat1'
    ? `${hero.name} fumbles it — ${lead.name} gives nothing up, and someone else will have to try.`
    : `${hero.name} comes up short on ${lead.name}. Another pair of hands might do better.`;
  const entry = await deps.campaign.appendArchive(
    db, campaign.user_sub, campaign.campaign_id, 'discovery', narration, true,
  );
  return {
    ok: true, missed: true, state: next, rev: Number(saved.rows[0].rev),
    narration, attempt, lead: { id: lead.id, name: lead.name },
    finder: { slug: hero.slug, name: hero.name }, archiveEntry: entry,
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
  const next = { ...state, mode: 'resolved', exploration: { ...progress, discovered } };
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
  return {
    ok: true, complete: true, state: next, rev: Number(saved.rows[0].rev),
    _cutaway: {
      sub: campaign.user_sub,
      body: {
        campaignId: campaign.campaign_id,
        eventKey: `chapter:${campaign.campaign_id}:${state.sceneId}:complete`,
        prompt: `${scene.title}. The party follows the evidence out of the chapter.`,
      },
    },
  };
}

/**
 * @description Answer the pre-roll gates: dedupe, lock, party, identity, and the
 *   nomination coax. Returns null when the attempt may proceed to the dice.
 */
async function attemptGate(deps, db, campaign, encounter, state, scene, lead, sub, body) {
  const record = explorationRecord(state);
  // A raced tap on a clue someone else just found (the ~1.6s window before the next
  // sync disables the button) must NOT roll: a miss would ledger an attempt and
  // narrate "comes up short" about evidence the party already shares.
  if (knownDiscoveries(sceneExploration(scene), record).includes(String(lead.id))) {
    return { ok: true, deduped: true, state, rev: Number(encounter.rev), narration: lead.reveal };
  }
  // Whether a lead is even askable is a property of the LEAD, not of who asked —
  // check it before nominating anyone, or a locked clue reports the wrong reason.
  if (!prerequisitesMet(lead, knownDiscoveries(sceneExploration(scene), record))) {
    return { ok: false, code: 'LEAD_LOCKED', error: 'Another clue must be found before this lead makes sense.' };
  }
  const heroes = partyHeroes(state);
  if (!heroes.length) return { ok: false, code: 'NO_PARTY', error: 'No heroes are seated at this table yet.' };
  const nominated = LEADS.nominee(lead, heroes);
  const hero = actingHero(heroes, body.heroSlug) || (body.heroSlug ? null : nominated && nominated.hero);
  if (!hero) return { ok: false, code: 'UNKNOWN_HERO', error: 'That hero is not at this table.' };
  if (!(await mayActAs(deps, db, campaign, sub, hero.slug))) {
    return { ok: false, code: 'NOT_YOUR_HERO', error: `${hero.name} belongs to another player.` };
  }
  // The coax: a hero who is not the nominee may still act, but the player has to
  // choose to step in. Without that, the table is told who this lead is FOR.
  if (nominated && hero.slug !== nominated.hero.slug && !body.stepIn) {
    return {
      ok: false, code: 'NOMINATED', error: `${nominated.hero.name} is the one to try this.`,
      nominee: {
        slug: nominated.hero.slug, name: nominated.hero.name,
        skill: nominated.skill, mod: nominated.mod, trained: nominated.trained,
      },
      dc: LEADS.leadDc(lead),
    };
  }
  return { proceed: { hero, heroes, record } };
}

/** @description Short ability code (ui/leads.js) → the full name the shared d20 displays. */
const ABILITY_NAME = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };

/**
 * @description Open the big shared d20 for one lead attempt (roadmap #13): persist
 *   a 'requested' sharedRoll carrying the lead contract — actor, skill, DC, and the
 *   PRECOMPUTED modifier (ability + proficiency when trained, which the DM path's
 *   ability-only sheet derivation cannot see) — and walk the hero over in the same
 *   write. The die itself lands through the SAME /roll route every other check
 *   uses; 'commit-roll' then applies the outcome exactly once.
 */
async function requestLeadRoll(deps, db, campaign, encounter, state, scene, lead, hero) {
  const pending = state.sharedRoll;
  if (pending && ['requested', 'rolled'].includes(pending.status)) {
    return { ok: false, code: 'ROLL_PENDING', error: 'Finish the visible shared roll before working another lead.' };
  }
  const skill = LEADS.leadSkill(lead);
  const sharedRoll = {
    id: crypto.randomUUID(),
    actorSlug: hero.slug,
    ability: ABILITY_NAME[LEADS.SKILL_ABILITY[skill]] || 'wisdom',
    skill,
    dc: LEADS.leadDc(lead),
    modifier: LEADS.heroSkillMod(hero, skill),
    status: 'requested',
    createdAt: new Date().toISOString(),
    lead: { id: String(lead.id), sceneId: String(state.sceneId || '') },
  };
  // The approach is part of the drama: the hero crosses the room while every
  // device watches the die come up — same authoritative-write doctrine as the
  // outcome walk in saveAttempt/saveDiscovery.
  const walked = walkHeroBesideLead(state.tokens, hero.slug, lead, scene, sceneExploration(scene).leads);
  const next = { ...state, tokens: walked.tokens, sharedRoll };
  const saved = await db.query(
    'UPDATE dnd_encounters SET state=$1, rev=rev+1, updated_at=now() WHERE campaign_id=$2 AND rev=$3 RETURNING rev',
    [JSON.stringify(next), campaign.campaign_id, encounter.rev],
  );
  if (!saved.rowCount) return { ok: false, code: 'REV_CONFLICT', error: 'The table changed. Try that lead again.' };
  return {
    ok: true, rollRequested: true, roll: sharedRoll,
    state: next, rev: Number(saved.rows[0].rev),
    lead: { id: lead.id, name: lead.name },
    finder: { slug: hero.slug, name: hero.name },
  };
}

/** @description Shape one lead attempt from an authoritative ROLLED shared d20. Lead crit semantics: a natural 20 always finds it, a natural 1 always fumbles — the same rule the retired server-private roll used. */
function attemptFromRoll(roll, lead) {
  const natural = Number(roll.natural);
  const mod = Number(roll.modifier) || 0;
  const total = Number(roll.total);
  const dc = Number(roll.dc) || LEADS.leadDc(lead);
  return {
    roll: natural, mod, total, dc,
    skill: roll.skill || LEADS.leadSkill(lead),
    success: natural === 20 || (natural !== 1 && total >= dc),
    crit: natural === 20 ? 'nat20' : natural === 1 ? 'nat1' : '',
  };
}

/**
 * @description Apply the outcome of a rolled lead d20 exactly once: the shared
 *   roll resolves and the discovery (or the ledgered miss) lands in the SAME
 *   write. Roller-authorized — the claimant of the rolled hero, or the host for
 *   an AI companion. A lead someone else discovered mid-roll resolves the die as
 *   a dedupe instead of stranding it 'rolled' forever.
 */
async function commitLeadRoll(deps, db, campaign, encounter, state, scene, sub, body) {
  const roll = state.sharedRoll;
  const rollId = String((body && body.rollId) || '');
  if (!roll || !roll.lead || (rollId && roll.id !== rollId)) {
    return { ok: false, code: 'ROLL_STALE', error: 'That investigation roll is no longer active.' };
  }
  if (roll.status === 'resolved') return { ok: true, alreadyCommitted: true, state, rev: Number(encounter.rev) };
  if (roll.status !== 'rolled') return { ok: false, code: 'ROLL_NOT_READY', error: 'The d20 has not landed yet.' };
  const exploration = sceneExploration(scene);
  const lead = exploration.leads.find((entry) => String(entry.id) === String(roll.lead.id));
  if (!lead) return { ok: false, code: 'UNKNOWN_LEAD', error: 'That lead is not available here.' };
  const hero = actingHero(partyHeroes(state), roll.actorSlug);
  if (!hero) return { ok: false, code: 'UNKNOWN_HERO', error: 'The rolled hero is no longer at this table.' };
  if (!(await mayActAs(deps, db, campaign, sub, hero.slug))) {
    return { ok: false, code: 'NOT_YOUR_HERO', error: 'Only the roller may commit this result.' };
  }
  const resolved = { ...state, sharedRoll: { ...roll, status: 'resolved', resolvedAt: new Date().toISOString() } };
  // Discovered while the die was up (a raced second finder): resolve the roll,
  // hand back the shared reveal, ledger nothing contradictory.
  if (knownDiscoveries(exploration, explorationRecord(state)).includes(String(lead.id))) {
    const saved = await db.query(
      'UPDATE dnd_encounters SET state=$1, rev=rev+1, updated_at=now() WHERE campaign_id=$2 AND rev=$3 RETURNING rev',
      [JSON.stringify(resolved), campaign.campaign_id, encounter.rev],
    );
    if (!saved.rowCount) return { ok: false, code: 'REV_CONFLICT', error: 'The table changed. Try that lead again.' };
    return { ok: true, deduped: true, state: resolved, rev: Number(saved.rows[0].rev), narration: lead.reveal };
  }
  const attempt = attemptFromRoll(roll, lead);
  if (!attempt.success) {
    return saveAttempt(deps, db, campaign, encounter, resolved, scene, lead, hero, attempt);
  }
  return saveDiscovery(deps, db, campaign, encounter, resolved, scene, lead, { hero, attempt });
}

/**
 * @description Resolve one attempt on a lead: nominate, authorize, then OPEN the
 *   shared d20 (the roll and its outcome land via /roll + 'commit-roll'). The
 *   nomination refusal is a FIRST-CLASS response, not an error — the surface
 *   uses it to coax the right player instead of silently accepting the fastest
 *   tap. The muddled escape hatch never rolls: once the whole party has failed,
 *   the lead relents on the spot.
 */
async function attemptLead(deps, db, campaign, encounter, state, scene, lead, sub, body) {
  const gate = await attemptGate(deps, db, campaign, encounter, state, scene, lead, sub, body);
  if (!gate.proceed) return gate;
  const { hero, heroes, record } = gate.proceed;
  const tried = record.attempts[lead.id] || [];
  // Once every seated hero has failed a lead it stops being a wall: the next
  // attempt lands, muddled, so a chapter can never deadlock behind bad dice.
  // This is checked BEFORE the one-try-each rule, or the escape hatch is
  // unreachable — every candidate is by definition already on the ledger.
  const exhausted = heroes.every((entry) => tried.includes(entry.slug));
  if (!exhausted && tried.includes(hero.slug)) {
    return { ok: false, code: 'ALREADY_TRIED', error: `${hero.name} has already worked this lead. Someone else has to try.` };
  }
  if (exhausted) {
    const attempt = { roll: 0, mod: 0, total: 0, dc: LEADS.leadDc(lead), skill: LEADS.leadSkill(lead), success: true, crit: '', muddled: true };
    return saveDiscovery(deps, db, campaign, encounter, state, scene, lead, { hero, attempt });
  }
  return requestLeadRoll(deps, db, campaign, encounter, state, scene, lead, hero);
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
  const encounter = result.rows[0], stored = parsedJson(encounter.state, {});
  const scene = deps.sceneById(stored.sceneId), exploration = sceneExploration(scene);
  if (stored.mode !== 'exploration' || !exploration) {
    return { ok: false, code: 'NOT_EXPLORING', error: 'This chapter is not in exploration.' };
  }
  // Repair before dispatch, so a chapter that was played before figures existed —
  // or a board that lost one to a raced write — fills in on the very next action
  // rather than staying empty for the rest of the investigation.
  const repair = reconcileDiscoveredCast(
    stored.tokens, exploration.leads,
    knownDiscoveries(exploration, explorationRecord(stored)), scene,
  );
  const state = repair.cast.length ? { ...stored, tokens: repair.tokens } : stored;
  if (body.action === 'complete') {
    return completeExploration(deps, db, campaign, encounter, state, scene, sub);
  }
  if (body.action === 'commit-roll') {
    return commitLeadRoll(deps, db, campaign, encounter, state, scene, sub, body);
  }
  const lead = exploration.leads.find((entry) => entry.id === body.leadId);
  if (!lead) return { ok: false, code: 'UNKNOWN_LEAD', error: 'That lead is not available here.' };
  return attemptLead(deps, db, campaign, encounter, state, scene, lead, sub, body);
}

/**
 * @description Create the authenticated exploration domain boundary.
 * @param {object} deps - Campaign, content, and database dependencies.
 * @returns {{act:Function}} Exploration command service.
 */
function createExplorationService(deps) {
  return {
    act: async (sub, body) => {
      const result = await withTransaction(
        deps.pool, (db) => resolveRequest(deps, sub, body || {}, db),
      );
      // After the transaction commits: authoritative story art, detached so a slow
      // or resting illustrator can never block or fail the player's action.
      fireStoryCutaway(deps, result);
      return result;
    },
  };
}

module.exports = {
  createExplorationService,
  explorationRecord,
  requiredDiscoveries,
  partyHeroes,
};
