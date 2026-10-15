/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Strict immutable Motion source identities and source revision links, with no caller-selected authority or paths.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const fields = ['project','revision','compId','documentSha256','renderJob','renderSha256','startTick','endTick','frameRate'];
function demand(ok) { if (!ok) throw new TypeError('Invalid Motion source lineage'); }
function decimal(value, signed) {
  demand(typeof value === 'string' && (signed ? /^(0|-?[1-9][0-9]{0,19})$/ : /^(0|[1-9][0-9]{0,19})$/).test(value));
  const number = BigInt(value); demand(signed ? number >= -(1n << 63n) && number < (1n << 63n) : number < (1n << 64n)); return value;
}
export function validateMotionSource(value) {
  demand(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value)));
  demand(Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key)));
  demand(Object.values(Object.getOwnPropertyDescriptors(value)).every(entry => 'value' in entry));
  demand(typeof value.project === 'string' && typeof value.renderJob === 'string' && UUID.test(value.project) && UUID.test(value.renderJob));
  demand(Number.isSafeInteger(value.revision) && value.revision >= 1 && value.revision <= 1000);
  demand(typeof value.documentSha256 === 'string' && typeof value.renderSha256 === 'string' && HASH.test(value.documentSha256) && HASH.test(value.renderSha256));
  const rate = value.frameRate;
  demand(rate && typeof rate === 'object' && !Array.isArray(rate) && [Object.prototype,null].includes(Object.getPrototypeOf(rate)) && Object.values(Object.getOwnPropertyDescriptors(rate)).every(entry => 'value' in entry) && Object.keys(rate).length === 2 && Object.hasOwn(rate,'num') && Object.hasOwn(rate,'den'));
  demand(Number.isSafeInteger(rate.num) && rate.num >= 1 && rate.num <= 120000 && Number.isSafeInteger(rate.den) && rate.den >= 1 && rate.den <= 100000);
  const result = {project:value.project,revision:value.revision,compId:decimal(value.compId,false),documentSha256:value.documentSha256,
    renderJob:value.renderJob,renderSha256:value.renderSha256,startTick:decimal(value.startTick,true),endTick:decimal(value.endTick,true),frameRate:{num:rate.num,den:rate.den}};
  demand(BigInt(result.endTick) > BigInt(result.startTick)); return result;
}
export function sameMotionSource(left, right) {
  try { return JSON.stringify(validateMotionSource(left)) === JSON.stringify(validateMotionSource(right)); } catch { return false; }
}
export function motionSourceUrl(value) {
  const source = validateMotionSource(value);
  return `/api/motion-studio/app?project=${source.project}&revision=${source.revision}&compId=${source.compId}`;
}
