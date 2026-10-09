/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Camera Ops family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/camera/fleet (CameraFleetSummary rows: a simulated camera, an offline GoPro and a recording GoPro whose node declares a feed URL), /captures per camera (CameraCapture rows, one with a thumbnail URL on the camera node) and /home-summary (the route's three metrics, one item per logged command with its prepare-document offer, the audit note last), and what the family view must show. /state and /events answer only so the full page's own polling has something to read without an audience; the view never reads them. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const FEED = 'http://192.0.2.10:8080';

/**
 * @description A CameraTelemetry snapshot as the camera engine reports it.
 * @param {string} cameraId Fleet id.
 * @param {object} extra Fields that differ from an idle, linked simulator.
 * @returns {object} The telemetry.
 */
function telemetry(cameraId, extra) {
  return Object.assign({ cameraId, status: 'connected', connected: true, recording: false, mode: 'video', model: 'OSHAL SimCam', batteryPct: 97.5,
    sdRemainingPhotos: 900, sdRemainingVideoS: 5400, recordElapsedS: 0, previewActive: false, settings: { resolution: '1080p', fps: 60 }, lastCaptureSeq: 0 }, extra);
}

/**
 * @description The synthetic fleet as GET /fleet lists it, sorted by camera id as the route sorts it.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} CameraFleetSummary rows.
 */
function fleet(iso) {
  return [
    { cameraId: 'sim-1', kind: 'sim', remote: false, online: true, lastSeenMs: null, telemetry: telemetry('sim-1', { mode: 'photo' }), videoUrl: null },
    { cameraId: 'synthetic-garage', kind: 'gopro', remote: true, online: false, lastSeenMs: Date.parse(iso(-3)), videoUrl: null,
      telemetry: telemetry('synthetic-garage', { model: 'Synthetic HERO9 Black', batteryPct: 40 }) },
    { cameraId: 'synthetic-hero9', kind: 'gopro', remote: true, online: true, lastSeenMs: Date.parse(iso(0)), videoUrl: FEED + '/live',
      telemetry: telemetry('synthetic-hero9', { status: 'recording', recording: true, recordElapsedS: 42, model: 'Synthetic HERO9 Black', batteryPct: 76.4 }) },
  ];
}

/**
 * @description The synthetic captures each camera reported, as GET /captures answers for its cameraId.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {Record<string, object[]>} CameraCapture rows by camera id.
 */
function captures(iso) {
  return {
    'sim-1': [{ seq: 1, ts: Date.parse(iso(-1)), kind: 'photo', path: '100GOPRO/GOPR0001.JPG' }],
    'synthetic-hero9': [
      { seq: 6, ts: Date.parse(iso(-2)), kind: 'photo', path: '100GOPRO/GOPR0006.JPG', sizeBytes: 4000000, thumbUrl: FEED + '/thumb/GOPR0006.JPG' },
      { seq: 7, ts: Date.parse(iso(-0.5)), kind: 'video', path: '100GOPRO/GX010007.MP4', durationS: 75 },
    ],
  };
}

/**
 * @description One command item exactly as routes/home-summary.js builds it.
 * @param {string} id Camera id.
 * @param {string} op Logged op.
 * @param {string} outcome 'ok' or 'rejected'.
 * @param {string} at ISO time the command was logged.
 * @returns {object} A home-summary item.
 */
function command(id, op, outcome, at) {
  const detail = op + ' / ' + outcome + ' / ' + at;
  return { text: 'Camera ' + id, detail, tone: outcome === 'rejected' ? 'warn' : 'neutral', fix: 'camera-ops',
    actions: [{ integration: 'prepare-document', context: { title: 'Camera ' + id, notes: detail + '\nCommand log only. Acceptance does not prove capture completion, media availability or physical device state. The log may include simulated cameras.' } }] };
}

/**
 * @description The synthetic home summary as the route answers it.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object} The summary.
 */
function summary(iso) {
  const metrics = [{ id: 'commands-24h', label: 'Commands logged / 24h', value: '3' }, { id: 'commands-5d', label: 'Commands logged / 5d', value: '5' }, { id: 'rejected-5d', label: 'Rejected commands / 5d', value: '1' }];
  return { metrics, tiles: metrics, asOf: iso(0), partial: false, items: [
    command('synthetic-hero9', 'record', 'ok', iso(-1)), command('sim-1', 'deleteAll', 'rejected', iso(-2)), command('sim-1', 'photo', 'ok', iso(-26)),
    { text: 'Your recorded camera commands, including rejected attempts. Simulation and hardware commands share this audit log; it cannot establish physical success. Prepare a diagnostic brief from selected metadata without transferring captures or issuing commands.', tone: 'neutral', fix: 'camera-ops' },
  ] };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const rows = fleet(iso), byCamera = captures(iso);
  const one = (req) => rows.find((f) => f.cameraId === String(req.query.cameraId || 'sim-1')) || rows[0];
  return {
    app: 'camera', file: 'camera/tools/camera-ops.html', url: '/api/camera/app', fullMarker: '#fleetList .cam-row',
    reads: {
      '/api/camera/fleet': { fleet: rows },
      '/api/camera/captures': (req) => ({ captures: byCamera[String(req.query.cameraId)] || [] }),
      '/api/camera/home-summary': summary(iso),
      '/api/camera/state': (req) => ({ telemetry: one(req).telemetry }),
      '/api/camera/events': () => ({ events: [{ seq: 1, ts: Date.parse(iso(-1)), level: 'info', message: 'Synthetic camera connected' }] }),
    },
    audiences: {
      family: {
        stats: 4, sections: ['cameras', 'captures', 'commands'],
        text: ['Our cameras', '1 camera recording', 'synthetic-hero9 has been recording for 0:42.', 'Open Camera Ops',
          'Cameras', 'sim-1', 'Practice camera (simulated) · Photo mode', 'battery 98%', 'Ready',
          'synthetic-garage', 'Synthetic HERO9 Black · Video mode', 'last seen 3 h ago', 'Offline',
          'synthetic-hero9', 'battery 76% · recording 0:42', 'Recording',
          'A practice camera is simulated: it shows how Camera Ops works, and nothing it captures is real.',
          'Latest photos and videos', 'Video · 1:15', 'On synthetic-hero9 · 100GOPRO/GX010007.MP4', 'On synthetic-hero9 · 100GOPRO/GOPR0006.JPG', 'On sim-1 · 100GOPRO/GOPR0001.JPG',
          'What the cameras reported since Camera Ops last started. The files stay on the camera.',
          'Recent commands', 'Start recording', 'Camera synthetic-hero9', 'Erase all media', 'Refused', 'Take a photo', 'Accepted', 'yesterday',
          'Accepted means the camera took the command; it does not prove a photo or video was made.'],
        statValues: { online: '2', recording: '1', captures: '3', commands: '3' },
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
