/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's audience views (ADR-164 D6): the page, its declared URL, synthetic read-only answers for its own routes and what each audience must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Schedules now carry what GET /api/home/schedules really returns (id, label, the trigger OBJECT, the UTC cron, nextRunAt, status): one solar and one weekday clock schedule. The old fixture passed the trigger as the string 'sunset', which hid that the family view printed "[object Object]" for every real schedule. The family view must show the solar text exactly as the full page does ("sunset -15m") and the weekday suffix of the clock one.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
    app: 'home', file: 'home/tools/home.html', url: '/api/home/ui', fullMarker: '#grid',
    reads: {
      '/api/home/devices': { devices: [{ key: 'd1', name: 'Kitchen light', switch: 'on', capabilities: ['switch', 'switchLevel'] }, { key: 'd2', userName: 'Porch', name: 'x', switch: 'off', capabilities: ['switch'] }, { key: 'd3', name: 'Den lamp', switch: 'on', capabilities: ['switch'] }], deviceCount: 3, hubs: ['SmartThings'], generatedAt: iso(-1) },
      '/api/home/scenes': { scenes: [{ name: 'Movie night', steps: [{}, {}] }, { name: 'Good morning', steps: [{}] }] },
      '/api/home/schedules': { schedules: [
        { id: 's1', label: 'Porch on at dusk', trigger: { kind: 'solar', event: 'sunset', offsetMin: -15, lat: 30.4, lng: -86.6 }, cron: '45 23 * * *', nextRunAt: iso(5), status: 'active' },
        { id: 's2', label: 'Coffee maker on', trigger: { kind: 'clock', hour: 6, minute: 30, repeat: 'weekdays', tzOffsetMin: 300 }, cron: '30 11 * * 1-5', nextRunAt: iso(14), status: 'active' },
      ] },
    },
    audiences: {
      family: { stats: 4, sections: ['scenes', 'devices', 'schedules'], text: ['2 of 3 devices are on', 'Movie night', 'Porch on at dusk', 'sunset -15m', 'Coffee maker on', ' · weekdays', 'Kitchen light', 'Dimmable'], statValues: { on: '2', devices: '3', scenes: '2', schedules: '2' } },
    },
  });

// ADR-164 D6: the company audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.family && !entry.audiences.company) entry.audiences.company = entry.audiences.family;
  return entries;
};
