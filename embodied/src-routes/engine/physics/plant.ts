/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the PhysicsPlant seam (ADR-152 D3): what the simulation asks of a plant (step the truth toward the commanded setpoint, sense from the true pose, clone for a rehearsal, drop), the sensor specification built from the same sensor set and intrinsics the kinematic raycaster uses, the conversion of the plant's compact frames into the LidarSweeps the map integrates (paint looked up by the solid's name, exactly as the kinematic sensors paint), and RemotePlant, the plant behind the engine container's bridge.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A ControllerSpec on load (the plant's own controller or a trained policy the container holds, residual or absolute); the plant names its controller. B19.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | B20: a plant is a DroneNode when it has an identity on the swarm (nodeId, link, endpoint) — RemotePlant is one over either link; `clone()` may answer null (a real body has one instance) and the rehearsal then runs on the kinematic twin from the plant's last reported truth.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | B19: a policy's `interface` (motors | ctbr) rides the ControllerSpec and the load result; the plant flies a ctbr policy through its own rate loop.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | B6: a node's own flight stack names itself (`controller: 'px4'`); anything but a policy is reported by its kind.
 */

import { randomUUID } from 'node:crypto';
import type { CameraIntrinsics } from '../drone/camera-model';
import type { Pose3Yaw } from '../drone/quad-model';
import type { DroneSensorSet } from '../drone/sensor-set';
import type { LidarSweep, RayHit, SensedSolid } from '../sense/raycast';
import type { Vec3 } from '../math/vec';
import { SyncBridge, type NodeLink } from './bridge-client';

/** The kinematic sim's mode, as the plant needs it: motors off when landed; the floor is not a strike while landed, taking off or landing. */
export type PlantPhase = 'landed' | 'takeoff' | 'hover' | 'moving' | 'landing';

export interface PlantStep {
  pose: Pose3Yaw;
  tiltRad: number;
  speed: number;
  /** The scene solid the hull touched during the step, or null. */
  contact: string | null;
  /** The controller has converged on the setpoint (or the hull is down, when landing). */
  settled: boolean;
  motorsN: number[];
}

export interface SenseSpec {
  ring?: { azimuthCount: number; elevationsDeg: readonly number[]; maxRange: number };
  zenith?: { rays: number; coneDeg: number; maxRange: number };
  depth?: { fx: number; fy: number; cx: number; cy: number; width: number; height: number; stride: number; maxRange: number; pitch: number };
  nadir?: { maxRange: number };
}

/** A compact frame: flat hit points and normals, ranges, geom indices into `names`, flat miss points. */
export interface RawFrame { origin: number[]; p: number[]; n: number[]; t: number[]; geom: number[]; misses: number[] }
export interface PlantFrames { names: string[]; truth: Pose3Yaw & { tiltRad: number; speed: number }; ring?: RawFrame; zenith?: RawFrame; depth?: RawFrame; nadir?: RawFrame }

/** What flies the plant: its own cascaded controller, or a trained policy from the container's report directory (residual = a bounded correction on the controller). */
export type ControllerSpec = { kind: 'pid' } | { kind: 'policy'; file: string; residual: boolean; interface?: 'motors' | 'ctbr' };

/** @description The controller as the plant names it: `pid` or `policy:<file>`. */
export const controllerName = (c: ControllerSpec | undefined): string => (c && c.kind === 'policy' ? `policy:${c.file}` : 'pid');

/** @description What the simulation needs from a physics plant. Synchronous by design: the simulation's step is one. */
export interface PhysicsPlant {
  readonly engine: string;
  readonly version: string;
  readonly seed: number;
  /** `pid` or `policy:<file>`. */
  readonly controller: string;
  step(setpoint: Pose3Yaw, phase: PlantPhase, dt: number): PlantStep;
  sense(spec: SenseSpec): PlantFrames;
  /** A copy for a rehearsal — or null when this plant cannot be copied (a real body has one instance): the rehearsal then runs on the kinematic twin from the plant's last reported truth. */
  clone(): PhysicsPlant | null;
  drop(): void;
}

/**
 * @description A drone node as the simulation sees one (ADR-099, B20): a plant with an identity on the swarm — which node,
 * over which link (the container's bridge we dial, or the rail a node joined by heartbeat), at which endpoint. `RemotePlant`
 * is one over either link; `RailDroneNode` is the one a real drone's node runtime would be.
 */
export interface DroneNode extends PhysicsPlant {
  readonly nodeId: string;
  readonly link: NodeLink;
  readonly endpoint: string;
}

/** @description Whether a plant carries a node identity. @param p - Any plant. @returns True for a DroneNode. */
export function isDroneNode(p: PhysicsPlant | null | undefined): p is DroneNode {
  return Boolean(p && typeof (p as DroneNode).nodeId === 'string' && typeof (p as DroneNode).link === 'string');
}

/** @description The sensor specification for a set, with the depth camera's pinhole built exactly as the kinematic depth picture builds it. */
export function senseSpec(set: DroneSensorSet, intr: CameraIntrinsics): SenseSpec {
  const spec: SenseSpec = { ring: { azimuthCount: set.lidar.azimuthCount, elevationsDeg: set.lidar.elevationsDeg, maxRange: set.lidar.maxRange } };
  if (set.lidar.zenith) spec.zenith = { ...set.lidar.zenith };
  if (set.depthCamera) {
    const c = set.depthCamera;
    spec.depth = { fx: intr.width / (2 * Math.tan(((c.fovHDeg / 2) * Math.PI) / 180)), fy: intr.height / (2 * Math.tan(((c.fovVDeg / 2) * Math.PI) / 180)), cx: intr.cx, cy: intr.cy, width: intr.width, height: intr.height, stride: c.stride, maxRange: c.maxRange, pitch: -Math.PI / 2 + 1e-3 };
  }
  if (set.nadirRangerM !== null) spec.nadir = { maxRange: set.nadirRangerM };
  return spec;
}

function toSweep(f: RawFrame, names: readonly string[], paint: ReadonlyMap<string, string>): LidarSweep {
  const hits: RayHit[] = [];
  for (let i = 0; i < f.t.length; i += 1) {
    const name = names[f.geom[i]] ?? 'unknown';
    hits.push({ t: f.t[i], point: [f.p[3 * i], f.p[3 * i + 1], f.p[3 * i + 2]], normal: [f.n[3 * i], f.n[3 * i + 1], f.n[3 * i + 2]], name, paint: paint.get(name) ?? 'unknown' });
  }
  const misses: Vec3[] = [];
  for (let i = 0; i < f.misses.length; i += 3) misses.push([f.misses[i], f.misses[i + 1], f.misses[i + 2]]);
  return { origin: [f.origin[0], f.origin[1], f.origin[2]], hits, misses };
}

/** @description The plant's frames as the sweeps the map integrates, one per sensor, in the order the kinematic scan builds them (ring, depth camera, nadir), plus the nadir range when it read the floor. */
export function framesToSweeps(frames: PlantFrames, solids: readonly SensedSolid[]): { sweeps: LidarSweep[]; nadirM: number | null } {
  const paint = new Map(solids.map((s) => [s.name, s.paint] as const));
  const sweeps: LidarSweep[] = [];
  if (frames.ring) {
    const ring = toSweep(frames.ring, frames.names, paint);
    if (frames.zenith) { const z = toSweep(frames.zenith, frames.names, paint); ring.hits.push(...z.hits); ring.misses.push(...z.misses); }
    sweeps.push(ring);
  }
  if (frames.depth) sweeps.push(toSweep(frames.depth, frames.names, paint));
  let nadirM: number | null = null;
  if (frames.nadir) {
    const n = toSweep(frames.nadir, frames.names, paint);
    sweeps.push(n);
    if (n.hits.length && n.hits[0].name === 'floor') nadirM = n.hits[0].t;
  }
  return { sweeps, nadirM };
}

export interface LoadResult { session: string; bodies: number; geoms: number; actuators: number; timestep: number; massKg: number; restZ: number; controller?: { kind: string; file?: string; residual?: boolean; interface?: string } }
interface StepResult { x: number; y: number; z: number; yaw: number; tiltRad: number; speed: number; contact: string | null; settled: boolean; motorsN: number[] }

/** @description The plant behind a bridge — the engine container we dial, or a node on the rail — one session per world (a rehearsal clone is its own session). */
export class RemotePlant implements DroneNode {
  readonly engine: string;
  readonly version: string;
  readonly controller: string;
  readonly nodeId: string;
  readonly link: NodeLink;
  readonly endpoint: string;
  private dropped = false;

  private constructor(private readonly bridge: SyncBridge, readonly session: string, readonly seed: number, readonly loaded: LoadResult) {
    const h = bridge.hello();
    this.engine = h.engine; this.version = h.version;
    this.nodeId = bridge.nodeId; this.link = bridge.link; this.endpoint = bridge.endpoint;
    this.controller = loaded.controller && loaded.controller.kind === 'policy' ? `policy:${loaded.controller.file ?? ''}` : (loaded.controller?.kind ?? 'pid');
  }

  /** @description Load an MJCF into a fresh session, flown by the plant's own controller or a policy the container holds. */
  static load(bridge: SyncBridge, mjcf: string, seed: number, controller: ControllerSpec = { kind: 'pid' }): RemotePlant {
    const session = randomUUID();
    const loaded = bridge.call<LoadResult>('load', { session, mjcf, seed, controller });
    return new RemotePlant(bridge, session, seed, loaded);
  }

  step(setpoint: Pose3Yaw, phase: PlantPhase, dt: number): PlantStep {
    const r = this.bridge.call<StepResult>('step', { session: this.session, setpoint, phase, dt });
    return { pose: { x: r.x, y: r.y, z: r.z, yaw: r.yaw }, tiltRad: r.tiltRad, speed: r.speed, contact: r.contact, settled: r.settled, motorsN: r.motorsN };
  }

  sense(spec: SenseSpec): PlantFrames {
    return this.bridge.call<PlantFrames>('sense', { session: this.session, spec });
  }

  clone(): RemotePlant {
    const session = randomUUID();
    this.bridge.call('clone', { session, from: this.session });
    return new RemotePlant(this.bridge, session, this.seed, this.loaded);
  }

  drop(): void {
    if (this.dropped) return;
    this.dropped = true;
    try { this.bridge.call('drop', { session: this.session }); } catch { /* a bridge that is already gone has nothing to drop */ }
  }
}
