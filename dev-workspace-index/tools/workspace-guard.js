/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The exclusion list as a real guard: secret rules mirroring the core publish gate's vendor-credential families plus generic secret assignments, concrete identifier shapes (personal email, OIDC subject forms, subject values in key positions, phone numbers) instead of the prose-matching pattern that skipped half the corpus, an optional fail-closed read of the checkout's gitignored scripts/publish-gate.local.patterns whose text is never echoed, line-level exemptions equal to the gate's, and a post-build rescan of every emitted chunk that fails the build on any hit.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOCAL_PATTERNS_FILE = path.join('scripts', 'publish-gate.local.patterns');
const LOCAL_RULE_ID = 'identifier:local-pattern';

/** Vendor-prefixed credential shapes: the same families core's scripts/publish-gate.sh refuses. */
const SECRET_RULES = Object.freeze([
  { id: 'secret:aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g },
  { id: 'secret:private-key-block', pattern: /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY/g },
  { id: 'secret:headscale-key', pattern: /hskey-auth-[A-Za-z0-9_-]{10,}/g },
  { id: 'secret:tailscale-key', pattern: /tskey-[A-Za-z0-9_-]{10,}/g },
  { id: 'secret:github-token', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { id: 'secret:gitlab-token', pattern: /glpat-[A-Za-z0-9_-]{15,}/g },
  { id: 'secret:anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'secret:openai-key', pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g },
  { id: 'secret:slack-token', pattern: /xox[bpsa]-[A-Za-z0-9-]{10,}/g },
  { id: 'secret:google-client-secret', pattern: /GOCSPX-[A-Za-z0-9_-]{10,}/g },
  { id: 'secret:digitalocean-token', pattern: /dop_v1_[a-f0-9]{40,}/g },
  { id: 'secret:shopify-token', pattern: /shpat_[a-f0-9]{32}/g },
  { id: 'secret:signed-jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { id: 'secret:assignment', pattern: /\b(?:api[_-]?key|secret(?:[_-]?key)?|password|passwd|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|service[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9_\-/+.]{16,}/gi },
]);

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HOUSE_ADDRESSES = Object.freeze(['maintainer@emeraldcoastsystemsgroup.com']);
// Role mailboxes are not a person's identifier: the product and maintainer mailboxes, and the
// conventional shared inboxes. A first-name mailbox at the business domain is still a person.
const ROLE_LOCAL_PARTS = /^(?:no-?reply|noreply|support|security|admin|info|hello|contact|oshal|oss|maintainer)$/i;
// Reserved and fixture domains documentation uses on purpose (RFC 2606/6761 plus `.local`).
const EXAMPLE_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|localhost|invalid|local)$/i;
const SUBJECT_KEYS = '(?:sub|user_sub|owner_sub|caller_sub|target_sub|userSub|ownerSub|callerSub|targetSub|subject|oid|objectId|object_id)';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Concrete identifier shapes. Prose such as "user-facing" or "session-engine" never matches. */
const IDENTIFIER_RULES = Object.freeze([
  { id: 'identifier:personal-email', find: (text) => firstPersonalEmail(text) },
  { id: 'identifier:oidc-subject', pattern: /\b(?:google-oauth2|auth0|windowslive|samlp|waad|github|okta|azuread|oauth2|facebook|apple|linkedin)\|[A-Za-z0-9._@-]{6,}/g },
  { id: 'identifier:subject-value', pattern: new RegExp(`\\b${SUBJECT_KEYS}\\b\\W{0,5}(?:\\d{15,25}|${UUID})\\b`, 'gi') },
  { id: 'identifier:numeric-subject', pattern: /\b\d{21}\b/g },
  { id: 'identifier:phone-number', find: (text) => firstPhoneNumber(text) },
]);

/** The publish gate's own per-line exemptions: placeholders, documented shapes and known fake fixtures. */
const SECRET_EXEMPT_LINE = /REPLACE_ME|CHANGE_ME|example|placeholder|<[^>]+>|MIIBOgIBAAJBAK|['"]-----BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY/i;
const IDENTIFIER_EXEMPT_LINE = /example-user-sub|REDACTED|internal\.example\.com/i;
const PHONE = /(?:\+[1-9]\d{0,2}[ .-]?)?\(?\b[2-9]\d{2}\)?[ .-]\d{3}[ .-]\d{4}\b|\+[1-9]\d{9,14}\b/g;

function firstPersonalEmail(text) {
  for (const match of text.matchAll(EMAIL)) {
    const address = match[0].toLowerCase();
    const [local, domain] = address.split('@');
    if (HOUSE_ADDRESSES.includes(address) || ROLE_LOCAL_PARTS.test(local) || EXAMPLE_DOMAIN.test(domain)) continue;
    return { index: match.index, length: match[0].length };
  }
  return null;
}

function firstPhoneNumber(text) {
  for (const match of text.matchAll(PHONE)) {
    const digits = match[0].replace(/\D/g, '');
    // 555-01xx is the reserved fictional exchange; documentation examples use it on purpose.
    if (/555\d{4}$/.test(digits)) continue;
    return { index: match.index, length: match[0].length };
  }
  return null;
}

function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

function firstHit(text, rule, exempt) {
  if (rule.find) {
    const hit = rule.find(text);
    return hit && !exempt.test(lineAt(text, hit.index)) ? hit : null;
  }
  rule.pattern.lastIndex = 0;
  for (const match of text.matchAll(rule.pattern)) {
    if (!exempt.test(lineAt(text, match.index))) return { index: match.index, length: match[0].length };
  }
  return null;
}

/** Translate the POSIX classes an ERE line may use into JavaScript syntax. */
function fromPosix(line) {
  return line
    .replace(/\[\[:space:\]\]/g, '\\s').replace(/\[\[:alnum:\]\]/g, '[A-Za-z0-9]').replace(/\[\[:alpha:\]\]/g, '[A-Za-z]')
    .replace(/\[\[:digit:\]\]/g, '\\d').replace(/\[\[:upper:\]\]/g, '[A-Z]').replace(/\[\[:lower:\]\]/g, '[a-z]');
}

/**
 * @description Load the operator's gitignored identifier patterns when the checkout carries them.
 * A present-but-unreadable or non-compiling file fails closed: the build stops rather than running
 * with fewer rules than the publish gate. The pattern text is never returned, logged or stored;
 * callers see only a count.
 * @param {{checkoutRoot?: string, file?: string}} options Where to look; `file` overrides the checkout default.
 * @returns {{source: string|null, count: number, rules: Array<{id: string, pattern: RegExp}>}} Compiled local rules.
 */
function loadLocalIdentifierRules({ checkoutRoot, file } = {}) {
  const source = file || (checkoutRoot ? path.join(checkoutRoot, LOCAL_PATTERNS_FILE) : null);
  if (!source || !fs.existsSync(source)) return { source: null, count: 0, rules: [] };
  let text;
  try { text = fs.readFileSync(source, 'utf8'); } catch (error) {
    throw new Error(`local identifier patterns are present but unreadable (${error.code || 'read error'}); refusing to index with fewer rules than the publish gate`);
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !/^\s*#/.test(line));
  const rules = lines.map((line, index) => {
    try { return { id: LOCAL_RULE_ID, pattern: new RegExp(fromPosix(line.trim()), 'gi') }; } catch {
      throw new Error(`local identifier pattern ${index + 1} does not compile; refusing to index with fewer rules than the publish gate`);
    }
  });
  return { source, count: rules.length, rules };
}

/**
 * @description Assemble the full rule set for one build.
 * @param {{checkoutRoot?: string, localPatternsFile?: string}} options Checkout used to locate the local patterns.
 * @returns {{secret: object[], identifier: object[], local: {source: string|null, count: number, rules: object[]}}} Rules by family.
 */
function buildRules({ checkoutRoot, localPatternsFile } = {}) {
  return { secret: SECRET_RULES, identifier: IDENTIFIER_RULES, local: loadLocalIdentifierRules({ checkoutRoot, file: localPatternsFile }) };
}

/**
 * @description Find the first rule a text violates, secrets first, then identifiers, then local patterns.
 * @param {string} text Candidate document or chunk text.
 * @param {ReturnType<typeof buildRules>} rules Rules from buildRules().
 * @returns {string|null} The violated rule id, or null when the text is clean.
 */
function violatedRule(text, rules) {
  for (const rule of rules.secret) if (firstHit(text, rule, SECRET_EXEMPT_LINE)) return rule.id;
  for (const rule of rules.identifier) if (firstHit(text, rule, IDENTIFIER_EXEMPT_LINE)) return rule.id;
  for (const rule of rules.local.rules) if (firstHit(text, rule, IDENTIFIER_EXEMPT_LINE)) return rule.id;
  return null;
}

/**
 * @description Rescan every emitted chunk, title and path of a built index. This is the guard that
 * goes red: a secret-shaped or identifier-carrying chunk that reached the index is a build failure,
 * whatever earlier rule should have caught it.
 * @param {{documents: Array<{doc_id: string, path: string, title: string, chunks: Array<{chunk_id: string, text: string}>}>}} index A built index.
 * @param {ReturnType<typeof buildRules>} rules Rules from buildRules().
 * @returns {Array<{doc_id: string, path: string, chunk_id: string|null, rule: string}>} Every hit; empty when clean.
 */
function scanIndex(index, rules) {
  const hits = [];
  for (const doc of index.documents || []) {
    const header = violatedRule(`${doc.title}\n${doc.path}`, rules);
    if (header) hits.push({ doc_id: doc.doc_id, path: doc.path, chunk_id: null, rule: header });
    for (const chunk of doc.chunks || []) {
      const rule = violatedRule(chunk.text, rules);
      if (rule) hits.push({ doc_id: doc.doc_id, path: doc.path, chunk_id: chunk.chunk_id, rule });
    }
  }
  return hits;
}

/**
 * @description Throw when a built index carries any guarded content. The error names only paths,
 * chunk ids and rule ids, never the matched text.
 * @param {object} index A built index.
 * @param {ReturnType<typeof buildRules>} rules Rules from buildRules().
 * @returns {object} The same index when it is clean.
 */
function assertIndexClean(index, rules) {
  const hits = scanIndex(index, rules);
  if (hits.length) {
    const error = new Error(`developer workspace index refused: ${hits.length} guarded chunk(s) reached the index`);
    error.code = 'DEV_WORKSPACE_GUARD';
    error.hits = hits;
    throw error;
  }
  return index;
}

module.exports = {
  IDENTIFIER_RULES, LOCAL_PATTERNS_FILE, LOCAL_RULE_ID, SECRET_RULES,
  assertIndexClean, buildRules, loadLocalIdentifierRules, scanIndex, violatedRule,
};
