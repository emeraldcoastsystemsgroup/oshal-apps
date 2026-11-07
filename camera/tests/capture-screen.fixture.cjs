/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fixture server for the Camera Ops capture-screen browser proof (UX audit
 *   2026-11-06): serves the shipped tools/camera-ops.html, answers GET /api/camera/fleet with an empty fleet (the native
 *   kernel's no_camera_node answer) or a one-camera fleet, answers the delete-all control the way the camera route does
 *   (428 until confirm:true) and records every control call, serves the kernel's REAL /cockpit/js/app-workflows.js (its
 *   mountConnectedActions offers nothing today) or a stand-in that offers one action, and the shell's shared UI and theme
 *   stylesheets from the kernel checkout when present (empty stand-ins otherwise). Never reaches a camera or a model.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const COCKPIT_JS = path.join(KERNEL, 'platform', 'src', 'pages', 'cockpit', 'js');
const THEMES = path.join(KERNEL, 'platform', 'src', 'pages', 'cockpit', 'css', 'themes');
const SHARED_UI = process.env.OSHAL_SHARED_UI || path.join(KERNEL, 'platform', 'src', 'shared', 'ui');
const PAGE = process.env.CAMERA_OPS_PAGE || path.join(PKG, 'tools', 'camera-ops.html');
const express = require(path.join(TOOLCHAIN, 'express'));

/** A connected-actions module that offers this person one action, as a future mountConnectedActions would. */
const OFFERING_MODULE = `export async function mountConnectedActions({ element }) {
  const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = 'Open in Office';
  element.replaceChildren(b); element.hidden = false; element.style.display = '';
}`;

/** One online, linked simulator camera as GET /fleet lists it. */
const ONE_CAMERA = [{ cameraId: 'sim-1', kind: 'sim', remote: false, online: true, lastSeenMs: null, videoUrl: null,
  telemetry: { cameraId: 'sim-1', status: 'connected', connected: true, recording: false, mode: 'video', model: 'OSHAL SimCam',
    batteryPct: 97, sdRemainingPhotos: 900, sdRemainingVideoS: 5400, recordElapsedS: 0, previewActive: false, settings: { fps: 60 } } }];

/**
 * @description Send a file from disk, or an empty stand-in of the right type when the checkout does not have it.
 * @param {object} res Express response.
 * @param {string} file Absolute path.
 * @param {string} type 'js' or 'css'.
 * @returns {void}
 */
function sendOrEmpty(res, file, type) {
  if (fs.existsSync(file)) return res.type(type).send(fs.readFileSync(file, 'utf8'));
  return res.type(type).send('');
}

/**
 * @description Start the fixture.
 * @param {{ fleet?: object[], offer?: boolean }} opts fleet: what GET /fleet lists; offer: serve the offering module.
 * @returns {Promise<{ server: object, base: string, controls: object[] }>} The server, its base URL and the control calls.
 */
async function serve(opts = {}) {
  const fleet = opts.fleet || [], controls = [];
  const app = express();
  app.use(express.json());
  app.get('/camera', (_req, res) => res.sendFile(PAGE));
  app.get('/api/camera/fleet', (_req, res) => res.json(fleet.length ? { fleet } : { fleet: [], detail: 'No camera node is registered with this native runtime.' }));
  app.get('/api/camera/state', (req, res) => res.json({ telemetry: (fleet.find((f) => f.cameraId === req.query.cameraId) || {}).telemetry || null }));
  app.get('/api/camera/captures', (_req, res) => res.json({ captures: [] }));
  app.get('/api/camera/events', (_req, res) => res.json({ events: [] }));
  app.get('/api/camera/home-summary', (_req, res) => res.json({ items: [], metrics: [] }));
  app.post('/api/camera/control', (req, res) => {
    controls.push(req.body);
    if (req.body.op === 'deleteAll' && req.body.confirm !== true) return res.status(428).json({ error: 'confirmation required', confirmationRequired: true });
    return res.json({ ok: true });
  });
  app.get('/cockpit/js/app-workflows.js', (_req, res) => (opts.offer ? res.type('js').send(OFFERING_MODULE) : sendOrEmpty(res, path.join(COCKPIT_JS, 'app-workflows.js'), 'js')));
  app.get('/cockpit/js/:file', (req, res) => sendOrEmpty(res, path.join(COCKPIT_JS, path.basename(req.params.file)), 'js'));
  app.get('/cockpit/css/themes/:file', (req, res) => sendOrEmpty(res, path.join(THEMES, path.basename(req.params.file)), 'css'));
  app.get(/^\/shared\/ui\/(css|js)\/([\w.-]+)$/, (req, res) => sendOrEmpty(res, path.join(SHARED_UI, req.params[0], req.params[1]), req.params[0]));
  app.use((_req, res) => res.status(404).type('text').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}`, controls };
}

module.exports = { serve, ONE_CAMERA, TOOLCHAIN, KERNEL, COCKPIT_JS };
