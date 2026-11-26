/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Creative Studio 1.5.2 screen controller for Make the next story, Story library browsing/selection with Made badges, Custom story script/sceneCount/shape form, and Recorded work job updates.
 */
const BASE = '/api/creative-studio';
const STATUS_LABELS = Object.freeze({
  queued: 'Queued',
  running: 'Being made',
  done: 'Finished',
  failed: 'Did not finish',
  awaiting_worker: 'Saved — awaiting worker',
  draft_recorded: 'Recorded draft',
});

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

async function fetchJson(path, options = {}) {
  const res = await fetch(BASE + path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function setInlineMessage(deps, text) {
  const box = document.getElementById('storyProductionStatus');
  if (box) box.textContent = text;
  deps.setStatus?.(text);
}

function fillCustomForm(story) {
  const titleEl = document.getElementById('customStoryTitle');
  const scriptEl = document.getElementById('customStoryScript');
  const scenesEl = document.getElementById('customStoryScenes');
  const shapeEl = document.getElementById('customStoryShape');
  if (titleEl) titleEl.value = String(story.title || '').slice(0, 120);
  if (scriptEl) scriptEl.value = String(story.script || '').slice(0, 4000);
  if (scenesEl) scenesEl.value = String(story.sceneCount || 4);
  if (shapeEl && ['16:9', '9:16', '1:1'].includes(story.defaultShape || story.shape)) {
    shapeEl.value = story.defaultShape || story.shape;
  }
}

function renderJobRow(tbody, job) {
  const tr = tbody.insertRow();
  const c1 = tr.insertCell();
  const c2 = tr.insertCell();
  const c3 = tr.insertCell();
  c1.append(el('strong', 'item', job.title || 'Untitled story'));
  const statusWord = STATUS_LABELS[job.status] || job.status || 'Recorded';
  c2.textContent = `${statusWord} · ${job.sceneCount} scenes · ${job.shape}`;
  if (job.script) {
    const loadBtn = el('button', 'story-inline-btn', 'Load script');
    loadBtn.type = 'button';
    loadBtn.onclick = () => fillCustomForm(job);
    c3.append(loadBtn);
  }
}

async function refreshStoryJobs() {
  const host = document.getElementById('storyJobsRecords');
  if (!host) return [];
  const res = await fetchJson('/stories/jobs').catch(() => ({ ok: false, body: {} }));
  if (!res.ok || !Array.isArray(res.body.jobs)) return [];
  host.replaceChildren();
  const jobs = res.body.jobs;
  if (!jobs.length) return [];
  const wrap = el('div', 'table-scroll');
  const table = el('table', 'records');
  table.setAttribute('aria-label', 'Recorded story jobs');
  const head = table.createTHead().insertRow();
  for (const label of ['Story', 'Status', '']) head.append(el('th', '', label));
  const tbody = table.createTBody();
  for (const job of jobs) renderJobRow(tbody, job);
  wrap.append(table);
  host.append(wrap);
  return jobs;
}

function renderLibraryItem(story, onChoose) {
  const card = el('article', 'story-lib-item');
  card.dataset.storySlug = story.slug;
  const top = el('div', 'story-lib-head');
  top.append(el('strong', 'story-lib-title', story.title));
  const badge = el('span', story.made ? 'story-badge story-badge-made' : 'story-badge story-badge-new', story.made ? 'Made' : 'Not made yet');
  badge.dataset.storyStatus = story.made ? 'made' : 'not-made';
  top.append(badge);
  const meta = el('p', 'story-lib-meta', `${story.category} · ${story.sceneCount} scenes · ${story.defaultShape}${story.lastJobStatus && !story.made ? ` · ${STATUS_LABELS[story.lastJobStatus] || story.lastJobStatus}` : ''}`);
  const summary = el('p', 'story-lib-summary', story.summary);
  const actions = el('div', 'story-lib-actions');
  const chooseBtn = el('button', '', 'Choose / Produce');
  chooseBtn.type = 'button';
  chooseBtn.dataset.chooseStory = story.slug;
  chooseBtn.onclick = () => onChoose(story, chooseBtn);
  actions.append(chooseBtn);
  card.append(top, meta, summary, actions);
  return card;
}

async function refreshStoryLibrary(onChoose) {
  const list = document.getElementById('storyLibraryList');
  if (!list) return null;
  const res = await fetchJson('/stories/library').catch(() => ({ ok: false, body: {} }));
  if (!res.ok || !Array.isArray(res.body.stories)) return null;
  list.replaceChildren();
  for (const story of res.body.stories) list.append(renderLibraryItem(story, onChoose));
  return res.body;
}

async function refreshAll(deps, onChoose) {
  await Promise.all([refreshStoryJobs(), refreshStoryLibrary(onChoose), deps.refreshEvidence?.()]);
}

async function submitMakeNext(deps, btn, onChoose) {
  btn.disabled = true;
  setInlineMessage(deps, 'Checking for the next story…');
  try {
    const res = await fetchJson('/stories/next', { method: 'POST', body: '{}' });
    if (res.status === 503 && res.body?.error === 'worker_unavailable') {
      setInlineMessage(deps, res.body.message || 'No Vids worker is online right now — connect a worker or save/edit your story script below.');
      return;
    }
    if (!res.ok) {
      setInlineMessage(deps, res.body?.message || res.body?.error || `Could not start the next story (${res.status}).`);
      return;
    }
    setInlineMessage(deps, res.body.message || 'Started the next story.');
    await refreshAll(deps, onChoose);
  } catch (error) {
    setInlineMessage(deps, error.message || 'Could not reach Creative Studio right now.');
  } finally {
    btn.disabled = false;
  }
}

async function submitLibraryChoice(deps, story, btn, onChoose) {
  fillCustomForm(story);
  btn.disabled = true;
  setInlineMessage(deps, `Preparing "${story.title}"…`);
  try {
    const payload = { story: story.slug, sceneCount: story.sceneCount, shape: story.defaultShape };
    const res = await fetchJson('/stories/produce', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) {
      setInlineMessage(deps, res.body?.message || res.body?.error || `Could not produce "${story.title}" (${res.status}).`);
      return;
    }
    setInlineMessage(deps, res.body.message || `Saved "${story.title}".`);
    await refreshAll(deps, onChoose);
  } catch (error) {
    setInlineMessage(deps, error.message || 'Could not reach Creative Studio right now.');
  } finally {
    btn.disabled = false;
  }
}

async function submitCustomForm(deps, form, onChoose) {
  const title = String(document.getElementById('customStoryTitle')?.value || '').trim();
  const script = String(document.getElementById('customStoryScript')?.value || '').trim();
  const sceneCount = Number(document.getElementById('customStoryScenes')?.value);
  const shape = String(document.getElementById('customStoryShape')?.value || '16:9');
  if (!title || !script) {
    setInlineMessage(deps, 'Enter both a title and a script before producing a custom story.');
    return;
  }
  if (!Number.isSafeInteger(sceneCount) || sceneCount < 1 || sceneCount > 12) {
    setInlineMessage(deps, 'Choose a whole scene count between 1 and 12.');
    return;
  }
  const btn = form.querySelector('#produceCustomStoryBtn');
  if (btn) btn.disabled = true;
  setInlineMessage(deps, `Saving "${title}"…`);
  try {
    const res = await fetchJson('/stories/produce', {
      method: 'POST',
      body: JSON.stringify({ title, script, sceneCount, shape }),
    });
    if (!res.ok) {
      setInlineMessage(deps, res.body?.message || res.body?.error || `Could not save "${title}" (${res.status}).`);
      return;
    }
    setInlineMessage(deps, res.body.message || `Saved "${title}".`);
    await refreshAll(deps, onChoose);
  } catch (error) {
    setInlineMessage(deps, error.message || 'Could not reach Creative Studio right now.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function mountStoryProduction(deps = {}) {
  const nextBtn = document.getElementById('makeNextStoryBtn');
  const form = document.getElementById('customStoryForm');
  const onChoose = (story, btn) => { void submitLibraryChoice(deps, story, btn, onChoose); };
  if (nextBtn) nextBtn.addEventListener('click', () => { void submitMakeNext(deps, nextBtn, onChoose); });
  if (form) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      void submitCustomForm(deps, form, onChoose);
    });
  }
  void Promise.all([refreshStoryJobs(), refreshStoryLibrary(onChoose)]);
  return { refresh: () => refreshAll(deps, onChoose) };
}
