"""Download stage: signed CDN URL first, then yt-dlp (anonymous, then cookies opt-in).

Returns the source asset(s) plus whatever yt-dlp already knows (title, canonical URL,
captions, comments) so later stages can skip work.
"""

from __future__ import annotations

import ipaddress
import json
import os
import shutil
import socket
import subprocess
import sys
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from . import ffmpeg
from .errors import WorkerError, classify_ytdlp_failure

MAX_BYTES = 500 * 1024 * 1024
DURATION_CAP_S = {"quick": 15 * 60, "standard": 15 * 60, "deep": 60 * 60}
"""Quick/Standard keep the first 15 minutes; Deep refuses beyond 60 (docs/MEDIA-PIPELINE.md)."""

SOURCE_STEM = "source"


@dataclass
class Downloaded:
    path: Path | None
    source: str  # cdn | ytdlp | direct
    kind: str  # video | image | audio
    title: str | None = None
    canonical_url: str | None = None
    duration_s: float | None = None
    width: int | None = None
    height: int | None = None
    captions_path: Path | None = None
    comments: list[dict[str, object]] = field(default_factory=list)
    comment_count: int | None = None
    warnings: list[str] = field(default_factory=list)


def sha256_of(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---- direct / CDN ------------------------------------------------------------------


def _assert_public_host(url: str) -> None:
    host = urlparse(url).hostname
    if not host:
        raise WorkerError("download_failed", "cdn_url has no host")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise WorkerError("download_failed", f"cannot resolve {host}: {e}", retryable=True) from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise WorkerError("download_failed", f"refusing to fetch private address {ip}")


def download_direct(url: str, out_dir: Path, progress: Callable[[int, str], None]) -> Downloaded:
    """Fetch a media URL we were handed (Instagram DM CDN link). No redirects to private hosts."""
    if urlparse(url).scheme != "https":
        raise WorkerError("download_failed", "cdn_url must be https")
    _assert_public_host(url)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Doubletake"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:  # noqa: S310 - https + host check above
            ctype = (res.headers.get("content-type") or "").split(";")[0].strip().lower()
            ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(ctype, "mp4")
            kind = "image" if ctype.startswith("image/") else "video"
            dest = out_dir / f"{'image' if kind == 'image' else SOURCE_STEM}.{ext}"
            total = int(res.headers.get("content-length") or 0)
            if total > MAX_BYTES:
                raise WorkerError("too_long", f"media is {total // (1 << 20)} MB (cap 500 MB)")
            written = 0
            with dest.open("wb") as f:
                while True:
                    chunk = res.read(1 << 20)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_BYTES:
                        raise WorkerError("too_long", "media exceeds the 500 MB cap")
                    f.write(chunk)
                    if total:
                        progress(int(written * 100 / total), "cdn")
    except urllib.error.HTTPError as e:
        code = "private_or_removed" if e.code in (401, 403, 404, 410) else "download_failed"
        raise WorkerError(code, f"CDN fetch failed: HTTP {e.code}", retryable=e.code >= 500) from e
    except urllib.error.URLError as e:
        raise WorkerError("download_failed", f"CDN fetch failed: {e.reason}", retryable=True) from e
    return _finish(Downloaded(path=dest, source="cdn", kind=kind))


# ---- yt-dlp -----------------------------------------------------------------------


def _ytdlp_cmd() -> list[str]:
    exe = shutil.which("yt-dlp")
    if exe:
        return [exe]
    return [sys.executable, "-m", "yt_dlp"]


def _base_args(mode: str) -> list[str]:
    height = 1080 if mode == "deep" else 720
    args = [
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "--no-part",
        "--restrict-filenames",
        "--max-filesize",
        f"{MAX_BYTES}",
        "-f",
        f"bv*[height<={height}]+ba/b[height<={height}]/bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "--socket-timeout",
        "30",
        "--retries",
        "2",
    ]
    browser = os.environ.get("DOUBLETAKE_YTDLP_COOKIES_FROM_BROWSER", "").strip()
    if browser:
        args += ["--cookies-from-browser", browser]
    return args


def _run_ytdlp(args: list[str], *, timeout: float) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            [*_ytdlp_cmd(), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as e:
        raise WorkerError(
            "tool_missing", "yt-dlp is not installed (uv sync in workers/media)"
        ) from e
    except subprocess.TimeoutExpired as e:
        raise WorkerError("download_failed", "yt-dlp timed out", retryable=True) from e


def _no_media(stderr: str) -> bool:
    low = stderr.lower()
    return any(
        m in low
        for m in (
            "no video formats found",
            "no media found",
            "unsupported url",
            "no video could be found",
            "there's no video in this",
            "does not contain a video",
            "requested format is not available",
        )
    )


def download_ytdlp(
    url: str,
    out_dir: Path,
    *,
    platform: str,
    mode: str,
    comments_budget: int,
    progress: Callable[[int, str], None],
) -> Downloaded:
    """yt-dlp: probe first (duration cap), then download + captions (+ comments for YouTube)."""
    progress(5, "probing")
    probe_args = [*_base_args(mode), "-J", "--skip-download"]
    want_comments = platform == "youtube" and comments_budget > 0
    if want_comments:
        probe_args += [
            "--write-comments",
            "--extractor-args",
            f"youtube:max_comments={comments_budget},all,{comments_budget},0;comment_sort=top",
        ]
    probe = _run_ytdlp([*probe_args, url], timeout=180 if want_comments else 90)
    if probe.returncode != 0 or not probe.stdout.strip():
        if _no_media(probe.stderr):
            return Downloaded(
                path=None,
                source="ytdlp",
                kind="none",
                warnings=["No downloadable video or audio was found at this URL."],
            )
        raise classify_ytdlp_failure(probe.stderr)
    info = json.loads(probe.stdout)
    duration = float(info.get("duration") or 0.0)
    cap = DURATION_CAP_S[mode if mode in DURATION_CAP_S else "standard"]
    warnings: list[str] = []
    if mode == "deep" and duration > cap:
        raise WorkerError(
            "too_long", f"media is {int(duration // 60)} min long; the cap is {cap // 60} min"
        )
    if duration > cap:
        warnings.append(
            f"Media is {int(duration // 60)} min long; only the first {cap // 60} min were "
            "transcribed and sampled (Deep mode allows 60)."
        )

    progress(15, "downloading")
    dl_args = [
        *_base_args(mode),
        "-o",
        str(out_dir / f"{SOURCE_STEM}.%(ext)s"),
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "en,en-orig,en-US,en-GB",
        "--sub-format",
        "vtt/srt/best",
        url,
    ]
    dl = _run_ytdlp(dl_args, timeout=900)
    media = _find_source(out_dir)
    if dl.returncode != 0 and media is None:
        raise classify_ytdlp_failure(dl.stderr)
    if dl.returncode != 0:
        # Media landed; the failure was a side file (captions 429 etc.). Keep going.
        warnings.append(f"yt-dlp warning: {_last_error_line(dl.stderr)}")
    if media is None:
        raise WorkerError("download_failed", "yt-dlp finished without producing a media file")
    captions = next(iter(sorted(out_dir.glob(f"{SOURCE_STEM}*.vtt"))), None) or next(
        iter(sorted(out_dir.glob(f"{SOURCE_STEM}*.srt"))), None
    )
    comments = info.get("comments") or []
    d = Downloaded(
        path=media,
        source="ytdlp",
        kind="video",
        title=info.get("title"),
        canonical_url=info.get("webpage_url"),
        captions_path=captions,
        comments=[_norm_comment(c) for c in comments[:comments_budget]] if comments else [],
        comment_count=info.get("comment_count"),
        warnings=warnings,
    )
    return _finish(d)


def _last_error_line(stderr: str) -> str:
    lines = [ln for ln in stderr.splitlines() if ln.startswith("ERROR")]
    return (lines[-1] if lines else stderr.strip()[-200:]).removeprefix("ERROR: ")[:200]


def _norm_comment(c: dict[str, object]) -> dict[str, object]:
    parent = c.get("parent")
    return {
        "id": str(c.get("id", "")),
        "author": c.get("author"),
        "text": c.get("text", ""),
        "likes": c.get("like_count"),
        "ts": c.get("timestamp"),
        **({"parent_id": str(parent)} if parent and parent != "root" else {}),
    }


def _find_source(out_dir: Path) -> Path | None:
    for ext in ("mp4", "webm", "mkv", "mov", "m4a", "mp3", "opus", "jpg", "png", "webp"):
        p = out_dir / f"{SOURCE_STEM}.{ext}"
        if p.exists():
            return p
    return None


def _finish(d: Downloaded) -> Downloaded:
    if d.path is None:
        return d
    meta = ffmpeg.probe(d.path)
    d.duration_s = float(meta["duration_s"] or 0) or None
    d.width = meta["width"]  # type: ignore[assignment]
    d.height = meta["height"]  # type: ignore[assignment]
    if meta["is_image"]:
        d.kind = "image"
    elif not meta["has_video"] and meta["has_audio"]:
        d.kind = "audio"
    return d
