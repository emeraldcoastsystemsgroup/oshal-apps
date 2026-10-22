/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Explicit bounded JSON Pointer mappings normalize local adapter samples without rewriting source authority or inventing resource identities. */
(function(root){
  'use strict';
  const Contract=typeof module!=='undefined'&&module.exports?require('./source-contract.js'):root.OperationsSourceContract;
  const DEFAULTS=Object.freeze({environment:'/data/environment',alertType:'/data/alertType',severity:'/data/severity',status:'/data/status',kind:'/data/resource/kind',scope:'/data/resource/scope',id:'/data/resource/id'});
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function read(value,pointer){
    if(typeof pointer!=='string'||pointer.length>512||!pointer.startsWith('/')||/[\u0000-\u001f\u007f-\u009f]/u.test(pointer)||/~(?:[^01]|$)/u.test(pointer))throw new Error('Use a JSON Pointer starting with /, at most 512 characters; escape ~ as ~0 and / as ~1.');
    const tokens=pointer.slice(1).split('/').map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'));
    if(tokens.length>12||tokens.some(t=>['__proto__','prototype','constructor'].includes(t)))throw new Error('Use at most 12 path segments without reserved property names.');
    for(const token of tokens){
      if(Array.isArray(value)&&!/^(0|[1-9][0-9]*)$/.test(token))throw new Error('Use a concrete zero-based array index without leading zeroes.');
      if(value===null||typeof value!=='object'||!Object.hasOwn(value,token))throw new Error('The mapped field is missing. Identity is never inferred from a name or another field.');
      value=value[token];
    }
    if(typeof value!=='string')throw new Error('The mapped field must contain a string; values are not coerced.');
    return value;
  }
  function normalize(input,mapping=DEFAULTS,expectedSource){
    const fail=message=>({ok:false,errors:[{path:'$',message}]});
    if(typeof input!=='string'||input.length>Contract.MAX_BYTES||new TextEncoder().encode(input).length>Contract.MAX_BYTES)return fail('Use one JSON alert no larger than 64 KiB.');
    let original;try{original=JSON.parse(input);}catch{return fail('Enter a valid JSON object.');}
    if(!object(original))return fail('Enter one alert object, not a batch or primitive.');
    if(!object(mapping)||Object.keys(mapping).length!==Object.keys(DEFAULTS).length||Object.keys(mapping).some(key=>!Object.hasOwn(DEFAULTS,key)))return fail('Map exactly environment, alertType, severity, status, kind, scope and id. Envelope identity cannot be mapped.');
    const values={},errors=[];
    for(const key of Object.keys(DEFAULTS)){
      try{values[key]=read(original,mapping[key]);}catch(error){errors.push({path:`mapping.${key}`,message:error.message});}
    }
    if(errors.length)return {ok:false,errors};
    const normalized={};
    for(const key of ['specversion','id','source','type','time','dataschema','datacontenttype','data_base64'])if(Object.hasOwn(original,key))normalized[key]=original[key];
    normalized.data={environment:values.environment,alertType:values.alertType,severity:values.severity,status:values.status,resource:{kind:values.kind,scope:values.scope,id:values.id}};
    const result=Contract.validate(JSON.stringify(normalized),expectedSource);
    return result.ok?{...result,normalized}:result;
  }
  const api=Object.freeze({DEFAULTS,normalize});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OperationsAdapterMapping=api;
})(typeof window==='undefined'?globalThis:window);
