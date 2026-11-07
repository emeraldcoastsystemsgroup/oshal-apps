"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-20 00:00:00 | roger.murphy@agenticfederal.us   | Layer B: World Intelligence cockpit surface (read-only dashboard)
 * 2026-07-24 21:00:00 | @codex-surface-audit | Inherit the swarm control-plane theme instead of forcing a fixed dark palette.
 * 2026-07-29 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Read window is a visible control defaulting to 90 days, not a hardcoded 3650. Asking every panel for "all history" made the metric store plan across ~50 years of daily buckets - more time planning than reading (1.1s of PLANNING per sentiment read). Also drops a stale in-flight response when the user has already clicked another subject.
 * 2026-07-31 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | The 1.0.1 edit dropped the `async function load() {` declaration, leaving a top-level await — a SyntaxError in a classic script, so the page never loaded at all. Restored, and the three per-subject reads now paint their cards independently as each lands (generation-guarded against subject AND window races) instead of one Promise.all blocking first paint on the slowest read — the pull ledger can run seconds cold after a deploy while sentiment is ~100ms. Guard: tests/surface-parse.test.js.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The company audience view for the Business shell (ADR-164 D6): ?audience=company paints a coverage desk through the shared kit from /entities, /home-summary and /pulls for the most covered subject over 30 days (tracked subjects with a quiet-for-24-h status, the last day's coverage counts, headlines opening their source in a new tab, the next recorded event, the pull-rate), and the dashboard's window binding and load() run only when no audience view renders. The block is plain string concatenation because this page is a String.raw template. Guards: tests/audience-view.test.cjs, tests/surface-parse.test.js.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: the dashboard reads sentiment through oshal's own observed outlet ratings (core ADR-061, 2026-10-01; the seed table and its political/economic/kind axes are retired). The lean axis shows sources that usually read below, near and above the others; the by-source table shows each rating with its compared subject-days, subjects and date range, or insufficient data below the stated minimums; the note states the method with its own numbers. A server that reports no ratings gets a plain notice instead of numbers. Guard: tests/surface-ratings.test.js.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: a "Sources & schedules" header link to the operator page (/api/world/operations/app), shown only when its operator-only route answers /ping; the dashboard itself stays read-only.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Phone width: the stacked grid column is minmax(0,1fr) and main may shrink below its content, so the by-source table (nowrap, ~1224px) scrolls inside its own box instead of widening the whole page to 1290px. Guard: scripts/phone-screens.browser.cjs (world).
 * 9 | maintainer@emeraldcoastsystemsgroup.com | 1.4.7 (UX audit 2026-11-06): one window control (the select repeating the four pills is gone; the pills are buttons, 44px on a phone), names only (human() turns world:ticker:nvda into NVDA and outlet ids into words), a subject search, and By source shows 15 rows with Show more. Guard: tests/ux-controls.test.js.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | 1.4.8 (UX audit 2026-11-06): add asset filter chips above subjects, By source / Entity graph tabs under the KPI and lean cards, sortable Lean/Reliability/Sentiment column headers on By source, phone Subject picker collapsing the rail so KPI tiles appear first, and remove Pull-rate ops table from the analyst view.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORLD_APP_HTML = void 0;
/**
 * The World Intelligence cockpit surface — a read-only dashboard over the shared world
 * layer. Lists tracked subjects (/entities), and for the selected one renders the
 * bias-aware sentiment read through oshal's own observed outlet ratings (each with its
 * counts and date range, or insufficient data), the entity co-mention graph, and
 * pull-rate. Pure vanilla JS hitting the OPEN read endpoints; ingestion is the
 * world_ingest TOOL (run by the analyst bot / Jarvis), not a button here. Inlined as a
 * string so it ships in dist without an asset-copy step.
 */
exports.WORLD_APP_HTML = String.raw `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>World Intelligence</title>
<link rel="stylesheet" href="/shared/ui/css/surface-themes.css" />
<script src="/shared/ui/js/surface-theme.js"></script>
<!-- Audience view (ADR-164 D6). The Business shell opens this page with ?audience=company: a coverage desk over the
     swarm's SHARED news archive (the same numbers for every member): the subjects tracked, the last day's coverage,
     fresh headlines with their sources, the next recorded event and the pull-rate of the most covered subject, from
     the SAME /api/world routes, painted by the shared kit in the company grammar. On open it reads only /entities,
     /home-summary and /pulls for one subject over 30 days: no ingest, no classification, no model call and no write
     (every write here needs the ingest token). Any other request runs the full dashboard below unchanged.
     This page is a String.raw template: nothing in this block may use a backtick or a dollar-brace. -->
<link rel="stylesheet" href="/shared/ui/css/app-view.css" />
<style>
  /* Under an audience view: the page's own main rule scrolls and its narrow-screen table rule turns every table into
     a nowrap block; the kit's root is a main and its tables are real tables, so set both back. */
  html[data-audience] #av-root { overflow: visible; }
  html[data-audience] .av-table { display: table; white-space: normal; }
</style>
<script src="/shared/ui/js/app-view.js"></script>
<script>
(function () {
  var A = window.AppView; if (!A) return;
  var FULL = '/cockpit/?app=world', LIMIT = 60, SHOWN = 12, DAY = 864e5, WINDOW = 30;
  var METRICS = [['fetched-24h', 'Fetched / 24h'], ['new-subject-items-24h', 'New subject items / 24h'], ['pulls-24h', 'Feed pulls / 24h'], ['subjects-24h', 'Subjects pulled / 24h']];
  function call(path) {
    return fetch('/api/world' + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j || {} }; });
    });
  }
  function right(label) { return { label: label, align: 'right' }; }
  // The home summary answers 503 with its full body when every coverage read failed, so read the body, not the status.
  function summaryState(res) {
    if (res.status === 401 || res.status === 403) return { body: null, reason: 'Sign in to see the shared coverage.' };
    if (res.body && Array.isArray(res.body.metrics)) return { body: res.body, reason: null };
    return { body: null, reason: 'The world archive is unavailable right now.' };
  }
  // The route's items in its own order: up to three headlines, at most one recorded event (highlight), then one
  // coverage note last. A headline whose link failed the route's check carries no sourceUrl and opens nothing.
  function summaryParts(body) {
    var items = (body && body.items) || [], last = items[items.length - 1], note = last && !last.highlight ? last : null, rest = note ? items.slice(0, -1) : items;
    return { note: note, upcoming: rest.filter(function (i) { return i.highlight; })[0] || null, headlines: rest.filter(function (i) { return !i.highlight; }) };
  }
  function stats(subjects, sum) {
    var byId = {}, full = subjects.length >= LIMIT;
    ((sum.body && sum.body.metrics) || []).forEach(function (m) { byId[m.id] = m; });
    return [{ id: 'subjects', label: 'Subjects tracked', value: full ? LIMIT + '+' : subjects.length, hint: full ? 'The ' + LIMIT + ' most covered are listed' : null }].concat(METRICS.map(function (d) {
      var m = byId[d[0]], v = m ? m.value : null, known = v !== null && v !== undefined && v !== 'Unavailable';
      return { id: d[0], label: (m && m.label) || d[1], value: known ? A.num(v) : '—', hint: known ? null : sum.reason || 'Could not be read', tone: known ? null : 'warn' };
    }));
  }
  function subjectRow(s, now) {
    var t = Date.parse(s.lastSeen || ''), quiet = !t || now - t > DAY;
    return [s.label || s.entity, A.num(s.items), s.lastSeen ? A.when(s.lastSeen) : '—', { text: !t ? 'Never seen' : quiet ? 'Nothing new in 24 h' : 'Seen in 24 h', tone: quiet ? 'warn' : null }];
  }
  function headlines(parts, sum) {
    var items = parts.headlines.map(function (h) { return { title: h.text, text: h.detail || null, href: h.sourceUrl || null, target: h.sourceUrl ? '_blank' : null, meta: h.sourceUrl ? 'Source' : null }; });
    if (parts.note && parts.note.tone === 'warn') items.push({ title: parts.note.text, tone: 'warn', badge: 'Partial' });
    return { kind: 'list', id: 'headlines', title: 'Headlines, last 48 hours', note: parts.note ? parts.note.detail || null : null, items: items,
      empty: sum.reason || (parts.note && parts.note.text) || 'No headlines in this coverage sample.' };
  }
  function upcoming(parts, sum) {
    var u = parts.upcoming, partial = !!(sum.body && sum.body.partial);
    return { kind: 'list', id: 'upcoming', title: 'Upcoming', items: u ? [{ title: String(u.text || '').replace(/^Upcoming: /, ''), text: u.detail || null, badge: 'Recorded event' }] : [],
      empty: sum.reason || (partial ? 'No recorded event to show; part of the coverage read failed.' : 'No recorded event in the next 7 days.') };
  }
  function pullRate(top, res) {
    var label = top.label || top.entity, body = res.ok ? res.body : {}, rows = body.bySource || [];
    return { kind: 'table', id: 'pulls', title: 'Pull-rate · ' + label + ' · ' + WINDOW + ' days', note: res.ok ? A.num(body.archivedItems || 0) + ' new items archived for ' + label + ' in ' + WINDOW + ' days. Fresh rate is new items over fetched.' : null,
      empty: res.ok ? 'No feed pulls recorded for ' + label + ' in ' + WINDOW + ' days.' : 'The pull ledger could not be read (HTTP ' + res.status + ').',
      columns: ['Source', right('Pulls'), right('Fetched'), right('New'), right('Fresh rate'), 'Last pull'],
      rows: rows.map(function (p) { return [p.feedId, A.num(p.pulls), A.num(p.fetched), A.num(p.newItems), p.freshRate == null ? '—' : A.pct(p.freshRate), p.lastPull ? A.when(p.lastPull) : '—']; }) };
  }
  function desk(subjects, sum, pulls) {
    var top = subjects[0], now = Date.now(), parts = summaryParts(sum.body);
    var sections = [
      { kind: 'table', id: 'subjects', title: 'Tracked subjects', note: subjects.length > SHOWN ? 'The ' + SHOWN + ' most covered of the ' + subjects.length + ' listed.' : null,
        empty: 'No subjects tracked yet. Ask the World Analyst to ingest one, or run the world_ingest tool.',
        columns: ['Subject', right('Items'), 'Last item seen', 'Status'], rows: subjects.slice(0, SHOWN).map(function (s) { return subjectRow(s, now); }) },
      headlines(parts, sum), upcoming(parts, sum)
    ];
    if (top) sections.push(pullRate(top, pulls));
    return { kicker: 'World Intelligence', title: 'Coverage desk',
      lede: (top ? 'Most covered: ' + (top.label || top.entity) + ' (' + A.num(top.items) + ' items). ' : 'No subjects tracked yet. ') + 'One shared news archive: every member sees the same coverage.',
      actions: [{ label: 'Open World Intelligence', primary: true, onClick: function () { A.open(FULL); } }], stats: stats(subjects, sum), sections: sections };
  }
  function company() {
    return Promise.all([call('/entities?limit=' + LIMIT + '&surface=1'), call('/home-summary')]).then(function (r) {
      var ent = r[0];
      if (ent.ok && ent.body.enabled === false) return { kicker: 'World Intelligence', title: 'World Intelligence is not configured', lede: ent.body.message || 'This deployment has not turned World Intelligence on.' };
      if (!ent.ok) throw new Error('World Intelligence could not read the tracked subjects (HTTP ' + ent.status + ').');
      var subjects = ent.body.entities || [], sum = summaryState(r[1]);
      var pulls = subjects.length ? call('/pulls?entity=' + encodeURIComponent(subjects[0].entity) + '&days=' + WINDOW + '&surface=1') : Promise.resolve(null);
      return pulls.then(function (p) { return desk(subjects, sum, p); });
    });
  }
  // ADR-164 D6: the other shells' audience (family) paints this same account-scoped card in its own grammar; the reads and the model do not change.
  A.boot({ app: 'world', escapeLabel: 'Open World Intelligence in the cockpit', audiences: { company: company, family: company } });
})();
</script>
<style>
  :root {
    --bg:var(--bg-primary,#0b1020); --panel:var(--bg-card,#121a30); --panel2:var(--bg-tertiary,#0e1526); --ink:var(--text-primary,#e8edf7); --muted:var(--text-secondary,#8a97b4);
    --line:var(--border-color,#243150); --accent:var(--accent-primary,#46e5b7); --pos:var(--status-success,#46e5b7); --neg:var(--status-error,#ff6b81); --neu:var(--text-muted,#8a97b4);
    --left:#5b8cff; --center:#b9c2da; --right:#ff8f5b;
  }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 Inter,system-ui,sans-serif; background:var(--bg); color:var(--ink); }
  header { padding:14px 18px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:10px; }
  header .dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  header h1 { font:600 16px Archivo,Inter,sans-serif; margin:0; letter-spacing:.3px; }
  header .sub { color:var(--muted); font-size:12px; margin-left:auto; }
  header .ops { color:var(--accent); font-size:12px; text-decoration:none; white-space:nowrap; }
  header .win { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.5px; display:flex; align-items:center; gap:6px; }
  header .win select { background:var(--panel2); color:var(--ink); border:1px solid var(--line); border-radius:6px; padding:3px 6px; font:12px Inter,system-ui,sans-serif; text-transform:none; letter-spacing:0; }
  .win-pills { display:inline-flex; flex-wrap:wrap; gap:4px; align-items:center; }
  .win-pill { cursor:pointer; user-select:none; background:var(--panel2); color:var(--muted); font:600 11px Inter,system-ui,sans-serif; padding:3px 8px; border-radius:999px; border:1px solid var(--line); }
  .win-pill:hover, .win-pill:focus-visible { border-color:var(--accent); color:var(--ink); outline:none; }
  .win-pill.active { background:var(--panel); border-color:var(--accent); color:var(--accent); }
  /* One window control (UX audit 2026-11-06): the select that repeated these four pills is gone; the pills are a
     segmented control, 44px tall on a phone. */
  .win-pills .win-pill { min-height:32px; padding:0 12px; font-size:12px; }
  @media (max-width:640px) { .win-pills .win-pill { min-height:44px; padding:0 14px; } }
  .subj-search { width:100%; box-sizing:border-box; margin:0 0 8px; padding:8px 10px; background:var(--panel2); color:var(--ink); border:1px solid var(--line); border-radius:8px; font:13px Inter,system-ui,sans-serif; }
  .kind-chips { display:flex; flex-wrap:wrap; gap:5px; padding:0 12px 10px; border-bottom:1px solid var(--line); }
  .kind-chip { cursor:pointer; background:var(--panel); color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 10px; font:600 11px Inter,system-ui,sans-serif; }
  .kind-chip.active { border-color:var(--accent); color:var(--accent); }
  .subj-picker-btn { display:none; cursor:pointer; background:var(--panel2); color:var(--ink); border:1px solid var(--line); border-radius:999px; padding:0 14px; min-height:44px; font:600 12.5px Inter,system-ui,sans-serif; align-items:center; gap:6px; }
  .view-tabs { display:flex; gap:6px; margin:0 0 14px; }
  .view-tab { cursor:pointer; background:var(--panel2); color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:6px 14px; min-height:36px; font:600 12px Inter,system-ui,sans-serif; }
  .view-tab.active { background:var(--panel); border-color:var(--accent); color:var(--accent); }
  .th-sort { cursor:pointer; background:none; border:0; padding:0; color:inherit; font:inherit; text-transform:inherit; letter-spacing:inherit; display:inline-flex; align-items:center; gap:4px; }
  .th-sort:hover { color:var(--accent); }
  .more { margin-top:8px; background:var(--panel2); color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:8px 14px; font:600 12px Inter,system-ui,sans-serif; cursor:pointer; min-height:40px; }
  .subj:focus-visible { outline:1px solid var(--accent); outline-offset:-1px; }
  .wrap { display:grid; grid-template-columns:280px 1fr; height:calc(100vh - 52px); }
  .rail { border-right:1px solid var(--line); overflow:auto; background:var(--panel2); }
  .rail h2 { font:600 11px Inter; text-transform:uppercase; letter-spacing:1px; color:var(--muted); padding:14px 16px 6px; margin:0; }
  .subj { padding:10px 16px; border-bottom:1px solid var(--line); cursor:pointer; }
  .subj:hover { background:var(--panel); }
  .subj.active { background:var(--panel); border-left:3px solid var(--accent); padding-left:13px; }
  .subj .nm { font-weight:600; }
  .subj .meta { color:var(--muted); font-size:12px; }
  main { overflow:auto; padding:18px 22px; }
  .empty { color:var(--muted); padding:40px; text-align:center; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:16px; }
  .card h3 { margin:0 0 12px; font:600 13px Inter; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); }
  .row { display:flex; flex-wrap:wrap; gap:10px; }
  .stat { background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:10px 14px; min-width:120px; }
  .stat .k { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
  .stat .v { font:700 20px Archivo,Inter; margin-top:2px; }
  .axis { margin:12px 0; }
  .axis .lbl { font-weight:600; margin-bottom:6px; }
  .bars { display:flex; flex-direction:column; gap:6px; }
  .bar { display:grid; grid-template-columns:120px 1fr 56px; align-items:center; gap:10px; }
  .bar .name { color:var(--muted); font-size:12px; }
  .track { height:14px; background:var(--panel2); border-radius:7px; position:relative; overflow:hidden; }
  .fill { position:absolute; top:0; bottom:0; left:50%; border-radius:7px; }
  .bar .val { text-align:right; font-variant-numeric:tabular-nums; font-size:12px; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; border:1px solid var(--line); margin:2px 4px 2px 0; }
  .pos { color:var(--pos); } .neg { color:var(--neg); } .neu { color:var(--neu); }
  .pill { font:600 11px Inter; padding:3px 9px; border-radius:999px; border:1px solid var(--line); }
  .grp { margin-bottom:10px; } .grp .gt { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.4px; }
  .note { color:var(--muted); font-size:12px; margin-top:6px; }
  code { background:var(--panel2); padding:1px 6px; border-radius:5px; color:var(--accent); }
  /* Mobile: the fixed 280px rail crushes the main pane on a phone. Stack them — the subject
     rail becomes a bounded, scrollable strip on top and the detail flows below (page scrolls). */
  @media (max-width: 700px) {
    .wrap { grid-template-columns:minmax(0,1fr); height:auto; }
    .rail { display:none; border-right:none; border-bottom:1px solid var(--line); max-height:55vh; background:var(--bg); }
    .rail.open { display:block; }
    .subj-picker-btn { display:inline-flex; }
    .kind-chip, .view-tab, .subj-search { min-height:44px; }
    header { flex-wrap:wrap; }
    header .sub { display:none; }
    main { padding:14px; overflow:visible; min-width:0; }
    .bar { grid-template-columns:88px 1fr 46px; gap:8px; }
    .stat { min-width:calc(50% - 5px); flex:1; }
    table { display:block; max-width:100%; overflow-x:auto; white-space:nowrap; }
  }
</style>
</head>
<body>
<header>
  <a id="cockpit-link" class="ops" href="/cockpit/">&larr; Cockpit</a>
  <span class="dot"></span>
  <h1>World Intelligence</h1>
  <button type="button" id="subjPickerBtn" class="subj-picker-btn" aria-expanded="false" onclick="toggleSubjRail()">Subject &#9662;</button>
  <div class="win-pills" role="group" aria-label="Time window">
    <button type="button" class="pill win-pill" aria-pressed="false" data-win="30" aria-label="30 days">30 d</button>
    <button type="button" class="pill win-pill active" aria-pressed="true" data-win="90" aria-label="90 days">90 d</button>
    <button type="button" class="pill win-pill" aria-pressed="false" data-win="365" aria-label="1 year">1 y</button>
    <button type="button" class="pill win-pill" aria-pressed="false" data-win="3650" aria-label="All history">All</button>
  </div>
  <span class="sub">bias-aware sentiment &middot; entity graph</span>
  <a id="ops-link" class="ops" href="/api/world/operations/app" hidden>Sources &amp; schedules</a>
</header>
<div class="wrap">
  <aside class="rail" id="subjRail">
    <h2>Tracked subjects</h2>
    <div style="padding:0 12px"><input id="subjSearch" class="subj-search" type="search" placeholder="Search subjects" aria-label="Search tracked subjects"></div>
    <div class="kind-chips" id="kindChips" role="group" aria-label="Filter by asset class">
      <button type="button" class="kind-chip active" data-kind="" onclick="setSubjectKind(this, '')">All</button>
      <button type="button" class="kind-chip" data-kind="ticker" onclick="setSubjectKind(this, 'ticker')">Stocks</button>
      <button type="button" class="kind-chip" data-kind="market" onclick="setSubjectKind(this, 'market')">Markets</button>
      <button type="button" class="kind-chip" data-kind="topic" onclick="setSubjectKind(this, 'topic')">Topics</button>
      <button type="button" class="kind-chip" data-kind="crypto" onclick="setSubjectKind(this, 'crypto')">Crypto</button>
      <button type="button" class="kind-chip" data-kind="commodity" onclick="setSubjectKind(this, 'commodity')">Commodities</button>
    </div>
    <div id="subjects"></div>
  </aside>
  <main id="main"><div class="empty">Loading tracked subjects&hellip;</div></main>
</div>
<script>
const api = (p) => {
  const sep = p.includes('?') ? '&' : '?';
  return fetch('/api/world' + p + sep + 'surface=1').then(r => r.json());
};
const fmt = (n) => (n === null || n === undefined) ? '&mdash;' : (n > 0 ? '+' : '') + Number(n).toFixed(2);
const cls = (n) => n == null ? 'neu' : (n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : 'neu');
const colorFor = (n) => n == null ? '#46506e' : (n >= 0 ? 'var(--pos)' : 'var(--neg)');

function bar(name, val) {
  if (val == null) return '<div class="bar"><span class="name">'+name+'</span><div class="track"></div><span class="val neu">&mdash;</span></div>';
  const w = Math.min(50, Math.abs(val) * 50); // -1..1 -> half-track
  const side = val >= 0 ? 'left:50%;' : 'right:50%;';
  return '<div class="bar"><span class="name">'+name+'</span><div class="track"><span class="fill" style="'+side+'width:'+w+'%;background:'+colorFor(val)+'"></span></div><span class="val '+cls(val)+'">'+fmt(val)+'</span></div>';
}
function axis(label, obj) {
  const keys = Object.keys(obj || {});
  if (!keys.length) return '';
  return '<div class="axis"><div class="lbl">'+label+'</div><div class="bars">'+keys.map(k => bar(k, obj[k])).join('')+'</div></div>';
}

let subjects = [];
let selected = 0;
// The read window, in days. This used to be hardcoded to 3650 ("all history") on every panel, which
// is the worst possible default: the metric store buckets by day across ~50 years of real article
// publication dates, so asking for everything made the database plan across every chunk it owns —
// more time spent planning than reading. 90 days covers ~98% of the archive; "all history" is still
// one click away when someone actually wants the long tail.
let win = 90;
// Monotonic read generation: selecting a subject or changing the window bumps it, and any paint
// from an older generation is dropped — covers both the "clicked another subject" race and the
// "changed the window while a read was in flight" race with one guard.
let gen = 0;

function syncWinPills() {
  document.querySelectorAll('.win-pill').forEach(p => {
    const active = Number(p.dataset.win) === win;
    p.classList.toggle('active', active);
    if (p.setAttribute) p.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setWin(w) {
  win = Number(w) || 90;
  syncWinPills();
  if (subjects.length) select(selected);
}

// Operators get a link to the Sources & schedules page: its route answers only for an operator, so everyone
// else never sees the link. Full page only (load() never runs under an audience view); a probe that fails
// leaves the link hidden and never stops the dashboard.
function showOpsLink() {
  try {
    if (window.self && window.top && window.self !== window.top) {
      document.getElementById('cockpit-link').hidden = true;
    }
    fetch('/api/world/operations/ping', { credentials: 'same-origin' })
      .then((r) => { if (r.ok) document.getElementById('ops-link').hidden = false; })
      .catch(() => {});
  } catch (e) { /* no link without the probe */ }
}

async function load() {
  showOpsLink();
  document.querySelectorAll('.win-pill').forEach(p => {
    const pickWin = () => setWin(p.dataset.win);
    p.onclick = pickWin;
    p.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickWin(); } };
  });
  syncWinPills();
  const r = await api('/entities?limit=60');
  if (r && r.enabled === false) {
    const msg = esc(r.message || 'World Intelligence is not configured yet.');
    document.getElementById('subjects').innerHTML = '<div class="note" style="padding:16px">'+msg+'</div>';
    document.getElementById('main').innerHTML = '<div class="empty">'+msg+'</div>';
    return;
  }
  subjects = (r && r.entities) || r || [];
  const el = document.getElementById('subjects');
  if (!subjects.length) { el.innerHTML = '<div class="note" style="padding:16px">No subjects tracked yet. Ask the World Analyst to ingest one, or run the <code>world_ingest</code> tool.</div>'; return; }
  el.innerHTML = subjects.map((s,i) =>
    '<div class="subj" role="button" tabindex="0" data-i="'+i+'"><div class="nm">'+esc(s.label || human(s.entity))+'</div><div class="meta">'+s.items+' items</div></div>'
  ).join('');
  el.querySelectorAll('.subj').forEach(n => {
    const pick = () => select(Number(n.dataset.i));
    n.onclick = pick;
    n.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
  });
  const search = document.getElementById('subjSearch');
  if (search) search.oninput = () => filterSubjects(search.value);
  select(0);
}
let subjKind = '';
let detailTab = 'sources';
function toggleSubjRail() {
  const rail = document.getElementById('subjRail');
  const btn = document.getElementById('subjPickerBtn');
  if (!rail) return;
  const open = rail.classList.toggle('open');
  if (btn && btn.setAttribute) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function setSubjectKind(btn, kind) {
  subjKind = kind || '';
  document.querySelectorAll('.kind-chip').forEach((c) => { c.classList.toggle('active', c === btn); });
  const search = document.getElementById('subjSearch');
  filterSubjects(search ? search.value : '');
}
/** Narrow the subject list to names containing the typed text and matching the active asset kind. */
function filterSubjects(text) {
  const q = String(text || '').trim().toLowerCase();
  document.querySelectorAll('.subj').forEach((n) => {
    const s = subjects[Number(n.dataset.i)] || {};
    const parts = String(s.entity || '').split(':');
    const kind = parts.length > 2 ? parts[1] : '';
    const matchKind = !subjKind || kind === subjKind;
    const matchText = !q || String(s.label || human(s.entity)).toLowerCase().indexOf(q) >= 0;
    n.hidden = !(matchKind && matchText);
  });
}
/** A stored id in words, never the id itself: "world:ticker:nvda" reads "NVDA", "world:outlet:the-verge" reads "The Verge". */
function human(id) {
  const parts = String(id || '').split(':');
  const kind = parts.length > 2 ? parts[1] : '';
  const rest = parts.length > 2 ? parts.slice(2).join(':') : String(id || '');
  if (kind === 'ticker' || kind === 'crypto') return rest.toUpperCase();
  return rest.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
const KIND_WORDS = { ticker: 'Stocks', market: 'Markets', topic: 'Topics', crypto: 'Crypto', commodity: 'Commodities', outlet: 'Outlets', org: 'Organisations', person: 'People', place: 'Places' };
function esc(s){ return String(s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function switchDetailTab(tab) {
  detailTab = tab === 'graph' ? 'graph' : 'sources';
  document.querySelectorAll('.view-tab').forEach((b) => { b.classList.toggle('active', b.dataset.vtab === detailTab); });
  const srcCard = document.querySelector && document.querySelector('#p-sent .src-card');
  if (srcCard) srcCard.hidden = detailTab !== 'sources';
  const gEl = document.getElementById('p-graph');
  if (gEl) gEl.hidden = detailTab !== 'graph';
}

function select(i) {
  selected = i;
  const g = ++gen;
  document.querySelectorAll('.subj').forEach((n,j) => {
    n.classList.toggle('active', j===i);
    if (n.setAttribute) n.setAttribute('aria-selected', j===i ? 'true' : 'false');
  });
  const s = subjects[i]; if (!s) return;
  const picker = document.getElementById('subjPickerBtn');
  if (picker) { picker.textContent = (s.label || human(s.entity)) + ' \u25BE'; if (picker.setAttribute) picker.setAttribute('aria-expanded', 'false'); }
  const rail = document.getElementById('subjRail');
  if (rail && rail.classList) rail.classList.remove('open');
  detailTab = 'sources';
  const main = document.getElementById('main');
  main.innerHTML = '<div id="p-sent">'+waitCard(s.label, 'Reading bias-aware sentiment')+'</div>'
    + '<div class="view-tabs" role="tablist" aria-label="Coverage detail">'
    + '<button type="button" class="view-tab active" data-vtab="sources" onclick="switchDetailTab(\'sources\')">By source</button>'
    + '<button type="button" class="view-tab" data-vtab="graph" onclick="switchDetailTab(\'graph\')">Entity graph</button>'
    + '</div>'
    + '<div id="p-graph" hidden>'+waitCard('Entity graph', 'Walking co-mentions')+'</div>';
  const paint = (id, html) => {
    if (g !== gen) return;
    document.getElementById(id).innerHTML = html;
    if (id === 'p-sent') {
      const sc = document.querySelector && document.querySelector('#p-sent .src-card');
      if (sc) sc.hidden = detailTab !== 'sources';
    }
  };
  api('/sentiment?entity='+encodeURIComponent(s.entity)+'&days='+win)
    .then(sent => paint('p-sent', sentimentCards(s, sent)))
    .catch(e => paint('p-sent', failCard(s.label, e)));
  api('/neighbors?id='+encodeURIComponent(s.entity)+'&depth=1')
    .then(nb => paint('p-graph', graphCard(nb)))
    .catch(e => paint('p-graph', failCard('Entity graph', e)));
}

function waitCard(title, msg) { return '<div class="card"><h3>'+esc(title)+'</h3><div class="note">'+msg+'&hellip;</div></div>'; }
function failCard(title, e) { return '<div class="card"><h3>'+esc(title)+'</h3><div class="note">Read failed: '+esc(String(e))+'</div></div>'; }

// A count rendered as digits (esc() would turn 0 into an empty cell).
function count(v) { return v == null ? '&mdash;' : String(Number(v)); }

// The rating method, stated with its own numbers: every rating on the page is oshal's own, observed.
function ratingNote(m) {
  return 'oshal rates every source from its own stored coverage. Lean is a source&rsquo;s sustained divergence from the other sources on the same subjects and days (above 0 reads more favourably than they do); reliability is how closely it tracks them. Ratings use the last '
    + count(m.windowDays) + ' days; a source with fewer than ' + count(m.minComparisons) + ' compared subject-days or ' + count(m.minSubjects)
    + ' subjects shows insufficient data, never a number. Here: ' + count(m.rated) + ' rated, ' + count(m.insufficient) + ' insufficient. A naive average is misleading.';
}

// One source row: its observed rating with the counts and dates behind it, or insufficient data.
function sourceRow(x) {
  const r = x.rating || {};
  const rated = r.status === 'rated';
  const lean = rated ? fmt(r.lean) + ' <span class="tag">' + esc(r.leanBucket) + '</span>' : '<span class="tag">insufficient data</span>';
  const rel = rated ? Number(r.reliability).toFixed(2) : '&mdash;';
  const observed = r.comparisons ? count(r.comparisons) + ' compared subject-days, ' + count(r.subjects) + ' subjects, ' + esc(r.firstObserved) + ' to ' + esc(r.lastObserved) : 'not compared in the rating window';
  return '<tr><td>' + esc(/^world:/.test(String(x.outlet)) ? human(x.outlet) : x.outlet) + '</td><td>' + lean + '</td><td>' + rel + '</td><td>' + observed + '</td><td>' + count(x.points) + '</td><td class="' + cls(x.value) + '">' + fmt(x.value) + '</td></tr>';
}

// Rated sources by lean (most critical first), then the insufficient ones by name.
function byRating(a, b) {
  const ra = a.rating && a.rating.status === 'rated', rb = b.rating && b.rating.status === 'rated';
  if (ra !== rb) return ra ? -1 : 1;
  if (ra) return (a.rating.lean || 0) - (b.rating.lean || 0);
  return String(a.outlet).localeCompare(String(b.outlet));
}

function sentimentCards(s, sent) {
  const lean = sent.lean || {};
  const head = '<div class="card"><h3>'+esc(s.label)+'</h3><div class="row">'
    + statBox('naive avg', fmt(sent.naive))
    + statBox('lean-balanced', fmt(lean.balanced))
    + statBox('reliability-wtd', fmt(sent.reliabilityWeighted))
    + '</div>'
    + '<div class="row" style="margin-top:10px">'
    + '<span class="pill">consensus: '+esc(lean.consensus||'?')+'</span>'
    + '</div></div>';
  if (!sent.ratings) {
    return head + '<div class="card"><h3>Outlet ratings</h3><div class="note">This server does not report observed outlet ratings, so no rating is shown. It needs a core build with oshal&rsquo;s own observed ratings (ADR-061, 2026-10-01).</div></div>';
  }
  const axes = '<div class="card"><h3>Bias-aware sentiment</h3>'
    + axis('Lean against the other sources (observed)', lean.byLean)
    + '<div class="note">' + ratingNote(sent.ratings) + '</div>'
    + '</div>';
  const rows = (sent.bySource || []).slice().sort(byRating);
  // 15 rows, then Show more (an unpaginated table of 12,000 words buried the entity graph).
  const srcTable = rows.length ? '<div class="card src-card"><h3>By source</h3><table><thead><tr><th>Source</th><th><button type="button" class="th-sort" onclick="sortSources(this, 1)">Lean &#8597;</button></th><th><button type="button" class="th-sort" onclick="sortSources(this, 2)">Reliability &#8597;</button></th><th>Observed</th><th>n</th><th><button type="button" class="th-sort" onclick="sortSources(this, 5)">Sentiment &#8597;</button></th></tr></thead><tbody>'
    + rows.map((x, i) => i < SOURCE_ROWS ? sourceRow(x) : sourceRow(x).replace('<tr>', '<tr class="extra" hidden>')).join('') + '</tbody></table>'
    + (rows.length > SOURCE_ROWS ? '<button type="button" class="more" onclick="showAllSources(this)">Show ' + (rows.length - SOURCE_ROWS) + ' more</button>' : '') + '</div>' : '';
  return head + axes + srcTable;
}

const SOURCE_ROWS = 15;
function cellNum(tr, idx) {
  const txt = tr && tr.cells && tr.cells[idx] ? tr.cells[idx].textContent : '';
  const m = String(txt || '').match(/[+-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function sortSources(btn, colIdx) {
  const card = btn.closest('.card');
  const tbody = card && card.querySelector('tbody');
  if (!tbody) return;
  const dir = btn.dataset.dir === 'desc' ? 'asc' : 'desc';
  card.querySelectorAll('.th-sort').forEach((b) => { delete b.dataset.dir; });
  btn.dataset.dir = dir;
  const allRows = Array.from(tbody.querySelectorAll('tr'));
  const expanded = !card.querySelector('.more');
  allRows.sort((a, b) => {
    const va = cellNum(a, colIdx), vb = cellNum(b, colIdx);
    if ((va == null) !== (vb == null)) return va == null ? 1 : -1;
    if (va != null && vb != null && va !== vb) return dir === 'asc' ? va - vb : vb - va;
    return String(a.cells[0] && a.cells[0].textContent || '').localeCompare(String(b.cells[0] && b.cells[0].textContent || ''));
  });
  allRows.forEach((r, idx) => {
    const hide = !expanded && idx >= SOURCE_ROWS;
    r.classList.toggle('extra', hide);
    r.hidden = hide;
    tbody.appendChild(r);
  });
}
function showAllSources(btn) {
  btn.closest('.card').querySelectorAll('tr.extra').forEach((r) => { r.hidden = false; });
  btn.remove();
}
function graphCard(nb) {
  const neighbors = (nb && nb.neighbors) || [];
  const byType = {};
  neighbors.forEach(n => { const t = (n.id.split(':')[1]) || 'other'; (byType[t] = byType[t] || []).push(n.props && n.props.label || human(n.id)); });
  return '<div class="card"><h3>Entity graph</h3>'
    + (Object.keys(byType).length ? Object.entries(byType).map(([t,labels]) =>
        '<div class="grp"><div class="gt">'+esc(KIND_WORDS[t] || human(t))+'</div><div>'+[...new Set(labels)].slice(0,18).map(l=>'<span class="tag">'+esc(l)+'</span>').join('')+'</div></div>'
      ).join('') : '<div class="note">No co-mentioned entities yet.</div>')
    + '</div>';
}

function pullsCard(pulls) {
  const ps = (pulls && pulls.bySource) || [];
  return ps.length ? '<div class="card"><h3>Pull-rate</h3><table><thead><tr><th>Source</th><th>Pulls</th><th>Fetched</th><th>Unique</th><th>New</th><th>Fresh</th></tr></thead><tbody>'
    + ps.map(p => '<tr><td>'+esc(p.feedId)+'</td><td>'+p.pulls+'</td><td>'+p.fetched+'</td><td>'+p.uniqueItems+'</td><td>'+p.newItems+'</td><td>'+(p.freshRate==null?'&mdash;':p.freshRate)+'</td></tr>').join('')
    + '</tbody></table></div>' : '';
}
function statBox(k,v){ return '<div class="stat"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>'; }
// The full page only: under an audience view the shared kit paints instead (see the head script), so the dashboard
// neither binds its window control nor reads the subjects, sentiment, graph and pull ledger.
if (!window.AppView || !AppView.active()) {
  load().catch(e => { document.getElementById('main').innerHTML = '<div class="empty">Failed to load: '+esc(String(e))+'</div>'; });
}
</script>
</body>
</html>`;
//# sourceMappingURL=world-app-html.js.map