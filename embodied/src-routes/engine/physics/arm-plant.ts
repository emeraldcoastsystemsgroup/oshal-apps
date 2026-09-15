/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (B22, half a) — the arm plant seam, the drone
 *                     |                             | plant's counterpart: the simulation commands joint angles and a
 *                     |                             | grip and is told back what the joints REALLY did, what each
 *                     |                             | servo exerted doing it, and what the arm touched. Synchronous,
 *                     |                             | like the drone's, because the simulation's step is. `backend`
 *                     |                             | says which body answered: 'physics' for the engine container we
 *                     |                             | dial, 'node' for an arm that dialled us over the swarm rail
 *                     |                             | (B22 half b, blocked on the core ADR-149 decision recorded in
 *                     |                             | B20 — no package code can open that gate).
 */
import { randomUUID } from 'node:crypto';
import type { SyncBridge, NodeLink } from './bridge-client';

/** @description What the arm plant reports after a step. Every number is measured in the physics, never restated from the command. */
export interface ArmStep {
  /** The joint angles the arm really holds now (rad). */
  q: number[];
  /** What each joint's servo is exerting (N·m) — the sizing's own units, so a saturation is visible. */
  torqueNm: number[];
  /** The jaw opening the gripper really holds (rad on the jaw hinge). */
  grip: number;
  /** The scene solid an arm link touched during the step, or null. */
  contact: string | null;
  /** Every commanded joint is within tolerance of its command and has stopped moving. */
  settled: boolean;
}

/**
 * @description What the simulation needs from an arm plant. Deliberately the shape of `PhysicsPlant`: a step, a clone
 * for the rehearsal, a drop. A plant that is one real body returns null from `clone()` and the rehearsal then runs on
 * the kinematic twin — the same contract the drone's node already keeps.
 */
export interface ArmPlant {
  readonly engine: string;
  readonly version: string;
  readonly seed: number;
  /** 'physics' for the engine container behind a dialled bridge, 'node' for an arm that joined over the swarm rail. */
  readonly backend: 'physics' | 'node';
  /** The joint table the plant's model was BUILT from (d, a, alpha per joint). The simulation checks it against its own
   * arm before it trusts a single step: a belief computed from one arm's link lengths over another arm's physics is
   * plausible-but-wrong motion, and there is no symptom until the tool point misses. */
  readonly dh: readonly (readonly [number, number, number])[];
  step(qTarget: readonly number[], grip: number, dt: number): ArmStep;
  clone(): ArmPlant | null;
  drop(): void;
}

/** @description An arm plant that also carries a node identity (B22 half b: an arm on the swarm rail). */
export interface ArmNode extends ArmPlant {
  readonly nodeId: string;
  readonly link: NodeLink;
  readonly endpoint: string;
}

/**
 * @description Whether an arm plant carries a node identity.
 * @param p - Any arm plant.
 * @returns True for an ArmNode.
 */
export function isArmNode(p: ArmPlant | null | undefined): p is ArmNode {
  return Boolean(p && typeof (p as ArmNode).nodeId === 'string' && typeof (p as ArmNode).link === 'string');
}

interface ArmLoadResult { session: string; bodies: number; geoms: number; actuators: number; timestep: number; joints: number }

/** @description The tolerance the plant's joint table must match the simulation's arm within (m, rad). */
export const ARM_DH_TOLERANCE = 1e-6;

/**
 * @description Whether an arm plant's model was built from the same arm the simulation believes it is driving.
 * @param plant - The plant.
 * @param dh - The simulation's own joint table.
 * @returns The reason they differ, or null when they are the same arm.
 */
export function armSpecMismatch(plant: ArmPlant, dh: readonly (readonly [number, number, number])[]): string | null {
  if (plant.dh.length !== dh.length) return `the plant has ${plant.dh.length} joints, the simulation's arm has ${dh.length}`;
  for (let i = 0; i < dh.length; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      if (Math.abs(plant.dh[i][k] - dh[i][k]) > ARM_DH_TOLERANCE) return `joint ${i + 1} differs (${['d', 'a', 'alpha'][k]}: plant ${plant.dh[i][k]}, simulation ${dh[i][k]})`;
    }
  }
  return null;
}
interface ArmStepResult { q: number[]; torqueNm: number[]; grip: number; contact: string | null; settled: boolean }

/**
 * @description The arm plant behind a bridge — the engine container we dial — one session per world, a rehearsal clone
 * being its own session. The MJCF is built on this side (the room the arm stands in) and sent once at load, exactly the
 * way the drone's is: the container holds physics, never a picture of the world.
 */
export class RemoteArmPlant implements ArmPlant {
  readonly engine: string;
  readonly version: string;
  readonly backend = 'physics' as const;
  readonly dh: readonly (readonly [number, number, number])[];
  private dropped = false;

  private constructor(private readonly bridge: SyncBridge, readonly session: string, readonly seed: number, readonly mjcf: string, readonly loaded: ArmLoadResult, dh: readonly (readonly [number, number, number])[]) {
    this.dh = dh;
    const h = bridge.hello();
    this.engine = h.engine;
    this.version = h.version;
  }

  /**
   * @description Load an arm model into a fresh session on the bridge.
   * @param bridge - The bridge to the engine container.
   * @param mjcf - The arm's model, in the room it stands in.
   * @param seed - The plant's seed.
   * @param dh - The joint table the model was built from.
   * @returns The loaded plant.
   */
  static load(bridge: SyncBridge, mjcf: string, seed = 0, dh: readonly (readonly [number, number, number])[] = []): RemoteArmPlant {
    const session = randomUUID();
    const loaded = bridge.call<ArmLoadResult>('arm-load', { session, mjcf, seed });
    return new RemoteArmPlant(bridge, session, seed, mjcf, loaded, dh);
  }

  step(qTarget: readonly number[], grip: number, dt: number): ArmStep {
    const r = this.bridge.call<ArmStepResult>('arm-step', { session: this.session, q: [...qTarget], grip, dt });
    return { q: r.q, torqueNm: r.torqueNm, grip: r.grip, contact: r.contact ?? null, settled: Boolean(r.settled) };
  }

  clone(): RemoteArmPlant {
    const session = randomUUID();
    this.bridge.call('arm-clone', { session, from: this.session });
    return new RemoteArmPlant(this.bridge, session, this.seed, this.mjcf, this.loaded, this.dh);
  }

  drop(): void {
    if (this.dropped) return;
    this.dropped = true;
    try { this.bridge.call('arm-drop', { session: this.session }); } catch { /* a bridge that is already gone has nothing to drop */ }
  }
}
