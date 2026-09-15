/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the rig contract every route, tool and the
 *                     |                             | surface enforce: a rig is CHANNELS (one hobby or bus servo
 *                     |                             | each, with its calibration — centre pulse, microseconds per
 *                     |                             | degree, reversal, hard pulse clamps — and its SOFTWARE
 *                     |                             | LIMITS in mechanism degrees), MECHANISMS (an eye gimbal, lids,
 *                     |                             | a neck, a jaw, an arm: named roles bound to channels), a
 *                     |                             | SUPPLY and a CONTROLLER. Validation is fail-closed and names
 *                     |                             | the field; a pulse outside a channel's clamps at either limit
 *                     |                             | is refused here, before any frame is ever generated.
 */

/** @description The contract version the capabilities route publishes. */
export const CONTRACT_VERSION = 1;
/** @description Frame rate of every compiled stream (hobby servos take a 50 Hz pulse train). */
export const FRAME_HZ = 50;
/** @description Frame period in milliseconds. */
export const FRAME_MS = 1000 / FRAME_HZ;

/** @description Caps that bound every rig, pose and scenario. */
export const LIMITS = Object.freeze({ channels: 32, mechanisms: 16, poses: 200, scenarios: 200, steps: 400, durationMs: 120_000, repeat: 100, depth: 8, frames: 6000, minUs: 400, maxUs: 2800 });

/** @description Mechanism kinds with the roles each may bind and the roles it must bind. `*` = any role name. */
export const MECHANISM_KINDS: Readonly<Record<string, { roles: readonly string[]; required: readonly string[]; label: string }>> = Object.freeze({
  'eye-gimbal': { roles: ['pan', 'tilt'], required: ['pan', 'tilt'], label: 'Eye gimbal (two axes)' },
  eyelids: { roles: ['upper', 'lower', 'left', 'right'], required: [], label: 'Eyelids' },
  neck: { roles: ['yaw', 'pitch', 'roll'], required: ['yaw'], label: 'Neck / head' },
  jaw: { roles: ['open'], required: ['open'], label: 'Jaw' },
  arm: { roles: ['*'], required: [], label: 'Arm (any joints)' },
  custom: { roles: ['*'], required: [], label: 'Custom mechanism' },
});

/** @description Controller boards the protocol speaks to and how many outputs each has. */
export const CONTROLLER_BOARDS: Readonly<Record<string, { channels: number; label: string }>> = Object.freeze({
  pca9685: { channels: 16, label: 'PCA9685 16-channel PWM driver (I²C) behind an ESP32 / Arduino' },
  'pca9685-x2': { channels: 32, label: 'Two chained PCA9685 boards' },
  'direct-pwm': { channels: 8, label: 'Servos on the microcontroller pins' },
  'serial-bus': { channels: 32, label: 'Serial bus servos (Feetech / Dynamixel class) — ids as channels' },
});

export const TRANSPORTS = Object.freeze(['web-serial', 'wifi-tcp'] as const);
export const SUPPLY_SOURCES = Object.freeze(['usb', 'bench', 'wall', 'battery'] as const);

/** @description A refused input, naming the field. */
export class ContractError extends Error {
  constructor(message: string, public readonly field: string) { super(message); this.name = 'ContractError'; }
}

/** @description One servo output with its calibration and software limits (mechanism degrees). */
export interface ServoChannel {
  id: string;
  channel: number;
  model: string;
  centerUs: number;
  usPerDeg: number;
  reversed: boolean;
  neutralDeg: number;
  minDeg: number;
  maxDeg: number;
  minUs: number;
  maxUs: number;
  maxDegPerS: number;
}

/** @description A named group of roles bound to channels. */
export interface Mechanism { id: string; kind: string; axes: Record<string, string> }
/** @description The actuator supply. */
export interface Supply { volts: number; amps: number; source: (typeof SUPPLY_SOURCES)[number] }
/** @description The motion controller the frames go to. */
export interface Controller { board: string; transport: (typeof TRANSPORTS)[number]; baud: number }
/** @description The whole rig as stored. */
export interface RigSpec { channels: ServoChannel[]; mechanisms: Mechanism[]; supply: Supply; controller: Controller }

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const ROLE = /^[a-z][a-z0-9-]{0,23}$/;

function obj(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError(`${field} must be an object`, field);
  return value as Record<string, unknown>;
}
function num(value: unknown, field: string, min: number, max: number, fallback?: number): number {
  const n = value === undefined && fallback !== undefined ? fallback : Number(value);
  if (typeof value === 'string' && !value.trim()) throw new ContractError(`${field} must be a number`, field);
  if (!Number.isFinite(n)) throw new ContractError(`${field} must be a number`, field);
  if (n < min || n > max) throw new ContractError(`${field} must be between ${min} and ${max}`, field);
  return n;
}
function id(value: unknown, field: string, pattern = ID): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new ContractError(`${field} must match ${pattern}`, field);
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  const v = value === undefined ? fallback : value;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new ContractError(`${field} must be one of ${allowed.join(', ')}`, field);
  return v as T;
}
function rejectUnknown(input: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new ContractError(`${field}.${key} is not a property`, `${field}.${key}`);
}

/**
 * @description The pulse a channel needs to sit at a mechanism angle. Pure; does not check limits.
 * @param ch - The channel.
 * @param deg - Mechanism degrees.
 * @returns Microseconds, rounded.
 */
export function pulseFor(ch: ServoChannel, deg: number): number {
  return Math.round(ch.centerUs + (ch.reversed ? -1 : 1) * (deg - ch.neutralDeg) * ch.usPerDeg);
}

/** @description Validate one channel; the pulses at both software limits must sit inside the hard clamps. */
export function validateChannel(input: unknown, field = 'channel'): ServoChannel {
  const c = obj(input, field);
  rejectUnknown(c, ['id', 'channel', 'model', 'centerUs', 'usPerDeg', 'reversed', 'neutralDeg', 'minDeg', 'maxDeg', 'minUs', 'maxUs', 'maxDegPerS'], field);
  const ch: ServoChannel = {
    id: id(c.id, `${field}.id`),
    channel: num(c.channel, `${field}.channel`, 0, 253),
    model: id(c.model, `${field}.model`),
    centerUs: num(c.centerUs, `${field}.centerUs`, LIMITS.minUs, LIMITS.maxUs, 1500),
    usPerDeg: num(c.usPerDeg, `${field}.usPerDeg`, 1, 40, 10),
    reversed: c.reversed === undefined ? false : c.reversed === true,
    neutralDeg: num(c.neutralDeg, `${field}.neutralDeg`, -180, 180, 0),
    minDeg: num(c.minDeg, `${field}.minDeg`, -180, 180, -45),
    maxDeg: num(c.maxDeg, `${field}.maxDeg`, -180, 180, 45),
    minUs: num(c.minUs, `${field}.minUs`, LIMITS.minUs, LIMITS.maxUs, 500),
    maxUs: num(c.maxUs, `${field}.maxUs`, LIMITS.minUs, LIMITS.maxUs, 2500),
    maxDegPerS: num(c.maxDegPerS, `${field}.maxDegPerS`, 10, 3000, 400),
  };
  if (typeof c.reversed !== 'undefined' && typeof c.reversed !== 'boolean') throw new ContractError(`${field}.reversed must be true or false`, `${field}.reversed`);
  if (!Number.isInteger(ch.channel)) throw new ContractError(`${field}.channel must be an integer`, `${field}.channel`);
  if (ch.minUs >= ch.maxUs) throw new ContractError(`${field}.minUs must be below maxUs`, `${field}.minUs`);
  if (ch.minDeg >= ch.maxDeg) throw new ContractError(`${field}.minDeg must be below maxDeg`, `${field}.minDeg`);
  if (ch.neutralDeg < ch.minDeg || ch.neutralDeg > ch.maxDeg) throw new ContractError(`${field}.neutralDeg must lie within the software limits`, `${field}.neutralDeg`);
  for (const [name, deg] of [['minDeg', ch.minDeg], ['maxDeg', ch.maxDeg]] as const) {
    const us = pulseFor(ch, deg);
    if (us < ch.minUs || us > ch.maxUs) throw new ContractError(`${field}.${name} needs a pulse of ${us} µs, outside the clamps ${ch.minUs}–${ch.maxUs} µs`, `${field}.${name}`);
  }
  return ch;
}

/** @description Validate one mechanism against its kind's roles and the rig's channel ids. */
export function validateMechanism(input: unknown, channelIds: Set<string>, field = 'mechanism'): Mechanism {
  const m = obj(input, field);
  rejectUnknown(m, ['id', 'kind', 'axes'], field);
  const kind = oneOf(m.kind, Object.keys(MECHANISM_KINDS), `${field}.kind`);
  const spec = MECHANISM_KINDS[kind];
  const axesIn = obj(m.axes ?? {}, `${field}.axes`);
  const axes: Record<string, string> = {};
  for (const [role, channel] of Object.entries(axesIn)) {
    id(role, `${field}.axes.${role}`, ROLE);
    if (!spec.roles.includes('*') && !spec.roles.includes(role)) throw new ContractError(`${field}.axes.${role} is not a ${kind} role (${spec.roles.join(', ')})`, `${field}.axes.${role}`);
    if (typeof channel !== 'string' || !channelIds.has(channel)) throw new ContractError(`${field}.axes.${role} names an unknown channel`, `${field}.axes.${role}`);
    if (Object.values(axes).includes(channel)) throw new ContractError(`${field}.axes binds channel ${channel} twice`, `${field}.axes.${role}`);
    axes[role] = channel;
  }
  for (const role of spec.required) if (!axes[role]) throw new ContractError(`${field}.axes must bind ${role}`, `${field}.axes.${role}`);
  if (!Object.keys(axes).length) throw new ContractError(`${field}.axes must bind at least one role`, `${field}.axes`);
  return { id: id(m.id, `${field}.id`), kind, axes };
}

/** @description Validate the supply (a USB port is 5 V / 0.5 A unless the person says otherwise). */
export function validateSupply(input: unknown, field = 'supply'): Supply {
  const s = obj(input ?? {}, field);
  rejectUnknown(s, ['volts', 'amps', 'source'], field);
  const source = oneOf(s.source, SUPPLY_SOURCES, `${field}.source`, 'bench');
  return { source, volts: num(s.volts, `${field}.volts`, 3, 30, source === 'usb' ? 5 : 6), amps: num(s.amps, `${field}.amps`, 0.1, 100, source === 'usb' ? 0.5 : 3) };
}

/** @description Validate the controller. */
export function validateController(input: unknown, field = 'controller'): Controller {
  const c = obj(input ?? {}, field);
  rejectUnknown(c, ['board', 'transport', 'baud'], field);
  return { board: oneOf(c.board, Object.keys(CONTROLLER_BOARDS), `${field}.board`, 'pca9685'), transport: oneOf(c.transport, TRANSPORTS, `${field}.transport`, 'web-serial'), baud: num(c.baud, `${field}.baud`, 9600, 2_000_000, 115_200) };
}

/**
 * @description Validate a whole rig: unique ids and output numbers, every output within the board.
 * @param input - Untrusted rig.
 * @returns The typed rig.
 */
export function validateRig(input: unknown): RigSpec {
  const r = obj(input ?? {}, 'rig');
  rejectUnknown(r, ['channels', 'mechanisms', 'supply', 'controller'], 'rig');
  const controller = validateController(r.controller);
  const board = CONTROLLER_BOARDS[controller.board];
  const rawChannels = Array.isArray(r.channels) ? r.channels : [];
  if (!Array.isArray(r.channels ?? [])) throw new ContractError('rig.channels must be a list', 'rig.channels');
  if (rawChannels.length > LIMITS.channels) throw new ContractError(`rig.channels is capped at ${LIMITS.channels}`, 'rig.channels');
  const channels = rawChannels.map((c, i) => validateChannel(c, `rig.channels[${i}]`));
  const ids = new Set<string>(); const outputs = new Set<number>();
  channels.forEach((c, i) => {
    if (ids.has(c.id)) throw new ContractError(`rig.channels[${i}].id repeats ${c.id}`, `rig.channels[${i}].id`);
    if (outputs.has(c.channel)) throw new ContractError(`rig.channels[${i}].channel repeats output ${c.channel}`, `rig.channels[${i}].channel`);
    if (c.channel >= board.channels) throw new ContractError(`rig.channels[${i}].channel ${c.channel} is beyond the ${board.channels} outputs of ${controller.board}`, `rig.channels[${i}].channel`);
    ids.add(c.id); outputs.add(c.channel);
  });
  const rawMechs = r.mechanisms === undefined ? [] : r.mechanisms;
  if (!Array.isArray(rawMechs)) throw new ContractError('rig.mechanisms must be a list', 'rig.mechanisms');
  if (rawMechs.length > LIMITS.mechanisms) throw new ContractError(`rig.mechanisms is capped at ${LIMITS.mechanisms}`, 'rig.mechanisms');
  const mechanisms = rawMechs.map((m, i) => validateMechanism(m, ids, `rig.mechanisms[${i}]`));
  const mechIds = new Set<string>(); const bound = new Set<string>();
  mechanisms.forEach((m, i) => {
    if (mechIds.has(m.id)) throw new ContractError(`rig.mechanisms[${i}].id repeats ${m.id}`, `rig.mechanisms[${i}].id`);
    for (const ch of Object.values(m.axes)) { if (bound.has(ch)) throw new ContractError(`rig.mechanisms[${i}] binds channel ${ch} already bound by another mechanism`, `rig.mechanisms[${i}].axes`); bound.add(ch); }
    mechIds.add(m.id);
  });
  return { channels, mechanisms, supply: validateSupply(r.supply), controller };
}

/** @description The axis keys of a rig (`<mechanism>.<role>`) with the channel behind each. */
export function axisMap(rig: RigSpec): Map<string, ServoChannel> {
  const byId = new Map(rig.channels.map((c) => [c.id, c]));
  const out = new Map<string, ServoChannel>();
  for (const m of rig.mechanisms) for (const [role, ch] of Object.entries(m.axes)) out.set(`${m.id}.${role}`, byId.get(ch) as ServoChannel);
  return out;
}

/** @description Refuse an angle outside a channel's software limits. */
export function requireWithinLimits(ch: ServoChannel, deg: number, field: string): number {
  if (!Number.isFinite(deg)) throw new ContractError(`${field} must be a number`, field);
  if (deg < ch.minDeg || deg > ch.maxDeg) throw new ContractError(`${field} = ${deg}° is outside ${ch.id}'s limits ${ch.minDeg}…${ch.maxDeg}°`, field);
  return deg;
}

/** @description The contract as the capabilities route publishes it. */
export function describeRigContract(): Record<string, unknown> {
  return {
    version: CONTRACT_VERSION,
    frameHz: FRAME_HZ,
    limits: LIMITS,
    mechanismKinds: MECHANISM_KINDS,
    controllerBoards: CONTROLLER_BOARDS,
    transports: TRANSPORTS,
    supplySources: SUPPLY_SOURCES,
    channel: { id: 'kebab-case', channel: 'integer output on the board', model: 'servo catalog id', centerUs: 'pulse at neutralDeg (400–2800)', usPerDeg: 'microseconds per mechanism degree (1–40)', reversed: 'true flips the direction', neutralDeg: 'rest angle', minDeg: 'software limit', maxDeg: 'software limit', minUs: 'hard clamp', maxUs: 'hard clamp', maxDegPerS: 'the servo speed the rehearsal assumes' },
    axisKey: '<mechanism id>.<role>',
  };
}
