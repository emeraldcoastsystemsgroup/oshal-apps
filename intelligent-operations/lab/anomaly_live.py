#!/usr/bin/env python3
"""Live anomaly acceptance on the owned lab: real load, a real scripted fault, real Prometheus series, the installed detector and the normal pipeline.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Drive healthy load, the api error scenario and recovery; stream the frontend pod's real 503 ratio into the installed package as OTLP gauges; score it with the installed detector; evaluate the admitted candidate through percolation and reduction; write a private receipt.
"""
import json
import time
import urllib.parse
from pathlib import Path
import lab
from portal import Portal, private_json

API='/api/intelligent-operations'
TELEMETRY={'name':'Lab frontend metrics','source':'urn:operations:source:lab-prometheus-frontend','environment':'operations-lab'}
CANDIDATES={'name':'Lab anomaly candidates','source':'urn:operations:source:lab-anomaly-candidates','environment':'operations-lab'}
STEP=5


def prom(path):
    code="import urllib.request,sys;print(urllib.request.urlopen('http://prometheus.operations-monitoring.svc:9090'+sys.argv[1],timeout=20).read().decode())"
    return json.loads(lab.kubectl('-n',lab.MON,'exec','deployment/event-recorder','--','python','-c',code,path))


def phase(mode,requests,rate,seconds):
    lab.scenario(mode);start=time.time();lab.load(requests,rate);time.sleep(seconds);return start


def series(start,end):
    ratio=('sum by (pod_uid) (rate(operations_lab_requests_total{service="frontend",status="503"}[20s]))'
           ' / sum by (pod_uid) (rate(operations_lab_requests_total{service="frontend"}[20s]))')
    q='/api/v1/query_range?'+urllib.parse.urlencode({'query':ratio,'start':int(start),'end':int(end),'step':STEP})
    result=prom(q)['data']['result']
    if not result: raise RuntimeError('Prometheus returned no frontend series for the run window.')
    return [(r['metric']['pod_uid'],[(float(t),float(v)) for t,v in r['values'] if v not in ('NaN','+Inf','-Inf')]) for r in result]


def source(portal,definition):
    for s in portal.call(API+'/records')['sources']:
        if s['source']==definition['source']: return s
    return portal.call(API+'/sources',definition)


def run():
    receipt={'kind':'live-anomaly-acceptance','startedAt':time.time(),'steps':[]}
    out=lab.STATE/'event-to-action'/('anomaly-live-'+time.strftime('%Y%m%dT%H%M%S')+'.json')
    def step(name,**values): receipt['steps'].append({'step':name,'at':time.time(),**values});private_json(out,receipt)
    cluster=lab.guard()['kubeSystemUid']
    t0=phase('healthy',1000,10,100);step('healthy-load',seconds=100)
    t1=phase('errors',600,10,60);step('error-fault',seconds=60)
    t2=phase('healthy',600,10,60);step('recovered-load',seconds=60)
    t3=time.time();time.sleep(25)
    data=series(t0,t3);step('prometheus',series=len(data),samples=sum(len(v) for _,v in data))
    with Portal() as portal:
        telemetry=source(portal,TELEMETRY);candidates=source(portal,CANDIDATES)
        streams=portal.call(API+'/telemetry')
        stream=next((s for s in streams.get('streams',[]) if s['id']==telemetry['id']),None)
        if not stream:
            portal.call(API+'/telemetry/configure',{'sourceId':telemetry['id'],'config':{'resourceKind':'kubernetes-pod','idAttribute':'k8s.pod.uid','scopeAttribute':'k8s.cluster.uid','maxBankRecords':2000,'maxBankBytes':2097152},'expectedRevision':0})
        accepted=0
        for uid,points in data:
            for i in range(0,len(points),60):
                batch=[{'timeUnixNano':str(int(t*1e9)),'asDouble':round(v,6)} for t,v in points[i:i+60]]
                body={'resourceMetrics':[{'resource':{'attributes':[{'key':'k8s.pod.uid','value':{'stringValue':uid}},{'key':'k8s.cluster.uid','value':{'stringValue':cluster}}]},'scopeMetrics':[{'metrics':[{'name':'frontend.error_ratio','unit':'1','gauge':{'dataPoints':batch}}]}]}]}
                portal.call(API+'/streams/'+telemetry['id']+'/v1/metrics',body);accepted+=len(batch)
        step('telemetry-ingested',points=accepted,sourceId=telemetry['id'])
        pipeline=portal.call(API+'/pipeline');binding=next((b for b in pipeline.get('bindings',[]) if b.get('id')==candidates['id'] or b.get('sourceId')==candidates['id']),None)
        if not binding:
            portal.call(API+'/pipeline/policies',{'sourceId':candidates['id'],'policy':{'name':'Anomaly candidates','window':{'mode':'sliding','seconds':900},'rules':[{'name':'Anomaly firing','enabled':True,'capture':True,'query':{'term':{'status':'firing'}}}]},'expectedRevision':0})
        current=portal.call(API+'/anomaly')['config']
        portal.call(API+'/anomaly/config',{'enabled':True,'telemetrySourceIds':[telemetry['id']],'candidateSourceId':candidates['id'],'metricNames':['frontend.error_ratio'],'parameters':{'detector':'robust-zscore','threshold':6,'persistence':2,'warmupSamples':12,'windowSamples':288,'resolveSamples':3},'expectedRevision':current['revision']})
        detection=portal.call(API+'/anomaly/run',{});step('detection',candidates=detection.get('candidates'),resolved=detection.get('resolved'),failed=detection.get('failed'),results=detection.get('results'))
        page=portal.call(API+'/anomaly');step('baselines',baselines=[{k:b.get(k) for k in ['name','resource','readiness','samples','lastScore','firing','lastCandidate']} for b in page['baselines'] if b['name']=='frontend.error_ratio'])
        records=portal.call(API+'/records');mine=[e for e in records['events'] if e.get('sourceId')==candidates['id'] and e['normalized']['time']>=time.strftime('%Y-%m-%dT%H:%M:%S',time.gmtime(t0))]
        step('candidates',events=[{'id':e['id'],'status':e['normalized']['data']['status'],'alertType':e['normalized']['data']['alertType'],'time':e['normalized']['time'],'score':e['raw']['data'].get('score'),'decision':e['decision']} for e in mine])
        firing=[e['id'] for e in mine if e['normalized']['data']['status']=='firing']
        if firing:
            evaluated=portal.call(API+'/pipeline/evaluate',{'deliveryIds':firing[:20]});step('evaluated',results=[{'deliveryId':r.get('deliveryId'),'outcome':r.get('outcome'),'reduction':(r.get('reduction') or {}).get('outcome'),'error':r.get('error')} for r in evaluated['results']])
        receipt['window']={'healthyFrom':t0,'faultFrom':t1,'recoveredFrom':t2,'end':t3}
    receipt['finishedAt']=time.time();private_json(out,receipt);print(json.dumps({k:receipt[k] for k in ['window']}),out);return receipt


if __name__=='__main__':
    run()
