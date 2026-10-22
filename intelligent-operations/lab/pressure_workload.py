#!/usr/bin/env python3
"""Bounded CPU pressure with measured Prometheus metrics, no Kubernetes credentials.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual CPU consumption on one disposable lab worker.
"""
import hashlib
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

START = time.monotonic()
CPU_START = time.process_time()
DURATION = 150


class Metrics(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/metrics':
            self.send_error(404)
            return
        labels = ','.join(k+'="'+os.environ[k]+'"' for k in ['node', 'pod_uid', 'episode'])
        body = ('# TYPE operations_pressure_cpu_seconds_total counter\n'
                'operations_pressure_cpu_seconds_total{'+labels+'} '+str(time.process_time()-CPU_START)+'\n').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; version=0.0.4')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def main():
    server = HTTPServer(('0.0.0.0', 8080), Metrics)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    data = b'bounded-operations-pressure' * 8192
    while time.monotonic()-START < DURATION:
        hashlib.sha256(data).digest()
    server.shutdown()


if __name__ == '__main__':
    main()
