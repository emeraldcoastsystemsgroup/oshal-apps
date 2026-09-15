/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the DroneNode a node on the swarm rail is (ADR-099, B20), the core RemoteDroneProvider's shape: built from the fleet's record of a node that joined by heartbeat, commanded at the endpoint it declared over the swarm service secret (one bridge per world, closed on drop), its hello checked like a dialled one (the build hash for a plant node, whose engine tree must be this package's). `load` is what a plant node accepts and a real body refuses; a `clone` the node refuses (cannot_clone: one body) is null, and the rehearsal runs on the kinematic twin. The sim flies it through the same seam as the dialled plant.
 */

import { EngineFailure, SyncBridge } from '../physics/bridge-client';
import { RemotePlant, type ControllerSpec, type DroneNode, type PhysicsPlant, type PlantFrames, type PlantPhase, type PlantStep, type SenseSpec } from '../physics/plant';
import type { Pose3Yaw } from '../drone/quad-model';
import type { NodeKind, NodeRecord } from './node-fleet';

export interface RailNodeOptions {
  /** The swarm service secret every envelope carries (SWARM_SERVICE_SECRET). Empty = the rail cannot be used. */
  secret: string;
  /** This package's engine tree hash; a plant node built from another tree is refused before the first request. */
  expectedBuildHash: string | null;
  timeoutMs?: number;
}

/** @description A node on the rail as the simulation's drone: the same seam as the dialled plant, over the node's own command channel. */
export class RailDroneNode implements DroneNode {
  readonly link = 'rail' as const;
  readonly nodeId: string;
  readonly endpoint: string;
  readonly kind: NodeKind;
  readonly engine: string;
  readonly version: string;
  readonly seed: number;
  readonly controller: string;
  private dropped = false;

  private constructor(private readonly plant: RemotePlant, private readonly bridge: SyncBridge, record: NodeRecord) {
    this.nodeId = record.nodeId; this.endpoint = record.endpointUrl; this.kind = record.kind;
    this.engine = plant.engine; this.version = plant.version; this.seed = plant.seed; this.controller = plant.controller;
  }

  /**
   * @description Open the node's command channel and load the world's MJCF into a session there.
   * @param record - The fleet's record (an online node; the fleet refuses an offline one before this is reached).
   * @param mjcf - The scene and the drone, generated from the parts model. @param seed - The gust seed.
   * @param controller - The plant's controller or a certified policy. @param opts - Secret, expected build hash, timeout.
   * @returns The node, flying the session.
   */
  static load(record: NodeRecord, mjcf: string, seed: number, controller: ControllerSpec, opts: RailNodeOptions): RailDroneNode {
    const bridge = new SyncBridge({ transport: 'http', endpoint: record.endpointUrl, secret: opts.secret, hello: record.hello, nodeId: record.nodeId, expectedBuildHash: record.kind === 'plant' ? opts.expectedBuildHash : null, timeoutMs: opts.timeoutMs ?? 30000 });
    try {
      const plant = RemotePlant.load(bridge, mjcf, seed, controller);
      return new RailDroneNode(plant, bridge, record);
    } catch (error) {
      bridge.close();
      if (error instanceof EngineFailure && error.code === 'engine_error' && /^cannot_load/.test(error.reason ?? '')) throw new EngineFailure('engine_error', `node ${record.nodeId} is a body, not a simulator: it cannot load a scene (the real-node lane, BACKLOG B6)`, error.reason);
      throw error;
    }
  }

  /** The session id the node holds for this world (specs). */
  get session(): string { return this.plant.session; }

  step(setpoint: Pose3Yaw, phase: PlantPhase, dt: number): PlantStep { return this.plant.step(setpoint, phase, dt); }

  sense(spec: SenseSpec): PlantFrames { return this.plant.sense(spec); }

  /** @description A copy for a rehearsal, or null when the node says it is one body (cannot_clone): the rehearsal then runs on the kinematic twin. */
  clone(): PhysicsPlant | null {
    try { return this.plant.clone(); } catch (error) {
      if (error instanceof EngineFailure && error.code === 'engine_error' && /^cannot_clone/.test(error.reason ?? '')) return null;
      throw error;
    }
  }

  drop(): void {
    if (this.dropped) return;
    this.dropped = true;
    this.plant.drop();
    this.bridge.close();
  }
}
