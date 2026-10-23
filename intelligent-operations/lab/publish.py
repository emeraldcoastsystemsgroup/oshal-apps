#!/usr/bin/env python3
"""Install one committed public Operations revision into the owned lab portal through the existing registry trust, preview and consent flow.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Re-point the trusted public registry at an exact pushed commit, preview the package's permission radius, consent to exactly that preview and install the exact artifact under the operator's fresh confirmations; no private store, kernel image or role assignment is touched.
CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Delete the finished stage Job after staging, so every publish no longer leaves a completed Job and pod behind.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Stage the committed public source into the kernel's applications volume first with the installer's own archive/stage Job helpers, because the registry refuses a Git source that is not bound to the captured local origin and commit.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from portal import Portal, private_json
KERNEL=Path(os.environ.get('OSHAL_KERNEL_CHECKOUT',Path.home()/'Documents/projects/oshal-kernel'))/'deploy/k8s'

ORIGIN='https://github.com/emeraldcoastsystemsgroup/oshal-apps.git'
PACKAGE='intelligent-operations'


def pushed(repo,commit):
    if not re.fullmatch(r'[a-f0-9]{40}',commit): raise ValueError('A full commit is required.')
    subprocess.run(['git','-C',str(repo),'fetch','-q','origin'],check=True,timeout=120)
    remote=subprocess.run(['git','-C',str(repo),'branch','-r','--contains',commit],capture_output=True,text=True,check=True).stdout
    if 'origin/' not in remote: raise ValueError('The commit is not on the public origin; push it first.')
    return commit


def stage(repo,commit,state):
    sys.path.insert(0,str(KERNEL));os.environ['PATH']=str(Path.home()/'.local/state/oshal-operations-lab/bin')+os.pathsep+os.environ['PATH']
    import install as installer
    from install_apps import selected_archive,stage_job
    config=installer.validate(installer.read_private(state/'installation.json'));installer.guard(config)
    with tempfile.TemporaryDirectory(prefix='oshal-public-stage-') as temp:
        folder=Path(temp);digest=selected_archive(str(repo),commit,[PACKAGE],folder,installer.run)
        (folder/'Dockerfile').write_text('FROM '+config['image']+'\nCOPY --chown=10001:10001 applications /opt/staged\n')
        image='oshal-public-stage:'+digest[:16]
        installer.run(['docker','build','--network=none','-t',image,folder],timeout=300)
        installer.run(['kind','load','docker-image',image,'--name',config['kindCluster']],timeout=300)
        job=stage_job(config,image,digest);installer.apply(config,[job])
        installer.kube(config,'-n',config['namespace'],'wait','--for=condition=complete','job/'+job['metadata']['name'],'--timeout=180s',timeout=190)
        # The staged files live in the applications volume; the finished one-shot Job is not needed and would pile up.
        installer.kube(config,'-n',config['namespace'],'delete','job/'+job['metadata']['name'],'--wait=false',timeout=60)
    return digest


def install(repo,commit,state=None):
    commit=pushed(repo,commit);state=state or Path.home()/'.local/state/oshal-k8s'
    archive=stage(repo,commit,state);print('staged archive',archive)
    with Portal(state) as portal:
        registries={r['id']:r for r in portal.call('/api/swarm/registries')['registries']}
        current=registries.get('oshal-public')
        if not current: raise RuntimeError('The oshal-public registry is not configured.')
        source='git+'+ORIGIN+'#'+commit
        if current['source']!=source:
            portal.call('/api/swarm/registries',{'id':'oshal-public','source':source,'trusted':True,'offers':current.get('offers') or [PACKAGE]},confirmed=True)
        preview=portal.call('/api/swarm/registries/oshal-public/native-preview/'+PACKAGE)
        if preview['reference']!=commit: raise RuntimeError('The preview does not reference the requested commit.')
        result=portal.call('/api/swarm/registries/native-install',{'registry':'oshal-public','package':PACKAGE,'expected':preview['artifact'],'consented':preview['radius']},confirmed=True)
        if result.get('status')!='installed' or result.get('artifact')!=preview['artifact']: raise RuntimeError('Installation did not report the previewed artifact.')
        receipt={'package':PACKAGE,'revision':commit,'artifact':result['artifact'],'version':result.get('version'),'radius':preview['radius'],'registrySource':source}
        private_json(state/'operations-latest-install.json',{'revision':commit,'artifact':result['artifact'],'unchangedGrants':True,'stagedArchiveSha256':archive})
        print(json.dumps(receipt,indent=2));return receipt


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('commit');parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2]);args=parser.parse_args()
    install(args.repo,args.commit)
