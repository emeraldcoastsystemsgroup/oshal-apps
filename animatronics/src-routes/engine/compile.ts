/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the motion compiler: a validated scenario
 *                     |                             | becomes per-axis eased SEGMENTS (expanding runs and repeats,
 *                     |                             | letting `together` children overlap — the same axis in two
 *                     |                             | concurrent children is refused), then a 50 Hz stream of
 *                     |                             | mechanism angles per channel and the pulse each needs through
 *                     |                             | the channel's calibration. Every angle is checked against the
 *                     |                             | software limits again as it is sampled, so no frame can carry
 *                     |                             | a pulse the rig refused. Deterministic: same rig + scenario +
 *                     |                             | start pose → identical frames.
 */

import { ContractError, FRAME_MS, LIMITS, axisMap, pulseFor, type RigSpec, type ServoChannel } from './rig-contract';
import { ease, type Ease, type Library, type Pose, type Step } from './scenario';

/** @description One eased move of one axis. */
export interface Segment { axis: string; t0: number; t1: number; from: number; to: number; ease: Ease }

/** @description The compiled stream. */
export interface Compiled {
  frameMs: number;
  durationMs: number;
  channelIds: string[];
  outputs: number[];
  /** Mechanism degrees per frame, per channel (index = channelIds order). */
  angles: number[][];
  /** Pulse microseconds per frame, per channel. */
  pulses: number[][];
  /** Axis key → channel index, for readers that think in axes. */
  axisIndex: Record<string, number>;
  /** The final pose (axis key → degrees). */
  end: Pose;
  /** Peak commanded speed per channel (deg/s) — what the servo is asked to do. */
  demandDegPerS: number[];
}

interface Ctx { rig: RigSpec; lib: Library; axes: Map<string, ServoChannel>; segments: Segment[] }

function targetsOf(step: Extract<Step, { kind: 'move' }>, lib: Library): Pose {
  return { ...(step.pose ? lib.poses[step.pose] : {}), ...(step.axes ?? {}) };
}

/** Expand steps from time t with the running pose `cur`; returns the end time. Mutates cur. */
function expand(steps: Step[], t: number, cur: Pose, ctx: Ctx, field: string, touched?: Set<string>): number {
  let now = t;
  steps.forEach((step, i) => {
    const here = `${field}[${i}]`;
    if (step.kind === 'move') {
      for (const [axis, to] of Object.entries(targetsOf(step, ctx.lib))) {
        const ch = ctx.axes.get(axis);
        if (!ch) throw new ContractError(`${here} moves unknown axis ${axis}`, here);
        if (to < ch.minDeg || to > ch.maxDeg) throw new ContractError(`${here}.${axis} = ${to}° is outside ${ch.id}'s limits`, here);
        touched?.add(axis);
        ctx.segments.push({ axis, t0: now, t1: now + step.ms, from: cur[axis], to, ease: step.ms === 0 ? 'snap' : step.ease });
        cur[axis] = to;
      }
      now += step.ms;
    } else if (step.kind === 'hold') {
      now += step.ms;
    } else if (step.kind === 'run') {
      now = expand(ctx.lib.scenarios[step.scenario].steps, now, cur, ctx, `${here}(${step.scenario})`, touched);
    } else if (step.kind === 'repeat') {
      for (let n = 0; n < step.times; n += 1) now = expand(step.steps, now, cur, ctx, `${here}.steps`, touched);
    } else {
      now = together(step.steps, now, cur, ctx, here, touched);
    }
    if (now > LIMITS.durationMs) throw new ContractError(`${here} takes the scenario past ${LIMITS.durationMs} ms`, here);
  });
  return now;
}

/** Children start together; the same axis in two of them is a conflict. */
function together(children: Step[], t: number, cur: Pose, ctx: Ctx, field: string, outer?: Set<string>): number {
  let end = t;
  const seen = new Map<string, number>();
  const merged: Pose = { ...cur };
  children.forEach((child, i) => {
    const local: Pose = { ...cur };
    const mine = new Set<string>();
    const childEnd = expand([child], t, local, ctx, `${field}.steps`, mine);
    for (const axis of mine) {
      if (seen.has(axis)) throw new ContractError(`${field}.steps[${i}] and steps[${seen.get(axis)}] both move ${axis} at the same time`, `${field}.steps[${i}]`);
      seen.set(axis, i);
      merged[axis] = local[axis];
      outer?.add(axis);
    }
    end = Math.max(end, childEnd);
  });
  Object.assign(cur, merged);
  return end;
}

/** The neutral pose of a rig: every axis at its channel's rest angle. */
export function neutralPose(rig: RigSpec): Pose {
  const out: Pose = {};
  for (const [axis, ch] of axisMap(rig)) out[axis] = ch.neutralDeg;
  return out;
}

function sample(segs: Segment[], t: number, start: number): number {
  let value = start;
  for (const s of segs) {
    if (s.t0 > t) break;
    value = t >= s.t1 ? s.to : s.from + (s.to - s.from) * ease(s.ease, (t - s.t0) / (s.t1 - s.t0));
  }
  return value;
}

/**
 * @description Compile steps into frames.
 * @param rig - The validated rig.
 * @param lib - Poses and scenarios the steps may reference.
 * @param steps - Validated steps (a scenario's, or a single generated move).
 * @param start - The pose the rig is in when the stream begins (defaults to neutral; missing axes are neutral).
 * @returns The compiled stream.
 */
export function compileSteps(rig: RigSpec, lib: Library, steps: Step[], start: Pose = {}): Compiled {
  const axes = axisMap(rig);
  const cur: Pose = { ...neutralPose(rig) };
  for (const [axis, deg] of Object.entries(start)) {
    const ch = axes.get(axis);
    if (!ch) throw new ContractError(`start.${axis} is not an axis of this rig`, `start.${axis}`);
    if (!Number.isFinite(deg) || deg < ch.minDeg || deg > ch.maxDeg) throw new ContractError(`start.${axis} is outside ${ch.id}'s limits`, `start.${axis}`);
    cur[axis] = deg;
  }
  const initial: Pose = { ...cur };
  const ctx: Ctx = { rig, lib, axes, segments: [] };
  const durationMs = expand(steps, 0, cur, ctx, 'steps');
  const frameCount = Math.floor(durationMs / FRAME_MS) + 1;
  if (frameCount > LIMITS.frames) throw new ContractError(`the stream would be ${frameCount} frames; the cap is ${LIMITS.frames}`, 'steps');

  const channelIds = rig.channels.map((c) => c.id);
  const axisIndex: Record<string, number> = {};
  const byChannel = new Map<string, { axis: string; segs: Segment[] }>();
  for (const [axis, ch] of axes) { axisIndex[axis] = channelIds.indexOf(ch.id); byChannel.set(ch.id, { axis, segs: [] }); }
  for (const s of ctx.segments) byChannel.get(axes.get(s.axis)!.id)!.segs.push(s);
  for (const entry of byChannel.values()) entry.segs.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);

  const angles: number[][] = []; const pulses: number[][] = [];
  const demand = new Array<number>(channelIds.length).fill(0);
  let previous: number[] | null = null;
  for (let f = 0; f < frameCount; f += 1) {
    const t = f * FRAME_MS;
    const row = rig.channels.map((ch) => { const e = byChannel.get(ch.id); return e ? sample(e.segs, t, initial[e.axis]) : ch.neutralDeg; });
    if (previous) row.forEach((deg, i) => { demand[i] = Math.max(demand[i], Math.abs(deg - (previous as number[])[i]) * (1000 / FRAME_MS)); });
    angles.push(row.map((d) => Math.round(d * 100) / 100));
    pulses.push(row.map((deg, i) => pulseFor(rig.channels[i], deg)));
    previous = row;
  }
  return { frameMs: FRAME_MS, durationMs, channelIds, outputs: rig.channels.map((c) => c.channel), angles, pulses, axisIndex, end: cur, demandDegPerS: demand.map((d) => Math.round(d)) };
}
