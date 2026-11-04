"""A polite, retrying HTTP session shared by all connectors.

- Single requests.Session with a descriptive User-Agent.
- Per-host rate limiting so we never hammer one employer.
- Exponential-backoff retry on transient errors / 429 / 5xx.
"""
# CHANGE LOG
# 3 | maintainer@emeraldcoastsystemsgroup.com | Add a public-only mode, checked for every redirect hop in the adapter, for unattended reads that follow links from pages we do not control.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Read selected employer details through the run's signed kernel callback on native installations, retaining namespace network isolation.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Retain per-source pull health and guarded content deltas across existing ingestion paths.
from __future__ import annotations
import ipaddress
import socket
import time
import threading
import json
import os
from contextlib import contextmanager
from contextvars import ContextVar
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

from . import config


def _native_public_get(url):
    from . import enrich
    status, payload = enrich._rail_post(json.dumps({'operation':'employer-detail-get','url':url}).encode('utf-8'))
    if status != 200 or payload.get('ok') is not True or not isinstance(payload.get('body'), str):
        raise requests.RequestException('employer_detail_unavailable')
    if len(payload['body'].encode('utf-8')) > 256 * 1024:
        raise requests.RequestException('employer_detail_too_large')
    response = requests.Response()
    response.status_code = int(payload['status']);response.url = url
    response._content = payload['body'].encode('utf-8');response.encoding = 'utf-8'
    response.headers['Content-Type'] = payload.get('contentType') or 'application/json'
    return response


class PrivateAddressRefused(requests.RequestException):
    """A read, or a redirect it followed, aimed at an address that is not on the public internet."""


_public_only_active = False


def _is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    return ip.is_global and not ip.is_multicast


def _host_is_public(host: str) -> bool:
    """Every address a name resolves to must be public, or one DNS answer could reach inside."""
    try:
        answers = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError, ValueError):
        return False  # A second lookup at connect time could answer differently, so unknown is refused.
    return all(_is_public_address(answer[4][0]) for answer in answers)


class _PrivatePeer(Exception):
    """Not an OSError, so urllib3 does not turn it into a retried connection failure."""


class _CheckedPeer:
    """Checks the address actually connected to, before any bytes are sent, so a name that changes its answer gains nothing."""

    def _new_conn(self):
        sock = super()._new_conn()
        if _public_only_active and not _is_public_address(sock.getpeername()[0]):
            sock.close()
            raise _PrivatePeer()
        return sock


class _CheckedHTTPConnection(_CheckedPeer, HTTPConnection):
    pass


class _CheckedHTTPSConnection(_CheckedPeer, HTTPSConnection):
    pass


class _CheckedHTTPPool(HTTPConnectionPool):
    ConnectionCls = _CheckedHTTPConnection


class _CheckedHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = _CheckedHTTPSConnection


class _PublicOnlyAdapter(HTTPAdapter):
    """Checked here rather than at the call, because every redirect hop comes back through send()."""

    def init_poolmanager(self, *args, **kwargs):
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {"http": _CheckedHTTPPool, "https": _CheckedHTTPSPool}

    def send(self, request, **kwargs):
        if _public_only_active:
            host = urlparse(request.url).hostname
            if not host or not _host_is_public(host):
                raise PrivateAddressRefused("refused a non-public address")
        try:
            return super().send(request, **kwargs)
        except _PrivatePeer:
            raise PrivateAddressRefused("refused a non-public address") from None


@contextmanager
def public_only():
    """Refuse non-public addresses for every read in this process until the block ends.

    For unattended reads that follow links from pages we do not control, on a host network that can
    reach local services. Process-wide on purpose: a connector's own worker threads are covered too.
    """
    global _public_only_active
    previous, _public_only_active = _public_only_active, True
    try:
        yield
    finally:
        _public_only_active = previous


_session = requests.Session()
_session.headers.update({
    "User-Agent": config.USER_AGENT,
    "Accept": "application/json, text/html;q=0.9",
    # stick to encodings requests decodes reliably (some hosts send zstd which trips urllib3)
    "Accept-Encoding": "gzip, deflate",
})
_session.mount("https://", _PublicOnlyAdapter())
_session.mount("http://", _PublicOnlyAdapter())

_lock = threading.Lock()
_last_hit: dict[str, float] = {}
_observed = ContextVar("career_source_http", default=None)
_conditional = ContextVar("career_source_conditional", default=None)


class NotModified(Exception):
    """An exact employer listing was conditionally checked without downloading its body."""


@contextmanager
def conditional(url, headers):
    """Validators belong to one exact GET URL and one source, never a shared host cache."""
    state = {"url": url, "headers": headers, "validators": {}}
    token = _conditional.set(state)
    try:
        yield state
    finally:
        _conditional.reset(token)


@contextmanager
def observe():
    """Track final HTTP refusals without retaining URLs, headers or response bodies."""
    outcomes = []
    token = _observed.set(outcomes)
    try:
        yield outcomes
    finally:
        _observed.reset(token)


class TransientHTTP(Exception):
    """Raised for retryable HTTP responses (429 / 5xx)."""


def _throttle(url: str) -> None:
    host = urlparse(url).netloc
    with _lock:
        now = time.monotonic()
        prev = _last_hit.get(host, 0.0)
        wait = config.PER_HOST_DELAY - (now - prev)
        if wait > 0:
            time.sleep(wait)
        _last_hit[host] = time.monotonic()


@retry(
    reraise=True,
    stop=stop_after_attempt(config.MAX_RETRIES),
    wait=wait_exponential(multiplier=1, min=1, max=20),
    retry=retry_if_exception_type((TransientHTTP, requests.ConnectionError, requests.Timeout)),
)
def request(method: str, url: str, **kwargs) -> requests.Response:
    """Rate-limited, retrying HTTP request. Returns the Response (caller checks .ok)."""
    _throttle(url)
    kwargs.setdefault("timeout", config.REQUEST_TIMEOUT)
    conditional_state = _conditional.get()
    exact = conditional_state and method == "GET" and url == conditional_state["url"]
    if exact and conditional_state["headers"]:
        kwargs["headers"] = {**conditional_state["headers"], **kwargs.get("headers", {})}
    if os.environ.get('OSHAL_EGRESS') == 'kernel':
        if method != 'GET':
            raise requests.RequestException('native_employer_write_refused')
        resp = _native_public_get(url)
    else:
        resp = _session.request(method, url, **kwargs)
    if exact and (resp.ok or resp.status_code == 304):
        for key in ("ETag", "Last-Modified"):
            value = resp.headers.get(key)
            if value and len(value) <= 1000 and "\r" not in value and "\n" not in value:
                conditional_state["validators"][key] = value
    observed = _observed.get()
    # A retried transient error followed by a successful full response is not partial data.
    # Exhausted retries raise and the source attempt is recorded as failed.
    if observed is not None and not resp.ok and resp.status_code != 429 and resp.status_code < 500:
        observed.append(resp.status_code)
    if resp.status_code == 429 or 500 <= resp.status_code < 600:
        raise TransientHTTP(f"{resp.status_code} for {url}")
    return resp


def get(url: str, **kwargs) -> requests.Response:
    return request("GET", url, **kwargs)


def post(url: str, **kwargs) -> requests.Response:
    return request("POST", url, **kwargs)


def get_once(url: str, **kwargs) -> requests.Response:
    """Single attempt, no retry — for discovery probing where dead URLs shouldn't be retried."""
    _throttle(url)
    kwargs.setdefault("timeout", config.REQUEST_TIMEOUT)
    return _session.get(url, **kwargs)


def post_once(url: str, **kwargs) -> requests.Response:
    _throttle(url)
    kwargs.setdefault("timeout", config.REQUEST_TIMEOUT)
    return _session.post(url, **kwargs)


def get_json(url: str, **kwargs):
    r = get(url, **kwargs)
    if r.status_code == 304:
        raise NotModified()
    if not r.ok:
        return None
    try:
        return r.json()
    except ValueError:
        return None
