/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exchange a bounded inert SVG subset while preserving cubic nodes, paint, transforms and explicit unsupported-feature refusals.
 */
import { validateProject, demand } from './model-validation.mjs';
import { parentGroup } from './group-geometry.mjs';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const decimal = value => Number(value.toFixed(6));
const fields = ['id', 'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'transform', 'clip-path'];

function pathData(layer) {
  return layer.contours.map(contour => {
    const nodes = contour.nodes, first = nodes[0]; let data = `M ${decimal(first.x * layer.w)} ${decimal(first.y * layer.h)}`;
    const count = contour.closed ? nodes.length : nodes.length - 1;
    for (let index = 0; index < count; index++) {
      const a = nodes[index], b = nodes[(index + 1) % nodes.length];
      data += ` C ${decimal((a.x + a.out.x) * layer.w)} ${decimal((a.y + a.out.y) * layer.h)} ${decimal((b.x + b.in.x) * layer.w)} ${decimal((b.y + b.in.y) * layer.h)} ${decimal(b.x * layer.w)} ${decimal(b.y * layer.h)}`;
    }
    return data + (contour.closed ? ' Z' : '');
  }).join(' ');
}

function transform(layer) { return `translate(${decimal(layer.x + layer.w / 2)} ${decimal(layer.y + layer.h / 2)}) rotate(${decimal(layer.rotation)}) translate(${decimal(-layer.w / 2)} ${decimal(-layer.h / 2)})`; }

function svgText(layer, definitions) {
  const canvas = globalThis.document?.createElement('canvas'), ctx = canvas?.getContext('2d');
  demand(ctx, 'SVG text export requires browser font metrics'); ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
  const lines = [];
  for (const paragraph of layer.text.split('\n')) {
    let line = ''; for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > layer.w) { lines.push(line); line = word; } else line = next;
    } lines.push(line);
  }
  const id = `text-clip-${definitions.length}`;
  definitions.push(`<clipPath id="${id}"><rect width="${layer.w}" height="${layer.h}"/></clipPath>`);
  const metadata = encodeURIComponent(JSON.stringify({ text: layer.text, w: layer.w, h: layer.h, fontFamily: layer.fontFamily,
    fontSize: layer.fontSize, fontWeight: layer.fontWeight, fill: layer.fill, align: layer.align }));
  const x = layer.align === 'center' ? layer.w / 2 : layer.align === 'right' ? layer.w : 0;
  const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
  const tspans = lines.map((line, index) => `<tspan x="${x}" y="${index * layer.fontSize * 1.2}"${ctx.measureText(line).width > layer.w ? ` textLength="${layer.w}" lengthAdjust="spacingAndGlyphs"` : ''}>${escape(line)}</tspan>`).join('');
  return `<text transform="${transform(layer)}" opacity="${layer.opacity}" fill="${escape(layer.fill)}" font-family="${escape(layer.fontFamily)}" font-size="${layer.fontSize}" font-weight="${layer.fontWeight}" text-anchor="${anchor}" dominant-baseline="text-before-edge" clip-path="url(#${id})" data-oshal-text="${escape(metadata)}">${tspans}</text>`;
}

function svgLayer(layer, project, definitions) {
  if (!layer.visible) return '';
  demand(!['image', 'adjustment'].includes(layer.type), 'SVG export cannot retain raster masks or adjustment layers. Use PNG or native JSON.');
  if (layer.type === 'group') {
    const id = `group-frame-${definitions.length}`;
    definitions.push(`<clipPath id="${id}"><rect width="${layer.baseWidth}" height="${layer.baseHeight}"/></clipPath>`);
    return `<g opacity="${layer.opacity}" transform="${transform(layer)} scale(${layer.w / layer.baseWidth})"><g clip-path="url(#${id})">${layer.children.map(id => svgLayer(project.layers.find(item => item.id === id), project, definitions)).join('')}</g></g>`;
  }
  if (layer.type === 'text') return svgText(layer, definitions);
  let fill = layer.fill ?? 'transparent', clipping = '';
  if (layer.gradient) {
    const id = `gradient-${definitions.length}`;
    definitions.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${layer.gradient.from.x * layer.w}" y1="${layer.gradient.from.y * layer.h}" x2="${layer.gradient.to.x * layer.w}" y2="${layer.gradient.to.y * layer.h}">${layer.gradient.stops.map(stop => `<stop offset="${stop.offset}" stop-color="${escape(stop.color)}"/>`).join('')}</linearGradient>`); fill = `url(#${id})`;
  }
  if (layer.clip) {
    const id = `clip-${definitions.length}`;
    definitions.push(`<clipPath id="${id}"><polygon points="${layer.clip.map(point => `${point.x * layer.w},${point.y * layer.h}`).join(' ')}"/></clipPath>`); clipping = ` clip-path="url(#${id})"`;
  }
  const attributes = `fill="${escape(fill)}" stroke="${escape(layer.stroke ?? 'transparent')}" stroke-width="${layer.strokeWidth ?? 0}" opacity="${layer.opacity}" transform="${transform(layer)}"${clipping}`;
  if (layer.type === 'path') return `<path ${attributes} d="${pathData(layer)}" fill-rule="${layer.fillRule}" stroke-linecap="${layer.cap}" stroke-linejoin="${layer.join}" stroke-dasharray="${layer.dash.join(',')}"/>`;
  if (layer.type === 'rect') return `<rect ${attributes} width="${layer.w}" height="${layer.h}"/>`;
  if (layer.type === 'ellipse') return `<ellipse ${attributes} cx="${layer.w / 2}" cy="${layer.h / 2}" rx="${layer.w / 2}" ry="${layer.h / 2}"/>`;
  if (layer.type === 'freehand') return `<polyline ${attributes.replace(/fill="[^"]*"/, 'fill="none"')} points="${layer.points.map(point => `${point.x * layer.w},${point.y * layer.h}`).join(' ')}" stroke-linecap="round" stroke-linejoin="round"/>`;
  throw new Error('Unsupported SVG layer');
}

/** @description Export editable vector geometry with local gradient/clip definitions and no external resource references.
 * @param {object} project Native document containing supported vector/shape/group layers.
 * @returns {string} Standalone SVG; unsupported layers refuse rather than flatten silently. */
export function exportVectorSvg(project) {
  const current = validateProject(project), definitions = [];
  const body = current.layers.filter(layer => !parentGroup(current, layer.id)).map(layer => svgLayer(layer, current, definitions)).join('');
  const background = current.background === 'transparent' ? '' : `<rect width="${current.width}" height="${current.height}" fill="${escape(current.background)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${current.width}" height="${current.height}" viewBox="0 0 ${current.width} ${current.height}"><defs>${definitions.join('')}</defs>${background}${body}</svg>`;
}

function scalar(value, fallback) {
  if (value == null) return fallback;
  demand(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(value.trim()), 'SVG lengths must be finite pixels');
  const result = Number(value.replace(/px$/, '')); demand(Number.isFinite(result) && Math.abs(result) <= 65536, 'SVG coordinate is out of range'); return result;
}
const numbers = value => { const result = value.trim().split(/[\s,]+/).filter(Boolean).map(value => scalar(value)); demand(result.length <= 20000, 'SVG geometry is too large'); return result; };
const identity = [1, 0, 0, 1, 0, 0];
function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function mapped(matrix, point) { return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] }; }

function matrix(value = '') {
  const matches = [...value.matchAll(/(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g)];
  demand(value.replace(/(matrix|translate|scale|rotate)\s*\([^)]*\)/g, '').trim() === '', 'Unsupported SVG transform');
  let result = identity;
  for (const match of matches) {
    const values = numbers(match[2]); let part;
    if (match[1] === 'matrix') { demand(values.length === 6, 'SVG matrix needs six values'); part = values; }
    if (match[1] === 'translate') { demand(values.length >= 1 && values.length <= 2, 'SVG translate needs one or two values'); part = [1, 0, 0, 1, values[0], values[1] ?? 0]; }
    if (match[1] === 'scale') { demand(values.length >= 1 && values.length <= 2 && values.every(value => value !== 0), 'SVG scale must be nonzero'); part = [values[0], 0, 0, values[1] ?? values[0], 0, 0]; }
    if (match[1] === 'rotate') {
      demand(values.length === 1 || values.length === 3, 'SVG rotate needs an angle and optional center');
      const angle = values[0] * Math.PI / 180, rotation = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
      part = values.length === 3 ? multiply(multiply([1, 0, 0, 1, values[1], values[2]], rotation), [1, 0, 0, 1, -values[1], -values[2]]) : rotation;
    }
    result = multiply(result, part);
  }
  return result;
}

function attributes(element, extra = []) {
  for (const attribute of element.attributes) demand([...fields, ...extra].includes(attribute.name), `Unsupported SVG attribute: ${attribute.name}`);
  demand(!element.getAttribute('fill-opacity') || element.getAttribute('fill-opacity') === '1', 'Separate SVG fill opacity is not supported');
  demand(!element.getAttribute('stroke-opacity') || element.getAttribute('stroke-opacity') === '1', 'Separate SVG stroke opacity is not supported');
}
function color(value, fallback = '#000000') {
  if (value == null) return fallback;
  const named = { none: 'transparent', transparent: 'transparent', black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000' };
  return named[value] ?? value;
}
function style(element, inherited = {}) {
  const get = (name, fallback) => element.getAttribute(name) ?? inherited[name] ?? fallback;
  return { ...inherited, fill: get('fill', '#000000'), stroke: get('stroke', 'transparent'),
    'stroke-width': get('stroke-width', '0'), 'fill-rule': get('fill-rule', 'nonzero'), 'stroke-linecap': get('stroke-linecap', 'butt'),
    'stroke-linejoin': get('stroke-linejoin', 'miter'), 'stroke-dasharray': get('stroke-dasharray', '') };
}

function parsedPath(value) {
  const tokenPattern = /[MmLlCcZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g;
  demand(value.replace(tokenPattern, '').replace(/[\s,]/g, '') === '', 'SVG path supports M, L, C and Z only');
  const tokens = value.match(tokenPattern) ?? []; demand(tokens.length <= 20000, 'SVG path is too large');
  let cursor = 0, command, current = { x: 0, y: 0 }, contour; const contours = [];
  const read = () => { demand(cursor < tokens.length && !/^[a-z]$/i.test(tokens[cursor]), 'Incomplete SVG path'); return scalar(tokens[cursor++]); };
  const pair = relative => { const x = read(), y = read(); return { x: x + (relative ? current.x : 0), y: y + (relative ? current.y : 0) }; };
  while (cursor < tokens.length) {
    if (/^[a-z]$/i.test(tokens[cursor])) command = tokens[cursor++];
    demand(command, 'SVG path must start with a move'); const relative = command === command.toLowerCase();
    if (command.toUpperCase() === 'Z') { demand(contour, 'Close needs a contour'); contour.closed = true;
      const first = contour.nodes[0], last = contour.nodes.at(-1);
      if (contour.nodes.length > 2 && first.x === last.x && first.y === last.y) { first.in = last.in; contour.nodes.pop(); }
      current = { ...contour.nodes[0] }; command = undefined; continue; }
    if (command.toUpperCase() === 'M') { current = pair(relative); contour = { closed: false, nodes: [{ ...current, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }] }; contours.push(contour); command = relative ? 'l' : 'L'; continue; }
    demand(contour, 'SVG path needs an initial move');
    if (command.toUpperCase() === 'L') { current = pair(relative); contour.nodes.push({ ...current, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }); continue; }
    const first = pair(relative), second = pair(relative), end = pair(relative), previous = contour.nodes.at(-1);
    previous.out = { x: first.x - previous.x, y: first.y - previous.y };
    current = end; contour.nodes.push({ ...end, in: { x: second.x - end.x, y: second.y - end.y }, out: { x: 0, y: 0 } });
  }
  return contours;
}

function shapeContours(element) {
  const get = (name, fallback = 0) => scalar(element.getAttribute(name), fallback), tag = element.localName;
  if (tag === 'path') return parsedPath(element.getAttribute('d') ?? '');
  if (tag === 'polygon' || tag === 'polyline') {
    const points = numbers(element.getAttribute('points') ?? ''); demand(points.length % 2 === 0, 'SVG point coordinates must be paired');
    return [{ closed: tag === 'polygon', nodes: Array.from({ length: points.length / 2 }, (_, index) => ({ x: points[index * 2], y: points[index * 2 + 1], in: { x: 0, y: 0 }, out: { x: 0, y: 0 } })) }];
  }
  if (tag === 'rect') {
    const x = get('x'), y = get('y'), w = get('width'), h = get('height'); demand(w > 0 && h > 0, 'SVG rectangle needs positive dimensions');
    return [{ closed: true, nodes: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([x, y]) => ({ x, y, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } })) }];
  }
  const cx = get('cx'), cy = get('cy'), rx = get('rx'), ry = get('ry'); demand(rx > 0 && ry > 0, 'SVG ellipse needs positive radii');
  const k = .5522847498307936;
  return [{ closed: true, nodes: [
    { x: cx + rx, y: cy, in: { x: 0, y: -k * ry }, out: { x: 0, y: k * ry } },
    { x: cx, y: cy + ry, in: { x: k * rx, y: 0 }, out: { x: -k * rx, y: 0 } },
    { x: cx - rx, y: cy, in: { x: 0, y: k * ry }, out: { x: 0, y: -k * ry } },
    { x: cx, y: cy - ry, in: { x: -k * rx, y: 0 }, out: { x: k * rx, y: 0 } } ] }];
}

function pathLayer(contours, transform, paint, definitions) {
  const nodes = contours.flatMap(contour => contour.nodes), transformed = nodes.map(node => mapped(transform, node));
  demand(transformed.length >= 2, 'SVG shape needs at least two nodes');
  const x = Math.min(...transformed.map(point => point.x)), y = Math.min(...transformed.map(point => point.y));
  const w = Math.max(.1, Math.max(...transformed.map(point => point.x)) - x), h = Math.max(.1, Math.max(...transformed.map(point => point.y)) - y);
  const relative = point => ({ x: (point.x - x) / w, y: (point.y - y) / h });
  const sx = Math.hypot(transform[0], transform[1]), sy = Math.hypot(transform[2], transform[3]);
  const strokeWidth = scalar(paint['stroke-width'], 0);
  demand(!strokeWidth || (Math.abs(sx - sy) < .000001 && Math.abs(transform[0] * transform[2] + transform[1] * transform[3]) < .000001), 'Stroked SVG geometry requires a uniform non-skew transform');
  const normalized = contours.map(contour => ({ closed: contour.closed, nodes: contour.nodes.map(node => {
    const center = mapped(transform, node), incoming = mapped(transform, { x: node.x + node.in.x, y: node.y + node.in.y }), outgoing = mapped(transform, { x: node.x + node.out.x, y: node.y + node.out.y });
    return { x: Math.max(0, Math.min(1, (center.x - x) / w)), y: Math.max(0, Math.min(1, (center.y - y) / h)), in: { x: (incoming.x - center.x) / w, y: (incoming.y - center.y) / h }, out: { x: (outgoing.x - center.x) / w, y: (outgoing.y - center.y) / h } };
  }) }));
  const layer = { id: crypto.randomUUID(), type: 'path', name: 'Imported vector', x, y, w, h, contours: normalized,
    fill: color(paint.fill), stroke: color(paint.stroke, 'transparent'), strokeWidth: strokeWidth * sx,
    fillRule: paint['fill-rule'], cap: paint['stroke-linecap'], join: paint['stroke-linejoin'], dash: paint['stroke-dasharray'] === 'none' ? [] : numbers(paint['stroke-dasharray']) };
  const gradient = /^url\(#([a-zA-Z0-9._:-]+)\)$/.exec(paint.fill);
  if (gradient) {
    const definition = definitions.gradients.get(gradient[1]); demand(definition, 'SVG gradient must name a supported local definition');
    demand(definition.units === 'userSpaceOnUse', 'SVG gradients currently require userSpaceOnUse coordinates');
    layer.fill = '#000000'; layer.gradient = { from: relative(mapped(transform, definition.from)), to: relative(mapped(transform, definition.to)), stops: definition.stops };
  }
  if (paint['clip-path']) {
    const match = /^url\(#([a-zA-Z0-9._:-]+)\)$/.exec(paint['clip-path']);
    const points = match && definitions.clips.get(match[1]); demand(points, 'SVG clip must name a supported local polygon');
    layer.clip = points.map(point => relative(mapped(transform, point)));
  }
  return layer;
}

function textLayer(element, transform, paint, opacity) {
  attributes(element, ['x', 'y', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'data-oshal-text']);
  const sx = Math.hypot(transform[0], transform[1]), sy = Math.hypot(transform[2], transform[3]);
  demand(Math.abs(sx - sy) < .000001 && transform[0] * transform[3] - transform[1] * transform[2] > 0, 'SVG text requires uniform non-reflected scaling');
  const raw = element.getAttribute('data-oshal-text');
  if (raw) {
    const data = JSON.parse(decodeURIComponent(raw));
    demand(data && Object.keys(data).every(key => ['text', 'w', 'h', 'fontFamily', 'fontSize', 'fontWeight', 'fill', 'align'].includes(key)), 'Unsupported SVG text metadata');
    const center = mapped(transform, { x: data.w / 2, y: data.h / 2 });
    return { id: crypto.randomUUID(), type: 'text', name: 'Imported text', ...data, x: center.x - data.w * sx / 2,
      y: center.y - data.h * sy / 2, w: data.w * sx, h: data.h * sy, fontSize: data.fontSize * sx,
      rotation: Math.atan2(transform[1], transform[0]) * 180 / Math.PI, opacity };
  }
  demand(element.children.length === 0 && !element.getAttribute('clip-path'), 'External SVG text supports plain unclipped text only');
  const fontSize = scalar(element.getAttribute('font-size'), 16), at = mapped(transform, { x: scalar(element.getAttribute('x'), 0), y: scalar(element.getAttribute('y'), 0) });
  const family = element.getAttribute('font-family') ?? 'sans-serif', text = element.textContent;
  const ctx = document.createElement('canvas').getContext('2d'); ctx.font = `${fontSize}px ${family}`;
  const w = Math.max(.1, ctx.measureText(text).width * sx), anchor = element.getAttribute('text-anchor') ?? 'start';
  demand(['start', 'middle', 'end'].includes(anchor), 'Unsupported SVG text anchor');
  return { id: crypto.randomUUID(), type: 'text', name: 'Imported text', text, fontFamily: family, fontSize: fontSize * sx,
    fontWeight: scalar(element.getAttribute('font-weight'), 400), fill: color(paint.fill), align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
    x: at.x - (anchor === 'middle' ? w / 2 : anchor === 'end' ? w : 0), y: at.y - fontSize * sx, w, h: fontSize * sx * 1.2,
    rotation: Math.atan2(transform[1], transform[0]) * 180 / Math.PI, opacity };
}

function readDefinitions(root) {
  const gradients = new Map(), clips = new Map();
  for (const defs of [...root.children].filter(element => element.localName === 'defs')) {
    attributes(defs, []);
    for (const element of defs.children) {
      if (element.localName === 'clipPath') {
        attributes(element, ['clipPathUnits']);
        demand(!element.getAttribute('clipPathUnits') || element.getAttribute('clipPathUnits') === 'userSpaceOnUse', 'SVG clip uses user-space coordinates');
        const child = element.children[0]; demand(element.children.length === 1 && child && ['rect', 'polygon'].includes(child.localName), 'SVG clip supports one rectangle or polygon');
        attributes(child, ['x', 'y', 'width', 'height', 'points']);
        const id = element.getAttribute('id'); demand(id && !clips.has(id), 'SVG clip IDs must be unique');
        clips.set(id, shapeContours(child)[0].nodes.map(node => mapped(matrix(element.getAttribute('transform') ?? ''), node))); continue;
      }
      demand(element.localName === 'linearGradient', 'SVG definitions currently support linear gradients only');
      attributes(element, ['gradientUnits', 'x1', 'x2', 'y1', 'y2']);
      const id = element.getAttribute('id'); demand(id && !gradients.has(id), 'SVG definition IDs must be unique');
      const stops = [...element.children].map(stop => {
        demand(stop.localName === 'stop', 'Only gradient stops may appear in a gradient'); attributes(stop, ['offset', 'stop-color']);
        return { offset: scalar(stop.getAttribute('offset'), 0), color: color(stop.getAttribute('stop-color')) };
      });
      gradients.set(id, { units: element.getAttribute('gradientUnits') ?? 'objectBoundingBox',
        from: { x: scalar(element.getAttribute('x1'), 0), y: scalar(element.getAttribute('y1'), 0) },
        to: { x: scalar(element.getAttribute('x2'), 1), y: scalar(element.getAttribute('y2'), 0) }, stops });
    }
  }
  return { gradients, clips };
}

/** @description Parse only an inert bounded SVG geometry subset; executable/external/unknown features refuse the whole import.
 * @param {string} source XML SVG contents.
 * @returns {{project:object,warnings:string[]}} New editable project plus explicit hierarchy/format warnings. */
export function importVectorSvg(source) {
  demand(typeof source === 'string' && new TextEncoder().encode(source).length <= 2097152, 'SVG import is limited to 2 MiB');
  demand(!/<!DOCTYPE|<!ENTITY|<\?/i.test(source), 'SVG entities and processing instructions are not supported');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml'), root = document.documentElement;
  demand(root.localName === 'svg' && !document.querySelector('parsererror') && root.namespaceURI === 'http://www.w3.org/2000/svg', 'Use a valid SVG document');
  demand(!root.querySelector('script,foreignObject,image,use,style,animate,set'), 'SVG executable, external and unsupported dynamic elements are refused');
  for (const element of [root, ...root.querySelectorAll('*')]) for (const attribute of element.attributes) demand(!/^on/i.test(attribute.name) && !['href', 'xlink:href', 'src'].includes(attribute.name), 'SVG event handlers and resource references are refused');
  attributes(root, ['xmlns', 'width', 'height', 'viewBox']);
  const box = numbers(root.getAttribute('viewBox') ?? `0 0 ${root.getAttribute('width')} ${root.getAttribute('height')}`);
  demand(box.length === 4 && box[2] > 0 && box[3] > 0, 'SVG needs a positive viewBox');
  const width = Math.ceil(scalar(root.getAttribute('width'), box[2])), height = Math.ceil(scalar(root.getAttribute('height'), box[3]));
  demand(root.querySelectorAll('*').length <= 1000, 'SVG contains too many elements');
  const definitions = readDefinitions(root), layers = [], warnings = [];
  const walk = (element, inherited, transform, opacity, depth) => {
    demand(depth <= 8 && layers.length <= 200, 'SVG nesting or layer count is too large');
    if (['defs', 'title', 'desc'].includes(element.localName)) return;
    demand(['g', 'rect', 'ellipse', 'path', 'polyline', 'polygon', 'text'].includes(element.localName), `Unsupported SVG element: ${element.localName}`);
    if (element.localName !== 'text') attributes(element, ['x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'd', 'points']);
    const paint = style(element, inherited), combined = multiply(transform, matrix(element.getAttribute('transform') ?? ''));
    paint['clip-path'] = element.getAttribute('clip-path') ?? inherited['clip-path'];
    const alpha = opacity * scalar(element.getAttribute('opacity'), 1);
    if (element.localName === 'g') {
      demand(!paint['clip-path'], 'Clipped SVG group import is not supported; use native JSON');
      demand(alpha === 1, 'SVG group opacity cannot be flattened faithfully; use native JSON'); warnings.push('Imported SVG group hierarchy is flattened into editable geometry.');
      for (const child of element.children) walk(child, paint, combined, alpha, depth + 1); return;
    }
    if (element.localName === 'text') { if (!element.getAttribute('data-oshal-text')) warnings.push('Plain SVG text baseline/font metrics are approximated; inspect before saving.'); layers.push(textLayer(element, combined, paint, alpha)); warnings.push('SVG fonts are referenced by name; missing local fonts may be substituted.'); return; }
    demand(element.children.length === 0, 'SVG geometry cannot contain nested elements');
    const layer = pathLayer(shapeContours(element), combined, paint, definitions); layer.opacity = alpha; layers.push(layer);
  };
  const rootTransform = [width / box[2], 0, 0, height / box[3], -box[0] * width / box[2], -box[1] * height / box[3]];
  for (const element of root.children) walk(element, style(root), rootTransform, scalar(root.getAttribute('opacity'), 1), 0);
  demand(layers.length > 0, 'SVG contains no supported geometry');
  return { project: validateProject({ version: 3, name: 'Imported SVG', width, height, background: 'transparent', images: {}, layers }), warnings: [...new Set(warnings)] };
}
