/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preview real archives and require typed confirmation of exact owned evidence before importing shared reference bars.
 */
function futuresArchiveControls() {
  return '<details class="panel"><summary>Import Futures archives into the shared bar store</summary>' +
    '<p>Uses the roots, server directory, minimum volume and UTC date range above, without saving or running a study. Raw dated-contract front-month bars only; no continuous adjustment, orders or provider use.</p>' +
    '<label class="f">Confirmed archive wall-clock zone<select id="futArchiveZone"><option value="">Select the archive clock</option><option value="UTC">UTC</option><option value="America/New_York">America/New_York</option><option value="America/Chicago">America/Chicago</option></select></label>' +
    '<label><input type="checkbox" id="futArchiveHourly" checked /> 1Hour from minute/CONTRACT.txt</label> ' +
    '<label><input type="checkbox" id="futArchiveDaily" checked /> 1Day from daily/CONTRACT.txt</label>' +
    '<p class="foot">Stored times are true UTC bar opens. Daily files mean local calendar days, not exchange settlement. Completeness uses the instrument/session model, not proof of a complete vendor download. Missing contracts and gaps stay visible. At most one million bars per import; split larger ranges.</p>' +
    '<button class="btn ghost" id="futArchivePreview">Preview archive import (no shared-bar writes)</button> ' +
    '<button class="btn ghost" id="futArchiveRefresh">Refresh import receipts</button>' +
    '<label class="f">After inspecting a ready preview, type IMPORT SHARED FUTURES BARS, then select its import button<input id="futArchiveConfirmation" autocomplete="off" /></label>' +
    '<div class="foot">This adds shared reference data for all users. Existing prices or different source clocks are never silently replaced. The source is re-read and must match the preview. A failure rolls back every new bar.</div>' +
    '<div id="futArchiveMsg" class="sub"></div><div id="futArchiveJobs"></div></details>';
}
function futuresArchiveForm() {
  const timeframes = [];
  if ($('futArchiveHourly').checked) timeframes.push('1Hour');
  if ($('futArchiveDaily').checked) timeframes.push('1Day');
  return { roots: $('futRoots').value.split(',').map(value => value.trim()).filter(Boolean), dataDir: $('futDir').value.trim(),
    minVolume: Number($('futVolume').value), sourceTimeZone: $('futArchiveZone').value,
    timeframes, start: $('futStart').value, end: $('futEndMode').value === 'latest' ? new Date(Date.now() - 86400000).toISOString().slice(0,10) : $('futEnd').value };
}
function futuresArchiveCard(job) {
  const plan = job.plan;
  return '<details class="panel"><summary>' + esc(job.createdAt) + ' · ' + esc(job.status) + ' · ' + esc(job.config.roots.join(', ')) + '</summary>' +
    (job.error ? '<p class="err">' + esc(job.error) + '</p>' : '') +
    (plan ? '<p>' + esc(plan.totalBars) + ' previewed bars; ' + esc(plan.incomplete) + ' contract/timeframe series below the completeness threshold.</p>' : '') +
    (job.status === 'completed' ? '<p>Committed ' + esc(job.inserted) + ' new bars; ' + esc(job.unchanged) + ' identical bars unchanged. No trading action.</p>' : '') +
    '<pre style="white-space:pre-wrap;max-height:320px;overflow:auto">' + esc(JSON.stringify({ importId: job.importId, config: job.config, plan }, null, 2)) + '</pre>' +
    (job.status === 'ready' ? '<button class="btn primary" data-futures-import="' + esc(job.importId) + '">Import this exact preview</button>' : '') + '</details>';
}
function wireFuturesArchive() {
  $('futArchivePreview').onclick = () => void previewFuturesArchiveFromConsole($('futArchivePreview'));
  $('futArchiveRefresh').onclick = () => void loadFuturesArchiveImports();
}
async function loadFuturesArchiveImports() {
  const token = RENDER_TOKEN, gen = tabGen();
  try {
    const result = await api('/autopilot/futures/archive');
    if (stale(token) || tabStale(gen)) return;
    const rows = result.imports || [], host = $('futArchiveJobs');
    host.innerHTML = rows.map(futuresArchiveCard).join('') || '<div class="foot">No archive import receipts yet.</div>';
    host.onclick = event => {
      const button = event.target.closest('[data-futures-import]');
      if (!button || !host.contains(button)) return;
      const job = rows.find(row => row.importId === button.dataset.futuresImport);
      if (job?.status === 'ready') void confirmFuturesArchiveFromConsole(job, button);
    };
  } catch (error) { if (!stale(token) && !tabStale(gen)) $('futArchiveMsg').textContent = error.message; }
}
async function previewFuturesArchiveFromConsole(button) {
  const token = RENDER_TOKEN, gen = tabGen(); button.disabled = true;
  try {
    await api('/autopilot/futures/archive/preview', jbody('POST', futuresArchiveForm()));
    if (stale(token) || tabStale(gen)) return;
    $('futArchiveConfirmation').value = '';
    $('futArchiveMsg').textContent = 'Preview admitted. Refresh receipts for coverage and the exact fingerprint; no shared bars have been written.';
    await loadFuturesArchiveImports();
  } catch (error) { if (!stale(token) && !tabStale(gen)) $('futArchiveMsg').textContent = error.message; }
  finally { button.disabled = false; }
}
async function confirmFuturesArchiveFromConsole(job, button) {
  const confirmation = $('futArchiveConfirmation').value;
  if (confirmation !== 'IMPORT SHARED FUTURES BARS') { $('futArchiveMsg').textContent = 'Type the exact confirmation after inspecting this preview.'; return; }
  const token = RENDER_TOKEN, gen = tabGen(); button.disabled = true;
  try {
    await api('/autopilot/futures/archive/' + encodeURIComponent(job.importId) + '/import', jbody('POST', { confirmation, fingerprint: job.plan.fingerprint }));
    if (stale(token) || tabStale(gen)) return;
    $('futArchiveConfirmation').value = '';
    $('futArchiveMsg').textContent = 'Import admitted. Refresh receipts for the atomic commit result. Research settings and orders are unchanged.';
    await loadFuturesArchiveImports();
  } catch (error) { if (!stale(token) && !tabStale(gen)) $('futArchiveMsg').textContent = error.message; }
  finally { button.disabled = false; }
}
