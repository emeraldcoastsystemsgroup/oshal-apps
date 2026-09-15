"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — who is in command: `auto` (a plan runs),
 *                     |                             | `manual` (a human took command; the plan is paused), `estop`
 *                     |                             | (latched until a human resets), `idle`. Manual commands go
 *                     |                             | through the SAME guarded sim primitives as the plan — a human
 *                     |                             | cannot jog into a counter or lift a load the tip budget
 *                     |                             | refuses either — and every one is logged with its outcome.
 *                     |                             | E-stop and abort are always accepted, in any mode.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Manual `scan` (rover / wrist / drone) as a guarded command; a drone abort lands regardless of the map (`droneLand(true)`).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | B14: the manual drone command `recover` — one wide registration sweep; the multi-step recovery belongs to the executor.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlAuthority = void 0;
const arm_model_1 = require("../arm/arm-model");
const plan_executor_1 = require("../plan/plan-executor");
const world_sim_1 = require("../sim/world-sim");
/** @description Reads a finite number from params or throws. */
function num(params, key, fallback) {
    const v = params[key];
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (fallback !== undefined)
        return fallback;
    throw new Error(`refused: ${key} must be a number`);
}
/** @description The command authority over one world. */
class ControlAuthority {
    sim;
    log;
    mode = 'idle';
    executor;
    /** The user sub that holds manual command, when any. */
    holder = null;
    constructor(sim, log) {
        this.sim = sim;
        this.log = log;
        this.executor = new plan_executor_1.PlanExecutor(sim, log, 'plan');
    }
    /** @description Start a plan (the human has already confirmed; the route enforces that). */
    execute(plan, who) {
        if (this.mode === 'estop')
            throw new Error('refused: e-stop is latched');
        if (this.mode === 'manual')
            throw new Error(`refused: ${this.holder ?? 'someone'} holds manual command`);
        this.executor.start(plan);
        this.mode = 'auto';
        this.log({ tMs: this.sim.timeMs, actor: who, nodeId: world_sim_1.UNIT_NODE_ID, command: 'plan.execute', params: { task: plan.task, steps: plan.steps.length }, outcome: 'accepted' });
    }
    /** @description A human takes command: the running plan pauses. */
    take(who) {
        if (this.mode === 'estop')
            throw new Error('refused: reset the e-stop first');
        if (this.mode === 'manual' && this.holder !== who)
            throw new Error(`refused: ${this.holder} already holds command`);
        if (this.executor.state === 'running')
            this.executor.pause();
        this.mode = 'manual';
        this.holder = who;
        this.log({ tMs: this.sim.timeMs, actor: who, nodeId: world_sim_1.UNIT_NODE_ID, command: 'control.take', params: {}, outcome: 'accepted' });
    }
    /** @description The human releases command: a paused plan resumes, otherwise idle. */
    release(who) {
        if (this.mode !== 'manual')
            return;
        if (this.holder !== who)
            throw new Error(`refused: ${this.holder} holds command`);
        this.holder = null;
        if (this.executor.state === 'paused') {
            this.executor.resume();
            this.mode = 'auto';
        }
        else
            this.mode = 'idle';
        this.log({ tMs: this.sim.timeMs, actor: who, nodeId: world_sim_1.UNIT_NODE_ID, command: 'control.release', params: {}, outcome: 'accepted' });
    }
    /** @description Latch the e-stop. Always accepted. */
    estop(who) {
        this.executor.abort('e-stop');
        this.sim.eStop();
        if (this.sim.drone.mode !== 'landed')
            this.sim.droneLand();
        this.mode = 'estop';
        this.holder = null;
        this.log({ tMs: this.sim.timeMs, actor: who, nodeId: world_sim_1.UNIT_NODE_ID, command: 'e-stop', params: {}, outcome: 'accepted' });
    }
    /** @description Abort the running plan without latching. Always accepted. */
    abort(who) {
        this.executor.abort();
        this.sim.abortUnit();
        if (this.mode === 'auto')
            this.mode = 'idle';
        this.log({ tMs: this.sim.timeMs, actor: who, nodeId: world_sim_1.UNIT_NODE_ID, command: 'plan.abort', params: {}, outcome: 'accepted' });
    }
    /** @description A human resets the latch. */
    reset(who) {
        if (this.mode !== 'estop')
            throw new Error('refused: no e-stop is latched');
        this.sim.resetEstop();
        this.mode = 'idle';
        this.log({ tMs: this.sim.timeMs, actor: who, nodeId: world_sim_1.UNIT_NODE_ID, command: 'e-stop.reset', params: {}, outcome: 'accepted' });
    }
    /** @description After the world advances: drive the executor and settle the mode when a plan ends. */
    tick() {
        this.executor.tick();
        if (this.mode === 'auto' && ['done', 'failed', 'aborted'].includes(this.executor.state))
            this.mode = 'idle';
    }
    /**
     * @description A manual command. Requires manual mode held by `who`; runs through the guarded
     * primitives; logged whether accepted or refused.
     * @param cmd - The command.
     * @param who - The human.
     * @returns A short result the surface can show.
     */
    manual(cmd, who) {
        const base = { tMs: this.sim.timeMs, actor: who, nodeId: cmd.nodeId, command: cmd.command, params: cmd.params ?? {}, outcome: 'accepted' };
        try {
            if (this.mode !== 'manual' || this.holder !== who)
                throw new Error('refused: take command first');
            const result = this.dispatch(cmd);
            this.log(base);
            return result;
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.log({ ...base, outcome: 'refused', reason });
            throw error;
        }
    }
    dispatch(cmd) {
        const p = cmd.params ?? {};
        if (cmd.nodeId === world_sim_1.DRONE_NODE_ID)
            return this.dispatchDrone(cmd.command, p);
        if (cmd.nodeId !== world_sim_1.UNIT_NODE_ID)
            throw new Error(`refused: unknown node ${cmd.nodeId}`);
        switch (cmd.command) {
            case 'jog':
                this.sim.jog(num(p, 'v', 0), num(p, 'w', 0), num(p, 'seconds', 0.5));
                return { ok: true };
            case 'stop':
                this.sim.stopBase();
                return { ok: true };
            case 'lift':
                this.sim.setLift(num(p, 'z'));
                return { ok: true };
            case 'move-to-pose': return this.armJog(p);
            case 'move-joints':
                this.sim.moveArmJoints(p.q === 'stow' ? [...arm_model_1.STOW_Q] : p.q === 'ready' ? [...arm_model_1.READY_Q] : p.q);
                return { ok: true };
            case 'grasp': return { ok: true, objectId: this.sim.grasp() };
            case 'release': return { ok: true, ...this.sim.release() };
            case 'scan': {
                const s = p.sensor === 'wrist' ? this.sim.scanWrist().sweep : this.sim.scanRover();
                return { ok: true, returns: s.hits.length, ...this.sim.world.stats() };
            }
            case 'abort':
                this.sim.abortUnit();
                return { ok: true };
            default: throw new Error(`refused: unknown command ${cmd.command}`);
        }
    }
    /** @description Cartesian jog of the tool by at most 10 cm per axis from where it is now. */
    armJog(p) {
        const clampStep = (v) => Math.max(-0.1, Math.min(0.1, v));
        const tcp = this.sim.tcpWorld();
        const target = { ...tcp, x: tcp.x + clampStep(num(p, 'dx', 0)), y: tcp.y + clampStep(num(p, 'dy', 0)), z: tcp.z + clampStep(num(p, 'dz', 0)) };
        if (p.toolDown === true) {
            target.roll = Math.PI;
            target.pitch = 0;
        }
        const ik = this.sim.moveArmToWorldPose(target, num(p, 'expectedForceN', 0));
        return { ok: true, iterations: ik.iterations, target };
    }
    dispatchDrone(command, p) {
        switch (command) {
            case 'takeoff':
                this.sim.droneTakeoff();
                return { ok: true };
            case 'goto':
                this.sim.droneGoto([num(p, 'x'), num(p, 'y'), num(p, 'z')]);
                return { ok: true };
            case 'land':
                this.sim.droneLand();
                return { ok: true };
            case 'observe': {
                const f = this.sim.droneObserve(typeof p.pitch === 'number' ? p.pitch : undefined, typeof p.yaw === 'number' ? p.yaw : undefined);
                return { ok: true, detections: f.detections.length };
            }
            case 'scan': {
                const s = this.sim.scanDrone();
                return { ok: true, returns: s.hits.length, ...this.sim.world.stats() };
            }
            case 'abort':
                this.sim.droneLand(true);
                return { ok: true };
            case 'recover': {
                const s = this.sim.scanDrone({ wide: true });
                return { ok: true, returns: s.hits.length, status: this.sim.localization.status, correctionM: this.sim.localization.correctionM };
            }
            default: throw new Error(`refused: unknown drone command ${command}`);
        }
    }
}
exports.ControlAuthority = ControlAuthority;
//# sourceMappingURL=control-authority.js.map