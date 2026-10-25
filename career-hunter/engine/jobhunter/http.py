"""A polite, retrying HTTP session shared by all connectors.

- Single requests.Session with a descriptive User-Agent.
- Per-host rate limiting so we never hammer one employer.
- Exponential-backoff retry on transient errors / 429 / 5xx.
"""
# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Retain per-source pull health and guarded content deltas across existing ingestion paths.
from __future__ import annotations
import time
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from urllib.parse import urlparse

import requests
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

from . import config

_session = requests.Session()
_session.headers.update({
    "User-Agent": config.USER_AGENT,
    "Accept": "application/json, text/html;q=0.9",
    # stick to encodings requests decodes reliably (some hosts send zstd which trips urllib3)
    "Accept-Encoding": "gzip, deflate",
})

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
