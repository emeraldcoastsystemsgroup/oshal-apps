/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.4.0 collaboration & transfer controls: chunked file upload/download (RP-PHC-03), clipboard read/write sync (RP-PHC-04), live session chat with computer notification & outbox sync (RP-PHC-11), normalized screen whiteboard overlay (RP-PHC-12), and operator screen sharing via Switch sides (RP-PHC-13).
 */

import { bytesToBase64, computerStanding, fromBase64, safeFileName, toBase64 } from '/api/phone-control/ui/computer-link.js';

const FILE_CHUNK_BYTES = 12288;
const MAX_TRANSFER_BYTES = 4 * 1024 * 1024;

const COMP_LIST_PY = [
  'import json,os',
  'd=os.path.expanduser("~/Downloads");os.makedirs(d,exist_ok=True)',
  'items=[{"name":n[:120],"sizeBytes":os.path.getsize(os.path.join(d,n))} for n in sorted(os.listdir(d)) if os.path.isfile(os.path.join(d,n)) and not n.startswith(".")][:50]',
  'print(json.dumps({"ok":True,"folder":d,"files":items}))'
].join('\n');

const COMP_WRITE_PY = [
  'import base64,json,os,sys',
  'm=json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))',
  'd=os.path.expanduser("~/Downloads");os.makedirs(d,exist_ok=True)',
  'p=os.path.join(d,os.path.basename(m["name"]))',
  'open(p,"ab" if m.get("append") else "wb").write(base64.b64decode(m["data"]))',
  'print(json.dumps({"ok":True,"path":p,"sizeBytes":os.path.getsize(p)}))'
].join('\n');

const COMP_READ_PY = [
  'import base64,json,os,sys',
  'm=json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))',
  'p=os.path.join(os.path.expanduser("~/Downloads"),os.path.basename(m["name"]))',
  'if not os.path.isfile(p): print(json.dumps({"ok":False,"message":"File not found in ~/Downloads."}));sys.exit(0)',
  'sz=os.path.getsize(p)',
  'if sz>4194304: print(json.dumps({"ok":False,"message":"File exceeds 4 MiB transfer limit."}));sys.exit(0)',
  'f=open(p,"rb");f.seek(int(m["offset"]));b=f.read(12288);f.close()',
  'print(json.dumps({"ok":True,"totalBytes":sz,"eof":int(m["offset"])+len(b)>=sz,"data":base64.b64encode(b).decode("ascii")}))'
].join('\n');

const COMP_CLIP_GET_PY = [
  'import json,shutil,subprocess,sys',
  'cmds=[["wl-paste","--no-newline"],["xclip","-selection","clipboard","-o"],["xsel","--clipboard","--output"],["pbpaste"],["powershell.exe","-NoProfile","-Command","Get-Clipboard"]]',
  'for c in cmds:',
  '    if shutil.which(c[0]):',
  '        r=subprocess.run(c,capture_output=True,text=True,timeout=6)',
  '        if r.returncode==0: print(json.dumps({"ok":True,"text":r.stdout[:4000]}));sys.exit(0)',
  'print(json.dumps({"ok":False,"message":"No clipboard utility (wl-paste, xclip, xsel, pbpaste or Get-Clipboard) answered on that computer."}))'
].join('\n');

const COMP_CLIP_SET_PY = [
  'import base64,json,shutil,subprocess,sys',
  't=base64.b64decode(sys.argv[1]).decode("utf-8")',
  'cmds=[["wl-copy"],["xclip","-selection","clipboard"],["xsel","--clipboard","--input"],["pbcopy"],["clip.exe"]]',
  'for c in cmds:',
  '    if shutil.which(c[0]):',
  '        r=subprocess.run(c,input=t,capture_output=True,text=True,timeout=6)',
  '        if r.returncode==0: print(json.dumps({"ok":True}));sys.exit(0)',
  'print(json.dumps({"ok":False,"message":"No clipboard utility (wl-copy, xclip, xsel, pbcopy or clip.exe) could write the clipboard on that computer."}))'
].join('\n');

const COMP_CHAT_PY = [
  'import base64,json,os,shutil,subprocess,sys',
  'm=json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))',
  'd=os.path.expanduser("~/.cache/oshal-phone-bridge");os.makedirs(d,mode=0o700,exist_ok=True)',
  'if m.get("send"):',
  '    open(os.path.join(d,"chat-inbox.jsonl"),"a",encoding="utf-8").write(json.dumps(m)+"\\n")',
  '    if shutil.which("notify-send"): subprocess.run(["notify-send","oshal Session",m["body"][:200]],timeout=4)',
  'out=os.path.join(d,"chat-outbox.jsonl");replies=[]',
  'if os.path.isfile(out):',
  '    replies=[ln.strip() for ln in open(out,encoding="utf-8").read().splitlines() if ln.strip()][-10:]',
  '    open(out,"w",encoding="utf-8").close()',
  'print(json.dumps({"ok":True,"replies":replies}))'
].join('\n');

const COMP_SHARE_PY = [
  'import base64,json,os,shutil,subprocess,sys',
  'm=json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))',
  'd=os.path.expanduser("~/.cache/oshal-phone-bridge");os.makedirs(d,mode=0o700,exist_ok=True)',
  'p=os.path.join(d,"operator-share.jpg")',
  'open(p+".new","wb").write(base64.b64decode(m["data"]));os.replace(p+".new",p)',
  'if m.get("openViewer") and shutil.which("xdg-open"):',
  '    subprocess.Popen(["xdg-open",p],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)',
  'print(json.dumps({"ok":True,"path":p}))'
].join('\n');

function parseLastJson(answer) {
  const line = String(answer?.output?.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  try { return JSON.parse(line); } catch { return null; }
}

function downloadBytes(bytes, fileName, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function refreshTransfersList(ctx) {
  const targetKey = ctx.currentTargetKey();
  const list = ctx.$('transfersList');
  if (!targetKey) { list.replaceChildren(); return; }
  try {
    const transfers = await ctx.app.records.transfers(targetKey);
    list.replaceChildren(...transfers.slice(0, 5).map((item) => {
      const li = document.createElement('li');
      li.className = 'pc-compact-item';
      const label = document.createElement('span');
      label.textContent = `${item.direction === 'upload' ? 'Sent' : 'Pulled'} ${item.fileName} (${Math.max(1, Math.round(item.byteSize / 1024))} KB)`;
      const dl = document.createElement('a');
      dl.className = 'ks-btn';
      dl.href = ctx.app.records.transferUrl(item.id);
      dl.download = item.fileName;
      dl.textContent = 'Save copy';
      li.append(label, dl);
      return li;
    }));
  } catch { list.replaceChildren(); }
}

function renderRemoteFiles(ctx, files, folder) {
  const statusEl = ctx.$('filesStatus');
  const ul = ctx.$('remoteFilesList');
  statusEl.textContent = files.length ? `${files.length} file(s) in ${folder}.` : `No files in ${folder}.`;
  ul.replaceChildren(...files.map((file) => {
    const li = document.createElement('li');
    li.className = 'pc-compact-item';
    const label = document.createElement('span');
    label.textContent = `${file.name} (${Math.max(1, Math.round((file.sizeBytes || 0) / 1024))} KB)`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ks-btn';
    btn.textContent = 'Download';
    btn.addEventListener('click', () => void pullRemoteFile(ctx, file.name));
    li.append(label, btn);
    return li;
  }));
}

async function listRemoteFiles(ctx) {
  const computer = ctx.selectedComputer();
  const phone = ctx.selectedPhone();
  const statusEl = ctx.$('filesStatus');
  if (phone?.platform === 'ios' || ctx.selectedRdp()) {
    statusEl.textContent = ctx.selectedRdp()
      ? 'Direct file listing requires oshal Node on that desktop; RDP sessions stream screen, mouse and keyboard.'
      : 'iPhone Bluetooth keyboard and AirPlay mirroring do not expose iPhone storage; use AirDrop or iCloud Drive.';
    return;
  }
  if (computer) {
    const standing = computerStanding(computer);
    if (!standing.usable) { statusEl.textContent = standing.fix || standing.text; return; }
    statusEl.textContent = `Reading ~/Downloads on ${computer.name}…`;
    const reply = parseLastJson(await ctx.app.computers.run(computer.id, `python3 -I -c '${COMP_LIST_PY}'`, 15000));
    renderRemoteFiles(ctx, reply?.files || [], reply?.folder || '~/Downloads');
    return;
  }
  if (phone?.platform === 'android') {
    statusEl.textContent = `Reading /sdcard/Download on ${phone.name}…`;
    const reply = await ctx.phoneCommand(phone, 'adb-files', { serial: phone.address }, null, '');
    if (!reply?.ok) { statusEl.textContent = reply?.message || 'Could not read /sdcard/Download.'; return; }
    renderRemoteFiles(ctx, reply.files || [], reply.folder);
  }
}

async function pushFileChunks(ctx, name, bytes) {
  const computer = ctx.selectedComputer();
  const phone = ctx.selectedPhone();
  let remotePath = '';
  if (computer) {
    const standing = computerStanding(computer);
    if (!standing.usable) throw new Error(standing.fix || standing.text);
    for (let off = 0; off < bytes.length; off += FILE_CHUNK_BYTES) {
      const arg = toBase64(JSON.stringify({ name, append: off > 0, data: bytesToBase64(bytes.subarray(off, off + FILE_CHUNK_BYTES)) }));
      const reply = parseLastJson(await ctx.app.computers.run(computer.id, `python3 -I -c '${COMP_WRITE_PY}' ${arg}`, 20000));
      if (!reply?.ok) throw new Error(reply?.message || 'Upload failed.');
      remotePath = reply.path;
    }
    return remotePath;
  }
  for (let off = 0; off < bytes.length; off += FILE_CHUNK_BYTES) {
    const done = off + FILE_CHUNK_BYTES >= bytes.length;
    const reply = await ctx.phoneCommand(phone, 'adb-push', {
      serial: phone.address, name, append: off > 0, done,
      data: bytesToBase64(bytes.subarray(off, off + FILE_CHUNK_BYTES))
    }, done ? 'upload file' : null, `Send ${name}`);
    if (!reply?.ok) throw new Error(reply?.message || 'Android file push failed.');
    remotePath = reply.remotePath || `/sdcard/Download/${name}`;
  }
  return remotePath;
}

async function uploadSelectedFile(ctx, file) {
  const statusEl = ctx.$('filesStatus');
  const targetKey = ctx.currentTargetKey();
  if (!file || !targetKey) return;
  if (ctx.selectedPhone()?.platform === 'ios' || ctx.selectedRdp()) {
    statusEl.textContent = ctx.selectedRdp()
      ? 'Direct file uploads require oshal Node on that desktop.'
      : 'iPhone sessions do not carry file uploads over Bluetooth or AirPlay.';
    return;
  }
  if (file.size === 0 || file.size > MAX_TRANSFER_BYTES) {
    statusEl.textContent = file.size === 0 ? 'Choose a non-empty file.' : 'Files sent here may be at most 4 MiB.';
    return;
  }
  try {
    const name = safeFileName(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    statusEl.textContent = `Sending ${name}…`;
    const remotePath = await pushFileChunks(ctx, name, bytes);
    await ctx.app.records.saveTransfer({
      targetKey, direction: 'upload', fileName: name, mimeType: file.type || 'application/octet-stream',
      remotePath, status: 'delivered', dataBase64: bytesToBase64(bytes)
    });
    await refreshTransfersList(ctx);
    statusEl.textContent = `Sent ${name} to ${remotePath}.`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function pullRemoteFile(ctx, rawName) {
  const statusEl = ctx.$('filesStatus');
  const targetKey = ctx.currentTargetKey();
  const name = safeFileName(rawName);
  const computer = ctx.selectedComputer();
  const phone = ctx.selectedPhone();
  statusEl.textContent = `Downloading ${name}…`;
  const parts = [];
  let offset = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    const step = computer
      ? parseLastJson(await ctx.app.computers.run(computer.id, `python3 -I -c '${COMP_READ_PY}' ${toBase64(JSON.stringify({ name, offset }))}`, 20000))
      : await ctx.phoneCommand(phone, 'adb-pull', { serial: phone.address, name, offset }, null, '');
    if (!step?.ok) { statusEl.textContent = step?.message || `Could not download ${name}.`; return; }
    const chunk = fromBase64(step.data);
    parts.push(chunk);
    offset += chunk.length;
    if (step.eof || chunk.length === 0) break;
  }
  const merged = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) { merged.set(part, at); at += part.length; }
  downloadBytes(merged, name);
  if (targetKey && merged.length > 0) {
    await ctx.app.records.saveTransfer({
      targetKey, direction: 'download', fileName: name, mimeType: 'application/octet-stream',
      remotePath: computer ? `~/Downloads/${name}` : `/sdcard/Download/${name}`, status: 'downloaded',
      dataBase64: bytesToBase64(merged)
    });
    await refreshTransfersList(ctx);
  }
  statusEl.textContent = `Downloaded ${name} (${Math.max(1, Math.round(merged.length / 1024))} KB).`;
}

async function syncClipboard(ctx, direction) {
  const statusEl = ctx.$('clipboardStatus');
  const box = ctx.$('clipboardText');
  const computer = ctx.selectedComputer();
  const phone = ctx.selectedPhone();
  if (phone?.platform === 'ios' || ctx.selectedRdp()) {
    statusEl.textContent = ctx.selectedRdp()
      ? 'Paste directly onto the RDP screen or use Type in Session to send text.'
      : 'iPhone Bluetooth and AirPlay do not expose clipboard sync; use Type in Session to send text.';
    return;
  }
  if (computer && !computerStanding(computer).usable) {
    statusEl.textContent = computerStanding(computer).fix || computerStanding(computer).text;
    return;
  }
  if (direction === 'read') {
    const reply = computer
      ? parseLastJson(await ctx.app.computers.run(computer.id, `python3 -I -c '${COMP_CLIP_GET_PY}'`, 12000))
      : await ctx.phoneCommand(phone, 'adb-clipboard-get', { serial: phone.address }, 'clipboard', 'Read clipboard');
    if (!reply?.ok) { statusEl.textContent = reply?.message || 'Clipboard could not be read.'; return; }
    box.value = reply.text || '';
    try { await navigator.clipboard?.writeText?.(box.value); } catch { /* optional */ }
    statusEl.textContent = `Read ${box.value.length} character(s) from remote clipboard.`;
    return;
  }
  const text = box.value;
  if (!text) { statusEl.textContent = 'Enter text in Clipboard text before sending.'; return; }
  const reply = computer
    ? parseLastJson(await ctx.app.computers.run(computer.id, `python3 -I -c '${COMP_CLIP_SET_PY}' ${toBase64(text)}`, 12000))
    : await ctx.phoneCommand(phone, 'adb-clipboard-set', { serial: phone.address, text }, 'clipboard', 'Send clipboard');
  statusEl.textContent = reply?.ok ? `Sent ${text.length} character(s) to remote clipboard.` : (reply?.message || 'Clipboard write refused.');
}

async function loadChat(ctx) {
  const targetKey = ctx.currentTargetKey();
  const host = ctx.$('chatLog');
  if (!targetKey) { host.replaceChildren(); return; }
  try {
    const messages = await ctx.app.records.chat(targetKey);
    if (!messages.length) {
      const p = document.createElement('p');
      p.className = 'ks-help';
      p.textContent = 'No messages in this session yet.';
      host.replaceChildren(p);
      return;
    }
    host.replaceChildren(...messages.slice(-30).map((msg) => {
      const row = document.createElement('div');
      row.className = `pc-chat-msg pc-chat-${msg.sender}`;
      const who = document.createElement('strong');
      who.textContent = msg.sender === 'remote' ? 'Remote: ' : 'You: ';
      const body = document.createElement('span');
      body.textContent = msg.body;
      row.append(who, body);
      return row;
    }));
  } catch { host.replaceChildren(); }
}

async function submitChat(ctx, bodyText) {
  const targetKey = ctx.currentTargetKey();
  if (!targetKey || !bodyText) return;
  const computer = ctx.selectedComputer();
  let deliveryStatus = 'saved';
  let replies = [];
  if (computer && computerStanding(computer).usable) {
    try {
      const arg = toBase64(JSON.stringify({ send: true, body: bodyText, at: new Date().toISOString() }));
      const reply = parseLastJson(await ctx.app.computers.run(computer.id, `python3 -I -c '${COMP_CHAT_PY}' ${arg}`, 10000));
      if (reply?.ok) { deliveryStatus = 'notified'; replies = reply.replies || []; }
    } catch { deliveryStatus = 'saved'; }
  }
  await ctx.app.records.sendChat({ targetKey, sender: 'operator', body: bodyText, deliveryStatus });
  for (const line of replies) {
    await ctx.app.records.sendChat({ targetKey, sender: 'remote', body: String(line).slice(0, 1000), deliveryStatus: 'received' });
  }
  await loadChat(ctx);
  ctx.$('chatStatus').textContent = deliveryStatus === 'notified'
    ? `Delivered to ${computer.name} desktop notification & chat inbox.`
    : 'Saved in this session thread (live desktop notification requires a connected computer).';
}

async function syncRemoteChat(ctx) {
  const computer = ctx.selectedComputer();
  const targetKey = ctx.currentTargetKey();
  if (!computer || !targetKey || !computerStanding(computer).usable) {
    ctx.$('chatStatus').textContent = 'Remote reply inbox sync requires a connected computer session.';
    return;
  }
  const arg = toBase64(JSON.stringify({ send: false, body: '', at: new Date().toISOString() }));
  const reply = parseLastJson(await ctx.app.computers.run(computer.id, `python3 -I -c '${COMP_CHAT_PY}' ${arg}`, 10000));
  const lines = reply?.replies || [];
  for (const line of lines) {
    await ctx.app.records.sendChat({ targetKey, sender: 'remote', body: String(line).slice(0, 1000), deliveryStatus: 'received' });
  }
  await loadChat(ctx);
  ctx.$('chatStatus').textContent = lines.length ? `${lines.length} reply message(s) received.` : 'No new replies in ~/.cache/oshal-phone-bridge/chat-outbox.jsonl.';
}

const INK_PALETTE = Object.freeze({ red: '#ef4444', gold: '#f59e0b', green: '#22c55e', blue: '#3b82f6' });

function renderWhiteboard(ctx, state) {
  const canvas = ctx.$('whiteboardCanvas');
  const toggle = ctx.$('whiteboardToggleBtn');
  toggle.textContent = state.whiteboardOn ? 'Draw on screen: On' : 'Draw on screen: Off';
  toggle.setAttribute('aria-pressed', String(state.whiteboardOn));
  const visible = state.whiteboardOn || state.strokes.length > 0;
  canvas.hidden = !visible;
  canvas.style.pointerEvents = state.whiteboardOn ? 'auto' : 'none';
  if (!visible) return;
  const rect = ctx.$('deviceFrame').getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || 320));
  const h = Math.max(1, Math.round(rect.height || 480));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const c2d = canvas.getContext('2d');
  c2d.clearRect(0, 0, w, h);
  c2d.lineCap = 'round';
  c2d.lineJoin = 'round';
  for (const stroke of [...state.strokes, ...(state.activeStroke ? [state.activeStroke] : [])]) {
    if (!stroke.points?.length) continue;
    c2d.strokeStyle = INK_PALETTE[stroke.color] || stroke.color || '#ef4444';
    c2d.lineWidth = stroke.width || 3;
    c2d.beginPath();
    stroke.points.forEach((pt, idx) => { if (idx === 0) c2d.moveTo(pt.x * w, pt.y * h); else c2d.lineTo(pt.x * w, pt.y * h); });
    c2d.stroke();
  }
}

function stopSwitchSides(ctx, state) {
  if (!state.sharing) return;
  clearInterval(state.sharing.timer);
  for (const track of state.sharing.stream.getTracks()) track.stop();
  state.sharing = null;
  ctx.$('switchSidesBtn').textContent = 'Switch sides';
  ctx.$('switchSidesBtn').setAttribute('aria-pressed', 'false');
}

async function pushOperatorShareFrame(ctx, state, computer, video, canvas) {
  if (!state.sharing || !(video.videoWidth > 0)) return;
  canvas.width = Math.min(960, video.videoWidth);
  canvas.height = Math.max(1, Math.round((canvas.width / video.videoWidth) * video.videoHeight));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.65));
  if (!blob) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > FILE_CHUNK_BYTES * 2) return;
  const arg = toBase64(JSON.stringify({ data: bytesToBase64(bytes), openViewer: state.sharing.first }));
  state.sharing.first = false;
  await ctx.app.computers.run(computer.id, `python3 -I -c '${COMP_SHARE_PY}' ${arg}`, 12000).catch(() => {});
}

async function toggleSwitchSides(ctx, state) {
  if (state.sharing) { stopSwitchSides(ctx, state); ctx.status('Stopped sharing your screen.'); return; }
  const computer = ctx.selectedComputer();
  if (!computer) { ctx.status('Phones and TVs cannot view or control your operator browser session.'); return; }
  const standing = computerStanding(computer);
  if (!standing.usable) { ctx.status(standing.fix || standing.text); return; }
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
    ctx.status('This browser does not support screen capture (getDisplayMedia) to share your side.');
    return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); } catch {
    ctx.status('Screen sharing was cancelled or refused by the browser; nothing was shared.');
    return;
  }
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  const timer = setInterval(() => void pushOperatorShareFrame(ctx, state, computer, video, canvas), 2500);
  stream.getVideoTracks()[0]?.addEventListener('ended', () => stopSwitchSides(ctx, state));
  state.sharing = { stream, timer, first: true };
  ctx.$('switchSidesBtn').textContent = 'Stop sharing side';
  ctx.$('switchSidesBtn').setAttribute('aria-pressed', 'true');
  void pushOperatorShareFrame(ctx, state, computer, video, canvas);
  ctx.status(`Sharing your screen view to ${computer.name} (view-only; remote reverse input is off).`);
}

function wireTransferAndChat(ctx, state) {
  const { $ } = ctx;
  $('uploadFileBtn').addEventListener('click', () => $('fileUploadInput').click());
  $('fileUploadInput').addEventListener('change', () => {
    const file = $('fileUploadInput').files?.[0];
    $('fileUploadInput').value = '';
    if (file) void uploadSelectedFile(ctx, file);
  });
  $('listRemoteFilesBtn').addEventListener('click', () => void listRemoteFiles(ctx));
  $('readClipboardBtn').addEventListener('click', () => void syncClipboard(ctx, 'read'));
  $('writeClipboardBtn').addEventListener('click', () => void syncClipboard(ctx, 'write'));
  $('chatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    $('chatInput').value = '';
    void submitChat(ctx, text);
  });
  $('syncRemoteChatBtn').addEventListener('click', () => void syncRemoteChat(ctx));
  $('clearChatBtn').addEventListener('click', async () => {
    const targetKey = ctx.currentTargetKey();
    if (!targetKey) return;
    await ctx.app.records.clearChat(targetKey);
    await loadChat(ctx);
    $('chatStatus').textContent = 'Session chat cleared.';
  });
  $('switchSidesBtn').addEventListener('click', () => void toggleSwitchSides(ctx, state));
}

function wireWhiteboardControls(ctx, state) {
  const { $ } = ctx;
  $('whiteboardToggleBtn').addEventListener('click', () => {
    state.whiteboardOn = !state.whiteboardOn;
    renderWhiteboard(ctx, state);
    $('whiteboardStatus').textContent = state.whiteboardOn ? 'Drag on the screen to draw annotations.' : 'Drawing paused.';
  });
  $('saveWhiteboardBtn').addEventListener('click', async () => {
    const targetKey = ctx.currentTargetKey();
    if (!targetKey) return;
    await ctx.app.records.saveWhiteboard({ targetKey, strokes: state.strokes });
    $('whiteboardStatus').textContent = `Saved ${state.strokes.length} stroke(s) for this device.`;
  });
  $('clearWhiteboardBtn').addEventListener('click', async () => {
    state.strokes = []; state.activeStroke = null;
    renderWhiteboard(ctx, state);
    const targetKey = ctx.currentTargetKey();
    if (targetKey) await ctx.app.records.clearWhiteboard(targetKey).catch(() => {});
    $('whiteboardStatus').textContent = 'Whiteboard cleared.';
  });
  const wb = $('whiteboardCanvas');
  const norm = (ev) => {
    const r = wb.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(r.width, 1))), y: Math.max(0, Math.min(1, (ev.clientY - r.top) / Math.max(r.height, 1))) };
  };
  wb.addEventListener('pointerdown', (ev) => {
    if (!state.whiteboardOn) return;
    state.activeStroke = { color: $('whiteboardColorSelect').value || '#ef4444', width: 3, points: [norm(ev)] };
    renderWhiteboard(ctx, state);
  });
  wb.addEventListener('pointermove', (ev) => {
    if (!state.activeStroke) return;
    state.activeStroke.points.push(norm(ev));
    renderWhiteboard(ctx, state);
  });
  wb.addEventListener('pointerup', () => {
    if (!state.activeStroke) return;
    if (state.activeStroke.points.length === 1) state.activeStroke.points.push({ ...state.activeStroke.points[0] });
    state.strokes = [...state.strokes.slice(-199), state.activeStroke];
    state.activeStroke = null;
    renderWhiteboard(ctx, state);
    const targetKey = ctx.currentTargetKey();
    if (targetKey) void ctx.app.records.saveWhiteboard({ targetKey, strokes: state.strokes }).catch(() => {});
  });
  window.addEventListener('resize', () => renderWhiteboard(ctx, state));
}

/** @description Mount file transfer, clipboard sync, live session chat, whiteboard, and switch-sides sharing. @param {object} ctx Stage context. @returns {object} Collab controller. */
export function mountSessionCollab(ctx) {
  const state = { whiteboardOn: false, strokes: [], activeStroke: null, sharing: null };
  wireTransferAndChat(ctx, state);
  wireWhiteboardControls(ctx, state);
  return {
    onSelectTarget() {
      state.whiteboardOn = false; state.activeStroke = null;
      stopSwitchSides(ctx, state);
      ctx.$('remoteFilesList').replaceChildren();
      ctx.$('filesStatus').textContent = ''; ctx.$('clipboardStatus').textContent = '';
      ctx.$('chatStatus').textContent = ''; ctx.$('whiteboardStatus').textContent = '';
      void refreshTransfersList(ctx);
      void loadChat(ctx);
      const targetKey = ctx.currentTargetKey();
      if (!targetKey) { state.strokes = []; renderWhiteboard(ctx, state); return; }
      ctx.app.records.whiteboard(targetKey)
        .then((wb) => { state.strokes = Array.isArray(wb.strokes) ? wb.strokes : []; renderWhiteboard(ctx, state); })
        .catch(() => { state.strokes = []; renderWhiteboard(ctx, state); });
    },
    renderWhiteboard: () => renderWhiteboard(ctx, state),
    beforeEndSession() {
      state.whiteboardOn = false;
      stopSwitchSides(ctx, state);
      renderWhiteboard(ctx, state);
    }
  };
}
