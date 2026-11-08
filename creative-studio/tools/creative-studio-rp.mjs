/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Creative Studio 1.5.0 modal sheets and live client controllers for starter brief templates (RP-CRS-01), aspect-ratio resize (RP-CRS-02), Create and custom brand kits (RP-CRS-03), H.264 storyboard MP4 builds and download (RP-CRS-04), approval-gated social schedules (RP-CRS-05), brief/scene comments with replies and resolve (RP-CRS-06), and scene trim/split with Video Studio handoff (RP-CRS-07).
 */
import { backCloses } from '/api/creative-studio/source-project-editor.mjs';

const BASE = '/api/creative-studio';
const ASPECTS = [['16:9', 'Landscape 16:9 (1280×720)'], ['9:16', 'Vertical 9:16 (720×1280)'], ['1:1', 'Square 1:1 (1080×1080)'], ['4:5', 'Portrait 4:5 (1080×1350)']];
const FONTS = ['Arial', 'Calibri', 'Cambria', 'Candara', 'Century Gothic', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Garamond', 'Georgia', 'Trebuchet MS'];
const CHANNELS = [['youtube', 'YouTube'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['linkedin', 'LinkedIn'], ['x', 'X']];
const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

async function requestJson(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(body.error || `Request failed (${res.status}).`);
  return body;
}

function openSheet(title) {
  const dialog = make('dialog', 'source-confirm crs-sheet'), head = make('div', 'crs-sheet-head'), h2 = make('h2', '', title), done = make('button', 'source-tertiary', 'Done'), body = make('div', 'crs-sheet-body');
  h2.id = 'crs-sheet-' + crypto.randomUUID().slice(0, 8);
  dialog.setAttribute('aria-labelledby', h2.id);
  dialog.setAttribute('aria-label', title);
  done.type = 'button';
  head.append(h2, done); dialog.append(head, body); document.body.append(dialog);
  let closed = false;
  const history = backCloses({ isOpen: () => dialog.open, close: () => finish(true) });
  function finish(fromBack = false) {
    if (closed) return Promise.resolve();
    closed = true;
    if (dialog.open) dialog.close();
    const gone = fromBack ? Promise.resolve() : history.closed();
    dialog.remove();
    return gone;
  }
  done.onclick = () => void finish();
  dialog.addEventListener('cancel', e => { e.preventDefault(); void finish(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) void finish(); });
  dialog.showModal();
  history.opened();
  return { dialog, body, close: () => finish() };
}

function fieldRow(labelText, control) {
  const wrap = make('label', 'crs-field', labelText);
  wrap.append(control);
  return wrap;
}

function triggerDownload(url) {
  const link = make('a');
  link.href = url; link.download = '';
  document.body.append(link); link.click(); link.remove();
}

async function syncBuilds(env, projectId) {
  env.latestBuild = null;
  const editor = env.getEditor();
  if (!projectId) { editor?.showDownload(false); return []; }
  try {
    const { builds = [] } = await requestJson(`${BASE}/source-projects/${encodeURIComponent(projectId)}/builds`);
    env.latestBuild = builds[0] || null;
    editor?.showDownload(Boolean(env.latestBuild));
    return builds;
  } catch {
    editor?.showDownload(false);
    return [];
  }
}

async function openTemplates(env) {
  const sheet = openSheet('Starter templates'), note = make('p', 'hint', 'Choose a template to start an editable brief and storyboard.'), list = make('div', 'crs-list');
  sheet.body.append(note, list);
  const { templates = [] } = await requestJson(`${BASE}/source-projects/templates`);
  for (const tpl of templates) {
    const btn = make('button', 'crs-card-btn');
    btn.type = 'button'; btn.dataset.templateId = tpl.id;
    btn.append(make('strong', '', `${tpl.name} · ${tpl.aspectRatio}`), make('span', 'hint', `${tpl.scenes.length} scenes — ${tpl.notes}`));
    btn.onclick = async () => {
      await sheet.close();
      const current = env.getBriefMeta();
      const model = {
        version: 1, kind: 'story', title: tpl.title, notes: tpl.notes, sourceUrl: '', mode: 'episode',
        aspectRatio: tpl.aspectRatio, ...(current.brandKit ? { brandKit: current.brandKit } : {}),
        scenes: tpl.scenes.map(s => ({ id: crypto.randomUUID(), title: s.title, text: s.text, duration: s.duration })),
      };
      await env.getEditor().loadDraft(model, `Loaded "${tpl.name}" template.`);
    };
    list.append(btn);
  }
}

function openResize(env) {
  const sheet = openSheet('Resize storyboard'), current = env.getBriefMeta().aspectRatio || '16:9', list = make('div', 'crs-list');
  for (const [ratio, label] of ASPECTS) {
    const btn = make('button', ratio === current ? 'primary' : '', label);
    btn.type = 'button'; btn.dataset.aspectRatio = ratio;
    btn.onclick = async () => {
      env.getEditor().updateBrief(() => env.setBriefMeta({ ...env.getBriefMeta(), aspectRatio: ratio }), `Aspect ratio set to ${ratio}.`);
      await sheet.close();
    };
    list.append(btn);
  }
  sheet.body.append(make('p', 'hint', 'Applies to storyboard MP4 builds and saved brief metadata.'), list);
}

async function loadCreateBrandKit(host, applyKitValues) {
  try {
    const res = await fetch('/api/create/brand-kit', { credentials: 'same-origin', cache: 'no-store' });
    const data = res.ok ? await res.json().catch(() => null) : null;
    if (!data?.kit) return;
    const k = data.kit, importBtn = make('button', '', `Import from Create (${k.name || 'Saved kit'})`);
    importBtn.type = 'button'; importBtn.dataset.importCreateKit = '';
    importBtn.onclick = () => applyKitValues({
      name: k.name || 'Create Brand Kit', primaryColor: k.colors?.primary || '#1e293b',
      accentColor: k.colors?.accent || '#f59e0b', headingFont: k.fonts?.heading || 'Century Gothic',
      bodyFont: k.fonts?.body || 'Calibri', ...(k.logo?.src ? { logoSrc: k.logo.src } : {}),
    });
    host.prepend(importBtn);
  } catch { /* Create optional */ }
}

function openBrandKit(env) {
  const sheet = openSheet('Brand kit'), existing = env.getBriefMeta().brandKit || { name: 'Studio Brand', primaryColor: '#1e293b', accentColor: '#f59e0b', headingFont: 'Century Gothic', bodyFont: 'Calibri' };
  const importSlot = make('div', 'crs-actions-row'), nameIn = make('input'), primaryIn = make('input'), accentIn = make('input'), headSel = make('select'), bodySel = make('select'), err = make('p', 'hint', '');
  nameIn.maxLength = 80; nameIn.value = existing.name;
  primaryIn.type = accentIn.type = 'color'; primaryIn.value = existing.primaryColor; accentIn.value = existing.accentColor;
  for (const f of FONTS) { headSel.append(new Option(f, f)); bodySel.append(new Option(f, f)); }
  headSel.value = FONTS.includes(existing.headingFont) ? existing.headingFont : FONTS[0];
  bodySel.value = FONTS.includes(existing.bodyFont) ? existing.bodyFont : FONTS[1];
  let logoSrc = existing.logoSrc || '';
  void loadCreateBrandKit(importSlot, kit => { nameIn.value = kit.name; primaryIn.value = kit.primaryColor; accentIn.value = kit.accentColor; if (FONTS.includes(kit.headingFont)) headSel.value = kit.headingFont; if (FONTS.includes(kit.bodyFont)) bodySel.value = kit.bodyFont; logoSrc = kit.logoSrc || ''; });
  const applyBtn = make('button', 'primary', 'Apply brand kit'), clearBtn = make('button', '', 'Clear brand kit'), actions = make('div', 'crs-actions-row');
  applyBtn.type = clearBtn.type = 'button';
  applyBtn.onclick = async () => {
    const name = nameIn.value.trim();
    if (!name) { err.textContent = 'Enter a brand kit name.'; return; }
    const kit = { name, primaryColor: primaryIn.value.toLowerCase(), accentColor: accentIn.value.toLowerCase(), headingFont: headSel.value, bodyFont: bodySel.value, ...(logoSrc ? { logoSrc } : {}) };
    env.getEditor().updateBrief(() => env.setBriefMeta({ ...env.getBriefMeta(), brandKit: kit }), `Applied brand kit "${name}".`);
    await sheet.close();
  };
  clearBtn.onclick = async () => { env.getEditor().updateBrief(() => env.setBriefMeta({ ...env.getBriefMeta(), brandKit: null }), 'Cleared brand kit from brief.'); await sheet.close(); };
  actions.append(clearBtn, applyBtn);
  sheet.body.append(importSlot, fieldRow('Brand name', nameIn), fieldRow('Primary background', primaryIn), fieldRow('Accent title color', accentIn), fieldRow('Heading font', headSel), fieldRow('Body font', bodySel), err, actions);
}

async function renderNewBuild(env, noteNode) {
  const editor = env.getEditor();
  if (!editor.getScenes().length) throw Error('Add at least one scene to the storyboard before building an MP4.');
  if (noteNode) noteNode.textContent = 'Saving brief and rendering H.264 MP4 storyboard…';
  const saved = await editor.ensureSaved();
  const { build } = await requestJson(`${BASE}/source-projects/${encodeURIComponent(saved.id)}/builds`, { method: 'POST', body: '{}' });
  env.latestBuild = build;
  editor.showDownload(true);
  env.setStatus(`Rendered ${build.aspectRatio} MP4 (${build.durationSeconds}s, ${Math.max(1, Math.round(build.bytes / 1024))} KB).`);
  return build;
}

async function openBuildSheet(env) {
  const sheet = openSheet('Storyboard MP4 builds'), msg = make('p', 'hint', 'Render the current storyboard scenes to a downloadable H.264 MP4 in package storage.'), list = make('div', 'crs-list');
  const buildBtn = make('button', 'primary', 'Render MP4 build'); buildBtn.type = 'button';
  const drawBuilds = builds => {
    list.replaceChildren();
    for (const b of builds) {
      const row = make('div', 'crs-item-row'), info = make('span', '', `Rev ${b.revision} · ${b.aspectRatio} · ${b.durationSeconds}s (${Math.max(1, Math.round(b.bytes / 1024))} KB)`), dl = make('a', '', 'Download MP4');
      dl.href = b.downloadUrl; dl.download = '';
      row.append(info, dl); list.append(row);
    }
    if (!builds.length) list.append(make('p', 'hint', 'No MP4 builds rendered for this brief yet.'));
  };
  buildBtn.onclick = async () => {
    buildBtn.disabled = true;
    try { const b = await renderNewBuild(env, msg); msg.textContent = `Build ready: ${b.aspectRatio} (${b.durationSeconds}s).`; drawBuilds(await syncBuilds(env, b.projectId)); }
    catch (e) { msg.textContent = e.message; }
    finally { buildBtn.disabled = false; }
  };
  sheet.body.append(msg, buildBtn, list);
  const id = env.getEditor().currentId();
  drawBuilds(id ? await syncBuilds(env, id) : []);
}

async function refreshScheduleRows(list, projectId) {
  const { schedules = [] } = await requestJson(`${BASE}/schedules`);
  list.replaceChildren();
  for (const s of schedules.filter(r => !projectId || r.projectId === projectId)) {
    const row = make('div', 'crs-item-row'), text = make('span', '', `${s.channel.toUpperCase()} · ${s.status} · ${new Date(s.scheduledFor).toLocaleString()}`);
    row.append(text);
    if (s.status === 'scheduled') {
      const cancel = make('button', 'source-tertiary', 'Cancel'); cancel.type = 'button';
      cancel.onclick = async () => { await requestJson(`${BASE}/schedules/${encodeURIComponent(s.id)}/cancel`, { method: 'POST', body: '{}' }); await refreshScheduleRows(list, projectId); };
      row.append(cancel);
    }
    list.append(row);
  }
  if (!list.children.length) list.append(make('p', 'hint', 'No scheduled posts for this brief yet.'));
}

async function openSchedule(env) {
  const sheet = openSheet('Schedule publication'), msg = make('p', 'hint', 'Queue an approved publication record for a rendered storyboard MP4 build.');
  const chSel = make('select'), capIn = make('textarea'), modeSel = make('select'), whenIn = make('input'), approveWrap = make('label', 'crs-check'), approveBox = make('input'), submit = make('button', 'primary', 'Approve & schedule'), list = make('div', 'crs-list');
  for (const [val, label] of CHANNELS) chSel.append(new Option(label, val));
  capIn.rows = 2; capIn.maxLength = 1000; capIn.placeholder = 'Post caption';
  modeSel.append(new Option('Schedule for time', 'later'), new Option('Post immediately', 'now'));
  whenIn.type = 'datetime-local';
  whenIn.value = new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modeSel.onchange = () => { whenIn.disabled = modeSel.value === 'now'; };
  approveBox.type = 'checkbox'; submit.type = 'button';
  approveWrap.append(approveBox, document.createTextNode(' Approve publication of this storyboard build'));
  const currentProjectId = () => env.getEditor().currentId();
  submit.onclick = async () => {
    if (!approveBox.checked) { msg.textContent = 'Check explicit approval before scheduling or posting.'; return; }
    submit.disabled = true;
    try {
      const build = env.latestBuild || await renderNewBuild(env, msg);
      const iso = modeSel.value === 'now' ? new Date().toISOString() : new Date(whenIn.value).toISOString();
      const { schedule } = await requestJson(`${BASE}/schedules`, { method: 'POST', body: JSON.stringify({ projectId: build.projectId, buildId: build.id, channel: chSel.value, caption: capIn.value.trim(), postNow: modeSel.value === 'now', scheduledFor: iso, approved: true }) });
      msg.textContent = `${schedule.channel.toUpperCase()} ${schedule.status === 'posted' ? 'posted' : 'scheduled'} (${schedule.status}).`;
      await refreshScheduleRows(list, build.projectId);
    } catch (e) { msg.textContent = e.message; } finally { submit.disabled = false; }
  };
  sheet.body.append(msg, fieldRow('Channel', chSel), fieldRow('Caption', capIn), fieldRow('Timing', modeSel), fieldRow('Publish time', whenIn), approveWrap, submit, list);
  await refreshScheduleRows(list, currentProjectId()).catch(() => {});
}

async function refreshCommentRows(editor, list, pid, replyState, msg, bodyIn) {
  if (!pid) { list.replaceChildren(make('p', 'hint', 'Post a comment to save the brief and attach notes.')); return; }
  const { comments = [] } = await requestJson(`${BASE}/source-projects/${encodeURIComponent(pid)}/comments`);
  list.replaceChildren();
  const scenesById = new Map(editor.getScenes().map((s, i) => [s.id, `Scene ${i + 1}`]));
  for (const c of comments) {
    const row = make('div', 'crs-comment' + (c.parentId ? ' crs-reply' : '')), tag = c.sceneId ? (scenesById.get(c.sceneId) || 'Scene') : 'Brief';
    const head = make('div', 'crs-item-row'), meta = make('strong', '', `${tag}${c.resolved ? ' · Resolved' : ''}`), btns = make('span', 'crs-actions-row');
    if (!c.parentId) {
      const reply = make('button', 'source-tertiary', 'Reply'); reply.type = 'button';
      reply.onclick = () => { replyState.id = c.id; msg.textContent = `Replying to comment: "${c.body.slice(0, 40)}"`; bodyIn.focus(); };
      btns.append(reply);
    }
    const toggle = make('button', 'source-tertiary', c.resolved ? 'Reopen' : 'Resolve'); toggle.type = 'button';
    toggle.onclick = async () => { await requestJson(`${BASE}/source-projects/${encodeURIComponent(pid)}/comments/${encodeURIComponent(c.id)}/resolve`, { method: 'POST', body: JSON.stringify({ resolved: !c.resolved }) }); await refreshCommentRows(editor, list, pid, replyState, msg, bodyIn); };
    btns.append(toggle); head.append(meta, btns); row.append(head, make('p', '', c.body)); list.append(row);
  }
  if (!comments.length) list.append(make('p', 'hint', 'No comments yet.'));
}

async function openComments(env) {
  const editor = env.getEditor(), sheet = openSheet('Brief & scene comments'), msg = make('p', 'hint', 'Pin notes to the brief or a specific scene.'), pinSel = make('select'), bodyIn = make('textarea'), postBtn = make('button', 'primary', 'Post comment'), list = make('div', 'crs-list');
  pinSel.append(new Option('Entire brief', ''));
  for (const [i, sc] of editor.getScenes().entries()) pinSel.append(new Option(`Scene ${i + 1}: ${sc.title}`, sc.id));
  bodyIn.rows = 2; bodyIn.maxLength = 2000; bodyIn.placeholder = 'Add review feedback…'; postBtn.type = 'button';
  const replyState = { id: null };
  postBtn.onclick = async () => {
    if (!bodyIn.value.trim()) { msg.textContent = 'Write a comment first.'; return; }
    postBtn.disabled = true;
    try {
      const saved = await editor.ensureSaved();
      await requestJson(`${BASE}/source-projects/${encodeURIComponent(saved.id)}/comments`, { method: 'POST', body: JSON.stringify({ body: bodyIn.value.trim(), ...(pinSel.value ? { sceneId: pinSel.value } : {}), ...(replyState.id ? { parentId: replyState.id } : {}) }) });
      bodyIn.value = ''; replyState.id = null; msg.textContent = 'Comment posted.';
      await refreshCommentRows(editor, list, saved.id, replyState, msg, bodyIn);
    } catch (e) { msg.textContent = e.message; } finally { postBtn.disabled = false; }
  };
  sheet.body.append(msg, fieldRow('Pin to', pinSel), fieldRow('Comment', bodyIn), postBtn, list);
  await refreshCommentRows(editor, list, editor.currentId(), replyState, msg, bodyIn).catch(() => {});
}

function openTrimSplit(env, scene) {
  const sheet = openSheet(`Trim & split: ${scene.title}`), span = (scene.trimOut ?? scene.duration) - (scene.trimIn ?? 0), msg = make('p', 'hint', `Scene length: ${scene.duration}s (playable span ${span}s).`);
  const inField = make('input'), outField = make('input'), trimBtn = make('button', 'primary', 'Apply trim');
  inField.type = outField.type = 'number'; inField.min = '0'; inField.max = String(Math.max(0, scene.duration - 1)); inField.value = String(scene.trimIn ?? 0);
  outField.min = '1'; outField.max = String(scene.duration); outField.value = String(scene.trimOut ?? scene.duration);
  trimBtn.type = 'button';
  trimBtn.onclick = async () => { try { env.getEditor().trimScene(scene.id, Number(inField.value), Number(outField.value)); await sheet.close(); } catch (e) { msg.textContent = e.message; } };
  const splitField = make('input'), splitBtn = make('button', '', 'Split scene'), handoffBtn = make('button', 'source-tertiary', 'Open in Video Studio');
  splitField.type = 'number'; splitField.min = '1'; splitField.max = String(Math.max(1, span - 1)); splitField.value = String(Math.max(1, Math.floor(span / 2)));
  splitBtn.type = handoffBtn.type = 'button'; splitBtn.disabled = span < 2;
  splitBtn.onclick = async () => { try { env.getEditor().splitScene(scene.id, Number(splitField.value)); await sheet.close(); } catch (e) { msg.textContent = e.message; } };
  handoffBtn.onclick = async () => { await sheet.close(); env.onEpisodeHandoff(); };
  const row = make('div', 'crs-actions-row'); row.append(trimBtn, splitBtn, handoffBtn);
  sheet.body.append(msg, fieldRow('Trim start (s)', inField), fieldRow('Trim end (s)', outField), fieldRow('Split at second', splitField), row);
}

export function createStudioRpController(deps) {
  const env = { ...deps, latestBuild: null };
  const downloadLatestOrOpen = async () => {
    if (env.latestBuild?.downloadUrl) { triggerDownload(env.latestBuild.downloadUrl); env.setStatus(`Downloading ${env.latestBuild.aspectRatio} MP4 build.`); return; }
    await openBuildSheet(env);
  };
  return {
    openTemplates: () => openTemplates(env),
    openResize: () => openResize(env),
    openBrandKit: () => openBrandKit(env),
    openBuildSheet: () => openBuildSheet(env),
    downloadLatestOrOpen,
    openSchedule: () => openSchedule(env),
    openComments: () => openComments(env),
    syncBuilds: projectId => syncBuilds(env, projectId),
    tools: {
      comment: () => openComments(env),
      download: downloadLatestOrOpen,
      build: () => openBuildSheet(env),
      resize: () => openResize(env),
      schedule: () => openSchedule(env),
      sceneTools: (scene, busy) => [{ label: 'Trim & split', run: () => openTrimSplit(env, scene), disabled: busy }],
    },
  };
}
