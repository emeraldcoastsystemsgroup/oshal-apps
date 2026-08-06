"use strict";
/**
 * Venture Plan — the store/route DTO layer.
 *
 * These are the shapes that cross the HTTP boundary and the database boundary.
 * They are deliberately SEPARATE from the engine's types (`venture-assumptions`,
 * `venture-bom`, …): the engine speaks in integer micro-dollars and basis points
 * and knows nothing about `owner_sub`, while these carry ownership, revision
 * history and source provenance and know nothing about arithmetic.
 *
 * THE ONE TYPE-LEVEL RULE. `Assumption.provenance` is the literal `'assumed'` and
 * `Figure.provenance` is the literal `'computed'`. Neither is optional and neither
 * is a union. That is what makes "a computed number is stored as an assumption" a
 * compile error rather than a code-review question — and it is the reason the bot
 * parsers can only ever produce `Assumption` values.
 *
 * `SourceKind` is closed on purpose. A bot may claim `vendor-quote`; the parser
 * in `venture-bot-contracts` downgrades it to `model-estimate` unless a source URL
 * or document reference came with it. A model cannot certify its own guess.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the closed SourceKind/Confidence/Domain enums, the row DTOs for every stored entity, the provenance literal discriminants, and the run/stage vocabularies the routes and the orchestrator share.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add immutable FX evidence, preserve original and reporting-currency quote amounts, and replace the last scenario cents field with integer micros.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Add scheduled rebaseline run kind, trigger provenance, UTC idempotency slot, and exact micro-USD cost evidence.
 *
 * @module venture-types
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUN_PHASES = exports.DOMAINS = exports.ENGINE_VERSION = exports.CONFIDENCES = exports.SELF_CERTIFIABLE_SOURCE_KINDS = exports.SOURCE_KINDS = void 0;
exports.isSourceKind = isSourceKind;
exports.isConfidence = isConfidence;
exports.isDomain = isDomain;
/** Every source kind, for validation and for the coverage roll-up. */
exports.SOURCE_KINDS = Object.freeze([
    'model-estimate', 'user-entered', 'vendor-quote', 'published-source', 'derived',
]);
/**
 * Source kinds a bot may assert about its own output WITHOUT external evidence.
 * Everything else needs a URL or a document reference, or it is downgraded.
 */
exports.SELF_CERTIFIABLE_SOURCE_KINDS = Object.freeze(['model-estimate']);
/** Every confidence level, weakest first. */
exports.CONFIDENCES = Object.freeze(['low', 'medium', 'high']);
/**
 * The arithmetic contract version, folded into every model's `inputs_hash`.
 *
 * BUMP IT WHENEVER AN ENGINE CHANGE MOVES A NUMBER. That invalidates every stored
 * hash, which is the point: a document rendered under the old arithmetic must read
 * as stale rather than as agreeing with a model it no longer matches.
 */
exports.ENGINE_VERSION = '1.1.0';
/** Every domain, in the order the surface groups them. */
exports.DOMAINS = Object.freeze([
    'product', 'market', 'channel', 'manufacturing', 'logistics',
    'compliance', 'finance', 'org', 'schedule',
]);
/** The phases a `full` run walks, in order. Two of them are independent. */
exports.RUN_PHASES = Object.freeze(['bom', 'market', 'ops', 'compute', 'narrate']);
/**
 * @description Narrow an arbitrary value to a known source kind.
 * @param v - Candidate value, typically off a bot's JSON.
 * @returns True when `v` is a member of the closed set.
 */
function isSourceKind(v) {
    return typeof v === 'string' && exports.SOURCE_KINDS.includes(v);
}
/**
 * @description Narrow an arbitrary value to a known confidence level.
 * @param v - Candidate value.
 * @returns True when `v` is `low`, `medium` or `high`.
 */
function isConfidence(v) {
    return typeof v === 'string' && exports.CONFIDENCES.includes(v);
}
/**
 * @description Narrow an arbitrary value to a known domain.
 * @param v - Candidate value.
 * @returns True when `v` is one of the nine domains.
 */
function isDomain(v) {
    return typeof v === 'string' && exports.DOMAINS.includes(v);
}
//# sourceMappingURL=venture-types.js.map