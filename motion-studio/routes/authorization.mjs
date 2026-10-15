/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Capture the original actor through every request await and preserve fresh named own-project permissions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require original read and create together for editable import/fork requests.
 */
import { MotionError } from './project-store.mjs';
export const ACTIONS = ['view','read','create','change','delete','export'];
function actor(ctx) {
  const value=ctx.authorization?.currentActor();
  if(!value?.isActive||typeof value.issuer!=='string'||typeof value.sub!=='string'||!value.issuer||!value.sub)throw new MotionError(401,'motion_verified_identity_required');
  return value;
}
export function bindRequest(ctx) {
  const original=actor(ctx), issuer=original.issuer, sub=original.sub;
  const current=()=>{const now=actor(ctx);if(now.issuer!==issuer||now.sub!==sub)throw new MotionError(401,'motion_identity_changed');return now;};
  return {...ctx,authorization:{...ctx.authorization,currentActor:current,authorize:async query=>{current();const result=await ctx.authorization.authorize(query);current();return result;}},
    intent:async(name,input)=>{current();const answer=await ctx.intent(name,input);current();return answer;}};
}
export async function access(ctx,action) {
  actor(ctx);
  const required=['view',...(['change','export'].includes(action)?['read',action]:action==='copy'?['read','create']:action==='upload'?[]:[action])];
  for(const name of new Set(required))if(!(await ctx.authorization.authorize({permission:'project.'+name})).allowed)throw new MotionError(403,'motion_permission_denied');
  if(action==='upload'&&!(await ctx.authorization.authorize({permission:'project.create'})).allowed&&!(await ctx.authorization.authorize({permission:'project.change'})).allowed)throw new MotionError(403,'motion_permission_denied');
  actor(ctx);
}
export async function permissions(ctx) {
  return Object.fromEntries(await Promise.all(ACTIONS.map(async action=>{try{await access(ctx,action);return[action,true];}catch{return[action,false];}})));
}
