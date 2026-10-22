#!/usr/bin/env python3
"""Bounded package-owned detection engine, reached through the native engine relay.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Relay typed percolator operations with a versioned hello; no caller-provided URLs, filesystem paths, shell or cluster credentials.
"""
import hashlib
import json
import os
from pathlib import Path
import socketserver
import threading
from percolation import Percolator,Failure

ROOT=Path(__file__).parent
BUILD=hashlib.sha256(b''.join((ROOT/name).read_bytes() for name in ['percolation.py','server.py'])).hexdigest()
BACKEND=Percolator(os.environ.get('OPERATIONS_SEARCH_URL','http://127.0.0.1:9200'))
SLOTS=threading.BoundedSemaphore(4)

class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(15)
        if not SLOTS.acquire(blocking=False):self.write({'error':'engine-busy'});return
        try:
            self.write({'protocol':1,'engine':'operations-detection','buildHash':BUILD})
            raw=self.rfile.readline(131073)
            if len(raw)>131072 or not raw.endswith(b'\n'):raise Failure('Request exceeds the frame bound.','invalid-request')
            request=json.loads(raw);identifier=request.get('id');args=request.get('args',{})
            if request.get('cmd')=='health':result=BACKEND.status()
            elif request.get('cmd')=='publish':result=BACKEND.publish(args.get('scope'),args.get('revision'),args.get('rules'))
            elif request.get('cmd')=='match':result=BACKEND.match(args.get('scope'),args.get('revision'),args.get('document'))
            else:raise Failure('Unknown detection command.','invalid-request')
            self.write({'id':identifier,'result':result})
        except (Failure,ValueError,KeyError,TypeError,OSError) as error:
            self.write({'id':locals().get('identifier',1),'error':{'code':getattr(error,'code','backend-unavailable'),'message':str(error) if isinstance(error,Failure) else 'Detection engine could not complete this operation.'}})
        finally:SLOTS.release()

    def write(self,value):
        try:self.wfile.write(json.dumps(value,separators=(',',':')).encode()+b'\n');self.wfile.flush()
        except OSError:pass  # Disconnected requester receives no successful acknowledgement.

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address=True
    daemon_threads=True

if __name__=='__main__':
    with Server((os.environ.get('OPERATIONS_ENGINE_BIND','127.0.0.1'),int(os.environ.get('OPERATIONS_ENGINE_PORT','7419'))),Handler) as server:
        print(json.dumps({'listening':server.server_address[1]}),flush=True)
        server.serve_forever()
