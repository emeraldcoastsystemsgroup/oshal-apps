#!/usr/bin/env python3
"""Explicit real-local-cluster acceptance; restore healthy mode even after failure."""
import json
import subprocess
import time
import urllib.parse
import lab


def read(url):
    code='import urllib.request;print(urllib.request.urlopen('+repr(url)+',timeout=5).read().decode())'
    return json.loads(lab.kubectl('-n',lab.MON,'exec','deployment/event-recorder','--','python','-c',code))


def healthy_http():
    code="""import urllib.request,time
for _ in range(5):
 with urllib.request.urlopen('http://frontend.operations-demo:8080/',timeout=5) as response:
  assert response.status==200
  response.read(1024)
 time.sleep(0.2)
print('200')
"""
    return lab.kubectl('-n',lab.MON,'exec','deployment/event-recorder','--','python','-c',code)=='200'


def active_pods():
    items=json.loads(lab.kubectl('-n',lab.APP,'get','pods','-l','app=api','-o','json'))['items']
    return [pod for pod in items if not pod['metadata'].get('deletionTimestamp')]


def wait(check,description,seconds=90):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        try:
            if check():return
        except subprocess.CalledProcessError:
            pass  # Endpoint convergence can lag a successful Deployment rollout.
        time.sleep(3)
    raise RuntimeError('Timed out: '+description)


def main():
    lab.guard()
    receipt={'environment':lab.CLUSTER,'synthetic':True,'startedAt':time.time(),'checks':[]}
    destination=lab.STATE/'acceptance.json'
    def firing():
        alerts=read('http://prometheus:9090/api/v1/alerts')['data']['alerts']
        return any(a['labels']['alertname']=='LabApplicationErrors' and a['state']=='firing' for a in alerts)
    try:
        lab.scenario('healthy')
        wait(healthy_http,'five successful dependency HTTP requests',60)
        wait(lambda:not firing(),'healthy monitoring baseline',100)
        initial_deliveries=len(read('http://event-recorder:8080/alerts')['deliveries'])
        receipt['checks'].append('healthy frontend dependency request')
        lab.scenario('errors')
        lab.kubectl('-n',lab.APP,'rollout','status','deployment/api','--timeout=90s')
        lab.load(600,10)
        wait(firing,'actual Prometheus error alert firing')
        receipt['checks'].append('Prometheus observed real synthetic request failures and fired LabApplicationErrors')
        wait(lambda:len(read('http://event-recorder:8080/alerts')['deliveries'])>initial_deliveries,'new Alertmanager delivery recorded')
        receipt['faultCapture']=str(lab.capture())
        receipt['checks'].append('Alertmanager webhook retained with current pod and event evidence')
        lab.scenario('healthy')
        lab.kubectl('-n',lab.APP,'delete','jobs','-l','operations.oshal.dev/lab=true','--ignore-not-found=true')
        wait(healthy_http,'five successful dependency requests after recovery',60)
        wait(lambda:not firing(),'request-error alert clears after its rolling window',100)
        receipt['checks'].append('fresh dependency request returned HTTP 200 and error alert cleared')
        before=active_pods()
        lab.kubectl('-n',lab.APP,'scale','deployment/api','--replicas=3')
        lab.kubectl('-n',lab.APP,'rollout','status','deployment/api','--timeout=90s')
        after=active_pods()
        assert len(after)==3 and len({x['metadata']['uid'] for x in after}-{x['metadata']['uid'] for x in before})>=1
        receipt['checks'].append('scale created a distinct third API pod UID')
        receipt['status']='passed'
    except Exception as error:
        receipt['status']='failed';receipt['failure']=str(error)
        raise
    finally:
        try:
            lab.scenario('healthy')
            lab.kubectl('-n',lab.APP,'scale','deployment/api','--replicas=2')
            lab.kubectl('-n',lab.APP,'delete','jobs','-l','operations.oshal.dev/lab=true','--ignore-not-found=true')
            lab.kubectl('-n',lab.APP,'rollout','status','deployment/api','--timeout=90s')
            receipt['cleanup']='healthy mode, 2 API replicas, no remaining load jobs'
            receipt['recoveryCapture']=str(lab.capture())
        except Exception as error:
            receipt['cleanup']='failed: '+str(error);receipt['status']='failed'
        receipt['finishedAt']=time.time();destination.write_text(json.dumps(receipt,indent=2)+'\n')
        print(json.dumps(receipt,indent=2))
    if receipt['status']!='passed':raise SystemExit(1)


if __name__=='__main__':main()
