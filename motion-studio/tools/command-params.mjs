/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve native values in command forms whose catalog describes parameters without JSON types.
 */
import { isNativeNumber, parseNative } from './native-json.mjs';

/** @description Decode typed fields and untyped native JSON without rounding large identifiers.
 * @param {string} value Field contents. @param {string} type Catalog JSON type, or native.
 * @returns {unknown} The native parameter value.
 */
export function commandValue(value, type = 'native') {
  if (type === 'string') return value;
  try {
    const parsed = parseNative(value);
    if (type === 'native' || type === 'number' && (typeof parsed === 'number' || typeof parsed === 'bigint' || isNativeNumber(parsed))
      || type === 'integer' && (Number.isSafeInteger(parsed) || typeof parsed === 'bigint')
      || type === 'boolean' && typeof parsed === 'boolean'
      || type === 'array' && Array.isArray(parsed)
      || type === 'object' && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && !isNativeNumber(parsed)) return parsed;
  } catch {
    if (type === 'native' && !/^[\s]*[\[{"]/.test(value)) return value;
  }
  throw new Error('Enter a valid ' + (type === 'native' ? 'JSON value or plain text' : type) + '.');
}

/** @description Read the actual command form, leaving omitted optional parameters absent.
 * @param {Iterable<HTMLInputElement | HTMLTextAreaElement>} fields Parameter fields.
 * @returns {Record<string, unknown>} Values for the existing native command boundary.
 */
export function commandParams(fields) {
  return Object.fromEntries([...fields].filter(field => field.value !== '').map(field =>
    [field.name, commandValue(field.value, field.dataset.type)]));
}
