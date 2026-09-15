"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — plan validation by REHEARSAL: the plan runs
 *                     |                             | to completion on a clone of the world through the very same
 *                     |                             | executor and guarded primitives a live execution uses. A plan
 *                     |                             | that cannot finish in the rehearsal is refused at draft time
 *                     |                             | with the step and reason; one that finishes reports how long
 *                     |                             | it took and what the world looks like afterwards. The live run
 *                     |                             | re-validates every step again — the rehearsal never replaces
 *                     |                             | that, it only refuses earlier.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | `stepsCompleted` counts plan steps only — the executor's own registration sweeps (`drone.register`) are logged but are not steps.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REHEARSAL_LIMIT_S = void 0;
exports.validatePlan = validatePlan;
const plan_executor_1 = require("./plan-executor");
/** @description Upper bound on rehearsal time so a stuck plan cannot spin (simulated seconds). */
exports.REHEARSAL_LIMIT_S = 1800;
/**
 * @description Rehearse a plan on a clone of the world.
 * @param sim - The live world (never mutated).
 * @param plan - The plan.
 * @returns The validation.
 */
function validatePlan(sim, plan) {
    const world = sim.clone();
    const records = [];
    const executor = new plan_executor_1.PlanExecutor(world, (r) => records.push(r), 'rehearsal');
    executor.start(plan);
    let minFrontFactor = Number.POSITIVE_INFINITY;
    const start = world.timeMs;
    while (executor.state === 'running' && (world.timeMs - start) / 1000 < exports.REHEARSAL_LIMIT_S) {
        executor.tick();
        if (executor.state !== 'running')
            break;
        world.advance(200);
        const budget = world.tipBudget();
        const demand = 60 * 1.1;
        minFrontFactor = Math.min(minFrontFactor, budget.momentCapacity.front / demand);
    }
    const issues = [];
    if (executor.state === 'failed')
        issues.push(executor.failure ?? 'the rehearsal failed');
    else if (executor.state !== 'done')
        issues.push(`the rehearsal did not finish within ${exports.REHEARSAL_LIMIT_S} simulated seconds`);
    const dropped = world.scene.objects.filter((o) => o.location.kind === 'floor').map((o) => o.id);
    if (dropped.length)
        issues.push(`objects ended on the floor: ${dropped.join(', ')}`);
    const completed = records.filter((r) => r.outcome === 'completed' && r.command !== 'drone.register').length;
    const finalLocations = {};
    for (const o of world.scene.objects)
        finalLocations[o.id] = o.location.kind === 'surface' ? o.location.surfaceId : o.location.kind;
    return { ok: issues.length === 0, issues, durationS: (world.timeMs - start) / 1000, stepsCompleted: completed, stepsTotal: plan.steps.length, finalLocations, minFrontFactor };
}
//# sourceMappingURL=plan-validator.js.map