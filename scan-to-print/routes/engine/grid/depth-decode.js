"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (BACKLOG B1) — a real device's range image as a
 *                     |                             | `DepthMap`. Two encodings are accepted: little-endian float32
 *                     |                             | (NaN or +-Infinity = no return) and 16-bit unsigned integers,
 *                     |                             | the usual depth-PNG form, where 0 is the conventional "no
 *                     |                             | return". A `depthScale` turns stored units into millimetres, so a
 *                     |                             | device that writes metres or tenths of a millimetre needs no
 *                     |                             | conversion step. Everything a client sends is validated here,
 *                     |                             | in the engine, so the same refusals are exercised by plain node
 *                     |                             | and by the running route; decoding the PNG container itself is
 *                     |                             | the route's job (sharp), and hands this module plain integers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEPTH_UPLOAD_LIMITS = void 0;
exports.parseDepthHeader = parseDepthHeader;
exports.depthMapFromFloat32 = depthMapFromFloat32;
exports.depthMapFromUint16 = depthMapFromUint16;
const views_1 = require("./views");
/** @description Published bounds for an uploaded range image. */
exports.DEPTH_UPLOAD_LIMITS = Object.freeze({
    /** Largest image accepted, pixels (4096 x 4096; a phone depth frame is a few hundred on a side). */
    maxPixels: 16_777_216,
    /** Millimetres per stored unit. */
    depthScale: { default: 1, min: 1e-6, max: 1e6 },
    /** The accepted encodings. */
    formats: ['png16', 'f32le'],
});
/** @description A finite number from a multipart field (every field arrives as a string). */
function numberField(raw, key, fallback) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') {
        if (fallback !== undefined)
            return fallback;
        throw new RangeError(`Depth header field ${key} is required`);
    }
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n) || (typeof value === 'string' && value.trim() === ''))
        throw new RangeError(`Depth header field ${key} must be a finite number`);
    return n;
}
/**
 * @description Read and validate the header of a range-image upload.
 * @param raw - The multipart fields (or any object of the same shape).
 * @param size - The image size when the container carries it (PNG); must then agree with any sent.
 * @returns The validated header.
 * @throws RangeError naming the first field that is missing, malformed or out of bounds.
 */
function parseDepthHeader(raw, size) {
    const format = raw.format;
    if (!exports.DEPTH_UPLOAD_LIMITS.formats.includes(format))
        throw new RangeError(`Depth header field format must be one of ${exports.DEPTH_UPLOAD_LIMITS.formats.join(', ')}`);
    if (!(0, views_1.isViewName)(raw.view))
        throw new RangeError(`Depth header field view must be one of ${views_1.VIEW_NAMES.join(', ')}`);
    const width = size ? numberField(raw, 'width', size.width) : numberField(raw, 'width');
    const height = size ? numberField(raw, 'height', size.height) : numberField(raw, 'height');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
        throw new RangeError('Depth header width and height must be positive integers');
    if (size && (width !== size.width || height !== size.height))
        throw new RangeError(`Depth header says ${width}x${height} but the image is ${size.width}x${size.height}`);
    if (width * height > exports.DEPTH_UPLOAD_LIMITS.maxPixels)
        throw new RangeError(`Depth image exceeds ${exports.DEPTH_UPLOAD_LIMITS.maxPixels} pixels`);
    const mmPerPx = numberField(raw, 'mmPerPx');
    if (!(mmPerPx > 0))
        throw new RangeError('Depth header field mmPerPx must be positive');
    const bound = exports.DEPTH_UPLOAD_LIMITS.depthScale;
    const depthScale = numberField(raw, 'depthScale', bound.default);
    if (depthScale < bound.min || depthScale > bound.max)
        throw new RangeError(`Depth header field depthScale must be between ${bound.min} and ${bound.max}`);
    return {
        format: format, view: raw.view, width, height, mmPerPx, depthScale,
        uCenterPx: numberField(raw, 'uCenterPx'), vCenterPx: numberField(raw, 'vCenterPx'),
        uCenterMm: numberField(raw, 'uCenterMm', 0), vCenterMm: numberField(raw, 'vCenterMm', 0), planeMm: numberField(raw, 'planeMm'),
    };
}
/** @description The map shell every decoder fills. */
function emptyMap(h) {
    return {
        view: h.view, width: h.width, height: h.height, mmPerPx: h.mmPerPx, uCenterPx: h.uCenterPx, vCenterPx: h.vCenterPx,
        uCenterMm: h.uCenterMm, vCenterMm: h.vCenterMm, planeMm: h.planeMm, data: new Float32Array(h.width * h.height),
    };
}
/**
 * @description Decode a little-endian float32 range image. NaN and +-Infinity are no return; every
 * finite value (zero included: the surface may sit on the sensor plane) is a range.
 * @param bytes - Exactly `width x height x 4` bytes.
 * @param header - From {@link parseDepthHeader} with `format: 'f32le'`.
 * @returns The depth map, millimetres.
 * @throws RangeError when the byte count does not match the header.
 */
function depthMapFromFloat32(bytes, header) {
    if (bytes.length !== header.width * header.height * 4)
        throw new RangeError(`A ${header.width}x${header.height} float32 range image is ${header.width * header.height * 4} bytes, not ${bytes.length}`);
    const map = emptyMap(header);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < map.data.length; i += 1) {
        const value = view.getFloat32(i * 4, true);
        map.data[i] = Number.isFinite(value) ? value * header.depthScale : NaN;
    }
    return map;
}
/**
 * @description Decode 16-bit unsigned range values (a depth PNG's samples). 0 is no return, the
 * convention every 16-bit depth format shares; any other value is `value x depthScale` millimetres.
 * @param values - `width x height` samples, row-major.
 * @param header - From {@link parseDepthHeader} with `format: 'png16'`.
 * @returns The depth map, millimetres.
 * @throws RangeError when the sample count does not match the header.
 */
function depthMapFromUint16(values, header) {
    if (values.length !== header.width * header.height)
        throw new RangeError(`A ${header.width}x${header.height} 16-bit range image has ${header.width * header.height} samples, not ${values.length}`);
    const map = emptyMap(header);
    for (let i = 0; i < map.data.length; i += 1)
        map.data[i] = values[i] === 0 ? NaN : values[i] * header.depthScale;
    return map;
}
//# sourceMappingURL=depth-decode.js.map