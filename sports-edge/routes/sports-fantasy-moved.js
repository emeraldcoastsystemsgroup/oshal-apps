"use strict";
/**
 * Where Sports Edge's fantasy routes went — /api/sports-edge/fantasy/* answers 410 Gone.
 *
 * ADR-146 D1 (operator decisions 2026-09-27): fantasy football is its own store package,
 * `fantasy-football`, grouped with this one as the application group `intelligent-sports`. The
 * management engine that used to live under this package's /fantasy routes — league link, the
 * P(win) lineup advisor, the start/sit ledger — moved there, and it moved to PER-PERSON ownership:
 * every table user_sub-keyed under forced exact-owner row security, and only the caller's own ESPN
 * connection spent.
 *
 * WHY 410 AND NOT A REDIRECT. The new package's tables are not this package's tables, and a link or
 * a ledger here was never copied there (a package reading another package's tables is a coupling the
 * platform does not sanction). A redirect would send a saved bookmark to a route that answers with
 * none of the caller's old state and look like data loss; 410 with the new address says exactly what
 * happened: it moved, relink there. The old sports_fantasy_* tables are left in place, unread and
 * unwritten, rather than dropped — deleting a person's rows is not something a version bump does.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — every method on /fantasy and below answers 410 with the fantasy-football app's address, after the management engine moved there (ADR-146 D1).
 *
 * @module sports-fantasy-moved
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FANTASY_MOVED = void 0;
exports.registerFantasyMoved = registerFantasyMoved;
/** The answer every retired fantasy route gives. */
exports.FANTASY_MOVED = Object.freeze({
    error: 'Fantasy moved to its own app, Fantasy Football. Your team, leagues and ledger there are yours alone; link your league again there.',
    movedTo: '/api/fantasy-football/',
    app: 'fantasy-football',
    open: '/cockpit/?app=fantasy-football',
});
/**
 * @description Answer every request under /fantasy with 410 Gone and the new address.
 * @param router - The package's router.
 * @returns Nothing.
 */
function registerFantasyMoved(router) {
    router.use('/fantasy', (_req, res) => {
        res.status(410).json(exports.FANTASY_MOVED);
    });
}
//# sourceMappingURL=sports-fantasy-moved.js.map