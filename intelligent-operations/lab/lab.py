#!/usr/bin/env python3
"""Isolated Operations Kubernetes lab lifecycle and bounded scenarios (stdlib only)."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
STATE = Path.home() / '.local/state/oshal-operations-lab'
CLUSTER = 'operations-lab'
CONTEXT = 'kind-operations-lab'
APP = 'operations-demo'
MON = 'operations-monitoring'
LABEL = {'operations.oshal.dev/lab': 'true'}


def run(args, text=None, timeout=240):
    return subprocess.run([str(x) for x in args], input=text, capture_output=True, text=True, check=True, timeout=timeout).stdout.strip()


def kubectl(*args, text=None):
    return run([STATE/'bin/kubectl', '--kubeconfig', STATE/'kubeconfig', '--context', CONTEXT, *args], text=text)


def local_docker():
    """A remote Docker context must not turn this local lab into remote work."""
    override=os.environ.get('DOCKER_HOST','')
    context=os.environ.get('DOCKER_CONTEXT','')
    endpoint=run(['docker','context','inspect',context,'--format','{{.Endpoints.docker.Host}}']) if context else (
        override or run(['docker','context','inspect','--format','{{.Endpoints.docker.Host}}']))
    if not endpoint.startswith('unix://'):
        raise RuntimeError('The lab requires a local Unix-socket Docker endpoint.')


def guard():
    """Mutations require the private ownership receipt, exact cluster UID and loopback API."""
    local_docker()
    receipt = json.loads((STATE/'ownership.json').read_text())
    if receipt.get('cluster') != CLUSTER:
        raise RuntimeError('The local lab ownership receipt does not match.')
    server = kubectl('config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}')
    if not server.startswith('https://127.0.0.1:'):
        raise RuntimeError('Refusing a Kubernetes API outside the owned loopback lab.')
    current = kubectl('get', 'namespace', 'kube-system', '-o', 'jsonpath={.metadata.uid}')
    if current != receipt.get('kubeSystemUid'):
        raise RuntimeError('Cluster incarnation changed; refusing the old ownership receipt.')
    nodes = [json.loads(line) for line in run(['docker', 'ps', '--filter', 'label=io.x-k8s.kind.cluster='+CLUSTER, '--format', '{{json .Names}}']).splitlines()]
    if sorted(nodes) != sorted(receipt.get('nodes', [])) or len(nodes) != 3:
        raise RuntimeError('The three owned local kind nodes are not present.')
    return receipt


def install_tools():
    lock = json.loads((ROOT/'versions.json').read_text())
    if platform.system() != 'Linux':
        raise RuntimeError('This bootstrap currently supports Linux; no system tools are replaced.')
    arch = {'aarch64': 'arm64', 'x86_64': 'amd64'}.get(platform.machine())
    if not arch:
        raise RuntimeError('Unsupported host architecture.')
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    (STATE/'bin').mkdir(exist_ok=True, mode=0o700)
    for name, version in [('kind', lock['kindVersion']), ('kubectl', lock['kubectlVersion'])]:
        expected = lock['toolChecksums'][name+'-linux-'+arch]
        path = STATE/'bin'/name
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            continue
        url = f'https://github.com/kubernetes-sigs/kind/releases/download/{version}/kind-linux-{arch}' if name == 'kind' else f'https://dl.k8s.io/release/{version}/bin/linux/{arch}/kubectl'
        body = urllib.request.urlopen(url, timeout=90).read()
        if hashlib.sha256(body).hexdigest() != expected:
            raise RuntimeError('Downloaded tool did not match its pinned checksum.')
        path.write_bytes(body)
        path.chmod(0o700)
    return lock


def bootstrap():
    local_docker()
    lock = install_tools()
    clusters = run([STATE/'bin/kind', 'get', 'clusters']).splitlines()
    if CLUSTER in clusters:
        guard()
        return
    if (STATE/'ownership.json').exists():
        raise RuntimeError('A previous lab receipt remains. Use destroy before recreating the lab.')
    run([STATE/'bin/kind', 'create', 'cluster', '--name', CLUSTER, '--config', ROOT/'kind.yaml', '--kubeconfig', STATE/'kubeconfig', '--image', lock['nodeImage'], '--wait', '180s'], timeout=360)
    (STATE/'kubeconfig').chmod(0o600)
    nodes = [CLUSTER+'-control-plane', CLUSTER+'-worker', CLUSTER+'-worker2']
    receipt = {'cluster': CLUSTER, 'kubeSystemUid': kubectl('get','namespace','kube-system','-o','jsonpath={.metadata.uid}'), 'nodes': nodes}
    (STATE/'ownership.json').write_text(json.dumps(receipt, indent=2)+'\n')
    (STATE/'ownership.json').chmod(0o600)


def metadata(name, namespace=None, labels=None):
    out = {'name': name, 'labels': {**LABEL, **(labels or {})}}
    if namespace:
        out['namespace'] = namespace
    return out


def configmap(name, namespace, data):
    return {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': metadata(name, namespace), 'data': data}


def deployment(name, namespace, image, *, command=None, args=None, env=None, ports=None, mounts=None, volumes=None, replicas=1, account=None, memory='128Mi', cpu='200m'):
    container = {'name': name, 'image': image, 'ports': [{'containerPort': p} for p in (ports or [8080])],
                 'resources': {'requests': {'cpu': '25m', 'memory': '32Mi'}, 'limits': {'cpu': cpu, 'memory': memory}},
                 'securityContext': {'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}, 'seccompProfile': {'type': 'RuntimeDefault'}}}
    if command: container['command'] = command
    if args: container['args'] = args
    if env: container['env'] = [{'name': k, 'value': v} for k,v in env.items()]
    if mounts: container['volumeMounts'] = mounts
    if name in ['frontend','api','event-recorder']:
        container['readinessProbe'] = {'httpGet': {'path': '/readyz', 'port': 8080}, 'periodSeconds': 3, 'failureThreshold': 2}
        container['livenessProbe'] = {'httpGet': {'path': '/healthz', 'port': 8080}, 'periodSeconds': 10}
    spec = {'containers': [container], 'automountServiceAccountToken': bool(account), 'securityContext': {'fsGroup': 65534}}
    if account: spec['serviceAccountName'] = account
    if volumes: spec['volumes'] = volumes
    return {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': metadata(name, namespace), 'spec': {
        'replicas': replicas, 'selector': {'matchLabels': {'app': name}},
        'template': {'metadata': {'labels': {**LABEL, 'app': name}}, 'spec': spec}}}


def service(name, namespace, ports):
    return {'apiVersion': 'v1', 'kind': 'Service', 'metadata': metadata(name, namespace),
            'spec': {'selector': {'app': name}, 'ports': [{'name': 'p'+str(p), 'port': p, 'targetPort': p} for p in ports]}}


def manifests():
    images = json.loads((ROOT/'versions.json').read_text())['images']
    if not all('@sha256:' in image for image in images.values()):
        raise RuntimeError('Every lab workload image must be pinned by digest.')
    objects = [{'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': metadata(ns)} for ns in [APP,MON]]
    for ns in [APP,MON]:
        objects += [{'apiVersion': 'v1', 'kind': 'ResourceQuota', 'metadata': metadata('lab-budget', ns),
                     'spec': {'hard': {'pods': '20', 'requests.cpu': '3', 'requests.memory': '3Gi', 'limits.cpu': '6', 'limits.memory': '6Gi'}}},
                    configmap('lab-workload', ns, {'workload.py': (ROOT/'workload.py').read_text()})]
    for name, dependency, replicas in [('api','',2),('frontend','http://api:8080/',1)]:
        objects.append(deployment(name, APP, images['workload'], command=['python','/app/workload.py'],
            env={'SERVICE_NAME': name, 'LAB_SCENARIO': 'healthy', 'DEPENDENCY_URL': dependency, 'OTLP_HTTP': f'http://collector.{MON}:4318'},
            mounts=[{'name':'code','mountPath':'/app','readOnly':True}],volumes=[{'name':'code','configMap':{'name':'lab-workload'}}],replicas=replicas))
        objects.append(service(name, APP, [8080]))
    objects.append(deployment('event-recorder',MON,images['workload'],command=['python','/app/workload.py'],env={'SERVICE_NAME':'event-recorder','RECORDER_DATABASE':'/data/events.db'},
        mounts=[{'name':'code','mountPath':'/app','readOnly':True},{'name':'data','mountPath':'/data'}],volumes=[{'name':'code','configMap':{'name':'lab-workload'}},{'name':'data','emptyDir':{'sizeLimit':'64Mi'}}]))
    objects.append(service('event-recorder',MON,[8080]))
    prometheus = f'''global:
  scrape_interval: 5s
  evaluation_interval: 5s
  external_labels:
    environment: operations-lab
    source: operations-lab-prometheus
rule_files: [/config/rules.yaml]
alerting:
  alertmanagers:
    - static_configs:
        - targets: [alertmanager:9093]
scrape_configs:
  - job_name: lab-services
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names: [{APP}]
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: frontend|api
        action: keep
      - source_labels: [__meta_kubernetes_pod_phase]
        regex: Running
        action: keep
      - source_labels: [__meta_kubernetes_pod_name]
        target_label: pod
      - source_labels: [__meta_kubernetes_pod_uid]
        target_label: pod_uid
      - source_labels: [__meta_kubernetes_namespace]
        target_label: namespace
      - source_labels: [__meta_kubernetes_pod_node_name]
        target_label: node
  - job_name: kube-state-metrics
    static_configs:
      - targets: [state-metrics:8080]
'''
    rules = f'''groups:
  - name: operations-lab
    rules:
      - alert: LabApplicationErrors
        expr: sum by (service, pod, pod_uid, namespace, node) (rate(operations_lab_requests_total{{status=~"5.."}}[1m])) > 0.1
        for: 10s
        labels: {{severity: warning, environment: operations-lab}}
        annotations: {{summary: "Synthetic lab service is returning errors"}}
      - alert: LabContainerRestarting
        expr: increase(kube_pod_container_status_restarts_total{{namespace="{APP}"}}[5m]) > 0
        labels: {{severity: warning, environment: operations-lab}}
        annotations: {{summary: "Synthetic lab container restarted"}}
      - alert: LabWorkloadNotReady
        expr: kube_deployment_status_replicas_unavailable{{namespace="{APP}"}} > 0
        for: 15s
        labels: {{severity: warning, environment: operations-lab}}
        annotations: {{summary: "Synthetic lab deployment has unavailable replicas"}}
'''
    alertmanager = '''global:
  resolve_timeout: 30s
route:
  receiver: local-recorder
  group_by: [alertname, environment]
  group_wait: 5s
  group_interval: 15s
  repeat_interval: 1m
receivers:
  - name: local-recorder
    webhook_configs:
      - url: http://event-recorder:8080/webhook
        send_resolved: true
'''
    collector = '''receivers:
  otlp:
    protocols:
      grpc: {endpoint: "0.0.0.0:4317"}
      http: {endpoint: "0.0.0.0:4318"}
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 128
    spike_limit_mib: 32
  batch: {}
exporters:
  debug: {verbosity: basic}
extensions:
  health_check: {endpoint: "0.0.0.0:13133"}
service:
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [debug]
'''
    for name, data in [('prometheus',{'prometheus.yaml':prometheus,'rules.yaml':rules}),('alertmanager',{'alertmanager.yaml':alertmanager}),('collector',{'collector.yaml':collector})]:
        objects.append(configmap(name,MON,data))
    for name in ['prometheus','state-metrics']:
        objects.append({'apiVersion':'v1','kind':'ServiceAccount','metadata':metadata(name,MON)})
        resources=['pods','nodes','namespaces'] if name=='state-metrics' else ['pods']
        perms=[{'apiGroups':[''],'resources':resources,'verbs':['get','list','watch']}]
        if name=='state-metrics':perms.append({'apiGroups':['apps'],'resources':['deployments','replicasets'],'verbs':['get','list','watch']})
        objects.append({'apiVersion':'rbac.authorization.k8s.io/v1','kind':'ClusterRole','metadata':metadata('operations-lab-'+name),'rules':perms})
        objects.append({'apiVersion':'rbac.authorization.k8s.io/v1','kind':'ClusterRoleBinding','metadata':metadata('operations-lab-'+name),
                        'roleRef':{'apiGroup':'rbac.authorization.k8s.io','kind':'ClusterRole','name':'operations-lab-'+name},'subjects':[{'kind':'ServiceAccount','name':name,'namespace':MON}]})
    for name,port,args,memory,account in [
        ('prometheus',9090,['--config.file=/config/prometheus.yaml','--storage.tsdb.path=/data','--storage.tsdb.retention.time=6h','--storage.tsdb.retention.size=128MB'], '512Mi','prometheus'),
        ('alertmanager',9093,['--config.file=/config/alertmanager.yaml','--storage.path=/data'],'128Mi',None),
        ('collector',4318,['--config=/config/collector.yaml'],'256Mi',None),
        ('state-metrics',8080,['--resources=pods,nodes,namespaces,deployments,replicasets'],'256Mi','state-metrics')]:
        key='stateMetrics' if name=='state-metrics' else name
        volumes=[];mounts=[]
        if name!='state-metrics':
            volumes=[{'name':'config','configMap':{'name':name}},{'name':'data','emptyDir':{'sizeLimit':'256Mi'}}]
            mounts=[{'name':'config','mountPath':'/config','readOnly':True},{'name':'data','mountPath':'/data'}]
        objects.append(deployment(name,MON,images[key],args=args,ports=[port],volumes=volumes,mounts=mounts,memory=memory,account=account))
        objects.append(service(name,MON,[port,4317] if name=='collector' else [port]))
    return {'apiVersion':'v1','kind':'List','items':objects}


def setup():
    bootstrap()
    receipt=guard()
    for name in receipt['nodes']:
        run(['docker','update','--cpus','2','--memory','3g','--memory-swap','3g',name])
    print(kubectl('apply','-f','-',text=json.dumps(manifests())))
    for ns in [APP,MON]:
        print(kubectl('-n',ns,'rollout','status','deployment','-l','operations.oshal.dev/lab=true','--timeout=180s'))


def scenario(mode):
    guard()
    print(kubectl('-n',APP,'set','env','deployment/api','LAB_SCENARIO='+mode))
    if mode=='healthy':print(kubectl('-n',APP,'rollout','status','deployment/api','--timeout=90s'))


def load(requests,rate):
    guard()
    if not 1<=requests<=2000 or not 1<=rate<=20 or requests/rate>110:
        raise ValueError('Load is bounded to 2000 requests, 20 requests/s and 110 seconds.')
    image=json.loads((ROOT/'versions.json').read_text())['images']['workload']
    name='load-'+str(time.time_ns())
    code=f'''import time,urllib.request,urllib.error
for i in range({requests}):
 try:
  with urllib.request.urlopen('http://frontend:8080/',timeout=2) as r:r.read(1024)
 except (OSError,urllib.error.URLError):pass
 time.sleep({1/rate})
print('completed bounded synthetic load')
'''
    job={'apiVersion':'batch/v1','kind':'Job','metadata':metadata(name,APP),
         'spec':{'backoffLimit':0,'activeDeadlineSeconds':120,'ttlSecondsAfterFinished':300,
                 'template':{'metadata':{'labels':LABEL},'spec':{'restartPolicy':'Never','automountServiceAccountToken':False,'containers':[
                     {'name':'load','image':image,'command':['python','-c',code],
                      'resources':{'requests':{'cpu':'10m','memory':'16Mi'},'limits':{'cpu':'100m','memory':'64Mi'}}}]}}}}
    print(kubectl('create','-f','-',text=json.dumps(job)))
    print('Load job:',name)


def capture():
    guard()
    destination=STATE/'captures'/(time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+str(time.time_ns())[-6:])
    destination.mkdir(parents=True,mode=0o700)
    failures=[]
    def save(name, args):
        try:(destination/name).write_text(kubectl(*args)+'\n')
        except subprocess.CalledProcessError as error:
            failures.append({'file':name,'status':'unavailable','detail':error.stderr[:1000]})
    for ns in [APP,MON]:
        for resource in ['pods','deployments','events','services']:
            save(ns+'-'+resource+'.json',['-n',ns,'get',resource,'-o','json'])
    for app in ['api','frontend']:
        save(app+'-logs.txt',['-n',APP,'logs','deployment/'+app,'--all-pods=true','--tail=100','--prefix=true'])
    save('collector-logs.txt',['-n',MON,'logs','deployment/collector','--tail=50'])
    for endpoint in ['alerts','targets']:
        query="import urllib.request;print(urllib.request.urlopen('http://prometheus:9090/api/v1/"+endpoint+"').read().decode())"
        save('prometheus-'+endpoint+'.json',['-n',MON,'exec','deployment/event-recorder','--','python','-c',query])
    reader="import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8080/alerts').read().decode())"
    save('alertmanager-deliveries.json',['-n',MON,'exec','deployment/event-recorder','--','python','-c',reader])
    (destination/'receipt.json').write_text(json.dumps({'environment':CLUSTER,'synthetic':True,'capturedAt':time.time(),
        'status':'partial' if failures else 'complete','collectionFailures':failures,
        'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(destination.iterdir())}},indent=2)+'\n')
    print(destination)
    return destination


def status():
    guard()
    print(kubectl('get','nodes','-o','wide'))
    for ns in [APP,MON]:print(kubectl('-n',ns,'get','deployments,pods,services'))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    for command in ['setup','render','status','capture','recover','destroy']:sub.add_parser(command)
    fault=sub.add_parser('scenario');fault.add_argument('mode',choices=['errors','unready','crash','healthy'])
    burst=sub.add_parser('load');burst.add_argument('--requests',type=int,default=400);burst.add_argument('--rate',type=int,default=10)
    scale=sub.add_parser('scale');scale.add_argument('replicas',type=int,choices=range(1,5))
    forward=sub.add_parser('forward');forward.add_argument('service',choices=['frontend','prometheus','alertmanager','event-recorder']);forward.add_argument('--port',type=int,required=True)
    args=parser.parse_args()
    if args.command=='setup':setup()
    elif args.command=='render':print(json.dumps(manifests(),indent=2))
    elif args.command=='status':status()
    elif args.command=='capture':capture()
    elif args.command=='scenario':scenario(args.mode)
    elif args.command=='recover':
        scenario('healthy');print(kubectl('-n',APP,'scale','deployment/api','--replicas=2'))
        print(kubectl('-n',APP,'delete','jobs','-l','operations.oshal.dev/lab=true','--ignore-not-found=true'))
    elif args.command=='load':load(args.requests,args.rate)
    elif args.command=='scale':
        guard();print(kubectl('-n',APP,'scale','deployment/api','--replicas='+str(args.replicas)))
    elif args.command=='forward':
        guard()
        if not 1024<=args.port<=65535:raise ValueError('Choose an unprivileged local port.')
        port={'frontend':8080,'event-recorder':8080,'prometheus':9090,'alertmanager':9093}[args.service]
        namespace=APP if args.service=='frontend' else MON
        subprocess.run([str(STATE/'bin/kubectl'),'--kubeconfig',str(STATE/'kubeconfig'),'--context',CONTEXT,'-n',namespace,'port-forward','--address','127.0.0.1','service/'+args.service,f'{args.port}:{port}'],check=True)
    elif args.command=='destroy':
        guard();print(run([STATE/'bin/kind','delete','cluster','--name',CLUSTER,'--kubeconfig',STATE/'kubeconfig']))
        (STATE/'ownership.json').unlink();(STATE/'kubeconfig').unlink(missing_ok=True)


if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,subprocess.CalledProcessError) as error:
        print('Lab command refused or failed: '+str(error),file=sys.stderr)
        if isinstance(error,subprocess.CalledProcessError):print(error.stderr,file=sys.stderr)
        raise SystemExit(1)
