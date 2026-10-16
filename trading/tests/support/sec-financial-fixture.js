/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Explicit synthetic annual SEC concept transport for financial-reader tests; no live company figures.
 */
'use strict';
const {FINANCIAL_CONCEPTS}=require('../../routes/trading-sec-fundamentals');
const CIK='0001045810',FETCHED='2026-10-15T16:00:00Z';
const current={start:'2025-01-27',end:'2026-01-25',filed:'2026-02-25',accn:'0001045810-26-000021',form:'10-K',fp:'FY',fy:2026,val:100};
const prior={...current,start:'2024-01-29',end:'2025-01-26',val:80};
function documents(){return FINANCIAL_CONCEPTS.map(([taxonomy,tag],i)=>({cik:1045810,taxonomy,tag,units:{USD:i===0?[{...current},{...prior}]:i===4?[{...current,val:25}]:[]}}));}
module.exports={CIK,FETCHED,current,prior,documents};
