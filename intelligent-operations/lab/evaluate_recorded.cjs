/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Measure a label-blind severity baseline and actual noise reduction on hash-verified BGL samples using disposable services. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash,randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {fixture,loadExperience}=require('../tests/fixtures/intake.cjs'),{engineFixture}=require('../tests/fixtures/detection.cjs'),{admit,hash}=require('../routes/intake.js'),{publishPolicy,evaluateDelivery}=require('../routes/pipeline.js');
const root=path.resolve(__dirname,'..');
function recorded(cache){
 const registry=JSON.parse(fs.readFileSync(path.join(__dirname,'datasets.json'))),dataset=registry.datasets.find(d=>d.id==='loghub'),item=dataset.files.find(f=>f.path==='BGL/BGL_2k.log_structured.csv'),file=path.join(cache,'loghub',dataset.revision,item.path),bytes=fs.readFileSync(file);
 if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Research input differs from its pinned manifest.');
 const rows=JSON.parse(execFileSync('python3',['-c','import csv,json,sys; print(json.dumps(list(csv.DictReader(sys.stdin))))'],{input:bytes,maxBuffer:4*1024*1024}).toString());
 return {dataset,item,rows:rows.sort((a,b)=>Number(a.Timestamp)-Number(b.Timestamp)||Number(a.LineId)-Number(b.LineId))};
}
async function run({cache=path.join(os.homedir(),'.cache/triagenorth/datasets'),output=path.join(os.homedir(),'.local/state/oshal-k8s/bgl-evaluation.json')}={}){
 const {dataset,item,rows}=recorded(cache),f=await fixture(),engine=await engineFixture(),owner='recorded-evaluation-'+randomUUID(),pool=f.caller(owner),indexes=[];
 const counts={observations:rows.length,matched:0,filtered:0,admitted:0,suppressed:0,late:0,truePositive:0,falsePositive:0,trueNegative:0,falseNegative:0};
 try{
  const source=loadExperience().sourceDefinition({name:'Recorded BGL severity baseline',source:'urn:triagenorth:research:bgl:'+owner,environment:'research-bgl'});
  const policy={name:'Recorded severity baseline',window:{mode:'fixed',seconds:900},rules:[{name:'Warning or critical severity',enabled:true,capture:false,query:{terms:{severity:['warning','critical']}}}]};
  const published=await publishPolicy(pool,engine.engine,owner,source,policy,0);indexes.push('ops-rules-'+hash(['detection-owner-v1',owner])+'-'+published.policy.id);
  for(let i=0;i<rows.length;i++){
   const row=rows[i],time=new Date(Number(row.Timestamp)*1000).toISOString(),severity=['FATAL','SEVERE','ERROR'].includes(row.Level)?'critical':row.Level==='WARNING'?'warning':'info';
   // Neither Label nor the expected outcome enters the event or the query. EventId is the upstream parsing template, not an incident label.
   const event={specversion:'1.0',id:'bgl-line-'+row.LineId,source:source.source,type:'operations.alert',time,dataschema:'urn:oshal:operations:alert:1',datacontenttype:'application/json',data:{environment:source.environment,alertType:'BGL.'+row.Component+'.'+row.EventId,severity,status:'firing',resource:{kind:'host',scope:'loghub/bgl-recorded-system',id:row.Node},message:row.Content}};
   const delivery=await admit(pool,owner,source,event);if(delivery.record.decision!=='validated')throw Error('Recorded native identity was not admitted at row '+row.LineId);
   const decision=await evaluateDelivery(pool,engine.engine,owner,delivery.record.id,()=>time),positive=decision.outcome==='matched',label=row.Label!=='-';
   counts[positive?'matched':'filtered']++;counts[label?(positive?'truePositive':'falseNegative'):(positive?'falsePositive':'trueNegative')]++;
   if(decision.reduction.outcome==='admitted')counts.admitted++;if(decision.reduction.outcome==='suppressed')counts.suppressed++;if(decision.reduction.outcome==='late-occurrence')counts.late++;
   if((i+1)%250===0)console.log('Recorded BGL evaluation:',i+1,'/',rows.length);
  }
  const receipt={kind:'recorded-data-baseline-evaluation',at:new Date().toISOString(),dataset:{repository:dataset.repository,revision:dataset.revision,path:item.path,sha256:item.sha256},synthetic:false,sourceWasSampled:true,method:'BGL-level-severity-v1 / actual OpenSearch percolation / application symptom key / fixed900-second event-time replay',labelLeakageIntoRules:false,counts,precision:counts.truePositive/(counts.truePositive+counts.falsePositive)||0,recall:counts.truePositive/(counts.truePositive+counts.falseNegative)||0,falsePositiveRate:counts.falsePositive/(counts.falsePositive+counts.trueNegative)||0,engineBuild:published.policy.receipt.engineBuild,anomalyDetector:false,correlationAccuracyMeasured:false,limitations:['2k sampled lines, not a full chronological incident capture','severity baseline only; no learned model or tuned detector','same-time rows preserve upstream LineId tie-break','virtual replay clock uses original epoch timestamps; no source timezone guessed','source labels score alert categories, not root cause or ticket quality']};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt,null,2));return receipt;
 }finally{await engine.close();await f.close();for(const index of indexes){const r=await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});if(!r.ok&&r.status!==404)throw Error('Could not remove owned benchmark rules');}}
}
module.exports={recorded,run};if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
