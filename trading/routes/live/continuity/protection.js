/** CHANGE LOG
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * SEQ: 1
 * Preserve protective exclusions across cycle creation and unchanged mandate renewal using broker fill evidence.
 */
'use strict';
const {canonicalPlanSymbol}=require('../../trading-portfolio-plan');
const {sessionDates,nyseSessionClock}=require('../../trading-portfolio-calendar');

function eventTime(value){
 if(typeof value!=='string'||!/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))return NaN;
 return Date.parse(value);
}

/** A terminal close bounds every fill; submitted/observed times do not. */
function lastFillBound(status){
 const executions=Array.isArray(status.executions)?status.executions:[];
 const invalid=executions.some(e=>!e||!Number.isFinite(e.quantity)||e.quantity<=0);
 if(invalid)return NaN;
 const covered=executions.reduce((sum,e)=>sum+e.quantity,0);
 if(covered>status.filledQuantity+1e-6)return NaN;
 const times=executions.map(e=>eventTime(e.time)),known=times.filter(Number.isFinite);
 const close=status.status==='FILLED'?eventTime(status.closeTime):NaN;
 if(Number.isFinite(close)&&known.some(at=>at>close))return NaN;
 if(executions.length&&known.length===executions.length&&Math.abs(covered-status.filledQuantity)<=1e-6)return Math.max(...known);
 return Number.isFinite(close)&&known.every(at=>at<=close)?close:NaN;
}

/** The same calendar close used by the signal includes regular-session, not later after-hours, fills. */
function signalIncludes(signalDate,at){
 if(!Number.isFinite(at))return false;
 try{
  if(sessionDates(signalDate,signalDate).length!==1)return false;
  const clock=nyseSessionClock(new Date(at));
  if(clock.date!==signalDate)return clock.date<signalDate;
  return clock.minutes*60000+at%60000<=clock.close*60000;
 }catch{return false;}
}

/** The caller supplies native account-scoped tickets; the mandate is their current stable lineage. */
function eventProtectedSymbols(tickets,mandateId,signalDate){
 const stopped=new Set();
 for(const ticket of tickets){
  const status=ticket.brokerStatus,filled=status?.filledQuantity;
  if(ticket.allocationMandateId!==mandateId||ticket.terms?.side!=='sell'||!Number.isFinite(filled)||filled<=0)continue;
  if(!signalIncludes(signalDate,lastFillBound(status)))stopped.add(canonicalPlanSymbol(ticket.terms.symbol));
 }
 return stopped;
}

module.exports={eventProtectedSymbols};
