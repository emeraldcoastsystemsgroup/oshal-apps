"""One pure, memory/time-bounded child per framed PDF request; no database or owner inputs.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Pin source identity and close children on client cancellation.
"""
import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX = 12 * 1024 * 1024
SLOTS = asyncio.Semaphore(2)


def identity():
    digest = hashlib.sha256()
    for name in ("worker.py", "server.py", "requirements.txt"):
        digest.update(name.encode() + b"\0" + (ROOT / name).read_bytes() + b"\0")
    return {"protocol": 1, "buildHash": digest.hexdigest(), "upstream": "pypdf/6.20.1"}


async def serve(reader, writer):
    child = None
    slot = False
    build = identity()
    async def send(value):
        raw = json.dumps(value, separators=(",", ":")).encode() + b"\n"
        if len(raw) > MAX:
            raise ValueError("response limit")
        writer.write(raw)
        await writer.drain()
    try:
        if SLOTS.locked():
            await send({"error": "pdf_engine_busy"})
            return
        await SLOTS.acquire()
        slot = True
        await send({"bridge": build})
        raw = await asyncio.wait_for(reader.readline(), 10)
        if not raw.endswith(b"\n") or len(raw) > MAX:
            raise ValueError("frame limit")
        value = json.loads(raw)
        if set(value) != {"id", "cmd", "args"} or value["id"] != 1 or value["cmd"] != "pdf":
            raise ValueError("closed request")
        child = await asyncio.create_subprocess_exec(sys.executable, str(ROOT / "worker.py"),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"})
        work = asyncio.create_task(child.communicate(json.dumps(value["args"]).encode()))
        disconnected = asyncio.create_task(reader.read(1))
        try:
            done, _ = await asyncio.wait((work, disconnected), timeout=45, return_when=asyncio.FIRST_COMPLETED)
            if work not in done:
                raise TimeoutError("client closed or deadline")
            output, _ = work.result()
            if child.returncode != 0 or len(output) > MAX - 1024:
                raise ValueError("worker refused")
            answer = json.loads(output)
            await send({"id": 1, "buildHash": build["buildHash"], **answer})
        finally:
            disconnected.cancel()
            if child.returncode is None:
                child.kill()
                await child.wait()
            await asyncio.gather(work, disconnected, return_exceptions=True)
    except (Exception, asyncio.CancelledError):
        try:
            await send({"id": 1, "buildHash": build["buildHash"], "ok": False, "error": "pdf_engine_failed"})
        except Exception:
            pass
    finally:
        if child is not None and child.returncode is None:
            child.kill()
            await child.wait()
        if slot:
            SLOTS.release()
        writer.close()
        await writer.wait_closed()


async def main():
    server = await asyncio.start_server(serve, os.environ.get("PDF_ENGINE_HOST", "127.0.0.1"),
                                       int(os.environ.get("PDF_ENGINE_PORT", "7415")), limit=MAX + 1)
    print(json.dumps({"port": server.sockets[0].getsockname()[1], "identity": identity()}), flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    if "--identity" in sys.argv:
        print(json.dumps(identity()))
    else:
        asyncio.run(main())
