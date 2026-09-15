/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bring the person's brand kit into the image editor: brand swatches for the selected layer or the canvas, the logo as a layer, brand and Office fonts in the font list, and the kit for branded templates.
 */
import { $, state, edit, notify, subscribe, handle, api, canEdit } from './editor-state.mjs';
import { BRAND_ROLES, BRAND_ROLE_LABELS, BRAND_FONTS, validateBrandKit, logoAssetId } from './brand-kit.mjs';
import { LIMITS } from './model.mjs';

const brand = { kit: null, available: false, logo: null, signature: '' };
const BASIC_FONTS = [['sans-serif', 'Sans serif'], ['serif', 'Serif'], ['monospace', 'Monospace']];

/** @description The saved kit, or null when the person has none or may not read it.
 * @returns {object|null} Validated kit. */
export function brandKit() { return brand.kit; }

/** @description The kit a template should wear: only while the gallery's "Show in my brand" switch is on.
 * @returns {object|null} Validated kit or null. */
export function templateBrandKit() { return brand.kit && $('brandTemplates')?.checked ? brand.kit : null; }

/** @description Decoded logo keyed by its asset ID, for painting branded thumbnails.
 * @returns {Map<string,HTMLImageElement>} Empty without a decoded logo. */
export function brandImages() { return brand.kit?.logo && brand.logo ? new Map([[logoAssetId(brand.kit), brand.logo]]) : new Map(); }

function navigate(tool, query = '') {
  const embedded = (() => { try { return window.parent && window.parent !== window; } catch { return false; } })();
  if (embedded) window.parent.postMessage({ type: 'app-navigate', tool, ...(query ? { query } : {}) }, window.location.origin);
  else window.location.assign('/api/create/brand');
}

function decodeLogo(logo) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => (image.naturalWidth === logo.width && image.naturalHeight === logo.height ? resolve(image) : reject(new Error('Logo size changed')));
    image.onerror = () => reject(new Error('Logo unavailable')); image.src = logo.src;
  });
}

function swatches(kit) {
  return [...BRAND_ROLES.map(role => ({ label: BRAND_ROLE_LABELS[role], hex: kit.colors[role] })), ...kit.extras.map(extra => ({ label: extra.name, hex: extra.hex }))];
}

/** A swatch recolors the selected text, shape or drawing; with nothing selected it fills the canvas. */
function applySwatch(hex) {
  const layer = state.project.layers.find(item => item.id === state.selected);
  if (!layer) { edit({ type: 'project', patch: { background: hex } }); return; }
  if (layer.locked) throw new Error('Unlock this layer before editing it.');
  if (layer.type === 'image') throw new Error('Choose a text, shape or drawing layer to recolor.');
  edit({ type: 'update', id: layer.id, patch: layer.type === 'freehand' ? { stroke: hex } : { fill: hex } });
}

/** The logo is already an image the person owns: it joins the canvas as a layer with no new upload. */
function addLogo() {
  const kit = brand.kit, project = state.project;
  if (!kit?.logo) return;
  if (!canEdit()) throw new Error('Your role does not allow adding images.');
  const id = logoAssetId(kit), known = Object.hasOwn(project.images, id);
  if (project.layers.length >= LIMITS.layers || (!known && Object.keys(project.images).length >= LIMITS.images)) throw new Error('This project has reached its layer or image limit.');
  const scale = Math.min(project.width * 0.22 / kit.logo.width, project.height * 0.18 / kit.logo.height, 1);
  const w = kit.logo.width * scale, h = kit.logo.height * scale, margin = Math.round(Math.min(project.width, project.height) * 0.05);
  const layer = { id: crypto.randomUUID(), type: 'image', name: 'Brand logo', assetId: id, x: project.width - w - margin, y: margin, w, h };
  edit({ type: 'add', layer, ...(known ? {} : { images: { [id]: { ...kit.logo } } }) });
  state.selected = layer.id; notify();
}

function renderSwatches(kit) {
  const signature = JSON.stringify(kit);
  if (signature === brand.signature) return;
  brand.signature = signature;
  $('brandSwatches').replaceChildren(...swatches(kit).map(swatch => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.brandColor = swatch.hex;
    button.style.background = swatch.hex; button.title = `${swatch.label} · ${swatch.hex}`; button.setAttribute('aria-label', `Apply ${swatch.label} ${swatch.hex}`);
    button.onclick = handle(() => applySwatch(swatch.hex)); return button;
  }));
}

function renderPanel() {
  $('brandPanel').hidden = !brand.available;
  $('brandSetup').hidden = !brand.available || Boolean(brand.kit); $('brandTools').hidden = !brand.kit;
  if (!brand.kit) return;
  renderSwatches(brand.kit);
  for (const button of $('brandSwatches').children) button.disabled = !canEdit();
  $('addLogo').hidden = !brand.kit.logo; $('addLogo').disabled = !canEdit() || state.loading || state.saving;
}

function option(value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
function group(label, options) { const node = document.createElement('optgroup'); node.label = label; node.append(...options); return node; }

/** Brand faces first, then the basic families, then every Office face; a template's own face always has an entry. */
function renderFonts() {
  const select = $('fontFamily'), kit = brand.kit, current = select.value;
  const brandFaces = kit ? [...new Set([kit.fonts.heading, kit.fonts.body])] : [];
  const label = face => (kit && face === kit.fonts.heading ? `${face} · brand heading` : `${face} · brand body`);
  select.replaceChildren(
    ...(brandFaces.length ? [group('Your brand', brandFaces.map(face => option(face, label(face))))] : []),
    group('Basic', BASIC_FONTS.map(([value, text]) => option(value, text))),
    group('Office fonts', BRAND_FONTS.filter(face => !brandFaces.includes(face)).map(face => option(face, face))));
  select.value = current;
}

/** @description Read the kit once per editor visit. A person without brand access, or a failed read,
 * leaves the editor exactly as it was.
 * @returns {Promise<void>} Settles after the panel, fonts and gallery switch reflect the kit. */
export async function loadBrand() {
  try {
    const result = await api('/brand-kit');
    brand.available = true; brand.kit = result.kit ? validateBrandKit(result.kit) : null;
    if (brand.kit?.logo) brand.logo = await decodeLogo(brand.kit.logo).catch(() => null);
  } catch (failure) {
    brand.available = false; brand.kit = null;
    console.warn('[Create] The brand kit is unavailable here; editing continues without it.', failure?.status ?? '');
  }
  $('brandTemplateToggle').hidden = !brand.kit;
  renderPanel(); renderFonts();
}

/** @description Bind the brand panel once; it re-renders with every editor state change. */
export function bindBrand() {
  renderFonts();
  $('addLogo').onclick = handle(addLogo);
  $('editBrand').onclick = () => navigate('create-brand'); $('setupBrand').onclick = () => navigate('create-brand');
  subscribe(() => { if (brand.available) renderPanel(); });
}
