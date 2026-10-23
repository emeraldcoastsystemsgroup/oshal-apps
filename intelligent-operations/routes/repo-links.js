"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repoLink = repoLink;
exports.saveRepoLink = saveRepoLink;
exports.removeRepoLink = removeRepoLink;
exports.repoLinks = repoLinks;
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Link each recorded Kubernetes cluster to its GitOps repository (GitHub owner/repo, base branch, folder, optional workflow): one link per cluster per person, at most 64, validated like a promotion target; promotion panels preselect the link for the plan's cluster. */
// @ts-nocheck
const intake_1 = require("./intake");
const pipeline_1 = require("./pipeline");
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const requireOwner = owner => { if (typeof owner !== 'string' || !owner.trim())
    fail(401, 'A verified caller is required.'); };
const safe = (v, re, max) => typeof v === 'string' && v.length <= max && re.test(v);
/** @description Validate one link: the cluster it belongs to and where its manifests live. */
function repoLink(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['clusterScope', 'clusterName', 'owner', 'repo', 'baseBranch', 'folder', 'workflow'].includes(k)))
        fail(400, 'Supply only the link fields.');
    if (!safe(input.clusterScope, /^[^\x00-\x1f\x7f]{1,512}$/, 512) || input.clusterScope.trim() !== input.clusterScope)
        fail(400, 'Choose a recorded cluster.');
    if (!safe(input.clusterName, /^[^\x00-\x1f\x7f]{1,256}$/, 256))
        fail(400, 'Name the cluster.');
    if (!safe(input.owner, /^[A-Za-z0-9-]{1,39}$/, 39) || !safe(input.repo, /^[A-Za-z0-9._-]{1,100}$/, 100) || input.repo.startsWith('.'))
        fail(400, 'Use the GitHub owner and repository names.');
    if (!safe(input.baseBranch, /^[A-Za-z0-9._-]{1,100}$/, 100))
        fail(400, 'Use a base branch name without slashes.');
    if (!safe(input.folder, /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,5}$/, 200) || input.folder.split('/').some(p => p === '.' || p === '..'))
        fail(400, 'Use a relative folder inside the repository.');
    if (input.workflow != null && input.workflow !== '' && !safe(input.workflow, /^[A-Za-z0-9._-]{1,100}\.ya?ml$/, 100))
        fail(400, 'A workflow is a .yml file name in .github/workflows.');
    return { clusterScope: input.clusterScope, clusterName: input.clusterName, provider: 'github', owner: input.owner, repo: input.repo, baseBranch: input.baseBranch, folder: input.folder, workflow: input.workflow || null };
}
/** @description Keep or replace the person's link for one cluster. */
async function saveRepoLink(pool, owner, input) {
    requireOwner(owner);
    const link = repoLink(input), id = (0, intake_1.hash)(['repo-link-v1', link.clusterScope]);
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const previous = (await c.query('SELECT record FROM operations_repo_links WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0]?.record;
        const record = { ...link, id, updatedAt: new Date().toISOString() };
        if (previous) {
            await c.query('UPDATE operations_repo_links SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, id, JSON.stringify(record)]);
            return { ...record, replaced: true };
        }
        const count = (await c.query('SELECT count(*)::int AS n FROM operations_repo_links WHERE user_sub=$1', [owner])).rows[0].n;
        if (count >= 64)
            fail(409, 'Link at most 64 clusters.');
        await c.query('INSERT INTO operations_repo_links(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [owner, id, record.updatedAt, JSON.stringify(record)]);
        return { ...record, replaced: false };
    });
}
/** @description Remove the person's link for one cluster. */
async function removeRepoLink(pool, owner, input) {
    requireOwner(owner);
    if (!input || typeof input.id !== 'string' || !/^[a-f0-9]{64}$/.test(input.id))
        fail(400, 'Choose a link.');
    const r = await pool.query('DELETE FROM operations_repo_links WHERE user_sub=$1 AND id=$2', [owner, input.id]);
    if (!r.rowCount)
        fail(404, 'The owned link is unavailable.');
    return { removed: input.id };
}
/** @description The person's links, newest first. */
async function repoLinks(pool, owner) {
    requireOwner(owner);
    return { items: (await pool.query('SELECT record FROM operations_repo_links WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 64', [owner])).rows.map(r => r.record), limit: 64 };
}
