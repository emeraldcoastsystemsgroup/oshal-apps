/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Ambient Recall browser controller reading /api/jarvis/ambient/person/{projection,recall,asks,people,trends} with graceful empty-state and pre-promotion 404 handling.
 */

window.__OSHAL_SCREEN_CONTRACT__ = {
  category: 'dashboard',
  firstAction: 'go',
};

const API = '/api/jarvis/ambient/person';
const $ = (id) => document.getElementById(id);
let lastReceipts = [];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function when(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? esc(iso) : esc(d.toLocaleString());
}

function day(iso) {
  return esc(String(iso || '').slice(0, 10));
}

async function getJson(subPath) {
  const res = await fetch(API + subPath, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (res.status === 401) throw new Error('sign_in');
  const body = res.ok || res.status < 500 ? await res.json().catch(() => ({})) : {};
  return { ok: res.ok, status: res.status, body };
}

async function postJson(subPath, payload) {
  const res = await fetch(API + subPath, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

function unavailableNote(status, contextLabel) {
  if (status === 404) {
    return `<div class="note" data-testid="pre-promotion-note">No ${esc(contextLabel)} recorded yet — Ambient Recall native endpoints are not active on this kernel version yet (HTTP 404).</div>`;
  }
  return `<div class="note">${esc(contextLabel)} could not be loaded right now (HTTP ${esc(status)}).</div>`;
}

function noteFor(err) {
  return err && err.message === 'sign_in'
    ? '<div class="note">Please sign in to view your ambient transcripts.</div>'
    : '<div class="note">Ambient Recall is temporarily unavailable.</div>';
}

function showTab(name, opts = {}) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  const url = new URL(location.href);
  url.searchParams.set('tab', name);
  if (!opts.profile) url.searchParams.delete('profile');
  history.replaceState(null, '', url.toString());
  if (name === 'asks' && !$('asks-list').innerHTML) void loadAsks();
  if (name === 'people' && !opts.profile) void loadPeople();
  if (name === 'trends' && !$('trend-out').innerHTML) void loadTrends();
}

function renderRecall(data) {
  const box = $('answer');
  if (data.resolved === false) {
    box.innerHTML = `<div class="note" data-testid="recall-empty">No enrolled or named voice matches “${esc(data.intent?.personName || '')}”. Name that voice under <b>Manage Voices</b> first, then ask again.</div>`;
    return;
  }
  lastReceipts = Array.isArray(data.receipts) ? data.receipts : [];
  const count = Number.isFinite(Number(data.count)) ? Number(data.count) : lastReceipts.length;
  const who = esc(data.personLabel || 'Anyone');
  const topic = data.terms ? ` about “${esc(data.terms)}”` : '';
  const range = data.range === 'today' ? 'today' : 'on record';
  const headline = count === 0
    ? `${who} has not been heard${topic} ${range}.`
    : `${who} was heard${topic} <b>${count}</b> time${count === 1 ? '' : 's'} ${range}.`;
  let html = `<p class="headline" data-testid="recall-headline">${headline}</p><p class="meta">Counted from your transcripts — exact, not an estimate.</p>`;
  if (!lastReceipts.length) {
    html += '<div class="note" data-testid="recall-empty">No matching transcript lines on record yet.</div>';
  }
  for (const r of lastReceipts) {
    html += `<div class="receipt"><span class="t">${when(r.capturedAt)}</span>“${esc(r.quote)}”</div>`;
  }
  if (lastReceipts.length) html += '<button class="playbtn" id="play" type="button">Play it back</button>';
  box.innerHTML = html;
  const play = $('play');
  if (play) play.onclick = playback;
}

async function recall() {
  const q = $('q').value.trim();
  if (!q) return;
  $('go').disabled = true;
  const box = $('answer');
  box.hidden = false;
  box.innerHTML = '<p class="meta">Searching your transcripts…</p>';
  try {
    const { ok, status, body } = await getJson('/recall?q=' + encodeURIComponent(q));
    if (status === 400) {
      box.innerHTML = '<div class="note">Try asking “how many times has &lt;person&gt; mentioned &lt;topic&gt;”, or check the Asks, People, and Trends tabs.</div>';
      return;
    }
    if (!ok) {
      box.innerHTML = unavailableNote(status, 'transcript recall');
      return;
    }
    renderRecall(body);
  } catch (e) {
    box.innerHTML = noteFor(e);
  } finally {
    $('go').disabled = false;
  }
}

function playback() {
  if (!('speechSynthesis' in window) || !lastReceipts.length) return;
  speechSynthesis.cancel();
  for (const r of lastReceipts) speechSynthesis.speak(new SpeechSynthesisUtterance(r.quote));
}

function askCard(a) {
  const kind = a.kind === 'commitment' ? 'Commitment' : 'Ask';
  return `<div class="card" data-ask="${esc(a.askId)}"><span class="t">${esc(a.personLabel)} · ${when(a.createdAt)}</span>`
    + `<b>${kind}:</b> ${esc(a.text)}<span class="inference-tag">oshal's read</span>`
    + `<div class="meta" style="margin:4px 0 0">Heard as: “${esc(a.sourceQuote)}”</div>`
    + '<div class="actions"><button type="button" class="btn small" data-status="done">Mark done</button>'
    + '<button type="button" class="btn small ghost" data-status="dismissed">Dismiss</button></div></div>';
}

function wireAskActions(container, reload) {
  container.querySelectorAll('[data-ask]').forEach((card) => {
    card.querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const { ok } = await postJson(`/asks/${encodeURIComponent(card.dataset.ask)}/status`, { status: btn.dataset.status });
        if (ok) reload(); else btn.disabled = false;
      });
    });
  });
}

async function loadAsks() {
  const person = $('asks-person').value.trim();
  const out = $('asks-list');
  out.innerHTML = '<p class="meta">Loading…</p>';
  try {
    const { ok, status, body } = await getJson('/asks' + (person ? '?person=' + encodeURIComponent(person) : ''));
    if (!ok) { out.innerHTML = unavailableNote(status, 'open asks'); return; }
    const asks = Array.isArray(body.asks) ? body.asks : [];
    if (!asks.length) {
      out.innerHTML = `<div class="note" data-testid="asks-empty">Nothing open${person ? ' from ' + esc(person) : ''}. Open asks appear after new transcripts are analyzed and modeling is allowed under People → Consent.</div>`;
      return;
    }
    out.innerHTML = asks.map((a) => askCard(a)).join('');
    wireAskActions(out, loadAsks);
  } catch (e) {
    out.innerHTML = noteFor(e);
  }
}

async function loadPeople() {
  const out = $('people-list');
  out.hidden = false;
  $('profile').hidden = true;
  out.innerHTML = '<p class="meta">Loading…</p>';
  try {
    const { ok, status, body } = await getJson('/people');
    if (!ok) { out.innerHTML = unavailableNote(status, 'voices'); return; }
    const people = Array.isArray(body.people) ? body.people : [];
    if (!people.length) {
      out.innerHTML = '<div class="note" data-testid="people-empty">No voices heard yet. Turn on ambient listening in Jarvis and name voices under Manage Voices.</div>';
      return;
    }
    out.innerHTML = '<ul class="people">' + people.map((p) => `<li data-profile="${esc(p.profileId)}"><span class="who">${esc(p.label)}`
      + `${p.isSelf ? ' <span class="inference-tag">you</span>' : ''}</span><span class="cnt">${Number(p.utterances || 0)} line${Number(p.utterances || 0) === 1 ? '' : 's'}`
      + `${p.lastHeardAt ? ' · last ' + day(p.lastHeardAt) : ''}</span></li>`).join('') + '</ul>';
    out.querySelectorAll('[data-profile]').forEach((li) => li.addEventListener('click', () => void loadProfile(li.dataset.profile)));
  } catch (e) {
    out.innerHTML = noteFor(e);
  }
}

function renderProfileSubtab(out, p, subtab) {
  const topics = Array.isArray(p.topics) ? p.topics : [];
  const asks = Array.isArray(p.asks) ? p.asks : [];
  const presence = Array.isArray(p.presence) ? p.presence : [];
  if (subtab === 'topics') {
    if (!topics.length) { out.innerHTML = '<div class="note">No modeled topics yet.</div>'; return; }
    const max = Math.max(...topics.map((t) => Number(t.mentions || 1)));
    out.innerHTML = '<ul class="bars">' + topics.map((t) => `<li><span>${esc(t.topic)}</span><span class="bar" style="width:${Math.max(2, Math.round((100 * Number(t.mentions || 0)) / max))}%"></span><span>${esc(t.mentions)}</span></li>`).join('') + '</ul>';
  } else if (subtab === 'asks') {
    out.innerHTML = asks.length ? asks.map((a) => askCard(a)).join('') : `<div class="note">Nothing open from ${esc(p.label)}.</div>`;
    wireAskActions(out, () => void loadProfile(p.profileId, 'asks'));
  } else if (subtab === 'presence') {
    if (!presence.length) { out.innerHTML = '<div class="note">Not heard in the last 30 days.</div>'; return; }
    const max = Math.max(...presence.map((d) => Number(d.utterances || 1)));
    out.innerHTML = '<ul class="bars">' + presence.map((d) => `<li><span>${day(d.localDate)}</span><span class="bar" style="width:${Math.max(2, Math.round((100 * Number(d.utterances || 0)) / max))}%"></span><span>${esc(d.utterances)}</span></li>`).join('') + '</ul>';
  } else {
    renderConsent(out, p);
  }
}

function renderConsent(out, p) {
  const c = p.consent || {};
  out.innerHTML = `<p class="meta">Per-person modeling is off by default. Allowing it derives topics and asks as deletable inferences; declining stops and purges prior inferences.</p>`
    + `<dl class="kv"><dt>Current</dt><dd>${esc(c.status || 'no decision recorded')}${c.isMinor ? ' (minor — never modeled)' : ''}</dd></dl>`
    + (p.isSelf ? '' : '<div class="actions"><button type="button" class="btn small" data-consent="granted">Allow modeling</button>'
      + '<button type="button" class="btn small ghost" data-consent="declined">Decline and purge</button></div>');
  out.querySelectorAll('[data-consent]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const { ok } = await postJson('/consents', { profileId: p.profileId, status: btn.dataset.consent, scope: 'transcript' });
    if (ok) void loadProfile(p.profileId, 'consent'); else btn.disabled = false;
  }));
}

function renderProfile(p, subtab) {
  const box = $('profile');
  const consent = p.consent || {};
  const posture = consent.eligible ? 'modeling allowed' : (consent.status === 'declined' ? 'declined' : 'not modeled (default)');
  box.innerHTML = `<button type="button" class="back" id="back">← All people</button>`
    + `<h2>${esc(p.label)}${p.isSelf ? ' <span class="inference-tag">you</span>' : ''}</h2>`
    + `<dl class="kv"><dt>Utterances</dt><dd>${esc(p.utterances ?? 0)}</dd><dt>First heard</dt><dd>${p.firstHeardAt ? when(p.firstHeardAt) : '—'}</dd>`
    + `<dt>Last heard</dt><dd>${p.lastHeardAt ? when(p.lastHeardAt) : '—'}</dd><dt>Modeling</dt><dd>${esc(posture)}</dd></dl>`
    + '<nav class="subtabs" role="tablist">' + ['topics', 'asks', 'presence', 'consent'].map((t) =>
      `<button type="button" role="tab" data-sub="${t}" aria-selected="${t === subtab}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('') + '</nav><div id="sub-out"></div>';
  $('back').onclick = () => showTab('people');
  box.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => renderProfile(p, b.dataset.sub)));
  renderProfileSubtab($('sub-out'), p, subtab);
}

async function loadProfile(profileId, subtab = 'topics') {
  const box = $('profile');
  box.hidden = false;
  $('people-list').hidden = true;
  box.innerHTML = '<p class="meta">Loading…</p>';
  try {
    const { ok, status, body } = await getJson('/profile/' + encodeURIComponent(profileId));
    if (status === 404) { box.innerHTML = '<div class="note">That voice is not in your transcripts.</div>'; return; }
    if (!ok || !body?.profile) { box.innerHTML = unavailableNote(status, 'person profile'); return; }
    renderProfile(body.profile, subtab);
  } catch (e) {
    box.innerHTML = noteFor(e);
  }
}

async function loadTrends() {
  const person = $('trend-person').value.trim();
  const weeks = $('trend-weeks').value;
  const out = $('trend-out');
  out.innerHTML = '<p class="meta">Loading…</p>';
  try {
    const { ok, status, body } = await getJson('/trends?weeks=' + encodeURIComponent(weeks) + (person ? '&person=' + encodeURIComponent(person) : ''));
    if (!ok) { out.innerHTML = unavailableNote(status, 'topic trends'); return; }
    if (person && body.personResolved === false) { out.innerHTML = `<div class="note">No named voice matches “${esc(person)}”.</div>`; return; }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      out.innerHTML = `<div class="note" data-testid="trends-empty">No modeled topics${body.personLabel ? ' for ' + esc(body.personLabel) : ''} in this window yet.</div>`;
      return;
    }
    out.innerHTML = `<div class="scroll"><table><thead><tr><th>Week of</th><th>Person</th><th>Topic</th><th>Mentions</th></tr></thead><tbody>`
      + rows.map((r) => `<tr><td>${day(r.weekStart)}</td><td>${esc(r.personLabel)}</td><td>${esc(r.topic)}</td><td>${esc(r.mentions)}</td></tr>`).join('')
      + '</tbody></table></div>';
  } catch (e) {
    out.innerHTML = noteFor(e);
  }
}

async function loadConnections() {
  const a = $('conn-a').value.trim();
  const b = $('conn-b').value.trim();
  const out = $('conn-out');
  if (!a || !b) { out.innerHTML = '<div class="note">Name two people to compare shared topics.</div>'; return; }
  out.innerHTML = '<p class="meta">Loading…</p>';
  try {
    const { ok, status, body } = await getJson('/connections?a=' + encodeURIComponent(a) + '&b=' + encodeURIComponent(b));
    if (!ok) { out.innerHTML = unavailableNote(status, 'shared topics'); return; }
    if (body.resolved === false) { out.innerHTML = '<div class="note">One of those names does not match a named voice.</div>'; return; }
    const topics = Array.isArray(body.topics) ? body.topics : [];
    if (!topics.length) { out.innerHTML = `<div class="note">${esc(body.labelA || a)} and ${esc(body.labelB || b)} have no shared topics recorded yet.</div>`; return; }
    out.innerHTML = `<div class="scroll"><table><thead><tr><th>Topic</th><th>${esc(body.labelA || a)}</th><th>${esc(body.labelB || b)}</th><th>Last</th></tr></thead><tbody>`
      + topics.map((t) => `<tr><td>${esc(t.topic)}</td><td>${esc(t.daysA)}d</td><td>${esc(t.daysB)}d</td><td>${day(t.lastObservedOn)}</td></tr>`).join('') + '</tbody></table></div>';
  } catch (e) {
    out.innerHTML = noteFor(e);
  }
}

async function loadProjectionStatus() {
  try {
    const { ok, status, body } = await getJson('/projection');
    if (status === 404) {
      $('status').textContent = 'Ambient Recall native endpoints are awaiting kernel promotion on this host (empty preview).';
      return;
    }
    if (!ok) return;
    const l = body.ledger;
    $('status').textContent = 'Semantic recall: ' + (body.semanticAvailable ? 'on' : 'off (exact search only)')
      + (l ? ` · projected ${l.projectedRows ?? 0} of ${l.canonRows ?? 0} lines (${l.status || 'idle'})` : ' · no transcript lines projected yet');
  } catch {
    $('status').textContent = 'Semantic recall status unavailable.';
  }
}

function bootAmbientRecall() {
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('go').onclick = () => void recall();
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') void recall(); });
  $('asks-load').onclick = () => void loadAsks();
  $('asks-person').addEventListener('keydown', (e) => { if (e.key === 'Enter') void loadAsks(); });
  $('trend-load').onclick = () => void loadTrends();
  $('conn-load').onclick = () => void loadConnections();
  document.querySelectorAll('[data-ex]').forEach((el) => el.addEventListener('click', () => {
    const ex = el.dataset.ex || '';
    if (/asked me/i.test(ex)) { showTab('asks'); $('asks-person').value = 'Ella'; void loadAsks(); return; }
    $('q').value = ex;
    void recall();
  }));
  const params = new URLSearchParams(location.search);
  const profile = params.get('profile');
  const tab = params.get('tab') || (profile ? 'people' : 'recall');
  showTab(tab, { profile: Boolean(profile) });
  if (profile) void loadProfile(profile);
  void loadProjectionStatus();
}

bootAmbientRecall();
