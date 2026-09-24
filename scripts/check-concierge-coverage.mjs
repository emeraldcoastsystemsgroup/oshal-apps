#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-23 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Require every package that contributes a cockpit surface to declare the concierge that owns its right rail. Discovery is whole-tree and the manifest projection is parsed structurally: comments and nested lookalike keys do not count, ui.static/ui.dynamic and ADR-141 toolbar surfaces are all covered, and a nonblank chatBot, workflow.workerBot or first bots[].name satisfies the contract. There is deliberately no exception list.
 * 2026-09-23 01:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Match YAML value semantics at the projection boundary: booleans, nulls, numbers and timestamps cannot masquerade as bot names; anchors, aliases, merge keys, tags and duplicate relevant keys fail closed at any nesting depth because this dependency-free reader cannot safely resolve them.
 * 2026-09-23 02:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Align surface classification with the runtime contract: toolbar is a cockpit surface only for kind group, while empty ui.dynamic remains headless and a non-empty dynamic declaration remains covered.
 * 2026-09-23 03:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Close parser-parity edges without rejecting ordinary prose: recognize structural indicators only at YAML node boundaries, mirror js-yaml implicit scalar resolution, refuse complex/undecodable keys and ambiguous flow bot maps, and fail closed on unsupported root shapes.
 *
 * Usage: node scripts/check-concierge-coverage.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Remove a YAML comment without treating a hash inside a quoted scalar as a comment. */
function stripComment(source) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (double) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') double = false;
      continue;
    }
    if (single) {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") single = false;
      continue;
    }
    if (char === '"') double = true;
    else if (char === "'") single = true;
    else if (char === '#' && (index === 0 || /\s/.test(source[index - 1]))) {
      return source.slice(0, index).trimEnd();
    }
  }
  return source.trimEnd();
}

/** Replace quoted YAML content so structural indicators can be inspected without false hits. */
function outsideQuotedScalars(source) {
  let result = '';
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (double) {
      result += ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') double = false;
      continue;
    }
    if (single) {
      result += ' ';
      if (char === "'" && source[index + 1] === "'") {
        result += ' ';
        index += 1;
      } else if (char === "'") single = false;
      continue;
    }
    if (char === '"') {
      double = true;
      result += ' ';
    } else if (char === "'") {
      single = true;
      result += ' ';
    } else result += char;
  }
  return result;
}

/** Decode the JSON-compatible subset of plain or quoted YAML mapping keys. */
function mappingKey(source) {
  const value = source.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return { key: value.slice(1, -1).replaceAll("''", "'"), supported: true };
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return { key: JSON.parse(value), supported: true }; } catch {
      return { key: '', supported: false };
    }
  }
  return { key: value, supported: true };
}

/** Find the mapping colon at this YAML level, ignoring quoted and flow-collection content. */
function mappingPair(source) {
  let single = false;
  let double = false;
  let escaped = false;
  let flowDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (double) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') double = false;
      continue;
    }
    if (single) {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") single = false;
      continue;
    }
    if (char === '"') double = true;
    else if (char === "'") single = true;
    else if (char === '[' || char === '{') flowDepth += 1;
    else if (char === ']' || char === '}') flowDepth = Math.max(0, flowDepth - 1);
    else if (char === ':' && flowDepth === 0 && (index + 1 === source.length || /\s/.test(source[index + 1]))) {
      const decoded = mappingKey(source.slice(0, index));
      return {
        key: decoded.key,
        keySupported: decoded.supported,
        value: source.slice(index + 1).trim(),
      };
    }
  }
  return null;
}

/** Parse the line/indentation structure needed by the manifest contract. */
function yamlRecords(source, label) {
  const records = [];
  const problems = [];
  let blockScalarIndent = null;
  source.split(/\r?\n/).forEach((raw, offset) => {
    const indentation = /^\s*/.exec(raw)?.[0] ?? '';
    if (indentation.includes('\t')) {
      problems.push(`${label}:${offset + 1}: tabs are not valid manifest indentation`);
      return;
    }
    const indent = indentation.length;
    if (blockScalarIndent !== null) {
      if (!raw.trim() || indent > blockScalarIndent) return;
      blockScalarIndent = null;
    }
    const text = stripComment(raw.slice(indent));
    if (!text.trim()) return;
    const record = { indent, text: text.trimEnd(), line: offset + 1 };
    records.push(record);
    const item = record.text.replace(/^-\s+/, '');
    const pair = mappingPair(item);
    if (pair && /^[>|][+-]?$/.test(pair.value)) blockScalarIndent = indent;
  });
  return { records, problems };
}

/** Return the records nested below one mapping entry. */
function nestedRange(records, index) {
  const indent = records[index].indent;
  let end = index + 1;
  while (end < records.length && records[end].indent > indent) end += 1;
  return { start: index + 1, end };
}

/** Find all mapping entries with one key at exactly one structural level. */
function findMappings(records, key, indent, start = 0, end = records.length) {
  const matches = [];
  for (let index = start; index < end; index += 1) {
    if (records[index].indent !== indent || records[index].text.startsWith('-')) continue;
    const pair = mappingPair(records[index].text);
    if (pair?.key === key) matches.push({ index, ...pair });
  }
  return matches;
}

/** Find the first mapping entry at exactly one structural level. */
function findMapping(records, key, indent, start = 0, end = records.length) {
  return findMappings(records, key, indent, start, end)[0] ?? null;
}

/** Find the indentation of a node's immediate children. */
function childIndent(records, start, end) {
  let indent = Infinity;
  for (let index = start; index < end; index += 1) indent = Math.min(indent, records[index].indent);
  return Number.isFinite(indent) ? indent : null;
}

/** Match js-yaml's default-schema integer resolver without taking a dependency on it. */
function resolvesYamlInteger(value) {
  const decimal = /^[+-]?\d+$/.test(value);
  const based = /^[+-]?0(?:b[01]+|o[0-7]+|x[\da-fA-F]+)$/.test(value);
  if (!decimal && !based) return false;
  const unsigned = /^[+-]/.test(value) ? value.slice(1) : value;
  let radix = 10;
  let digits = unsigned;
  if (/^0b/.test(unsigned)) { radix = 2; digits = unsigned.slice(2); }
  else if (/^0o/.test(unsigned)) { radix = 8; digits = unsigned.slice(2); }
  else if (/^0x/.test(unsigned)) { radix = 16; digits = unsigned.slice(2); }
  return Number.isFinite(Number.parseInt(digits, radix));
}

/** Whether an unquoted YAML scalar resolves to a non-string under js-yaml's default schema. */
function implicitNonStringScalar(raw) {
  const value = raw.trim();
  if (/^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE)$/.test(value)) return true;
  if (resolvesYamlInteger(value)) return true;
  const float = /^(?:[-+]?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
  if (float.test(value)) {
    if (Number.isFinite(Number.parseFloat(value))) return true;
    if (/^(?:[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/.test(value)) return true;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  return /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt]|[ \t]+)\d{1,2}:\d{2}:\d{2}(?:\.\d*)?(?:[ \t]*(?:Z|[+-]\d{1,2}(?::\d{2})?))?$/.test(value);
}

/** Decode the direct-string subset used by relevant manifest scalar fields. */
function directStringScalar(raw) {
  const value = raw.trim();
  if (!value) return { supported: true, value: '' };
  if (/^[\[{*&!]/.test(value) || /^[>|][+-]?$/.test(value)) {
    return { supported: false, value: '' };
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return { supported: true, value: value.slice(1, -1).replaceAll("''", "'") };
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return { supported: true, value: JSON.parse(value) }; } catch {
      return { supported: false, value: '' };
    }
  }
  if (implicitNonStringScalar(value)) return { supported: false, value: '' };
  return { supported: true, value };
}

/** Read a concierge scalar as a trimmed string, matching the runtime selector. */
function stringScalar(raw) {
  const decoded = directStringScalar(raw);
  return decoded.supported ? decoded.value.trim() : '';
}

/** Decide whether a parsed collection node contains at least one item/field. */
function nodeHasContent(records, entry) {
  const value = entry.value.trim();
  if (value) {
    if (/^\[\s*\]$/.test(value) || /^\{\s*\}$/.test(value)) return false;
    return /^[\[{]/.test(value);
  }
  const range = nestedRange(records, entry.index);
  return range.end > range.start;
}

/** Read named entries immediately below a mapping node. */
function nestedScalarEntries(records, parent, key) {
  if (!parent || parent.value) return [];
  const range = nestedRange(records, parent.index);
  const indent = childIndent(records, range.start, range.end);
  if (indent === null) return [];
  return findMappings(records, key, indent, range.start, range.end);
}

/** Read `name` from the first item of a bots sequence. */
function firstBotName(records, bots) {
  const none = (line = 0, flowMap = false) => ({ name: '', raw: '', line, count: 0, flowMap });
  if (!bots) return none();
  if (bots.value) return none(records[bots.index].line);
  const range = nestedRange(records, bots.index);
  const indent = childIndent(records, range.start, range.end);
  if (indent === null) return none(records[bots.index].line);
  const first = records.slice(range.start, range.end)
    .map((record, offset) => ({ record, index: range.start + offset }))
    .find(({ record }) => record.indent === indent && /^-\s*/.test(record.text));
  if (!first) return none(records[bots.index].line);
  const candidates = [];
  const prefix = /^-\s*/.exec(first.record.text)?.[0] ?? '';
  const body = first.record.text.slice(prefix.length);
  if (/^\{/.test(body)) return none(first.record.line, true);
  const pair = mappingPair(body);
  if (pair?.key === 'name') {
    candidates.push({ raw: pair.value, line: first.record.line });
  }
  let end = first.index + 1;
  while (end < range.end && records[end].indent > indent) end += 1;
  const itemIndent = first.record.indent + prefix.length;
  for (const name of findMappings(records, 'name', itemIndent, first.index + 1, end)) {
    candidates.push({ raw: name.value, line: records[name.index].line });
  }
  const selected = candidates[0];
  return selected
    ? { name: stringScalar(selected.raw), ...selected, count: candidates.length }
    : none(first.record.line);
}

/** Parse the manifest fields that define a cockpit surface and its concierge. */
export function parseConciergeProjection(source, label = 'oshal-app.yaml') {
  const parsed = yamlRecords(source, label);
  const { records } = parsed;
  const problems = [...parsed.problems];
  const top = (key) => findMapping(records, key, 0);
  const root = records[0] ?? null;
  if (root?.indent > 0) {
    problems.push(
      `${label}:${root.line}: an indented document root is unsupported; manifest top-level keys `
      + 'must begin at column zero so the structural projection cannot miss a surface.',
    );
  }
  if (root && /^[\[{]/.test(outsideQuotedScalars(root.text).trimStart())) {
    problems.push(
      `${label}:${root.line}: a flow-style document root is unsupported; use the canonical `
      + 'block mapping so the structural projection cannot miss a surface.',
    );
  }
  for (const record of records) {
    const structural = outsideQuotedScalars(record.text);
    const documentControl = structural.trim();
    if (record.indent === 0 && (/^(?:---|\.\.\.)$/.test(documentControl) || /^%/.test(documentControl))) {
      problems.push(
        `${label}:${record.line}: YAML document markers and directives are unsupported because `
        + 'they can hide an unsupported root shape from this zero-dependency projection.',
      );
    }
    const item = record.text.replace(/^-\s+/, '');
    const pair = mappingPair(item);
    if (pair && !pair.keySupported) {
      problems.push(
        `${label}:${record.line}: quoted mapping key uses YAML-only escapes that this `
        + 'zero-dependency projection cannot decode safely.',
      );
    }
    const hasExplicitKey = /^(?:-\s+)?\?(?:\s|$)/.test(structural)
      || /[\[{,]\s*\?(?:\s|$)/.test(structural);
    if (hasExplicitKey) {
      problems.push(
        `${label}:${record.line}: explicit complex mapping keys are unsupported because they `
        + 'can hide a relevant manifest key from this zero-dependency projection.',
      );
    }
    const hasReference = /^(?:-\s+|\?\s+|:\s+)?[&*](?=\S)/u.test(structural)
      || /[\[{,]\s*[&*](?=\S)/u.test(structural)
      || /:\s+[&*](?=\S)/u.test(structural);
    const hasMerge = /^(?:-\s+|\?\s+)?<<\s*:/.test(structural)
      || /[\[{,]\s*<<\s*:/.test(structural);
    const hasTag = /^(?:-\s+|\?\s+|:\s+)?!(?=\S)/u.test(structural)
      || /[\[{,]\s*!(?=\S)/u.test(structural)
      || /:\s+!(?=\S)/u.test(structural);
    if (hasReference || hasMerge || hasTag) {
      problems.push(
        `${label}:${record.line}: YAML anchors, aliases, merge keys, and tags are unsupported in `
        + 'this zero-dependency contract projection because they can hide or rewrite a cockpit '
        + 'surface or concierge declaration.',
      );
    }
  }
  const relevantKeys = ['kind', 'ui', 'toolbar', 'chatBot', 'workflow', 'bots'];
  for (const key of relevantKeys) {
    const matches = findMappings(records, key, 0);
    if (matches.length > 1) {
      problems.push(`${label}: repeats top-level ${key}; duplicate relevant keys cannot be graded safely.`);
    }
  }
  const surfaces = [];
  const ui = top('ui');
  const workflow = top('workflow');
  const bots = top('bots');
  for (const [key, entry, emptyFlow] of [
    ['ui', ui, '{}'], ['workflow', workflow, '{}'], ['bots', bots, '[]'],
  ]) {
    if (entry?.value && entry.value.replaceAll(' ', '') !== emptyFlow) {
      problems.push(
        `${label}:${records[entry.index].line}: top-level ${key} uses an unsupported nonempty `
        + 'inline, anchored, or alias form. Use the canonical block form so this zero-dependency '
        + 'gate can grade it instead of guessing.',
      );
    }
  }
  if (ui && !ui.value) {
    const range = nestedRange(records, ui.index);
    const indent = childIndent(records, range.start, range.end);
    if (indent !== null) {
      for (const key of ['static', 'dynamic']) {
        const entries = findMappings(records, key, indent, range.start, range.end);
        if (entries.length > 1) {
          problems.push(`${label}: repeats ui.${key}; duplicate relevant keys cannot be graded safely.`);
        }
        const entry = entries[0] ?? null;
        const flowShape = key === 'static' ? /^\[.*\]$/ : /^\{.*\}$/;
        if (entry?.value && !flowShape.test(entry.value)) {
          problems.push(
            `${label}:${records[entry.index].line}: ui.${key} uses an unsupported alias, anchor, `
            + 'or scalar shape; use its canonical block form or a complete flow collection.',
          );
        }
        if (entry && nodeHasContent(records, entry)) surfaces.push(`ui.${key}`);
      }
    }
  }
  const kindEntry = top('kind');
  const decodedKind = directStringScalar(kindEntry?.value ?? '');
  if (kindEntry?.value && !decodedKind.supported) {
    problems.push(
      `${label}:${records[kindEntry.index].line}: top-level kind must use a directly decodable `
      + 'string scalar so group toolbar coverage cannot be hidden.',
    );
  }
  const kind = decodedKind.supported ? decodedKind.value : '';
  const toolbar = top('toolbar');
  if (kind === 'group' && toolbar && nodeHasContent(records, toolbar)) surfaces.push('toolbar');
  if (kind === 'group' && toolbar?.value && !/^\[.*\]$/.test(toolbar.value)) {
    problems.push(
      `${label}:${records[toolbar.index].line}: top-level toolbar must use a block or flow sequence; `
      + 'aliases and scalar lookalikes cannot prove that a group surface is covered.',
    );
  }

  const chatBot = top('chatBot');
  const workerBots = nestedScalarEntries(records, workflow, 'workerBot');
  if (workerBots.length > 1) {
    problems.push(`${label}: repeats workflow.workerBot; duplicate relevant keys cannot be graded safely.`);
  }
  const workerBot = workerBots[0] ?? null;
  const firstBot = firstBotName(records, bots);
  if (firstBot.flowMap) {
    problems.push(
      `${label}:${firstBot.line}: bots[0] uses an unsupported flow mapping; use the canonical `
      + 'block mapping so nested or quoted name lookalikes cannot become the concierge.',
    );
  }
  if (firstBot.count > 1) {
    problems.push(`${label}: repeats bots[0].name; duplicate relevant keys cannot be graded safely.`);
  }
  for (const [railName, raw, line] of [
    ['chatBot', chatBot?.value ?? '', chatBot ? records[chatBot.index].line : 0],
    ['workflow.workerBot', workerBot?.value ?? '', workerBot ? records[workerBot.index].line : 0],
    ['bots[0].name', firstBot.raw, firstBot.line],
  ]) {
    if (raw && /^[*&!\[{]/.test(raw.trim())) {
      problems.push(
        `${label}:${line}: ${railName} uses an unsupported alias, tag, anchor, or collection; `
        + 'declare the concierge as a direct nonblank scalar name.',
      );
    } else if (raw && implicitNonStringScalar(raw)) {
      problems.push(
        `${label}:${line}: ${railName} resolves to a non-string YAML scalar; declare the `
        + 'concierge as a quoted or plain nonblank string name.',
      );
    }
  }
  const candidates = [
    { rail: 'chatBot', name: chatBot ? stringScalar(chatBot.value) : '' },
    { rail: 'workflow.workerBot', name: workerBot ? stringScalar(workerBot.value) : '' },
    { rail: 'bots[0].name', name: firstBot.name },
  ];
  const concierge = candidates.find(({ name }) => name)?.name ?? '';
  const rail = candidates.find(({ name }) => name)?.rail ?? '';
  return {
    name: stringScalar(top('name')?.value ?? ''), surfaces, concierge, rail,
    problems,
  };
}

/** Discover and grade every package manifest in the checkout; there is no exception list. */
export function conciergeCoverage(repositoryRoot = REPOSITORY_ROOT) {
  const directories = fs.readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      && fs.existsSync(path.join(repositoryRoot, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();
  const problems = [];
  let surfaceCount = 0;
  let coveredCount = 0;
  for (const directory of directories) {
    const label = `${directory}/oshal-app.yaml`;
    const projection = parseConciergeProjection(
      fs.readFileSync(path.join(repositoryRoot, label), 'utf8'), label,
    );
    problems.push(...projection.problems);
    if (!projection.surfaces.length) continue;
    surfaceCount += 1;
    if (projection.concierge) {
      coveredCount += 1;
      continue;
    }
    problems.push(
      `${label}: registers cockpit surface(s) ${projection.surfaces.join(', ')} but declares no `
      + 'nonblank concierge. Add top-level `chatBot`, `workflow.workerBot`, or the first '
      + '`bots[].name`; comments and nested lookalike keys do not satisfy the contract.',
    );
  }
  return { problems, packageCount: directories.length, surfaceCount, coveredCount };
}

/** CLI entry. */
export function main(argv = process.argv.slice(2), repositoryRoot = REPOSITORY_ROOT) {
  const result = conciergeCoverage(repositoryRoot);
  if (result.problems.length) {
    console.error(`Concierge coverage failed with ${result.problems.length} problem(s):`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(
    `Concierge coverage passed: ${result.coveredCount}/${result.surfaceCount} cockpit-surface `
    + `package(s) across ${result.packageCount} manifest(s) declare a concierge`,
  );
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exitCode = main();
