"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — what a person types to add or adjust a
 *                     |                             | printer, validated before anything is stored or any packet
 *                     |                             | leaves. HTTP hosts keep the original URL + API key rules. A
 *                     |                             | Bambu Lab printer is registered from its LAN address and access
 *                     |                             | code alone: its serial and model code are READ from the
 *                     |                             | printer's certificate (never typed), the access code is proven
 *                     |                             | by a real status session before the row exists, and the slice
 *                     |                             | profile starts from the nozzle the printer reports. A slice
 *                     |                             | profile is checked against the engine's own vocabulary.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The printer's certificate fingerprint is read with its identity
 *                     |                             | and pinned: the code is proven over a session that already
 *                     |                             | requires that certificate, and the row stores it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A host name is resolved before anything is dialled and refused
 *                     |                             | when any address it resolves to is loopback, unspecified or the
 *                     |                             | metadata address (names such as ip6-localhost would otherwise
 *                     |                             | pass the literal check). Later sessions are pinned to the
 *                     |                             | printer's certificate, so a re-resolution cannot swap the device.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.forbiddenAddress = forbiddenAddress;
exports.parseHttpPrinter = parseHttpPrinter;
exports.parseSliceProfile = parseSliceProfile;
exports.registerBambuPrinter = registerBambuPrinter;
exports.parseSettingsChange = parseSettingsChange;
const node_dns_1 = __importDefault(require("node:dns"));
const printer_adapters_1 = require("./engine/print/printer-adapters");
const bambu_lan_1 = require("./printing/bambu-lan");
const slicer_engine_1 = require("./printing/slicer-engine");
const defaultLookup = async (host) => (await node_dns_1.default.promises.lookup(host, { all: true })).map((entry) => entry.address);
/**
 * @description Whether an address is one a printer registration must never dial.
 * @param address - IPv4 or IPv6 literal.
 * @returns True for loopback, unspecified and the cloud-metadata address.
 */
function forbiddenAddress(address) {
    const a = address.toLowerCase().replace(/^::ffff:/, '');
    return a.startsWith('127.') || a === '0.0.0.0' || a === '::' || a === '::1' || a === '169.254.169.254' || a === 'fd00:ec2::254';
}
/** @description Refuse a host whose name resolves to a forbidden address (literals were already checked). */
async function assertDialable(host, lookup) {
    let addresses;
    try {
        addresses = await lookup(host);
    }
    catch {
        throw new RangeError(`the printer address ${host} does not resolve on this network`);
    }
    if (!addresses.length || addresses.some(forbiddenAddress))
        throw new RangeError('loopback and metadata addresses are refused');
}
/** @description The label every printer needs. */
function labelOf(body) {
    const label = String(body.label ?? '').trim().slice(0, 80);
    if (!label)
        throw new RangeError('label is required');
    return label;
}
/**
 * @description Validate an HTTP host registration (OctoPrint / Moonraker / PrusaLink).
 * @param body - Request body.
 * @returns The draft.
 * @throws RangeError with the reason.
 */
function parseHttpPrinter(body) {
    const kind = String(body.kind ?? '');
    const secret = String(body.apiKey ?? '').trim();
    if (!printer_adapters_1.PRINTER_KINDS.includes(kind) || kind === printer_adapters_1.BAMBU_KIND)
        throw new RangeError(`kind must be one of ${printer_adapters_1.PRINTER_KINDS.join(', ')}`);
    if (!secret || secret.length > 512)
        throw new RangeError('apiKey is required');
    const url = (0, printer_adapters_1.validatePrinterBaseUrl)(String(body.baseUrl ?? ''));
    if (!url.ok)
        throw new RangeError(`baseUrl: ${url.reason}`);
    return { label: labelOf(body), kind: kind, baseUrl: url.url, secret };
}
/**
 * @description Validate a slice profile against the engine's vocabulary. Absent fields stay absent.
 * @param raw - `{ nozzle?, filament?, plate? }`.
 * @returns The cleaned profile.
 * @throws RangeError with the reason.
 */
function parseSliceProfile(raw) {
    if (raw === undefined || raw === null)
        return {};
    if (typeof raw !== 'object' || Array.isArray(raw))
        throw new RangeError('sliceProfile must be an object');
    const body = raw;
    const out = {};
    if (body.nozzle !== undefined) {
        const nozzle = String(body.nozzle);
        if (!slicer_engine_1.BAMBU_NOZZLES.includes(nozzle))
            throw new RangeError(`nozzle must be one of ${slicer_engine_1.BAMBU_NOZZLES.join(', ')}`);
        out.nozzle = nozzle;
    }
    if (body.filament !== undefined) {
        const filament = String(body.filament).trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9 +.()/-]{0,79}$/.test(filament))
            throw new RangeError('filament must be a filament profile name such as "Bambu PLA Basic"');
        out.filament = filament;
    }
    if (body.plate !== undefined && body.plate !== null && body.plate !== '') {
        const plate = String(body.plate);
        if (!slicer_engine_1.BAMBU_PLATES.includes(plate))
            throw new RangeError(`plate must be one of ${slicer_engine_1.BAMBU_PLATES.join(', ')}`);
        out.plate = plate;
    }
    return out;
}
/**
 * @description Register a Bambu Lab printer: validate the address and code, read the printer's
 * identity from its certificate, and prove the code with a real status session.
 * @param body - `{ label, host, accessCode, modelId?, sliceProfile? }`.
 * @param io - Socket and name-resolution seams.
 * @returns The draft.
 * @throws RangeError with a reason the person can act on.
 */
async function registerBambuPrinter(body, io = {}) {
    const label = labelOf(body);
    const host = (0, printer_adapters_1.validateBambuHost)(String(body.host ?? ''));
    if (!host.ok)
        throw new RangeError(`host: ${host.reason}`);
    await assertDialable(host.host, io.lookup ?? defaultLookup);
    const accessCode = String(body.accessCode ?? '').trim();
    if (!/^[A-Za-z0-9]{4,32}$/.test(accessCode))
        throw new RangeError('accessCode is the LAN access code from the printer screen (letters and digits)');
    const sliceProfile = parseSliceProfile(body.sliceProfile);
    const identity = await (0, bambu_lan_1.probeBambuPrinter)(host.host, io);
    if (!identity.ok)
        throw new RangeError(identity.message);
    const modelId = identity.modelId ?? (typeof body.modelId === 'string' && /^[A-Z0-9-]{1,16}$/.test(body.modelId) ? body.modelId : null);
    if (!modelId)
        throw new RangeError('could not read the printer model from its certificate; choose the model and try again');
    const status = await (0, bambu_lan_1.bambuStatus)({ host: host.host, serial: identity.serial, certSha256: identity.certSha256, accessCode, modelId }, io);
    if (!status.ok)
        throw new RangeError(status.message);
    if (!sliceProfile.nozzle && status.state.nozzle && slicer_engine_1.BAMBU_NOZZLES.includes(status.state.nozzle))
        sliceProfile.nozzle = status.state.nozzle;
    return { label, kind: printer_adapters_1.BAMBU_KIND, baseUrl: host.baseUrl, secret: accessCode, deviceSerial: identity.serial, deviceModel: modelId, deviceCertSha256: identity.certSha256, sliceProfile };
}
/**
 * @description Validate a settings change. Turning auto-start ON is a standing permission for
 * service-sent jobs to start a physical machine, so it needs the explicit confirmation flag.
 * @param body - `{ autoStart?, sliceProfile?, confirm? }`.
 * @returns The change, or `needsConfirm` when auto-start is being enabled without `confirm: true`.
 * @throws RangeError with the reason.
 */
function parseSettingsChange(body) {
    if (body.autoStart !== undefined && typeof body.autoStart !== 'boolean')
        throw new RangeError('autoStart must be true or false');
    const autoStart = typeof body.autoStart === 'boolean' ? body.autoStart : null;
    const sliceProfile = body.sliceProfile === undefined ? null : parseSliceProfile(body.sliceProfile);
    if (autoStart === null && sliceProfile === null)
        throw new RangeError('nothing to change: send autoStart and/or sliceProfile');
    return { autoStart, sliceProfile, needsConfirm: autoStart === true && body.confirm !== true };
}
//# sourceMappingURL=printer-registration.js.map