/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | One personal brand kit for every Create surface: bounded role colors, Office-safe fonts and an owned logo reference, plus readable-color, naming and template-branding helpers shared by the browser and the server validator.
 */

/** @description The five colors every kit carries, in display order. Named roles (not a loose
 * swatch list) are what let a template or another studio apply the brand without guessing. */
export const BRAND_ROLES = Object.freeze(['primary', 'secondary', 'accent', 'dark', 'light']);

/** @description People-facing names for the roles. */
export const BRAND_ROLE_LABELS = Object.freeze({ primary: 'Primary', secondary: 'Secondary', accent: 'Accent', dark: 'Text', light: 'Background' });

/** @description What each role is used for, shown beside its swatch. */
export const BRAND_ROLE_HINTS = Object.freeze({
  primary: 'Headlines, buttons and the shapes people remember.',
  secondary: 'Supporting shapes, panels and highlights.',
  accent: 'Small pops of contrast such as badges, rules and calls to action.',
  dark: 'Body text and dark backgrounds.',
  light: 'Pages, canvases and light backgrounds.',
});

/** @description Faces that ship with Microsoft Office on both Windows and macOS: the same set AI
 * Office renders with, so a brand opens identically in a design, a deck and a document. */
export const BRAND_FONTS = Object.freeze(['Arial', 'Calibri', 'Cambria', 'Candara', 'Century Gothic', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Garamond', 'Georgia', 'Trebuchet MS']);

/** @description Ready-made heading and body pairings offered on the Brand Kit page. */
export const FONT_PAIRINGS = Object.freeze([
  { id: 'modern', name: 'Modern', heading: 'Century Gothic', body: 'Calibri' },
  { id: 'classic', name: 'Classic', heading: 'Georgia', body: 'Garamond' },
  { id: 'clean', name: 'Clean', heading: 'Arial', body: 'Arial' },
  { id: 'friendly', name: 'Friendly', heading: 'Trebuchet MS', body: 'Candara' },
  { id: 'editorial', name: 'Editorial', heading: 'Constantia', body: 'Corbel' },
]);

/** @description Size ceilings shared by the page, the editor and the server. */
export const BRAND_LIMITS = Object.freeze({ name: 80, voice: 280, extras: 6, swatchName: 40, bytes: 8192, logoDimension: 8192 });

const LOGO_SRC = /^\/api\/create\/project-assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const ONE_LINE = /[\u0000-\u001f\u007f]/;

function fail(message) { throw new TypeError(message); }

function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be an object`);
  if (Object.keys(value).some(key => !keys.includes(key))) fail(`${label} has an unsupported field`);
}

function hex(value, label) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(`${label} must be a six-digit hex color`);
  return value.toLowerCase();
}

function line(value, maximum, label) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum || ONE_LINE.test(value)) fail(`${label} must be one line of at most ${maximum} characters`);
  return value.trim();
}

function face(value, label) {
  if (!BRAND_FONTS.includes(value)) fail(`${label} must be one of the supported fonts`);
  return value;
}

function roleColors(value) {
  record(value, BRAND_ROLES, 'Brand colors');
  return Object.fromEntries(BRAND_ROLES.map(role => [role, hex(value[role], `${BRAND_ROLE_LABELS[role]} color`)]));
}

function extraColors(value = []) {
  if (!Array.isArray(value) || value.length > BRAND_LIMITS.extras) fail(`Add at most ${BRAND_LIMITS.extras} extra colors`);
  return value.map((item, index) => {
    record(item, ['name', 'hex'], `Extra color ${index + 1}`);
    return { name: line(item.name, BRAND_LIMITS.swatchName, 'Color name') || `Color ${index + 1}`, hex: hex(item.hex, `Extra color ${index + 1}`) };
  });
}

function logoReference(value) {
  if (value === null || value === undefined) return null;
  record(value, ['src', 'width', 'height'], 'Logo');
  if (typeof value.src !== 'string' || !LOGO_SRC.test(value.src)) fail('Upload the logo before saving the brand kit');
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > BRAND_LIMITS.logoDimension) fail('Logo dimensions are out of range');
  }
  return { src: value.src, width: value.width, height: value.height };
}

/** @description A starting kit in the Create look, offered before a person saves their own.
 * @returns {object} A valid, unsaved v1 brand kit. */
export function defaultBrandKit() {
  return { version: 1, name: '', colors: { primary: '#7d2ae8', secondary: '#00c4cc', accent: '#ff7a59', dark: '#1d1733', light: '#ffffff' },
    extras: [], fonts: { heading: 'Century Gothic', body: 'Calibri' }, voice: '', logo: null };
}

/** @description Validate and copy a complete v1 kit. The browser and the server run this same
 * function, so a kit the page accepts is exactly a kit the server stores.
 * @param {unknown} value Candidate kit.
 * @returns {object} Independent normalized kit; invalid input throws a readable TypeError. */
export function validateBrandKit(value) {
  record(value, ['version', 'name', 'colors', 'extras', 'fonts', 'voice', 'logo'], 'Brand kit');
  if (value.version !== 1) fail('Unsupported brand kit version');
  record(value.fonts, ['heading', 'body'], 'Brand fonts');
  const kit = { version: 1, name: line(value.name, BRAND_LIMITS.name, 'Brand name'), colors: roleColors(value.colors),
    extras: extraColors(value.extras), fonts: { heading: face(value.fonts.heading, 'Heading font'), body: face(value.fonts.body, 'Body font') },
    voice: line(value.voice, BRAND_LIMITS.voice, 'Brand voice'), logo: logoReference(value.logo) };
  if (new TextEncoder().encode(JSON.stringify(kit)).length > BRAND_LIMITS.bytes) fail('Brand kit is too large');
  return kit;
}

/** @description The owned image asset a kit's logo points at.
 * @param {object} kit Validated kit.
 * @returns {string|null} Asset UUID, or null without a logo. */
export function logoAssetId(kit) { return kit.logo ? LOGO_SRC.exec(kit.logo.src)[1] : null; }

/** @description Split a hex color into 0-255 channels.
 * @param {string} value Six-digit hex color.
 * @returns {number[]} [red, green, blue]. */
export function rgb(value) {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }

/** @description WCAG relative luminance.
 * @param {string} value Six-digit hex color.
 * @returns {number} 0 (black) to 1 (white). */
export function luminance(value) {
  const [r, g, b] = rgb(value).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @description WCAG contrast ratio between two colors.
 * @param {string} a Six-digit hex color.
 * @param {string} b Six-digit hex color.
 * @returns {number} 1 to 21. */
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** @description The brand's own text or background color that reads on a surface, falling back
 * to black or white only when neither brand color reaches 4.5:1.
 * @param {string} background Six-digit hex color behind the text.
 * @param {object} kit Validated kit.
 * @returns {string} Six-digit hex color. */
export function readableOn(background, kit) {
  const best = options => [...options].sort((p, q) => contrast(q, background) - contrast(p, background))[0];
  const brand = best([kit.colors.dark, kit.colors.light]);
  return contrast(brand, background) >= 4.5 ? brand : best([brand, '#000000', '#ffffff']);
}

/** @description Hue (degrees), saturation and lightness (0-1).
 * @param {string} value Six-digit hex color.
 * @returns {number[]} [hue, saturation, lightness]. */
export function hsl(value) {
  const [r, g, b] = rgb(value).map(c => c / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const HUES = [[12, 'red'], [35, 'orange'], [45, 'amber'], [65, 'yellow'], [85, 'lime'], [150, 'green'], [175, 'teal'],
  [195, 'cyan'], [215, 'sky blue'], [245, 'blue'], [265, 'indigo'], [290, 'violet'], [320, 'purple'], [345, 'pink'], [361, 'red']];

function neutralName(l) { return l < 0.12 ? 'black' : l < 0.3 ? 'charcoal' : l < 0.55 ? 'gray' : l < 0.85 ? 'light gray' : 'white'; }

/** @description A plain-language color name, for prompts to studios that describe images in
 * words (a generator does not reliably read hex codes).
 * @param {string} value Six-digit hex color.
 * @returns {string} For example "deep indigo" or "bright teal". */
export function colorName(value) {
  const [h, s, l] = hsl(value);
  if (s < 0.12 || l < 0.06 || l > 0.96) return neutralName(l);
  let hue = HUES.find(([limit]) => h < limit)[1];
  if (hue === 'orange' && l < 0.35) hue = 'brown';
  if ((hue === 'amber' || hue === 'yellow') && l > 0.85) hue = 'cream';
  if ((h >= 5 && h < 25) && l >= 0.55 && l <= 0.8 && s > 0.6) hue = 'coral';
  const tone = l < 0.3 ? 'deep ' : l > 0.8 ? 'pale ' : s < 0.35 ? 'muted ' : s > 0.75 && l >= 0.4 && l <= 0.65 ? 'bright ' : '';
  return ['brown', 'cream', 'coral'].includes(hue) ? hue : tone + hue;
}

/** @description The brand's colors as one phrase, for example "bright violet, bright cyan and coral".
 * @param {object} kit Validated kit.
 * @param {string[]} roles Roles to name, in order.
 * @returns {string} Distinct names joined in plain English. */
export function palettePhrase(kit, roles = ['primary', 'secondary', 'accent']) {
  const names = [...new Set(roles.map(role => colorName(kit.colors[role])))];
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** @description Words a studio can use without re-deriving anything: each role's color name and
 * the primary palette phrase.
 * @param {object} kit Validated kit.
 * @returns {{phrase:string, colors:object}} Plain-language description. */
export function describeBrandKit(kit) {
  return { phrase: palettePhrase(kit), colors: Object.fromEntries(BRAND_ROLES.map(role => [role, colorName(kit.colors[role])])) };
}

function contains(layer, x, y) {
  if (!layer.visible || !['rect', 'ellipse'].includes(layer.type) || layer.fill === 'transparent') return false;
  if (layer.type === 'rect') return x >= layer.x && x <= layer.x + layer.w && y >= layer.y && y <= layer.y + layer.h;
  const rx = layer.w / 2, ry = layer.h / 2, dx = (x - layer.x - rx) / rx, dy = (y - layer.y - ry) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Keep text readable against whatever it actually sits on after the colors change. */
function readableText(layer, below, background, kit) {
  const x = layer.x + layer.w / 2, y = layer.y + Math.min(layer.h, layer.fontSize) / 2;
  const surface = [...below].reverse().find(item => contains(item, x, y))?.fill ?? background;
  const behind = /^#[0-9a-f]{6}$/.test(surface) ? surface : kit.colors.light;
  return contrast(layer.fill, behind) >= 3 ? layer : { ...layer, fill: readableOn(behind, kit) };
}

function fitLogo(slot, logo) {
  const scale = Math.min(slot.w / logo.width, slot.h / logo.height), w = logo.width * scale, h = logo.height * scale;
  const x = slot.align === 'right' ? slot.x + slot.w - w : slot.align === 'center' ? slot.x + (slot.w - w) / 2 : slot.x;
  return { x, y: slot.y + (slot.h - h) / 2, w, h };
}

/** @description Dress a fresh template in a brand: every declared template color becomes its role's
 * brand color, bold text takes the heading face and the rest the body face, text that would lose
 * contrast is re-inked, the signature line carries the brand name and the logo fills its slot.
 * @param {object} project Fresh validated template project.
 * @param {{palette:object, roles?:object, signature?:object, logo?:object}} design The template's
 * brand roles: `palette` maps each template hex to a role, `roles` overrides one named layer's fill.
 * @param {object} kit Validated kit.
 * @returns {object} New project object (the caller validates it). */
export function brandProject(project, design, kit) {
  const map = value => (design.palette[value] ? kit.colors[design.palette[value]] : value);
  const background = project.background === 'transparent' ? 'transparent' : map(project.background);
  const recolored = project.layers.map(layer => {
    const next = { ...layer }, role = design.roles?.[layer.name];
    if (next.fill) next.fill = role ? kit.colors[role] : map(next.fill);
    if (next.stroke) next.stroke = map(next.stroke);
    if (next.type === 'text') next.fontFamily = next.fontWeight >= 700 ? kit.fonts.heading : kit.fonts.body;
    return next;
  });
  const layers = recolored.map((layer, index) => (layer.type === 'text' ? readableText(layer, recolored.slice(0, index), background, kit) : layer));
  if (kit.name && design.signature) {
    const target = layers.findIndex(layer => layer.name === design.signature.layer);
    if (target >= 0) layers[target] = { ...layers[target], text: design.signature.text(kit.name) };
  }
  const images = { ...project.images };
  if (kit.logo && design.logo) {
    const id = logoAssetId(kit);
    images[id] = { ...kit.logo };
    layers.push({ id: globalThis.crypto.randomUUID(), type: 'image', name: 'Brand logo', assetId: id, ...fitLogo(design.logo, kit.logo) });
  }
  return { ...project, background, layers, images };
}
