/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Apply Create brand kit fonts, palette colours, and owned logo asset onto a publication revision (RP-PUB-05).
 */
import {exact, fail, id, integer, key, LIMITS, validate} from './model.mjs';

const SERIF_FACES = new Set(['cambria', 'constantia', 'garamond', 'georgia', 'libertinus serif', 'times', 'times new roman']);
const MONO_FACES = new Set(['consolas', 'courier', 'courier new', 'liberation mono', 'monospace']);

export function mapBrandFont(face, fallback = 'Libertinus Serif') {
  if (typeof face !== 'string' || !face.trim()) return fallback;
  const norm = face.trim().toLowerCase();
  if (MONO_FACES.has(norm) || norm.includes('mono') || norm.includes('code')) return 'Liberation Mono';
  if (SERIF_FACES.has(norm) || (norm.includes('serif') && !norm.includes('sans'))) return 'Libertinus Serif';
  return 'Liberation Sans';
}

export function parseHexRgb(hex, fallback) {
  if (Array.isArray(hex) && hex.length === 3 && hex.every(n => typeof n === 'number' && n >= 0 && n <= 255)) {
    return hex.map(n => Math.round(n));
  }
  if (typeof hex !== 'string') return fallback;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return fallback;
  const raw = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
}

function pngOrJpegDims(buf, mime) {
  if (mime === 'image/png' && buf.length >= 24) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      if ([0xc0, 0xc1, 0xc2].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      if (marker === 0xd9 || marker === 0xda) break;
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return { w: 300, h: 300 };
}

function placeBrandLogo(m, logoInfo) {
  if (!m.assets.some(a => a.id === logoInfo.descriptor.id)) {
    m.assets.push(logoInfo.descriptor);
  }
  const p1 = m.pages[0];
  const maxPtW = Math.min(96, Math.max(18, Math.floor((logoInfo.widthPx * 72) / 160)));
  const ratio = logoInfo.heightPx / Math.max(1, logoInfo.widthPx);
  const ptW = Math.min(maxPtW, Math.max(18, p1.width - 2 * p1.margin));
  const ptH = Math.max(12, Math.min(96, Math.round(ptW * ratio * 10) / 10));
  const x = Math.max(0, Math.round((p1.width - p1.margin - ptW) * 10) / 10);
  const y = Math.max(0, Math.min(p1.margin, p1.height - ptH));
  const existing = p1.objects.find(o => o.id === 'brand_logo');
  if (existing) {
    Object.assign(existing, { kind: 'image', assetId: logoInfo.descriptor.id, x, y, width: ptW, height: ptH });
  } else {
    p1.objects.push({ id: 'brand_logo', kind: 'image', assetId: logoInfo.descriptor.id, x, y, width: ptW, height: ptH });
  }
}

export function applyBrandKitToModel(model, kit, logoInfo) {
  if (!kit || typeof kit !== 'object' || Array.isArray(kit)) fail(400, 'publishing_brand_kit_invalid');
  const colors = kit.colors ?? {};
  const primary = parseHexRgb(colors.primary, null);
  if (!primary) fail(400, 'publishing_brand_kit_invalid');
  const secondary = parseHexRgb(colors.secondary, primary);
  const accent = parseHexRgb(colors.accent, secondary);
  const dark = parseHexRgb(colors.dark, [22, 26, 32]);
  const headingFont = mapBrandFont(kit.fonts?.heading, 'Liberation Sans');
  const bodyFont = mapBrandFont(kit.fonts?.body, 'Libertinus Serif');

  const m = structuredClone(model);
  for (const [name, style] of Object.entries(m.characterStyles)) {
    const isLightText = style.color.every(c => c >= 235);
    if (name === 'default') {
      style.font = bodyFont;
      style.color = [...dark];
    } else if (name === 'header' || style.weight === 700 || style.size >= 16) {
      style.font = headingFont;
      if (!isLightText) style.color = [...primary];
    } else {
      style.font = bodyFont;
      if (!isLightText) style.color = [...dark];
    }
  }
  if (!m.characterStyles.header) {
    m.characterStyles.header = { font: headingFont, size: 18, weight: 700, style: 'normal', color: [...primary] };
  }

  const palette = [primary, accent, secondary];
  let rectIndex = 0;
  for (const page of m.pages) {
    for (const obj of page.objects) {
      if (obj.kind === 'rect') {
        obj.color = [...palette[rectIndex % palette.length]];
        rectIndex += 1;
      }
    }
  }
  if (logoInfo) placeBrandLogo(m, logoInfo);
  return validate(m);
}

function resolveKitInput(input) {
  if (input.kit !== undefined) {
    exact(input, ['baseRevision', 'requestKey', 'kit'], ['logoAssetId']);
    return input.kit;
  }
  exact(input, ['baseRevision', 'requestKey', 'primaryColor'], ['secondaryColor', 'accentColor', 'darkColor', 'headingFont', 'bodyFont', 'logoAssetId']);
  return {
    colors: {
      primary: input.primaryColor,
      ...(input.secondaryColor !== undefined ? { secondary: input.secondaryColor } : {}),
      ...(input.accentColor !== undefined ? { accent: input.accentColor } : {}),
      ...(input.darkColor !== undefined ? { dark: input.darkColor } : {}),
    },
    fonts: {
      ...(input.headingFont !== undefined ? { heading: input.headingFont } : {}),
      ...(input.bodyFont !== undefined ? { body: input.bodyFont } : {}),
    },
  };
}

export async function applyBrandKit(store, documentId, input) {
  id(documentId);
  const kit = resolveKitInput(input);
  integer(input.baseRevision, 1, LIMITS.revisions - 1);
  if (input.logoAssetId !== undefined) key(input.logoAssetId);
  return store.tx('change', true, async (c, o) => {
    const answer = await store.request(c, o, input.requestKey, ['brand-kit', documentId, input.baseRevision, kit, input.logoAssetId ?? null], async () => {
      const prior = await store.getRow(c, o, documentId);
      if (prior.row.current_revision !== input.baseRevision) fail(409, 'publishing_revision_conflict');
      let logoInfo = null;
      if (input.logoAssetId) {
        const assetRow = (await c.query('SELECT * FROM publishing_assets WHERE owner_key=$1 AND id=$2', [...o, input.logoAssetId])).rows[0];
        if (!assetRow) fail(404, 'publishing_asset_missing');
        const blobRow = (await c.query('SELECT * FROM publishing_blobs WHERE owner_key=$1 AND id=$2', [...o, assetRow.blob_id])).rows[0];
        const bytes = await store.blob(c, o, assetRow.blob_id, 'change');
        const dims = pngOrJpegDims(bytes, assetRow.mime);
        logoInfo = {
          descriptor: { id: assetRow.id, sha256: blobRow.sha256, bytes: blobRow.bytes, mime: assetRow.mime },
          widthPx: dims.w,
          heightPx: dims.h,
        };
      }
      const nextModel = applyBrandKitToModel(prior.model, kit, logoInfo);
      const nextRev = input.baseRevision + 1;
      await store.revision(c, o, documentId, nextRev, nextModel);
      const updated = await c.query('UPDATE publishing_documents SET current_revision=$3,updated_at=now() WHERE owner_key=$1 AND id=$2 AND current_revision=$4 RETURNING id', [...o, documentId, nextRev, input.baseRevision]);
      if (!updated.rows.length) fail(409, 'publishing_revision_conflict');
      return { resource: documentId, result: { document: { id: documentId, revision: nextRev } } };
    });
    const saved = await store.getRow(c, o, answer.document.id, answer.document.revision);
    return { document: store.document(saved), appliedBrand: { headingFont: mapBrandFont(kit?.fonts?.heading, 'Liberation Sans'), bodyFont: mapBrandFont(kit?.fonts?.body, 'Libertinus Serif') }, ...(answer.replayed ? { replayed: true } : {}) };
  });
}
