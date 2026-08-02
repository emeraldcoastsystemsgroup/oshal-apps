/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-20 00:00:00 | roger.murphy@agenticfederal.us   | Layer B: World Intelligence cockpit surface (read-only dashboard)
 * 2026-07-24 21:00:00 | @codex-surface-audit | Inherit the swarm control-plane theme instead of forcing a fixed dark palette.
 * 2026-07-29 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Read window is a visible control defaulting to 90 days, not a hardcoded 3650. Asking every panel for "all history" made the metric store plan across ~50 years of daily buckets - more time planning than reading (1.1s of PLANNING per sentiment read). Also drops a stale in-flight response when the user has already clicked another subject.
 * 2026-07-31 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | The 1.0.1 edit dropped the `async function load() {` declaration, leaving a top-level await — a SyntaxError in a classic script, so the page never loaded at all. Restored, and the three per-subject reads now paint their cards independently as each lands (generation-guarded against subject AND window races) instead of one Promise.all blocking first paint on the slowest read — the pull ledger can run seconds cold after a deploy while sentiment is ~100ms. Guard: tests/surface-parse.test.js.
 */

/**
 * The World Intelligence cockpit surface — a read-only dashboard over the shared world
 * layer. Lists tracked subjects (/entities), and for the selected one renders the
 * bias-aware sentiment (political + econ + by-kind), the entity co-mention graph, and
 * pull-rate. Pure vanilla JS hitting the OPEN read endpoints; ingestion is the
 * world_ingest TOOL (run by the analyst bot / Jarvis), not a button here. Inlined as a
 * string so it ships in dist without an asset-copy step.
 */
export const WORLD_APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>World Intelligence</title>
<link rel="stylesheet" href="/shared/ui/css/surface-themes.css" />
<script src="/shared/ui/js/surface-theme.js"></script>
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
  header .win { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.5px; display:flex; align-items:center; gap:6px; }
  header .win select { background:var(--panel2); color:var(--ink); border:1px solid var(--line); border-radius:6px; padding:3px 6px; font:12px Inter,system-ui,sans-serif; text-transform:none; letter-spacing:0; }
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
    .wrap { grid-template-columns:1fr; height:auto; }
    .rail { border-right:none; border-bottom:1px solid var(--line); max-height:40vh; }
    header { flex-wrap:wrap; }
    header .sub { margin-left:0; flex-basis:100%; }
    main { padding:14px; overflow:visible; }
    .bar { grid-template-columns:88px 1fr 46px; gap:8px; }
    .stat { min-width:calc(50% - 5px); flex:1; }
    table { display:block; overflow-x:auto; white-space:nowrap; }
  }
</style>
</head>
<body>
<header>
  <span class="dot"></span>
  <h1>World Intelligence</h1>
  <label class="win">window
    <select id="win">
      <option value="30">30 days</option>
      <option value="90" selected>90 days</option>
      <option value="365">1 year</option>
      <option value="3650">all history</option>
    </select>
  </label>
  <span class="sub">bias-aware sentiment &middot; entity graph &middot; pull-rate</span>
</header>
<div class="wrap">
  <aside class="rail">
    <h2>Tracked subjects</h2>
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

async function load() {
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
    '<div class="subj" data-i="'+i+'"><div class="nm">'+esc(s.label)+'</div><div class="meta">'+s.items+' items &middot; '+s.entity+'</div></div>'
  ).join('');
  el.querySelectorAll('.subj').forEach(n => n.onclick = () => select(Number(n.dataset.i)));
  select(0);
}
function esc(s){ return String(s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function select(i) {
  selected = i;
  const g = ++gen;
  document.querySelectorAll('.subj').forEach((n,j) => n.classList.toggle('active', j===i));
  const s = subjects[i]; if (!s) return;
  const main = document.getElementById('main');
  // Progressive load: paint the shell immediately and fill each card as its read lands. The three
  // reads have very different costs (sentiment ~100ms warm; the pull ledger can run for seconds
  // cold after a deploy), and a Promise.all holds the whole screen hostage to the slowest one.
  main.innerHTML = '<div id="p-sent">'+waitCard(s.label, 'Reading bias-aware sentiment')+'</div>'
    + '<div id="p-graph">'+waitCard('Entity graph', 'Walking co-mentions')+'</div>'
    + '<div id="p-pulls">'+waitCard('Pull-rate', 'Reading the pull ledger')+'</div>';
  const paint = (id, html) => { if (g === gen) document.getElementById(id).innerHTML = html; };
  api('/sentiment?entity='+encodeURIComponent(s.entity)+'&days='+win)
    .then(sent => paint('p-sent', sentimentCards(s, sent)))
    .catch(e => paint('p-sent', failCard(s.label, e)));
  api('/neighbors?id='+encodeURIComponent(s.entity)+'&depth=1')
    .then(nb => paint('p-graph', graphCard(nb)))
    .catch(e => paint('p-graph', failCard('Entity graph', e)));
  api('/pulls?entity='+encodeURIComponent(s.entity)+'&days='+win)
    .then(pulls => paint('p-pulls', pullsCard(pulls)))
    .catch(e => paint('p-pulls', failCard('Pull-rate', e)));
}

function waitCard(title, msg) { return '<div class="card"><h3>'+esc(title)+'</h3><div class="note">'+msg+'&hellip;</div></div>'; }
function failCard(title, e) { return '<div class="card"><h3>'+esc(title)+'</h3><div class="note">Read failed: '+esc(String(e))+'</div></div>'; }

function sentimentCards(s, sent) {
  const pol = sent.political || {}; const eco = sent.econ || {};
  const byKind = sent.byKind || {};
  const head = '<div class="card"><h3>'+esc(s.label)+'</h3><div class="row">'
    + statBox('naive avg', fmt(sent.naive))
    + statBox('political balanced', fmt(pol.balanced))
    + statBox('econ balanced', fmt(eco.balanced))
    + statBox('reliability-wtd', fmt(sent.reliabilityWeighted))
    + '</div>'
    + '<div class="row" style="margin-top:10px">'
    + '<span class="pill">political: '+(pol.consensus||'?')+'</span>'
    + '<span class="pill">econ: '+(eco.consensus||'?')+'</span>'
    + '</div></div>';

  const axes = '<div class="card"><h3>Bias-aware sentiment</h3>'
    + axis('Political axis (byLean)', pol.byLean)
    + axis('Economic axis (byEcon)', eco.byEcon)
    + kindBlock(byKind)
    + '<div class="note">A naive average is misleading. The political and economic axes often disagree &mdash; e.g. politically aligned but the financial press flat. Outlet ratings are seed placeholders.</div>'
    + '</div>';

  const sources = (sent.bySource || []).filter(x => x.lean != null);
  const srcTable = sources.length ? '<div class="card"><h3>By outlet</h3><table><thead><tr><th>Outlet</th><th>Kind</th><th>Lean</th><th>Econ</th><th>n</th><th>Sentiment</th></tr></thead><tbody>'
    + sources.sort((a,b)=>(a.lean||0)-(b.lean||0)).map(x =>
        '<tr><td>'+esc(x.outlet)+'</td><td>'+esc(x.kind||'')+'</td><td>'+esc(x.bias||'')+'</td><td>'+esc(x.econBias||'')+'</td><td>'+x.points+'</td><td class="'+cls(x.value)+'">'+fmt(x.value)+'</td></tr>'
      ).join('') + '</tbody></table></div>' : '';

  return head + axes + srcTable;
}

function graphCard(nb) {
  const neighbors = (nb && nb.neighbors) || [];
  const byType = {};
  neighbors.forEach(n => { const t = (n.id.split(':')[1]) || 'other'; (byType[t] = byType[t] || []).push(n.props && n.props.label || n.id); });
  return '<div class="card"><h3>Entity graph</h3>'
    + (Object.keys(byType).length ? Object.entries(byType).map(([t,labels]) =>
        '<div class="grp"><div class="gt">'+t+'</div><div>'+[...new Set(labels)].slice(0,18).map(l=>'<span class="tag">'+esc(l)+'</span>').join('')+'</div></div>'
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
function kindBlock(byKind){
  const keys = Object.keys(byKind||{}); if(!keys.length) return '';
  const obj = {}; keys.forEach(k => obj[k] = byKind[k] && byKind[k].value);
  return axis('By outlet kind', obj);
}
document.getElementById('win').onchange = (e) => { win = Number(e.target.value) || 90; if (subjects.length) select(selected); };
load().catch(e => { document.getElementById('main').innerHTML = '<div class="empty">Failed to load: '+esc(String(e))+'</div>'; });
</script>
</body>
</html>`;
