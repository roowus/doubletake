"""`doubletake-media`: JSON-lines worker on stdin/stdout (see docs/MEDIA-PIPELINE.md)."""

from __future__ import annotations

import sys
from collections.abc import Mapping

from . import __version__
from .extract import handle_extract
from .protocol import Progress, Server


def handle_version(_params: Mapping[str, object], _progress: Progress) -> dict[str, object]:
    return {"version": __version__}


def main() -> int:
    handlers = {"extract": handle_extract, "version": handle_version}
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        from .serve import serve

        return serve(sys.argv[2:], handlers)
    server = Server(handlers)
    print(f"doubletake-media {__version__} ready", file=sys.stderr, flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
