/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (B22, half a) — the printed arm standing IN a room
 *                     |                             | instead of on its bench: the same body chain the sizing check
 *                     |                             | loads, mounted at a world pose, with the scene's own solids as
 *                     |                             | the static world around it (the shared `sceneGeoms`, so the arm
 *                     |                             | and the drone collide with the same room). Two refusals live
 *                     |                             | here because they are geometry, not policy: a base outside the
 *                     |                             | room's extent, and a base standing inside a solid.
 */
import { ARM_GEOM_DEFAULT, ARM_PREAMBLE, armActuatorLines, armChainLines, ARM_BASE_HALF_M, ARM_BASE_RADIUS_M, armExcludes, armPlant } from './arm-mjcf';
import { sceneGeoms } from './mjcf';
import type { ArmFit } from '../design/arm-design';
import type { SensedSolid } from '../sense/raycast';

const f = (v: number): string => (Math.abs(v) < 1e-12 ? '0' : Number(v.toFixed(6)).toString());

/** @description Where the arm's base stands in the world: the carriage pose the kinematic sim already computes. */
export interface ArmMount {
  x: number;
  y: number;
  /** The top of the carriage — the arm's base plate rests here. */
  z: number;
  yaw: number;
}

/** @description The room the mount is checked against: the scene's own extent. */
export interface RoomExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  ceiling: number;
}

/**
 * @description Whether a solid's box overlaps the arm base's footprint (its cylinder taken as its bounding square) in
 * the layer the base occupies. The base is a printed plate, not a point: a scanned scene whose furniture sits where the
 * arm stands would otherwise load as a model with the shoulder buried inside a cupboard and report torques for it.
 * @param s - A scene solid.
 * @param mount - The base pose.
 * @returns True when the solid and the base share space.
 */
export function solidHitsBase(s: SensedSolid, mount: ArmMount): boolean {
  const r = ARM_BASE_RADIUS_M;
  const overlaps = s.min[0] < mount.x + r && s.max[0] > mount.x - r && s.min[1] < mount.y + r && s.max[1] > mount.y - r;
  return overlaps && s.min[2] < mount.z + 2 * ARM_BASE_HALF_M && s.max[2] > mount.z + 1e-4;
}

/**
 * @description Check a mount before any model is built, and say which clause failed. A model that loads with the arm
 * outside the room or inside the furniture still runs — it just simulates a machine that is not the one in the room —
 * so the refusal has to happen here, not be left for the physics to express as a contact.
 * @param room - The scene's extent.
 * @param solids - The scene's solids (the same list the sensors cast against).
 * @param mount - Where the base would stand.
 * @returns Null when the mount is good, otherwise the reason it is refused.
 */
export function armMountRefusal(room: RoomExtent, solids: readonly SensedSolid[], mount: ArmMount): string | null {
  const r = ARM_BASE_RADIUS_M;
  if (mount.x - r < room.minX || mount.x + r > room.maxX || mount.y - r < room.minY || mount.y + r > room.maxY) {
    return `refused: the arm's base at (${f(mount.x)}, ${f(mount.y)}) stands outside the room`;
  }
  if (mount.z < -1e-6 || mount.z + 2 * ARM_BASE_HALF_M > room.ceiling) {
    return `refused: the arm's base at ${f(mount.z)} m stands outside the room's height`;
  }
  // The floor is a solid in every scene and the base rests ON it, so the floor slab is never the thing in the way.
  const hit = solids.find((s) => s.name !== 'floor' && solidHitsBase(s, mount));
  return hit ? `refused: the arm's base at (${f(mount.x)}, ${f(mount.y)}) stands inside ${hit.name}` : null;
}

/**
 * @description The MJCF for the arm standing in a room: the scene's solids as static geoms, the arm's own chain mounted
 * at the carriage pose. There is no bench plane and no block — the room supplies the floor and whatever is on it, and
 * the objects a task moves are the scene's, tracked by the simulation that owns them.
 * @param fit - The arm fit (the same fit the sizing check measures).
 * @param solids - The scene's solids.
 * @param mount - Where the base stands.
 * @returns MJCF XML.
 */
export function armRoomMjcf(fit: ArmFit, solids: readonly SensedSolid[], mount: ArmMount): string {
  const p = armPlant(fit);
  const half = ARM_BASE_HALF_M;
  const q = [Math.cos(mount.yaw / 2), 0, 0, Math.sin(mount.yaw / 2)].map(f).join(' ');
  const lines = [
    `<mujoco model="embodied-arm-room-${fit}">`,
    ...ARM_PREAMBLE,
    // MJCF allows one top-level <default>: the arm's own geom default, with the scene class nested inside it.
    `  <default>${ARM_GEOM_DEFAULT}<default class="scene"><geom contype="1" conaffinity="1" friction="0.8 0.005 0.0001" rgba="0.6 0.6 0.65 1"/></default></default>`,
    '  <worldbody>',
    '    <light pos="0 0 2" dir="0 0 -1"/>',
    sceneGeoms(solids),
    `    <body name="arm-base" pos="${f(mount.x)} ${f(mount.y)} ${f(mount.z)}" quat="${q}">`,
    `      <geom name="base" type="cylinder" pos="0 0 ${f(half)}" size="${f(ARM_BASE_RADIUS_M)} ${f(half)}" contype="0" conaffinity="0" rgba="0.4 0.4 0.4 1"/>`,
    ...armChainLines(p, '      '),
    '    </body>',
    '  </worldbody>',
    `  <contact>${armExcludes().concat('<exclude body1="arm-base" body2="link1"/>').join('')}</contact>`,
    '  <actuator>',
    ...armActuatorLines(p),
    '  </actuator>',
    '</mujoco>',
  ];
  return lines.join('\n') + '\n';
}
