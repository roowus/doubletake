"""download_direct must refuse to treat an HTML page (an Instagram permalink) as media."""

import io
from pathlib import Path
from unittest import mock

import pytest

from doubletake_media import download
from doubletake_media.errors import WorkerError


class _Resp(io.BytesIO):
    def __init__(self, body: bytes, ctype: str) -> None:
        super().__init__(body)
        self.headers = {"content-type": ctype, "content-length": str(len(body))}

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *a: object) -> None:
        self.close()


def _patch(resp: _Resp):
    return (
        mock.patch.object(download, "_assert_public_host", lambda _url: None),
        mock.patch("urllib.request.urlopen", lambda *a, **k: resp),
    )


def test_html_permalink_is_not_media(tmp_path: Path) -> None:
    resp = _Resp(b"<html>reel page</html>", "text/html; charset=utf-8")
    a, b = _patch(resp)
    with a, b, pytest.raises(WorkerError) as ei:
        download.download_direct("https://www.instagram.com/reel/abc/", tmp_path, lambda *_: None)
    assert ei.value.code == "download_failed"
    assert "text/html" in ei.value.message
    assert not list(tmp_path.iterdir())


def test_image_is_accepted(tmp_path: Path) -> None:
    resp = _Resp(b"\xff\xd8\xff", "image/jpeg")
    a, b = _patch(resp)
    with a, b, mock.patch.object(download, "_finish", lambda d: d):
        out = download.download_direct("https://cdn.example/x.jpg", tmp_path, lambda *_: None)
    assert out.kind == "image"
    assert out.path.name == "image.jpg"
