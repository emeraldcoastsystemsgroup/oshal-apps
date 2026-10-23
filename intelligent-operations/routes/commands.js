"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandRun = commandRun;
exports.recordCommand = recordCommand;
exports.commandRecords = commandRecords;
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | Admit ssh commands and ssh-connection records (kernel ADR-195) with their host target and provenance. */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Admit gcp-connection and azure-connection records with their own provenance. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Admit aws-connection records (AWS reads signed by the kernel with the person's own key) with their own provenance. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Command helper records: the operator's reviewed command, where it ran (own terminal, OSHAL Node or reviewed pod exec), the coaching that proposed it and the pasted or native result, as bounded own-scope records with digests; pasted results are labeled operator-provided, never server-verified. */
// @ts-nocheck
const node_crypto_1 = require("node:crypto");
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const requireOwner = owner => { if (typeof owner !== 'string' || !owner.trim())
    fail(401, 'A verified caller is required.'); };
const TOOLS = ['kubectl', 'aws', 'gcloud', 'az', 'pod-exec', 'ssh'], WHERE = ['local-terminal', 'oshal-node', 'pod-exec', 'aws-connection', 'gcp-connection', 'azure-connection', 'ssh-connection'], RISK = ['none', 'low', 'medium', 'high'];
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00]/.test(value) ? value : null;
const sha = value => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
/** @description Validate a closed command-run record; argv is explicit data (no shell string), outputs are bounded and labeled by where they came from. */
function commandRun(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['tool', 'argv', 'where', 'goal', 'proposal', 'target', 'output', 'exitCode', 'outcome'].includes(k)))
        fail(400, 'Supply only the supported command fields.');
    if (!TOOLS.includes(input.tool) || !WHERE.includes(input.where))
        fail(400, 'Choose a supported tool and where it ran.');
    if ((input.tool === 'pod-exec') !== (input.where === 'pod-exec'))
        fail(400, 'Pod exec commands run only through the reviewed pod connection.');
    if (input.where === 'ssh-connection' && input.tool !== 'ssh')
        fail(400, 'Only host commands run through the SSH connection.');
    if ({ 'aws-connection': 'aws', 'gcp-connection': 'gcloud', 'azure-connection': 'az' }[input.where] && { 'aws-connection': 'aws', 'gcp-connection': 'gcloud', 'azure-connection': 'az' }[input.where] !== input.tool)
        fail(400, 'Only that cloud\'s reads run through its connection.');
    if (!Array.isArray(input.argv) || !input.argv.length || input.argv.length > 64 || input.argv.some(a => typeof a !== 'string' || !a.length || a.length > 4096 || a.includes('\0')) || input.argv.reduce((n, a) => n + a.length, 0) > 16384)
        fail(400, 'Command arguments are an explicit bounded array.');
    const goal = text(input.goal, 2000);
    if (goal === null || !goal.trim())
        fail(400, 'State the goal the command serves.');
    const proposal = input.proposal === undefined ? null : input.proposal;
    if (proposal !== null && (typeof proposal !== 'object' || Array.isArray(proposal) || Object.keys(proposal).some(k => !['say', 'reason', 'readOnly', 'risk', 'verify'].includes(k)) || (proposal.risk !== undefined && !RISK.includes(proposal.risk)) || (proposal.readOnly !== undefined && typeof proposal.readOnly !== 'boolean') || ['say', 'reason', 'verify'].some(k => proposal[k] !== undefined && text(proposal[k], 4000) === null)))
        fail(400, 'The coaching proposal has a closed shape.');
    const target = input.target === undefined ? null : input.target;
    if (target !== null && (typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(k => !['namespace', 'pod', 'uid', 'container', 'account', 'profile', 'project', 'subscription', 'cluster', 'region', 'host'].includes(k)) || Object.values(target).some(v => text(v, 253) === null)))
        fail(400, 'The target is a closed set of identifiers.');
    const output = input.output === undefined ? null : text(input.output, 16384);
    if (output === null && input.output !== undefined)
        fail(413, 'Pasted output is limited to 16 KiB.');
    const exitCode = input.exitCode === undefined || input.exitCode === null ? null : Number.isSafeInteger(input.exitCode) ? input.exitCode : fail(400, 'Exit code must be an integer.');
    const outcome = input.outcome === undefined ? null : ['completed', 'failed', 'unknown', 'not-run'].includes(input.outcome) ? input.outcome : fail(400, 'Use a bounded outcome.');
    if (JSON.stringify(input.argv).match(/(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abp]-|ghp_[A-Za-z0-9]{20,})/))
        fail(400, 'The command contains what looks like a credential; use your signed-in CLI profile instead.');
    return { tool: input.tool, argv: input.argv, where: input.where, goal: goal.trim(), proposal, target, output, outputSha256: output === null ? null : sha(output), outputBytes: output === null ? null : Buffer.byteLength(output), exitCode, outcome,
        provenance: input.where === 'pod-exec' ? 'native-kubernetes-exec reported by the operator session' : input.where === 'aws-connection' ? 'native AWS-signed read through the operator\'s own connection, reported by the operator session' : input.where === 'gcp-connection' ? 'native Google Cloud read through the operator\'s own connection, reported by the operator session' : input.where === 'azure-connection' ? 'native Azure read through the operator\'s own connection, reported by the operator session' : input.where === 'ssh-connection' ? 'native SSH command on an administrator-pinned host with the operator\'s own key, reported by the operator session' : 'operator-pasted from their own ' + (input.where === 'oshal-node' ? 'OSHAL Node' : 'terminal'), verifiedByServer: false, executedByApplication: false };
}
/** @description Save one bounded command record under the caller; at most 200 are kept per person (oldest dropped). */
async function recordCommand(pool, owner, input) {
    requireOwner(owner);
    const record = { ...commandRun(input), id: (0, node_crypto_1.randomUUID)(), recordedAt: new Date().toISOString() };
    await pool.query('INSERT INTO operations_command_runs(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [owner, record.id, record.recordedAt, JSON.stringify(record)]);
    await pool.query('DELETE FROM operations_command_runs WHERE user_sub=$1 AND id IN (SELECT id FROM operations_command_runs WHERE user_sub=$1 ORDER BY created_at DESC, id OFFSET 200)', [owner]);
    return record;
}
/** @description Bounded own-scope page of recorded commands, newest first. */
async function commandRecords(pool, owner) {
    requireOwner(owner);
    const rows = (await pool.query('SELECT record FROM operations_command_runs WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 51', [owner])).rows.map(r => r.record);
    return { items: rows.slice(0, 50), truncated: rows.length > 50, limit: 50, tools: TOOLS, where: WHERE, executionRails: { 'pod-exec': 'reviewed native Kubernetes exec through the operator\'s own connection', kubectl: 'operator\'s own terminal or OSHAL Node; no in-application execution rail', aws: 'caller identity and EKS cluster and node-group reads through your own AWS connection (signed by the kernel with your key); anything else in your own terminal or OSHAL Node', gcloud: 'GKE cluster and node-pool reads through your own Google Cloud connection; anything else in your own terminal or OSHAL Node', az: 'subscription and AKS reads through your own Azure connection; anything else in your own terminal or OSHAL Node', ssh: 'a reviewed command on an administrator-selected host with your own SSH key, one confirmation per run; or your own terminal' } };
}
