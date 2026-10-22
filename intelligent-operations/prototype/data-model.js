/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Pure synthetic decision demonstrator; not the established production noise-reduction algorithm or an intake service. */
(function(root){
  'use strict';
  const Contract=typeof module!=='undefined'&&module.exports?require('../ui/source-contract.js'):root.OperationsSourceContract;
  function samples(){
    const make=(id,change={})=>{const event=Contract.example();event.id=id;event.time='2026-10-20T17:29:00Z';event.data.resource.id='example-pod-uid-a';event.data.alertType='ApplicationErrors';Object.assign(event.data,change);return event;};
    const a=make('delivery-001'),missing=make('delivery-005');delete missing.data.resource.id;
    const other=make('delivery-007');other.source='urn:operations:source:example-secondary';
    return [a,structuredClone(a),make('delivery-002',{severity:'critical'}),make('delivery-003',{alertType:'MemoryPressure'}),make('delivery-004',{severity:'info',alertType:'LatencyNotice'}),missing,make('delivery-006',{environment:'production'}),other];
  }
  function inspect(minimum='warning',reduce=true){
    const ranks={info:0,warning:1,critical:2};if(!Object.hasOwn(ranks,minimum))throw new Error('Unsupported demo threshold');
    const deliveries=new Set(),symptoms=new Map(),rows=[];
    for(const [index,event] of samples().entries()){
      const row={receipt:`demo-receipt-${index+1}`,source:event.source,raw:event,outcome:'',reason:'',key:null,snapshot:false};
      if(event.data.environment!=='local-lab'){row.outcome='Refused';row.reason='Outside the demo caller’s environment grant. No identity, payload or evidence is exposed.';row.raw=null;row.source='Outside authorized scope';rows.push(row);continue;}
      const result=Contract.validate(JSON.stringify(event));
      if(!result.ok){row.outcome='Quarantined';row.reason='Required native resource identity is missing. No name-based fallback or incident dispatch.';rows.push(row);continue;}
      row.normalized=result.normalized||event;const delivery=JSON.stringify(result.deliveryIdentity);row.key=JSON.stringify(result.symptomIdentity);
      if(deliveries.has(delivery)){row.outcome='Delivery retry';row.reason='The same named source and event ID were already received. Do not increment independent occurrences or dispatch investigation again.';rows.push(row);continue;}
      deliveries.add(delivery);
      if(ranks[event.data.severity]<ranks[minimum]){row.outcome='Filtered';row.reason=`Below the ${minimum} minimum in demo rule version 1; the delivery remains explainable.`;rows.push(row);continue;}
      row.snapshot=event.data.severity==='critical';
      if(reduce&&symptoms.has(row.key)){row.outcome='Symptom update';row.incident=symptoms.get(row.key);row.reason='A different delivery has the same scoped symptom tuple. Update occurrence count; do not create another incident.';}
      else{row.outcome='Eligible incident';row.incident=`demo-incident-${symptoms.size+1}-${index+1}`;symptoms.set(row.key,row.incident);row.reason='Eligible after identity and filter checks. Investigation would start only after durable reservation; none is started here.';}
      rows.push(row);
    }
    return {rows,received:rows.length,eligible:rows.filter(row=>row.outcome==='Eligible incident').length,updates:rows.filter(row=>row.outcome==='Symptom update').length,retries:rows.filter(row=>row.outcome==='Delivery retry').length};
  }
  const api={samples,inspect};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OperationsDataDemo=api;
})(typeof window==='undefined'?globalThis:window);
