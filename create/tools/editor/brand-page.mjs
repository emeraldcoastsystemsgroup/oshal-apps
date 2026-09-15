/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the Brand Kit page: load the private kit, edit it through the shared validator, upload a logo, suggest colors from its pixels, preview real branded templates and save with optimistic revisions.
 */
import { BRAND_ROLES, BRAND_ROLE_LABELS, BRAND_ROLE_HINTS, BRAND_FONTS, FONT_PAIRINGS, BRAND_LIMITS,
  defaultBrandKit, validateBrandKit, contrast, palettePhrase, hsl, luminance } from './brand-kit.mjs';
import { createBrandedTemplate } from './templates.mjs';
import { renderProject } from './renderer.mjs';

const $ = id => document.getElementById(id);
const state = { kit: defaultBrandKit(), revision: 0, canChange: false, saved: '', loading: true, saving: false, uploading: false, undoColors: null };
const MESSAGES = {
  brand_revision_conflict: 'Your brand kit changed in another tab. Reload this page to see the latest version.',
  brand_permission_denied: 'Your current role does not permit this change.',
  brand_logo_unavailable: 'That logo is no longer available. Upload it again.',
  brand_kit_not_found: 'There is no saved brand kit to remove.',
  project_asset_limit_reached: 'Your image storage is full. Clean unused uploads in the image editor, then try again.',
  project_image_too_large: 'This image exceeds the 8 MB limit.',
  invalid_project_image: 'Choose a PNG, JPEG or WebP image within 8192 pixels on each side.',
  invalid_brand_kit: 'Some brand kit values are not supported. Check the colors and fonts.',
  project_write_queue_full: 'Storage is busy. Your changes are still here; try saving again.',
  project_write_queue_timeout: 'Storage is busy. Your changes are still here; try saving again.',
};
const FALLBACK_URLS = { 'create-editor': '/api/create/editor', 'create-office': '/api/presentations/sections/ui',
  'create-portrait': '/api/portrait-studio/app', 'create-video': '/api/video/ui' };
const PREVIEWS = [['previewSquare', 'square-announcement', 640], ['previewWide', 'presentation-title', 960], ['previewVideo', 'video-thumbnail', 960]];
let toastTimer = 0, previewTimer = 0, previewGeneration = 0, logoCache = { src: '', promise: null };

/** Office faces with a generic fallback, so a specimen still reads where a face is not installed. */
function fontStack(face) {
  const generic = ['Cambria', 'Constantia', 'Garamond', 'Georgia'].includes(face) ? 'serif' : ['Consolas', 'Courier New'].includes(face) ? 'monospace' : 'sans-serif';
  return `"${face}", ${generic}`;
}
function normalized() { try { return validateBrandKit(state.kit); } catch { return null; } }
function dirty() { const kit = normalized(); return !kit || JSON.stringify(kit) !== state.saved; }
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200);
}
function error(message) { $('pageError').textContent = message || ''; $('pageError').hidden = !message; }
function handle(work) { return async event => { try { error(''); await work(event); } catch (failure) { error(failure.message || 'This action could not finish.'); } }; }
const jsonRequest = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Same-origin JSON with a bounded wait; server codes become sentences a person can act on. */
async function api(path, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/api/create' + path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
    if (response.status === 204) return null;
    let body = null; try { body = await response.json(); } catch { /* A gateway page is reported by status below. */ }
    if (!response.ok) {
      const failure = new Error(MESSAGES[body?.error] || `The server could not complete this request (${response.status}).`);
      failure.status = response.status; failure.code = body?.error; throw failure;
    }
    return body;
  } catch (failure) {
    if (controller.signal.aborted) throw new Error('The server took too long to respond. Please try again.');
    throw failure;
  } finally { clearTimeout(timer); }
}

/** The ribbon's app-navigate dialect inside the cockpit; the studio's own URL when opened alone. */
function go(tool, query = '') {
  const embedded = (() => { try { return window.parent && window.parent !== window; } catch { return false; } })();
  if (embedded) { window.parent.postMessage({ type: 'app-navigate', tool, ...(query ? { query } : {}) }, window.location.origin); return; }
  window.location.assign(FALLBACK_URLS[tool] + (query ? `?${query}` : ''));
}

function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }

function bindRoles() {
  for (const role of BRAND_ROLES) {
    const row = el('div', 'role-row'), picker = el('input'), hexInput = el('input', 'hex'), label = el('div');
    picker.type = 'color'; picker.id = `color-${role}`; picker.dataset.edit = ''; picker.setAttribute('aria-label', `${BRAND_ROLE_LABELS[role]} color`);
    hexInput.id = `hex-${role}`; hexInput.dataset.edit = ''; hexInput.maxLength = 7; hexInput.setAttribute('aria-label', `${BRAND_ROLE_LABELS[role]} hex value`);
    label.append(el('b', '', BRAND_ROLE_LABELS[role]), el('span', '', BRAND_ROLE_HINTS[role]));
    picker.addEventListener('input', () => setColor(role, picker.value));
    hexInput.addEventListener('change', () => {
      const value = hexInput.value.trim().replace(/^([0-9a-f]{6})$/i, '#$1');
      if (/^#[0-9a-f]{6}$/i.test(value)) setColor(role, value); else { hexInput.value = state.kit.colors[role]; toast('Use a six-digit hex color such as #7d2ae8.'); }
    });
    row.append(picker, label, hexInput); $('roleColors').append(row);
  }
}

function setColor(role, value) { state.kit.colors = { ...state.kit.colors, [role]: value.toLowerCase() }; state.undoColors = null; render(); schedulePreview(); }

function renderExtras() {
  const list = $('extraColors'); list.replaceChildren();
  state.kit.extras.forEach((extra, index) => {
    const item = el('div', 'extra'), picker = el('input'), name = el('input'), remove = el('button', '', 'Remove');
    picker.type = 'color'; picker.value = extra.hex; picker.dataset.edit = ''; picker.setAttribute('aria-label', `${extra.name} color`);
    name.type = 'text'; name.value = extra.name; name.maxLength = BRAND_LIMITS.swatchName; name.dataset.edit = ''; name.setAttribute('aria-label', 'Color name');
    remove.type = 'button'; remove.dataset.edit = ''; remove.setAttribute('aria-label', `Remove ${extra.name}`);
    picker.addEventListener('input', () => { state.kit.extras[index] = { ...state.kit.extras[index], hex: picker.value }; renderStatus(); });
    name.addEventListener('input', () => { state.kit.extras[index] = { ...state.kit.extras[index], name: name.value }; renderStatus(); });
    remove.addEventListener('click', () => { state.kit.extras = state.kit.extras.filter((_, i) => i !== index); render(); });
    item.append(picker, name, remove); list.append(item);
  });
  $('addExtra').hidden = state.kit.extras.length >= BRAND_LIMITS.extras;
}

function bindFonts() {
  for (const id of ['headingFont', 'bodyFont']) {
    for (const face of BRAND_FONTS) { const option = el('option', '', face); option.value = face; option.style.fontFamily = fontStack(face); $(id).append(option); }
    $(id).addEventListener('change', () => { state.kit.fonts = { ...state.kit.fonts, [id === 'headingFont' ? 'heading' : 'body']: $(id).value }; render(); schedulePreview(); });
  }
  for (const pairing of FONT_PAIRINGS) {
    const button = el('button'); button.type = 'button'; button.dataset.edit = ''; button.dataset.pairing = pairing.id;
    const title = el('b', '', pairing.name); title.style.fontFamily = fontStack(pairing.heading);
    button.append(title, el('span', '', `${pairing.heading} + ${pairing.body}`));
    button.addEventListener('click', () => { state.kit.fonts = { heading: pairing.heading, body: pairing.body }; render(); schedulePreview(); });
    $('pairings').append(button);
  }
}

function renderContrast() {
  const { colors } = state.kit, checks = [
    ['Text on background', contrast(colors.dark, colors.light), 4.5],
    ['Background on primary', contrast(colors.light, colors.primary), 3],
    ['Primary on background', contrast(colors.primary, colors.light), 3],
  ];
  $('contrast').replaceChildren(...checks.map(([label, ratio, minimum]) => {
    const chip = el('span', ratio >= minimum ? 'pass' : 'fail', `${label} ${ratio.toFixed(1)}:1`);
    chip.title = ratio >= minimum ? 'Readable' : `Below ${minimum}:1 — templates re-ink text that would be hard to read`; return chip;
  }));
}

function renderLogo() {
  const logo = state.kit.logo;
  for (const [id, surface] of [['logoLight', 'light'], ['logoDark', 'dark']]) {
    const image = $(id); image.hidden = !logo; if (logo && image.getAttribute('src') !== logo.src) image.src = logo.src;
    image.parentElement.style.background = state.kit.colors[surface];
    image.parentElement.style.color = state.kit.colors[surface === 'light' ? 'dark' : 'light'];
  }
  $('uploadLogo').textContent = logo ? 'Replace logo' : 'Upload logo';
}

function renderStatus() {
  const busy = state.loading || state.saving || state.uploading, editable = state.canChange && !busy;
  for (const control of document.querySelectorAll('[data-edit]')) control.disabled = !editable;
  $('suggestColors').disabled = !editable || !state.kit.logo; $('removeLogo').disabled = !editable || !state.kit.logo;
  $('suggestColors').textContent = state.undoColors ? 'Undo suggested colors' : 'Suggest colors from logo';
  $('saveKit').disabled = !editable || !dirty(); $('removeKit').hidden = !state.canChange || !state.revision;
  $('saveStatus').textContent = state.loading ? 'Loading your brand kit…' : state.saving ? 'Saving…' : state.uploading ? 'Uploading logo…'
    : !state.canChange ? 'View only' : !state.revision && dirty() ? 'Not saved yet' : dirty() ? 'Unsaved changes' : `Saved · revision ${state.revision}`;
}

function value(id, next) { if (document.activeElement !== $(id)) $(id).value = next; }

function render() {
  const { kit } = state;
  value('brandName', kit.name); value('brandVoice', kit.voice); $('voiceCount').textContent = `${kit.voice.length} / ${BRAND_LIMITS.voice}`;
  for (const role of BRAND_ROLES) { value(`color-${role}`, kit.colors[role]); value(`hex-${role}`, kit.colors[role]); }
  value('headingFont', kit.fonts.heading); value('bodyFont', kit.fonts.body);
  for (const button of $('pairings').children) {
    const pairing = FONT_PAIRINGS.find(item => item.id === button.dataset.pairing);
    button.setAttribute('aria-pressed', String(pairing.heading === kit.fonts.heading && pairing.body === kit.fonts.body));
  }
  $('specimen').style.background = kit.colors.light; $('specimen').style.color = kit.colors.dark;
  $('specimen').querySelector('.specimen-heading').style.fontFamily = fontStack(kit.fonts.heading);
  $('specimen').querySelector('.specimen-heading').style.color = kit.colors.primary;
  $('specimen').querySelector('.specimen-body').style.fontFamily = fontStack(kit.fonts.body);
  $('paletteWords').textContent = palettePhrase(kit);
  renderExtras(); renderContrast(); renderLogo(); renderStatus();
}

function logoImage(src) {
  if (logoCache.src !== src) {
    logoCache = { src, promise: new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('The logo could not be loaded.')); image.src = src;
    }) };
  }
  return logoCache.promise;
}

/** Paint the exact editor output: the real template module, the real renderer, the person's kit. */
async function paintPreviews() {
  const generation = ++previewGeneration, kit = normalized();
  if (!kit) return;
  const images = new Map();
  if (kit.logo) {
    try { images.set(kit.logo.src.split('/').pop(), await logoImage(kit.logo.src)); } catch (failure) { error(failure.message); }
  }
  for (const [canvasId, templateId, width] of PREVIEWS) {
    if (generation !== previewGeneration) return;
    const project = createBrandedTemplate(templateId, kit), full = document.createElement('canvas');
    const visible = { ...project, layers: project.layers.filter(layer => layer.type !== 'image' || images.has(layer.assetId)) };
    renderProject(full.getContext('2d'), visible, { images });
    const target = $(canvasId); target.width = width; target.height = Math.round(width * project.height / project.width);
    target.getContext('2d').drawImage(full, 0, 0, target.width, target.height); full.width = full.height = 1;
  }
}
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(() => { paintPreviews().catch(failure => error(failure.message)); }, 120); }

function toHex(r, g, b) { return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join(''); }
function hueGap(a, b) { const d = Math.abs(hsl(a)[0] - hsl(b)[0]); return Math.min(d, 360 - d); }

/** Count the logo's own pixels (16 levels per channel), most common first; transparent pixels do not vote. */
async function logoColors(src) {
  const image = await logoImage(src), size = 64, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size), buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4), bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += data[i]; bucket.g += data[i + 1]; bucket.b += data[i + 2]; bucket.n += 1; buckets.set(key, bucket);
  }
  const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.n, 0) || 1;
  return [...buckets.values()].map(bucket => ({ hex: toHex(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n), share: bucket.n / total }))
    .sort((a, b) => b.share - a.share);
}

/** Primary, secondary and accent from distinct vivid hues; text and background from the darkest and lightest. */
function suggestColors(colors, current) {
  const vivid = colors.filter(color => { const [, s, l] = hsl(color.hex); return s > 0.25 && l > 0.15 && l < 0.85 && color.share > 0.01; });
  const distinct = [];
  for (const color of vivid) if (distinct.every(pick => hueGap(pick.hex, color.hex) > 28)) distinct.push(color);
  const next = { ...current };
  ['primary', 'secondary', 'accent'].forEach((role, index) => { if (distinct[index]) next[role] = distinct[index].hex; });
  const byLight = colors.filter(color => color.share > 0.005).sort((a, b) => luminance(a.hex) - luminance(b.hex));
  if (byLight[0] && luminance(byLight[0].hex) < 0.08) next.dark = byLight[0].hex;
  if (byLight.length && luminance(byLight.at(-1).hex) > 0.8) next.light = byLight.at(-1).hex;
  return { next, found: distinct.length };
}

async function suggestFromLogo() {
  if (state.undoColors) { state.kit.colors = state.undoColors; state.undoColors = null; render(); schedulePreview(); return; }
  const { next, found } = suggestColors(await logoColors(state.kit.logo.src), state.kit.colors);
  state.undoColors = state.kit.colors; state.kit.colors = next; render(); schedulePreview();
  toast(found ? `Picked ${found} color${found === 1 ? '' : 's'} from your logo. Adjust any swatch, then save.` : 'Your logo has no strong colors, so only text and background changed.');
}

async function uploadLogo(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8388608) throw new Error('Choose a PNG, JPEG or WebP image up to 8 MB.');
  state.uploading = true; renderStatus();
  try {
    const form = new FormData(); form.append('image', file, file.name || 'logo.png');
    const { asset } = await api('/brand-kit/logo', { method: 'POST', body: form });
    state.kit.logo = { src: asset.src, width: asset.width, height: asset.height }; state.undoColors = null;
    toast('Logo added. Save the brand kit to keep it.');
  } finally { state.uploading = false; render(); schedulePreview(); }
}

async function save() {
  const kit = validateBrandKit(state.kit);
  state.saving = true; renderStatus();
  try {
    const result = await api('/brand-kit', jsonRequest('PUT', { baseRevision: state.revision, kit }));
    state.kit = validateBrandKit(result.kit); state.revision = result.revision; state.saved = JSON.stringify(state.kit); state.undoColors = null;
    toast('Brand kit saved. Your studios use it from now on.');
  } finally { state.saving = false; render(); }
}

async function removeKit() {
  if (!window.confirm('Remove your brand kit? Studios go back to their own looks. Designs you already made keep their colors.')) return;
  state.saving = true; renderStatus();
  try {
    await api('/brand-kit', jsonRequest('DELETE', { baseRevision: state.revision }));
    state.kit = defaultBrandKit(); state.revision = 0; state.saved = ''; toast('Brand kit removed.');
  } finally { state.saving = false; render(); schedulePreview(); }
}

function bindControls() {
  bindRoles(); bindFonts();
  $('brandName').addEventListener('input', () => { state.kit.name = $('brandName').value; renderStatus(); schedulePreview(); });
  $('brandVoice').addEventListener('input', () => { state.kit.voice = $('brandVoice').value.replace(/\s+/g, ' ').slice(0, BRAND_LIMITS.voice); $('voiceCount').textContent = `${state.kit.voice.length} / ${BRAND_LIMITS.voice}`; renderStatus(); });
  $('addExtra').addEventListener('click', () => { state.kit.extras = [...state.kit.extras, { name: `Color ${state.kit.extras.length + 1}`, hex: state.kit.colors.secondary }]; render(); });
  $('uploadLogo').addEventListener('click', () => $('logoFile').click());
  $('logoFile').addEventListener('change', handle(async () => { const file = $('logoFile').files[0]; $('logoFile').value = ''; if (file) await uploadLogo(file); }));
  $('removeLogo').addEventListener('click', () => { state.kit.logo = null; state.undoColors = null; render(); schedulePreview(); });
  $('suggestColors').addEventListener('click', handle(suggestFromLogo));
  $('saveKit').addEventListener('click', handle(save)); $('removeKit').addEventListener('click', handle(removeKit));
  $('openTemplates').addEventListener('click', () => go('create-editor', 'templates=1'));
  for (const button of document.querySelectorAll('[data-go]')) button.addEventListener('click', () => go(button.dataset.go, button.dataset.query || ''));
  window.addEventListener('beforeunload', event => { if (state.canChange && state.revision && dirty()) event.preventDefault(); });
}

async function start() {
  bindControls();
  try {
    const result = await api('/brand-kit');
    state.canChange = Boolean(result.canChange);
    if (result.kit) { state.kit = validateBrandKit(result.kit); state.revision = result.revision; state.saved = JSON.stringify(state.kit); }
  } catch (failure) {
    state.loading = false;
    if (failure.status === 403) { $('locked').hidden = false; $('saveStatus').textContent = 'No access'; return; }
    error(failure.message); $('saveStatus').textContent = 'Unavailable'; return;
  }
  state.loading = false; $('workspace').hidden = false; render(); schedulePreview();
}
start();
