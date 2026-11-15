/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A stand-in for the kernel's route-backed tools, for the calendar meeting suites (1.4.0): a
 *   model's tool call is checked against the manifest's inputSchema the way the kernel's validator checks it before any card
 *   (oshal-kernel crates/packages/src/tool_schema.rs: type, required, enum, const, pattern, lengths, items, uuid format), its
 *   apiEndpoint is rendered (path and query placeholders, an absent optional query placeholder left out; crates/oshald/src/
 *   package_api_tools.rs render), a read runs at once, and an approval-held write becomes a held proposal that runs only when
 *   its person approves it, once (crates/api/src/tool_proposals.rs: single use).
 */
'use strict';
const { randomUUID } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value satisfies a declared schema, as the kernel checks it; the first broken rule, or null. */
function broken(schema, value, at = 'input') {
  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) return `${at} is not one of its values`;
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) return `${at} is not ${JSON.stringify(schema.const)}`;
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${at} is not an object`;
    for (const key of schema.required || []) if (!(key in value)) return `${at}.${key} is required`;
    for (const [key, child] of Object.entries(value)) {
      const spec = schema.properties?.[key];
      if (spec) { const bad = broken(spec, child, `${at}.${key}`); if (bad) return bad; }
      else if (schema.additionalProperties === false) return `${at}.${key} is not declared`;
    }
    return null;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return `${at} is not a list`;
    if ((schema.minItems != null && value.length < schema.minItems) || (schema.maxItems != null && value.length > schema.maxItems)) return `${at} has the wrong count`;
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) return `${at} repeats an item`;
    for (const [i, item] of value.entries()) { const bad = schema.items && broken(schema.items, item, `${at}[${i}]`); if (bad) return bad; }
    return null;
  }
  if (type === 'string') {
    if (typeof value !== 'string') return `${at} is not text`;
    const n = [...value].length;
    if ((schema.minLength != null && n < schema.minLength) || (schema.maxLength != null && n > schema.maxLength)) return `${at} has the wrong length`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${at} does not match its pattern`;
    if (schema.format === 'uuid' && !UUID.test(value)) return `${at} is not a uuid`;
    return null;
  }
  if (type === 'integer' || type === 'number') return typeof value === 'number' && (type === 'number' || Number.isInteger(value)) ? null : `${at} is not a number`;
  if (type === 'boolean') return typeof value === 'boolean' ? null : `${at} is not true or false`;
  return `${at} has an unknown type`;
}

/** The route and query a tool's apiEndpoint selects for an input; an absent optional query placeholder is left out. */
function render(tool, input) {
  const [method, target] = tool.executor.apiEndpoint.split(' ');
  const [path, query = ''] = target.split('?');
  const fill = (part) => part.replace(/\{input\.([A-Za-z0-9_]+)\}/g, (_, name) => encodeURIComponent(String(input[name])));
  const params = {};
  for (const pair of query.split('&').filter(Boolean)) {
    const [key, value] = pair.split('=');
    const m = /^\{input\.([A-Za-z0-9_]+)\}$/.exec(value);
    if (m && (input[m[1]] == null || input[m[1]] === '')) continue;
    params[key] = m ? String(input[m[1]]) : value;
  }
  return { method, path: fill(path), query: params };
}

/**
 * @description The kernel's route tools for one application: `use(name, input)` checks a model's call, runs a read or holds a
 * write as a proposal; `approve(id)` runs a held proposal once.
 * @param {object} manifest - The application's manifest.
 * @param {Function} dispatch - (method, path, query, body) => Promise<{status, body}>: the application's own routes.
 */
function routeTools(manifest, dispatch) {
  const held = new Map();
  async function use(name, input) {
    const tool = (manifest.tools || []).find((t) => t.name === name);
    if (!tool) return { refused: `${name} is not offered` };
    const bad = broken(tool.inputSchema, input);
    if (bad) return { refused: `the kernel refuses the call before any card: ${bad}` };
    const { method, path, query } = render(tool, input);
    if (tool.requiresApproval) {
      const id = randomUUID();
      held.set(id, { id, tool, input, method, path, query, pending: true });
      return { proposal: { id, toolName: tool.name, app: manifest.name, label: tool.displayName, cardText: tool.cardText, mode: 'ask', input, appName: manifest.displayName } };
    }
    return { observation: await dispatch(method, path, query, null) };
  }
  async function approve(id) {
    const row = held.get(id);
    if (!row || !row.pending) return { refused: 'This card was already used or has expired.' };
    row.pending = false;
    return dispatch(row.method, row.path, row.query, method(row) === 'GET' ? null : row.input);
  }
  const method = (row) => row.method;
  return { use, approve, held };
}

module.exports = { routeTools, broken, render };
