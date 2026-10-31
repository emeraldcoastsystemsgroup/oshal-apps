/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 (lane L4): the TypeScript seam a spider-18 node presents
 *                     |                             | to the brain — the HexapodNode interface (hello, walk, stop,
 *                     |                             | pose, flip, jump, sense, sit, estop, tick), the reply shapes the
 *                     |                             | Python node answers (the brief's section 3.2 state plus the
 *                     |                             | node's own status, the LiDAR on sense), and RailHexapodNode,
 *                     |                             | which sends {id, command, args} envelopes to a node that
 *                     |                             | heartbeated in, over the same node-rail bridge RailDroneNode
 *                     |                             | uses (the node's own command key, never the service secret),
 *                     |                             | with every argument checked here before an envelope leaves.
 *                     |                             | Also the spider-18's capability manifest for kind `hexapod`.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A refusal decided at home (a bad argument, another kind, a closed
 *                     |                             | seam) carries its message as `reason` too, so a route's 503 body
 *                     |                             | and a suite's check read the same explanation as a node refusal.
 */

import { EngineFailure, SyncBridge, type BridgeHello } from '../physics/bridge-client';
import type { CapabilityManifest } from '../nodes/capability-manifest';

/** The node kind the spider heartbeats as. */
export const HEXAPOD_KIND = 'hexapod' as const;
/** Eighteen targets, always, in ACTUATOR_ORDER (hexapod-spec.ts). */
export const HEXAPOD_ACTUATOR_COUNT = 18;
/** Every command the Python node answers; the brief's section 3.3 set plus estop, tick, load and reset. */
export const HEXAPOD_COMMANDS = ['hello', 'status', 'walk', 'stop', 'pose', 'flip', 'jump', 'sense', 'sit', 'land', 'estop', 'tick', 'load', 'reset'] as const;
export type HexapodCommand = (typeof HEXAPOD_COMMANDS)[number];
/** Which body stands behind the node. */
export type HexapodBackend = 'fake' | 'plant' | 'serial';
/** The node's modes: idle holds the stance, walk plays the gait, pose holds targets, flip plays the push, sit folds and relaxes, estop holds where it stood with torque off. */
export type HexapodMode = 'idle' | 'walk' | 'pose' | 'flip' | 'sit' | 'estop';
export type HexapodFlipSide = 'left' | 'right';

/** A body velocity command: +x forward, +y left, yaw counter-clockwise seen from above. */
export interface HexapodWalkCommand { vxMps: number; vyMps: number; yawRateRadS: number }

/** The latched spring's state, or null on a legs-hop body. */
export interface HexapodSpring { storedJ: number; latched: boolean }

/** The brief's state (section 3.2), exactly: what the plant, the robot or the fake reports. */
export interface HexapodState {
  timeS: number;
  bodyPosM: number[];
  bodyQuatWXYZ: number[];
  bodyVelMps: number[];
  gyroRadS: number[];
  accelMps2: number[];
  jointPosRad: number[];
  jointVelRadS: number[];
  jointTorqueNm: number[];
  footContact: boolean[];
  /** The body's truth where there is one (the plant, the fake); the node's own decision on a serial body. */
  inverted: boolean;
  fell: boolean;
  spring: HexapodSpring | null;
}

/** A flip in progress or just started. */
export interface HexapodFlip { side: HexapodFlipSide; durationS: number; keyframes: number; fromInverted: boolean }

/** The node's own view, carried on every reply as `node`. */
export interface HexapodNodeStatus {
  mode: HexapodMode;
  /** The node's decision from accelMps2 alone (hysteresis and a settling time). */
  inverted: boolean;
  /** Whether the targets being sent carry the mirror rule. */
  mirrored: boolean;
  accelZ: number | null;
  flips: number;
  command: HexapodWalkCommand;
  tickHz: number;
  ticks: number;
  backend: HexapodBackend;
  relaxed: boolean;
  flip: HexapodFlip | null;
}

/** Every command's reply: the state plus the node's status. */
export interface HexapodReply extends HexapodState { node: HexapodNodeStatus }
/** A 2-D scan: empty on a fake body and on a plant whose state carries no lidar. */
export interface HexapodLidar { anglesRad: number[]; rangesM: number[] }
/** The sense reply: the state, the scan and where the scan came from. */
export interface HexapodSense extends HexapodReply { lidar: HexapodLidar; lidarSource: HexapodBackend | 'none' }
/** What hello answers and the heartbeat carries. */
export interface HexapodHello extends BridgeHello { backend: HexapodBackend; kind: typeof HEXAPOD_KIND; tickHz: number; hasSpring: boolean }

/** @description What a spider node is to the brain: the brief's commands, each answered with the state. */
export interface HexapodNode {
  readonly nodeId: string;
  readonly link: 'rail';
  readonly endpoint: string;
  readonly backend: HexapodBackend;
  hello(): HexapodHello;
  walk(command: HexapodWalkCommand): HexapodReply;
  stop(): HexapodReply;
  /** Eighteen targets in ACTUATOR_ORDER as upright intent (mirrored when the body is inverted) or raw. */
  pose(targetsRad: readonly number[], raw?: boolean): HexapodReply;
  flip(side?: HexapodFlipSide): HexapodReply & { flip: HexapodFlip };
  /** Refused with no_spring on a legs-hop body: see {@link isNoSpring}. */
  jump(): HexapodReply & { jumped: true };
  sense(): HexapodSense;
  sit(): HexapodReply;
  estop(): HexapodReply & { estopped: true };
  /** One control period, lock-step (a node whose paced loop is off). */
  tick(dtS?: number): HexapodReply;
  close(): void;
}

/** The fleet's record of a node, as much of it as this seam needs (a NodeRecord satisfies it structurally). */
export interface HexapodNodeRecord { nodeId: string; endpointUrl: string; commandKey: string; hello: BridgeHello }

export interface HexapodNodeOptions { timeoutMs?: number }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A refusal decided here, before any envelope leaves: the message is the reason (the route layer reports `reason`). */
const refuse = (message: string): EngineFailure => new EngineFailure('engine_error', message, message);

/** @description A walk command checked before it leaves: three finite numbers. @param cmd - Untrusted. @returns The command. */
export function validateWalkCommand(cmd: unknown): HexapodWalkCommand {
  const c = (cmd ?? {}) as Record<string, unknown>;
  for (const key of ['vxMps', 'vyMps', 'yawRateRadS']) if (!finite(c[key])) throw refuse(`walk needs a finite ${key}`);
  return { vxMps: c.vxMps as number, vyMps: c.vyMps as number, yawRateRadS: c.yawRateRadS as number };
}

/** @description Eighteen finite targets or a refusal; the node clamps them to the contract's limits. @param targets - Untrusted. @returns A copy. */
export function validateTargets(targets: unknown): number[] {
  if (!Array.isArray(targets) || targets.length !== HEXAPOD_ACTUATOR_COUNT || !targets.every(finite)) {
    throw refuse(`pose needs ${HEXAPOD_ACTUATOR_COUNT} finite targets in ACTUATOR_ORDER`);
  }
  return [...(targets as number[])];
}

/** @description Whether a failure is the body's no_spring refusal (a legs-hop model asked to jump). @param error - Anything thrown. @returns True for no_spring. */
export function isNoSpring(error: unknown): boolean {
  return error instanceof EngineFailure && /^no_spring\b/.test(error.reason ?? '');
}

/** @description Whether a failure is the node's busy refusal (a flip in progress). @param error - Anything thrown. @returns True for busy. */
export function isBusy(error: unknown): boolean {
  return error instanceof EngineFailure && /^busy\b/.test(error.reason ?? '');
}

/** @description Whether a value carries the hexapod seam. @param p - Anything. @returns True for a HexapodNode. */
export function isHexapodNode(p: unknown): p is HexapodNode {
  const n = p as HexapodNode | null;
  return Boolean(n && typeof n.nodeId === 'string' && n.link === 'rail' && typeof n.walk === 'function' && typeof n.sense === 'function');
}

/**
 * @description A spider on the rail: one bridge per node over its declared endpoint, each method one envelope.
 * `connect` asks the node `hello` first and refuses a node of another kind, so a drone or a plant cannot be walked.
 */
export class RailHexapodNode implements HexapodNode {
  readonly link = 'rail' as const;
  readonly nodeId: string;
  readonly endpoint: string;
  readonly backend: HexapodBackend;
  private closed = false;

  private constructor(private readonly bridge: SyncBridge, record: HexapodNodeRecord, private readonly helloSeen: HexapodHello) {
    this.nodeId = record.nodeId; this.endpoint = record.endpointUrl; this.backend = helloSeen.backend;
  }

  /**
   * @description Open the node's command channel and check it is a hexapod.
   * @param record - The fleet's record (an online node; the fleet refuses an offline one before this).
   * @param opts - The per-request timeout (a serial jump winds for seconds; the default allows it).
   * @returns The node.
   */
  static connect(record: HexapodNodeRecord, opts: HexapodNodeOptions = {}): RailHexapodNode {
    const bridge = new SyncBridge({ transport: 'http', endpoint: record.endpointUrl, commandKey: record.commandKey, hello: record.hello, nodeId: record.nodeId, expectedBuildHash: null, timeoutMs: opts.timeoutMs ?? 10_000 });
    try {
      const hello = bridge.call<HexapodHello>('hello');
      if (hello.kind !== HEXAPOD_KIND || !['fake', 'plant', 'serial'].includes(hello.backend)) {
        throw refuse(`node ${record.nodeId} is not a hexapod (kind ${String(hello.kind)}, backend ${String(hello.backend)})`);
      }
      return new RailHexapodNode(bridge, record, hello);
    } catch (error) { bridge.close(); throw error; }
  }

  private call<T>(command: HexapodCommand, args: Record<string, unknown> = {}): T {
    if (this.closed) throw new EngineFailure('capability_unavailable', `node ${this.nodeId} was closed`, 'the seam was closed');
    return this.bridge.call<T>(command, args);
  }

  hello(): HexapodHello { return this.helloSeen; }
  walk(command: HexapodWalkCommand): HexapodReply { return this.call('walk', { ...validateWalkCommand(command) }); }
  stop(): HexapodReply { return this.call('stop'); }
  pose(targetsRad: readonly number[], raw = false): HexapodReply { return this.call('pose', { targetsRad: validateTargets(targetsRad), raw }); }
  flip(side: HexapodFlipSide = 'right'): HexapodReply & { flip: HexapodFlip } {
    if (side !== 'left' && side !== 'right') throw refuse("flip side must be 'left' or 'right'");
    return this.call('flip', { side });
  }
  jump(): HexapodReply & { jumped: true } { return this.call('jump'); }
  sense(): HexapodSense { return this.call('sense'); }
  sit(): HexapodReply { return this.call('sit'); }
  estop(): HexapodReply & { estopped: true } { return this.call('estop'); }
  tick(dtS?: number): HexapodReply {
    if (dtS !== undefined && !(finite(dtS) && dtS > 0 && dtS <= 1)) throw refuse('tick dtS must be in (0, 1]');
    return this.call('tick', dtS === undefined ? {} : { dtS });
  }

  /** @description End the channel; every later call fails closed. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.bridge.close();
  }
}

/**
 * @description The spider-18's capability manifest (ADR-151 D1 shape, kind `hexapod`). The envelope numbers are the
 * contract's (hexapod-spec.ts) and the gait player's cap: 0.2 m/s is the stride cap over the stance time, the lane's
 * starting choice, not a measurement.
 */
export const SPIDER_18_MANIFEST: CapabilityManifest = Object.freeze({
  nodeId: 'embodied-hexapod',
  kind: 'hexapod',
  model: 'spider-18',
  safetyClass: 2,
  senses: ['pose', 'imu', 'joint-state', 'foot-contact', 'lidar', 'spring'],
  acts: ['walk', 'stop', 'pose', 'flip', 'jump', 'sit', 'e-stop'],
  envelope: { legs: 6, actuators: HEXAPOD_ACTUATOR_COUNT, standHeightMm: 90, massTargetG: 1900, springStoredJ: 3.61, maxSpeedMps: 0.2, tickHz: 50 },
});
