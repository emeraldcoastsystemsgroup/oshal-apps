#!/usr/bin/env python3
"""Trusted lab collector: read-only namespace token, explicit projection, no agent credentials.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Capture actual Alertmanager deliveries and prove collector RBAC exclusions.
"""
import json
import subprocess
import tempfile
import time
from pathlib import Path
import lab
import evidence
from portal import private_json


def deliveries():
    code="import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8080/alerts',timeout=10).read().decode())"
    return json.loads(lab.kubectl('-n',lab.MON,'exec','deployment/event-recorder','--','python','-c',code))


def alerts(value):
    if isinstance(value,list):
        for item in value: yield from alerts(item)
    elif isinstance(value,dict):
        if 'labels' in value and 'startsAt' in value: yield value
        else:
            for key in ['alerts','deliveries','body','payload','events']:
                if key in value: yield from alerts(value[key])


def wait_alert(episode,status,timeout=90):
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        matches=[a for a in alerts(deliveries()) if a.get('labels',{}).get('episode')==episode and a.get('status')==status]
        if matches: return matches[-1]
        time.sleep(3)
    raise RuntimeError('No actual Alertmanager '+status+' delivery for this episode.')


def scoped_pods(directory):
    lab.guard()
    config=json.loads(lab.kubectl('config','view','--raw','--minify','-o','json'))
    token=lab.kubectl('-n',lab.APP,'create','token','operations-evidence-collector','--duration=10m')
    config['users']=[{'name':'collector','user':{'token':token}}]
    config['contexts'][0]['context']['user']='collector'
    path=directory/'collector-private.json';private_json(path,config)
    command=[lab.STATE/'bin/kubectl','--kubeconfig',path,'--context',lab.CONTEXT]
    proof={}
    try:
        for verb,resource,namespace in [('get','secrets',lab.APP),('create','pods/exec',lab.APP),('patch','deployments',lab.APP),('get','pods','oshal-install-lab')]:
            result=subprocess.run([str(x) for x in [*command,'auth','can-i',verb,resource,'-n',namespace]],capture_output=True,text=True,timeout=15)
            if result.returncode!=1 or result.stdout.strip()!='no': raise RuntimeError('Collector denial was not proved.')
            proof[verb+' '+namespace+'/'+resource]='denied'
        pods=json.loads(lab.run([*command,'-n',lab.APP,'get','pods','-o','json']))
        return pods,proof
    finally:
        path.unlink(missing_ok=True)


def capture(episode,directory):
    alert=wait_alert(episode,'firing')
    with tempfile.TemporaryDirectory(prefix='operations-collector-') as temp:
        pods,proof=scoped_pods(Path(temp))
    packet=evidence.packet(alert,pods,lab.guard()['kubeSystemUid'],episode)
    directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    private_json(directory/'packet.json',packet)
    private_json(directory/'collector-proof.json',proof)
    for name,content in evidence.scripts(packet).items():
        target=directory/name;target.write_text(content);target.chmod(0o600)
    print('Captured measured CPU alert and isolated evidence:',packet['sha256'])
    return packet


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('episode');args=parser.parse_args()
    capture(args.episode,lab.STATE/'event-to-action'/args.episode)
