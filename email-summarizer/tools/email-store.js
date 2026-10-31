/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Inbox's stored-copy controls (Roger, 2026-10-29: the concierge should search a stored copy of the mail): "Search all your mail" searches the person's stored Gmail copy over 180 days (or Gmail directly, 30 days, before there is one); the line under it says how many messages the copy holds, how far back and how fresh, and "Keep a copy" turns on the person's own mail-copy job (every 10 minutes) and stores the first part at once; "Update now" runs one pass. Loaded beside the page's own script, which keeps its listing and reader.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A copy that stopped updating is said so (Roger, 2026-10-30: his mail-copy job had been suspended by an update of the application ten hours earlier and the line still read "updates every 10 minutes"): when the job is suspended, or the copy is stale while the job reads active, the line says when it stopped and why, and "Turn it back on" re-arms the job (deactivate when it still reads active, then activate), runs one pass and reloads the list from the copy. After a search the list's end note is cleared.
 */
(function () {
  'use strict';
  var form = document.getElementById('storeSearch'), input = document.getElementById('storeQuery');
  var line = document.getElementById('storeLine'), items = document.getElementById('items'), countEl = document.getElementById('count');
  if (!form || !line || !items) return;
  var SCHEDULE = { app: 'email-summarizer', name: 'mail-copy' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  function ago(iso) {
    var mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' h ago' : day(iso);
  }
  async function json(url, init) {
    var r = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }, init || {}));
    var body = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(body.message || body.error || ('HTTP ' + r.status));
    return body;
  }
  async function scheduleRow() {
    var list = await json('/api/v1/agent/schedules').catch(function () { return {}; });
    return (list.schedules || list.jobs || []).find(function (s) { return s.app === SCHEDULE.app && s.name === SCHEDULE.name; }) || null;
  }

  function describe(status, job) {
    var s = status.store, active = job && job.status === 'active', suspended = job && job.status === 'suspended';
    var stopped = Boolean(s && s.stored && (suspended || (active && status.fresh === false)));
    var copy = s && s.stored
      ? 'Searchable copy: ' + s.stored.toLocaleString() + ' messages back to ' + day(s.oldestAt) + (s.complete ? '' : ' (still filling)')
        + (stopped ? ' · stopped updating ' + ago(s.lastRunAt) + (suspended ? ' (an update of this application paused its job)' : '') : ' · updated ' + ago(s.lastRunAt))
      : 'Search reads Gmail directly (the last 30 days).';
    var why = s && s.lastError ? ' · last update failed: ' + esc(s.lastError) : '';
    var keep = active && !stopped ? ' · updates every 10 minutes' : '';
    var buttons = (stopped ? '<button type="button" class="refresh" data-store="rearm">Turn it back on</button>'
      : active ? '' : '<button type="button" class="refresh" data-store="keep">' + (s && s.stored ? 'Keep it up to date' : 'Keep a copy') + '</button>')
      + (s && s.stored ? '<button type="button" class="refresh" data-store="now">Update now</button>' : '');
    line.innerHTML = '<span>' + esc(copy) + why + esc(keep) + '</span>' + buttons;
    line.hidden = false;
  }

  async function refresh() {
    try {
      var both = await Promise.all([json('/api/email/sync/status'), scheduleRow()]);
      describe(both[0], both[1]);
    } catch (err) {
      line.hidden = true;
    }
  }

  var SAYING = { keep: 'Turning on your mail copy and storing the newest mail…', rearm: 'Turning your mail copy back on and storing the newest mail…', now: 'Storing new mail…' };
  /** Bind the job to the person again: an activation that still reads active is withdrawn first (its plan is stale), then activated. */
  async function rearm(job) {
    var url = '/api/v1/agent/schedules/' + encodeURIComponent(job.id);
    if (job.status === 'active') await json(url + '/deactivate', { method: 'POST', body: '{}' }).catch(function () { /* already withdrawn */ });
    await json(url + '/activate', { method: 'POST', body: JSON.stringify({ class: 'person' }) });
  }
  async function act(kind, button) {
    button.disabled = true;
    line.querySelector('span').textContent = SAYING[kind] || SAYING.now;
    try {
      if (kind === 'keep' || kind === 'rearm') {
        var job = await scheduleRow();
        if (!job) throw new Error('The mail-copy job is not available on this installation.');
        if (kind === 'rearm') await rearm(job);
        else if (job.status !== 'active') await json('/api/v1/agent/schedules/' + encodeURIComponent(job.id) + '/activate', { method: 'POST', body: JSON.stringify({ class: 'person' }) });
      }
      await json('/api/email/sync', { method: 'POST', body: '{}' });
    } catch (err) {
      line.querySelector('span').textContent = 'Could not update the copy: ' + err.message;
      button.disabled = false;
      return;
    }
    await refresh();
    if (kind === 'rearm' && window.load) window.load();
  }

  function render(found, words) {
    var more = document.getElementById('more');
    if (more) more.innerHTML = '';
    if (found.connected === false) { countEl.textContent = ''; items.innerHTML = '<div class="notice">' + esc(found.message || 'Connect a mailbox first.') + '</div>'; return; }
    var messages = found.messages || [];
    var where = found.source === 'stored' ? ' in your copy' : ' in Gmail';
    countEl.textContent = messages.length + (found.matchedAll === false ? ' close matches' : ' found') + where;
    if (!messages.length) { items.innerHTML = '<div class="empty">Nothing matched “' + esc(words) + '”' + esc(where) + '.</div>'; return; }
    items.innerHTML = '';
    messages.forEach(function (m) {
      var el = document.createElement('div');
      el.className = 'item' + (m.unread ? ' unread' : '');
      el.innerHTML = '<div class="row1"><span class="from">' + esc(window.shortFrom ? window.shortFrom(m.from) : m.from) + '</span><span class="when">' + esc(window.when ? window.when(m.date) : '') + '</span></div>'
        + '<div class="subj">' + esc(m.subject) + '</div><div class="snip">' + esc(m.snippet) + '</div>';
      el.onclick = function () { window.open(m, el); };
      items.appendChild(el);
    });
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var words = input.value.trim();
    if (!words) { if (window.load) window.load(); return; }
    items.innerHTML = '<div class="empty">Searching…</div>';
    try {
      render(await json('/api/email/messages?surface=1&max=50&days=180&q=' + encodeURIComponent(words)), words);
    } catch (err) {
      items.innerHTML = '<div class="notice">Could not search (' + esc(err.message) + ').</div>';
    }
  });
  line.addEventListener('click', function (event) {
    var button = event.target.closest('[data-store]');
    if (button) act(button.getAttribute('data-store'), button);
  });
  var reload = document.getElementById('refresh');
  if (reload && reload.addEventListener) reload.addEventListener('click', refresh);
  refresh();
})();
