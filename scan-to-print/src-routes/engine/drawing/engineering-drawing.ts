/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the engineering drawing as SVG: a third-angle
 *                     |                             | six-view sheet (top over front, right beside front, back beyond
 *                     |                             | right, bottom under front — ASME Y14.3) at a standard drawing
 *                     |                             | scale, overall dimensions on front and top, a title block and
 *                     |                             | a numbered notes column that states where every extent came
 *                     |                             | from and what the reconstruction method cannot see. Outlines
 *                     |                             | are the exact re-projection of the occupancy grid, so the
 *                     |                             | drawing and the STL can never disagree: they are two readings
 *                     |                             | of one solid. Sheet units are millimetres throughout (viewBox
 *                     |                             | = A3 landscape), so a viewer that honours physical size prints
 *                     |                             | it at the stated scale.
 */

import type { Point2D, Vec3 } from '../geometry/geometry-types';
import { formatFixed } from '../geometry/format-number';
import { type Mask, maskStats } from '../raster/raster-types';
import { type Axis, type ViewName, VIEW_FRAMES, viewExtent } from '../grid/views';
import type { DimensionSource } from '../grid/silhouette-carver';
import { loopsToPath, traceContours } from './contours';

/** @description What the sheet is drawn from. */
export interface DrawingInput {
  /** Part name for the title block. */
  partName: string;
  /** Identifier printed as DRAWING NO. */
  drawingNumber: string;
  /** Object extents, millimetres. */
  sizeMm: Vec3;
  /** Provenance of each extent. */
  sources: Record<Axis, DimensionSource>;
  /** Millimetres per projection pixel (one pixel = one voxel). */
  voxelMm: number;
  /** Re-projections of the solid per view (from `projectGrid`); absent views are left blank. */
  views: Partial<Record<ViewName, Mask>>;
  /** One line naming the reconstruction method. */
  method: string;
  /** Solid volume, cubic millimetres. */
  volumeMm3: number;
  /** Facets in the exported STL. */
  triangleCount: number;
  /** The mesh validation verdict. */
  printable: boolean;
  /** ISO timestamp. */
  generatedAt: string;
  /** Numbered notes; the generator adds the dimension-source note first. */
  notes: string[];
}

/** @description A3 landscape, millimetres. */
export const SHEET = Object.freeze({ width: 420, height: 297, margin: 10, titleWidth: 150, titleHeight: 40 });

/** @description Standard drawing scales, descending. */
const SCALES: readonly number[] = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

/** @description Sheet cell for each view in third-angle layout: [column, row]. */
const CELL: Readonly<Record<ViewName, readonly [number, number]>> = Object.freeze({
  top: [1, 0], left: [0, 1], front: [1, 1], right: [2, 1], back: [3, 1], bottom: [1, 2],
});

/** @description Room kept around a view inside its cell for dimension lines and the label. */
const GUTTER_MM = 11;

/** @description XML-escape text content. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** @description The views area and the cell size derived from the sheet constants. */
function viewsArea(): { x: number; y: number; w: number; h: number; cw: number; ch: number } {
  const x = SHEET.margin;
  const y = SHEET.margin;
  const w = SHEET.width - 2 * SHEET.margin;
  const h = SHEET.height - 2 * SHEET.margin - SHEET.titleHeight;
  return { x, y, w, h, cw: w / 4, ch: h / 3 };
}

/**
 * @description Largest standard scale at which every present view fits its cell.
 * @param input - The drawing input.
 * @returns Sheet millimetres per object millimetre.
 */
export function chooseScale(input: DrawingInput): number {
  const { cw, ch } = viewsArea();
  let fit = Infinity;
  for (const name of Object.keys(input.views) as ViewName[]) {
    const { uMm, vMm } = viewExtent(VIEW_FRAMES[name], input.sizeMm);
    fit = Math.min(fit, (cw - 2 * GUTTER_MM) / uMm, (ch - 2 * GUTTER_MM) / vMm);
  }
  if (!Number.isFinite(fit)) return 1;
  return SCALES.find((s) => s <= fit) ?? SCALES[SCALES.length - 1];
}

/** @description `1:2`, `2:1`, `1:1` for a numeric scale. */
export function scaleLabel(scale: number): string {
  if (scale >= 1) return `${Number(scale.toFixed(2))}:1`;
  return `1:${Number((1 / scale).toFixed(2))}`;
}

/** @description Where a view's outline lands on the sheet: its placed bounding box. */
interface Placed { x1: number; y1: number; x2: number; y2: number; path: string }

/** @description Centre a view's silhouette in its cell and trace it. Null when the mask is empty. */
function placeView(name: ViewName, mask: Mask, voxelMm: number, scale: number): Placed | null {
  const { bbox } = maskStats(mask);
  if (!bbox) return null;
  const { x, y, cw, ch } = viewsArea();
  const [col, row] = CELL[name];
  const centre: Point2D = { x: x + (col + 0.5) * cw, y: y + (row + 0.5) * ch };
  const px = voxelMm * scale;
  const bboxCentre: Point2D = { x: (bbox.minX + bbox.maxX + 1) / 2, y: (bbox.minY + bbox.maxY + 1) / 2 };
  const offset: Point2D = { x: centre.x - bboxCentre.x * px, y: centre.y - bboxCentre.y * px };
  return {
    x1: offset.x + bbox.minX * px, y1: offset.y + bbox.minY * px,
    x2: offset.x + (bbox.maxX + 1) * px, y2: offset.y + (bbox.maxY + 1) * px,
    path: loopsToPath(traceContours(mask), px, offset),
  };
}

/** @description A horizontal dimension: extension lines, arrowed line, centred label above. */
function dimensionH(x1: number, x2: number, yLine: number, yFrom: number, label: string): string {
  const a = 1.5;
  return [
    `<line x1="${x1}" y1="${yFrom}" x2="${x1}" y2="${yLine + 1}" class="ext"/>`,
    `<line x1="${x2}" y1="${yFrom}" x2="${x2}" y2="${yLine + 1}" class="ext"/>`,
    `<line x1="${x1}" y1="${yLine}" x2="${x2}" y2="${yLine}" class="dim"/>`,
    `<polygon points="${x1},${yLine} ${x1 + a * 2},${yLine - a / 2} ${x1 + a * 2},${yLine + a / 2}" class="arrow"/>`,
    `<polygon points="${x2},${yLine} ${x2 - a * 2},${yLine - a / 2} ${x2 - a * 2},${yLine + a / 2}" class="arrow"/>`,
    `<text x="${(x1 + x2) / 2}" y="${yLine - 1}" class="dimtext" text-anchor="middle">${esc(label)}</text>`,
  ].join('');
}

/** @description A vertical dimension: extension lines, arrowed line, label rotated along it. */
function dimensionV(y1: number, y2: number, xLine: number, xFrom: number, label: string): string {
  const a = 1.5;
  const mid = (y1 + y2) / 2;
  return [
    `<line x1="${xFrom}" y1="${y1}" x2="${xLine + 1}" y2="${y1}" class="ext"/>`,
    `<line x1="${xFrom}" y1="${y2}" x2="${xLine + 1}" y2="${y2}" class="ext"/>`,
    `<line x1="${xLine}" y1="${y1}" x2="${xLine}" y2="${y2}" class="dim"/>`,
    `<polygon points="${xLine},${y1} ${xLine - a / 2},${y1 + a * 2} ${xLine + a / 2},${y1 + a * 2}" class="arrow"/>`,
    `<polygon points="${xLine},${y2} ${xLine - a / 2},${y2 - a * 2} ${xLine + a / 2},${y2 - a * 2}" class="arrow"/>`,
    `<text x="${xLine - 1}" y="${mid}" class="dimtext" text-anchor="middle" transform="rotate(-90 ${xLine - 1} ${mid})">${esc(label)}</text>`,
  ].join('');
}

/** @description Overall dimensions: width and height on the front view, depth on the top view. */
function renderDimensions(input: DrawingInput, placed: Partial<Record<ViewName, Placed>>): string {
  const parts: string[] = [];
  const mm = (v: number): string => formatFixed(v, 1);
  const front = placed.front;
  if (front) {
    parts.push(dimensionH(front.x1, front.x2, front.y2 + 6, front.y2 + 1, mm(input.sizeMm.x)));
    parts.push(dimensionV(front.y1, front.y2, front.x2 + 6, front.x2 + 1, mm(input.sizeMm.z)));
  }
  const top = placed.top;
  if (top) parts.push(dimensionV(top.y1, top.y2, top.x2 + 6, top.x2 + 1, mm(input.sizeMm.y)));
  return parts.join('');
}

/** @description Every placed view outline plus its label. */
function renderViews(input: DrawingInput, scale: number): { svg: string; placed: Partial<Record<ViewName, Placed>> } {
  const { x, y, cw, ch } = viewsArea();
  const placed: Partial<Record<ViewName, Placed>> = {};
  const parts: string[] = [];
  for (const name of Object.keys(CELL) as ViewName[]) {
    const [col, row] = CELL[name];
    const labelX = x + (col + 0.5) * cw;
    const labelY = y + (row + 1) * ch - 2;
    const mask = input.views[name];
    const view = mask ? placeView(name, mask, input.voxelMm, scale) : null;
    if (view) {
      placed[name] = view;
      parts.push(`<path d="${view.path}" class="outline" fill-rule="evenodd"/>`);
      parts.push(`<text x="${labelX}" y="${labelY}" class="label" text-anchor="middle">${name.toUpperCase()}</text>`);
    } else {
      parts.push(`<text x="${labelX}" y="${labelY}" class="label muted" text-anchor="middle">${name.toUpperCase()} (no view)</text>`);
    }
  }
  return { svg: parts.join(''), placed };
}

/** @description The third-angle projection symbol: end view (circles) left of the frustum. */
function projectionSymbol(x: number, y: number): string {
  return [
    `<circle cx="${x + 4}" cy="${y}" r="3.2" class="sym"/>`,
    `<circle cx="${x + 4}" cy="${y}" r="1.4" class="sym"/>`,
    `<polygon points="${x + 10},${y - 1.4} ${x + 18},${y - 3.2} ${x + 18},${y + 3.2} ${x + 10},${y + 1.4}" class="sym"/>`,
  ].join('');
}

/** @description The title block, bottom right. */
function titleBlock(input: DrawingInput, scale: number): string {
  const x = SHEET.width - SHEET.margin - SHEET.titleWidth;
  const y = SHEET.height - SHEET.margin - SHEET.titleHeight;
  const rows: Array<[string, string]> = [
    ['PART', input.partName], ['DRAWING NO', input.drawingNumber], ['DATE', input.generatedAt.slice(0, 10)],
    ['SCALE', scaleLabel(scale)], ['UNITS', 'mm'], ['METHOD', input.method],
    ['VOXEL', `${formatFixed(input.voxelMm, 2)} mm`], ['VOLUME', `${formatFixed(input.volumeMm3 / 1000, 2)} cm³`],
    ['FACETS', String(input.triangleCount)], ['PRINTABLE', input.printable ? 'yes (watertight)' : 'NO — see notes'],
  ];
  const cells = rows.map(([k, v], i) => {
    const cx = x + 2 + (i % 2) * 75;
    const cy = y + 6 + Math.floor(i / 2) * 6;
    return `<text x="${cx}" y="${cy}" class="tb"><tspan class="tbk">${k}</tspan> ${esc(v)}</text>`;
  });
  return [
    `<rect x="${x}" y="${y}" width="${SHEET.titleWidth}" height="${SHEET.titleHeight}" class="frame"/>`,
    ...cells,
    `<text x="${x + 2}" y="${y + SHEET.titleHeight - 2}" class="tb"><tspan class="tbk">PROJECTION</tspan> THIRD ANGLE</text>`,
    projectionSymbol(x + 52, y + SHEET.titleHeight - 4),
    `<text x="${x + SHEET.titleWidth - 2}" y="${y + SHEET.titleHeight - 2}" class="tb" text-anchor="end">oshal scan-to-print</text>`,
  ].join('');
}

/** @description Numbered notes, bottom left, dimension provenance first. */
function notesBlock(input: DrawingInput): string {
  const x = SHEET.margin;
  const y = SHEET.height - SHEET.margin - SHEET.titleHeight;
  const width = SHEET.width - 2 * SHEET.margin - SHEET.titleWidth;
  const provenance = `Extents: X ${formatFixed(input.sizeMm.x, 1)} (${input.sources.x}), Y ${formatFixed(input.sizeMm.y, 1)} (${input.sources.y}), Z ${formatFixed(input.sizeMm.z, 1)} (${input.sources.z}).`;
  const lines = [provenance, ...input.notes].slice(0, 6).map((n, i) => `${i + 1}. ${n.length > 150 ? `${n.slice(0, 147)}…` : n}`);
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${SHEET.titleHeight}" class="frame"/>`,
    `<text x="${x + 2}" y="${y + 5}" class="tbk">NOTES</text>`,
    ...lines.map((line, i) => `<text x="${x + 2}" y="${y + 10.5 + i * 5}" class="note">${esc(line)}</text>`),
  ].join('');
}

/** @description The stylesheet. Line weights follow the usual 0.35 / 0.18 mm split. */
const STYLE = [
  '.frame{fill:none;stroke:#000;stroke-width:0.5}', '.outline{fill:none;stroke:#000;stroke-width:0.35;stroke-linejoin:round}',
  '.ext,.dim{stroke:#000;stroke-width:0.18}', '.arrow{fill:#000;stroke:none}', '.sym{fill:none;stroke:#000;stroke-width:0.25}',
  '.label{font:3.2px sans-serif;fill:#000}', '.muted{fill:#888}', '.dimtext{font:2.8px sans-serif;fill:#000}',
  '.tb{font:2.6px sans-serif;fill:#000}', '.tbk{font:2.6px sans-serif;font-weight:bold;fill:#000}', '.note{font:2.4px sans-serif;fill:#000}',
].join('');

/**
 * @description Render the drawing sheet.
 * @param input - See {@link DrawingInput}.
 * @returns A complete SVG document.
 */
export function renderEngineeringDrawing(input: DrawingInput): string {
  const scale = chooseScale(input);
  const views = renderViews(input, scale);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.width}mm" height="${SHEET.height}mm" viewBox="0 0 ${SHEET.width} ${SHEET.height}">`,
    `<title>${esc(input.partName)} — engineering drawing</title>`,
    `<style>${STYLE}</style>`,
    `<rect x="0" y="0" width="${SHEET.width}" height="${SHEET.height}" fill="#fff"/>`,
    `<rect x="${SHEET.margin}" y="${SHEET.margin}" width="${SHEET.width - 2 * SHEET.margin}" height="${SHEET.height - 2 * SHEET.margin}" class="frame"/>`,
    views.svg,
    renderDimensions(input, views.placed),
    notesBlock(input),
    titleBlock(input, scale),
    '</svg>',
  ].join('\n');
}
