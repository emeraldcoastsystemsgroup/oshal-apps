"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 00:25:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — aero-lab routes
 *                     |                             | (BUILD_CONTRACT §2/§2a/§2b, sat-routes pattern):
 *                     |                             | GET /app + /app.js (bundled surface), GET
 *                     |                             | /capabilities (engine presence + feature flags,
 *                     |                             | honest 200 even when absent), POST /polar /evaluate
 *                     |                             | /screen /mission /export against the real aerosim
 *                     |                             | engine via the subprocess adapter, allow-listed
 *                     |                             | per-file export downloads, and the aero-designer
 *                     |                             | concierge POST /chat (drafts only — the human runs
 *                     |                             | the engine). No mocks anywhere: a missing engine or
 *                     |                             | module returns 503 capability_unavailable with the
 *                     |                             | reason; numbers only ever come from the engine.
 * 2026-08-03 03:20:00 | maintainer@emeraldcoastsystemsgroup.com | Integration fix: four sanity bounds were
 *                     |                             | TIGHTER than the engine's own published bounds, so
 *                     |                             | the route refused designs the engine accepts — the
 *                     |                             | opposite of this table's stated job. Measured against
 *                     |                             | the live capabilities payload: area_m2 20 vs engine
 *                     |                             | 195, battery_mass_kg 100 vs 500, fus_over_floor
 *                     |                             | [0.5,3] vs [0.25,8], buoyancy_fraction 0.95 vs 1.0.
 *                     |                             | The last one mattered most: f=1.00 is the pure-float
 *                     |                             | craft the persona ships as a validated design, and
 *                     |                             | the surface's own buoyancy slider ends at 1.0 — its
 *                     |                             | last notch 400'd before the engine ever ran. Widened
 *                     |                             | so the engine's bounds bind, which the live spec now
 *                     |                             | asserts field-by-field against published bounds.
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Serve the browser geometry helper as a
 *                     |                             | first-class package asset so the cockpit and
 *                     |                             | cross-runtime parity spec execute the exact
 *                     |                             | same JavaScript implementation.
 * 2026-09-11 01:40:00 | maintainer@emeraldcoastsystemsgroup.com | GET /capabilities reports the engine
 *                     |                             | transport (local venv or the package's engine
 *                     |                             | container), its address and the exact install
 *                     |                             | command; an absent or out-of-date container is a
 *                     |                             | 200 present:false with that reason, like a missing
 *                     |                             | venv — never a bare 503 the surface can't explain.
 * 2026-10-10 16:00:00 | maintainer@emeraldcoastsystemsgroup.com | On the native kernel (a scoped-document
 *                     |                             | pool and an intent port, no network) the adapter
 *                     |                             | reaches the engine through engine.exchange.
 * 2026-10-11 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Draft with AI drafts against the person's
 *                     |                             | own design. POST /chat validated an absent design
 *                     |                             | as {} and so told the model the defaults (the R7
 *                     |                             | Sweep Winner) were the current design; a partial
 *                     |                             | draft was filled from those defaults too. Now a
 *                     |                             | draft needs body.design, is merged over it, must
 *                     |                             | declare each changed field's direction in "moves"
 *                     |                             | (a draft that lowers battery mass while saying
 *                     |                             | raise it is withheld with the reason), and comes
 *                     |                             | back with its from/to changes. The reply's "say" is
 *                     |                             | taken from the last JSON object carrying one, so
 *                     |                             | deliberation around it is never shown. Guarded by
 *                     |                             | aero-lab/tests/aero-designer-chat.test.cjs.
 * 2026-10-12 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Draft with AI keeps the site and season
 *                     |                             | the person names. Asked for "a cloudy day at 47N in
 *                     |                             | October" it kept day 195 (midsummer) and answered
 *                     |                             | about day 195. namedMission() reads a named month,
 *                     |                             | season or latitude, the prompt states it as the
 *                     |                             | mission, and holdNamedMission() applies it to any
 *                     |                             | draft that kept another day, saying so. A whole
 *                     |                             | degree ("47N") names a band, so 47.6 already is it.
 *                     |                             | Guarded by aero-lab/tests/aero-designer-chat.test.cjs.
 * 2026-10-12 08:00:00 | maintainer@emeraldcoastsystemsgroup.com | The named month is the one the person
 *                     |                             | wrote, read where it appears: months were checked in
 *                     |                             | calendar order and any capitalised "May" counted, so
 *                     |                             | "May I get a craft ... October day" drafted day 135
 *                     |                             | under a reply about day 288. "May" now counts only as
 *                     |                             | a date ("in May", "3 May", "May 20"), and two named
 *                     |                             | months are stated without holding a day. Seasons
 *                     |                             | follow the hemisphere of the named (else current)
 *                     |                             | latitude: "winter at 35S" was held to day 355, which
 *                     |                             | is southern midsummer; it is now 172. Guarded by
 *                     |                             | aero-lab/tests/aero-designer-chat.test.cjs.
 * 2026-10-12 21:00:00 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: Draft with AI said "I have drafted
 *                     |                             | an increase in battery_mass_kg" or "I have updated the
 *                     |                             | site and season" while the reply carried no draft, so
 *                     |                             | no panel or Apply button appeared and nothing said
 *                     |                             | why. A reply that claims a draft or change but carries
 *                     |                             | none (no draft, one that changes nothing, one outside
 *                     |                             | the limits, or buoyancy without the hybrid capability)
 *                     |                             | ends with a note that nothing changed on the sliders
 *                     |                             | and why (withoutDraft). Guarded by
 *                     |                             | aero-lab/tests/aero-designer-chat.test.cjs.
 * 2026-10-12 23:30:00 | maintainer@emeraldcoastsystemsgroup.com | Sweep 11: a withheld draft (its direction
 *                     |                             | contradicted the advice) still said "I have increased
 *                     |                             | battery_mass_kg from 0.4 to 0.7 kg ... The engine will
 *                     |                             | judge this draft" above "No draft was offered". With no
 *                     |                             | draft offered, withoutChangeClaims() leaves out every
 *                     |                             | sentence or semicolon clause that claims a change or
 *                     |                             | speaks of the draft, in every branch (dropped, refused,
 *                     |                             | no design sent); advice is kept. Guarded by
 *                     |                             | aero-lab/tests/aero-designer-chat.test.cjs.
 * 2026-10-13 09:00:00 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: with a change claim cut out, the
 *                     |                             | clause after it opened a sentence in lower case
 *                     |                             | ("... the primary lever. the engine will judge ...").
 *                     |                             | sentenceStarts() capitalises a kept clause that starts a
 *                     |                             | sentence; identifiers stay as written. Guarded by
 *                     |                             | aero-lab/tests/aero-designer-chat.test.cjs.
 * 2026-10-13 12:00:00 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: "a cloudy day at 47N in October"
 *                     |                             | on a 47.6 design drafted day 288 and kept 47.6 (inside
 *                     |                             | the 47N band), and the reply read "Drafted for 47°N"
 *                     |                             | with nothing saying the draft holds 47.6. The status
 *                     |                             | line now names the latitude the draft keeps when the
 *                     |                             | person named a whole degree (keptLatitude). Guarded by
 *                     |                             | aero-lab/tests/aero-designer-chat.test.cjs.
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
exports.DESIGN_SANITY_BOUNDS = exports.DEFAULT_DESIGN = void 0;
exports.validateDesign = validateDesign;
exports.namedMission = namedMission;
exports.withoutChangeClaims = withoutChangeClaims;
exports.designChanges = designChanges;
exports.parseAeroDesignerEnvelope = parseAeroDesignerEnvelope;
exports.holdNamedMission = holdNamedMission;
exports.nativeExchange = nativeExchange;
exports.createAeroLabRoutes = createAeroLabRoutes;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const engine_adapter_1 = require("./engine-adapter");
const logger = (0, logger_1.createChildLogger)({ module: 'aero-lab-routes' });
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
const AERO_DESIGNER_AGENT_ID = 'b0ae0000-0000-0000-0000-000000000001';
/**
 * The frozen design-vector wire shape (§2a) with defaults from the engine's own proven
 * sweep winner — R7_winner_vector.json "v" block (min SOC 0.4366, usable 1.0586) plus
 * buoyancy_fraction 0 (pure fixed-wing unless the hybrid capability is live). Values are
 * rounded for readability; the engine re-validates authoritatively.
 */
exports.DEFAULT_DESIGN = {
    area_m2: 0.9, aspect_ratio: 12.0, taper_ratio: 0.57,
    twist_root_deg: 2.0, twist_tip_deg: -0.93, extra_CD0: 0.0059,
    battery_mass_kg: 2.04, pack_Wh_per_kg: 441.8,
    cell_eff: 0.29, pv_density: 0.296, pv_packing: 0.9,
    prop_max_W: 2102.7, prop_diameter_m: 0.498,
    payload_W: 4.57, payload_mass_kg: 0.244,
    altitude_m: 163.7, latitude_deg: -10.4, day_of_year: 90,
    fus_over_floor: 1.01,
    buoyancy_fraction: 0.0,
};
/**
 * Garbage-early sanity bounds per field: [min, max]. These reject nonsense before a
 * worker spawn; the ENGINE's published bounds (worker capabilities → bounds) are the
 * authority and are applied on top when cached. Source: the R7 sweep envelope widened
 * to physical-plausibility limits — deliberately loose so the engine's own bounds bind.
 */
exports.DESIGN_SANITY_BOUNDS = {
    area_m2: [0.01, 500], aspect_ratio: [2, 40], taper_ratio: [0.05, 1],
    twist_root_deg: [-10, 10], twist_tip_deg: [-10, 10], extra_CD0: [0, 0.1],
    battery_mass_kg: [0, 1000], pack_Wh_per_kg: [50, 1000],
    cell_eff: [0.05, 0.5], pv_density: [0.01, 5], pv_packing: [0.1, 1],
    prop_max_W: [10, 100_000], prop_diameter_m: [0.05, 5],
    payload_W: [0, 1000], payload_mass_kg: [0, 50],
    altitude_m: [0, 30_000], latitude_deg: [-90, 90], day_of_year: [1, 366],
    fus_over_floor: [0.1, 20], buoyancy_fraction: [0, 1],
};
/**
 * @description Validate + normalize a request's design vector: unknown fields rejected,
 * every known field present-or-defaulted, finite, inside the sanity bounds and (when the
 * worker's published bounds are cached) inside those too. Clamp nothing — reject.
 * @param raw - The request body's design value.
 * @param workerBounds - `bounds` from cached worker capabilities, when available.
 * @returns The full normalized vector, or the rejection reason.
 */
function validateDesign(raw, workerBounds) {
    if (raw === undefined || raw === null)
        return { error: 'design (object) is required' };
    if (typeof raw !== 'object' || Array.isArray(raw))
        return { error: 'design must be a JSON object' };
    const body = raw;
    for (const k of Object.keys(body)) {
        if (!(k in exports.DEFAULT_DESIGN))
            return { error: `unknown design field "${k}"` };
    }
    const design = {};
    for (const [field, dflt] of Object.entries(exports.DEFAULT_DESIGN)) {
        const v = body[field] === undefined ? dflt : Number(body[field]);
        if (!Number.isFinite(v))
            return { error: `design.${field} must be a finite number` };
        const [lo, hi] = exports.DESIGN_SANITY_BOUNDS[field];
        if (v < lo || v > hi)
            return { error: `design.${field}=${v} is outside sanity bounds [${lo}, ${hi}]` };
        const wb = workerBounds?.[field];
        if (Array.isArray(wb) && wb.length === 2 && Number.isFinite(Number(wb[0])) && Number.isFinite(Number(wb[1]))) {
            if (v < Number(wb[0]) || v > Number(wb[1])) {
                return { error: `design.${field}=${v} is outside engine bounds [${wb[0]}, ${wb[1]}]` };
            }
        }
        design[field] = v;
    }
    if (!Number.isInteger(design.day_of_year))
        return { error: 'design.day_of_year must be an integer (1–366)' };
    return { design };
}
/**
 * @description Resolve a surface file from the package's tools/ dir (ctx.appPackageDir
 * captured at factory time per D10), load-time env fallback, then relative to the built
 * routes/ dir (tests, local checks). Verbatim sat-routes pattern.
 * @param appPackageDir - This package's directory from the per-package context.
 * @param fileName - The bundled surface file.
 * @returns The first existing candidate path (or the last for sendFile's 404 path).
 */
function surfaceHtml(appPackageDir, fileName) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools', fileName) : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', fileName) : '',
        path.resolve(__dirname, '../tools', fileName),
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}
/** Serve one bundled surface file (resolved once per factory call). */
function serveFile(filePath) {
    return (_req, res) => {
        res.sendFile(filePath, (err) => {
            if (err) {
                logger.error({ err, filePath }, 'Failed to serve surface file');
                res.status(404).send('Page not found');
            }
        });
    };
}
/**
 * @description Map a typed engine failure to the frozen §2a status codes. Anything that
 * is not an AeroEngineError is a route bug — logged with stack, 500.
 * @param res - The response.
 * @param err - What the adapter threw.
 * @param what - Route label for logs.
 */
function engineErrorTo(res, err, what) {
    if (err instanceof engine_adapter_1.AeroEngineError) {
        switch (err.code) {
            case 'capability_unavailable':
                res.status(503).json({ error: err.message, code: 'capability_unavailable', reason: err.reason || err.message });
                return;
            case 'invalid_design':
                res.status(400).json({ error: err.message });
                return;
            case 'inadmissible_input':
                res.status(422).json({ error: err.message });
                return;
            case 'engine_timeout':
                res.status(504).json({ error: err.message });
                return;
            case 'engine_busy':
                res.status(503).json({ error: err.message });
                return;
            default:
                logger.error({ code: err.code, message: err.message }, `${what} engine error`);
                res.status(500).json({ error: err.message });
                return;
        }
    }
    logger.error({ err, stack: err?.stack }, `${what} failed`);
    res.status(500).json({ error: `${what} failed` });
}
/** Middle day of each month (non-leap year), the day a named month is drafted at. */
const MONTH_MID_DAY = {
    january: 15, february: 46, march: 74, april: 105, may: 135, june: 166,
    july: 196, august: 227, september: 258, october: 288, november: 319, december: 349,
};
/** Every month but May: the name alone is the month. */
const MONTH_NAME = /\b(january|february|march|april|june|july|august|september|october|november|december)\b/gi;
/** "May" is a month only as a date ("in May", "3 May", "May 20"), never "May I" or "it may". */
const MAY_AS_DATE = /\b(?:in|of|during|early|mid|late|through|until|by|\d{1,2}(?:st|nd|rd|th)?)[\s-]+may\b|\bmay\s+\d{1,2}(?:st|nd|rd|th)?\b/gi;
/** Named seasons in the engine's own preset days: [pattern, north day, south day, label]. */
const SEASON_DAY = [
    [/\bmid-?summer\b|\bsummer solstice\b/i, 195, 355, 'midsummer'],
    [/\bwinter solstice\b|\bmid-?winter\b|\bwinter\b/i, 355, 172, 'winter'],
    [/\bspring\b/i, 80, 266, 'spring'],
    [/\bautumn\b/i, 266, 80, 'autumn'],
    [/\bequinox\b/i, 80, 80, 'equinox'],
    [/\bsummer\b/i, 195, 355, 'summer'],
];
/**
 * @description The distinct months a message names, in the order it names them. Months
 * were checked in calendar order with any capitalised "May" counted, so "May I get a
 * craft ... October" was read as May; position decides now, and "May" counts only as a date.
 * @param message - The designer's message.
 * @returns Lower-case month names, first-named first, each once.
 */
function namedMonths(message) {
    const hits = [];
    for (const re of [MONTH_NAME, MAY_AS_DATE]) {
        const scan = new RegExp(re.source, re.flags);
        for (let m = scan.exec(message); m; m = scan.exec(message)) {
            const word = m[1] ? m[1].toLowerCase() : 'may';
            hits.push([m.index + m[0].toLowerCase().indexOf(word), word]);
        }
    }
    hits.sort((a, b) => a[0] - b[0]);
    return [...new Set(hits.map(([, month]) => month))];
}
/**
 * @description The latitude a message names ("47N", "10.4 S"), with its prompt words.
 * @param message - The designer's message.
 * @returns latitude_deg (south negative) and its words, or null when none is named.
 */
function namedLatitude(message) {
    const lat = /(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])\b/.exec(message);
    if (!lat || Number(lat[1]) > 90)
        return null;
    const value = Number(lat[1]) * (lat[2] === 'S' ? -1 : 1);
    const whole = Number.isInteger(Number(lat[1]));
    return {
        value,
        words: whole
            ? `latitude ${lat[1]}°${lat[2]} (latitude_deg ${value}; a current ${lat[1]}.x already is)`
            : `latitude ${lat[1]}°${lat[2]} (latitude_deg ${value})`,
    };
}
/**
 * @description Read the site and season the person names ("47N in October", "a Seattle
 * winter night"). Draft with AI kept day 195 (midsummer) for "a cloudy day at 47N in
 * October" and answered about day 195, so the named season is read here, told to the
 * model as the mission, and applied to its draft by the route. Two named months are
 * stated without a day (the route then holds none); a season takes the hemisphere of the
 * named latitude, else the current one, since southern winter is day 172, not 355.
 * @param message - The designer's message.
 * @param currentLatitude - The person's current latitude_deg, when a design was sent.
 * @returns The named day_of_year / latitude_deg (absent when not named) and their words.
 */
function namedMission(message, currentLatitude) {
    const out = { words: [] };
    const lat = namedLatitude(message);
    const months = namedMonths(message);
    const label = (m) => `${m[0].toUpperCase()}${m.slice(1)} (day_of_year ${MONTH_MID_DAY[m]})`;
    if (months.length === 1) {
        out.day_of_year = MONTH_MID_DAY[months[0]];
        out.words.push(label(months[0]));
    }
    else if (months.length > 1) {
        out.words.push(`more than one month: ${months.map(label).join(', ')}; keep CURRENT DESIGN's day_of_year unless they say which one`);
    }
    else {
        const south = (lat ? lat.value : Number(currentLatitude) || 0) < 0;
        const season = SEASON_DAY.find(([re]) => re.test(message));
        if (season) {
            out.day_of_year = south ? season[2] : season[1];
            out.words.push(`${season[3]} (day_of_year ${out.day_of_year}${south ? ', southern hemisphere' : ''})`);
        }
    }
    if (lat) {
        out.latitude_deg = lat.value;
        out.words.push(lat.words);
    }
    return out;
}
/**
 * @description Whether a design latitude is the one the person named: "47N" names the
 * whole degree, so 47.6 is already at it; "10.4S" names that exact value.
 * @param named - The named latitude_deg.
 * @param value - The design's latitude_deg.
 * @returns True when the value is the named latitude.
 */
function atNamedLatitude(named, value) {
    if (!Number.isInteger(named))
        return Math.abs(named - value) < 1e-6;
    return Math.sign(value || named) === Math.sign(named || value) && Math.trunc(Math.abs(value)) === Math.abs(named);
}
/**
 * @description Build the aero-designer turn prompt: live capability flags (so the bot
 * never drafts what the engine cannot run), the slider bounds, the user's current
 * vector, the short client-side history, and the strict say+draft output contract.
 * @param o - Message, history, and the context lines.
 * @returns The prompt string.
 */
function buildAeroDesignerPrompt(o) {
    const named = o.named && o.named.words.length
        ? `THE DESIGNER NAMED: ${o.named.words.join(', ')}. That site and season is the mission: draft those fields (with their "moves") unless CURRENT DESIGN already has them, and answer about that day, never another.`
        : '';
    const convo = o.history.slice(-8).map((h) => `${h.role === 'assistant' ? 'You' : 'Designer'}: ${h.content}`).join('\n');
    return [
        'You are the Aero Designer — the design-drafting brain of the Aero Lab. The user describes the craft they want; you produce a design-vector DRAFT. You never compute performance numbers: the validated aerosim engine is the only source of polars, SOC traces, and verdicts, and your drafts only reach it after the human presses Run. Never claim a design works — say the engine will judge it.',
        '',
        `ENGINE CAPABILITIES: ${o.capsLine}`,
        `SLIDER BOUNDS: ${o.boundsLine}`,
        `CURRENT DESIGN: ${o.currentLine}`,
        named,
        '',
        convo ? `CONVERSATION SO FAR:\n${convo}\n` : '',
        `Designer: ${o.message}`,
        '',
        'Reply with ONLY a JSON object, nothing around it, and no reasoning before or after it:',
        '{ "say": "your reply to the designer", "draft": { "battery_mass_kg": 0.5 }, "moves": { "battery_mass_kg": "up" } }',
        `Draft fields (only the ones you change, all numeric, inside the bounds): ${Object.keys(exports.DEFAULT_DESIGN).join(', ')}.`,
        '"moves" names every drafted field as "up" or "down" against CURRENT DESIGN, and must agree with what "say" advises.',
        'No draft to suggest → "draft": null. Never invent fields. buoyancy_fraction must stay 0 unless the capabilities line says hybrid true.',
    ].join('\n');
}
/** Shown instead of a reply whose envelope cannot be read, so raw model text never reaches the person. */
const UNREADABLE_REPLY = "I couldn't put that reply into the design form's words. Ask again.";
/** Why no draft was offered without the person's design. */
const NO_DESIGN_NOTE = 'No draft was offered: ask from the Aero Lab design form, which sends your current design, so a draft starts from it.';
/** Words in a reply that say it drafted or changed the design. */
const CLAIMS_CHANGE = /\b(?:drafted|draft (?:below|above|is ready)|(?:i(?:'ve| have)?|i'll|i will) (?:update|updated|change|changed|set|increase|increased|decrease|decreased|raise|raised|lower|lowered|adjust|adjusted|move|moved)|(?:has|have) been (?:updated|changed|set|adjusted))\b/i;
/** Said when a reply claims a draft or change that did not come with one. */
const NO_DRAFT_NOTE = 'No draft came with this reply, so nothing changed on your sliders. Ask again for a draft to apply.';
/** Words that speak of a draft or move as if one came with the reply ("the engine will judge this draft"). */
const SPEAKS_OF_DRAFT = /\b(?:this|the|my) (?:draft|move|change)\b/i;
/**
 * @description The reply without its sentences (and semicolon clauses) that claim a change or speak of a draft, for an
 * answer that offers no draft: "I have increased battery_mass_kg from 0.4 to 0.7 kg" must not stand beside a note that
 * nothing changed. Advice ("Raise the battery") is kept.
 * @param say - The model's reply text.
 * @returns The reply with those clauses left out (possibly empty).
 */
function withoutChangeClaims(say) {
    return say.split(/\n/).map((line) => sentenceStarts(line.split(/(?<=[.!?;])\s+/)
        .filter((part) => !CLAIMS_CHANGE.test(part) && !SPEAKS_OF_DRAFT.test(part)))
        .join(' ').replace(/;\s*$/, '.').trim())
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
/**
 * @description The kept clauses with a capital at each sentence start. A clause cut after its semicolon ("... is the primary
 * lever. I have increased it; the engine will judge ...") leaves the next one opening a sentence in lower case (sweep 12). A
 * clause that opens the line or follows a kept sentence end gets a capital when it starts with a plain word; an identifier
 * such as battery_mass_kg is left as written.
 * @param parts - The clauses kept from one line, in order.
 * @returns The same clauses, sentence starts capitalised.
 */
function sentenceStarts(parts) {
    return parts.map((part, i) => (i === 0 || /[.!?]$/.test(parts[i - 1]))
        ? part.replace(/^([a-z])(?=[a-z]*[\s,.!?;:]|[a-z]*$)/, (c) => c.toUpperCase()) : part);
}
/** A reply with no draft: its change claims left out, then the note saying why nothing changed. */
function joinNote(say, note) {
    const kept = note ? withoutChangeClaims(say) : say;
    return kept && note ? `${kept}\n\n${note}` : kept || note;
}
/**
 * @description A say-only answer. When a draft was dropped for a reason the reply says why; when the reply claims a draft or a
 * change that it does not carry, it says nothing changed on the sliders. Either way the reply's own claim of a change is left out.
 * @param say - The model's reply text.
 * @param reason - Why a draft that came was not offered, or undefined when none came.
 * @returns The answer with no draft.
 */
function withoutDraft(say, reason) {
    const note = reason ? `No draft was offered: ${reason}. Nothing changed on your sliders.` : CLAIMS_CHANGE.test(say) ? NO_DRAFT_NOTE : '';
    return { say: joinNote(say, note), draft: null, changes: [] };
}
/**
 * @description Every top-level balanced {...} span in a reply, in order; quoted strings are
 * respected so a brace inside a "say" does not end the object.
 * @param text - Raw model output.
 * @returns The candidate JSON object texts.
 */
function jsonObjectSpans(text) {
    const spans = [];
    let depth = 0;
    let start = -1;
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (quoted) {
            if (escaped)
                escaped = false;
            else if (c === '\\')
                escaped = true;
            else if (c === '"')
                quoted = false;
            continue;
        }
        if (c === '"' && depth > 0)
            quoted = true;
        else if (c === '{') {
            if (depth === 0)
                start = i;
            depth += 1;
        }
        else if (c === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0)
                spans.push(text.slice(start, i + 1));
        }
    }
    return spans;
}
/**
 * @description The reply's envelope: the LAST JSON object that parses and carries a string "say".
 * Deliberation the model wrote around it is discarded.
 * @param raw - Raw model output.
 * @returns The envelope, or null when the reply holds none.
 */
function findEnvelope(raw) {
    const spans = jsonObjectSpans(raw);
    for (let i = spans.length - 1; i >= 0; i -= 1) {
        try {
            const env = JSON.parse(spans[i]);
            if (env && typeof env === 'object' && !Array.isArray(env) && typeof env.say === 'string')
                return env;
        }
        catch { /* not this span */ }
    }
    return null;
}
/**
 * @description The fields a draft changes against the current design, with their direction.
 * @param current - The person's validated current design.
 * @param next - The validated merged draft.
 * @returns One entry per changed field.
 */
function designChanges(current, next) {
    return Object.keys(next).filter((field) => next[field] !== current[field])
        .map((field) => ({ field, from: current[field], to: next[field], move: next[field] > current[field] ? 'up' : 'down' }));
}
/**
 * @description Why a draft contradicts the direction the model declared, or null when every
 * changed field is declared and agrees.
 * @param changes - From designChanges.
 * @param moves - The envelope's "moves" map.
 * @returns A sentence for the person, or null.
 */
function directionConflict(changes, moves) {
    const declared = moves && typeof moves === 'object' && !Array.isArray(moves) ? moves : {};
    for (const c of changes) {
        const said = String(declared[c.field] ?? '').toLowerCase();
        if (said !== 'up' && said !== 'down')
            return `No draft was offered: it changed ${c.field} without saying which way. Ask again.`;
        if (said !== c.move) {
            return `No draft was offered: it would move ${c.field} ${c.move} (${c.from} to ${c.to}) while the advice moves it ${said}. Ask again.`;
        }
    }
    return null;
}
/**
 * @description Parse + validate the concierge envelope. Anything malformed degrades to
 * a say-only reply — a bad draft must never reach the sliders (§2b). A draft is merged over
 * the person's current design (never over the defaults), checked finite + in bounds with
 * nothing clamped, and offered only when every changed field's declared direction agrees.
 * @param raw - Raw model output.
 * @param hybridOk - Whether the hybrid capability is live (gates buoyancy_fraction > 0).
 * @param workerBounds - Engine-published bounds when cached.
 * @param current - The person's validated current design, or null when the request sent none.
 * @returns say, a validated full design draft or null, and the draft's changes.
 */
function parseAeroDesignerEnvelope(raw, hybridOk, workerBounds, current = null) {
    const env = findEnvelope(raw);
    if (!env)
        return { say: raw.includes('{') ? UNREADABLE_REPLY : raw.slice(0, 2000), draft: null, changes: [] };
    const say = String(env.say).slice(0, 4000) || 'No reply.';
    const d = env.draft;
    if (!d || typeof d !== 'object' || Array.isArray(d))
        return withoutDraft(say);
    if (!current)
        return { say: joinNote(say, NO_DESIGN_NOTE), draft: null, changes: [] };
    const validated = validateDesign({ ...current, ...d }, workerBounds);
    if ('error' in validated) {
        logger.warn({ error: validated.error }, 'concierge draft rejected — degrading to say-only');
        return withoutDraft(say, `it did not fit the design form (${validated.error})`);
    }
    if (validated.design.buoyancy_fraction > 0 && !hybridOk) {
        logger.warn({}, 'concierge drafted buoyancy without the hybrid capability — draft dropped');
        return withoutDraft(say, 'it used buoyancy, which this installation cannot model');
    }
    const changes = designChanges(current, validated.design);
    const conflict = directionConflict(changes, env.moves);
    if (conflict) {
        logger.warn({ changes }, 'concierge draft contradicts its declared direction — draft dropped');
        return { say: joinNote(say, conflict), draft: null, changes: [] };
    }
    return changes.length ? { say, draft: validated.design, changes } : withoutDraft(say);
}
/**
 * @description Hold a draft to the site and season the person named: a draft that kept
 * another day or latitude gets the named values (re-validated, changes recomputed), and
 * the reply says so. Without a draft, or without a current design, nothing changes.
 * @param result - parseAeroDesignerEnvelope's result.
 * @param named - From namedMission.
 * @param current - The person's validated current design, or null.
 * @param workerBounds - Engine-published bounds when cached.
 * @returns The result, with the named fields applied when a draft was offered.
 */
function holdNamedMission(result, named, current, workerBounds) {
    if (!result.draft || !current)
        return result;
    const fix = {};
    if (named.day_of_year !== undefined && result.draft.day_of_year !== named.day_of_year)
        fix.day_of_year = named.day_of_year;
    if (named.latitude_deg !== undefined && !atNamedLatitude(named.latitude_deg, result.draft.latitude_deg)) {
        fix.latitude_deg = named.latitude_deg;
    }
    const kept = fix.latitude_deg === undefined ? keptLatitude(named, result.draft.latitude_deg) : '';
    if (!Object.keys(fix).length)
        return kept ? { ...result, say: `${result.say}\n\n${kept}` } : result;
    const validated = validateDesign({ ...result.draft, ...fix }, workerBounds);
    if ('error' in validated)
        return result;
    const set = Object.entries(fix).map(([k, v]) => `${k} ${v}`).join(', ');
    return {
        say: `${result.say}\n\nSet to the site and season you named: ${set}.${kept ? ` ${kept}` : ''} The engine will judge it there when you press Run.`,
        draft: validated.design,
        changes: designChanges(current, validated.design),
    };
}
/**
 * @description The status line for a named whole-degree latitude the draft already sits in: "47N"
 * names the band, so a 47.6 design keeps 47.6, and the reply says the draft holds 47.6 rather than
 * leaving "Drafted for 47°N" to read as a latitude change.
 * @param named - From namedMission.
 * @param value - The draft's latitude_deg.
 * @returns The sentence, or '' when no latitude was named or the draft holds exactly the named one.
 */
function keptLatitude(named, value) {
    if (named.latitude_deg === undefined || value === named.latitude_deg || !Number.isFinite(value))
        return '';
    const deg = (v) => `${Math.abs(v)}°${v < 0 ? 'S' : 'N'}`;
    return `Latitude stays ${deg(value)}, inside the ${deg(named.latitude_deg)} you named.`;
}
/**
 * @description The native kernel's engine path, when this package runs inside its sandbox: the
 * pool is the kernel's scoped document store and the context carries the intent port.
 * @param ctx - The package context.
 * @returns The exchange function, or undefined off the native kernel.
 */
function nativeExchange(ctx) {
    const c = ctx;
    if (c?.pool?.storageModel !== 'kernel-scoped-documents' || typeof c.intent !== 'function')
        return undefined;
    const intent = c.intent;
    return async (request, timeoutMs) => (await intent('engine.exchange', { request, timeoutMs }));
}
/**
 * @description Build the /api/aero-lab router (frozen §2a API) over one engine adapter
 * (injectable for tests). Accepts EITHER the opts wrapper ({adapter?, ctx?}) OR a bare
 * AppContext (how the manifest-route-mounter invokes a packaged factory with
 * requiresContext) — sat-routes pattern verbatim. Auth is the manifest's
 * `requiresAuth: true` wrapping the whole mount; nothing here mounts elsewhere.
 * @param arg - Opts wrapper, or the AppContext itself.
 * @returns The router.
 */
function createAeroLabRoutes(arg = {}) {
    const isOpts = arg !== null && typeof arg === 'object' && ('adapter' in arg || 'ctx' in arg);
    const opts = isOpts ? arg : { ctx: arg };
    const appPackageDir = opts.ctx?.appPackageDir;
    const adapter = opts.adapter ?? new engine_adapter_1.AeroEngineAdapter({ appPackageDir, exchange: nativeExchange(opts.ctx) });
    const exports = new Map();
    const router = (0, express_1.Router)();
    // ── The bundled surface ────────────────────────────────────────────────────
    router.get('/app', serveFile(surfaceHtml(appPackageDir, 'aero-lab.html')));
    router.get('/geometry.js', serveFile(surfaceHtml(appPackageDir, 'aero-lab-geometry.js')));
    router.get('/app.js', serveFile(surfaceHtml(appPackageDir, 'aero-lab.js')));
    /** GET /capabilities — honest presence + per-module flags. 200 even when absent: the
     * surface's first paint renders these flags; absence is data, not an error. */
    router.get('/capabilities', (_req, res) => {
        void (async () => {
            const started = Date.now();
            const status = adapter.engineStatus();
            const engine = {
                present: status.present, transport: status.transport || 'local', engineAddr: status.engineAddr ?? null,
                installHint: status.installHint ?? null, engineDir: status.engineDir, python: status.python,
                venvOk: status.venvOk, version: null,
            };
            if (!status.present) {
                const reason = !status.venvOk
                    ? `engine venv not found (${status.python}) — set AERO_LAB_ENGINE_DIR / run engine/setup-venv`
                    : `engine worker script not found (${status.workerPath})`;
                res.json({ engine, capabilities: null, bounds: null, reason });
                return;
            }
            try {
                const caps = (await adapter.capabilities());
                engine.version = caps.engineVersion == null ? null : String(caps.engineVersion);
                if (caps.python)
                    engine.python = String(caps.python);
                if (engine.transport === 'container' && caps.engineDir)
                    engine.engineDir = String(caps.engineDir);
                logger.info({ durationMs: Date.now() - started, transport: engine.transport }, 'GET /capabilities done');
                res.json({ engine, capabilities: caps.capabilities ?? null, bounds: caps.bounds ?? null });
            }
            catch (err) {
                // An absent or out-of-date engine container is a box fact, reported like a missing venv:
                // 200 with present:false and the reason (which names the exact install command).
                if (err instanceof engine_adapter_1.AeroEngineError && err.code === 'capability_unavailable') {
                    engine.present = false;
                    logger.info({ durationMs: Date.now() - started, reason: err.reason }, 'GET /capabilities — engine unavailable');
                    res.json({ engine, capabilities: null, bounds: null, reason: err.reason || err.message });
                    return;
                }
                engineErrorTo(res, err, 'capabilities');
            }
        })();
    });
    /** Shared handler for the four design→engine commands (validate early, engine re-validates). */
    const runEngine = (cmd, req, res, extraArgs = {}) => {
        void (async () => {
            const started = Date.now();
            const caps = adapter.cachedCapabilities();
            const v = validateDesign((req.body || {}).design, caps?.bounds ?? null);
            if ('error' in v) {
                res.status(400).json({ error: v.error });
                return;
            }
            try {
                if (v.design.buoyancy_fraction > 0) {
                    const live = (await adapter.capabilities());
                    if (!live.capabilities?.hybrid) {
                        res.status(503).json({
                            error: 'buoyancy_fraction > 0 needs the hybrid buoyancy capability, which is not available',
                            code: 'capability_unavailable',
                            reason: 'hybrid module not importable in the engine tree (in-flight upgrade) — set buoyancy_fraction to 0',
                        });
                        return;
                    }
                }
                const result = await adapter.request(cmd, { design: v.design, ...extraArgs });
                logger.info({ cmd, durationMs: Date.now() - started }, `POST /${cmd} done`);
                if (cmd === 'export') {
                    const r = result;
                    const exportId = String(r.exportId || '');
                    const files = Array.isArray(r.files) ? r.files.map(String) : [];
                    if (!exportId || files.length === 0) {
                        res.status(500).json({ error: 'engine export returned no files' });
                        return;
                    }
                    exports.set(exportId, { dir: path.join(adapter.workDir, 'exports', exportId), files });
                    res.json({ exportId, files });
                    return;
                }
                res.json(result);
            }
            catch (err) {
                engineErrorTo(res, err, cmd);
            }
        })();
    };
    /** POST /polar {design} — real wing polar via the engine. */
    router.post('/polar', (req, res) => runEngine('polar', req, res));
    /** POST /evaluate {design} — build + 24 h energy limit cycle + verdict. */
    router.post('/evaluate', (req, res) => runEngine('evaluate', req, res));
    /** POST /screen {design} — admissibility screen, reasons verbatim. */
    router.post('/screen', (req, res) => runEngine('screen', req, res));
    /** POST /mission {design, days?} — capability-gated multi-day mission (503 until the
     * in-flight mission module lands; the worker's feature detection is the gate). */
    router.post('/mission', (req, res) => {
        const rawDays = (req.body || {}).days;
        const days = rawDays === undefined ? 3 : Number(rawDays);
        if (!Number.isInteger(days) || days < 1 || days > 30) {
            res.status(400).json({ error: 'days must be an integer between 1 and 30' });
            return;
        }
        void (async () => {
            const caps = adapter.cachedCapabilities();
            const v = validateDesign((req.body || {}).design, caps?.bounds ?? null);
            if ('error' in v) {
                res.status(400).json({ error: v.error });
                return;
            }
            try {
                const result = await adapter.request('mission', { design: v.design, days });
                res.json(result);
            }
            catch (err) {
                engineErrorTo(res, err, 'mission');
            }
        })();
    });
    /** POST /export {design} — generate the build package; files download individually. */
    router.post('/export', (req, res) => runEngine('export', req, res));
    /** GET /export/:exportId/:file — stream one recorded file. `:file` is validated
     * against the export's recorded list — never path-joined raw (§2a). */
    router.get('/export/:exportId/:file', (req, res) => {
        const exportId = String(req.params.exportId);
        const file = String(req.params.file);
        const record = exports.get(exportId);
        if (!record) {
            res.status(404).json({ error: `unknown exportId "${exportId}"` });
            return;
        }
        if (!record.files.includes(file) || path.basename(file) !== file) {
            logger.warn({ exportId, file }, 'export download refused — not in the recorded file list');
            res.status(404).json({ error: `"${file}" is not a file of export "${exportId}"` });
            return;
        }
        const filePath = path.join(record.dir, file);
        res.download(filePath, file, (err) => {
            if (err && !res.headersSent) {
                logger.error({ err, filePath }, 'export download failed');
                res.status(404).json({ error: 'export file no longer on disk' });
            }
        });
    });
    /** POST /chat — the aero-designer concierge: drafts only; the human runs the engine. */
    router.post('/chat', (req, res) => {
        void (async () => {
            const started = Date.now();
            const message = String((req.body || {}).message || '').trim();
            if (!message) {
                res.status(400).json({ error: 'message is required' });
                return;
            }
            const orchestrator = opts.ctx?.orchestrator;
            if (!orchestrator) {
                res.status(503).json({ error: 'aero-designer concierge is not wired on this deployment' });
                return;
            }
            const history = Array.isArray((req.body || {}).history) ? req.body.history.slice(-8) : [];
            let caps = null;
            try {
                caps = (await adapter.capabilities());
            }
            catch (err) {
                logger.warn({ error: err.message }, 'capabilities unavailable for chat context — telling the bot');
            }
            const capsLine = caps?.capabilities ? JSON.stringify(caps.capabilities) : 'engine OFFLINE — every command will 503; draft anyway but say the engine cannot run it right now';
            const boundsLine = caps?.bounds ? JSON.stringify(caps.bounds) : JSON.stringify(exports.DESIGN_SANITY_BOUNDS);
            const sent = (req.body || {}).design;
            const current = sent && typeof sent === 'object' ? validateDesign(sent, caps?.bounds ?? null) : { error: 'no design sent' };
            const currentDesign = 'design' in current ? current.design : null;
            const currentLine = currentDesign ? JSON.stringify(currentDesign) : '(none sent: talk about the design space, and do not draft)';
            const named = namedMission(message, currentDesign?.latitude_deg);
            const prompt = buildAeroDesignerPrompt({ message, history, capsLine, boundsLine, currentLine, named });
            const sub = String(req.oidc?.user?.sub || 'operator');
            let raw = '';
            try {
                const result = await orchestrator.processMessage(`aero-${sub}-${started}`, prompt, {
                    agenticMode: true, autoApprove: false, source: 'aero-lab', agentId: AERO_DESIGNER_AGENT_ID, userSub: sub,
                });
                raw = String(result?.response || '').trim();
            }
            catch (err) {
                logger.error({ err, stack: err.stack }, 'aero-designer orchestrate failed');
            }
            const hybridOk = !!caps?.capabilities?.hybrid;
            const env = holdNamedMission(parseAeroDesignerEnvelope(raw, hybridOk, caps?.bounds ?? null, currentDesign), named, currentDesign, caps?.bounds ?? null);
            if (!raw)
                env.say = "I couldn't reach the design brain just now — try again in a moment.";
            logger.info({ hasDraft: !!env.draft, durationMs: Date.now() - started }, 'POST /chat done');
            res.json(env);
        })();
    });
    return router;
}
