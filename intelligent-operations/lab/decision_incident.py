#!/usr/bin/env python3
"""Admit one fresh, verified local monitoring episode and start its isolated native investigation.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve actual source/resource/time/hash identity while putting bounded monitoring facts through telemetry, percolation and canonical workflow admission.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import time
from portal import Portal, private_json


def main():
    lab=Path.home()/'.local/state/oshal-operations-lab'
    proof=json.loads((lab/'acceptance.json').read_text())
    assert proof['status']=='passed' and 0<=time.time()-proof['finishedAt']<1200,'Run the bounded real-local verification first'
    folder=Path(proof['faultCapture']);assert folder.resolve().parent==(lab/'captures').resolve()
    capture=json.loads((folder/'receipt.json').read_text())
    for name,digest in capture['files'].items():
        assert Path(name).name==name
        assert hashlib.sha256((folder/name).read_bytes()).hexdigest()==digest,'Captured bytes changed'
    alerts=json.loads((folder/'prometheus-alerts.json').read_text())['data']['alerts']
    alert=next(a for a in alerts if a['state']=='firing' and a['labels'].get('alertname')=='LabApplicationErrors')
    labels=alert['labels'];pods=json.loads((folder/'operations-demo-pods.json').read_text())['items']
    pod=next(p for p in pods if p['metadata']['uid']==labels['pod_uid'])
    assert pod['metadata']['namespace']=='operations-demo' and pod['metadata']['name']==labels['pod']
    from lab import guard
    guard()
    # The native installation guard checks the exact local cluster UID again before admission.
    with Portal() as portal:
        installation=json.loads((portal.state/'installation.json').read_text());scope=installation['clusterUid']
        stage=portal.state/'decision-real-incident.json'
        if stage.exists():raise ValueError('Inspect the existing durable episode reservation; no duplicate investigation is started.')
        observed=datetime.datetime.fromtimestamp(capture['capturedAt'],datetime.timezone.utc)
        when=observed.isoformat().replace('+00:00','Z');nanos=str(int(observed.timestamp()*1_000_000_000));episode=hashlib.sha256(json.dumps(capture,sort_keys=True).encode()).hexdigest()[:12]
        receipt={'stage':'reserved','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'monitoringFinishedAt':proof['finishedAt'],'captureSha256':hashlib.sha256((folder/'receipt.json').read_bytes()).hexdigest(),'syntheticWorkload':True,'realMonitoringObservations':True,'executionAuthorized':False}
        fd=os.open(stage,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as output:json.dump(receipt,output,indent=2)
        source=portal.call('/api/intelligent-operations/sources',{'name':'Local monitoring decision '+episode,'source':'urn:triagenorth:monitoring-decision:'+episode,'environment':'operations-lab'});receipt['sourceId']=source['id'];private_json(stage,receipt)
        api='/api/intelligent-operations'
        portal.call(api+'/telemetry/configure',{'sourceId':source['id'],'expectedRevision':0,'config':{'resourceKind':'kubernetes-pod','idAttribute':'k8s.pod.uid','scopeAttribute':'resource.scope'}})
        resource={'attributes':[{'key':'k8s.pod.uid','value':{'stringValue':labels['pod_uid']}},{'key':'resource.scope','value':{'stringValue':scope}}]}
        logs=[]
        for line in (folder/'frontend-logs.txt').read_text().splitlines():
            if '[pod/'+labels['pod']+'/' not in line:continue
            match=re.search(r'\{.*\}',line)
            if not match:continue
            row=json.loads(match[0])
            if row.get('time',float('inf'))>capture['capturedAt']:continue
            if row.get('status',0)>=500:logs.append({'timeUnixNano':str(int(row['time']*1_000_000_000)),'severityNumber':17,'body':{'stringValue':json.dumps(row,separators=(',',':'))}})
        assert logs,'The target resource must have genuine captured failure logs'
        facts={'kind':'captured-pod-observation','pod':pod['metadata']['name'],'namespace':pod['metadata']['namespace'],'uid':pod['metadata']['uid'],'node':pod['spec']['nodeName'],'images':[c['image'] for c in pod['spec']['containers']],'alertStartedAt':alert['activeAt'],'captureSha256':receipt['captureSha256']}
        logs=logs[-6:]+[{'timeUnixNano':nanos,'severityNumber':9,'body':{'stringValue':json.dumps(facts,separators=(',',':'))}}]
        portal.call(api+'/streams/'+source['id']+'/v1/logs',{'resourceLogs':[{'resource':resource,'scopeLogs':[{'logRecords':logs}]}]})
        portal.call(api+'/streams/'+source['id']+'/v1/metrics',{'resourceMetrics':[{'resource':resource,'scopeMetrics':[{'metrics':[{'name':'operations_lab_5xx_requests_per_second','unit':'1/s','gauge':{'dataPoints':[{'timeUnixNano':nanos,'asDouble':float(alert['value'])}]}}]}]}]})
        policy={'name':'Captured firing availability alert','window':{'mode':'sliding','seconds':900},'rules':[{'name':'Firing requires evidence review','enabled':True,'capture':True,'query':{'term':{'status':'firing'}}}]}
        portal.call(api+'/pipeline/policies',{'sourceId':source['id'],'expectedRevision':0,'policy':policy})
        event={'specversion':'1.0','id':episode,'source':source['source'],'type':'operations.alert','time':when,'dataschema':'urn:oshal:operations:alert:1','datacontenttype':'application/json','data':{'environment':'operations-lab','alertType':'LabApplicationErrors','severity':labels['severity'],'status':'firing','resource':{'kind':'kubernetes-pod','scope':scope,'id':labels['pod_uid']}}}
        delivery=portal.call(api+'/events',{'sourceId':source['id'],'event':event});decision=portal.call(api+'/pipeline/evaluate',{'deliveryIds':[delivery['id']]});work=decision['results'][0]['reduction']['workId'];receipt.update(deliveryId=delivery['id'],workId=work);private_json(stage,receipt)
        prepared=portal.call(api+'/investigations',{'workId':work});receipt.update(ticketId=prepared['ticketId'],inputSha256=prepared['inputSha256'],packetSha256=prepared['packetSha256']);private_json(stage,receipt)
        packet=json.loads(bytes(prepared['startInput']['files'][0]['bytes']));assert len(packet['context']['observations'])>=7
        assert packet['executionAuthorized'] is False and packet['rawStreamAccess'] is False
        assert all(item['resource']==event['data']['resource'] for item in packet['context']['observations'])
        portal.call('/tickets/'+prepared['ticketId']+'/start',prepared['startInput']);receipt.update(stage='dispatched',observationCount=len(packet['context']['observations']),resource=event['data']['resource']);private_json(stage,receipt)
        print(json.dumps(receipt),flush=True)


if __name__=='__main__':main()
