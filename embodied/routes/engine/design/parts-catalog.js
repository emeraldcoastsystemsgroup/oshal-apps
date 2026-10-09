"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the one reader of the bought-part rows this
 *                     |                             | package OWNS (parts-catalog.json, ADR-152 D1). The drone motors
 *                     |                             | and the arm servo were TypeScript literals, so Circuit Lab had to
 *                     |                             | restate their name, mass and price to describe the same parts and
 *                     |                             | a test had to chase the copies. The rows are data now: identity,
 *                     |                             | mass, price and a source line, plus the propulsion block (KV) or
 *                     |                             | the joint-drive block (stall, speed, case). parts-model.ts and
 *                     |                             | servos.ts build from them by id; another package reads the same
 *                     |                             | compiled JSON file as data. A missing or malformed row is this
 *                     |                             | package's own defect, so it throws at load naming the list, the
 *                     |                             | row and the field — never a default in its place.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.motorRow = motorRow;
exports.servoRow = servoRow;
const parts_catalog_json_1 = __importDefault(require("./parts-catalog.json"));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** A finite positive number at `key`, or a load error naming where it should have been. */
function positive(o, key, where) {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
        throw new Error(`parts-catalog.json ${where}.${key} must be a positive number`);
    return v;
}
/** A non-empty string at `key`, or a load error naming where it should have been. */
function text(o, key, where) {
    const v = o[key];
    if (typeof v !== 'string' || !v.trim())
        throw new Error(`parts-catalog.json ${where}.${key} is required`);
    return v;
}
/**
 * @description Find one row of one list and check its identity block.
 * @param list - The list the row lives in.
 * @param id - The row id.
 * @returns The raw row, its identity block checked.
 */
function rowById(list, id) {
    const data = parts_catalog_json_1.default;
    const rows = isObj(data) ? data[list] : undefined;
    if (!Array.isArray(rows))
        throw new Error(`parts-catalog.json has no ${list} list`);
    const row = rows.find((r) => isObj(r) && r.id === id);
    if (!isObj(row))
        throw new Error(`parts-catalog.json has no ${list} row ${id}`);
    const where = `${list}#${id}`;
    text(row, 'name', where);
    text(row, 'source', where);
    positive(row, 'massG', where);
    positive(row, 'approxUsd', where);
    return row;
}
/**
 * @description The motor row with this id: identity, mass, price, source and the propulsion block.
 * @param id - The motor row id (e.g. `2306-1800kv`).
 * @returns The checked row.
 */
function motorRow(id) {
    const row = rowById('motors', id);
    const where = `motors#${id}.propulsion`;
    if (!isObj(row.propulsion))
        throw new Error(`parts-catalog.json ${where} is required`);
    positive(row.propulsion, 'kv', where);
    return row;
}
/**
 * @description The servo row with this id: identity, mass, price, source and the joint-drive block.
 * @param id - The servo row id (e.g. `sts3215-12v`).
 * @returns The checked row.
 */
function servoRow(id) {
    const row = rowById('servos', id);
    const where = `servos#${id}.jointDrive`;
    const drive = row.jointDrive;
    if (!isObj(drive))
        throw new Error(`parts-catalog.json ${where} is required`);
    for (const key of ['stallKgCm', 'secondsPer60', 'splineOffsetMm', 'hornDiscMm'])
        positive(drive, key, where);
    text(drive, 'encoder', where);
    const body = drive.bodyMm;
    if (!Array.isArray(body) || body.length !== 3 || !body.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) {
        throw new Error(`parts-catalog.json ${where}.bodyMm must be three positive numbers`);
    }
    return row;
}
//# sourceMappingURL=parts-catalog.js.map