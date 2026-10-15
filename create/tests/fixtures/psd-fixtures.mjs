/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Generate original format-spec PSD fixtures; no upstream application or corpus bytes copied.
 */
import { Buffer } from 'node:buffer';
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const i16 = n => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const cat = values => Buffer.concat(values);
const section = bytes => cat([u32(bytes.length), bytes]);
const padded = (bytes, n) => cat([bytes, Buffer.alloc((n - bytes.length % n) % n)]);
const tag = (key, bytes) => cat([Buffer.from('8BIM' + key), section(padded(bytes, 2))]);
function pack(row) {
  if(row.length && row.every(value=>value===row[0])) {
    const result=[];for(let i=0;i<row.length;i+=128){const count=Math.min(128,row.length-i);result.push(Buffer.from(count===1?[0,row[0]]:[257-count,row[0]]));}return cat(result);
  }
  const result = []; for (let i = 0; i < row.length; i += 128) { const bytes = row.subarray(i, i + 128); result.push(Buffer.from([bytes.length - 1]), bytes); } return cat(result);
}
function plane(data, width, height, rle) {
  if (!rle) return cat([u16(0), data]);
  const rows = Array.from({ length: height }, (_, y) => pack(data.subarray(y * width, (y + 1) * width)));
  return cat([u16(1), ...rows.map(row => u16(row.length)), ...rows]);
}
/** @description Write real PSDv1 RGB8 structure independently from the production decoder.
 * @param {object} options Top-to-bottom layer records and planar composite.
 * @returns {Buffer} Original test PSD bytes. */
export function makePsd({ width = 2, height = 2, layers = [], color = [255, 0, 0], compositeRgb, rle = false,
  mergedAlpha = false, resources = Buffer.alloc(0), mode = 3, depth = 8 } = {}) {
  const records = [], data = [];
  for (const layer of layers) {
    const w = layer.section ? 0 : layer.width ?? width, h = layer.section ? 0 : layer.height ?? height;
    const channels = layer.section ? [] : [0, 1, 2, -1].map((id, c) => ({ id, data: plane(Buffer.alloc(w * h, layer.color?.[c] ?? (c === 3 ? 255 : color[c])), w, h, layer.rle ?? rle) }));
    const ascii = Buffer.from(layer.name ?? 'Layer'), unicode = layer.unicode === undefined ? [] : [tag('luni', cat([u32(layer.unicode.length), ...Array.from({ length: layer.unicode.length }, (_, i) => u16(layer.unicode.charCodeAt(i)))]))];
    const additional = layer.section ? [tag('lsct', cat([u32(layer.section), Buffer.from('8BIM' + (layer.blend ?? 'norm'))]))] : [];
    const extra = cat([section(layer.mask ?? Buffer.alloc(0)), section(Buffer.alloc(0)), padded(cat([Buffer.from([ascii.length]), ascii]), 4), ...unicode, ...additional,
      ...(layer.tag ? [tag(layer.tag, layer.tagData ?? Buffer.alloc(4))] : [])]);
    records.push(cat([i32(layer.y ?? 0), i32(layer.x ?? 0), i32((layer.y ?? 0) + h), i32((layer.x ?? 0) + w), u16(channels.length),
      ...channels.map(c => cat([i16(c.id), u32(c.data.length)])), Buffer.from('8BIM' + (layer.blend ?? 'norm')),
      Buffer.from([layer.opacity ?? 255, layer.clipping ?? 0, (layer.hidden ? 2 : 0) | (layer.locked ? 1 : 0), 0]), section(extra)]));
    data.push(...channels.map(c => c.data));
  }
  const info = padded(cat([i16(mergedAlpha ? -layers.length : layers.length), ...records, ...data]), 2);
  const layerSection = section(cat([section(info), u32(0)])), count = mergedAlpha ? 4 : 3;
  let composite;
  const mergedPlane=c=>compositeRgb&&c<3?Buffer.from(Array.from({length:width*height},(_,i)=>compositeRgb[i*3+c])):Buffer.alloc(width*height,color[c]??255);
  if (!rle) composite = cat([u16(0), ...Array.from({ length: count }, (_, c) => mergedPlane(c))]);
  else {
    const planes=Array.from({length:count},(_,c)=>mergedPlane(c));
    const rows = Array.from({ length: count * height }, (_, i) => pack(planes[Math.floor(i/height)].subarray(i%height*width,(i%height+1)*width)));
    composite = cat([u16(1), ...rows.map(row => u16(row.length)), ...rows]);
  }
  return cat([Buffer.from('8BPS'), u16(1), Buffer.alloc(6), u16(count), u32(height), u32(width), u16(depth), u16(mode), u32(0), section(resources), layerSection, composite]);
}
export const groupedPsd = () => makePsd({ width: 4, height: 4, color: [0, 0, 255], compositeRgb:Buffer.from(Array.from({length:16},(_,i)=>i%4>=1&&i%4<=2&&Math.floor(i/4)>=1&&Math.floor(i/4)<=2?[128,0,127]:[0,0,255]).flat()),layers: [
  { name: 'Group', unicode: 'Grüppe 🎨', section: 1, opacity: 128 },
  { name: 'Red', color: [255, 0, 0, 255], x: 1, y: 1, width: 2, height: 2, rle: true },
  { name: 'Divider', section: 3 },
  { name: 'Blue', color: [0, 0, 255, 255], locked: true },
] });
