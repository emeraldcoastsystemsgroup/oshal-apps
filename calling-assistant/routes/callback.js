'use strict';
const {urlencoded}=require('express');
const {validSignature}=require('./twilio');
const P=require('./policy');
function callbackVerifier({findRun,carrier,asOwner}) {
  const parse=urlencoded({extended:false,limit:'16kb'});
  return async req=>{
    if(req.method!=='POST' || !req.is('application/x-www-form-urlencoded')) return null;
    await new Promise((resolve,reject)=>parse(req,{},e=>e?reject(e):resolve()));
    const path=req.originalUrl||req.url;
    const match=/^\/api\/calling-callbacks\/run\/([0-9a-f-]{36})\/(answer|recorded|audio|poll|status|transfer)\/(\d{1,3})$/.exec(path);
    if(!match || !P.uuid.test(match[1]) || !/^CA[0-9a-f]{32}$/i.test(req.body?.CallSid)) return null;
    const r=await findRun(match[1]);
    if(!r || (r.call_sid && r.call_sid!==req.body.CallSid)) return null;
    const a={sub:r.owner_sub,issuer:r.owner_issuer};
    return asOwner(a,async()=>{
      const client=await carrier(a,r.config.connectionId);
      if(req.body.AccountSid!==client.credential.sid || !validSignature(client.credential,r.config.publicOrigin+path,req.body,req.get('x-twilio-signature'))) return null;
      return a;
    });
  };
}
module.exports={callbackVerifier};
