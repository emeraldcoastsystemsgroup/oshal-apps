"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-04-22 00:05:00 | roger.murphy@agenticfederal.us   | New route module for Little Monsters voice settings — serves the config HTML and exposes the current provider resolution so the page can render without duplicating registry logic client-side
 * 2026-04-22 15:10:00 | roger.murphy@agenticfederal.us   | Added runSynchronousTranscription + buildLectureTicketDescription helpers here so /process-lecture can transcribe via the STT registry without pushing education-routes.ts over the 1000-line cap; same domain (education voice), different call surface
 * 2026-07-12 19:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | D10 fix: serveEducationFile no longer reads OSHAL_APP_PACKAGE_DIR at request time (last-mounted app won) — module-level packageToolsRoot captured at load time, re-affirmed from ctx.appPackageDir at factory time.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationVoiceRoutes = createEducationVoiceRoutes;
exports.runSynchronousTranscription = runSynchronousTranscription;
exports.buildLectureTicketDescription = buildLectureTicketDescription;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const voice_providers_1 = require("@/features/voice-providers");
const logger = (0, logger_1.createChildLogger)({ module: 'education-voice-routes' });
/** Package tools root — same D10 discipline as education-routes.ts: load-time capture,
 *  re-affirmed from ctx.appPackageDir at factory time; never read env at request time. */
let packageToolsRoot = process.env.OSHAL_APP_PACKAGE_DIR
    ? node_path_1.default.join(process.env.OSHAL_APP_PACKAGE_DIR, 'tools')
    : node_path_1.default.resolve(process.cwd(), 'any-bot/server/services/tools/education');
/**
 * @description Serve a static file from the education tools directory,
 * mirroring the helper in education-routes.ts rather than cross-importing.
 *
 * @param fileName Filename relative to any-bot/server/services/tools/education/.
 * @returns Express RequestHandler that sends the file or 404s.
 */
function serveEducationFile(fileName) {
    return (_req, res) => {
        const filePath = node_path_1.default.resolve(packageToolsRoot, fileName);
        res.sendFile(filePath, (err) => {
            if (err) {
                logger.error({ err, fileName }, `Failed to serve ${fileName}`);
                res.status(404).send(`Page not found: ${fileName}`);
            }
        });
    };
}
/**
 * @description Build the read-only voice-config payload the settings page
 * renders. Resolves the currently-active providers by ID and asks each for
 * its status so the UI can flag anything not yet configured.
 *
 * @returns Config + status envelope.
 */
async function buildVoiceConfigPayload() {
    const config = (0, voice_providers_1.loadSwarmVoiceConfig)();
    const ttsRegistry = (0, voice_providers_1.getTTSProviderRegistry)();
    const sttRegistry = (0, voice_providers_1.getSTTProviderRegistry)();
    const ttsProviders = await Promise.all(ttsRegistry.list().map(async (p) => ({
        id: p.id,
        displayName: p.displayName,
        kind: p.kind,
        status: await p.getStatus(),
    })));
    const sttProviders = await Promise.all(sttRegistry.list().map(async (p) => ({
        id: p.id,
        displayName: p.displayName,
        kind: p.kind,
        status: await p.getStatus(),
    })));
    return { config, tts: { providers: ttsProviders }, stt: { providers: sttProviders } };
}
/**
 * @description Create the Little Monsters voice routes — settings page +
 * read-only config endpoint. Mounted at /api/education by the swarm-app
 * loader (same prefix as the rest of the education routes).
 *
 * @returns Configured Express router.
 */
function createEducationVoiceRoutes(ctx) {
    // Per-package dir from the mounter (D10) — structural param, so this module keeps
    // working on frameworks whose mounter predates ctx.appPackageDir.
    if (ctx?.appPackageDir) {
        packageToolsRoot = node_path_1.default.join(ctx.appPackageDir, 'tools');
    }
    const router = (0, express_1.Router)();
    /** GET /api/education/voice-settings — serve the settings HTML page. */
    router.get('/voice-settings', serveEducationFile('voice-settings.html'));
    /** GET /api/education/voice-config — return resolved config + provider status. */
    router.get('/voice-config', async (_req, res) => {
        try {
            const payload = await buildVoiceConfigPayload();
            logger.info({ ttsDefault: payload.config.tts.default, sttDefault: payload.config.stt.default }, 'voice-config requested');
            res.json({ success: true, data: payload });
        }
        catch (error) {
            logger.error({ err: error }, 'Failed to build voice-config payload');
            res.status(500).json({
                success: false,
                error: 'Failed to load voice config',
                message: error.message,
            });
        }
    });
    logger.info('Education voice routes registered');
    return router;
}
/**
 * @description Transcribe an uploaded lecture buffer via the STT registry,
 * persist the transcript to disk, and update the `lm_lectures` row. Errors
 * are translated into a typed result so the calling endpoint still
 * dispatches its bot ticket (which may have its own BYOK fallback).
 *
 * @param params Transcription inputs (buffer + DB pool + workspace target).
 * @returns Structured result with status + optional transcript path.
 */
async function runSynchronousTranscription(params) {
    const provider = (0, voice_providers_1.getSTTProviderRegistry)().resolveForApp();
    if (provider.kind === 'browser') {
        return {
            status: 'unconfigured',
            providerId: provider.id,
            message: 'Swarm default STT is browser-only — cannot transcribe server-side uploads',
        };
    }
    try {
        const result = await provider.transcribe({
            audio: params.audioBuffer,
            mimeType: params.mimeType,
            enableSegments: false,
        });
        const transcriptPath = node_path_1.default.join(params.workspaceDir, `TRANSCRIPT-${params.date}.md`);
        node_fs_1.default.writeFileSync(transcriptPath, formatTranscriptMarkdown(params, result.providerId, result.text), 'utf8');
        await params.pool.query(`UPDATE lm_lectures SET transcript_path = $1 WHERE lecture_id = $2`, [transcriptPath, params.lectureId]);
        logger.info({ providerId: result.providerId, chars: (result.text || '').length, transcriptPath }, 'Synchronous STT succeeded');
        return {
            status: 'transcribed',
            providerId: result.providerId,
            transcriptPath,
            text: result.text,
        };
    }
    catch (error) {
        return mapTranscriptionError(provider.id, error);
    }
}
/**
 * @description Render the transcript + standard frontmatter. Split out so
 * `runSynchronousTranscription` stays under the 50-line function cap.
 */
function formatTranscriptMarkdown(params, providerId, text) {
    return [
        `# Lecture Transcript`,
        ``,
        `**Date:** ${params.date}`,
        `**Subject:** ${params.subject}`,
        `**Class:** ${params.classId}`,
        `**Provider:** ${providerId}`,
        ``,
        `---`,
        ``,
        text || '',
    ].join('\n');
}
/**
 * @description Classify a transcription error into the caller-friendly
 * result shape. Auth errors become `unconfigured`; anything else `failed`.
 */
function mapTranscriptionError(providerId, error) {
    if (error instanceof voice_providers_1.GoogleAuthNotConfiguredError) {
        logger.warn({ providerId, reason: error.reason }, 'STT provider unconfigured — ticket will rely on bot-side fallback');
        return { status: 'unconfigured', providerId, message: error.reason };
    }
    logger.error({ err: error, providerId }, 'Synchronous STT failed');
    return { status: 'failed', providerId, message: error.message };
}
/**
 * @description Build the Markdown description for the lecture-processing
 * ticket. Branches on whether transcription succeeded so the bot sees the
 * transcript path instead of a "please transcribe" step when it's already
 * done.
 *
 * @param params Ticket context + transcription result.
 * @returns Markdown body for `CreateInternalTicketSchema.description`.
 */
function buildLectureTicketDescription(params) {
    const lines = [
        `## Lecture Processing Request`,
        `**Class:** ${params.className} (${params.subject})`,
        `**Date:** ${params.date}`,
        `**Audio:** ${params.audioPath}`,
        `**Lecture ID:** ${params.lectureId}`,
        `**Transcription:** ${params.transcription.status} (${params.transcription.providerId})`,
        ``,
    ];
    if (params.transcription.status === 'transcribed' && params.transcription.transcriptPath) {
        lines.push(`**Transcript:** ${params.transcription.transcriptPath}`, ``, `### Instructions (transcript already available)`, `1. Read the transcript at the path above`, `2. Generate study notes using generate-study-notes tool`, `3. Extract assignments using extract-assignments tool`, `4. Generate flashcards using generate-flashcards tool`, `5. Index content into ChromaDB for class ${params.classId}`);
    }
    else {
        lines.push(`**Transcription note:** ${params.transcription.message || 'unknown'}`, ``, `### Instructions (transcript unavailable — try BYOK fallback)`, `1. Transcribe audio using transcribe-lecture tool (requires OPENAI_API_KEY)`, `2. Generate study notes using generate-study-notes tool`, `3. Extract assignments using extract-assignments tool`, `4. Generate flashcards using generate-flashcards tool`, `5. Index content into ChromaDB for class ${params.classId}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=education-voice-routes.js.map