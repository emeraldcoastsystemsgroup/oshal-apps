/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-135 D14 — the recommendation builder, as PURE functions so the decision logic is testable without a database, a stack or a model. Deliberately deterministic in v1: every proposed destination carries a reason a person can evaluate ("equipment IDs and service intervals"), never an opaque score, because the form exists so a human can disagree with it. Ownership is never inferred here — a rule's suggested user and a sidecar's requestingUser are HINTS surfaced for display, and the caller decides owner_sub elsewhere (D8). Admin rules pre-tick, they do not approve, and the swarm-wide destination is filtered out entirely for a non-admin approver rather than offered and failed at write time.
 *
 * @module print-classify
 */

/** A place a document can be filed. `kind` decides the RAG collection and who can read it. */
export interface Destination {
  id: string;
  label: string;
  kind: 'private' | 'bot' | 'swarm';
  /** RAG collection this destination writes to. */
  collection: string;
  /** Bot this destination belongs to, for `kind: 'bot'`. */
  botId?: string;
  /** Keywords that make a document relevant to this destination (bot destinations). */
  topics?: string[];
  /** Shown at the point of choice. A bot corpus has no access control — say so. */
  readableBy: string;
}

/** One proposed destination, as the approval form renders it. */
export interface Proposal {
  id: string;
  label: string;
  kind: Destination['kind'];
  recommended: boolean;
  confidence: 'high' | 'medium' | 'low';
  /** Human-evaluable justification. Never a bare number. */
  reason: string;
  readableBy: string;
}

/** The sidecar the printer wrote. Every field is untrusted LAN input. */
export interface PrintSidecar {
  jobName?: string;
  documentName?: string;
  requestingUser?: string;
  originatingComputer?: string;
  clientIp?: string;
  printerName?: string;
  source?: string;
  receivedAt?: string;
  textCharacters?: number;
  textPages?: number;
}

/** An admin association rule (D16). */
export interface AssociationRule {
  ruleId: string;
  label: string;
  matchClientIp?: string | null;
  matchComputer?: string | null;
  matchPrinter?: string | null;
  suggestedUserSub?: string | null;
  destinations: string[];
  autoApprove: boolean;
  enabled: boolean;
}

export interface RecommendationInput {
  sidecar: PrintSidecar;
  text: string;
  destinations: Destination[];
  rules: AssociationRule[];
  /** Non-admin approvers are not offered the kernel-reserved swarm level. */
  callerIsAdmin: boolean;
}

export interface Recommendation {
  title: string;
  proposals: Proposal[];
  /** The rule that matched, if any — recorded so a bad rule is discoverable later. */
  appliedRule: { ruleId: string; label: string; autoApprove: boolean } | null;
  /** A rule's suggested owner. A HINT for display; never authority (D8). */
  suggestedUserSub: string | null;
}

const MAX_TITLE = 120;
/** Below this, a keyword hit is coincidence rather than subject matter. */
const STRONG_TOPIC_HITS = 2;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * @description The destinations this deployment offers. The two shared levels are
 * fixed; bot destinations are CONFIGURATION, so adding a bot never needs a release:
 * PRINT_INGEST_BOT_DESTINATIONS holds `id|Label|collection|topic,topic` entries
 * separated by `;`. A malformed entry is dropped rather than half-registered — a
 * destination with no collection would fail at write time, after a person believed
 * they had filed the document.
 * @param env - Environment to read (injectable for tests).
 * @returns The destination catalog.
 */
export function destinationCatalog(env: NodeJS.ProcessEnv = process.env): Destination[] {
  const catalog: Destination[] = [
    {
      id: 'private',
      label: 'Private to me',
      kind: 'private',
      collection: 'my-knowledge',
      readableBy: 'only you',
    },
    {
      id: 'swarm',
      label: 'Swarm knowledge',
      kind: 'swarm',
      collection: 'swarm-knowledge',
      readableBy: 'everyone signed in to this swarm',
    },
  ];
  for (const entry of String(env.PRINT_INGEST_BOT_DESTINATIONS || '').split(';')) {
    const [id, label, collection, topics] = entry.split('|').map((part) => String(part || '').trim());
    if (!SAFE_ID.test(id || '') || !label || !collection) continue;
    if (catalog.some((existing) => existing.id === id)) continue;
    catalog.push({
      id,
      label,
      kind: 'bot',
      collection,
      botId: id,
      topics: (topics || '').split(',').map((t) => t.trim()).filter(Boolean),
      // Stated at the point of choice: a bot corpus is routing, not privacy.
      readableBy: 'everyone signed in — a bot corpus is routing, not privacy',
    });
  }
  return catalog;
}

/**
 * @description Whether an identity is an operator, read from the SAME allowlist the
 * kernel uses (`OSHAL_OPERATOR_SUBS` / `OSHAL_OPERATOR_EMAILS`). Found by live test:
 * an OIDC `roles` claim is the wrong signal — a personal-access-token session
 * carries no roles, so a genuine operator was silently denied the swarm
 * destination. Subs compare exactly (an OIDC subject is case-sensitive); emails
 * compare case-insensitively, matching how the allowlist is written.
 * @param sub - The caller's subject, if any.
 * @param email - The caller's email, if any.
 * @param env - Environment to read (injectable for tests).
 * @returns True when the identity is on the operator allowlist.
 */
export function isOperatorIdentity(
  sub: string | null | undefined,
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const list = (raw: string | undefined) =>
    String(raw || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (sub && list(env.OSHAL_OPERATOR_SUBS).includes(String(sub))) return true;
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return list(env.OSHAL_OPERATOR_EMAILS).some((entry) => entry.toLowerCase() === normalized);
}

/**
 * @description The destinations a given caller may file into. The kernel-reserved
 * swarm level is withheld from a non-admin rather than offered and refused at
 * write time — a missing option beats a write that fails after the fact.
 * @param catalog - The full catalog.
 * @param callerIsAdmin - Whether the caller is an operator/admin.
 * @returns The permitted destinations.
 */
export function destinationsForCaller(catalog: Destination[], callerIsAdmin: boolean): Destination[] {
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
export function proposeTitle(sidecar: PrintSidecar, text: string): string {
  const generic = /^(document|untitled|print|printout|page \d+|microsoft word - document\d*)$/i;
  for (const candidate of [sidecar.jobName, sidecar.documentName]) {
    const value = String(candidate || '').trim();
    if (value && !generic.test(value)) return value.slice(0, MAX_TITLE);
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
export function ruleMatches(rule: AssociationRule, sidecar: PrintSidecar): boolean {
  if (!rule.enabled) return false;
  const criteria: Array<[string | null | undefined, string | undefined]> = [
    [rule.matchClientIp, sidecar.clientIp],
    [rule.matchComputer, sidecar.originatingComputer],
    [rule.matchPrinter, sidecar.printerName],
  ];
  const declared = criteria.filter(([want]) => String(want || '').trim().length > 0);
  if (declared.length === 0) return false;
  return declared.every(([want, got]) =>
    String(want).trim().toLowerCase() === String(got || '').trim().toLowerCase());
}

/**
 * @description Count how many of a destination's topics the document mentions,
 * and name the ones that hit so the reason can quote them back.
 * @param text - The document's extracted text.
 * @param topics - The destination's topic keywords.
 * @returns The matched topics, in declaration order.
 */
function matchedTopics(text: string, topics: string[]): string[] {
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
function proposeBot(destination: Destination, text: string, ruleDestinations: Set<string>): Proposal {
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
export function buildRecommendation(input: RecommendationInput): Recommendation {
  const rule = input.rules.find((candidate) => ruleMatches(candidate, input.sidecar)) || null;
  const ruleDestinations = new Set(rule ? rule.destinations : []);
  const available = destinationsForCaller(input.destinations, input.callerIsAdmin);

  const proposals = available.map((destination) => {
    if (destination.kind === 'bot') return proposeBot(destination, input.text, ruleDestinations);
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
      } as Proposal;
    }
    return {
      id: destination.id,
      label: destination.label,
      kind: destination.kind,
      recommended: byRule,
      confidence: byRule ? 'high' : 'low',
      reason: byRule
        ? 'an administrator rule files documents from this source here'
        : 'everyone in this swarm would be able to retrieve it — tick only if that is intended',
      readableBy: destination.readableBy,
    } as Proposal;
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
export function ruleMayAutoApprove(recommendation: Recommendation, destinations: Destination[]): boolean {
  if (!recommendation.appliedRule?.autoApprove) return false;
  const swarmIds = new Set(destinations.filter((d) => d.kind === 'swarm').map((d) => d.id));
  return !recommendation.proposals.some((p) => p.recommended && swarmIds.has(p.id));
}
