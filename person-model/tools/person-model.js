/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Ambient Recall browser controller reading /api/jarvis/ambient/person/{projection,recall,asks,people,trends} with graceful empty-state and pre-promotion 404 handling.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add Continuous Profile Learning & Eavesdrop Business Cards controller (/api/person-model/profile-cards, /api/person-model/recall) merged with ambient person endpoints.
 */

window.__OSHAL_SCREEN_CONTRACT__ = {
  category: 'dashboard',
  firstAction: 'go',
};

const API = '/api/jarvis/ambient/person';
const PKG_API = '/api/person-model';
const $ = (id) => document.getElementById(id);
let lastReceipts = [];
let cachedProfileStore = { selfProfile: null, cards: [] };

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

async function getJson(subPath, base = API) {
  const res = await fetch(base + subPath, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (res.status === 401) throw new Error('sign_in');
  const body = res.ok || res.status < 500 ? await res.json().catch(() => ({})) : {};
  return { ok: res.ok, status: res.status, body };
}

async function postJson(subPath, payload, base = API) {
  const res = await fetch(base + subPath, {
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
  if (name === 'cards') void loadProfileCards();
  if (name === 'asks' && !$('asks-list').innerHTML) void loadAsks();
  if (name === 'people' && !opts.profile) void loadPeople();
  if (name === 'trends' && !$('trend-out').innerHTML) void loadTrends();
}

function renderSelfProfileCard(self) {
  const box = $('self-profile-card');
  if (!box || !self) return;
  const facts = Array.isArray(self.facts) ? self.facts : [];
  const factsHtml = facts.map((f) =>
    `<li class="fact-item" data-fact-id="${esc(f.id)}"><span class="fact-cat">${esc(f.category || 'learned')}</span>`
    + `<span class="fact-text">${esc(f.text)}</span>`
    + `<button type="button" class="fact-del" data-del-fact="${esc(f.id)}" title="Remove fact">×</button></li>`).join('');
  box.innerHTML = `<div class="hero-top"><div><span class="biz-badge self-badge">My Learned Profile · Continuous Learning Active</span>`
    + `<h2 data-testid="self-profile-name">${esc(self.fullName)}</h2><p class="meta">${esc(self.role)} · ${esc(self.organization)}</p></div>`
    + `<div class="hero-meta"><span><b>Address:</b> ${esc(self.address)}</span>`
    + `<span><b>Contact:</b> ${esc(self.email)} · ${esc(self.phone)}</span>`
    + `<span><b>Clearance:</b> ${esc(self.clearance || '—')} · <b>Education:</b> ${esc(self.education || '—')}</span></div></div>`
    + `<h3>Learned Profile &amp; Household Facts (${facts.length})</h3>`
    + `<ul class="fact-list" data-testid="self-facts-list">${factsHtml}</ul>`;
  box.querySelectorAll('[data-del-fact]').forEach((btn) => {
    btn.addEventListener('click', () => void deleteFact(btn.dataset.delFact));
  });
}

function renderSingleBusinessCard(c) {
  const topics = Array.isArray(c.topics) ? c.topics : [];
  const asks = Array.isArray(c.openCommitments) ? c.openCommitments : [];
  const quotes = Array.isArray(c.recentQuotes) ? c.recentQuotes : [];
  return `<article class="biz-card" data-card-id="${esc(c.cardId)}"><div class="biz-head"><div>`
    + `<h3>${esc(c.name)}</h3><div class="biz-role">${esc(c.role || 'Ambient Contact')}${c.organization ? ' · ' + esc(c.organization) : ''}</div></div>`
    + `<span class="biz-badge">${esc(c.relationship || 'Contact')}</span></div>`
    + (c.email || c.phone ? `<div class="biz-contact">${c.email ? esc(c.email) : ''}${c.email && c.phone ? ' · ' : ''}${c.phone ? esc(c.phone) : ''}</div>` : '')
    + `<div class="biz-stats"><span><b>${Number(c.utterances || 0)}</b> utterances</span>`
    + `<span>Source: ${esc(c.source || 'eavesdrop')}</span>`
    + `${c.lastHeardAt ? `<span>Last heard: ${day(c.lastHeardAt)}</span>` : ''}</div>`
    + (topics.length ? `<div class="pill-row">${topics.map((t) => `<span class="topic-pill">${esc(t)}</span>`).join('')}</div>` : '')
    + (asks.length ? `<div class="biz-section"><b>Open Commitments:</b><ul>${asks.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : '')
    + (quotes.length ? `<div class="biz-quote">“${esc(quotes[0].quote)}”</div>` : '')
    + `<div class="actions"><button type="button" class="btn small ghost" data-edit-card="${esc(c.cardId)}">Edit Card</button>`
    + `<button type="button" class="btn small ghost" data-delete-card="${esc(c.cardId)}">Remove</button></div></article>`;
}

function renderBusinessCardsGrid(cards) {
  const grid = $('business-cards-grid');
  const filter = ($('cards-filter')?.value || '').trim().toLowerCase();
  const filtered = filter
    ? cards.filter((c) => JSON.stringify(c).toLowerCase().includes(filter))
    : cards;
  const badge = $('cards-count-badge');
  if (badge) badge.textContent = `${filtered.length} card${filtered.length === 1 ? '' : 's'}`;
  if (!filtered.length) {
    grid.innerHTML = '<div class="note" data-testid="cards-empty">No matching business cards found.</div>';
    return;
  }
  grid.innerHTML = filtered.map((c) => renderSingleBusinessCard(c)).join('');
  grid.querySelectorAll('[data-edit-card]').forEach((btn) => {
    btn.addEventListener('click', () => openCardEditor(btn.dataset.editCard));
  });
  grid.querySelectorAll('[data-delete-card]').forEach((btn) => {
    btn.addEventListener('click', () => void deleteBusinessCard(btn.dataset.deleteCard));
  });
}

function mergeAmbientPeopleIntoCards(cards, ambientCards, ambientPeople) {
  const byName = new Map(cards.map((c) => [String(c.name || '').toLowerCase(), { ...c }]));
  for (const kc of (Array.isArray(ambientCards) ? ambientCards : [])) {
    const key = String(kc.name || kc.label || '').toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) {
      byName.set(key, {
        cardId: kc.cardId || `card-${key.replace(/[^a-z0-9]+/g, '-')}`,
        profileId: kc.profileId || '',
        name: kc.name || kc.label,
        role: kc.role || 'Ambient Voice Profile',
        organization: kc.organization || '',
        email: kc.email || '',
        phone: kc.phone || '',
        relationship: kc.relationship || 'Ambient',
        source: kc.source || 'eavesdrop',
        utterances: Number(kc.utterances || 0),
        lastHeardAt: kc.lastHeardAt || '',
        topics: Array.isArray(kc.topics) ? kc.topics : [],
        openCommitments: Array.isArray(kc.openCommitments) ? kc.openCommitments : [],
        recentQuotes: Array.isArray(kc.recentQuotes) ? kc.recentQuotes : [],
      });
    }
  }
  for (const p of (Array.isArray(ambientPeople) ? ambientPeople : [])) {
    const key = String(p.label || '').toLowerCase();
    if (!key || p.isSelf) continue;
    const existing = byName.get(key);
    if (existing) {
      existing.utterances = Math.max(Number(existing.utterances || 0), Number(p.utterances || 0));
      if (p.lastHeardAt) existing.lastHeardAt = p.lastHeardAt;
    } else {
      byName.set(key, {
        cardId: `card-${p.profileId || key}`,
        profileId: p.profileId || '',
        name: p.label,
        role: 'Named Ambient Voice',
        organization: '',
        relationship: 'Voice Profile',
        source: 'voice-diarization',
        utterances: Number(p.utterances || 0),
        lastHeardAt: p.lastHeardAt || '',
        topics: [],
        openCommitments: [],
        recentQuotes: [],
      });
    }
  }
  return Array.from(byName.values());
}

async function loadProfileCards() {
  try {
    const [pkgRes, kernelCardsRes, peopleRes] = await Promise.all([
      getJson('/profile-cards', PKG_API),
      getJson('/business-cards', API).catch(() => ({ ok: false, body: {} })),
      getJson('/people', API).catch(() => ({ ok: false, body: {} })),
    ]);
    if (!pkgRes.ok) return;
    const selfProfile = pkgRes.body.selfProfile;
    const mergedCards = mergeAmbientPeopleIntoCards(
      pkgRes.body.cards || [],
      kernelCardsRes.ok ? kernelCardsRes.body?.cards : [],
      peopleRes.ok ? peopleRes.body?.people : [],
    );
    cachedProfileStore = { selfProfile, cards: mergedCards };
    renderSelfProfileCard(selfProfile);
    renderBusinessCardsGrid(mergedCards);
  } catch (e) {
    $('self-profile-card').innerHTML = noteFor(e);
  }
}

async function teachFact() {
  const input = $('teach-fact-input');
  const fact = input.value.trim();
  if (!fact) return;
  const category = $('teach-fact-category').value;
  $('teach-fact-btn').disabled = true;
  try {
    const { ok, body } = await postJson('/profile-cards', { action: 'teach_fact', fact, category }, PKG_API);
    if (ok && body.selfProfile) {
      input.value = '';
      cachedProfileStore.selfProfile = body.selfProfile;
      renderSelfProfileCard(body.selfProfile);
    }
  } finally {
    $('teach-fact-btn').disabled = false;
  }
}

async function deleteFact(factId) {
  const { ok, body } = await postJson('/profile-cards', { action: 'delete_fact', factId }, PKG_API);
  if (ok && body.selfProfile) {
    cachedProfileStore.selfProfile = body.selfProfile;
    renderSelfProfileCard(body.selfProfile);
  }
}

function openSelfEditor() {
  const s = cachedProfileStore.selfProfile || {};
  $('self-name-input').value = s.fullName || '';
  $('self-address-input').value = s.address || '';
  $('self-email-input').value = s.email || '';
  $('self-phone-input').value = s.phone || '';
  $('self-role-input').value = s.role || '';
  $('self-org-input').value = s.organization || '';
  $('self-clearance-input').value = s.clearance || '';
  $('self-education-input').value = s.education || '';
  $('edit-self-form').hidden = false;
}

async function saveSelfProfile(e) {
  e.preventDefault();
  const payload = {
    action: 'update_self',
    fullName: $('self-name-input').value.trim(),
    address: $('self-address-input').value.trim(),
    email: $('self-email-input').value.trim(),
    phone: $('self-phone-input').value.trim(),
    role: $('self-role-input').value.trim(),
    organization: $('self-org-input').value.trim(),
    clearance: $('self-clearance-input').value.trim(),
    education: $('self-education-input').value.trim(),
  };
  const { ok, body } = await postJson('/profile-cards', payload, PKG_API);
  if (ok && body.selfProfile) {
    $('edit-self-form').hidden = true;
    cachedProfileStore.selfProfile = body.selfProfile;
    renderSelfProfileCard(body.selfProfile);
  }
}

function openCardEditor(cardId = '') {
  const existing = cachedProfileStore.cards.find((c) => c.cardId === cardId);
  $('card-id-input').value = existing?.cardId || '';
  $('card-name-input').value = existing?.name || '';
  $('card-role-input').value = existing?.role || '';
  $('card-org-input').value = existing?.organization || '';
  $('card-rel-input').value = existing?.relationship || 'Contact';
  $('card-email-input').value = existing?.email || '';
  $('card-phone-input').value = existing?.phone || '';
  $('card-topics-input').value = (existing?.topics || []).join(', ');
  $('card-commitments-input').value = (existing?.openCommitments || []).join(', ');
  $('card-quote-input').value = existing?.recentQuotes?.[0]?.quote || '';
  $('upsert-card-form').hidden = false;
}

async function saveBusinessCard(e) {
  e.preventDefault();
  const payload = {
    action: 'upsert_card',
    cardId: $('card-id-input').value.trim(),
    name: $('card-name-input').value.trim(),
    role: $('card-role-input').value.trim(),
    organization: $('card-org-input').value.trim(),
    relationship: $('card-rel-input').value.trim() || 'Contact',
    email: $('card-email-input').value.trim(),
    phone: $('card-phone-input').value.trim(),
    topics: $('card-topics-input').value.trim(),
    openCommitments: $('card-commitments-input').value.trim(),
    quote: $('card-quote-input').value.trim(),
  };
  if (!payload.name) return;
  const { ok, body } = await postJson('/profile-cards', payload, PKG_API);
  if (ok && Array.isArray(body.cards)) {
    $('upsert-card-form').hidden = true;
    cachedProfileStore.cards = body.cards;
    renderBusinessCardsGrid(body.cards);
  }
}

async function deleteBusinessCard(cardId) {
  const { ok, body } = await postJson('/profile-cards', { action: 'delete_card', cardId }, PKG_API);
  if (ok && Array.isArray(body.cards)) {
    cachedProfileStore.cards = body.cards;
    renderBusinessCardsGrid(body.cards);
  }
}

function renderProfileRecallResult(data) {
  const box = $('answer');
  const s = data.selfProfile || {};
  const facts = Array.isArray(data.selfMatches) ? data.selfMatches : [];
  const cards = Array.isArray(data.cardMatches) ? data.cardMatches : [];
  let html = `<p class="headline" data-testid="recall-headline">${esc(data.summary)}</p>`;
  html += `<div class="receipt"><span class="t">Learned Owner Profile</span><b>${esc(s.fullName)}</b> · ${esc(s.address)} · ${esc(s.email)} · ${esc(s.phone)}</div>`;
  for (const f of facts.slice(0, 5)) {
    html += `<div class="receipt"><span class="t">${esc(f.category)}</span>${esc(f.text)}</div>`;
  }
  for (const c of cards.slice(0, 4)) {
    html += `<div class="receipt"><span class="t">Business Card · ${esc(c.relationship || 'Contact')}</span><b>${esc(c.name)}</b> (${esc(c.role || 'Contact')}) — Topics: ${esc((c.topics || []).join(', ') || 'none')}</div>`;
  }
  box.innerHTML = html;
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
    if (/\b(my address|my profile|who am i|where do i live|my phone|my email|my clearance|learned profile|business card|business cards)\b/i.test(q)) {
      const pkgRecall = await getJson('/recall?q=' + encodeURIComponent(q), PKG_API);
      if (pkgRecall.ok) { renderProfileRecallResult(pkgRecall.body); return; }
    }
    const { ok, status, body } = await getJson('/recall?q=' + encodeURIComponent(q));
    if (status === 400) {
      box.innerHTML = '<div class="note">Try asking “how many times has &lt;person&gt; mentioned &lt;topic&gt;”, or check the Profile &amp; Cards, Asks, People, and Trends tabs.</div>';
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

function wireProfileCardsControls() {
  $('teach-fact-btn').onclick = () => void teachFact();
  $('teach-fact-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') void teachFact(); });
  $('edit-self-toggle').onclick = () => openSelfEditor();
  $('self-cancel-btn').onclick = () => { $('edit-self-form').hidden = true; };
  $('edit-self-form').addEventListener('submit', (e) => void saveSelfProfile(e));
  $('new-card-toggle').onclick = () => openCardEditor('');
  $('card-cancel-btn').onclick = () => { $('upsert-card-form').hidden = true; };
  $('upsert-card-form').addEventListener('submit', (e) => void saveBusinessCard(e));
  $('cards-filter').addEventListener('input', () => renderBusinessCardsGrid(cachedProfileStore.cards || []));
  const openCardsBtn = $('open-cards-tab-btn');
  if (openCardsBtn) openCardsBtn.onclick = () => showTab('cards');
}

function bootAmbientRecall() {
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('go').onclick = () => void recall();
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') void recall(); });
  $('asks-load').onclick = () => void loadAsks();
  $('asks-person').addEventListener('keydown', (e) => { if (e.key === 'Enter') void loadAsks(); });
  $('trend-load').onclick = () => void loadTrends();
  $('conn-load').onclick = () => void loadConnections();
  wireProfileCardsControls();
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
  void loadProfileCards();
  void loadProjectionStatus();
}

bootAmbientRecall();
