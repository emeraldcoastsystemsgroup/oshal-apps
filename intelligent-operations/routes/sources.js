"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeSource = removeSource;
exports.removedSourceIds = removedSourceIds;
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Remove a saved source (backlog P5-55b, 2026-11-09: the stopped fleet observer's six made-up installations stayed in Operations, and only a failed sample replay's clean-up could take a source out). removeSource marks one of the caller's own sources discarded, as replay-store.js discardReplay does, so every read that starts from the saved sources drops it: Sources, Systems and its Monitored installations, the desks, the processing tick and its silence watch; removedSourceIds lets the attention and systems summaries Jarvis reads drop it too. Nothing it recorded is deleted: alerts, readings, telemetry, scans and investigations stay, and a source registered in Sources comes back with its history when the same definition is saved there again. It takes confirm: true, names the source by id or by an exact name only one saved source has, refuses a desk's own source (the next tick saves it again) and answers 404 for a source that is not the caller's. */
// @ts-nocheck
const desks_1 = require("./desks");
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const ID = /^[a-f0-9]{64}$/, KEYS = ['sourceId', 'name', 'confirm'];
/** The input's shape: one way to name the source, a bounded name, and the explicit confirmation. */
function checked(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !KEYS.includes(k)))
        fail(400, 'Send the source (sourceId or name) and confirm: true only.');
    const byId = typeof input.sourceId === 'string', byName = typeof input.name === 'string';
    if (!byId && !byName)
        fail(400, 'Name the source to remove: send sourceId or name.');
    if (byId && byName)
        fail(400, 'Name the source by sourceId or by name, not both.');
    if (typeof input.sourceId === 'string' && !ID.test(input.sourceId))
        fail(400, 'A source id is 64 lowercase hexadecimal characters.');
    if (typeof input.name === 'string' && (!input.name.trim() || input.name.length > 80))
        fail(400, 'A source name is 1 to 80 characters.');
    if (input.confirm !== true)
        fail(400, 'Removing a source takes your confirmation: send confirm: true.');
    return input;
}
/** The saved source the input names: by id (a removed one too, so a retry answers the same), or by an exact name that only one saved source still has. */
function chosen(saved, input) {
    if (input.sourceId) {
        const hit = saved.find(s => s?.id === input.sourceId);
        if (!hit)
            fail(404, 'That source is not saved in your Operations.');
        return hit;
    }
    const named = saved.filter(s => s && !s.discardedAt && s.name === input.name);
    if (!named.length)
        fail(404, 'No saved source in your Operations is named ' + JSON.stringify(input.name) + '.');
    if (named.length > 1)
        fail(409, named.length + ' saved sources are named ' + JSON.stringify(input.name) + '; remove the one you mean from Systems, or by its id.');
    return named[0];
}
/**
 * @description Remove one of the caller's own saved sources from Operations and keep everything it recorded. Its alerts are refused from then on, because every route that admits them reads only the saved sources that are not removed.
 * @param ctx The package context; ctx.store is the caller's own document store.
 * @param owner The verified caller.
 * @param input {sourceId} or {name}, with confirm: true.
 * @returns What was removed and when; a source already removed answers with its first removal and changes nothing.
 */
async function removeSource(ctx, owner, input) {
    if (typeof owner !== 'string' || !owner.trim())
        fail(401, 'A verified caller is required.');
    checked(input);
    const saved = await ctx.store.query('sources');
    if (!Array.isArray(saved))
        throw Error('Malformed store response');
    const source = chosen(saved, input);
    if (source.discardedAt)
        return { removed: false, alreadyRemoved: true, sourceId: source.id, name: source.name, discardedAt: source.discardedAt };
    const desk = desks_1.DESKS.find(d => d.uri === source.source);
    if (desk)
        fail(409, source.name + ' is the ' + desk.label + ' desk\'s own source, which the next processing tick saves again, so it cannot be removed.');
    const discardedAt = new Date().toISOString();
    await ctx.store.put('sources', source.id, { ...source, discardedAt });
    return { removed: true, sourceId: source.id, name: source.name, discardedAt, kept: 'Its alerts, readings, telemetry, scans and investigations stay.' };
}
/**
 * @description The ids of the caller's removed sources, for the reads that do not start from the saved sources (the installation standing behind the attention and systems summaries).
 * @param store The caller's own document store.
 * @returns A Set of source ids.
 */
async function removedSourceIds(store) { const saved = await store.query('sources'); return new Set((Array.isArray(saved) ? saved : []).filter(s => s?.discardedAt).map(s => s.id)); }
