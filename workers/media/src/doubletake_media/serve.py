"""`doubletake-media serve`: the same JSON-lines protocol over HTTP, for a worker on another
machine (ADR 0026, docs/MEDIA-PIPELINE.md "Remote worker").

Routes (all need `Authorization: Bearer <token>` unless the token is empty and the bind is
loopback):
  GET  /ping                → {"ok": true, "pong": true}
  POST /extract             → streamed `application/x-ndjson`: progress lines, then one result
  GET  /files?path=<abs>    → the bytes of a file under the worker's data dir (assets, frames)

One extraction at a time (a lock; a second request waits). `out_dir` in the request is
replaced by `<data_dir>/media/<item_id>` unless `--shared-paths` is given, and the result carries
`out_dir` so the server can map paths back. Nothing here cancels a running extraction; the
server drops the connection on abort and the worker finishes the stage on its own.
"""

from __future__ import annotations

import argparse
import contextlib
import hmac
import io
import json
import os
import sys
import threading
from collections.abc import Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import IO, Any
from urllib.parse import parse_qs, urlparse

from .errors import WorkerError
from .protocol import Handler, Server


class _ChunkWriter(io.TextIOBase):
    """Text sink that emits each write as one HTTP chunk."""

    def __init__(self, wfile: IO[bytes]) -> None:
        self.wfile = wfile

    def write(self, s: str) -> int:  # type: ignore[override]
        data = s.encode("utf-8")
        if data:
            self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
        return len(s)

    def flush(self) -> None:
        with contextlib.suppress(ValueError, OSError):  # socket may already be gone
            self.wfile.flush()

    def close_chunks(self) -> None:
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()


class RemoteWorker:
    def __init__(
        self,
        handlers: Mapping[str, Handler],
        *,
        data_dir: Path,
        token: str,
        shared_paths: bool = False,
        log: IO[str] | None = None,
    ) -> None:
        self.handlers = dict(handlers)
        self.data_dir = data_dir.resolve()
        self.token = token
        self.shared_paths = shared_paths
        self.log = log or sys.stderr
        self.lock = threading.Lock()

    def authorized(self, header: str | None) -> bool:
        if not self.token:
            return True
        got = (header or "").removeprefix("Bearer ").strip()
        return hmac.compare_digest(got, self.token)

    def file_path(self, raw: str) -> Path:
        p = Path(raw)
        if not p.is_absolute():
            raise WorkerError("bad_request", "path must be absolute")
        rp = p.resolve()
        if rp != self.data_dir and self.data_dir not in rp.parents:
            raise WorkerError("bad_request", "path outside the worker data dir")
        if not rp.is_file():
            raise WorkerError("not_found", "no such file")
        return rp

    def rewrite_request(self, req: dict[str, Any]) -> dict[str, Any]:
        if req.get("op") == "extract" and not self.shared_paths:
            item_id = str(req.get("item_id") or "").strip()
            if not item_id or "/" in item_id or item_id in {".", ".."}:
                raise WorkerError("bad_request", "item_id required")
            req = {**req, "out_dir": str(self.data_dir / "media" / item_id)}
        return req

    def run(self, req: dict[str, Any], out: IO[str]) -> None:
        """Execute one request, writing protocol lines to `out`."""
        req = self.rewrite_request(req)
        out_dir = req.get("out_dir")

        class _Tagged(io.TextIOBase):
            # Add `out_dir` to the result line so the server can map paths (ADR 0026).
            def write(self_inner, s: str) -> int:  # type: ignore[override]  # noqa: N805
                try:
                    msg = json.loads(s)
                except json.JSONDecodeError:
                    return out.write(s)
                if msg.get("event") == "result" and msg.get("ok") and out_dir:
                    msg["out_dir"] = out_dir
                    s = json.dumps(msg, ensure_ascii=False, separators=(",", ":")) + "\n"
                return out.write(s)

            def flush(self_inner) -> None:  # noqa: N805
                out.flush()

        server = Server(
            self.handlers, inp=io.StringIO(json.dumps(req) + "\n"), out=_Tagged(), log=self.log
        )
        with self.lock:
            server.serve_forever()


def make_handler(worker: RemoteWorker) -> type[BaseHTTPRequestHandler]:
    class Handler_(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "doubletake-media"

        def log_message(self, fmt: str, *args: object) -> None:
            worker.log.write(f"{self.address_string()} {fmt % args}\n")
            worker.log.flush()

        def _json(self, status: int, body: dict[str, Any]) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _error(self, status: int, code: str, message: str) -> None:
            self._json(status, {"ok": False, "error": WorkerError(code, message).to_json()})

        def _auth(self) -> bool:
            if worker.authorized(self.headers.get("Authorization")):
                return True
            self._error(401, "unauthorized", "bad or missing worker token")
            return False

        def do_GET(self) -> None:  # noqa: N802
            u = urlparse(self.path)
            if not self._auth():
                return
            if u.path == "/ping":
                self._json(200, {"ok": True, "pong": True})
                return
            if u.path == "/files":
                raw = (parse_qs(u.query).get("path") or [""])[0]
                try:
                    p = worker.file_path(raw)
                except WorkerError as e:
                    self._error(404 if e.code == "not_found" else 400, e.code, e.message)
                    return
                size = p.stat().st_size
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(size))
                self.end_headers()
                with p.open("rb") as f:
                    while chunk := f.read(1 << 16):
                        self.wfile.write(chunk)
                return
            self._error(404, "not_found", "no such route")

        def do_POST(self) -> None:  # noqa: N802
            u = urlparse(self.path)
            if not self._auth():
                return
            if u.path != "/extract":
                self._error(404, "not_found", "no such route")
                return
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 1 << 20:
                self._error(400, "bad_request", "body required (max 1 MiB)")
                return
            try:
                req = json.loads(self.rfile.read(n))
            except json.JSONDecodeError as e:
                self._error(400, "bad_request", f"invalid JSON: {e}")
                return
            if not isinstance(req, dict):
                self._error(400, "bad_request", "body must be an object")
                return
            req.setdefault("op", "extract")
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            out = _ChunkWriter(self.wfile)
            try:
                worker.run(req, out)
            except WorkerError as e:
                out.write(
                    json.dumps(
                        {"id": req.get("id"), "event": "result", "ok": False, "error": e.to_json()}
                    )
                    + "\n"
                )
            except (BrokenPipeError, ConnectionResetError):
                return
            with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                out.close_chunks()

    return Handler_


def serve(argv: list[str], handlers: Mapping[str, Handler]) -> int:
    ap = argparse.ArgumentParser(prog="doubletake-media serve")
    ap.add_argument(
        "--bind", default="127.0.0.1", help="address to listen on (tailnet IP or 0.0.0.0)"
    )
    ap.add_argument("--port", type=int, default=7392)
    ap.add_argument(
        "--data-dir",
        default=os.environ.get("DOUBLETAKE_DATA_DIR", "~/.doubletake"),
        help="where this worker writes media/<item_id>/…; the server mirrors files from here",
    )
    ap.add_argument(
        "--shared-paths",
        action="store_true",
        help="keep the server's out_dir as sent (server and worker share one filesystem path)",
    )
    ap.add_argument(
        "--token-env",
        default="DOUBLETAKE_WORKER_TOKEN",
        help="env var holding the bearer token the server must send",
    )
    a = ap.parse_args(argv)
    token = os.environ.get(a.token_env, "")
    if not token and a.bind not in {"127.0.0.1", "::1", "localhost"}:
        print(f"refusing to bind {a.bind} without {a.token_env} set", file=sys.stderr)
        return 2
    data_dir = Path(os.path.expanduser(a.data_dir))
    data_dir.mkdir(parents=True, exist_ok=True)
    worker = RemoteWorker(handlers, data_dir=data_dir, token=token, shared_paths=a.shared_paths)
    httpd = ThreadingHTTPServer((a.bind, a.port), make_handler(worker))
    print(
        f"doubletake-media serving on http://{a.bind}:{a.port} data_dir={data_dir}"
        f"{' shared-paths' if a.shared_paths else ''}",
        file=sys.stderr,
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0
