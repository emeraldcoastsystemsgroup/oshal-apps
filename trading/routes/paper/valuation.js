/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fresh-quote valuation plans preserve paper holdings, cash and all risk anchors; no decision or fill can originate here.
 */
'use strict';
const {quoteFresh}=require('./market');

/**
 * @description Revalue held shares only when every quote passes the existing freshness bound.
 * Peak and high-water feed risk decisions, so valuation alone preserves both recorded anchors.
 * @param {object} account - Current book account.
 * @param {Array<object>} positions - Current held shares and cost basis.
 * @param {Map<string,object>} prices - Requested read-only quotes.
 * @param {Date} now - Pass clock.
 * @param {number} maxAge - Existing quote freshness minutes.
 * @param {object} summary - Provenance and committed daily state.
 * @returns {object} Zero-fill plan for the existing atomic writer.
 */
function valuationPlan(account,positions,prices,now,maxAge,summary){
 const marked=positions.map(p=>{
  const quote=prices.get(p.symbol);
  if(!quote||!Number.isFinite(quote.price)||quote.price<=0||!quoteFresh(quote,now,maxAge))throw Error('No fresh current price for '+p.symbol+'.');
  return {...p,currentPrice:quote.price,lastPriceAt:quote.at};
 });
 const equity=Math.round((account.cash+marked.reduce((n,p)=>n+p.qty*p.currentPrice,0))*100)/100;
 return {fills:[],positions:marked,cash:account.cash,equity,highWater:account.highWater,valuationOnly:true,summary};
}
module.exports={valuationPlan};
