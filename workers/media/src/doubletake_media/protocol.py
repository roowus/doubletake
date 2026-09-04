"""JSON-lines request/response loop over stdio.

Server → worker: `{ "id", "op", ...params }`.
Worker → server: `{ "id", "event": "progress", ... }` (many) then one
`{ "id", "event": "result", "ok": true, ... }` or `{ ..., "ok": false, "error": {...} }`.
Anything the worker logs goes to stderr; stdout is protocol only.
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from collections.abc import Callable, Mapping
from typing import IO, Any, Protocol

from .errors import WorkerError

Progress = Callable[[str, int, str], None]
"""progress(stage, pct, detail)"""


class Handler(Protocol):
    def __call__(self, params: Mapping[str, Any], progress: Progress) -> dict[str, Any]: ...


class Server:
    def __init__(
        self,
        handlers: Mapping[str, Handler],
        *,
        inp: IO[str] | None = None,
        out: IO[str] | None = None,
        log: IO[str] | None = None,
    ) -> None:
        self.handlers = dict(handlers)
        self.inp = inp or sys.stdin
        self.out = out or sys.stdout
        self.log = log or sys.stderr
        self._lock = threading.Lock()

    def send(self, msg: dict[str, Any]) -> None:
        line = json.dumps(msg, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self.out.write(line + "\n")
            self.out.flush()

    def _progress_for(self, rid: str) -> Progress:
        def progress(stage: str, pct: int, detail: str = "") -> None:
            self.send(
                {
                    "id": rid,
                    "event": "progress",
                    "stage": stage,
                    "pct": max(0, min(100, int(pct))),
                    "detail": detail,
                }
            )

        return progress

    def handle(self, raw: str) -> bool:
        """Process one line. Returns False when the server should stop."""
        raw = raw.strip()
        if not raw:
            return True
        try:
            req = json.loads(raw)
        except json.JSONDecodeError as e:
            self.send(
                {
                    "id": None,
                    "event": "result",
                    "ok": False,
                    "error": WorkerError("bad_request", f"invalid JSON: {e}").to_json(),
                }
            )
            return True
        rid = str(req.get("id", ""))
        op = req.get("op")
        if op == "shutdown":
            self.send({"id": rid, "event": "result", "ok": True})
            return False
        if op == "ping":
            self.send({"id": rid, "event": "result", "ok": True, "pong": True})
            return True
        handler = self.handlers.get(op)
        if handler is None:
            self.send(
                {
                    "id": rid,
                    "event": "result",
                    "ok": False,
                    "error": WorkerError("bad_request", f"unknown op {op!r}").to_json(),
                }
            )
            return True
        try:
            result = handler(req, self._progress_for(rid))
        except WorkerError as e:
            self.send({"id": rid, "event": "result", "ok": False, "error": e.to_json()})
        except Exception as e:  # noqa: BLE001 - anything else is a worker bug, still answer
            self.log.write(traceback.format_exc())
            self.log.flush()
            err = WorkerError("worker_error", f"{type(e).__name__}: {e}", retryable=False)
            self.send({"id": rid, "event": "result", "ok": False, "error": err.to_json()})
        else:
            self.send({"id": rid, "event": "result", "ok": True, **result})
        return True

    def serve_forever(self) -> None:
        for line in self.inp:
            if not self.handle(line):
                break
