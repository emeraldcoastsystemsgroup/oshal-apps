"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the hexapod designer's routes on the embodied
 *                     |                             | mount — the design (every number from the parts), its document,
 *                     |                             | one part as a CAD Studio program in the hand-off shape the drone
 *                     |                             | and the arm use, and the bill of materials as CSV. Public within
 *                     |                             | the app, as the drone designer is: nothing owner-scoped in it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEXAPOD_FITS = void 0;
exports.registerHexapodDesignRoutes = registerHexapodDesignRoutes;
const hexapod_design_1 = require("./engine/design/hexapod-design");
const hexapod_markdown_1 = require("./engine/design/hexapod-markdown");
const hexapod_spec_1 = require("./engine/design/hexapod-spec");
/** @description The fits this designer answers for. */
exports.HEXAPOD_FITS = ['spider-18'];
const fitOf = (req) => (0, hexapod_spec_1.hexapodFitById)(typeof req.query.fit === 'string' ? req.query.fit : undefined);
/**
 * @description Mount the hexapod designer's routes on the embodied router: `GET /build/hexapod?fit=`,
 * `/build/hexapod/design.md`, `/build/hexapod/parts/:partId` and `/build/hexapod/bom.csv`.
 * @param router - The package's router.
 */
function registerHexapodDesignRoutes(router) {
    const refuse = (res) => { res.status(400).json({ error: 'unknown_fit', fits: exports.HEXAPOD_FITS }); };
    router.get('/build/hexapod', (req, res) => {
        const fit = fitOf(req);
        if (!fit) {
            refuse(res);
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ simulated: true, generated: true, ...(0, hexapod_design_1.buildHexapod)(fit) });
    });
    router.get('/build/hexapod/design.md', (req, res) => {
        const fit = fitOf(req);
        if (!fit) {
            refuse(res);
            return;
        }
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.send((0, hexapod_markdown_1.hexapodDesignMarkdown)(fit));
    });
    router.get('/build/hexapod/parts/:partId', (req, res) => {
        const fit = fitOf(req);
        if (!fit) {
            refuse(res);
            return;
        }
        const part = (0, hexapod_design_1.buildHexapod)(fit).printed.find((p) => p.id === req.params.partId);
        if (!part) {
            res.status(404).json({ error: 'unknown_part', parts: (0, hexapod_design_1.buildHexapod)(fit).printed.map((p) => p.id) });
            return;
        }
        res.json({
            fit,
            part: { id: part.id, name: part.name, qty: part.qty, material: part.material, massEachG: part.massEachG, link: part.link, ...(part.option ? { option: part.option } : {}) },
            cadStudio: { title: `${part.name} — ${fit}`, base: part.cad.base, features: part.cad.features, source: { package: 'embodied', fit, partId: part.id, qty: part.qty, material: part.material } },
        });
    });
    router.get('/build/hexapod/bom.csv', (req, res) => {
        const fit = fitOf(req);
        if (!fit) {
            refuse(res);
            return;
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fit}-bom.csv"`);
        res.send((0, hexapod_markdown_1.hexapodBomCsv)(fit));
    });
}
//# sourceMappingURL=embodied-hexapod-routes.js.map