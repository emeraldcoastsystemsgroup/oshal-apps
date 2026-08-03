"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — DXF R12 (AC1009) profile export. R12 is the
 *                     |                             | target on purpose: it is the most widely importable revision
 *                     |                             | there is, and every later revision adds structure (object
 *                     |                             | handles, class tables, LWPOLYLINE) that a hand-written writer
 *                     |                             | gets subtly wrong. The old-style POLYLINE/VERTEX/SEQEND triple
 *                     |                             | is verbose but it is what R12 readers expect; LWPOLYLINE does
 *                     |                             | not exist before R13 and silently drops the profile. Each
 *                     |                             | profile also gets a declared LAYER, because an entity on an
 *                     |                             | undeclared layer is where strict importers give up.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DXF_R12_VERSION = void 0;
exports.toDxfLayerName = toDxfLayerName;
exports.toDxfR12 = toDxfR12;
const logger_1 = require("@/shared/logger");
const format_number_1 = require("./format-number");
const log = (0, logger_1.createChildLogger)({ module: 'shared/geometry/export-dxf' });
/** @description R12's version string; the token importers key their parser off. */
exports.DXF_R12_VERSION = 'AC1009';
/** @description Layer name R12 always defines; the fallback when a section name sanitises away. */
const DEFAULT_LAYER = '0';
/**
 * @description Emit a group code and its value as the two lines DXF is made of. Every line in the
 * file goes through here so the strict "code line, value line" pairing cannot drift.
 * @param code - DXF group code.
 * @param value - The value line.
 * @returns The two lines.
 */
function group(code, value) {
    return [String(code), value];
}
/**
 * @description Coerce a section name into an R12 layer name: upper-case, and only the characters
 * R12 allows. R12 predates the relaxed naming of later revisions, so a space or a slash here is a
 * file some importers reject.
 * @param name - Requested name.
 * @param ordinal - Position, used when the name sanitises away entirely.
 * @returns A legal R12 layer name, at most 31 characters.
 */
function toDxfLayerName(name, ordinal) {
    const cleaned = name.trim().toUpperCase().replace(/[^A-Z0-9_$-]+/g, '_').replace(/^_+|_+$/g, '');
    if (cleaned.length === 0)
        return `SECTION_${ordinal}`;
    return cleaned.slice(0, 31);
}
/**
 * @description The LAYER table, declaring every layer the entities reference plus R12's layer 0.
 * @param layers - Layer names in use, already sanitised.
 * @returns The TABLES section lines.
 */
function tablesSection(layers) {
    const declared = [DEFAULT_LAYER, ...layers.filter((layer) => layer !== DEFAULT_LAYER)];
    const unique = [...new Set(declared)];
    const lines = [
        ...group(0, 'SECTION'),
        ...group(2, 'TABLES'),
        ...group(0, 'TABLE'),
        ...group(2, 'LAYER'),
        ...group(70, String(unique.length)),
    ];
    for (const layer of unique) {
        lines.push(...group(0, 'LAYER'), ...group(2, layer), ...group(70, '0'), ...group(62, '7'), ...group(6, 'CONTINUOUS'));
    }
    lines.push(...group(0, 'ENDTAB'), ...group(0, 'ENDSEC'));
    return lines;
}
/**
 * @description One profile as an R12 POLYLINE: the entity, its VERTEX list, and the SEQEND that
 * terminates it. The 66 flag ("vertices follow") is mandatory in R12 — without it a reader stops
 * at the POLYLINE and the profile arrives empty.
 * @param section - Profile to write.
 * @param layer - Sanitised layer name.
 * @returns The entity's lines.
 * @throws RangeError when a coordinate is not finite.
 */
function polylineEntity(section, layer) {
    const elevation = section.elevation ?? 0;
    const lines = [
        ...group(0, 'POLYLINE'),
        ...group(8, layer),
        ...group(66, '1'),
        ...group(10, (0, format_number_1.formatFixed)(0)),
        ...group(20, (0, format_number_1.formatFixed)(0)),
        ...group(30, (0, format_number_1.formatFixed)(elevation)),
        ...group(70, section.closed === false ? '0' : '1'),
    ];
    for (const point of section.points) {
        lines.push(...group(0, 'VERTEX'), ...group(8, layer), ...group(10, (0, format_number_1.formatFixed)(point.x)), ...group(20, (0, format_number_1.formatFixed)(point.y)), ...group(30, (0, format_number_1.formatFixed)(elevation)));
    }
    lines.push(...group(0, 'SEQEND'), ...group(8, layer));
    return lines;
}
/**
 * @description Serialise section profiles as a DXF R12 drawing — one POLYLINE per profile, on its
 * own named layer, at its own elevation. This is the 2-D companion to the solid exporters: it is
 * what goes to a laser cutter, a waterjet, or a draughtsman checking stations against a table,
 * none of which want a triangulated solid.
 * @param sections - Profiles to write, in drawing order. Points are emitted verbatim — no welding
 * and no reordering, so a caller's point count survives the round trip exactly.
 * @returns The complete `.dxf` text, newline-terminated.
 * @throws RangeError when a section has no points or a coordinate is not finite.
 */
function toDxfR12(sections) {
    const layers = sections.map((section, index) => toDxfLayerName(section.name, index));
    const entities = [];
    sections.forEach((section, index) => {
        if (section.points.length === 0) {
            throw new RangeError(`DXF section ${index} ("${section.name}") has no points`);
        }
        entities.push(...polylineEntity(section, layers[index]));
    });
    const lines = [
        ...group(0, 'SECTION'),
        ...group(2, 'HEADER'),
        ...group(9, '$ACADVER'),
        ...group(1, exports.DXF_R12_VERSION),
        ...group(9, '$INSBASE'),
        ...group(10, (0, format_number_1.formatFixed)(0)),
        ...group(20, (0, format_number_1.formatFixed)(0)),
        ...group(30, (0, format_number_1.formatFixed)(0)),
        ...group(0, 'ENDSEC'),
        ...tablesSection(layers),
        ...group(0, 'SECTION'),
        ...group(2, 'ENTITIES'),
        ...entities,
        ...group(0, 'ENDSEC'),
        ...group(0, 'EOF'),
    ];
    log.debug({ sections: sections.length, layers: new Set(layers).size, lines: lines.length }, 'wrote DXF R12');
    return `${lines.join('\n')}\n`;
}
