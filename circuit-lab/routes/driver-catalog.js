"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the shaft-driver catalog (catalog/drivers.json):
 *                     |                             | motors, servos and steppers with a nameplate that VALIDATES
 *                     |                             | against the part contract, the mass and price other packages
 *                     |                             | share, and a `source` line per row saying where each number
 *                     |                             | came from. Loaded once, refused loudly when a row drifts from
 *                     |                             | the contract; the surface and the concierge read the same list.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDriverCatalog = loadDriverCatalog;
exports.listDrivers = listDrivers;
const node_fs_1 = __importDefault(require("node:fs"));
const circuit_contract_1 = require("./circuit-contract");
const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
/**
 * @description Parse and validate the catalog file: every row a known driver type, an id, a name, a
 * mass, a price, a source line, and a nameplate the contract accepts (defaults fill the rest).
 * @param file - Path to catalog/drivers.json.
 * @returns The rows.
 */
function loadDriverCatalog(file) {
    const raw = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw.drivers))
        throw new circuit_contract_1.ContractError('catalog has no drivers list', 'drivers');
    const seen = new Set();
    return raw.drivers.map((row, i) => {
        const r = (row && typeof row === 'object' ? row : {});
        const field = `drivers[${i}]`;
        if (typeof r.id !== 'string' || !ID.test(r.id) || seen.has(r.id))
            throw new circuit_contract_1.ContractError('each row needs a unique kebab-case id', `${field}.id`);
        seen.add(r.id);
        if (typeof r.type !== 'string' || !circuit_contract_1.DRIVER_TYPES.includes(r.type))
            throw new circuit_contract_1.ContractError(`type must be one of ${circuit_contract_1.DRIVER_TYPES.join(', ')}`, `${field}.type`);
        for (const key of ['name', 'kind', 'source'])
            if (typeof r[key] !== 'string' || !r[key].trim())
                throw new circuit_contract_1.ContractError(`${key} is required`, `${field}.${key}`);
        for (const key of ['massG', 'approxUsd'])
            if (typeof r[key] !== 'number' || !(r[key] >= 0))
                throw new circuit_contract_1.ContractError(`${key} must be a number`, `${field}.${key}`);
        const nameplate = (0, circuit_contract_1.validateProps)(r.type, r.nameplate, field);
        const usedBy = Array.isArray(r.usedBy) ? r.usedBy.filter((u) => typeof u === 'string') : [];
        return { id: r.id, type: r.type, name: r.name, kind: r.kind, massG: r.massG, approxUsd: r.approxUsd, ...(typeof r.kv === 'number' ? { kv: r.kv } : {}), ...(typeof r.cells === 'number' ? { cells: r.cells } : {}), nameplate, source: r.source, usedBy };
    });
}
/** @description The rows of one driver type, or all of them. */
function listDrivers(rows, type) {
    return type ? rows.filter((r) => r.type === type) : rows;
}
