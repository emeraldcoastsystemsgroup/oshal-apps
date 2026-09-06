"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-141 per-user readiness for the Intelligent Career group's setup dashboard: GET /readiness answers `stories` (how many of the caller's roles carry a story — read from the profile the review conversation will write, so it reports "0 of N" honestly until ADR-141 D7 ships) and `materials` (documents the caller has added under uploads/artifacts). Reads the caller's OWN store only; nothing is cached, nothing spends a token.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readStoriesReadiness = readStoriesReadiness;
exports.readMaterialsReadiness = readMaterialsReadiness;
exports.registerCareerReadinessRoutes = registerCareerReadinessRoutes;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-readiness' });
/**
 * @description How many of the caller's roles carry at least one story (`roles[].stories[]`) — the
 * evidence the story-by-story review leaves behind. Reads the same career profile Strengthen and the
 * generators read, so the count is what the profile actually holds.
 * @param userDir - The caller's isolated store directory.
 * @returns The stories readiness.
 */
async function readStoriesReadiness(userDir) {
    let roles = [];
    try {
        const data = JSON.parse(await fs_1.promises.readFile(path_1.default.join(userDir, 'career_db.json'), 'utf8'));
        roles = Array.isArray(data.roles) ? data.roles.filter((r) => !!r && typeof r === 'object') : [];
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            logger.error({ err }, 'career profile unreadable for stories readiness');
    }
    const withStory = roles.filter((r) => Array.isArray(r.stories) && r.stories.some((s) => !!s)).length;
    const ready = roles.length > 0 && withStory === roles.length;
    const detail = roles.length === 0
        ? 'Index a resume first — the review walks your roles one by one.'
        : `${withStory} of ${roles.length} roles have a story.`;
    return { ready, roles: roles.length, withStory, detail };
}
/**
 * @description How many documents the caller has added (uploads/artifacts — performance reports,
 * anything sent to Career through "Add to Career profile"). Counts regular files only.
 * @param userDir - The caller's isolated store directory.
 * @returns The materials readiness.
 */
async function readMaterialsReadiness(userDir) {
    let count = 0;
    try {
        const dir = await fs_1.promises.opendir(path_1.default.join(userDir, 'uploads', 'artifacts'));
        for await (const entry of dir)
            if (entry.isFile() && !entry.name.startsWith('.'))
                count += 1;
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            logger.error({ err }, 'career artifacts unreadable for materials readiness');
    }
    const detail = count === 0
        ? 'Nothing added yet — performance reports, project write-ups, anything that shows your work.'
        : `${count} document${count === 1 ? '' : 's'} added to your profile.`;
    return { ready: count > 0, count, detail };
}
/**
 * @description Registers GET /readiness — the probes the Intelligent Career group's setup steps
 * "Review your resume story by story" and "Add performance reports and other documents" read.
 * @param router - The package router (mounted at /api/career-hunter).
 */
function registerCareerReadinessRoutes(router) {
    router.get('/readiness', async (req, res) => {
        const userSub = (0, career_user_store_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const { userDir } = (0, career_user_store_1.userPaths)(userSub);
        try {
            const [stories, materials] = await Promise.all([readStoriesReadiness(userDir), readMaterialsReadiness(userDir)]);
            res.json({ stories, materials });
        }
        catch (err) {
            logger.error({ err, userSub }, 'career readiness failed');
            res.status(500).json({ error: 'readiness unavailable' });
        }
    });
}
//# sourceMappingURL=career-readiness.js.map