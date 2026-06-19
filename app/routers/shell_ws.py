"""
WebSocket for real-time shell execution.

WS /ws/shell   — open a shell session, receive stdout/stderr chunks live

v2.3: Replaces polling-based shell execution with a real-time WebSocket.
Protocol (JSON messages):

Client → Server:
    {"type": "exec", "shell": "bash", "cmd": "ls -la", "timeout": 30, "sudo": false}
    {"type": "exec", "shell": "python3", "cmd": "print('hi')", "timeout": 30}
    {"type": "stdin", "data": "yes\n"}                # send stdin to running process
    {"type": "kill"}                                   # SIGTERM the running process
    {"type": "ping"}

Server → Client:
    {"type": "start", "shell": "bash", "pid": 12345}
    {"type": "stdout", "data": "total 8\n..."}
    {"type": "stderr", "data": "..."}
    {"type": "exit", "returncode": 0, "timed_out": false}
    {"type": "error", "message": "..."}
    {"type": "pong"}
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import threading
from typing import Any, Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Shell — WebSocket"])


# ── Allowed shells ─────────────────────────────────────────────────────

_ALLOWED_SHELLS = {
    "bash": {"binary": "bash", "args": ["-c"]},
    "python3": {"binary": "python3", "args": ["-c"]},
}

# Block obviously dangerous patterns
_BLOCKED_PATTERNS = [
    "rm -rf /",
    "mkfs.",
    "dd if=/dev/zero of=/dev/",
    ":(){ :|:& };:",
    "fork bomb",
]


def _is_blocked(cmd: str) -> Optional[str]:
    for p in _BLOCKED_PATTERNS:
        if p in cmd:
            return p
    return None


# ── WebSocket handler ──────────────────────────────────────────────────

@router.websocket("/ws/shell")
async def ws_shell(websocket: WebSocket) -> None:
    """Real-time shell execution over WebSocket.

    Auth: the gateway should verify the connection. For dev, accepts
    any connection.
    """
    await websocket.accept()
    proc: Optional[asyncio.subprocess.Process] = None
    stdout_task: Optional[asyncio.Task] = None
    stderr_task: Optional[asyncio.Task] = None

    async def _stream_reader(stream, ws, channel: str):
        try:
            while True:
                chunk = await stream.read(4096)
                if not chunk:
                    break
                try:
                    text = chunk.decode("utf-8", errors="replace")
                except Exception:
                    text = repr(chunk)
                await ws.send_text(json.dumps({
                    "type": channel, "data": text,
                }))
        except Exception as exc:
            logger.debug("[ws/shell] %s reader error: %s", channel, exc, exc_info=True)

    try:
        while True:
            msg = await websocket.receive_text()
            try:
                data = json.loads(msg)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({
                    "type": "error", "message": "invalid JSON",
                }))
                continue

            mtype = data.get("type")

            if mtype == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                continue

            if mtype == "exec":
                if proc is not None:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "a command is already running; send kill first",
                    }))
                    continue

                shell_name = data.get("shell", "bash")
                if shell_name not in _ALLOWED_SHELLS:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"unsupported shell: {shell_name}",
                    }))
                    continue

                cmd = data.get("cmd", "")
                if not cmd:
                    await websocket.send_text(json.dumps({
                        "type": "error", "message": "empty cmd",
                    }))
                    continue

                blocked = _is_blocked(cmd)
                if blocked:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"blocked pattern: {blocked}",
                    }))
                    continue

                timeout = float(data.get("timeout", 30))
                use_sudo = bool(data.get("sudo", False))

                # Build argv
                sh = _ALLOWED_SHELLS[shell_name]
                argv = [sh["binary"]] + sh["args"] + [cmd]
                if use_sudo:
                    argv = ["sudo", "-S", "-E"] + argv

                try:
                    proc = await asyncio.create_subprocess_exec(
                        *argv,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        stdin=asyncio.subprocess.PIPE,
                        env=os.environ.copy(),
                    )
                except Exception as exc:
                    await websocket.send_text(json.dumps({
                        "type": "error", "message": f"spawn failed: {exc}",
                    }))
                    proc = None
                    continue

                await websocket.send_text(json.dumps({
                    "type": "start",
                    "shell": shell_name,
                    "pid": proc.pid,
                }))

                # Start stream readers
                stdout_task = asyncio.create_task(
                    _stream_reader(proc.stdout, websocket, "stdout")
                )
                stderr_task = asyncio.create_task(
                    _stream_reader(proc.stderr, websocket, "stderr")
                )

                # Wait for completion with timeout
                timed_out = False
                try:
                    await asyncio.wait_for(proc.wait(), timeout=timeout)
                except asyncio.TimeoutError:
                    timed_out = True
                    try:
                        proc.send_signal(signal.SIGTERM)
                        await asyncio.wait_for(proc.wait(), timeout=2)
                    except Exception:
                        try:
                            proc.kill()
                        except Exception:
                            pass

                # Drain remaining output
                try:
                    await asyncio.wait_for(asyncio.gather(stdout_task, stderr_task), timeout=2)
                except Exception:
                    pass

                await websocket.send_text(json.dumps({
                    "type": "exit",
                    "returncode": proc.returncode if proc.returncode is not None else -1,
                    "timed_out": timed_out,
                }))
                proc = None
                stdout_task = None
                stderr_task = None
                continue

            if mtype == "stdin":
                if proc is None or proc.stdin is None:
                    await websocket.send_text(json.dumps({
                        "type": "error", "message": "no running process",
                    }))
                    continue
                try:
                    data_str = data.get("data", "")
                    proc.stdin.write(data_str.encode("utf-8"))
                    await proc.stdin.drain()
                except Exception as exc:
                    await websocket.send_text(json.dumps({
                        "type": "error", "message": f"stdin failed: {exc}",
                    }))
                continue

            if mtype == "kill":
                if proc is None:
                    await websocket.send_text(json.dumps({
                        "type": "error", "message": "no running process",
                    }))
                    continue
                try:
                    proc.send_signal(signal.SIGTERM)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                continue

            await websocket.send_text(json.dumps({
                "type": "error", "message": f"unknown message type: {mtype}",
            }))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("[ws/shell] handler error: %s", exc, exc_info=True)
    finally:
        # Clean up any running process
        if proc is not None and proc.returncode is None:
            try:
                proc.kill()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass
