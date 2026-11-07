/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Wire Bot Forge 1-click Inject to native caller-scoped publish_authored with mandatory Permission Preview and structured refusal handling.
 */

window.__OSHAL_SCREEN_CONTRACT__ = {
  category: 'editor',
  firstAction: 'inject-btn',
};

const model = window.OshalBotForgeModel;
const state = {
  agents: [],
  definitions: [],
  activeId: null,
  activeVersion: null,
  pendingPreview: null,
  busy: false,
};

const el = (id) => document.getElementById(id);

function showError(message) {
  const box = el('forge-alert');
  if (!message) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.textContent = message;
  box.hidden = false;
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...options,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 240) };
  }
  return { ok: res.ok, status: res.status, data };
}

function readSpecFromForm() {
  return model.normalizeSpec({
    name: el('bot-name').value,
    workerBot: el('worker-bot').value,
    suite: el('bot-suite').value,
    task: el('bot-task').value,
    ioContract: el('bot-io').value,
    guardrails: el('bot-guardrails').value,
    requireApproval: el('require-approval').checked,
  });
}

function renderAgentsSelect() {
  const select = el('worker-bot');
  const previous = select.value;
  select.innerHTML = '';
  if (!state.agents.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No installed bots available';
    select.appendChild(opt);
    return;
  }
  for (const bot of state.agents) {
    const opt = document.createElement('option');
    opt.value = bot.name;
    opt.textContent = bot.role ? `${bot.name} (${bot.role})` : bot.name;
    select.appendChild(opt);
  }
  const preferred = state.agents.find((b) => b.name === previous)
    || state.agents.find((b) => b.name === 'codex-packer')
    || state.agents[0];
  if (preferred) select.value = preferred.name;
}

function renderDefinitionsList() {
  const list = el('authored-list');
  const empty = el('authored-empty');
  list.innerHTML = '';
  if (!state.definitions.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  for (const def of state.definitions) {
    const li = document.createElement('li');
    li.className = 'forge-draft-row';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = def.name || 'Untitled bot';
    const badge = document.createElement('span');
    const published = Boolean(def.publication && def.publication.published);
    badge.className = published ? 'forge-badge forge-badge-live' : 'forge-badge';
    badge.textContent = published ? `Live (${def.publication.package})` : `Draft v${def.version || 1}`;
    info.append(title, document.createTextNode(' '), badge);

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'forge-btn';
    loadBtn.textContent = 'Select';
    loadBtn.addEventListener('click', () => loadDefinitionIntoForm(def.id));
    li.append(info, loadBtn);
    list.appendChild(li);
  }
}

async function loadDefinitionIntoForm(id) {
  showError('');
  const res = await apiJson(`/api/workflow-studio/definitions/${encodeURIComponent(id)}`);
  if (!res.ok || !res.data?.definition) {
    showError(model.describeRefusal(res.status, res.data));
    return;
  }
  const def = res.data.definition;
  state.activeId = def.id;
  state.activeVersion = def.version;
  el('bot-name').value = def.name || '';
  el('bot-task').value = def.description || '';
  const workNode = (def.nodes || []).find((n) => n.type === 'execute-agent');
  const bound = workNode?.config?.agentBinding || workNode?.config?.agentId || '';
  if (bound && [...el('worker-bot').options].some((o) => o.value === bound)) {
    el('worker-bot').value = bound;
  }
  el('require-approval').checked = (def.nodes || []).some((n) => n.type === 'approval-gate');
  el('bot-guardrails').value = def.metadata?.notes || '';
  el('draft-status-pill').textContent = `Editing draft v${def.version}`;
}

async function refreshWorkspace() {
  const [agentsRes, defsRes] = await Promise.all([
    apiJson('/api/agents'),
    apiJson('/api/workflow-studio/definitions'),
  ]);
  if (agentsRes.ok && Array.isArray(agentsRes.data?.agents)) {
    state.agents = agentsRes.data.agents
      .filter((a) => typeof a?.name === 'string' && a.name.trim())
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  renderAgentsSelect();
  if (defsRes.ok && Array.isArray(defsRes.data?.definitions)) {
    state.definitions = defsRes.data.definitions;
  }
  renderDefinitionsList();
}

async function saveAndCompileDraft(spec) {
  let id = state.activeId;
  let version = state.activeVersion;
  if (!id) {
    const created = await apiJson('/api/workflow-studio/definitions', {
      method: 'POST',
      body: JSON.stringify({ name: spec.name, description: spec.description || spec.task }),
    });
    if (!created.ok || !created.data?.definition) return created;
    id = created.data.definition.id;
    version = created.data.definition.version;
    state.activeId = id;
    state.activeVersion = version;
  }
  const payload = model.buildSavePayload(id, version, spec);
  const saved = await apiJson(`/api/workflow-studio/definitions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!saved.ok || !saved.data?.definition) return saved;
  state.activeVersion = saved.data.definition.version;
  el('draft-status-pill').textContent = `Saved draft v${state.activeVersion}`;

  return apiJson(`/api/workflow-studio/definitions/${encodeURIComponent(id)}/compile`, {
    method: 'POST',
  });
}

function renderPermissionModal(previewInfo) {
  el('preview-package-id').textContent = previewInfo.packagePreview;
  el('preview-scope').textContent = `${previewInfo.scope} (caller-isolated, live without git commit)`;
  el('preview-worker').textContent = previewInfo.workerBot || 'Unbound';

  const fillList = (id, items) => {
    const ul = el(id);
    ul.innerHTML = '';
    for (const line of items) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    }
  };
  fillList('preview-capabilities', previewInfo.capabilities);
  fillList('preview-withheld', previewInfo.withheld);

  const issuesWrap = el('preview-issues-section');
  if (previewInfo.issues.length > 0) {
    fillList('preview-issues', previewInfo.issues);
    issuesWrap.hidden = false;
  } else {
    issuesWrap.hidden = true;
  }

  el('confirm-inject-btn').disabled = !previewInfo.ready;
  el('permission-preview-modal').hidden = false;
  el('confirm-inject-btn').focus();
}

async function handleInjectClick() {
  if (state.busy) return;
  showError('');
  const spec = readSpecFromForm();
  const check = model.validateSpec(spec);
  if (!check.valid) {
    showError(check.errors.join(' '));
    return;
  }
  state.busy = true;
  el('inject-btn').disabled = true;
  try {
    const compiled = await saveAndCompileDraft(spec);
    if (!compiled.ok || !compiled.data?.preview) {
      showError(model.describeRefusal(compiled.status, compiled.data));
      return;
    }
    const previewInfo = model.buildPermissionPreview(spec, compiled.data.preview);
    state.pendingPreview = { id: state.activeId, expectedVersion: state.activeVersion, previewInfo };
    renderPermissionModal(previewInfo);
    await refreshWorkspace();
  } catch {
    showError('Network error while preparing Permission Preview.');
  } finally {
    state.busy = false;
    el('inject-btn').disabled = false;
  }
}

async function handleConfirmInject() {
  if (state.busy || !state.pendingPreview) return;
  state.busy = true;
  el('confirm-inject-btn').disabled = true;
  showError('');
  try {
    const { id, expectedVersion } = state.pendingPreview;
    const pubRes = await apiJson(`/api/workflow-studio/definitions/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion }),
    });
    el('permission-preview-modal').hidden = true;
    state.pendingPreview = null;
    if (!pubRes.ok || !pubRes.data?.publication?.published) {
      showError(model.describeRefusal(pubRes.status, pubRes.data));
      return;
    }
    const pub = pubRes.data.publication;
    el('receipt-package').textContent = pub.package;
    el('receipt-ticket-type').textContent = pub.ticketType;
    el('receipt-version').textContent = `v${pub.version}`;
    el('receipt-mode').textContent = pub.executionMode || 'supported-sequential';
    el('publication-receipt').hidden = false;
    el('draft-status-pill').textContent = `Live: ${pub.package}`;
    await refreshWorkspace();
  } catch {
    el('permission-preview-modal').hidden = true;
    showError('Network error while publishing caller-scoped package.');
  } finally {
    state.busy = false;
  }
}

function resetDraftForm() {
  state.activeId = null;
  state.activeVersion = null;
  state.pendingPreview = null;
  el('bot-name').value = '';
  el('bot-task').value = '';
  el('bot-io').value = '';
  el('bot-guardrails').value = '';
  el('require-approval').checked = false;
  el('publication-receipt').hidden = true;
  el('draft-status-pill').textContent = 'New draft';
  showError('');
}

function importDraftYaml() {
  const parsed = model.parseForgeYamlDraft(el('yaml-import-input').value);
  if (!parsed.name && !parsed.task) {
    showError('Paste a drafted oshal-app.yaml or persona block first.');
    return;
  }
  if (parsed.name) el('bot-name').value = parsed.name;
  if (parsed.task) el('bot-task').value = parsed.task;
  if (parsed.guardrails) el('bot-guardrails').value = parsed.guardrails;
  el('bot-suite').value = parsed.suite;
  showError('');
}

function wireEvents() {
  el('inject-btn').addEventListener('click', handleInjectClick);
  el('confirm-inject-btn').addEventListener('click', handleConfirmInject);
  el('cancel-inject-btn').addEventListener('click', () => {
    state.pendingPreview = null;
    el('permission-preview-modal').hidden = true;
  });
  el('new-draft-btn').addEventListener('click', resetDraftForm);
  el('import-yaml-btn').addEventListener('click', importDraftYaml);
}

wireEvents();
void refreshWorkspace();
