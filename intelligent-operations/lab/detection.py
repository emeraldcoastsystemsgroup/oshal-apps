#!/usr/bin/env python3
"""Install the package-owned detection service in the guarded local Kubernetes lab.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Deploy an isolated percolator and engine bridge; pin it through the existing native package engine relay.
"""
import argparse
import json
from pathlib import Path
import lab

ROOT=Path(__file__).resolve().parents[1]
SEARCH='opensearchproject/opensearch@sha256:6836708871685e272ad9042285e1c680790fe4315b047279ad16f761da2f4b70'
NAME='operations-detection'
KERNEL_NS='oshal-install-lab'


def manifests():
    image=json.loads((ROOT/'lab/versions.json').read_text())['images']['workload']
    meta=lambda name:{'name':name,'namespace':lab.MON,'labels':{'app':NAME,'oshal.owner':'operations-lab'}}
    security={'runAsNonRoot':True,'runAsUser':1000,'allowPrivilegeEscalation':False,'capabilities':{'drop':['ALL']},'seccompProfile':{'type':'RuntimeDefault'}}
    engine={'name':'engine','image':image,'command':['python','/engine/server.py'],'env':[{'name':'PYTHONDONTWRITEBYTECODE','value':'1'},{'name':'OPERATIONS_ENGINE_BIND','value':'0.0.0.0'}],'ports':[{'containerPort':7419}], 'securityContext':{**security,'readOnlyRootFilesystem':True},'resources':{'requests':{'cpu':'100m','memory':'64Mi'},'limits':{'cpu':'500m','memory':'256Mi'}},'volumeMounts':[{'name':'code','mountPath':'/engine','readOnly':True}],'readinessProbe':{'tcpSocket':{'port':7419},'initialDelaySeconds':3}}
    env={'discovery.type':'single-node','network.host':'127.0.0.1','node.store.allow_mmap':'false','DISABLE_INSTALL_DEMO_CONFIG':'true','DISABLE_SECURITY_PLUGIN':'true','OPENSEARCH_JAVA_OPTS':'-Xms512m -Xmx512m'}
    search={'name':'search','image':SEARCH,'env':[{'name':k,'value':v} for k,v in env.items()],'securityContext':security,'resources':{'requests':{'cpu':'500m','memory':'768Mi'},'limits':{'cpu':'2','memory':'1536Mi'}},'volumeMounts':[{'name':'search','mountPath':'/usr/share/opensearch/data'}],'readinessProbe':{'exec':{'command':['curl','-fsS','http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=2s']},'initialDelaySeconds':15,'periodSeconds':5,'timeoutSeconds':3,'failureThreshold':24}}
    pod={'automountServiceAccountToken':False,'securityContext':{'fsGroup':1000},'containers':[engine,search],'volumes':[{'name':'code','configMap':{'name':NAME}},{'name':'search','persistentVolumeClaim':{'claimName':NAME}}]}
    return [
        {'apiVersion':'v1','kind':'ConfigMap','metadata':meta(NAME),'data':{n:(ROOT/'engine'/n).read_text() for n in ['server.py','percolation.py']}},
        {'apiVersion':'v1','kind':'PersistentVolumeClaim','metadata':meta(NAME),'spec':{'accessModes':['ReadWriteOnce'],'resources':{'requests':{'storage':'5Gi'}}}},
        {'apiVersion':'apps/v1','kind':'Deployment','metadata':meta(NAME),'spec':{'replicas':1,'strategy':{'type':'Recreate'},'selector':{'matchLabels':{'app':NAME}},'template':{'metadata':{'labels':meta(NAME)['labels'],'annotations':{'operations.oshal.dev/engine-build':json.loads((ROOT/'engine/identity.json').read_text())['buildHash']}},'spec':pod}}},
        {'apiVersion':'v1','kind':'Service','metadata':meta(NAME),'spec':{'selector':{'app':NAME},'ports':[{'port':7419,'targetPort':7419}]}},
        {'apiVersion':'networking.k8s.io/v1','kind':'NetworkPolicy','metadata':meta(NAME),'spec':{'podSelector':{'matchLabels':{'app':NAME}},'policyTypes':['Ingress','Egress'],'ingress':[{'from':[{'namespaceSelector':{'matchLabels':{'kubernetes.io/metadata.name':KERNEL_NS}},'podSelector':{'matchLabels':{'app.kubernetes.io/name':'oshal-kernel'}}}],'ports':[{'protocol':'TCP','port':7419}]}],'egress':[]}}
    ]



def repair_import_names():
    """Kind may retain unnamed Docker import references that CRI normalizes differently."""
    expected=json.loads(lab.run(['docker','image','inspect',SEARCH]))[0]['Id']
    for node in lab.run([lab.STATE/'bin/kind','get','nodes','--name',lab.CLUSTER]).splitlines():
        held=json.loads(lab.run(['docker','exec',node,'crictl','inspecti',expected]))['status']
        if held['id']!=expected:raise ValueError('Imported search image differs from the pinned local image.')
        names=set(lab.run(['docker','exec',node,'ctr','-n','k8s.io','images','list','-q']).splitlines())
        canonical='docker.io/'+SEARCH
        if canonical not in names:
            if expected not in names:raise ValueError('Verified search image content is unavailable.')
            lab.run(['docker','exec',node,'ctr','-n','k8s.io','images','tag',expected,canonical])
        for normalized in held.get('repoDigests',[]):
            if normalized.startswith('docker.io/library/import-') and normalized not in names:
                original=normalized.removeprefix('docker.io/library/')
                if original not in names:raise ValueError('Search import reference is unavailable.')
                lab.run(['docker','exec',node,'ctr','-n','k8s.io','images','tag',original,normalized])


def deploy():
    lab.guard()
    lab.run([lab.STATE/'bin/kind','load','docker-image',SEARCH,'--name',lab.CLUSTER],timeout=240)
    repair_import_names()
    lab.kubectl('apply','-f','-',text=json.dumps({'apiVersion':'v1','kind':'List','items':manifests()}))
    lab.kubectl('-n',lab.MON,'rollout','status','deployment/'+NAME,'--timeout=180s')
    address=lab.kubectl('-n',lab.MON,'get','service',NAME,'-o','jsonpath={.spec.clusterIP}').strip()+':7419'
    deployment=json.loads(lab.kubectl('-n',KERNEL_NS,'get','deployment','oshal-kernel-deployment','-o','json'))
    container=next(c for c in deployment['spec']['template']['spec']['containers'] if c['name']=='oshal-kernel')
    current=next((v for v in container.get('env',[]) if v['name']=='OSHAL_PACKAGE_ENGINES'),None)
    if current and 'value' not in current:raise ValueError('Existing engine map is externally managed; preserve its source and update that configuration.')
    mapping=json.loads(current['value']) if current else {};mapping['intelligent-operations']=address
    lab.kubectl('-n',KERNEL_NS,'set','env','deployment/oshal-kernel-deployment','--containers=oshal-kernel','OSHAL_PACKAGE_ENGINES='+json.dumps(mapping,separators=(',',':')))
    lab.kubectl('-n',KERNEL_NS,'rollout','status','deployment/oshal-kernel-deployment','--timeout=180s')
    print('Detection engine ready; native package engine binding installed. Reconnect the portal port-forward after kernel replacement.')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['render','deploy','status']);args=parser.parse_args()
    if args.command=='render':print(json.dumps(manifests(),indent=2))
    elif args.command=='deploy':deploy()
    else:lab.guard();print(lab.kubectl('-n',lab.MON,'get','deployment,service,pvc','-l','app='+NAME))
