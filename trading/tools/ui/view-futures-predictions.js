/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose explicit forward settings, ungraded states and frozen owner evidence without execution authority.
 */
function futuresPredictionControls() {
  return '<fieldset style="margin:12px 0"><legend>Forward research calls — separate from historical OOS</legend>' +
    '<label class="f"><span><input type="checkbox" id="futPredEnabled" /> Enable locked-strategy forward bias and later outcome grading</span></label>' +
    '<div class="sub">Off by default. File archives only; no orders, automatic rolling, probabilities or profit promises. Each new input snapshot freezes a long/short bias or records an abstention. Pausing the loop pauses issuance and grading.</div>' +
    '<div class="grid2"><label class="f">Dated contracts (JSON root map)<textarea id="futPredContracts" placeholder="{&quot;ES&quot;:&quot;ESZ26&quot;,&quot;CL&quot;:&quot;CLZ26&quot;}"></textarea></label>' +
    '<label class="f">Confirmed archive wall-clock zone<select id="futPredZone"><option value="">Select explicitly</option><option>UTC</option><option>America/New_York</option><option>America/Chicago</option></select></label>' +
    '<label class="f">Horizon from actual issuance (hours)<input id="futPredHorizon" type="number" min="1" max="168" value="24" /></label>' +
    '<label class="f">Maximum completed source age (hours)<input id="futPredAge" type="number" min="1" max="168" value="36" /></label>' +
    '<label class="f">Outcome tolerance after target (hours)<input id="futPredTolerance" type="number" min="1" max="168" value="24" /></label>' +
    '<label class="f">Replay chart history (bars)<input id="futPredHistory" type="number" min="64" max="4096" value="512" /></label></div>' +
    '<div class="foot">Supported bars: 5Min, 1Hour and 1Day. Minute exports go in minute/CONTRACT.txt; daily exports in daily/CONTRACT.txt. Confirm the archive labels bar starts; daily rows mean local calendar-day bars, not exchange settlement. Missing, stale, malformed, ambiguous-clock or revised reference data is not scored.</div></fieldset>';
}
function futuresPredictionForm() {
  const raw = $('futPredContracts').value.trim();
  return { enabled: $('futPredEnabled').checked, contracts: raw ? JSON.parse(raw) : {}, sourceTimeZone: $('futPredZone').value,
    horizonHours: Number($('futPredHorizon').value), maxSourceAgeHours: Number($('futPredAge').value),
    gradingToleranceHours: Number($('futPredTolerance').value), historyBars: Number($('futPredHistory').value) };
}
function fillFuturesPredictionForm(config) {
  const p = config || {};
  $('futPredEnabled').checked = p.enabled === true;
  $('futPredContracts').value = Object.keys(p.contracts || {}).length ? JSON.stringify(p.contracts, null, 2) : '';
  $('futPredZone').value = p.sourceTimeZone || '';
  $('futPredHorizon').value = p.horizonHours ?? 24;
  $('futPredAge').value = p.maxSourceAgeHours ?? 36;
  $('futPredTolerance').value = p.gradingToleranceHours ?? 24;
  $('futPredHistory').value = p.historyBars ?? 512;
}
function futuresPredictionCard(row) {
  const s = row.snapshot, o = row.outcome;
  const target = s ? new Date(Date.parse(row.issuedAt) + s.horizonHours * 3600000).toISOString() : null;
  const grade = row.status === 'graded' ? ' · directional ticks ' + Number(o?.signedTicks).toFixed(2) +
    ' · ' + (o?.correct === null ? 'flat outcome (not a win)' : o?.correct ? 'direction matched' : 'direction missed') : ' · unscored';
  return '<details class="panel"><summary>' + esc(row.contract) + ' · ' + esc(row.status) + ' · ' + esc(s?.observation?.bias || 'no call') + grade + '</summary>' +
    '<div class="foot">Recorded ' + esc(row.issuedAt) + (target ? ' · target ' + esc(target) : '') + ' · last checked ' + esc(row.checkedAt) + '</div>' +
    (row.reason ? '<div class="foot warn">' + esc(row.reason) + '</div>' : '') +
    '<pre style="white-space:pre-wrap;max-height:220px;overflow:auto">' + esc(JSON.stringify(row, null, 2)) + '</pre>' +
    (s ? '<button class="btn ghost sm" data-futures-evidence="' + esc(row.predictionId) + '">Inspect frozen replay inputs</button><pre id="futEvidence_' + esc(row.predictionId) + '" style="white-space:pre-wrap;max-height:360px;overflow:auto"></pre>' : '') + '</details>';
}
async function loadFuturesPredictions() {
  const token = RENDER_TOKEN, gen = tabGen();
  const host = $('futPredictions'); if (!host) return;
  try {
    const result = await api('/autopilot/futures/predictions');
    if (stale(token) || tabStale(gen)) return;
    host.innerHTML = '<h3>Forward calls and outcomes</h3><div class="foot">Latest 50 owner receipts. Directional change from the last known raw close to the first completed same-contract close in the target window; not trade P&amp;L or historical OOS. Abstentions and missing data are not accuracy successes.</div>' +
      ((result.predictions || []).map(futuresPredictionCard).join('') || '<div class="why">No forward receipts yet.</div>') + '<button class="btn ghost sm" data-futures-refresh>Refresh forward receipts</button>';
    host.onclick = event => {
      const button = event.target.closest('[data-futures-evidence], [data-futures-refresh]');
      if (!button || !host.contains(button)) return;
      if (button.hasAttribute('data-futures-refresh')) { void loadFuturesPredictions(); return; }
      void loadFuturesPredictionEvidence(button.dataset.futuresEvidence, button);
    };
  } catch (error) { if (!stale(token) && !tabStale(gen)) host.innerHTML = '<div class="foot err">Forward receipts unavailable: ' + esc(error.message) + '</div>'; }
}
async function loadFuturesPredictionEvidence(id, button) {
  const token = RENDER_TOKEN, gen = tabGen();
  button.disabled = true;
  try {
    const result = await api('/autopilot/futures/predictions/' + encodeURIComponent(id));
    if (stale(token) || tabStale(gen)) return;
    $('futEvidence_' + id).textContent = JSON.stringify(result.snapshot, null, 2);
  } catch (error) { if (!stale(token) && !tabStale(gen)) $('futEvidence_' + id).textContent = error.message; }
  finally { button.disabled = false; }
}
