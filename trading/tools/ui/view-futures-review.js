/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Review owned Futures evidence and stage bounded next-study proposals without arming or placing trades.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Explain recorded freshness/sample gates, including deficient and legacy-unassessed evidence.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Show queued review state and its workflow ticket without automatically adopting proposals.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Show frozen forward sample/cohort denominators and citation-linked assessments separately from historical results.
 */

function futuresReviewCard(run) {
  if (!['completed', 'unchanged', 'insufficient_sample'].includes(run.status)) return '';
  const review = run.review;
  let html = futuresQualityCard(run) + '<div class="foot">Research review: ' + esc(review?.status || 'not requested') +
    '. Historical OOS evidence is not a forward prediction. Reviewing uses your connected provider.</div>';
  if (review?.ticketId) html += '<div class="foot">Workflow ticket: ' + esc(review.ticketId) + ' (Futures Research queue)</div>';
  html += futuresForwardReviewCard(review);
  if (review?.skipReason) html += '<div class="foot">' + esc(review.skipReason) + '</div>';
  if (review?.result) {
    html += '<p>' + esc(review.result.summary) + '</p><ul>' + review.result.limitations.map(item => '<li>' + esc(item) + '</li>').join('') + '</ul>';
    if (review.result.nextStudy) html += '<p>' + esc(review.result.nextStudy.rationale) + '</p>' +
      '<button class="btn ghost sm" data-futures-proposal="' + esc(run.runId) + '">Load proposed study into form</button>';
  }
  if (review?.error) html += '<div class="foot err">' + esc(review.error) + '</div>';
  if (review?.status !== 'completed') html += '<button class="btn ghost sm" data-futures-review="' + esc(run.runId) + '">' +
    (['queued', 'reviewing'].includes(review?.status) ? 'Check / retry interrupted review (after 1 hour)' :
      review?.status === 'skipped' ? 'Review explicitly (uses provider)' : 'Review this study') + '</button>';
  return html;
}

function futuresForwardReviewCounts(counts) {
  return esc(counts.graded) + ' graded: ' + esc(counts.matched) + ' matched / ' + esc(counts.missed) + ' missed / ' + esc(counts.flat) + ' flat; ' +
    esc(counts.pending) + ' pending / ' + esc(counts.unavailable) + ' unavailable / ' + esc(counts.withheld) + ' withheld / ' + esc(counts.abstained) + ' abstained';
}

function futuresForwardReviewCard(review) {
  const context = review?.forwardContext;
  if (!context) return '<div class="foot">Forward evidence was not assessed in this review. A completed review is not refreshed in place.</div>';
  if (context.availability === 'schema_missing') return '<div class="foot warn">Forward ledger unavailable at review admission (migration 161 required). Not a zero-success sample.</div>';
  let html = '<div class="foot">Forward evidence frozen at ' + esc(context.capturedAt) + '. ' +
    'Latest ' + esc(context.counts.graded) + ' of ' + esc(context.available.graded) + ' graded and ' +
    esc(context.receipts.length - context.counts.graded) + ' of ' + esc(context.available.other) + ' other owner receipts for ' + esc(context.roots.join(', ')) +
    ' (up to ' + esc(context.limitPerStateGroup) + ' per group). Counts below cover only this supplied sample.</div>';
  if (!context.receipts.length) return html + '<div class="foot">No forward receipts were available; no forward performance was assessed.</div>';
  html += '<p>' + futuresForwardReviewCounts(context.counts) + '.</p><div class="foot">Overlapping horizons are not independent. Do not pool contract, model, study or horizon cohorts into strategy accuracy. Signed ticks are not trade P&amp;L; unscored and flat cases are not wins.</div>';
  html += '<details><summary>Forward cohorts and frozen citations</summary><ul>' + context.cohorts.map(cohort =>
    '<li>' + esc(cohort.root) + ' / ' + esc(cohort.contract) + ' / ' + esc(cohort.model || 'no model') + ' / ' +
    esc(cohort.horizonHours ?? 'unassessed') + ' hours / study ' + esc(cohort.studyFingerprint || 'unassessed') + ': ' + futuresForwardReviewCounts(cohort.counts) + '</li>').join('') +
    '</ul><div class="foot">Context: ' + esc(context.fingerprint) + '</div><pre>' + esc(JSON.stringify(context.receipts, null, 2)) + '</pre></details>';
  if (review.result?.forwardAssessment) html += '<p>Forward assessment: ' + esc(review.result.forwardAssessment.summary) + '</p>';
  return html;
}

function futuresQualityCard(run) {
  return (run.markets || []).map(market => {
    const q = market.quality;
    if (!q) return '<div class="foot warn">' + esc(market.root) + ': quality gates were not assessed on this recorded run.</div>';
    const low = q.lowTradeWindows || [];
    return '<div class="foot ' + (q.sampleStatus === 'insufficient' ? 'warn' : '') + '">' + esc(market.root) +
      ': ' + (q.sampleStatus === 'insufficient' ? 'INSUFFICIENT OOS SAMPLE' : 'Meets configured sample floor (not statistical confidence)') +
      ' · floor ' + esc(q.minOosTradesPerWindow) + ' trades/window · chart/higher bar-date lag ' + esc(q.chartLagDays) + '/' + esc(q.ltfLagDays) +
      ' days against ' + esc(q.referenceDate) + ' (limit ' + esc(q.maxSourceLagDays) + ').' +
      (low.length ? '<ul>' + low.map(window => '<li>' + esc(window.oosStart) + ' → ' + esc(window.oosEnd) + ': ' + esc(window.trades) + ' trades</li>').join('') + '</ul>' : '') + '</div>';
  }).join('');
}

function wireFuturesReviews(rows) {
  const host = $('futRuns');
  host.onclick = (event) => {
    const button = event.target.closest('[data-futures-review], [data-futures-proposal]');
    if (!button || !host.contains(button)) return;
    const run = rows.find(row => row.runId === (button.dataset.futuresReview || button.dataset.futuresProposal));
    if (!run) return;
    if (button.dataset.futuresReview) { void requestFuturesReview(run.runId, button); return; }
    const proposal = run.review?.result?.nextStudy;
    if (!proposal) return;
    // Restore the reviewed study envelope as well as its grid; do not apply a grid to unrelated form settings.
    fillFuturesForm({ ...run.config, stageGrids: proposal.stageGrids });
    $('futMsg').className = 'sub warn';
    $('futMsg').textContent = 'Proposed study loaded, not saved or run. Review the controls, then Save / enable nightly loop to use it. Prior OOS results used for tuning are no longer an untouched holdout.';
  };
}

async function requestFuturesReview(runId, button) {
  const token = RENDER_TOKEN, gen = tabGen();
  button.disabled = true;
  const msg = $('futMsg');
  msg.textContent = 'Reviewing the recorded study with your research provider…';
  try {
    const result = await api('/autopilot/futures/runs/' + encodeURIComponent(runId) + '/review', { method: 'POST' });
    if (stale(token) || tabStale(gen)) return;
    msg.className = result.ok ? 'sub ok' : 'sub err';
    msg.textContent = result.ok ? 'Research review saved. Any proposal remains unapplied.' : (result.review?.error || 'Review failed; study evidence is unchanged.');
    await loadFuturesResearch();
  } catch (error) {
    if (!stale(token) && !tabStale(gen)) { msg.className = 'sub err'; msg.textContent = error.message; }
  } finally { button.disabled = false; }
}
