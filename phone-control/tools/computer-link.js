/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0: how the page reaches a phone - through the person's own computer. The kernel's /api/computers runs one shell.exec there (ADR-205, the same route the kernel's own computer page uses); the command is always the installed bridge with a closed verb and one base64 argument, so nothing a person types ever reaches the shell as text. Also: the bridge install command (every file's sha256 checked before any is replaced), the picture of an Android screen read in parts and checked by sha256, tap and swipe scaling, and a one-at-a-time queue where a press goes before the next screen refresh.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0: the verbs adb-connect-tv (a Fire TV or Android TV at its address, port 5555 by default) and ble-remove (forget one Bluetooth pairing); bridgeSupport says plainly that the phone bridge runs on a Linux computer only (it gets adb with apt and the iPhone keyboard is BlueZ), and computerStanding says what to do on the computer when it cannot take commands.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: AirPlay screen mirroring verbs (setup-mirror, mirror-start, mirror-stop, mirror-frame), oshal_phone_mirror.py in the verified bridge installer, readFrame support for mirror-frame, and lowercase oshal Node copy.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: add desktop.control and app.open computer client helpers, iOS direct tap/swipe/drag/scroll & screen reading verbs (ble-tap, ble-swipe, ble-drag, ble-scroll, mirror-ui), Fire TV Wi-Fi scan & chunked APK push verbs (adb-scan-tv, stage-chunk, adb-install-apk), Android file/clipboard bridge verbs, session & concierge package client routes, quality presets, and normalized iOS gesture geometry.
 */

export const BRIDGE = '"$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py"';
export const VERBS = Object.freeze([
  'version', 'status', 'setup-adb', 'setup-mirror', 'mirror-start', 'mirror-stop', 'mirror-frame', 'mirror-ui', 'uninstall',
  'ensure', 'stop', 'ble-status', 'ble-pair-window', 'ble-devices', 'ble-remove', 'ble-type', 'ble-key', 'ble-mouse',
  'ble-move', 'ble-tap', 'ble-swipe', 'ble-drag', 'ble-scroll', 'ble-open', 'ble-calibrate', 'rdp-probe',
  'screen-info', 'pointer-move', 'pointer-click', 'pointer-drag', 'keyboard-type', 'keyboard-key',
  'adb-pair', 'adb-connect', 'adb-connect-tv', 'adb-scan-tv',
  'adb-disconnect', 'adb-devices', 'adb-info', 'adb-tap', 'adb-swipe', 'adb-text', 'adb-key', 'adb-apps', 'adb-launch',
  'adb-ui', 'adb-frame', 'frame-chunk', 'stage-chunk', 'adb-install-apk',
  'adb-files', 'adb-push', 'adb-pull', 'adb-clipboard-get', 'adb-clipboard-set'
]);
export const BRIDGE_FILE_NAMES = Object.freeze([
  'oshal_phone_bridge.py', 'oshal_phone_ble.py', 'oshal_phone_mirror.py', 'oshal_phone_ops.py', 'oshal-phone-bridge'
]);
export const QUALITY_PRESETS = Object.freeze({
  high: Object.freeze({ width: 720, phoneMs: 450, computerMs: 900, label: 'High' }),
  balanced: Object.freeze({ width: 432, phoneMs: 700, computerMs: 1500, label: 'Balanced' }),
  low: Object.freeze({ width: 288, phoneMs: 2200, computerMs: 3000, label: 'Low' })
});
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;

// The installer runs on the computer with the system python3. It checks every file before it writes any.
const INSTALLER = [
  'import base64,gzip,hashlib,json,os,sys',
  'm=json.loads(base64.b64decode(sys.argv[1]))',
  'h=os.path.expanduser("~")',
  'd=os.path.join(h,".local","share","oshal-phone-bridge")',
  'b=os.path.join(h,".local","bin")',
  'os.makedirs(d,mode=0o700,exist_ok=True)',
  'os.makedirs(b,exist_ok=True)',
  'where={"oshal_phone_bridge.py":d,"oshal_phone_ble.py":d,"oshal_phone_mirror.py":d,"oshal_phone_ops.py":d,"oshal-phone-bridge":b}',
  'ready=[]',
  'for f in m["files"]:',
  '    n=f["name"]',
  '    if n not in where:',
  '        print(json.dumps({"ok":False,"error":"bad_file","message":"unexpected file "+n[:40]}));sys.exit(3)',
  '    data=gzip.decompress(base64.b64decode(f["gz"]))',
  '    if hashlib.sha256(data).hexdigest()!=f["sha256"]:',
  '        print(json.dumps({"ok":False,"error":"sha256_mismatch","message":n+" arrived damaged; nothing was replaced"}));sys.exit(3)',
  '    ready.append((n,data,int(f["mode"])))',
  'for n,data,mode in ready:',
  '    t=os.path.join(where[n],n)',
  '    open(t+".new","wb").write(data)',
  '    os.chmod(t+".new",mode)',
  '    os.replace(t+".new",t)',
  'print(json.dumps({"ok":True,"verb":"install","version":m["version"],"installed":[n for n,_,_ in ready]}))'
].join('\n');

/** @description Raw bytes as base64, in a browser or in node. Pure. @param {Uint8Array} bytes Bytes. @returns {string} Base64. */
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** @description UTF-8 text as base64, in a browser or in node. Pure. @param {string} text Text. @returns {string} Base64. */
export function toBase64(text) {
  return bytesToBase64(new TextEncoder().encode(String(text)));
}

/** @description Base64 to bytes. Pure. @param {string} text Base64. @returns {Uint8Array} Bytes. */
export function fromBase64(text) {
  if (typeof text !== 'string' || !BASE64.test(text)) throw new Error('The computer sent a picture part that is not base64.');
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @description Validate a plain file name for safe remote transfer. Pure. @param {string} raw Name. @returns {string} Safe name. */
export function safeFileName(raw) {
  const rawText = String(raw || '').trim();
  const cleaned = rawText.replace(/^.*[/\\]/, '');
  if (!SAFE_FILE.test(cleaned) || rawText.includes('..') || cleaned.includes('..')) {
    throw new Error('Use a plain file name with letters, numbers, spaces, dots, dashes or underscores.');
  }
  return cleaned;
}

/**
 * @description The one command that runs a bridge verb on the computer: a closed verb and one base64 argument. Pure.
 * @param {string} verb One of VERBS.
 * @param {object} [args] The verb's arguments.
 * @returns {string} The shell command.
 */
export function bridgeCommand(verb, args = {}) {
  if (!VERBS.includes(verb)) throw new Error(`phone-control has no bridge verb ${String(verb).slice(0, 40)}`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('bridge arguments are an object');
  return `python3 -I ${BRIDGE} ${verb} --b64 ${toBase64(JSON.stringify(args))}`;
}

/**
 * @description The command that installs the bridge files from the package's manifest. Pure.
 * @param {{version:string,files:Array<{name:string,sha256:string,mode:number,gz:string}>}} manifest From /bridge/manifest.json.
 * @returns {string} The shell command.
 */
export function installCommand(manifest) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const names = files.map((file) => file.name).sort();
  if (names.join() !== [...BRIDGE_FILE_NAMES].sort().join()) throw new Error('The bridge manifest names unexpected files.');
  for (const file of files) {
    if (!SHA256.test(file.sha256) || !BASE64.test(file.gz) || !Number.isInteger(file.mode)) throw new Error(`The bridge manifest entry ${file.name} is malformed.`);
  }
  const payload = { version: String(manifest.version), files: files.map(({ name, sha256, mode, gz }) => ({ name, sha256, mode, gz })) };
  return `python3 -I -c '${INSTALLER}' ${toBase64(JSON.stringify(payload))}`;
}

/**
 * @description The bridge's answer from what the computer sent back: its JSON line, or why there is none. Pure.
 * @param {{ok?:boolean,output?:{stdout?:string,stderr?:string,exitCode?:number},error?:string}} answer The /run answer.
 * @returns {object} The bridge reply, always with ok and, when not ok, error and message.
 */
export function parseReply(answer) {
  const output = answer?.output || {};
  const line = String(output.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  try {
    const reply = JSON.parse(line);
    if (reply && typeof reply === 'object') return { ...reply, exitCode: output.exitCode ?? null };
  } catch { /* not the bridge's line; described below */ }
  const stderr = String(output.stderr || '').trim();
  const missing = /No such file|can't open file/.test(stderr);
  return {
    ok: false, exitCode: output.exitCode ?? null,
    error: missing ? 'bridge_not_installed' : 'no_reply',
    message: missing ? 'phone-control is not set up on this computer yet. Press Set up this computer.'
      : (answer?.error || stderr.split('\n').pop() || 'The computer gave no answer from the bridge.').slice(0, 300)
  };
}

/** @description Whether the installed bridge is exactly the package's. Pure. @param {object} version The version reply. @param {object} manifest The manifest. @returns {boolean} True when every file matches. */
export function bridgeMatches(version, manifest) {
  if (!version?.ok || version.version !== manifest?.version) return false;
  return (manifest.files || []).every((file) => version.files?.[file.name] === file.sha256);
}

/**
 * @description A click on the picture as a point on the phone. Pure.
 * @param {{x:number,y:number}} point The click, relative to the picture's box.
 * @param {{width:number,height:number}} box The picture's box on the page.
 * @param {{deviceWidth:number,deviceHeight:number}} frame The phone's own size.
 * @returns {{x:number,y:number}} The phone's pixel.
 */
export function tapPoint(point, box, frame) {
  if (!(box?.width > 0 && box?.height > 0 && frame?.deviceWidth > 0 && frame?.deviceHeight > 0)) throw new Error('There is no picture to tap on yet.');
  const scale = Math.min(box.width / frame.deviceWidth, box.height / frame.deviceHeight);
  const drawW = frame.deviceWidth * scale;
  const drawH = frame.deviceHeight * scale;
  const offX = (box.width - drawW) / 2;
  const offY = (box.height - drawH) / 2;
  const clamp = (value, max) => Math.max(0, Math.min(max - 1, Math.round(value)));
  return {
    x: clamp(((point.x - offX) / drawW) * frame.deviceWidth, frame.deviceWidth),
    y: clamp(((point.y - offY) / drawH) * frame.deviceHeight, frame.deviceHeight)
  };
}

/**
 * @description Map a click inside an object-fit:contain computer image to screenshot or multi-monitor physical coordinates. Pure.
 * @param {{x:number,y:number}} point Local coordinates inside the img element.
 * @param {{width:number,height:number}} box Element box.
 * @param {{width:number,height:number}} natural Natural screenshot size.
 * @param {{originX?:number,originY?:number}|null} [monitor] Optional secondary monitor offset.
 * @returns {{x:number,y:number,coordinateSpace:string}} Target desktop coordinates.
 */
export function computerPoint(point, box, natural, monitor = null) {
  if (!(box?.width > 0 && box?.height > 0 && natural?.width > 0 && natural?.height > 0)) {
    throw new Error('There is no computer picture to click on yet.');
  }
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const drawW = natural.width * scale;
  const drawH = natural.height * scale;
  const offX = (box.width - drawW) / 2;
  const offY = (box.height - drawH) / 2;
  const clamp = (val, max) => Math.max(0, Math.min(max - 1, Math.round(val)));
  const sx = clamp(((point.x - offX) / drawW) * natural.width, natural.width);
  const sy = clamp(((point.y - offY) / drawH) * natural.height, natural.height);
  if (monitor && (Number.isFinite(monitor.originX) || Number.isFinite(monitor.originY))) {
    return { x: sx + (monitor.originX || 0), y: sy + (monitor.originY || 0), coordinateSpace: 'physical' };
  }
  return { x: sx, y: sy, coordinateSpace: 'screenshot' };
}

/** @description A drag on the picture as a swipe, or null for a tap. Pure. @param {object} start Point. @param {object} end Point. @param {object} box Box. @param {object} frame Frame. @param {number} ms Duration. @returns {object|null} Swipe. */
export function swipeFromDrag(start, end, box, frame, ms) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 12) return null;
  const a = tapPoint(start, box, frame);
  const b = tapPoint(end, box, frame);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ms: Math.max(80, Math.min(1500, Math.round(ms))) };
}

/**
 * @description Convert a click or drag on a mirrored iPhone image into normalized ble-tap or ble-swipe arguments. Pure.
 * @param {{x:number,y:number}} start Pointer-down point relative to img box.
 * @param {{x:number,y:number}} end Pointer-up point relative to img box.
 * @param {{width:number,height:number}} box Rendered img element box.
 * @param {{deviceWidth:number,deviceHeight:number}} frame Mirrored frame pixel dimensions.
 * @param {number} ms Drag duration in ms.
 * @returns {{verb:string,args:object,summary:string}} Normalized iOS BLE gesture.
 */
export function iosGestureFromDrag(start, end, box, frame, ms) {
  if (!(box?.width > 0 && box?.height > 0 && frame?.deviceWidth > 0 && frame?.deviceHeight > 0)) {
    throw new Error('Start mirroring first so there is an iPhone screen picture to tap or swipe.');
  }
  const scale = Math.min(box.width / frame.deviceWidth, box.height / frame.deviceHeight);
  const drawW = frame.deviceWidth * scale;
  const drawH = frame.deviceHeight * scale;
  const offX = (box.width - drawW) / 2;
  const offY = (box.height - drawH) / 2;
  const norm = (pt) => ({
    nx: Math.max(0, Math.min(1, Math.round((((pt.x - offX) / drawW)) * 1000) / 1000)),
    ny: Math.max(0, Math.min(1, Math.round((((pt.y - offY) / drawH)) * 1000) / 1000))
  });
  const landscape = frame.deviceWidth > frame.deviceHeight;
  const a = norm(start);
  const b = norm(end);
  const px = (n, dim) => Math.max(0, Math.min(dim - 1, Math.round(n * dim)));
  const x = px(b.nx, frame.deviceWidth);
  const y = px(b.ny, frame.deviceHeight);
  if (Math.hypot(end.x - start.x, end.y - start.y) >= 12) {
    const duration = Math.max(120, Math.min(1200, Math.round(ms || 260)));
    const x1 = px(a.nx, frame.deviceWidth);
    const y1 = px(a.ny, frame.deviceHeight);
    return {
      verb: 'ble-swipe',
      args: { nx1: a.nx, ny1: a.ny, nx2: b.nx, ny2: b.ny, ms: duration, landscape },
      pixel: { x1, y1, x2: x, y2: y, width: frame.deviceWidth, height: frame.deviceHeight },
      summary: `Swipe (${x1}, ${y1}) → (${x}, ${y})`
    };
  }
  return {
    verb: 'ble-tap',
    args: { nx: b.nx, ny: b.ny, landscape },
    pixel: { x, y, width: frame.deviceWidth, height: frame.deviceHeight },
    summary: `Tap at ${x}, ${y}`
  };
}

/** @description The hex sha256 of bytes. @param {Uint8Array} bytes Bytes. @returns {Promise<string>} Hex. */
export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * @description Read one picture of a phone or TV screen: the first part comes with the capture, the rest in parts, all checked.
 * @param {(verb:string,args:object)=>Promise<object>} send Runs one bridge verb and gives its reply.
 * @param {string} serial The phone serial (used by adb-frame).
 * @param {number} [width] Picture width.
 * @param {string} [verb] Frame verb ('adb-frame' or 'mirror-frame').
 * @returns {Promise<{bytes:Uint8Array,mime:string,deviceWidth:number,deviceHeight:number,slow:boolean,parts:number}>} The picture.
 */
export async function readFrame(send, serial, width = 432, verb = 'adb-frame') {
  const first = await send(verb, verb === 'mirror-frame' ? { width } : { serial, width });
  if (!first.ok) throw Object.assign(new Error(first.message || 'The phone sent no picture.'), { reply: first });
  const parts = [first.data];
  for (let index = 1; index < first.chunks; index += 1) {
    const part = await send('frame-chunk', { id: first.id, index });
    if (!part.ok) throw Object.assign(new Error(part.message || 'A part of the picture did not arrive.'), { reply: part });
    parts.push(part.data);
  }
  const bytes = fromBase64(parts.join(''));
  if (bytes.length !== first.bytes || await sha256Hex(bytes) !== first.sha256) throw new Error('The picture arrived damaged; the next one is on its way.');
  return { bytes, mime: first.mime, deviceWidth: first.deviceWidth, deviceHeight: first.deviceHeight, slow: Boolean(first.slow), parts: parts.length };
}

/**
 * @description One command at a time. A press goes before a waiting screen refresh, and only one refresh ever waits.
 * @returns {{press:(task:Function)=>Promise<any>,refresh:(task:Function)=>Promise<any>|null,idle:()=>boolean}} The queue.
 */
export function createQueue() {
  const waiting = [];
  let running = false;
  const pump = async () => {
    if (running || !waiting.length) return;
    running = true;
    const job = waiting.shift();
    try { job.resolve(await job.task()); } catch (error) { job.reject(error); }
    running = false;
    void pump();
  };
  const add = (task, kind) => new Promise((resolve, reject) => {
    const job = { task, kind, resolve, reject };
    if (kind === 'press') {
      const at = waiting.findIndex((item) => item.kind === 'refresh');
      if (at < 0) waiting.push(job); else waiting.splice(at, 0, job);
    } else waiting.push(job);
    void pump();
  });
  return {
    press: (task) => add(task, 'press'),
    refresh: (task) => (waiting.some((item) => item.kind === 'refresh') ? null : add(task, 'refresh')),
    idle: () => !running && !waiting.length
  };
}

/** @description What a refused kernel answer says. @param {Response} response The answer. @returns {Promise<string>} Words. */
async function refusalWords(response) {
  const body = await response.json().catch(() => ({}));
  if (typeof body.detail === 'string') return body.detail;
  if (typeof body.message === 'string') return body.message;
  if (typeof body.error === 'string') return body.error;
  return `Refused (HTTP ${response.status}).`;
}

/**
 * @description The person's own computers through the kernel: list, picture, desktop input, app launch and shell commands.
 * @param {{fetchImpl?:Function}} [options] fetch to use.
 * @returns {object} The client.
 */
export function createComputerClient({ fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  const call = async (path, init = {}) => {
    const response = await fetchImpl(path, { credentials: 'same-origin', cache: 'no-store', ...init });
    if (!response.ok) throw Object.assign(new Error(await refusalWords(response)), { status: response.status });
    return response;
  };
  return {
    async list() {
      const body = await (await call('/api/computers', { headers: { accept: 'application/json' } })).json();
      return Array.isArray(body.computers) ? body.computers : [];
    },
    async screen(id, etag) {
      return fetchImpl(`/api/computers/${encodeURIComponent(id)}/screen`, {
        credentials: 'same-origin', cache: 'no-store', headers: etag ? { 'if-none-match': etag } : {}
      });
    },
    async tool(id, tool, args = {}, limitMs = 30000) {
      const body = JSON.stringify({ tool, arguments: args, limit_ms: limitMs + 5000 });
      const response = await call(`/api/computers/${encodeURIComponent(id)}/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body
      });
      return response.json();
    },
    desktopControl(id, args) {
      return this.tool(id, 'desktop.control', args, 20000);
    },
    openApp(id, target) {
      return this.tool(id, 'app.open', { target }, 20000);
    },
    run(id, command, limitMs = 45000) {
      return this.tool(id, 'shell.exec', { command, timeout_ms: limitMs }, limitMs);
    },
    async bridge(id, verb, args = {}, limitMs = 45000) {
      return parseReply(await this.run(id, bridgeCommand(verb, args), limitMs));
    },
    async install(id, manifest) {
      return parseReply(await this.run(id, installCommand(manifest), 60000));
    }
  };
}

/**
 * @description This package's own records: phones, history, bridge reports, manifest, and session artifacts.
 * @param {{fetchImpl?:Function}} [options] fetch to use.
 * @returns {object} The client.
 */
export function createPackageClient({ fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  const base = '/api/phone-control';
  const call = async (path, method = 'GET', body) => {
    const init = { method, credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } };
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const response = await fetchImpl(base + path, init);
    if (!response.ok) throw Object.assign(new Error(await refusalWords(response)), { status: response.status });
    return response.status === 204 ? null : response.json();
  };
  const q = (key) => `?target=${encodeURIComponent(key)}`;
  return {
    phones: async () => (await call('/devices')).devices,
    phone: (id) => call(`/devices/${encodeURIComponent(id)}`),
    savePhone: (input) => call('/devices', 'POST', input),
    updatePhone: (id, changes) => call(`/devices/${encodeURIComponent(id)}`, 'POST', changes),
    removePhone: (id) => call(`/devices/${encodeURIComponent(id)}`, 'DELETE'),
    commandPlan: (id, payload) => call(`/devices/${encodeURIComponent(id)}/command-plan`, 'POST', payload),
    rdpCommandPlan: (payload) => call('/rdp/command-plan', 'POST', payload),
    history: async (deviceId) => (await call(`/history${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''}`)).history,
    record: (event) => call('/history', 'POST', event),
    reports: async () => (await call('/computers/reports')).reports,
    report: (node, report) => call(`/computers/${encodeURIComponent(node)}/report`, 'POST', { report }),
    manifest: () => call('/bridge/manifest.json'),
    conciergeTurn: (payload) => call('/concierge/turn', 'POST', payload),
    preferences: async (targetKey) => {
      const list = (await call(`/sessions/preferences${q(targetKey)}`)).preferences;
      return Array.isArray(list) ? (list[0] || {}) : (list || {});
    },
    savePreferences: async (input) => (await call('/sessions/preferences', 'POST', input)).preference,
    chat: async (targetKey) => (await call(`/sessions/chat${q(targetKey)}`)).messages,
    sendChat: async (input) => (await call('/sessions/chat', 'POST', input)).message,
    clearChat: (targetKey) => call(`/sessions/chat${q(targetKey)}`, 'DELETE'),
    whiteboard: async (targetKey) => {
      const res = await call(`/sessions/whiteboard${q(targetKey)}`);
      return { strokes: res.strokes || res.whiteboard?.strokes || [] };
    },
    saveWhiteboard: async (input) => call('/sessions/whiteboard', 'POST', input),
    clearWhiteboard: (targetKey) => call(`/sessions/whiteboard${q(targetKey)}`, 'DELETE'),
    captures: async (targetKey) => (await call(`/sessions/captures${targetKey ? q(targetKey) : ''}`)).captures,
    saveCapture: async (input) => (await call('/sessions/captures', 'POST', input)).capture,
    captureUrl: (id) => `${base}/sessions/captures/${encodeURIComponent(id)}`,
    deleteCapture: (id) => call(`/sessions/captures/${encodeURIComponent(id)}`, 'DELETE'),
    transfers: async (targetKey) => (await call(`/sessions/transfers${targetKey ? q(targetKey) : ''}`)).transfers,
    saveTransfer: async (input) => (await call('/sessions/transfers', 'POST', input)).transfer,
    transferUrl: (id) => `${base}/sessions/transfers/${encodeURIComponent(id)}`,
    deleteTransfer: (id) => call(`/sessions/transfers/${encodeURIComponent(id)}`, 'DELETE')
  };
}

/**
 * @description Live kernel RDP sessions (/api/rdp/sessions): list, connect, PNG frame stream, unified input, and disconnect.
 * @param {{fetchImpl?:Function}} [options] fetch to use.
 * @returns {object} The RDP client.
 */
export function createRdpClient({ fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  const call = async (path, init = {}) => {
    const response = await fetchImpl(`/api/rdp/sessions${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
    if (!response.ok) throw Object.assign(new Error(await refusalWords(response)), { status: response.status });
    return response;
  };
  return {
    async list() {
      const response = await fetchImpl('/api/rdp/sessions', {
        credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }
      });
      if (!response.ok && [404, 501, 502, 503].includes(response.status)) return [];
      if (!response.ok) throw Object.assign(new Error(await refusalWords(response)), { status: response.status });
      const body = await response.json();
      const raw = Array.isArray(body?.sessions) ? body.sessions : Array.isArray(body) ? body : [];
      return raw.map((s) => ({ ...s, sessionId: s.sessionId || s.id }));
    },
    async create(input) {
      const body = await (await call('', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(input)
      })).json();
      const s = body?.session && typeof body.session === 'object' ? body.session : body;
      return { ...s, sessionId: s.sessionId || s.id };
    },
    async frame(id) {
      const response = await call(`/${encodeURIComponent(id)}/frame`, { headers: { accept: 'image/png,image/*,*/*' } });
      return {
        blob: await response.blob(),
        width: Number(response.headers.get('x-rdp-width')) || 1280,
        height: Number(response.headers.get('x-rdp-height')) || 800
      };
    },
    async input(id, payload) {
      return (await call(`/${encodeURIComponent(id)}/input`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload)
      })).json();
    },
    async disconnect(id) {
      const response = await call(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return response.status === 204 ? { ok: true } : response.json().catch(() => ({ ok: true }));
    }
  };
}

/** @description The kernel's own page for one computer (Jarvis on it, its screen, a command line). Pure. @param {string} id Computer. @returns {string} The path. */
export function workHref(id) {
  return `/cockpit/tools/computer.html?id=${encodeURIComponent(String(id))}`;
}

/**
 * @description How a computer stands, in words, and what to do on it when it cannot take commands. Pure.
 * @param {object} computer From /api/computers.
 * @returns {{text:string,tone:string,usable:boolean,fix:string}} Standing.
 */
export function computerStanding(computer) {
  const name = computer?.name || 'That computer';
  if (!computer?.connected) {
    return { text: 'Not connected', tone: 'tone-warn', usable: false,
      fix: `${name} is not connected. On it, open oshal Node and sign in; this list shows it as Connected within a few seconds.` };
  }
  if (!computer.can_control) {
    return { text: 'Connected, control is off on that computer', tone: 'tone-warn', usable: false,
      fix: `Control is off on ${name}. In oshal Node on it, press ⚙ Settings and tick Let Jarvis control this computer.` };
  }
  if (!computer.tools?.includes('shell.exec')) {
    return { text: 'Connected, but it does not take commands', tone: 'tone-warn', usable: false,
      fix: `${name} does not take commands. Update oshal Node on it from the Devices page, then sign in again.` };
  }
  return { text: computer.busy ? 'Connected, busy' : 'Connected', tone: 'tone-ok', usable: true, fix: '' };
}

/**
 * @description Whether direct desktop pointer/keyboard control is advertised by this computer node. Pure.
 * @param {object} computer From /api/computers.
 * @returns {{ok:boolean,text:string}} Whether desktop.control can run.
 */
export function desktopControlSupport(computer) {
  const standing = computerStanding(computer);
  if (!computer?.connected || !computer?.can_control) return { ok: false, text: standing.fix || standing.text };
  if (!computer.tools?.includes('desktop.control')) {
    return {
      ok: false,
      text: `${computer.name || 'That computer'} does not advertise desktop.control. Update oshal Node or grant Accessibility / X11 input access on it.`
    };
  }
  return { ok: true, text: '' };
}

/**
 * @description Whether the phone bridge can run on this computer. Pure.
 * @param {object} computer From /api/computers.
 * @returns {{ok:boolean,text:string}} Whether, and the words when not.
 */
export function bridgeSupport(computer) {
  const platform = String(computer?.platform || '').toLowerCase();
  if (!platform || platform === 'linux') return { ok: true, text: '' };
  const label = platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS' : platform;
  return { ok: false, text: `${computer?.name || 'This computer'} runs ${label}. The phone bridge runs on a Linux computer only for now: `
    + 'it gets Android and AirPlay tools with apt, and the iPhone keyboard needs Linux Bluetooth (BlueZ). Use a Linux computer on the same '
    + `Wi-Fi as the phone or TV, with oshal Node signed in and control allowed. ${label} still shows its own screen under Devices.` };
}

/** @description Whether a phone is reachable now, from its computer's last bridge report. Pure. @param {object} phone A phone. @param {object|null} report The report. @returns {boolean} Reachable. */
export function phoneReachable(phone, report) {
  if (!phone || !report) return false;
  if (phone.platform === 'android') return Boolean(report.adb?.devices?.some((d) => d.serial === phone.address && d.state === 'device'));
  return Boolean(report.ble?.phones?.some((p) => p.address === phone.address && p.connected) || report.mirror?.hasFrame);
}
