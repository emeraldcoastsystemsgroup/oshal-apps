/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Return a fresh transient contract edit key without changing saved source or retry semantics.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Add starter story brief templates (RP-CRS-01), aspect-ratio resize (RP-CRS-02), brand kit styling (RP-CRS-03), and scene trim/split operations (RP-CRS-07).
 */
import { randomUUID } from 'node:crypto';
import { exact, uuid, integer, text, fail } from './vendor/source-project-store.mjs';

export const KIND = 'story';
export const ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:5']);
const MODES = ['episode'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const STORY_TEMPLATES = Object.freeze([
  {
    id: 'product-launch',
    name: 'Product Launch',
    aspectRatio: '16:9',
    title: 'Product Launch Announcement',
    notes: 'Introduce the problem customers hit every day, reveal the new capability in action, and close with one clear next step.',
    scenes: [
      { title: 'The everyday friction', text: 'Show the bottleneck teams face before today.', duration: 6 },
      { title: 'Meet the release', text: 'Reveal the capability live on screen with crisp callouts.', duration: 10 },
      { title: 'Proof in workflow', text: 'Walk through one real customer outcome end to end.', duration: 10 },
      { title: 'Try it today', text: 'Close with availability and one direct invitation.', duration: 5 },
    ],
  },
  {
    id: 'customer-story',
    name: 'Customer Story',
    aspectRatio: '16:9',
    title: 'Customer Impact Story',
    notes: 'Center the person doing the work: their starting challenge, the turning point, and measurable results in their own words.',
    scenes: [
      { title: 'Who we are meeting', text: 'Introduce the team, their craft, and what was at stake.', duration: 7 },
      { title: 'Before the switch', text: 'Describe the manual steps that slowed every week down.', duration: 8 },
      { title: 'How the workflow changed', text: 'Show the new daily rhythm in real scenes.', duration: 10 },
      { title: 'Measured outcome', text: 'Share the concrete time saved and what comes next.', duration: 7 },
    ],
  },
  {
    id: 'explainer',
    name: 'Explainer',
    aspectRatio: '16:9',
    title: 'How It Works in 30 Seconds',
    notes: 'Break a complex topic into three plain steps anyone can follow on the first watch.',
    scenes: [
      { title: 'One plain question', text: 'Open with the exact question newcomers ask.', duration: 6 },
      { title: 'Step 1 & Step 2', text: 'Connect the input to the core mechanism visually.', duration: 12 },
      { title: 'Step 3: The result', text: 'Show the finished output and why it stays reliable.', duration: 8 },
    ],
  },
  {
    id: 'event-recap',
    name: 'Event Recap',
    aspectRatio: '4:5',
    title: 'Highlights & Key Takeaways',
    notes: 'Capture the energy of the gathering, the three moments people talked about most, and where to watch full sessions.',
    scenes: [
      { title: 'Opening energy', text: 'Set the venue, crowd, and theme of the day.', duration: 5 },
      { title: 'Keynote highlight', text: 'Feature the standout demonstration and audience reaction.', duration: 9 },
      { title: 'Community moments', text: 'Cut across workshops, conversations, and hallway demos.', duration: 8 },
      { title: 'Watch on demand', text: 'Point viewers to session replays and next dates.', duration: 5 },
    ],
  },
  {
    id: 'social-reel',
    name: 'Social Reel',
    aspectRatio: '9:16',
    title: 'Vertical Quick Tip Reel',
    notes: 'Fast-paced vertical hook in the first two seconds, one actionable demonstration, and a punchy wrap-up.',
    scenes: [
      { title: 'Two-second hook', text: 'Stop the scroll with the finished result first.', duration: 4 },
      { title: 'Show the move', text: 'Demonstrate the exact step in one tight close-up.', duration: 8 },
      { title: 'Save for later', text: 'Recap the takeaway in one crisp sentence.', duration: 4 },
    ],
  },
]);

function link(value) {
  text(value, 2000, { empty: true });
  if (value) {
    try {
      const parsed = new URL(value, 'https://source.invalid');
      if (!['http:', 'https:'].includes(parsed.protocol)) throw Error();
    } catch { fail(400, 'source_invalid_link'); }
  }
  return value;
}

function normalizeAspect(value) {
  if (!ASPECT_RATIOS.includes(value)) fail(400, 'source_invalid_aspect_ratio');
  return value;
}

function normalizeBrandKit(value) {
  if (value === null) return undefined;
  exact(value, ['name', 'primaryColor', 'accentColor', 'headingFont', 'bodyFont'], ['logoSrc']);
  if (!HEX_COLOR.test(value.primaryColor) || !HEX_COLOR.test(value.accentColor)) fail(400, 'source_invalid_brand_kit');
  const out = {
    name: text(value.name, 80),
    primaryColor: value.primaryColor.toLowerCase(),
    accentColor: value.accentColor.toLowerCase(),
    headingFont: text(value.headingFont, 60),
    bodyFont: text(value.bodyFont, 60),
  };
  if (value.logoSrc) out.logoSrc = link(value.logoSrc);
  return out;
}

function scene(value) {
  exact(value, ['id', 'title', 'text', 'duration'], ['trimIn', 'trimOut']);
  const duration = integer(value.duration, 1, 120);
  const out = { id: uuid(value.id), title: text(value.title, 120), text: text(value.text, 2000, { empty: true }), duration };
  if (value.trimIn !== undefined || value.trimOut !== undefined) {
    const trimIn = value.trimIn === undefined ? 0 : integer(value.trimIn, 0, duration - 1);
    const trimOut = value.trimOut === undefined ? duration : integer(value.trimOut, trimIn + 1, duration);
    if (trimIn > 0 || trimOut < duration) { out.trimIn = trimIn; out.trimOut = trimOut; }
  }
  return out;
}

export function validate(model) {
  exact(model, ['version', 'kind', 'title', 'notes', 'sourceUrl', 'mode', 'scenes'], ['aspectRatio', 'brandKit']);
  if (model.version !== 1 || model.kind !== KIND || !MODES.includes(model.mode) || !Array.isArray(model.scenes) || model.scenes.length > 32) {
    fail(400, 'source_invalid_model');
  }
  const scenes = model.scenes.map(scene);
  if (new Set(scenes.map(v => v.id)).size !== scenes.length) fail(400, 'source_duplicate_scene');
  const out = {
    version: 1, kind: KIND, title: text(model.title, 120), notes: text(model.notes, 2000, { empty: true }),
    sourceUrl: link(model.sourceUrl), mode: model.mode, scenes,
  };
  if (model.aspectRatio !== undefined) out.aspectRatio = normalizeAspect(model.aspectRatio);
  if (model.brandKit !== undefined && model.brandKit !== null) out.brandKit = normalizeBrandKit(model.brandKit);
  return out;
}

function applyEnhancementOp(next, op) {
  switch (op.op) {
    case 'resize-brief':
      exact(op, ['op', 'aspectRatio']);
      next.aspectRatio = normalizeAspect(op.aspectRatio);
      return;
    case 'set-brand-kit':
      exact(op, ['op', 'brandKit']);
      if (op.brandKit === null) delete next.brandKit;
      else next.brandKit = normalizeBrandKit(op.brandKit);
      return;
    case 'trim-scene': {
      exact(op, ['op', 'id', 'trimIn', 'trimOut']);
      const target = next.scenes.find(v => v.id === uuid(op.id));
      if (!target) fail(404, 'source_scene_missing');
      const trimIn = integer(op.trimIn, 0, target.duration - 1), trimOut = integer(op.trimOut, trimIn + 1, target.duration);
      if (trimIn === 0 && trimOut === target.duration) { delete target.trimIn; delete target.trimOut; }
      else { target.trimIn = trimIn; target.trimOut = trimOut; }
      return;
    }
    case 'split-scene': {
      exact(op, ['op', 'id', 'atSecond', 'newId']);
      if (next.scenes.length >= 32) fail(400, 'source_invalid_model');
      const at = next.scenes.findIndex(v => v.id === uuid(op.id));
      if (at < 0) fail(404, 'source_scene_missing');
      const newId = uuid(op.newId);
      if (next.scenes.some(v => v.id === newId)) fail(409, 'source_duplicate_scene');
      const target = next.scenes[at], span = (target.trimOut ?? target.duration) - (target.trimIn ?? 0);
      if (span < 2) fail(400, 'source_scene_too_short_to_split');
      const splitAt = integer(op.atSecond, 1, span - 1);
      const second = { id: newId, title: `${target.title} (part 2)`.slice(0, 120), text: target.text, duration: span - splitAt };
      target.duration = splitAt; delete target.trimIn; delete target.trimOut;
      next.scenes.splice(at + 1, 0, second);
      return;
    }
    default: fail(400, 'source_unsupported_operation');
  }
}

function applyOne(next, op) {
  switch (op.op) {
    case 'set-brief':
      exact(op, ['op', 'values']);
      exact(op.values, [], ['title', 'notes', 'sourceUrl', 'mode', 'aspectRatio', 'brandKit']);
      if (!Object.keys(op.values).length) fail(400, 'source_empty_operation');
      Object.assign(next, op.values);
      if (op.values.brandKit === null) delete next.brandKit;
      return;
    case 'replace-scenes':
      exact(op, ['op', 'scenes']);
      if (!Array.isArray(op.scenes) || op.scenes.length > 32) fail(400, 'source_invalid_model');
      next.scenes = op.scenes.map(scene);
      return;
    case 'add-scene': {
      exact(op, ['op', 'scene'], ['after']);
      const value = scene(op.scene);
      if (next.scenes.some(v => v.id === value.id)) fail(409, 'source_duplicate_scene');
      const at = op.after === undefined ? next.scenes.length : next.scenes.findIndex(v => v.id === uuid(op.after)) + 1;
      if (op.after !== undefined && at === 0) fail(404, 'source_scene_missing');
      next.scenes.splice(at, 0, value);
      return;
    }
    case 'set-scene': {
      exact(op, ['op', 'id', 'values']);
      exact(op.values, [], ['title', 'text', 'duration', 'trimIn', 'trimOut']);
      if (!Object.keys(op.values).length) fail(400, 'source_empty_operation');
      const target = next.scenes.find(v => v.id === uuid(op.id));
      if (!target) fail(404, 'source_scene_missing');
      if (op.values.duration !== undefined && (target.trimIn !== undefined || target.trimOut !== undefined) && op.values.trimIn === undefined && op.values.trimOut === undefined) {
        delete target.trimIn; delete target.trimOut;
      }
      Object.assign(target, op.values);
      return;
    }
    case 'remove-scene': {
      exact(op, ['op', 'id']);
      const at = next.scenes.findIndex(v => v.id === uuid(op.id));
      if (at < 0) fail(404, 'source_scene_missing');
      next.scenes.splice(at, 1);
      return;
    }
    case 'move-scene': {
      exact(op, ['op', 'id', 'index']);
      const at = next.scenes.findIndex(v => v.id === uuid(op.id));
      if (at < 0) fail(404, 'source_scene_missing');
      const index = integer(op.index, 0, next.scenes.length - 1);
      next.scenes.splice(index, 0, next.scenes.splice(at, 1)[0]);
      return;
    }
    default: applyEnhancementOp(next, op);
  }
}

export function apply(model, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 16) fail(400, 'source_invalid_operations');
  const next = structuredClone(model);
  for (const op of operations) applyOne(next, op);
  return validate(next);
}

export const CONTRACT = {
  kind: KIND,
  version: 1,
  wire: {
    discriminator: 'op',
    closed: true,
    rule: 'Each operations item is an object with op exactly as shown and only the listed fields. values is an object containing only changed fields, never an array. Do not use type or invent operation names.',
    request: { id: 'actual source-read project UUID', baseRevision: 'actual source-read revision', requestKey: 'copy the top-level requestKey unchanged for this exact intent', operations: '1..16 operation objects' },
  },
  limits: { scenes: 32, operations: 16, title: 120, notes: 2000, sceneText: 2000, duration: [1, 120], aspectRatios: ASPECT_RATIOS },
  operations: {
    'replace-scenes': { op: 'replace-scenes', scenes: 'complete ordered array of at most 32 typed scenes with stable IDs' },
    'set-brief': { op: 'set-brief', values: { title: 'optional text <=120 characters', notes: 'optional text <=2000 characters', sourceUrl: 'optional http(s) link or relative path <=2000 characters', mode: MODES, aspectRatio: 'optional 16:9|9:16|1:1|4:5', brandKit: 'optional brandKit object or null' } },
    'add-scene': { op: 'add-scene', scene: { id: 'new UUID v4', title: 'text <=120 characters', text: 'text <=2000 characters', duration: 'integer seconds 1..120' }, after: 'optional existing scene UUID; omit to append' },
    'set-scene': { op: 'set-scene', id: 'existing scene UUID', values: { title: 'optional text <=120 characters', text: 'optional text <=2000 characters', duration: 'optional integer seconds 1..120', trimIn: 'optional integer seconds', trimOut: 'optional integer seconds' } },
    'remove-scene': { op: 'remove-scene', id: 'existing scene UUID' },
    'move-scene': { op: 'move-scene', id: 'existing scene UUID', index: 'zero-based index' },
    'resize-brief': { op: 'resize-brief', aspectRatio: '16:9|9:16|1:1|4:5' },
    'set-brand-kit': { op: 'set-brand-kit', brandKit: 'brandKit object or null' },
    'trim-scene': { op: 'trim-scene', id: 'existing scene UUID', trimIn: 'integer seconds >=0', trimOut: 'integer seconds <=duration' },
    'split-scene': { op: 'split-scene', id: 'existing scene UUID', atSecond: 'integer seconds 1..duration-1', newId: 'new UUID v4' },
  },
  examples: [
    { purpose: 'Change only the existing selected scene text. Substitute its actual source-read ID for the illustrative ID.', operations: [{ op: 'set-scene', id: '33333333-3333-4333-8333-333333333333', values: { text: 'Updated scene text' } }] },
    { purpose: 'Change brief notes only.', operations: [{ op: 'set-brief', values: { notes: 'Updated brief notes' } }] },
  ],
  concurrency: 'Read current project and use its revision as baseRevision. A conflict changes nothing. Restore appends a new immutable revision.',
  generation: 'Source edits never spend provider credits or change existing generated outputs.',
};

/** Fresh transient request identity; never stored in the source model. */
export function sourceContract() {
  return {
    ...CONTRACT,
    requestKey: randomUUID(),
    requestKeyRule: 'Copy requestKey unchanged from the just-read editing contract response for this new edit; never invent it. Read a fresh contract for each new intent; retry an uncertain result with the identical key and body.',
  };
}
