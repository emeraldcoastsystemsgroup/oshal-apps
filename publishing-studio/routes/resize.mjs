/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Proportional format resize creating a new owned publication copy with scaled frames, objects, and styles (RP-PUB-04).
 */
import {randomUUID} from 'node:crypto';
import {PAGE_SIZES, exact, fail, id, title, validate} from './model.mjs';

const round1 = n => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function mapAxis(val, oldMargin, oldInner, newMargin, newInner) {
  if (oldInner <= 0) return newMargin;
  return newMargin + ((val - oldMargin) / oldInner) * newInner;
}

function scaleObject(obj, oldBox, newBox, bleed) {
  const sx = newBox.innerW / oldBox.innerW;
  const sy = newBox.innerH / oldBox.innerH;
  const w = round1(clamp(obj.width * sx, 4, newBox.w + 2 * bleed));
  const h = round1(clamp(obj.height * sy, 4, newBox.h + 2 * bleed));
  const x = round1(clamp(mapAxis(obj.x, oldBox.margin, oldBox.innerW, newBox.margin, newBox.innerW), -bleed, newBox.w + bleed - w));
  const y = round1(clamp(mapAxis(obj.y, oldBox.margin, oldBox.innerH, newBox.margin, newBox.innerH), -bleed, newBox.h + bleed - h));
  return { ...structuredClone(obj), x, y, width: w, height: h };
}

function scaleStyles(m, factor) {
  const f = clamp(factor, 0.65, 1.35);
  for (const s of Object.values(m.characterStyles)) {
    s.size = round1(clamp(s.size * f, 8, 72));
  }
  for (const s of Object.values(m.paragraphStyles)) {
    s.leading = round1(clamp(s.leading * f, 0, 72));
    s.spaceAfter = round1(clamp(s.spaceAfter * f, 0, 72));
    s.indent = round1(clamp(s.indent * f, 0, 96));
  }
}

export function resizeModel(sourceModel, targetSize, nextTitle) {
  const spec = PAGE_SIZES[targetSize];
  if (!spec) fail(400, 'publishing_page_size_unsupported');
  const m = structuredClone(sourceModel);
  m.title = title(nextTitle);
  const firstOld = m.pages[0];
  const areaScale = Math.sqrt((spec.width * spec.height) / (firstOld.width * firstOld.height));
  scaleStyles(m, areaScale);

  const oldMasterBox = { w: firstOld.width, h: firstOld.height, margin: firstOld.margin, innerW: Math.max(12, firstOld.width - 2 * firstOld.margin), innerH: Math.max(12, firstOld.height - 2 * firstOld.margin) };
  const newBox = { w: spec.width, h: spec.height, margin: spec.margin, innerW: Math.max(12, spec.width - 2 * spec.margin), innerH: Math.max(12, spec.height - 2 * spec.margin) };
  for (const master of m.masters) {
    master.objects = master.objects.map(o => scaleObject(o, oldMasterBox, newBox, firstOld.bleed));
  }

  const storySizes = new Map();
  for (const p of m.pages) {
    const oldBox = { w: p.width, h: p.height, margin: p.margin, innerW: Math.max(12, p.width - 2 * p.margin), innerH: Math.max(12, p.height - 2 * p.margin) };
    p.width = spec.width;
    p.height = spec.height;
    p.margin = spec.margin;
    p.guides = { x: [spec.margin, round1(spec.width - spec.margin)], y: [spec.margin, round1(spec.height - spec.margin)] };
    p.objects = p.objects.map(o => scaleObject(o, oldBox, newBox, p.bleed));
    for (const f of p.frames) {
      const sx = newBox.innerW / oldBox.innerW;
      const sy = newBox.innerH / oldBox.innerH;
      if (!storySizes.has(f.storyId)) {
        storySizes.set(f.storyId, {
          w: round1(clamp(f.width * sx, 36, spec.width - 2 * spec.margin)),
          h: round1(clamp(f.height * sy, 36, spec.height - 2 * spec.margin)),
        });
      }
      const uni = storySizes.get(f.storyId);
      f.width = uni.w;
      f.height = uni.h;
      f.x = round1(clamp(mapAxis(f.x, oldBox.margin, oldBox.innerW, newBox.margin, newBox.innerW), 0, spec.width - f.width));
      f.y = round1(clamp(mapAxis(f.y, oldBox.margin, oldBox.innerH, newBox.margin, newBox.innerH), 0, spec.height - f.height));
    }
    // Preserve strict reading order for same-page linked frames
    for (let i = 1; i < p.frames.length; i++) {
      if (p.frames[i].storyId === p.frames[i - 1].storyId && p.frames[i].y <= p.frames[i - 1].y) {
        p.frames[i].y = round1(clamp(p.frames[i - 1].y + 12, 0, spec.height - p.frames[i].height));
      }
    }
  }
  return validate(m);
}

export async function resizeDocument(store, documentId, input) {
  id(documentId);
  exact(input, ['size', 'requestKey'], ['title', 'revision']);
  if (!Object.hasOwn(PAGE_SIZES, input.size)) fail(400, 'publishing_page_size_unsupported');
  return store.tx('create', true, async (c, o) => {
    const source = await store.getRow(c, o, documentId, input.revision);
    await store.assets(c, o, source.model.assets);
    const label = input.size.toUpperCase();
    const copyTitle = input.title !== undefined ? title(input.title) : title(`${source.row.title.slice(0, 136)} (${label})`);
    const answer = await store.request(c, o, input.requestKey, ['resize', documentId, source.saved.revision, input.size, copyTitle], async () => {
      const countRow = (await c.query('SELECT count(*)::int AS n FROM publishing_documents WHERE owner_key=$1', o)).rows[0];
      if (Number(countRow.n) >= 32) fail(413, 'publishing_document_limit');
      const resized = resizeModel(source.model, input.size, copyTitle);
      const createdId = randomUUID();
      await c.query('INSERT INTO publishing_documents(id,owner_key,title,current_revision) VALUES($2,$1,$3,1)', [...o, createdId, copyTitle]);
      await store.revision(c, o, createdId, 1, resized);
      return { resource: createdId, result: { document: { id: createdId, revision: 1 } } };
    });
    const saved = await store.getRow(c, o, answer.document.id, answer.document.revision);
    return { document: store.document(saved), sourceDocument: documentId, size: input.size, ...(answer.replayed ? { replayed: true } : {}) };
  });
}
