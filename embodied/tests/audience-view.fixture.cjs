/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Embodied Swarm family audience view (ADR-164 D6): the page, its declared URL, the surface script it loads, synthetic read-only answers shaped like GET /api/embodied/tasks (embodied_task rows, newest first: task, title, plan with its steps, rehearsal, status, current_step, failure, created_at, updated_at) and /home-summary (the four metrics), and what the family view must show. /log answers only so the full page's own start paints its command log without an audience; the view never reads it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description One synthetic embodied_task row as GET /tasks returns it.
 * @param {string} id task_id. @param {string} task The planner task. @param {string} title The plan title. @param {string} status The row status.
 * @param {{steps: number, step?: number, failure?: string|null, ok?: boolean, issues?: string[], created: string, updated?: string}} o The rest.
 * @returns {object} The row.
 */
function job(id, task, title, status, o) {
  const steps = Array.from({ length: o.steps }, (_, i) => ({ kind: 'scan', label: 'Synthetic step ' + (i + 1) }));
  const rehearsal = { ok: o.ok !== false, issues: o.issues || [], durationS: 20, stepsCompleted: o.steps, stepsTotal: o.steps, finalLocations: {} };
  return { task_id: id, owner_sub: 'synthetic-sub', task, title, plan: { task, title, steps, summary: [] }, rehearsal, status, current_step: o.step || 0, failure: o.failure || null, created_at: o.created, updated_at: o.updated || o.created };
}

/**
 * @description The synthetic saved jobs, newest first: seven, so the latest six are tiles and one is listed earlier.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} embodied_task rows.
 */
function tasks(iso) {
  return [
    job('t1', 'explore', 'Explore the room — drone first', 'done', { steps: 14, step: 13, created: iso(-5), updated: iso(-3) }),
    job('t2', 'clear-surface', 'Clear Synthetic Counter onto Synthetic Rack', 'failed', { steps: 12, step: 4, failure: 'refused: tip budget exceeded at the counter edge', created: iso(-30), updated: iso(-29) }),
    job('t3', 'fetch-from-appliance', 'Fetch milk-1 from the fridge to the island', 'draft', { steps: 9, created: iso(-50) }),
    job('t4', 'clear-surface', 'Clear Synthetic Shelf onto Synthetic Bench', 'aborted', { steps: 10, step: 2, failure: 'e-stop', created: iso(-100), updated: iso(-99) }),
    job('t5', 'clear-surface', 'Clear Synthetic Sink onto Synthetic Rack', 'draft', { steps: 8, ok: false, issues: ['obj-3 is out of reach from every mapped standoff'], created: iso(-150) }),
    job('t6', 'explore', 'Explore the room', 'done', { steps: 11, step: 10, created: iso(-200), updated: iso(-199) }),
    job('t7', 'explore', 'Explore the room', 'done', { steps: 11, step: 10, created: iso(-400), updated: iso(-399) }),
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'embodied', file: 'embodied/tools/embodied.html', url: '/api/embodied/app', fullMarker: '#log li',
  assets: [{ url: '/api/embodied/assets/embodied.js', file: 'embodied/tools/embodied.js' }],
  reads: {
    '/api/embodied/tasks': tasks(iso),
    '/api/embodied/home-summary': {
      metrics: [
        { id: 'tasks-total', label: 'Physical tasks drafted', value: '7' },
        { id: 'tasks-done', label: 'Completed in simulation', value: '3' },
        { id: 'tasks-stopped', label: 'Failed or aborted', value: '2' },
        { id: 'commands-refused', label: 'Commands refused (7 days)', value: '1' },
      ],
      tiles: [], items: [{ text: 'Simulation only: every task here ran against the simulated kitchen, never a real arm or drone. Home reads task metadata only.', tone: 'neutral', fix: 'embodied' }], asOf: iso(0), partial: false,
    },
    '/api/embodied/log': [
      { log_id: 2, task_id: 't1', sim_ms: 4200, actor: 'planner', node_id: 'mini-drone-1', command: 'land', params: {}, outcome: 'completed', reason: null, created_at: iso(-3) },
      { log_id: 1, task_id: 't1', sim_ms: 1200, actor: 'planner', node_id: 'mini-drone-1', command: 'takeoff', params: {}, outcome: 'accepted', reason: null, created_at: iso(-3) },
    ],
  },
  audiences: {
    family: {
      stats: 4, sections: ['jobs', 'earlier'],
      text: ['Robot practice', 'The last robot job finished', 'Latest: Explore the room — drone first, ended 3 h ago. Everything here happened in a simulated room; no real robot moved.',
        'Open Embodied Swarm', 'Latest robot jobs', 'Map the room · Finished all 14 steps', 'ended 3 h ago',
        'Clear a surface · Stopped at step 5 of 12: refused: tip budget exceeded at the counter edge', 'ended yesterday',
        'Fetch from the fridge · Planned; the dry run went through', 'planned 2 days ago', 'Clear a surface · Called off at step 3 of 10: e-stop',
        'Planned; the dry run found a problem: obj-3 is out of reach from every mapped standoff', 'Planned earlier', 'never on a real arm or drone',
        'Commands refused, last 7 days'],
      statValues: { jobs: '7', done: '3', stopped: '2', refused: '1' },
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
