"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: the operator's Sources & schedules page, served at /api/world/operations/app (operator-only mount). Two cards: World's schedules (from core GET /api/swarm/apps/world/schedules — on/off, cadence presets or a custom cron, reset to the manifest) and every place World pulls from (GET /api/world/operations/sources — per-subject feeds, the publisher firehose and the depth collectors, each with its switch, where it pulls from, which schedule uses it, the .env flags that govern it, its last-24-hour pulls or its last run).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review fixes before release: a failed change keeps its error on screen (the refresh after it no longer clears the banner); a cadence preset tighter than the server's minimum interval is offered disabled; a source that is both switched off and off in .env says both, and every source names the .env flags that govern it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A firehose feed whose own switch and flags are on says why it is not pulling while the whole firehose pass is switched off (core blockedBy), and a collector run that ended partial reads as a warning.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORLD_OPS_HTML = void 0;
/**
 * The World Sources & schedules page. A separate page from the read-only dashboard on purpose:
 * the dashboard is open to every viewer, while everything here changes shared, system-wide work
 * and is served only to operators. Inlined as a string so it ships in dist without an asset step.
 * This page is a String.raw template: nothing in it may use a backtick or a dollar-brace.
 */
exports.WORLD_OPS_HTML = String.raw `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>World Sources and Schedules</title>
<link rel="stylesheet" href="/shared/ui/css/surface-themes.css" />
<script src="/shared/ui/js/surface-theme.js"></script>
<style>
  :root {
    --bg:var(--bg-primary,#0b1020); --panel:var(--bg-card,#121a30); --panel2:var(--bg-tertiary,#0e1526); --ink:var(--text-primary,#e8edf7); --muted:var(--text-secondary,#8a97b4);
    --line:var(--border-color,#243150); --accent:var(--accent-primary,#46e5b7); --pos:var(--status-success,#46e5b7); --neg:var(--status-error,#ff6b81); --warn:var(--status-warning,#f5b84a);
  }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 Inter,system-ui,sans-serif; background:var(--bg); color:var(--ink); }
  header { padding:14px 18px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  header .dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  header h1 { font:600 16px Archivo,Inter,sans-serif; margin:0; letter-spacing:.3px; }
  header a { color:var(--accent); text-decoration:none; font-size:13px; margin-left:auto; }
  main { padding:18px 22px; max-width:1400px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:16px; }
  .card h2 { margin:0 0 4px; font:600 13px Inter; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); }
  .card h3 { margin:16px 0 6px; font:600 12px Inter; color:var(--ink); }
  .note { color:var(--muted); font-size:12px; margin:4px 0 10px; }
  .banner { border:1px solid var(--warn); color:var(--warn); border-radius:10px; padding:10px 14px; margin-bottom:16px; }
  .banner.err { border-color:var(--neg); color:var(--neg); }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.4px; white-space:nowrap; }
  code, .url { font:12px ui-monospace,SFMono-Regular,Consolas,monospace; color:var(--accent); word-break:break-all; }
  .muted { color:var(--muted); }
  .ok { color:var(--pos); } .bad { color:var(--neg); } .warn { color:var(--warn); }
  .pill { display:inline-block; font:600 11px Inter; padding:2px 8px; border-radius:999px; border:1px solid var(--line); white-space:nowrap; }
  select, input[type=text], button { background:var(--panel2); color:var(--ink); border:1px solid var(--line); border-radius:6px; padding:4px 8px; font:12px Inter,system-ui,sans-serif; }
  button { cursor:pointer; } button:hover { border-color:var(--accent); }
  input[type=checkbox] { width:18px; height:18px; accent-color:var(--accent); cursor:pointer; }
  .freq { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  .freq input[type=text] { width:150px; }
  .group td { background:var(--panel2); font-weight:600; }
  @media (max-width: 700px) { main { padding:14px; } }
</style>
</head>
<body>
<header>
  <span class="dot"></span>
  <h1>World Intelligence &middot; Sources and schedules</h1>
  <a href="/api/world/app">&larr; Dashboard</a>
</header>
<main>
  <div id="banner"></div>
  <section class="card">
    <h2>Schedules</h2>
    <div class="note" id="sched-note">Loading&hellip;</div>
    <div class="scroll" id="schedules"></div>
  </section>
  <section class="card">
    <h2>Where World pulls from</h2>
    <div class="note" id="src-note">Loading&hellip;</div>
    <div id="sources"></div>
  </section>
</main>
<script>
var SCHEDULES_URL = '/api/swarm/apps/world/schedules';
var SOURCES_URL = '/api/world/operations/sources';
// [cron, label, minutes between fires]; a preset under the server's minimum interval is offered disabled.
var PRESETS = [
  ['Market hours, weekdays', [['*/5 8-23 * * 1-5', 'every 5 minutes', 5], ['*/10 8-23 * * 1-5', 'every 10 minutes', 10], ['*/15 8-23 * * 1-5', 'every 15 minutes', 15], ['*/30 8-23 * * 1-5', 'every 30 minutes', 30], ['0 8-23 * * 1-5', 'hourly', 60]]],
  ['All day, every day', [['0 * * * *', 'every hour', 60], ['0 */2 * * *', 'every 2 hours', 120], ['0 */3 * * *', 'every 3 hours', 180], ['0 */6 * * *', 'every 6 hours', 360], ['0 */12 * * *', 'every 12 hours', 720], ['0 6 * * *', 'daily at 06:00', 1440]]]
];
var minIntervalMinutes = 5;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function when(iso) {
  if (!iso) return '<span class="muted">&mdash;</span>';
  var d = new Date(iso);
  return esc(d.toISOString().replace('T', ' ').slice(0, 16)) + ' UTC';
}
function presetLabel(cron) {
  for (var g = 0; g < PRESETS.length; g++) for (var i = 0; i < PRESETS[g][1].length; i++) {
    if (PRESETS[g][1][i][0] === cron) return PRESETS[g][1][i][1] + ' (' + PRESETS[g][0].toLowerCase() + ')';
  }
  return '';
}
function request(url, method, body) {
  var opts = { method: method || 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch(url, opts).then(function (r) {
    return r.json().catch(function () { return null; }).then(function (j) {
      if (r.status === 401 || r.status === 403) throw new Error('Only a swarm operator can see and change World schedules and sources.');
      if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
      return j;
    });
  });
}
function banner(html, isError) {
  document.getElementById('banner').innerHTML = html ? '<div class="banner' + (isError ? ' err' : '') + '">' + html + '</div>' : '';
}

function freqControl(s) {
  var opts = '<option value="">Change frequency&hellip;</option>';
  for (var g = 0; g < PRESETS.length; g++) {
    opts += '<optgroup label="' + esc(PRESETS[g][0]) + '">';
    for (var i = 0; i < PRESETS[g][1].length; i++) {
      var p = PRESETS[g][1][i];
      var tooTight = p[2] < minIntervalMinutes;
      opts += '<option value="' + esc(p[0]) + '"' + (p[0] === s.cron || tooTight ? ' disabled' : '') + '>' + esc(p[1]) + (tooTight ? ' (under the ' + esc(minIntervalMinutes) + '-minute minimum)' : '') + '</option>';
    }
    opts += '</optgroup>';
  }
  return '<div class="freq"><select data-preset="' + esc(s.id) + '" aria-label="Frequency preset for ' + esc(s.id) + '">' + opts + '</select>'
    + '<input type="text" data-custom="' + esc(s.id) + '" placeholder="custom cron" aria-label="Custom cron for ' + esc(s.id) + '" />'
    + '<button data-apply="' + esc(s.id) + '">Apply</button>'
    + (s.override ? '<button data-reset="' + esc(s.id) + '">Reset to manifest</button>' : '') + '</div>';
}
function scheduleRow(s) {
  var label = presetLabel(s.cron);
  var cronCell = '<code>' + esc(s.cron) + '</code>' + (label ? '<div class="muted">' + esc(label) + '</div>' : '')
    + (s.cron !== s.manifestCron ? '<div class="muted">manifest: <code>' + esc(s.manifestCron) + '</code></div>' : '');
  var on = s.controllable
    ? '<input type="checkbox" data-sched="' + esc(s.id) + '"' + (s.enabled ? ' checked' : '') + ' aria-label="Run ' + esc(s.id) + '" />'
    : '<span class="pill">' + esc(s.scope === 'per-user' ? 'per user' : 'off in manifest') + '</span>';
  var state = !s.controllable ? '<span class="muted">not controllable here</span>'
    : !s.registered ? '<span class="warn">not registered</span>'
    : s.enabled ? '<span class="ok">on</span>' : '<span class="bad">off</span>';
  return '<tr><td>' + on + '</td><td><strong>' + esc(s.id) + '</strong><div class="muted">' + esc(s.description || '') + '</div></td>'
    + '<td>' + state + '</td><td>' + cronCell + '</td><td>' + when(s.nextRunAt) + '</td><td>' + when(s.lastRunAt) + '</td>'
    + '<td>' + (s.executionCount == null ? '&mdash;' : esc(s.executionCount)) + '</td><td>' + (s.controllable ? freqControl(s) : '') + '</td></tr>';
}
function paintSchedules(j) {
  if (Number(j.minIntervalMinutes) > 0) minIntervalMinutes = Number(j.minIntervalMinutes);
  var note = 'Times are shown in UTC; the scheduler reads each cron in the server clock (' + esc(j.timezone) + '). '
    + 'A cadence tighter than ' + esc(j.minIntervalMinutes) + ' minutes between fires is refused. A change applies at once and survives restarts.';
  if (!j.schedulerEnabled) note = '<span class="warn">The agent scheduler is off on this deployment (ENABLE_AGENT_SCHEDULER), so no schedule fires.</span> ' + note;
  document.getElementById('sched-note').innerHTML = note;
  document.getElementById('schedules').innerHTML = '<table><thead><tr><th>On</th><th>Job</th><th>State</th><th>Runs on</th><th>Next run</th><th>Last run</th><th>Runs</th><th>Frequency</th></tr></thead><tbody>'
    + j.schedules.map(scheduleRow).join('') + '</tbody></table>';
}

function gateText(s) {
  var off = s.gates.filter(function (g) { return !g.on; }).map(function (g) { return g.name; });
  var parts = [];
  if (!s.switchedOn) parts.push('<span class="bad">switched off</span>');
  if (off.length) parts.push('<span class="warn">off in .env (' + esc(off.join(', ')) + ')</span>');
  if (s.blockedBy) parts.push('<span class="warn">not pulling: ' + esc(s.blockedBy) + '</span>');
  return parts.length ? parts.join('<br>') : '<span class="ok">pulling</span>';
}
function activity(s) {
  if (s.kind === 'collector') {
    if (!s.lastRun) return '<span class="muted">no run recorded yet</span>';
    var r = s.lastRun, cls = r.outcome === 'ok' ? 'ok' : r.outcome === 'failed' ? 'bad' : 'warn';
    var d = r.detail || {}, bits = [];
    Object.keys(d).forEach(function (k) { if (typeof d[k] !== 'object') bits.push(k + ' ' + d[k]); });
    return when(r.ranAt) + ' <span class="' + cls + '">' + esc(r.outcome) + '</span><div class="muted">' + esc(bits.slice(0, 5).join(' · ')) + '</div>';
  }
  if (s.id === 'firehose') return '<span class="muted">see each feed below</span>';
  if (!s.last24h) return '<span class="muted">no successful pull in 24 h</span>';
  return esc(s.last24h.pulls) + ' pulls &middot; ' + esc(s.last24h.fetched) + ' items &middot; ' + esc(s.last24h.newItems) + ' new<div class="muted">last ' + when(s.last24h.lastPull) + '</div>';
}
function sourceRow(s, group) {
  var urls = s.urls.length ? s.urls.map(function (u) { return '<div class="url">' + esc(u) + '</div>'; }).join('') : '<span class="muted">&mdash;</span>';
  return '<tr' + (group ? ' class="group"' : '') + '><td><input type="checkbox" data-src="' + esc(s.id) + '"' + (s.switchedOn ? ' checked' : '') + ' aria-label="Pull from ' + esc(s.name) + '" /></td>'
    + '<td>' + esc(s.name) + '<div class="muted">' + esc(s.id) + '</div>' + (s.note ? '<div class="muted">' + esc(s.note) + '</div>' : '')
    + (s.gates.length ? '<div class="muted">.env: ' + esc(s.gates.map(function (g) { return g.name; }).join(', ')) + '</div>' : '') + '</td>'
    + '<td>' + urls + '</td><td>' + esc(s.usedBy.join(', ')) + '</td><td>' + activity(s) + '</td><td>' + gateText(s) + '</td></tr>';
}
function sourceTable(title, rows) {
  if (!rows.length) return '';
  return '<h3>' + esc(title) + '</h3><div class="scroll"><table><thead><tr><th>On</th><th>Source</th><th>Pulls from</th><th>Used by</th><th>Activity</th><th>Status</th></tr></thead><tbody>'
    + rows.join('') + '</tbody></table></div>';
}
function paintSources(j) {
  var feeds = j.sources.filter(function (s) { return s.kind === 'feed'; });
  var fire = j.sources.filter(function (s) { return s.kind === 'firehose'; });
  var collectors = j.sources.filter(function (s) { return s.kind === 'collector'; });
  document.getElementById('src-note').innerHTML = 'A switch only turns a source off; the .env flags stay the ceiling. Feeds and the firehose follow a change within '
    + esc(Math.round(j.switchTtlMs / 1000)) + ' s; collectors at the next depth refresh. Activity counts successful pulls only: a feed that failed or returned nothing writes no pull record.';
  document.getElementById('sources').innerHTML = sourceTable('Per-subject feeds', feeds.map(function (s) { return sourceRow(s, false); }))
    + sourceTable('Publisher firehose', fire.map(function (s) { return sourceRow(s, s.id === 'firehose'); }))
    + sourceTable('Depth collectors (world-refresh)', collectors.map(function (s) { return sourceRow(s, false); }));
}

// Re-reads both cards. It leaves the banner alone, so a failed change keeps its error on screen.
function refresh() {
  request(SCHEDULES_URL).then(paintSchedules).catch(function (e) {
    document.getElementById('sched-note').innerHTML = '<span class="bad">' + esc(e.message) + '</span>';
    document.getElementById('schedules').innerHTML = '';
  });
  request(SOURCES_URL).then(paintSources).catch(function (e) {
    document.getElementById('src-note').innerHTML = '<span class="bad">' + esc(e.message) + '</span>';
    document.getElementById('sources').innerHTML = '';
  });
}
function change(url, body, what) {
  return request(url, 'PATCH', body).then(function () { banner(''); refresh(); }).catch(function (e) {
    banner(esc(what) + ': ' + esc(e.message), true);
    refresh();
  });
}
function scheduleUrl(id) { return SCHEDULES_URL + '/' + encodeURIComponent(id); }

document.addEventListener('change', function (ev) {
  var t = ev.target;
  if (t.dataset.sched) change(scheduleUrl(t.dataset.sched), { enabled: t.checked }, 'Schedule ' + t.dataset.sched);
  else if (t.dataset.src) change(SOURCES_URL + '/' + encodeURIComponent(t.dataset.src), { enabled: t.checked }, 'Source ' + t.dataset.src);
  else if (t.dataset.preset && t.value) change(scheduleUrl(t.dataset.preset), { cron: t.value }, 'Schedule ' + t.dataset.preset);
});
document.addEventListener('click', function (ev) {
  var t = ev.target;
  if (t.dataset.apply) {
    var input = document.querySelector('input[data-custom="' + t.dataset.apply + '"]');
    var cron = input ? input.value.trim() : '';
    if (cron) change(scheduleUrl(t.dataset.apply), { cron: cron }, 'Schedule ' + t.dataset.apply);
  } else if (t.dataset.reset) {
    change(scheduleUrl(t.dataset.reset), { cron: null, enabled: true }, 'Schedule ' + t.dataset.reset);
  }
});
refresh();
</script>
</body>
</html>
`;
//# sourceMappingURL=world-ops-html.js.map