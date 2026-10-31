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

import type { Request, Response, Router } from 'express';
import { buildHexapod } from './engine/design/hexapod-design';
import { hexapodBomCsv, hexapodDesignMarkdown } from './engine/design/hexapod-markdown';
import { hexapodFitById, type HexapodFit } from './engine/design/hexapod-spec';

/** @description The fits this designer answers for. */
export const HEXAPOD_FITS: readonly HexapodFit[] = ['spider-18'];

const fitOf = (req: Request): HexapodFit | null => hexapodFitById(typeof req.query.fit === 'string' ? req.query.fit : undefined);

/**
 * @description Mount the hexapod designer's routes on the embodied router: `GET /build/hexapod?fit=`,
 * `/build/hexapod/design.md`, `/build/hexapod/parts/:partId` and `/build/hexapod/bom.csv`.
 * @param router - The package's router.
 */
export function registerHexapodDesignRoutes(router: Router): void {
  const refuse = (res: Response): void => { res.status(400).json({ error: 'unknown_fit', fits: HEXAPOD_FITS }); };

  router.get('/build/hexapod', (req: Request, res: Response) => {
    const fit = fitOf(req);
    if (!fit) { refuse(res); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ simulated: true, generated: true, ...buildHexapod(fit) });
  });

  router.get('/build/hexapod/design.md', (req: Request, res: Response) => {
    const fit = fitOf(req);
    if (!fit) { refuse(res); return; }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(hexapodDesignMarkdown(fit));
  });

  router.get('/build/hexapod/parts/:partId', (req: Request, res: Response) => {
    const fit = fitOf(req);
    if (!fit) { refuse(res); return; }
    const part = buildHexapod(fit).printed.find((p) => p.id === req.params.partId);
    if (!part) { res.status(404).json({ error: 'unknown_part', parts: buildHexapod(fit).printed.map((p) => p.id) }); return; }
    res.json({
      fit,
      part: { id: part.id, name: part.name, qty: part.qty, material: part.material, massEachG: part.massEachG, link: part.link, ...(part.option ? { option: part.option } : {}) },
      cadStudio: { title: `${part.name} — ${fit}`, base: part.cad.base, features: part.cad.features, source: { package: 'embodied', fit, partId: part.id, qty: part.qty, material: part.material } },
    });
  });

  router.get('/build/hexapod/bom.csv', (req: Request, res: Response) => {
    const fit = fitOf(req);
    if (!fit) { refuse(res); return; }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fit}-bom.csv"`);
    res.send(hexapodBomCsv(fit));
  });
}
