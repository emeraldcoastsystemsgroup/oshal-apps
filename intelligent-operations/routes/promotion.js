"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promotionTarget = promotionTarget;
exports.reservePromotion = reservePromotion;
exports.reportPromotion = reportPromotion;
exports.promotionRecords = promotionRecords;
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | A provisioning kind promotes a provisioning request's rendered manifests with its own manifest file and request text. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Git promotion of a response plan: the standard path commits the plan's exact generated files and a manifest to a new branch, opens a pull/merge request and optionally starts a pipeline; the break-glass path is allowed only after an emergency execution and must be reconciled in Git before its deadline. One reservation per plan and path is written before the browser's confirmed native connector actions; provider results are operator-reported, the file bytes and manifest come from the server. */
// @ts-nocheck
const node_crypto_1 = require("node:crypto");
const intake_1 = require("./intake");
const pipeline_1 = require("./pipeline");
const provisioning_1 = require("./provisioning");
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const requireOwner = owner => { if (typeof owner !== 'string' || !owner.trim())
    fail(401, 'A verified caller is required.'); };
const id64 = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const closed = (input, fields) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k)))
    fail(400, 'Supply only the supported promotion fields.'); };
const RECONCILE_HOURS = 24, PROVIDERS = ['github', 'gitlab'], KINDS = ['standard', 'break-glass-reconciliation', 'provisioning'];
const sha = b => (0, node_crypto_1.createHash)('sha256').update(b).digest('hex');
const safe = (v, re, max) => typeof v === 'string' && v.length <= max && re.test(v);
/** @description Validate where the change goes: provider, the person's exact account, the repository, the base branch, a folder inside the repository and an optional pipeline. */
function promotionTarget(input) {
    closed(input, ['provider', 'account', 'owner', 'repo', 'projectId', 'baseBranch', 'folder', 'workflow', 'runPipeline']);
    if (!PROVIDERS.includes(input.provider))
        fail(400, 'Choose GitHub or GitLab.');
    if (!safe(input.account, /^[^\x00-\x1f\x7f]+$/, 128))
        fail(400, 'Select your exact connection account.');
    if (input.provider === 'github' && (!safe(input.owner, /^[A-Za-z0-9-]{1,39}$/, 39) || !safe(input.repo, /^[A-Za-z0-9._-]{1,100}$/, 100) || input.repo.startsWith('.')))
        fail(400, 'Use the GitHub owner and repository names.');
    if (input.provider === 'gitlab' && !safe(input.projectId, /^[1-9][0-9]{0,19}$/, 20))
        fail(400, 'Use the numeric GitLab project ID.');
    if (!safe(input.baseBranch, /^[A-Za-z0-9._-]{1,100}$/, 100))
        fail(400, 'Use a base branch name without slashes.');
    if (!safe(input.folder, /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,5}$/, 200) || input.folder.split('/').some(p => p === '.' || p === '..'))
        fail(400, 'Use a relative folder inside the repository.');
    if (input.workflow !== undefined && input.workflow !== null && input.workflow !== '' && (input.provider !== 'github' || !safe(input.workflow, /^[A-Za-z0-9._-]{1,100}\.ya?ml$/, 100)))
        fail(400, 'A GitHub workflow is a .yml file name in .github/workflows.');
    if (input.runPipeline !== undefined && typeof input.runPipeline !== 'boolean')
        fail(400, 'Invalid runPipeline.');
    return { provider: input.provider, account: input.account, owner: input.provider === 'github' ? input.owner : null, repo: input.provider === 'github' ? input.repo : null, projectId: input.provider === 'gitlab' ? input.projectId : null, baseBranch: input.baseBranch, folder: input.folder, workflow: input.provider === 'github' && input.workflow ? input.workflow : null, runPipeline: input.runPipeline === true };
}
async function planAndFiles(c, owner, planId) {
    if (!id64(planId))
        fail(400, 'Choose a saved response plan.');
    const plan = (await c.query('SELECT record FROM operations_action_plans WHERE user_sub=$1 AND id=$2', [owner, planId])).rows[0]?.record;
    if (!plan)
        fail(404, 'The owned response plan is unavailable.');
    if (plan.answerVerifiedByServer !== true)
        fail(409, 'This response plan predates server-verified accepted work. Prepare a new plan before Git promotion.');
    const rows = (await c.query('SELECT name, sha256, content FROM operations_action_artifacts WHERE user_sub=$1 AND plan_id=$2 ORDER BY name', [owner, planId])).rows;
    for (const r of rows)
        if (sha(Buffer.from(r.content)) !== r.sha256)
            fail(503, 'Stored artifact bytes no longer match their digest.');
    return { plan, files: rows.map(r => ({ name: r.name, sha256: r.sha256, content: Buffer.from(r.content).toString('utf8') })) };
}
/** @description Reserve one promotion per plan, path and destination before any provider write; the reply carries the exact files, manifest, branch, commit message and request text the browser must send. */
async function reservePromotion(pool, owner, input) {
    requireOwner(owner);
    closed(input, ['planId', 'kind', 'target']);
    if (!KINDS.includes(input.kind))
        fail(400, 'Choose the standard Git path or a break-glass reconciliation.');
    const target = promotionTarget(input.target);
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        if (input.kind === 'provisioning')
            return reserveProvisioning(c, owner, input, target);
        const { plan, files } = await planAndFiles(c, owner, input.planId);
        const execution = (await c.query("SELECT record FROM operations_action_executions WHERE user_sub=$1 AND record->>'planId'=$2 ORDER BY created_at DESC LIMIT 1", [owner, plan.id])).rows[0]?.record || null;
        if (input.kind === 'break-glass-reconciliation' && (!execution || !['completed', 'uncertain', 'failed'].includes(execution.state)))
            fail(409, 'A break-glass reconciliation follows an emergency execution of this plan; none has a reported outcome yet.');
        const id = (0, intake_1.hash)(['git-promotion-v1', { planId: plan.id, kind: input.kind, target: { ...target, account: undefined } }]);
        const old = (await c.query('SELECT record FROM operations_git_promotions WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0]?.record;
        if (old)
            return { ...old, retry: true };
        const short = plan.id.slice(0, 12), branch = (input.kind === 'standard' ? 'triagenorth-' : 'triagenorth-reconcile-') + short;
        const manifest = { schema: 'triagenorth-change-manifest/1', planId: plan.id, ticketId: plan.ticketId, ticketRevision: plan.ticketRevision, workId: plan.workId, phase: plan.phase, answerSha256: plan.answerSha256, target: plan.target, artifacts: plan.artifacts.map(a => ({ name: a.name, sha256: a.sha256, bytes: a.bytes })), path: input.kind, execution: execution ? { id: execution.id, state: execution.state, recovery: execution.recovery?.outcome || null, reportedAt: execution.action?.reportedAt || null } : null, generatedAt: new Date().toISOString() };
        const tree = [...files.map(f => ({ path: target.folder + '/' + f.name, content: f.content, sha256: f.sha256 })), { path: target.folder + '/manifest.json', content: JSON.stringify(manifest, null, 2) + '\n', sha256: null }];
        if (Buffer.byteLength(JSON.stringify(tree)) > 60000)
            fail(413, 'The change exceeds the 60 KB connector request bound.');
        const title = (input.kind === 'standard' ? 'Response plan ' : 'Reconcile break-glass change ') + short + ' for ticket ' + String(plan.ticketId).slice(0, 8);
        const deadline = input.kind === 'break-glass-reconciliation' ? new Date(Date.parse(execution.action?.reportedAt || execution.createdAt) + RECONCILE_HOURS * 3600000).toISOString() : null;
        const body = [input.kind === 'standard' ? 'Standard path: this change is reviewed and merged through Git, and the pipeline applies it. Nothing was executed on the cluster by the application.' : 'Break-glass reconciliation: this change was applied in an emergency through a reviewed pod exec and must be merged (or reverted in Git) before ' + deadline + '.',
            '', 'Plan: ' + plan.id, 'Ticket: ' + plan.ticketId + ' (revision ' + plan.ticketRevision + ')', 'Generated by workflow phase ' + plan.phase + '; answer sha256 ' + plan.answerSha256, 'Target: ' + plan.target.namespace + '/' + plan.target.pod + ' (' + plan.target.uid + ') container ' + plan.target.container, '',
            'Files:', ...plan.artifacts.map(a => '- ' + a.name + ' sha256 ' + a.sha256), ...(execution ? ['', 'Execution ' + execution.id + ': ' + execution.state + ', recovery ' + (execution.recovery?.outcome || 'not verified')] : [])].join('\n');
        const record = { id, planId: plan.id, kind: input.kind, target, branch, tree: tree.map(f => ({ path: f.path, sha256: f.sha256 })), title, state: 'reserved-outcome-unknown', deadline, createdAt: new Date().toISOString(), provenance: 'native-dispatch-reservation', verifiedByServer: false };
        await c.query('INSERT INTO operations_git_promotions(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [owner, id, record.createdAt, JSON.stringify(record)]);
        return { ...record, request: { files: tree, commitMessage: title + '\n\n' + body, title, body } };
    });
}
/** @description A provisioning request's exact manifests and a manifest file on a new branch; the person's pipeline applies them after review. */
async function reserveProvisioning(c, owner, input, target) {
    const req = await (0, provisioning_1.provisioningRequest)(c, owner, input.planId);
    const id = (0, intake_1.hash)(['git-promotion-v1', { planId: req.id, kind: 'provisioning', target: { ...target, account: undefined } }]);
    const old = (await c.query('SELECT record FROM operations_git_promotions WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0]?.record;
    if (old)
        return { ...old, retry: true };
    const short = req.id.slice(0, 12), branch = 'triagenorth-provision-' + short, name = req.params.name + (req.params.namespace ? ' in ' + req.params.namespace : '');
    const manifest = { schema: 'triagenorth-provisioning-manifest/1', provisioningId: req.id, template: req.template, params: req.params, reason: req.reason, files: req.files.map(f => ({ name: f.name, sha256: f.sha256, bytes: f.bytes })), generatedAt: new Date().toISOString() };
    const tree = [...req.files.map(f => ({ path: target.folder + '/' + f.name, content: f.content, sha256: f.sha256 })), { path: target.folder + '/manifest.json', content: JSON.stringify(manifest, null, 2) + '\n', sha256: null }];
    if (Buffer.byteLength(JSON.stringify(tree)) > 60000)
        fail(413, 'The change exceeds the 60 KB connector request bound.');
    const title = 'Provision ' + req.template + ' ' + name;
    const body = ['Provisioning through Git: these manifests were rendered from reviewed parameters and are applied by your pipeline after this request is reviewed and merged. Nothing was applied to a cluster by the application.', '', 'Request: ' + req.id, 'Template: ' + req.template, 'Reason: ' + req.reason, '', 'Files:', ...req.files.map(f => '- ' + f.name + ' sha256 ' + f.sha256)].join('\n');
    const record = { id, planId: req.id, kind: 'provisioning', target, branch, tree: tree.map(f => ({ path: f.path, sha256: f.sha256 })), title, state: 'reserved-outcome-unknown', deadline: null, createdAt: new Date().toISOString(), provenance: 'native-dispatch-reservation', verifiedByServer: false };
    await c.query('INSERT INTO operations_git_promotions(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [owner, id, record.createdAt, JSON.stringify(record)]);
    return { ...record, request: { files: tree, commitMessage: title + '\n\n' + body, title, body } };
}
/** @description Record what the browser saw from the provider; never server-verified, never a change to canonical state. */
async function reportPromotion(pool, owner, input) {
    requireOwner(owner);
    closed(input, ['promotionId', 'outcome', 'commitSha', 'requestNumber', 'requestUrl', 'pipelineId', 'pipelineUrl', 'pipelineStatus', 'merged', 'error']);
    if (!id64(input.promotionId) || !['opened', 'pipeline-started', 'merged', 'failed', 'uncertain', 'status'].includes(input.outcome))
        fail(400, 'Use a bounded promotion outcome.');
    const str = (v, max) => v === undefined || v === null ? null : typeof v === 'string' && v.length <= max && !/[\x00-\x1f]/.test(v) ? v : fail(400, 'Invalid promotion field.');
    const url = v => { const u = str(v, 512); if (u && !/^https:\/\/(github\.com|gitlab\.com)\//.test(u))
        fail(400, 'Provider links must be github.com or gitlab.com.'); return u; };
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const row = (await c.query('SELECT record FROM operations_git_promotions WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, input.promotionId])).rows[0]?.record;
        if (!row)
            fail(404, 'The owned promotion is unavailable.');
        const record = { ...row, state: input.outcome === 'status' ? row.state : input.outcome, commitSha: str(input.commitSha, 64) ?? row.commitSha ?? null, requestNumber: Number.isSafeInteger(input.requestNumber) ? input.requestNumber : row.requestNumber ?? null, requestUrl: url(input.requestUrl) ?? row.requestUrl ?? null, pipelineId: str(input.pipelineId != null ? String(input.pipelineId) : null, 40) ?? row.pipelineId ?? null, pipelineUrl: url(input.pipelineUrl) ?? row.pipelineUrl ?? null, pipelineStatus: str(input.pipelineStatus, 40) ?? row.pipelineStatus ?? null, merged: typeof input.merged === 'boolean' ? input.merged : row.merged ?? null, error: str(input.error, 240), reportedAt: new Date().toISOString(), provenance: 'operator-report', verifiedByServer: false };
        if (record.kind === 'break-glass-reconciliation')
            record.overdue = !record.merged && Date.parse(record.deadline) < Date.now();
        await c.query('UPDATE operations_git_promotions SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, row.id, JSON.stringify(record)]);
        return record;
    });
}
/** @description Own promotions by plan, with break-glass deadlines evaluated now. */
async function promotionRecords(pool, owner) {
    requireOwner(owner);
    const rows = (await pool.query('SELECT record FROM operations_git_promotions WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 101', [owner])).rows.map(r => r.record);
    return rows.slice(0, 100).map(r => r.kind === 'break-glass-reconciliation' ? { ...r, overdue: !r.merged && Date.parse(r.deadline) < Date.now() } : r);
}
