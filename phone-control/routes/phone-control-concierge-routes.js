/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: specialized Phone & Connection Concierge turn planner (/api/phone-control/concierge/turn) bound to device-concierge (f518c3e9-92a4-47d6-85c1-d827a93c1058) with closed phone primitives (read_screen, open_app, tap, drag_icon, swipe, type, key), Home Screen app organization planning, and Fire TV / ADB / Bluetooth / AirPlay connection diagnostics.
 */

'use strict';

let createRouter;
try {
  createRouter = require('express').Router;
} catch {
  createRouter = require('../lib/router.js').createRouter;
}

const DEVICE_CONCIERGE_AGENT = 'f518c3e9-92a4-47d6-85c1-d827a93c1058';
const PHONE_KINDS = new Set(['read_screen', 'calibrate_pointer', 'open_app', 'move', 'tap', 'drag_icon', 'swipe', 'type', 'key']);
const SWIPE_DIRS = new Set(['left', 'right', 'up', 'down']);
const ALLOWED_KEYS = new Set([
  'Home', 'Spotlight', 'Back', 'Recents', 'Enter', 'Select', 'Menu', 'PlayPause',
  'Escape', 'Backspace', 'Tab', 'Up', 'Down', 'Left', 'Right', 'VolumeUp', 'VolumeDown'
]);
const CONNECT_KINDS = Object.freeze({
  scan_tvs: 'Find TVs on Wi-Fi',
  connect_tv: 'Connect TV',
  push_tv_apk: 'Push & open oshal TV app',
  pair_tv_ble: 'Pair Fire TV over Bluetooth',
  open_ble_window: 'Open iPhone pairing window',
  connect_rdp: 'Connect in console',
  probe_rdp: 'Check RDP port',
  setup_adb: 'Set up Android tools',
  setup_mirror: 'Set up AirPlay mirroring',
  check_computer: 'Check computer status'
});

const APP_CATEGORIES = Object.freeze([
  { name: 'Work & Notes', match: /note|remind|calendar|mail|clock|files|safari|chrome|docs|slack|teams|calc/i },
  { name: 'Messages & Social', match: /message|phone|facetime|contact|whatsapp|telegram|discord|signal|social/i },
  { name: 'Media & Photos', match: /photo|camera|music|podcast|tv|youtube|spotify|video|news|books/i },
  { name: 'Utilities', match: /setting|map|weather|wallet|health|watch|find|home|app store|store|translate/i }
]);

const PHONE_CONCIERGE_CONTRACT = [
  'You are the specialized Phone Concierge inside oshal Phone & Device Control.',
  'You operate ONLY on the connected phone or TV through its closed mobile action list — NEVER mention or use desktop computer screen/mouse tools.',
  'Always prefer open_app (Spotlight on iPhone, package launch on Android) to launch an app instead of hunting pages, UNLESS the user asks to organize Home Screen apps or tap something visible.',
  'For "Organize my applications" / "Organize my apps": first go Home and read_screen if screen items are empty; then group visible app labels by category, emit drag_icon moves using each item\'s iconNy (icon center above label) onto a peer icon\'s (nx, iconNy) to create tidy folders, and end with key "Home" to exit jiggle mode.',
  'Reply with ONLY a single JSON object: {"reply":"concise plain-English status","done":true|false,"actions":[...]} where each action is one of:',
  '{"kind":"read_screen"}, {"kind":"calibrate_pointer"}, {"kind":"open_app","name":"Notes"},',
  '{"kind":"move","nx":0.5,"ny":0.4,"label":"..."}, {"kind":"tap","nx":0.5,"ny":0.4,"label":"..."},',
  '{"kind":"drag_icon","nx1":0.2,"ny1":0.3,"nx2":0.5,"ny2":0.3,"label":"Group Reminders with Notes"},',
  '{"kind":"swipe","direction":"left"|"right"|"up"|"down"}, {"kind":"type","text":"...","enter":false},',
  '{"kind":"key","key":"Home"|"Spotlight"|"Back"|"Recents"|"Enter"|"Select"|"Menu"|"PlayPause"|"Escape"|"Backspace"|"Tab"|"Up"|"Down"|"Left"|"Right"|"VolumeUp"|"VolumeDown"}.'
].join('\n');

const CONNECT_CONCIERGE_CONTRACT = [
  'You are the specialized Connection Concierge inside oshal Phone & Device Control.',
  'Diagnose the exact computer, Android Wireless Debugging, Fire TV / Android TV (Bluetooth OSHAL-KB peripheral without Developer Options OR Wi-Fi ADB + APK push), iPhone Bluetooth (OSHAL-KB + AssistiveTouch + ble-calibrate) + AirPlay (UxPlay), or RDP (:3389 on Windows, Linux grdctl/xrdp, macOS FreeRDP) issue in plain English.',
  'Reply with ONLY a single JSON object: {"reply":"concise plain-English fix steps","done":true,"actions":[{"kind":"scan_tvs"|"connect_tv"|"push_tv_apk"|"pair_tv_ble"|"open_ble_window"|"probe_rdp"|"setup_adb"|"setup_mirror"|"check_computer","label":"Button label"}]}.'
].join('\n');

function clamp01(value, fallback = 0.5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0.02, Math.min(0.98, Math.round(num * 1000) / 1000));
}

function sanitizePhoneAction(raw) {
  if (!raw || typeof raw !== 'object' || !PHONE_KINDS.has(raw.kind)) return null;
  if (raw.kind === 'read_screen' || raw.kind === 'calibrate_pointer') return { kind: raw.kind };
  if (raw.kind === 'open_app') {
    const name = String(raw.name || '').trim().slice(0, 80);
    return name ? { kind: 'open_app', name } : null;
  }
  if (raw.kind === 'tap' || raw.kind === 'move') {
    const out = { kind: raw.kind, nx: clamp01(raw.nx), ny: clamp01(raw.ny), label: String(raw.label || (raw.kind === 'move' ? 'Move pointer' : 'Tap')).slice(0, 80) };
    if (Number.isFinite(Number(raw.x)) && Number.isFinite(Number(raw.y))) { out.x = Math.round(Number(raw.x)); out.y = Math.round(Number(raw.y)); }
    return out;
  }
  if (raw.kind === 'drag_icon') {
    return {
      kind: 'drag_icon', nx1: clamp01(raw.nx1, 0.25), ny1: clamp01(raw.ny1, 0.35),
      nx2: clamp01(raw.nx2, 0.5), ny2: clamp01(raw.ny2, 0.35),
      label: String(raw.label || 'Move app icon').slice(0, 90)
    };
  }
  if (raw.kind === 'swipe') {
    const direction = String(raw.direction || '').toLowerCase();
    return SWIPE_DIRS.has(direction) ? { kind: 'swipe', direction } : null;
  }
  if (raw.kind === 'type') {
    const text = String(raw.text || '').slice(0, 240);
    return text ? { kind: 'type', text, enter: Boolean(raw.enter) } : null;
  }
  const key = String(raw.key || '').trim();
  return ALLOWED_KEYS.has(key) ? { kind: 'key', key } : null;
}

function sanitizeConnectAction(raw) {
  const kind = String(raw?.kind || '').trim();
  if (!Object.prototype.hasOwnProperty.call(CONNECT_KINDS, kind)) return null;
  return { kind, label: String(raw?.label || CONNECT_KINDS[kind]).trim().slice(0, 60) };
}

function parseStructuredReply(text, sanitizer) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!candidate.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) return null;
    const actions = (Array.isArray(parsed.actions) ? parsed.actions : []).map(sanitizer).filter(Boolean).slice(0, 6);
    return { reply: parsed.reply.trim().slice(0, 900), done: parsed.done !== false, actions };
  } catch {
    return null;
  }
}

function filterAppIcons(items) {
  const statusNoise = /^(\d{1,2}:\d{2}|5g|lte|wi-?fi|\d+%|search|q|w|e|r|t|y)$/i;
  return items.filter((item) => {
    const text = String(item?.text || '').trim();
    const ny = Number(item?.ny ?? 0.5);
    return text.length >= 2 && text.length <= 24 && !statusNoise.test(text) && ny > 0.08 && ny < 0.88;
  });
}

function planOrganizeTurn(items, round) {
  if (!items.length && round === 0) {
    return {
      reply: 'Going to the Home Screen and reading your visible app labels so I can group them cleanly.',
      done: false,
      actions: [{ kind: 'key', key: 'Home' }, { kind: 'read_screen' }]
    };
  }
  const apps = filterAppIcons(items);
  if (apps.length < 2 && round === 1) {
    return {
      reply: 'Checking the next Home Screen page for app icons to group.',
      done: false,
      actions: [{ kind: 'swipe', direction: 'left' }, { kind: 'read_screen' }]
    };
  }
  const buckets = new Map();
  for (const app of apps) {
    const cat = APP_CATEGORIES.find((entry) => entry.match.test(app.text))?.name || 'Everyday Apps';
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat).push(app);
  }
  const actions = [];
  const summaryParts = [];
  for (const [cat, list] of buckets.entries()) {
    summaryParts.push(`${cat}: ${list.map((a) => a.text).join(', ')}`);
    if (list.length >= 2 && actions.length < 3) {
      const anchor = list[0];
      const mover = list[1];
      actions.push({
        kind: 'drag_icon',
        nx1: clamp01(mover.nx), ny1: clamp01(mover.iconNy ?? mover.ny),
        nx2: clamp01(anchor.nx), ny2: clamp01(anchor.iconNy ?? anchor.ny),
        label: `Group ${mover.text} with ${anchor.text} (${cat})`
      });
    }
  }
  if (actions.length) actions.push({ kind: 'key', key: 'Home' });
  const groupedText = summaryParts.length
    ? `Grouped ${apps.length} visible apps (${summaryParts.join(' · ')}).`
    : 'Read the screen, and fewer than two moveable Home Screen app labels were visible to group.';
  return { reply: groupedText, done: true, actions };
}

function planTapTurn(label, items, round) {
  const needle = label.trim().toLowerCase();
  const hit = items.find((item) => String(item.text || '').toLowerCase().includes(needle));
  if (hit) {
    return {
      reply: `Tapping "${hit.text}".`, done: true,
      actions: [sanitizePhoneAction({ kind: 'tap', nx: hit.nx, ny: hit.ny, x: hit.x, y: hit.y, label: hit.text })]
    };
  }
  if (round === 0 && !items.length) {
    return { reply: `Reading the phone screen to locate "${label}".`, done: false, actions: [{ kind: 'read_screen' }] };
  }
  return { reply: `Could not find "${label}" on the current phone screen.`, done: true, actions: [] };
}

const DIRECT_KEY_MAP = Object.freeze({
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  select: 'Select', ok: 'Select', menu: 'Menu', 'play/pause': 'PlayPause', play: 'PlayPause', pause: 'PlayPause',
  back: 'Back', enter: 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab'
});

function planDirectInputTurn(prompt, lower, screen) {
  if (/calibrat|drift|off[- ]?target|miss(?:ing)?\s+tap|learn\s+pointer|pointer\s+scale/i.test(lower)) {
    return {
      reply: 'Calibrating the Bluetooth pointer against your live mirrored screen and saving its learned gain profile.',
      done: true, actions: [{ kind: 'calibrate_pointer' }]
    };
  }
  const coord = /^(?:(move)(?:\s+pointer)?(?:\s+to)?|(click|tap)(?:\s+at)?)\s*\(?\s*(\d{1,4})\s*[,x ]\s*(\d{1,4})\s*\)?$/i.exec(prompt);
  if (coord) {
    const kind = coord[1] ? 'move' : 'tap';
    const x = Number(coord[3]);
    const y = Number(coord[4]);
    const w = Math.max(1, Number(screen?.width || 430));
    const h = Math.max(1, Number(screen?.height || 932));
    const label = `${kind === 'move' ? 'Move' : 'Click'} (${x}, ${y})`;
    return {
      reply: `${kind === 'move' ? 'Moving pointer to' : 'Clicking'} (${x}, ${y}).`,
      done: true, actions: [sanitizePhoneAction({ kind, x, y, nx: x / w, ny: y / h, label })]
    };
  }
  const keyHit = /^(?:press\s+)?(up|down|left|right|select|ok|menu|play\/pause|play|pause|back|enter|escape|esc|tab)$/i.exec(prompt);
  if (keyHit) {
    const mapped = DIRECT_KEY_MAP[keyHit[1].toLowerCase()];
    return { reply: `Sending ${mapped}.`, done: true, actions: [{ kind: 'key', key: mapped }] };
  }
  return null;
}

function planPhoneTurn(body) {
  const prompt = String(body?.prompt || '').trim();
  const lower = prompt.toLowerCase();
  const round = Math.max(0, Math.min(5, Number(body?.round || 0)));
  const items = Array.isArray(body?.screen?.items) ? body.screen.items.slice(0, 80) : [];
  const isRdp = body?.device?.form === 'rdp' || body?.device?.platform === 'rdp';
  const isTv = body?.device?.form === 'tv';
  const noun = isRdp ? 'RDP desktop' : isTv ? 'TV' : 'phone';
  const direct = planDirectInputTurn(prompt, lower, body?.screen);
  if (direct) return direct;
  if (/organi[sz]e|folder|tidy|arrange|clean\s*up.*app/i.test(lower)) {
    return (isTv || isRdp)
      ? { reply: `Ask me to open an app, click a label, or send keyboard keys on your ${noun}.`, done: true, actions: [] }
      : planOrganizeTurn(items, round);
  }
  if (/what.*on.*screen|read.*screen|describe.*screen|on (my )?screen/i.test(lower)) {
    if (!items.length && round === 0) return { reply: `Reading the current ${noun} screen now.`, done: false, actions: [{ kind: 'read_screen' }] };
    const labels = items.slice(0, 18).map((i) => i.text).filter(Boolean);
    return { reply: labels.length ? `On screen right now: ${labels.join(', ')}.` : `No readable labels were detected on the current ${noun} frame.`, done: true, actions: [] };
  }
  if (/^(go\s+)?home\b|home\s+screen/i.test(lower)) return { reply: 'Returning to the Home Screen.', done: true, actions: [{ kind: 'key', key: 'Home' }] };
  const openMatch = /^(?:please\s+)?(?:open|launch|start)\s+(.+)$/i.exec(prompt);
  if (openMatch) {
    const name = openMatch[1].replace(/[.!?]+$/, '').trim().slice(0, 60);
    return { reply: `Opening ${name} on your ${noun}.`, done: true, actions: [{ kind: 'open_app', name }] };
  }
  if (/swipe\s+left|next\s+page/i.test(lower)) return { reply: 'Swiping to the next page.', done: true, actions: [{ kind: 'swipe', direction: 'left' }] };
  if (/swipe\s+right|previous\s+page/i.test(lower)) return { reply: 'Swiping back a page.', done: true, actions: [{ kind: 'swipe', direction: 'right' }] };
  if (/swipe\s+up|scroll\s+down/i.test(lower)) return { reply: 'Scrolling down.', done: true, actions: [{ kind: 'swipe', direction: 'up' }] };
  if (/swipe\s+down|scroll\s+up/i.test(lower)) return { reply: 'Scrolling up.', done: true, actions: [{ kind: 'swipe', direction: 'down' }] };
  const typeMatch = /^type\s+["']?(.+?)["']?$/i.exec(prompt);
  if (typeMatch) return { reply: `Typing "${typeMatch[1]}" on the ${noun}.`, done: true, actions: [{ kind: 'type', text: typeMatch[1], enter: false }] };
  const tapMatch = /^(?:tap|press|click|select)\s+["']?(.+?)["']?$/i.exec(prompt);
  if (tapMatch) return planTapTurn(tapMatch[1], items, round);
  if (!items.length && round === 0) return { reply: `Reading your ${noun} screen first so I can act accurately.`, done: false, actions: [{ kind: 'read_screen' }] };
  return {
    reply: items.length
      ? `I see ${items.slice(0, 10).map((i) => i.text).join(', ')}. Ask me to open an app, ${isTv ? 'control playback, or send D-Pad keys' : 'tap a label, swipe pages, or organize your apps'}.`
      : (isTv
        ? 'Tell me an app to open (for example "Open YouTube" or "Open oshal TV"), ask "What\'s on screen?", or say "Play/Pause".'
        : 'Tell me an app to open (for example "Open Notes"), ask "What\'s on my screen?", or tap "Organize my apps".'),
    done: true, actions: []
  };
}

function planTvConnectTurn(combined, ctx) {
  if (/unauthorized|allow usb debugging/i.test(combined)) {
    return {
      reply: 'Your Fire TV or Android device is showing an "Allow USB debugging?" prompt on its screen right now. Use the TV remote to tick "Always allow from this computer" and press OK, then retry pushing the oshal TV app.',
      done: true,
      actions: [{ kind: 'connect_tv', label: 'Reconnect TV' }, { kind: 'push_tv_apk', label: 'Retry push & open oshal TV app' }]
    };
  }
  if (/fire\s*(?:tv|stick)|android\s*tv/i.test(combined) && /bluetooth|ble|oshal-kb|keyboard|mouse|physical\s+remote|phone\s+remote/i.test(combined)) {
    return {
      reply: 'Fire OS requires a physical hardware remote to pair Bluetooth devices (Settings → Controllers & Bluetooth Devices → Other Bluetooth Devices → Add Bluetooth Devices → OSHAL-KB). If you use the Fire TV phone remote app without a physical remote, skip Bluetooth: enter your Fire Stick IP above and press Load oshal TV.',
      done: true,
      actions: [{ kind: 'scan_tvs', label: 'Find TVs on Wi-Fi' }, { kind: 'pair_tv_ble', label: 'Pair Bluetooth (needs physical remote)' }]
    };
  }
  if (/connect_failed|refused|offline|5555|no route|timed? ?out/i.test(combined) && /tv|fire|adb|5555/i.test(combined)) {
    return {
      reply: 'Port 5555 did not answer on that TV. Using your remote or the Fire TV phone remote app, open Settings → My Fire TV → About → tap Fire TV Stick 7 times → Back → Developer Options → turn ADB Debugging ON (check IP Address under About → Network), then press Find TVs on Wi-Fi and Load oshal TV.',
      done: true,
      actions: [{ kind: 'scan_tvs', label: 'Find TVs on Wi-Fi' }, { kind: 'connect_tv', label: 'Load oshal TV' }]
    };
  }
  if (/no_tv_apk|apk/i.test(combined) && ctx.downloadsAvailable === false) {
    return {
      reply: 'No signed Fire TV .apk is staged in this server\'s device downloads folder yet. You can still connect the Fire Stick over Wi-Fi right now for live TV remote control and app launching, or use Copy push script once the .apk is placed in device downloads.',
      done: true,
      actions: [{ kind: 'scan_tvs', label: 'Find TVs on Wi-Fi' }, { kind: 'connect_tv', label: 'Connect TV remote now' }]
    };
  }
  return null;
}

function planConnectTurn(body) {
  const ctx = body?.context && typeof body.context === 'object' ? body.context : {};
  const combined = `${body?.prompt || ''} ${ctx.lastErrorCode || ''} ${ctx.lastErrorMessage || ''} ${ctx.step || ''}`;
  if (/\brdp\b|3389|remote desktop|xrdp|grdctl|freerdp/i.test(combined)) {
    return {
      reply: 'To connect over RDP (:3389), run the setup script for Windows (PowerShell Admin), Linux (grdctl or xrdp), or macOS (FreeRDP shadow) on the target host, enter its IP, username and password, and press Connect in console (or Check RDP port to verify the X.224 handshake).',
      done: true,
      actions: [{ kind: 'connect_rdp', label: 'Connect in console' }, ...(ctx.selectedComputer ? [{ kind: 'probe_rdp', label: 'Check RDP port' }] : [])]
    };
  }
  if (!ctx.selectedComputer) {
    return {
      reply: 'Pick a Linux computer running oshal Node with "Let Jarvis control this computer" turned on under Your computers first — phones and Fire Sticks connect through that computer on your Wi-Fi.',
      done: true, actions: []
    };
  }
  const tvPlan = planTvConnectTurn(combined, ctx);
  if (tvPlan) return tvPlan;
  if (/iphone|ble|bluetooth|oshal-kb|assistive|calibrat/i.test(combined)) {
    return {
      reply: 'For iPhone control, this Linux computer advertises as the Bluetooth keyboard & pointer peripheral OSHAL-KB. Open the 2-minute pairing window, tap OSHAL-KB on your iPhone under Settings → Bluetooth → Other Devices, turn on Settings → Accessibility → Touch → AssistiveTouch, and run Calibrate pointer once mirroring is live so tap scale matches your iPhone.',
      done: true,
      actions: [{ kind: 'open_ble_window', label: 'Open 2-minute iPhone pairing window' }, { kind: 'setup_mirror', label: 'Set up AirPlay mirroring' }]
    };
  }
  return {
    reply: 'For a Fire Stick (using your remote or the Fire TV phone remote app): 1) open Settings → My Fire TV → About → tap Fire TV Stick 7 times → Back → Developer Options → turn ADB Debugging ON, 2) press Find TVs on Wi-Fi or enter its IP, and 3) press Load oshal TV and tap Allow USB debugging on the TV.',
    done: true,
    actions: [
      { kind: 'scan_tvs', label: 'Find TVs on Wi-Fi' },
      { kind: 'connect_tv', label: 'Load oshal TV' },
      { kind: 'check_computer', label: 'Check computer status' }
    ]
  };
}

function buildTurnRequestText(mode, body) {
  if (mode === 'connect') {
    const safeCtx = {
      step: String(body?.context?.step || '').slice(0, 60),
      selectedComputer: body?.context?.selectedComputer || null,
      lastErrorCode: String(body?.context?.lastErrorCode || '').slice(0, 80),
      lastErrorMessage: String(body?.context?.lastErrorMessage || '').slice(0, 300),
      tvAddress: String(body?.context?.tvAddress || '').slice(0, 80),
      discoveredTvs: Array.isArray(body?.context?.discoveredTvs) ? body.context.discoveredTvs.slice(0, 12) : [],
      downloadsAvailable: body?.context?.downloadsAvailable ?? null
    };
    return `Operator question: ${String(body?.prompt || 'Help me finish connecting this device.').slice(0, 600)}\nConnection context: ${JSON.stringify(safeCtx)}`;
  }
  const items = (Array.isArray(body?.screen?.items) ? body.screen.items : []).slice(0, 60).map((item) => ({
    text: String(item.text || '').slice(0, 40),
    nx: clamp01(item.nx), ny: clamp01(item.ny), iconNy: clamp01(item.iconNy ?? item.ny)
  }));
  const state = {
    round: Math.max(0, Math.min(5, Number(body?.round || 0))),
    device: {
      name: String(body?.device?.name || 'Phone').slice(0, 60),
      platform: String(body?.device?.platform || 'ios').slice(0, 16),
      form: String(body?.device?.form || 'phone').slice(0, 16),
      mirrorRunning: Boolean(body?.device?.mirrorRunning)
    },
    screenItems: items,
    recentSteps: (Array.isArray(body?.history) ? body.history : []).slice(-6)
  };
  return `User request: ${String(body?.prompt || '').slice(0, 600)}\nPhone state: ${JSON.stringify(state)}`;
}

async function runConciergeTurn(ctx, body) {
  const mode = body?.mode === 'connect' ? 'connect' : 'phone';
  const prompt = String(body?.prompt || '').trim();
  if (mode === 'phone' && !prompt) {
    return { status: 400, payload: { error: 'missing_prompt', message: 'Type a phone task or choose one of the quick task buttons.' } };
  }
  const fallback = mode === 'connect' ? planConnectTurn(body) : planPhoneTurn(body);
  if (typeof ctx?.orchestrator?.processMessage === 'function') {
    try {
      const turnText = buildTurnRequestText(mode, body);
      const contract = mode === 'connect' ? CONNECT_CONCIERGE_CONTRACT : PHONE_CONCIERGE_CONTRACT;
      const answer = await ctx.orchestrator.processMessage('phone-concierge-turn', turnText, {
        agentId: DEVICE_CONCIERGE_AGENT,
        maxOutputTokens: 900,
        systemPromptOverride: contract
      });
      const parsed = parseStructuredReply(answer?.response, mode === 'connect' ? sanitizeConnectAction : sanitizePhoneAction);
      if (parsed) return { status: 200, payload: { ok: true, mode, source: 'ai', ...parsed } };
    } catch {
      /* Hosted inference unavailable or offline: deterministic specialist planner handles the turn cleanly */
    }
  }
  return { status: 200, payload: { ok: true, mode, source: 'planner', ...fallback } };
}

function createPhoneControlConciergeRoutes(ctx) {
  const router = createRouter();
  router.post('/turn', (req, res, next) => {
    Promise.resolve(runConciergeTurn(ctx, req.body || {}))
      .then(({ status, payload }) => res.status(status).json(payload))
      .catch(next);
  });
  return router;
}

module.exports = {
  DEVICE_CONCIERGE_AGENT,
  createPhoneControlConciergeRoutes,
  planPhoneTurn,
  planConnectTurn,
  parseStructuredReply
};
