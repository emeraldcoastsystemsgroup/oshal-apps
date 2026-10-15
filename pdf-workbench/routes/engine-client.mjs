/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Use only original native engine relay and exact pinned source identity.
 */
import identity from './engine-identity.json' with {type:'json'};
import {fail,LIMITS,digest,bytes,PdfError} from './model.mjs';
function unavailable(code){const error=new PdfError(503,code);error.installHint='Installation administrator: run engine/install-engine.sh from the admitted pdf-workbench package with OSHAL_NETWORK set; coordinate the private pdf-workbench mapping in OSHAL_PACKAGE_ENGINES.';error.expectedBuildHash=identity.buildHash;throw error;}
export async function engine(ctx,payload){
 if(typeof ctx?.intent!=='function')unavailable('pdf_native_engine_unavailable');
 if(Buffer.byteLength(JSON.stringify(payload))>12*1024*1024-1024)fail(413,'pdf_request_limit');
 let answer;try{answer=await ctx.intent('engine.exchange',{request:{cmd:'pdf',args:payload},timeoutMs:50000});}catch{unavailable('pdf_native_engine_unavailable');}
 const hello=answer?.hello?.bridge;if(!hello||['protocol','buildHash','upstream'].some(key=>hello[key]!==identity[key]))unavailable(answer?.hello?.error==='pdf_engine_busy'?'pdf_engine_busy':'pdf_engine_source_mismatch');
 const reply=answer.reply;if(reply?.id!==1||reply.buildHash!==identity.buildHash)fail(503,'pdf_engine_invalid_response');
 if(reply.ok!==true)fail(reply.error==='pdf_engine_failed'?503:400,typeof reply.error==='string'&&/^pdf_[a-z0-9_]+$/.test(reply.error)?reply.error:'pdf_engine_refused');
 if(!reply.result||typeof reply.result!=='object'||Array.isArray(reply.result))fail(503,'pdf_engine_invalid_response');return reply.result;
}
export function output(result){if(typeof result?.data!=='string'||result.data.length>Math.ceil(LIMITS.bytes/3)*4)fail(503,'pdf_output_invalid');const data=Buffer.from(result.data,'base64');bytes(data);if(data.toString('base64')!==result.data||result.bytes!==data.length||result.sha256!==digest(data)||!Array.isArray(result.pages)||!result.pages.length||result.pages.length>32)fail(503,'pdf_output_invalid');return data;}
