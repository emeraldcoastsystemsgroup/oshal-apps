#!/usr/bin/env python3
"""Operator-side native API client; its session never enters agent evidence.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep local installation login and confirmed writes outside the worker materialization boundary.
"""
import json
import os
from pathlib import Path
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


class Portal:
    def __init__(self, state=None):
        self.state=state or Path.home()/'.local/state/oshal-k8s'
        config=json.loads((self.state/'installation.json').read_text())
        if config['context']!='kind-operations-lab' or config['namespace']!='oshal-install-lab':
            raise ValueError('Only the explicitly owned local installation is accepted.')
        self.base='http://127.0.0.1:'+str(config['port'])
        self.token=None
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def __enter__(self):
        credential=self.state/'admin-password.json'
        if credential.is_symlink() or credential.stat().st_mode & 0o077 or credential.stat().st_uid!=os.getuid():
            raise ValueError('Installation login must be an owner-only regular file.')
        self.token=self.call('/sessions',json.loads(credential.read_text()))['session']
        return self

    def __exit__(self,*_):
        self.call('/sessions',method='DELETE')
        self.token=None

    def call(self,path,body=None,method=None,confirmed=False):
        if not path.startswith('/') or path.startswith('//'):
            raise ValueError('A local API path is required.')
        headers={'Content-Type':'application/json'}
        if self.token: headers['Authorization']='Bearer '+self.token
        if confirmed: headers['x-oshal-confirm']=self.call('/confirmations',{})['confirmation']
        request=urllib.request.Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
        try:
            with self.opener.open(request,timeout=150) as response:
                raw=response.read(4*1024*1024)
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raise RuntimeError('Native API refused '+path+' (HTTP '+str(error.code)+')') from None


def private_json(path,value):
    if path.is_symlink(): raise ValueError('Refusing a linked state file.')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as output: json.dump(value,output,indent=2)
