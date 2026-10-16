/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify bounded real company-directory matching, provenance identifiers and malformed-source refusal.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {companyMatches}=require('../routes/trading-edgar-filings');
const table={0:{ticker:'NVDA',title:'NVIDIA CORP',cik_str:1045810},1:{ticker:'NVDS',title:'Example NVIDIA Fund',cik_str:123},2:{ticker:'OTHER',title:'Another company',cik_str:456}};
test('company names and tickers match actual directory rows and exact identities rank first',()=>{
 assert.deepEqual(companyMatches(table,'Nvidia'),[{symbol:'NVDA',name:'NVIDIA CORP',cik:'0001045810'},{symbol:'NVDS',name:'Example NVIDIA Fund',cik:'0000000123'}]);
 assert.equal(companyMatches(table,'nvda')[0].name,'NVIDIA CORP');assert.deepEqual(companyMatches(table,'absent company'),[]);
});
test('broad matches are capped at 25 without fabricated names or tickers',()=>{
 const rows=Object.fromEntries(Array.from({length:40},(_,i)=>[i,{ticker:'T'+i,title:'Test company '+i,cik_str:i+1}]));
 assert.equal(companyMatches(rows,'test company').length,25);assert.ok(companyMatches(rows,'test company').every(r=>rows[Number(r.symbol.slice(1))].title===r.name));
});
test('malformed, empty and conflicting directory snapshots refuse instead of claiming no matches',()=>{
 for(const rows of [null,[],{}, {0:{ticker:'NVDA'}}, {0:table[0],1:{...table[0],cik_str:999}}])assert.throws(()=>companyMatches(rows,'NVIDIA'));
});
