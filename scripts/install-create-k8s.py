#!/usr/bin/env python3
"""Complete Create's Office, manual Video and Publishing/PDF components in the owned lab.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Reuse exact reviewed engines, native package admission and Create's declared composite role.
2 | maintainer@emeraldcoastsystemsgroup.com | Initialize Video's private scratch root before the kernel under Kubernetes fsGroup inheritance.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENGINES = {
    'publishing-studio': {'name': 'oshal-publishing-engine', 'image': 'oshal-publishing-studio-engine',
        'port': 7419, 'bind': 'PUBLISHING_ENGINE_HOST', 'python': '/opt/publishing-runtime/python/bin/python'},
    'pdf-workbench': {'name': 'oshal-pdf-engine', 'image': 'oshal-pdf-workbench-engine',
        'port': 7415, 'bind': 'PDF_ENGINE_HOST', 'python': 'python'},
}
COMPONENTS = ['vids', 'video', 'publishing-studio', 'pdf-workbench']


def manifests(namespace, package, image, identity):
    """No login, cluster token, host port, host path or persistent user data in the renderer."""
    if package not in ENGINES:
        raise ValueError('Unknown Create engine.')
    engine = ENGINES[package]; name = engine['name']; port = engine['port']
    if namespace != 'oshal-install-lab' or not re.fullmatch(re.escape(engine['image'])+r':reviewed-[a-f0-9]{16}', image):
        raise ValueError('Only the owned lab and a verified local image are accepted.')
    labels = {'app': name, 'oshal.owner': 'operations-lab'}
    meta = {'name': name, 'namespace': namespace, 'labels': labels}
    container = {'name': 'renderer', 'image': image, 'imagePullPolicy': 'Never',
        'env': [{'name': engine['bind'], 'value': '0.0.0.0'}, {'name': 'RAYON_NUM_THREADS', 'value': '2'}],
        'securityContext': {'runAsNonRoot': True, 'runAsUser': 10001, 'readOnlyRootFilesystem': True,
            'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}, 'seccompProfile': {'type': 'RuntimeDefault'}},
        'resources': {'requests': {'cpu': '100m', 'memory': '384Mi'}, 'limits': {'cpu': '2', 'memory': '1536Mi'}},
        'volumeMounts': [{'name': 'temporary', 'mountPath': '/tmp'}],
        'readinessProbe': {'tcpSocket': {'port': port}, 'initialDelaySeconds': 2}}
    pod = {'automountServiceAccountToken': False, 'securityContext': {'fsGroup': 10001},
        'containers': [container], 'volumes': [{'name': 'temporary', 'emptyDir': {'medium': 'Memory', 'sizeLimit': '512Mi'}}]}
    return [
        {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': meta, 'spec': {'replicas': 1,
            'selector': {'matchLabels': {'app': name}}, 'strategy': {'type': 'Recreate'},
            'template': {'metadata': {'labels': labels, 'annotations': {'oshal.engine/source': identity['buildHash']}}, 'spec': pod}}},
        {'apiVersion': 'v1', 'kind': 'Service', 'metadata': meta, 'spec': {
            'selector': {'app': name}, 'ports': [{'port': port, 'targetPort': port}]}},
        {'apiVersion': 'networking.k8s.io/v1', 'kind': 'NetworkPolicy', 'metadata': meta, 'spec': {
            'podSelector': {'matchLabels': {'app': name}}, 'policyTypes': ['Ingress', 'Egress'],
            'ingress': [{'from': [{'podSelector': {'matchLabels': {'app.kubernetes.io/name': 'oshal-kernel'}}}],
                'ports': [{'protocol': 'TCP', 'port': port}]}], 'egress': []}}
    ]


def engine_map(container, additions):
    entry = next((item for item in container.get('env', []) if item['name'] == 'OSHAL_PACKAGE_ENGINES'), None)
    if entry and 'value' not in entry:
        raise ValueError('Preserve externally managed engine configuration; update its source first.')
    mapping = json.loads(entry['value']) if entry else {}
    if not isinstance(mapping, dict):
        raise ValueError('Invalid existing engine map.')
    return {**mapping, **additions}


def video_scratch_init(image):
    """fsGroup sets SGID on emptyDir; Video deliberately requires an exact 0700 root."""
    script = """const fs=require('fs'); const p='/scratch/oshal-video-scratch-10001';
try{fs.mkdirSync(p,{mode:0o700})}catch(e){if(e.code!=='EEXIST')throw e}
const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==10001||![0o700,0o2700].includes(s.mode&0o7777))throw Error('Unsafe Video scratch root');
fs.chmodSync(p,0o700);"""
    return {'name': 'create-video-scratch', 'image': image, 'command': ['node', '-e', script],
        'securityContext': {'runAsNonRoot': True, 'runAsUser': 10001, 'runAsGroup': 10001,
            'readOnlyRootFilesystem': True, 'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}},
        'resources': {'requests': {'cpu': '50m', 'memory': '32Mi'}, 'limits': {'cpu': '500m', 'memory': '128Mi'}},
        'volumeMounts': [{'name': 'scratch', 'mountPath': '/scratch'}]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kernel', type=Path, default=ROOT.parent/'oshal-kernel')
    parser.add_argument('--revision', required=True, help='Full already-pushed public application revision')
    args = parser.parse_args()
    sys.path.insert(0, str(args.kernel/'deploy/k8s'))
    from install import read_private, guard, run, kube, apply
    from install_apps import selected_archive, stage_job
    sys.path.insert(0, str(ROOT/'intelligent-operations/lab'))
    from portal import Portal, private_json
    state = Path.home()/'.local/state/oshal-k8s'
    os.environ['PATH'] = str(Path.home()/'.local/state/oshal-operations-lab/bin')+os.pathsep+os.environ['PATH']
    config = read_private(state/'installation.json'); guard(config)
    if not re.fullmatch(r'[a-f0-9]{40}', args.revision):
        raise ValueError('A full committed revision is required.')
    published = run(['git', '-C', ROOT, 'ls-remote', 'origin', 'refs/heads/codex/triagenorth-live-operations']).split()[0]
    if published != args.revision:
        raise ValueError('Publish the selected revision before installing.')
    reviewed = {}
    for package, engine in ENGINES.items():
        expected = json.loads(run(['git', '-C', ROOT, 'show', args.revision+':'+package+'/routes/engine-identity.json']))
        held = json.loads(run(['docker', 'image', 'inspect', engine['image']+':local']))[0]['Id']
        image = engine['image']+':reviewed-'+held.removeprefix('sha256:')[:16]
        run(['docker', 'tag', held, image])
        actual = json.loads(run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--user', '10001:10001', '--cpus=1', '--memory=256m', '--pids-limit=32',
            '--entrypoint', engine['python'], image, 'server.py', '--identity']))
        if actual != expected:
            raise ValueError('Prebuilt renderer differs from the committed reviewed source: '+package)
        reviewed[package] = {'image': image, 'imageId': held, 'engine': actual}
    current = json.loads(kube(config, '-n', config['namespace'], 'get', 'deployment', 'oshal-kernel-deployment', '-o', 'json'))
    kernel = next(c for c in current['spec']['template']['spec']['containers'] if c['name'] == 'oshal-kernel')
    engine_map(kernel, {})  # Validate the existing source before any cluster mutation.
    additions = {}
    for package, item in reviewed.items():
        engine = ENGINES[package]
        run(['kind', 'load', 'docker-image', item['image'], '--name', config['kindCluster']], timeout=300)
        apply(config, manifests(config['namespace'], package, item['image'], item['engine']))
        kube(config, '-n', config['namespace'], 'rollout', 'status', 'deployment/'+engine['name'], '--timeout=120s', timeout=130)
        address = kube(config, '-n', config['namespace'], 'get', 'service', engine['name'], '-o', 'jsonpath={.spec.clusterIP}').strip()
        additions[package] = address+':'+str(engine['port'])
    latest = json.loads(kube(config, '-n', config['namespace'], 'get', 'deployment', 'oshal-kernel-deployment', '-o', 'json'))
    kernel = next(c for c in latest['spec']['template']['spec']['containers'] if c['name'] == 'oshal-kernel')
    pod = latest['spec']['template']['spec']
    if not any(v.get('name') == 'scratch' and 'emptyDir' in v for v in pod.get('volumes', [])):
        raise ValueError('The standard kernel scratch emptyDir is required.')
    initializer = video_scratch_init(kernel['image'])
    inits = pod.get('initContainers', [])
    existing = next((item for item in inits if item['name'] == initializer['name']), None)
    if existing is not None and existing != initializer:
        raise ValueError('Review the existing Video scratch initializer before replacement.')
    if existing is None:
        kube(config, '-n', config['namespace'], 'patch', 'deployment/oshal-kernel-deployment', '--type=json', '-p',
            json.dumps([{'op': 'test', 'path': '/metadata/resourceVersion', 'value': latest['metadata']['resourceVersion']},
                {'op': 'add', 'path': '/spec/template/spec/initContainers', 'value': [*inits, initializer]}]))
    mapping = engine_map(kernel, additions)
    kube(config, '-n', config['namespace'], 'set', 'env', 'deployment/oshal-kernel-deployment', '--containers=oshal-kernel',
        'OSHAL_PACKAGE_ENGINES='+json.dumps(mapping, separators=(',', ':')))
    kube(config, '-n', config['namespace'], 'rollout', 'status', 'deployment/oshal-kernel-deployment', '--timeout=180s', timeout=190)
    run(['systemctl', '--user', 'restart', 'oshal-operations-portal.service'])
    selected = ['intelligent-operations', 'email-summarizer', 'create', 'presentations', *COMPONENTS]
    with tempfile.TemporaryDirectory(prefix='oshal-publishing-stage-') as temp:
        folder = Path(temp); digest = selected_archive(str(ROOT), args.revision, selected, folder, run)
        (folder/'Dockerfile').write_text('FROM '+config['image']+'\nCOPY --chown=10001:10001 applications /opt/staged\n')
        staging = 'oshal-public-stage:'+digest[:16]
        run(['docker', 'build', '--network=none', '-t', staging, folder], timeout=300)
        run(['kind', 'load', 'docker-image', staging, '--name', config['kindCluster']], timeout=300)
        job = stage_job(config, staging, digest); apply(config, [job])
        kube(config, '-n', config['namespace'], 'wait', '--for=condition=complete', 'job/'+job['metadata']['name'], '--timeout=180s', timeout=190)
    with Portal() as portal:
        registry = next(r for r in portal.call('/api/swarm/registries')['registries'] if r['id'] == 'oshal-public')
        portal.call('/api/swarm/registries', {'id': registry['id'], 'trusted': True,
            'source': 'git+https://github.com/emeraldcoastsystemsgroup/oshal-apps.git#'+args.revision,
            'offers': sorted(set(registry['offers'])|set(selected))}, confirmed=True)
        applications = []
        for package in COMPONENTS:
            preview = portal.call('/api/swarm/registries/oshal-public/native-preview/'+package)
            portal.call('/api/swarm/registries/native-install', {'registry': registry['id'], 'package': package,
                'expected': preview['artifact'], 'consented': preview['radius']}, confirmed=True)
            applications.append({'application': package, 'artifact': preview['artifact']})
        catalog = portal.call('/api/authorization/composites')
        identifier = 'k8s-install-admin-create-suite'
        existing = next((a['assignment'] for a in catalog['assignments'] if a['assignment']['id'] == identifier), None)
        caller = catalog['caller']['id'] if isinstance(catalog['caller'], dict) else catalog['caller']
        request = {'target': existing['target']['id'] if existing else caller, 'assignment_id': identifier,
            'action': 'replace' if existing else 'assign', 'selection': existing['selection'] if existing else
                {'app': 'create', 'kind': 'composite', 'template': 'admin', 'optional_apps': ['presentations', *COMPONENTS]},
            'expected_revision': catalog['revision'], 'reason': 'Enable the requested Create Office, manual Video, Publishing and PDF components',
            'idempotency_key': str(uuid.uuid4())}
        plan = portal.call('/api/authorization/composites/preview', request)
        if not plan['ready']:
            raise ValueError('Native own-account Publishing role plan is not ready.')
        portal.call('/api/authorization/composites/apply', {**request, 'expected_plan_revision': plan['plan_revision']})
        receipt = {'revision': args.revision, 'applications': applications, 'engines': reviewed,
            'externalSends': 0, 'renderAcceptancePending': True}
        private_json(state/'create-suite-install.json', receipt)
        print(json.dumps(receipt))


if __name__ == '__main__':
    main()
