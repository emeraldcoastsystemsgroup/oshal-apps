/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Publish the shared human/agent runtime contract and the actual pinned command registry.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve complete bounded agent observations with a compact registry index and exact per-command schema retrieval.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve exact native numeric text and original authority across the updated transport.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Include actual human effect schemas and bounded source agent lookup instructions.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Describe automatic inspector saves and native editable document refresh shared by human and concierge editing.
 */
import { stringifyNative } from '../tools/native-json.mjs';
import { LIMITS, MotionError } from './project-store.mjs';
import { motionEngine } from './engine-client.mjs';
import { effectRegistry } from './effects.mjs';
import {fontInventory} from './text.mjs';
const AGENT_RESPONSE_BYTES = 60 * 1024;
function contract(ctx, engine) {
  return { schemaVersion: 1, format: 'effectcraft-native-project', limits: LIMITS, engine,
    documentHandoff: 'The editor automatically saves retained inspector fields before assistant reads and refreshes the same native composition on return. Use CURRENT DOCUMENT identity, revision and selection; read actual owned data first. Preserve native layers/effects/keyframes; never substitute a flattened image. Historical views stay read-only. Never ask for Save or Reload.',
    operations: { create: { title: 'string', width: 'integer', height: 'integer', frameRate: 'number', duration: 'seconds', requestKey: 'uuid' },
      apply: { id: 'uuid', baseRevision: 'integer', requestKey: 'uuid', commands: '1..32 real catalog commands', comp: 'optional composition selector' },
      preview: { document: 'native object', comp: 'optional', time: 'seconds', max_side: '1..4096', transparent: 'boolean' } },
    runtimeStorage: { model: ctx.pool?.storageModel || 'postgresql',
      nativeEncodedAssetPageBytes: ctx.pool?.storageModel === 'kernel-scoped-documents' ? 4194304 : null,
      nativeAssetAdmission: 'Normalized photos are bounded at 4 MiB each and 64 assets/256 MiB per owner. Native lasting storage keeps bytes outside bounded row pages; legacy inline rows retain their encoded-page bound.',
      aggregateGrowth: 'Controlled native source fixtures cover 64 large durable photos and 1000 private revision bodies. Installed full project/history combinations remain unverified.' },
    sourceAssets: 'Only owned rows; no filesystem URLs. Exported native JSON preserves source references; Portable bundle transfers preserve recipient-owned photos; protected render jobs preserve exact native source lineage; installed Video acceptance remains open.' };
}
function completeObservation(value) {
  if (Buffer.byteLength(stringifyNative(value)) > AGENT_RESPONSE_BYTES) throw new MotionError(413, 'motion_agent_observation_limit');
  return value;
}
export async function editingContract(ctx) {
  const engine = await motionEngine(ctx, { op: 'catalog' });
  const registry = await effectRegistry(ctx);
  const fonts=await fontInventory(ctx);
  return contract(ctx, { ...engine, effects: registry.effects, effectStamp: registry.stamp, fonts:fonts.families,fontStamp:fonts.stamp });
}
export async function agentContract(ctx) {
  const engine = await motionEngine(ctx, { op: 'catalog' });
  const commands = engine.commands.map(({ id, label, schema }) => ({ id, label, hasSchema: !!schema }));
  return completeObservation({ ...contract(ctx, { ...engine, commands }),
    commandCount: commands.length, commandIndexComplete: true,
    schemaLookup: '/api/motion-studio/command-schema/{command}',
    fontIndex:'/api/motion-studio/font-index/start/0',
    maskInspection:'Immutable revision/decimal comp/layer/mask/tick observations; motion-read-mask pages64vertices and64feather points with exact native interpolation.',
    effectIndex: '/api/motion-studio/effect-index/start/0', effectSchemaLookup: '/api/motion-studio/effect-schema/{effect}',
    portableBundles:{archiveBytes:276824064,humanChunkBytes:1048576,agentChunkBytes:8192,tools:['motion-export-bundle','motion-begin-bundle-import','motion-append-bundle-chunk','motion-import-bundle','motion-import-transfer-status','motion-export-transfer-status','motion-cancel-bundle-import','motion-cancel-bundle-export'],humanUpload:'Import bundle or Upload for agent in the Motion editor; use the actual returned transfer id.',download:'Agent-prepared openUrl opens protected verified download controls. Staging is not a completed file or installed acceptance.'},
    renderJobs:{outputBytes:276824064,deadlineSeconds:300,tools:['motion-start-render','motion-render-status','motion-cancel-render','motion-read-render-chunk'],source:'Immutable owner project/revision/compId/documentSha256',publication:'Only ready has a complete SHA256/bytes/contentUrl. Partial progress cannot be downloaded. Original export/read grants are freshly checked inside the signed engine continuation and all download requests.'},
    fullAgentValueEdits:'motion-begin-value-upload seals owned project/revision/comp/layer/effect/prop/tick and whole UTF8 byte SHA256/length; append canonical8192-byte chunks under16KiB arguments, inspect exact received offsets, then finish once atomically. All writes ask under read/change; status auto retains real mutating grant classification. Every disk read/write rechecks original active principal/source/grants. Retry same id/key after uncertain replies; cancel staging only.',
    effectStringEdits:'properties.patchAt supports mutually exclusive value or textPatch {start,end,text}; exact UTF16 bounds cannot split surrogate pairs. Existing approval-held exact edits support small edits to large strings. Protected human multipart effect-values saves a full native batch in one revision; full oversized agent replacements use approved bounded value-upload staging.',
    effectPropertiesInspection:'motion-read-effect-properties marks incomplete large values for motion-read-effect-value exact bounded chunks; the human full binding retains original native capacity. Read one actual effect instance at exact composition ticks before expressions. properties.patchAt with effect seals changed targets to that same-layer instance and preserves native key semantics.',
    propertiesInspection:'motion-read-properties returns actual transform/camera/light values before expressions at exact decimal composition ticks. properties.patchAt uses sealed decimal target properties and changed-only original native setters.',
    agentInputBytes: 16384, agentObservationBytes: AGENT_RESPONSE_BYTES,
    instructions: 'Fetch the exact command schema before constructing its parameters. The manual editing contract retains the complete registry schemas. Large document observations require bounded inspection; never infer truncated data.' });
}
export async function commandSchema(ctx, command) {
  if (typeof command !== 'string' || command.length > 128 || !/^[a-z][a-zA-Z0-9._-]*$/.test(command)) throw new MotionError(400, 'motion_invalid_command');
  const engine = await motionEngine(ctx, { op: 'catalog', filter: command });
  const found = engine.commands.find(entry => entry.id === command);
  if (!found) throw new MotionError(404, 'motion_command_not_found');
  return completeObservation({ schemaVersion: 1, upstream: engine.upstream,
    ticksPerSecond: engine.ticksPerSecond, command: found });
}
