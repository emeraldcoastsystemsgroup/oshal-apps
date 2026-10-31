/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the print set as data, for any product.
 *                     |                             | What a set is begun with (the design's printed parts with their
 *                     |                             | own fields - count, material, orientation, layer height,
 *                     |                             | supports, notes - and the bought rows, each validated by field
 *                     |                             | and capped so the whole body stays inside the kernel's JSON
 *                     |                             | bound), what one exported part carries (the CAD Studio source
 *                     |                             | and the kernel's report as read), the file name a part id
 *                     |                             | derives (never a path a request names), and the print sheet,
 *                     |                             | the BOM and the manifest built from those rows. A part without
 *                     |                             | a program or a build is listed unprintable with its reason;
 *                     |                             | nothing is invented for a field the design does not state.
 */

import { ModelError } from './phase-model';

/** @description The engines whose design a print set can be made from. */
export const SET_ENGINES = ['embodied', 'cad-studio'] as const;
export type SetEngine = typeof SET_ENGINES[number];

/** @description The constant file names of a set; every other file is `<partId>.stl`. */
export const SET_FILES = Object.freeze({ sheet: 'PRINT-SHEET.md', bom: 'bom.csv', manifest: 'manifest.json', state: 'set.json', sent: 'sent.json' });
export const SET_SCHEMA = 'design-studio-print-set/1';
/** A part id: the design's own (embodied's `coxa-bracket`) or a CAD Studio model id (a UUID). */
export const PART_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The caps that keep a begin body under the kernel's 100 KB JSON bound (64 parts and 64 bought rows at their longest fit). */
export const CAPS = Object.freeze({ parts: 64, bought: 64, name: 120, notes: 400, short: 80, orientation: 120, source: 200, route: 300, revision: 200, qty: 1000, stlBytes: 8 * 1024 * 1024 });

/** @description One printed part as the design states it; a null field is one the design did not state. */
export interface PartInput {
  id: string; name: string; qty: number; material: string | null; printNotes: string | null; option: string | null; link: string | null;
  massEachG: number | null; orientation: string | null; layerHeightMm: number | null; supports: boolean | null;
  /** Whether the design carries a program (or a built model) for the part; false is listed unprintable at finish unless a file arrives. */
  program: boolean;
}
/** @description One bought row as the design states it. */
export interface BoughtInput { id: string; name: string; qty: number; massEachG: number | null; approxUsdEach: number | null; role: string | null; source: string | null }
/** @description What a set is begun with. */
export interface SetInput { engine: SetEngine; designRevision: string; designRoute: string; parts: PartInput[]; bought: BoughtInput[] }
/** @description Where an exported file came from: the person's own CAD Studio part at a revision. */
export interface PartSource { engine: 'cad-studio'; modelId: string; revision: number; route: string; title: string | null }
/** @description The kernel's report for the revision, as CAD Studio answered it. */
export interface PartReport { valid: boolean; massG: number | null; volumeMm3: number | null; extentsMm: { min: number[]; max: number[] } | null; densityGcm3: number | null; engineBuild: string | null }
/** @description One part's outcome in a set. */
export type PartResult =
  | { status: 'exported'; file: string; sha256: string; bytes: number; triangles: number; kernelMassEachG: number | null; volumeCm3: number | null; extentsMm: number[] | null; densityGcm3: number | null; source: PartSource; report: PartReport }
  | { status: 'unprintable'; reason: string };
/** @description A set in progress or finished, as kept on disk (`set.json`). */
export interface SetState extends SetInput { schema: string; project: string; name: string; begunAt: string; results: Record<string, PartResult> }
/** @description One hand-off to a printer as the print service answered it. */
export interface SentRecord { file: string; printerId: string; printerLabel: string | null; submissionId: string | null; uploaded: boolean; started: boolean; message: string | null; at: string }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, cap: number): string | null => { if (v === undefined || v === null) return null; const s = String(v).replace(/\s+/g, ' ').trim().slice(0, cap); return s || null; };
const num = (v: unknown, field: string): number | null => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new ModelError(`${field} must be a non-negative number`, 'bad_print_set', field); return n; };
const bool = (v: unknown, field: string): boolean | null => { if (v === undefined || v === null) return null; if (typeof v !== 'boolean') throw new ModelError(`${field} must be true or false`, 'bad_print_set', field); return v; };
const required = (v: unknown, cap: number, field: string): string => { const s = text(v, cap); if (!s) throw new ModelError(`${field} is required`, 'bad_print_set', field); return s; };
const count = (v: unknown, field: string): number => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > CAPS.qty) throw new ModelError(`${field} must be a whole number from 1 to ${CAPS.qty}`, 'bad_print_set', field); return n; };

/** @description A part id from the wire, or a refusal naming the field. */
export function partId(value: unknown, field = 'id'): string {
  const s = String(value ?? '').toLowerCase();
  if (!PART_ID.test(s)) throw new ModelError('a part id is lowercase letters, digits and dashes, at most 41 characters', 'bad_print_set', field);
  return s;
}

/** @description The file a part's STL is written to: derived from the validated id, never from a request's path. */
export function fileFor(id: string): string { return `${partId(id)}.stl`; }

function part(raw: unknown, i: number): PartInput {
  const at = `parts[${i}]`;
  if (!isRecord(raw)) throw new ModelError(`${at} must be an object`, 'bad_print_set', at);
  return {
    id: partId(raw.id, `${at}.id`), name: required(raw.name, CAPS.name, `${at}.name`), qty: count(raw.qty, `${at}.qty`), material: text(raw.material, CAPS.short), printNotes: text(raw.printNotes, CAPS.notes),
    option: text(raw.option, CAPS.short), link: text(raw.link, CAPS.short), massEachG: num(raw.massEachG, `${at}.massEachG`), orientation: text(raw.orientation, CAPS.orientation),
    layerHeightMm: num(raw.layerHeightMm, `${at}.layerHeightMm`), supports: bool(raw.supports, `${at}.supports`), program: raw.program === true,
  };
}
function bought(raw: unknown, i: number): BoughtInput {
  const at = `bought[${i}]`;
  if (!isRecord(raw)) throw new ModelError(`${at} must be an object`, 'bad_print_set', at);
  return { id: required(raw.id, CAPS.short, `${at}.id`), name: required(raw.name, CAPS.name, `${at}.name`), qty: count(raw.qty, `${at}.qty`), massEachG: num(raw.massEachG, `${at}.massEachG`), approxUsdEach: num(raw.approxUsdEach, `${at}.approxUsdEach`), role: text(raw.role, CAPS.notes), source: text(raw.source, CAPS.source) };
}

/**
 * @description Validate what a set is begun with: the engine, the design revision and route, the printed parts and the bought rows.
 * @param value - The request body.
 * @returns The validated input.
 * @throws ModelError naming the field.
 */
export function validateSetInput(value: unknown): SetInput {
  if (!isRecord(value)) throw new ModelError('the body is {engine, designRevision, designRoute, parts, bought}', 'bad_print_set', 'body');
  if (!(SET_ENGINES as readonly string[]).includes(String(value.engine))) throw new ModelError(`engine must be one of ${SET_ENGINES.join(', ')}`, 'bad_print_set', 'engine');
  const parts = Array.isArray(value.parts) ? value.parts : [];
  if (!parts.length) throw new ModelError('parts must list the design\'s printed parts', 'bad_print_set', 'parts');
  if (parts.length > CAPS.parts) throw new ModelError(`a set carries at most ${CAPS.parts} printed parts (the kernel's body bound); split the product`, 'too_many_parts', 'parts', 413);
  const rows = Array.isArray(value.bought) ? value.bought : [];
  if (rows.length > CAPS.bought) throw new ModelError(`a set carries at most ${CAPS.bought} bought rows`, 'too_many_parts', 'bought', 413);
  const out = parts.map(part);
  const ids = new Set(out.map((p) => p.id));
  if (ids.size !== out.length) throw new ModelError('a part id appears twice', 'bad_print_set', 'parts');
  return { engine: value.engine as SetEngine, designRevision: required(value.designRevision, CAPS.revision, 'designRevision'), designRoute: required(value.designRoute, CAPS.route, 'designRoute'), parts: out, bought: rows.map(bought) };
}

/**
 * @description Validate an exported part's meta: where the file came from and the kernel's report as read.
 * @param value - The `meta` field, parsed.
 * @returns The source and the report.
 * @throws ModelError naming the field.
 */
export function validatePartMeta(value: unknown): { source: PartSource; report: PartReport } {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.report)) throw new ModelError('meta is {source:{engine, modelId, revision, route}, report:{valid, massG, volumeMm3, extentsMm, densityGcm3}}', 'bad_print_set', 'meta');
  const s = value.source; const r = value.report;
  if (s.engine !== 'cad-studio') throw new ModelError('source.engine is cad-studio: a file is exported through CAD Studio', 'bad_print_set', 'meta.source.engine');
  const modelId = String(s.modelId ?? '').toLowerCase();
  if (!UUID.test(modelId)) throw new ModelError('source.modelId is the CAD Studio model id (a UUID)', 'bad_print_set', 'meta.source.modelId');
  const revision = Number(s.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new ModelError('source.revision is the built revision number', 'bad_print_set', 'meta.source.revision');
  if (typeof r.valid !== 'boolean') throw new ModelError('report.valid is the kernel\'s own verdict', 'bad_print_set', 'meta.report.valid');
  const e = r.extentsMm;
  const extents = isRecord(e) && Array.isArray(e.min) && Array.isArray(e.max) && e.min.length === 3 && e.max.length === 3 && [...e.min, ...e.max].every((x) => Number.isFinite(Number(x))) ? { min: e.min.map(Number), max: e.max.map(Number) } : null;
  return {
    source: { engine: 'cad-studio', modelId, revision, route: required(s.route, CAPS.route, 'meta.source.route'), title: text(s.title, CAPS.name) },
    report: { valid: r.valid, massG: num(r.massG, 'meta.report.massG'), volumeMm3: num(r.volumeMm3, 'meta.report.volumeMm3'), extentsMm: extents, densityGcm3: num(r.densityGcm3, 'meta.report.densityGcm3'), engineBuild: text(r.engineBuild, CAPS.short) },
  };
}

/** @description A reason a part is unprintable, as the page or this package states it. */
export function validateReason(value: unknown): string {
  const s = text(value, CAPS.notes);
  if (!s) throw new ModelError('an unprintable part needs its reason', 'bad_print_set', 'reason');
  return s;
}

/** @description A printer hand-off as the print service answered it, kept beside the set. */
export function validateSent(value: unknown, files: Set<string>): SentRecord {
  if (!isRecord(value)) throw new ModelError('the body is {file, printerId, printerLabel, submissionId, uploaded, started, message}', 'bad_print_set', 'body');
  const file = String(value.file ?? '');
  if (!files.has(file)) throw new ModelError('file must be a file of this print set', 'bad_print_set', 'file');
  return { file, printerId: required(value.printerId, CAPS.short, 'printerId'), printerLabel: text(value.printerLabel, CAPS.name), submissionId: text(value.submissionId, CAPS.short), uploaded: value.uploaded === true, started: value.started === true, message: text(value.message, CAPS.notes), at: new Date().toISOString() };
}

const stated = (v: unknown, unit = ''): string => (v === null || v === undefined || v === '' ? 'not stated' : `${v}${unit}`);
const g = (v: number | null): string => (v === null ? 'not stated' : `${Math.round(v)} g`);
const csv = (v: unknown): string => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

type ExportedRow = PartInput & Extract<PartResult, { status: 'exported' }>;
type UnprintableRow = PartInput & Extract<PartResult, { status: 'unprintable' }>;

/** The exported and the unprintable rows of a set, in the design's order. */
export function rowsOf(state: SetState): { exported: ExportedRow[]; unprintable: UnprintableRow[] } {
  const exported: ExportedRow[] = []; const unprintable: UnprintableRow[] = [];
  for (const p of state.parts) {
    const r = state.results[p.id];
    if (r && r.status === 'exported') exported.push({ ...p, ...r });
    else unprintable.push({ ...p, status: 'unprintable', reason: r ? r.reason : p.program ? 'no file was exported for this part' : 'no CAD program in the design for this part' });
  }
  return { exported, unprintable };
}

/** One sheet table line. */
function sheetLine(r: ExportedRow): string {
  const sup = r.supports === null ? 'not stated' : r.supports ? 'yes' : 'no';
  return `| \`${r.file}\` | ${r.qty} | ${stated(r.material)} | ${stated(r.orientation)} | ${stated(r.layerHeightMm, ' mm')} | ${sup} | ${r.extentsMm ? r.extentsMm.join(' × ') : 'not stated'} | ${g(r.kernelMassEachG)}${r.densityGcm3 !== null ? ` at ${r.densityGcm3} g/cm³` : ''} (design ${g(r.massEachG)}) | ${r.option ? `**${r.option} only** · ` : ''}${stated(r.printNotes)} |`;
}

/**
 * @description The print sheet as Markdown: what to print, how many, in what, how, from the parts' own fields.
 * @param state - The set.
 * @param finishedAt - When.
 * @returns The sheet text.
 */
export function printSheet(state: SetState, finishedAt: string): string {
  const { exported, unprintable } = rowsOf(state);
  const core = exported.filter((r) => !r.option); const options = [...new Set(exported.filter((r) => r.option).map((r) => r.option as string))];
  const pieces = (rs: ExportedRow[]): number => rs.reduce((n, r) => n + r.qty, 0);
  const grams = (rs: ExportedRow[]): number => rs.reduce((n, r) => n + r.qty * (r.kernelMassEachG ?? 0), 0);
  const lines = [
    `# ${state.name} print set (design revision ${state.designRevision}, generated ${finishedAt.slice(0, 10)})`, '',
    `Every file here came out of CAD Studio's kernel from the part's own program (the design at \`${state.designRoute}\`, each part exported once as the person's own CAD Studio part); the mass of each is the kernel's solid volume at the density CAD Studio's report states, beside the design's own estimate. Orientation, layer height and supports are the design's words where it states them and "not stated" where it does not. A sliced part weighs what the slicer says.`, '',
    `**Core build:** ${pieces(core)} piece${pieces(core) === 1 ? '' : 's'} from ${core.length} file${core.length === 1 ? '' : 's'}, about ${Math.round(grams(core))} g of solid by the kernel.${options.map((o) => { const rs = exported.filter((r) => r.option === o); return ` **The ${o} option adds** ${pieces(rs)} piece${pieces(rs) === 1 ? '' : 's'} from ${rs.length} file${rs.length === 1 ? '' : 's'} (${Math.round(grams(rs))} g).`; }).join('')}`, '',
    '| file | print | material | orientation | layer | supports | extents mm (x × y × z) | each by the kernel | notes |', '|---|---|---|---|---|---|---|---|---|',
    ...core.map(sheetLine), ...exported.filter((r) => r.option).map(sheetLine), '',
  ];
  lines.push('## Unprintable', '');
  if (unprintable.length) lines.push(...unprintable.map((r) => `- **${r.name}** (\`${r.id}\`, × ${r.qty}): ${r.reason}`), '', 'These parts are listed, not skipped: the set is not complete until each has a program that builds and exports watertight.', '');
  else lines.push('None: every printed part of the design is in this set.', '');
  lines.push('## Bought parts', '', `The bill of materials beside this sheet (\`${SET_FILES.bom}\`) lists the ${state.bought.length} bought row${state.bought.length === 1 ? '' : 's'} of the design with the printed parts.`, '',
    '## Checks the files passed', '', `Each STL was parsed back and checked watertight (every edge on exactly two triangles, no degenerate triangle); the triangle counts and the sha256 of every file are in \`${SET_FILES.manifest}\`.`, '');
  return lines.join('\n');
}

/**
 * @description The bill of materials as CSV: the printed parts of the set (kind printed) and the design's bought rows (kind bought).
 * @param state - The set.
 * @returns CSV text with a header.
 */
export function bomCsv(state: SetState): string {
  const { exported, unprintable } = rowsOf(state);
  const header = ['id', 'kind', 'name', 'qty', 'massEachG', 'totalG', 'approxUsdEach', 'approxUsdTotal', 'option', 'role', 'source', 'file'];
  const lines = [header.join(',')];
  for (const r of exported) lines.push([r.id, 'printed', r.name, r.qty, r.kernelMassEachG === null ? '' : Math.round(r.kernelMassEachG), r.kernelMassEachG === null ? '' : Math.round(r.kernelMassEachG * r.qty), '', '', r.option ?? '', r.link ?? '', 'CAD Studio kernel', r.file].map(csv).join(','));
  for (const r of unprintable) lines.push([r.id, 'unprintable', r.name, r.qty, r.massEachG === null ? '' : Math.round(r.massEachG), r.massEachG === null ? '' : Math.round(r.massEachG * r.qty), '', '', r.option ?? '', r.link ?? '', r.reason, ''].map(csv).join(','));
  for (const b of state.bought) lines.push([b.id, 'bought', b.name, b.qty, b.massEachG === null ? '' : b.massEachG, b.massEachG === null ? '' : Math.round(b.massEachG * b.qty * 100) / 100, b.approxUsdEach === null ? '' : b.approxUsdEach, b.approxUsdEach === null ? '' : Math.round(b.approxUsdEach * b.qty * 100) / 100, '', b.role ?? '', b.source ?? '', ''].map(csv).join(','));
  return lines.join('\n') + '\n';
}

/**
 * @description The manifest: every part with its file's sha256, the unprintable parts with their reasons, the bought rows and the sheet and BOM digests.
 * @param state - The set.
 * @param finishedAt - When.
 * @param digests - sha256 and bytes of the sheet and the BOM as written.
 * @returns The manifest object (its own sha256 is computed over the file once written).
 */
export function manifestOf(state: SetState, finishedAt: string, digests: { sheet: { sha256: string; bytes: number }; bom: { sha256: string; bytes: number } }): Record<string, unknown> {
  const { exported, unprintable } = rowsOf(state);
  const files = [...exported.map((r) => ({ file: r.file, kind: 'stl', sha256: r.sha256, bytes: r.bytes })), { file: SET_FILES.sheet, kind: 'sheet', ...digests.sheet }, { file: SET_FILES.bom, kind: 'bom', ...digests.bom }];
  return {
    schema: SET_SCHEMA, project: state.project, name: state.name, engine: state.engine, designRevision: state.designRevision, designRoute: state.designRoute, begunAt: state.begunAt, finishedAt,
    parts: exported.map(({ status: _s, report, ...r }) => ({ ...r, report })),
    unprintable: unprintable.map((r) => ({ id: r.id, name: r.name, qty: r.qty, reason: r.reason })),
    bought: state.bought, files,
    totals: { files: files.length, stlFiles: exported.length, pieces: exported.reduce((n, r) => n + r.qty, 0), kernelMassG: Math.round(exported.reduce((n, r) => n + r.qty * (r.kernelMassEachG ?? 0), 0)), unprintable: unprintable.length, watertight: exported.length },
  };
}
