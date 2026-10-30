/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Inbox's stored-copy controls (Roger, 2026-10-29: the concierge should search a stored copy of the mail): "Search all your mail" searches the person's stored Gmail copy over 180 days (or Gmail directly, 30 days, before there is one); the line under it says how many messages the copy holds, how far back and how fresh, and "Keep a copy" turns on the person's own mail-copy job (every 10 minutes) and stores the first part at once; "Update now" runs one pass. Loaded beside the page's own script, which keeps its listing and reader.
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
    var s = status.store, active = job && job.status === 'active';
    var copy = s && s.stored
      ? 'Searchable copy: ' + s.stored.toLocaleString() + ' messages back to ' + day(s.oldestAt) + (s.complete ? '' : ' (still filling)') + ' · updated ' + ago(s.lastRunAt)
      : 'Search reads Gmail directly (the last 30 days).';
    var why = s && s.lastError ? ' · last update failed: ' + esc(s.lastError) : '';
    var keep = active ? ' · updates every 10 minutes' : '';
    var buttons = (active ? '' : '<button type="button" class="refresh" data-store="keep">' + (s && s.stored ? 'Keep it up to date' : 'Keep a copy') + '</button>')
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

  async function act(kind, button) {
    button.disabled = true;
    line.querySelector('span').textContent = kind === 'keep' ? 'Turning on your mail copy and storing the newest mail…' : 'Storing new mail…';
    try {
      if (kind === 'keep') {
        var job = await scheduleRow();
        if (!job) throw new Error('The mail-copy job is not available on this installation.');
        if (job.status !== 'active') await json('/api/v1/agent/schedules/' + encodeURIComponent(job.id) + '/activate', { method: 'POST', body: JSON.stringify({ class: 'person' }) });
      }
      await json('/api/email/sync', { method: 'POST', body: '{}' });
    } catch (err) {
      line.querySelector('span').textContent = 'Could not update the copy: ' + err.message;
      button.disabled = false;
      return;
    }
    await refresh();
  }

  function render(found, words) {
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
  refresh();
})();
