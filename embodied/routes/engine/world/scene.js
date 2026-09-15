"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the world model: a room, solid obstacles,
 *                     |                             | placeable surfaces (a sink basin, a dish rack, an island top, a
 *                     |                             | fridge shelf that is ENCLOSED while the door is shut), objects
 *                     |                             | of a known class with a pose, mass and location, and zones that
 *                     |                             | pair a surface with where the base parks and where the drone
 *                     |                             | looks from. The default kitchen is the first scenario; a scene
 *                     |                             | is plain data so others can be added without touching code.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The scene is hidden ground truth for rays and physics: `sceneSolids` feeds the sensors; carton class; fridge shell with a west hinge; mug and dishes spread so no two touch; zone standoffs at x 4.6 off a cell boundary.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.restingZ = exports.DOOR_SLICE_M = exports.doorDirection = exports.OBJECT_CLASSES = void 0;
exports.doorNormal = doorNormal;
exports.doorSlices = doorSlices;
exports.handleGrasp = handleGrasp;
exports.doorAngleFromPoint = doorAngleFromPoint;
exports.objectOn = objectOn;
exports.kitchenScene = kitchenScene;
exports.surfaceById = surfaceById;
exports.zoneById = zoneById;
exports.objectById = objectById;
exports.isEnclosed = isEnclosed;
exports.objectsOn = objectsOn;
exports.pointOnSurface = pointOnSurface;
exports.sceneSolids = sceneSolids;
exports.pointInObstacle = pointInObstacle;
exports.applianceById = applianceById;
/** @description Object classes the detector and the grasp planner know. Sizes are l × w × h (m). */
exports.OBJECT_CLASSES = {
    plate: { size: { l: 0.26, w: 0.26, h: 0.02 }, mass: 0.6 },
    bowl: { size: { l: 0.16, w: 0.16, h: 0.07 }, mass: 0.5 },
    mug: { size: { l: 0.09, w: 0.09, h: 0.10 }, mass: 0.35 },
    carton: { size: { l: 0.07, w: 0.07, h: 0.20 }, mass: 1.0 },
};
/** @description Unit vector from the hinge toward the free end at a swing angle. */
const doorDirection = (door, angle) => [Math.cos(door.closedHeading + door.swing * angle), Math.sin(door.closedHeading + door.swing * angle)];
exports.doorDirection = doorDirection;
/** @description Outward unit normal of the door face (the handle side — the side the door opens toward) at a swing angle. */
function doorNormal(door, angle) {
    const d = (0, exports.doorDirection)(door, angle);
    return door.swing > 0 ? [-d[1], d[0]] : [d[1], -d[0]];
}
/** @description Slice length along the door (m): the bounding-box over-cover of a swung panel stays within ~2 cm. */
exports.DOOR_SLICE_M = 0.05;
/**
 * @description The door panel as axis-aligned slices for collision, fence and navigation — one
 * box per {@link DOOR_SLICE_M} along its width, each the bounding box of a rotated slice,
 * recomputed per angle.
 * @param door - The door.
 * @param angle - Current swing (rad).
 * @param name - Obstacle name for refusals.
 * @returns The slices.
 */
function doorSlices(door, angle, name) {
    const d = (0, exports.doorDirection)(door, angle);
    const n = doorNormal(door, angle);
    const k = Math.max(1, Math.ceil(door.width / exports.DOOR_SLICE_M));
    const out = [];
    for (let i = 0; i < k; i += 1) {
        const a = (door.width * i) / k;
        const b = (door.width * (i + 1)) / k;
        const corners = [[a, 0], [b, 0], [a, door.thickness], [b, door.thickness]].map(([along, across]) => [door.hinge.x + along * d[0] + across * n[0], door.hinge.y + along * d[1] + across * n[1]]);
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        out.push({ name, kind: 'appliance', min: [Math.min(...xs), Math.min(...ys), 0], max: [Math.max(...xs), Math.max(...ys), door.height] });
    }
    return out;
}
/**
 * @description Where a gripper takes the handle: on the outward face, 2 cm off the panel, and the
 * heading the tool must point (into the door) to hold it square.
 * @param door - The door.
 * @param angle - Current swing.
 * @returns The grasp point and the tool yaw (with roll −π/2 the tool z points into the door).
 */
function handleGrasp(door, angle) {
    const d = (0, exports.doorDirection)(door, angle);
    const n = doorNormal(door, angle);
    const off = door.thickness + 0.02;
    const point = [door.hinge.x + door.handleOffset * d[0] + off * n[0], door.hinge.y + door.handleOffset * d[1] + off * n[1], door.handleZ];
    // Tool z = Rz(yaw)·Rx(−π/2)·ẑ = (−sin yaw, cos yaw) must equal −n.
    return { point, yaw: Math.atan2(n[0], -n[1]) };
}
/**
 * @description The swing angle implied by the gripper's position on the handle arc (clamped to
 * the door's travel). The handle stands off the panel, so its bearing from the hinge leads the
 * door's own heading by atan(offset / handleOffset); that lead is removed here — otherwise the
 * door would "jump" the moment the handle is taken.
 */
function doorAngleFromPoint(door, x, y) {
    const lead = Math.atan2(door.thickness + 0.02, door.handleOffset);
    let polar = Math.atan2(y - door.hinge.y, x - door.hinge.x) - door.closedHeading;
    while (polar <= -Math.PI)
        polar += 2 * Math.PI;
    while (polar > Math.PI)
        polar -= 2 * Math.PI;
    const a = door.swing * polar - lead;
    return Math.min(door.maxOpen, Math.max(0, a));
}
/** @description An object's centroid height when resting on a surface. */
const restingZ = (cls, surfaceZ) => surfaceZ + exports.OBJECT_CLASSES[cls].size.h / 2;
exports.restingZ = restingZ;
/** @description Build an object resting on a surface at a planar position. */
function objectOn(id, cls, surface, x, y, yaw = 0) {
    return { id, cls, pose: { x, y, z: (0, exports.restingZ)(cls, surface.z), yaw }, location: { kind: 'surface', surfaceId: surface.id } };
}
/**
 * @description The default kitchen: 5 × 4 m, a counter run along the north wall with a sink
 * basin recessed into it and a dish rack to its right, a fridge in the north-east corner, an
 * island in the middle, three dishes in the sink. The base parks south of the island; the drone
 * sits on a pad in the south-west corner.
 * @returns A fresh scene (mutable by the simulation).
 */
function kitchenScene() {
    const sink = { id: 'sink', name: 'Sink basin', z: 0.72, area: { minX: 0.97, maxX: 1.58, minY: 3.45, maxY: 3.95 }, kind: 'sink' };
    const rack = { id: 'rack', name: 'Dish rack', z: 0.90, area: { minX: 2.42, maxX: 2.88, minY: 3.48, maxY: 3.72 }, kind: 'rack' };
    const island = { id: 'island-top', name: 'Island top', z: 0.90, area: { minX: 1.85, maxX: 2.95, minY: 1.65, maxY: 2.35 }, kind: 'counter' };
    const fridgeShelf = { id: 'fridge-shelf', name: 'Fridge middle shelf', z: 1.20, area: { minX: 3.75, maxX: 4.45, minY: 3.30, maxY: 3.90 }, kind: 'shelf', enclosedBy: 'fridge' };
    // Hinged on its WEST edge with the handle east, so a machine parked east of the handle pulls the
    // door open toward itself and the panel swings away to the west — the human habit of standing
    // beside the swing, never in it. Clockwise swing: the free end turns from east toward south.
    const fridgeDoor = { hinge: { x: 3.7, y: 3.2 }, width: 0.75, thickness: 0.05, height: 1.8, closedHeading: 0, swing: -1, maxOpen: 0.87, openThreshold: 0.7, handleOffset: 0.7, handleZ: 1.1, sealForceN: 60, swingForceN: 20 };
    return {
        name: 'kitchen',
        room: { minX: 0, maxX: 5, minY: 0, maxY: 4, ceiling: 2.3 },
        obstacles: [
            { name: 'counter-left', kind: 'counter', min: [0.4, 3.4, 0], max: [0.95, 4.0, 0.9] },
            { name: 'sink-basin', kind: 'fixture', min: [0.95, 3.4, 0], max: [1.6, 4.0, 0.72] },
            { name: 'counter-right', kind: 'counter', min: [1.6, 3.4, 0], max: [3.6, 4.0, 0.9] },
            // The fridge is a shell, not a solid: the arm reaches INTO it once the door is open.
            { name: 'fridge-base', kind: 'appliance', min: [3.7, 3.2, 0], max: [4.5, 4.0, 0.4] },
            { name: 'fridge-left-wall', kind: 'appliance', min: [3.7, 3.2, 0], max: [3.75, 4.0, 1.8] },
            { name: 'fridge-right-wall', kind: 'appliance', min: [4.45, 3.2, 0], max: [4.5, 4.0, 1.8] },
            { name: 'fridge-back', kind: 'appliance', min: [3.7, 3.95, 0], max: [4.5, 4.0, 1.8] },
            { name: 'fridge-top', kind: 'appliance', min: [3.7, 3.2, 1.75], max: [4.5, 4.0, 1.8] },
            { name: 'fridge-shelf-slab', kind: 'appliance', min: [3.75, 3.3, 1.18], max: [4.45, 3.95, 1.2] },
            { name: 'island', kind: 'island', min: [1.8, 1.6, 0], max: [3.0, 2.4, 0.9] },
        ],
        surfaces: [sink, rack, island, fridgeShelf],
        objects: [
            // Spread so nothing touches: a sensor can only separate things that leave a gap between them.
            objectOn('plate-1', 'plate', sink, 1.10, 3.56),
            objectOn('plate-2', 'plate', sink, 1.43, 3.70),
            objectOn('mug-1', 'mug', sink, 1.10, 3.80),
            objectOn('milk-1', 'carton', fridgeShelf, 4.3, 3.45),
        ],
        zones: [
            { id: 'sink', name: 'Sink', surfaceId: 'sink', standoff: { x: 1.27, y: 2.95, yaw: Math.PI / 2 }, droneVantage: [1.27, 2.75, 1.9], dronePitch: -1.05, droneYaw: Math.PI / 2 },
            { id: 'rack', name: 'Dish rack', surfaceId: 'rack', standoff: { x: 2.65, y: 2.95, yaw: Math.PI / 2 }, droneVantage: [2.65, 2.75, 1.9], dronePitch: -1.05, droneYaw: Math.PI / 2 },
            { id: 'island', name: 'Island', surfaceId: 'island-top', standoff: { x: 2.4, y: 1.2, yaw: Math.PI / 2 }, droneVantage: [2.4, 1.0, 1.9], dronePitch: -1.0, droneYaw: Math.PI / 2 },
            { id: 'fridge-door', name: 'Fridge door', surfaceId: 'fridge-shelf', standoff: { x: 4.6, y: 2.45, yaw: Math.PI / 2 }, droneVantage: [3.5, 2.3, 1.9], dronePitch: -0.45, droneYaw: 0.98 },
            { id: 'fridge', name: 'Fridge shelf', surfaceId: 'fridge-shelf', standoff: { x: 4.6, y: 2.7, yaw: Math.PI / 2 }, droneVantage: [3.5, 2.3, 1.9], dronePitch: -0.45, droneYaw: 0.98 },
        ],
        appliances: [{ id: 'fridge', name: 'Refrigerator', open: false, door: fridgeDoor, angle: 0 }],
        basePark: { x: 0.9, y: 1.2, yaw: Math.PI / 2 },
        droneHome: [0.6, 0.6, 0],
    };
}
/** @description Look up a surface or throw. */
function surfaceById(scene, id) {
    const s = scene.surfaces.find((x) => x.id === id);
    if (!s)
        throw new RangeError(`unknown surface ${id}`);
    return s;
}
/** @description Look up a zone or throw. */
function zoneById(scene, id) {
    const z = scene.zones.find((x) => x.id === id);
    if (!z)
        throw new RangeError(`unknown zone ${id}`);
    return z;
}
/** @description Look up an object or throw. */
function objectById(scene, id) {
    const o = scene.objects.find((x) => x.id === id);
    if (!o)
        throw new RangeError(`unknown object ${id}`);
    return o;
}
/** @description True when an object's surface is inside a closed appliance. */
function isEnclosed(scene, o) {
    const loc = o.location;
    if (loc.kind !== 'surface')
        return false;
    const s = scene.surfaces.find((x) => x.id === loc.surfaceId);
    if (!s || !s.enclosedBy)
        return false;
    const appliance = scene.appliances.find((a) => a.id === s.enclosedBy);
    return appliance ? !appliance.open : true;
}
/** @description The objects resting on a surface. */
function objectsOn(scene, surfaceId) {
    return scene.objects.filter((o) => o.location.kind === 'surface' && o.location.surfaceId === surfaceId);
}
/** @description Is a planar point inside a surface's area? */
function pointOnSurface(s, x, y) {
    return x >= s.area.minX && x <= s.area.maxX && y >= s.area.minY && y <= s.area.maxY;
}
/** @description Every solid right now: the fixed obstacles plus each appliance door at its current swing. */
function sceneSolids(scene) {
    const doors = scene.appliances.flatMap((a) => (a.door ? doorSlices(a.door, a.angle, `${a.id}-door`) : []));
    return [...scene.obstacles, ...doors];
}
/** @description Is a world point inside any solid (optionally expanded by a margin)? */
function pointInObstacle(scene, p, margin = 0) {
    return sceneSolids(scene).find((b) => p[0] >= b.min[0] - margin && p[0] <= b.max[0] + margin
        && p[1] >= b.min[1] - margin && p[1] <= b.max[1] + margin
        && p[2] >= b.min[2] - margin && p[2] <= b.max[2] + margin) ?? null;
}
/** @description Look up an appliance or throw. */
function applianceById(scene, id) {
    const a = scene.appliances.find((x) => x.id === id);
    if (!a)
        throw new RangeError(`unknown appliance ${id}`);
    return a;
}
//# sourceMappingURL=scene.js.map