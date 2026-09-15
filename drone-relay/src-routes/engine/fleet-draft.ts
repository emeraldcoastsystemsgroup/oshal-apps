/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The formation as a Drone Ops fleet-mission DRAFT (backlog B6
 *                     |                             | first half, and B4's slots as latitude / longitude). A plan's
 *                     |                             | local frame (x east, y north, metres from the base) is placed
 *                     |                             | on the map from the base's latitude and longitude with the
 *                     |                             | same flat-earth metres-per-degree the drone package's map and
 *                     |                             | its separation check use, so a slot lands where Drone Ops
 *                     |                             | draws it. Every relay and tip gets one assignment: fly to its
 *                     |                             | slot at the plan's cruise speed, hold, return to launch. The
 *                     |                             | holds end together — the moment the farthest relay must fly
 *                     |                             | home on a hovering battery — because Drone Ops holds a
 *                     |                             | waypoint in the air: this is the predefined formation at full
 *                     |                             | strength for one sortie (ADR-155 D1), not the dynamic chain.
 *                     |                             | Pure: it builds JSON, it sends nothing, and nothing in this
 *                     |                             | package can execute it — Drone Ops re-validates and a human
 *                     |                             | approves every flight there (ADR-098 / ADR-099).
 */

import { type ChainPlan, type ChainSpec, type Slot } from './chain';
import { type Pt } from './path';
import { SpecError, numberIn } from './spec-error';

/** @description Metres per degree of latitude — the constant the drone package's map and separation check use. */
export const M_PER_DEG_LAT = 111_320;

/** @description The most drones one Drone Ops fleet mission carries (the drone package's MAX_FLEET_ASSIGNMENTS). */
export const FLEET_MISSION_MAX_DRONES = 8;

/** @description A drone id the drone package accepts in a fleet assignment. */
const FLEET_DRONE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/** @description Where the base stands on the map. */
export interface GeoHome {
  lat: number;
  lon: number;
}

/** @description One waypoint as the drone package reads it: degrees, and metres up. */
export interface GeoWaypoint {
  lat: number;
  lon: number;
  alt: number;
  holdSeconds?: number;
}

/** @description One drone's share of the formation, in the shape Drone Ops stores a fleet assignment. */
export interface FleetAssignmentDraft {
  droneId: string;
  plan: { name: string; waypoints: GeoWaypoint[]; speedMps: number; rtlAfterMission: boolean };
}

/** @description The fleet-mission draft: `{name, assignments}` — the shape the drone package's fleet gate normalises. */
export interface FleetMissionDraft {
  name: string;
  assignments: FleetAssignmentDraft[];
}

/** @description The draft and what it is. */
export interface FormationDraft {
  draft: FleetMissionDraft;
  /** Seconds every drone is on station together: the farthest relay's hovering station time. */
  formationHoldS: number;
  notes: string[];
}

/**
 * @description Read the base's position from untrusted input, refusing naming the field. Latitudes
 * are held to ±80°: the flat-earth metres-per-degree the map uses stops being honest near the poles.
 * @param input - Candidate `{lat, lon}`.
 * @returns The home.
 */
export function validateHome(input: unknown): GeoHome {
  if (!input || typeof input !== 'object') throw new SpecError('home', 'home must be the base position {lat, lon} in degrees');
  const h = input as Record<string, unknown>;
  if (h.lat === undefined || h.lat === null) throw new SpecError('home.lat', 'home.lat is required');
  if (h.lon === undefined || h.lon === null) throw new SpecError('home.lon', 'home.lon is required');
  return { lat: numberIn(h.lat, 'home.lat', -80, 80, 0), lon: numberIn(h.lon, 'home.lon', -180, 180, 0) };
}

/**
 * @description A point of the plan's local frame on the map.
 * @param home - The base's position.
 * @param pt - x east, y north, z up, metres from the base.
 * @returns Degrees to seven places (about a centimetre) and metres up.
 */
export function toGeo(home: GeoHome, pt: Pt): GeoWaypoint {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((home.lat * Math.PI) / 180);
  return { lat: round7(home.lat + pt.y / M_PER_DEG_LAT), lon: round7(home.lon + pt.x / mPerDegLon), alt: Math.round(pt.z * 10) / 10 };
}

/** The drones the formation flies, inner → outer: every slot's relay, then every tip. */
function formationMembers(plan: ChainPlan): Array<{ id: string; slot: Slot }> {
  const relays = plan.mobileSlots.map((slot, i) => ({ id: `r${i + 1}`, slot }));
  const tips = plan.tree ? plan.tree.branches.map((b) => ({ id: `tip${b.index}`, slot: b.tip })) : [{ id: 'tip', slot: plan.tip }];
  return [...relays, ...tips];
}

/** The caller's names for the formation's drones (the Drone Ops fleet ids), each checked; unnamed ones keep their roster id. */
function readDroneNames(input: unknown, members: string[]): Map<string, string> {
  const names = new Map(members.map((id) => [id, id]));
  if (input === undefined || input === null) return names;
  if (typeof input !== 'object' || Array.isArray(input)) throw new SpecError('drones', 'drones maps roster ids to Drone Ops fleet ids, e.g. {"r1": "alpha"}');
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!names.has(key)) throw new SpecError(`drones.${key}`, `${key} does not fly in this formation (${members.join(', ')})`);
    if (typeof value !== 'string' || !FLEET_DRONE_ID.test(value)) throw new SpecError(`drones.${key}`, 'a Drone Ops fleet id is 1 to 32 letters, digits, _ or -, starting with a letter or digit');
    names.set(key, value);
  }
  const used = [...names.values()];
  const twice = used.find((id, i) => used.indexOf(id) !== i);
  if (twice) throw new SpecError('drones', `${twice} is given to two drones of the formation`);
  return names;
}

/**
 * @description Draft the plan's formation as a Drone Ops fleet mission. Refused when the plan is not
 * feasible (field `plan`) or has more drones than one fleet mission carries (field `drones`).
 * @param spec - The spec.
 * @param plan - Its plan.
 * @param homeInput - The base's `{lat, lon}` (untrusted).
 * @param dronesInput - Optional `{rosterId: fleetId}` names (untrusted).
 * @returns The draft, the common hold, and what the draft is not.
 */
export function formationDraft(spec: ChainSpec, plan: ChainPlan, homeInput: unknown, dronesInput?: unknown): FormationDraft {
  if (!plan.feasible) throw new SpecError('plan', `the plan is not feasible: ${plan.reasons.join('; ')}`);
  const home = validateHome(homeInput);
  const members = formationMembers(plan);
  if (members.length > FLEET_MISSION_MAX_DRONES) throw new SpecError('drones', `the formation flies ${members.length} drones and one Drone Ops fleet mission carries at most ${FLEET_MISSION_MAX_DRONES}: split the corridor or hand it over in parts`);
  const names = readDroneNames(dronesInput, members.map((m) => m.id));
  const farthestS = plan.mobileSlots.reduce((m, slot) => Math.max(m, slot.s), 0);
  const formationHoldS = Math.max(0, Math.floor(spec.enduranceS - (2 * farthestS) / spec.cruiseMps - spec.reserveS));
  const leaveAtS = farthestS / spec.cruiseMps + formationHoldS;
  const assignments = members.map(({ id, slot }): FleetAssignmentDraft => {
    const holdSeconds = Math.max(0, Math.floor(leaveAtS - slot.s / spec.cruiseMps));
    const waypoint = { ...toGeo(home, slot.pt), ...(holdSeconds > 0 ? { holdSeconds } : {}) };
    return { droneId: names.get(id) as string, plan: { name: `${spec.title} · ${id} at ${Math.round(slot.s)} m`, waypoints: [waypoint], speedMps: spec.cruiseMps, rtlAfterMission: true } };
  });
  return { draft: { name: `${spec.title} — relay formation`.slice(0, 120), assignments }, formationHoldS, notes: draftNotes(spec, formationHoldS) };
}

function draftNotes(spec: ChainSpec, formationHoldS: number): string[] {
  const notes = [
    `Every drone flies to its slot at ${spec.cruiseMps} m/s and holds until the formation breaks up together, ${formationHoldS} s after the farthest relay arrives (its hovering battery with the ${spec.reserveS} s reserve), then returns to launch.`,
    'This is the formation at full strength for one sortie: the chain\'s own rules (elastic spacing, spares, swaps, the shift inward) are not part of a Drone Ops fleet mission.',
    'A draft only: Drone Ops re-validates it against its geofence and separation rules at execution, and a human approves every flight there. Nothing in Drone Relay can execute it.',
  ];
  if (spec.posture === 'perch') notes.push('Drone Ops holds a waypoint in the air, so the holds are sized on a hovering battery; the perched station time does not apply to this draft.');
  return notes;
}

function round7(v: number): number {
  return Math.round(v * 1e7) / 1e7;
}
