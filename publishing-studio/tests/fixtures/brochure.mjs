import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
function crc32(bytes) { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; }
function chunk(type, bytes) { const tag = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([tag, bytes]))); return Buffer.concat([size, tag, bytes, checksum]); }
export function brochureImage(width = 600, height = 300) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const pos = y * (width * 3 + 1) + 1 + x * 3; pixels[pos] = x < width / 2 ? 210 : 20; pixels[pos + 1] = 40; pixels[pos + 2] = x < width / 2 ? 40 : 210; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function brochure() {
  const image = brochureImage();
  const style = (size = 11, weight = 400, slant = 'normal', color = [0, 0, 0]) => ({ font: 'Libertinus Serif', size, weight, style: slant, color });
  const model = {
    version: 1, pageView: 'facing', title: 'Four-page linked publishing brochure',
    characterStyles: { default: style(), emphasis: style(11, 700, 'italic', [20, 45, 110]), header: style(12, 700), footer: style(10) },
    paragraphStyles: { body: { leading: 2, spaceAfter: 4, indent: 0, align: 'left' }, heading: { leading: 2, spaceAfter: 0, indent: 0, align: 'left' } },
    assets: [{ id: 'bleedImage', bytes: image.length, sha256: createHash('sha256').update(image).digest('hex'), mime: 'image/png' }],
    masters: [{ id: 'brochureMaster', objects: [
      { id: 'masterHeader', kind: 'text', x: 36, y: 20, width: 360, height: 24, paragraph: { style: 'heading', runs: [{ text: 'Publishing Studio - Shared Master', style: 'header' }] } },
      { id: 'pageNumber', kind: 'number', x: 210, y: 574, width: 32, height: 24, style: 'footer' },
      { id: 'headerRule', kind: 'rect', x: 36, y: 48, width: 360, height: 2, color: [20, 45, 110] }
    ] }],
    pages: Array.from({ length: 4 }, (_, index) => ({ id: `page${index + 1}`, width: 432, height: 612, bleed: 9, margin: 36, guides: { x: [36, 396], y: [72, 540] }, masterId: 'brochureMaster',
      objects: index === 0 ? [{ id: 'bleedBanner', kind: 'image', x: -9, y: 504, width: 144, height: 72, assetId: 'bleedImage' }, { id: 'positionMark', kind: 'rect', x: 350, y: 510, width: 18, height: 18, color: [0, 180, 40] }] : [],
      frames: [{ id: `main${index + 1}`, storyId: 'mainStory', nextFrame: index === 3 ? null : `main${index + 2}`, x: 36, y: 72, width: 360, height: 190 },
        { id: `side${index + 1}`, storyId: 'sideStory', nextFrame: index === 3 ? null : `side${index + 2}`, x: 36, y: 300, width: 360, height: 170 }] })),
    stories: [{ id: 'mainStory', firstFrame: 'main1', paragraphs: Array.from({ length: 30 }, (_, index) => ({ style: 'body', runs: [{ text: `MAIN-${String(index + 1).padStart(2, '0')} ` }, { text: 'This linked paragraph keeps authoritative native shaping, ', style: 'emphasis' }, { text: 'measured flow, and exact print-scale placement across the brochure pages.' }] })) },
      { id: 'sideStory', firstFrame: 'side1', paragraphs: Array.from({ length: 32 }, (_, index) => ({ style: 'body', runs: [{ text: `SIDE-${String(index + 1).padStart(2, '0')} A second independent story flows through its own linked frames using the same embedded permitted fonts and paragraph style.` }] })) }]
  };
  return { model, assets: new Map([['bleedImage', image]]) };
}
