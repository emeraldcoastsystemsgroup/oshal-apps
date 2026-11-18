/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: dedicated Phone Concierge & Connection Concierge client controller — direct iPhone click-to-tap (ble-tap), drag-to-swipe (ble-swipe), wheel-to-scroll (ble-scroll), AssistiveTouch 1-click helper, mobile task chips (Organize my apps, What's on my screen?, Open Notes, Go Home), bounded 5-round anti-loop execution over closed phone primitives, and Connection sheet troubleshooting with 1-click fixes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: AI Office-aligned bottom-pinned Jarvis composer (Enter-to-send / Shift+Enter-newline, + screen context attachment, speaker read-aloud toggle, Screenshot chip), live iOS stage touchpad tap/swipe/scroll before AirPlay frames arrive, Re-center pointer via ble-sync, direct computer keyboard navigation on TV sessions, and fast post-action frame wakeups.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2: support mouse-wheel scrolling across desktop computers, Swarm-enrolled Android nodes, RDP sessions, and phones, and normalize WheelEvent.deltaY across line/page deltaMode so Linux/Firefox wheel ticks scroll reliably.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: pass com.oshal.remote and serverUrl in installSessionCompanionApk for zero-touch companion launch.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: support register_device Concierge actions and DPAD_UP/DPAD_DOWN/DPAD_LEFT/DPAD_RIGHT/DPAD_CENTER key aliases in ANDROID_KEY_MAP.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (T83): the oshal Companion app is told to sign in to the page's own origin (installationOrigin); the fixed installation address it fell back to is gone.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.20.3 (Roger, 2026-11-16/17: one concierge chat window everywhere): mount /shared/ui/js/jarvis-chat-frame.js (mountJarvisChat) as phone-control / device-concierge in #phoneConciergeWindow and #connectConciergeWindow with live device/connect screen_state, keep the seven quick-action buttons deterministic over local bridge primitives, and remove bespoke client calls to /concierge/turn.
 */

import { bytesToBase64, installationOrigin, iosGestureFromDrag } from '/api/phone-control/ui/computer-link.js';
import { executeRdpConciergeAction, rdpLabel, resolveCompanionApk, sendRdpInput, stageCompanionApk } from '/api/phone-control/ui/phone-rdp.js';

const WHEEL_THROTTLE_MS = 180;

const SWIPE_VECTORS = Object.freeze({
  left: { nx1: 0.82, ny1: 0.52, nx2: 0.18, ny2: 0.52 },
  right: { nx1: 0.18, ny1: 0.52, nx2: 0.82, ny2: 0.52 },
  up: { nx1: 0.5, ny1: 0.76, nx2: 0.5, ny2: 0.24 },
  down: { nx1: 0.5, ny1: 0.24, nx2: 0.5, ny2: 0.76 }
});

const ANDROID_KEY_MAP = Object.freeze({
  Home: 'HOME', Back: 'BACK', Recents: 'RECENTS', Enter: 'ENTER',
  Backspace: 'BACKSPACE', VolumeUp: 'VOLUME_UP', VolumeDown: 'VOLUME_DOWN', Escape: 'BACK', Spotlight: 'HOME',
  Up: 'UP', Down: 'DOWN', Left: 'LEFT', Right: 'RIGHT', Select: 'OK', OK: 'OK',
  DPAD_UP: 'UP', DPAD_DOWN: 'DOWN', DPAD_LEFT: 'LEFT', DPAD_RIGHT: 'RIGHT', DPAD_CENTER: 'OK',
  PlayPause: 'PLAY_PAUSE', Menu: 'MENU', Tab: 'ENTER'
});

const STAGE_SPECIAL_KEYS = Object.freeze({
  Enter: 'Enter', Backspace: 'Backspace', Escape: 'Escape', Tab: 'Tab',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
});

const TV_STAGE_KEYS = Object.freeze({
  ArrowUp: { adb: 'UP', ios: 'Up', label: 'Up' },
  ArrowDown: { adb: 'DOWN', ios: 'Down', label: 'Down' },
  ArrowLeft: { adb: 'LEFT', ios: 'Left', label: 'Left' },
  ArrowRight: { adb: 'RIGHT', ios: 'Right', label: 'Right' },
  Enter: { adb: 'OK', ios: 'Select', label: 'OK' },
  Backspace: { adb: 'BACK', ios: 'Back', label: 'Back' },
  Escape: { adb: 'BACK', ios: 'Back', label: 'Back' },
  ' ': { adb: 'PLAY_PAUSE', ios: 'PlayPause', label: 'Play/Pause' }
});

const TV_PACKAGE_ALIASES = Object.freeze({
  oshaltv: ['com.oshal.remote'],
  oshal: ['com.oshal.remote'],
  youtube: ['com.amazon.firetv.youtube', 'com.google.android.youtube.tv', 'com.google.android.youtube'],
  netflix: ['com.netflix.ninja', 'com.netflix.mediaclient'],
  primevideo: ['com.amazon.avod'],
  disneyplus: ['com.disney.disneyplus']
});

const APP_CATEGORIES = Object.freeze([
  { name: 'Work & Notes', match: /note|remind|calendar|mail|clock|files|safari|chrome|docs|slack|teams|calc/i },
  { name: 'Messages & Social', match: /message|phone|facetime|contact|whatsapp|telegram|discord|signal|social/i },
  { name: 'Media & Photos', match: /photo|camera|music|podcast|tv|youtube|spotify|video|news|books/i },
  { name: 'Utilities', match: /setting|map|weather|wallet|health|watch|find|home|app store|store|translate/i }
]);

const QUICK_CHIP_IDS = Object.freeze([
  'chipOrganizeApps', 'chipReadScreen', 'chipScreenshot', 'chipOpenNotes',
  'chipGoHome', 'conciergeSwipeLeftBtn', 'conciergeSwipeRightBtn'
]);

let chatMountPromise = null;

function loadChatMount() {
  if (!chatMountPromise) {
    chatMountPromise = import('/shared/ui/js/jarvis-chat-frame.js')
      .then((mod) => (typeof mod?.mountJarvisChat === 'function' ? mod.mountJarvisChat : null))
      .catch(() => null);
  }
  return chatMountPromise;
}

function setConciergeStatus(ctx, state, text) {
  const clean = String(text || '').trim();
  state.lastReply = clean;
  const log = ctx.$('conciergeLog');
  if (log) log.textContent = clean;
}

function setChipsDisabled(ctx, disabled) {
  for (const id of QUICK_CHIP_IDS) {
    const btn = ctx.$(id);
    if (btn) btn.disabled = disabled;
  }
}

function refusalAdvice(reply) {
  const err = reply?.error || '';
  if (err === 'assistive_touch_off') {
    return 'Bluetooth pointer is off on your iPhone — press "Open AssistiveTouch on iPhone" below the screen (or open Settings → Accessibility → Touch → AssistiveTouch) and toggle AssistiveTouch ON.';
  }
  if (err === 'no_phone_listening') {
    return 'Your iPhone is not actively connected to OSHAL-KB over Bluetooth yet. On your iPhone open Settings → Bluetooth and tap OSHAL-KB.';
  }
  if (err === 'mirror_not_running' || err === 'no_frame') {
    return 'Start screen mirroring first (and choose OSHAL Mirror in iPhone Control Center → Screen Mirroring) so I can see your phone screen.';
  }
  return reply?.message || 'The phone bridge refused that step.';
}

async function readPhoneScreenMap(ctx, phone) {
  if (phone.platform === 'ios' && !ctx.view.mirrorRunning) {
    return { ok: false, error: 'mirror_not_running', message: 'Start mirroring first so Phone Concierge can read the iPhone screen.' };
  }
  const verb = phone.platform === 'ios' ? 'mirror-ui' : 'adb-ui';
  const args = phone.platform === 'ios' ? {} : { serial: phone.address };
  const reply = await ctx.phoneCommand(phone, verb, args, 'read screen', 'Read phone screen text');
  return reply || { ok: false, error: 'offline', message: ctx.$('stageStatus').textContent || 'Device unavailable.' };
}

function resolveAndroidPkg(apps, rawName) {
  const wanted = String(rawName || '').trim();
  if (!wanted) return null;
  if (apps.includes(wanted)) return wanted;
  const squashed = wanted.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const aliases = TV_PACKAGE_ALIASES[squashed] || [];
  const matchedAlias = aliases.find((pkg) => apps.includes(pkg));
  if (matchedAlias) return matchedAlias;
  const matchedApp = apps.find((pkg) => pkg.split('.').pop().toLowerCase() === squashed)
    || apps.find((pkg) => pkg.toLowerCase().includes(squashed));
  return matchedApp || aliases[0] || null;
}

async function executePhoneAction(ctx, phone, action, state) {
  const landscape = Boolean(ctx.view.frame && ctx.view.frame.deviceWidth > ctx.view.frame.deviceHeight);
  const w = state.screen?.deviceWidth || ctx.view.frame?.deviceWidth || 1080;
  const h = state.screen?.deviceHeight || ctx.view.frame?.deviceHeight || 2340;
  if (action.kind === 'read_screen') {
    const res = await readPhoneScreenMap(ctx, phone);
    if (res.ok) state.screen = res;
    return { reply: res, stepText: res.ok ? `Read ${res.items?.length || 0} labels on screen` : '' };
  }
  if (action.kind === 'open_app') {
    if (phone.platform === 'ios') {
      const reply = await ctx.phoneCommand(phone, 'ble-open', { name: action.name }, 'open app', `Open ${action.name}`);
      return { reply, stepText: `Opened ${action.name} via Spotlight` };
    }
    const pkg = resolveAndroidPkg(ctx.view.apps || [], action.name) || action.name;
    const reply = await ctx.phoneCommand(phone, 'adb-launch', { serial: phone.address, package: pkg }, 'open app', `Open ${action.name}`);
    return { reply, stepText: `Launched ${action.name}` };
  }
  if (action.kind === 'tap') {
    if (phone.platform === 'ios') {
      const reply = await ctx.phoneCommand(phone, 'ble-tap', { nx: action.nx, ny: action.ny, landscape, address: phone.address }, 'tap', `Tap ${action.label || 'item'}`);
      return { reply, stepText: `Tapped ${action.label || 'screen'}` };
    }
    const x = Number.isFinite(action.x) ? action.x : Math.round(action.nx * w);
    const y = Number.isFinite(action.y) ? action.y : Math.round(action.ny * h);
    const reply = await ctx.phoneCommand(phone, 'adb-tap', { serial: phone.address, x, y }, 'tap', `Tap ${action.label || 'item'}`);
    return { reply, stepText: `Tapped ${action.label || 'screen'}` };
  }
  return executeGestureOrKeyAction(ctx, phone, action, { landscape, w, h });
}

async function executeGestureOrKeyAction(ctx, phone, action, dims) {
  const { landscape, w, h } = dims;
  if (action.kind === 'drag_icon') {
    if (phone.platform === 'ios') {
      const reply = await ctx.phoneCommand(phone, 'ble-drag', {
        nx1: action.nx1, ny1: action.ny1, nx2: action.nx2, ny2: action.ny2, holdMs: 700, landscape, address: phone.address
      }, 'drag icon', action.label || 'Move app icon');
      return { reply, stepText: action.label || 'Moved app icon' };
    }
    const reply = await ctx.phoneCommand(phone, 'adb-swipe', {
      serial: phone.address,
      x1: Math.round(action.nx1 * w), y1: Math.round(action.ny1 * h),
      x2: Math.round(action.nx2 * w), y2: Math.round(action.ny2 * h), ms: 900
    }, 'drag icon', action.label || 'Move app icon');
    return { reply, stepText: action.label || 'Moved app icon' };
  }
  if (action.kind === 'swipe') {
    const vec = SWIPE_VECTORS[action.direction] || SWIPE_VECTORS.left;
    const reply = phone.platform === 'ios'
      ? await ctx.phoneCommand(phone, 'ble-swipe', { ...vec, ms: 260, landscape, address: phone.address }, 'swipe', `Swipe ${action.direction}`)
      : await ctx.phoneCommand(phone, 'adb-swipe', {
        serial: phone.address, x1: Math.round(vec.nx1 * w), y1: Math.round(vec.ny1 * h),
        x2: Math.round(vec.nx2 * w), y2: Math.round(vec.ny2 * h), ms: 260
      }, 'swipe', `Swipe ${action.direction}`);
    return { reply, stepText: `Swiped ${action.direction}` };
  }
  const reply = phone.platform === 'ios'
    ? await ctx.phoneCommand(phone, 'ble-key', { key: action.key }, 'key', `Press ${action.key}`)
    : await ctx.phoneCommand(phone, 'adb-key', { serial: phone.address, key: ANDROID_KEY_MAP[action.key] || 'HOME' }, 'key', `Press ${action.key}`);
  return { reply, stepText: `Pressed ${action.key}` };
}

function clamp01(value, fallback = 0.5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0.02, Math.min(0.98, Math.round(num * 1000) / 1000));
}

function filterAppIcons(items) {
  const statusNoise = /^(\d{1,2}:\d{2}|5g|lte|wi-?fi|\d+%|search|q|w|e|r|t|y)$/i;
  return (Array.isArray(items) ? items : []).filter((item) => {
    const text = String(item?.text || '').trim();
    const ny = Number(item?.ny ?? 0.5);
    return text.length >= 2 && text.length <= 24 && !statusNoise.test(text) && ny > 0.08 && ny < 0.88;
  });
}

function planClientOrganize(items) {
  const apps = filterAppIcons(items);
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
  const reply = summaryParts.length
    ? `Grouped ${apps.length} visible apps (${summaryParts.join(' · ')}).`
    : 'Read the screen, and fewer than two moveable Home Screen app labels were visible to group.';
  return { reply, actions };
}

function checkTargetAllowed(ctx, state) {
  const phone = ctx.selectedPhone();
  const rdp = ctx.selectedRdp();
  if (state.running || (!phone && !rdp)) return null;
  if (phone && !phone.controlEnabled) {
    setConciergeStatus(ctx, state, 'Allow control is currently off for this device — switch Allow control on first.');
    return null;
  }
  return { phone, rdp };
}

async function runTargetStep(ctx, target, action, state) {
  const { reply, stepText } = await ctx.queue.press(() => (target.rdp
    ? executeRdpConciergeAction(ctx, target.rdp, action, state)
    : executePhoneAction(ctx, target.phone, action, state)));
  state.steps.push({ summary: stepText || action.kind, ok: Boolean(reply?.ok), error: reply?.error || null });
  if (!reply?.ok && reply?.error === 'assistive_touch_off') ctx.$('assistiveTouchBar').hidden = false;
  if (reply?.ok && action.kind !== 'read_screen' && target.phone?.platform === 'android') ctx.scheduleFastFrame?.(260);
  return reply;
}

async function runOrganizeChip(ctx, state) {
  const target = checkTargetAllowed(ctx, state);
  if (!target?.phone || target.phone.form === 'tv') return;
  state.running = true;
  setChipsDisabled(ctx, true);
  setConciergeStatus(ctx, state, 'Going to the Home Screen and reading your visible app labels…');
  try {
    for (const step of [{ kind: 'key', key: 'Home' }, { kind: 'read_screen' }]) {
      const reply = await runTargetStep(ctx, target, step, state);
      if (!reply?.ok) { setConciergeStatus(ctx, state, refusalAdvice(reply)); return; }
    }
    const plan = planClientOrganize(state.screen?.items || []);
    for (const action of plan.actions) {
      const reply = await runTargetStep(ctx, target, action, state);
      if (!reply?.ok) { setConciergeStatus(ctx, state, refusalAdvice(reply)); return; }
    }
    setConciergeStatus(ctx, state, plan.reply);
  } finally {
    state.running = false;
    setChipsDisabled(ctx, false);
  }
}

async function runReadScreenChip(ctx, state) {
  const target = checkTargetAllowed(ctx, state);
  if (!target) return;
  const noun = target.rdp ? 'RDP desktop' : target.phone?.form === 'tv' ? 'TV' : 'phone';
  state.running = true;
  setChipsDisabled(ctx, true);
  setConciergeStatus(ctx, state, `Reading the current ${noun} screen…`);
  try {
    const reply = await runTargetStep(ctx, target, { kind: 'read_screen' }, state);
    if (!reply?.ok) { setConciergeStatus(ctx, state, refusalAdvice(reply)); return; }
    const labels = (state.screen?.items || []).slice(0, 18).map((i) => i.text).filter(Boolean);
    setConciergeStatus(ctx, state, labels.length
      ? `On screen right now: ${labels.join(', ')}.`
      : `No readable labels were detected on the current ${noun} frame.`);
  } finally {
    state.running = false;
    setChipsDisabled(ctx, false);
  }
}

async function runDirectChip(ctx, state, action, pendingText, doneText) {
  const target = checkTargetAllowed(ctx, state);
  if (!target) return;
  state.running = true;
  setChipsDisabled(ctx, true);
  setConciergeStatus(ctx, state, pendingText);
  try {
    const reply = await runTargetStep(ctx, target, action, state);
    setConciergeStatus(ctx, state, reply?.ok ? doneText : refusalAdvice(reply));
  } finally {
    state.running = false;
    setChipsDisabled(ctx, false);
  }
}

function wireConciergeChips(ctx, state) {
  const { $ } = ctx;
  $('chipScreenshot').addEventListener('click', () => $('screenshotBtn').click());
  $('chipOrganizeApps').addEventListener('click', () => void runOrganizeChip(ctx, state));
  $('chipReadScreen').addEventListener('click', () => void runReadScreenChip(ctx, state));
  $('chipOpenNotes').addEventListener('click', () => {
    const name = ctx.selectedRdp() ? 'Terminal' : ctx.selectedPhone()?.form === 'tv' ? 'YouTube' : 'Notes';
    const where = ctx.selectedPhone()?.form === 'tv' ? ' on your TV' : '';
    void runDirectChip(ctx, state, { kind: 'open_app', name }, `Opening ${name}${where}…`, `Opening ${name}${where} — launched.`);
  });
  $('chipGoHome').addEventListener('click', () => {
    void runDirectChip(ctx, state, { kind: 'key', key: 'Home' }, 'Returning to the Home Screen…', 'Returned to the Home Screen.');
  });
  $('conciergeSwipeLeftBtn').addEventListener('click', () => {
    if (ctx.selectedRdp()) {
      void runDirectChip(ctx, state, { kind: 'key', key: 'Escape' }, 'Sending Escape…', 'Sent Escape.');
    } else if (ctx.selectedPhone()?.form === 'tv') {
      void runDirectChip(ctx, state, { kind: 'open_app', name: 'oshal TV' }, 'Opening oshal TV on your TV…', 'Opening oshal TV on your TV — launched.');
    } else {
      void runDirectChip(ctx, state, { kind: 'swipe', direction: 'left' }, 'Swiping left…', 'Swiped left.');
    }
  });
  $('conciergeSwipeRightBtn').addEventListener('click', () => {
    if (ctx.selectedRdp()) {
      void runDirectChip(ctx, state, { kind: 'key', key: 'Enter' }, 'Sending Enter…', 'Sent Enter.');
    } else if (ctx.selectedPhone()?.form === 'tv') {
      void runDirectChip(ctx, state, { kind: 'key', key: 'PlayPause' }, 'Sending Play / Pause…', 'Sent Play / Pause.');
    } else {
      void runDirectChip(ctx, state, { kind: 'swipe', direction: 'right' }, 'Swiping right…', 'Swiped right.');
    }
  });
}

function sendStageText(ctx, text, verbLabel = 'Type') {
  if (!text) return;
  const rdp = ctx.selectedRdp();
  if (rdp) { void ctx.queue.press(() => sendRdpInput(ctx, rdp, { action: 'type', text, enter: false }, `${verbLabel} ${text.length} characters`)); return; }
  const phone = ctx.selectedPhone();
  if (!phone || !phone.controlEnabled) return;
  const extra = phone.platform === 'ios' ? { address: phone.address } : {};
  ctx.press('type', `${verbLabel} ${text.length} characters`, 'keyboard-type', { platform: phone.platform, ...extra, text });
}

function wireStageKeyboard(ctx) {
  const frame = ctx.$('deviceFrame');
  let buffer = '';
  let timer = null;
  const flush = () => {
    clearTimeout(timer); timer = null;
    const text = buffer; buffer = '';
    sendStageText(ctx, text, 'Type');
  };
  frame.addEventListener('keydown', (event) => {
    const phone = ctx.selectedPhone();
    const rdp = ctx.selectedRdp();
    if ((!rdp && (!phone || !phone.controlEnabled)) || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.matches?.('input, textarea, select')) return;
    if (phone?.form === 'tv' && TV_STAGE_KEYS[event.key] && (event.key !== ' ' || !buffer)) {
      const tvKey = TV_STAGE_KEYS[event.key];
      event.preventDefault(); flush();
      ctx.press(`key ${tvKey.adb.toLowerCase()}`, tvKey.label, phone.platform === 'android' ? 'adb-key' : 'ble-key', { key: phone.platform === 'android' ? tvKey.adb : tvKey.ios });
      return;
    }
    const mapped = STAGE_SPECIAL_KEYS[event.key];
    if (mapped) {
      event.preventDefault(); flush();
      if (rdp) { void ctx.queue.press(() => sendRdpInput(ctx, rdp, { action: 'key', key: mapped }, `Press ${mapped}`)); return; }
      ctx.press('key', `Press ${mapped}`, 'keyboard-key', { platform: phone.platform, ...(phone.platform === 'ios' ? { address: phone.address } : {}), key: mapped });
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault(); buffer += event.key;
      clearTimeout(timer); timer = setTimeout(flush, 120);
    }
  });
  frame.addEventListener('paste', (event) => {
    const phone = ctx.selectedPhone();
    if ((!ctx.selectedRdp() && (!phone || !phone.controlEnabled)) || event.target?.matches?.('input, textarea, select')) return;
    const text = event.clipboardData?.getData('text') || '';
    if (!text) return;
    event.preventDefault();
    sendStageText(ctx, text, 'Paste');
  });
}

async function postAudioForTranscript(audioBase64, mimeType) {
  for (const [url, extra] of [['/api/voice/transcribe', {}], ['/api/jarvis/ambient/transcribe', { consentScope: 'ambient.recall' }]]) {
    const res = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType, ...extra })
    }).catch(() => null);
    if (!res) continue;
    const data = await res.json().catch(() => ({}));
    const text = String(data?.text || data?.transcript || data?.data?.text || '').trim();
    if (res.ok && text) return { ok: true, text };
  }
  return { ok: false, message: 'No speech detected or voice transcription is not configured yet.' };
}

async function transcribeRecordedAudio(button, onStatus) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return { ok: false, message: 'Voice input is not supported in this browser.' };
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    button.setAttribute('aria-pressed', 'true');
    onStatus('Recording voice… press mic again or pause to send.');
    const blob = await new Promise((resolve, reject) => {
      const limitMs = Math.max(40, Number(globalThis.__PC_VOICE_RECORD_MS) || 4000);
      const timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, limitMs);
      button._pcStopVoice = () => { clearTimeout(timer); if (recorder.state === 'recording') recorder.stop(); };
      recorder.ondataavailable = (ev) => { if (ev.data?.size) chunks.push(ev.data); };
      recorder.onerror = (ev) => { clearTimeout(timer); reject(ev.error || new Error('Microphone recording failed.')); };
      recorder.onstop = () => { clearTimeout(timer); resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })); };
      recorder.start();
    });
    onStatus('Transcribing voice…');
    const audioBase64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    return await postAudioForTranscript(audioBase64, blob.type || 'audio/webm');
  } finally {
    button._pcStopVoice = null;
    button.setAttribute('aria-pressed', 'false');
    stream.getTracks().forEach((t) => t.stop());
  }
}

async function captureVoiceTranscript(button, onStatus) {
  if (typeof button._pcStopVoice === 'function') { button._pcStopVoice(); return null; }
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (typeof SR === 'function') {
    const viaWebSpeech = await new Promise((resolve) => {
      const rec = new SR();
      let text = '';
      let errCode = '';
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      button.setAttribute('aria-pressed', 'true');
      button._pcStopVoice = () => rec.stop();
      onStatus('Listening… speak now.');
      rec.onresult = (ev) => { text = String(ev.results?.[0]?.[0]?.transcript || '').trim(); };
      rec.onerror = (ev) => { errCode = String(ev.error || 'error'); };
      rec.onend = () => { button._pcStopVoice = null; button.setAttribute('aria-pressed', 'false'); resolve({ text, errCode }); };
      try { rec.start(); } catch { button._pcStopVoice = null; button.setAttribute('aria-pressed', 'false'); resolve({ text: '', errCode: 'start-failed' }); }
    });
    if (viaWebSpeech.text) return { ok: true, text: viaWebSpeech.text };
    if (viaWebSpeech.errCode === 'not-allowed' || viaWebSpeech.errCode === 'permission-denied') {
      return { ok: false, message: 'Microphone access was denied by the browser.' };
    }
    if (!viaWebSpeech.errCode || viaWebSpeech.errCode === 'no-speech' || viaWebSpeech.errCode === 'aborted') {
      return { ok: false, message: 'No speech detected — press the mic and speak clearly.' };
    }
  }
  try {
    return await transcribeRecordedAudio(button, onStatus);
  } catch (error) {
    return { ok: false, message: error?.message || 'Microphone could not start.' };
  }
}

async function sendTextToActiveTarget(ctx, text, clearInput = false) {
  const { $ } = ctx;
  if (!text) return;
  const computer = ctx.selectedComputer();
  if (computer) {
    if ((await ctx.sessionComputer.typeOnComputer(computer, text)) && clearInput) $('quickTypeInput').value = '';
    return;
  }
  const rdp = ctx.selectedRdp();
  if (rdp) {
    const sent = await ctx.queue.press(() => sendRdpInput(ctx, rdp, { action: 'type', text, enter: false }, `Type ${text.length} characters`));
    if (sent?.ok && clearInput) $('quickTypeInput').value = '';
    return;
  }
  const phone = ctx.selectedPhone();
  if (!phone) return;
  ctx.press('type', `Type ${text.length} characters`, phone.platform === 'android' ? 'adb-text' : 'ble-type', { text }, () => {
    if (clearInput) $('quickTypeInput').value = '';
  });
}

async function installSessionCompanionApk(ctx) {
  const phone = ctx.selectedPhone();
  if (!phone || phone.platform !== 'android') return;
  const nodeName = ctx.app.computer(phone.computerNodeId)?.name || 'your Linux computer';
  const localApk = ctx.app.state.reports.get(phone.computerNodeId)?.report?.tvApk || null;
  ctx.status('Checking signed oshal Companion APK…');
  const apk = await resolveCompanionApk(localApk, true);
  if (!apk) { ctx.status('No signed oshal Companion APK is staged on this server or computer yet.'); return; }
  await ctx.queue.press(async () => {
    try {
      const staged = await stageCompanionApk({
        apk, nodeName, onProgress: (m) => ctx.status(m),
        bridge: (verb, args, limit) => ctx.app.computers.bridge(phone.computerNodeId, verb, args, limit)
      });
      ctx.status(`Installing and launching oshal Companion (${apk.file})…`);
      const installed = await ctx.phoneCommand(phone, 'adb-install-apk', {
        serial: phone.address, stageId: staged.stageId, sha256: staged.sha256, preferAndroid: true,
        launchPackage: 'com.oshal.remote', serverUrl: installationOrigin()
      }, 'install apk', `Install oshal Companion on ${phone.name}`, 180000);
      if (!installed) return;
      ctx.status(installed.ok ? `Installed and opened oshal Companion on ${phone.name}.` : (installed.message || 'APK install failed.'));
    } catch (error) {
      ctx.status(error?.message || 'Companion APK staging failed.');
    }
  });
}

function wirePointerHelpersAndQuickBar(ctx) {
  const { $ } = ctx;
  $('openAssistiveTouchBtn').addEventListener('click', () => {
    $('assistiveTouchBar').hidden = true;
    ctx.press('open app', 'Open AssistiveTouch settings', 'ble-open', { name: 'AssistiveTouch' });
  });
  $('recenterPointerBtn').addEventListener('click', () => {
    void ctx.syncActiveDevice();
  });
  $('calibratePointerBtn').addEventListener('click', () => {
    const phone = ctx.selectedPhone();
    if (!phone || phone.platform !== 'ios') return;
    ctx.status('Calibrating Bluetooth pointer scale…');
    void ctx.queue.press(async () => {
      const reply = await ctx.phoneCommand(phone, 'ble-calibrate', { address: phone.address }, 'calibrate', 'Calibrate iPhone pointer', 45000);
      if (!reply) return;
      if (reply.error === 'assistive_touch_off') $('assistiveTouchBar').hidden = false;
      ctx.status(reply.ok
        ? `Pointer calibrated (${reply.profile?.span_x}×${reply.profile?.span_y} steps).`
        : (reply.message || 'Could not calibrate pointer.'));
    });
  });
  $('installSessionApkBtn').addEventListener('click', () => { void installSessionCompanionApk(ctx); });
  $('quickMoreBtn').addEventListener('click', () => ctx.app.openSessionSheet(true));
  $('quickVoiceBtn').addEventListener('click', async () => {
    const res = await captureVoiceTranscript($('quickVoiceBtn'), (m) => ctx.status(m));
    if (!res) return;
    if (!res.ok) { ctx.status(res.message); return; }
    $('quickTypeInput').value = res.text;
    await sendTextToActiveTarget(ctx, res.text, true);
  });
  $('quickTypeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await sendTextToActiveTarget(ctx, $('quickTypeInput').value, true);
  });
}

function wireScreenScrollAndQuickBar(ctx) {
  const { $ } = ctx;
  let lastWheelAt = 0;
  wireStageKeyboard(ctx);
  wirePointerHelpersAndQuickBar(ctx);
  const onWheel = (event) => {
    if (event.defaultPrevented) return;
    const computer = ctx.selectedComputer();
    const rdp = ctx.selectedRdp();
    const phone = ctx.selectedPhone();
    if (!computer && !rdp && (!phone || !phone.controlEnabled || (phone.platform === 'ios' && phone.form === 'tv'))) return;
    const rawDelta = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaMode === 2 ? event.deltaY * 240 : event.deltaY;
    if (Math.abs(rawDelta) < 0.5) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheelAt < WHEEL_THROTTLE_MS) return;
    lastWheelAt = now;
    const down = rawDelta > 0;
    if (computer) {
      const box = $('screenImage').getBoundingClientRect();
      const local = box.width > 0 && box.height > 0 ? { x: event.clientX - box.left, y: event.clientY - box.top, box } : null;
      void ctx.sessionComputer.scrollOnComputer(computer, down, local);
      return;
    }
    if (rdp) {
      const amount = down ? -4 : 4;
      void ctx.queue.press(() => sendRdpInput(ctx, rdp, { action: 'scroll', amount }, amount < 0 ? 'Scroll down' : 'Scroll up'));
      return;
    }
    if (phone.platform === 'ios') {
      const dy = (down ? -1 : 1) * 6;
      ctx.press('scroll', dy < 0 ? 'Scroll down' : 'Scroll up', 'ble-scroll', { dy });
      return;
    }
    const w = ctx.view.frame?.deviceWidth || 1080;
    const h = ctx.view.frame?.deviceHeight || 2340;
    ctx.press('scroll', down ? 'Scroll down' : 'Scroll up', 'adb-swipe', {
      x1: Math.round(w * 0.5), y1: Math.round(h * (down ? 0.72 : 0.28)),
      x2: Math.round(w * 0.5), y2: Math.round(h * (down ? 0.28 : 0.72)), ms: 200
    });
  };
  $('screenImage').addEventListener('wheel', onWheel, { passive: false });
  $('deviceFrame').addEventListener('wheel', onWheel, { passive: false });
}

function handleIosGestureOnStage(ctx, start, end) {
  const { $ } = ctx;
  const phone = ctx.selectedPhone();
  if (!phone || phone.platform !== 'ios') return;
  $('deviceFrame').focus({ preventScroll: true });
  try {
    const gesture = iosGestureFromDrag(start, end, end.box, ctx.view.frame, performance.now() - start.at);
    ctx.status(`${gesture.summary}…`);
    void ctx.queue.press(async () => {
      const args = { ...gesture.args, address: phone.address };
      const reply = await ctx.phoneCommand(phone, gesture.verb, args, gesture.verb === 'ble-swipe' ? 'swipe' : 'tap', gesture.summary);
      if (!reply) return;
      if (reply.error === 'assistive_touch_off') $('assistiveTouchBar').hidden = false;
      else if (reply.ok) $('assistiveTouchBar').hidden = true;
      ctx.status(reply.ok ? `${gesture.summary}: done.` : (reply.message || 'Bluetooth gesture failed.'));
    });
  } catch (error) {
    ctx.status(error.message);
  }
}

function buildSessionScreenState(ctx, state) {
  const phone = ctx.selectedPhone();
  const rdp = ctx.selectedRdp();
  const heading = ctx.$('conciergeHeading')?.textContent?.trim() || 'Phone Concierge';
  const labels = (state.screen?.items || []).slice(0, 24).map((item) => item.text).filter(Boolean);
  const device = rdp
    ? { kind: 'rdp', sessionId: rdp.sessionId, name: rdpLabel(rdp), connected: rdp.connected !== false }
    : phone
      ? {
        kind: 'phone', id: phone.id, name: phone.name, platform: phone.platform,
        form: phone.form || 'phone', address: phone.address,
        controlEnabled: Boolean(phone.controlEnabled), mirrorRunning: Boolean(ctx.view.mirrorRunning)
      }
      : null;
  const lines = [
    `[surface] ${heading}`,
    device ? `[device] ${device.name} (${device.platform || device.kind}${device.form ? ` · ${device.form}` : ''})` : '[device] none',
    phone ? `[control] ${phone.controlEnabled ? 'on' : 'off'}` : '',
    labels.length ? `[on_screen] ${labels.join(', ')}` : '',
    state.lastReply ? `[status] ${state.lastReply}` : ''
  ].filter(Boolean);
  return { tab: heading, device, labels, text: lines.join('\n') };
}

function renderConciergeCard(ctx) {
  const { $ } = ctx;
  const phone = ctx.selectedPhone();
  const computer = ctx.selectedComputer();
  const rdp = ctx.selectedRdp();
  const tv = phone?.form === 'tv';
  $('conciergeCard').hidden = !(phone || rdp);
  $('computerConciergeCard').hidden = !computer;
  if (!phone && !rdp) return;
  $('conciergeHeading').textContent = rdp ? 'RDP Concierge' : tv ? 'TV Concierge' : 'Phone Concierge';
  $('conciergeSub').textContent = rdp
    ? `Ask about ${rdpLabel(rdp)} or request an action.`
    : `Ask about ${phone.name} or request an action.`;
  $('chipOrganizeApps').hidden = Boolean(tv || rdp);
  $('chipReadScreen').textContent = (tv || rdp) ? "What's on screen?" : 'Read screen';
  $('chipOpenNotes').textContent = rdp ? 'Open Terminal' : tv ? 'Open YouTube' : 'Open Notes';
  $('conciergeSwipeLeftBtn').textContent = rdp ? 'Press Escape' : tv ? 'Open oshal TV' : 'Swipe left';
  $('conciergeSwipeRightBtn').textContent = rdp ? 'Press Enter' : tv ? 'Play / Pause' : 'Swipe right';
}

function resetConciergeForTarget(ctx, state) {
  const { $ } = ctx;
  state.screen = null;
  state.steps = [];
  $('assistiveTouchBar').hidden = true;
  const nextId = ctx.currentTargetKey();
  if (nextId === state.targetId) return;
  state.targetId = nextId;
  setConciergeStatus(ctx, state, '');
  state.chat?.setRecord(nextId || null);
  const phone = ctx.selectedPhone();
  const rdp = ctx.selectedRdp();
  if (!phone && !rdp) return;
  const welcome = rdp
    ? `Ready for ${rdpLabel(rdp)}. Click or drag directly on the desktop picture, type on your keyboard, or ask RDP Concierge.`
    : phone.form === 'tv'
      ? `Ready for ${phone.name}. Click directly on the TV picture, type on your keyboard, or ask TV Concierge to open apps or control playback.`
      : `Ready for ${phone.name}. Tap the screen directly to tap or swipe, or choose a task above.`;
  setConciergeStatus(ctx, state, welcome);
  state.chat?.setHelp(welcome);
}

function mountSessionChatWindow(ctx, state) {
  const host = ctx.$('phoneConciergeWindow');
  if (!host) return;
  void loadChatMount().then((mountJarvisChat) => {
    if (!mountJarvisChat) {
      host.classList.add('assistant-unavailable');
      return;
    }
    state.chat = mountJarvisChat(host, {
      app: 'phone-control',
      bot: 'device-concierge',
      record: state.targetId || null,
      title: 'Device Concierge',
      closable: false,
      lazy: true,
      help: state.lastReply || 'Ask about this device or request an action.',
      chatHost: {
        prepare: async () => ({ screen_state: buildSessionScreenState(ctx, state) }),
        refresh: () => ctx.app.load?.()
      }
    });
  });
}

/** @description Mount the specialized Phone/TV/RDP Concierge and iOS direct-touch helpers in the session view. @param {object} ctx Stage context. @returns {object} Controller. */
export function mountPhoneConcierge(ctx) {
  const state = { running: false, screen: null, steps: [], targetId: '', lastReply: '', chat: null };
  wireScreenScrollAndQuickBar(ctx);
  wireConciergeChips(ctx, state);
  mountSessionChatWindow(ctx, state);
  return {
    onSelectTarget: () => resetConciergeForTarget(ctx, state),
    render: () => renderConciergeCard(ctx),
    handleIosGesture: (start, end) => handleIosGestureOnStage(ctx, start, end)
  };
}

function buildConnectScreenState(setupCtx) {
  const { $, app } = setupCtx;
  const comp = setupCtx.view.node ? app.computer(setupCtx.view.node) : null;
  const savedReport = setupCtx.view.node ? app.state.reports.get(setupCtx.view.node)?.report || null : null;
  const tvAddress = $('tvAddress')?.value?.trim() || '';
  const rdpHost = $('rdpHost')?.value?.trim() || '';
  const problem = setupCtx.view.lastProblem;
  const lines = [
    '[surface] Add a device · Connection Concierge',
    comp ? `[computer] ${comp.name} (${comp.platform} · ${comp.connected ? 'connected' : 'offline'})` : '[computer] none selected',
    savedReport ? `[bridge] adbReady=${Boolean(savedReport.adb?.ready)} bleReady=${Boolean(savedReport.ble?.registered)} mirrorRunning=${Boolean(savedReport.mirror?.running)}` : '',
    tvAddress ? `[field] TV address: ${tvAddress}` : '',
    rdpHost ? `[field] RDP host: ${rdpHost}` : '',
    problem?.message ? `[problem] (${problem.step || 'setup'}/${problem.code || 'error'}) ${problem.message}` : ''
  ].filter(Boolean);
  return { tab: 'Add a device', computer: comp?.name || null, tvAddress, rdpHost, problem: problem || null, text: lines.join('\n') };
}

/** @description Mount the Connection Troubleshooting Concierge inside #connectSheet. @param {object} setupCtx Setup context. @returns {object} Controller. */
export function mountConnectConcierge(setupCtx) {
  const { $ } = setupCtx;
  const connectState = { chat: null };
  const host = $('connectConciergeWindow');
  if (host) {
    void loadChatMount().then((mountJarvisChat) => {
      if (!mountJarvisChat) {
        host.classList.add('assistant-unavailable');
        return;
      }
      connectState.chat = mountJarvisChat(host, {
        app: 'phone-control',
        bot: 'device-concierge',
        record: 'connect',
        title: 'Connection Concierge',
        closable: false,
        lazy: true,
        help: 'Ask about Android Wireless Debugging, Fire TV ADB, Bluetooth OSHAL-KB, AirPlay mirroring, or RDP setup.',
        chatHost: {
          prepare: async () => ({ screen_state: buildConnectScreenState(setupCtx) }),
          refresh: () => setupCtx.app.load?.()
        }
      });
    });
  }
  $('askConnectConciergeBtn').addEventListener('click', () => {
    $('connectConciergeDetails').open = true;
    $('connectConciergeCard').scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    const prompt = setupCtx.view.lastProblem?.message || 'Help me finish connecting my device.';
    connectState.chat?.focus(prompt);
  });
  return {
    flagProblem(step, code, message) {
      setupCtx.view.lastProblem = { step, code: String(code || 'error'), message: String(message || '') };
      $('connectProblemBanner').hidden = false;
      $('connectProblemText').textContent = message || 'A connection step needs attention.';
    },
    clearProblem() {
      $('connectProblemBanner').hidden = true;
    }
  };
}
