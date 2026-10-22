#!/usr/bin/env python3
"""Verify the real native minimum-age guard without changing a server clock.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Start a three-bank canary, then verify safe reuse and pinned evidence after fifteen real minutes.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import uuid
from portal import Portal, private_json
from intake_verify import response

BASE='/api/intelligent-operations'
STATE=Path.home()/'.local/state/oshal-k8s/retention-canary.json'


def now():
    return datetime.now(timezone.utc).isoformat()


def log(identifier):
    return {'resourceLogs':[{'resource':{'attributes':[{'key':'host.id','value':{'stringValue':'canary-host'}},{'key':'site.id','value':{'stringValue':'native-retention-test'}}]},'scopeLogs':[{'logRecords':[{'timeUnixNano':str(time.time_ns()),'body':{'stringValue':'SYNTHETIC retained context '+identifier},'attributes':[{'key':'log.record.uid','value':{'stringValue':identifier}}]}]}]}]}


def start():
    if STATE.exists():raise ValueError('An existing retention canary is present; finish it before starting another.')
    episode='retention-'+uuid.uuid4().hex
    with Portal() as portal:
        source=portal.call(BASE+'/sources',{'name':'Native 15-minute retention canary','source':'urn:triagenorth:'+episode,'environment':episode})
        portal.call(BASE+'/telemetry/configure',{'sourceId':source['id'],'config':{'resourceKind':'host','idAttribute':'host.id','scopeAttribute':'site.id','maxBankRecords':1},'expectedRevision':0})
        first_at=time.time()
        for i in range(3):portal.call(BASE+'/streams/'+source['id']+'/v1/logs',log(episode+'-'+str(i)))
        code,_=response(portal,BASE+'/streams/'+source['id']+'/v1/logs',log(episode+'-blocked'))
        assert code==429, 'Native ring must backpressure before its first minimum age.'
        alert_at=now();resource={'kind':'host','scope':'native-retention-test','id':'canary-host'}
        event={'specversion':'1.0','id':episode,'source':source['source'],'type':'operations.alert','time':alert_at,'dataschema':'urn:oshal:operations:alert:1','datacontenttype':'application/json','data':{'environment':episode,'alertType':'RetentionCanary','severity':'warning','status':'firing','resource':resource}}
        portal.call(BASE+'/pipeline/policies',{'sourceId':source['id'],'expectedRevision':0,'policy':{'name':episode,'window':{'mode':'fixed','seconds':900},'rules':[{'name':'Capture canary context','query':{'term':{'alertType':'RetentionCanary'}},'enabled':True,'capture':True}]}})
        delivery=portal.call(BASE+'/events',{'sourceId':source['id'],'event':event})
        decision=portal.call(BASE+'/pipeline/evaluate',{'deliveryIds':[delivery['id']]})['results'][0]
        assert 'error' not in decision
        packet=portal.call(BASE+'/telemetry/pin',{'workId':decision['reduction']['workId']})
        assert len(packet['observations'])==3
        private_json(STATE,{'episode':episode,'sourceId':source['id'],'firstReceiptWallSeconds':first_at,'alertAt':alert_at,'resource':resource,'packetId':packet['id'],'packetSha256':packet['sha256'],'initialProtectedStatus':code,'initialPacketObservations':3})
        print(json.dumps({'state':'waiting-for-real-minimum-age','minimumSeconds':900,'initialBackpressure':code,'packetObservations':3}))


def finish():
    saved=json.loads(STATE.read_text())
    elapsed=time.time()-saved['firstReceiptWallSeconds']
    if elapsed<902:raise ValueError('Canary needs another '+str(round(902-elapsed))+' real seconds; no clock or database bypass is used.')
    with Portal() as portal:
        portal.call(BASE+'/streams/'+saved['sourceId']+'/v1/logs',log(saved['episode']+'-after-retention'))
        state=next(s for s in portal.call(BASE+'/telemetry')['streams'] if s['id']==saved['sourceId'])
        assert state['active']==0 and state['banks'][0]['generation']==1
        window=portal.call(BASE+'/telemetry/window',{'sourceId':saved['sourceId'],'resource':saved['resource'],'at':saved['alertAt']})
        assert window['matched']==2
        packet=portal.call(BASE+'/telemetry/pin',{'workId':saved['packetId']})
        assert packet['retry'] and packet['sha256']==saved['packetSha256'] and len(packet['observations'])==3
        proof={'kind':'native-real-time-retention','passed':True,'at':now(),'elapsedSeconds':round(elapsed,3),'minimumSeconds':900,'earlyReuseHttp':saved['initialProtectedStatus'],'reusedBank':0,'generation':1,'rawContextRemaining':2,'pinnedContextRetained':3,'packetHashUnchanged':True,'serverClockChanged':False,'syntheticCanary':True}
        private_json(STATE.with_name('retention-native-acceptance.json'),proof)
        print(json.dumps(proof,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['start','finish']);args=parser.parse_args()
    start() if args.command=='start' else finish()
