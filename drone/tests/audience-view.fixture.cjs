/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Drone Ops family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/drone/missions (drone_missions rows as the route selects them: mission_id, name, plan in its three shapes, status, source, created_at, updated_at, last_flown_at, newest first) and GET /api/drone/home-summary (its three metrics with their ids, the tiles mirror, the newest items, the trailing note), and what the family view must show. The same missions answer lets the full page paint its own mission list without an audience. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description One drone_missions row as GET /api/drone/missions returns it.
 * @param {string} id The mission id.
 * @param {string} name The plan name.
 * @param {object} body The plan's shape (waypoints, assignments, or a show's cues).
 * @param {string} status draft | ready | flown.
 * @param {string} source manual | concierge | pattern | show.
 * @param {string} created ISO creation time.
 * @param {string|null} flown ISO time the latest execution started, or null.
 * @returns {object} The row.
 */
function mission(id, name, body, status, source, created, flown) {
  return { mission_id: id, name, plan: Object.assign({ name }, body), status, source, created_at: created, updated_at: flown || created, last_flown_at: flown };
}

/**
 * @description The synthetic saved plans, newest first: a timed show and a chat-drafted loop (drafts), a two-drone plan
 * started yesterday, and a one-stop plan saved by hand.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} drone_missions rows.
 */
function missions(iso) {
  const slots = [0, 1, 2].map((i) => ({ droneId: 'd' + i, east: i * 10, north: 0, alt: 30 }));
  const point = (lat, lon) => ({ lat, lon, alt: 30 });
  return [
    mission('m1', 'Synthetic Evening Ballet', { kind: 'show', cues: [0, 1, 2, 3, 4].map((i) => ({ at: i * 20, name: 'cue ' + i, slots })) }, 'draft', 'show', iso(-2), null),
    mission('m2', 'Synthetic Backyard Loop', { waypoints: [point(1, 1), point(1, 2), point(2, 2), point(2, 1)] }, 'draft', 'concierge', iso(-5), null),
    mission('m3', 'Synthetic Pair Sweep', { assignments: [{ droneId: 'alpha', plan: { waypoints: [point(1, 1)] } }, { droneId: 'bravo', plan: { waypoints: [point(2, 2)] } }] }, 'flown', 'manual', iso(-200), iso(-30)),
    mission('m4', 'Synthetic Porch Hop', { waypoints: [point(1, 1)] }, 'ready', 'manual', iso(-100), null),
  ];
}

/**
 * @description The synthetic home summary as routes/home-summary.js builds it: two drafts, one plan started in five days,
 * two commands turned down in five days.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object} The route's JSON body.
 */
function summary(iso) {
  const metrics = [
    { id: 'draft-missions', label: 'Mission drafts', value: '2' },
    { id: 'started-5d', label: 'Execution starts / 5d', value: '1' },
    { id: 'rejected-5d', label: 'Rejected commands / 5d', value: '2' },
  ];
  return { metrics, tiles: metrics, partial: false, asOf: iso(0), items: [
    { text: 'Synthetic Evening Ballet', detail: 'draft / updated ' + iso(-2), tone: 'neutral', fix: 'drone-ops', actions: [{ integration: 'prepare-document', context: { title: 'Synthetic Evening Ballet', notes: 'draft' } }] },
    { text: 'Saved mission drafts and recorded execution starts. The source writes flown immediately after startMission, so Home calls this execution starts, never completed flights. Diagnostic handoff carries plan name and recorded state only; flight approval stays in Drone Ops.', tone: 'neutral', fix: 'drone-ops' },
  ] };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'drone', file: 'drone/tools/drone-ops.html', url: '/api/drone/app', fullMarker: '#missionList .mission-row',
  reads: {
    '/api/drone/missions': { missions: missions(iso) },
    '/api/drone/home-summary': summary(iso),
  },
  audiences: {
    family: {
      stats: 4, sections: ['plans'],
      text: ['Drone flights', '1 flight plan started in the last 5 days',
        'Latest: Synthetic Evening Ballet, saved 2 h ago. Nothing flies from here: a person approves every flight in Drone Ops.',
        'Latest flight plans', 'Timed show · 5 moves · 3 drones · made in the show builder', 'Draft',
        'Synthetic Backyard Loop', 'One drone · 4 stops · drafted in the operator chat', 'saved 5 h ago',
        'Synthetic Pair Sweep', '2 drones flying together · made on the map', 'started yesterday', 'Started',
        'Synthetic Porch Hop', 'One drone · 1 stop · made on the map', 'saved 4 days ago', 'Ready',
        'Commands turned down, last 5 days', 'By the flight checks', 'it does not say the flight finished', 'Open Drone Ops'],
      statValues: { plans: '4', waiting: '3', started: '1', refused: '2' },
    },
  },
});

// ADR-164 D6: the company audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.family && !entry.audiences.company) entry.audiences.company = entry.audiences.family;
  return entries;
};
