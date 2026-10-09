/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compose a Home-owned, ticket-scoped attention panel through the exported shared module factory without new reads or authority.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Join only available row metadata so absent or invalid update times leave no dangling separator or invented date.
 */
(() => {
  'use strict';
  if (document.body.dataset.experienceApp !== 'home-experience') return;
  const shared = window.HOMEBASE_MODULES;
  if (!shared || typeof shared.create !== 'function') return;

  /** @description Keep only the real owning-ticket destination; malformed links are qualified, never repaired into invented records. */
  function ticketHref(item, live) {
    if (typeof item.ref !== 'string' || !item.ref.trim() || item.ref !== item.ref.trim() || ['undefined', 'null'].includes(item.ref)) return '';
    const expected = '/cockpit/?ticket=' + encodeURIComponent(item.ref);
    return item.id === 'ticket:' + item.ref && live.localHref(item.href) === expected ? expected : '';
  }
  /** @description Missing/invalid timestamps sort after actual update times; equal times use a stable ticket ID, never a guessed deadline. */
  function changedAt(item) {
    const at = item.at && typeof item.at.getTime === 'function' ? item.at.getTime() : NaN;
    return Number.isFinite(at) ? at : -Infinity;
  }
  /** @description Render only the caller-readable tickets that the shared status vocabulary places in attention. */
  function attention(ctx) {
    const { LIVE, esc, link, btn } = ctx, shell = ctx.shell();
    const read = shell.workState(['tickets']);
    const tickets = ctx.snapshot().work.filter(item => item && item.kind === 'ticket');
    const knownStates = new Set(Object.values(LIVE.STATUS_GROUPS).flat());
    const unknownStates = tickets.some(item => !item.status || !knownStates.has(item.status.label));
    const candidates = tickets.filter(item => item.status && LIVE.STATUS_GROUPS.attention.includes(item.status.label));
    const rows = candidates.map(item => ({ item, href: ticketHref(item, LIVE) })).filter(row => row.href);
    rows.sort((a, b) => changedAt(b.item) - changedAt(a.item) || (a.item.ref < b.item.ref ? -1 : a.item.ref > b.item.ref ? 1 : 0));
    const incompleteLinks = rows.length !== candidates.length;
    const incomplete = unknownStates || incompleteLinks;
    const complete = read.complete && !incomplete;
    const kind = read.complete && incomplete ? (rows.length ? 'partial' : 'unavailable') : read.kind;
    const count = complete ? `${rows.length} ${rows.length === 1 ? 'ticket' : 'tickets'}` : kind === 'loading' ? 'Tickets loading' : kind === 'partial' && rows.length ? `${rows.length} ${rows.length === 1 ? 'ticket' : 'tickets'} loaded` : 'Tickets unavailable';
    const incompleteNote = incomplete ? `<div class="note-line" role="status">${unknownStates ? '<p>Some ticket states are unavailable. Only known attention tickets are shown.</p>' : ''}${incompleteLinks ? '<p>Some ticket links are unavailable. Only linked tickets are shown.</p>' : ''}${btn('Retry work sources', 'retry-work', 'button', read.kind === 'loading' ? 'disabled' : '')}</div>` : '';
    const shown = rows.slice(0, 6).map(({ item, href }) => {
      const metadata = [item.appName, item.status.label, Number.isFinite(changedAt(item)) ? LIVE.relativeTime(item.at) : '']
        .filter(part => typeof part === 'string' && part.trim()).map(esc).join(' · ');
      return `<li class="home-attention-row"><div><strong>${esc(item.title)}</strong><small>${metadata}</small></div>${link('Open ticket ↗', href, 'button', `aria-label="${esc('Open ticket: ' + item.title)}"`)}</li>`;
    }).join('');
    const empty = !shown && complete ? '<p class="note-line">No tickets need your attention right now.</p>' : '';
    const limit = rows.length > 6 ? '<p class="subtle">Showing the six most recently changed tickets.</p>' : '';
    return `<section class="panel home-attention" data-module="home-attention" data-ticket-source-state="${esc(kind)}" aria-labelledby="home-attention-heading"><div class="panel-head"><h2 id="home-attention-heading">Top Items Today</h2>${ctx.pill(count)}</div><p class="subtle">Tickets waiting for review or follow-up, most recently changed first.</p>${shell.workNotice(['tickets'])}${incompleteNote}${shown ? `<ul class="home-attention-list">${shown}</ul>` : ''}${empty}${limit}</section>`;
  }

  // Homebase reads this exported factory before boot. Compose its render-time roomTabs
  // output so the owned panel remains inside the shared main before every column.
  // Do not copy the renderer or observe/mutate its DOM, preferences or member frames.
  window.HOMEBASE_MODULES = { ...shared, create(ctx) {
    const modules = shared.create(ctx);
    if (ctx.key !== 'family') return modules;
    return { ...modules, roomTabs() {
      return modules.roomTabs() + (ctx.state.page === 'home' ? attention(ctx) : '');
    } };
  } };
})();
