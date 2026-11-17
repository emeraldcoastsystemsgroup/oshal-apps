/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Client controller for Futures Research (/api/futures-research/app): loads caller-scoped overview, futures-research tickets, and optional Intelligent Trades futures studies and forward predictions with honest empty states and sortable responsive tables.
 */
'use strict';

(function initFuturesResearchSurface() {
  const byId = id => document.getElementById(id);

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatInstant(value) {
    if (!value) return 'Not recorded';
    const ms = typeof value === 'number' ? value : Date.parse(String(value));
    if (!Number.isFinite(ms)) return 'Not recorded';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  }

  async function safeJson(url) {
    try {
      const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!res.ok) return { ok: false, status: res.status, body: null };
      return { ok: true, status: res.status, body: await res.json() };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  }

  function extractFuturesTickets(overviewBody, ticketsBody) {
    const raw = Array.isArray(ticketsBody?.tickets)
      ? ticketsBody.tickets
      : Array.isArray(ticketsBody) ? ticketsBody : (overviewBody?.queue || []);
    return raw.filter(t => t && (t.ticketType === 'futures-research' || t.kind === 'futures-research'));
  }

  function renderStudiesSection(futuresRes) {
    const badge = byId('frStudiesStatus');
    const host = byId('frStudiesBody');
    if (!futuresRes.ok || !futuresRes.body) {
      badge.textContent = 'Partner not connected';
      host.className = 'fr-empty';
      host.textContent = 'Intelligent Trades futures ledger is not connected in this session. Open Intelligent Trades when admitted to run walk-forward studies over /MES, /MNQ, /ES, /NQ, /CL, or /GC; queued reviews for your account still appear below.';
      return { connected: false, runs: [], proposals: 0 };
    }
    const runs = Array.isArray(futuresRes.body.runs) ? futuresRes.body.runs : [];
    const schedule = futuresRes.body.schedule;
    const proposals = runs.filter(r => r?.review?.result?.nextStudy).length;
    badge.textContent = schedule ? `Schedule: ${schedule.status || 'saved'}` : `${runs.length} recorded`;
    if (!runs.length) {
      host.className = 'fr-empty';
      host.textContent = 'No walk-forward futures studies recorded yet. Configure a study in Intelligent Trades to evaluate /MES, /MNQ, /ES, /NQ, /CL, or /GC windows and opt into queued review.';
      return { connected: true, runs, proposals: 0 };
    }
    const rowsHtml = runs.map(run => {
      const roots = (run.markets || []).map(m => m.root).filter(Boolean).join(', ') || 'Unspecified';
      const gate = (run.markets || []).map(m => {
        const q = m.quality;
        if (!q) return `${m.root}: unassessed`;
        return `${m.root}: ${q.sampleStatus === 'insufficient' ? 'insufficient OOS sample' : `floor >=${q.minOosTradesPerWindow} trades`}`;
      }).join(' · ') || 'Unassessed';
      const proposal = run.review?.result?.nextStudy?.rationale || 'None staged (explicit adoption required)';
      return `<tr>
        <td data-label="Run"><code>${esc(run.runId || 'run')}</code></td>
        <td data-label="Roots">${esc(roots)}</td>
        <td data-label="Status">${esc(run.status || 'recorded')}</td>
        <td data-label="Sample gate">${esc(gate)}</td>
        <td data-label="Proposal">${esc(proposal)}</td>
      </tr>`;
    }).join('');
    host.className = 'fr-table-wrap';
    host.innerHTML = `<table class="fr-table" data-sortable="true">
      <thead><tr>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="0">Run</button></th>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="1">Roots</button></th>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="2">Status</button></th>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="3">Sample gate</button></th>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="4">Proposal</button></th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
    wireSortableTable(host.querySelector('table'));
    return { connected: true, runs, proposals };
  }

  function buildReviewItems(runs, tickets) {
    const items = [];
    const seenTicketIds = new Set();
    for (const run of runs) {
      if (!run?.review) continue;
      if (run.review.ticketId) seenTicketIds.add(String(run.review.ticketId));
      const res = run.review.result || {};
      const citations = [
        ...(Array.isArray(res.evidence) ? res.evidence : []),
        ...(Array.isArray(run.review.evidenceCitations) ? run.review.evidenceCitations : []),
        ...(run.review.forwardContext?.fingerprint ? [run.review.forwardContext.fingerprint] : []),
      ];
      items.push({
        id: run.runId || run.review.ticketId || 'review',
        status: run.review.status || 'recorded',
        thesis: res.summary || 'Queued for tool-less walk-forward review.',
        risks: Array.isArray(res.limitations) && res.limitations.length ? res.limitations : ['Sample size and source-lag checks pending completion.'],
        confidence: run.review.confidence || 'Sample-gated research posture (not a probability or trade signal)',
        citations: [...new Set(citations)],
        at: run.createdAt,
      });
    }
    for (const ticket of tickets) {
      const id = String(ticket.ticketId || ticket.id || '');
      if (id && seenTicketIds.has(id)) continue;
      items.push({
        id: id || 'ticket',
        status: String(ticket.status || 'queued'),
        thesis: String(ticket.title || ticket.summary || 'Futures Research workflow ticket'),
        risks: Array.isArray(ticket.risks) && ticket.risks.length ? ticket.risks : ['Awaiting or completed on futures-research-worker; inspect run evidence before adopting any grid change.'],
        confidence: String(ticket.confidence || 'Bounded workflow review (zero order execution)'),
        citations: Array.isArray(ticket.evidenceCitations) ? ticket.evidenceCitations : (id ? [`ticket:${id}`] : []),
        at: ticket.updatedAt || ticket.createdAt,
      });
    }
    return items;
  }

  function renderReviewQueue(runs, tickets) {
    const badge = byId('frQueueStatus');
    const host = byId('frQueueBody');
    const items = buildReviewItems(runs, tickets);
    badge.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    if (!items.length) {
      host.className = 'fr-empty';
      host.textContent = 'No Futures Research review items or futures-research workflow tickets are in your queue yet. Completed or sample-gated studies opted into review appear here with thesis, risks, confidence posture, and evidence citations.';
      return items.length;
    }
    host.className = 'fr-review-list';
    host.innerHTML = items.map(item => {
      const risks = item.risks.map(r => `<li>${esc(r)}</li>`).join('');
      const cites = item.citations.length
        ? item.citations.map(c => `<span class="fr-citation"><code>${esc(c)}</code></span>`).join('')
        : '<span class="fr-citation">No citation recorded yet</span>';
      return `<article class="fr-review-item">
        <div class="fr-review-meta">
          <span><strong>${esc(item.id)}</strong> · ${esc(item.status)}</span>
          <span>${esc(formatInstant(item.at))}</span>
        </div>
        <p><strong>Thesis:</strong> ${esc(item.thesis)}</p>
        <div><strong>Risks &amp; limitations:</strong><ul>${risks}</ul></div>
        <p><strong>Confidence posture:</strong> ${esc(item.confidence)}</p>
        <div class="fr-citations" aria-label="Evidence citations">${cites}</div>
      </article>`;
    }).join('');
    return items.length;
  }

  function renderForwardSection(predRes) {
    const badge = byId('frForwardStatus');
    const host = byId('frForwardBody');
    if (!predRes.ok || !predRes.body) {
      badge.textContent = 'Partner not connected';
      host.className = 'fr-empty';
      host.textContent = 'Forward-call receipts load from Intelligent Trades when admitted in your session. No forward calls are fabricated or inferred locally.';
      return { connected: false, count: 0 };
    }
    const rows = Array.isArray(predRes.body.predictions) ? predRes.body.predictions : [];
    badge.textContent = `${rows.length} receipt${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      host.className = 'fr-empty';
      host.textContent = 'No frozen forward calls recorded yet. Forward bias receipts and post-horizon tick grading appear here when forward call tracking is enabled.';
      return { connected: true, count: 0 };
    }
    const bodyHtml = rows.map(row => {
      const bias = row.snapshot?.observation?.bias || 'abstained';
      const horizon = row.snapshot?.horizonHours ? `${row.snapshot.horizonHours}h` : 'Unassessed';
      const outcome = row.status === 'graded'
        ? `${Number(row.outcome?.signedTicks || 0).toFixed(2)} ticks (${row.outcome?.correct === null ? 'flat — not a win' : row.outcome?.correct ? 'matched' : 'missed'})`
        : 'Unscored';
      return `<tr>
        <td data-label="Contract"><code>${esc(row.contract || 'contract')}</code></td>
        <td data-label="Bias">${esc(bias)}</td>
        <td data-label="Status">${esc(row.status || 'pending')}</td>
        <td data-label="Horizon">${esc(horizon)}</td>
        <td data-label="Outcome">${esc(outcome)}</td>
        <td data-label="Issued">${esc(formatInstant(row.issuedAt))}</td>
      </tr>`;
    }).join('');
    host.className = 'fr-table-wrap';
    host.innerHTML = `<table class="fr-table" data-sortable="true">
      <thead><tr>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="0">Contract</button></th>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="1">Bias</button></th>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="2">Status</button></th>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="3">Horizon</button></th>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="4">Outcome</button></th>
        <th aria-sort="none"><button type="button" class="fr-sort-btn" data-col="5">Issued</button></th>
      </tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>`;
    wireSortableTable(host.querySelector('table'));
    return { connected: true, count: rows.length };
  }

  function wireSortableTable(table) {
    if (!table) return;
    table.querySelector('thead')?.addEventListener('click', event => {
      const btn = event.target.closest('.fr-sort-btn');
      if (!btn) return;
      const col = Number(btn.dataset.col || 0);
      const th = btn.closest('th');
      const asc = th.getAttribute('aria-sort') !== 'ascending';
      for (const h of table.querySelectorAll('th')) h.setAttribute('aria-sort', 'none');
      th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
      const tbody = table.querySelector('tbody');
      const sorted = [...tbody.querySelectorAll('tr')].sort((a, b) => {
        const av = a.children[col]?.textContent.trim() || '';
        const bv = b.children[col]?.textContent.trim() || '';
        return (asc ? 1 : -1) * av.localeCompare(bv, undefined, { numeric: true });
      });
      for (const tr of sorted) tbody.appendChild(tr);
    });
  }

  async function refreshAll() {
    const btn = byId('frRefreshBtn');
    if (btn) btn.disabled = true;
    try {
      const [overviewRes, ticketsRes, futuresRes, predRes] = await Promise.all([
        safeJson('/api/futures-research/overview'),
        safeJson('/api/tickets'),
        safeJson('/api/trading/autopilot/futures'),
        safeJson('/api/trading/autopilot/futures/predictions'),
      ]);
      const tickets = extractFuturesTickets(overviewRes.body, ticketsRes.body);
      const studies = renderStudiesSection(futuresRes);
      const queueCount = renderReviewQueue(studies.runs, tickets);
      const forward = renderForwardSection(predRes);

      byId('frTileQueue').textContent = String(queueCount);
      byId('frTileQueueHint').textContent = `${tickets.length} workflow ticket${tickets.length === 1 ? '' : 's'}`;
      byId('frTileStudies').textContent = studies.connected ? String(studies.runs.length) : 'Not connected';
      byId('frTileStudiesHint').textContent = studies.connected ? 'Walk-forward study runs' : 'Admit Intelligent Trades to load';
      byId('frTileProposals').textContent = studies.connected ? String(studies.proposals) : '—';
      byId('frTileForward').textContent = forward.connected ? String(forward.count) : '—';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  byId('frRefreshBtn')?.addEventListener('click', () => { void refreshAll(); });
  void refreshAll();
})();
