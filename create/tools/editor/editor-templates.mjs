/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Browse real editable designs and create an independent draft without replacing saved projects.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Show and start designs in the person's brand kit while the gallery's Show in my brand switch is on.
 */
import { $, state, openDocument, notify, subscribe, handle } from './editor-state.mjs';
import { mayReplace } from './editor-projects.mjs';
import { renderProject } from './renderer.mjs';
import { TEMPLATES, createTemplate, createBrandedTemplate } from './templates.mjs';
import { templateBrandKit, brandImages } from './brand-editor.mjs';

const canStart = () => Boolean(state.permissions.create) && !state.loading && !state.saving;

/** The same design, dressed in the brand kit while the gallery switch is on. */
function designFor(id) { const kit = templateBrandKit(); return kit ? createBrandedTemplate(id, kit) : createTemplate(id); }

/** Paint the same composition used by the editor, then retain only a small thumbnail. */
function thumbnail(id) {
  const project = designFor(id), source = document.createElement('canvas'), images = brandImages();
  const preview = document.createElement('canvas'); preview.setAttribute('aria-hidden', 'true');
  renderProject(source.getContext('2d'), { ...project, layers: project.layers.filter(layer => layer.type !== 'image' || images.has(layer.assetId)) }, { images });
  preview.width = 320; preview.height = Math.round(320 * project.height / project.width);
  preview.getContext('2d').drawImage(source, 0, 0, preview.width, preview.height);
  source.width = source.height = 1;
  return preview;
}

/** Applying a template creates a fresh unsaved project; the original remains in My projects. */
function useTemplate(id) {
  if (!canStart()) throw new Error('Your current role does not allow starting an image project.');
  const project = designFor(id);
  if (!mayReplace()) return;
  openDocument(project);
  if ($('templateDialog').open) $('templateDialog').close();
  $('projectName').focus(); $('projectName').select();
}

function text(tag, className, value) {
  const node = document.createElement(tag); node.className = className; node.textContent = value; return node;
}

function card(template) {
  const button = document.createElement('button'); button.type = 'button';
  button.className = 'template-card'; button.dataset.templateId = template.id;
  button.setAttribute('aria-label', `Use ${template.name} template`); button.disabled = !canStart();
  const preview = document.createElement('span'); preview.className = 'template-preview'; preview.append(thumbnail(template.id));
  button.append(preview, text('strong', 'template-name', template.name),
    text('span', 'template-meta', `${template.category} · ${template.width} × ${template.height}`),
    text('span', 'template-description', template.description));
  button.onclick = handle(() => useTemplate(template.id));
  return button;
}

function renderTemplates() {
  const query = $('templateSearch').value.trim().toLocaleLowerCase(), category = $('templateCategory').value;
  const matches = TEMPLATES.filter(item => (!category || item.category === category)
    && `${item.name} ${item.description} ${item.category}`.toLocaleLowerCase().includes(query));
  $('templateGrid').replaceChildren(...matches.map(card));
  $('templateCount').textContent = `${matches.length} editable ${matches.length === 1 ? 'design' : 'designs'}`;
  $('templateEmpty').hidden = matches.length > 0;
}

function availability() {
  $('openTemplates').disabled = state.loading || state.saving;
  $('templatePermission').hidden = state.loading || Boolean(state.permissions.create);
  for (const button of $('templateGrid').querySelectorAll('button')) button.disabled = !canStart();
}

function showTemplates() {
  if (state.loading || state.saving) throw new Error('Wait for the current action to finish.');
  renderTemplates(); availability();
  if (!$('templateDialog').open) $('templateDialog').showModal();
  $('templateSearch').focus();
}

/** Bind palette-aware browsing once; search and category changes never edit the open canvas. */
export function bindTemplates() {
  for (const category of [...new Set(TEMPLATES.map(item => item.category))]) {
    const option = document.createElement('option'); option.value = category; option.textContent = category;
    $('templateCategory').append(option);
  }
  $('openTemplates').onclick = handle(showTemplates);
  $('closeTemplates').onclick = () => $('templateDialog').close();
  $('templateDialog').addEventListener('close', () => $('openTemplates').focus());
  $('templateSearch').oninput = handle(renderTemplates); $('templateCategory').onchange = handle(renderTemplates);
  $('brandTemplates').onchange = handle(renderTemplates);
  subscribe(availability); availability();
}

/** Open an exact catalog design only after current permissions resolve; saved project links take precedence. */
export function acceptIncomingTemplate() {
  const query = new URLSearchParams(location.search);
  if ((query.has('template') || query.get('templates') === '1') && query.has('artifact')) {
    throw new Error('Open a template or an image file separately, then add the image to your design.');
  }
  if (query.has('project')) return;
  if (query.has('template')) {
    if (query.getAll('template').length !== 1) throw new Error('Choose one image template.');
    useTemplate(query.get('template')); notify();
  } else if (query.get('templates') === '1') showTemplates();
}
