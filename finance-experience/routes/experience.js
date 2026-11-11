"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HAND_OFF = exports.FINANCE_APPLICATION = void 0;
exports.createExperienceRoutes = createExperienceRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The entry of Finance in the experiences list: one route that sends the person to the Finance application page. This package owns no page of its own, so there is one Finance page and one owner of it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.0.1: the entry answers a hand-off page that sends the browser to the Finance application page. 1.0.0 answered with `res.redirect`: the native kernel's response has no such method (HTTP 500 on the test slot, 2026-11-11), and a kernel relays a package's status, body and content type and no other header (oshal-kernel crates/api/src/package_dispatch.rs `render`), so a Location header never reaches the browser either. Guard: tests/package-contract.test.cjs runs the route with a response that has only the kernel's methods.
 */
const express_1 = require("express");
/** Where the entry sends a person: the Finance application page, owned and served by the finance package. */
exports.FINANCE_APPLICATION = '/api/finance/app';
/**
 * The hand-off page. It carries no script and one address: the browser goes to the Finance application page at once,
 * and the link is there for a browser that does not follow a refresh.
 */
exports.HAND_OFF = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=${exports.FINANCE_APPLICATION}">
<title>Finance</title>
</head>
<body>
<p><a href="${exports.FINANCE_APPLICATION}">Open Finance</a></p>
</body>
</html>
`;
/**
 * @description The routes of the Finance entry. Opening it is the only thing the member role allows, so the
 * `application` resource admits an active, identified caller holding an `own` grant and nothing else.
 * @param ctx The package context; application authorization must be present.
 * @returns The router: GET /app answers the hand-off page to the Finance application page.
 */
function createExperienceRoutes(ctx) {
    if (!ctx.authorization)
        throw new Error('The Finance entry requires application authorization');
    ctx.authorization.registerResource('application', {
        authorize: async ({ actor, grant, fields }) => actor.isActive && Boolean(actor.sub?.trim()) && Boolean(actor.issuer?.trim())
            && grant.scope === 'own' && fields.length === 0,
    });
    const router = (0, express_1.Router)();
    router.get('/app', (_req, res) => {
        // A page, not a redirect: a kernel relays a package's status, body and content type and no other header.
        res.status(200).type('html').send(exports.HAND_OFF);
    });
    return router;
}
//# sourceMappingURL=experience.js.map