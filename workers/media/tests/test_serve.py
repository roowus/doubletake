import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from doubletake_media.serve import RemoteWorker, make_handler


def _extract(params, progress):
    out = Path(params["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "source.mp4").write_bytes(b"vid")
    progress("download", 50, "half")
    return {
        "assets": [{"kind": "video", "path": str(out / "source.mp4"), "bytes": 3}],
        "extractions": [],
        "vision_requests": [],
        "warnings": [],
        "canonical_url": None,
        "title": "t",
    }


@pytest.fixture
def srv(tmp_path: Path):
    worker = RemoteWorker({"extract": _extract}, data_dir=tmp_path, token="s3cret")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(worker))
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}", tmp_path
    finally:
        httpd.shutdown()
        httpd.server_close()


def _req(url: str, method: str = "GET", body: dict | None = None, token: str | None = "s3cret"):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    if data:
        r.add_header("Content-Type", "application/json")
    return urllib.request.urlopen(r, timeout=10)


def test_ping_requires_token(srv) -> None:
    base, _ = srv
    with pytest.raises(urllib.error.HTTPError) as ei:
        _req(f"{base}/ping", token=None)
    assert ei.value.code == 401
    assert json.load(_req(f"{base}/ping")) == {"ok": True, "pong": True}


def test_extract_streams_and_rewrites_out_dir(srv) -> None:
    base, data_dir = srv
    body = {"id": "r1", "item_id": "01ITEM", "url": "u", "out_dir": "/elsewhere/media/01ITEM"}
    with _req(f"{base}/extract", "POST", body) as resp:
        assert resp.headers["Content-Type"] == "application/x-ndjson"
        lines = [json.loads(ln) for ln in resp.read().decode().splitlines() if ln.strip()]
    assert lines[0]["event"] == "progress"
    assert lines[0]["pct"] == 50
    res = lines[-1]
    assert res["ok"] is True
    assert res["out_dir"] == str(data_dir / "media" / "01ITEM")
    assert res["assets"][0]["path"] == str(data_dir / "media" / "01ITEM" / "source.mp4")
    # and the file is fetchable, but nothing outside the data dir is
    got = _req(f"{base}/files?path={res['assets'][0]['path']}").read()
    assert got == b"vid"
    with pytest.raises(urllib.error.HTTPError) as ei:
        _req(f"{base}/files?path=/etc/hosts")
    assert ei.value.code == 400
    with pytest.raises(urllib.error.HTTPError) as ei:
        _req(f"{base}/files?path={data_dir / 'media' / '01ITEM' / '..' / '..' / '..' / 'x'}")
    assert ei.value.code in (400, 404)


def test_extract_rejects_bad_item_id(srv) -> None:
    base, _ = srv
    with _req(f"{base}/extract", "POST", {"id": "r2", "item_id": "../x", "url": "u"}) as resp:
        lines = [json.loads(ln) for ln in resp.read().decode().splitlines() if ln.strip()]
    assert lines[-1]["ok"] is False
    assert lines[-1]["error"]["code"] == "bad_request"


def test_shared_paths_keep_out_dir(tmp_path: Path) -> None:
    w = RemoteWorker({"extract": _extract}, data_dir=tmp_path, token="", shared_paths=True)
    import io

    out = io.StringIO()
    w.run(
        {"id": "1", "op": "extract", "item_id": "a", "url": "u", "out_dir": str(tmp_path / "keep")},
        out,
    )
    res = json.loads(out.getvalue().splitlines()[-1])
    assert res["out_dir"] == str(tmp_path / "keep")
    assert (tmp_path / "keep" / "source.mp4").exists()


def _put(base: str, rel: str, body: bytes, token: str | None = "s3cret"):
    r = urllib.request.Request(f"{base}/files?path={rel}", data=body, method="PUT")
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    r.add_header("Content-Type", "application/octet-stream")
    return urllib.request.urlopen(r, timeout=10)


def test_put_files_stores_uploads_under_media_only(srv) -> None:
    import hashlib

    base, data_dir = srv
    body = b"\xff\xd8\xff\xd9"
    with _put(base, "media/01UP/image.jpg", body) as resp:
        res = json.load(resp)
    assert res["ok"] is True
    assert res["bytes"] == len(body)
    assert res["sha256"] == hashlib.sha256(body).hexdigest()
    assert res["path"] == str(data_dir / "media" / "01UP" / "image.jpg")
    assert (data_dir / "media" / "01UP" / "image.jpg").read_bytes() == body
    assert not (data_dir / "media" / "01UP" / "image.jpg.part").exists()
    # no token, wrong shape, traversal, empty body
    with pytest.raises(urllib.error.HTTPError) as ei:
        _put(base, "media/01UP/x.jpg", body, token=None)
    assert ei.value.code == 401
    for bad in ("image.jpg", "media/01UP/a/b.jpg", "media/../01UP/x.jpg", "other/01UP/x.jpg"):
        with pytest.raises(urllib.error.HTTPError) as ei:
            _put(base, bad, body)
        assert ei.value.code == 400, bad
    with pytest.raises(urllib.error.HTTPError) as ei:
        _put(base, "media/01UP/empty.jpg", b"")
    assert ei.value.code == 413
    assert not (data_dir / "media" / "01UP" / "empty.jpg").exists()


def test_rewrite_moves_local_path_into_worker_dir(tmp_path: Path) -> None:
    w = RemoteWorker({"extract": _extract}, data_dir=tmp_path, token="")
    req = w.rewrite_request(
        {
            "op": "extract",
            "item_id": "01UP",
            "url": "",
            "out_dir": "/laptop/.doubletake/media/01UP",
            "hints": {"local_path": "/laptop/.doubletake/media/01UP/image.jpg"},
        }
    )
    assert req["out_dir"] == str(tmp_path / "media" / "01UP")
    assert req["hints"]["local_path"] == str(tmp_path / "media" / "01UP" / "image.jpg")
    shared = RemoteWorker({"extract": _extract}, data_dir=tmp_path, token="", shared_paths=True)
    same = {"op": "extract", "item_id": "a", "url": "", "hints": {"local_path": "/x/y.jpg"}}
    assert shared.rewrite_request(same)["hints"]["local_path"] == "/x/y.jpg"
