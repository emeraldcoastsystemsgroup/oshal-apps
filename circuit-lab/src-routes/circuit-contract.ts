/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Non-rigid mechanics: a torsion spring, pulleys joined by a
 *                     |                             | belt (the `belt` pin kind), a crank-slider.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A hobby servo, a bipolar stepper and a step/dir driver; a
 *                     |                             | load's constant torque (a lifted weight); a wire's optional
 *                     |                             | `route` (where its middle segment sits — drawing only).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Eight more parts (zener, lamp, regulator, op-amp, relay,
 *                     |                             | sequenced pin, H-bridge driver, 555 timer), the `text`
 *                     |                             | property type with the sequence regex shared with the
 *                     |                             | worker, and the gear's face width / bore / pressure angle.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the circuit contract the routes enforce
 *                     |                             | BEFORE the engine runs: the part library (every type, its
 *                     |                             | pins and their kinds, every property with unit, default
 *                     |                             | and range), the validators for a part, a wire, a whole
 *                     |                             | circuit and the transient settings, each refusing with
 *                     |                             | the field named, and the published description the
 *                     |                             | concierge reads. Mirrors engine/circuit_parts.py exactly;
 *                     |                             | tests/contract-parts.test.js diffs the two libraries.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | sim.syncSeconds (the firmware co-simulation step) is bounded here
 *                    |                             | too, so the route refuses it before the engine has to.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | A wire's route may be several bend points (`route.points`, at most
 *                     |                             | limits.maxRoutePoints) instead of one movable middle segment;
 *                     |                             | drawing only, validated with the field named on both sides.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | The solver knobs (BACKLOG B7): sim.reltol, sim.gmin and sim.method
 *                     |                             | (trap | gear) for a person who wants to choose — bounded here and
 *                     |                             | in the engine, published with the lab's defaults.
 */

export type PinKind = 'electrical' | 'shaft' | 'teeth' | 'belt';
export type PartCategory = 'electrical' | 'electromechanical' | 'mechanical';

export interface NumberProp { type: 'number'; unit: string; default: number | null; min: number; max: number; optional?: true }
export interface EnumProp { type: 'enum'; values: string[]; default: string }
export interface BooleanProp { type: 'boolean'; default: boolean }
export interface TextProp { type: 'text'; default: string; maxLength: number; pattern: string }
export type PropSpec = NumberProp | EnumProp | BooleanProp | TextProp;
export interface PartSpec { category: PartCategory; label: string; pins: Array<{ name: string; kind: PinKind }>; props: Record<string, PropSpec> }

const num = (unit: string, def: number | null, min: number, max: number, optional?: true): NumberProp => (optional ? { type: 'number', unit, default: def, min, max, optional } : { type: 'number', unit, default: def, min, max });
const en = (values: string[], def: string): EnumProp => ({ type: 'enum', values, default: def });
const bool = (def: boolean): BooleanProp => ({ type: 'boolean', default: def });
const text = (def: string, maxLength: number, pattern: string): TextProp => ({ type: 'text', default: def, maxLength, pattern });
/** One token per step: level (0..1, a fraction of highVolts) : seconds. Shared with engine/circuit_parts.py. */
export const SEQUENCE_PATTERN = String.raw`^\s*(?:(?:0|1|0?\.\d+):\d*\.?\d+(?:[eE]-?\d+)?\s*)+$`;
export const SEQUENCE_MAX_STEPS = 64;
/** An Arduino sketch: any text up to the cap (the compiler judges it). Shared with engine/circuit_parts.py. */
export const SKETCH_PATTERN = String.raw`^[\s\S]*$`;
export const SKETCH_MAX_CHARS = 8000;
export const DEFAULT_SKETCH = 'void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(500);\n}\n';
const pins = (...names: string[]) => names.map((name) => ({ name, kind: 'electrical' as PinKind }));

/** The part library — the same object engine/circuit_parts.py publishes with `--contract`. */
export const PART_LIBRARY: Readonly<Record<string, PartSpec>> = Object.freeze({
  ground: { category: 'electrical', label: 'Ground', pins: pins('gnd'), props: {} },
  junction: { category: 'electrical', label: 'Junction', pins: pins('n'), props: {} },
  battery: { category: 'electrical', label: 'Battery', pins: pins('+', '-'), props: { volts: num('V', 9, 0.1, 1000), internalOhms: num('ohm', 0.5, 0, 1e6), capacityMah: num('mAh', 500, 1, 1e6) } },
  source: { category: 'electrical', label: 'Signal source', pins: pins('+', '-'), props: { kind: en(['dc', 'pulse', 'sine'], 'pulse'), volts: num('V', 5, 0, 1000), offsetVolts: num('V', 0, -1000, 1000), frequencyHz: num('Hz', 1000, 0.001, 1e7), dutyPercent: num('%', 50, 0, 100) } },
  resistor: { category: 'electrical', label: 'Resistor', pins: pins('a', 'b'), props: { ohms: num('ohm', 220, 0.001, 1e9), ratedWatts: num('W', 0.25, 0.001, 1e4) } },
  potentiometer: { category: 'electrical', label: 'Potentiometer', pins: pins('a', 'w', 'b'), props: { ohms: num('ohm', 10000, 1, 1e9), position: num('fraction', 0.5, 0, 1) } },
  capacitor: { category: 'electrical', label: 'Capacitor', pins: pins('a', 'b'), props: { farads: num('F', 100e-6, 1e-12, 10), ratedVolts: num('V', 25, 1, 1e4) } },
  inductor: { category: 'electrical', label: 'Inductor', pins: pins('a', 'b'), props: { henries: num('H', 0.001, 1e-9, 100) } },
  diode: { category: 'electrical', label: 'Diode', pins: pins('a', 'k'), props: {} },
  led: { category: 'electrical', label: 'LED', pins: pins('a', 'k'), props: { color: en(['red', 'yellow', 'green', 'blue', 'white'], 'red'), maxMa: num('mA', 20, 0.1, 1000) } },
  switch: { category: 'electrical', label: 'Switch', pins: pins('a', 'b'), props: { closed: bool(true), toggleAtSeconds: num('s', null, 0, 1e4, true) } },
  npn: { category: 'electrical', label: 'NPN transistor', pins: pins('c', 'b', 'e'), props: {} },
  nmos: { category: 'electrical', label: 'N-channel MOSFET', pins: pins('d', 'g', 's'), props: {} },
  motor: { category: 'electromechanical', label: 'DC motor', pins: [...pins('+', '-'), { name: 'shaft', kind: 'shaft' }], props: { nominalVolts: num('V', 12, 0.1, 1000), stallAmps: num('A', 5, 0.001, 1000), noLoadRpm: num('rpm', 3000, 1, 100000), noLoadAmps: num('A', 0.2, 0, 1000), inductanceMh: num('mH', 1, 0.001, 1000), rotorInertiaGcm2: num('g*cm2', 10, 0.001, 1e6) } },
  gear: { category: 'mechanical', label: 'Gear', pins: [{ name: 'shaft', kind: 'shaft' }, { name: 'teeth', kind: 'teeth' }], props: { teeth: num('count', 20, 6, 400), moduleMm: num('mm', 1, 0.2, 20), inertiaGcm2: num('g*cm2', 5, 0, 1e6), faceWidthMm: num('mm', 8, 1, 200), boreMm: num('mm', 3, 0, 100), pressureAngleDeg: num('deg', 20, 14.5, 25) } },
  load: { category: 'mechanical', label: 'Load', pins: [{ name: 'shaft', kind: 'shaft' }], props: { inertiaGcm2: num('g*cm2', 50, 0, 1e7), frictionMnm: num('mN*m', 0, 0, 1e5), viscousMnmPerKrpm: num('mN*m/krpm', 0.1, 0, 1e5), torqueMnm: num('mN*m', 0, -1e5, 1e5) } },
  zener: { category: 'electrical', label: 'Zener diode', pins: pins('a', 'k'), props: { breakdownVolts: num('V', 5.1, 1, 200) } },
  lamp: { category: 'electrical', label: 'Lamp', pins: pins('a', 'b'), props: { ratedVolts: num('V', 12, 0.1, 1000), ratedWatts: num('W', 5, 0.01, 1e4) } },
  regulator: { category: 'electrical', label: 'Voltage regulator', pins: pins('in', 'gnd', 'out'), props: { outputVolts: num('V', 5, 1, 50), dropoutVolts: num('V', 2, 0, 5), maxAmps: num('A', 1, 0.01, 20) } },
  opamp: { category: 'electrical', label: 'Op-amp', pins: pins('+', '-', 'out', 'vcc', 'vee'), props: { gain: num('V/V', 100000, 10, 1e7), railDropVolts: num('V', 1, 0, 5) } },
  relay: { category: 'electrical', label: 'Relay', pins: pins('c+', 'c-', 'com', 'no', 'nc'), props: { coilOhms: num('ohm', 100, 1, 1e5), coilMh: num('mH', 10, 0.001, 1e4), pullInAmps: num('A', 0.03, 1e-4, 10) } },
  sequencer: { category: 'electrical', label: 'Sequenced pin', pins: pins('out', 'ref'), props: { highVolts: num('V', 5, 0, 1000), pattern: text('1:0.5 0:0.5', 400, SEQUENCE_PATTERN), repeat: bool(true) } },
  hbridge: { category: 'electrical', label: 'H-bridge driver', pins: pins('vcc', 'gnd', 'in1', 'in2', 'out1', 'out2'), props: { thresholdVolts: num('V', 2.5, 0.1, 100), onOhms: num('ohm', 0.2, 0.001, 100) } },
  timer555: { category: 'electrical', label: '555 timer', pins: pins('vcc', 'gnd', 'trig', 'thr', 'out', 'dis'), props: {} },
  servo: { category: 'electromechanical', label: 'Hobby servo', pins: [...pins('sig', 'v+', 'gnd'), { name: 'shaft', kind: 'shaft' }], props: {
    nominalVolts: num('V', 5, 3, 12), stallAmps: num('A', 0.7, 0.01, 20), runAmps: num('A', 0.2, 0, 10), stallTorqueMnm: num('mN*m', 180, 1, 1e5),
    noLoadDegPerS: num('deg/s', 500, 10, 5000), travelDeg: num('deg', 180, 10, 360), minPulseMs: num('ms', 1.0, 0.3, 3), maxPulseMs: num('ms', 2.0, 0.5, 4),
    idleAmps: num('A', 0.01, 0, 1), rotorInertiaGcm2: num('g*cm2', 500, 0.001, 1e6) } },
  stepper: { category: 'electromechanical', label: 'Stepper motor', pins: [...pins('a+', 'a-', 'b+', 'b-'), { name: 'shaft', kind: 'shaft' }], props: {
    stepsPerRev: num('count', 200, 4, 3200), phaseOhms: num('ohm', 2, 0.01, 1000), phaseMh: num('mH', 3, 0.001, 1000), ratedAmps: num('A', 1.7, 0.01, 50),
    holdingTorqueMnm: num('mN*m', 400, 0.1, 1e5), detentTorqueMnm: num('mN*m', 20, 0, 1e4), rotorInertiaGcm2: num('g*cm2', 54, 0.001, 1e6), dampingRatio: num('ratio', 0.15, 0.01, 1) } },
  stepdriver: { category: 'electrical', label: 'Step/dir driver', pins: pins('vm', 'gnd', 'step', 'dir', 'a+', 'a-', 'b+', 'b-'), props: {
    currentAmps: num('A', 1.0, 0.01, 20), microsteps: en(['1', '2', '4', '8', '16'], '1'), thresholdVolts: num('V', 1.5, 0.1, 20) } },
  spring: { category: 'mechanical', label: 'Torsion spring', pins: [{ name: 'a', kind: 'shaft' }, { name: 'b', kind: 'shaft' }], props: {
    stiffnessMnmPerDeg: num('mN*m/deg', 5, 0.001, 1e5), dampingMnmPerKrpm: num('mN*m/krpm', 1, 0, 1e5) } },
  pulley: { category: 'mechanical', label: 'Pulley', pins: [{ name: 'shaft', kind: 'shaft' }, { name: 'belt', kind: 'belt' }], props: {
    radiusMm: num('mm', 20, 1, 1000), inertiaGcm2: num('g*cm2', 5, 0, 1e6), gripN: num('N', 10, 0.01, 1e5) } },
  crank: { category: 'mechanical', label: 'Crank-slider', pins: [{ name: 'shaft', kind: 'shaft' }], props: {
    radiusMm: num('mm', 20, 1, 1000), rodMm: num('mm', 80, 2, 5000), sliderMassG: num('g', 100, 0.1, 1e5), dampingNsPerM: num('N*s/m', 0.5, 0, 1e4),
    springNPerM: num('N/m', 0, 0, 1e6), springRestMm: num('mm', 100, -5000, 5000), frictionN: num('N', 0, 0, 1e4) } },
  arduino: { category: 'electrical', label: 'Arduino Uno', pins: pins('5V', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'), props: {
    sketch: text(DEFAULT_SKETCH, SKETCH_MAX_CHARS, SKETCH_PATTERN) } },
});
export const PART_TYPES = Object.freeze(Object.keys(PART_LIBRARY));
/** The part types that drive a shaft train (one per train). */
export const DRIVER_TYPES = Object.freeze(['motor', 'servo', 'stepper']);
export const ROTATIONS = Object.freeze([0, 90, 180, 270]);
export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
export const LIMITS = Object.freeze({ maxParts: 200, maxWires: 400, maxRoutePoints: 16 });
/** The transient defaults; reltol is the lab's own, gmin and method are ngspice's. */
export const SIM_DEFAULTS = Object.freeze({ stopSeconds: 1.0, maxPoints: 20000, defaultPoints: 2000, startFromRest: true, reltol: 0.003, gmin: 1e-12, method: 'trap' });
export const SIM_LIMITS = Object.freeze({ stopSeconds: [1e-6, 600] as const, stepSeconds: [1e-9, 600] as const, syncSeconds: [4e-6, 10e-3] as const, reltol: [1e-6, 0.05] as const, gmin: [1e-15, 1e-6] as const });
/** The integration methods a person may choose (ngspice's trapezoidal default, or Gear for stiff, hard-switched circuits). */
export const SIM_METHODS = Object.freeze(['trap', 'gear'] as const);

/** @description A refused input; `field` names the offending field for the 400 body. */
export class ContractError extends Error {
  constructor(message: string, readonly field: string) { super(message); this.name = 'ContractError'; }
}

export interface CircuitPart { id: string; type: string; x: number; y: number; rotation: number; label: string; props: Record<string, number | string | boolean | null> }
export interface WireEnd { part: string; pin: string }
/** How a wire is drawn (canvas units): where its middle segment sits, or the bend points it passes through; the solver ignores it. */
export type WireRoute = { mid: number } | { points: Array<[number, number]> };
export interface CircuitWire { id: string; kind: PinKind; from: WireEnd; to: WireEnd; route?: WireRoute | null }
export interface SimSettings { stopSeconds: number; stepSeconds: number | null; startFromRest: boolean; syncSeconds?: number; reltol?: number; gmin?: number; method?: 'trap' | 'gear' }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** @description The kind of a part type's pin, or null when the pin does not exist. */
export function pinKind(type: string, pin: unknown): PinKind | null {
  const spec = PART_LIBRARY[type];
  if (!spec) return null;
  return spec.pins.find((p) => p.name === pin)?.kind ?? null;
}

/**
 * @description Normalise one part's properties against its type: defaults filled, ranges enforced,
 * unknown keys refused (a typo must never be a silent no-op).
 */
export function validateProps(type: string, raw: unknown, field: string): CircuitPart['props'] {
  const schema = PART_LIBRARY[type].props;
  const props = obj(raw) ? raw : {};
  for (const key of Object.keys(props)) if (!Object.prototype.hasOwnProperty.call(schema, key)) throw new ContractError(`${type} has no property ${key}`, `${field}.props.${key}`);
  const out: CircuitPart['props'] = {};
  for (const [key, spec] of Object.entries(schema)) {
    const value = props[key] === undefined ? spec.default : props[key];
    if (spec.type === 'number') {
      if (value === null || value === undefined) {
        if (spec.optional) { out[key] = null; continue; }
        throw new ContractError(`${key} is required`, `${field}.props.${key}`);
      }
      if (!isNum(value)) throw new ContractError(`${key} must be a number`, `${field}.props.${key}`);
      if (value < spec.min || value > spec.max) throw new ContractError(`${key} must be between ${spec.min} and ${spec.max} ${spec.unit}`, `${field}.props.${key}`);
      out[key] = value;
    } else if (spec.type === 'enum') {
      if (typeof value !== 'string' || !spec.values.includes(value)) throw new ContractError(`${key} must be one of ${spec.values.join(', ')}`, `${field}.props.${key}`);
      out[key] = value;
    } else if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') throw new ContractError(`${key} must be true or false`, `${field}.props.${key}`);
      out[key] = value;
    } else {
      if (typeof value !== 'string' || value.length > spec.maxLength || !new RegExp(spec.pattern).test(value)) throw new ContractError(`${key} must match ${spec.pattern} (at most ${spec.maxLength} characters)`, `${field}.props.${key}`);
      if (key === 'pattern') {
        const steps = parseSequence(value);
        if (steps.length > SEQUENCE_MAX_STEPS) throw new ContractError(`pattern has ${steps.length} steps; at most ${SEQUENCE_MAX_STEPS}`, `${field}.props.${key}`);
        if (steps.some(([, sec]) => !(sec > 0))) throw new ContractError('every step needs a positive duration', `${field}.props.${key}`);
      }
      out[key] = value;
    }
  }
  return out;
}

/** @description 'level:seconds …' → [[level, seconds]] (the contract regex has already shaped it). */
export function parseSequence(value: string): Array<[number, number]> {
  return value.trim().split(/\s+/).filter(Boolean).map((token) => { const [level, sec] = token.split(':'); return [Number(level), Number(sec)] as [number, number]; });
}

/** @description Validate one part (id kept when well-formed; `fallbackId` is used for updates). */
export function validatePart(raw: unknown, field = 'part', fallbackId?: string): CircuitPart {
  if (!obj(raw)) throw new ContractError('part must be an object', field);
  const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : fallbackId;
  if (!id || !ID_PATTERN.test(id)) throw new ContractError('id must be a letter followed by up to 23 letters, digits or underscores', `${field}.id`);
  const type = raw.type;
  if (typeof type !== 'string' || !PART_LIBRARY[type]) throw new ContractError(`unknown part type ${JSON.stringify(type)}`, `${field}.type`);
  const rotation = raw.rotation === undefined ? 0 : raw.rotation;
  if (!ROTATIONS.includes(rotation as number)) throw new ContractError('rotation must be 0, 90, 180 or 270', `${field}.rotation`);
  const x = raw.x === undefined ? 0 : raw.x, y = raw.y === undefined ? 0 : raw.y;
  if (!isNum(x)) throw new ContractError('x must be a number', `${field}.x`);
  if (!isNum(y)) throw new ContractError('y must be a number', `${field}.y`);
  if (raw.label !== undefined && raw.label !== null && typeof raw.label !== 'string') throw new ContractError('label must be text', `${field}.label`);
  return { id, type, x, y, rotation: rotation as number, label: String(raw.label ?? '').slice(0, 60), props: validateProps(type, raw.props, field) };
}

/** @description Validate a wire against the parts it joins: both ends exist, pins are of one kind, no self-loop. */
export function validateWire(raw: unknown, parts: CircuitPart[], field = 'wire', fallbackId?: string): CircuitWire {
  if (!obj(raw)) throw new ContractError('wire must be an object', field);
  const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : fallbackId;
  if (!id || !ID_PATTERN.test(id)) throw new ContractError('wire id must be a letter followed by up to 23 letters, digits or underscores', `${field}.id`);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const ends: Array<{ end: WireEnd; kind: PinKind }> = [];
  for (const endName of ['from', 'to'] as const) {
    const end = raw[endName];
    if (!obj(end) || typeof end.part !== 'string' || !byId.has(end.part)) throw new ContractError(`${endName}.part must name a part in the circuit`, `${field}.${endName}.part`);
    const kind = pinKind(byId.get(end.part)!.type, end.pin);
    if (!kind) throw new ContractError(`${byId.get(end.part)!.type} ${end.part} has no pin ${JSON.stringify(end.pin)}`, `${field}.${endName}.pin`);
    ends.push({ end: { part: end.part, pin: String(end.pin) }, kind });
  }
  if (ends[0].kind !== ends[1].kind) throw new ContractError(`a wire joins pins of one kind; ${ends[0].end.part}.${ends[0].end.pin} is ${ends[0].kind} and ${ends[1].end.part}.${ends[1].end.pin} is ${ends[1].kind}`, field);
  if (ends[0].end.part === ends[1].end.part && ends[0].end.pin === ends[1].end.pin) throw new ContractError('a wire cannot join a pin to itself', field);
  const wire: CircuitWire = { id, kind: ends[0].kind, from: ends[0].end, to: ends[1].end };
  if (raw.route !== undefined && raw.route !== null) wire.route = validateRoute(raw.route, `${field}.route`);
  return wire;
}

/**
 * @description A wire's drawing route: `{mid}` (where the middle segment of the three-segment path sits) or
 * `{points}` (1 to maxRoutePoints bend points [x, y] the wire passes through, pin to pin). Drawing only.
 */
export function validateRoute(raw: unknown, field: string): WireRoute {
  const route = obj(raw) ? raw : {};
  if (route.points !== undefined && route.mid !== undefined) throw new ContractError('a route is either {mid} or {points}, not both', field);
  if (route.points !== undefined) {
    if (!Array.isArray(route.points) || route.points.length < 1 || route.points.length > LIMITS.maxRoutePoints) throw new ContractError(`route.points must be a list of 1 to ${LIMITS.maxRoutePoints} bend points [x, y]`, `${field}.points`);
    const points = route.points.map((p, i): [number, number] => {
      if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) throw new ContractError('a bend point is [x, y] in canvas units', `${field}.points[${i}]`);
      return [p[0], p[1]];
    });
    return { points };
  }
  if (!isNum(route.mid)) throw new ContractError("route.mid must be a number (where the wire's middle segment sits)", `${field}.mid`);
  return { mid: route.mid };
}

const wireKey = (w: CircuitWire): string => [`${w.from.part}.${w.from.pin}`, `${w.to.part}.${w.to.pin}`].sort().join('|');

/** @description Validate a whole circuit: unique ids (case-insensitive), the caps, no duplicate wires. */
export function validateCircuit(raw: unknown): { parts: CircuitPart[]; wires: CircuitWire[] } {
  if (!obj(raw)) throw new ContractError('circuit must be an object', 'circuit');
  const partsIn = raw.parts === undefined ? [] : raw.parts, wiresIn = raw.wires === undefined ? [] : raw.wires;
  if (!Array.isArray(partsIn)) throw new ContractError('parts must be a list', 'parts');
  if (!Array.isArray(wiresIn)) throw new ContractError('wires must be a list', 'wires');
  if (partsIn.length > LIMITS.maxParts) throw new ContractError(`at most ${LIMITS.maxParts} parts`, 'parts');
  if (wiresIn.length > LIMITS.maxWires) throw new ContractError(`at most ${LIMITS.maxWires} wires`, 'wires');
  const parts: CircuitPart[] = [], seen = new Set<string>();
  partsIn.forEach((p, i) => {
    const part = validatePart(p, `parts[${i}]`);
    if (seen.has(part.id.toLowerCase())) throw new ContractError(`duplicate part id ${part.id} (ids are case-insensitive)`, `parts[${i}].id`);
    seen.add(part.id.toLowerCase());
    parts.push(part);
  });
  const wires: CircuitWire[] = [], keys = new Set<string>(), ids = new Set<string>();
  wiresIn.forEach((w, i) => {
    const wire = validateWire(w, parts, `wires[${i}]`);
    if (ids.has(wire.id)) throw new ContractError(`duplicate wire id ${wire.id}`, `wires[${i}].id`);
    if (keys.has(wireKey(wire))) throw new ContractError(`duplicate wire between ${wire.from.part}.${wire.from.pin} and ${wire.to.part}.${wire.to.pin}`, `wires[${i}]`);
    ids.add(wire.id); keys.add(wireKey(wire));
    wires.push(wire);
  });
  return { parts, wires };
}

/** @description Validate the transient settings (the engine re-derives the step when null). */
export function validateSim(raw: unknown): SimSettings {
  const sim = obj(raw) ? raw : {};
  const stop = sim.stopSeconds === undefined ? SIM_DEFAULTS.stopSeconds : sim.stopSeconds;
  if (!isNum(stop) || stop < SIM_LIMITS.stopSeconds[0] || stop > SIM_LIMITS.stopSeconds[1]) throw new ContractError(`stopSeconds must be between ${SIM_LIMITS.stopSeconds[0]} and ${SIM_LIMITS.stopSeconds[1]}`, 'sim.stopSeconds');
  let step: number | null = null;
  if (sim.stepSeconds !== undefined && sim.stepSeconds !== null) {
    if (!isNum(sim.stepSeconds) || sim.stepSeconds < SIM_LIMITS.stepSeconds[0] || sim.stepSeconds > SIM_LIMITS.stepSeconds[1]) throw new ContractError(`stepSeconds must be between ${SIM_LIMITS.stepSeconds[0]} and ${SIM_LIMITS.stepSeconds[1]}`, 'sim.stepSeconds');
    step = sim.stepSeconds;
  }
  const points = Math.floor(stop / (step ?? stop / SIM_DEFAULTS.defaultPoints)) + 1;
  if (points > SIM_DEFAULTS.maxPoints) throw new ContractError(`stopSeconds / stepSeconds is ${points} points; at most ${SIM_DEFAULTS.maxPoints} — raise stepSeconds`, 'sim.stepSeconds');
  if (points < 4) throw new ContractError('stepSeconds must give at least four points', 'sim.stepSeconds');
  const rest = sim.startFromRest === undefined ? SIM_DEFAULTS.startFromRest : sim.startFromRest;
  if (typeof rest !== 'boolean') throw new ContractError('startFromRest must be true or false', 'sim.startFromRest');
  const out: SimSettings = { stopSeconds: stop, stepSeconds: step, startFromRest: rest };
  // the firmware co-simulation step: the interval the sketch and the solver agree on (engine ARCHITECTURE 5b)
  if (sim.syncSeconds !== undefined && sim.syncSeconds !== null) {
    if (!isNum(sim.syncSeconds) || sim.syncSeconds < SIM_LIMITS.syncSeconds[0] || sim.syncSeconds > SIM_LIMITS.syncSeconds[1]) throw new ContractError(`syncSeconds (the firmware co-simulation step) must be between ${SIM_LIMITS.syncSeconds[0]} and ${SIM_LIMITS.syncSeconds[1]}`, 'sim.syncSeconds');
    out.syncSeconds = sim.syncSeconds;
  }
  return solverKnobs(sim, out);
}

/**
 * @description The solver knobs a person may set (each absent or null = the lab's default): reltol and gmin
 * bounded, method one of SIM_METHODS. Set any of them and the engine uses exactly these, with no automatic
 * relaxed retry over them.
 */
function solverKnobs(sim: Record<string, unknown>, out: SimSettings): SimSettings {
  for (const key of ['reltol', 'gmin'] as const) {
    const value = sim[key];
    if (value === undefined || value === null) continue;
    const [lo, hi] = SIM_LIMITS[key];
    if (!isNum(value) || value < lo || value > hi) throw new ContractError(`${key} must be between ${lo} and ${hi}`, `sim.${key}`);
    out[key] = value;
  }
  if (sim.method !== undefined && sim.method !== null) {
    if (typeof sim.method !== 'string' || !(SIM_METHODS as readonly string[]).includes(sim.method)) throw new ContractError(`method must be one of ${SIM_METHODS.join(', ')}`, 'sim.method');
    out.method = sim.method as SimSettings['method'];
  }
  return out;
}

/** @description The contract as `/capabilities` publishes it (what the concierge reads before editing). */
export function describeContract(): Record<string, unknown> {
  return {
    parts: PART_LIBRARY,
    limits: { maxParts: LIMITS.maxParts, maxWires: LIMITS.maxWires, maxRoutePoints: LIMITS.maxRoutePoints, rotations: [...ROTATIONS], idPattern: ID_PATTERN.source },
    sim: { defaults: SIM_DEFAULTS, limits: { stopSeconds: [...SIM_LIMITS.stopSeconds], stepSeconds: [...SIM_LIMITS.stepSeconds], syncSeconds: [...SIM_LIMITS.syncSeconds], reltol: [...SIM_LIMITS.reltol], gmin: [...SIM_LIMITS.gmin] }, methods: [...SIM_METHODS] },
    rules: [
      'A wire joins two pins of ONE kind: electrical to electrical, shaft to shaft (rigid coupling — the parts turn together), teeth to teeth (two gears mesh; external gears turn opposite ways), belt to belt (two pulleys share a belt).',
      'Ground is node 0. With no ground part, the first battery or source minus pin becomes the reference and a warning says so.',
      'A motor drives the shaft train reachable from its shaft pin; one motor per train. Every gear and load on that train is reflected onto the motor shaft by its ratio.',
      'Motors are identified from nameplate numbers: nominalVolts, stallAmps, noLoadRpm, noLoadAmps.',
      'The simulation is a transient from t = 0 with the circuit at rest (startFromRest); set it false for the DC steady state.',
      'The solver runs at the lab defaults and, when ngspice refuses a circuit, retries once with relaxed tolerances (a relaxed_tolerances warning). sim.reltol, sim.gmin and sim.method (trap | gear) choose them instead; set any and the run uses exactly those, with no automatic retry.',
      'Readings are in SI plus the units named: currents in A (LEDs also in mA), power in W, speed in rpm, torque in mN*m.',
      'A sequenced pin follows its pattern ("level:seconds …", level 0..1 of highVolts) and repeats it; it stands in for a programmed pin until firmware is in the loop.',
      'A relay closes NO (opens NC) when the coil current reaches pullInAmps and releases at 60 % of it. An H-bridge driver switches each output to vcc when its input is above thresholdVolts and to gnd when below. The 555 latches on the real 1/3 and 2/3 Vcc thresholds; its readings include the measured frequency and duty.',
      'A gear also carries faceWidthMm, boreMm and pressureAngleDeg for the CAD Studio hand-off (circuit-gear-to-cad); the solver ignores them.',
      'A servo (sig, v+, gnd, shaft) decodes the pulse width on sig (minPulseMs..maxPulseMs -> 0..travelDeg) and drives its shaft there at noLoadDegPerS with a position loop on a geared motor fed from v+; its readings include angleDeg, targetDeg and pulseMs. A stepper (a+ a- b+ b-, shaft) turns stepsPerRev per revolution; wire its coils to a stepdriver (vm gnd step dir a+ a- b+ b-), which advances the phase currents one step per rising edge on step (dir high = forward, microsteps as set); readings give angleDeg, loadAngleDeg, holding and slipped. A servo or stepper drives a gear train exactly like a motor.',
      'A load may carry a constant torqueMnm (a lifted weight): positive opposes its shaft\'s positive direction; it reflects through the signed gear ratio.',
      'Non-rigid links: a spring (pins a, b — both shaft) is a torsion spring between two shafts (stiffnessMnmPerDeg, dampingMnmPerKrpm) and reports twist and torque; two pulleys wired belt ↔ belt are a belt (omega2 / omega1 = r1 / r2) that slips once the belt force reaches the smaller gripN; a crank (shaft) is a crank-slider — the slider mass, damper, spring and friction act on the shaft through the exact crank kinematics, and x(<crank>) is the slider position in mm. Each side of a spring or belt is its own rotational node; one driver and at most one crank per rigidly linked train; a spring or belt whose two ends are already rigidly linked is refused.',
      'A wire may carry route: {mid} — where its middle segment is drawn — or route: {points: [[x, y], …]} — up to maxRoutePoints bends it is drawn through; the solver ignores both.',
    ],
    canvas: 'Positions x, y are canvas pixels (grid of 20). Rotation turns the symbol clockwise. angle(<driver>) in degrees is a signal for every motor, servo and stepper.',
  };
}
