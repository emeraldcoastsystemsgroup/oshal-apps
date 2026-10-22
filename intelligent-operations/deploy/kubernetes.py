#!/usr/bin/env python3
"""Deploy a committed Operations package and pinned native kernel into the owned local lab.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Isolated durable Kubernetes experience with native sessions, explicit sandbox policy and reproducible provenance.
"""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, os, secrets, subprocess, sys, tarfile, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parent
STATE=Path.home()/'.local/state/oshal-operations-lab/experience'
NAMESPACE='operations-experience'
KERNEL='oshal-kernel:47cbad1'
KERNEL_ID='sha256:91ec87273602cd49a67574c15a6d2ed359dac89551d9a3f7a73b8c53b9c20a6a'
KERNEL_REV='47cbad1e5b5f6b87853a57ee93a46591ed416055'
POSTGRES='postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
spec=importlib.util.spec_from_file_location('operations_lab',ROOT/'lab/lab.py')
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)

def run(args,**kw):return lab.run(args,**kw)
def kube(*args,text=None):return lab.kubectl(*args,text=text)
def meta(name):return {'name':name,'namespace':NAMESPACE,'labels':{'operations.oshal.dev/experience':'true'}}
def pvc(name,size):return {'apiVersion':'v1','kind':'PersistentVolumeClaim','metadata':meta(name),'spec':{'accessModes':['ReadWriteOnce'],'storageClassName':'standard','resources':{'requests':{'storage':size}}}}
def svc(name,port):return {'apiVersion':'v1','kind':'Service','metadata':meta(name),'spec':{'selector':{'app':name},'ports':[{'port':port,'targetPort':port}],'type':'ClusterIP'}}
def env(name,key):return {'name':name,'valueFrom':{'secretKeyRef':{'name':'operations-private','key':key}}}

def objects(image,revision):
    security={'runAsNonRoot':True,'runAsUser':10001,'runAsGroup':10001,'fsGroup':10001}
    container={'name':'kernel','image':image,'imagePullPolicy':'Never','args':['serve'],'ports':[{'containerPort':38788}],
      'env':[env('OSHAL_ADMIN_TOKEN','admin'),env('OSHAL_VAULT_KEY','vault'),env('OSHAL_POSTGRES','dsn')],
      'envFrom':[{'configMapRef':{'name':'operations-runtime'}}],
      'securityContext':{'allowPrivilegeEscalation':False,'readOnlyRootFilesystem':True,'capabilities':{'drop':['ALL']},'seccompProfile':{'type':'Localhost','localhostProfile':'oshal/seccomp-bwrap.json'},'appArmorProfile':{'type':'Localhost','localhostProfile':'oshal-bwrap'},'procMount':'Unmasked'},
      'resources':{'requests':{'cpu':'100m','memory':'256Mi'},'limits':{'cpu':'1500m','memory':'1536Mi'}},
      'volumeMounts':[{'name':'state','mountPath':'/var/lib/oshal'},{'name':'scratch','mountPath':'/tmp'}],
      'startupProbe':{'httpGet':{'path':'/healthz','port':38788},'periodSeconds':3,'failureThreshold':60},
      'readinessProbe':{'httpGet':{'path':'/readyz','port':38788},'periodSeconds':5,'timeoutSeconds':3},
      'livenessProbe':{'httpGet':{'path':'/healthz','port':38788},'periodSeconds':15,'timeoutSeconds':3}}
    runtime={'OSHAL_BIND':'0.0.0.0:38788','OSHAL_DEPLOYMENT':'home','OSHAL_MOCK_IDENTITY':'false','OSHAL_PLATFORM_DIR':'/app/platform',
      'OSHAL_APPLICATIONS_DIR':'/opt/operations/applications','OSHAL_APP_PRIVATE_DIR':'/opt/operations/empty','OSHAL_ADDITIONAL_APPLICATIONS_DIRS':'/opt/operations/empty',
      'OSHAL_PACKAGE_DIR':'/var/lib/oshal/packages','OSHAL_APPLICATION_FILES_DIR':'/var/lib/oshal/application-files',
      'OSHAL_FLEET_PROVIDER':'noop','OSHAL_FLEET_MODEL':'noop-1','OSHAL_LANDING_PATH':'/api/ui/experiences/intelligent-operations/open'}
    kernel={'apiVersion':'apps/v1','kind':'Deployment','metadata':meta('operations-kernel'),'spec':{'replicas':1,'strategy':{'type':'Recreate'},'selector':{'matchLabels':{'app':'operations-kernel'}},'template':{'metadata':{'labels':{'app':'operations-kernel'},'annotations':{'operations.oshal.dev/source-revision':revision}},'spec':{'hostUsers':False,'automountServiceAccountToken':False,'nodeSelector':{'operations.oshal.dev/sandbox-ready':'true'},'securityContext':security,'containers':[container],'volumes':[{'name':'state','persistentVolumeClaim':{'claimName':'operations-state'}},{'name':'scratch','emptyDir':{'sizeLimit':'256Mi'}}]}}}}
    database={'apiVersion':'apps/v1','kind':'Deployment','metadata':meta('operations-postgres'),'spec':{'replicas':1,'strategy':{'type':'Recreate'},'selector':{'matchLabels':{'app':'operations-postgres'}},'template':{'metadata':{'labels':{'app':'operations-postgres'}},'spec':{'automountServiceAccountToken':False,'securityContext':{'runAsUser':70,'runAsGroup':70,'fsGroup':70},'containers':[{'name':'postgres','image':POSTGRES,'ports':[{'containerPort':5432}],'env':[env('POSTGRES_PASSWORD','postgres'),{'name':'POSTGRES_DB','value':'operations'},{'name':'PGDATA','value':'/var/lib/postgresql/data/pgdata'}],'securityContext':{'allowPrivilegeEscalation':False,'capabilities':{'drop':['ALL']},'seccompProfile':{'type':'RuntimeDefault'}},'resources':{'requests':{'cpu':'50m','memory':'128Mi'},'limits':{'cpu':'500m','memory':'512Mi'}},'volumeMounts':[{'name':'data','mountPath':'/var/lib/postgresql/data'}],'readinessProbe':{'exec':{'command':['pg_isready','-U','postgres','-d','operations']},'periodSeconds':3}}],'volumes':[{'name':'data','persistentVolumeClaim':{'claimName':'operations-postgres'}}]}}}}
    return [{'apiVersion':'v1','kind':'Namespace','metadata':{'name':NAMESPACE,'labels':{'operations.oshal.dev/experience':'true'}}},pvc('operations-state','2Gi'),pvc('operations-postgres','2Gi'),{'apiVersion':'v1','kind':'ConfigMap','metadata':meta('operations-runtime'),'data':runtime},database,svc('operations-postgres',5432),kernel,svc('operations-kernel',38788)]

def private():
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    file=STATE/'credentials.json'
    if not file.exists():
        value={k:secrets.token_hex(32) for k in ['admin','vault','postgres']}
        file.touch(mode=0o600,exist_ok=False);file.write_text(json.dumps(value))
    if file.is_symlink() or file.stat().st_mode&0o077:raise RuntimeError('Private credentials must be an owner-only regular file.')
    value=json.loads(file.read_text());value['dsn']='postgresql://postgres:'+value['postgres']+'@operations-postgres:5432/operations'
    return value

def deploy():
    receipt=lab.guard()
    if run(['git','-C',REPO,'status','--porcelain','--','intelligent-operations']):raise RuntimeError('Commit the Operations package before deploying it.')
    revision=run(['git','-C',REPO,'rev-parse','HEAD'])
    image='oshal-operations-experience:'+revision[:12]
    actual=json.loads(run(['docker','image','inspect',KERNEL]))[0]
    if actual['Id']!=KERNEL_ID or actual['Config']['Labels']['org.opencontainers.image.revision']!=KERNEL_REV:raise RuntimeError('Pinned native kernel image does not match.')
    # Install the reviewed seccomp policy only in this lab's owned nodes. AppArmor must already be loaded on the host.
    core=REPO.parent/'oshal-kernel'
    policy=run(['git','-C',core,'show',KERNEL_REV+':deploy/security/seccomp-bwrap.json'])
    with tempfile.TemporaryDirectory(prefix='operations-build-') as folder:
        folder=Path(folder)
        archive=folder/'package.tar'
        subprocess.run(['git','-C',str(REPO),'archive','--format=tar','--output',str(archive),revision,'intelligent-operations'],check=True)
        with tarfile.open(archive) as tar:tar.extractall(folder,filter='data')
        (folder/'Dockerfile').write_text('FROM '+KERNEL+'\nCOPY --chown=10001:10001 intelligent-operations /opt/operations/applications/intelligent-operations\nLABEL operations.oshal.dev.source-revision="'+revision+'"\n')
        run(['docker','build','--network=none','-t',image,folder],timeout=300)
        (folder/'seccomp.json').write_text(policy+'\n')
        for node in receipt['nodes']:
            # kind's synthetic DMI mounts obstruct nested user namespaces (kind issue 3436).
            # A separate read-only sysfs mount keeps existing node masks and pod security unchanged.
            run(['docker','exec',node,'mkdir','-p','/mnt/operations-sysfs'])
            run(['docker','exec',node,'sh','-c','mountpoint -q /mnt/operations-sysfs || mount -t sysfs -o ro,nosuid,nodev,noexec sysfs /mnt/operations-sysfs'])
            # kind nodes need securityfs visible for kubelet to verify the host's loaded policy.
            present=run(['docker','exec',node,'sh','-c','test -r /sys/kernel/security/apparmor/profiles && printf present || true'])
            if present!='present':
                run(['docker','exec',node,'mount','-t','securityfs','securityfs','/sys/kernel/security'])
                run(['docker','exec',node,'systemctl','restart','containerd'])
                run(['docker','exec',node,'systemctl','restart','kubelet'])
            # containerd checks the real parser executable even for an already-loaded Localhost profile.
            parser=Path('/sbin/apparmor_parser')
            if not parser.is_file():raise RuntimeError('Install the host AppArmor parser before deployment.')
            parser_hash=hashlib.sha256(parser.read_bytes()).hexdigest()
            installed=run(['docker','exec',node,'sh','-c','sha256sum /sbin/apparmor_parser 2>/dev/null || true'])
            if not installed.startswith(parser_hash+' '):
                run(['docker','cp',parser,node+':/sbin/apparmor_parser'])
                run(['docker','exec',node,'/sbin/apparmor_parser','--version'])
                run(['docker','exec',node,'systemctl','restart','containerd'])
            profiles=run(['docker','exec',node,'cat','/sys/kernel/security/apparmor/profiles'])
            if not any(line.startswith('oshal-bwrap (') for line in profiles.splitlines()):raise RuntimeError('Native AppArmor profile is not loaded; refusing deployment.')
            run(['docker','exec',node,'mkdir','-p','/var/lib/kubelet/seccomp/oshal'])
            run(['docker','cp',folder/'seccomp.json',node+':/var/lib/kubelet/seccomp/oshal/seccomp-bwrap.json'])
            kube('label','node',node,'operations.oshal.dev/sandbox-ready=true','--overwrite')
    run([lab.STATE/'bin/kind','load','docker-image',image,'--name',lab.CLUSTER],timeout=300)
    resources=objects(image,revision)
    kube('apply','-f','-',text=json.dumps(resources[0]))
    kube('apply','-f','-',text=json.dumps({'apiVersion':'v1','kind':'Secret','metadata':meta('operations-private'),'type':'Opaque','stringData':private()}))
    kube('apply','-f','-',text=json.dumps({'apiVersion':'v1','kind':'List','items':resources[1:]}))
    try:
        for name in ['operations-postgres','operations-kernel']:kube('-n',NAMESPACE,'rollout','status','deployment/'+name,'--timeout=180s')
        current=json.loads(kube('-n',NAMESPACE,'get','deployment','operations-kernel','-o','json'))
        if current['spec']['replicas']!=1 or current.get('status',{}).get('readyReplicas')!=1:raise RuntimeError('The declared application replica is not ready.')
    except Exception:
        kube('-n',NAMESPACE,'scale','deployment/operations-kernel','--replicas=0')
        raise
    record={'packageRevision':revision,'kernelRevision':KERNEL_REV,'kernelImageId':KERNEL_ID,'applicationImage':image,'applicationImageId':run(['docker','image','inspect',image,'--format','{{.Id}}']),'clusterUid':receipt['kubeSystemUid'],'namespace':NAMESPACE,'apparmorParserSha256':hashlib.sha256(Path('/sbin/apparmor_parser').read_bytes()).hexdigest(),'seccompSha256':hashlib.sha256((policy+'\n').encode()).hexdigest()}
    (STATE/'deployment.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record,indent=2))

def capture():
    receipt=lab.guard();pods=json.loads(kube('-n','operations-demo','get','pods','-o','json'))['items']
    from datetime import datetime,timezone
    result={'environment':'operations-lab','clusterUid':receipt['kubeSystemUid'],'observedAt':datetime.now(timezone.utc).isoformat(),'complete':True,'pods':[]}
    for p in pods:
        statuses={c['name']:c for c in p.get('status',{}).get('containerStatuses',[])}
        ready=next(({'True':True,'False':False}.get(c['status']) for c in p.get('status',{}).get('conditions',[]) if c['type']=='Ready'),None)
        result['pods'].append({'uid':p['metadata']['uid'],'name':p['metadata']['name'],'namespace':p['metadata']['namespace'],'node':p['spec'].get('nodeName'),'ready':ready,'terminating':bool(p['metadata'].get('deletionTimestamp')),'containers':[{'name':c['name'],'image':c['image'],'ready':statuses.get(c['name'],{}).get('ready'),'restarts':statuses.get(c['name'],{}).get('restartCount',0)} for c in p['spec']['containers']]})
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['deploy','render','forward','capture','status']);parser.add_argument('--port',type=int,default=38079);args=parser.parse_args()
    if args.command=='render':print(json.dumps({'apiVersion':'v1','kind':'List','items':objects('oshal-operations-experience:COMMITTED_REVISION','COMMITTED_REVISION')},indent=2))
    elif args.command=='deploy':deploy()
    elif args.command=='capture':capture()
    elif args.command=='status':lab.guard();print(kube('-n',NAMESPACE,'get','pods,pvc,services'))
    else:
        lab.guard()
        if not 1024<=args.port<=65535:raise RuntimeError('Choose an unprivileged local port.')
        os.execv(str(lab.STATE/'bin/kubectl'),[str(lab.STATE/'bin/kubectl'),'--kubeconfig',str(lab.STATE/'kubeconfig'),'--context',lab.CONTEXT,'-n',NAMESPACE,'port-forward','--address=127.0.0.1','service/operations-kernel',str(args.port)+':38788'])
