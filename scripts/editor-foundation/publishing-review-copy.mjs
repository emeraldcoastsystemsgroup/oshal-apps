/** Preserve the previous review's exact models/assets and clone current documents through actual owned HTTP APIs. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function call(origin, path, method = 'GET', body) { const response = await fetch(origin + '/api/publishing-studio' + path, { method, headers: body instanceof FormData ? {} : body === undefined ? {} : { 'content-type': 'application/json' }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) }); const value = await response.json(); if (!response.ok)
    throw Error('Publishing review copy refused: ' + (value.error || response.status)); return value; }
export async function clonePublishingReview({ oldOrigin, fresh, stateDir }) {
    const directory = await mkdtemp(join(stateDir, 'publishing-backup-')), receipt = { version: 1, createdAt: new Date().toISOString(), originalOrigin: oldOrigin, originalsPreserved: true, assets: [], documents: [] };
    const [{ documents }, { assets }] = await Promise.all([call(oldOrigin, '/documents'), call(oldOrigin, '/assets')]);
    if (documents.length > 32 || assets.length > 64)
        throw Error('Publishing review snapshot exceeds its owned bounds.');
    const replacements = new Map();
    for (const asset of assets) {
        const response = await fetch(oldOrigin + '/api/publishing-studio/assets/' + encodeURIComponent(asset.id) + '/content');
        if (!response.ok)
            throw Error('The earlier Publishing image could not be read.');
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length !== Number(asset.bytes) || sha(data) !== asset.sha256)
            throw Error('The earlier Publishing image changed during snapshot.');
        const filename = 'asset-' + sha(Buffer.from(asset.id)) + '.bin';
        await writeFile(join(directory, filename), data, { mode: 0o600, flag: 'wx' });
        const form = new FormData();
        form.append('file', new Blob([data], { type: asset.mime }), asset.title);
        form.append('title', asset.title);
        form.append('requestKey', randomUUID());
        const copied = await call(fresh.url, '/assets/upload', 'POST', form);
        if (copied.asset.sha256 !== asset.sha256 || copied.asset.bytes !== Number(asset.bytes))
            throw Error('Publishing image clone digest mismatch.');
        replacements.set(asset.id, copied.asset.id);
        receipt.assets.push({ ...asset, filename, clonedId: copied.asset.id });
    }
    for (const item of documents) {
        const original = await call(oldOrigin, '/documents/' + item.id), revisions = [];
        if (original.history.length > 100)
            throw Error('Publishing history exceeds its owned bounds.');
        for (const version of original.history) {
            const snapshot = version.revision === original.document.revision ? original : await call(oldOrigin, '/documents/' + item.id + '?revision=' + version.revision), filename = 'document-' + item.id + '-revision-' + version.revision + '.json';
            await writeFile(join(directory, filename), JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
            revisions.push({ revision: version.revision, filename, modelSha256: snapshot.document.sha256 });
        }
        const model = structuredClone(original.document.model);
        for (const asset of model.assets) {
            const id = replacements.get(asset.id);
            if (!id)
                throw Error('A referenced Publishing image was absent from its protected asset directory.');
            asset.id = id;
        }
        for (const page of [...model.pages, ...model.masters])
            for (const object of page.objects)
                if (object.kind === 'image') {
                    const id = replacements.get(object.assetId);
                    if (!id)
                        throw Error('A Publishing image object lost its original asset.');
                    object.assetId = id;
                }
        const created = await call(fresh.url, '/documents', 'POST', { title: model.title, pageCount: model.pages.length, requestKey: randomUUID() }), copied = await call(fresh.url, '/documents/' + created.document.id + '/revisions', 'POST', { baseRevision: 1, requestKey: randomUUID(), operations: [{ op: 'replace-model', model }] });
        receipt.documents.push({ originalId: item.id, originalRevision: original.document.revision, clonedId: copied.document.id, clonedRevision: copied.document.revision, title: copied.document.title, revisions });
    }
    receipt.complete = true;
    const receiptPath = join(directory, 'receipt.json');
    await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
    return { receipt, receiptPath, directory };
}
