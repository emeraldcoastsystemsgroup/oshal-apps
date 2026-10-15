"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTES = exports.MAX_NOTES = void 0;
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: asked "Which parts of Life can I use right now without connecting anything?" on the
 *   Movies & TV tab, the concierge said NO part of Life was usable (Get a Ride, Travel and the others included): it saw only the
 *   Movies screen, and Life declared no summary. Life owns no data, so its summary states what each part needs and what works
 *   without it, as each part's own screen says, and that the part's tab shows whether it is connected on this installation.
 *   A provider this store knows has no connector on the native installation (Uber, Uber Eats, Walmart, Duffel, PayPal;
 *   scripts/check-connector-copy.mjs) is named as a rail the screen reports, never as something to connect. It
 *   reads nothing, calls no provider and spends nothing.
 */
const express_1 = require("express");
/** The most notes a concierge reads from one summary (oshal-kernel concierge_summary.rs NOTE_ROWS), each at most 280 characters. */
exports.MAX_NOTES = 6;
/**
 * Each part as its own screen describes it (movies, spotify, eats, rides, purchasing, travel, payments, bake-off), grouped by
 * what works without connecting anything, so the answer to "what can I use now" is one read.
 */
exports.NOTES = Object.freeze([
    'Works without a connection: Get a Ride (the map, your location, destination picks, distance and a modelled fare from the pins; a hand-off to Uber needs an Uber rail, and its screen says when this installation has none).',
    'Partly without a connection: the concierges of Order Food, Shopping and Travel work; restaurant search and checkout need an Uber Eats rail, products and deals a Walmart rail, and flight, hotel and car search a Duffel rail. Each screen says when this installation has none.',
    'Needs a connection first: Movies & TV (a TMDB key on the Connections page), Music (your Spotify account) and Payments (your Stripe key on the Connections page).',
    'AI Bake-Off needs no connection, but bots that each declare their own harness and provider; its screen says Not available here when every bot answers through one inference rail.',
    'Whether a part is connected on this installation is shown on its own tab (Not connected, Not configured or Unavailable when it is not).',
]);
/**
 * @description Life's Home summary: notes saying which parts work without a connection and what the rest need. Life is a launcher
 *   with no data or runtime, so there are no figures; whether a part is connected on this installation is on that part's
 *   own tab, and the summary says so rather than guessing.
 * @returns The summary router (GET /).
 */
function createHomeSummaryRoutes() {
    const router = (0, express_1.Router)();
    router.get('/', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const oidc = req.oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const items = exports.NOTES.slice(0, exports.MAX_NOTES).map((text) => ({ text, tone: 'neutral' }));
        res.json({ metrics: [], tiles: [], items, asOf: new Date().toISOString(), partial: false });
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map