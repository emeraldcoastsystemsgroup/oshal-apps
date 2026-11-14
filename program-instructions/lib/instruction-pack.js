/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0 (T76): the pure half of the instruction writer. requestText builds the one request the writer bot gets for a program version (under 4 KiB, from fields of a closed shape only, so nothing a computer reported reaches a model as free text); bodyOf takes the bot's answer as it stands, less one outer code fence; checkBody applies the kernel's rules for instruction text before the package offers it for publication. The kernel's own check decides; this copy keeps a text the kernel would refuse from being offered. Nothing here repairs, pads or rewrites an answer.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0, before any delivery: checkBody follows the kernel's check as built (oshal-kernel crates/nodes/src/program_profiles.rs, validate_body and names_only_allowed). A `computer.<name>` word outside the contract's tools is refused anywhere in the text, not only between backticks (words break at anything but an ASCII letter, a digit, a full stop or an underscore, and trailing full stops are dropped, so "the computer." is fine and "computer.app." is computer.app). http://, https:// and file:/ are refused anywhere, whatever their ASCII case. "action":"<name>" is read with all white space removed. A block opened with ```tool_call or ```handoff is refused wherever it stands and whatever its ASCII case; the first version also refused other fence spellings (~~~, a space after the fence), which the kernel accepts, and no longer does. The tools, the actions and the size bounds are still taken from the request's contract, which the kernel fills from the same constants its own check uses (crates/oshald/src/application_profiles.rs). The first version read tools between backticks only and `file:` only as a word, so a text the kernel refuses could have been offered for publication.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0, before any delivery: checkBody refuses a text that carries the prompt's data-fence marks, `<<untrusted` or `<<end untrusted` in any ASCII case, as the kernel's check does since its commit 034044f4 (validate_body: "instruction text imitates the prompt's data fence"). The kernel's prompt fence removes an imitation itself; a text that carries one is not offered for publication.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0, before any delivery: a pack names only verbs a bridge really has. lib/bridge-verbs.json (distilled by scripts/bridge-verbs.cjs from Lane G's bridge fact sheet) lists each bridge's declared verb ids by document kind. requestText lists the verbs of the request's bridge for the program's document kind, or says none are known (windows-uia today); checkBody refuses "declared": "<id>" (read with white space removed) for an id that bridge does not list for the program, and any such form for a bridge with no entry. This is stricter than the kernel's check on purpose: the kernel bounds tools and actions, not declared verbs.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0, before any delivery: a contract may list at most 8 tools and 16 actions (was 16 and 32; the kernel's lists 2 and 9), so the largest accepted request with LibreOffice's every declared verb stays under 4 KiB (it measured 4,213 bytes with the old bounds).
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: the measured facts. The text 0.1.0 published on the test slot for LibreOffice Writer 24.2.7 on Linux (2026-11-13) passed every rule here and lacked four of the eight words Lane G's pack inputs require (add-on, "part", whole, verified): the request gave the bot the bridge's verbs and nothing measured. lib/program-facts.json (distilled by scripts/program-facts.cjs from pack-inputs.json) holds, for a program on its platform and bridge, the facts a text says, what it never says, and the words it must and must not hold. requestText carries them (factLines) and acceptanceProblem holds a text to the words; a program with no entry is asked and checked as before. The request bound is 8 KiB (was 4 KiB, a bound of this package only; the kernel's plain-completion rail takes 256 KiB): Writer's facts make its request 6,028 bytes.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: detailOf makes the one line a failure report carries (the kernel keeps it on the row since Lane A3's kernel change): white space folded to single spaces, at most MAX_DETAIL_CHARS (240) characters as the kernel counts them, none when nothing is left.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 0.1.2, production's first runs for LibreOffice Writer 24.2.7 (2026-11-13): attempts 1 and 2 were refused because the text quoted the request's own form "declared": "<id>"; a name that is not a verb-name shape (lowercase letters, digits and hyphens, starting with a letter, at most 64) is now not taken for a verb, and a verb-shaped name the bridge does not list is still refused. Attempt 3 lacked "part" in quotation marks: the request's list of required words is now a "use each of these words" list that says quotation marks are part of a word. retryText builds the second request when the package's own check refused the first answer.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | 0.1.3 (Lane A4, T76 on Windows): the kernel keeps rows for the Windows 11 Notepad, Word and Excel, all through the windows-uia bridge, which had no entry here, so a Word text naming Word's own format-text was refused and its request said no declared verbs were known. lib/bridge-verbs.json now has windows-uia (Word's six edit verbs and Excel's seven spreadsheet verbs, as Orbit's Windows bridge declares them, and none for any other window) and lib/program-facts.json the three programs' measured facts; PROGRAM_KINDS reads winword.exe and excel.exe in a key, so Word's request lists only Word's verbs and Excel's only Excel's.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | 0.1.4 (Lane A5): the kernel keeps a row for PowerPoint (microsoft.office.powerpnt.exe.15) through windows-uia, and Orbit's Windows bridge declares six slide verbs for it (the Windows board's W10). PROGRAM_KINDS reads powerpnt.exe in a key as a presentation, so PowerPoint's request lists only its slide verbs; before it, no kind matched, the sheet's catch-all kind had none, and a text naming add-slide was refused.
 */

'use strict';

/** The request text stays under this many UTF-8 bytes. */
const MAX_REQUEST_BYTES = 8192;
/** The kernel's bounds for instruction text, used when a contract does not carry its own. */
const DEFAULT_MIN_BYTES = 200;
const DEFAULT_MAX_BYTES = 8192;
/** The most characters of a failure's one-line detail, as the kernel keeps it (nodes::program_profiles::MAX_DETAIL_CHARS). */
const MAX_DETAIL_CHARS = 240;
/** The reasons the kernel accepts for a version whose text was not written. */
const REASONS = Object.freeze(['model-refused', 'invalid-output', 'over-budget', 'timeout']);

/** The closed shape of each identifying field, as the kernel keeps it. */
const FIELD_SHAPES = Object.freeze({
  program: /^[a-z0-9.-]{1,64}$/,
  version: /^[0-9A-Za-z._+-]{1,64}$/,
  version_kind: /^(?:package|file)$/,
  platform: /^[a-z0-9-]{1,32}$/,
  bridge: /^[a-z0-9.-]{1,32}$/
});
const TOOL_NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
const ACTION_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
/**
 * The most tools and actions a contract may list for the request to be built. The kernel's contract lists 2 tools and
 * 9 actions (crates/nodes/src/program_profiles.rs TOOLS, crates/oshald/src/computer_apps.rs APP_ACTIONS); these leave
 * room for growth while every accepted request, with every declared verb a bridge lists, stays under 4 KiB.
 */
const MAX_TOOLS = 8;
const MAX_ACTIONS = 16;
/** Every character the Unicode control category holds except newline and tab. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;
/** Half of a surrogate pair standing alone: text that has no UTF-8 form. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** What the kernel looks for, as plain text anywhere in the ASCII-lowercased body. */
const DIRECTIVE_MARKS = Object.freeze(['```tool_call', '```handoff']);
const ADDRESS_MARKS = Object.freeze(['http://', 'https://', 'file:/']);
/** The marks the kernel's prompt fences data with (its untrusted.rs); a text may not imitate either. */
const FENCE_MARKS = Object.freeze(['<<untrusted', '<<end untrusted']);
/** What ends a word when the kernel reads tool names: anything but an ASCII letter, a digit, a full stop or an underscore. */
const WORD_BREAK = /[^A-Za-z0-9._]+/;
const TOOL_PREFIX = 'computer.';
/** White space as the kernel removes it before it reads actions (the Unicode White_Space set). */
const WHITE_SPACE = /[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;
const ACTION_OPEN = '"action":"';
/** A declared verb id as the kernel bounds it; anything else (a placeholder such as <id>) names no verb. */
const VERB_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const DECLARED_OPEN = '"declared":"';
/** Each bridge's declared verb ids by document kind, distilled from the bridge fact sheet (scripts/bridge-verbs.cjs). */
const BRIDGE_VERBS = require('./bridge-verbs.json');
/** Measured facts and acceptance words by program, platform and bridge, distilled from the pack inputs (scripts/program-facts.cjs). */
const PROGRAM_FACTS = require('./program-facts.json');
/**
 * The document kind a program key names, by the words Orbit reads in a LibreOffice binding's key (desktop/oshal-node
 * src/main/bridges/libreoffice.ts: `appKey.includes('calc') ? 'spreadsheet' : 'text'`; Draw and Impress are drawings
 * and presentations there), and by the program file of Word and Excel in the keys Orbit gives them on Windows
 * (microsoft.office.winword.exe.15, microsoft.office.excel.exe.15; windows-word.ts isWord and windows-excel.ts isExcel
 * tell their windows by winword.exe and excel.exe), and of PowerPoint (microsoft.office.powerpnt.exe.15;
 * windows-powerpoint.ts isPowerPoint tells its windows by powerpnt.exe).
 */
const PROGRAM_KINDS = Object.freeze([
  ['writer', 'text'], ['calc', 'spreadsheet'], ['impress', 'presentation'], ['draw', 'drawing'],
  ['winword.exe', 'text'], ['excel.exe', 'spreadsheet'], ['powerpnt.exe', 'presentation']
]);
/** The sheet's label for a bridge's catch-all kind ("any other window"). */
const OTHER_KIND = 'any other';
const OUTER_FENCE = /^(`{3,}|~{3,})[ \t]*(?:markdown|md)?[ \t]*\n([\s\S]*)\n\1[ \t]*$/i;

/**
 * @description A request that cannot be turned into a bot request, named so the caller can tell it from a refusal.
 * @param {string} message What is wrong, without the offending value.
 * @returns {Error} The error, with code instruction_request_invalid.
 */
function unusable(message) {
  return Object.assign(new Error(message), { code: 'instruction_request_invalid' });
}

/**
 * @description A list of names of one closed shape, each once.
 * @param {unknown} list What the contract carried. @param {RegExp} shape The shape of one name.
 * @param {string} label The field, for the refusal. @param {number} most The most names kept.
 * @returns {string[]} The names. @throws {Error} When it is not such a list.
 */
function names(list, shape, label, most) {
  const ok = Array.isArray(list) && list.length > 0 && list.length <= most
    && list.every((name) => typeof name === 'string' && shape.test(name))
    && new Set(list).size === list.length;
  if (!ok) throw unusable(`The request's contract has no usable list of ${label}.`);
  return list.slice();
}

/**
 * @description The size bounds a contract carries, or the kernel's own when it carries none it can use.
 * @param {object|null|undefined} contract The request's contract.
 * @returns {{min: number, max: number}} The bounds in UTF-8 bytes.
 */
function boundsOf(contract) {
  const min = contract && contract.min_bytes;
  const max = contract && contract.max_bytes;
  const usable = Number.isInteger(min) && Number.isInteger(max) && min > 0 && min <= max;
  return usable ? { min, max } : { min: DEFAULT_MIN_BYTES, max: DEFAULT_MAX_BYTES };
}

/**
 * @description The identifying fields of a request, each checked against its closed shape.
 * @param {object} request One request of the kernel's claim answer.
 * @returns {object} { program, version, version_kind, platform, bridge }. @throws {Error} When a field is not of its shape.
 */
function subjectOf(request) {
  const subject = {};
  for (const [field, shape] of Object.entries(FIELD_SHAPES)) {
    const value = request ? request[field] : undefined;
    if (typeof value !== 'string' || !shape.test(value)) throw unusable(`The request's ${field} is not of the shape the kernel keeps.`);
    subject[field] = value;
  }
  return subject;
}

/**
 * @description The request's lines about declared verbs: the bridge's verbs for the program by document kind and the
 *   one form they may be named in, or that none are known.
 * @param {object} subject The request's checked fields. @param {object} verbs The distilled bridge verbs.
 * @returns {string[]} The lines.
 */
function declaredLines(subject, verbs) {
  const known = verbsFor(subject.bridge, subject.program, verbs);
  if (!known || known.ids.length === 0) {
    const whose = known ? `this program on the ${subject.bridge} bridge` : `the ${subject.bridge} bridge`;
    return [`- No declared verbs are known for ${whose}: describe only the actions above, and never write "declared".`];
  }
  return [
    `- Declared verbs the ${subject.bridge} bridge has for this program, by document kind:`,
    ...known.kinds.filter(([, ids]) => ids.length).map(([kind, ids]) => `  - ${kind}: ${ids.join(', ')}`),
    '- Name a declared verb only in the form "declared": "<id>" and only one listed here. Name no other declared verb.'
  ];
}

/**
 * @description What is measured for a request's program on its platform and bridge, or null when nothing is. The pack
 *   inputs measure a program through one bridge on one platform, so all three must match.
 * @param {object} request A request or its checked fields (platform, program, bridge).
 * @param {object} [facts] The distilled program facts (the package's own by default).
 * @returns {object|null} { platform, program, bridge, facts, never, contains, absent } or null.
 */
function factsFor(request, facts = PROGRAM_FACTS) {
  const list = facts && Array.isArray(facts.programs) ? facts.programs : [];
  const match = (entry) => entry.platform === request?.platform && entry.program === request?.program && entry.bridge === request?.bridge;
  return list.find(match) || null;
}

/**
 * @description The request's lines with what is measured for the program on its platform and bridge: the facts to say,
 *   what never to say, and the words the text must and must not hold. None when nothing is measured for it.
 * @param {object} subject The request's checked fields. @param {object} facts The distilled program facts.
 * @returns {string[]} The lines.
 */
function factLines(subject, facts) {
  const known = factsFor(subject, facts);
  if (!known) return [];
  const list = (items) => items.map((item) => `  - ${item}`);
  return [
    '- Measured for this program on this bridge. Say each of these, in your own words where you like, and contradict none:',
    ...list(known.facts),
    '- Never write any of these:', ...list(known.never),
    '- Use each of these words in the text, character for character; where a word is shown in quotation marks, write the '
      + 'quotation marks too:', ...list(known.contains),
    '- The text must not hold any of these:', ...list(known.absent)
  ];
}

/**
 * @description The text the writer bot is asked with for one program version: who the reader is, what the text may
 *   name, what is measured for the program, what it must say when something is not known, and the size it must fit.
 * @param {object} request One request of the kernel's claim answer (program, version, version_kind, platform, bridge, contract).
 * @param {object} [verbs] The distilled bridge verbs (the package's own by default).
 * @param {object} [facts] The distilled program facts (the package's own by default).
 * @returns {string} The request text, under 8 KiB. @throws {Error} When the request cannot be used or the text would not fit.
 */
function requestText(request, verbs = BRIDGE_VERBS, facts = PROGRAM_FACTS) {
  const subject = subjectOf(request);
  const contract = request.contract;
  const tools = names(contract && contract.tools, TOOL_NAME, 'tools', MAX_TOOLS);
  const actions = names(contract && contract.actions, ACTION_NAME, 'actions', MAX_ACTIONS);
  const { min, max } = boundsOf(contract);
  const text = [
    'INSTRUCTION REQUEST',
    `program: ${subject.program}`,
    `version: ${subject.version} (${subject.version_kind})`,
    `platform: ${subject.platform}`,
    `bridge: ${subject.bridge}`,
    '',
    'Write the instruction data Jarvis reads before it works inside this program version on a person\'s computer.',
    'Jarvis works inside the program through the tool `computer.app` only.',
    '',
    'Rules for the text:',
    '- Markdown. The first line starts with "# " and names the program, the version and the platform.',
    `- Name only these tools, each in backticks: ${tools.map((tool) => `\`${tool}\``).join(', ')}. Name no other tool.`,
    '- Write no other word that starts with "computer." anywhere in the text, in backticks or not.',
    `- Name only these actions, each written as "action": "<name>": ${actions.join(', ')}. Name no other action.`,
    ...declaredLines(subject, verbs),
    ...factLines(subject, facts),
    '- Say plainly what is not known for this version. Write nothing you are not sure this version does.',
    `- At least ${min} bytes and under ${max} bytes of UTF-8.`,
    '- No web address and no file address: never write http://, https:// or file:/ anywhere.',
    '- No fenced block labelled tool_call or handoff. No control characters other than line breaks and tabs.',
    '- Answer with the document only: no preamble, no closing remark, no code fence around the whole answer.'
  ].join('\n');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes >= MAX_REQUEST_BYTES) throw unusable(`The instruction request would be ${bytes} bytes; it must stay under ${MAX_REQUEST_BYTES}.`);
  return text;
}

/**
 * @description The bot's answer as the text to check: trimmed, and without one outer Markdown code fence when the
 *   model wrapped its whole answer in one. Nothing else is changed.
 * @param {unknown} response The bot's answer (answer.response).
 * @returns {string} The text; empty when the answer is not text.
 */
function bodyOf(response) {
  if (typeof response !== 'string') return '';
  const text = response.trim();
  const wrapped = OUTER_FENCE.exec(text);
  return wrapped ? wrapped[2].trim() : text;
}

/**
 * @description Every `computer.<name>` word in the text, read as the kernel reads it: anywhere, in backticks or not,
 *   with trailing full stops dropped.
 * @param {string} body The instruction text.
 * @returns {string[]} The tool words, in order.
 */
function toolWords(body) {
  return body.split(WORD_BREAK).map((word) => word.replace(/\.+$/, '')).filter((word) => word.startsWith(TOOL_PREFIX));
}

/**
 * @description Every `"<field>":"<name>"` the text names, read as the kernel reads actions: with all white space removed.
 * @param {string} body The instruction text. @param {string} open The opening, such as `"action":"`.
 * @returns {string[]} The names, in order.
 */
function namedField(body, open) {
  const found = [];
  let rest = body.replace(WHITE_SPACE, '');
  for (let start = rest.indexOf(open); start !== -1; start = rest.indexOf(open)) {
    const after = rest.slice(start + open.length);
    const end = after.indexOf('"');
    if (end === -1) break;
    found.push(after.slice(0, end));
    rest = after.slice(end + 1);
  }
  return found;
}

/**
 * @description The first name the text uses that its contract does not list.
 * @param {string} body The instruction text. @param {object|null|undefined} contract The request's contract.
 * @returns {string|null} The reason, or null when every named tool and action is listed.
 */
function namingProblem(body, contract) {
  const listed = (list) => (Array.isArray(list) ? list.filter((name) => typeof name === 'string') : []);
  const tools = listed(contract && contract.tools);
  const actions = listed(contract && contract.actions);
  const tool = toolWords(body).find((word) => !tools.includes(word));
  if (tool !== undefined) return `the text names the tool ${tool.slice(0, 64)}, which the contract does not list`;
  const action = namedField(body, ACTION_OPEN).find((name) => !actions.includes(name));
  if (action !== undefined) return `the text names the action "${action.slice(0, 32)}", which the contract does not list`;
  return null;
}

/**
 * @description The document kinds of a bridge entry that apply to a program: the kind its key names (writer, calc,
 *   impress, draw, winword.exe, excel.exe, powerpnt.exe), else the bridge's catch-all kind ("any other window"), else every kind. With no program, every kind.
 * @param {object} entry A bridge entry of the distilled file. @param {string} [program] The program key.
 * @returns {Array<[string, string[]]>} The applying kinds and their verb ids, in the file's order.
 */
function applyingKinds(entry, program) {
  const kinds = Object.entries(entry.declared || {});
  if (typeof program !== 'string') return kinds;
  const named = PROGRAM_KINDS.find(([word]) => program.includes(word));
  const matched = named ? kinds.filter(([label]) => label === named[1] || label.startsWith(`${named[1]} `)) : [];
  if (matched.length) return matched;
  const other = kinds.filter(([label]) => label.startsWith(OTHER_KIND));
  return other.length ? other : kinds;
}

/**
 * @description The declared verbs a pack for this program may name: the bridge's applying kinds and the union of
 *   their ids, or null when the bridge has no entry.
 * @param {string} bridge The request's bridge word. @param {string} [program] The program key.
 * @param {object} [verbs] The distilled file (the package's own by default).
 * @returns {{kinds: Array<[string, string[]]>, ids: string[]}|null} The verbs, or null.
 */
function verbsFor(bridge, program, verbs = BRIDGE_VERBS) {
  const entry = typeof bridge === 'string' && verbs && verbs.bridges ? verbs.bridges[bridge] : undefined;
  if (!entry || !Object.prototype.hasOwnProperty.call(verbs.bridges, bridge)) return null;
  const kinds = applyingKinds(entry, program);
  return { kinds, ids: [...new Set(kinds.flatMap(([, ids]) => ids))] };
}

/**
 * @description The first declared verb the text names that its bridge does not list for the program. Stricter than
 *   the kernel's check on purpose: the kernel bounds tools and actions, not a bridge's declared verbs.
 * @param {string} body The instruction text. @param {string} bridge The bridge word. @param {string} [program] The program key.
 * @param {object} [verbs] The distilled file.
 * @returns {string|null} The reason, or null.
 */
function declaredProblem(body, bridge, program, verbs = BRIDGE_VERBS) {
  const named = namedField(body, DECLARED_OPEN).filter((id) => VERB_NAME.test(id));
  if (named.length === 0) return null;
  const known = verbsFor(bridge, program, verbs);
  const where = known ? `the ${bridge} bridge does not list it for this program` : 'no declared verbs are known for this bridge';
  const unknown = named.find((id) => !known || !known.ids.includes(id));
  return unknown === undefined ? null : `the text names the declared verb "${unknown.slice(0, 64)}", and ${where}`;
}

/**
 * @description Whether a text holds the words measured for its program on its platform and bridge: each required word
 *   as written, and none of the forbidden ones. Literal and case-sensitive, as the pack inputs' acceptance check is.
 * @param {string} body The checked text. @param {object} request The claimed request (platform, program, bridge).
 * @param {object} [facts] The distilled program facts (the package's own by default).
 * @returns {string|null} Null when it holds them or nothing is measured for the program; else what it lacks or holds.
 */
function acceptanceProblem(body, request, facts = PROGRAM_FACTS) {
  const known = factsFor(request, facts);
  if (!known) return null;
  const text = typeof body === 'string' ? body : '';
  const lacking = known.contains.filter((word) => !text.includes(word));
  if (lacking.length) return `the text lacks what the measured facts require: ${lacking.join(', ')}`;
  const held = known.absent.filter((word) => text.includes(word));
  return held.length ? `the text holds what the measured facts forbid: ${held.join(', ')}` : null;
}

/**
 * @description The kernel's rules for instruction text (validate_body as built), applied before the text is offered
 *   for publication, so a text the kernel would refuse is reported without a publication attempt.
 *   Then the package's own rule, stricter than the kernel's: a declared verb only as its bridge lists it for the program.
 * @param {unknown} body The text to check. @param {object|null|undefined} contract The request's contract (tools, actions, min_bytes, max_bytes).
 * @param {string} [bridge] The request's bridge word. @param {string} [program] The request's program key (every kind when absent).
 * @param {object} [verbs] The distilled bridge verbs (the package's own by default).
 * @returns {string|null} Null when the text passes; otherwise a short reason.
 */
function checkBody(body, contract, bridge, program, verbs = BRIDGE_VERBS) {
  if (typeof body !== 'string') return 'the answer is not text';
  if (LONE_SURROGATE.test(body)) return 'the text is not valid UTF-8';
  const bytes = Buffer.byteLength(body, 'utf8');
  const { min, max } = boundsOf(contract);
  if (bytes < min || bytes > max) return `the text is ${bytes} bytes; it must be ${min} to ${max}`;
  if (CONTROL.test(body)) return 'the text has a control character other than newline and tab';
  if (!body.startsWith('# ')) return 'the first line does not start with "# "';
  // The kernel lowers ASCII letters only before it looks for its marks; so does this.
  const low = body.replace(/[A-Z]+/g, (run) => run.toLowerCase());
  const directive = DIRECTIVE_MARKS.find((mark) => low.includes(mark));
  if (directive) return `the text has a fenced block labelled ${directive.slice(3)}`;
  const address = ADDRESS_MARKS.find((mark) => low.includes(mark));
  if (address) return `the text has a ${address} address`;
  if (FENCE_MARKS.some((mark) => low.includes(mark))) return 'the text imitates the prompt\'s data fence';
  return namingProblem(body, contract) || declaredProblem(body, bridge, program, verbs);
}

/**
 * @description The reason reported to the kernel when the writer bot's turn did not answer, read from the words the
 *   kernel or the bot rail refused with: a spending cap, a time limit, an empty answer, or anything else.
 * @param {unknown} error What the bot turn rejected with.
 * @returns {string} One of REASONS.
 */
function failureReason(error) {
  const words = String(error && error.message ? error.message : error || '').toLowerCase();
  if (/over[_ -]?budget/.test(words)) return 'over-budget';
  if (/timed out|timeout|time limit|deadline/.test(words)) return 'timeout';
  if (/empty (?:response|answer)/.test(words)) return 'invalid-output';
  return 'model-refused';
}

/**
 * @description The one line a failure report carries: the words of an error or a check, white space and control
 *   characters folded to single spaces, cut to the kernel's bound in characters.
 * @param {unknown} words An Error, a string, or nothing. @returns {string|null} The line, or null when nothing is left.
 */
function detailOf(words) {
  const text = words instanceof Error ? words.message : typeof words === 'string' ? words : '';
  const line = text.replace(/[\s\u0000-\u001F\u007F-\u009F]+/g, ' ').trim();
  return line ? [...line].slice(0, MAX_DETAIL_CHARS).join('') : null;
}

/**
 * @description The second request when the package's own check refused the first answer: the same request, then the
 *   refusal's own words (one line) and the instruction to write the whole document again.
 * @param {string} text The first request. @param {unknown} problem The check's words.
 * @returns {string|null} The request, or null when it would not fit the request bound.
 */
function retryText(text, problem) {
  const again = `${text}\n\nYour previous answer was not used: ${detailOf(problem)}. Write the whole document again and fix that.`;
  return Buffer.byteLength(again, 'utf8') < MAX_REQUEST_BYTES ? again : null;
}

module.exports = {
  detailOf, MAX_DETAIL_CHARS, retryText,
  requestText, bodyOf, checkBody, acceptanceProblem, failureReason, boundsOf, verbsFor, factsFor, BRIDGE_VERBS, PROGRAM_FACTS,
  REASONS, MAX_REQUEST_BYTES, DEFAULT_MIN_BYTES, DEFAULT_MAX_BYTES
};
