/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Original-owner read-only recovery of exact account reviews across tabs; retain terms while expired or unverifiable drafts require refresh.
 */
'use strict';
const {listRecords,fingerprint}=require('../trading-portfolio-store');
const {accountKey}=require('../trading-portfolio-model');
function draftState(saved,current,at,idKey){
 if(!current||current[idKey]!==saved.mandate[idKey]||current.fingerprint!==saved.mandate.fingerprint)return'unavailable';
 if(current.status!=='draft'||current.effectiveStatus!=='draft')return current.effectiveStatus||current.status||'unavailable';
 return Number.isFinite(current.reviewExpiresAtMs)&&current.reviewExpiresAtMs>at.getTime()?'ready':'expired';
}
function registerReviewRead(route,ctx,{selected,host,fields}){
 route('get','/portfolio/live/reviews',async(req,owner,at)=>{
  const b=req.query||{};fields(b,['accountId','connectionKey']);
  const fresh=await selected(owner,b,at),key=accountKey(fresh.account),bound={accountId:fresh.account.accountId,connection:fresh.account.connectionKey};
  const [watches,allocations,policies,protections]=await Promise.all(['watch','live-mandate','backstop-policy','protection-review'].map(kind=>listRecords(ctx,owner,kind)));
  const watch=watches.find(w=>accountKey(w)===key),policy=policies.find(p=>accountKey(p)===key);
  const saved=allocations.find(r=>accountKey(r)===key&&r.watchId===watch?.id&&r.mandate?.terms?.strategyId===fresh.profile?.strategyId);
  const protectedReview=protections.find(r=>accountKey(r)===key&&r.policyId===policy?.id&&r.policyFingerprint===fingerprint(policy?.config));
  let strategy=null,protection=null;
  if(saved){
   let current;try{current=await host(ctx,'mandate.status',{...bound,mandateId:saved.mandateId});}catch{}
   const availability=draftState(saved,current,at,'mandateId');
   strategy={mandate:current||saved.mandate,review:{...saved.review,activationReady:availability==='ready'&&watch.enabled&&!watch.automatedTrading&&saved.review?.activationReady===true},availability,savedAt:saved.createdAt};
  }
  if(protectedReview){
   let current;try{current=await host(ctx,'protection.status',{...bound,protectionMandateId:protectedReview.mandate.protectionMandateId});}catch{}
   const availability=draftState(protectedReview,current,at,'protectionMandateId');
   protection={...protectedReview,mandate:current||protectedReview.mandate,availability,activationReady:availability==='ready'&&!policy.automatedBrokerProtection&&!!protectedReview.research};
  }
  return{accountId:fresh.account.accountId,connectionKey:fresh.account.connectionKey,strategy,protection,readAt:at.toISOString(),ordersSubmitted:0};
 });
}
module.exports={registerReviewRead,draftState};
