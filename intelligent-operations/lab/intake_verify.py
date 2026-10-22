#!/usr/bin/env python3
"""Verify transactional intake through the installed local native package.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Record real installed concurrent retries, conflicts, quarantine and caller-session refusal.
"""
import concurrent.futures
import json
from pathlib import Path
import uuid
import urllib.error
import urllib.request
from portal import Portal, private_json


def response(portal,path,body=None,token=True):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+portal.token
    req=urllib.request.Request(portal.base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
        with portal.opener.open(req,timeout=150) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:
        return e.code,json.loads(e.read())


def verify():
    episode='intake-'+uuid.uuid4().hex
    path='/api/intelligent-operations'
    with Portal() as portal:
        source=portal.call(path+'/sources',{'name':'Intake acceptance '+episode[-8:],'source':'urn:operations:acceptance:'+episode,'environment':'operations-lab'})
        event={'specversion':'1.0','id':episode,'source':source['source'],'type':'operations.alert',
            'time':'2026-10-20T12:00:00Z','dataschema':'urn:oshal:operations:alert:1',
            'datacontenttype':'application/json','data':{'environment':'operations-lab','alertType':'IntakeAcceptance',
            'severity':'warning','status':'firing','resource':{'kind':'container','scope':'cluster/operations-lab','id':episode}}}
        # This is deliberately labelled acceptance data, not a real cluster alert.
        def send(i):
            raw=event if i%2==0 else dict(reversed(list(event.items())))
            return response(portal,path+'/events',{'sourceId':source['id'],'event':raw})
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:replies=list(executor.map(send,range(100)))
        assert sum(code==201 for code,_ in replies)==1,[(code,body.get('error')) for code,body in replies if code!=200][:5]
        assert sum(code==200 and body.get('retry') is True for code,body in replies)==99
        delivery=next(body['id'] for code,body in replies if code==201)
        changed=json.loads(json.dumps(event));changed['data']['severity']='critical'
        code,conflict=response(portal,path+'/events',{'sourceId':source['id'],'event':changed})
        assert code==409 and conflict['raw']==event and conflict['attempt']['raw']==changed
        missing=json.loads(json.dumps(event));missing['id']=episode+'-missing';del missing['data']['resource']['id']
        code,quarantine=response(portal,path+'/events',{'sourceId':source['id'],'event':missing})
        assert code==201 and quarantine['decision']=='quarantined'
        rows=portal.call(path+'/records');attempts=[a for a in rows['attempts'] if a['deliveryId']==delivery]
        assert len(attempts)==101 and sum(a['outcome']=='retry' for a in attempts)==99
        assert sum(e['id']==delivery for e in rows['events'])==1
        assert sum(w['delivery_id']==delivery and w['state']=='pending' for w in rows['processing'])==1
        assert not any(w['delivery_id']==quarantine['id'] for w in rows['processing'])
        code,_=response(portal,path+'/records',token=False);assert code in (401,403)
        proof={'episode':episode,'sourceId':source['id'],'deliveryId':delivery,'acceptanceData':True,
            'concurrentRequests':100,'replicaClaim':'four concurrent HTTP clients to the installed native deployment; not two kernel replicas',
            'created':1,'retries':99,'conflict':409,'attemptsForDelivery':101,'quarantined':1,'unauthenticatedStatus':code,
            'nativePendingWorkCount':1,'backgroundCollection':False}
        private_json(Path.home()/'.local/state/oshal-k8s/intake-acceptance.json',proof)
        print(json.dumps(proof,indent=2))


if __name__=='__main__':verify()
