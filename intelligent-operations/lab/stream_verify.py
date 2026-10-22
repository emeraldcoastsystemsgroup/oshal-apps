#!/usr/bin/env python3
"""Verify standard syslog/OTLP flow into the owned native installation.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Use a pinned, temporary, bounded Collector and a short-lived existing-user session; never bootstrap or agent credentials.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid
from portal import Portal, private_json

BASE='/api/intelligent-operations'


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        return sock.getsockname()[1]


def verify():
    image=json.loads((Path(__file__).parent/'versions.json').read_text())['images']['collector']
    episode='stream-'+uuid.uuid4().hex;name='triagenorth-'+episode;syslog_port=port();otlp_port=port()
    with Portal() as portal, tempfile.TemporaryDirectory(prefix='triagenorth-collector-') as temporary:
        source=portal.call(BASE+'/sources',{'name':'Standard Collector acceptance','source':'urn:triagenorth:'+episode,'environment':episode})
        portal.call(BASE+'/telemetry/configure',{'sourceId':source['id'],'config':{'resourceKind':'host','idAttribute':'host.id','scopeAttribute':'site.id'},'expectedRevision':0})
        config={'receivers':{'syslog':{'tcp':{'listen_address':'127.0.0.1:'+str(syslog_port),'max_log_size':'64KiB'},'protocol':'rfc5424'},'otlp':{'protocols':{'http':{'endpoint':'127.0.0.1:'+str(otlp_port)}}}},
                'processors':{'resource/identity':{'attributes':[{'key':key,'value':value,'action':'upsert'} for key,value in {'host.id':'collector-canary-host','site.id':'native-stream-test','deployment.environment.name':episode}.items()]},'transform/body':{'error_mode':'ignore','log_statements':[{'context':'log','statements':['set(body, attributes["message"]) where attributes["message"] != nil','set(body, body["message"]) where IsMap(body) and body["message"] != nil']}]},'batch':{'send_batch_size':1,'send_batch_max_size':1,'timeout':'1s'}},
                'exporters':{'otlphttp/native':{'endpoint':portal.base+BASE+'/streams/'+source['id'],'encoding':'json','compression':'none','headers':{'Authorization':'Bearer '+portal.token},'retry_on_failure':{'enabled':True,'initial_interval':'1s','max_interval':'3s','max_elapsed_time':'20s'},'sending_queue':{'enabled':True,'num_consumers':1,'queue_size':64}}},
                'service':{'pipelines':{'logs':{'receivers':['syslog','otlp'],'processors':['resource/identity','transform/body','batch'],'exporters':['otlphttp/native']},'metrics':{'receivers':['otlp'],'processors':['resource/identity','batch'],'exporters':['otlphttp/native']}}}}
        file=Path(temporary)/'collector.json';private_json(file,config)
        args=['docker','run','--detach','--name',name,'--label','oshal.owner=operations-stream-acceptance','--network=host','--user',str(file.stat().st_uid)+':'+str(file.stat().st_gid),'--cpus=0.5','--memory=256m','--memory-swap=256m','--pids-limit=64','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--mount','type=bind,src='+str(file)+',dst=/config.json,readonly',image,'--config=/config.json']
        created=False
        try:
            subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=60);created=True
            deadline=time.monotonic()+30
            while True:
                try:
                    sock=socket.create_connection(('127.0.0.1',syslog_port),timeout=1);break
                except OSError:
                    running=subprocess.run(['docker','inspect','--format','{{.State.Running}}',name],capture_output=True,text=True,timeout=5)
                    if running.stdout.strip()!='true':raise RuntimeError('Pinned Collector exited during startup; inspect its private acceptance log.')
                    if time.monotonic()>deadline:raise RuntimeError('Pinned Collector did not start; inspect its private acceptance log.')
                    time.sleep(.5)
            with sock:
                stamp=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
                for i in range(2):sock.sendall(('<34>1 '+stamp+' canary triagenorth 123 ID47 - SYNTHETIC syslog '+episode+'-'+str(i)+'\n').encode())
            metrics={'resourceMetrics':[{'scopeMetrics':[{'metrics':[{'name':'host.disk.queue','unit':'1','gauge':{'dataPoints':[{'timeUnixNano':str(time.time_ns()),'asDouble':7}]}}]}]}]}
            request=urllib.request.Request('http://127.0.0.1:'+str(otlp_port)+'/v1/metrics',data=json.dumps(metrics).encode(),headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(request,timeout=10) as result:assert result.status==200
            resource={'kind':'host','scope':'native-stream-test','id':'collector-canary-host'}
            deadline=time.monotonic()+45
            while True:
                window=portal.call(BASE+'/telemetry/window',{'sourceId':source['id'],'resource':resource,'at':datetime.now(timezone.utc).isoformat()})
                logs=[o for o in window['observations'] if o['signal']=='log'];points=[o for o in window['observations'] if o['signal']=='metric']
                if len(logs)==2 and len(points)==1:break
                if time.monotonic()>deadline:raise RuntimeError('Collector export did not produce exactly two syslogs and one metric in the admitted stream.')
                time.sleep(1)
            assert all(episode in o['body'] for o in logs) and points[0]['name']=='host.disk.queue' and points[0]['value']==7
            proof={'kind':'native-standard-stream-acceptance','passed':True,'collectorImage':image,'syslogProtocol':'RFC5424/TCP','export':'OTLP/HTTP JSON without compression','syslogObservations':len(logs),'metricObservations':len(points),'nativeResourceMapping':True,'identity':'temporary existing-user password session; no bootstrap credential','durableProducerEnrollment':False,'collectorRemovedAfterCheck':True,'synthetic':True,'at':datetime.now(timezone.utc).isoformat()}
            private_json(Path.home()/'.local/state/oshal-k8s/standard-stream-acceptance.json',proof);print(json.dumps(proof,indent=2))
        except Exception:
            if created:
                result=subprocess.run(['docker','logs',name],capture_output=True,text=True,timeout=10)
                text=(result.stdout+result.stderr).replace(portal.token,'[redacted]')
                private_json(Path.home()/'.local/state/oshal-k8s/standard-stream-failure.json',{'collectorLog':text[-16000:]})
            raise
        finally:
            if created:subprocess.run(['docker','rm','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True,timeout=20)


if __name__=='__main__':verify()
