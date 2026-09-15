/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compose original editable starting designs without raster assets, network calls or shared mutable projects.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Declare each design's brand roles (color roles, a signature line and a logo slot) so a fresh copy can be dressed in the person's brand kit.
 */
import { validateProject } from './model.mjs';
import { brandProject, validateBrandKit } from './brand-kit.mjs';

function rect(name, x, y, w, h, fill) { return { type: 'rect', name, x, y, w, h, fill }; }
function ellipse(name, x, y, w, h, fill) { return { type: 'ellipse', name, x, y, w, h, fill }; }
function text(name, content, x, y, w, h, fontSize, fill, options = {}) {
  return { type: 'text', name, text: content, x, y, w, h, fontSize, fill, fontWeight: 400, ...options };
}

function announcement() {
  return [
    rect('New chapter label background', 76, 76, 284, 62, '#ef6b3b'),
    text('New chapter label', 'A NEW CHAPTER', 98, 91, 244, 42, 27, '#153d35', { fontWeight: 700 }),
    text('Announcement headline', 'Good things\nstart here.', 76, 205, 928, 272, 110, '#153d35', { fontWeight: 700 }),
    rect('Headline underline', 80, 521, 128, 9, '#ef6b3b'),
    ellipse('Large garden circle', 588, 602, 388, 388, '#153d35'),
    ellipse('Orange garden circle', 694, 618, 274, 274, '#ef6b3b'),
    ellipse('Cream garden circle', 760, 636, 176, 176, '#f8f3e8'),
    text('Announcement detail', 'Something worth sharing.\nMake this moment yours.', 80, 668, 480, 104, 32, '#153d35'),
    text('Brand signature', 'YOUR STUDIO / EST. TODAY', 80, 955, 488, 42, 23, '#153d35', { fontWeight: 700 }),
  ];
}

function story() {
  return [
    rect('Series marker', 84, 115, 10, 88, '#f8c9ce'),
    text('Story series', 'THE NEXT CHAPTER', 122, 132, 790, 62, 37, '#fff7e9', { fontWeight: 700 }),
    text('Story headline', 'Make\nroom for\nwonder.', 84, 338, 912, 548, 142, '#fff7e9', { fontWeight: 700 }),
    text('Story invitation', 'A fresh perspective.\nA little everyday possibility.', 90, 979, 890, 136, 41, '#f8c9ce'),
    ellipse('Rose horizon', 170, 1202, 740, 350, '#f8c9ce'),
    ellipse('Peach horizon', 280, 1254, 520, 244, '#f19a7c'),
    ellipse('Plum horizon', 390, 1303, 300, 142, '#321942'),
    rect('Call to action background', 84, 1650, 912, 128, '#fff7e9'),
    text('Call to action', 'EXPLORE WHAT IS NEXT', 124, 1684, 832, 64, 39, '#321942', { align: 'center', fontWeight: 700 }),
    text('Story signature', 'YOUR NAME / YOUR STORY', 90, 1830, 900, 47, 26, '#f8c9ce', { align: 'center' }),
  ];
}

function presentation() {
  return [
    rect('Presentation accent', 120, 116, 64, 14, '#d9f56f'),
    text('Presentation category', 'A NEW PERSPECTIVE', 214, 95, 940, 68, 34, '#d9f56f', { fontWeight: 700 }),
    text('Presentation title', 'Ideas into\nwhat’s next.', 120, 286, 1200, 360, 136, '#f5f2e8', { fontWeight: 700 }),
    text('Presentation subtitle', 'A clear vision. A meaningful next step.', 128, 735, 1190, 92, 40, '#f5f2e8'),
    rect('Short step', 1450, 598, 108, 206, '#688ba2'),
    rect('Middle step', 1578, 422, 108, 382, '#99b9b0'),
    rect('Tall step', 1706, 224, 108, 580, '#d9f56f'),
    rect('Presentation footer rule', 120, 918, 1694, 2, '#688ba2'),
    text('Presenter name', 'PRESENTED BY YOUR NAME', 120, 956, 1350, 57, 27, '#f5f2e8'),
    text('Slide number', '01', 1706, 946, 108, 67, 37, '#d9f56f', { align: 'right' }),
  ];
}

function thumbnail() {
  return [
    rect('Video category background', 64, 54, 268, 51, '#18283f'),
    text('Video category', 'THE CREATIVE GUIDE', 79, 65, 238, 35, 22, '#f6d94b', { fontWeight: 700 }),
    text('Video headline', 'MAKE IT\nHAPPEN', 60, 192, 734, 236, 96, '#18283f', { fontWeight: 900 }),
    rect('Headline highlight', 65, 462, 580, 14, '#18283f'),
    ellipse('Episode circle', 820, 165, 388, 388, '#f87959'),
    text('Episode number', '01', 862, 252, 304, 176, 142, '#18283f', { fontWeight: 700, align: 'center' }),
    text('Episode caption', 'START HERE', 872, 451, 284, 51, 26, '#18283f', { fontWeight: 700, align: 'center' }),
    text('Video supporting line', 'Small steps. Real progress.', 66, 556, 732, 67, 35, '#18283f'),
    rect('Video footer', 0, 670, 1280, 50, '#18283f'),
    text('Video signature', 'YOUR CHANNEL', 66, 682, 1080, 34, 21, '#f6d94b', { fontWeight: 700 }),
  ];
}

function event() {
  return [
    rect('Event top panel', 0, 0, 1080, 139, '#262334'),
    text('Event category', 'A CREATIVE MEETUP', 78, 47, 924, 68, 35, '#fff1d7', { fontWeight: 700 }),
    text('Event title', 'Design\nafter\nhours.', 74, 210, 902, 414, 112, '#fff1d7', { fontFamily: 'Georgia', fontWeight: 700 }),
    ellipse('Event gold circle', 824, 646, 170, 170, '#f4c76b'),
    ellipse('Event red center', 872, 694, 74, 74, '#bf3c2b'),
    text('Event invitation', 'Good conversations.\nFresh connections.', 82, 730, 706, 122, 38, '#fff1d7'),
    rect('Event information panel', 58, 958, 964, 334, '#fff1d7'),
    text('Event time', 'FRIDAY / 6 PM', 98, 1006, 844, 86, 51, '#262334', { fontWeight: 700 }),
    text('Event place', 'YOUR FAVORITE PLACE', 101, 1113, 838, 65, 31, '#262334', { fontWeight: 700 }),
    text('Event details', 'Add your date, location and RSVP details.', 101, 1206, 838, 52, 26, '#262334'),
  ];
}

function quote() {
  return [
    rect('Quote outer rule', 66, 66, 948, 5, '#6a59a6'),
    text('Quote category', 'A THOUGHT TO KEEP', 80, 113, 920, 58, 28, '#30345c', { fontWeight: 700 }),
    text('Opening quotation mark', '“', 72, 222, 230, 216, 176, '#6a59a6', { fontFamily: 'Georgia' }),
    text('Quote words', 'A small idea,\ngiven care,\ncan grow.', 90, 426, 906, 318, 79, '#30345c', { fontFamily: 'Georgia' }),
    rect('Author accent', 94, 820, 74, 5, '#6a59a6'),
    text('Quote attribution', 'YOUR NAME', 199, 804, 744, 67, 30, '#30345c', { fontWeight: 700 }),
    ellipse('Quote lower dot', 894, 929, 54, 54, '#6a59a6'),
    ellipse('Quote upper dot', 958, 899, 30, 30, '#30345c'),
    text('Quote signature', 'WORDS FOR THE EVERYDAY', 90, 962, 740, 46, 22, '#30345c'),
  ];
}

function product() {
  return [
    text('Product brand', 'FORM / OBJECTS', 72, 75, 914, 70, 35, '#163f3c', { fontWeight: 700 }),
    rect('Brand divider', 72, 170, 936, 3, '#163f3c'),
    text('Product headline', 'Made for\nevery day.', 72, 279, 530, 242, 77, '#163f3c', { fontWeight: 700 }),
    text('Product description', 'Simple shapes.\nThoughtful details.', 78, 589, 476, 100, 30, '#163f3c'),
    ellipse('Object shadow', 598, 694, 364, 70, '#b2c8bc'),
    ellipse('Cup handle outer', 825, 366, 138, 178, '#163f3c'),
    ellipse('Cup handle opening', 860, 401, 68, 108, '#e0ece6'),
    rect('Cup body', 626, 335, 256, 322, '#faf8f0'),
    ellipse('Cup rounded base', 626, 601, 256, 110, '#faf8f0'),
    ellipse('Cup rim', 626, 293, 256, 98, '#163f3c'),
    ellipse('Cup interior', 652, 312, 204, 60, '#b2c8bc'),
    rect('Product information panel', 0, 873, 1080, 207, '#163f3c'),
    text('Product name', 'YOUR EVERYDAY FAVORITE', 77, 915, 926, 65, 37, '#faf8f0', { fontWeight: 700 }),
    text('Product information', 'Add your product name and details.', 79, 1007, 922, 49, 27, '#faf8f0'),
  ];
}

function banner() {
  return [
    text('Profile category', 'DESIGN / IDEAS / EVERYDAY', 84, 64, 1030, 56, 26, '#fff4e4', { fontWeight: 700 }),
    text('Profile introduction', 'Hello, I’m Alex.', 79, 176, 1052, 124, 88, '#fff4e4', { fontWeight: 700 }),
    text('Profile description', 'Designer · maker · curious mind', 87, 337, 1014, 64, 33, '#fff4e4'),
    ellipse('Profile blue disc', 1175, 114, 264, 264, '#8cb4fa'),
    ellipse('Profile cream disc', 1207, 146, 200, 200, '#fff4e4'),
    ellipse('Profile orange disc', 1256, 195, 102, 102, '#e77746'),
    rect('Profile footer accent', 84, 447, 1031, 7, '#e77746'),
  ];
}

const upper = name => name.toUpperCase();

const DESIGNS = [
  { id: 'square-announcement', name: 'A new chapter', description: 'A warm square announcement with bold type and nested garden circles.', category: 'Social',
    width: 1080, height: 1080, background: '#f8f3e8', layers: announcement,
    brand: { palette: { '#f8f3e8': 'light', '#153d35': 'dark', '#ef6b3b': 'accent' }, roles: { 'Large garden circle': 'primary' },
      signature: { layer: 'Brand signature', text: upper }, logo: { x: 820, y: 70, w: 190, h: 90, align: 'right' } } },
  { id: 'story-promo', name: 'Room for wonder', description: 'A tall story with generous type, a rose horizon and a clear invitation.', category: 'Social',
    width: 1080, height: 1920, background: '#321942', layers: story,
    brand: { palette: { '#321942': 'dark', '#fff7e9': 'light', '#f8c9ce': 'secondary', '#f19a7c': 'accent' }, roles: { 'Rose horizon': 'primary' },
      signature: { layer: 'Story signature', text: upper }, logo: { x: 84, y: 26, w: 220, h: 72, align: 'left' } } },
  { id: 'presentation-title', name: 'Ideas into next', description: 'A wide navy presentation title with lime steps and a presenter line.', category: 'Presentation',
    width: 1920, height: 1080, background: '#101d36', layers: presentation,
    brand: { palette: { '#101d36': 'dark', '#f5f2e8': 'light', '#d9f56f': 'accent', '#688ba2': 'secondary', '#99b9b0': 'primary' },
      signature: { layer: 'Presenter name', text: name => `PRESENTED BY ${upper(name)}` }, logo: { x: 1560, y: 90, w: 254, h: 96, align: 'right' } } },
  { id: 'video-thumbnail', name: 'Make it happen', description: 'A bright video cover with a bold headline and editable episode badge.', category: 'Video',
    width: 1280, height: 720, background: '#f6d94b', layers: thumbnail,
    brand: { palette: { '#f6d94b': 'primary', '#18283f': 'dark', '#f87959': 'accent' },
      signature: { layer: 'Video signature', text: upper }, logo: { x: 1040, y: 36, w: 200, h: 90, align: 'right' } } },
  { id: 'event-flyer', name: 'Design after hours', description: 'A terracotta event poster with serif type and a cream details panel.', category: 'Print',
    width: 1080, height: 1350, background: '#bf3c2b', layers: event,
    brand: { palette: { '#bf3c2b': 'primary', '#262334': 'dark', '#fff1d7': 'light', '#f4c76b': 'accent' },
      logo: { x: 850, y: 28, w: 180, h: 84, align: 'right' } } },
  { id: 'quote-card', name: 'A thought to keep', description: 'A lavender quote card with editorial typography and room for an author.', category: 'Social',
    width: 1080, height: 1080, background: '#e9eaf8', layers: quote,
    brand: { palette: { '#e9eaf8': 'light', '#30345c': 'dark', '#6a59a6': 'primary' },
      signature: { layer: 'Quote signature', text: upper }, logo: { x: 830, y: 96, w: 180, h: 86, align: 'right' } } },
  { id: 'product-card', name: 'Everyday objects', description: 'A mint product card with an editable geometric cup and product details.', category: 'Brand',
    width: 1080, height: 1080, background: '#e0ece6', layers: product,
    brand: { palette: { '#e0ece6': 'light', '#163f3c': 'dark', '#b2c8bc': 'secondary', '#faf8f0': 'accent' },
      roles: { 'Cup rim': 'primary', 'Cup handle outer': 'primary', 'Product name': 'light', 'Product information': 'light' },
      signature: { layer: 'Product brand', text: upper }, logo: { x: 830, y: 60, w: 178, h: 92, align: 'right' } } },
  { id: 'profile-banner', name: 'Hello, creative', description: 'A cobalt profile banner with a personal introduction and a circular accent.', category: 'Brand',
    width: 1500, height: 500, background: '#2045a2', layers: banner,
    brand: { palette: { '#2045a2': 'primary', '#fff4e4': 'light', '#8cb4fa': 'secondary', '#e77746': 'accent' },
      logo: { x: 1150, y: 398, w: 250, h: 76, align: 'right' } } },
];
const BY_ID = new Map(DESIGNS.map(design => [design.id, design]));

/** @description Share immutable display metadata without exposing reusable layer objects.
 * @returns {ReadonlyArray<object>} Original template identities, descriptions, categories and canvas dimensions. */
export const TEMPLATES = Object.freeze(DESIGNS.map(({ id, name, description, category, width, height }) =>
  Object.freeze({ id, name, description, category, width, height })));

/** @description Start a fresh editable design; exact catalog admission never evaluates or coerces untrusted IDs.
 * @param {string} id Exact identity from TEMPLATES.
 * @returns {object} Independent validated v1 project with new UUID layers and no image assets. */
export function createTemplate(id) {
  if (typeof id !== 'string' || !BY_ID.has(id)) throw new TypeError('Choose an available image template');
  const design = BY_ID.get(id);
  return validateProject({ version: 1, name: design.name, width: design.width, height: design.height,
    background: design.background, images: {}, layers: design.layers().map(layer => ({ ...layer, id: globalThis.crypto.randomUUID() })) });
}

/** @description Start a fresh editable design dressed in a brand kit: the template's color roles
 * take the brand's colors, bold text the heading face and the rest the body face, the signature
 * line carries the brand name and the logo (when the kit has one) fills the design's logo slot.
 * @param {string} id Exact identity from TEMPLATES.
 * @param {object} kit Candidate brand kit; validated here.
 * @returns {object} Independent validated v1 project. */
export function createBrandedTemplate(id, kit) {
  const project = createTemplate(id);
  return validateProject(brandProject(project, BY_ID.get(id).brand, validateBrandKit(kit)));
}
