"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the step machine that runs a plan against a
 *                     |                             | world: issues one step at a time through the sim's guarded
 *                     |                             | primitives (so every command is re-validated live, at
 *                     |                             | execution time), watches for completion, checks each
 *                     |                             | observation's expectations, and reports every command to a
 *                     |                             | log sink with its outcome. Pause (a human took command) drops
 *                     |                             | the current step and re-issues it on resume; abort and e-stop
 *                     |                             | end the run. It never advances time itself.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Sensing steps (rover.scan / drone.scan / wrist.scan) and world.expect are immediate; drone.explore ticks a frontier exploration leg by leg; an abort lands the drone regardless of the map; grasp `*` and release `*` take whatever is under the tool.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A drone step whose drone has struck the hidden scene (`sim.droneDown`) fails the plan instead of waiting forever for a hover that will never come.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Registered flight: a drone.goto longer than MAX_UNREGISTERED_M is flown in sub-legs with a registration sweep between them, a climb is registered before the next step, and exploration registers when its legs have flown that far — dead reckoning never outruns the registration capture range.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | A drone.goto is first routed through the flight grid (`sim.flightLegs`), then each routed leg is split into registered sub-legs.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Exploration remembers every spot it scanned from and hands the list to the goal search.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | B14 recover from lost: a flight refused for a lost localisation gets one recovery per step — a `drone.recover` step spliced in before it: climb to cruise, sweep wide (30 cm capture); still lost, fly back along the registered trail sweeping wide at each point; trail spent, land — on the pad the fix anchors, anywhere else the drone declares itself grounded and the run fails. The refused step is re-issued from scratch afterwards.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanExecutor = exports.IMMEDIATE_KINDS = exports.stepNode = void 0;
exports.registeredLegs = registeredLegs;
const vec_1 = require("../math/vec");
const world_sim_1 = require("../sim/world-sim");
/** @description The node a step commands. */
const stepNode = (s) => (s.kind.startsWith('drone.') ? world_sim_1.DRONE_NODE_ID : world_sim_1.UNIT_NODE_ID);
exports.stepNode = stepNode;
/** @description Steps that finish the moment they are issued. */
/** @description Split a straight flight into legs no longer than MAX_UNREGISTERED_M. */
function registeredLegs(from, to) {
    const len = (0, vec_1.distance)(from, to);
    const n = Math.max(1, Math.ceil(len / world_sim_1.MAX_UNREGISTERED_M));
    const legs = [];
    for (let i = 1; i <= n; i += 1)
        legs.push([from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n, from[2] + ((to[2] - from[2]) * i) / n]);
    return legs;
}
exports.IMMEDIATE_KINDS = new Set(['drone.observe', 'arm.grasp', 'arm.release', 'arm.grasp-handle', 'arm.release-handle', 'rover.scan', 'drone.scan', 'wrist.scan', 'world.expect']);
/** @description Runs one plan. */
class PlanExecutor {
    sim;
    log;
    actor;
    state = 'idle';
    stepIndex = -1;
    legIndex = 0;
    failure = null;
    lastObservation = null;
    plan = null;
    stepActive = false;
    explore = null;
    /** The sub-legs of the active drone.goto: a flight longer than MAX_UNREGISTERED_M is flown in pieces with a registration sweep between them. */
    flight = null;
    /** The recovery in progress (B14): which phase, the trail still to fly, the wide sweeps taken. */
    recover = null;
    /** The index of the step a recovery was inserted for: one recovery per step. */
    recoveredFor = -1;
    constructor(sim, log, actor = 'plan') {
        this.sim = sim;
        this.log = log;
        this.actor = actor;
    }
    /** @description The plan being run. */
    get current() { return this.plan; }
    /** @description The step in progress, if any. */
    get currentStep() { return this.plan && this.stepIndex >= 0 ? this.plan.steps[this.stepIndex] ?? null : null; }
    /** @description Begin a plan from its first step. */
    start(plan) {
        if (this.state === 'running' || this.state === 'paused')
            throw new Error('a plan is already running');
        this.plan = plan;
        this.state = 'running';
        this.stepIndex = -1;
        this.legIndex = 0;
        this.failure = null;
        this.stepActive = false;
        this.recover = null;
        this.recoveredFor = -1;
    }
    /** @description A human took command: stop motion, keep the place, re-issue on resume. */
    pause() {
        if (this.state !== 'running')
            return;
        this.sim.abortUnit();
        this.state = 'paused';
        this.stepActive = false;
        this.legIndex = 0;
    }
    /** @description Resume after a pause; the current step is issued again from scratch. */
    resume() {
        if (this.state !== 'paused')
            return;
        this.state = 'running';
        if (this.stepIndex >= 0)
            this.stepIndex -= 1;
    }
    /** @description End the run; motion stops. */
    abort(reason = 'aborted by a human') {
        if (this.state !== 'running' && this.state !== 'paused')
            return;
        this.sim.abortUnit();
        if (this.sim.drone.mode !== 'landed')
            this.sim.droneLand(true);
        this.state = 'aborted';
        this.failure = reason;
        this.stepActive = false;
    }
    /**
     * @description Advance the machine: call after every world advance. Issues the next step when
     * the current one is complete; fails the run when a command is refused or an expectation is
     * not met.
     */
    tick() {
        if (this.state !== 'running' || !this.plan)
            return;
        if (this.stepActive) {
            const step = this.plan.steps[this.stepIndex];
            if (this.sim.droneDown && (0, exports.stepNode)(step) === world_sim_1.DRONE_NODE_ID) {
                this.fail(step, `drone down: ${this.sim.droneDown}`);
                return;
            }
            if (!this.isComplete(step))
                return;
            this.log(this.record(step, 'completed'));
            this.stepActive = false;
        }
        if (this.stepIndex + 1 >= this.plan.steps.length) {
            this.state = 'done';
            return;
        }
        this.stepIndex += 1;
        this.legIndex = 0;
        this.issue(this.plan.steps[this.stepIndex]);
    }
    record(step, outcome, reason) {
        const { id, kind, label, ...params } = step;
        return { tMs: this.sim.timeMs, actor: `${this.actor}:${id}`, nodeId: (0, exports.stepNode)(step), command: kind, params: { label, ...params }, outcome, reason };
    }
    fail(step, reason) {
        this.log(this.record(step, 'failed', reason));
        this.state = 'failed';
        this.failure = `${step.id} ${step.label}: ${reason}`;
        this.sim.abortUnit();
    }
    /** @description Issue a step's first command through the sim's guarded primitives. */
    issue(step) {
        try {
            this.dispatch(step);
            this.stepActive = true;
            this.log(this.record(step, 'accepted'));
            if (exports.IMMEDIATE_KINDS.has(step.kind)) {
                this.log(this.record(step, 'completed'));
                this.stepActive = false;
            }
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.log(this.record(step, 'refused', reason));
            if (this.tryRecover(step, reason))
                return;
            this.state = 'failed';
            this.failure = `${step.id} ${step.label}: ${error instanceof Error ? error.message : String(error)}`;
            this.sim.abortUnit();
        }
    }
    dispatch(step) {
        switch (step.kind) {
            case 'drone.takeoff':
                this.sim.droneTakeoff();
                return;
            case 'drone.goto':
                this.startFlight(step.target);
                return;
            case 'drone.land':
                this.sim.droneLand();
                return;
            case 'drone.observe':
                this.observe(step);
                return;
            case 'base.drive':
                this.sim.driveTo(step.legs[0]);
                return;
            case 'base.lift':
                this.sim.setLift(step.z);
                return;
            case 'arm.move':
                this.sim.moveArmToWorldPose(step.target, step.expectedForceN, step.contactRadius ?? 0);
                return;
            case 'arm.joints':
                this.sim.moveArmJoints(step.q);
                return;
            case 'arm.grasp': {
                const got = this.sim.grasp();
                if (step.objectId !== '*' && got !== step.objectId)
                    throw new Error(`grasped ${got}, expected ${step.objectId}`);
                return;
            }
            case 'arm.release': {
                const r = this.sim.release();
                if (!r)
                    throw new Error('nothing was held');
                if (step.surfaceId === '*' ? r.surfaceId === null : r.surfaceId !== step.surfaceId)
                    throw new Error(step.surfaceId === '*' ? 'the object fell to the floor' : `object did not land on ${step.surfaceId}`);
                return;
            }
            case 'rover.scan':
                this.sim.scanRover();
                return;
            case 'drone.scan':
                this.sim.scanDrone();
                return;
            case 'wrist.scan':
                this.sim.scanWrist();
                return;
            case 'drone.explore':
                this.explore = { scans: 0, pending: false, max: step.maxScans, legs: [], flown: 0, registerDue: false, scannedFrom: [] };
                return;
            case 'drone.recover':
                this.startRecovery();
                return;
            case 'world.expect': {
                this.sim.world.refresh();
                const n = this.sim.world.objectsOn(step.surfaceId).length;
                if (step.minObjects !== undefined && n < step.minObjects)
                    throw new Error(`expected at least ${step.minObjects} object(s) on ${step.surfaceId}, the map shows ${n}`);
                if (step.maxObjects !== undefined && n > step.maxObjects)
                    throw new Error(`expected at most ${step.maxObjects} object(s) on ${step.surfaceId}, the map shows ${n}`);
                return;
            }
            case 'arm.grasp-handle':
                this.sim.graspHandle(step.applianceId);
                return;
            case 'arm.release-handle': {
                const released = this.sim.releaseHandle();
                if (released !== step.applianceId)
                    throw new Error(`was not holding the ${step.applianceId} handle`);
                return;
            }
            default: throw new Error(`unknown step kind ${step.kind}`);
        }
    }
    observe(step) {
        const frame = this.sim.droneObserve(step.pitch, step.yaw);
        const seen = frame.detections.map((d) => d.objectId);
        this.lastObservation = { stepId: step.id, seen };
        const missing = step.expectPresent.filter((id) => !seen.includes(id));
        const lingering = step.expectAbsent.filter((id) => seen.includes(id));
        if (missing.length)
            throw new Error(`expected to see ${missing.join(', ')}; saw ${seen.join(', ') || 'nothing'}`);
        if (lingering.length)
            throw new Error(`expected ${lingering.join(', ')} to be gone; still visible`);
    }
    /** @description Has the active step finished? Multi-leg drives issue their next leg here. */
    isComplete(step) {
        const u = this.sim.unit;
        switch (step.kind) {
            case 'drone.takeoff': {
                if (this.sim.drone.mode !== 'hover')
                    return false;
                // Register the climb unless the plan's next step is a sweep anyway.
                const next = this.plan?.steps[this.stepIndex + 1];
                if (!next || next.kind !== 'drone.scan')
                    this.register(step);
                return true;
            }
            case 'drone.goto': {
                const d = this.sim.drone;
                const f = this.flight;
                if (d.mode !== 'hover' || !f)
                    return false;
                if ((0, vec_1.distance)([d.x, d.y, d.z], f.legs[f.index]) >= 0.02)
                    return false;
                if (f.index + 1 < f.legs.length) {
                    this.register(step);
                    f.index += 1;
                    try {
                        this.sim.droneGoto(f.legs[f.index]);
                    }
                    catch (error) {
                        this.failOrRecover(step, error);
                    }
                    return false;
                }
                this.flight = null;
                return (0, vec_1.distance)([d.x, d.y, d.z], step.target) < 0.02;
            }
            case 'drone.land': return this.sim.drone.mode === 'landed';
            case 'base.lift': return u.liftTarget === null;
            case 'arm.move':
            case 'arm.joints': return u.qTarget === null;
            case 'base.drive': return this.nextLegOrDone(step);
            case 'drone.explore': return this.exploreTick(step);
            case 'drone.recover': return this.recoverTick(step);
            default: return true;
        }
    }
    /** @description Frontier exploration: when hovering, scan if a scan is due, then fly to the next frontier; done when none is left or the budget is spent. */
    exploreTick(step) {
        const st = this.explore;
        if (!st || this.sim.drone.mode !== 'hover')
            return false;
        try {
            if (st.registerDue) {
                this.register(step);
                st.scans += 1;
                st.registerDue = false;
                st.flown = 0;
            }
            if (st.legs.length) {
                const next = st.legs.shift();
                const d = this.sim.drone;
                st.flown += (0, vec_1.distance)([d.x, d.y, d.z], next);
                if (st.flown > world_sim_1.MAX_UNREGISTERED_M && st.legs.length)
                    st.registerDue = true;
                this.sim.droneGoto(next);
                return false;
            }
            if (st.pending) {
                this.sim.scanDrone();
                st.scans += 1;
                st.pending = false;
                st.flown = 0;
                st.scannedFrom.push([this.sim.drone.x, this.sim.drone.y, this.sim.drone.z]);
            }
            if (st.scans >= st.max)
                return true;
            const goal = this.sim.nextExplorationGoal(st.scannedFrom);
            if (!goal)
                return true;
            st.legs = [...goal.legs];
            st.pending = true;
            this.log({ tMs: this.sim.timeMs, actor: `${this.actor}:${step.id}`, nodeId: world_sim_1.DRONE_NODE_ID, command: 'drone.explore-leg', params: { target: goal.point, legs: goal.legs.length, frontierCount: goal.frontierCount, scan: st.scans + 1 }, outcome: 'accepted' });
            this.sim.droneGoto(st.legs.shift());
        }
        catch (error) {
            this.failOrRecover(step, error);
        }
        return false;
    }
    /** @description A refusal ends the run — unless it is a lost localisation, which gets one recovery per step. */
    failOrRecover(step, error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (this.tryRecover(step, reason))
            return;
        this.fail(step, reason);
    }
    /**
     * @description Splice a `drone.recover` step in before the refused one and issue it; the refused step is re-issued from
     * scratch once the drone is localised again. One recovery per step — a second loss on the same step fails the run.
     */
    tryRecover(step, reason) {
        if (!this.plan || !/localisation lost/.test(reason) || (0, exports.stepNode)(step) !== world_sim_1.DRONE_NODE_ID || this.recoveredFor === this.stepIndex)
            return false;
        const recovery = { id: `${step.id}-recover`, kind: 'drone.recover', label: 'recover localisation: climb, sweep wide, back along the registered trail' };
        this.plan.steps.splice(this.stepIndex, 0, recovery);
        this.recoveredFor = this.stepIndex + 1;
        this.flight = null;
        this.explore = null;
        this.legIndex = 0;
        this.stepActive = false;
        this.issue(recovery);
        return true;
    }
    startRecovery() {
        this.recover = this.sim.localization.status === 'lost' ? { phase: 'climb', trail: this.sim.recoveryTrail(), sweeps: 0 } : null;
    }
    /**
     * @description The recovery, one decision per tick while hovering: climb to cruise and sweep wide; still lost, fly back
     * along the registered trail sweeping wide at each point; trail spent, land — on the pad the fix anchors, anywhere
     * else the drone declares itself grounded (the next tick fails the run on `droneDown`).
     */
    recoverTick(step) {
        const st = this.recover;
        if (!st)
            return true;
        const d = this.sim.drone;
        if (d.mode === 'landed') {
            if (this.sim.localization.status !== 'lost') {
                this.note(step, `landed and re-anchored on the pad after ${st.sweeps} wide sweep(s)`);
                this.recover = null;
                return true;
            }
            this.sim.groundLost(`still lost after ${st.sweeps} wide sweep(s) and the trail back; landed off the pad`);
            return false;
        }
        if (d.mode !== 'hover')
            return false;
        try {
            if (st.phase === 'climb') {
                st.phase = 'sweep';
                const cruise = this.sim.droneLimits.cruiseAlt;
                if (d.z < cruise - 0.05) {
                    this.sim.droneGoto([d.x, d.y, cruise], { recovering: true });
                    return false;
                }
            }
            if (st.phase === 'sweep' || st.phase === 'trail-sweep') {
                this.sim.scanDrone({ wide: true });
                st.sweeps += 1;
                const loc = this.sim.localization;
                // Recovered only when the sweep measured every direction: a fit that could not see the shift along a wall is not a fix.
                if (loc.status !== 'lost' && loc.observable) {
                    this.note(step, `recovered by a wide sweep after ${st.sweeps} sweep(s): corrected ${(0, vec_1.round)(loc.correctionM * 100, 1)} cm`);
                    this.recover = null;
                    return true;
                }
                st.phase = 'trail';
            }
            if (st.phase === 'trail') {
                const next = st.trail.shift();
                if (next) {
                    this.sim.droneGoto(next, { recovering: true });
                    st.phase = 'trail-sweep';
                    return false;
                }
                this.sim.droneLand();
                st.phase = 'landing';
            }
            return false;
        }
        catch (error) {
            this.sim.groundLost(`recovery refused: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    note(step, text) {
        this.log({ tMs: this.sim.timeMs, actor: `${this.actor}:${step.id}`, nodeId: world_sim_1.DRONE_NODE_ID, command: 'drone.recover-result', params: { text, status: this.sim.localization.status }, outcome: 'completed' });
    }
    /** @description Route a flight through the flight grid, split every routed leg into registered sub-legs, and fly the first. */
    startFlight(target) {
        const d = this.sim.drone;
        const route = this.sim.flightLegs(target);
        const legs = [];
        let from = [d.x, d.y, d.z];
        for (const wp of route) {
            legs.push(...registeredLegs(from, wp));
            from = wp;
        }
        this.flight = { legs, index: 0 };
        this.sim.droneGoto(this.flight.legs[0]);
    }
    /** @description A registration sweep the executor inserts on its own (after a climb, between long legs); logged as its own command so the record shows why the drone paused. */
    register(step) {
        this.sim.scanDrone();
        const loc = this.sim.localization;
        this.log({ tMs: this.sim.timeMs, actor: `${this.actor}:${step.id}`, nodeId: world_sim_1.DRONE_NODE_ID, command: 'drone.register', params: { status: loc.status, correctionM: loc.correctionM, matched: loc.matched }, outcome: loc.status === 'lost' ? 'failed' : 'completed', reason: loc.status === 'lost' ? 'registration did not converge' : undefined });
    }
    nextLegOrDone(step) {
        if (this.sim.unit.driveGoal)
            return false;
        if (this.legIndex + 1 >= step.legs.length)
            return true;
        this.legIndex += 1;
        try {
            this.sim.driveTo(step.legs[this.legIndex]);
        }
        catch (error) {
            this.fail(step, error instanceof Error ? error.message : String(error));
        }
        return false;
    }
}
exports.PlanExecutor = PlanExecutor;
//# sourceMappingURL=plan-executor.js.map