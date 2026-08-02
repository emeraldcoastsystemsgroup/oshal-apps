/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 11:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Motion and art become server truths on the CONVERSATION path too. The 2026-07-30 playtest showed the table's real play style is the free Ask-the-DM box: the narration said "Zin, you cross east toward Tovin Quill" while Zin's token stood frozen at party start, and a whole investigation chapter produced zero images — because v0.17.3 wired walking and cutaways only into the /explore lead-tap path. Now every ordinary story exchange deterministically matches the person/place/object the fiction engaged, walks the acting hero beside it in an authoritative board write, requests a first-meeting portrait cutaway when the party reaches someone new, and keeps a steady art cadence: whenever the last few story beats carry no image, the newest beat is illustrated.
 */

'use strict';

const { parsedJson, withTransaction } = require('./dnd-route-helpers');
const { authoredPropId, walkHeroBeside, walkHeroBesideLead } = require('./dnd-lead-cast');

/**
 * How many consecutive story-log beats may pass without an image before the newest
 * beat is illustrated. Discovery, chapter, meeting, and combat art all reset the
 * run, so this only pays for art when the story has gone visually quiet.
 */
const BEAT_ART_EVERY = 4;
/** Story-log kinds that count as beats a player actually reads. */
const STORY_KINDS = new Set(['table-talk', 'narration', 'milestone', 'discovery']);
/** Name words too generic to identify a story target on their own. */
const STOP_WORDS = new Set(['the', 'and', 'from', 'with', 'for', 'her', 'his', 'their']);

/** @description The distinctive lowercase words of one authored name. */
function significantWords(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/** @description How many of these words the text mentions as whole words. */
function mentionScore(text, words) {
  const value = String(text || '').toLowerCase();
  if (!value) return 0;
  return words.reduce((count, word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return count + (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(value) ? 1 : 0);
  }, 0);
}

/**
 * @description Everyone and everything the fiction can send a hero to in this
 *   chapter: the authored leads, plus any authored prop no lead already covers.
 *   Each target carries the words that identify it and how to find its cell.
 * @param {object} scene - The authored scene.
 * @returns {Array} Story targets in stable authored order.
 */
function storyTargets(scene) {
  const exploration = scene && scene.exploration;
  const leads = exploration && Array.isArray(exploration.leads) ? exploration.leads : [];
  const targets = leads.map((lead) => ({
    key: `lead:${lead.id}`, name: String(lead.name || ''), type: String(lead.type || 'person'), lead,
  }));
  const covered = new Set(leads.map((lead) => authoredPropId(lead, scene)).filter(Boolean));
  for (const prop of (scene && scene.props) || []) {
    if (covered.has(String(prop.id))) continue;
    targets.push({ key: `prop:${prop.id}`, name: String(prop.name || ''), type: 'person', prop });
  }
  return targets.map((target) => ({ ...target, words: significantWords(target.name) }));
}

/**
 * @description The target this exchange engaged, or null when the fiction named
 *   nobody. The player's own words weigh triple the model's narration: "Question
 *   Tovin about Elira" names Tovin deliberately, while narration mentions the
 *   whole room. Ties prefer people — the complaint this module answers is a hero
 *   who talks to someone without ever walking over.
 * @param {Array} targets - Story targets from storyTargets().
 * @param {string} message - The player's untrusted request text.
 * @param {string} narration - The DM's narration for this exchange.
 * @returns {object|null} The best-scoring target.
 */
function matchStoryTarget(targets, message, narration) {
  const scored = targets
    .map((target, index) => ({
      target, index,
      score: 3 * mentionScore(message, target.words) + mentionScore(narration, target.words),
    }))
    .filter((entry) => entry.score > 0);
  scored.sort((a, b) => b.score - a.score
    || Number(b.target.type === 'person') - Number(a.target.type === 'person')
    || a.index - b.index);
  return scored.length ? scored[0].target : null;
}

/** @description All normalized identity labels for one board token. */
function tokenLabels(token) {
  return [token.id, token.slug, token.name].filter(Boolean).map((value) => String(value).trim().toLowerCase());
}

/** @description The first hero this text names, or null. */
function mentionedHero(pcs, text) {
  const value = String(text || '').toLowerCase();
  if (!value) return null;
  return pcs.find((pc) => tokenLabels(pc).some((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(value);
  })) || null;
}

/**
 * @description Who walks: the hero the narration names (the DM says who acted),
 *   else the speaker's claimed hero, else an explicit client hint. The host with
 *   no seat and no mention moves nobody — guessing would walk the wrong figure.
 * @param {object} state - The authoritative board.
 * @param {Array} seats - dnd_players rows for this campaign.
 * @param {string} sub - The requesting user.
 * @param {object} body - The untrusted request.
 * @param {string} narration - The DM's narration.
 * @returns {string} The acting hero's slug, or ''.
 */
function actingHeroSlug(state, seats, sub, body, narration) {
  const pcs = Array.isArray(state && state.tokens)
    ? state.tokens.filter((token) => token.kind === 'pc') : [];
  const named = mentionedHero(pcs, narration) || mentionedHero(pcs, body && body.message);
  if (named) return named.slug;
  const seat = (seats || []).find((entry) => entry.user_sub === sub && entry.character_slug);
  if (seat && pcs.some((pc) => pc.slug === seat.character_slug)) return seat.character_slug;
  const hinted = String((body && (body.actorSlug || body.heroSlug)) || '').trim();
  return pcs.some((pc) => pc.slug === hinted) ? hinted : '';
}

/** @description Walk the acting hero beside the matched target's figure. */
function walkTowardTarget(state, scene, target, heroSlug) {
  const leads = scene.exploration && Array.isArray(scene.exploration.leads) ? scene.exploration.leads : [];
  if (target.lead) return walkHeroBesideLead(state.tokens, heroSlug, target.lead, scene, leads);
  const standing = (state.tokens || []).find((token) => token.id === target.prop.id);
  const spot = standing && Number.isFinite(Number(standing.x)) ? standing : target.prop;
  return walkHeroBeside(state.tokens, heroSlug, { x: spot.x, y: spot.y }, scene);
}

/**
 * @description How many story beats the log has run without an image. Derived from
 *   the archive rather than a counter in board state, so restores, rewinds, and
 *   client state writes can never desynchronize the cadence.
 */
async function beatsSinceLastArt(pool, campaignId) {
  const log = await pool.query(
    'SELECT kind FROM dnd_archive WHERE campaign_id=$1 ORDER BY seq DESC LIMIT 12',
    [campaignId],
  );
  let count = 0;
  for (const row of log.rows || []) {
    if (String(row.kind) === 'cutaway') return count;
    if (STORY_KINDS.has(String(row.kind))) count += 1;
  }
  return count;
}

/**
 * @description The art this exchange has earned. A person the party just reached
 *   gets a first-meeting portrait (the eventKey collapses every later mention into
 *   the same file, so it only ever costs once); otherwise, once the last few story
 *   beats have gone unillustrated, the newest beat becomes the scene image.
 * @returns {Array<{eventKey:string,prompt:string}>} Zero or one cutaway request.
 */
async function storyArtPlan(deps, campaignId, scene, narration, outcome, archiveEntry) {
  const excerpt = String(narration || '').replace(/\s+/g, ' ').trim().slice(0, 480);
  const target = outcome && outcome.target;
  if (target && target.type === 'person') {
    return [{
      eventKey: `meet:${campaignId}:${scene.id}:${target.key}`,
      prompt: `${scene.title}. The party meets ${target.name}. ${excerpt}`,
    }];
  }
  if (!archiveEntry || !Number.isFinite(Number(archiveEntry.seq))) return [];
  if ((await beatsSinceLastArt(deps.pool, campaignId)) < BEAT_ART_EVERY) return [];
  return [{
    eventKey: `beat:${campaignId}:${archiveEntry.seq}`,
    prompt: `${scene.title}. ${excerpt}`,
  }];
}

/** @description Request story art without ever blocking or failing the exchange. */
function fireStoryArt(deps, sub, campaignId, requests) {
  if (!deps.media || !requests.length) return;
  for (const request of requests) {
    // The media service FAIL-SOFTS: outages RESOLVE {ok:false, soft:true} and never
    // reject. Inspect the settled value or a resting illustrator is invisible — a
    // whole chapter of zero art with no log line is the exact bug class this
    // server-side path exists to end. The catch is a backstop for refactors.
    (async () => {
      const outcome = await deps.media.generateCutaway(sub, { campaignId, ...request });
      if (!outcome || outcome.ok !== true) {
        if (deps.logger) deps.logger.error(
          { eventKey: request.eventKey, error: outcome && outcome.error },
          'dnd story art generation failed soft',
        );
      }
    })().catch((error) => {
      if (deps.logger) deps.logger.error({ err: error, eventKey: request.eventKey }, 'dnd story art request failed');
    });
  }
}

/** @description Match, authorize, and persist one conversation walk under the row lock. */
async function lockedConversationWalk(deps, db, transactional, sub, body, narration) {
  const locked = await db.query(
    `SELECT state, rev FROM dnd_encounters WHERE campaign_id=$1${transactional ? ' FOR UPDATE' : ''}`,
    [body.campaignId],
  );
  if (!locked.rowCount) return null;
  const state = parsedJson(locked.rows[0].state, {});
  // Combat movement belongs to the tactical rules; conversation never moves a combatant.
  if (state.mode === 'combat') return null;
  const scene = deps.sceneById(state.sceneId);
  if (!scene) return null;
  const rev = Number(locked.rows[0].rev);
  const target = matchStoryTarget(storyTargets(scene), body.message, narration);
  if (!target) return { scene, state, rev, moved: false, target: null };
  const seats = await deps.campaign.seatsOf(body.campaignId, db);
  const heroSlug = actingHeroSlug(state, seats || [], sub, body, narration);
  const walked = heroSlug ? walkTowardTarget(state, scene, target, heroSlug) : { moved: false };
  if (!walked.moved) return { scene, state, rev, moved: false, target, heroSlug };
  const next = { ...state, tokens: walked.tokens };
  const saved = await db.query(
    'UPDATE dnd_encounters SET state=$1, rev=rev+1, updated_at=now() WHERE campaign_id=$2 AND rev=$3 RETURNING rev',
    [JSON.stringify(next), body.campaignId, rev],
  );
  // A raced write loses quietly: the walk is embellishment, and the next
  // exchange re-derives it from wherever the board actually ended up.
  if (!saved.rowCount) return { scene, state, rev, moved: false, target, heroSlug };
  await db.query('UPDATE dnd_campaigns SET updated_at=now() WHERE campaign_id=$1', [body.campaignId]);
  return { scene, state: next, rev: Number(saved.rows[0].rev), moved: true, target, heroSlug };
}

/**
 * @description Apply one ordinary story exchange to the shared table: walk the
 *   acting hero beside whoever the fiction engaged, then request the art the
 *   exchange has earned. Never throws — a failed embellishment must not turn a
 *   successful DM reply into an error.
 * @param {object} deps - pool, campaign, media, sceneById, logger.
 * @param {string} sub - The requesting user.
 * @param {object} body - The untrusted /chat request.
 * @param {string} narration - The DM's directive-stripped narration.
 * @param {object|null} archiveEntry - The story-log entry this exchange wrote.
 * @returns {Promise<object|null>} {state, rev, moved, heroSlug, target} when the board changed.
 */
async function conversationBeat(deps, sub, body, narration, archiveEntry) {
  try {
    const outcome = await withTransaction(
      deps.pool, (db, transactional) => lockedConversationWalk(deps, db, transactional, sub, body, narration),
    );
    if (!outcome) return null;
    const art = await storyArtPlan(deps, body.campaignId, outcome.scene, narration, outcome, archiveEntry);
    fireStoryArt(deps, sub, body.campaignId, art);
    return outcome.moved
      ? { state: outcome.state, rev: outcome.rev, moved: true, heroSlug: outcome.heroSlug, target: { key: outcome.target.key, name: outcome.target.name } }
      : null;
  } catch (error) {
    if (deps.logger) deps.logger.error({ err: error, campaignId: body && body.campaignId }, 'dnd conversation beat failed');
    return null;
  }
}

/**
 * @description Bind the conversation motion-and-art domain.
 * @param {object} deps - Pool, campaign service, media service, scene resolver, logger.
 * @returns {{conversationBeat:Function}} Service consumed by the DM router.
 */
function createStoryMotionService(deps) {
  return {
    conversationBeat: (sub, body, narration, archiveEntry) => conversationBeat(deps, sub, body, narration, archiveEntry),
  };
}

module.exports = {
  createStoryMotionService,
  BEAT_ART_EVERY,
  _test: {
    actingHeroSlug, beatsSinceLastArt, matchStoryTarget, mentionScore,
    significantWords, storyArtPlan, storyTargets, walkTowardTarget,
  },
};
