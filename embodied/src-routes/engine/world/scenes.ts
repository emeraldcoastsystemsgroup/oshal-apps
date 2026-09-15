/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — named hidden scenes (BACKLOG B4): a registry of scenarios a world can start from, each plain data in the Scene shape (the kitchen, and a studio with a desk, a two-shelf unit and a bench), a validator that refuses a scene whose furniture leaves the room or whose objects do not rest on their surface, and the listing the tile offers. The discovery code never changes per scene: it reads the map, not the scene.
 */

import { kitchenScene, OBJECT_CLASSES, objectOn, pointInObstacle, type Scene, type Surface, type WorldObject } from './scene';

/** @description One scenario as the tile lists it. */
export interface ScenarioInfo { id: string; name: string; room: Scene['room']; surfaces: number; objects: number; appliances: number }

/**
 * @description A studio: 4.5 × 3.5 m, a desk along the east wall, a two-shelf unit on the north wall, a 1.0 × 0.9 m bench in the
 * middle at counter height; a mug and a bowl on the desk, a carton on the low shelf, a plate on the bench; no door.
 * The base parks in the south-west facing north; the drone pad is the south-west corner.
 * @returns A fresh scene (mutable by the simulation).
 */
export function studioScene(): Scene {
  const desk: Surface = { id: 'desk-top', name: 'Desk top', z: 0.75, area: { minX: 3.75, maxX: 4.35, minY: 0.65, maxY: 2.35 }, kind: 'counter' };
  const shelfLow: Surface = { id: 'shelf-low', name: 'Low shelf', z: 0.80, area: { minX: 0.45, maxX: 1.55, minY: 3.15, maxY: 3.40 }, kind: 'shelf' };
  const shelfHigh: Surface = { id: 'shelf-high', name: 'High shelf', z: 1.30, area: { minX: 0.45, maxX: 1.55, minY: 3.15, maxY: 3.40 }, kind: 'shelf' };
  const bench: Surface = { id: 'bench-top', name: 'Bench top', z: 0.90, area: { minX: 1.85, maxX: 2.75, minY: 1.25, maxY: 2.05 }, kind: 'counter' };
  return {
    name: 'studio',
    room: { minX: 0, maxX: 4.5, minY: 0, maxY: 3.5, ceiling: 2.3 },
    obstacles: [
      { name: 'desk', kind: 'counter', min: [3.7, 0.6, 0], max: [4.4, 2.4, 0.75] },
      { name: 'shelf-post-left', kind: 'fixture', min: [0.4, 3.1, 0], max: [0.45, 3.45, 1.6] },
      { name: 'shelf-post-right', kind: 'fixture', min: [1.55, 3.1, 0], max: [1.6, 3.45, 1.6] },
      { name: 'shelf-back', kind: 'fixture', min: [0.4, 3.45, 0], max: [1.6, 3.5, 1.6] },
      { name: 'shelf-low-slab', kind: 'fixture', min: [0.4, 3.1, 0.78], max: [1.6, 3.45, 0.8] },
      { name: 'shelf-high-slab', kind: 'fixture', min: [0.4, 3.1, 1.28], max: [1.6, 3.45, 1.3] },
      { name: 'bench', kind: 'island', min: [1.8, 1.2, 0], max: [2.8, 2.1, 0.9] },
    ],
    surfaces: [desk, shelfLow, shelfHigh, bench],
    objects: [
      objectOn('mug-1', 'mug', desk, 4.05, 1.0),
      objectOn('bowl-1', 'bowl', desk, 4.05, 1.9),
      objectOn('milk-1', 'carton', shelfLow, 1.0, 3.28),
      objectOn('plate-1', 'plate', bench, 2.05, 1.45),
    ],
    zones: [
      { id: 'desk', name: 'Desk', surfaceId: 'desk-top', standoff: { x: 3.15, y: 1.5, yaw: 0 }, droneVantage: [3.1, 1.5, 1.9], dronePitch: -1.05, droneYaw: 0 },
      { id: 'shelf', name: 'Shelf unit', surfaceId: 'shelf-low', standoff: { x: 1.0, y: 2.6, yaw: Math.PI / 2 }, droneVantage: [1.0, 2.5, 1.9], dronePitch: -1.0, droneYaw: Math.PI / 2 },
      { id: 'bench', name: 'Bench', surfaceId: 'bench-top', standoff: { x: 2.35, y: 0.7, yaw: Math.PI / 2 }, droneVantage: [2.35, 0.65, 1.9], dronePitch: -1.0, droneYaw: Math.PI / 2 },
    ],
    appliances: [],
    basePark: { x: 1.4, y: 0.8, yaw: Math.PI / 2 },
    droneHome: [0.5, 0.5, 0],
  };
}

/** @description Every scenario a world can start from, by id (the scene's own name). */
export const SCENARIOS: Readonly<Record<string, { name: string; build: () => Scene }>> = {
  kitchen: { name: 'Kitchen', build: kitchenScene },
  studio: { name: 'Studio', build: studioScene },
};

export const DEFAULT_SCENARIO = 'kitchen';

/** @description A fresh scene for a scenario id; the default when none is given; throws on an unknown id. */
export function scenarioById(id?: string): Scene {
  const key = id ?? DEFAULT_SCENARIO;
  const entry = SCENARIOS[key];
  if (!entry) throw new Error(`unknown scenario "${key}" — one of ${Object.keys(SCENARIOS).join(', ')}`);
  const scene = entry.build();
  if (scene.name !== key) throw new Error(`scenario ${key} builds a scene named ${scene.name}`);
  return scene;
}

/** @description The scenarios as the tile lists them. */
export function listScenarios(): ScenarioInfo[] {
  return Object.entries(SCENARIOS).map(([id, e]) => {
    const s = e.build();
    return { id, name: e.name, room: s.room, surfaces: s.surfaces.length, objects: s.objects.length, appliances: s.appliances.length };
  });
}

const inside = (p: readonly number[], room: Scene['room']): boolean => p[0] >= room.minX && p[0] <= room.maxX && p[1] >= room.minY && p[1] <= room.maxY;

/**
 * @description The rules a hidden scene must keep so the simulation, the planners and the discovery stay honest: unique
 * names; furniture, surfaces, standoffs, vantages, the pad and the park inside the room; a surface's area over some solid
 * (or declared floor); every object resting on its surface inside its area; zones naming surfaces that exist; the pad and
 * the park clear of furniture; vantages under the ceiling.
 * @param scene - The scene. @returns Every issue found; empty when the scene is sound.
 */
export function validateScene(scene: Scene): string[] {
  const issues: string[] = [];
  const room = scene.room;
  const seen = new Set<string>();
  for (const o of scene.obstacles) {
    if (seen.has(o.name)) issues.push(`duplicate obstacle name ${o.name}`);
    seen.add(o.name);
    if (!inside(o.min, room) || !inside(o.max, room) || o.max[2] > room.ceiling) issues.push(`obstacle ${o.name} leaves the room`);
    if (o.min[0] >= o.max[0] || o.min[1] >= o.max[1] || o.min[2] >= o.max[2]) issues.push(`obstacle ${o.name} has no volume`);
  }
  const surfaces = new Map<string, Surface>();
  for (const s of scene.surfaces) {
    if (surfaces.has(s.id)) issues.push(`duplicate surface id ${s.id}`);
    surfaces.set(s.id, s);
    const a = s.area;
    if (!inside([a.minX, a.minY], room) || !inside([a.maxX, a.maxY], room) || a.minX >= a.maxX || a.minY >= a.maxY) issues.push(`surface ${s.id} leaves the room or has no area`);
    if (s.kind !== 'floor') {
      const under = scene.obstacles.find((o) => o.min[0] <= a.minX && o.max[0] >= a.maxX && o.min[1] <= a.minY && o.max[1] >= a.maxY && Math.abs(o.max[2] - s.z) < 0.03);
      if (!under) issues.push(`surface ${s.id} at ${s.z} m has no solid top under its whole area`);
    }
    if (s.enclosedBy && !scene.appliances.some((ap) => ap.id === s.enclosedBy)) issues.push(`surface ${s.id} is enclosed by an unknown appliance ${s.enclosedBy}`);
  }
  const ids = new Set<string>();
  for (const o of scene.objects) {
    if (ids.has(o.id)) issues.push(`duplicate object id ${o.id}`);
    ids.add(o.id);
    if (!(o.cls in OBJECT_CLASSES)) { issues.push(`object ${o.id} has an unknown class ${String(o.cls)}`); continue; }
    if (o.location.kind !== 'surface') { issues.push(`object ${o.id} does not start on a surface`); continue; }
    const s = surfaces.get(o.location.surfaceId);
    if (!s) { issues.push(`object ${o.id} rests on an unknown surface ${o.location.surfaceId}`); continue; }
    const expected = objectOn(o.id, o.cls, s, o.pose.x, o.pose.y, o.pose.yaw) as WorldObject;
    if (Math.abs(expected.pose.z - o.pose.z) > 1e-6) issues.push(`object ${o.id} floats: z ${o.pose.z} on ${s.id} at ${s.z}`);
    // A resting object needs its centre over the support; a rim may overhang (a plate on a basin's lip does).
    if (o.pose.x < s.area.minX || o.pose.x > s.area.maxX || o.pose.y < s.area.minY || o.pose.y > s.area.maxY) issues.push(`object ${o.id} is not over ${s.id}`);
  }
  for (const z of scene.zones) {
    if (!surfaces.has(z.surfaceId)) issues.push(`zone ${z.id} names an unknown surface ${z.surfaceId}`);
    if (!inside([z.standoff.x, z.standoff.y], room)) issues.push(`zone ${z.id} standoff leaves the room`);
    if (pointInObstacle(scene, [z.standoff.x, z.standoff.y, 0.1], 0.25)) issues.push(`zone ${z.id} standoff is inside furniture`);
    if (!inside(z.droneVantage, room) || z.droneVantage[2] >= room.ceiling) issues.push(`zone ${z.id} vantage leaves the room`);
  }
  for (const ap of scene.appliances) if (ap.door && !inside([ap.door.hinge.x, ap.door.hinge.y], room)) issues.push(`appliance ${ap.id} door hinge leaves the room`);
  if (!inside(scene.droneHome, room) || pointInObstacle(scene, [scene.droneHome[0], scene.droneHome[1], 0.05], 0.25)) issues.push('the drone pad is outside the room or inside furniture');
  if (!inside([scene.basePark.x, scene.basePark.y], room) || pointInObstacle(scene, [scene.basePark.x, scene.basePark.y, 0.1], 0.35)) issues.push('the base park is outside the room or inside furniture');
  return issues;
}
