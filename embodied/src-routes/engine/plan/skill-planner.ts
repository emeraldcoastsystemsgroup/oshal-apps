/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the skill plan (a typed, validated sequence
 *                     |                             | of node commands with expectations) and the deterministic
 *                     |                             | planner for the first task: clear a surface into another —
 *                     |                             | drone surveys, base navigates (A* + line-of-sight legs), lift
 *                     |                             | rises to work, arm grasps from above, carries at the lifted
 *                     |                             | speed, places in a free slot, and the drone verifies both
 *                     |                             | surfaces before landing. No model, no seed: same world, same
 *                     |                             | plan.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Discovered-id planning: `planExplore` (frontier exploration), `planClearSurface(fromId, toId)` against discovered surfaces/objects (standoffs searched in the discovered grid, slots on discovered free columns, unreachable objects skipped and expected to remain, drone verification via `world.expect`); the scene-zone variant renamed `planClearSceneSurface`; fetch-from-appliance scans at the opening and looks into and up the shelf before reaching; contact radii on retracts. MAX_WORK_REACH 0.56.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Keep every planner under the 50-line rule: the drone verification tail, the clear-surface summary and the close-door-and-verify sequence are helpers (no behaviour change; step order and ids identical).
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | `planExplore(sim, maxScans, { droneFirst })` — the rover parked, the drone alone; every scripted vantage scans (registers) before it observes, because a picture back-projected from a drifted pose is a wrong measurement.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | A discovered-id place picks the nearest slot WITH a reachable standoff (`reachableSlot`) instead of throwing on a free slot at the back of a deep counter; the shelf pick also looks DOWN into the opening — the space under the shelf lip is where the forearm passes.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Slot spacing uses BOTH extents: a mug spaced from a plate by the mug's own size touched the plate and the two read back as one object.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | B14: the `drone.recover` step — the executor inserts it before a flight refused for a lost localisation.
 */

import { READY_Q, STOW_Q } from '../arm/arm-model';
import type { DriveGoal } from '../base/diff-drive';
import type { Pose2, Pose6, Vec3 } from '../math/vec';
import { ARM_MOUNT_X, type WorldSim } from '../sim/world-sim';
import { buildGrid, isFree, planPath, simplifyPath, type Grid, type Point2 } from '../world/occupancy-grid';
import type { DiscoveredObject, DiscoveredSurface } from '../world/world-model';
import { applianceById, doorDirection, doorNormal, handleGrasp, isEnclosed, OBJECT_CLASSES, objectById, objectsOn, restingZ, sceneSolids, surfaceById, zoneById, type Appliance, type Scene, type Surface, type WorldObject, type Zone } from '../world/scene';

/** @description One command in a plan, with what must be true afterwards. */
export type PlanStep =
  | { id: string; kind: 'drone.takeoff'; label: string }
  | { id: string; kind: 'drone.goto'; label: string; target: Vec3 }
  | { id: string; kind: 'drone.observe'; label: string; zoneId: string; pitch: number; yaw: number; expectPresent: string[]; expectAbsent: string[] }
  | { id: string; kind: 'drone.land'; label: string }
  | { id: string; kind: 'base.drive'; label: string; legs: DriveGoal[] }
  | { id: string; kind: 'base.lift'; label: string; z: number }
  | { id: string; kind: 'arm.move'; label: string; target: Pose6; expectedForceN: number; contactRadius?: number }
  | { id: string; kind: 'arm.joints'; label: string; q: number[] }
  | { id: string; kind: 'arm.grasp'; label: string; objectId: string }
  | { id: string; kind: 'arm.release'; label: string; surfaceId: string }
  | { id: string; kind: 'arm.grasp-handle'; label: string; applianceId: string }
  | { id: string; kind: 'arm.release-handle'; label: string; applianceId: string }
  | { id: string; kind: 'rover.scan'; label: string }
  | { id: string; kind: 'drone.scan'; label: string }
  | { id: string; kind: 'wrist.scan'; label: string }
  | { id: string; kind: 'drone.explore'; label: string; maxScans: number }
  | { id: string; kind: 'drone.recover'; label: string }
  | { id: string; kind: 'world.expect'; label: string; surfaceId: string; minObjects?: number; maxObjects?: number };

/** @description A complete plan. */
export interface SkillPlan {
  task: string;
  title: string;
  steps: PlanStep[];
  summary: string[];
}

/** @description The lift height the arm works from (m). */
export const WORK_LIFT_Z = 0.85;
/** @description Approach height above an object before descending (m). */
export const APPROACH_CLEARANCE = 0.15;
/** @description Lift height after a grasp before moving (m). */
export const CARRY_CLEARANCE = 0.12;

/** @description Tool-down pose over a point: roll π makes the tool z point at the floor. */
export const toolDown = (x: number, y: number, z: number, yaw: number): Pose6 => ({ x, y, z, roll: Math.PI, pitch: 0, yaw });
/** @description Tool-level pose: roll −π/2 makes the tool z horizontal, pointing along (−sin yaw, cos yaw). */
export const toolLevel = (x: number, y: number, z: number, yaw: number): Pose6 => ({ x, y, z, roll: -Math.PI / 2, pitch: 0, yaw });
/** @description A level pose backed off along its own tool axis by `d` metres (positive = away from the target). */
export const backOff = (p: Pose6, d: number): Pose6 => ({ ...p, x: p.x + d * Math.sin(p.yaw), y: p.y - d * Math.cos(p.yaw) });
/** @description Door-arc waypoint spacing (rad). */
export const DOOR_ARC_STEP = Math.PI / 18;
/** @description Height above the shelf a fetched object is lifted before it is drawn out (m). */
export const SHELF_LIFT = 0.03;
/** @description Farthest horizontal distance from the arm base a tool-down grasp is planned at (m); the solver converges reliably to here. */
export const MAX_WORK_REACH = 0.56;

/** @description Sequential step ids. */
class StepIds {
  private n = 0;
  next(prefix: string): string { this.n += 1; return `${prefix}-${String(this.n).padStart(3, '0')}`; }
}

/**
 * @description The navigation grid as it will be with appliance doors at given angles — what a
 * plan must route against for the drives it makes AFTER it has opened a door.
 */
export function gridWithDoors(sim: WorldSim, doorAngles: Record<string, number>): Grid {
  const scene = JSON.parse(JSON.stringify(sim.scene)) as Scene;
  for (const a of scene.appliances) if (a.id in doorAngles) a.angle = doorAngles[a.id];
  return buildGrid(scene.room, sceneSolids(scene));
}

/**
 * @description Straight driving legs from a pose to a zone standoff: A* over the grid, simplified
 * by line of sight; each leg ends facing the next, the last at the standoff heading. Pass the
 * door angles the plan will have set by then so the legs avoid an open door.
 * @param sim - The world (its grid).
 * @param from - Start pose.
 * @param to - The standoff.
 * @returns The legs.
 */
export function driveLegs(sim: WorldSim, from: Pose2, to: Pose2, doorAngles: Record<string, number> = {}): DriveGoal[] {
  const grid = Object.keys(doorAngles).length ? gridWithDoors(sim, doorAngles) : sim.grid;
  const path = planPath(grid, from, to);
  if (!path) throw new Error(`no drivable path from (${from.x.toFixed(2)}, ${from.y.toFixed(2)}) to (${to.x.toFixed(2)}, ${to.y.toFixed(2)})`);
  const pts: Point2[] = simplifyPath(grid, path);
  const legs: DriveGoal[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const last = i === pts.length - 1;
    const yaw = last ? to.yaw : Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
    legs.push({ x: pts[i].x, y: pts[i].y, yaw });
  }
  if (!legs.length) legs.push({ x: to.x, y: to.y, yaw: to.yaw });
  return legs;
}

/** @description Free placement slots across a surface for a class, left to right, 15 cm pitch, avoiding occupied ones. */
export function placementSlots(scene: Scene, surface: Surface, cls: keyof typeof OBJECT_CLASSES): Point2[] {
  const size = OBJECT_CLASSES[cls].size;
  const pitch = Math.max(size.l, 0.12) + 0.03;
  const y = (surface.area.minY + surface.area.maxY) / 2;
  const slots: Point2[] = [];
  for (let x = surface.area.minX + size.l / 2 + 0.01; x <= surface.area.maxX - size.l / 2; x += pitch) slots.push({ x, y });
  const occupied = objectsOn(scene, surface.id);
  return slots.filter((p) => !occupied.some((o) => Math.hypot(o.pose.x - p.x, o.pose.y - p.y) < pitch * 0.9));
}

/** @description Slots ordered nearest-first to where the arm base sits at a standoff — the reachable ones come first. */
export function slotsNearest(slots: readonly Point2[], standoff: Pose2): Point2[] {
  const ax = standoff.x + ARM_MOUNT_X * Math.cos(standoff.yaw);
  const ay = standoff.y + ARM_MOUNT_X * Math.sin(standoff.yaw);
  return [...slots].sort((p, q) => Math.hypot(p.x - ax, p.y - ay) - Math.hypot(q.x - ax, q.y - ay));
}

/** @description Steps that survey a zone from the drone with expectations. */
function surveySteps(ids: StepIds, zone: Zone, present: string[], absent: string[], label: string): PlanStep[] {
  return [
    { id: ids.next('drone'), kind: 'drone.goto', label: `fly to the ${zone.name} vantage`, target: zone.droneVantage },
    { id: ids.next('scan'), kind: 'drone.scan', label: 'register the drone against the map before it looks' },
    { id: ids.next('drone'), kind: 'drone.observe', label, zoneId: zone.id, pitch: zone.dronePitch, yaw: zone.droneYaw, expectPresent: present, expectAbsent: absent },
  ];
}

/** @description Steps that pick one object from above. */
function pickSteps(ids: StepIds, o: WorldObject): PlanStep[] {
  const yaw = o.pose.yaw;
  const size = OBJECT_CLASSES[o.cls].size;
  const contact = Math.max(size.l, size.w) / 2 + 0.04;
  return [
    { id: ids.next('arm'), kind: 'arm.move', label: `approach above ${o.id}`, target: toolDown(o.pose.x, o.pose.y, o.pose.z + APPROACH_CLEARANCE, yaw), expectedForceN: 0 },
    { id: ids.next('arm'), kind: 'arm.move', label: `descend onto ${o.id}`, target: toolDown(o.pose.x, o.pose.y, o.pose.z, yaw), expectedForceN: 0, contactRadius: contact },
    { id: ids.next('arm'), kind: 'arm.grasp', label: `grasp ${o.id}`, objectId: o.id },
    { id: ids.next('arm'), kind: 'arm.move', label: `lift ${o.id} clear`, target: toolDown(o.pose.x, o.pose.y, o.pose.z + CARRY_CLEARANCE, yaw), expectedForceN: 0, contactRadius: contact },
    { id: ids.next('arm'), kind: 'arm.joints', label: 'tuck for carrying', q: [...READY_Q] },
  ];
}

/** @description Steps that place a held object at a slot. */
function placeSteps(ids: StepIds, o: WorldObject, surface: Surface, slot: Point2): PlanStep[] {
  const z = restingZ(o.cls, surface.z) + 0.005;
  return [
    { id: ids.next('arm'), kind: 'arm.move', label: `approach above the ${surface.name} slot`, target: toolDown(slot.x, slot.y, z + APPROACH_CLEARANCE, 0), expectedForceN: 0 },
    { id: ids.next('arm'), kind: 'arm.move', label: `lower ${o.id} onto the ${surface.name}`, target: toolDown(slot.x, slot.y, z, 0), expectedForceN: 0 },
    { id: ids.next('arm'), kind: 'arm.release', label: `release ${o.id}`, surfaceId: surface.id },
    { id: ids.next('arm'), kind: 'arm.move', label: 'retract', target: toolDown(slot.x, slot.y, z + APPROACH_CLEARANCE, 0), expectedForceN: 0, contactRadius: APPROACH_CLEARANCE + OBJECT_CLASSES[o.cls].size.h + 0.08 },
    { id: ids.next('arm'), kind: 'arm.joints', label: 'ready pose', q: [...READY_Q] },
  ];
}

/**
 * @description Plan "clear every object on one SCENE surface onto another" by zone id — the
 * scripted kitchen variant kept for the appliance work and comparison; it reads the hidden
 * scene, so it is not what the discovered-world task does.
 * @param sim - The current world (read only; the plan is rehearsed on a clone by the validator).
 * @param fromZoneId - Zone whose surface is cleared.
 * @param toZoneId - Zone whose surface receives the objects.
 * @returns The plan.
 */
export function planClearSceneSurface(sim: WorldSim, fromZoneId: string, toZoneId: string): SkillPlan {
  const scene = sim.scene;
  const from = zoneById(scene, fromZoneId);
  const to = zoneById(scene, toZoneId);
  const fromSurface = surfaceById(scene, from.surfaceId);
  const toSurface = surfaceById(scene, to.surfaceId);
  const objects = objectsOn(scene, fromSurface.id).filter((o) => !isEnclosed(scene, o)).sort((a, b) => a.id.localeCompare(b.id));
  if (!objects.length) throw new Error(`nothing to move: ${fromSurface.name} holds no reachable object`);
  const ids = new StepIds();
  const steps: PlanStep[] = [{ id: ids.next('drone'), kind: 'drone.takeoff', label: 'drone takes off' }];
  steps.push(...surveySteps(ids, from, objects.map((o) => o.id), [], `survey the ${from.name}: expect ${objects.length} object(s)`));
  steps.push({ id: ids.next('base'), kind: 'base.lift', label: 'stow the lift for travel', z: sim.baseLimits.liftMin });
  steps.push({ id: ids.next('base'), kind: 'arm.joints', label: 'fold the arm', q: [...STOW_Q] });
  let basePose: Pose2 = sim.basePose();
  const slots = slotsNearest(placementSlots(scene, toSurface, objects[0].cls), to.standoff);
  if (slots.length < objects.length) throw new Error(`${toSurface.name} has ${slots.length} free slot(s) for ${objects.length} object(s)`);
  /** A standoff searched in the discovered grid for a point, falling back to the zone's declared one. */
  const standoffFor = (p: Point2, fallback: Pose2): Pose2 => { try { return findStandoff(sim, p, basePose); } catch { return fallback; } };
  objects.forEach((o, i) => {
    const pickAt = standoffFor({ x: o.pose.x, y: o.pose.y }, from.standoff);
    steps.push({ id: ids.next('base'), kind: 'base.drive', label: `drive to the ${from.name}`, legs: driveLegs(sim, basePose, pickAt) });
    basePose = pickAt;
    steps.push({ id: ids.next('base'), kind: 'base.lift', label: 'raise the lift to work', z: WORK_LIFT_Z });
    steps.push({ id: ids.next('arm'), kind: 'arm.joints', label: 'ready pose', q: [...READY_Q] });
    steps.push(...pickSteps(ids, o));
    const placeAt = standoffFor(slots[i], to.standoff);
    steps.push({ id: ids.next('base'), kind: 'base.drive', label: `carry ${o.id} to the ${to.name} (lifted: slow)`, legs: driveLegs(sim, basePose, placeAt) });
    basePose = placeAt;
    steps.push(...placeSteps(ids, o, toSurface, slots[i]));
    steps.push({ id: ids.next('arm'), kind: 'arm.joints', label: 'fold the arm', q: [...STOW_Q] });
    steps.push({ id: ids.next('base'), kind: 'base.lift', label: 'stow the lift for travel', z: sim.baseLimits.liftMin });
  });
  steps.push(...surveySteps(ids, to, objects.map((o) => o.id), [], `verify the ${to.name}: expect ${objects.length} object(s)`));
  steps.push(...surveySteps(ids, from, [], objects.map((o) => o.id), `verify the ${from.name} is clear`));
  steps.push({ id: ids.next('drone'), kind: 'drone.goto', label: 'return above the pad', target: [scene.droneHome[0], scene.droneHome[1], sim.droneLimits.cruiseAlt] });
  steps.push({ id: ids.next('drone'), kind: 'drone.land', label: 'drone lands' });
  steps.push({ id: ids.next('base'), kind: 'base.drive', label: 'return to park', legs: driveLegs(sim, basePose, scene.basePark) });
  const summary = [
    `${objects.length} object(s) on the ${fromSurface.name} → ${toSurface.name}: ${objects.map((o) => o.id).join(', ')}.`,
    `Drone surveys first and verifies both surfaces at the end; the arm grasps from above and carries at the lifted speed limit.`,
    `${steps.length} steps; every kinetic step is re-validated live against the fence, the keep-out and the tip budget.`,
  ];
  return { task: 'clear-surface', title: `Clear the ${fromSurface.name} onto the ${toSurface.name}`, steps, summary };
}

// ── The discovered world ─────────────────────────────────────────────────────

/** @description Where a machine can park to work on a point: free in the discovered grid, facing it, within reach. */
export function findStandoff(sim: WorldSim, target: Point2, from: Pose2): Pose2 {
  const candidates: Pose2[] = [];
  for (const d of [0.55, 0.62, 0.70, 0.76, 0.80]) for (let k = 0; k < 24; k += 1) {
    const yaw = (2 * Math.PI * k) / 24;
    candidates.push({ x: target.x - d * Math.cos(yaw), y: target.y - d * Math.sin(yaw), yaw });
  }
  const reach = (p: Pose2): number => {
    const ax = p.x + ARM_MOUNT_X * Math.cos(p.yaw); const ay = p.y + ARM_MOUNT_X * Math.sin(p.yaw);
    return Math.hypot(target.x - ax, target.y - ay);
  };
  const free = candidates.filter((p) => isFree(sim.grid, p) && reach(p) >= 0.25 && reach(p) <= MAX_WORK_REACH);
  // Comfortable reach first (the arm works best around 0.45 m out), then the shortest drive.
  free.sort((a, b) => Math.abs(reach(a) - 0.45) - Math.abs(reach(b) - 0.45) || Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
  if (!free.length) throw new Error(`no free standoff around (${target.x.toFixed(2)}, ${target.y.toFixed(2)}) in the discovered map — explore more, or the area is blocked`);
  return free[0];
}

/** @description Free slots on a discovered surface for an object of a given extent, nearest a standoff first. */
export function discoveredSlots(sim: WorldSim, surface: DiscoveredSurface, extent: number, near: Pose2): Point2[] {
  const margin = extent / 2 + 0.04;
  const columns = new Set(surface.columns);
  const map = sim.world.map;
  const others = sim.world.objectsOn(surface.id);
  const slots: Point2[] = [];
  for (let x = surface.bbox.minX + margin; x <= surface.bbox.maxX - margin; x += 0.10) for (let y = surface.bbox.minY + margin; y <= surface.bbox.maxY - margin; y += 0.10) {
    let inside = true;
    for (const [dx, dy] of [[-margin, -margin], [margin, -margin], [-margin, margin], [margin, margin], [0, 0]]) if (!columns.has(map.column(x + dx, y + dy))) { inside = false; break; }
    if (!inside) continue;
    // Two clear columns between things, or the next scan reads them as one bump.
    if (others.some((o) => Math.hypot(o.centroid[0] - x, o.centroid[1] - y) < margin + Math.max(o.size.l, o.size.w) / 2 + 0.10)) continue;
    slots.push({ x, y });
  }
  return slotsNearest(slots, near);
}

/**
 * @description Plan "explore the room": the base LiDAR clears the machine's surroundings, the
 * drone scans from the pad, climbs, and flies frontier to frontier scanning until the flight
 * layer has no frontier or the scan budget is spent, then returns to the pad. Every later plan
 * is drafted against what this one mapped.
 */
export interface ExploreOptions {
  /** The rover stays parked and the drone maps the room alone: its upward ranger clears the climb, scan-to-map registration keeps its pose. */
  droneFirst?: boolean;
}

export function planExplore(sim: WorldSim, maxScans = 12, opts: ExploreOptions = {}): SkillPlan {
  const ids = new StepIds();
  const home = sim.scene.droneHome;
  const steps: PlanStep[] = [
    ...(opts.droneFirst ? [] : [{ id: ids.next('scan'), kind: 'rover.scan' as const, label: 'base LiDAR sweep' }]),
    { id: ids.next('scan'), kind: 'drone.scan', label: opts.droneFirst ? 'drone LiDAR sweep from the pad — the upward ranger clears the climb' : 'drone LiDAR sweep from the pad' },
    { id: ids.next('drone'), kind: 'drone.takeoff', label: 'drone takes off' },
    { id: ids.next('scan'), kind: 'drone.scan', label: 'drone LiDAR sweep at altitude' },
    { id: ids.next('drone'), kind: 'drone.explore', label: `explore frontier to frontier (up to ${maxScans} scans)`, maxScans },
    { id: ids.next('drone'), kind: 'drone.goto', label: 'return above the pad', target: [home[0], home[1], sim.droneLimits.cruiseAlt] },
    { id: ids.next('drone'), kind: 'drone.land', label: 'drone lands' },
  ];
  const opening = opts.droneFirst
    ? 'The machine starts knowing nothing and the rover stays parked: the drone maps the room alone. Its upward ranger clears the column it climbs through; every sweep is registered against the map it has already built before it is integrated, so its pose is an estimate kept honest by its own LiDAR; the rover\'s base LiDAR fills the low band later as it works.'
    : 'The machine starts knowing nothing. The base LiDAR and the drone map the room; surfaces and objects are discovered from the map, not from a file.';
  return { task: 'explore', title: opts.droneFirst ? 'Explore the room — drone first' : 'Explore the room', steps, summary: [opening, `Up to ${maxScans} drone scans, frontier to frontier; the drone only flies through space it has already seen free.`] };
}

/** @description Pick steps for a discovered object: look, scan, approach from above, descend (touching only the target), grasp, lift, tuck. */
function discoveredPickSteps(ids: StepIds, o: DiscoveredObject, standoff: Pose2): PlanStep[] {
  const [x, y, z] = o.centroid;
  const top = o.max[2];
  const contact = Math.max(o.size.l, o.size.w) / 2 + 0.04;
  return [
    { id: ids.next('arm'), kind: 'arm.move', label: `look at ${o.id} with the wrist camera`, target: toolDown(x, y, top + 0.35, 0), expectedForceN: 0 },
    { id: ids.next('scan'), kind: 'wrist.scan', label: `wrist depth picture of ${o.id}` },
    { id: ids.next('arm'), kind: 'arm.move', label: `approach above ${o.id}`, target: toolDown(x, y, top + APPROACH_CLEARANCE, 0), expectedForceN: 0 },
    { id: ids.next('arm'), kind: 'arm.move', label: `descend onto ${o.id}`, target: toolDown(x, y, z, 0), expectedForceN: 0, contactRadius: contact },
    { id: ids.next('arm'), kind: 'arm.grasp', label: `grasp ${o.id}`, objectId: '*' },
    { id: ids.next('arm'), kind: 'arm.move', label: `lift ${o.id} clear`, target: toolDown(x, y, top + CARRY_CLEARANCE, 0), expectedForceN: 0, contactRadius: contact },
    { id: ids.next('arm'), kind: 'arm.move', label: 'tuck for carrying', target: carryPose(standoff, WORK_LIFT_Z), expectedForceN: 0 },
  ];
}

/** @description Survey a discovered surface with the wrist camera from 45 cm above a reachable point on it, so what the drone missed is mapped before anything is picked. */
function surveySurfaceSteps(ids: StepIds, s: DiscoveredSurface, at: Point2): PlanStep[] {
  return [
    { id: ids.next('arm'), kind: 'arm.move', label: `look over ${s.label ?? s.id} with the wrist camera`, target: toolDown(at.x, at.y, s.z + 0.45, 0), expectedForceN: 0 },
    { id: ids.next('scan'), kind: 'wrist.scan', label: `wrist depth picture of ${s.label ?? s.id}` },
  ];
}

/** @description Place steps onto a discovered surface slot, then look at what was placed. */
function discoveredPlaceSteps(ids: StepIds, o: DiscoveredObject, surface: DiscoveredSurface, slot: Point2, standoff: Pose2): PlanStep[] {
  const z = surface.z + o.size.h / 2 + 0.005;
  return [
    { id: ids.next('arm'), kind: 'arm.move', label: `approach above the ${surface.label ?? surface.id} slot`, target: toolDown(slot.x, slot.y, z + APPROACH_CLEARANCE, 0), expectedForceN: 0 },
    { id: ids.next('arm'), kind: 'arm.move', label: `lower ${o.id} onto ${surface.label ?? surface.id}`, target: toolDown(slot.x, slot.y, z, 0), expectedForceN: 0 },
    { id: ids.next('arm'), kind: 'arm.release', label: `release ${o.id}`, surfaceId: '*' },
    { id: ids.next('arm'), kind: 'arm.move', label: 'retract', target: toolDown(slot.x, slot.y, z + 0.35, 0), expectedForceN: 0, contactRadius: 0.35 + o.size.h + 0.08 },
    { id: ids.next('scan'), kind: 'wrist.scan', label: 'wrist depth picture of the placed object' },
    { id: ids.next('arm'), kind: 'arm.move', label: 'tool back ahead of the base', target: carryPose(standoff, WORK_LIFT_Z), expectedForceN: 0 },
  ];
}

/**
 * @description Plan "clear every discovered object on one discovered surface onto another". Drafted
 * against the map: standoffs are searched in the discovered grid, slots on the discovered surface,
 * grasps at discovered centroids; each pick and place is preceded and followed by a wrist scan and
 * the drone verifies both surfaces by scanning at the end.
 * @param sim - The current world.
 * @param fromId - A discovered surface id (e.g. `surf-4`).
 * @param toId - A discovered surface id.
 * @returns The plan.
 */
export function planClearSurface(sim: WorldSim, fromId: string, toId: string): SkillPlan {
  const world = sim.world;
  const from = world.surface(fromId); const to = world.surface(toId);
  if (!from) throw new Error(`no discovered surface ${fromId} — explore first`);
  if (!to) throw new Error(`no discovered surface ${toId} — explore first`);
  const objects = [...world.objectsOn(fromId)].sort((a, b) => a.id.localeCompare(b.id));
  if (!objects.length) throw new Error(`nothing discovered on ${from.label ?? fromId}`);
  const ids = new StepIds();
  const steps: PlanStep[] = [];
  steps.push(...stowSteps(ids, sim));
  let basePose: Pose2 = sim.basePose();
  const placed: { x: number; y: number; extent: number }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  let surveyed = false;
  objects.forEach((o) => {
    let standoff: Pose2;
    try { standoff = findStandoff(sim, { x: o.centroid[0], y: o.centroid[1] }, basePose); } catch (error) { skipped.push({ id: o.id, reason: error instanceof Error ? error.message : String(error) }); return; }
    const index = surveyed ? 1 : 0; surveyed = true;
    steps.push({ id: ids.next('base'), kind: 'base.drive', label: `drive to ${o.id} (${o.guess})`, legs: driveLegs(sim, basePose, standoff) });
    basePose = standoff;
    steps.push({ id: ids.next('scan'), kind: 'rover.scan', label: 'base LiDAR sweep at the standoff' });
    steps.push({ id: ids.next('base'), kind: 'base.lift', label: 'raise the lift to work', z: WORK_LIFT_Z });
    if (index === 0) steps.push(...surveySurfaceSteps(ids, from, { x: o.centroid[0], y: o.centroid[1] }), ...surveySurfaceSteps(ids, from, { x: (o.centroid[0] + from.centroid[0]) / 2, y: (o.centroid[1] + from.centroid[1]) / 2 }));
    steps.push(...discoveredPickSteps(ids, o, standoff));
    const extent = Math.max(o.size.l, o.size.w);
    // Two placed things must not touch in the map: half of each extent, two clear columns, and a little.
    const chosen = reachableSlot(sim, discoveredSlots(sim, to, extent, basePose).filter((s) => !placed.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < (extent + p.extent) / 2 + 0.14)), basePose);
    if (!chosen) throw new Error(`${to.label ?? toId} has no free slot for ${o.id} that the arm can reach from the discovered map`);
    const { slot, standoff: toStandoff } = chosen;
    placed.push({ x: slot.x, y: slot.y, extent });
    steps.push({ id: ids.next('base'), kind: 'base.drive', label: `carry ${o.id} to ${to.label ?? toId} (lifted: slow)`, legs: driveLegs(sim, basePose, toStandoff) });
    basePose = toStandoff;
    steps.push(...discoveredPlaceSteps(ids, o, to, slot, toStandoff));
    steps.push(...stowSteps(ids, sim));
  });
  const moved = objects.length - skipped.length;
  if (!moved) throw new Error(`no object on ${from.label ?? fromId} has a reachable standoff: ${skipped.map((s) => s.id).join(', ')}`);
  steps.push(...verifyBySurveySteps(ids, sim, from, to, moved, skipped.length));
  steps.push({ id: ids.next('base'), kind: 'base.drive', label: 'return to park', legs: driveLegs(sim, basePose, sim.scene.basePark) });
  return { task: 'clear-surface', title: `Clear ${from.label ?? fromId} onto ${to.label ?? toId}`, steps, summary: clearSurfaceSummary(objects, skipped, steps.length) };
}

/** @description The first slot (nearest first) that has a standoff the base can reach in the discovered map — a slot at the back of a deep counter is free but useless. */
function reachableSlot(sim: WorldSim, slots: Point2[], from: Pose2): { slot: Point2; standoff: Pose2 } | null {
  for (const slot of slots) {
    try { return { slot, standoff: findStandoff(sim, slot, from) }; } catch { /* try the next slot */ }
  }
  return null;
}

/** @description The verification tail of a discovered-id plan: the drone scans the destination and the source, the map must agree with the counts, then it returns and lands. */
function verifyBySurveySteps(ids: StepIds, sim: WorldSim, from: DiscoveredSurface, to: DiscoveredSurface, moved: number, left: number): PlanStep[] {
  const above = (s: DiscoveredSurface): Vec3 => [s.centroid[0], s.centroid[1] - 0.3, sim.droneLimits.cruiseAlt];
  const name = (s: DiscoveredSurface): string => s.label ?? s.id;
  return [
    { id: ids.next('drone'), kind: 'drone.takeoff', label: 'drone takes off to verify' },
    { id: ids.next('drone'), kind: 'drone.goto', label: `fly over ${name(to)}`, target: above(to) },
    { id: ids.next('scan'), kind: 'drone.scan', label: 'scan the destination' },
    { id: ids.next('check'), kind: 'world.expect', label: `expect ${moved} object(s) on ${name(to)}`, surfaceId: to.id, minObjects: moved },
    { id: ids.next('drone'), kind: 'drone.goto', label: `fly over ${name(from)}`, target: above(from) },
    { id: ids.next('scan'), kind: 'drone.scan', label: 'scan the source' },
    { id: ids.next('check'), kind: 'world.expect', label: left ? `expect at most ${left} object(s) left on ${name(from)}` : `expect ${name(from)} clear`, surfaceId: from.id, maxObjects: left },
    { id: ids.next('drone'), kind: 'drone.goto', label: 'return above the pad', target: [sim.scene.droneHome[0], sim.scene.droneHome[1], sim.droneLimits.cruiseAlt] },
    { id: ids.next('drone'), kind: 'drone.land', label: 'drone lands' },
  ];
}

/** @description The human-readable summary of a discovered-id clear-surface plan. */
function clearSurfaceSummary(objects: DiscoveredObject[], skipped: { id: string; reason: string }[], stepCount: number): string[] {
  const moved = objects.filter((o) => !skipped.some((s) => s.id === o.id));
  return [
    `${moved.length} of ${objects.length} discovered object(s) planned: ${moved.map((o) => `${o.id} (${o.guess})`).join(', ')}.`,
    ...(skipped.length ? [`Left where they are — no reachable standoff in the discovered map: ${skipped.map((s) => s.id).join(', ')}.`] : []),
    'Every target is a mapped centroid; every standoff and slot was searched in the discovered map; the wrist camera looks before and after each grasp; the drone re-scans both surfaces at the end.',
    `${stepCount} steps.`,
  ];
}

/** @description After the delivery: back beside the door, push it shut, stow, verify the delivery by drone, bring the drone home. */
function closeDoorAndVerifySteps(ids: StepIds, sim: WorldSim, a: Appliance, o: WorldObject, to: Zone, doorStandoff: Pose2, from: Pose2, open: Record<string, number>): PlanStep[] {
  const door = a.door as NonNullable<Appliance['door']>;
  const steps: PlanStep[] = [{ id: ids.next('base'), kind: 'base.drive', label: `return beside the ${a.name} door`, legs: driveLegs(sim, from, doorStandoff, open) }];
  steps.push({ id: ids.next('base'), kind: 'base.lift', label: 'raise the lift to the handle', z: WORK_LIFT_Z });
  steps.push(...swingDoorSteps(ids, a, door.maxOpen, 0, 'push', doorStandoff));
  steps.push(...stowSteps(ids, sim));
  steps.push(...surveySteps(ids, to, [o.id], [], `verify ${o.id} on the ${to.name}`));
  steps.push({ id: ids.next('drone'), kind: 'drone.goto', label: 'return above the pad', target: [sim.scene.droneHome[0], sim.scene.droneHome[1], sim.droneLimits.cruiseAlt] });
  steps.push({ id: ids.next('drone'), kind: 'drone.land', label: 'drone lands' });
  return steps;
}

/** @description The handle pose (tool level, pointing into the door) at a swing angle. */
function handlePose(a: Appliance, angle: number): Pose6 {
  const g = handleGrasp(a.door as NonNullable<Appliance['door']>, angle);
  return toolLevel(g.point[0], g.point[1], g.point[2], g.yaw);
}

/**
 * @description Steps that swing a held door from one angle to another along the handle arc, one
 * waypoint per {@link DOOR_ARC_STEP}. The first waypoint off the seal carries the seal force;
 * every other waypoint the swing force — the numbers the tip budget is checked against.
 */
function doorArcSteps(ids: StepIds, a: Appliance, from: number, to: number, verb: string): PlanStep[] {
  const door = a.door as NonNullable<Appliance['door']>;
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / DOOR_ARC_STEP));
  const steps: PlanStep[] = [];
  for (let k = 1; k <= n; k += 1) {
    const angle = from + ((to - from) * k) / n;
    const force = k === 1 && from === 0 ? door.sealForceN : door.swingForceN;
    steps.push({ id: ids.next('arm'), kind: 'arm.move', label: `${verb} the ${a.name} door to ${Math.round((angle * 180) / Math.PI)}°`, target: handlePose(a, angle), expectedForceN: force });
  }
  return steps;
}

/**
 * @description A pose moved `d` metres toward the arm base of a parked machine (the arm base is
 * {@link ARM_MOUNT_X} ahead of the base origin). Approaching and retracting along this line always
 * shortens the reach, whatever way the door has swung.
 */
export function towardArmBase(p: Pose6, standoff: Pose2, d: number): Pose6 {
  const ax = standoff.x + ARM_MOUNT_X * Math.cos(standoff.yaw);
  const ay = standoff.y + ARM_MOUNT_X * Math.sin(standoff.yaw);
  const len = Math.hypot(ax - p.x, ay - p.y) || 1;
  return { ...p, x: p.x + ((ax - p.x) / len) * d, y: p.y + ((ay - p.y) / len) * d };
}

/**
 * @description The tool's way in to (and out from) a handle at a swing angle: a point just beyond
 * the door's free end on the handle side, then a point 6 cm off the handle, then the grasp. The
 * arm always rounds the free end — never the panel — whichever way the door has swung.
 */
function doorWaypoints(a: Appliance, angle: number): { beyond: Pose6; near: Pose6; grasp: Pose6 } {
  const door = a.door as NonNullable<Appliance['door']>;
  const d = doorDirection(door, angle);
  const n = doorNormal(door, angle);
  const g = handleGrasp(door, angle);
  const fx = door.hinge.x + door.width * d[0];
  const fy = door.hinge.y + door.width * d[1];
  return {
    beyond: toolLevel(fx + 0.12 * d[0] + 0.10 * n[0], fy + 0.12 * d[1] + 0.10 * n[1], door.handleZ, g.yaw),
    near: toolLevel(g.point[0] + 0.06 * n[0], g.point[1] + 0.06 * n[1], g.point[2], g.yaw),
    grasp: toolLevel(g.point[0], g.point[1], g.point[2], g.yaw),
  };
}

/**
 * @description A straight Cartesian move broken into legs of at most `stepM`, so each joint-space
 * sweep between consecutive targets stays close to the line. Used for transitions beside
 * obstacles, where a single long joint interpolation would arc the tool through them.
 */
export function lineSteps(ids: StepIds, from: Pose6, to: Pose6, label: string, stepM = 0.10): PlanStep[] {
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / stepM));
  const steps: PlanStep[] = [];
  for (let k = 1; k <= n; k += 1) {
    const t = k / n;
    const target: Pose6 = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t, roll: to.roll, pitch: to.pitch, yaw: from.yaw + (to.yaw - from.yaw) * t };
    steps.push({ id: ids.next('arm'), kind: 'arm.move', label: n === 1 ? label : `${label} (${k}/${n})`, target, expectedForceN: 0 });
  }
  return steps;
}

/** @description Take the handle at the door's current angle, swing it to `to`, let go and back out around the free end, tucking the tool ahead of the base on the way in and out. */
function swingDoorSteps(ids: StepIds, a: Appliance, from: number, to: number, verb: string, standoff: Pose2): PlanStep[] {
  const start = doorWaypoints(a, from);
  const end = doorWaypoints(a, to);
  const tuck = carryPose(standoff, WORK_LIFT_Z);
  return [
    { id: ids.next('arm'), kind: 'arm.move', label: 'tool ahead of the base', target: tuck, expectedForceN: 0 },
    ...lineSteps(ids, tuck, start.beyond, `round the ${a.name} door's free end`),
    { id: ids.next('arm'), kind: 'arm.move', label: `approach the ${a.name} handle`, target: start.near, expectedForceN: 0, contactRadius: 0.10 },
    { id: ids.next('arm'), kind: 'arm.move', label: `reach the ${a.name} handle`, target: start.grasp, expectedForceN: 0, contactRadius: 0.10 },
    { id: ids.next('arm'), kind: 'arm.grasp-handle', label: `take the ${a.name} handle`, applianceId: a.id },
    ...doorArcSteps(ids, a, from, to, verb),
    { id: ids.next('arm'), kind: 'arm.release-handle', label: `let go of the ${a.name} handle`, applianceId: a.id },
    { id: ids.next('arm'), kind: 'arm.move', label: 'back off the handle', target: end.near, expectedForceN: 0, contactRadius: 0.22 },
    { id: ids.next('arm'), kind: 'arm.move', label: `clear the ${a.name} door's free end`, target: end.beyond, expectedForceN: 0 },
    ...lineSteps(ids, end.beyond, tuck, 'tool back ahead of the base'),
  ];
}

/** @description A compact travelling pose for a level-held object: 0.25 m ahead of the arm base, 0.35 m above the carriage, tool pointing forward. */
export function carryPose(standoff: Pose2, liftZ: number): Pose6 {
  const ax = standoff.x + ARM_MOUNT_X * Math.cos(standoff.yaw);
  const ay = standoff.y + ARM_MOUNT_X * Math.sin(standoff.yaw);
  return toolLevel(ax + 0.25 * Math.cos(standoff.yaw), ay + 0.25 * Math.sin(standoff.yaw), liftZ + 0.35, standoff.yaw - Math.PI / 2);
}

/** @description Steps that take an object from a shelf with a level (front) grasp, draw it out and tuck it for travel. */
function shelfPickSteps(ids: StepIds, o: WorldObject, standoff: Pose2, liftZ: number): PlanStep[] {
  const at = toolLevel(o.pose.x, o.pose.y, o.pose.z, standoff.yaw - Math.PI / 2);
  const approach = backOff(at, 0.15);
  return [
    { id: ids.next('arm'), kind: 'arm.move', label: `level the tool toward ${o.id}`, target: towardArmBase(approach, standoff, 0.30), expectedForceN: 0 },
    { id: ids.next('scan'), kind: 'wrist.scan', label: 'wrist depth picture into the opening' },
    // Tilt the wrist camera up (roll toward level lifts the tool axis): the arm will reach through the upper part of the opening.
    { id: ids.next('arm'), kind: 'arm.move', label: 'tilt the wrist camera up into the opening', target: { ...towardArmBase(approach, standoff, 0.30), roll: -Math.PI / 2 + 0.55 }, expectedForceN: 0 },
    { id: ids.next('scan'), kind: 'wrist.scan', label: 'wrist depth picture of the upper opening' },
    // And down: the space under the shelf lip behind the door line is where the forearm passes on the reach.
    { id: ids.next('arm'), kind: 'arm.move', label: 'tilt the wrist camera down into the opening', target: { ...towardArmBase(approach, standoff, 0.30), roll: -Math.PI / 2 - 0.55 }, expectedForceN: 0 },
    { id: ids.next('scan'), kind: 'wrist.scan', label: 'wrist depth picture of the lower opening' },
    { id: ids.next('arm'), kind: 'arm.move', label: `approach ${o.id} on the shelf`, target: approach, expectedForceN: 0 },
    { id: ids.next('scan'), kind: 'wrist.scan', label: `wrist depth picture of ${o.id} up close` },
    { id: ids.next('arm'), kind: 'arm.move', label: `reach ${o.id}`, target: at, expectedForceN: 0, contactRadius: 0.16 },
    { id: ids.next('arm'), kind: 'arm.grasp', label: `grasp ${o.id}`, objectId: o.id },
    { id: ids.next('arm'), kind: 'arm.move', label: `lift ${o.id} off the shelf`, target: { ...at, z: at.z + SHELF_LIFT }, expectedForceN: 0, contactRadius: 0.12 },
    { id: ids.next('arm'), kind: 'arm.move', label: `draw ${o.id} out`, target: backOff({ ...at, z: at.z + SHELF_LIFT }, 0.30), expectedForceN: 0 },
    { id: ids.next('arm'), kind: 'arm.move', label: `tuck ${o.id} for travel`, target: carryPose(standoff, liftZ), expectedForceN: 0 },
  ];
}

/** @description Steps that set a level-held object down on a surface slot from the carry pose. */
function shelfPlaceSteps(ids: StepIds, o: WorldObject, surface: Surface, slot: Point2, standoff: Pose2): PlanStep[] {
  const z = restingZ(o.cls, surface.z) + 0.005;
  const yaw = standoff.yaw - Math.PI / 2;
  return [
    { id: ids.next('arm'), kind: 'arm.move', label: `approach above the ${surface.name} slot`, target: toolLevel(slot.x, slot.y, z + APPROACH_CLEARANCE, yaw), expectedForceN: 0 },
    { id: ids.next('arm'), kind: 'arm.move', label: `lower ${o.id} onto the ${surface.name}`, target: toolLevel(slot.x, slot.y, z, yaw), expectedForceN: 0 },
    { id: ids.next('arm'), kind: 'arm.release', label: `release ${o.id}`, surfaceId: surface.id },
    { id: ids.next('arm'), kind: 'arm.move', label: 'retract', target: backOff(toolLevel(slot.x, slot.y, z + APPROACH_CLEARANCE, yaw), 0.15), expectedForceN: 0, contactRadius: 0.22 + OBJECT_CLASSES[o.cls].size.h + 0.08 },
    { id: ids.next('arm'), kind: 'arm.move', label: 'draw the tool back', target: towardArmBase(backOff(toolLevel(slot.x, slot.y, z + APPROACH_CLEARANCE, yaw), 0.15), standoff, 0.20), expectedForceN: 0 },
  ];
}

/** @description Park the machine for travel: arm folded, lift down. */
const stowSteps = (ids: StepIds, sim: WorldSim): PlanStep[] => [
  { id: ids.next('base'), kind: 'arm.joints', label: 'fold the arm', q: [...STOW_Q] },
  { id: ids.next('base'), kind: 'base.lift', label: 'stow the lift for travel', z: sim.baseLimits.liftMin },
];

/**
 * @description Plan "open an appliance, fetch one object from inside it, deliver it to a zone,
 * and close the appliance". The door is pulled along its handle arc against the seal and swing
 * forces the tip budget is checked with; the object is taken with a level grasp and drawn out;
 * the door is pushed shut afterwards; the drone verifies the delivery.
 * @param sim - The current world.
 * @param applianceId - The appliance with a door.
 * @param objectId - An object resting on a surface the appliance encloses.
 * @param toZoneId - Where to deliver it.
 * @returns The plan.
 */
export function planFetchFromAppliance(sim: WorldSim, applianceId: string, objectId: string, toZoneId: string): SkillPlan {
  const scene = sim.scene;
  const a = applianceById(scene, applianceId);
  if (!a.door) throw new Error(`${a.name} has no door to open`);
  if (a.angle > 0.01) throw new Error(`${a.name} is already open (${Math.round((a.angle * 180) / Math.PI)}°); close it first`);
  const o = objectById(scene, objectId);
  if (o.location.kind !== 'surface' || surfaceById(scene, o.location.surfaceId).enclosedBy !== a.id) throw new Error(`${objectId} is not inside the ${a.name}`);
  const doorZone = scene.zones.find((z) => z.id === `${a.id}-door`);
  const insideZone = scene.zones.find((z) => z.id === a.id);
  if (!doorZone || !insideZone) throw new Error(`no standoffs declared for the ${a.name}`);
  const to = zoneById(scene, toZoneId);
  const toSurface = surfaceById(scene, to.surfaceId);
  const slot = slotsNearest(placementSlots(scene, toSurface, o.cls), to.standoff)[0];
  if (!slot) throw new Error(`${toSurface.name} has no free slot`);
  const ids = new StepIds();
  const steps: PlanStep[] = [{ id: ids.next('drone'), kind: 'drone.takeoff', label: 'drone takes off' }];
  steps.push(...surveySteps(ids, to, [], [o.id], `survey the ${to.name}: ${o.id} not there yet`));
  steps.push(...stowSteps(ids, sim));
  let basePose: Pose2 = sim.basePose();
  steps.push({ id: ids.next('base'), kind: 'base.drive', label: `drive beside the ${a.name} door`, legs: driveLegs(sim, basePose, doorZone.standoff) });
  basePose = doorZone.standoff;
  steps.push({ id: ids.next('base'), kind: 'base.lift', label: 'raise the lift to the handle', z: WORK_LIFT_Z });
  steps.push(...swingDoorSteps(ids, a, 0, a.door.maxOpen, 'pull', doorZone.standoff));
  steps.push(...stowSteps(ids, sim));
  const open = { [a.id]: a.door.maxOpen };
  steps.push({ id: ids.next('base'), kind: 'base.drive', label: `drive in front of the open ${a.name}`, legs: driveLegs(sim, basePose, insideZone.standoff, open) });
  basePose = insideZone.standoff;
  steps.push({ id: ids.next('scan'), kind: 'rover.scan', label: 'base LiDAR sweep at the opening' });
  steps.push({ id: ids.next('base'), kind: 'base.lift', label: 'raise the lift to the shelf', z: WORK_LIFT_Z });
  steps.push(...shelfPickSteps(ids, o, insideZone.standoff, WORK_LIFT_Z));
  steps.push({ id: ids.next('base'), kind: 'base.drive', label: `carry ${o.id} to the ${to.name} (lifted: slow)`, legs: driveLegs(sim, basePose, to.standoff, open) });
  basePose = to.standoff;
  steps.push(...shelfPlaceSteps(ids, o, toSurface, slot, to.standoff));
  steps.push(...stowSteps(ids, sim));
  steps.push(...closeDoorAndVerifySteps(ids, sim, a, o, to, doorZone.standoff, basePose, open));
  basePose = doorZone.standoff;
  steps.push({ id: ids.next('base'), kind: 'base.drive', label: 'return to park', legs: driveLegs(sim, basePose, scene.basePark) });
  const summary = [
    `Open the ${a.name} (pull ${Math.round((a.door.maxOpen * 180) / Math.PI)}° against a ${a.door.sealForceN} N seal at ${a.door.handleZ} m), take ${o.id} from the shelf, deliver it to the ${toSurface.name}, push the door shut.`,
    `Every pull waypoint is checked against the live tip budget; the door is a moving obstacle for the base, the arm and the drone.`,
    `${steps.length} steps; the drone verifies the delivery at the end.`,
  ];
  return { task: 'fetch-from-appliance', title: `Fetch ${o.id} from the ${a.name} to the ${toSurface.name}`, steps, summary };
}
