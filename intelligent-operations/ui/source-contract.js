/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Validate the bounded Operations JSON alert profile locally without authenticating, persisting or dispatching it.
 */
(function (root) {
  'use strict';
  const SCHEMA = 'urn:oshal:operations:alert:1';
  const MAX_BYTES = 65536;
  const KINDS = ['host', 'aws-resource', 'azure-resource', 'gcp-resource', 'kubernetes-pod', 'container', 'workload'];
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clean = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
  function absoluteUri(value) {
    if (!clean(value, 512) || /\s/u.test(value)) return false;
    try { const url = new URL(value); return Boolean(url.protocol) && !url.username && !url.password; } catch { return false; }
  }
  function timestamp(value) {
    if (typeof value !== 'string' || value.length > 64) return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!m) return false;
    const [year,month,day,hour,minute,second] = m.slice(1,7).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
    if (month < 1 || month > 12 || day < 1 || day > days[month-1] || hour > 23 || minute > 59 || second > 59) return false;
    if (m[7] !== 'Z' && (Number(m[7].slice(1,3)) > 23 || Number(m[7].slice(4)) > 59)) return false;
    return Number.isFinite(Date.parse(value));
  }
  function validate(input, expectedSource) {
    const errors = [];
    if (typeof input !== 'string' || input.length > MAX_BYTES || new TextEncoder().encode(input).length > MAX_BYTES) {
      return { ok: false, errors: [{ path: '$', message: 'Use one JSON alert no larger than 64 KiB.' }] };
    }
    let event;
    try { event = JSON.parse(input); } catch {
      return { ok: false, errors: [{ path: '$', message: 'Enter a valid JSON object.' }] };
    }
    if (!plain(event)) return { ok: false, errors: [{ path: '$', message: 'Enter one alert object, not a batch or primitive.' }] };
    const check = (condition, path, message) => { if (!condition) errors.push({ path, message }); };
    check(event.specversion === '1.0', 'specversion', 'Use CloudEvents specversion 1.0.');
    check(clean(event.id, 256), 'id', 'Provide a nonempty event ID of at most 256 characters without padding or control characters.');
    check(absoluteUri(event.source), 'source', 'Provide an absolute source URI without embedded credentials or whitespace.');
    if (expectedSource) {
      check(absoluteUri(expectedSource), 'expectedSource', 'The expected source must be an absolute URI.');
      check(event.source === expectedSource, 'source', 'The payload source must exactly match the expected source.');
    }
    check(clean(event.type, 256), 'type', 'Provide the event type.');
    check(timestamp(event.time), 'time', 'Provide a real RFC 3339 date and time, with a timezone and seconds from 00 to 59.');
    check(event.dataschema === SCHEMA, 'dataschema', 'Use the Operations alert v1 schema URI.');
    check(event.datacontenttype === 'application/json', 'datacontenttype', 'Use application/json.');
    check(!Object.hasOwn(event, 'data_base64'), 'data_base64', 'This profile accepts JSON data, not base64 data.');
    const data = plain(event.data) ? event.data : {};
    check(plain(event.data), 'data', 'Provide an alert data object.');
    check(clean(data.environment, 128), 'data.environment', 'Provide an environment identifier.');
    check(clean(data.alertType, 256), 'data.alertType', 'Provide a stable alert type, separate from its message.');
    check(['info', 'warning', 'critical'].includes(data.severity), 'data.severity', 'Use info, warning or critical.');
    check(['firing', 'resolved'].includes(data.status), 'data.status', 'Use firing or resolved.');
    const resource = plain(data.resource) ? data.resource : {};
    check(plain(data.resource), 'data.resource', 'Provide a resource identity object.');
    check(KINDS.includes(resource.kind), 'data.resource.kind', 'Use a supported resource kind.');
    check(clean(resource.id, 512), 'data.resource.id', 'Provide a stable native resource ID.');
    check(clean(resource.scope, 512), 'data.resource.scope', 'Provide the account, project, cluster or site scope of that resource.');
    if (errors.length) return { ok: false, errors };
    return {
      ok: true, errors: [],
      deliveryIdentity: [event.source, event.id],
      symptomIdentity: [event.source, data.environment, resource.kind, resource.scope, resource.id, data.alertType],
      resource: { kind: resource.kind, scope: resource.scope, id: resource.id },
    };
  }
  function example() {
    return { specversion: '1.0', id: 'example-event-001', source: 'urn:operations:source:local-lab',
      type: 'operations.alert', time: '2026-10-20T12:00:00Z', dataschema: SCHEMA, datacontenttype: 'application/json',
      data: { environment: 'local-lab', alertType: 'ContainerRestartLoop', severity: 'warning', status: 'firing',
        resource: { kind: 'container', scope: 'cluster/example-cluster', id: 'example-container-instance' } } };
  }
  const api = { validate, example, SCHEMA, MAX_BYTES, KINDS: Object.freeze(KINDS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OperationsSourceContract = api;
})(typeof window === 'undefined' ? globalThis : window);
