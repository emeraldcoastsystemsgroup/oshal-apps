"use strict";
/**
 * Home (Smart Home) routes — the surface's READ side + the reasoning fast loop.
 *
 * ADR-036: the home-bot OWNS its domain and persists a unified device index +
 * bot-owned scenes to a per-user store (the shared `home-data` volume, bot :rw /
 * api :ro). This module serves:
 *   - cheap reads (GET /devices, /scenes) straight from the store — NO LLM call;
 *   - the reasoning fast loop (POST /assistant, /refresh) → the home-bot via
 *     BotNodeClient with the caller's brokered SmartThings token (cost auto-
 *     captured on the bot side → chat_tasks). Same pattern as storage/content.
 *
 * Writes belong to the bot (the owner). This route never writes the store.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-17 17:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: GET /api/home/devices reads the bot's per-user device index (home-data :ro) — the cheap read-model for the Smart Home surface. Auth-gated; scoped to the caller's OIDC sub.
 * 2026-06-17 18:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Add the reasoning fast loop + scenes read + surface: POST /assistant (chat → home-bot, brokered SmartThings token, cost auto-tracked), POST /refresh (bot rebuilds the device index — the only writer), GET /scenes (cheap read of bot-owned scenes.json), GET /ui (serve home.html dashboard).
 * 2026-07-19 19:20:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the home app package (ADR-085 Wave 2). Standard (ctx) factory; the dashboard serves from ctx.appPackageDir/tools (load-time env fallback, D10); shared core helpers (token broker, connectors, inline-bot-execution, the kernel home-schedule branch, sun-times) import via @/ aliases. The home-bot node (container + registries + persona + oshal-smartthings.js + smartthingsToolKit), the home-data volume, and the scheduler's home-control branch stay framework-resident (ADR-093).
 *
 * @module home-routes
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeRoutes = createHomeRoutes;
const express_1 = require("express");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const crypto = __importStar(require("crypto"));
const agent_management_1 = require("@/features/agent-management");
const connector_token_broker_1 = require("@/app/routes/connector-token-broker");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const home_schedule_dispatch_1 = require("@/app/home-schedule-dispatch");
const sun_times_1 = require("@/shared/utils/sun-times");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
const logger = (0, logger_1.createChildLogger)({ module: 'home-routes' });
// The shared `home-data` volume (home-bot :rw, api :ro). The bot writes the store
// here keyed by user_sub; this route only reads it. Mirrors the CLI's default.
const HOME_DATA_DIR = process.env.OSHAL_HOME_DATA_DIR || '/app/home-data';
/** The smart-home worker (codex; shells out to oshal-smartthings.js). */
const HOME_BOT_AGENT_ID = 'd0000000-0000-0000-0000-000000000001';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
function homeAssistantMightWrite(message) {
    const text = message.toLowerCase();
    const writeVerb = /\b(turn|switch|set|dim|brighten|run|start|stop|open|close|lock|unlock|arm|disarm|schedule|create|save|delete)\b/.test(text);
    const homeTarget = /\b(light|lights|lamp|plug|switch|thermostat|lock|door|garage|scene|routine|device|smartthings|home)\b/.test(text);
    return writeVerb && homeTarget;
}
/** Pull the signed-in user's sub from the OIDC session (scopes the read to them). For paired TV
 *  surfaces (Fire TV cookie / Roku header) the TV-token middleware injects req.oidc, so this
 *  resolves the paired user transparently — see [tv-pairing-routes.createTvTokenAuthMiddleware]. */
function callerSub(req) {
    const u = req.oidc?.user;
    const sub = u?.sub || u?.oid;
    return sub ? String(sub) : null;
}
/** Read a per-user store file, returning a default when it's absent (lazy store). */
function readStore(sub, file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(path.join(HOME_DATA_DIR, sub, file), 'utf8'));
    }
    catch {
        return fallback;
    }
}
/**
 * Dispatch a message to the home-bot via the fast loop with the caller's brokered
 * SmartThings token. `direct:true` = lean (no handover scaffolding); `agenticMode:true`
 * = the bot can shell out to its CLI. Cost auto-captures on the bot side.
 */
async function runOnHomeBot(ctx, sub, message) {
    const creds = await (0, connector_token_broker_1.resolveBotCreds)(ctx.pool, sub, ['smartthings']);
    const r = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, HOME_BOT_AGENT_ID, {
        text: message, taskId: `home-${sub}`, workspaceFolderId: `home-${sub}`,
        agentId: HOME_BOT_AGENT_ID, agenticMode: true, direct: true, userSub: sub, creds,
    });
    return r.response;
}
/** Resolve a device's SmartThings id from the cached index (canonical key or raw id). */
function resolveDeviceId(sub, ref) {
    const idx = readStore(sub, 'devices.json', { devices: [] });
    const entry = (idx.devices || []).find((d) => d.key === ref);
    if (entry) {
        const s = (entry.sources || []).find((x) => x.hub === 'smartthings') || entry.sources?.[0];
        return s?.deviceId || null;
    }
    // Accept a raw deviceId if it's one we know about.
    for (const d of idx.devices || [])
        for (const s of d.sources || [])
            if (s.deviceId === ref)
                return ref;
    return null;
}
/** Send one capability command to a SmartThings device. */
async function smartThingsCommand(token, deviceId, capability, command, arg) {
    const cmd = { component: 'main', capability, command };
    if (arg !== undefined && arg !== null && arg !== '')
        cmd.arguments = [isNaN(Number(arg)) ? arg : Number(arg)];
    const r = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/commands`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: [cmd] }),
    });
    if (!r.ok)
        throw new Error(`smartthings ${r.status}: ${(await r.text()).slice(0, 140)}`);
}
/** The natural-language instruction the home-bot executes when a schedule fires. */
function buildSchedulePrompt(action) {
    if (action.kind === 'scene') {
        return `Run my saved smart-home scene "${action.name}" now - execute \`OSHAL_DEVICE_WRITE_CONFIRM=true node /app/scripts/oshal-smartthings.js scene-run "${action.name}"\`, then confirm in one line.`;
    }
    const verb = action.cmd === 'off' ? 'Turn OFF' : 'Turn ON';
    return `${verb} the "${action.name}" device now (resolve it from the device index), then confirm in one line. Prefix the SmartThings write command with OSHAL_DEVICE_WRITE_CONFIRM=true.`;
}
/** Translate a trigger into a daily UTC cron. Clock times convert local→UTC via the
 *  browser's tz offset; solar resolves the next sun event for the given location. */
function buildScheduleCron(trigger) {
    if (trigger.kind === 'clock') {
        const localTotal = Number(trigger.hour) * 60 + Number(trigger.minute);
        const utc = (((localTotal + Number(trigger.tzOffsetMin || 0)) % 1440) + 1440) % 1440; // local → UTC
        const dow = trigger.repeat === 'weekdays' ? '1-5' : '*';
        return `${utc % 60} ${Math.floor(utc / 60)} * * ${dow}`;
    }
    const next = (0, sun_times_1.nextSunEvent)(trigger.lat, trigger.lng, trigger.event, Number(trigger.offsetMin || 0), new Date());
    if (!next)
        throw new Error('could not compute a sun time for that location');
    return `${next.getUTCMinutes()} ${next.getUTCHours()} * * *`;
}
/**
 * @description Smart Home routes (mount at /api/home, auth: oidc). Packaged shape
 * (ADR-085): standard (ctx) factory — the dashboard serves from the installed
 * package's tools/ dir (ctx.appPackageDir, captured at factory time per D10).
 * @param ctx - app context (pool for the token broker, appPackageDir for the surface)
 * @returns an Express router
 */
function createHomeRoutes(ctx) {
    const router = (0, express_1.Router)();
    const assetRoot = ctx.appPackageDir
        ? path.join(ctx.appPackageDir, 'tools')
        : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
    /** GET /api/home/ui — the Smart Home dashboard surface. */
    router.get('/ui', (_req, res) => {
        res.sendFile(path.join(assetRoot, 'home.html'), (err) => {
            if (err) {
                logger.error({ err }, 'serve home surface failed');
                res.status(404).send('Not found');
            }
        });
    });
    /** GET /api/home/devices — the caller's cached, deduped device index. Cheap (no LLM).
     *  Empty list (not an error) when the bot hasn't built the index yet. */
    router.get('/devices', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const idx = readStore(sub, 'devices.json', { devices: [], deviceCount: 0 });
            res.json({
                devices: idx.devices || [], deviceCount: idx.deviceCount ?? (idx.devices?.length || 0),
                generatedAt: idx.generatedAt || null, hubs: idx.hubs || [],
                empty: !(idx.devices && idx.devices.length),
            });
        }
        catch (err) {
            logger.error({ err, sub }, 'read device index failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/home/scenes — the caller's bot-owned scenes. Cheap read (no LLM). */
    router.get('/scenes', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const store = readStore(sub, 'scenes.json', { scenes: [] });
        res.json({ scenes: store.scenes || [] });
    });
    /** POST /api/home/assistant — chat → the home-bot turns it into device/scene action(s)
     *  and replies. Body: { message }. The bot does the work; cost is auto-tracked. */
    router.post('/assistant', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body || {});
        const message = String(body.message || '').trim();
        if (!message) {
            res.status(400).json({ error: 'message required' });
            return;
        }
        const mightWrite = homeAssistantMightWrite(message);
        if (mightWrite && !(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-device-write', 'Changing a smart-home device'));
            return;
        }
        try {
            const prompt = mightWrite
                ? `${message}\n\nThe user explicitly confirmed this smart-home write. Prefix SmartThings write commands with OSHAL_DEVICE_WRITE_CONFIRM=true.`
                : message;
            res.json({ reply: await runOnHomeBot(ctx, sub, prompt) });
        }
        catch (err) {
            logger.error({ err, sub }, 'home assistant failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /api/home/control — instant device action from a surface button (deterministic,
     *  no LLM): resolve the device from the index, command it with the caller's token. Body:
     *  { device, cmd:'on'|'off'|'set', capability?, command?, arg? }. Reasoning uses /assistant. */
    router.post('/control', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body || {});
        const device = String(body.device || '').trim();
        const cmd = String(body.cmd || '').trim();
        if (!device || !cmd) {
            res.status(400).json({ error: 'device and cmd required' });
            return;
        }
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-device-write', 'Changing a smart-home device'));
            return;
        }
        try {
            const deviceId = resolveDeviceId(sub, device);
            if (!deviceId) {
                res.status(404).json({ error: 'unknown device — refresh the index' });
                return;
            }
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'smartthings');
            if (!token) {
                res.status(409).json({ error: 'SmartThings not connected — connect it at /utilities' });
                return;
            }
            if (cmd === 'on' || cmd === 'off')
                await smartThingsCommand(token, deviceId, 'switch', cmd);
            else if (cmd === 'set')
                await smartThingsCommand(token, deviceId, body.capability || 'switchLevel', body.command || 'setLevel', body.arg);
            else {
                res.status(400).json({ error: 'cmd must be on|off|set' });
                return;
            }
            res.json({ ok: true, device, cmd });
        }
        catch (err) {
            logger.error({ err, sub, device }, 'home control failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /api/home/scene/run — instant run of a bot-owned scene from a surface tile
     *  (deterministic, no LLM): replay its steps. Body: { name }. Scene CREATION stays on
     *  the bot (it owns scenes.json); the controller only reads + replays. */
    router.post('/scene/run', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body || {});
        const name = String(body.name || '').trim();
        if (!name) {
            res.status(400).json({ error: 'name required' });
            return;
        }
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-device-write', 'Running a smart-home scene'));
            return;
        }
        try {
            const store = readStore(sub, 'scenes.json', { scenes: [] });
            const want = name.toLowerCase();
            const scene = (store.scenes || []).find((s) => s.key === want || String(s.name).toLowerCase() === want);
            if (!scene) {
                res.status(404).json({ error: `no scene "${name}"` });
                return;
            }
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'smartthings');
            if (!token) {
                res.status(409).json({ error: 'SmartThings not connected' });
                return;
            }
            for (const step of scene.steps) {
                const deviceId = resolveDeviceId(sub, step.device);
                if (!deviceId)
                    continue; // skip a step whose device left the index; don't fail the whole scene
                if (step.cmd === 'on' || step.cmd === 'off')
                    await smartThingsCommand(token, deviceId, 'switch', step.cmd);
                else if (step.cmd === 'set')
                    await smartThingsCommand(token, deviceId, step.capability || 'switchLevel', step.command || 'setLevel', step.arg);
            }
            res.json({ ok: true, ran: scene.name, steps: scene.steps.length });
        }
        catch (err) {
            logger.error({ err, sub, name }, 'scene run failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /api/home/schedules — the caller's smart-home schedules (cheap; from the scheduler). */
    router.get('/schedules', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const svc = (0, home_schedule_dispatch_1.getHomeScheduleService)();
        if (!svc) {
            res.json({ schedules: [] });
            return;
        }
        try {
            const all = await svc.listSchedules();
            const mine = all
                .filter((s) => s.taskType.startsWith('home-control') && String(s.taskData.userSub) === sub)
                .map((s) => ({
                id: s.id, label: s.taskData.label,
                trigger: s.taskData.trigger, cron: s.cron,
                nextRunAt: s.nextRunAt, status: s.status,
            }));
            res.json({ schedules: mine });
        }
        catch (err) {
            logger.error({ err, sub }, 'list home schedules failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/home/schedule — create a smart-home timer. Body: { label?, action, trigger }.
     *  When it fires, the home branch brokers the token, runs it on the home-bot, and logs a ticket. */
    router.post('/schedule', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body || {});
        if (!body.action || !body.trigger) {
            res.status(400).json({ error: 'action and trigger required' });
            return;
        }
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-device-write', 'Scheduling a smart-home device change'));
            return;
        }
        const svc = (0, home_schedule_dispatch_1.getHomeScheduleService)();
        if (!svc) {
            res.status(503).json({ error: 'scheduler unavailable' });
            return;
        }
        try {
            const prompt = buildSchedulePrompt(body.action);
            const cron = buildScheduleCron(body.trigger);
            const label = (body.label || prompt).slice(0, 110);
            const created = await svc.createSchedule({
                taskType: `home-control-${crypto.randomUUID()}`, schedule: cron,
                taskData: { userSub: sub, label, prompt, action: body.action, trigger: body.trigger },
            });
            // Solar schedules drift daily — ensure a per-user replanner keeps them accurate.
            if (body.trigger.kind === 'solar') {
                await svc.createSchedule({
                    taskType: `home-replan-${sub}`, schedule: '20 0 * * *',
                    taskData: { userSub: sub, prompt: 'replan solar schedules', kind: 'replan' },
                });
            }
            res.json({ id: created.id, label, cron: created.cron, nextRunAt: created.nextRunAt });
        }
        catch (err) {
            logger.error({ err, sub }, 'create home schedule failed');
            res.status(400).json({ error: err.message });
        }
    });
    /** DELETE /api/home/schedule/:id — remove one of the caller's schedules (ownership-checked). */
    router.delete('/schedule/:id', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const svc = (0, home_schedule_dispatch_1.getHomeScheduleService)();
        if (!svc) {
            res.status(503).json({ error: 'scheduler unavailable' });
            return;
        }
        try {
            const s = await svc.getSchedule(String(req.params.id));
            if (!s || String(s.taskData.userSub) !== sub) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            await svc.deleteSchedule(String(req.params.id));
            res.json({ ok: true });
        }
        catch (err) {
            logger.error({ err, sub }, 'delete home schedule failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/home/refresh — ask the bot (the store's only writer) to rebuild the device
     *  index, then return the fresh cached index for the surface. */
    router.post('/refresh', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await runOnHomeBot(ctx, sub, 'Refresh my devices: run `node /app/scripts/oshal-smartthings.js index` to rebuild the device index, then confirm in one line how many devices you found.');
            const idx = readStore(sub, 'devices.json', { devices: [], deviceCount: 0 });
            res.json({ devices: idx.devices || [], deviceCount: idx.deviceCount ?? 0, generatedAt: idx.generatedAt || null });
        }
        catch (err) {
            logger.error({ err, sub }, 'home refresh failed');
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=home-routes.js.map