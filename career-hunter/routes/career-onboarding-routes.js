"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted caller-scoped resume indexing and board onboarding state.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Read durable child lifecycle status so an existing profile cannot clear a pending re-upload marker.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerOnboardingRoutes = registerCareerOnboardingRoutes;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const career_resume_upload_1 = require("./career-resume-upload");
const logger = (0, logger_1.createChildLogger)({ module: 'career-onboarding-routes' });
async function readResumeState(userDir) {
    const careerDb = path_1.default.join(userDir, 'career_db.json');
    try {
        const data = JSON.parse(await fs_1.promises.readFile(careerDb, 'utf8'));
        const roles = Array.isArray(data.roles) ? data.roles.length : 0;
        const name = data.profile?.name || '';
        const hasResume = roles > 0 || !!data.profile?.experience_summary;
        return { hasResume, roles, name };
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return { hasResume: false, roles: 0, name: '' };
        logger.error({ err }, 'career onboarding profile is unreadable');
        return { hasResume: false, roles: 0, name: '' };
    }
}
function countScoredJobs(userSub) {
    try {
        const db = (0, career_user_store_1.openUserDb)(userSub);
        if (!db)
            return 0;
        try {
            const row = db.prepare('SELECT COUNT(*) AS n FROM user_signals WHERE ai_fit_score IS NOT NULL').get();
            return row?.n || 0;
        }
        finally {
            db.close();
        }
    }
    catch (err) {
        logger.error({ err, userSub }, 'career scored-job count failed');
        return 0;
    }
}
async function getResumeState(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const { userDir } = (0, career_user_store_1.userPaths)(userSub);
    const [resume, ingest] = await Promise.all([
        readResumeState(userDir), (0, career_resume_upload_1.readResumeIngestState)(userSub),
    ]);
    res.json({
        ...resume,
        indexing: ingest.state === 'pending',
        ingest,
        scored: countScoredJobs(userSub),
    });
}
/**
 * @description Registers the resume-indexing and scored-board onboarding state route.
 * @param router - Authenticated Career Hunter router.
 * @returns Nothing.
 */
function registerCareerOnboardingRoutes(router) {
    router.get('/resume/state', getResumeState);
}
//# sourceMappingURL=career-onboarding-routes.js.map