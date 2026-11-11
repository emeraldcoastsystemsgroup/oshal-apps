/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The routing the kernel runs on a person's request before any model call, over this store's manifests: candidates, scoring, ranking, claim grading and specialist selection from oshal-kernel crates/api/src/jarvis_routing.rs, and the declared vocabulary from crates/packages/src/persona_routing.rs. Review of PR #823: Eats' six "... place" phrases made the bare word "place" an Eats keyword (the kernel scores every word of a phrase on its own), so with "order" from "order food" Eats tied Intelligent Trades on "Place a buy order for 5 shares of Tesla" and took the model's hand-off of "Place a market order for NVDA". No store test could see it, because the scoring lived only in the kernel. Copied here because the store cannot run the kernel; the kernel's own suite (jarvis_routing_suite_tests.rs, over both stores) stays the authority. Used by scripts/jarvis-routing-words.test.mjs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | J-3 & J-6: include 'view inside' and 'viewinside' in Smart Home's hub/appliance names and phrases so View Inside camera requests claim Smart Home over Camera Ops.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLCHAIN = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(TOOLCHAIN, 'package.json'))('js-yaml');

/** A declared phrase found verbatim, a declared keyword, a capability or tool tag, the application's name. */
const PHRASE_WEIGHT = 3;
const KEYWORD_WEIGHT = 2;
const SUPPORTING_WEIGHT = 1;
const NAME_WEIGHT = 10;
/** One supporting word alone never owns a request; one keyword alone claims it only at STRONG_SCORE. */
const MINIMUM_SCORE = 2;
const STRONG_SCORE = 4;
/** The kernel's filler words: they count neither in a request nor inside a declared phrase. */
const STOP_WORDS = new Set(('the and for with that this from into inside your their then than when where while must '
  + 'should did were have had will can get got make what how who whom whose which why need more want please help show '
  + 'tell give user task you our ours yours are was not but all any its has').split(' '));
/** persona_routing.rs: the most entries one list keeps and the longest entry kept. */
const MAX_ENTRIES = 128;
const MAX_ENTRY_CHARS = 80;
/** A conversational application whose bot is the assistant itself is never a candidate. */
const ASSISTANT_BOTS = new Set(['oshal-assistant', 'jarvis', 'bot-oshal-assistant']);
/** Smart Home (`home`) is also called by its hub and appliance nouns. */
const HOME_NAMES = ['smartthings', 'smarthings', 'smart home', 'refrigerator', 'refriderator', 'fridge', 'family hub',
  'appliance', 'thermostat', 'view inside', 'viewinside'];
const HUB_PHRASES = ['smart home', 'family hub', 'home scene', 'fridge camera', 'refrigerator camera', 'smartthings camera', 'view inside'];
const HUB_TERMS = ['smartthings', 'smarthings', 'refrigerator', 'refriderator', 'fridge', 'appliance', 'appliances',
  'thermostat', 'viewinside', 'samsung'];

const bytes = (text) => Buffer.byteLength(text, 'utf8');

/**
 * @description Lowercase words separated by single spaces, split on anything but a letter, digit or apostrophe.
 * @param {string} text Any request or declared entry.
 * @returns {string} The normalized words.
 */
export function normalize(text) {
  return String(text).toLowerCase().split(/[^\p{Alphabetic}\p{N}']+/u)
    .map((word) => word.replace(/^'+|'+$/g, '')).filter(Boolean).join(' ');
}

/**
 * @description Whether a word says what a request is about: over two bytes, not filler, not a filler contraction.
 * @param {string} word One normalized word.
 * @returns {boolean} True when the word routes.
 */
export function meaningful(word) {
  return bytes(word) > 2 && !STOP_WORDS.has(word) && !STOP_WORDS.has(word.split("'")[0]);
}

/** The stem left after `suffix`, when it keeps three bytes. */
function stemOf(word, suffix) {
  if (!word.endsWith(suffix)) return null;
  const stem = word.slice(0, word.length - suffix.length);
  return bytes(stem) >= 3 ? stem : null;
}

/** A word and its plausible singular forms ("groceries" meets "grocery"). */
function nounForms(word) {
  const out = new Set([word]);
  const ies = stemOf(word, 'ies');
  if (ies) out.add(`${ies}y`);
  for (const suffix of ['es', 's']) {
    const stem = stemOf(word, suffix);
    if (stem) out.add(stem);
  }
  return out;
}

/** A word with its singular and base forms ("booking" meets "book", "shopping" meets "shop"). */
function forms(word) {
  const out = nounForms(word);
  for (const suffix of ['ing', 'ed']) {
    const stem = stemOf(word, suffix);
    if (!stem) continue;
    out.add(stem);
    out.add(`${stem}e`);
    if (bytes(stem) >= 4 && stem.at(-1) === stem.at(-2)) out.add(stem.slice(0, -1));
  }
  return out;
}

/** Whether two sets of forms share one. */
function meets(a, b) {
  for (const form of a) if (b.has(form)) return true;
  return false;
}

/** The forms of every meaningful word of every entry. */
function wordForms(entries) {
  const out = new Set();
  for (const entry of entries) {
    for (const word of normalize(entry).split(' ')) if (meaningful(word)) for (const form of forms(word)) out.add(form);
  }
  return out;
}

const HUB_FORMS = wordForms(HUB_TERMS);

/** The request, normalized once: its distinct meaningful words with their forms, and its text for phrases. */
class Ask {
  constructor(text) {
    const normalized = normalize(text);
    this.text = ` ${normalized} `;
    this.words = [...new Set(normalized.split(' ').filter(meaningful))].sort().map(forms);
  }

  /** A multi-word phrase with a meaningful word, found verbatim. */
  verbatim(phrase) {
    return phrase.includes(' ') && phrase.split(' ').some(meaningful) && this.text.includes(` ${phrase} `);
  }

  /** Phrases count once each; each distinct request word once, at its strongest declaration. */
  score(vocab) {
    let score = 0;
    for (const keyword of vocab.keywords) if (this.verbatim(normalize(keyword))) score += PHRASE_WEIGHT;
    const keywords = wordForms(vocab.keywords);
    const supporting = wordForms(vocab.supporting);
    for (const word of this.words) {
      if (meets(word, keywords)) score += KEYWORD_WEIGHT;
      else if (meets(word, supporting)) score += SUPPORTING_WEIGHT;
    }
    return score;
  }

  /** Named by a phrase or the name; Several by two one-word keywords or one at STRONG_SCORE; else Single or null. */
  claim(vocab, names) {
    const keywords = vocab.keywords.map(normalize);
    if (keywords.some((keyword) => this.verbatim(keyword)) || this.named(vocab, names)) return 'Named';
    const single = keywords.filter((keyword) => !keyword.includes(' ') && meaningful(keyword)).map(forms);
    const matched = this.words.filter((word) => single.some((keyword) => meets(word, keyword))).length;
    if (matched === 0) return null;
    return matched === 1 && this.score(vocab) < STRONG_SCORE ? 'Single' : 'Several';
  }

  /** A multi-word name verbatim, or a one-word keyword that is a word of the name, used as that noun. */
  named(vocab, names) {
    if (names.some((name) => this.verbatim(normalize(name)))) return true;
    const words = new Set(names.flatMap((name) => normalize(name).split(' ')));
    if (words.has('camera') && !words.has('smartthings') && this.mentionsHub()) return false;
    return vocab.keywords.map(normalize).some((keyword) => !keyword.includes(' ') && meaningful(keyword)
      && words.has(keyword) && this.usesNoun(keyword));
  }

  /** The word itself or its plural, never a verb inflection of it. */
  usesNoun(word) {
    return this.text.split(' ').some((typed) => nounForms(typed).has(word));
  }

  /** A SmartThings hub or connected appliance, which Smart Home owns over Camera Ops. */
  mentionsHub() {
    return HUB_PHRASES.some((phrase) => this.verbatim(phrase)) || this.words.some((word) => meets(word, HUB_FORMS));
  }
}

/** The kept entries of one declared list: strings, trimmed, cut to 80 characters, lowercased, distinct. */
function extend(into, declared) {
  if (!Array.isArray(declared)) return;
  for (const raw of declared) {
    if (typeof raw !== 'string') continue;
    const entry = [...raw.trim()].slice(0, MAX_ENTRY_CHARS).join('').toLowerCase();
    if (into.length < MAX_ENTRIES && entry && !into.includes(entry)) into.push(entry);
  }
}

/** A bot's packaged persona routing_keywords (a .yaml/.yml persona path only). */
function personaKeywords(app, bot) {
  const declared = bot.persona;
  if (typeof declared !== 'string' || !(declared.endsWith('.yaml') || declared.endsWith('.yml'))) return undefined;
  const definition = yaml.load(fs.readFileSync(path.join(app.dir, declared), 'utf8'));
  return definition && typeof definition === 'object' ? definition.routing_keywords : undefined;
}

/** The routing vocabulary of the named bots of one application, as persona_routing.rs reads it. */
function vocabulary(app, bots) {
  const vocab = { keywords: [], supporting: [] };
  for (const bot of app.manifest.bots || []) {
    if (!bot || typeof bot !== 'object' || typeof bot.name !== 'string' || !bots.includes(bot.name)) continue;
    extend(vocab.keywords, personaKeywords(app, bot));
    extend(vocab.keywords, bot.routingKeywords);
    extend(vocab.supporting, bot.capabilities);
  }
  for (const tool of app.manifest.tools || []) if (tool && typeof tool === 'object') extend(vocab.supporting, tool.routingTags);
  return vocab;
}

/** The names a person calls an application by. */
function namesOf(manifest) {
  const names = [manifest.name, ...(manifest.displayName ? [manifest.displayName] : [])];
  return manifest.name === 'home' ? [...names, ...HOME_NAMES] : names;
}

/** The bot of each phase of one declared workflow, in order ('' for a phase no bot runs). */
function phaseBots(raw) {
  if ('processDefinition' in raw || 'stages' in raw) {
    const graph = (raw.processDefinition || {}).nodeGraph || raw;
    if ('nodes' in graph) {
      return graph.nodes.flatMap((node) => {
        if (node.type === 'execute-agent') return [(node.config || {}).agentBinding || node.bot || ''];
        return node.type === 'deliver' ? [''] : [];
      });
    }
    return (raw.stages || []).map((stage) => stage.bot ?? '');
  }
  if (Array.isArray(raw.phases) && raw.phases.length) {
    return raw.phases.map((phase) => (typeof phase === 'string' ? raw.workerBot ?? '' : phase.bot || ''));
  }
  return [raw.workerBot ?? ''];
}

/** Each declared workflow of a manifest as [ticket type, phase bots]. */
function workflowsOf(manifest) {
  const raws = [];
  if (manifest.workflow != null) raws.push(manifest.workflow);
  if (manifest.workflows != null) raws.push(...(Array.isArray(manifest.workflows) ? manifest.workflows : [manifest.workflows]));
  return raws.filter((raw) => raw && typeof raw === 'object').map((raw) => {
    const declared = manifest.ticketType;
    const ticket = raw.ticket_type || raw.ticketType || (typeof declared === 'string' ? declared : (declared || {}).id);
    return [ticket, phaseBots(raw)];
  });
}

/** Every application manifest directly under a store root, in directory order. */
function manifestsUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name).sort()
    .map((name) => ({ dir: path.join(root, name), manifest: yaml.load(fs.readFileSync(path.join(root, name, 'oshal-app.yaml'), 'utf8')) }));
}

/** Bots declaring their own routingKeywords on the manifest entry. */
const keywordBots = (manifest) => (manifest.bots || [])
  .filter((bot) => bot && typeof bot === 'object' && 'routingKeywords' in bot && typeof bot.name === 'string').map((bot) => bot.name);

/** The chatBot a workflow application declares, only when it names one of its own bots. */
function declaredChatBot(manifest) {
  const chat = typeof manifest.chatBot === 'string' ? manifest.chatBot.trim() : '';
  return chat && (manifest.bots || []).some((bot) => bot && bot.name === chat) ? chat : null;
}

/** One candidate per registered workflow: its phase bots, declared chatBot and keyword bots scored together. */
function workflowCandidates(owners, catalog) {
  const out = [];
  for (const ticket of [...owners.keys()].sort()) {
    const [phases, name] = owners.get(ticket);
    const app = catalog.get(name);
    if (!app) continue;
    const chat = declaredChatBot(app.manifest);
    const bots = [...phases, ...(chat ? [chat] : []), ...keywordBots(app.manifest)];
    const bot = phases.find(Boolean) || null;
    out.push({ package: name, ticket, bot, chat, app, vocab: vocabulary(app, bots), names: namesOf(app.manifest) });
  }
  return out;
}

/** One candidate per application that converses through a declared bot and runs no workflow. */
function conversationalCandidates(catalog, withWorkflow) {
  const out = [];
  for (const name of [...catalog.keys()].sort()) {
    if (withWorkflow.has(name)) continue;
    const app = catalog.get(name);
    const chat = typeof app.manifest.chatBot === 'string' ? app.manifest.chatBot.trim() : '';
    const first = (app.manifest.bots || []).find((bot) => bot && typeof bot.name === 'string');
    const bot = chat || (first ? first.name : null);
    if (!bot || ASSISTANT_BOTS.has(bot.toLowerCase())) continue;
    const bots = [bot, ...keywordBots(app.manifest)];
    out.push({ package: name, ticket: null, bot, chat: bot, app, vocab: vocabulary(app, bots), names: namesOf(app.manifest) });
  }
  return out;
}

/**
 * @description Build the routing candidates of every application under the given store roots, as the kernel admits
 * them (a later root's package of the same name replaces an earlier one).
 * @param {string[]} roots Store checkouts, public first.
 * @returns {object[]} Candidates: package, ticket, bot, chat, vocab and names.
 */
export function loadCandidates(roots = [ROOT]) {
  const apps = roots.flatMap(manifestsUnder);
  const owners = new Map();
  for (const app of apps) for (const [ticket, phases] of workflowsOf(app.manifest)) owners.set(ticket, [phases, app.manifest.name]);
  const catalog = new Map(apps.map((app) => [app.manifest.name, app]));
  const withWorkflow = new Set([...owners.values()].map(([, name]) => name));
  return [...workflowCandidates(owners, catalog), ...conversationalCandidates(catalog, withWorkflow)];
}

const sameChatOwner = (a, b) => a.package === b.package && a.chat != null && a.chat === b.chat;

/** The unique best candidate scored on `ask`, named only where `naming` names it; a tie or a weak best owns nothing. */
function rankNamed(ask, naming, candidates) {
  const scored = candidates
    .map((candidate) => ({ candidate, score: ask.score(candidate.vocab) + (naming.named(candidate.vocab, candidate.names) ? NAME_WEIGHT : 0) }))
    .filter((entry) => entry.score >= MINIMUM_SCORE);
  scored.sort((a, b) => (b.score - a.score)
    || (sameChatOwner(a.candidate, b.candidate) ? Number(b.candidate.bot === b.candidate.chat) - Number(a.candidate.bot === a.candidate.chat) : 0)
    || (a.candidate.package < b.candidate.package ? -1 : a.candidate.package > b.candidate.package ? 1 : 0));
  if (!scored.length) return { kind: 'unowned' };
  const [best, ...rest] = scored;
  const tied = rest.filter((entry) => entry.score === best.score).some((entry) => !sameChatOwner(best.candidate, entry.candidate));
  return tied ? { kind: 'tied', score: best.score } : { kind: 'owner', score: best.score, candidate: best.candidate };
}

/** The specialist bot the lane hands a request to: a bot named verbatim, or one whose own words match more strongly. */
function selectBot(candidate, text) {
  const fallback = candidate.chat || candidate.bot || '?';
  const bots = (candidate.app.manifest.bots || []).filter((bot) => bot && typeof bot.name === 'string');
  if ((candidate.app.manifest.bots || []).length <= 1 || !text.trim()) return fallback;
  const ask = new Ask(text);
  const named = bots.find((bot) => bot.name !== fallback && normalize(bot.name) && ask.text.includes(` ${normalize(bot.name)} `));
  if (named) return named.name;
  const floor = ask.score(vocabulary(candidate.app, [fallback]));
  let best = null;
  for (const bot of bots) {
    if (!('routingKeywords' in bot) || bot.name === fallback) continue;
    const score = ask.score(vocabulary(candidate.app, [bot.name]));
    if (score > floor && score >= MINIMUM_SCORE && (!best || score > best.score)) best = { score, name: bot.name };
  }
  return best ? best.name : fallback;
}

/**
 * @description What the kernel decides for a person's own request before any model call: the application a strong
 * claim (Named or Several) hands it to, or why it is left to the model.
 * @param {object[]} candidates From loadCandidates.
 * @param {string} text The request.
 * @returns {{owner: string|null, bot?: string, claim?: string, score?: number, why?: string}} The decision.
 */
export function decide(candidates, text) {
  const ask = new Ask(text);
  const ranked = rankNamed(ask, ask, candidates);
  if (ranked.kind === 'unowned') return { owner: null, why: 'no application reaches the minimum score' };
  if (ranked.kind === 'tied') return { owner: null, why: `a tie at score ${ranked.score}` };
  const claim = ask.claim(ranked.candidate.vocab, ranked.candidate.names);
  if (claim === 'Named' || claim === 'Several') {
    return { owner: ranked.candidate.package, bot: selectBot(ranked.candidate, text), claim, score: ranked.score };
  }
  return { owner: null, why: `${ranked.candidate.package} scores ${ranked.score} but claims only ${claim || 'None'}` };
}

/**
 * @description The application the kernel gives the model's own hand-off of this text (`rank_handoff_step` with the
 * request as title and naming): the unique best score, whatever the claim, or null on a tie or no owner.
 * @param {object[]} candidates From loadCandidates.
 * @param {string} text The hand-off title.
 * @returns {string|null} The owning package.
 */
export function handoffOwner(candidates, text) {
  const ask = new Ask(text);
  const ranked = rankNamed(ask, ask, candidates);
  return ranked.kind === 'owner' ? ranked.candidate.package : null;
}

/**
 * @description The best-scoring applications for a text, for a readable assertion message.
 * @param {object[]} candidates From loadCandidates.
 * @param {string} text The request.
 * @param {number} shown How many to show.
 * @returns {string} "package=score" pairs, highest first.
 */
export function leaderboard(candidates, text, shown = 3) {
  const ask = new Ask(text);
  return candidates
    .map((c) => [ask.score(c.vocab) + (ask.named(c.vocab, c.names) ? NAME_WEIGHT : 0), c.package])
    .filter(([score]) => score > 0)
    .sort((a, b) => (b[0] - a[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .slice(0, shown).map(([score, name]) => `${name}=${score}`).join(' ');
}
