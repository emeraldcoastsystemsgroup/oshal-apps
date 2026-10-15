/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve native integer literals across Node/browser JSON without changing global JSON or prototype behavior.
 */
class NativeNumber {
  #literal;
  constructor(literal){this.#literal=literal;Object.freeze(this);}
  get literal(){return this.#literal;}
  valueOf(){return Number(this.#literal);}
  toString(){return this.#literal;}
  toJSON(){return JSON.rawJSON(this.#literal);}
}
export const isNativeNumber=value=>value instanceof NativeNumber;
export function parseNative(text) {
  return JSON.parse(text,(_key,value,context)=>{
    if(typeof value==='number'){
      if(!Number.isFinite(value))throw new Error('motion_invalid_native_number');
      if(Number.isInteger(value)&&!Number.isSafeInteger(value))return /^-?[0-9]+$/.test(context.source)?BigInt(context.source):new NativeNumber(context.source);
    }
    return value;
  });
}
export function stringifyNative(value) {
  return JSON.stringify(value,(_key,entry)=>typeof entry==='bigint'?JSON.rawJSON(entry.toString()):entry);
}
export function hasWideInteger(value) {
  if(typeof value==='bigint'||isNativeNumber(value))return true;
  if(!value||typeof value!=='object')return false;
  return Object.values(value).some(hasWideInteger);
}
export function wireProject(project) {
  if(!project?.document)return project;
  const {document,...metadata}=project;
  return {...metadata,documentJson:stringifyNative(document),...(!hasWideInteger(document)?{document}:{})};
}
export function readProject(project) {
  if(project?.documentJson!==undefined){if(typeof project.documentJson!=='string')throw new Error('motion_invalid_document_transport');return {...project,document:parseNative(project.documentJson)};}
  return project;
}
export function decimalId(value) {
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||value.length>20)throw new Error('motion_invalid_native_id');
  const number=BigInt(value);if(number>18446744073709551615n)throw new Error('motion_invalid_native_id');return number;
}
