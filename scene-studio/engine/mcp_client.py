#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the engine's MCP client:
#   |                                           | newline-delimited JSON-RPC 2.0 over a child's stdio
#   |                                           | (the MCP stdio transport), initialize, tools/list and
#   |                                           | tools/call with per-request deadlines, bounded
#   |                                           | message and stderr sizes, and a close that kills the
#   |                                           | server's whole process group.
"""mcp_client -- a minimal MCP client over stdio for the Scene Studio engine (stdlib only)."""
import json
import os
import queue
import signal
import subprocess
import threading
import time

PROTOCOL_VERSION = "2024-11-05"
MAX_MESSAGE_BYTES = 32 * 1024 * 1024
STDERR_KEEP_BYTES = 64 * 1024
_EOF = object()


class McpError(Exception):
    """A failed MCP exchange. `code` is one of timeout, exited, rpc_error, protocol."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class McpSession:
    """One MCP server process and the JSON-RPC conversation with it."""

    def __init__(self, argv, env, cwd):
        self.proc = subprocess.Popen(argv, env=env, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, start_new_session=True, close_fds=True)
        self.inbox = queue.Queue()
        self.stderr = bytearray()
        self.stderr_lock = threading.Lock()
        self.next_id = 1
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def _read_stdout(self):
        stream = self.proc.stdout
        try:
            while True:
                line = stream.readline(MAX_MESSAGE_BYTES + 1)
                if not line:
                    break
                if len(line) > MAX_MESSAGE_BYTES:
                    self.inbox.put(McpError("protocol", "MCP server sent a message over the size limit"))
                    break
                text = line.strip()
                if not text:
                    continue
                try:
                    message = json.loads(text)
                except ValueError:
                    continue  # a server that logs to stdout: not a JSON-RPC message
                if isinstance(message, dict):
                    self.inbox.put(message)
        except (OSError, ValueError):
            pass
        self.inbox.put(_EOF)

    def _read_stderr(self):
        stream = self.proc.stderr
        try:
            for chunk in iter(lambda: stream.read(4096), b""):
                with self.stderr_lock:
                    self.stderr.extend(chunk)
                    if len(self.stderr) > STDERR_KEEP_BYTES:
                        del self.stderr[:len(self.stderr) - STDERR_KEEP_BYTES]
        except (OSError, ValueError):
            pass

    def stderr_tail(self, limit=4000):
        """@description The last `limit` characters the server wrote to stderr."""
        with self.stderr_lock:
            return bytes(self.stderr[-limit:]).decode("utf-8", "replace")

    def _send(self, message):
        data = (json.dumps(message) + "\n").encode("utf-8")
        try:
            self.proc.stdin.write(data)
            self.proc.stdin.flush()
        except (OSError, ValueError) as exc:
            raise McpError("exited", f"MCP server stdin closed: {exc}; stderr: {self.stderr_tail()}") from exc

    def request(self, method, params, timeout):
        """@description Send one request and wait for its response.
        @returns The JSON-RPC result object. @throws McpError on timeout, exit or an error reply."""
        rid = self.next_id
        self.next_id += 1
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise McpError("timeout", f"{method} got no answer within {timeout:.0f}s")
            try:
                message = self.inbox.get(timeout=min(remaining, 0.5))
            except queue.Empty:
                continue
            if message is _EOF:
                code = self.proc.poll()
                raise McpError("exited", f"MCP server exited (code {code}) during {method}: {self.stderr_tail()}")
            if isinstance(message, McpError):
                raise message
            if "method" in message:
                if "id" in message:  # a server-to-client request this client does not serve
                    self._send({"jsonrpc": "2.0", "id": message["id"],
                                "error": {"code": -32601, "message": "not supported by the Scene Studio engine"}})
                continue  # notifications (logging, progress) are not answers
            if message.get("id") != rid:
                continue
            if "error" in message:
                err = message.get("error") or {}
                raise McpError("rpc_error", str(err.get("message") or err))
            result = message.get("result")
            return result if isinstance(result, dict) else {}

    def initialize(self, timeout):
        """@description The MCP handshake. @returns The server's initialize result."""
        result = self.request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "scene-studio-engine", "version": "1"},
        }, timeout)
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return result

    def list_tools(self, timeout):
        """@description tools/list. @returns The server's tool definitions."""
        tools = self.request("tools/list", {}, timeout).get("tools")
        return tools if isinstance(tools, list) else []

    def call_tool(self, name, arguments, timeout):
        """@description tools/call. @returns {content, isError} as the server sent it."""
        return self.request("tools/call", {"name": name, "arguments": arguments}, timeout)

    def close(self):
        """@description Close stdin, give the server a moment, then kill its whole process group."""
        try:
            self.proc.stdin.close()
        except (OSError, ValueError):
            pass
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(self.proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def content_text(result, limit=200_000):
    """@description Join the text parts of a tools/call result, bounded.
    @param result The call result. @returns (text, is_error)."""
    parts = []
    for item in result.get("content") or []:
        if isinstance(item, dict) and item.get("type") == "text":
            parts.append(str(item.get("text", "")))
    text = "\n".join(parts)
    if len(text) > limit:
        text = text[:limit] + f"\n... [{len(text) - limit} more characters cut]"
    return text, bool(result.get("isError"))
