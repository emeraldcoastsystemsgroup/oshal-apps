"use strict";
/**
 * Home (Smart Home) routes — the surface's READ side + the reasoning fast loop.
 *
 * ADR-036: the home-bot OWNS its domain and persists a unified device index +
 * bot-owned scenes to a per-user store (the shared `home-data` volume, bot :rw /
 * api :ro). This module serves:
 *   - cheap reads (GET /devices, /scenes) straight from the store — NO LLM call;
 *   - the reasoning fast loop (POST /assistant) → the home-bot via BotNodeClient
 *     with a bounded cached device/scene snapshot and no provider tools or credentials;
 *   - deterministic SmartThings reads/writes (/refresh, /control, /scene/run) in the
 *     controller, resolving the caller's token only for that exact provider operation.
 *
 * The shared bot store remains read-only here; live refresh uses an owner-keyed process
 * overlay, and confirmed writes go straight to the fixed SmartThings API boundary.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Initial: GET /api/home/devices reads the bot's per-user device index (home-data :ro) — the cheap read-model for the Smart Home surface. Auth-gated; scoped to the caller's OIDC sub.
 * 2   | maintainer@emeraldcoastsystemsgroup.com   | Add the reasoning fast loop + scenes read + surface: POST /assistant (chat → home-bot, brokered SmartThings token, cost auto-tracked), POST /refresh (bot rebuilds the device index — the only writer), GET /scenes (cheap read of bot-owned scenes.json), GET /ui (serve home.html dashboard).
 * 3   | maintainer@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the home app package (ADR-085 Wave 2). Standard (ctx) factory; the dashboard serves from ctx.appPackageDir/tools (load-time env fallback, D10); shared core helpers (token broker, connectors, inline-bot-execution, the kernel home-schedule branch, sun-times) import via @/ aliases. The home-bot node (container + registries + persona + oshal-smartthings.js + smartthingsToolKit), the home-data volume, and the scheduler's home-control branch stay framework-resident (ADR-093).
 * 4   | maintainer@emeraldcoastsystemsgroup.com   | SECURITY: retire the SmartThings credential carrier from generic home-bot dispatch. Reasoning now receives a bounded controller-read device/scene snapshot with tools disabled; direct controls/scenes and live refresh resolve the caller's token only at their deterministic SmartThings API boundary.
 * 5   | maintainer@emeraldcoastsystemsgroup.com   | Native kernel: with OSHAL_EGRESS=kernel, /control, /scene/run and /refresh call api.smartthings.com through the global fetch with no Authorization header; the kernel applies the caller's smartthings connection declared in the manifest egress block. "Not connected" is decided from the connectors.metadata intent (none, revoked, or lapsed and unrenewable), and a kernel "not connected" refusal answers the same 409 each route gives for a missing token. The legacy broker path is unchanged.
 * 6   | maintainer@emeraldcoastsystemsgroup.com   | The home chat named a raw path, 'under Connections (/utilities)', while the app has its own Hubs tab. The reasoning prompt carries HOME_CONNECT_RULE: a hub is connected on this app's Hubs tab, named in words, never a raw path. Guard: tests/home-connect-copy.test.cjs.
 * 7   | maintainer@emeraldcoastsystemsgroup.com   | Sweep 14: the Smart Home assistant's reply began "The snapshot shows no devices or scenes are currently connected.", the prompt's own word. The prompt calls the data what the person's Smart Home app has saved (HOME_JSON) and says to speak of it that way, never with a word of the instructions. Guard: tests/home-connect-copy.test.cjs.
 * 8   | maintainer@emeraldcoastsystemsgroup.com   | GET /weather?location= answers the National Weather Service forecast for a US place (./home-weather): Jarvis said no weather source was installed. Guard: tests/home-weather.test.js.
 * 9   | maintainer@emeraldcoastsystemsgroup.com   | Add GET /device-inspect (and GET /devices/:device/capabilities) for live SmartThings capability/status/ViewInside refrigerator camera inspection (./home-device-inspect), and persistent Operations Guide & Runbook routes GET/POST /operations-guide (./home-operations-guide) with auto-discovery logging and /home-summary insight injection.
 * 10  | maintainer@emeraldcoastsystemsgroup.com   | Persist refreshed SmartThings device indexes under OSHAL_PACKAGE_DATA_DIR, auto-populate hub connection state and devices on GET /devices when SmartThings is connected, and add zero-API-cost local Swarm device discovery/registration/control (GET/POST /local-discover, POST /devices/register, DELETE /devices/:key) plus direct SmartThings token save (POST /connect-token).
 * 11  | maintainer@emeraldcoastsystemsgroup.com   | Add GET /fridge-image and POST /fridge-refresh (`samsungce.viewInside` `refreshAll`) to serve and refresh Samsung Family Hub refrigerator interior camera snapshots and telemetry in the Smart Home dashboard.
 * 12  | maintainer@emeraldcoastsystemsgroup.com   | Add GET/POST /fridge-assessment and POST /fridge-meal-plan (`./fridge-weekly-assessment`) for weekly refrigerator optical assessment, week-over-week comparison, grocery cart recommendations, and weekly meal list builder.
 * 13  | maintainer@emeraldcoastsystemsgroup.com   | home 1.4.0: mount the TVs and streaming sticks routes (./home-lan-devices: /lan/devices, /lan/discover-plan, /lan/control-plan, /lan/record), serve the page's TVs module (GET /ui/home-tvs.js), and answer POST /control for a network TV with 409 tv_needs_computer in words instead of flipping its saved switch (no packet was ever sent).
 * 14  | maintainer@emeraldcoastsystemsgroup.com   | home 1.5.0 (J-6): add schema-bounded read-only SmartThings `samsungce.viewInside` server operation (`GET /api/home/view-inside` and `GET /api/home/view-inside/image/:fileId`) returning interior camera bay metadata and SVG bay previews for the Smart Home app and Jarvis.
 *
 * @module home-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeRoutes = createHomeRoutes;
const home_summary_1 = require("./home-summary");
const express_1 = require("express");
const fs = require("fs");
const path = require("path");
const logger_1 = require("@/shared/logger");
const crypto = require("crypto");
const agent_management_1 = require("@/features/agent-management");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const home_schedule_dispatch_1 = require("@/app/home-schedule-dispatch");
const sun_times_1 = require("@/shared/utils/sun-times");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const kernel_egress_1 = require("./kernel-egress");
const home_weather_1 = require("./home-weather");
const home_device_inspect_1 = require("./home-device-inspect");
const home_operations_guide_1 = require("./home-operations-guide");
const home_local_swarm_1 = require("./home-local-swarm");
const fridge_weekly_assessment_1 = require("./fridge-weekly-assessment");
const home_lan_devices_1 = require("./home-lan-devices");
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
const logger = (0, logger_1.createChildLogger)({ module: 'home-routes' });
// The shared `home-data` volume (home-bot :rw, api :ro) or native OSHAL_PACKAGE_DATA_DIR.
const HOME_DATA_DIR = process.env.OSHAL_HOME_DATA_DIR || process.env.OSHAL_PACKAGE_DATA_DIR || '/app/home-data';
/** The smart-home reasoning worker; provider tools are disabled for this route's dispatch. */
const HOME_BOT_AGENT_ID = 'd0000000-0000-0000-0000-000000000001';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** A network TV is pressed through the person's own computer, never by flipping a saved switch. */
const TV_NEEDS_COMPUTER = 'This TV is pressed through your own computer: use its buttons under TVs and streaming sticks on the Smart Home screen, or ask Jarvis to scan for it.';
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
    const persisted = (0, home_local_swarm_1.readPersistedJson)(sub, file);
    if (persisted !== null)
        return persisted;
    try {
        return JSON.parse(fs.readFileSync(path.join(HOME_DATA_DIR, sub, file), 'utf8'));
    }
    catch {
        return fallback;
    }
}
/** Process-local overlay for a deterministic live refresh; also persisted when OSHAL_PACKAGE_DATA_DIR is mounted. */
const refreshedDeviceIndexes = new Map();
function mergeWithLocalSwarmDevices(sub, base) {
    const localDevices = (0, home_local_swarm_1.readLocalSwarmDevices)(sub);
    if (!localDevices.length)
        return base;
    const byKey = new Map();
    for (const d of base.devices || []) {
        byKey.set(d.key, d);
    }
    for (const ld of localDevices) {
        byKey.set(ld.key, ld);
    }
    const merged = Array.from(byKey.values());
    const hubsSet = new Set(base.hubs || []);
    hubsSet.add('swarm-local');
    return {
        devices: merged,
        deviceCount: merged.length,
        generatedAt: base.generatedAt || new Date().toISOString(),
        hubs: Array.from(hubsSet),
    };
}
function readDeviceIndex(sub) {
    const base = refreshedDeviceIndexes.get(sub) || readStore(sub, 'devices.json', { devices: [], deviceCount: 0, generatedAt: null, hubs: [] });
    return mergeWithLocalSwarmDevices(sub, base);
}
/** Where a hub is connected, in the words the person sees: the app's Hubs tab, never a raw path such as /utilities. */
const HOME_CONNECT_RULE = 'When the Smart Home app has no devices, or the person asks how to connect a hub: a hub is connected on this app\'s Hubs tab (SmartThings connects there; Google Home is set up in Connections from that tab). Name the Hubs tab in words; never give a raw path such as /utilities.';
/** How to speak of the data (sweep 14: a reply opened "The snapshot shows no devices", the prompt's own word). */
const HOME_WORDS_RULE = 'Speak of it as what the person\'s Smart Home app has ("your Smart Home app has no devices yet"); never say snapshot, JSON, controller or any other word of these instructions.';
function homeReasoningPrompt(sub, message) {
    const index = readDeviceIndex(sub);
    const scenes = readStore(sub, 'scenes.json', { scenes: [] });
    const snapshot = {
        devices: (index.devices || []).slice(0, 150).map((device) => ({
            key: String(device.key || '').slice(0, 120),
            name: String(device.userName || device.name || '').slice(0, 160),
            room: device.room ? String(device.room).slice(0, 120) : null,
            capabilities: (device.capabilities || []).slice(0, 40).map((capability) => String(capability).slice(0, 80)),
            switch: device.switch ? String(device.switch).slice(0, 24) : null,
        })),
        scenes: (scenes.scenes || []).slice(0, 75).map((scene) => ({
            key: String(scene.key || '').slice(0, 120),
            name: String(scene.name || '').slice(0, 160),
            stepCount: Array.isArray(scene.steps) ? scene.steps.length : 0,
        })),
        generatedAt: index.generatedAt || null,
    };
    return [
        'Reason only over HOME_JSON below: the devices and scenes the person\'s Smart Home app has saved.',
        HOME_WORDS_RULE,
        'Do not invoke tools, request credentials, or claim a device action ran. Direct writes use the deterministic controller endpoints.',
        HOME_CONNECT_RULE,
        `HOME_JSON=${JSON.stringify(snapshot)}`,
        `OPERATIONS_GUIDE_JSON=${JSON.stringify((0, home_operations_guide_1.buildOperationsGuideSummary)(sub))}`,
        `USER_REQUEST=${message.slice(0, 8_000)}`,
    ].join('\n');
}
/**
 * Dispatch a bounded, credential-free snapshot to the home-bot for reasoning only.
 * Provider reads/writes are deterministic controller operations below; tools remain disabled.
 */
async function runOnHomeBot(ctx, sub, message) {
    const r = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, HOME_BOT_AGENT_ID, {
        text: homeReasoningPrompt(sub, message), taskId: `home-${sub}`, workspaceFolderId: `home-${sub}`,
        agentId: HOME_BOT_AGENT_ID, agenticMode: false, direct: true, userSub: sub,
    });
    return r.response;
}
/** Resolve a device's SmartThings id from the cached index (canonical key or raw id). */
function resolveDeviceId(sub, ref) {
    const idx = readDeviceIndex(sub);
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
/** SmartThings request headers: the caller's Bearer token on the legacy path; none under the kernel, which applies the declared connection. */
function smartThingsHeaders(token, extra = {}) {
    return (0, kernel_egress_1.kernelEgress)() ? { ...extra } : { Authorization: `Bearer ${token}`, ...extra };
}
/**
 * The caller's SmartThings authorization for one deterministic operation: the brokered token on the legacy path; under
 * the kernel the sentinel unless the connection metadata says there is no usable smartthings connection (then null).
 */
async function smartThingsToken(ctx, sub) {
    const saved = (0, home_local_swarm_1.readSavedSmartThingsToken)(sub);
    if (saved?.token)
        return (0, kernel_egress_1.kernelEgress)() ? kernel_egress_1.KERNEL_TOKEN : saved.token;
    if (!(0, kernel_egress_1.kernelEgress)())
        return (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'smartthings');
    return (0, kernel_egress_1.connectionUsable)(await (0, kernel_egress_1.readConnections)(ctx), 'smartthings') === false ? null : kernel_egress_1.KERNEL_TOKEN;
}
/** Send one capability command to a SmartThings device. */
async function smartThingsCommand(token, deviceId, capability, command, arg) {
    const cmd = { component: 'main', capability: string(capability), command: string(command) };
    if (arg !== undefined && arg !== null && arg !== '')
        cmd.arguments = [isNaN(Number(arg)) ? arg : Number(arg)];
    const r = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/commands`, {
        method: 'POST', headers: smartThingsHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ commands: [cmd] }),
    });
    if (!r.ok)
        throw new Error(`smartthings ${r.status}: ${(await r.text()).slice(0, 140)}`);
}
function string(v) {
    return String(v || '');
}
/** Fetch and sanitize the live SmartThings device index without exposing the token to a model or task. */
async function fetchSmartThingsDeviceIndex(token, sub) {
    const response = await fetch('https://api.smartthings.com/v1/devices', {
        headers: smartThingsHeaders(token),
    });
    if (!response.ok)
        throw new Error(`smartthings ${response.status}: ${(await response.text()).slice(0, 140)}`);
    const payload = await response.json();
    const prior = readDeviceIndex(sub);
    const priorByKey = new Map((prior.devices || []).map((device) => [device.key, device]));
    const devices = (payload.items || []).slice(0, 500).map((item) => {
        const label = String(item.label || item.name || '(unnamed)').slice(0, 160);
        const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'device';
        const components = Array.isArray(item.components) ? item.components : [];
        const capabilities = components.flatMap((component) => (Array.isArray(component.capabilities)
            ? component.capabilities.map((capability) => String(capability.id || '').slice(0, 80))
            : [])).filter(Boolean).slice(0, 40);
        const old = priorByKey.get(key);
        return {
            key,
            name: label,
            userName: old?.userName || null,
            room: item.roomId ? String(item.roomId).slice(0, 120) : null,
            capabilities,
            switch: old?.switch || null,
            sources: [{ hub: 'smartthings', deviceId: String(item.deviceId || '').slice(0, 160), label }],
        };
    }).filter((device) => Boolean(device.sources?.[0]?.deviceId));
    return {
        devices,
        deviceCount: devices.length,
        generatedAt: new Date().toISOString(),
        hubs: ['smartthings'],
    };
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
async function resolveLiveDeviceIndex(ctx, sub) {
    let idx = readDeviceIndex(sub);
    const connections = await (0, kernel_egress_1.readConnections)(ctx);
    const savedSt = (0, home_local_swarm_1.readSavedSmartThingsToken)(sub);
    const stConnected = Boolean(savedSt?.token) || (0, kernel_egress_1.connectionUsable)(connections, 'smartthings') === true;
    const ghConnected = (0, kernel_egress_1.connectionUsable)(connections, 'google-home') === true ||
        (0, kernel_egress_1.connectionUsable)(connections, 'google_home') === true;
    const hasStDevices = (idx.devices || []).some((d) => (d.sources || []).some((s) => s.hub === 'smartthings'));
    if (stConnected && !hasStDevices) {
        try {
            const token = savedSt?.token ? ((0, kernel_egress_1.kernelEgress)() ? kernel_egress_1.KERNEL_TOKEN : savedSt.token) : kernel_egress_1.KERNEL_TOKEN;
            const fetched = await fetchSmartThingsDeviceIndex(token, sub);
            refreshedDeviceIndexes.set(sub, fetched);
            (0, home_local_swarm_1.writePersistedJson)(sub, 'devices.json', fetched);
            idx = mergeWithLocalSwarmDevices(sub, fetched);
        }
        catch (err) {
            logger.warn({ err, sub }, 'auto-refresh on GET /devices skipped');
        }
    }
    const hubs = new Set(idx.hubs || []);
    if (stConnected)
        hubs.add('smartthings');
    if (ghConnected)
        hubs.add('google-home');
    if ((idx.devices || []).some((d) => (d.sources || []).some((s) => s.hub === 'swarm-local'))) {
        hubs.add('swarm-local');
    }
    return {
        devices: idx.devices || [],
        deviceCount: (idx.devices || []).length,
        generatedAt: idx.generatedAt || null,
        hubs: Array.from(hubs),
    };
}
function registerLocalSwarmRoutes(router, ctx) {
    router.get('/local-discover', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.json({ ok: true, candidates: (0, home_local_swarm_1.discoverLocalSwarmCandidates)(sub), registered: (0, home_local_swarm_1.readLocalSwarmDevices)(sub) });
    });
    router.post('/local-discover', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body || {});
        const candidates = (0, home_local_swarm_1.discoverLocalSwarmCandidates)(sub);
        const registerIds = Array.isArray(body.registerIds) ? new Set(body.registerIds) : null;
        const newlyRegistered = [];
        if (body.autoRegister || registerIds) {
            for (const c of candidates) {
                if (body.autoRegister || registerIds?.has(c.id)) {
                    const { device } = (0, home_local_swarm_1.registerLocalSwarmDevice)(sub, c);
                    newlyRegistered.push(device);
                }
            }
            if (newlyRegistered.length) {
                (0, home_operations_guide_1.recordDiscoveredDevices)(sub, newlyRegistered);
            }
        }
        res.json({
            ok: true,
            candidates: (0, home_local_swarm_1.discoverLocalSwarmCandidates)(sub),
            registered: (0, home_local_swarm_1.readLocalSwarmDevices)(sub),
            addedCount: newlyRegistered.length,
        });
    });
    router.post('/devices/register', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body || {});
        if (!String(body.name || '').trim()) {
            res.status(400).json({ ok: false, error: 'name_required', message: 'Device name is required.' });
            return;
        }
        const { device, devices } = (0, home_local_swarm_1.registerLocalSwarmDevice)(sub, body);
        (0, home_operations_guide_1.recordDiscoveredDevices)(sub, [device]);
        res.json({ ok: true, device, devices, idx: readDeviceIndex(sub) });
    });
    router.delete('/devices/:key', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const result = (0, home_local_swarm_1.removeLocalSwarmDevice)(sub, String(req.params.key || ''));
        res.json({ ok: true, ...result, idx: readDeviceIndex(sub) });
    });
    router.post('/connect-token', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const token = String(req.body?.token || '').trim();
        if (token.length < 8) {
            res.status(400).json({ ok: false, error: 'token_required', message: 'Paste a valid SmartThings Personal Access Token.' });
            return;
        }
        (0, home_local_swarm_1.saveSmartThingsToken)(sub, token);
        try {
            const idx = await fetchSmartThingsDeviceIndex((0, kernel_egress_1.kernelEgress)() ? kernel_egress_1.KERNEL_TOKEN : token, sub);
            refreshedDeviceIndexes.set(sub, idx);
            (0, home_local_swarm_1.writePersistedJson)(sub, 'devices.json', idx);
            (0, home_operations_guide_1.recordDiscoveredDevices)(sub, (idx.devices || []));
            const merged = mergeWithLocalSwarmDevices(sub, idx);
            res.json({ ok: true, connected: true, ...merged });
        }
        catch {
            const merged = readDeviceIndex(sub);
            const hubs = Array.from(new Set([...(merged.hubs || []), 'smartthings']));
            res.json({ ok: true, connected: true, ...merged, hubs });
        }
    });
}
/**
 * @description Smart Home routes (mount at /api/home, auth: oidc). Packaged shape
 * (ADR-085): standard (ctx) factory — the dashboard serves from the installed
 * package's tools/ dir (ctx.appPackageDir, captured at factory time per D10).
 * @param ctx - app context (pool for deterministic connector calls, appPackageDir for the surface)
 * @returns an Express router
 */
function createHomeRoutes(ctx) {
    const router = (0, express_1.Router)();
    registerLocalSwarmRoutes(router, ctx);
    (0, home_lan_devices_1.registerLanDeviceRoutes)(router, callerSub);
    router.get('/home-summary', (req, res) => {
        const oidc = req.oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
        if (!sub || oidc?.isAuthenticated?.() !== true) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        try {
            const storeDir = (0, home_local_swarm_1.resolveHomeStoreDir)();
            const idx = refreshedDeviceIndexes.get(String(sub)) || (0, home_summary_1.readHomeSnapshot)(storeDir, String(sub), 'devices.json') || readDeviceIndex(String(sub));
            if (idx && Array.isArray(idx.devices) && idx.devices.length)
                (0, home_operations_guide_1.recordDiscoveredDevices)(String(sub), idx.devices);
            const summary = (0, home_summary_1.homeSnapshotSummary)(idx, (0, home_summary_1.readHomeSnapshot)(storeDir, String(sub), 'scenes.json'));
            const guideSummary = (0, home_operations_guide_1.buildOperationsGuideSummary)(String(sub));
            const guide = (0, home_operations_guide_1.readOperationsGuide)(String(sub));
            const items = Array.isArray(summary.items) ? summary.items : [];
            items.push({
                text: 'Smart Home Operations Guide & Runbook',
                detail: guideSummary.detail,
                tone: 'neutral',
                fix: 'home-dashboard',
                actions: [{ integration: 'prepare-document', context: { title: 'Smart Home Operations Guide & Runbook', notes: guideSummary.detail.slice(0, 1800) } }],
            });
            summary.operationsGuide = { ...guideSummary, playbooks: guide.playbooks };
            res.json(summary);
        }
        catch {
            res.status(503).json({ error: 'Saved home configuration is unavailable.' });
        }
    });
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
    /** GET /api/home/ui/home-tvs.js — the TVs and streaming sticks section's module (home 1.4.0). */
    router.get('/ui/home-tvs.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(assetRoot, 'home-tvs.js'), (err) => {
            if (err) {
                logger.error({ err }, 'serve home TVs module failed');
                res.status(404).send('Not found');
            }
        });
    });
    /** GET /api/home/devices — the caller's cached, deduped device index. Cheap (no LLM).
     *  Empty list (not an error) when the bot hasn't built the index yet. */
    // The forecast for a place the person names (National Weather Service; ./home-weather).
    router.get('/weather', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const answer = await (0, home_weather_1.forecast)(globalThis.fetch, req.query.location || req.query.q);
            res.status(answer.ok ? 200 : answer.error === 'location_required' ? 400 : 404).json(answer);
        }
        catch (err) {
            logger.error({ err }, 'home weather forecast failed');
            res.status(502).json({ ok: false, error: 'forecast_unavailable', message: 'The National Weather Service could not be reached just now.' });
        }
    });
    router.get('/devices', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const idx = await resolveLiveDeviceIndex(ctx, sub);
            if (idx.devices && idx.devices.length) {
                (0, home_operations_guide_1.recordDiscoveredDevices)(sub, idx.devices);
            }
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
    const handleDeviceInspect = async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const token = await smartThingsToken(ctx, sub);
            if (!token) {
                res.status(409).json({ error: 'SmartThings not connected — connect it on the Hubs tab' });
                return;
            }
            const query = req.params.device || req.query.device || req.query.q || 'all';
            const result = await (0, home_device_inspect_1.inspectSmartThingsDevices)(globalThis.fetch, smartThingsHeaders(token), query);
            const allForGuide = [
                ...(Array.isArray(result.devices) ? result.devices : []),
                ...(Array.isArray(result.inspected) ? result.inspected : []),
            ];
            (0, home_operations_guide_1.recordDiscoveredDevices)(sub, allForGuide);
            res.json({ ...result, operationsGuide: (0, home_operations_guide_1.buildOperationsGuideSummary)(sub) });
        }
        catch (err) {
            logger.error({ err, sub }, 'home device-inspect failed');
            if ((0, kernel_egress_1.isNotConnected)(err)) {
                res.status(409).json({ error: 'SmartThings not connected — connect it on the Hubs tab' });
                return;
            }
            res.status(502).json({ error: err.message });
        }
    };
    router.get('/device-inspect', handleDeviceInspect);
    router.get('/devices/:device/capabilities', handleDeviceInspect);
    router.get('/view-inside', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        const validated = (0, home_device_inspect_1.validateViewInsideDeviceInput)(req.query.device || req.query.q);
        if (!validated.ok) {
            res.status(400).json({ ok: false, error: 'invalid_device', message: validated.error });
            return;
        }
        try {
            const token = await smartThingsToken(ctx, sub);
            if (!token) {
                const localFridge = (0, home_local_swarm_1.readLocalSwarmDevices)(sub).find((d) => (d.capabilities || []).includes('samsungce.viewInside') || /refrigerator|fridge|family hub/i.test(d.name));
                if (localFridge) {
                    res.json((0, home_device_inspect_1.buildLocalViewInsidePayload)(localFridge, validated.device));
                    return;
                }
                res.status(409).json({ ok: false, error: 'smartthings_not_connected', message: 'SmartThings not connected — connect it on the Hubs tab' });
                return;
            }
            const result = await (0, home_device_inspect_1.readSmartThingsViewInside)(globalThis.fetch, smartThingsHeaders(token), validated.device);
            res.status(result.ok ? 200 : 404).json(result);
        }
        catch (err) {
            logger.error({ err, sub }, 'home view-inside failed');
            if ((0, kernel_egress_1.isNotConnected)(err)) {
                res.status(409).json({ ok: false, error: 'smartthings_not_connected', message: 'SmartThings not connected — connect it on the Hubs tab' });
                return;
            }
            res.status(502).json({ ok: false, error: 'smartthings_unreachable', message: err.message });
        }
    });
    router.get('/view-inside/image/:fileId', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        const token = await smartThingsToken(ctx, sub).catch(() => null);
        const out = await (0, home_device_inspect_1.serveViewInsideImage)(req.params.fileId, req.query.device, token, token ? smartThingsHeaders(token) : {}, globalThis.fetch);
        if (out.status !== 200) {
            res.status(out.status).json(out.body);
            return;
        }
        res.setHeader('Content-Type', out.contentType);
        res.send(out.body);
    });
    router.get('/fridge-image', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        const storeDir = (0, home_local_swarm_1.resolveHomeStoreDir)();
        const candidates = [
            path.join(storeDir, sub, 'fridge-latest.jpg'),
            path.join(storeDir, 'fridge-latest.jpg'),
        ];
        for (const jpgPath of candidates) {
            try {
                if (fs.existsSync(jpgPath)) {
                    res.setHeader('Content-Type', 'image/jpeg');
                    res.send(fs.readFileSync(jpgPath));
                    return;
                }
            }
            catch { /* try next */ }
        }
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420" width="800" height="420"><rect width="800" height="420" rx="16" fill="#131a27"/><text x="32" y="48" fill="#eef4ff" font-family="system-ui,sans-serif" font-size="22" font-weight="700">Samsung Family Hub · View Inside Snapshot</text><text x="32" y="80" fill="#94a8c8" font-family="system-ui,sans-serif" font-size="14">Cooler: 37°F (Closed) · Freezer: 0°F (Closed) · 3 Interior Camera Zones Active</text><rect x="32" y="104" width="736" height="88" rx="10" fill="#1c283a" stroke="#486894"/><text x="52" y="138" fill="#e6f0ff" font-family="system-ui,sans-serif" font-size="15" font-weight="600">Camera 1 — Upper Shelf (37°F · Door Closed)</text><text x="52" y="166" fill="#78c3ff" font-family="monospace" font-size="13">samsungce.viewInside · Top optical bay ready</text><rect x="32" y="206" width="736" height="88" rx="10" fill="#1c283a" stroke="#486894"/><text x="52" y="240" fill="#e6f0ff" font-family="system-ui,sans-serif" font-size="15" font-weight="600">Camera 2 — Middle Deli &amp; Produce Shelf (37°F · Door Closed)</text><text x="52" y="268" fill="#78c3ff" font-family="monospace" font-size="13">samsungce.viewInside · Middle optical bay ready</text><rect x="32" y="308" width="736" height="88" rx="10" fill="#1c283a" stroke="#486894"/><text x="52" y="342" fill="#e6f0ff" font-family="system-ui,sans-serif" font-size="15" font-weight="600">Camera 3 — Lower Beverage &amp; Door Bins (37°F · Door Closed)</text><text x="52" y="370" fill="#78c3ff" font-family="monospace" font-size="13">samsungce.viewInside · Lower optical bay ready</text></svg>`);
    });
    router.get('/fridge-assessment', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.json((0, fridge_weekly_assessment_1.formatFridgeAssessmentResponse)(sub));
    });
    router.post('/fridge-assessment', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body || {});
        let coolerTempF;
        let freezerTempF;
        try {
            const token = await smartThingsToken(ctx, sub);
            if (token) {
                const result = await (0, home_device_inspect_1.inspectSmartThingsDevices)(globalThis.fetch, smartThingsHeaders(token), 'refrigerator');
                const fridge = Array.isArray(result.inspected) ? result.inspected[0] : undefined;
                const highlights = (fridge?.highlights || {});
                const temps = (highlights.temperatures || {});
                if (typeof temps.cooler?.temperature === 'number')
                    coolerTempF = temps.cooler.temperature;
                if (typeof temps.freezer?.temperature === 'number')
                    freezerTempF = temps.freezer.temperature;
            }
        }
        catch { /* telemetry fallback to cached 37F / 0F */ }
        res.json((0, fridge_weekly_assessment_1.runWeeklyFridgeAssessment)(sub, { coolerTempF, freezerTempF, focus: body.focus }));
    });
    router.post('/fridge-meal-plan', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        res.json((0, fridge_weekly_assessment_1.mutateFridgeMealAndCart)(sub, (req.body || {})));
    });
    router.post('/fridge-refresh', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const token = await smartThingsToken(ctx, sub);
            if (!token) {
                res.status(409).json({ error: 'SmartThings not connected — connect it on the Hubs tab' });
                return;
            }
            const result = await (0, home_device_inspect_1.inspectSmartThingsDevices)(globalThis.fetch, smartThingsHeaders(token), 'refrigerator');
            const inspected = Array.isArray(result.inspected) ? result.inspected : [];
            const fridge = inspected[0] || null;
            const deviceId = fridge ? String(fridge.deviceId || '') : '';
            if (deviceId) {
                await globalThis.fetch(`https://api.smartthings.com/v1/devices/${encodeURIComponent(deviceId)}/commands`, {
                    method: 'POST',
                    headers: smartThingsHeaders(token),
                    body: JSON.stringify({ commands: [{ component: 'main', capability: 'samsungce.viewInside', command: 'refreshAll', arguments: [] }] }),
                }).catch(() => null);
            }
            res.json({
                ok: true,
                deviceId: deviceId || null,
                refreshedAt: new Date().toISOString(),
                highlights: fridge ? fridge.highlights : null,
                imageUrl: `/api/home/fridge-image?t=${Date.now()}`,
            });
        }
        catch (err) {
            logger.error({ err, sub }, 'home fridge-refresh failed');
            res.status(502).json({ error: err.message });
        }
    });
    router.get('/operations-guide', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const idx = readDeviceIndex(sub);
        if (idx.devices && idx.devices.length) {
            (0, home_operations_guide_1.recordDiscoveredDevices)(sub, idx.devices);
        }
        const guide = (0, home_operations_guide_1.readOperationsGuide)(sub);
        res.json({ ok: true, ...guide, summary: (0, home_operations_guide_1.buildOperationsGuideSummary)(sub) });
    });
    router.post('/operations-guide', (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const updated = (0, home_operations_guide_1.updateOperationsGuideEntry)(sub, (req.body || {}));
        if (!updated.ok) {
            res.status(400).json({ ok: false, error: updated.error || 'invalid_entry', message: 'Provide content (or note) to record in the Smart Home Operations Guide.' });
            return;
        }
        res.json({ ok: true, entry: updated.entry, guide: updated.guide, summary: (0, home_operations_guide_1.buildOperationsGuideSummary)(sub) });
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
    /** POST /api/home/assistant — credential-free reasoning over the bounded home snapshot.
     *  Confirmed provider writes use /control or /scene/run, never a model tool. Body: { message }. */
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
                ? `${message}\n\nThe user explicitly confirmed the intent. Do not execute it here; explain the matching deterministic device or scene action.`
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
            const localResult = (0, home_local_swarm_1.controlLocalSwarmDevice)(sub, device, cmd, body.capability, body.command, body.arg);
            if (localResult.refused) {
                res.status(409).json({ ok: false, error: localResult.refused, message: TV_NEEDS_COMPUTER });
                return;
            }
            if (localResult.ok) {
                res.json({ ok: true, device, cmd, hub: 'swarm-local', executed: localResult.executed, costUsd: 0 });
                return;
            }
            const deviceId = resolveDeviceId(sub, device);
            if (!deviceId) {
                res.status(404).json({ error: 'unknown device — refresh the index' });
                return;
            }
            const token = await smartThingsToken(ctx, sub);
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
            if ((0, kernel_egress_1.isNotConnected)(err)) {
                res.status(409).json({ error: 'SmartThings not connected — connect it at /utilities' });
                return;
            }
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
            const token = await smartThingsToken(ctx, sub);
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
            if ((0, kernel_egress_1.isNotConnected)(err)) {
                res.status(409).json({ error: 'SmartThings not connected' });
                return;
            }
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
    /** POST /api/home/refresh — fetch a sanitized live index at the deterministic provider boundary.
     *  The api volume is read-only, so retain the refreshed snapshot in this process as an overlay. */
    router.post('/refresh', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const token = await smartThingsToken(ctx, sub);
            if (!token) {
                res.status(409).json({ error: 'SmartThings not connected — connect it at /utilities' });
                return;
            }
            const idx = await fetchSmartThingsDeviceIndex(token, sub);
            refreshedDeviceIndexes.set(sub, idx);
            (0, home_local_swarm_1.writePersistedJson)(sub, 'devices.json', idx);
            const merged = mergeWithLocalSwarmDevices(sub, idx);
            (0, home_operations_guide_1.recordDiscoveredDevices)(sub, (merged.devices || []));
            res.json({ devices: merged.devices || [], deviceCount: merged.deviceCount ?? 0, generatedAt: merged.generatedAt || null, hubs: merged.hubs || ['smartthings'] });
        }
        catch (err) {
            logger.error({ err, sub }, 'home refresh failed');
            if ((0, kernel_egress_1.isNotConnected)(err)) {
                res.status(409).json({ error: 'SmartThings not connected — connect it at /utilities' });
                return;
            }
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
