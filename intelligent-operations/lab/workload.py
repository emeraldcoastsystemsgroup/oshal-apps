#!/usr/bin/env python3
"""Synthetic lab service, dependency client, telemetry producer and alert recorder.

No production credentials, infrastructure mutations or external destinations.
"""
import collections
import http.server
import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
import uuid

SERVICE = os.environ.get('SERVICE_NAME', 'api')
MODE = os.environ.get('LAB_SCENARIO', 'healthy')
DEPENDENCY = os.environ.get('DEPENDENCY_URL', '')
OTLP = os.environ.get('OTLP_HTTP', '')
PORT = int(os.environ.get('PORT', '8080'))
STARTED = time.time()
COUNTS = collections.Counter()
LOCK = threading.Lock()
DB = os.environ.get('RECORDER_DATABASE', '')


def record(payload):
    """Retain at most 1000 local Alertmanager deliveries in an ephemeral SQLite file."""
    with sqlite3.connect(DB) as connection:
        connection.execute('CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, received REAL, payload TEXT)')
        connection.execute('INSERT INTO deliveries(received,payload) VALUES (?,?)', (time.time(), json.dumps(payload)))
        connection.execute('DELETE FROM deliveries WHERE id NOT IN (SELECT id FROM deliveries ORDER BY id DESC LIMIT 1000)')
        while (connection.execute('SELECT COALESCE(SUM(LENGTH(payload)),0) FROM deliveries').fetchone()[0] > 16*1024*1024):
            connection.execute('DELETE FROM deliveries WHERE id IN (SELECT id FROM deliveries ORDER BY id LIMIT 100)')


def trace(status, start):
    """Send sampled real synthetic request spans through the lab OTLP HTTP receiver."""
    if not OTLP:
        return
    span = {'traceId': uuid.uuid4().hex, 'spanId': uuid.uuid4().hex[:16], 'name': SERVICE + ' GET /', 'kind': 2,
            'startTimeUnixNano': str(int(start * 1e9)), 'endTimeUnixNano': str(time.time_ns()),
            'attributes': [{'key': 'http.response.status_code', 'value': {'intValue': str(status)}}],
            'status': {'code': 2 if status >= 500 else 1}}
    body = {'resourceSpans': [{'resource': {'attributes': [
        {'key': 'service.name', 'value': {'stringValue': SERVICE}},
        {'key': 'deployment.environment.name', 'value': {'stringValue': 'operations-lab'}},
        {'key': 'k8s.pod.name', 'value': {'stringValue': os.environ.get('HOSTNAME', 'unknown')}}]},
        'scopeSpans': [{'scope': {'name': 'operations-lab'}, 'spans': [span]}]}]}
    try:
        req = urllib.request.Request(OTLP + '/v1/traces', json.dumps(body).encode(), {'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=1) as response:
            response.read(1024)
    except (OSError, urllib.error.URLError):
        print(json.dumps({'service': SERVICE, 'event': 'telemetry_export_unavailable'}), flush=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send(self, status, body, content_type='application/json'):
        data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/healthz':
            return self.send(200, {'alive': True})
        if self.path == '/readyz':
            return self.send(503 if MODE == 'unready' else 200, {'ready': MODE != 'unready'})
        if self.path == '/metrics':
            with LOCK:
                lines = ['# TYPE operations_lab_requests_total counter'] + [
                    f'operations_lab_requests_total{{service="{SERVICE}",status="{code}"}} {count}'
                    for code, count in sorted(COUNTS.items())]
            lines += ['# TYPE operations_lab_process_uptime_seconds gauge', f'operations_lab_process_uptime_seconds {time.time()-STARTED:.3f}']
            return self.send(200, '\n'.join(lines) + '\n', 'text/plain; version=0.0.4')
        if self.path == '/alerts' and DB:
            try:
                with sqlite3.connect(DB) as connection:
                    items = connection.execute('SELECT id,received,payload FROM deliveries ORDER BY id DESC LIMIT 1000').fetchall()
                return self.send(200, {'deliveries': [{'id': i, 'receivedAt': t, 'payload': json.loads(p)} for i,t,p in items]})
            except sqlite3.OperationalError:
                return self.send(200, {'deliveries': []})
        start = time.time()
        status = 500 if MODE == 'errors' else 200
        if DEPENDENCY and status == 200:
            try:
                with urllib.request.urlopen(DEPENDENCY, timeout=2) as response:
                    status = response.status
            except (OSError, urllib.error.URLError):
                status = 503
        with LOCK:
            COUNTS[status] += 1
            count = sum(COUNTS.values())
        print(json.dumps({'time': time.time(), 'environment': 'operations-lab', 'service': SERVICE,
                          'pod': os.environ.get('HOSTNAME'), 'scenario': MODE, 'status': status, 'synthetic': True}), flush=True)
        if count % 10 == 1:
            trace(status, start)
        return self.send(status, {'service': SERVICE, 'scenario': MODE, 'synthetic': True})

    def do_POST(self):
        size = int(self.headers.get('Content-Length', '0'))
        if self.path != '/webhook' or not DB:
            return self.send(404, {'error': 'not_found'})
        if size < 1 or size > 1024 * 1024:
            return self.send(413, {'error': 'bounded_payload_required'})
        try:
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict) or not isinstance(payload.get('alerts'), list):
                return self.send(400, {'error': 'alertmanager_envelope_required'})
            record(payload)
        except (ValueError, sqlite3.Error):
            return self.send(503, {'error': 'not_recorded'})
        return self.send(200, {'recorded': True, 'syntheticEnvironment': 'operations-lab'})


if __name__ == '__main__':
    if MODE == 'crash':
        print(json.dumps({'service': SERVICE, 'event': 'intentional_local_lab_crash', 'synthetic': True}), flush=True)
        time.sleep(2)
        raise SystemExit(1)
    http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
