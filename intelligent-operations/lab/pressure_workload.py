#!/usr/bin/env python3
"""Bounded CPU pressure with measured Prometheus metrics, no Kubernetes credentials.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual CPU consumption on one disposable lab worker.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Honor an in-container stop control (a file under /run/pressure) so a namespace-scoped exec executor can end the pressure without cluster authority, then keep serving the flat counter for a grace period so recovery can be measured before the pod completes.
CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Report the pressure loop's own thread CPU time, not the whole process's: the metrics server's microseconds per scrape kept the process counter creeping after a stop, and a generated verify.sh that compared exact samples correctly reported it as not flat.
"""
import hashlib
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

START = time.monotonic()
LOOP = {'cpu': 0.0}
DURATION = int(os.environ.get('DURATION', '150'))
STOP_FILE = os.environ.get('STOP_FILE', '/run/pressure/stop')
GRACE = 90


class Metrics(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/metrics':
            self.send_error(404)
            return
        labels = ','.join(k+'="'+os.environ[k]+'"' for k in ['node', 'pod_uid', 'episode'])
        body = ('# TYPE operations_pressure_cpu_seconds_total counter\n'
                'operations_pressure_cpu_seconds_total{'+labels+'} '+str(LOOP['cpu'])+'\n').encode()
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
    stopped = None
    rounds = 0
    cpu_start = time.thread_time()
    while time.monotonic()-START < DURATION:
        hashlib.sha256(data).digest()
        rounds += 1
        if rounds % 64 == 0:
            LOOP['cpu'] = time.thread_time()-cpu_start
            if os.path.exists(STOP_FILE):
                stopped = time.monotonic()
                break
    # After a reviewed stop the counter stays flat while the metrics server keeps answering, so the
    # alert can resolve and a verification command can read the same pod before it completes.
    while stopped is not None and time.monotonic()-stopped < GRACE and time.monotonic()-START < DURATION+GRACE:
        time.sleep(1)
    server.shutdown()


if __name__ == '__main__':
    main()
