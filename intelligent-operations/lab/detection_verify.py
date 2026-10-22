#!/usr/bin/env python3
"""Verify published rules and reduced evidence reservations through the installed portal.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve a sanitized native receipt for actual percolation and 100 labelled acceptance occurrences.
"""
import json,uuid
from datetime import datetime,timezone
from pathlib import Path
from portal import Portal,private_json
from intake_verify import response
import lab,topology


def verify():
    lab.guard();episode='detection-'+uuid.uuid4().hex;path='/api/intelligent-operations'
    with Portal() as portal:
        health=portal.call(path+'/pipeline/health');assert health['backend']=='opensearch'
        source=portal.call(path+'/sources',{'name':'Detection acceptance '+episode[-8:],'source':'urn:operations:acceptance:'+episode,'environment':'operations-lab'})
        scan=topology.capture();portal.call(path+'/topology/scans',{'sourceId':source['id'],'scan':scan})
        graph=portal.call(path+'/topology?collectionId='+__import__('urllib.parse',fromlist=['quote']).quote(scan['collectionId'],safe=''))
        pod=next(a for a in graph['assets'] if a['kind']=='pod')
        container=next(a for a in graph['assets'] if a['kind']=='container' and a['properties'].get('podUid')==pod['nativeId'])
        other=next(a for a in graph['assets'] if a['kind']=='pod' and a['id']!=pod['id'])
        targets=[pod,container,other]
        rules=[{'name':'Acceptance rule '+str(i),'enabled':i!=36,'capture':True,'query':{'term':{'alertType':'DetectionAcceptance'}}} for i in range(37)]
        policy={'name':'Acceptance '+episode,'window':{'mode':'sliding','seconds':900},'rules':rules}
        published=portal.call(path+'/pipeline/policies',{'sourceId':source['id'],'policy':policy,'expectedRevision':0});assert published['policy']['receipt']['count']==37
        deliveries=[];now=datetime.now(timezone.utc).isoformat()
        for i in range(100):
            target=targets[i%3]
            event={'specversion':'1.0','id':episode+'-'+str(i),'source':source['source'],'type':'operations.alert','time':now,'dataschema':'urn:oshal:operations:alert:1','datacontenttype':'application/json','data':{'environment':'operations-lab','alertType':'DetectionAcceptance' if i<30 else 'FilteredAcceptance','severity':'warning','status':'firing','resource':{'kind':'kubernetes-pod' if target['kind']=='pod' else 'container','scope':target['scope'],'id':target['nativeId']}}}
            saved=portal.call(path+'/events',{'sourceId':source['id'],'event':event});assert saved['decision']=='validated';deliveries.append(saved['id'])
        results=[]
        for offset in range(0,100,20):
            batch=portal.call(path+'/pipeline/evaluate',{'deliveryIds':deliveries[offset:offset+20]})['results'];assert all('error' not in r for r in batch),batch;results.extend(batch)
        assert sum(len(r['matches'])==36 for r in results)==30
        assert sum(r['outcome']=='unmatched' for r in results)==70
        assert sum(r['reduction']['outcome']=='admitted' for r in results)==3
        assert sum(r['reduction']['outcome']=='suppressed' for r in results)==27
        replay=portal.call(path+'/pipeline/evaluate',{'deliveryIds':[deliveries[0]]})['results'][0];assert replay['retry']
        rows=portal.call(path+'/pipeline');key=results[0]['reduction']['symptomKey'];symptom=next(r for r in rows['symptoms'] if r['id']==key)
        assert symptom['count']==10
        reservations=[r for r in rows['evidenceWork'] if r['symptomKey']==key];assert len(reservations)==1 and reservations[0]['executionAuthorized']==False
        survivors=[r['deliveryId'] for r in results if r['reduction']['outcome']=='admitted']
        correlation=portal.call(path+'/topology/correlate',{'deliveryIds':survivors,'asOf':scan['observedAt'],'collectionId':scan['collectionId'],'policy':{'id':'affected-dependency-paths-v1','types':['RUNS_ON','DEPENDS_ON','ROUTES_TO','FORWARDS_TO'],'maxDepth':4,'maxVisited':500,'maxAgeSeconds':900}})
        assert correlation['status']=='complete' and len(correlation['groups'])==2 and len(correlation['paths'])==1,correlation
        assert any(c['id']==correlation['id'] for c in portal.call(path+'/pipeline')['correlations'])
        code,_=response(portal,path+'/pipeline',token=False);assert code in (401,403)
        proof={'observedAt':now,'episode':episode,'sourceId':source['id'],'policyId':published['policy']['id'],'engineBuild':health['engineBuild'],'backend':health['backend'],'backendVersion':health['version'],'rulesPublished':37,'enabledMatchesPerSignal':36,'occurrences':100,'matched':30,'filtered':70,'admitted':3,'suppressed':27,'correlationGroups':2,'correlationPaths':1,'correlationId':correlation['id'],'graphAsOf':scan['observedAt'],'collectionId':scan['collectionId'],'replayRetainsCount':True,'evidenceReservations':3,'reservationId':reservations[0]['id'],'unauthenticatedStatus':code,'acceptanceAlertsSynthetic':True,'automaticProcessing':False,'infrastructureExecution':False,'replicaClaim':'one installed native kernel; independent SQL pools are tested separately'}
        private_json(Path.home()/'.local/state/oshal-k8s/detection-acceptance.json',proof);print(json.dumps(proof,indent=2))


if __name__=='__main__':verify()
