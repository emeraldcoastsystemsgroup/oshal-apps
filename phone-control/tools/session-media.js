/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.4.0 session media controls: one-tap PNG screenshot capture + owner-scoped save + download (RP-PHC-06), active stream WebM/MP4 clip recording via canvas MediaRecorder (RP-PHC-07), and High/Balanced/Low picture quality selector (RP-PHC-08).
 */

import { QUALITY_PRESETS, bytesToBase64 } from '/api/phone-control/ui/computer-link.js';

function triggerDownload(href, fileName) {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function chooseRecorderMime() {
  if (typeof globalThis.MediaRecorder !== 'function') return '';
  for (const mime of ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
    if (typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function drawCurrentStageFrame(img, overlayCanvas, targetCanvas) {
  const width = img.naturalWidth || 640;
  const height = img.naturalHeight || 360;
  if (targetCanvas.width !== width || targetCanvas.height !== height) {
    targetCanvas.width = width;
    targetCanvas.height = height;
  }
  const c2d = targetCanvas.getContext('2d');
  c2d.clearRect(0, 0, width, height);
  c2d.drawImage(img, 0, 0, width, height);
  if (overlayCanvas && !overlayCanvas.hidden && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
    c2d.drawImage(overlayCanvas, 0, 0, width, height);
  }
  return { width, height };
}

async function rememberMedia(ctx, action, summary) {
  const phone = ctx.selectedPhone();
  const computer = ctx.selectedComputer();
  const nodeId = phone?.computerNodeId || computer?.id;
  if (!nodeId) return;
  await ctx.app.remember({ computerNodeId: nodeId, phoneId: phone?.id, action, summary, ok: true });
  void ctx.loadHistory();
}

async function refreshCapturesList(ctx) {
  const targetKey = ctx.currentTargetKey();
  const list = ctx.$('capturesList');
  if (!targetKey) { list.replaceChildren(); return; }
  try {
    const captures = await ctx.app.records.captures(targetKey);
    list.replaceChildren(...captures.slice(0, 6).map((item) => {
      const li = document.createElement('li');
      li.className = 'pc-compact-item';
      const meta = document.createElement('span');
      meta.textContent = `${item.kind === 'recording' ? 'Clip' : 'Shot'} · ${Math.max(1, Math.round(item.byteSize / 1024))} KB`;
      const dl = document.createElement('a');
      dl.className = 'ks-btn';
      dl.href = ctx.app.records.captureUrl(item.id);
      dl.download = item.fileName;
      dl.textContent = 'Download';
      li.append(meta, dl);
      return li;
    }));
  } catch {
    list.replaceChildren();
  }
}

async function takeScreenshot(ctx) {
  const targetKey = ctx.currentTargetKey();
  const img = ctx.$('screenImage');
  if (!targetKey || img.hidden || !(img.naturalWidth > 0 && img.naturalHeight > 0)) {
    ctx.status('No live screen picture is showing yet to capture.');
    return;
  }
  const canvas = document.createElement('canvas');
  const { width, height } = drawCurrentStageFrame(img, ctx.$('whiteboardCanvas'), canvas);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) { ctx.status('Browser could not encode screenshot PNG.'); return; }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    const saved = await ctx.app.records.saveCapture({
      targetKey, kind: 'screenshot', mimeType: 'image/png', fileName: `screenshot-${stamp}.png`,
      width, height, dataBase64: bytesToBase64(bytes)
    });
    triggerDownload(ctx.app.records.captureUrl(saved.id), saved.fileName);
    await refreshCapturesList(ctx);
    await rememberMedia(ctx, 'screenshot', `Captured screenshot (${width}x${height})`);
    ctx.status(`Screenshot saved (${Math.max(1, Math.round(saved.byteSize / 1024))} KB).`);
  } catch (error) {
    ctx.status(`Screenshot could not be saved: ${error.message}`);
  }
}

async function saveRecordedChunks(ctx, { rawMime, chunks, startedAt, width, height, targetKey }) {
  const baseMime = rawMime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
  const ext = baseMime === 'video/mp4' ? 'mp4' : 'webm';
  const bytes = new Uint8Array(await new Blob(chunks, { type: baseMime }).arrayBuffer());
  const durationMs = Math.max(200, Date.now() - startedAt);
  if (!bytes.length || !targetKey) return;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const saved = await ctx.app.records.saveCapture({
      targetKey, kind: 'recording', mimeType: baseMime, fileName: `recording-${stamp}.${ext}`,
      width, height, durationMs, dataBase64: bytesToBase64(bytes)
    });
    triggerDownload(ctx.app.records.captureUrl(saved.id), saved.fileName);
    await refreshCapturesList(ctx);
    await rememberMedia(ctx, 'record', `Recorded ${Math.round(durationMs / 100) / 10}s session clip`);
    ctx.status(`Session clip saved (${Math.max(1, Math.round(saved.byteSize / 1024))} KB).`);
  } catch (error) {
    ctx.status(`Session clip could not be saved: ${error.message}`);
  }
}

async function startRecording(ctx, state, updateUi) {
  const targetKey = ctx.currentTargetKey();
  const img = ctx.$('screenImage');
  if (!targetKey || img.hidden || !(img.naturalWidth > 0 && img.naturalHeight > 0)) {
    ctx.status('Wait for a live screen picture before starting a recording.');
    return;
  }
  const rawMime = chooseRecorderMime();
  const canvas = document.createElement('canvas');
  if (!rawMime || typeof canvas.captureStream !== 'function') {
    ctx.status('This browser does not support canvas video recording (MediaRecorder).');
    return;
  }
  const { width, height } = drawCurrentStageFrame(img, ctx.$('whiteboardCanvas'), canvas);
  const stream = canvas.captureStream(5);
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: rawMime });
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (!img.hidden && img.naturalWidth > 0) drawCurrentStageFrame(img, ctx.$('whiteboardCanvas'), canvas);
  }, 200);
  recorder.addEventListener('dataavailable', (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); });
  const stoppedPromise = new Promise((resolve) => {
    recorder.addEventListener('stop', async () => {
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      await saveRecordedChunks(ctx, { rawMime, chunks, startedAt, width, height, targetKey });
      resolve();
    }, { once: true });
  });
  recorder.start(250);
  state.recording = { recorder, stoppedPromise };
  updateUi();
  ctx.status('Recording live session clip… Press Stop recording to save.');
}

async function stopRecording(state, updateUi) {
  const active = state.recording;
  if (!active) return;
  state.recording = null;
  updateUi();
  if (active.recorder.state !== 'inactive') active.recorder.stop();
  await active.stoppedPromise;
}

/** @description Mount screenshot, session clip recording, and picture quality controls. @param {object} ctx Stage context. @returns {object} Media controller. */
export function mountSessionMedia(ctx) {
  const { $ } = ctx;
  const state = { quality: 'balanced', recording: null };
  const preset = () => QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.balanced;
  const updateUi = () => {
    $('recordClipBtn').textContent = state.recording ? 'Stop recording' : 'Record clip';
    $('recordClipBtn').setAttribute('aria-pressed', String(Boolean(state.recording)));
  };
  $('screenshotBtn').addEventListener('click', () => void takeScreenshot(ctx));
  $('recordClipBtn').addEventListener('click', () => void (state.recording ? stopRecording(state, updateUi) : startRecording(ctx, state, updateUi)));
  $('qualitySelect').addEventListener('change', () => {
    state.quality = QUALITY_PRESETS[$('qualitySelect').value] ? $('qualitySelect').value : 'balanced';
    void ctx.savePref({ quality: state.quality });
    ctx.restartFrameLoops();
    ctx.status(`Picture quality set to ${preset().label} (${preset().width}p).`);
  });
  return {
    frameWidth: () => preset().width,
    phoneFrameMs: () => preset().phoneMs,
    computerFrameMs: () => preset().computerMs,
    applyPreferences(prefs) {
      state.quality = QUALITY_PRESETS[prefs.quality] ? prefs.quality : 'balanced';
      $('qualitySelect').value = state.quality;
      updateUi();
      void refreshCapturesList(ctx);
    },
    resetForSelection() { void stopRecording(state, updateUi); void refreshCapturesList(ctx); },
    beforeEndSession: () => stopRecording(state, updateUi)
  };
}
