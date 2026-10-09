/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Region compositing with sharp: rasterize the validated source-pixel outline as a coverage mask, feather it only inward, and blend the provider's answer into the source image ONLY where the mask covers. Every pixel the mask does not cover is copied byte for byte, so the outside of a region can never change whatever the provider returns.
 */
import sharp from 'sharp';
import { ProjectError, PROJECT_LIMITS } from './create-project-types';

export interface RegionPoint { x: number; y: number }
/** The validated selection shape tools/editor/region-select.mjs produces and the server re-validates. */
export interface RegionSelection {
  version: 1; kind: 'lasso' | 'box' | 'layer'; layerId: string; assetId: string;
  sourceWidth: number; sourceHeight: number; feather: number; points: RegionPoint[];
}
export interface CropBox { left: number; top: number; width: number; height: number }
export interface CompositeResult { png: Buffer; box: CropBox; width: number; height: number; changedPixels: number }

/** Context the provider sees around the region: a quarter of its larger side, at least 16 source pixels. */
export const REGION_CONTEXT = Object.freeze({ fraction: 0.25, minimum: 16, generatedBytes: 26214400 });
const DECODE = Object.freeze({ limitInputPixels: PROJECT_LIMITS.pixels, failOn: 'error' as const });

/**
 * @description The source rectangle sent to the provider: the region's whole-pixel bounds plus context, clamped to the image.
 * @param selection - Validated selection in source pixels.
 * @returns Integer crop box that contains every covered pixel of the region.
 */
export function regionCropBox(selection: RegionSelection): CropBox {
  const xs = selection.points.map(point => point.x), ys = selection.points.map(point => point.y);
  const minX = Math.floor(Math.min(...xs)), minY = Math.floor(Math.min(...ys));
  const maxX = Math.ceil(Math.max(...xs)), maxY = Math.ceil(Math.max(...ys));
  const margin = Math.max(REGION_CONTEXT.minimum, Math.round(Math.max(maxX - minX, maxY - minY) * REGION_CONTEXT.fraction));
  const left = Math.max(0, minX - margin), top = Math.max(0, minY - margin);
  const right = Math.min(selection.sourceWidth, maxX + margin), bottom = Math.min(selection.sourceHeight, maxY + margin);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * @description An SVG holding only the validated outline, filled non-zero; numbers are printed in fixed notation.
 * @param selection - Validated selection in source pixels.
 * @returns SVG text sized to the source image.
 */
export function regionMaskSvg(selection: RegionSelection): string {
  const path = selection.points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${selection.sourceWidth}" height="${selection.sourceHeight}" `
    + `viewBox="0 0 ${selection.sourceWidth} ${selection.sourceHeight}"><path d="${path} Z" fill="#fff" fill-rule="nonzero"/></svg>`;
}

/**
 * @description Per-pixel coverage (0-255) of the region, one byte per source pixel; feathering only ever lowers coverage.
 * @param selection - Validated selection in source pixels.
 * @returns Single-channel mask of sourceWidth x sourceHeight bytes.
 */
export async function regionMask(selection: RegionSelection): Promise<Buffer> {
  const { sourceWidth: width, sourceHeight: height } = selection;
  const rendered = await sharp(Buffer.from(regionMaskSvg(selection)), { density: 72, ...DECODE }).ensureAlpha()
    .extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  if (rendered.info.width !== width || rendered.info.height !== height || rendered.info.channels !== 1) throw new ProjectError(500, 'region_mask_invalid');
  const mask = rendered.data;
  if (selection.feather < 1) return mask;
  // sharp widens a blurred single-channel image to three channels, so take one back before indexing it per pixel.
  const blurred = await sharp(mask, { raw: { width, height, channels: 1 } }).blur(selection.feather / 2).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  if (blurred.info.channels !== 1 || blurred.data.length !== mask.length) throw new ProjectError(500, 'region_mask_invalid');
  for (let index = 0; index < mask.length; index++) mask[index] = Math.round(mask[index] * blurred.data[index] / 255);
  return mask;
}

/**
 * @description Decode the provider's answer and fit it exactly over the crop box.
 * @param generated - Provider image bytes.
 * @param box - Crop box the answer replaces.
 * @returns RGBA pixels of box.width x box.height.
 */
export async function generatedPatch(generated: Buffer, box: CropBox): Promise<Buffer> {
  if (!Buffer.isBuffer(generated) || !generated.length || generated.length > REGION_CONTEXT.generatedBytes) throw new ProjectError(502, 'region_edit_result_invalid');
  try {
    const metadata = await sharp(generated, DECODE).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new ProjectError(502, 'region_edit_result_invalid');
    return await sharp(generated, DECODE).rotate().resize(box.width, box.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError(502, 'region_edit_result_invalid');
  }
}

/**
 * @description The source crop sent to the provider as its one anchor image.
 * @param source - Normalized source PNG bytes.
 * @param box - Crop box from regionCropBox.
 * @returns PNG bytes of the crop.
 */
export async function regionAnchor(source: Buffer, box: CropBox): Promise<Buffer> {
  return sharp(source, DECODE).extract(box).png().toBuffer();
}

function blend(base: Buffer, patch: Buffer, mask: Buffer, width: number, box: CropBox): number {
  let changed = 0;
  for (let y = box.top; y < box.top + box.height; y++) {
    for (let x = box.left; x < box.left + box.width; x++) {
      const coverage = mask[y * width + x];
      if (!coverage) continue;
      const alpha = coverage / 255, target = (y * width + x) * 4, from = ((y - box.top) * box.width + x - box.left) * 4;
      for (let channel = 0; channel < 4; channel++) base[target + channel] = Math.round(base[target + channel] * (1 - alpha) + patch[from + channel] * alpha);
      changed++;
    }
  }
  return changed;
}

function outsideBox(mask: Buffer, width: number, box: CropBox): boolean {
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const x = index % width, y = Math.floor(index / width);
    if (x < box.left || x >= box.left + box.width || y < box.top || y >= box.top + box.height) return true;
  }
  return false;
}

/**
 * @description Replace the region of the source image with the provider's answer, and nothing else.
 * @param source - Normalized source PNG bytes of the target layer's image.
 * @param selection - Validated selection whose dimensions must match the source.
 * @param generated - Provider image bytes answering the crop from regionAnchor.
 * @returns New full-size PNG, the crop box, its size and how many pixels the mask touched.
 */
export async function compositeRegion(source: Buffer, selection: RegionSelection, generated: Buffer): Promise<CompositeResult> {
  const base = await sharp(source, DECODE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = base.info;
  if (width !== selection.sourceWidth || height !== selection.sourceHeight || channels !== 4) throw new ProjectError(409, 'region_edit_source_changed');
  const box = regionCropBox(selection), [patch, mask] = await Promise.all([generatedPatch(generated, box), regionMask(selection)]);
  if (outsideBox(mask, width, box)) throw new ProjectError(500, 'region_mask_invalid');
  const pixels = Buffer.from(base.data), changedPixels = blend(pixels, patch, mask, width, box);
  const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  if (png.length > PROJECT_LIMITS.imageBytes) throw new ProjectError(413, 'project_image_too_large');
  return { png, box, width, height, changedPixels };
}

/**
 * @description The instruction as an image-to-image edit of the crop; the provider never sees the rest of the image.
 * @param instruction - The person's validated instruction.
 * @returns Prompt text.
 */
export function regionPrompt(instruction: string): string {
  return [
    'Edit this image according to the instruction below.',
    `Instruction: ${instruction}`,
    'Change only what the instruction asks for. Keep the framing, perspective, lighting and colours of everything else.',
    'Return one image with exactly the same framing and aspect ratio, with no border, caption, text overlay or watermark.',
  ].join('\n');
}
