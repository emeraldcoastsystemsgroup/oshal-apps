#!/usr/bin/env python3
"""Verify real inventory and labelled correlation probes through the installed local portal.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Capture actual Kubernetes topology and verify durable graph provenance, retry/conflict semantics and saved correlation without dispatch.
"""
import json,uuid,urllib.parse
from datetime import datetime,timezone
from pathlib import Path
from portal import Portal,private_json
from intake_verify import response
import topology
def verify():
    scan=topology.capture()
    path='/api/intelligent-operations'
    with Portal() as p:
        source=p.call(path+'/sources',{'name':'Owned lab topology','source':'urn:operations:topology:owned-lab','environment':'operations-lab'})
        code,saved=response(p,path+'/topology/scans',{'sourceId':source['id'],'scan':scan});assert code==201,(code,saved)
        code,retry=response(p,path+'/topology/scans',{'sourceId':source['id'],'scan':scan});assert code==200 and retry['retry'],(code,retry)
        changed=json.loads(json.dumps(scan));changed['assets'][0]['name']+=' changed'
        code,_=response(p,path+'/topology/scans',{'sourceId':source['id'],'scan':changed});assert code==409,code
        asof=datetime.now(timezone.utc).isoformat();query=urllib.parse.urlencode({'at':asof,'collectionId':scan['collectionId']})
        graph=p.call(path+'/topology?'+query)
        assert len(graph['assets'])==len(scan['assets']) and len(graph['relationships'])==len(scan['relationships'])
        pod=next(a for a in graph['assets'] if a['kind']=='pod')
        container=next(a for a in graph['assets'] if a['kind']=='container' and a['properties']['podUid']==pod['nativeId'])
        other=next(a for a in graph['assets'] if a['kind']=='pod' and a['id']!=pod['id'])
        episode='graph-acceptance-'+uuid.uuid4().hex;deliveries=[]
        for item in [pod,container,other]:
            event={'specversion':'1.0','id':episode+'-'+item['id'][:8],'source':source['source'],'type':'operations.alert','time':scan['observedAt'],'dataschema':'urn:oshal:operations:alert:1','datacontenttype':'application/json','data':{'environment':'operations-lab','alertType':'TopologyAcceptance','severity':'warning','status':'firing','resource':{'kind':'kubernetes-pod' if item['kind']=='pod' else 'container','scope':item['scope'],'id':item['nativeId']}}}
            delivery=p.call(path+'/events',{'sourceId':source['id'],'event':event});assert delivery['decision']=='validated';deliveries.append(delivery['id'])
        body={'deliveryIds':deliveries,'asOf':asof,'collectionId':scan['collectionId'],'policy':{'id':'affected-dependency-paths-v1','types':['RUNS_ON','DEPENDS_ON','ROUTES_TO','FORWARDS_TO'],'maxDepth':4,'maxVisited':500,'maxAgeSeconds':900}}
        result=p.call(path+'/topology/correlate',body)
        assert result['status']=='complete' and len(result['groups'])==2 and len(result['paths'])==1 and result['automaticDispatch']==False,result
        replay=p.call(path+'/topology/correlate',body);assert replay['id']==result['id'] and replay['retry']
        code,_=response(p,path+'/topology',token=False);assert code in (401,403)
        proof={'observedAt':scan['observedAt'],'scanId':saved['scan']['id'],'sourceId':source['id'],'collectionId':scan['collectionId'],'assets':len(graph['assets']),'relationships':len(graph['relationships']),'scanRetry':True,'conflict':409,'unauthenticatedStatus':code,'graphRevision':graph['revision'],'decisionId':result['id'],'correlationStatus':result['status'],'groups':len(result['groups']),'paths':len(result['paths']),'deliveryIds':deliveries,'acceptanceAlertsSynthetic':True,'inventoryFromActualKubernetes':True,'automaticDispatch':False,'periodicCollection':False}
        private_json(Path.home()/'.local/state/oshal-k8s/topology-acceptance.json',proof)
        print(json.dumps(proof,indent=2))


if __name__=='__main__':verify()
