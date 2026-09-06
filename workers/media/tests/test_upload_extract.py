"""Uploaded files: `hints.local_path` replaces the download step and never escapes `out_dir`."""

from pathlib import Path
from unittest import mock

import pytest

from doubletake_media import download, extract
from doubletake_media.errors import WorkerError


def test_local_source_validation(tmp_path: Path) -> None:
    out = tmp_path / "media" / "01UP"
    out.mkdir(parents=True)
    f = out / "image.jpg"
    f.write_bytes(b"\xff\xd8")
    assert extract._local_source({}, out) is None
    assert extract._local_source({"local_path": ""}, out) is None
    assert extract._local_source({"local_path": str(f)}, out) == f.resolve()
    with pytest.raises(WorkerError) as ei:
        extract._local_source({"local_path": "image.jpg"}, out)
    assert ei.value.code == "bad_request"
    outside = tmp_path / "elsewhere.jpg"
    outside.write_bytes(b"x")
    with pytest.raises(WorkerError) as ei:
        extract._local_source({"local_path": str(outside)}, out)
    assert ei.value.code == "bad_request"
    with pytest.raises(WorkerError) as ei:
        extract._local_source({"local_path": str(out / ".." / ".." / "elsewhere.jpg")}, out)
    assert ei.value.code == "bad_request"
    with pytest.raises(WorkerError) as ei:
        extract._local_source({"local_path": str(out / "missing.jpg")}, out)
    assert ei.value.code == "not_found"


def test_extract_needs_url_or_local(tmp_path: Path) -> None:
    with pytest.raises(WorkerError) as ei:
        extract.handle_extract({"url": "", "out_dir": str(tmp_path)}, lambda *_: None)
    assert ei.value.code == "bad_request"
    assert "local_path" in ei.value.message


def test_from_local_probes_and_marks_upload(tmp_path: Path) -> None:
    f = tmp_path / "image.jpg"
    f.write_bytes(b"\xff\xd8\xff\xd9")
    meta = {
        "duration_s": None,
        "width": 64,
        "height": 48,
        "is_image": True,
        "has_video": False,
        "has_audio": False,
    }
    with mock.patch.object(download.ffmpeg, "probe", lambda _p: meta):
        d = download.from_local(f)
    assert d.source == "upload"
    assert d.kind == "image"
    assert (d.width, d.height) == (64, 48)
    with mock.patch.object(download, "MAX_BYTES", 2), pytest.raises(WorkerError) as ei:
        download.from_local(f)
    assert ei.value.code == "too_large"
