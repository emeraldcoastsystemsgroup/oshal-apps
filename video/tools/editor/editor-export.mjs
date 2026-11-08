/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The export panel of the manual video editor (CREATE-EDIT-05d): render the last SAVED revision as an MP4 or a low-resolution FFmpeg preview, follow its progress, cancel it, and offer the verified file for download or inline playback. Polling only reads a job; it never creates or retries one.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Support 720p, 1080p and 4K exports at 30 fps or 60 fps (RP-VID-09).
 */
import { call, describe, exportUrl } from './editor-api.mjs';

const PROFILE_TO_OPTIONS = Object.freeze({
  hd720p30: { resolution: '720p', fps: 30 },
  hd720p60: { resolution: '720p', fps: 60 },
  hd1080p30: { resolution: '1080p', fps: 30 },
  hd1080p60: { resolution: '1080p', fps: 60 },
  uhd4k30: { resolution: '4k', fps: 30 },
  uhd4k60: { resolution: '4k', fps: 60 },
});

export function optionsFromProfile(profile) {
  return { ...(PROFILE_TO_OPTIONS[profile] ?? PROFILE_TO_OPTIONS.hd720p30) };
}

/**
 * @description Build the export panel.
 * @param {object} nodes exportButton, previewButton, cancel, progress, status, download and watch elements.
 * @param {() => {projectId: string|null, revision: number|null, dirty: boolean, canExport: boolean, profile?: string}} stateOf Current editor state.
 * @returns {{refresh: Function, start: Function, cancel: Function, setOptions: Function, getOptions: Function}} Controls.
 */
export function createExporter(nodes, stateOf) {
  let job = null, timer = 0, options = { resolution: '720p', fps: 30 };
  const running = () => !!job && (job.status === 'queued' || job.status === 'running');

  function setOptions(patch = {}) {
    if (patch.resolution) options = { ...options, resolution: patch.resolution };
    if (patch.fps) options = { ...options, fps: Number(patch.fps) };
  }
  function getOptions() {
    const state = stateOf();
    if (state?.profile && PROFILE_TO_OPTIONS[state.profile]) options = optionsFromProfile(state.profile);
    return { ...options };
  }
  function refresh() {
    const state = stateOf(), ready = state.canExport && !!state.projectId && !state.dirty && !running();
    nodes.exportButton.disabled = !ready; nodes.previewButton.disabled = !ready; nodes.cancel.hidden = !running();
    if (!state.canExport) nodes.hint.textContent = 'Your access does not include exporting.';
    else if (!state.projectId || state.dirty) nodes.hint.textContent = 'Save first: an export renders the last saved version.';
    else nodes.hint.textContent = `Renders saved revision ${state.revision}.`;
  }
  function show(row) {
    job = row;
    const frames = row.progressFrames ?? 0;
    nodes.progress.hidden = !running(); nodes.progress.max = row.totalFrames; nodes.progress.value = Math.min(frames, row.totalFrames);
    const label = row.variant === 'preview' ? 'Preview' : 'Export';
    nodes.status.textContent = row.status === 'succeeded' ? `${label} ready.` : row.status === 'cancelled' ? `${label} cancelled.`
      : row.status === 'failed' || row.status === 'interrupted' ? `${label} failed: ${describe({ code: row.error })}`
        : `${label} ${row.status === 'queued' ? 'waiting to start' : 'rendering'}… ${frames} of ${row.totalFrames} frames`;
    nodes.download.hidden = row.status !== 'succeeded'; nodes.watch.hidden = row.status !== 'succeeded';
    if (row.status === 'succeeded') { nodes.download.href = exportUrl(row.id); nodes.watch.href = exportUrl(row.id, true); }
    refresh();
  }
  async function poll() {
    clearTimeout(timer);
    try { show((await call(`/exports/${job.id}`)).export); }
    catch (error) { nodes.status.textContent = describe(error); }
    if (running()) timer = setTimeout(poll, 500);
  }
  async function start(variant) {
    const state = stateOf();
    if (!state.projectId || state.dirty) return;
    const chosen = getOptions();
    const body = variant === 'export'
      ? { revision: state.revision, variant, resolution: chosen.resolution, fps: chosen.fps }
      : { revision: state.revision, variant };
    nodes.status.textContent = 'Starting…';
    try { show((await call(`/projects/${state.projectId}/exports`, { method: 'POST', body })).export); poll(); }
    catch (error) { nodes.status.textContent = describe(error); refresh(); }
  }
  async function cancel() {
    if (!running()) return;
    try { show((await call(`/exports/${job.id}/cancel`, { method: 'POST', body: {} })).export); poll(); }
    catch (error) { nodes.status.textContent = describe(error); }
  }
  nodes.exportButton.addEventListener('click', () => start('export'));
  nodes.previewButton.addEventListener('click', () => start('preview'));
  nodes.cancel.addEventListener('click', cancel);
  return { refresh, start, cancel, setOptions, getOptions };
}
