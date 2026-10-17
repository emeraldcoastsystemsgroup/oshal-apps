/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Separate Futures console lifecycle and owner evidence from equity strategies before adding forward controls.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Display computed/reused/unassessed optimizer receipts separately from research verdicts.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Round-trip opt-in source alerts and distinguish claimed, delivered, skipped and uncertain receipts.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Show read-only, owner-bound Schwab dated-contract quote and OHLCV capability separately from research-source readiness.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Round-trip ES/CL and bounded cadence controls for private forward capture, with explicit status/stop and no automatic study enablement.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Preview and explicitly confirm bounded current-contract catch-up from the connected owner.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Expose owner-private Schwab capture as a guarded historical research source without implying archive completeness or forward prediction support.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | On the native kernel (native_executor_unavailable) the Futures panel says once that the research loop is not available on this installation yet and disables its controls, instead of offering buttons that each answered "this is not available right now".
 * 9 | maintainer@emeraldcoastsystemsgroup.com | On the native kernel the panel shows the saved Schwab study and its last run (GET answers native:true), offers the Schwab connection as the default source with a note on its history, and keeps the run ledger rendering it already had.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | On the native kernel with no saved study the form starts at Schwab-sized defaults (ES,CL, 1Hour over 1Day, start 120 days back, 3/1/1 split) instead of the archive defaults (2021, 24-month in-sample) the Schwab history cannot fill.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Native nightly schedule: Save / enable and Resume activate the person's own futures-research schedule in the kernel, Pause and Stop deactivate it (Stop also deletes the study), and the status line reads the schedule's state and next run.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | On the native kernel the capture, catch-up and archive-import controls and the forward-call contract map and clock zone are hidden with the reason (the study reads Schwab directly); Check ES/CL and forward calls work natively.
 */
function syncFuturesResearchSource() {
  const live = $('futSource').value === 'schwab';
  const captured = live || $('futSource').value === 'schwab-capture';
  $('futDir').disabled = captured;
  const note = $('futSourceNote');
  if (note) note.textContent = live
    ? 'Reads ES/CL dated contracts from your Schwab connection: 30-minute bars combined into hours for the chart, daily or weekly bars for the higher timeframe. Schwab keeps months of intraday history for current contracts, so keep Start within the last few months and the split short (3 months in-sample, 1 out-of-sample).'
    : captured
    ? 'Reads only your stored dated ES/CL bars. Choose 1Hour or 1Day for both timeframes; no container directory is used. Missing session bars or a roll without overlapping contracts stop the study before optimization. Forward calls still require Kibot files and cannot be enabled here.'
    : 'File archives need a path mounted inside the API container. The Kibot API endpoint has not been verified.';
}
function futuresForm() {
  let grids = {};
  const raw = $('futGrids').value.trim();
  if (raw) grids = JSON.parse(raw);
  return { roots: $('futRoots').value.split(',').map(s => s.trim()).filter(Boolean), nightlyCron: $('futCron').value.trim(), timeframe: $('futTf').value, ltfTimeframe: $('futLtf').value, source: $('futSource').value, dataDir: $('futSource').value === 'schwab-capture' ? '' : $('futDir').value.trim(), adjust: $('futAdjust').value, minVolume: Number($('futVolume').value), start: $('futStart').value + 'T00:00:00Z', endMode: $('futEndMode').value, end: $('futEnd').value + 'T23:59:59Z', split: { inSampleMonths: Number($('futIs').value), oosMonths: Number($('futOos').value), stepMonths: Number($('futStep').value) }, stageGrids: grids,
    quality: { maxSourceLagDays: Number($('futMaxLag').value), minOosTradesPerWindow: Number($('futMinTrades').value) }, nightlyReview: $('futNightlyReview').checked, sourceAlerts: $('futSourceAlerts').checked, predictions: futuresPredictionForm() };
}
function fillFuturesForm(c) {
  if (!c) return;
  $('futRoots').value = (c.roots || []).join(','); $('futCron').value = c.nightlyCron || '0 2 * * *'; $('futTf').value = c.timeframe || '1Hour'; $('futLtf').value = c.ltfTimeframe || '1Day'; $('futSource').value = c.source || 'schwab'; $('futDir').value = c.dataDir || '';
  $('futStart').value = String(c.start || '2021-01-01').slice(0,10); $('futEndMode').value = c.endMode || 'fixed'; $('futEnd').value = String(c.end || '2025-12-31').slice(0,10); $('futEnd').disabled = $('futEndMode').value !== 'fixed'; $('futIs').value = c.split?.inSampleMonths || 24; $('futOos').value = c.split?.oosMonths || 6; $('futStep').value = c.split?.stepMonths || 6; $('futGrids').value = c.stageGrids && Object.keys(c.stageGrids).length ? JSON.stringify(c.stageGrids, null, 2) : '';
  $('futVolume').value = c.minVolume || 1; $('futAdjust').value = c.adjust || 'panama';
  $('futMaxLag').value = c.quality?.maxSourceLagDays ?? 7; $('futMinTrades').value = c.quality?.minOosTradesPerWindow ?? 10;
  $('futNightlyReview').checked = c.nightlyReview === true;
  $('futSourceAlerts').checked = c.sourceAlerts === true;
  fillFuturesPredictionForm(c.predictions);
  syncFuturesResearchSource();
}
function futuresSourceAlertCard(receipt) {
  if (!receipt) return '';
  const labels = { disabled: 'off for this run', ready: 'pending attempt (not delivered)', claimed: 'attempt claimed; delivery unconfirmed', delivered: 'delivered', skipped: 'skipped (not delivered)', failed: 'send failed; not confirmed', unknown: 'delivery unknown; no automatic retry' };
  return '<div class="foot">Source notification: ' + esc(labels[receipt.status] || 'not assessed') +
    (receipt.channel ? ' · channel ' + esc(receipt.channel) : '') + (receipt.fallbackFrom ? ' (fallback from ' + esc(receipt.fallbackFrom) + ')' : '') +
    (receipt.reason ? ' · ' + esc(receipt.reason) : '') + '</div><details><summary>Source notification receipt</summary><pre style="white-space:pre-wrap">' + esc(JSON.stringify(receipt, null, 2)) + '</pre></details>';
}
/* The native kernel has no Futures scheduler yet: say so once and disable this panel's controls, rather than
   offer buttons that cannot run (each answered "this is not available right now"). */
function futuresUnavailable() {
  const status = $('futStatus'); if (!status) return;
  status.innerHTML = '<div class="why">' + esc('The Futures research loop is not available on this installation yet: its scheduler has not been ported to the native kernel, so nothing in this panel can run. Your paper and live accounts are not affected.') + '</div>';
  const panel = status.closest('.panel');
  if (panel) panel.querySelectorAll('button, input, select, textarea').forEach((el) => { el.disabled = true; });
  const capture = $('futSchwabCaptureStatus'); if (capture) capture.textContent = '';
}
/* Native kernel: the person's own futures-research schedule lives in the kernel (GET /api/v1/agent/schedules);
   Save / enable and Resume activate it, Pause and Stop deactivate it, as the paper autopilot's button does. */
let FUT_KERNEL = null;
const FUT_ACTIVATION = { class: 'person', configuration: { runBudgetMicros: 1000000, dailyBudgetMicros: 2000000, timeoutMs: 300000 } };
async function futuresKernel(path, opts) {
  const r = await fetch(path, Object.assign({ credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }, opts || {}));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.message || j.error || ('HTTP ' + r.status));
  return j;
}
async function futuresScheduleRow() {
  if (!FUT_KERNEL) return null;
  const j = await futuresKernel('/api/v1/agent/schedules');
  return (j.schedules || j.jobs || []).find((s) => s.app === FUT_KERNEL.app && s.name === FUT_KERNEL.name) || null;
}
const futuresScheduleActive = (row) => Boolean(row && row.activation && row.status === 'active');
async function futuresSetSchedule(on) {
  const row = await futuresScheduleRow();
  if (!row) throw new Error('Your futures-research schedule is not listed yet; reload the page and try again.');
  if (on && !futuresScheduleActive(row)) await futuresKernel('/api/v1/agent/schedules/' + encodeURIComponent(row.id) + '/activate', { method: 'POST', body: JSON.stringify(FUT_ACTIVATION) });
  if (!on && futuresScheduleActive(row)) await futuresKernel('/api/v1/agent/schedules/' + encodeURIComponent(row.id) + '/deactivate', { method: 'POST', body: '{}' });
}
/* Native kernel: every run reads Schwab directly, so capture, catch-up and archive import have nothing to do; the
   forward-call contract map and clock zone are the live contract and New York. Hide those controls and say why. */
function nativeFuturesPanels(note) {
  const hide = (el) => { if (el) el.style.display = 'none'; };
  ['futSchwabStart', 'futSchwabRun', 'futSchwabStop'].forEach((id) => hide($(id)));
  hide($('futSchwabCadence') && $('futSchwabCadence').closest('label'));
  hide($('futSchwabBackfillFrom') && $('futSchwabBackfillFrom').closest('.panel'));
  hide($('futArchiveZone') && $('futArchiveZone').closest('details'));
  hide($('futPredContracts') && $('futPredContracts').closest('label'));
  hide($('futPredZone') && $('futPredZone').closest('label'));
  const cap = $('futSchwabCaptureStatus'); if (cap) cap.textContent = note || '';
  const fs = $('futPredEnabled') && $('futPredEnabled').closest('fieldset'), sub = fs && fs.querySelector('.sub');
  if (sub) sub.textContent = 'Off by default. Reads the live dated contract from your Schwab connection; no orders, rolling, probabilities or profit promises. After each run with computed evidence, the locked strategy freezes a long/short bias (or records an abstention) and grades it later against the first completed same-contract bar in its target window.';
}
async function paintFuturesSchedule(j, token, gen) {
  let line;
  try {
    const row = await futuresScheduleRow();
    const active = futuresScheduleActive(row);
    line = 'Nightly schedule: <strong class="' + (active ? 'ok' : 'warn') + '">' + (active ? 'ACTIVE' : (row && row.activation ? 'SUSPENDED' : 'NOT ENABLED')) + '</strong> · ' + esc(j.schedule.cron) + (row && row.nextRunAt ? ' · next ' + esc(fmtDate(row.nextRunAt)) : '');
  } catch (e) { line = 'Nightly schedule status unavailable: ' + esc(e.message); }
  if (stale(token) || tabStale(gen)) return;
  const el = $('futScheduleLine'); if (el) el.innerHTML = line;
}
/* The native study reads months, not years, of Schwab intraday history: start it a few months back with a short split. */
function fillNativeFuturesDefaults() {
  $('futSource').value = 'schwab'; $('futRoots').value = 'ES,CL'; $('futTf').value = '1Hour'; $('futLtf').value = '1Day';
  $('futStart').value = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  $('futIs').value = 3; $('futOos').value = 1; $('futStep').value = 1; $('futMinTrades').value = 3;
  syncFuturesResearchSource();
}
async function loadFuturesResearch() {
  const token = RENDER_TOKEN, gen = tabGen();
  try {
    const j = await api('/autopilot/futures');
    if (stale(token) || tabStale(gen)) return;
    FUT_KERNEL = j.native ? j.kernelSchedule || null : null;
    if (j.native) nativeFuturesPanels('Not needed on this installation: the Futures study reads your Schwab connection directly on every run, so there are no private bars to capture, catch up or import. Check ES/CL still shows what Schwab serves.');
    fillFuturesForm(j.schedule?.config);
    if (j.native && !j.schedule) fillNativeFuturesDefaults();
    $('futStatus').innerHTML = j.native
      ? (j.schedule ? '<div class="foot">Futures study saved · source Schwab · last run ' + esc(j.schedule.lastRunAt ? fmtDate(j.schedule.lastRunAt) : 'never') + '</div><div class="foot" id="futScheduleLine">Nightly schedule: checking…</div><div class="foot">' + esc(j.note || '') + '</div>' : '<div class="why">No Futures study saved yet. Choose roots and a window, then Save and Run once. ' + esc(j.note || '') + '</div>')
      : j.schedule
      ? '<div class="foot">Futures loop: <strong class="' + (j.enabled ? 'ok' : 'warn') + '">' + (j.enabled ? 'ACTIVE' : 'PAUSED') + '</strong> · UTC cron ' + esc(j.schedule.cron) + ' · next ' + esc(j.schedule.nextRunAt ? fmtDate(j.schedule.nextRunAt) : '—') + '</div>'
      : '<div class="why">No Futures research loop configured yet.</div>';
    const rows = j.runs || [];
    $('futRuns').innerHTML = rows.length ? '<div class="foot" style="margin-bottom:6px">RECENT FUTURES RESEARCH RUNS</div>' + rows.map(r => {
      const net = (r.markets || []).reduce((n, m) => n + Number(m.outOfSampleNet || 0), 0);
      const markets = (r.markets || []).map(m => m.root + ' (' + m.outOfSampleTrades + ' OOS trades)').join(', ');
      const evidence = (r.markets || []).map(m => ({ root: m.root, bars: m.bars, ltfBars: m.ltfBars, ltfResampledFromMinute: m.ltfResampledFromMinute, chartAsOf: m.chartAsOf, ltfAsOf: m.ltfAsOf, latestCompleteOosEnd: m.latestCompleteOosEnd, evidenceFingerprint: m.evidenceFingerprint, quality: m.quality ?? null, computation: m.computation ?? null, report: m.report }));
      return '<details class="panel" style="margin-bottom:6px"><summary>' + esc(fmtDate(r.createdAt)) + ' · ' + esc(r.status === 'unchanged' ? 'unchanged OOS evidence' : r.status === 'insufficient_sample' ? 'insufficient OOS sample' : r.status) + ' · ' + esc(markets || r.error || 'waiting for results') + (evidence.length ? ' · OOS ' + money(net) : ' · OOS not computed') + '</summary>' +
        (r.error ? '<div class="foot err">' + esc(r.error) + '</div>' : '') +
        futuresSourceAlertCard(r.sourceAlert) +
        evidence.map(m => '<div class="foot">' + esc(m.root) + ' optimizer: ' + esc(m.computation?.status === 'reused' ? 'report reused from run ' + m.computation.reusedFromRunId : m.computation?.status === 'computed' ? 'computed this run' : 'not assessed (no computation receipt)') + '</div>').join('') +
        (r.predictionCycle ? '<div class="foot">Forward cycle: ' + esc(r.predictionCycle.status) + ' · ' + esc(r.predictionCycle.error || ('new receipts ' + r.predictionCycle.inserted + ', checked ' + r.predictionCycle.checked)) + '</div>' : '') +
        (evidence.length ? '<pre style="white-space:pre-wrap;max-height:360px;overflow:auto">' + esc(JSON.stringify({ runId: r.runId, config: r.config, markets: evidence }, null, 2)) + '</pre>' : '') + futuresReviewCard(r) + '</details>';
    }).join('') : '';
    wireFuturesReviews(rows);
    if (j.native && j.schedule) paintFuturesSchedule(j, token, gen);
  } catch (e) {
    if (stale(token) || tabStale(gen)) return;
    if (e.code === 'native_executor_unavailable') { futuresUnavailable(); return; }
    $('futStatus').innerHTML = '<div class="foot err">' + esc(e.message) + '</div>';
  }
}
async function saveFuturesResearch() { const msg = $('futMsg'); try { const j = await api('/autopilot/futures', jbody('POST', futuresForm()));
  if (j.native) { FUT_KERNEL = j.kernelSchedule || FUT_KERNEL; await futuresSetSchedule(true); msg.className='sub ok'; msg.textContent='Saved and scheduled: your Futures study runs nightly at 02:15 New York (Tuesday to Saturday). Research only; nothing places an order.'; await loadFuturesResearch(); return; }
  msg.className='sub ok'; msg.textContent='Saved — Futures research loop is ' + (j.enabled ? 'active' : 'paused') + '. Results stay paper/research-only until separately reviewed.'; await loadFuturesResearch(); } catch (e) { msg.className='sub err'; msg.textContent=e.message; } }
async function futuresAction(action) { const msg = $('futMsg'); try {
  if (FUT_KERNEL && action !== 'run') {
    await futuresSetSchedule(action === 'resume');
    if (action === 'stop') await api('/autopilot/futures', { method: 'DELETE' });
    msg.className='sub ok'; msg.textContent = action === 'resume' ? 'Nightly Futures schedule resumed.' : action === 'pause' ? 'Nightly Futures schedule paused; Run once still works.' : 'Futures study stopped and its schedule switched off; past runs stay listed.';
    await loadFuturesResearch(); return;
  } const path = action === 'stop' ? '/autopilot/futures' : '/autopilot/futures/' + action; const j = await api(path, { method: action === 'stop' ? 'DELETE' : 'POST' }); msg.className='sub ok'; msg.textContent = action === 'run' ? 'Research run accepted as ' + (j.result?.taskId || 'pending') + '; refresh for its final evidence.' : action === 'stop' ? 'Futures research loop stopped.' : 'Futures research loop ' + action + 'd.'; await loadFuturesResearch(); } catch (e) { msg.className='sub err'; msg.textContent=e.message; } }
/** A provider quote cannot be mistaken for a dated-contract bar or a working collector. */
async function probeSchwabFuturesFromConsole(button) {
  const token = RENDER_TOKEN, gen = tabGen(), target = $('futSchwabProbeResult');
  button.disabled = true;
  target.textContent = 'Checking the connected Schwab account…';
  try {
    const result = await api('/autopilot/futures/sources/schwab/probe');
    if (stale(token) || tabStale(gen)) return;
    target.textContent = (result.roots || []).map(root =>
      root.root + ' ' + root.datedContract + ': quote ' + root.quote?.state +
      '; 30-minute bars ' + root.minute?.state + ' (' + (root.minute?.bars ?? 0) + ', volume ' + (root.minute?.volumeBars ?? 0) + ')' +
      '; daily bars ' + root.daily?.state + ' (' + (root.daily?.bars ?? 0) + ')' +
      '; forward-bar candidate ' + (root.forwardBarCandidate ? 'yes — check capture status below' : 'no')
    ).join('\n') + '\n' + (result.note || '');
  } catch (error) {
    if (!stale(token) && !tabStale(gen)) target.textContent = 'Schwab check unavailable: ' + error.message;
  } finally { button.disabled = false; }
}

function schwabCaptureForm() {
  return { roots: $('futSchwabRoots').value.split(','), cadence: $('futSchwabCadence').value };
}
let schwabBackfillPlan = null;
function schwabBackfillForm() {
  return { roots: $('futSchwabRoots').value.split(','), fromDate: $('futSchwabBackfillFrom').value,
    throughDate: $('futSchwabBackfillThrough').value };
}
async function previewSchwabBackfill(button) {
  const token = RENDER_TOKEN, gen = tabGen(), target = $('futSchwabBackfillStatus');
  schwabBackfillPlan = null;
  $('futSchwabBackfillRun').disabled = true;
  button.disabled = true;
  target.textContent = 'Checking selected UTC range…';
  try {
    const result = await api('/autopilot/futures/sources/schwab/capture/backfill/preview', jbody('POST', schwabBackfillForm()));
    if (stale(token) || tabStale(gen)) return;
    schwabBackfillPlan = result.plan;
    $('futSchwabBackfillRun').disabled = false;
    target.textContent = 'Preview: ' + result.plan.fromDate + ' through ' + result.plan.throughDate + ' UTC · ' +
      result.plan.contracts.map(row => row.symbol).join(', ') + ' · at most ' + result.plan.requestCount +
      ' Schwab requests. These are today\'s dated contracts, not a front-month archive. Confirm to fetch.';
  } catch (error) { if (!stale(token) && !tabStale(gen)) target.textContent = 'Catch-up preview unavailable: ' + error.message; }
  finally { button.disabled = false; }
}
async function runSchwabBackfill(button) {
  const token = RENDER_TOKEN, gen = tabGen(), target = $('futSchwabBackfillStatus');
  if (!schwabBackfillPlan?.fingerprint) { target.textContent = 'Preview the exact range first.'; return; }
  button.disabled = true;
  target.textContent = 'Fetching closed private bars for the confirmed range…';
  try {
    const result = await api('/autopilot/futures/sources/schwab/capture/backfill',
      jbody('POST', { ...schwabBackfillForm(), confirmation: schwabBackfillPlan.fingerprint }));
    if (stale(token) || tabStale(gen)) return;
    schwabBackfillPlan = null;
    target.textContent = 'Catch-up complete: ' + (result.receipt?.series || []).map(row =>
      row.symbol + ' +' + row.inserted + ' new / ' + row.received + ' received').join(', ') + '. Existing bars were retained.';
    await loadSchwabCaptureStatus();
  } catch (error) { if (!stale(token) && !tabStale(gen)) target.textContent = 'Catch-up failed: ' + error.message; }
  finally { button.disabled = !schwabBackfillPlan; }
}
/** Status contains only counts and session-model diagnostics, never market-data rows. */
async function loadSchwabCaptureStatus() {
  const token = RENDER_TOKEN, gen = tabGen(), target = $('futSchwabCaptureStatus');
  try {
    const result = await api('/autopilot/futures/sources/schwab/capture');
    if (stale(token) || tabStale(gen)) return;
    if (result.schedule?.roots?.length) $('futSchwabRoots').value = result.schedule.roots.join(',');
    if (result.schedule?.cron) $('futSchwabCadence').value = result.schedule.cron === '7,37 * * * *' ? 'half-hour' : 'hourly';
    const coverage = (result.coverage || []).map(row => row.symbol + ': ' + row.bars + ' closed bars, ' + row.first + ' → ' + row.last).join('\n');
    const health = (result.health || []).map(row => row.state === 'unobserved'
      ? row.symbol + ': no forward capture observed in the last five days'
      : row.symbol + ': session-model ' + row.received + '/' + row.expected + ' buckets since first capture, ' +
        row.missing + ' missing (' + row.trailingMissing + ' trailing), ' + row.gapCount + ' gap runs' +
        (row.outsideSession ? ', ' + row.outsideSession + ' outside modeled session' : '') +
        ' · latest expected ' + (row.latestExpected || 'none')).join('\n');
    target.textContent = 'Capture ' + (result.enabled ? 'ON' : 'OFF') + (result.schedule ? ' · next ' + (result.schedule.nextRunAt || 'pending') : '') +
      '\n' + (coverage || 'No captured Schwab Futures bars yet.') + (health ? '\n' + health : '');
  } catch (error) {
    if (stale(token) || tabStale(gen)) return;
    // The panel-wide notice already explains a native host with no Futures scheduler.
    if (error.code === 'native_executor_unavailable') return;
    target.textContent = 'Capture status unavailable: ' + error.message;
  }
}
async function schwabCaptureAction(action, button) {
  const token = RENDER_TOKEN, gen = tabGen(), target = $('futSchwabCaptureStatus');
  button.disabled = true;
  target.textContent = action === 'enable' ? 'Capturing current closed bars before scheduling…' : action === 'run' ? 'Capturing current closed bars…' : 'Stopping future capture…';
  try {
    const path = '/autopilot/futures/sources/schwab/capture';
    const result = await api(action === 'run' ? path + '/run' : action === 'enable' ? path + '/enable' : path,
      action === 'stop' ? { method: 'DELETE' } : jbody('POST', schwabCaptureForm()));
    if (stale(token) || tabStale(gen)) return;
    target.textContent = action === 'stop' ? 'Hourly capture stopped; existing private bars retained.' :
      'Captured ' + (result.receipt?.series || []).map(row => row.symbol + ' +' + row.inserted + ' new / ' + row.received + ' received').join(', ') +
      (action === 'enable' ? '. Forward schedule active.' : '.');
    await loadSchwabCaptureStatus();
  } catch (error) { if (!stale(token) && !tabStale(gen)) target.textContent = 'Schwab capture failed: ' + error.message; }
  finally { button.disabled = false; }
}
