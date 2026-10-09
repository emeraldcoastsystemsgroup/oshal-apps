/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S4 — the Floater as a RECORD instead of a folder of
 *                     |                             | frozen output. The kind this lab owns (solar-dynastat) with
 *                     |                             | the figures it requires, its fabrication outputs, its force
 *                     |                             | models and its LIMIT ROWS (the reference design's own "Not
 *                     |                             | true, and important" section as data — a kind with none is a
 *                     |                             | load-time refusal, D4); the seed vector read from the committed
 *                     |                             | design_snapshot.json; the committed export run read back as
 *                     |                             | evaluation 1 with every file hashed and every validator kept;
 *                     |                             | the BOM-vs-as-built BUDGET CHECK that is RED at +274.3 g and
 *                     |                             | blocks parts-complete (D6); and the STAGE, computed on read
 *                     |                             | and never stored (D2), rendered with the sentence that
 *                     |                             | `fabricable` is not a safety claim. Nothing here invents a
 *                     |                             | number: every figure is read from a committed file.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | An evaluation's engine build hash is a string, not
 *                     |                             | string|null: the nullable type is what let a run be
 *                     |                             | stored without naming its engine. The route now refuses
 *                     |                             | to seed when the hash cannot be taken (D5), so the draft
 *                     |                             | never carries a null.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '@/shared/logger';
import { listEnvelopes } from './force-model-envelopes';

const logger = createChildLogger({ module: 'aero-lab-floater-record' });

/** The sentence every surface that renders a stage renders with it (ADR-160 D6). */
export const FABRICABLE_SENTENCE = 'fabricable means the files are complete and self-consistent. It does not mean the machine is safe to build, fly or wet.';

/** ADR-160 D2: five stages, each defined by what the record can currently produce. */
export type Stage = 'concept' | 'sized' | 'parts-complete' | 'fabricable' | 'built';

/** The stages in order, so a surface can draw the ladder. */
export const STAGES: readonly Stage[] = ['concept', 'sized', 'parts-complete', 'fabricable', 'built'];

/** @description One "what is not true" sentence as data: an id, the sentence, what would retire it, and whether it blocks `built` (D4). */
export interface LimitRow {
  id: string;
  sentence: string;
  retireWhen: string;
  blocking: boolean;
}

/** @description A kind this lab owns: what it requires, what it emits, what it must not claim. */
export interface VehicleKind {
  id: string;
  lab: 'aero-lab';
  label: string;
  /** Every figure an evaluation must carry for the record to be `sized` at its vector. */
  requiredFigures: readonly string[];
  /** The fabrication outputs `fabricable` requires, by name. */
  fabricationOutputs: readonly string[];
  /** The force models (declared in force-model-envelopes.json) that answer for this kind. */
  forceModels: readonly string[];
  limits: readonly LimitRow[];
}

/** @description Refuse a kind that declares no limits: a model that silently drops "what is not true" is worse than the document it replaced (D4).
 * @param kind - The kind. @returns The same kind. @throws Error naming the kind. */
export function assertKindDeclared(kind: VehicleKind): VehicleKind {
  if (!kind.limits.length) throw new Error(`aero-lab: kind "${kind.id}" declares no limits — "what is not true" is a required field, not a courtesy (ADR-160 D4)`);
  if (!kind.requiredFigures.length) throw new Error(`aero-lab: kind "${kind.id}" declares no required figures, so nothing could ever be sized`);
  const declared = new Set(listEnvelopes().map((e) => e.id));
  const undeclared = kind.forceModels.filter((m) => !declared.has(m));
  if (undeclared.length) throw new Error(`aero-lab: kind "${kind.id}" names force models with no declared envelope: ${undeclared.join(', ')} (ADR-160 D7)`);
  return kind;
}

/** The Floater's kind. The limit rows are the reference design's own honest-limits section, sentence by sentence. */
export const FLOATER_KIND: VehicleKind = assertKindDeclared({
  id: 'solar-dynastat',
  lab: 'aero-lab',
  label: 'Solar dynastat — a partially buoyant solar aircraft that closes its 24 h energy loop',
  requiredFigures: ['trim_V_ms', 'load_W', 'P_prop_W', 'cap_Wh', 'min_soc', 'harvest_Wh', 'CL', 'CD', 'Re_wing'],
  fabricationOutputs: ['wing.stl', 'wing_panel_left.stl', 'wing_panel_right.stl', 'hull.stl', 'vehicle_full.stl', 'ribs.dxf', 'airfoil_template.dxf', 'airfoil.dat', 'hull_gore.dxf', 'hull_gore.svg', 'three_view.svg', 'BOM.csv', 'BUILD_SHEET.md'],
  forceModels: ['aeropolar', 'aerosurface', 'solar'],
  limits: [
    { id: 'nothing-built', sentence: 'Nothing was built. No hardware, no wind tunnel, no flight. Every number is simulation output.', retireWhen: 'a measured quantity from a physical object is recorded against its designed value', blocking: true },
    { id: 'ideal-chain', sentence: 'The numbers here come from the ideal propulsion chain; the real-chain promotion gate is red (BACKLOG A) and these energy numbers are not re-certified on real hardware physics.', retireWhen: 'a real-chain candidate passes validation cases A-D and the 72 h mission and the reference outputs are regenerated from it', blocking: true },
    { id: 'real-parts-heavier', sentence: 'Real parts are 274 g heavier than the certified ledger (pack 197 Wh/kg against 250, motor/ESC/prop 120 g against 55.2, an MPPT the ledger carried as 0 g); the as-built craft needs a bigger hull and a bigger pack.', retireWhen: 'the mass budget closes: the design vector is re-sized at the real parts and the evaluation at that vector carries a green budget check', blocking: true },
    { id: 'vent-ballonet-undesigned', sentence: 'The vent / ballonet is undesigned and unbilled. A sealed envelope cannot take the diurnal superheat cycle at this scale (+25.6 K / +9.1 kPa measured); any sealed build is gated on it.', retireWhen: 'a vent or ballonet is designed, billed in the ledger and its mass carried through the sizing', blocking: true },
    { id: 'party-helium', sentence: 'Party helium does not fly: 80 % purity drops f 0.800 to 0.703 (measured), gas mass 253 to 568 g, and the craft closes on no pack. Welding-grade only.', retireWhen: 'the build sheet names a 99.9 %+ helium source and the weigh-off confirms f at fill', blocking: false },
    { id: 'no-structural-analysis', sentence: 'No structural analysis. Nobody has checked whether the spar survives flight loads.', retireWhen: 'a structural check of the spar and wing under flight loads is recorded against the current vector', blocking: true },
  ],
});

/** @description sha256 over the canonical (key-sorted) JSON of a design vector: the identity an evaluation is pinned to.
 * @param vector - Any JSON value. @returns Hex sha256. */
export function designVectorFingerprint(vector: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(vector)), 'utf8').digest('hex');
}

/** @description One committed file of the export run, by name and bytes. */
export interface ReferenceFile { name: string; bytes: number; sha256: string }

/** @description One row of the as-built ledger V2_CONFIG.md tabulates: certified grams against real parts. */
export interface LedgerRow { item: string; certifiedG: number; asBuiltG: number; deltaG: number }

/** @description Everything the committed export run says about itself, read from the files rather than typed. */
export interface ReferenceDesign {
  dir: string;
  /** design_snapshot.json, verbatim. */
  snapshot: Record<string, unknown>;
  files: ReferenceFile[];
  /** verify_*.json by file name, verbatim. */
  validators: Record<string, unknown>;
  /** BOM.csv's "TOTAL all-up, OPTION A pack" row, grams. */
  bomOptionATotalG: number;
  /** V2_CONFIG.md's "All-up ledger (pack A), grams" table: the rows and the ALL-UP line. */
  ledger: { rows: LedgerRow[]; certifiedG: number; asBuiltG: number; deltaG: number };
}

/** Parse one CSV line with double-quoted fields (the shape BOM.csv is written in). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; } else field += c;
  }
  out.push(field);
  return out;
}

/** @description BOM.csv's option-A all-up total, grams. @param csv - The file text. @returns The total. @throws When the row is absent. */
export function bomOptionATotalG(csv: string): number {
  const header = csvFields(csv.split(/\r?\n/)[0] ?? '');
  const totalCol = header.indexOf('total_mass_g');
  if (totalCol < 0) throw new Error('reference-design/BOM.csv: no total_mass_g column');
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const fields = csvFields(line);
    if (fields[0]?.startsWith('TOTAL all-up, OPTION A')) {
      const g = Number(fields[totalCol]);
      if (!Number.isFinite(g)) throw new Error('reference-design/BOM.csv: the option-A total is not a number');
      return g;
    }
  }
  throw new Error('reference-design/BOM.csv: no "TOTAL all-up, OPTION A pack" row');
}

/** A markdown table cell to a number: strips bold markers, an em dash is zero delta. */
function cellNumber(cell: string): number {
  const text = cell.replace(/\*/g, '').trim();
  if (text === '—' || text === '-' || text === '') return 0;
  const n = Number(text.replace(/^\+/, ''));
  if (!Number.isFinite(n)) throw new Error(`reference-design/V2_CONFIG.md: ledger cell "${cell.trim()}" is not a number`);
  return n;
}

/** @description The as-built ledger table in V2_CONFIG.md ("| item | v1 certified | as-built | delta |" through the ALL-UP line).
 * @param markdown - The file text. @returns Rows and the ALL-UP totals. @throws When the table is absent or does not sum. */
export function asBuiltLedger(markdown: string): ReferenceDesign['ledger'] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\|\s*item\s*\|\s*v1 certified\s*\|\s*as-built\s*\|\s*delta\s*\|/.test(l));
  if (start < 0) throw new Error('reference-design/V2_CONFIG.md: the as-built ledger table is absent');
  const rows: LedgerRow[] = [];
  let total: LedgerRow | null = null;
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1);
    if (cells.length !== 4) break;
    const row = { item: cells[0].replace(/\*/g, '').trim(), certifiedG: cellNumber(cells[1]), asBuiltG: cellNumber(cells[2]), deltaG: cellNumber(cells[3]) };
    if (row.item === 'ALL-UP') { total = row; break; }
    rows.push(row);
  }
  if (!total || !rows.length) throw new Error('reference-design/V2_CONFIG.md: the as-built ledger has no ALL-UP line');
  const sum = (pick: (r: LedgerRow) => number): number => Math.round(rows.reduce((a, r) => a + pick(r), 0) * 10) / 10;
  if (sum((r) => r.certifiedG) !== total.certifiedG || sum((r) => r.asBuiltG) !== total.asBuiltG) {
    throw new Error(`reference-design/V2_CONFIG.md: the ledger rows sum to ${sum((r) => r.certifiedG)} / ${sum((r) => r.asBuiltG)} g, the ALL-UP line says ${total.certifiedG} / ${total.asBuiltG} g`);
  }
  return { rows, certifiedG: total.certifiedG, asBuiltG: total.asBuiltG, deltaG: Math.round((total.asBuiltG - total.certifiedG) * 10) / 10 };
}

/** @description Read the committed export run: the snapshot, every file hashed, every validator, and the two ledgers. Fails closed on anything missing.
 * @param packageDir - The package root holding `reference-design/`. @returns The reference design. */
export function loadReferenceDesign(packageDir: string): ReferenceDesign {
  const dir = path.join(packageDir, 'reference-design');
  const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'design_snapshot.json'), 'utf8')) as Record<string, unknown>;
  const files: ReferenceFile[] = [];
  const validators: Record<string, unknown> = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const bytes = fs.readFileSync(path.join(dir, name));
    files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    if (/^verify_.*\.json$/.test(name)) validators[name] = JSON.parse(bytes.toString('utf8'));
  }
  const ledger = asBuiltLedger(fs.readFileSync(path.join(dir, 'V2_CONFIG.md'), 'utf8'));
  const bom = bomOptionATotalG(fs.readFileSync(path.join(dir, 'BOM.csv'), 'utf8'));
  if (bom !== ledger.certifiedG) throw new Error(`reference-design: BOM.csv option-A total ${bom} g and V2_CONFIG.md's certified ledger ${ledger.certifiedG} g disagree`);
  logger.info({ files: files.length, validators: Object.keys(validators).length, certifiedG: ledger.certifiedG, asBuiltG: ledger.asBuiltG }, 'reference design read');
  return { dir, snapshot, files, validators, bomOptionATotalG: bom, ledger };
}

/** @description The budget check ADR-160 D6 makes a GATE: real parts summed against the ledger the sizing closed on. */
export interface BudgetCheck {
  status: 'green' | 'red';
  certifiedG: number;
  asBuiltG: number;
  deltaG: number;
  /** Grams of excess the check tolerates: zero, because the sizing closed at the certified mass and any excess is unsized mass. */
  toleranceG: number;
  rows: LedgerRow[];
  blocks: 'parts-complete';
  why: string;
}

/** @description Compare the as-built ledger to the certified one. Red on any excess: the point of the check is the 274 g (D6).
 * @param ledger - The two ledgers. @returns The check. */
export function budgetCheck(ledger: ReferenceDesign['ledger']): BudgetCheck {
  const red = ledger.deltaG > 0;
  return {
    status: red ? 'red' : 'green',
    certifiedG: ledger.certifiedG,
    asBuiltG: ledger.asBuiltG,
    deltaG: ledger.deltaG,
    toleranceG: 0,
    rows: ledger.rows,
    blocks: 'parts-complete',
    why: red
      ? `real parts sum to ${ledger.asBuiltG} g against the ${ledger.certifiedG} g ledger the sizing closed on: +${ledger.deltaG} g of mass nothing was sized for. The budget must close (printed + bought + the energy store, and the sizing recomputed AT that mass) before the record can be parts-complete (ADR-160 D6).`
      : `real parts sum to ${ledger.asBuiltG} g, inside the ${ledger.certifiedG} g ledger the sizing closed on`,
  };
}

/** @description The Floater's design vector — the authored part (D1) — read from the committed snapshot. */
export interface FloaterSeed {
  kind: string;
  name: string;
  designVector: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

/** @description The seed: what a person would type, read from design_snapshot.json rather than from prose. @param ref - The reference design. @returns The seed. */
export function floaterSeed(ref: ReferenceDesign): FloaterSeed {
  const s = ref.snapshot;
  const hull = (s.hull ?? {}) as Record<string, unknown>;
  return {
    kind: FLOATER_KIND.id,
    name: 'Floater',
    designVector: {
      f_buoyancy: s.f_buoyancy,
      planform: s.planform,
      airfoil: s.airfoil_cst,
      hull: { shape: hull.shape, film: hull.film, n_gores: hull.n_gores, seam_allowance_mm: hull.seam_allowance_mm },
      site: s.site,
      pack: 'A',
    },
    provenance: {
      source: 'reference-design/design_snapshot.json',
      snapshotProvenance: s.provenance,
      note: 'The authored part of the record (ADR-160 D1). The hull dimensions, mass ledger and performance are DERIVED and live on evaluation 1, not here.',
    },
  };
}

/** @description The engine fingerprints an evaluation carries (D5): the package, the generator, the vendored engine tree by its build hash, and the run's own date. */
export interface EvaluationFingerprints {
  package: 'aero-lab';
  packageVersion: string;
  generator: string;
  engineBuildHash: string;
  run: string;
  note: string;
}

/** @description What an evaluation row holds before it is stored. */
export interface EvaluationDraft {
  sequence: number;
  mediumId: 'air';
  vectorFingerprint: string;
  engineFingerprints: EvaluationFingerprints;
  result: Record<string, unknown>;
}

/** @description The committed export run as evaluation 1 of the Floater: its figures, the derived hull, the budget check, every artifact hashed and every validator kept.
 * @param ref - The reference design. @param seed - The seed it evaluates. @param engine - This package's version and vendored engine tree hash. @returns The evaluation. */
export function firstEvaluation(ref: ReferenceDesign, seed: FloaterSeed, engine: { packageVersion: string; engineBuildHash: string }): EvaluationDraft {
  const s = ref.snapshot;
  return {
    sequence: 1,
    mediumId: 'air',
    vectorFingerprint: designVectorFingerprint(seed.designVector),
    engineFingerprints: {
      package: 'aero-lab',
      packageVersion: engine.packageVersion,
      generator: 'engine/export_build_files.py',
      engineBuildHash: engine.engineBuildHash,
      run: 'reference-design/ — one committed export run, report dated 2026-08-03',
      note: 'The run predates the record. The engine build hash names the tree vendored in this package, which the folder\'s README states produced it; recorded at seed time, not at the run.',
    },
    result: {
      figures: s.performance,
      hull: s.hull,
      ledgerKg: s.ledger_kg,
      ledgerSumKg: s.ledger_sum_kg,
      packOptions: s.pack_options,
      budget: budgetCheck(ref.ledger),
      artifacts: ref.files,
      validators: ref.validators,
      medium: { id: 'air', atmosphereAt500m: s.atmosphere_500m, note: 'the ISA column at the design altitude, as the snapshot recorded it' },
    },
  };
}

/** @description What a stored evaluation looks like to the stage function. */
export interface EvaluationLike {
  sequence: number;
  mediumId: string;
  vectorFingerprint: string;
  result: Record<string, unknown>;
}

/** @description The stage, computed on read, with what blocks the next one and the sentence D6 requires. */
export interface StageView {
  stage: Stage;
  reached: Stage[];
  next: Stage | null;
  blockedBy: string[];
  because: string;
  currentVectorFingerprint: string;
  /** The evaluation the stage rests on, by sequence, or null at `concept`. */
  sizedBy: number | null;
  openLimits: LimitRow[];
  fabricable: string;
}

/** Does an evaluation carry every figure the kind requires, as finite numbers? */
function carriesRequiredFigures(kind: VehicleKind, evaluation: EvaluationLike): boolean {
  const figures = (evaluation.result.figures ?? {}) as Record<string, unknown>;
  return kind.requiredFigures.every((f) => Number.isFinite(Number(figures[f])));
}

/** @description The stage function (D2): nobody sets it, it is what the record can currently produce, and a changed vector drops it back.
 * @param kind - The kind. @param designVector - The record's current vector. @param evaluations - Every evaluation stored against the record.
 * @returns The stage and why. */
export function stageOf(kind: VehicleKind, designVector: unknown, evaluations: readonly EvaluationLike[]): StageView {
  const current = designVectorFingerprint(designVector);
  const base = { currentVectorFingerprint: current, openLimits: [...kind.limits], fabricable: FABRICABLE_SENTENCE };
  const sized = evaluations.filter((e) => e.vectorFingerprint === current && carriesRequiredFigures(kind, e)).sort((a, b) => b.sequence - a.sequence)[0];
  if (!sized) {
    const stale = evaluations.length ? ` ${evaluations.length} evaluation(s) exist at other vectors; the vector changed and they no longer count.` : '';
    return { ...base, stage: 'concept', reached: ['concept'], next: 'sized', sizedBy: null, blockedBy: ['no evaluation at the current design vector carries every figure the kind requires'], because: `a named design vector exists and nothing has been evaluated at it.${stale}` };
  }
  const budget = sized.result.budget as BudgetCheck | undefined;
  const blockedBy: string[] = [];
  if (!budget) blockedBy.push('the evaluation carries no mass budget check');
  else if (budget.status !== 'green') blockedBy.push(`the mass budget is RED: ${budget.why}`);
  blockedBy.push('no parts model is recorded against this vector (every part printed with material, print notes, mass and a CAD program, or bought with mass, price and a source line)');
  return { ...base, stage: 'sized', reached: ['concept', 'sized'], next: 'parts-complete', sizedBy: sized.sequence, blockedBy, because: `evaluation ${sized.sequence} computed every figure the kind requires at the current vector (${kind.requiredFigures.join(', ')}).` };
}
