"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the printed arm's routes on the embodied mount:
 *                     |                             | the design (every number from the parts model), its document, one
 *                     |                             | part as a CAD Studio program, the MuJoCo model generated from the
 *                     |                             | same design, and the physics check — the engine container holds
 *                     |                             | the payload in each joint's worst pose and runs the taught
 *                     |                             | pick-and-place, and the route hands back what it measured beside
 *                     |                             | what the design expected. The check runs without blocking the api.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARM_CHECK_TIMEOUT_MS = exports.ARM_CHECK_SEEDS = void 0;
exports.registerArmRoutes = registerArmRoutes;
const engine_1 = require("./engine");
/** How many scenes the taught pick-and-place may be asked for in one check. */
exports.ARM_CHECK_SEEDS = { min: 1, max: 5, fallback: 3 };
/** The check holds six poses and runs a few episodes: seconds, not milliseconds. */
exports.ARM_CHECK_TIMEOUT_MS = 120000;
const fitOf = (req) => (0, engine_1.armFitById)(typeof req.query.fit === 'string' ? req.query.fit : 'desk-6');
/** @description The design as the tile shows it: the fit, the joints, the parts, the budgets — never the CAD programs' bulk. */
function designView(d) {
    return {
        fit: { id: d.fit.id, label: d.fit.label, layout: d.fit.layout, payloadKg: d.fit.payloadKg, servo: d.fit.servo },
        joints: d.joints.map((j) => ({ joint: j.joint, name: j.name, gravityNm: j.gravityNm, inertialNm: j.inertialNm, requiredNm: j.requiredNm, worstQ: j.worstQ, drive: j.drive })),
        parts: d.parts.map((p) => ({ id: p.id, name: p.name, qty: p.qty, material: p.material, printNotes: p.printNotes, massEachG: p.massEachG, link: p.link, features: p.cad.features.length, base: p.cad.base })),
        bought: d.bought, spec: d.spec, linkMassesKg: d.linkMassesKg, massBudget: d.massBudget, reachM: d.reachM,
        repeatability: d.repeatability, servoCount: d.servoCount, approxUsd: d.approxUsd, undersized: d.undersized, printRules: d.printRules,
    };
}
/**
 * @description Mount the arm's routes on the embodied router.
 * @param router - The package's router. @param deps - Identity, the engine check and the failure shape.
 */
function registerArmRoutes(router, deps) {
    const fits = Object.keys(engine_1.ARM_FITS);
    router.get('/build/arm', (req, res) => {
        const fit = fitOf(req);
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ simulated: true, generated: true, ...designView((0, engine_1.buildArm)(fit)) });
    });
    router.get('/build/arm/design.md', (req, res) => {
        const fit = fitOf(req);
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits });
            return;
        }
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.send((0, engine_1.armDesignMarkdown)(fit));
    });
    router.get('/build/arm/parts/:partId', (req, res) => {
        const fit = fitOf(req);
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits });
            return;
        }
        const part = (0, engine_1.buildArm)(fit).parts.find((p) => p.id === req.params.partId);
        if (!part) {
            res.status(404).json({ error: 'unknown_part' });
            return;
        }
        res.json({ fit, part: { id: part.id, name: part.name, qty: part.qty, material: part.material, massEachG: part.massEachG }, cadStudio: { title: `${part.name} — ${fit}`, base: part.cad.base, features: part.cad.features, source: { package: 'embodied', fit, partId: part.id, qty: part.qty, material: part.material } } });
    });
    router.get('/physics/arm/mjcf', (req, res) => {
        const fit = fitOf(req);
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits });
            return;
        }
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.send((0, engine_1.armMjcf)(fit));
    });
    router.post('/physics/arm/check', async (req, res) => {
        const sub = deps.withSub(req, res);
        if (!sub)
            return;
        const body = (req.body ?? {});
        const fit = (0, engine_1.armFitById)(typeof body.fit === 'string' ? body.fit : 'desk-6');
        if (!fit) {
            res.status(400).json({ error: 'unknown_fit', fits });
            return;
        }
        const asked = Number(body.seeds);
        const seeds = Number.isFinite(asked) ? Math.round(asked) : exports.ARM_CHECK_SEEDS.fallback;
        if (seeds < exports.ARM_CHECK_SEEDS.min || seeds > exports.ARM_CHECK_SEEDS.max) {
            res.status(400).json({ error: 'bad_seeds', message: `seeds must be between ${exports.ARM_CHECK_SEEDS.min} and ${exports.ARM_CHECK_SEEDS.max}` });
            return;
        }
        const design = (0, engine_1.buildArm)(fit);
        const plant = (0, engine_1.armPlant)(fit);
        try {
            const report = await deps.checkArm({
                mjcf: (0, engine_1.armMjcf)(fit), worst: plant.worst.map((w) => w.q), designNm: plant.worst.map((w) => w.nm),
                usableNm: plant.joints.map((j) => j.usableNm), speeds: design.spec.joints.map((j) => j.maxSpeed), payloadKg: design.fit.payloadKg, seeds,
            });
            res.json({ simulated: true, fit, payloadKg: design.fit.payloadKg, joints: design.joints.map((j) => ({ joint: j.joint, name: j.name, requiredNm: j.requiredNm, drive: j.drive?.cfg.label ?? null, usableNm: j.drive?.output.usableNm ?? null })), report });
        }
        catch (error) {
            const { status, body: failure } = deps.physicsFailure(error);
            res.status(status).json(failure);
        }
    });
}
//# sourceMappingURL=embodied-arm-routes.js.map