"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guest-seed hook (ADR-144 guest-seed contract). POST /api/career-hunter/guest-seed: core calls this on guest-start, AS the fresh guest (service secret + x-oshal-user-sub), so THIS app — not the kernel — plants the demo profile. It copies the bundled, pre-indexed demo resume (engine/seeds/career_db.default.json) into the guest's own store dir, overwriting so every guest starts from the same fresh default. Guest-only by construction: a non-guest sub is refused, so a real signed-in user's resume can never be clobbered by the demo.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerGuestSeedRoutes = registerCareerGuestSeedRoutes;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-guest-seed-routes' });
/** The bundled, pre-indexed demo profile — packageDir/engine/seeds/career_db.default.json (this
 *  file compiles to packageDir/routes, so the seeds dir is one level up). PR-B replaces the static
 *  file with a nightly-indexed one; the copy target stays the same. */
const DEMO_PROFILE = path_1.default.resolve(__dirname, '..', 'engine', 'seeds', 'career_db.default.json');
/**
 * @description Plant the demo profile for a fresh guest so the board opens on an indexed candidate
 * (Jordan Rivera) instead of the empty "upload your resume" onboarding. Guest-only: a real sub is
 * refused so its resume is never overwritten. Overwrites on every call — a guest resets to defaults.
 * @param req - The service-authed request; x-oshal-user-sub carries the guest sub.
 * @param res - JSON { ok, seeded } | 403 for a non-guest | 500 on an unexpected failure.
 */
async function seedGuestProfile(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    // Defense-in-depth: this endpoint plants DEMO data, so it may only ever touch a guest store.
    // Real OIDC subs (Google numeric / local-auth) never start with 'guest-'.
    if (!userSub.startsWith('guest-')) {
        res.status(403).json({ error: 'guest_only' });
        return;
    }
    try {
        const { userDir } = (0, career_user_store_1.userPaths)(userSub); // creates the guest's store dir
        await fs_1.promises.copyFile(DEMO_PROFILE, path_1.default.join(userDir, 'career_db.json'));
        logger.info({ userSub }, 'Planted demo profile for guest (career_db.json)');
        res.json({ ok: true, seeded: true });
    }
    catch (err) {
        // Best-effort by contract — the kernel orchestrator fences this — but surface a non-2xx so the
        // fan-out logs it. A missing bundled default is the one expected soft failure.
        const code = err.code;
        logger.error({ err, userSub, code }, 'Guest demo-profile seed failed');
        res.status(500).json({ ok: false, error: code || 'seed_failed' });
    }
}
/**
 * @description Registers the guest-seed hook on the career-hunter router.
 * @param router - The service-or-oidc career-hunter router (mount /api/career-hunter).
 * @returns Nothing.
 */
function registerCareerGuestSeedRoutes(router) {
    router.post('/guest-seed', seedGuestProfile);
}
//# sourceMappingURL=career-guest-seed-routes.js.map