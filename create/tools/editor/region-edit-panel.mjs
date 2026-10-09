/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The region edit panel: before sending it states which region, layer and saved revision will be sent and what the configured image service costs; it saves pending edits first, follows the request, offers a side-by-side compare with explicit accept and reject, and lands an accepted candidate as one undoable step on the revision the person holds.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Full JSDoc tags on the provider query.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Require cost-consent v1, snapshot the displayed cost class before asynchronous save, and refresh a refused cap without automatically retrying or escalating.
 */
import { $, state, api, jsonRequest, notify, error, handle, subscribe, dirty } from './editor-state.mjs';
import { saveProject } from './editor-projects.mjs';
import { serializeProject } from './model.mjs';
import { resolveSelection, selectionSummary } from './region-select.mjs';

const panel = { edit: null, provider: null, providerError: '', timer: null, busy: false, accepted: null };
const KIND = { lasso: 'Lasso region', box: 'Box region', layer: 'Whole image' };
const FAILURES = {
  region_edit_provider_failed: 'The image service could not regenerate this region. Your project is unchanged.',
  region_edit_provider_timeout: 'The image service took too long. Your project is unchanged.',
  region_edit_provider_unavailable: 'Region regeneration is not configured on this server. Your project is unchanged.',
  region_edit_interrupted: 'The request was interrupted. Your project is unchanged; try again.',
  region_edit_cost_cap_exceeded: 'The image service cost changed or is unknown. Nothing was generated. Review the refreshed cost and choose Regenerate region again.',
  region_edit_result_invalid: 'The image service returned something that is not an image. Your project is unchanged.',
  project_permission_denied: 'Your access changed while regenerating, so nothing was kept.',
};
const path = (suffix = '') => `/projects/${state.id}/region-edits${suffix}`;

function stopPolling() { clearTimeout(panel.timer); panel.timer = null; }

/** Follow one request until it leaves generating; a different open project abandons the watch. */
function follow(edit) {
  stopPolling(); panel.edit = edit; notify();
  if (edit.status === 'failed' && edit.error === 'region_edit_cost_cap_exceeded') void loadRegionProvider();
  if (edit.status !== 'generating') return;
  panel.timer = setTimeout(() => {
    if (panel.edit?.id !== edit.id || state.id !== edit.projectId) return;
    api(path(`/${edit.id}`)).then(({ edit: next }) => { if (panel.edit?.id === edit.id) follow(next); })
      .catch(failure => { error(failure.message); panel.timer = setTimeout(() => follow(panel.edit), 2000); });
  }, 800);
}

/** @description Ask once which image service would answer and what it costs; asking never generates.
 * @returns {Promise<void>} Resolves after the panel re-renders with the answer or the reason it is unavailable. */
export async function loadRegionProvider() {
  if (!state.permissions.generate) return;
  try { panel.provider = await api('/region-edit-provider'); panel.providerError = ''; }
  catch (failure) { panel.provider = null; panel.providerError = failure.message; }
  notify();
}

function costText() {
  if (!state.permissions.generate) return 'Your role does not include region regeneration (project.generate).';
  if (panel.providerError) return panel.providerError;
  if (!panel.provider) return 'Checking the image service…';
  if (!panel.provider.configured) return 'Region regeneration is not configured on this server.';
  if (panel.provider.costConsentVersion !== 1) return 'This server does not support capped region regeneration. Update Create and refresh before generating.';
  if (!['free', 'paid'].includes(panel.provider.costClass)) return 'The image service reported an unknown cost class. Region regeneration is unavailable.';
  const cost = panel.provider.costClass === 'free' ? 'no charge per image' : 'charged per image to your account';
  return `Uses ${panel.provider.provider} · ${cost} · up to ${panel.provider.dailyCap} a day.`;
}

function summaryText() {
  if (!state.region) return 'Select a region of an image layer to change it.';
  try {
    const { layer } = resolveSelection(state.project, state.region), summary = selectionSummary(state.region);
    const revision = !state.id ? 'the project is saved first' : dirty() ? `your unsaved edits are saved first, then sent as revision ${state.revision + 1}` : `saved revision ${state.revision}`;
    return `${KIND[summary.kind]}, ${summary.width} × ${summary.height} source pixels of “${layer.name}”; ${revision}.`;
  } catch (failure) { return `Select the region again: ${failure.message}`; }
}

function statusText() {
  const edit = panel.edit;
  if (panel.accepted) return `Accepted as revision ${panel.accepted}. Undo returns to the previous image.`;
  if (!edit) return '';
  if (edit.status === 'generating') return 'Regenerating the region… You can keep editing.';
  if (edit.status === 'ready') return 'A candidate is ready. Compare it, then accept or reject it.';
  if (edit.status === 'failed') return FAILURES[edit.error] ?? 'Regeneration failed. Your project is unchanged.';
  return edit.status === 'cancelled' ? 'Cancelled. Your project is unchanged.' : 'Rejected. Your project is unchanged.';
}

function renderRegionPanel() {
  const edit = panel.edit, generating = edit?.status === 'generating', ready = edit?.status === 'ready';
  $('regionEditPanel').hidden = !state.region && !edit && !panel.accepted;
  $('regionSummary').textContent = summaryText(); $('regionCost').textContent = costText(); $('regionEditStatus').textContent = statusText();
  let usable = false; try { usable = Boolean(state.region && resolveSelection(state.project, state.region)); } catch { usable = false; }
  const capped = panel.provider?.costConsentVersion === 1 && ['free', 'paid'].includes(panel.provider.costClass);
  const sendable = usable && state.permissions.generate && state.permissions.change && panel.provider?.configured && capped && !generating && !ready;
  $('regionSend').disabled = panel.busy || state.loading || state.saving || !sendable;
  $('regionInstruction').disabled = !state.permissions.generate || generating;
  $('regionCancel').hidden = !generating; $('regionCancel').disabled = panel.busy;
  $('regionCompare').hidden = !ready; $('regionAccept').disabled = panel.busy || !ready || !state.permissions.change;
  $('regionReject').disabled = panel.busy || !ready;
  if (!ready && $('regionCompareDialog').open) $('regionCompareDialog').close();
}

async function busy(work) {
  panel.busy = true; notify();
  try { return await work(); } finally { panel.busy = false; notify(); }
}

/** Save pending edits so the request names a real saved revision, then send the region and the instruction. */
async function send() {
  const instruction = $('regionInstruction').value.trim();
  if (!instruction) throw new Error('Describe the change you want in this region.');
  resolveSelection(state.project, state.region);
  const maxCostClass = panel.provider?.costClass;
  if (!panel.provider?.configured || panel.provider.costConsentVersion !== 1 || !['free', 'paid'].includes(maxCostClass)) throw new Error(costText());
  await busy(async () => {
    if (!state.id || dirty()) await saveProject();
    panel.accepted = null;
    const { edit } = await api(path(), jsonRequest('POST', { sourceRevision: state.revision, selection: state.region, instruction, maxCostClass }));
    follow(edit);
  });
}

function openCompare() {
  const edit = panel.edit;
  $('regionBefore').src = `/api/create/project-assets/${edit.sourceAssetId}`; $('regionAfter').src = edit.resultAsset.src;
  $('regionCompareInstruction').textContent = edit.instruction;
  if (!$('regionCompareDialog').open) $('regionCompareDialog').showModal();
}

/** Accept on the revision this tab holds; the result joins local history so Undo can step back from it. */
async function accept() {
  await busy(async () => {
    if (dirty()) await saveProject();
    const { project } = await api(path(`/${panel.edit.id}/accept`), jsonRequest('POST', { baseRevision: state.revision }));
    state.project = state.history.commit(project.document); state.revision = project.revision;
    state.saved = serializeProject(project.document); state.conflict = false; state.saveFailed = false; state.region = null;
    stopPolling(); panel.edit = null; panel.accepted = project.revision; $('regionCompareDialog').close();
  });
}

async function close(action) {
  await busy(async () => { const { edit } = await api(path(`/${panel.edit.id}/${action}`), jsonRequest('POST', {})); stopPolling(); panel.edit = edit; });
  $('regionCompareDialog').close();
}

/** A different project, or a fresh one, never inherits another project's request or decision. */
function forgetForeign() {
  if ((panel.edit && panel.edit.projectId !== state.id) || (panel.accepted && !state.id)) { stopPolling(); panel.edit = null; panel.accepted = null; }
}

/** @description Wire the panel and its compare dialog to the shared editor state.
 * @returns {void} */
export function bindRegionEditPanel() {
  $('regionSend').onclick = handle(send);
  $('regionCancel').onclick = handle(() => close('cancel'));
  $('regionCompare').onclick = handle(openCompare);
  $('regionAccept').onclick = handle(accept);
  $('regionReject').onclick = handle(() => close('reject'));
  $('closeRegionCompare').onclick = () => $('regionCompareDialog').close();
  subscribe(forgetForeign); subscribe(renderRegionPanel); renderRegionPanel();
}
