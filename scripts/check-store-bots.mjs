#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Store bot contract for the native kernel. (a) Every bot a package's routes call
 *   (a UUID on an agentId line or in an AGENT or BOT constant, or the identity argument of executeBotOrInline) must be one the
 *   kernel's package bot turn will run for that package: declared by the package itself, or imported under dependencies.*.bots,
 *   and inline. The kernel resolves a turn only against the package's own and imported bots ("requested bot is not declared by
 *   this application") and refuses a node-posture bot bound to an unreachable node ("this bot requires an enrolled node"); the
 *   Storage Assistant, Presentations AI draft, Switchboard compose, Smart Home assistant and Eats concierge each failed one of
 *   those. (b) No persona's prompt teaches the retired CLI scripts (/app/scripts/, node scripts/oshal-) or an example.com link;
 *   personas printed shell commands and invented links. (c) Each concierge persona this contract names answers in plain prose.
 *   Known violators outside this change are listed in PENDING and must still violate, so the list cannot go stale.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | (d) A concierge whose package declares route-backed (executorType api) tools
 *   must teach the ```tool_call fence the kernel parses (crates/orchestration/src/turn.rs extract_tool_call). The Feeds
 *   curator had the tools but no answer rules and answered a person with a bare "tool_call" label and JSON in 2 of 7
 *   turns on 2026-10-11; feeds-curator joins CONCIERGES.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | (e) An application's chatBot may not be the platform general-bot, which holds none of the
 *   application's data (Home, Jarvis and Games answered "I cannot access your Home app", "No pending items require your review"
 *   beside 3 to review, and "this environment cannot run D&D"), and a chatBot the package declares or imports must be inline.
 *   social-writer and shopping-concierge run inline, so their route entries leave PENDING; the remaining general-bot concierges
 *   of other lanes are named there. More concierges join CONCIERGES with their plain-prose rule.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The concierges of Bake-Off, Brand Graphics, D&D, Marketing, Print Inbox, Spaces, Travel,
 *   Video Studio, Vids and Kid Lens join CONCIERGES: each answered a how-to question with JSON, a scene, "NO DATA" or the
 *   wrong reason in the 2026-10-11 sweep, and each now carries a plain-prose rule (and the ```tool_call fence for Travel).
 * 5 | maintainer@emeraldcoastsystemsgroup.com | rides-concierge runs inline, so the two rides route entries leave PENDING.
 *
 * Usage: node scripts/check-store-bots.mjs [repositoryRoot]
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Register and verify original-owner agent editing, immutable revision batches and approval-bound API tools.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const RETIRED = [/\/app\/scripts\//, /node scripts\/oshal-/, /example\.com/i];

/** Concierge personas whose screen answers a person directly: each must answer in plain prose. */
export const CONCIERGES = [
  'create/personas/create-editor.yaml',
  'video/personas/video-editor.yaml',
  'calendar/personas/calendar-concierge.yaml',
  'capability-ideator/personas/capability-ideator.yaml',
  'cloud/personas/cloud-ops-bot.yaml',
  'email-summarizer/personas/email-summarizer.yaml',
  'embodied/personas/embodied-operator.yaml',
  'feeds/personas/feeds-curator.yaml',
  'futures-research/personas/futures-research-worker.yaml',
  'home/personas/home-bot.yaml',
  'ocean-lab/personas/ocean-lab-guide.yaml',
  'spotify/personas/spotify-concierge.yaml',
  'storage/personas/storage-assistant.yaml',
  'switchboard/personas/email-summarizer.yaml',
  'venture-plan/personas/venture-strategist.yaml',
  'world/personas/world-analyst.yaml',
  'aero-lab/personas/aero-designer.yaml',
  'bake-off/personas/bake-off-analyst.yaml',
  'brand-graphics/personas/brand-graphics.yaml',
  'dnd/personas/dungeon-master.yaml',
  'marketing-engine/personas/campaign-director.yaml',
  'print-ingest/personas/print-ingest-bot.yaml',
  'sat-ops/personas/sat-operator.yaml',
  'social/personas/social-writer.yaml',
  'spaces/personas/spaces-operator.yaml',
  'travel/personas/travel-concierge.yaml',
  'video/personas/video-director.yaml',
  'vids/personas/vids-operator.yaml',
  'youtube-kids/personas/kid-lens-analyzer.yaml',
];

/**
 * Known violations owned by other lanes, each named exactly. A listed entry that no longer violates
 * is itself a failure, so fixing one forces its removal here.
 */
export const PENDING = new Set([
  'persona social/personas/email-summarizer.yaml teaches /app/scripts/',
  // Route-called dedicated-node bots in other lanes' packages (rides answered "I'm having trouble reaching my assistant"
  // with "this bot requires an enrolled node" live on 2026-10-11), and two routes calling platform bot identities.
  'route career-hunter/routes/career-job-guide.js calls bot cb000000-0000-0000-0000-000000000001, which career-hunter is node-posture',
  'route career-hunter/routes/career-profile-studio-routes.js calls bot cb000000-0000-0000-0000-000000000001, which career-hunter is node-posture',
  'route career-hunter/routes/career-resume-studio-routes.js calls bot cb000000-0000-0000-0000-000000000001, which career-hunter is node-posture',
  'route career-hunter/routes/career-worker-rail.js calls bot cb000000-0000-0000-0000-000000000001, which career-hunter is node-posture',
  'route career-hunter/src-routes/career-job-guide.ts calls bot cb000000-0000-0000-0000-000000000001, which career-hunter is node-posture',
  'route career-hunter/src-routes/career-profile-studio-routes.ts calls bot cb000000-0000-0000-0000-000000000001, which career-hunter is node-posture',
  'route career-hunter/src-routes/career-resume-studio-routes.ts calls bot cb000000-0000-0000-0000-000000000001, which career-hunter is node-posture',
  'route career-hunter/src-routes/career-worker-rail.ts calls bot cb000000-0000-0000-0000-000000000001, which career-hunter is node-posture',
  'route create/routes/create-region-edit-routes.js calls bot a0000000-0000-0000-0000-000000000099, which is neither declared nor imported by this package',
  'route create/src-routes/create-region-edit-routes.ts calls bot a0000000-0000-0000-0000-000000000099, which is neither declared nor imported by this package',
  'route finance/routes/finance-routes.js calls bot a0000000-0000-0000-0000-000000000044, which finance-analyst is node-posture',
  'route finance/src-routes/finance-routes.ts calls bot a0000000-0000-0000-0000-000000000044, which finance-analyst is node-posture',
  'route lora/routes/bot-lora-routes.js calls bot a0000000-0000-0000-0000-000000000049, which is neither declared nor imported by this package',
  'route lora/routes/lora-train-dispatch.js calls bot a0000000-0000-0000-0000-000000000049, which is neither declared nor imported by this package',
  'route lora/src-routes/bot-lora-routes.ts calls bot a0000000-0000-0000-0000-000000000049, which is neither declared nor imported by this package',
  'route lora/src-routes/lora-train-dispatch.ts calls bot a0000000-0000-0000-0000-000000000049, which is neither declared nor imported by this package',
  'route movies/routes/movies-routes.js calls bot b00b0000-0000-0000-0000-000000000001, which movies-concierge is node-posture',
  'route movies/src-routes/movies-routes.ts calls bot b00b0000-0000-0000-0000-000000000001, which movies-concierge is node-posture',
  // Concierges still bound to the platform general-bot in other lanes' packages (payments, payroll, life, kalshi, sports-edge,
  // fantasy-football and intelligent-sports each answered with no app data in the 2026-10-11 sweep).
  'app classroom-experience binds its concierge to the platform general-bot, which holds none of its data',
  'app commons-experience binds its concierge to the platform general-bot, which holds none of its data',
  'app dev-workspace-index binds its concierge to the platform general-bot, which holds none of its data',
  'app fantasy-football binds its concierge to the platform general-bot, which holds none of its data',
  'app hello-oshal binds its concierge to the platform general-bot, which holds none of its data',
  'app intelligent-sports binds its concierge to the platform general-bot, which holds none of its data',
  'app kalshi binds its concierge to the platform general-bot, which holds none of its data',
  'app life binds its concierge to the platform general-bot, which holds none of its data',
  'app orbit-experience binds its concierge to the platform general-bot, which holds none of its data',
  'app payments binds its concierge to the platform general-bot, which holds none of its data',
  'app payroll binds its concierge to the platform general-bot, which holds none of its data',
  'app sports-edge binds its concierge to the platform general-bot, which holds none of its data',
  'app studio-experience binds its concierge to the platform general-bot, which holds none of its data',
  'app system binds its concierge to the platform general-bot, which holds none of its data',
  'app career-hunter concierge career-hunter: career-hunter is node-posture',
  'app job-apply concierge career-hunter: imported career-hunter/career-hunter is node-posture',
  'route spotify/routes/spotify-routes.js calls bot b00a0000-0000-0000-0000-000000000001, which spotify-concierge is node-posture',
  'route spotify/src-routes/spotify-routes.ts calls bot b00a0000-0000-0000-0000-000000000001, which spotify-concierge is node-posture',
]);

/** js-yaml from the gate's own toolchain (never the old platform checkout). */
function loadYaml(root) {
  const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(root, 'scripts', 'toolchain'));
  return createRequire(path.join(toolchain, 'package.json'))('js-yaml');
}

function packages(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name).sort();
}

function sourceFiles(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(extension)).map((name) => path.join(dir, name));
}

/**
 * @description Every application's bot declarations, keyed by package name.
 * @param {string} root Repository root.
 * @param {object} yaml A js-yaml module.
 * @returns {Map<string, object>} name -> { bots, imports }.
 */
export function readManifests(root, yaml) {
  const manifests = new Map();
  for (const app of packages(root)) {
    const manifest = yaml.load(fs.readFileSync(path.join(root, app, 'oshal-app.yaml'), 'utf8')) || {};
    const deps = manifest.dependencies || {};
    const imports = ['required', 'optional'].flatMap((tier) => (deps[tier] && deps[tier].bots) || []);
    manifests.set(app, { bots: Array.isArray(manifest.bots) ? manifest.bots : [], imports });
  }
  return manifests;
}

/** The kernel's posture rule (crates/packages/src/legacy_contracts.rs bot_posture). */
export function posture(bot) {
  if (bot.posture) return String(bot.posture);
  if (bot.container) return bot.container === 'oshal-api' ? 'inline' : 'node';
  return bot.requiresOwnNode === true ? 'node' : 'inline';
}

/** Bot identities a route file names: agentId lines, AGENT or BOT constants, executeBotOrInline literals. */
export function routeBotSelectors(source) {
  const found = new Set();
  for (const line of source.split('\n')) {
    if (/agentId|AGENT|_BOT\b|BOT_|executeBotOrInline/.test(line) && !/^\s*(\*|\/\/)/.test(line)) {
      for (const id of line.match(UUID) || []) found.add(id.toLowerCase());
    }
  }
  for (const match of source.matchAll(/executeBotOrInline\)?\(\s*[^,]+,\s*[^,]+,\s*'([a-z][a-z0-9-]*)'/g)) found.add(match[1]);
  return found;
}

/** Whether a package's route may call this selector through the kernel's package bot turn. */
function routeCallable(app, selector, manifests) {
  const own = manifests.get(app);
  const matches = (bot) => bot.name === selector || String(bot.agentId || '').toLowerCase() === selector;
  const declared = own.bots.find(matches);
  if (declared) return posture(declared) === 'inline' ? null : `${declared.name} is ${posture(declared)}-posture`;
  for (const binding of own.imports) {
    const owner = manifests.get(binding.app);
    const bot = owner && owner.bots.find((item) => item.name === binding.name);
    if (bot && matches(bot)) return posture(bot) === 'inline' ? null : `imported ${binding.app}/${bot.name} is ${posture(bot)}-posture`;
  }
  return 'is neither declared nor imported by this package';
}

/**
 * @description Route-called bots the native kernel would refuse.
 * @param {string} root Repository root.
 * @param {Map<string, object>} manifests From readManifests.
 * @returns {string[]} One line per refused route bot.
 */
export function routeBotProblems(root, manifests) {
  const problems = [];
  for (const app of manifests.keys()) {
    const files = [...sourceFiles(path.join(root, app, 'routes'), '.js'), ...sourceFiles(path.join(root, app, 'src-routes'), '.ts')];
    for (const file of files) {
      for (const selector of routeBotSelectors(fs.readFileSync(file, 'utf8'))) {
        const why = routeCallable(app, selector, manifests);
        if (why) problems.push(`route ${path.relative(root, file)} calls bot ${selector}, which ${why}`);
      }
    }
  }
  return problems;
}

/**
 * @description Concierge bindings the native shell cannot answer from: a chatBot naming the platform general-bot, which
 *   holds none of the application's data, or a declared or imported chatBot that only an enrolled node can run.
 * @param {string} root Repository root.
 * @param {object} yaml A js-yaml module.
 * @param {Map<string, object>} manifests From readManifests.
 * @returns {string[]} One line per refused binding.
 */
export function conciergeBindingProblems(root, yaml, manifests) {
  const problems = [];
  for (const app of manifests.keys()) {
    const manifest = yaml.load(fs.readFileSync(path.join(root, app, 'oshal-app.yaml'), 'utf8')) || {};
    const chat = typeof manifest.chatBot === 'string' ? manifest.chatBot.trim() : '';
    if (!chat) continue;
    if (chat === 'general-bot') {
      problems.push(`app ${app} binds its concierge to the platform general-bot, which holds none of its data`);
      continue;
    }
    const why = routeCallable(app, chat, manifests);
    if (why && why !== 'is neither declared nor imported by this package') problems.push(`app ${app} concierge ${chat}: ${why}`);
  }
  return problems;
}

function personaText(yaml, file) {
  const persona = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  return String(persona.perspective || persona.systemPrompt || '');
}

/**
 * @description Persona prompts that teach retired scripts or invented links, and concierges without a prose rule.
 * @param {string} root Repository root.
 * @param {object} yaml A js-yaml module.
 * @param {string[]} concierges Repository-relative concierge persona paths.
 * @returns {string[]} One line per problem.
 */
export function personaProblems(root, yaml, concierges = CONCIERGES) {
  const problems = [];
  for (const app of packages(root)) {
    for (const file of sourceFiles(path.join(root, app, 'personas'), '.yaml')) {
      const text = personaText(yaml, file);
      const rel = path.relative(root, file);
      for (const pattern of RETIRED) {
        if (pattern.test(text)) problems.push(`persona ${rel} teaches ${pattern.source.replace(/\\/g, '')}`);
      }
    }
  }
  for (const rel of concierges) problems.push(...conciergeProblems(root, yaml, rel));
  return problems;
}

/** Whether a package manifest declares a route-backed tool the kernel offers its bot. */
function declaresApiTools(root, yaml, app) {
  const file = path.join(root, app, 'oshal-app.yaml');
  const manifest = fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) || {} : {};
  return (Array.isArray(manifest.tools) ? manifest.tools : []).some((tool) => tool && tool.executor && tool.executor.executorType === 'api');
}

/**
 * @description One concierge's answer rules: plain prose always, and the ```tool_call fence the kernel parses when its
 *   package offers route-backed tools (a bare "tool_call" label is shown to the person as the answer).
 * @param {string} root Repository root.
 * @param {object} yaml A js-yaml module.
 * @param {string} rel Repository-relative persona path; its first segment is the package.
 * @returns {string[]} One line per problem.
 */
function conciergeProblems(root, yaml, rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return [`concierge ${rel} is missing`];
  const text = personaText(yaml, file);
  const problems = [];
  if (!/plain prose/i.test(text)) problems.push(`concierge ${rel} has no plain-prose answer rule`);
  if (declaresApiTools(root, yaml, rel.split('/')[0]) && !text.includes('```tool_call')) {
    problems.push(`concierge ${rel} has route-backed tools but does not teach the \`\`\`tool_call fence`);
  }
  return problems;
}

/**
 * @description Problems after the named pending violations, plus every pending entry that no longer violates.
 * @param {string[]} problems All findings.
 * @param {Set<string>} pending Known violations owned elsewhere.
 * @returns {string[]} The failures this gate reports.
 */
export function unexpected(problems, pending = PENDING) {
  const stale = [...pending].filter((entry) => !problems.includes(entry)).map((entry) => `pending entry no longer violates; remove it: ${entry}`);
  return [...problems.filter((problem) => !pending.has(problem)), ...stale];
}

/** CLI entry: exit 1 on any unexpected problem. */
export function main(argv = process.argv.slice(2)) {
  const root = path.resolve(argv[0] || ROOT);
  const yaml = loadYaml(ROOT);
  const manifests = readManifests(root, yaml);
  const failures = unexpected([...routeBotProblems(root, manifests), ...conciergeBindingProblems(root, yaml, manifests), ...personaProblems(root, yaml)]);
  for (const failure of failures) console.error(`✗ ${failure}`);
  if (!failures.length) console.log(`Store bot contract verified for ${manifests.size} applications`);
  return failures.length ? 1 : 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exitCode = main();
