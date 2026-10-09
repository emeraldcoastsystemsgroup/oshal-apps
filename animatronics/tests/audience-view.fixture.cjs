/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Animatronics family audience view (ADR-164 D6): the page, its declared URL, the page's own scripts, and read-only answers shaped exactly as the routes send them. The rigs are the package's real templates (skull, two-axis eyes) with the saved rehearsal the real rehearsalFor produces and the public shape the real publicRig adds; /capabilities, /catalog/servos and a rig's detail answer only so the full page's own start paints (its marker is the saved report's channel table) without an audience - the view reads GET /rigs alone. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const E = require(path.join(ROOT, 'routes', 'engine', 'index.js'));
const CATALOG_FILE = E.loadServoCatalog(path.join(ROOT, 'catalog', 'servos.json'));
const CATALOG = E.servoMap(CATALOG_FILE.servos);
const TEMPLATES = E.buildTemplates(CATALOG);

/**
 * @description Load the compiled rig routes for their pure helpers (rehearsalFor, publicRig). Express and the framework
 * aliases are only referenced at load, never called by those helpers, so they are stubbed; the engine and the store are real.
 * @returns {object} The module's exports.
 */
function rigRoutes() {
  const dir = path.join(ROOT, 'routes');
  const logger = { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  const load = (name) => (name === 'express' ? {} : name.startsWith('@/') ? logger : require(path.resolve(dir, name)));
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', fs.readFileSync(path.join(dir, 'rig-routes.js'), 'utf8'))(load, mod, mod.exports, dir);
  return mod.exports;
}

/**
 * @description An animatronic_rig row built from a real template, as the store selects it.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @param {number} n Row number (last digit of the rig id).
 * @param {string} templateId The template the rig was made from.
 * @param {string} title The rig title.
 * @param {number} hours When it last changed, in hours from now.
 * @param {object} [extra] Column overrides.
 * @returns {object} The row.
 */
function row(iso, n, templateId, title, hours, extra) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  return Object.assign({ rig_id: '5e7a1c00-0000-4000-8000-00000000000' + n, owner_sub: 'synthetic-sub', title, rig: t.rig, poses: t.poses, scenarios: t.scenarios, armed: false, armed_at: null,
    current_pose: E.neutralPose(t.rig), run_count: 0, last_report: null, source: { kind: 'template', template: templateId }, created_at: iso(hours - 48), updated_at: iso(hours) }, extra);
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const R = rigRoutes();
  const skull = row(iso, 1, 'skull', 'Synthetic Porch Skull', -2, { run_count: 3 });
  skull.last_report = R.rehearsalFor(skull, CATALOG, [{ kind: 'run', scenario: 'BLINK' }], skull.current_pose).report;
  const eyes = row(iso, 2, 'two-axis-eyes', 'Synthetic Window Eyes', -30, { armed: true, armed_at: iso(-30), run_count: 2 });
  const rows = [skull, eyes];
  const count = (key) => rows.reduce((n, r) => n + Object.keys(r[key]).length, 0);
  const runs = [{ run: 3, kind: 'rehearse', scenario: 'BLINK', frames: skull.last_report.frames, created_at: iso(-2), verdict: skull.last_report.verdict.summary }];
  const assets = ['animatronics.js', 'animatronics-serial.js', 'animatronics-view.js'].map((f) => ({ url: '/api/animatronics/assets/' + f, file: 'animatronics/tools/' + f }));
  return {
    app: 'animatronics', file: 'animatronics/tools/animatronics.html', url: '/api/animatronics/app', fullMarker: '#report-channels tbody tr', assets,
    reads: {
      '/api/animatronics/rigs': { rigs: rows.map((r) => R.publicRig(r, CATALOG)) },
      '/api/animatronics/rigs/:rigId': (req) => {
        const r = rows.find((x) => x.rig_id === req.params.rigId) || skull;
        return { rig: R.publicRig(r, CATALOG), runs: r === skull ? runs : [], power: E.budgetPower(r.rig, CATALOG) };
      },
      '/api/animatronics/capabilities': { app: 'animatronics', contract: E.describeRigContract(), behaviour: E.describeBehaviourContract(), protocol: E.describeProtocol(),
        templates: TEMPLATES.map((t) => ({ id: t.id, title: t.title, description: t.description, channels: t.rig.channels.length, poses: Object.keys(t.poses), scenarios: Object.keys(t.scenarios) })) },
      '/api/animatronics/catalog/servos': { servos: CATALOG_FILE.servos, controllers: CATALOG_FILE.controllers },
    },
    audiences: {
      family: {
        stats: 4, sections: ['props', 'shows', 'checks'],
        text: ['Our props', '1 prop is armed', 'Newest change: Synthetic Porch Skull', 'Synthetic Window Eyes', '7 servos · ' + Object.keys(skull.poses).length + ' poses · 8 shows', 'Armed is the saved state',
          'Shows they know', 'Glance left', 'A quick look to the left and back', 'Last practice run', 'Passed · ' + (skull.last_report.durationMs / 1000).toFixed(1) + ' s'],
        statValues: { props: '2', shows: String(count('scenarios')), poses: String(count('poses')), armed: '1' },
      },
    },
  };
};

// ADR-164 D6: the company audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.family && !entry.audiences.company) entry.audiences.company = entry.audiences.family;
  return entries;
};
