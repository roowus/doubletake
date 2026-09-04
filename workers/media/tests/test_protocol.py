import io
import json

from doubletake_media.errors import WorkerError, classify_ytdlp_failure
from doubletake_media.protocol import Server


def _run(lines: list[dict], handlers: dict) -> list[dict]:
    inp = io.StringIO("".join(json.dumps(m) + "\n" for m in lines))
    out = io.StringIO()
    Server(handlers, inp=inp, out=out, log=io.StringIO()).serve_forever()
    return [json.loads(ln) for ln in out.getvalue().splitlines() if ln.strip()]


def test_ping_and_shutdown() -> None:
    msgs = _run([{"id": "1", "op": "ping"}, {"id": "2", "op": "shutdown"}], {})
    assert msgs[0] == {"id": "1", "event": "result", "ok": True, "pong": True}
    assert msgs[1]["ok"] is True


def test_handler_progress_then_result() -> None:
    def h(params, progress):
        progress("download", 250, "x")
        return {"got": params["url"]}

    msgs = _run([{"id": "7", "op": "extract", "url": "u"}], {"extract": h})
    assert msgs[0] == {
        "id": "7",
        "event": "progress",
        "stage": "download",
        "pct": 100,
        "detail": "x",
    }
    assert msgs[1] == {"id": "7", "event": "result", "ok": True, "got": "u"}


def test_worker_error_and_crash_are_results() -> None:
    def boom(_p, _pr):
        raise WorkerError("too_long", "nope", retryable=False)

    def crash(_p, _pr):
        raise RuntimeError("bug")

    msgs = _run(
        [{"id": "a", "op": "x"}, {"id": "b", "op": "y"}, {"id": "c", "op": "zzz"}],
        {"x": boom, "y": crash},
    )
    assert msgs[0]["ok"] is False and msgs[0]["error"]["code"] == "too_long"
    assert msgs[1]["error"]["code"] == "worker_error"
    assert msgs[2]["error"]["code"] == "bad_request"


def test_bad_json_line() -> None:
    out = io.StringIO()
    Server({}, inp=io.StringIO("{not json\n"), out=out, log=io.StringIO()).serve_forever()
    msg = json.loads(out.getvalue())
    assert msg["ok"] is False and msg["error"]["code"] == "bad_request"


def test_classify_ytdlp_failure() -> None:
    e = classify_ytdlp_failure(
        "WARNING: x\nERROR: [Instagram] abc: Requested content is not available"
    )
    assert e.code == "private_or_removed" and "COOKIES" in e.message
    e = classify_ytdlp_failure("ERROR: Unable to download webpage: timed out")
    assert e.code == "download_failed" and e.retryable
    e = classify_ytdlp_failure("ERROR: something else")
    assert e.code == "download_failed" and not e.retryable
