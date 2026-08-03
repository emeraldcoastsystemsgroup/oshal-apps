/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — one number formatter for every text exporter.
 *                     |                             | Three things bite CAD text formats and all three are handled
 *                     |                             | here once: JavaScript's `-0` (which some slicers read as a NaN
 *                     |                             | sentinel), exponent notation (which DXF R12 readers reject),
 *                     |                             | and unbounded decimal tails (which triple the file size for
 *                     |                             | digits that are below any printer's resolution).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The mesh formatter is now SIGNIFICANT-digit, not decimal-place.
 *                     |                             | Entry 1's "a micron at millimetre scale" reasoning assumed the
 *                     |                             | part arrives in millimetres; `bladeToMesh` emits METRES, where
 *                     |                             | six decimals is a 1 µm grid — coarser than the cosine-clustered
 *                     |                             | leading-edge spacing of a small blade. Distinct vertices were
 *                     |                             | landing on the same grid point, so toStlAscii/toObj/toOpenScad
 *                     |                             | welded them and emitted zero-area facets (and, in SCAD, a
 *                     |                             | polyhedron face naming one point twice — the exact CGAL
 *                     |                             | "not a valid 2-manifold" this slice claims to prevent) while
 *                     |                             | validateMesh, which runs on the un-quantised doubles, reported
 *                     |                             | `degenerate: 0`. Twelve significant digits is scale-free: it
 *                     |                             | resolves a 0.1 mm chord and a 100 m blade to the same relative
 *                     |                             | precision, and it still never emits exponent notation.
 */

/** @description Default significant decimals — a micron at millimetre scale, below any printer. */
export const DEFAULT_DECIMALS = 6;

/**
 * @description Default significant digits for mesh coordinates. Twelve is comfortably inside
 * double precision (~15–17 digits) so rounding is stable, and comfortably beyond float32 (~7), so
 * the text formats never carry LESS geometry than the binary STL of the same mesh.
 */
export const DEFAULT_SIGNIFICANT_DIGITS = 12;

/** @description Largest magnitude `toFixed` can still expand without falling back to exponents. */
const MAX_PLAIN_MAGNITUDE = 1e21;

/**
 * @description Reject values a CAD file cannot represent. Called before every write so a NaN
 * introduced by a bad transform is caught at export rather than becoming a silent hole in the
 * part.
 * @param value - Number to check.
 * @param label - What the number is, for the error message.
 * @returns The value, unchanged.
 * @throws RangeError when the value is NaN or infinite.
 */
export function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite for export, received ${String(value)}`);
  }
  return value;
}

/**
 * @description Render a number in plain decimal, expanding the exponent notation `String()` reaches
 * for below 1e-6. A CAD text format is read by parsers that predate — or simply do not implement —
 * exponents, so `1e-7` is a coordinate some readers drop and others read as 1.
 * @param value - Already-rounded number.
 * @param significant - Significant digits the value was rounded to.
 * @returns A plain decimal string with no trailing zeros.
 */
function plainDecimal(value: number, significant: number): string {
  const direct = String(value);
  if (!direct.includes('e') && !direct.includes('E')) return direct;
  if (Math.abs(value) >= MAX_PLAIN_MAGNITUDE) return value.toFixed(0);
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.min(100, Math.max(0, significant - 1 - exponent));
  return value.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * @description Format for a text CAD file: rounded to significant digits, trailing zeros dropped,
 * never `-0`, never exponent notation.
 *
 * Rounding is RELATIVE by default, which is the property the mesh exporters need — an absolute
 * decimal grid welds distinct vertices together whenever the part is smaller than the grid is
 * coarse, and a welded vertex is a zero-area facet in the emitted file that no check on the
 * un-quantised mesh can see. Pass `decimals` explicitly to get the old absolute behaviour, which
 * is what the DXF writer's fixed-format sibling wants.
 * @param value - Number to format.
 * @param decimals - Absolute decimal places to round to. Omit for relative rounding to
 * {@link DEFAULT_SIGNIFICANT_DIGITS} significant digits.
 * @returns A plain decimal string.
 * @throws RangeError when the value is not finite.
 */
export function formatFloat(value: number, decimals?: number): string {
  assertFinite(value, 'Coordinate');
  if (value === 0) return '0';
  if (decimals !== undefined) {
    const fixed = Number(value.toFixed(decimals));
    return String(Object.is(fixed, -0) ? 0 : fixed);
  }
  const rounded = Number(value.toPrecision(DEFAULT_SIGNIFICANT_DIGITS));
  if (rounded === 0) return '0';
  return plainDecimal(rounded, DEFAULT_SIGNIFICANT_DIGITS);
}

/**
 * @description Format with the decimal places KEPT. DXF group values are parsed by fixed-format
 * readers that are happier with `1.000000` than with `1`, so the DXF writer pays the extra bytes.
 * @param value - Number to format.
 * @param decimals - Decimal places to emit. Default {@link DEFAULT_DECIMALS}.
 * @returns A fixed-width decimal string.
 * @throws RangeError when the value is not finite.
 */
export function formatFixed(value: number, decimals: number = DEFAULT_DECIMALS): string {
  assertFinite(value, 'Coordinate');
  const safe = Object.is(value, -0) ? 0 : value;
  return safe.toFixed(decimals);
}
