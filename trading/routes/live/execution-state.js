/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Native effective authority and per-invocation broker receipts; unavailable or uncertain evidence never becomes active authority or zero submissions.
 */
'use strict';
function mandateAuthority(mandate,at){
 if(!mandate)return{status:'unavailable',active:false};
 if(mandate.status!=='active')return{status:['draft','stopped'].includes(mandate.status)?mandate.status:'unknown',active:false};
 if(typeof mandate.expiresAtMs!=='number'||!Number.isFinite(mandate.expiresAtMs)||mandate.expiresAtMs<=at.getTime())return{status:'expired',active:false};
 if(mandate.effectiveStatus!=='active')return{status:['expired','source-changed','stopped'].includes(mandate.effectiveStatus)?mandate.effectiveStatus:'unverified',active:false};
 return{status:'active',active:true};
}
function submissionCount(ticket){
 if(!ticket||['unknown','attempting'].includes(ticket.status))return null;
 if(ticket.ordersSubmitted===0)return 0;
 return ticket.status==='submitted'&&ticket.ordersSubmitted===1&&ticket.submissionAttempted===true?1:null;
}
module.exports={mandateAuthority,submissionCount};
