/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Decode bounded PSD RGB8 pixel layers without evaluating embedded Photoshop data.
 * Format reference: https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/
 */
export const PSD_LIMITS = Object.freeze({ bytes: 4194304, dimension: 2048, pixels: 4194304,
  decodedPixels: 8388608, records: 64, images: 32, depth: 4 });

export class PsdError extends TypeError {
  constructor(code) { super(code); this.code = code; }
}
const require = (condition, code = 'invalid_psd') => { if (!condition) throw new PsdError(code); };
class Reader {
  constructor(bytes) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.offset = 0; }
  get left() { return this.bytes.length - this.offset; }
  take(n) { require(Number.isSafeInteger(n) && n >= 0 && n <= this.left); const result = this.bytes.subarray(this.offset, this.offset + n); this.offset += n; return result; }
  u8() { return this.take(1)[0]; }
  u16() { const offset = this.offset; this.take(2); return this.view.getUint16(offset); }
  i16() { const offset = this.offset; this.take(2); return this.view.getInt16(offset); }
  u32() { const offset = this.offset; this.take(4); return this.view.getUint32(offset); }
  i32() { const offset = this.offset; this.take(4); return this.view.getInt32(offset); }
  tag() { return String.fromCharCode(...this.take(4)); }
  section() { return new Reader(this.take(this.u32())); }
  end() { require(this.left === 0); }
}
function pad(reader, count, multiple) { const n = (multiple - count % multiple) % multiple; require(reader.take(n).every(v => v === 0)); }
function name(reader) {
  const size = reader.u8(), bytes = reader.take(size); pad(reader, size + 1, 4);
  return String.fromCharCode(...bytes);
}
function unicode(reader) {
  const count = reader.u32(); require(count <= 4096); let value = '';
  for (let i = 0; i < count; i++) value += String.fromCharCode(reader.u16());
  reader.end(); return value.replace(/\0$/, '');
}
function reportCollector() {
  const rows = [], seen = new Set();
  return { rows, add(code, layer = null, editable = false) {
    const key = JSON.stringify([code, layer]); if (!seen.has(key)) { require(rows.length < 256, 'psd_metadata_limit'); seen.add(key); rows.push({ code, layer, editable }); }
  } };
}

/** @description Decode one PackBits row with exact output and input bounds.
 * @param {Uint8Array} bytes Compressed row. @param {number} width Required output width.
 * @returns {Uint8Array} Exact decoded row. */
export function decodePsdRow(bytes, width) {
  const row = new Uint8Array(width); let input = 0, output = 0;
  while (input < bytes.length) {
    const header = bytes[input++];
    if (header === 128) continue;
    const count = header < 128 ? header + 1 : 257 - header;
    require(output + count <= width);
    if (header < 128) { require(input + count <= bytes.length); row.set(bytes.subarray(input, input + count), output); input += count; }
    else { require(input < bytes.length); row.fill(bytes[input++], output, output + count); }
    output += count;
  }
  require(output === width); return row;
}
function channel(reader, width, height) {
  const compression = reader.u16(), size = width * height;
  require(compression === 0 || compression === 1, 'psd_compression_unsupported');
  if (!size) { reader.end(); return new Uint8Array(); }
  if (compression === 0) { const data = reader.take(size); reader.end(); return data; }
  const lengths = Array.from({ length: height }, () => reader.u16()), data = new Uint8Array(size);
  for (let y = 0; y < height; y++) data.set(decodePsdRow(reader.take(lengths[y]), width), y * width);
  reader.end(); return data;
}
function rgba(planes, size, alpha) {
  require([0, 1, 2].every(id => planes.has(id)), 'psd_pixel_channels_unsupported');
  const data = new Uint8Array(size * 4), A = alpha ? planes.get(-1) : undefined;
  for (let i = 0; i < size; i++) { data[i * 4] = planes.get(0)[i]; data[i * 4 + 1] = planes.get(1)[i]; data[i * 4 + 2] = planes.get(2)[i]; data[i * 4 + 3] = A ? A[i] : 255; }
  return data;
}
function resources(reader, report) {
  let count = 0;
  while (reader.left) {
    require(++count <= 256, 'psd_metadata_limit');
    require(reader.tag() === '8BIM'); const id = reader.u16(), length = reader.u8(); reader.take(length); pad(reader, length + 1, 2);
    const data = reader.section(); pad(reader, data.bytes.length, 2);
    if (id === 1039) report.add('embedded_color_profile');
    else if (id === 1005 || id === 1024 || id === 1036 || id === 1033 || id === 1061 || id === 1008) report.add(`resource_${id}_preserved_only`, null, true);
    else report.add(`resource_${id}_unsupported`);
  }
}
function additional(reader, layer, report) {
  const seen = new Set();
  while (reader.left) {
    require(seen.size < 128, 'psd_metadata_limit');
    if (reader.left < 12) { require(reader.take(reader.left).every(v => v === 0)); break; }
    require(reader.tag() === '8BIM'); const key = reader.tag(); require(!seen.has(key)); seen.add(key);
    const data = reader.section(); pad(reader, data.bytes.length, 2);
    if (key === 'luni') layer.name = unicode(data);
    else if (key === 'lsct') {
      require([4, 12, 16].includes(data.bytes.length)); layer.section = data.u32(); require(layer.section <= 3);
      if (data.left) { require(data.tag() === '8BIM'); layer.blend = data.tag(); }
      if (data.left && data.u32() !== 0) report.add('animation_group', layer.index);
      data.end();
    } else if (key === 'lyid') { require(data.bytes.length === 4); layer.sourceId = data.u32(); }
    else report.add(`layer_tag_${key}_unsupported`, layer.index);
  }
}
function layerRecord(reader, index, report) {
  const top = reader.i32(), left = reader.i32(), bottom = reader.i32(), right = reader.i32();
  const width = right - left, height = bottom - top;
  require(width >= 0 && height >= 0 && width <= PSD_LIMITS.dimension && height <= PSD_LIMITS.dimension
    && Math.abs(top) <= 8192 && Math.abs(left) <= 8192 && Math.abs(bottom) <= 8192 && Math.abs(right) <= 8192, 'psd_layer_bounds');
  const count = reader.u16(); require(count <= 8);
  const channels = Array.from({ length: count }, () => ({ id: reader.i16(), length: reader.u32() }));
  require(new Set(channels.map(c => c.id)).size === count);
  if (channels.some(c => c.id > 2)) report.add('extra_layer_channel', index);
  require(reader.tag() === '8BIM'); const blend = reader.tag(), opacity = reader.u8(), clipping = reader.u8(), flags = reader.u8(); require(reader.u8() === 0);
  require(clipping <= 1 && !(flags & 0xe0));
  const extra = reader.section(), mask = extra.section(), ranges = extra.section();
  const layer = { index, x: left, y: top, width, height, channels, blend, opacity: opacity / 255,
    visible: !(flags & 2), locked: !!(flags & 1), name: name(extra), section: 0 };
  if (mask.left || channels.some(c => c.id < -1)) report.add('layer_mask', index);
  if (ranges.left) {
    require(ranges.left % 8 === 0);
    if (!ranges.bytes.every((value, i) => value === (i % 4 < 2 ? 0 : 255))) report.add('blend_if', index);
  }
  if (clipping) report.add('clipping_layer', index);
  if (flags & 1) report.add('transparency_lock_promoted_to_layer_lock', index, true);
  if (flags & 16) report.add('pixel_data_irrelevant', index);
  additional(extra, layer, report);
  if (layer.section === 1 || layer.section === 2) report.add('group_fixed_frame', index, true);
  if (layer.blend !== 'norm') report.add(`blend_${layer.blend}_unsupported`, index);
  if (layer.name.length > 120 || /[\u0000-\u001f\u007f]/.test(layer.name)) report.add('layer_name_normalized', index, true);
  return layer;
}

/** @description Parse PSD v1 RGB8 raw/RLE data with deterministic conversion findings.
 * @param {Uint8Array} bytes Original immutable PSD bytes.
 * @returns {object} Pixel records, merged preview and an editable eligibility report. */
export function readPsd(bytes) {
  require(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= PSD_LIMITS.bytes, 'psd_file_limit');
  const reader = new Reader(bytes), report = reportCollector();
  require(reader.tag() === '8BPS'); require(reader.u16() === 1, 'psb_unsupported'); require(reader.take(6).every(v => v === 0));
  const channels = reader.u16(), height = reader.u32(), width = reader.u32(), depth = reader.u16(), mode = reader.u16();
  require(depth === 8 && mode === 3, 'psd_color_mode_unsupported');
  require(channels >= 3 && channels <= 4, 'psd_pixel_channels_unsupported');
  require(width > 0 && height > 0 && width <= PSD_LIMITS.dimension && height <= PSD_LIMITS.dimension && width * height <= PSD_LIMITS.pixels, 'psd_canvas_limit');
  reader.section().end(); resources(reader.section(), report);
  const section = reader.section(), layers = []; let mergedAlpha = false, decoded = width * height;
  if (section.left) {
    const info = section.section();
    if (info.left) {
      const signed = info.i16(), count = Math.abs(signed); mergedAlpha = signed < 0;
      require(count <= PSD_LIMITS.records, 'psd_layer_limit');
      for (let i = 0; i < count; i++) layers.push(layerRecord(info, i, report));
      let images = 0;
      for (const layer of layers) {
        const size = layer.width * layer.height;
        if (!layer.section) { decoded += size; images++; }
        require(decoded <= PSD_LIMITS.decodedPixels && images <= PSD_LIMITS.images, 'psd_decoded_limit');
        const planes = new Map();
        for (const item of layer.channels) {
          require(item.length>=2);
          const source = new Reader(info.take(item.length));
          if (item.id < -1 || item.id > 2 || layer.section) { require(source.u16()<=3);source.take(source.left);continue; }
          planes.set(item.id, channel(source, layer.width, layer.height));
        }
        if (!layer.section && size) layer.rgba = rgba(planes, size, true);
        else if (!layer.section) report.add('empty_pixel_layer', layer.index);
      }
      require(info.left <= 1); require(info.take(info.left).every(v => v === 0));
    }
    if (section.left) { const global = section.section(); if (global.left) report.add('global_mask'); }
    if (section.left) {
      report.add('global_layer_information'); let tags = 0;
      while (section.left) {
        require(++tags <= 128 && section.tag() === '8BIM'); section.tag();
        const data = section.section(); pad(section, data.bytes.length, 2);
      }
    }
  }
  require(!mergedAlpha || channels === 4);
  const compression = reader.u16(); require(compression <= 1, 'psd_compression_unsupported');
  const planes = new Map(), size = width * height;
  if (compression === 0) {
    for (let c = 0; c < channels; c++) planes.set(c === 3 ? -1 : c, reader.take(size));
  } else {
    const lengths = Array.from({ length: channels * height }, () => reader.u16());
    for (let c = 0; c < channels; c++) {
      const data = new Uint8Array(size);
      for (let y = 0; y < height; y++) data.set(decodePsdRow(reader.take(lengths[c * height + y]), width), y * width);
      planes.set(c === 3 ? -1 : c, data);
    }
  }
  reader.end(); if (!layers.length) report.add('no_editable_layers');
  if (channels === 4 && !mergedAlpha) report.add('extra_alpha_channel_ignored', null, true);
  const merged = rgba(planes, size, mergedAlpha);
  // Photoshop's merged transparency may carry a white matte. Do not invent a
  // color-unmatting conversion: transparent editable layer planes are supported,
  // but that merged cache is not an accepted flattened rendering in this profile.
  const result = { width, height, layers, merged, flattenable: !mergedAlpha,
    report: report.rows, editable: !report.rows.some(row => !row.editable) };
  try { psdLayerTree(result); } catch (error) { if (!(error instanceof PsdError)) throw error; report.add(error.code); result.editable = false; }
  return result;
}

/** @description Convert top-to-bottom PSD folder records to Create's bottom-to-top isolated tree.
 * @param {object} parsed Decoded PSD. @returns {object[]} Ordered root nodes. */
export function psdLayerTree(parsed) {
  const roots = [], stack = [roots];
  for (const layer of parsed.layers) {
    if (layer.section === 3) { require(stack.length > 1, 'psd_group_structure'); stack.pop(); continue; }
    const node = { layer, children: [] }; stack.at(-1).push(node);
    if (layer.section === 1 || layer.section === 2) {
      require(stack.length <= PSD_LIMITS.depth, 'psd_group_depth'); stack.push(node.children);
    }
  }
  require(stack.length === 1, 'psd_group_structure');
  const reverse = nodes => { nodes.reverse(); for (const node of nodes) if (node.layer.section) { require(node.children.length > 0, 'psd_empty_group'); reverse(node.children); } };
  function bounds(node) {
    if (!node.layer.section) return { x:node.layer.x,y:node.layer.y,w:node.layer.width,h:node.layer.height };
    const children=node.children.map(bounds), x=Math.min(...children.map(c=>c.x)),y=Math.min(...children.map(c=>c.y));
    const w=Math.max(...children.map(c=>c.x+c.w))-x,h=Math.max(...children.map(c=>c.y+c.h))-y;
    require(w>0 && h>0 && w<=PSD_LIMITS.dimension && h<=PSD_LIMITS.dimension && w*h<=PSD_LIMITS.pixels,'psd_group_frame_limit');
    return {x,y,w,h};
  }
  reverse(roots); roots.forEach(bounds); return roots;
}

/** @description Build editable reference-mode layers from server-owned immutable PNG asset receipts.
 * @param {object} parsed Parsed eligible PSD. @param {Map<number,object>} assets Index to owned asset receipt.
 * @param {string} title Project title. @returns {object} Create document with editable fixed-frame groups. */
export function psdDocument(parsed, assets, title) {
  require(parsed.editable, 'psd_editable_unsupported'); const layers = [], images = {};
  const nodes = psdLayerTree(parsed);
  function build(node) {
    const source = node.layer, id = `psd-${source.index}`;
    const common = { id, name: source.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'Layer', rotation: 0,
      opacity: source.opacity, visible: source.visible, locked: source.locked };
    if (!source.section) {
      const asset = assets.get(source.index); require(asset && asset.width === source.width && asset.height === source.height, 'psd_asset_unavailable');
      images[asset.id] = { src: asset.src, width: asset.width, height: asset.height };
      const layer = { ...common, type: 'image', x: source.x, y: source.y, w: source.width, h: source.height, assetId: asset.id };
      layers.push(layer); return layer;
    }
    const children = node.children.map(build), x = Math.min(...children.map(l => l.x)), y = Math.min(...children.map(l => l.y));
    const w = Math.max(...children.map(l => l.x + l.w)) - x, h = Math.max(...children.map(l => l.y + l.h)) - y;
    require(w > 0 && h > 0 && w <= PSD_LIMITS.dimension && h <= PSD_LIMITS.dimension && w * h <= PSD_LIMITS.pixels, 'psd_group_frame_limit');
    for (const child of children) { child.x -= x; child.y -= y; }
    const layer = { ...common, type: 'group', x, y, w, h, baseWidth: w, baseHeight: h, children: children.map(l => l.id) };
    layers.push(layer); return layer;
  }
  nodes.forEach(build); return { version: 3, name: title, width: parsed.width, height: parsed.height, background: 'transparent', layers, images };
}
