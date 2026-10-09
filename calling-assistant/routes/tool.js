'use strict';
const P=require('./policy');
/** Fixed package tool used by any authorized bot or workflow; the actor is never an input. */
function registerCallingTool(ctx,calls) {
  ctx.tools.register('calling_task',async input=>{
    const a=ctx.authorization?.currentActor();
    if(!a?.isActive || !a.sub || !a.issuer) throw P.fault('signed_in_owner_required',401);
    if(!input || typeof input!=='object' || Array.isArray(input)) throw P.fault('invalid_tool_input');
    const {operation,...args}=input;
    if(operation==='start') return calls.start(a,args);
    if(Object.keys(args).some(k=>k!=='id')) throw P.fault('invalid_tool_input');
    if(operation==='status') return calls.report(a,args.id);
    if(operation==='cancel') return calls.cancel(a,args.id);
    throw P.fault('unknown_operation');
  });
}
module.exports={registerCallingTool};
