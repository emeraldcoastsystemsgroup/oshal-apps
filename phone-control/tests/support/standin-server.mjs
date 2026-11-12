/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Stand-in HTTP server that serves phone-control UI assets from phone-control/tools/ and answers every fetch() URL the page's scripts call with realistic stand-in JSON.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.6.0: no machine path. The kernel's shared files come from OSHAL_KERNEL_ROOT when it is set and are answered empty when it is not, so the suite runs in a bare checkout; phone-home.js is served.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.10.0 (T27; Roger, 2026-11-10: "we should be able to rename connections"): PATCH /api/computers/{id} keeps a given name as the kernel does and refuses an empty or over-long one with {refused, detail}.
 */

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

// ---- Kernel shared-asset serving ----
// The kernel's shared styles and scripts are read from a kernel checkout when OSHAL_KERNEL_ROOT names one (for pictures
// true to the real screen). Without it, as in the store gate, each is answered empty: the page still runs on its own files.
const KERNEL_ROOT = process.env.OSHAL_KERNEL_ROOT || '';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Serve shared kernel assets (CSS, JS, fonts, images) referenced by the page.
 * Returns true if the URL was handled (success or 404 with MISSING log).
 */
function handleSharedAsset(req, res) {
  const url = req.url;

  // --- /ui/kernel/screen.css  ->  <root>/crates/api/src/kernel_screen.css ---
  if (url === '/ui/kernel/screen.css') {
    const path = resolve(KERNEL_ROOT, 'crates/api/src/kernel_screen.css');
    if (existsSync(path)) { return serveFile(res, path, '.css'); }
    if (!KERNEL_ROOT) { res.writeHead(200, { 'content-type': CONTENT_TYPES[url.split('?')[0].slice(url.split('?')[0].lastIndexOf('.'))] || 'text/plain; charset=utf-8' }); res.end(''); return true; }
    console.log(`MISSING ${url} -> ${path}`);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'kernel_screen.css not found' }));
    return true;
  }

  // --- /ui/kernel/shell.css  ->  <root>/crates/api/src/shell.css ---
  if (url === '/ui/kernel/shell.css') {
    const path = resolve(KERNEL_ROOT, 'crates/api/src/shell.css');
    if (existsSync(path)) { return serveFile(res, path, '.css'); }
    if (!KERNEL_ROOT) { res.writeHead(200, { 'content-type': CONTENT_TYPES[url.split('?')[0].slice(url.split('?')[0].lastIndexOf('.'))] || 'text/plain; charset=utf-8' }); res.end(''); return true; }
    console.log(`MISSING ${url} -> ${path}`);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'shell.css not found' }));
    return true;
  }

  // --- /ui/kernel/table.js  ->  <root>/crates/api/src/kernel_table.js ---
  if (url === '/ui/kernel/table.js') {
    const path = resolve(KERNEL_ROOT, 'crates/api/src/kernel_table.js');
    if (existsSync(path)) { return serveFile(res, path, '.js'); }
    if (!KERNEL_ROOT) { res.writeHead(200, { 'content-type': CONTENT_TYPES[url.split('?')[0].slice(url.split('?')[0].lastIndexOf('.'))] || 'text/plain; charset=utf-8' }); res.end(''); return true; }
    console.log(`MISSING ${url} -> ${path}`);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'kernel_table.js not found' }));
    return true;
  }

  // --- /cockpit/css/themes/…  ->  <root>/platform/src/pages/cockpit/css/themes/… ---
  if (url.startsWith('/cockpit/css/themes/')) {
    const rel = url.slice('/cockpit/css/themes/'.length);
    const path = resolve(KERNEL_ROOT, 'platform/src/pages/cockpit/css/themes', rel);
    if (existsSync(path)) { return serveFile(res, path, '.css'); }
    if (!KERNEL_ROOT) { res.writeHead(200, { 'content-type': CONTENT_TYPES[url.split('?')[0].slice(url.split('?')[0].lastIndexOf('.'))] || 'text/plain; charset=utf-8' }); res.end(''); return true; }
    console.log(`MISSING ${url} -> ${path}`);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'cockpit theme not found' }));
    return true;
  }

  // --- /shared/ui/css/…  ->  <root>/platform/src/shared/ui/css/… ---
  if (url.startsWith('/shared/ui/css/')) {
    const rel = url.slice('/shared/ui/css/'.length);
    const path = resolve(KERNEL_ROOT, 'platform/src/shared/ui/css', rel);
    if (existsSync(path)) { return serveFile(res, path, null); }
    console.log(`MISSING ${url} -> ${path}`);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'shared css not found' }));
    return true;
  }

  // --- /shared/ui/js/…  ->  <root>/platform/src/shared/ui/js/… ---
  if (url.startsWith('/shared/ui/js/')) {
    const rel = url.slice('/shared/ui/js/'.length);
    const path = resolve(KERNEL_ROOT, 'platform/src/shared/ui/js', rel);
    if (existsSync(path)) { return serveFile(res, path, '.js'); }
    if (!KERNEL_ROOT) { res.writeHead(200, { 'content-type': CONTENT_TYPES[url.split('?')[0].slice(url.split('?')[0].lastIndexOf('.'))] || 'text/plain; charset=utf-8' }); res.end(''); return true; }
    console.log(`MISSING ${url} -> ${path}`);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'shared js not found' }));
    return true;
  }

  return false;
}

/**
 * Helper: read a file and send it with the right content type.
 */
function serveFile(res, filePath, forcedExt) {
  let ext = forcedExt || getExt(filePath);
  const ct = CONTENT_TYPES[ext] || 'application/octet-stream';
  try {
    const buf = readFileSync(filePath);
    res.writeHead(200, { 'content-type': ct });
    res.end(buf);
    return true;
  } catch (err) {
    console.log(`MISSING ${filePath} -> ${err.message}`);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'read_failed', detail: err.message }));
    return false;
  }
}

function getExt(fp) {
  const idx = fp.lastIndexOf('.');
  return idx >= 0 ? fp.slice(idx) : '';
}
const ASSETS = {
  'phone-control.css': 'text/css; charset=utf-8',
  'phone-control.js': 'application/javascript; charset=utf-8',
  'computer-link.js': 'application/javascript; charset=utf-8',
  'phone-stage.js': 'application/javascript; charset=utf-8',
  'phone-home.js': 'application/javascript; charset=utf-8',
  'phone-setup.js': 'application/javascript; charset=utf-8',
  'phone-rdp.js': 'application/javascript; charset=utf-8',
  'phone-concierge.js': 'application/javascript; charset=utf-8',
  'session-computer.js': 'application/javascript; charset=utf-8',
  'session-media.js': 'application/javascript; charset=utf-8',
  'session-collab.js': 'application/javascript; charset=utf-8',
  'editor-handoff.mjs': 'application/javascript; charset=utf-8'
};

/* URLs stubbed by this server (found in phone-control tools/*.js):
 * /api/phone-control/ui                  phone-control.html (page itself)
 * /api/phone-control/ui/:asset           phone-control.js line 15-18 (static assets)
 * /api/computers                          computer-link.js line 353 (createComputerClient.list)
 * /api/computers/{id}/screen              computer-link.js line 357 (createComputerClient.screen)
 * /api/computers/{id}/run                 computer-link.js line 363 (createComputerClient.tool)
 * /api/phone-control/devices              computer-link.js line 405 (createPackageClient.phones)
 * /api/phone-control/devices/{id}         computer-link.js line 406 (createPackageClient.phone)
 * /api/phone-control/devices POST          computer-link.js line 407 (createPackageClient.savePhone)
 * /api/phone-control/devices/{id} POST     computer-link.js line 408 (createPackageClient.updatePhone)
 * /api/phone-control/devices/{id} DELETE   computer-link.js line 409 (createPackageClient.removePhone)
 * /api/phone-control/devices/{id}/command-plan POST computer-link.js line 410
 * /api/phone-control/devices/{id}/execute POST computer-link.js line 411
 * /api/phone-control/rdp/command-plan POST computer-link.js line 412
 * /api/phone-control/history GET           computer-link.js line 413
 * /api/phone-control/history POST          computer-link.js line 414
 * /api/phone-control/computers/reports    computer-link.js line 415 (createPackageClient.reports)
 * /api/phone-control/computers/{node}/report POST computer-link.js line 416
 * /api/phone-control/bridge/manifest.json computer-link.js line 417 (createPackageClient.manifest)
 * /api/phone-control/concierge/turn POST  computer-link.js line 418
 * /api/phone-control/sessions/preferences GET  computer-link.js line 419
 * /api/phone-control/sessions/preferences POST computer-link.js line 423
 * /api/phone-control/sessions/chat GET     computer-link.js line 424
 * /api/phone-control/sessions/chat POST    computer-link.js line 425
 * /api/phone-control/sessions/chat DELETE  computer-link.js line 426
 * /api/phone-control/sessions/whiteboard GET  computer-link.js line 428
 * /api/phone-control/sessions/whiteboard POST computer-link.js line 431
 * /api/phone-control/sessions/whiteboard DELETE computer-link.js line 432
 * /api/phone-control/sessions/captures GET computer-link.js line 433
 * /api/phone-control/sessions/captures POST computer-link.js line 434
 * /api/phone-control/sessions/captures/{id} DELETE computer-link.js line 436
 * /api/phone-control/sessions/transfers GET computer-link.js line 437
 * /api/phone-control/sessions/transfers POST computer-link.js line 438
 * /api/phone-control/sessions/transfers/{id} DELETE computer-link.js line 440
 * /api/rdp/sessions                        computer-link.js line 481 (createRdpClient)
 * /api/rdp/sessions POST                   computer-link.js line 488 (createRdpClient.create)
 * /api/rdp/sessions/{id}/frame             computer-link.js line 496 (createRdpClient.frame)
 * /api/rdp/sessions/{id}/input POST        computer-link.js line 504 (createRdpClient.input)
 * /api/rdp/sessions/{id} DELETE            computer-link.js line 508 (createRdpClient.disconnect)
 * /api/devices/downloads                   phone-rdp.js line 463
 * /api/voice/transcribe                    phone-concierge.js line 341
 * /api/jarvis/ambient/transcribe           phone-concierge.js line 341
 * /devices                                 computer-link.js line 405 (bare-path compat)
 * /devices/{id}                            computer-link.js line 406 (bare-path compat)
 * /devices POST                            computer-link.js line 407 (bare-path compat)
 */

const PORT = parseInt(process.env.PORT || '4599', 10);
const TOOLS_DIR = join(import.meta.dirname, '..', '..', 'tools');

const computers = [
  { id: 'spark-f255', name: 'spark-f255', platform: 'linux', connected: true, can_control: true, tools: ['shell.exec', 'desktop.control', 'app.open'] },
  { id: 'my-computer', name: 'my-computer', platform: 'windows', connected: true, can_control: true, tools: ['shell.exec', 'desktop.control', 'app.open'] },
  { id: 'office-amazon-tv', name: 'Office Amazon TV', platform: 'android', connected: true, can_control: true, tools: ['shell.exec', 'desktop.control'] },
  { id: 'galaxy-s25', name: 'Galaxy S25', platform: 'android', connected: false, can_control: false, tools: [] },
  { id: 'kitchen-tablet', name: 'Kitchen tablet', platform: 'android', connected: false, can_control: false, tools: [] },
  { id: 'old-laptop', name: 'old-laptop', platform: 'linux', connected: false, can_control: false, tools: [] }
];

const phones = [
  { id: 'iphone-bt-1', name: 'My iPhone', platform: 'ios', form: 'phone', connectionType: 'bluetooth', address: null, computerNodeId: 'my-computer', controlEnabled: true },
  { id: 'fire-tv-wifi', name: 'Fire TV', platform: 'android', form: 'tv', connectionType: 'wifi-adb', address: '192.168.1.60:5555', computerNodeId: 'spark-f255', controlEnabled: true },
  { id: 'android-usb-1', name: 'Pixel 9', platform: 'android', form: 'phone', connectionType: 'usb', address: '192.168.1.77:5555', computerNodeId: 'spark-f255', controlEnabled: true },
  { id: 'tablet-usb-1', name: 'Tablet', platform: 'android', form: 'phone', connectionType: 'usb', address: '192.168.1.80:5555', computerNodeId: 'my-computer', controlEnabled: false },
  { id: 'tablet-wifi-1', name: 'Tablet', platform: 'android', form: 'phone', connectionType: 'wifi-adb', address: '192.168.1.80:5555', computerNodeId: 'my-computer', controlEnabled: false },
  { id: 'tv-unreachable', name: 'Living Room TV', platform: 'android', form: 'tv', connectionType: 'wifi-adb', address: '192.168.1.90:5555', computerNodeId: 'spark-f255', controlEnabled: false }
];

const reports = [
  { computerNodeId: 'spark-f255', report: 'Android Wireless Debugging enabled', reportedAt: Date.now() },
  { computerNodeId: 'my-computer', report: 'Windows Subsystem for Android active', reportedAt: Date.now() }
];

const bridgeManifest = { version: '1.5.4', files: ['oshal_phone_bridge.py', 'oshal_phone_ble.py', 'oshal_phone_lan.py'] };
const history = [];

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function handleAsset(req, res) {
  if (req.url === '/api/phone-control/ui' || req.url === '/api/phone-control/ui/') {
    const html = readFileSync(join(TOOLS_DIR, 'phone-control.html'), 'utf-8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }
  const m = req.url.match(/^\/api\/phone-control\/ui\/(.+)$/);
  if (m) {
    const assetName = m[1];
    const type = ASSETS[assetName];
    if (type) {
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(readFileSync(join(TOOLS_DIR, assetName), 'utf-8'));
      return true;
    }
  }
  return false;
}

function handleApi(req, res) {
  const url = req.url.split('?')[0];
  const method = req.method;
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const jsonBody = body ? JSON.parse(body) : {};
    if (url === '/api/computers' && method === 'GET') { jsonResponse(res, { computers }); return; }
    const named = url.match(/^\/api\/computers\/([^/]+)$/);
    if (named && method === 'PATCH') {
      // As the kernel's computers_rename: one line of at most 80 characters, kept as the given name; a refusal is {refused, detail}.
      const computer = computers.find((c) => c.id === decodeURIComponent(named[1]));
      const name = String(jsonBody.name || '').trim();
      if (!computer) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ refused: 'not_found', detail: 'you have no computer with that id' })); return; }
      if (!name || name.length > 80 || /[\r\n]/.test(name)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ refused: 'invalid_request', detail: 'a device name is one line of at most 80 characters' })); return; }
      computer.name = name; jsonResponse(res, { id: computer.id, name }); return;
    }
    if (/^\/api\/computers\/[^/]+\/screen$/.test(url)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ frame: 'stub' })); return; }
    if (/^\/api\/computers\/[^/]+\/run$/.test(url) && method === 'POST') { jsonResponse(res, { ok: true, result: 'stub' }); return; }
    if (url === '/api/phone-control/devices') {
      if (method === 'GET') { jsonResponse(res, { devices: phones }); return; }
      if (method === 'POST') {
        const d = { ...phones[0], id: `new-${Date.now()}`, ...jsonBody };
        phones.push(d);
        jsonResponse(res, { device: d, created: true }, 201);
        return;
      }
    }
    const dm = url.match(/^\/api\/phone-control\/devices\/([^/]+)$/);
    if (dm) {
      const idx = phones.findIndex(p => p.id === decodeURIComponent(dm[1]));
      if (idx >= 0) {
        if (method === 'GET') { jsonResponse(res, { device: phones[idx] }); return; }
        if (method === 'POST') { phones[idx] = { ...phones[idx], ...jsonBody }; jsonResponse(res, { device: phones[idx] }); return; }
        if (method === 'DELETE') { phones.splice(idx, 1); res.writeHead(204).end(); return; }
      }
      jsonResponse(res, { error: 'device_not_found' }, 404);
      return;
    }
    if (/^\/api\/phone-control\/devices\/[^/]+\/command-plan$/.test(url) && method === 'POST') { jsonResponse(res, { plan: [], steps: [] }); return; }
    if (/^\/api\/phone-control\/devices\/[^/]+\/execute$/.test(url) && method === 'POST') { jsonResponse(res, { ok: true, result: 'stub' }); return; }
    if (url === '/api/phone-control/rdp/command-plan' && method === 'POST') { jsonResponse(res, { plan: [], steps: [] }); return; }
    if (url === '/api/phone-control/history') {
      if (method === 'GET') { jsonResponse(res, { history }); return; }
      if (method === 'POST') { jsonResponse(res, { event: { ...jsonBody, eventId: `e-${Date.now()}` } }, 201); return; }
    }
    if (url === '/api/phone-control/computers/reports' && method === 'GET') { jsonResponse(res, { reports }); return; }
    if (/^\/api\/phone-control\/computers\/[^/]+\/report$/.test(url) && method === 'POST') {
      jsonResponse(res, { computerNodeId: 'stub', report: 'updated', reportedAt: Date.now() });
      return;
    }
    if (url === '/api/phone-control/bridge/manifest.json' && method === 'GET') { jsonResponse(res, bridgeManifest); return; }
    if (url === '/api/phone-control/concierge/turn' && method === 'POST') {
      jsonResponse(res, { reply: 'stub', done: true, actions: [] });
      return;
    }
    if (url === '/api/phone-control/sessions/preferences') {
      if (method === 'GET') { jsonResponse(res, { preferences: [] }); return; }
      if (method === 'POST') { jsonResponse(res, { preference: { monitorId: 'primary' } }); return; }
    }
    if (url === '/api/phone-control/sessions/chat') {
      if (method === 'GET') { jsonResponse(res, { messages: [] }); return; }
      if (method === 'POST') { jsonResponse(res, { message: { id: 'msg-1', text: 'stub' } }); return; }
      if (method === 'DELETE') { jsonResponse(res, { ok: true }); return; }
    }
    if (url === '/api/phone-control/sessions/whiteboard') {
      if (method === 'GET') { jsonResponse(res, { strokes: [] }); return; }
      if (method === 'POST') { jsonResponse(res, { stroke: { id: 's-1' } }); return; }
      if (method === 'DELETE') { jsonResponse(res, { ok: true }); return; }
    }
    if (url === '/api/phone-control/sessions/captures') {
      if (method === 'GET') { jsonResponse(res, { captures: [] }); return; }
      if (method === 'POST') { jsonResponse(res, { capture: { id: 'cap-1' } }); return; }
    }
    if (/^\/api\/phone-control\/sessions\/captures\/[^/]+$/.test(url) && method === 'DELETE') { res.writeHead(204).end(); return; }
    if (url === '/api/phone-control/sessions/transfers') {
      if (method === 'GET') { jsonResponse(res, { transfers: [] }); return; }
      if (method === 'POST') { jsonResponse(res, { transfer: { id: 'xfer-1' } }); return; }
    }
    if (/^\/api\/phone-control\/sessions\/transfers\/[^/]+$/.test(url) && method === 'DELETE') { res.writeHead(204).end(); return; }
    if (url === '/api/rdp/sessions') {
      if (method === 'GET') { jsonResponse(res, { sessions: [] }); return; }
      if (method === 'POST') {
        const s = { sessionId: `rdp-${Date.now()}`, host: jsonBody.host || '192.168.1.1', port: 3389, connected: true, width: 1280, height: 800 };
        jsonResponse(res, s);
        return;
      }
    }
    if (/^\/api\/rdp\/sessions\/[^/]+\/frame$/.test(url) && method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ frame: 'stub' }));
      return;
    }
    if (/^\/api\/rdp\/sessions\/[^/]+\/input$/.test(url) && method === 'POST') { jsonResponse(res, { ok: true }); return; }
    if (/^\/api\/rdp\/sessions\/[^/]+$/.test(url) && method === 'DELETE') { res.writeHead(204).end(); return; }
    if (url === '/api/devices/downloads' && method === 'GET') { jsonResponse(res, { downloads: [] }); return; }
    if (url === '/api/voice/transcribe' && method === 'POST') { jsonResponse(res, { text: 'stub', duration: 1.2 }); return; }
    if (url === '/api/jarvis/ambient/transcribe' && method === 'POST') { jsonResponse(res, { text: '', duration: 0 }); return; }
    if (url === '/devices' && method === 'GET') { jsonResponse(res, { devices: phones }); return; }
    if (url === '/devices' && method === 'POST') {
      const d = { ...phones[0], id: `new-${Date.now()}`, ...jsonBody };
      phones.push(d);
      jsonResponse(res, { device: d, created: true }, 201);
      return;
    }
    const bdm = url.match(/^\/devices\/([^/]+)$/);
    if (bdm) {
      const idx = phones.findIndex(p => p.id === decodeURIComponent(bdm[1]));
      if (idx >= 0) {
        if (method === 'GET') { jsonResponse(res, { device: phones[idx] }); return; }
        if (method === 'POST') { phones[idx] = { ...phones[idx], ...jsonBody }; jsonResponse(res, { device: phones[idx] }); return; }
        if (method === 'DELETE') { phones.splice(idx, 1); res.writeHead(204).end(); return; }
      }
      jsonResponse(res, { error: 'device_not_found' }, 404);
      return;
    }
    console.log(`UNKNOWN ${req.url}`);
    jsonResponse(res, {}, 200);
  });
  return true;
}

const server = require('node:http').createServer((req, res) => {
  if (handleSharedAsset(req, res)) return;
  if (handleAsset(req, res)) return;
  if (handleApi(req, res)) return;
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(`standin-server listening on port ${PORT}`);
  console.log(`Serving static assets from: ${TOOLS_DIR}`);
  console.log(`Serving kernel shared assets from: ${KERNEL_ROOT}`);
  console.log(`Phone & Device Control page URL: http://localhost:${PORT}/api/phone-control/ui`);
});

export { server };
