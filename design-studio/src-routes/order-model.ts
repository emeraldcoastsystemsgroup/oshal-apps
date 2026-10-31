/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D3 as built (0.4.0): the closed vocabulary of an engine order. The partner names an action and its input; nothing here carries a URL, so the page can only ever call the fixed engine routes it maps each action to, with the person's own session.
 */
import { ModelError, PHASE_KINDS } from './phase-model';

/** @description What the partner may order. */
export const ORDER_ACTIONS = ['open', 'read', 'cad-create', 'cad-edit', 'circuit-create', 'circuit-edit', 'press'] as const;
export type OrderAction = typeof ORDER_ACTIONS[number];

/** @description The engine reads an order may name; each needs the id field beside it when one is listed. */
export const READ_TARGETS: Readonly<Record<string, string | null>> = Object.freeze({
  'cad-contract': null, 'cad-models': null, 'cad-model': 'modelId',
  'circuit-contract': null, 'circuit-examples': null, 'circuit-drivers': null, 'circuit-designs': null, 'circuit-design': 'designId',
  'motor-catalog': null, 'physics-status': null, 'physics-reports': null, printers: null,
});

/** @description The poster buttons an order may press: every one measures or makes, none closes a phase, ticks the bench or sends to a printer. */
export const PRESSABLE = Object.freeze(['Create the parts in CAD Studio', 'Build the plant', 'Run the baselines', 'Train the policy', 'Certify', 'Make the print set']);

const CAD_EDITS = ['add', 'update', 'remove'];
const CIRCUIT_EDITS = ['add_part', 'update_part', 'remove_part', 'connect', 'disconnect', 'run'];
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const NAME_CAP = 200;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const refuse = (message: string, field: string): never => { throw new ModelError(message, 'bad_order', field); };
function idOf(v: unknown, field: string): string { if (typeof v !== 'string' || !ID.test(v)) refuse(`${field} is an id`, field); return v as string; }
function nameOf(v: unknown, field: string): string { if (typeof v !== 'string' || !v.trim()) refuse(`${field} is required`, field); return (v as string).trim().slice(0, NAME_CAP); }

function readInput(i: Record<string, unknown>): Record<string, unknown> {
  const what = String(i.what ?? '');
  if (!Object.prototype.hasOwnProperty.call(READ_TARGETS, what)) refuse(`what is one of ${Object.keys(READ_TARGETS).join(', ')}`, 'input.what');
  const field = READ_TARGETS[what];
  return field ? { what, [field]: idOf(i[field], `input.${field}`) } : { what };
}
function cadCreate(i: Record<string, unknown>): Record<string, unknown> {
  if (!isObject(i.base)) refuse('base is the part\'s base, as cad-contract states it', 'input.base');
  if (i.features !== undefined && !Array.isArray(i.features)) refuse('features is a list', 'input.features');
  return { name: nameOf(i.name, 'input.name'), base: i.base, features: i.features ?? [] };
}
function cadEdit(i: Record<string, unknown>): Record<string, unknown> {
  const op = String(i.op ?? '');
  if (!CAD_EDITS.includes(op)) refuse(`op is one of ${CAD_EDITS.join(', ')}`, 'input.op');
  const out: Record<string, unknown> = { modelId: idOf(i.modelId, 'input.modelId'), op };
  if (op !== 'add') out.featureId = idOf(i.featureId, 'input.featureId');
  if (op !== 'remove') { if (!isObject(i.feature)) refuse('feature is the feature, as cad-contract states it', 'input.feature'); out.feature = i.feature; }
  return out;
}
function circuitCreate(i: Record<string, unknown>): Record<string, unknown> {
  if (i.example !== undefined) return { example: idOf(i.example, 'input.example'), title: i.title === undefined ? undefined : nameOf(i.title, 'input.title') };
  if (!Array.isArray(i.parts) || !Array.isArray(i.wires)) refuse('an example, or parts and wires as circuit-contract states them', 'input.parts');
  return { title: nameOf(i.title, 'input.title'), parts: i.parts, wires: i.wires };
}
function circuitEdit(i: Record<string, unknown>): Record<string, unknown> {
  const op = String(i.op ?? '');
  if (!CIRCUIT_EDITS.includes(op)) refuse(`op is one of ${CIRCUIT_EDITS.join(', ')}`, 'input.op');
  const out: Record<string, unknown> = { designId: idOf(i.designId, 'input.designId'), op };
  if (op === 'update_part' || op === 'remove_part') out.partId = idOf(i.partId, 'input.partId');
  if (op === 'disconnect') out.wireId = idOf(i.wireId, 'input.wireId');
  if (op === 'add_part' || op === 'update_part' || op === 'connect') { if (!isObject(i.body)) refuse('body is the part or wire, as circuit-contract states it', 'input.body'); out.body = i.body; }
  return out;
}
function pressInput(i: Record<string, unknown>): Record<string, unknown> {
  const phase = String(i.phase ?? '');
  if (!(PHASE_KINDS as readonly string[]).includes(phase)) refuse(`phase is one of ${PHASE_KINDS.join(', ')}`, 'input.phase');
  if (!PRESSABLE.includes(String(i.button ?? ''))) refuse(`button is one of ${PRESSABLE.join(', ')}; closing a phase, the bench checklist and a printer stay the person's`, 'input.button');
  return { phase, button: i.button };
}

/**
 * @description Validate an order against the closed vocabulary.
 * @param body - The request body: {action, input}.
 * @returns The action and the input reduced to the fields the action reads.
 */
export function validateOrder(body: unknown): { action: OrderAction; input: Record<string, unknown> } {
  const b = isObject(body) ? body : {};
  const action = String(b.action ?? '') as OrderAction;
  if (!ORDER_ACTIONS.includes(action)) refuse(`action is one of ${ORDER_ACTIONS.join(', ')}`, 'action');
  const i = isObject(b.input) ? b.input : {};
  const input = { open: () => ({}), read: readInput, 'cad-create': cadCreate, 'cad-edit': cadEdit, 'circuit-create': circuitCreate, 'circuit-edit': circuitEdit, press: pressInput }[action](i);
  return { action, input };
}
