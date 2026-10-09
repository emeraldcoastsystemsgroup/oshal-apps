/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Scan to Print company audience view (ADR-164 D6): the page, its declared URL, the three surface scripts it loads from the package's /assets mount, synthetic read-only answers shaped like GET /api/scan-to-print/jobs (scan_print_job rows as the route selects them, newest first, with reconstruction reports in the engine's shape), GET /api/scan-to-print/printers (label, kind, base URL, never a key; the slicer flag) and GET /api/scan-to-print/home-summary (its four metrics with their ids, the tiles mirror, the items), and what the company view must show. The same jobs answer lets the full page paint its own object list without an audience. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description A reconstruction report as the engine writes it (the fields the view reads, plus neighbours).
 * @param {{x: number, y: number, z: number}} sizeMm The object's extents.
 * @param {boolean} printable The mesh validator's verdict.
 * @param {object} [extra] Fields that differ (lane, print-check failures).
 * @returns {object} The report.
 */
function report(sizeMm, printable, extra) {
  const validation = { watertight: printable, openEdges: printable ? 0 : 12, degenerate: 0, consistentWinding: true, outwardFacing: true, eulerCharacteristic: 2 };
  return Object.assign({ lane: 'silhouettes', sizeMm, printable, validation, method: 'visual hull', printChecks: { failures: [] }, warnings: [], limitations: ['Visual hull.'], triangleCount: 1200 }, extra || {});
}

/**
 * @description One scan_print_job row as GET /api/scan-to-print/jobs returns it.
 * @param {string} id The job id.
 * @param {string} title The object's name.
 * @param {string} state capturing | reconstructed | failed.
 * @param {string} source photos | video | pointcloud.
 * @param {string} updated ISO time of the last change.
 * @param {object|null} rep The last reconstruction report, or null.
 * @param {string|null} failure The failure reason, or null.
 * @returns {object} The row.
 */
function job(id, title, state, source, updated, rep, failure) {
  return { job_id: id, owner_sub: 'synthetic-sub', title, source_kind: source, state, known_dimensions: [{ axis: 'x', mm: 80 }], settings: {}, report: rep, failure_reason: failure, created_at: updated, updated_at: updated };
}

/**
 * @description The synthetic objects, most recently changed first: two printable models (one refined by a range image with
 * a print-check warning), a failed video reconstruction, an unprintable point cloud and an object still capturing.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} scan_print_job rows.
 */
function jobs(iso) {
  const wall = 'Print check: thinnest wall is 0.30 mm, under the 0.80 mm a 0.4 mm nozzle needs for 2 perimeters (measured to within one voxel, 0.500 mm).';
  return [
    job('j1', 'Synthetic Phone Stand', 'reconstructed', 'photos', iso(-2), report({ x: 80, y: 60.4, z: 120 }, true), null),
    job('j2', 'Synthetic Cup', 'reconstructed', 'photos', iso(-5), report({ x: 84, y: 84, z: 95.5 }, true, { lane: 'depth', printChecks: { failures: [wall] } }), null),
    job('j3', 'Synthetic Bracket', 'failed', 'video', iso(-30), null, 'Reconstruction produced no solid voxels; check the views and the known dimension'),
    job('j4', 'Synthetic Room Scan', 'reconstructed', 'pointcloud', iso(-100), report({ x: 300, y: 210, z: 95 }, false), null),
    job('j5', 'Synthetic Gear', 'capturing', 'photos', iso(-200), null, null),
  ];
}

/**
 * @description The synthetic home summary as routes/home-summary.js builds it: five objects, two printable, one failed, two
 * uploads sent to a printer in seven days.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object} The route's JSON body.
 */
function summary(iso) {
  const metrics = [
    { id: 'jobs-total', label: 'Objects scanned', value: '5' },
    { id: 'jobs-printable', label: 'Printable models', value: '2' },
    { id: 'jobs-failed', label: 'Failed reconstructions', value: '1' },
    { id: 'prints-week', label: 'Sent to a printer (7 days)', value: '2' },
  ];
  return { metrics, tiles: metrics, asOf: iso(0), partial: false, items: [
    { text: 'Synthetic Phone Stand', detail: 'reconstructed / photos / ' + iso(-2), tone: 'neutral', fix: 'scan-to-print' },
    { text: 'Caller-owned scan jobs, drawings and print submissions. Home reads metadata only; it never reconstructs, reads a model file, or contacts a printer.', tone: 'neutral', fix: 'scan-to-print' },
  ] };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'scan-to-print', file: 'scan-to-print/tools/scan-to-print.html', url: '/api/scan-to-print/app', fullMarker: '#job-list .job-item',
  assets: ['scan-to-print.js', 'scan-to-print-gl.js', 'scan-to-print-camera.js'].map((name) => ({ url: '/api/scan-to-print/assets/' + name, file: 'scan-to-print/tools/' + name })),
  reads: {
    '/api/scan-to-print/jobs': { jobs: jobs(iso) },
    '/api/scan-to-print/printers': { printers: [{ printer_id: 'p1', label: 'Synthetic Prusa', kind: 'prusalink', base_url: 'http://synthetic-printer.local', created_at: iso(-100) }], kinds: ['octoprint', 'moonraker', 'prusalink'], slicerConfigured: false },
    '/api/scan-to-print/home-summary': summary(iso),
  },
  audiences: {
    company: {
      stats: 4, sections: ['objects', 'attention', 'printers'],
      text: ['Engineering · Scan to Print', '2 printable models ready to print',
        'Latest: Synthetic Phone Stand (reconstructed), updated 2 h ago. Reconstructing, slicing and printing happen in the full page, and every print asks for a confirmation.',
        '1 still capturing', 'Watertight meshes', 'Sent to a printer, 7 days', 'Uploads the host accepted',
        'Newest objects', 'Extents (mm)', 'Synthetic Phone Stand', '80.0 × 60.4 × 120.0', 'Photos + depth', '84.0 × 84.0 × 95.5',
        'Synthetic Bracket', 'Video frames', 'yesterday', 'Point cloud', '300.0 × 210.0 × 95.0', 'Synthetic Gear', 'Capturing', '8 days ago',
        'Needs attention', 'Print check', 'thinnest wall is 0.30 mm', 'Reconstruction produced no solid voxels', 'Not printable: 12 open edges.',
        'Printers', 'Synthetic Prusa', 'PrusaLink', 'added 4 days ago', 'No slicer is configured on this swarm', 'Sending a job asks for a confirmation in the full page.',
        'Open the full scanner', 'Open Scan to Print in the cockpit'],
      statValues: { objects: '5', printable: '2', failed: '1', sent: '2' },
    },
  },
});

// ADR-164 D6: the family audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.company && !entry.audiences.family) entry.audiences.family = entry.audiences.company;
  return entries;
};
Object.assign(module.exports, __secondAudience);
