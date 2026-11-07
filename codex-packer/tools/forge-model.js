/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pure Bot Forge draft compiler, YAML importer, permission-preview builder, and refusal classifier shared by browser and unit tests.
 */
'use strict';

const FORGE_VALID_SUITES = new Set([
  'ai-productivity',
  'ai-knowledge',
  'ai-engineering',
  'ai-finance',
  'ai-creative',
  'ai-home',
]);

function slugifyName(raw) {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return cleaned || 'draft-bot';
}

function normalizeSpec(input = {}) {
  const name = String(input.name || '').trim().slice(0, 120);
  const workerBot = String(input.workerBot || '').trim().slice(0, 120);
  const task = String(input.task || '').trim().slice(0, 2000);
  const ioContract = String(input.ioContract || '').trim().slice(0, 1200);
  const guardrails = String(input.guardrails || '').trim().slice(0, 2000);
  const suite = FORGE_VALID_SUITES.has(input.suite) ? input.suite : 'ai-productivity';
  const requireApproval = Boolean(input.requireApproval);
  const slug = slugifyName(name);
  const descriptionParts = [task, ioContract ? `Contract: ${ioContract}` : ''].filter(Boolean);
  const description = descriptionParts.join('\n\n').slice(0, 3800);
  return { name, slug, workerBot, task, ioContract, guardrails, suite, requireApproval, description };
}

function validateSpec(spec) {
  const errors = [];
  if (!spec.name || spec.name.length < 2) errors.push('Enter a bot name (at least 2 characters).');
  if (!spec.task || spec.task.length < 8) errors.push('Describe the single task this bot performs.');
  if (!spec.workerBot) errors.push('Choose an installed worker bot to execute turns.');
  return { valid: errors.length === 0, errors };
}

function buildGraphNodesAndEdges(spec) {
  const nodes = [
    {
      id: 'start',
      type: 'start',
      title: 'Start',
      description: 'Manual caller-scoped ticket entry.',
      position: { x: 80, y: 80 },
      config: { triggerMode: 'manual' },
    },
    {
      id: 'work',
      type: 'execute-agent',
      title: spec.name || 'Execute Bot',
      description: (spec.task || 'Run authored bot contract.').slice(0, 280),
      position: { x: 330, y: 80 },
      config: { agentBinding: spec.workerBot, workType: 'authored' },
    },
  ];
  const edges = [{ id: 'start-work', source: 'start', target: 'work' }];
  if (spec.requireApproval) {
    nodes.push({
      id: 'gate',
      type: 'approval-gate',
      title: 'Confirm Side Effects',
      description: 'Confirmed human Admin ticket gate before completion.',
      position: { x: 580, y: 80 },
      config: { gateState: 'approval_required' },
    });
    edges.push({ id: 'work-gate', source: 'work', target: 'gate' }, { id: 'gate-deliver', source: 'gate', target: 'deliver' });
  } else {
    edges.push({ id: 'work-deliver', source: 'work', target: 'deliver' });
  }
  nodes.push({
    id: 'deliver',
    type: 'deliver',
    title: 'Deliver',
    description: 'Complete caller-scoped ticket.',
    position: { x: spec.requireApproval ? 830 : 580, y: 80 },
    config: { deliveryMode: 'standard' },
  });
  return { nodes, edges };
}

function buildSavePayload(id, expectedVersion, rawSpec) {
  const spec = normalizeSpec(rawSpec);
  const { nodes, edges } = buildGraphNodesAndEdges(spec);
  const notesLines = [
    `Bot Forge authored spec (${spec.suite})`,
    spec.guardrails ? `Guardrails: ${spec.guardrails}` : 'Guardrails: Do not echo secrets or credentials.',
  ];
  return {
    id,
    name: spec.name,
    description: spec.description || spec.task,
    nodes,
    edges,
    metadata: {
      notes: notesLines.join('\n').slice(0, 3900),
      tags: ['bot-forge', spec.suite],
    },
    expectedVersion: Number(expectedVersion),
  };
}

function parseForgeYamlDraft(yamlText = '') {
  const text = String(yamlText || '');
  const scalar = (key) => {
    const m = text.match(new RegExp(`^${key}:\\s*(?!\\||>)(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2') : '';
  };
  const displayName = scalar('displayName');
  const rawName = scalar('name');
  const description = scalar('description');
  const suite = scalar('suite');
  const perspectiveMatch = text.match(/perspective:\s*\|\s*\n([\s\S]{1,3000})/);
  const perspective = perspectiveMatch
    ? perspectiveMatch[1]
        .split('\n')
        .filter((line) => /^\s{2,}\S/.test(line) || line.trim() === '')
        .map((line) => line.replace(/^\s{2}/, ''))
        .join('\n')
        .trim()
    : '';
  return {
    name: displayName || rawName || '',
    task: description || perspective.split('\n')[0] || '',
    guardrails: perspective.slice(0, 1500),
    suite: FORGE_VALID_SUITES.has(suite) ? suite : 'ai-productivity',
  };
}

function buildPermissionPreview(spec, compilePreview = {}) {
  const validation = compilePreview.validation || { valid: false, issues: [] };
  const stepBindings = Array.isArray(compilePreview.stepBindings) ? compilePreview.stepBindings : [];
  const runtimeBindings = Array.isArray(compilePreview.runtimeBindings) ? compilePreview.runtimeBindings : [];
  const capabilities = [
    'Caller-scoped personal package (scope: person) — visible and runnable only by you',
    `Bound worker bot dispatch: ${spec.workerBot || 'unbound'} (declared-bot-dispatch)`,
    spec.requireApproval
      ? 'Human Admin confirmation gate required before delivery (confirmed-ticket-approval)'
      : 'Direct sequential ticket completion without destructive write authority (terminal-ticket-completion)',
    'Zero git commit and zero manual App Loader installation required',
  ];
  const withheld = [
    'No shell, CLI, or host process execution',
    'No raw API keys, connectors, or stored credentials',
    'No cross-user or public store visibility',
    'No outbound network egress hosts',
  ];
  return {
    ready: validation.valid === true,
    packagePreview: `authored-${slugifyName(spec.name)}-*`,
    scope: 'person',
    workerBot: spec.workerBot,
    usesKernelBots: Boolean(compilePreview.usesKernelBots),
    capabilities,
    withheld,
    stepBindings,
    runtimeBindings,
    issues: Array.isArray(validation.issues)
      ? validation.issues.map((item) => String(item?.message || item?.code || 'Validation issue'))
      : [],
  };
}

function describeRefusal(status, body = {}) {
  const detail = String(body?.message || body?.detail || body?.error || '').trim();
  if (status === 401) return 'Your session is not signed in. Refresh and sign in before injecting a bot.';
  if (status === 403) {
    return detail || 'Permission refused: publishing an authored bot requires Editor access to Workflow Studio.';
  }
  if (status === 409) {
    return detail || 'This draft changed in another tab or conflicts with an existing ticket type. Reload and retry.';
  }
  if (status === 422 || status === 400) {
    return detail || 'The kernel refused this bot specification because a required binding or graph constraint failed.';
  }
  if (status === 503) {
    return detail || 'Native authored publication is temporarily unavailable on this kernel.';
  }
  return detail || `Request failed with HTTP ${status || 'error'}.`;
}

const OshalBotForgeModelApi = {
  slugifyName,
  normalizeSpec,
  validateSpec,
  buildSavePayload,
  parseForgeYamlDraft,
  buildPermissionPreview,
  describeRefusal,
};

if (typeof module === 'object' && module.exports) {
  module.exports = OshalBotForgeModelApi;
}
if (typeof globalThis !== 'undefined') {
  globalThis.OshalBotForgeModel = OshalBotForgeModelApi;
}
