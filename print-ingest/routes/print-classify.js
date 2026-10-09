"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-135 D14 — the recommendation builder, as PURE functions so the decision logic is testable without a database, a stack or a model. Deliberately deterministic in v1: every proposed destination carries a reason a person can evaluate ("equipment IDs and service intervals"), never an opaque score, because the form exists so a human can disagree with it. Ownership is never inferred here — a rule's suggested user and a sidecar's requestingUser are HINTS surfaced for display, and the caller decides owner_sub elsewhere (D8). Admin rules pre-tick, they do not approve, and the swarm-wide destination is filtered out entirely for a non-admin approver rather than offered and failed at write time.
 *
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Render only current native declared destinations and exact audiences; remove child operator environment authority.
 * @module print-classify
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.destinationCatalog = destinationCatalog;
exports.destinationsForCaller = destinationsForCaller;
exports.proposeTitle = proposeTitle;
exports.ruleMatches = ruleMatches;
exports.buildRecommendation = buildRecommendation;
exports.ruleMayAutoApprove = ruleMayAutoApprove;
const MAX_TITLE = 120;
/** Below this, a keyword hit is coincidence rather than subject matter. */
const STRONG_TOPIC_HITS = 2;
/** Native declarations and current named grants are the only destination catalog. */
function destinationCatalog(value) {
    if (!Array.isArray(value) || value.length > 32)
        throw new Error('Native RAG destinations unavailable');
    const seen = new Set();
    return value.map((raw) => {
        if (!raw || typeof raw !== 'object')
            throw new Error('Invalid native RAG destination');
        const entry = raw;
        const id = String(entry.id || ''), collection = String(entry.collection || ''), label = String(entry.label || '');
        const kind = entry.kind;
        if (!id || id.length > 160 || seen.has(id) || !label || label.length > 160
            || !/^[a-zA-Z0-9_.-]{1,160}$/.test(collection)
            || !['private', 'swarm', 'bot'].includes(String(kind)))
            throw new Error('Invalid native RAG destination');
        seen.add(id);
        const botId = kind === 'bot' ? String(entry.botId || '') : undefined;
        if (kind === 'bot' && !/^[0-9a-f-]{36}$/.test(botId || ''))
            throw new Error('Invalid native RAG bot audience');
        return { id, label, kind: kind, collection, botId,
            readableBy: kind === 'private' ? 'only you' : 'current named readers in your tenant — a bot corpus is routing, not privacy' };
    });
}
/**
 * @description The destinations a given caller may file into. The kernel-reserved
 * swarm level is withheld from a non-admin rather than offered and refused at
 * write time — a missing option beats a write that fails after the fact.
 * @param catalog - The full catalog.
 * @param callerIsAdmin - Whether the caller is an operator/admin.
 * @returns The permitted destinations.
 */
function destinationsForCaller(catalog, callerIsAdmin) {
    return catalog.filter((destination) => destination.kind !== 'swarm' || callerIsAdmin);
}
/**
 * @description Choose a human-readable title: the document's own title when the
 * client supplied a real one, otherwise the first meaningful line of its text.
 * A printed job frequently arrives named "document" or "Untitled", which is worse
 * than useless in an inbox, so those are treated as absent.
 * @param sidecar - The printer's job metadata.
 * @param text - The document's extracted text.
 * @returns A trimmed title, never empty.
 */
function proposeTitle(sidecar, text) {
    const generic = /^(document|untitled|print|printout|page \d+|microsoft word - document\d*)$/i;
    for (const candidate of [sidecar.jobName, sidecar.documentName]) {
        const value = String(candidate || '').trim();
        if (value && !generic.test(value))
            return value.slice(0, MAX_TITLE);
    }
    const firstLine = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length >= 3);
    return (firstLine || 'Untitled document').slice(0, MAX_TITLE);
}
/**
 * @description Whether a rule applies to this document. An unset match field means
 * "any"; a set one must match exactly. A rule with no match fields at all would
 * apply to everything, which is never what an admin means, so it is refused.
 * @param rule - The association rule.
 * @param sidecar - The printer's job metadata.
 * @returns True when the rule governs this document.
 */
function ruleMatches(rule, sidecar) {
    if (!rule.enabled)
        return false;
    const criteria = [
        [rule.matchClientIp, sidecar.clientIp],
        [rule.matchComputer, sidecar.originatingComputer],
        [rule.matchPrinter, sidecar.printerName],
    ];
    const declared = criteria.filter(([want]) => String(want || '').trim().length > 0);
    if (declared.length === 0)
        return false;
    return declared.every(([want, got]) => String(want).trim().toLowerCase() === String(got || '').trim().toLowerCase());
}
/**
 * @description Count how many of a destination's topics the document mentions,
 * and name the ones that hit so the reason can quote them back.
 * @param text - The document's extracted text.
 * @param topics - The destination's topic keywords.
 * @returns The matched topics, in declaration order.
 */
function matchedTopics(text, topics) {
    const haystack = ` ${String(text || '').toLowerCase()} `;
    return topics.filter((topic) => {
        const needle = String(topic).toLowerCase().trim();
        return needle.length > 0 && haystack.includes(needle);
    });
}
/**
 * @description Score one bot destination against the document's content.
 * @param destination - The candidate destination.
 * @param text - The document's extracted text.
 * @param ruleDestinations - Destination ids a matching admin rule pre-ticks.
 * @returns The proposal for this destination.
 */
function proposeBot(destination, text, ruleDestinations) {
    const hits = matchedTopics(text, destination.topics || []);
    const byRule = ruleDestinations.has(destination.id);
    if (byRule) {
        return {
            id: destination.id,
            label: destination.label,
            kind: destination.kind,
            recommended: true,
            confidence: 'high',
            reason: 'an administrator rule files documents from this source here',
            readableBy: destination.readableBy,
        };
    }
    const strong = hits.length >= STRONG_TOPIC_HITS;
    return {
        id: destination.id,
        label: destination.label,
        kind: destination.kind,
        recommended: strong,
        confidence: strong ? 'high' : hits.length === 1 ? 'medium' : 'low',
        reason: hits.length
            ? `mentions ${hits.slice(0, 3).join(', ')}`
            : 'nothing in the text matches this bot’s subjects',
        readableBy: destination.readableBy,
    };
}
/**
 * @description Build the approval form's recommendation from the four D14 signals:
 * admin rules, document content, the printer's metadata, and who is approving.
 * Every destination the caller may use is returned — including the ones NOT
 * recommended and why — so a person can see what was considered, not only what
 * was chosen for them.
 * @param input - Sidecar, text, destination catalog, rules, and caller privilege.
 * @returns The proposed title, every destination with its verdict, and the applied rule.
 */
function buildRecommendation(input) {
    const rule = input.rules.find((candidate) => ruleMatches(candidate, input.sidecar)) || null;
    const ruleDestinations = new Set(rule ? rule.destinations : []);
    const available = destinationsForCaller(input.destinations, input.callerIsAdmin);
    const proposals = available.map((destination) => {
        if (destination.kind === 'bot')
            return proposeBot(destination, input.text, ruleDestinations);
        const byRule = ruleDestinations.has(destination.id);
        if (destination.kind === 'private') {
            return {
                id: destination.id,
                label: destination.label,
                kind: destination.kind,
                recommended: byRule || !rule,
                confidence: byRule ? 'high' : 'medium',
                reason: byRule
                    ? 'an administrator rule files documents from this source here'
                    : 'the safe default — only you can retrieve it',
                readableBy: destination.readableBy,
            };
        }
        return {
            id: destination.id,
            label: destination.label,
            kind: destination.kind,
            recommended: byRule,
            confidence: byRule ? 'high' : 'low',
            reason: byRule
                ? 'an administrator rule files documents from this source here'
                : 'current named readers in your tenant would be able to retrieve it — tick only if that is intended',
            readableBy: destination.readableBy,
        };
    });
    return {
        title: proposeTitle(input.sidecar, input.text),
        proposals,
        appliedRule: rule ? { ruleId: rule.ruleId, label: rule.label, autoApprove: rule.autoApprove } : null,
        suggestedUserSub: rule?.suggestedUserSub ? String(rule.suggestedUserSub) : null,
    };
}
/**
 * @description Whether a matching rule may file this document without a human.
 * Auto-approval is opt-in per rule AND never permitted into the swarm-wide level,
 * which every signed-in user can read (ADR-135 D16 bound 2).
 * @param recommendation - The built recommendation.
 * @param destinations - The destination catalog.
 * @returns True when the rule may approve on its own.
 */
function ruleMayAutoApprove(recommendation, destinations) {
    if (!recommendation.appliedRule?.autoApprove)
        return false;
    const swarmIds = new Set(destinations.filter((d) => d.kind === 'swarm').map((d) => d.id));
    return !recommendation.proposals.some((p) => p.recommended && swarmIds.has(p.id));
}
