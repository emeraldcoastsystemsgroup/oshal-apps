/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the pixel vocabulary the silhouette extractor,
 *                     |                             | the carvers and the drawing generator share. A raster is always
 *                     |                             | RGBA (four bytes per pixel, row-major, top-left origin) because
 *                     |                             | that is what the decoder emits and one fixed layout is the only
 *                     |                             | way the engine stays decoder-agnostic. A mask is one byte per
 *                     |                             | pixel, 0 or 1, never a threshold-in-disguise grey value.
 */

/** @description Decoded image bytes: RGBA, row-major, top-left origin, 4 bytes per pixel. */
export interface Raster {
  /** Pixel columns. */
  width: number;
  /** Pixel rows. */
  height: number;
  /** `width · height · 4` bytes, RGBA interleaved. */
  data: Uint8Array;
}

/** @description A binary image: one byte per pixel, exactly 0 (background) or 1 (object). */
export interface Mask {
  /** Pixel columns. */
  width: number;
  /** Pixel rows. */
  height: number;
  /** `width · height` bytes, each 0 or 1. */
  data: Uint8Array;
}

/** @description Inclusive pixel bounds of the set pixels of a mask. */
export interface PixelBox {
  /** Leftmost set column. */
  minX: number;
  /** Topmost set row. */
  minY: number;
  /** Rightmost set column (inclusive). */
  maxX: number;
  /** Bottom-most set row (inclusive). */
  maxY: number;
}

/** @description Summary numbers about a mask that the registration and the UI both read. */
export interface MaskStats {
  /** Set pixels. */
  pixels: number;
  /** `pixels / (width · height)`, 0..1. */
  coverage: number;
  /** Bounds of the set pixels, or null when the mask is empty. */
  bbox: PixelBox | null;
}

/**
 * @description Allocate an all-zero mask.
 * @param width - Pixel columns.
 * @param height - Pixel rows.
 * @returns A mask with every pixel 0.
 * @throws RangeError when either dimension is not a positive integer.
 */
export function createMask(width: number, height: number): Mask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Mask dimensions must be positive integers, received ${width}x${height}`);
  }
  return { width, height, data: new Uint8Array(width * height) };
}

/**
 * @description Set pixels from a predicate — the way every synthetic test shape is built, and the
 * way a caller turns any geometric description into a mask without touching pixel indices.
 * @param width - Pixel columns.
 * @param height - Pixel rows.
 * @param inside - True for pixels that belong to the object; receives the pixel centre.
 * @returns A new mask.
 */
export function maskFromPredicate(
  width: number,
  height: number,
  inside: (x: number, y: number) => boolean,
): Mask {
  const mask = createMask(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inside(x + 0.5, y + 0.5)) mask.data[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * @description Count, coverage and bounding box of a mask's set pixels.
 * @param mask - Mask to measure.
 * @returns The stats; `bbox` is null for an empty mask.
 */
export function maskStats(mask: Mask): MaskStats {
  let pixels = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < mask.height; y += 1) {
    const row = y * mask.width;
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[row + x] === 0) continue;
      pixels += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const bbox = pixels === 0 ? null : { minX, minY, maxX, maxY };
  return { pixels, coverage: pixels / (mask.width * mask.height), bbox };
}

/**
 * @description Sample a mask at integer pixel coordinates, treating everything outside the image
 * as background. Out-of-range reads are the common case for a carver whose voxel projects beyond
 * a photo's edge, and "outside the photo" must mean "not the object".
 * @param mask - Mask to read.
 * @param x - Column.
 * @param y - Row.
 * @returns 1 when the pixel is set and inside the image, else 0.
 */
export function maskAt(mask: Mask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.data[y * mask.width + x];
}
