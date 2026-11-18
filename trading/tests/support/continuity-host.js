/** CHANGE LOG
 * SEQ: 2
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Send candidate fixture checks to its separate dormant endpoint; never dispatch legacy and candidate together.
 * SEQ: 1
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Explicitly adopt only synthetic fixture watches into the versioned continuity
 * executor after real route activation; this is not a live migration or proof
 * that native production admission supports this execution generation.
 */
'use strict';
const {allocationFixture}=require('./native-allocation-host');
const {saveRecord}=require('../../routes/trading-portfolio-store');
const {accountKey}=require('../../routes/trading-portfolio-model');
const GENERATION='synthetic-continuity-generation-1';

/** @description Add explicit synthetic execution admission to the existing account fixture.
 * @param {object} t Test teardown owner. @param {object} options Synthetic account options.
 * @returns {Promise<object>} Existing fixture with an explicitly adopting activation helper.
 */
async function continuityFixture(t,options={}){
 const h=await allocationFixture(t,options);
 const version=()=>Object.assign(h.mandate().terms,{executionVersion:2,executionGeneration:GENERATION});
 version();
 const activate=async()=>{
  version();const result=await h.activate();
  if(!result.watch||result.watch.automatedTrading!==true)return result;
  const watch=await saveRecord(h.ctx,'owner-a','watch',{
   ...result.watch,executionVersion:2,executionGeneration:GENERATION,
  },accountKey(result.watch));
  return{...result,watch};
 };
 const req=(path,...args)=>h.req(path==='/watch/tick'?'/continuity/watch/tick':path,...args);
 return{...h,activate,req};
}

module.exports={continuityFixture};
