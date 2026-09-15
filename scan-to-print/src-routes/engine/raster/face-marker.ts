/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (BACKLOG B9) — the orientation cube. A small paper
 *                     |                             | cube with one marker per face stands beside the object; the face
 *                     |                             | the camera sees names the canonical view, so assigning views stops
 *                     |                             | being a manual step. The detector is deterministic and has no
 *                     |                             | model: Otsu on darkness, 4-connected components, and for each
 *                     |                             | square candidate a (4 + 2)-cell grid sampled by majority over each
 *                     |                             | cell's central half — a solid black border ring and 16 data cells
 *                     |                             | read against a fixed six-code dictionary under all four rotations.
 *                     |                             | The codes were chosen by a deterministic greedy search (every row
 *                     |                             | and column mixed, seven to nine black cells) so any two faces, in
 *                     |                             | any rotation, differ in at least 6 cells and no face matches its
 *                     |                             | own rotation within 6; the spec re-verifies both. One wrong cell
 *                     |                             | is tolerated; exactly one known marker assigns a view, and
 *                     |                             | anything else (none, unknown, two) leaves the view to the person.
 */

import type { PixelBox, Raster } from './raster-types';
import { createMask } from './raster-types';
import { labelComponents, otsuThreshold } from './silhouette';
import { type ViewName, VIEW_NAMES } from '../grid/views';

/** @description Data cells per marker side; the marker is this plus a one-cell black border. */
export const FACE_MARKER_DATA = 4;

/**
 * @description The dictionary: one 16-cell code per face, row-major, `1` = black, as the face is
 * printed upright when seen from its own canonical view.
 */
export const FACE_MARKER_CODES: Readonly<Record<ViewName, string>> = Object.freeze({
  front: '0110110010100111',
  back: '0001110001110100',
  left: '0101100011100010',
  right: '1001111000011011',
  top: '0001000101111010',
  bottom: '0101011010110011',
});

/**
 * @description Detection bounds. `maxBitErrors` is 1 because the dictionary's minimum distance of 6
 * could correct 2 uniquely; accepting 1 keeps 4 cells of margin to any other face.
 */
export const FACE_MARKER_LIMITS = Object.freeze({
  /** Smallest cell, pixels, a marker must be photographed at. */
  minCellPx: 3,
  /** Largest relative difference between a candidate's width and height. */
  squareTolerance: 0.2,
  /** Wrong cells tolerated in a match. */
  maxBitErrors: 1,
});

/** @description One marker found in a photo. */
export interface FaceMarker {
  /** The face, and so the canonical view, it names. */
  view: ViewName;
  /** Clockwise rotation of the printed marker as it appears in the photo. */
  rotationDeg: 0 | 90 | 180 | 270;
  /** Cells that disagreed with the dictionary (0 or 1). */
  bitErrors: number;
  /** The marker's bounds, pixels (the black border's outer edge). */
  bbox: PixelBox;
}

/** @description What a photo says about its own view. */
export interface FaceMarkerScan {
  /** The view to assign: set only when exactly one known marker was found. */
  view: ViewName | null;
  /** Every known marker found. */
  markers: FaceMarker[];
  /** Square, black-bordered candidates whose code is not in the dictionary. */
  unknown: number;
  /** One sentence saying why the view is or is not assigned. */
  reason: string;
}

/** @description A code as 16 bits. */
function bitsOf(code: string): number[] {
  return [...code].map((c) => (c === '1' ? 1 : 0));
}

/** @description Rotate an N x N bit grid 90 degrees clockwise. */
function rotateClockwise(bits: number[]): number[] {
  const n = FACE_MARKER_DATA;
  const out = new Array<number>(n * n);
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) out[c * n + (n - 1 - r)] = bits[r * n + c];
  return out;
}

/** @description The dictionary expanded to every face in every rotation, in a fixed order. */
const DICTIONARY: ReadonlyArray<{ view: ViewName; rotationDeg: 0 | 90 | 180 | 270; bits: number[] }> = VIEW_NAMES.flatMap((view) => {
  const rotations: number[][] = [bitsOf(FACE_MARKER_CODES[view])];
  for (let k = 1; k < 4; k += 1) rotations.push(rotateClockwise(rotations[k - 1]));
  return rotations.map((bits, k) => ({ view, rotationDeg: (k * 90) as 0 | 90 | 180 | 270, bits }));
});

/**
 * @description The printable cell grid of one face: (4 + 2) x (4 + 2) cells, the border included,
 * `1` = black. A renderer draws it on white with at least one white cell of margin around it.
 * @param view - The face.
 * @returns Rows of cells, top first.
 */
export function faceMarkerCells(view: ViewName): number[][] {
  const data = bitsOf(FACE_MARKER_CODES[view]);
  const side = FACE_MARKER_DATA + 2;
  return Array.from({ length: side }, (_, r) => Array.from({ length: side }, (_, c) => {
    if (r === 0 || c === 0 || r === side - 1 || c === side - 1) return 1;
    return data[(r - 1) * FACE_MARKER_DATA + (c - 1)];
  }));
}

/** @description Darkness per pixel (255 - luminance), the value the threshold splits. */
function darkness(raster: Raster): Uint8Array {
  const out = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < out.length; i += 1) {
    const at = i * 4;
    out[i] = 255 - Math.round(0.299 * raster.data[at] + 0.587 * raster.data[at + 1] + 0.114 * raster.data[at + 2]);
  }
  return out;
}

/** @description Bounds of every labelled component, index = label. */
function componentBoxes(labels: Int32Array, count: number, width: number): Array<PixelBox | null> {
  const boxes: Array<PixelBox | null> = new Array(count).fill(null);
  for (let i = 0; i < labels.length; i += 1) {
    const id = labels[i];
    if (id === 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    const b = boxes[id];
    if (!b) { boxes[id] = { minX: x, minY: y, maxX: x, maxY: y }; continue; }
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }
  return boxes;
}

/** @description Majority of dark pixels over the central half of one grid cell. */
function sampleCell(dark: Uint8Array, width: number, box: PixelBox, row: number, col: number): number {
  const side = FACE_MARKER_DATA + 2;
  const cw = (box.maxX - box.minX + 1) / side;
  const ch = (box.maxY - box.minY + 1) / side;
  const x0 = Math.floor(box.minX + (col + 0.25) * cw);
  const x1 = Math.ceil(box.minX + (col + 0.75) * cw) - 1;
  const y0 = Math.floor(box.minY + (row + 0.25) * ch);
  const y1 = Math.ceil(box.minY + (row + 0.75) * ch) - 1;
  let on = 0;
  let total = 0;
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) { on += dark[y * width + x]; total += 1; }
  return on * 2 > total ? 1 : 0;
}

/** @description Is this component a candidate: square enough, large enough, clear of the image edge? */
function isCandidate(box: PixelBox, raster: Raster): boolean {
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const side = FACE_MARKER_DATA + 2;
  if (w < side * FACE_MARKER_LIMITS.minCellPx || h < side * FACE_MARKER_LIMITS.minCellPx) return false;
  if (Math.abs(w - h) > FACE_MARKER_LIMITS.squareTolerance * Math.max(w, h)) return false;
  return box.minX > 0 && box.minY > 0 && box.maxX < raster.width - 1 && box.maxY < raster.height - 1;
}

/** @description Read one candidate: null when it has no solid border or its data cells are uniform. */
function readCandidate(dark: Uint8Array, width: number, box: PixelBox): number[] | null {
  const side = FACE_MARKER_DATA + 2;
  const data: number[] = [];
  for (let r = 0; r < side; r += 1) {
    for (let c = 0; c < side; c += 1) {
      const bit = sampleCell(dark, width, box, r, c);
      const border = r === 0 || c === 0 || r === side - 1 || c === side - 1;
      if (border && bit === 0) return null;
      if (!border) data.push(bit);
    }
  }
  const ones = data.reduce((s, b) => s + b, 0);
  return ones === 0 || ones === data.length ? null : data;
}

/** @description The dictionary entry nearest a read code, when unique and within the error bound. */
function match(data: number[]): { view: ViewName; rotationDeg: 0 | 90 | 180 | 270; bitErrors: number } | null {
  let best: (typeof DICTIONARY)[number] | null = null;
  let bestErrors = Infinity;
  let tie = false;
  for (const entry of DICTIONARY) {
    let errors = 0;
    for (let i = 0; i < data.length; i += 1) if (data[i] !== entry.bits[i]) errors += 1;
    if (errors < bestErrors) { best = entry; bestErrors = errors; tie = false; } else if (errors === bestErrors) tie = true;
  }
  if (!best || tie || bestErrors > FACE_MARKER_LIMITS.maxBitErrors) return null;
  return { view: best.view, rotationDeg: best.rotationDeg, bitErrors: bestErrors };
}

/** @description The sentence the upload shows for a scan. */
function reasonFor(markers: FaceMarker[], unknown: number): string {
  if (markers.length === 1) return `The ${markers[0].view} face marker is visible, so this photo is the ${markers[0].view} view.`;
  if (markers.length > 1) return `Markers for ${markers.map((m) => m.view).join(' and ')} are both visible; assign this photo's view by hand.`;
  if (unknown > 0) return 'A marker-like square is visible but its pattern is not an orientation-cube face; assign this photo\'s view by hand.';
  return 'No orientation-cube marker is visible; assign this photo\'s view by hand.';
}

/**
 * @description Find the orientation-cube face markers in a photo and, when exactly one known marker
 * is visible, name the photo's canonical view. The object itself is never a marker: a candidate
 * needs a solid black border ring AND mixed data cells, which a uniformly dark part cannot show.
 * @param raster - The decoded photo.
 * @returns The scan: the view (or null), every known marker, the count of unknown candidates, why.
 */
export function detectFaceMarkers(raster: Raster): FaceMarkerScan {
  const dark = darkness(raster);
  const threshold = otsuThreshold(dark);
  const mask = createMask(raster.width, raster.height);
  for (let i = 0; i < dark.length; i += 1) mask.data[i] = dark[i] > threshold ? 1 : 0;
  const { labels, sizes } = labelComponents(mask);
  const boxes = componentBoxes(labels, sizes.length, raster.width);
  const markers: FaceMarker[] = [];
  let unknown = 0;
  for (let id = 1; id < boxes.length; id += 1) {
    const box = boxes[id];
    if (!box || !isCandidate(box, raster)) continue;
    const data = readCandidate(mask.data, raster.width, box);
    if (!data) continue;
    const found = match(data);
    if (found) markers.push({ ...found, bbox: box }); else unknown += 1;
  }
  return { view: markers.length === 1 ? markers[0].view : null, markers, unknown, reason: reasonFor(markers, unknown) };
}

/**
 * @description One face as a printable SVG square of `sideMm`, the marker on white with one cell of
 * margin. Print the six, fold them onto a cube so each reads upright from its own canonical view,
 * and stand the cube beside the object, not touching it, smaller than the object in every photo.
 * @param view - The face.
 * @param sideMm - Printed side of the whole face, millimetres.
 * @returns SVG text.
 * @throws RangeError when the side is not a positive number.
 */
export function faceMarkerSvg(view: ViewName, sideMm: number): string {
  if (!(sideMm > 0) || !Number.isFinite(sideMm)) throw new RangeError('sideMm must be a positive number');
  const cells = faceMarkerCells(view);
  const n = cells.length + 2;
  const rects: string[] = [];
  cells.forEach((row, r) => row.forEach((bit, c) => { if (bit) rects.push(`<rect x="${c + 1}" y="${r + 1}" width="1" height="1"/>`); }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sideMm}mm" height="${sideMm}mm" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><title>${view}</title><rect width="${n}" height="${n}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
}
