/* CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | New matches answers ?view=matches, the address the live Job Board (career-job-lists) reads for recommendations.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Career is one pipeline. Prepare & submit, Application status and Approvals were the Job Board under other names, so they became stages of it: New matches · Saved · To approve · Preparing · Applied · Interviewing, with Offer, Not selected and Dismissed under More. This draws that one segmented control on the Job Board and on the To approve view, maps every stage to the address it has always answered (?view=queue, ?view=status, the approvals route), and gives the board a hook to switch stage in place.
 */
(function (root) {
  'use strict';
  const BOARD = '/api/career-hunter/board-native';
  /** Each stage: id, label, the board status it filters (null for To approve), the address it answers. */
  const STAGES = [
    { id: 'matches', label: 'New matches', status: '', href: BOARD + '?view=matches' },
    { id: 'saved', label: 'Saved', status: 'saved', href: BOARD + '?view=saved', count: 'saved' },
    { id: 'approve', label: 'To approve', status: null, href: '/api/career-hunter/approvals', count: 'approve' },
    { id: 'preparing', label: 'Preparing', status: 'queue', href: BOARD + '?view=queue' },
    { id: 'applied', label: 'Applied', status: 'tracked', href: BOARD + '?view=status' },
    { id: 'interviewing', label: 'Interviewing', status: 'interview', href: BOARD + '?view=interviewing', count: 'interview' },
  ];
  const MORE = [
    { id: 'offer', label: 'Offer', status: 'offer', href: BOARD + '?view=offer', count: 'offer' },
    { id: 'closed', label: 'Not selected', status: 'rejected', href: BOARD + '?view=closed', count: 'rejected' },
    { id: 'dismissed', label: 'Dismissed', status: 'dismissed', href: BOARD + '?view=dismissed', count: 'dismissed' },
    { id: 'generated', label: 'Document records', status: 'generated', href: BOARD + '?status=generated', count: 'generated' },
    { id: 'promoted', label: 'Queued for documents', status: 'promoted', href: BOARD + '?status=promoted', count: 'promoted' },
    { id: 'deferred', label: 'Needs you', status: 'deferred', href: BOARD + '?status=deferred', count: 'deferred' },
  ];
  const ALL = STAGES.concat(MORE);
  /** ?view= values, old and new, to the board status they open. */
  const VIEW_STATUS = { matches: '', queue: 'queue', status: 'tracked', saved: 'saved', interviewing: 'interview', offer: 'offer', closed: 'rejected', dismissed: 'dismissed' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** @description The stage a board status belongs to. @param {string} status @returns {object|undefined} */
  function forStatus(status) { return ALL.find((stage) => stage.status === (status || '')); }

  /**
   * @description Draw the stage control into `host`.
   * @param {HTMLElement} host - The container.
   * @param {string} current - The current stage id.
   * @param {object} counts - Stage counts by count key.
   * @param {(stage: object, event: Event) => boolean} [onSelect] - Return true when the page handled it in place.
   * @returns {void}
   */
  function render(host, current, counts = {}, onSelect) {
    if (!host) return;
    const chip = (stage) => {
      const n = stage.count && counts[stage.count] > 0 ? `<span class="n">${counts[stage.count]}</span>` : '';
      return `<a class="tab" role="tab" data-stage="${stage.id}" data-k="${stage.status == null ? 'approve' : stage.status}" href="${stage.href}" aria-selected="${stage.id === current}">${esc(stage.label)}${n}</a>`;
    };
    const inMore = MORE.find((stage) => stage.id === current);
    const moreItems = MORE.filter((stage) => stage.id === current || !stage.count || counts[stage.count] > 0 || ['offer', 'closed', 'dismissed'].includes(stage.id));
    host.setAttribute('role', 'tablist');
    host.setAttribute('aria-label', 'Application stages');
    host.classList.add('ck-seg', 'career-stages');
    host.innerHTML = STAGES.map(chip).join('')
      + (inMore ? chip(inMore) : '')
      + `<button type="button" class="tab" data-stage-more aria-haspopup="menu" aria-expanded="false">More ▾</button>`;
    let menu = document.getElementById('careerStageMore');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'careerStageMore'; menu.className = 'ck-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('popover', '');
      document.body.append(menu);
    }
    menu.innerHTML = moreItems.map((stage) => `<button type="button" role="menuitem" data-stage="${stage.id}">${esc(stage.label)}${stage.count && Number.isFinite(counts[stage.count]) ? ' · ' + counts[stage.count] : ''}</button>`).join('');
    const pick = (id, event) => {
      const stage = ALL.find((s) => s.id === id); if (!stage) return;
      if (onSelect && onSelect(stage, event)) { event?.preventDefault(); return; }
      if (event?.currentTarget?.tagName !== 'A') location.href = stage.href;
    };
    host.querySelectorAll('a[data-stage]').forEach((a) => a.addEventListener('click', (event) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      pick(a.dataset.stage, event);
    }));
    const more = host.querySelector('[data-stage-more]');
    more.addEventListener('click', () => {
      const rect = more.getBoundingClientRect();
      menu.style.top = Math.min(rect.bottom + 4, innerHeight - 60) + 'px';
      menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - 216)) + 'px';
      if (menu.togglePopover) menu.togglePopover(); else menu.hidden = !menu.hidden;
      more.setAttribute('aria-expanded', String(menu.matches?.(':popover-open') ?? !menu.hidden));
    });
    menu.onclick = (event) => {
      const button = event.target.closest('[data-stage]'); if (!button) return;
      if (menu.hidePopover) menu.hidePopover(); else menu.hidden = true;
      pick(button.dataset.stage, event);
    };
  }

  /** @description Read the counts the stage control shows. @returns {Promise<object>} Counts by key. */
  async function counts() {
    const out = {};
    try {
      const response = await fetch('/api/career-hunter/jobs/stats', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        out.saved = Number(data.saved) || 0;
        for (const row of data.byStatus || []) out[row.status] = Number(row.n) || 0;
      }
    } catch (_) { /* counts are optional; the stages still work */ }
    try {
      const response = await fetch('/api/career-hunter/applications', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        out.approve = (data.applications || []).filter((a) => (a.status || 'approval_required') === 'approval_required').length;
      }
    } catch (_) { /* optional */ }
    return out;
  }

  root.CareerStages = { STAGES, MORE, VIEW_STATUS, forStatus, render, counts };
})(typeof window === 'undefined' ? globalThis : window);
