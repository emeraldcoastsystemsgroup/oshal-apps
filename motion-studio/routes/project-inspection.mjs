/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Provide complete revision-pinned structural pages and exact string/key chunks within agent observation bounds.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve exact native numeric text and original authority across the updated transport.
 */
import {stringifyNative,isNativeNumber} from '../tools/native-json.mjs';
import { createHash } from 'node:crypto';
import { MotionError } from './project-store.mjs';
export const OBSERVATION_BYTES = 60 * 1024;
const CHILDREN = 64, STRING_UNITS = 4096;
const type = value => isNativeNumber(value)?'number':value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value==='bigint'?'integer':typeof value;
const keys = value => type(value) === 'object' ? Object.keys(value) : Array.isArray(value) ? value.map((_, index) => String(index)) : [];
const checked = value => {
  if (Buffer.byteLength(JSON.stringify(value)) > OBSERVATION_BYTES) throw new MotionError(413, 'motion_agent_observation_limit');
  return value;
};
function projectHeader(project) {
  const { id, title, revision, createdAt, updatedAt } = project;
  return { id, title, revision, createdAt, updatedAt };
}
export function projectReceipt(project) {
  const { id, revision } = project;
  return checked({ ...projectHeader(project),
    documentBytes: Buffer.byteLength(stringifyNative(project.document)), assets: project.assets,
    inspection: { tool: 'motion-inspect-project', id, revision, part: 'value', node: 'root', offset: 0 } });
}
export function exportReceipt(project) {
  const bytes = Buffer.from(stringifyNative(project.document));
  return checked({ project: projectReceipt(project), download: {
    url: '/api/motion-studio/projects/' + project.id + '/revisions/' + project.revision + '/export',
    revision: project.revision, filename: 'composition.ecproj', type: 'application/json',
    byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    requiresPermission: 'project.export', portableSources: false,
    // Pin download bytes to the same immutable revision as these receipts.
    immutableUrl: '/api/motion-studio/projects/' + project.id + '/revisions/' + project.revision + '/export',
  } });
}
function selected(document, node) {
  if (typeof node !== 'string' || node.length > 4096 || !/^(root|(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))*)$/.test(node)) throw new MotionError(400, 'motion_invalid_inspection_node');
  let value = document, key;
  if (node !== 'root') for (const token of node.split('.')) {
    const index = Number(token), names = keys(value);
    if (!Number.isSafeInteger(index) || index >= names.length) throw new MotionError(404, 'motion_inspection_node_not_found');
    key = names[index]; value = value[key];
  }
  return { value, key };
}
function stringChunk(value, offset) {
  if (offset > value.length) throw new MotionError(400, 'motion_invalid_inspection_offset');
  // Offsets are UTF-16 code units. Keep a valid surrogate pair together so each
  // JSON chunk remains valid Unicode; lone code units still round-trip exactly.
  if (offset > 0 && offset < value.length && /[\uDC00-\uDFFF]/.test(value[offset]) && /[\uD800-\uDBFF]/.test(value[offset - 1])) throw new MotionError(400, 'motion_invalid_inspection_offset');
  let end = Math.min(value.length, offset + STRING_UNITS);
  if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
  return { type: 'string', offsetUnit: 'utf16-code-units', offset, totalCodeUnits: value.length,
    text: value.slice(offset, end), complete: end === value.length, nextOffset: end < value.length ? end : null };
}
function descriptor(value, name, node) {
  const kind = type(value), result = { node, name: name.slice(0, 256), nameComplete: name.length <= 256, type: kind };
  if (kind === 'object' || kind === 'array') result.childCount = keys(value).length;
  else if (kind === 'string') {
    result.preview = value.slice(0, 128); result.totalCodeUnits = value.length;
    result.previewComplete = value.length <= 128;
  } else if(isNativeNumber(value)){result.value=value.literal;result.valueEncoding='json-number-literal';}else if(kind==='integer'){result.value=value.toString();result.valueEncoding='decimal-integer';}else result.value = value;
  return result;
}
/** Numeric child paths enumerate all original keys, including very long keys.
 * They are not filesystem paths or JSON pointer escapes. Always pin revision. */
export function inspectProject(project, { node = 'root', part = 'value', offset = 0 } = {}) {
  if (!['value', 'key'].includes(part) || !Number.isSafeInteger(offset) || offset < 0) throw new MotionError(400, 'motion_invalid_inspection_input');
  const found = selected(project.document, node);
  if (part === 'key' && found.key === undefined) throw new MotionError(400, 'motion_inspection_root_has_no_key');
  const value = part === 'key' ? found.key : found.value;
  const base = { project: projectHeader(project), node, part, type: type(value), offset };
  if (typeof value === 'string') return checked({ ...base, ...stringChunk(value, offset) });
  if (type(value) !== 'object' && !Array.isArray(value)) {
    if (offset !== 0) throw new MotionError(400, 'motion_invalid_inspection_offset');
    return checked({ ...base, value:isNativeNumber(value)?value.literal:typeof value==='bigint'?value.toString():value,...(isNativeNumber(value)?{valueEncoding:'json-number-literal'}:typeof value==='bigint'?{valueEncoding:'decimal-integer'}:{}), complete: true, nextOffset: null });
  }
  const names = keys(value);
  if (offset > names.length) throw new MotionError(400, 'motion_invalid_inspection_offset');
  const result = { ...base, offsetUnit: 'child-index', totalChildren: names.length, children: [], complete: false, nextOffset: offset };
  for (let index = offset; index < Math.min(names.length, offset + CHILDREN); index++) {
    const child = descriptor(value[names[index]], names[index], node === 'root' ? String(index) : node + '.' + index);
    result.children.push(child); result.nextOffset = index + 1;
    if (Buffer.byteLength(JSON.stringify(result)) > OBSERVATION_BYTES - 128) { result.children.pop(); result.nextOffset = index; break; }
  }
  if (result.nextOffset === names.length) { result.complete = true; result.nextOffset = null; }
  if (!result.complete && !result.children.length) throw new MotionError(413, 'motion_agent_observation_limit');
  return checked(result);
}

function metadataPage(rows, offset, field, extra) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length) throw new MotionError(400, 'motion_invalid_inspection_offset');
  const result = { ...extra, offset, total: rows.length, [field]: [], complete: false, nextOffset: offset };
  for (let index = offset; index < Math.min(rows.length, offset + CHILDREN); index++) {
    result[field].push(rows[index]); result.nextOffset = index + 1;
    if (Buffer.byteLength(JSON.stringify(result)) > OBSERVATION_BYTES - 128) { result[field].pop(); result.nextOffset = index; break; }
  }
  if (result.nextOffset === rows.length) { result.complete = true; result.nextOffset = null; }
  if (!result.complete && !result[field].length) throw new MotionError(413, 'motion_agent_observation_limit');
  return checked(result);
}
export function projectIndex(projects, stamp, offset) {
  if (typeof stamp !== 'string' || !/^(start|[0-9a-f]{64})$/.test(stamp) || (stamp === 'start' && offset !== 0)) throw new MotionError(400, 'motion_invalid_index_stamp');
  const rows = [...projects].sort((a, b) => a.id.localeCompare(b.id));
  const current = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  if (stamp !== 'start' && stamp !== current) throw new MotionError(409, 'motion_index_changed');
  return metadataPage(rows, offset, 'projects', { stamp: current });
}
export function revisionIndex(revisions, revision, offset) {
  if (!Number.isSafeInteger(revision) || !revisions.some(row => row.revision === revision)) throw new MotionError(404, 'motion_revision_not_found');
  const rows = revisions.filter(row => row.revision <= revision).sort((a, b) => a.revision - b.revision);
  return metadataPage(rows, offset, 'revisions', { throughRevision: revision });
}
