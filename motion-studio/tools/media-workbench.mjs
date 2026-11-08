/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | RP-MOT-01 & RP-MOT-02: media upload helpers, Web Audio work-area playback synchronization, and composition motion-blur inspector helpers.
 */

export function formatAssetOption(asset) {
  if (asset.kind === 'video') return `Video · ${asset.width} × ${asset.height} · ${asset.id.slice(0, 8)}`;
  if (asset.kind === 'audio') return `Audio · ${Math.round((asset.audioSampleRate || 48000) / 100) / 10} kHz · ${asset.id.slice(0, 8)}`;
  return `${asset.width} × ${asset.height} · ${asset.id.slice(0, 8)}`;
}

export function layerSupportsAudio(layer, items, assetById) {
  if (!layer) return false;
  if (layer.source?.type === 'Comp') return true;
  if (layer.source?.type !== 'Footage') return false;
  const item = items?.[layer.source.id];
  const path = item?.kind?.path;
  const match = typeof path === 'string' && /^oshal-asset:([^@]+)@[0-9a-f]{64}$/.exec(path);
  if (match && assetById?.has(match[1])) return Boolean(assetById.get(match[1]).hasAudio);
  const fKind = item?.kind?.kind;
  if (fKind === 'Audio' || fKind?.type === 'Audio' || fKind?.Audio) return true;
  if (fKind?.has_audio !== undefined) return Boolean(fKind.has_audio);
  if (fKind?.Video?.has_audio !== undefined) return Boolean(fKind.Video.has_audio);
  return false;
}

export function paintCompMotionBlur($, currentComp, state) {
  const form = $('compMotionBlur')?.elements;
  if (!form) return;
  const enabled = Boolean(currentComp?.enable_motion_blur ?? currentComp?.motion_blur);
  const shutterAngle = String(currentComp?.shutter_angle ?? 180);
  const shutterPhase = String(currentComp?.shutter_phase ?? -90);
  const samples = String(currentComp?.motion_blur_samples ?? 16);
  form.enabled.checked = enabled;
  form.shutterAngle.value = shutterAngle;
  form.shutterPhase.value = shutterPhase;
  form.samples.value = samples;
  state.blurFields = { enabled, shutterAngle, shutterPhase, samples };
}

export function buildCompMotionBlurCommands($, compId, state) {
  const form = $('compMotionBlur').elements;
  const initial = state.blurFields ?? { enabled: false, shutterAngle: '180', shutterPhase: '-90', samples: '16' };
  const commands = [];
  if (form.enabled.checked !== initial.enabled) {
    commands.push({ command: 'comp.setSwitch', params: { comp: compId, switch: 'motionBlur', value: form.enabled.checked } });
  }
  const settings = {};
  if (form.shutterAngle.value !== initial.shutterAngle) {
    const angle = Number(form.shutterAngle.value);
    if (!form.shutterAngle.value.trim() || !Number.isFinite(angle) || angle < 0 || angle > 720) {
      throw new Error('Enter a shutter angle between 0 and 720 degrees.');
    }
    settings.shutterAngle = angle;
  }
  if (form.shutterPhase.value !== initial.shutterPhase) {
    const phase = Number(form.shutterPhase.value);
    if (!form.shutterPhase.value.trim() || !Number.isFinite(phase) || phase < -360 || phase > 360) {
      throw new Error('Enter a shutter phase between -360 and 360 degrees.');
    }
    settings.shutterPhase = phase;
  }
  if (form.samples.value !== initial.samples) {
    const samples = Number(form.samples.value);
    if (!form.samples.value.trim() || !Number.isInteger(samples) || samples < 2 || samples > 64) {
      throw new Error('Enter whole motion-blur samples between 2 and 64.');
    }
    settings.motionBlurSamples = samples;
  }
  if (Object.keys(settings).length) {
    commands.push({ command: 'comp.settings', params: { comp: compId, ...settings } });
  }
  return commands;
}

export async function uploadAndImportFile(inputEl, { state, api, apply }) {
  const file = inputEl.files?.[0];
  inputEl.value = '';
  if (!file) return;
  const epoch = state.epoch, projectId = state.project?.id;
  const form = new FormData();
  form.append('file', file);
  const { asset } = await api('/assets', { method: 'POST', body: form });
  if (epoch !== state.epoch || projectId !== state.project?.id) return;
  await apply([{ command: 'asset.import', params: { assetId: asset.id, name: file.name } }]);
}

function decodeBase64Bytes(b64) {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export function createPreviewAudioPlayer(api) {
  let audioCtx = null, activeSource = null, playToken = 0;
  function stop() {
    playToken++;
    if (!activeSource) return;
    try { activeSource.stop(); } catch { /* already stopped */ }
    try { activeSource.disconnect(); } catch { /* disconnected */ }
    activeSource = null;
  }
  async function start({ projectId, revision, compId, startTicks, endTicks, loop, signal, state }) {
    stop();
    const token = ++playToken;
    const compSegment = compId === undefined || compId === null ? 'auto' : String(compId);
    const maxWindow = BigInt(endTicks) - BigInt(startTicks) > 20n * 254016000000n
      ? String(BigInt(startTicks) + 20n * 254016000000n)
      : String(endTicks);
    const res = await api(`/projects/${projectId}/revisions/${revision}/audio/${compSegment}/${startTicks}/${maxWindow}`, { signal });
    if (token !== playToken || signal?.aborted) return;
    state.lastAudioPreview = { hasAudio: Boolean(res.hasAudio), peaks: res.peaks ?? [] };
    if (!res.hasAudio || !res.wav) return;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return;
    try {
      audioCtx ??= new Ctor();
      if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});
      const buffer = await audioCtx.decodeAudioData(decodeBase64Bytes(res.wav));
      if (token !== playToken || signal?.aborted) return;
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.loop = Boolean(loop);
      source.connect(audioCtx.destination);
      source.start(0);
      activeSource = source;
    } catch {
      /* Headless or autoplay-restricted browsers keep visual frame playback running cleanly */
    }
  }
  return { start, stop };
}
