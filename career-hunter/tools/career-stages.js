/* CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | ?view=approve, the address the To approve stage had, is in the map of old addresses: it opens Saved, where Career's picks lead. The live Job Board already did this by itself; the unserved board page reads this map and used to bounce to the approvals address, which now forwards back.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 6 and 9. (a) To approve is no longer a stage. A job Career picks for a person is shown at the top of Saved and is prepared on the one application page, so the control and Home's pipeline lose that entry and counts() no longer reads the application records; picks() reads them and returns the picked jobs the person has done nothing with yet. (b) The stages follow the bar: My jobs is New matches, Saved, Getting ready and Removed; Applications is Applied, Interviewing, Offer and Closed. The control draws the row of the section its current stage is in, so a page has one row and it never disagrees with the bar. The More menu is gone: Offer, Closed and Removed are tabs, and Document records, Queued for documents and Needs your answer are not offered (the live Job Board never read ?status=, so each opened Saved; those jobs are all in Getting ready). (c) counts() carries the Getting ready and Applied totals GET /jobs/stats answers as queued and tracked, which Home's cards looked up under those names and never found. PIPELINE is the order Home draws.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5 (one word for each thing): the stages read Getting ready (was Preparing), Closed (was Not selected), Removed (was Dismissed) and Needs your answer (was Needs you). Only the words changed: ids, statuses, counts and addresses are as they were.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | New matches answers ?view=matches, the address the live Job Board (career-job-lists) reads for recommendations.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Career is one pipeline. Prepare & submit, Application status and Approvals were the Job Board under other names, so they became stages of it: New matches · Saved · To approve · Preparing · Applied · Interviewing, with Offer, Not selected and Dismissed under More. This draws that one segmented control on the Job Board and on the To approve view, maps every stage to the address it has always answered (?view=queue, ?view=status, the approvals route), and gives the board a hook to switch stage in place.
 */
(function (root) {
  'use strict';
  const BOARD = '/api/career-hunter/board-native';
  /** Each stage: id, label, the board status it filters, the address it answers, its count key and the bar section it is in. */
  const STAGES = [
    { id: 'matches', label: 'New matches', status: '', href: BOARD + '?view=matches', side: 'jobs' },
    { id: 'saved', label: 'Saved', status: 'saved', href: BOARD + '?view=saved', count: 'saved', side: 'jobs' },
    { id: 'preparing', label: 'Getting ready', status: 'queue', href: BOARD + '?view=queue', count: 'queue', side: 'jobs' },
    { id: 'dismissed', label: 'Removed', status: 'dismissed', href: BOARD + '?view=dismissed', side: 'jobs' },
    { id: 'applied', label: 'Applied', status: 'tracked', href: BOARD + '?view=status', count: 'tracked', side: 'applications' },
    { id: 'interviewing', label: 'Interviewing', status: 'interview', href: BOARD + '?view=interviewing', count: 'interview', side: 'applications' },
    { id: 'offer', label: 'Offer', status: 'offer', href: BOARD + '?view=offer', count: 'offer', side: 'applications' },
    { id: 'closed', label: 'Closed', status: 'rejected', href: BOARD + '?view=closed', count: 'rejected', side: 'applications' },
  ];
  /** Home's pipeline, in the order a job moves. */
  const PIPELINE = ['matches', 'saved', 'preparing', 'applied', 'interviewing', 'offer'].map((id) => STAGES.find((stage) => stage.id === id));
  /** ?view= values, old and new, to the board status they open. */
  const VIEW_STATUS = { matches: '', queue: 'queue', status: 'tracked', saved: 'saved', approve: 'saved', interviewing: 'interview', offer: 'offer', closed: 'rejected', dismissed: 'dismissed' };
  /** How many of Career's picks a page shows at once; the next ones follow as these are prepared or removed. */
  const PICK_LIMIT = 10;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** @description The stage a board status belongs to. @param {string} status @returns {object|undefined} */
  function forStatus(status) { return STAGES.find((stage) => stage.status === (status || '')); }
  /** @description The stage a ?view= value opens. @param {string} view @returns {object|undefined} */
  function forView(view) { return Object.hasOwn(VIEW_STATUS, view || '') ? forStatus(VIEW_STATUS[view]) : undefined; }

  /**
   * @description Draw the stage row into `host`: the stages of the bar section the current stage is in.
   * @param {HTMLElement} host - The container.
   * @param {string} current - The current stage id.
   * @param {object} counts - Stage counts by count key.
   * @param {(stage: object, event: Event) => boolean} [onSelect] - Return true when the page handled it in place.
   * @returns {void}
   */
  function render(host, current, counts = {}, onSelect) {
    if (!host) return;
    const now = STAGES.find((stage) => stage.id === current) || STAGES[1];
    const chip = (stage) => {
      const n = stage.count && counts[stage.count] > 0 ? `<span class="n">${counts[stage.count]}</span>` : '';
      return `<a class="tab" role="tab" data-stage="${stage.id}" data-k="${stage.status}" href="${stage.href}" aria-selected="${stage.id === now.id}">${esc(stage.label)}${n}</a>`;
    };
    host.setAttribute('role', 'tablist');
    host.setAttribute('aria-label', 'Application stages');
    host.dataset.side = now.side;
    host.classList.add('ck-seg', 'career-stages');
    host.innerHTML = STAGES.filter((stage) => stage.side === now.side).map(chip).join('');
    host.querySelectorAll('a[data-stage]').forEach((a) => a.addEventListener('click', (event) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const stage = STAGES.find((s) => s.id === a.dataset.stage);
      if (stage && onSelect && onSelect(stage, event)) event.preventDefault();
    }));
  }

  /** @description Read the counts the stage row and Home's pipeline show. @returns {Promise<object>} Counts by key. */
  async function counts() {
    const out = {};
    try {
      const response = await fetch('/api/career-hunter/jobs/stats', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        out.saved = Number(data.saved) || 0;
        for (const row of data.byStatus || []) out[row.status] = Number(row.n) || 0;
        if (typeof data.queued === 'number') out.queue = data.queued;
        if (typeof data.tracked === 'number') out.tracked = data.tracked;
      }
    } catch (_) { /* counts are optional; the stages still work */ }
    return out;
  }

  /**
   * @description The jobs Career picked for this person that they have done nothing with yet: the application records
   * still waiting (GET /applications), each read as a job (GET /jobs/:id). A pick the person has since prepared, applied
   * to or removed is left out, because its job has moved on even though its record has not. A failed read gives none.
   * @returns {Promise<Array<object>>} At most PICK_LIMIT jobs, each with `picked: true` and no description.
   */
  async function picks() {
    let rows = [];
    try {
      const response = await fetch('/api/career-hunter/applications', { cache: 'no-store' });
      if (response.ok) rows = (await response.json()).applications || [];
    } catch (_) { return []; }
    const waiting = rows.filter((a) => a && (a.status || 'approval_required') === 'approval_required' && Number(a.posting_id) > 0).slice(0, PICK_LIMIT + 5);
    const jobs = await Promise.all(waiting.map(async (a) => {
      try {
        const response = await fetch('/api/career-hunter/jobs/' + encodeURIComponent(a.posting_id), { cache: 'no-store' });
        if (!response.ok) return null;
        const { job } = await response.json();
        if (!job || !['', 'new'].includes(job.status || '')) return null;
        const { description, ...rest } = job;
        return { ...rest, picked: true };
      } catch (_) { return null; }
    }));
    return jobs.filter(Boolean).slice(0, PICK_LIMIT);
  }

  root.CareerStages = { STAGES, PIPELINE, VIEW_STATUS, forStatus, forView, render, counts, picks };
})(typeof window === 'undefined' ? globalThis : window);
