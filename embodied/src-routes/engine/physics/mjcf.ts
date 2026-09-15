/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — MJCF (MuJoCo XML) generated from the parts model and the hidden scene: the room and every solid a sensor can strike as named boxes, the drone as one free body whose mass is the summed mass budget, whose inertia is estimated from where the parts sit (motors, props, arms, guards and feet at the arm radius; everything else as a disc of the plate's radius), whose four motors are thrust actuators with a yaw torque per newton, and whose sensor sites are the same mast, pad plate and under-drop the kinematic sim flies. A number lives in one place (ADR-152 D1): nothing here is typed that the parts model already knows.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | ADR-160 D7 slice S1: the scene's gravity is fed from a MEDIUM the caller chooses, not from a module constant. The drone plant's medium defaults to `vacuum` — which is what it has always run in without saying so — so what it emits is unchanged byte for byte; naming the medium changed nothing it emits, and the fixture proves that. `G_MPS2` is no longer a literal here: it is the Earth-surface gravity of the committed medium property rows, so the arm's bench sizing and the plant's scene cannot drift apart. The formatters are exported for the hull generator beside this one.
 */

import { buildDrone, type DroneDesign, type DroneFit } from '../design/parts-model';
import type { SensedSolid } from '../sense/raycast';
import { EARTH_SURFACE_GRAVITY_MPS2, mediumById, requireModelValidIn, type ForceModel, type Medium } from '../medium/medium';

/** Physics step (s). 500 Hz keeps a 750 g quad's attitude loop stable with the stock implicit integrator. */
export const MJCF_TIMESTEP_S = 0.002;
/** Reaction torque per newton of thrust (m). A placeholder until aero-lab's propeller curves replace it (BACKLOG B13). */
export const YAW_TORQUE_PER_THRUST_M = 0.012;
/** Half the hull's height: the body is a flat box the props and guards sit on; the pad plate under it is part of it. */
export const HULL_HALF_HEIGHT_M = 0.03;
/** Guard ring outside the prop tips (m), from the airframe's guard segment. */
export const GUARD_RING_M = 0.01;
/** Earth-surface gravity (m/s^2), from the committed medium property rows — one number, one place (ADR-160 D7). */
export const G_MPS2 = EARTH_SURFACE_GRAVITY_MPS2;

/**
 * The physics plant declared as a force model (ADR-160 D7): what it needs from a medium, and the media its author
 * declares it valid in. The envelope is declared here, by the plant's author, and never inferred by a caller.
 */
export const RIGID_BODY_PLANT: ForceModel = {
  id: 'rigid-body-plant',
  label: 'MuJoCo rigid-body plant (gravity, mass and contact)',
  requires: ['gravityMps2'],
  validIn: ['vacuum', 'air'],
  envelopeWhy:
    'This plant is entitled to gravity, mass and contact and to nothing else: its generator emits no <option> density and no viscosity, so no fluid model runs, and buoyancy, added mass, cavitation and a free surface are absent everywhere in this package. In vacuum and in air that is the whole truth and a body falls correctly. In a liquid it is not: the numbers would compute and they would be confidently wrong, which ADR-160 D7 calls worse than a refusal.',
};

export interface DroneInertia {
  massKg: number;
  ixx: number;
  iyy: number;
  izz: number;
  /** Mass carried at the arm radius per arm (motor, prop, arm, guard, foot), kg. */
  armMassKg: number;
}

/** @description Estimate the airframe's inertia from where the parts model puts its mass: four lumps at the arm radius on the diagonals, the rest a uniform disc of the plate's radius. An estimate to be replaced by a swing test at assembly; the mass itself is the parts model's budget.
 * @param d - The drone design. @returns Mass and principal inertias about the body origin. */
export function droneInertia(d: DroneDesign): DroneInertia {
  const perArm = ['arm', 'guard', 'foot'].reduce((a, id) => a + (d.parts.find((p) => p.id === id)?.massEachG ?? 0), 0)
    + (d.bought.find((b) => b.id === 'motor')?.massEachG ?? 0) + (d.bought.find((b) => b.id === 'props')?.massEachG ?? 0);
  const armMassKg = perArm / 1000;
  const massKg = d.massBudget.allUpG / 1000;
  const centreKg = Math.max(0, massKg - 4 * armMassKg);
  const L = d.layout.armMm / 1000;
  const r = d.layout.plateMm / 2000;
  // Rotors sit at (±L/√2, ±L/√2): each is L/√2 from either horizontal axis and L from the vertical one.
  const ixx = 2 * armMassKg * L * L + (centreKg * r * r) / 4;
  const izz = 4 * armMassKg * L * L + (centreKg * r * r) / 2;
  return { massKg, ixx, iyy: ixx, izz, armMassKg };
}

export interface DronePlantSpec {
  fit: DroneFit;
  massKg: number;
  inertia: DroneInertia;
  /** Arm length from the body origin to a rotor axis (m). */
  armM: number;
  /** Rotor positions in the body frame (m), X configuration, and their spin sign (+1 CCW, −1 CW). */
  rotors: { x: number; y: number; spin: 1 | -1 }[];
  maxThrustPerMotorN: number;
  hoverThrustPerMotorN: number;
  /** Half-width of the hull in x and y (m): prop tips plus the guard ring — what a strike is measured against. */
  hullHalfXyM: number;
  hullHalfZM: number;
  mastM: number;
  padPlateM: number;
  underDropM: number;
  yawTorquePerThrustM: number;
}

/** @description The numbers the physics plant is built from, all read from the parts model and the sensor set. */
export function dronePlant(fit: DroneFit): DronePlantSpec {
  const d = buildDrone(fit);
  const inertia = droneInertia(d);
  const L = d.layout.armMm / 1000;
  const h = L / Math.SQRT2;
  const propR = d.layout.propDiameterMm / 2000;
  return {
    fit, massKg: inertia.massKg, inertia, armM: L,
    rotors: [{ x: h, y: h, spin: 1 }, { x: -h, y: h, spin: -1 }, { x: -h, y: -h, spin: 1 }, { x: h, y: -h, spin: -1 }],
    maxThrustPerMotorN: (d.sizing.thrustPerMotorTw2G / 1000) * G_MPS2,
    hoverThrustPerMotorN: (d.sizing.thrustPerMotorHoverG / 1000) * G_MPS2,
    hullHalfXyM: h + propR + GUARD_RING_M,
    hullHalfZM: HULL_HALF_HEIGHT_M,
    mastM: d.sensorSet.mastM, padPlateM: d.sensorSet.padPlateM, underDropM: d.sensorSet.underDropM,
    yawTorquePerThrustM: YAW_TORQUE_PER_THRUST_M,
  };
}

/** @description One MJCF number: six decimals, trailing zeros trimmed, a hard zero for anything below 1e-12. @param v - the value. @returns The attribute text. */
export const mjcfNumber = (v: number): string => (Math.abs(v) < 1e-12 ? '0' : Number(v.toFixed(6)).toString());
/** @description One MJCF 3-vector. @param a - three numbers. @returns The attribute text. */
export const mjcfVec3 = (a: readonly number[]): string => a.map(mjcfNumber).join(' ');
const f = mjcfNumber;
const v3 = mjcfVec3;

/** @description One static box geom per solid, named after it, so a ray's return names what it struck exactly as the kinematic raycaster does. */
export function sceneGeoms(solids: readonly SensedSolid[]): string {
  const seen = new Map<string, number>();
  return solids.map((s) => {
    // A door is several slices with one name; MuJoCo names must be unique, so repeats get ".N" (the worker strips it).
    const n = seen.get(s.name) ?? 0; seen.set(s.name, n + 1);
    const name = n ? `${s.name}.${n}` : s.name;
    const centre = [0, 1, 2].map((a) => (s.min[a] + s.max[a]) / 2);
    const half = [0, 1, 2].map((a) => Math.max(1e-4, (s.max[a] - s.min[a]) / 2));
    return `    <geom name="${name}" class="scene" type="box" pos="${v3(centre)}" size="${v3(half)}"/>`;
  }).join('\n');
}

/**
 * @description The whole world as MJCF: the solids, and the drone as a free body resting on its pad plate at `home`.
 * The body origin is the kinematic sim's body reference: `padPlateM` above the floor when landed (the body is placed at
 * rest, not dropped), sensors at the same offsets the sim casts from. Motors are `motor` actuators on rotor sites with gear (0 0 1 0 0 ±k): thrust along the
 * body z and a reaction torque of k newton-metres per newton, alternating with the spin.
 * The scene's gravity is the MEDIUM'S, not a module constant (ADR-160 D7). The default is `vacuum` — gravity, mass and contact
 * and no fluid at all, which is exactly what this plant has always run in — so the emitted bytes are unchanged by naming it.
 * No `density` and no `viscosity` are ever emitted, so MuJoCo's own fluid model does not run and this scene makes no fluid claim.
 * @param fit - Which drone. @param solids - Everything a sensor can strike (the sim's `sensingSolids()`). @param home - Where the drone sits.
 * @param medium - The medium the scene runs in; `vacuum` by default.
 * @throws MediumRefused `model_not_valid_in_medium: rigid-body-plant, <medium>` for a medium this plant's author has not declared it valid in.
 */
export function droneMjcf(fit: DroneFit, solids: readonly SensedSolid[], home: readonly number[], medium?: Medium): string {
  const m = medium ?? (mediumById('vacuum') as Medium);
  requireModelValidIn(RIGID_BODY_PLANT, m);
  const p = dronePlant(fit);
  const hullZ = p.hullHalfZM - p.padPlateM; // the hull's bottom is the pad plate's bottom: the body origin sits padPlateM above the floor
  const rotors = p.rotors.map((r, i) => `      <site name="rotor-${i}" pos="${f(r.x)} ${f(r.y)} 0" size="0.01"/>`).join('\n');
  const motors = p.rotors.map((r, i) => `    <motor name="motor-${i}" site="rotor-${i}" gear="0 0 1 0 0 ${f(r.spin * p.yawTorquePerThrustM)}" ctrllimited="true" ctrlrange="0 ${f(p.maxThrustPerMotorN)}"/>`).join('\n');
  return `<mujoco model="embodied-${fit}">
  <compiler angle="radian" autolimits="true"/>
  <option timestep="${MJCF_TIMESTEP_S}" gravity="${v3(m.gravityMps2)}" integrator="implicitfast"/>
  <default>
    <default class="scene"><geom contype="1" conaffinity="1" friction="0.8 0.005 0.0001" rgba="0.6 0.6 0.65 1"/></default>
    <default class="drone"><geom contype="1" conaffinity="1" friction="0.6 0.005 0.0001" rgba="0.55 0.35 0.9 1"/></default>
  </default>
  <worldbody>
${sceneGeoms(solids)}
    <body name="drone" pos="${v3([home[0], home[1], home[2] + p.padPlateM])}" quat="1 0 0 0">
      <freejoint name="drone-free"/>
      <inertial pos="0 0 0" mass="${f(p.massKg)}" diaginertia="${f(p.inertia.ixx)} ${f(p.inertia.iyy)} ${f(p.inertia.izz)}"/>
      <geom name="drone-hull" class="drone" type="box" pos="0 0 ${f(hullZ)}" size="${f(p.hullHalfXyM)} ${f(p.hullHalfXyM)} ${f(p.hullHalfZM)}"/>
${rotors}
      <site name="ring" pos="0 0 ${f(p.mastM)}" size="0.005"/>
      <site name="zenith" pos="0 0 ${f(p.mastM)}" size="0.005"/>
      <site name="nadir" pos="0 0 ${f(-p.underDropM)}" size="0.005"/>
      <site name="depth-camera" pos="0 0 ${f(-p.underDropM)}" size="0.005"/>
    </body>
  </worldbody>
  <actuator>
${motors}
  </actuator>
  <sensor>
    <framepos name="drone-pos" objtype="body" objname="drone"/>
    <framequat name="drone-quat" objtype="body" objname="drone"/>
    <framelinvel name="drone-vel" objtype="body" objname="drone"/>
    <frameangvel name="drone-angvel" objtype="body" objname="drone"/>
  </sensor>
</mujoco>
`;
}
