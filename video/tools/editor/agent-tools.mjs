/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bounded agent timeline operations retain linked timing, lock checks and immutable revisions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Describe automatic document saves and refreshes in the shared editing contract.
 */
import { createTimeline, addSource, removeSource, renameTimeline, replaceMotionSource } from './timeline-model.mjs';
import { validateTimeline } from './timeline-validation.mjs';
import { migrateMultitrack, applyMultitrack } from './multitrack-model.mjs';
const forms = { migrate: [], rename: ['name'], addSource: ['source'], removeSource: ['key'], replaceMotionSource: ['key','source'],
  addTrack: ['name','kind'], track: ['id','patch'], addClip: ['track','source','start','in','out'], clip: ['id','patch'],
  moveClip: ['id','track','start'], removeClip: ['id','ripple'], split: ['id','frame'], extractAudio: ['id','track'], unlink: ['id'],
  text: ['track','entry'], removeText: ['track','id'] };
export const operationSchema = { type: 'object', additionalProperties: false, required: ['type'], properties: {
  type: { type: 'string', enum: Object.keys(forms) }, id: { type: 'string', maxLength: 100 },
  name: { type: 'string', minLength: 1, maxLength: 120 }, key: { type: 'string', maxLength: 32 },
  kind: { type: 'string', enum: ['video','audio'] }, track: { type: 'string', maxLength: 100 },
  // source is a key for addClip, and metadata for addSource; server validates that dependent shape.
  patch: { type: 'object' }, entry: { type: 'object' },
  start: { type: 'integer', minimum: 0, maximum: 1800 }, in: { type: 'integer', minimum: 0, maximum: 1800 },
  out: { type: 'integer', minimum: 1, maximum: 1800 }, frame: { type: 'integer', minimum: 0, maximum: 1800 }, ripple: { type: 'boolean' },
} };
// Kernel schema has no union types. Use separate sourceKey/sourceMetadata tool fields, normalize here.
operationSchema.properties.sourceKey = { type: 'string', maxLength: 32 };
operationSchema.properties.sourceMetadata = { type: 'object' };
export function blankProject(input) { return migrateMultitrack(createTimeline(input.title)); }
export function applyAgentOperations(value, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 16 || JSON.stringify(operations).length > 15000) throw new TypeError('Use 1–16 bounded timeline operations');
  let next = validateTimeline(value);
  for (const raw of operations) {
    const operation = { ...raw }, allowed = forms[operation.type];
    const publicFields = allowed?.map(key => key === 'source' ? (operation.type === 'addClip' ? 'sourceKey' : 'sourceMetadata') : key);
    if (!publicFields || Object.keys(operation).some(key => key !== 'type' && !publicFields.includes(key))) throw new TypeError('Unsupported editing fields');
    if (operation.type === 'addClip') { operation.source = operation.sourceKey; delete operation.sourceKey; }
    if (operation.type === 'addSource' || operation.type === 'replaceMotionSource') { operation.source = operation.sourceMetadata; delete operation.sourceMetadata; }
    if (!allowed || Object.keys(operation).some(key => key !== 'type' && !allowed.includes(key))) throw new TypeError('Unsupported editing fields');
    if (operation.type === 'migrate') next = migrateMultitrack(next);
    else if (operation.type === 'rename') next = renameTimeline(next, operation.name);
    else if (operation.type === 'addSource') next = addSource(next, operation.source).document;
    else if (operation.type === 'replaceMotionSource') next = replaceMotionSource(next, operation.key, operation.source);
    else if (operation.type === 'removeSource') next = removeSource(next, operation.key);
    else next = applyMultitrack(next, operation);
  }
  return validateTimeline(next);
}
export function editingContract() {
  return { editor: 'video', version: 1, sourceVersion: '1.11.1', maxOperations: 16, maxInputBytes: 16384, operations: Object.fromEntries(Object.entries(forms).map(([type,keys]) => [type,keys.map(key => key === 'source' ? (type === 'addClip' ? 'sourceKey' : 'sourceMetadata') : key)])), operationSchema,
    conventions: { timing: 'All timing in integer frames at 30fps. Clip in/out are source frames (out exclusive); start/split frame are timeline frames. Keys are clip-local.',
      clips: 'clip patch allows in/out/start/volume/x/y/scale/opacity/keys/transition/fadeIn/fadeOut/brightness/contrast/saturation/audioEnabled.',
      bounds: '4 video + 8 audio tracks, 32 clips, 60 seconds, 8 video + 8 audio sources; x/y -100..100 percent, scale10..200, opacity0..100, volume0..200.',
      keyframes: 'keys [{frame,property:x|y|scale|opacity|volume,value,interpolation:linear|hold}], max64 per clip. Fades in frames; transition dissolve or black.',
      audio: 'extractAudio links timing and disables duplicated video sound. Linked trims/moves/splits stay synchronized. Ripple crossing another clip is refused until split. Never silently unlock tracks.',
      text: 'text track titles or captions, entry {text,start,end,position:top|center|bottom,size:small|medium|large}; plain text only.',
      sources: 'Video sourceMetadata is exactly {asset,kind,name,frames,width,height,audio}; audio is {asset,kind,name,frames}. Reuse actual project sources, or map a verified owned upload id to asset and hasAudio to audio. Do not include fps, codecs, URLs, paths or code. Metadata must match the owned upload. The optional motion lineage is copied verbatim only from a successful protected Motion import; never construct it.',
      motion: 'Import a verified Motion render handle with video-import-motion-render (approval). Returned sourceMetadata includes sealed motion lineage. Add it or replaceMotionSource with actual source key; refresh same project/comp/range/rate with equal/newer revision, no locked track. Open graph using sourceUrl returned by import. Full native graph stays editable in Motion; Video stores an immutable linked render cache. Existing cache survives source deletion but graph editing requires current Motion access.',
      saves: 'Read project id/revision first. Explicit migrate upgrades v1. One batch saves one revision, stale conflicts require re-read. The editor automatically saves the current draft before concierge reading, then refreshes the same project on return. Concurrent browser drafts are preserved with a conflict message.',
      renders: 'Single-source browser preview is unavailable in v2. Use render preview/export job tools; report actual returned state. Never promise codecs or native support without a successful job.', },
    examples: [ {type:'migrate'}, {type:'addClip',track:'video1',sourceKey:'v1',start:30,in:0,out:90},
      {type:'clip',id:'clip-id',patch:{opacity:80,fadeIn:15,transition:'dissolve'}},
      {type:'text',track:'captions',entry:{text:'Hello',start:0,end:60,position:'bottom',size:'small'}},
      {type:'extractAudio',id:'clip-id',track:'audio1'}, {type:'split',id:'clip-id',frame:60} ],
    unsupported: ['Audio recording/EQ/compression workstation','Local Motion graph editing inside Video (linked owned graph edits open in Motion)','RAW','Publishing','PDF','PSD'] };
}
