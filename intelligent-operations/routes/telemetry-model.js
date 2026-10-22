"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamConfiguration = streamConfiguration;
exports.normalizeTelemetry = normalizeTelemetry;
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Validate standard OTLP JSON logs/metrics and decoded CloudWatch subscriptions without guessing resource identities.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bound initial bank budgets and their explicitly configured growth ceilings.
 */
// @ts-nocheck
const intake_1 = require("./intake");
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const clean = (v, n = 512) => typeof v === 'string' && v.length > 0 && v.length <= n && v.trim() === v && !/[\x00-\x1f\x7f]/.test(v);
const kinds = ['host', 'aws-resource', 'azure-resource', 'gcp-resource', 'kubernetes-pod', 'container', 'workload'];
function streamConfiguration(input) {
    if (!input || !kinds.includes(input.resourceKind) || !clean(input.idAttribute, 128) || !clean(input.scopeAttribute, 128))
        fail(400, 'Choose a resource kind and explicit resource ID/scope attributes.');
    const bytes = input.maxBankBytes ?? 2097152, rows = input.maxBankRecords ?? 2000;
    if (!Number.isSafeInteger(bytes) || bytes < 16384 || bytes > 67108864 || !Number.isInteger(rows) || rows < 1 || rows > 2000)
        fail(400, 'Each bank needs 16 KiB–64 MiB and 1–2000 records.');
    const initialBytes = input.initialBankBytes ?? Math.min(65536, bytes), initialRows = input.initialBankRecords ?? Math.min(64, rows), autoGrow = input.autoGrow ?? true;
    if (!Number.isInteger(initialBytes) || initialBytes < 16384 || initialBytes > bytes || !Number.isInteger(initialRows) || initialRows < 1 || initialRows > rows || typeof autoGrow !== 'boolean')
        fail(400, 'Initial bank budgets must fit their ceilings; autoGrow must be explicit true or false.');
    const result = { resourceKind: input.resourceKind, idAttribute: input.idAttribute, scopeAttribute: input.scopeAttribute, maxBankBytes: bytes, maxBankRecords: rows, initialBankBytes: initialBytes, initialBankRecords: initialRows, autoGrow, retentionSeconds: 900 };
    if (input.retentionSeconds !== undefined && input.retentionSeconds !== 900)
        fail(400, 'This profile preserves a 900-second minimum after durable receipt.');
    if (input.cloudwatch) {
        const c = input.cloudwatch;
        if (!/^\d{12}$/.test(c.account) || !clean(c.region, 80) || !clean(c.logGroup) || !Array.isArray(c.streams) || !c.streams.length || c.streams.length > 32)
            fail(400, 'CloudWatch needs its exact account, region, log group and 1–32 mapped streams.');
        const seen = new Set();
        const streams = c.streams.map(s => { if (!s || !clean(s.stream) || !clean(s.id) || !clean(s.scope) || seen.has(s.stream))
            fail(400, 'CloudWatch stream mappings need unique names and explicit native resource IDs/scopes.'); seen.add(s.stream); return { stream: s.stream, id: s.id, scope: s.scope }; });
        result.cloudwatch = { account: c.account, region: c.region, logGroup: c.logGroup, streams };
    }
    return result;
}
function attributes(input) {
    if (!Array.isArray(input) || input.length > 64)
        fail(400, 'Use at most 64 OTLP attributes.');
    const result = {};
    for (const item of input) {
        if (!item || !clean(item.key, 128) || ['__proto__', 'constructor', 'prototype'].includes(item.key) || Object.hasOwn(result, item.key))
            fail(400, 'OTLP attribute names must be unique and bounded.');
        const value = item.value;
        if (!value || typeof value !== 'object' || Object.keys(value).length !== 1)
            fail(400, 'Use scalar OTLP attributes.');
        const [type, v] = Object.entries(value)[0];
        if (!['stringValue', 'intValue', 'doubleValue', 'boolValue'].includes(type) || !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'string' && v.length > 2048) || (typeof v === 'number' && !Number.isFinite(v)))
            fail(400, 'Unsupported or oversized OTLP attribute value.');
        if (type === 'stringValue' && typeof v !== 'string' || type === 'boolValue' && typeof v !== 'boolean' || type === 'doubleValue' && typeof v !== 'number' || type === 'intValue' && (typeof v !== 'string' || !/^[-]?\d+$/.test(v) || BigInt(v) < -9223372036854775808n || BigInt(v) > 9223372036854775807n))
            fail(400, 'OTLP scalar values must match their declared protobuf type.');
        result[item.key] = v;
    }
    return result;
}
function timestamp(ns) { if (typeof ns !== 'string' || !/^\d{1,20}$/.test(ns))
    fail(400, 'OTLP timeUnixNano must be a decimal string.'); const n = Number(BigInt(ns) / 1000000n); if (!Number.isSafeInteger(n) || n < 0 || n > 8640000000000000)
    fail(400, 'Invalid OTLP timestamp.'); return new Date(n).toISOString(); }
function point(source, config, resource, value, format) {
    const id = resource[config.idAttribute], scope = resource[config.scopeAttribute];
    if (!clean(id) || !clean(scope))
        fail(422, 'A resource is unmapped: supply its configured native ID and scope attributes.');
    const environment = resource['deployment.environment.name'];
    if (environment !== undefined && environment !== source.environment)
        fail(422, 'Telemetry environment differs from the registered source.');
    const record = { sourceId: source.id, source: source.source, environment: source.environment, resource: { kind: config.resourceKind, id, scope }, resourceAttributes: resource, format, ...value };
    if (Buffer.byteLength(JSON.stringify(record)) > 16384)
        fail(413, 'One normalized telemetry observation exceeds 16 KiB.');
    return { ...record, id: (0, intake_1.hash)(['telemetry-v1', source.source, value.externalId ?? (0, intake_1.hash)(record)]), payloadHash: (0, intake_1.hash)(record) };
}
function normalizeTelemetry(source, config, format, payload) {
    config = streamConfiguration(config);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Buffer.byteLength(JSON.stringify(payload)) > 65536)
        fail(413, 'Use one telemetry request of at most 64 KiB.');
    const result = [];
    const push = record => { result.push(record); if (result.length > 64)
        fail(413, 'A stream batch supports at most 64 observations.'); };
    if (format === 'cloudwatch') {
        const c = config.cloudwatch;
        if (!c)
            fail(409, 'Configure the CloudWatch source and stream identity mapping first.');
        if (payload.owner !== c.account || payload.logGroup !== c.logGroup)
            fail(422, 'CloudWatch account/log group differs from the registered source.');
        if (payload.messageType === 'CONTROL_MESSAGE')
            return [];
        const stream = c.streams.find(s => s.stream === payload.logStream);
        if (payload.messageType !== 'DATA_MESSAGE' || !stream || !Array.isArray(payload.logEvents) || !payload.logEvents.length)
            fail(422, 'CloudWatch data requires a mapped stream and logEvents.');
        for (const item of payload.logEvents) {
            if (!item || !clean(item.id, 256) || !Number.isSafeInteger(item.timestamp) || item.timestamp < 0 || item.timestamp > 8640000000000000 || typeof item.message !== 'string' || item.message.length > 8192)
                fail(400, 'Invalid CloudWatch log event.');
            push(point(source, config, { [config.idAttribute]: stream.id, [config.scopeAttribute]: stream.scope }, { externalId: item.id, observedAt: new Date(item.timestamp).toISOString(), signal: 'log', body: item.message, attributes: { 'aws.account.id': c.account, 'cloud.region': c.region, 'aws.log.group.names': c.logGroup, 'aws.log.stream.names': stream.stream } }, format));
        }
    }
    else if (format === 'otlp-logs' || format === 'otlp-metrics') {
        const groups = payload[format === 'otlp-logs' ? 'resourceLogs' : 'resourceMetrics'];
        if (!Array.isArray(groups) || !groups.length || groups.length > 64)
            fail(400, 'Use OTLP resourceLogs or resourceMetrics.');
        for (const group of groups) {
            const resource = attributes(group.resource?.attributes || []), scopes = group[format === 'otlp-logs' ? 'scopeLogs' : 'scopeMetrics'];
            if (!Array.isArray(scopes) || scopes.length > 64)
                fail(400, 'OTLP scope batches are required.');
            for (const scope of scopes) {
                if (format === 'otlp-logs') {
                    if (!Array.isArray(scope.logRecords))
                        fail(400, 'OTLP logRecords are required.');
                    for (const item of scope.logRecords) {
                        const a = attributes(item.attributes || []), body = item.body?.stringValue;
                        if (typeof body !== 'string' || body.length > 8192)
                            fail(400, 'This log profile accepts bounded stringValue bodies.');
                        if (item.severityNumber !== undefined && (!Number.isInteger(item.severityNumber) || item.severityNumber < 0 || item.severityNumber > 24))
                            fail(400, 'Invalid OTLP severityNumber.');
                        push(point(source, config, resource, { signal: 'log', observedAt: timestamp(item.timeUnixNano), body, attributes: a, severityNumber: item.severityNumber ?? 0, ...(clean(a['log.record.uid'], 256) ? { externalId: a['log.record.uid'] } : {}) }, format));
                    }
                }
                else {
                    if (!Array.isArray(scope.metrics))
                        fail(400, 'OTLP metrics are required.');
                    for (const metric of scope.metrics) {
                        if (!clean(metric.name, 256) || typeof metric.unit !== 'string' || metric.unit.length > 64)
                            fail(400, 'Metrics need a name and bounded unit.');
                        const type = metric.gauge ? 'gauge' : metric.sum ? 'sum' : null;
                        if (!type || metric.histogram || metric.exponentialHistogram || metric.summary || metric.gauge && metric.sum)
                            fail(422, 'This profile supports numeric gauge and sum observations; other metric types must use a compatible collector transform.');
                        if (!Array.isArray(metric[type].dataPoints))
                            fail(400, 'Metric dataPoints are required.');
                        if (type === 'sum' && (![1, 2].includes(metric.sum.aggregationTemporality) || typeof metric.sum.isMonotonic !== 'boolean'))
                            fail(400, 'Sum metrics require explicit delta/cumulative temporality and isMonotonic.');
                        for (const item of metric[type].dataPoints) {
                            const a = attributes(item.attributes || []);
                            if (Object.hasOwn(item, 'asDouble') === Object.hasOwn(item, 'asInt'))
                                fail(400, 'Use exactly one numeric OTLP point value.');
                            const raw = item.asDouble ?? item.asInt;
                            if (Object.hasOwn(item, 'asDouble') && typeof raw !== 'number')
                                fail(400, 'OTLP floating-point samples must be numbers.');
                            if (Object.hasOwn(item, 'asInt') && (typeof raw !== 'string' || !/^[-]?\d+$/.test(raw)))
                                fail(400, 'OTLP integer samples must be decimal strings.');
                            const v = Number(raw);
                            if (!Number.isFinite(v) || (Object.hasOwn(item, 'asInt') && !Number.isSafeInteger(v)))
                                fail(422, 'A metric value cannot be represented accurately.');
                            push(point(source, config, resource, { signal: 'metric', observedAt: timestamp(item.timeUnixNano), name: metric.name, unit: metric.unit, value: v, metricType: type, attributes: a, ...(item.startTimeUnixNano ? { startTime: timestamp(item.startTimeUnixNano) } : {}), ...(type === 'sum' ? { aggregationTemporality: metric.sum.aggregationTemporality, isMonotonic: metric.sum.isMonotonic } : {}) }, format));
                        }
                    }
                }
            }
        }
    }
    else
        fail(415, 'Use OTLP JSON logs, OTLP JSON metrics or decoded CloudWatch subscriptions.');
    return result;
}
